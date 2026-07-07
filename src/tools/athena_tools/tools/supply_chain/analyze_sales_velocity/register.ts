import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { runAthenaQuery } from '../../../../../clients/athena';
import { neonPanelRequest } from '../../../../../clients/neonpanel-api';
import { config } from '../../../../../config';
import type { ToolExecutionContext, ToolRegistry, ToolSpecJson } from '../../../../types';
import { loadTextFile } from '../../../runtime/load-assets';
import { renderSqlTemplate } from '../../../runtime/render-sql';
import { buildItemPresentation } from '../../../runtime/presentation';

type CompaniesWithPermissionResponse = {
  companies?: Array<{
    company_id?: number;
    companyId?: number;
    id?: number;
    uuid?: string;
    name?: string;
    short_name?: string;
  }>;
};

function toInt(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.trunc(n);
}

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return null;
  return n;
}

function getRowValue(row: Record<string, unknown>, key: string): unknown {
  return row[key];
}

function sqlEscapeString(value: string): string {
  return value.replace(/'/g, "''");
}

function sqlStringLiteral(value: string): string {
  return `'${sqlEscapeString(value)}'`;
}

function sqlVarcharArrayExpr(values: string[]): string {
  if (values.length === 0) return 'CAST(ARRAY[] AS ARRAY(VARCHAR))';
  return `CAST(ARRAY[${values.map(sqlStringLiteral).join(',')}] AS ARRAY(VARCHAR))`;
}

function sqlCompanyIdArrayExpr(values: number[]): string {
  if (values.length === 0) return 'CAST(ARRAY[] AS ARRAY(BIGINT))';
  return `CAST(ARRAY[${values.map((n) => String(Math.trunc(n))).join(',')}] AS ARRAY(BIGINT))`;
}

type OutputMode = 'detail_only' | 'total_only' | 'detail_plus_total';

type Severity = 'info' | 'warn' | 'critical';

type DiagnosticIssue = {
  code: string;
  severity: Severity;
  explanation: string;
};

const inputSchema = z
  .object({
    company: z.string().optional(),
    company_id: z.coerce.number().int().min(1).optional(),
    company_ids: z.array(z.coerce.number().int().min(1)).optional(),
    brand: z.array(z.string()).optional(),
    marketplace: z.array(z.string()).optional(),
    marketplaces: z.array(z.string()).optional(),
    product_family: z.array(z.string()).optional(),
    parent_asin: z.array(z.string()).optional(),
    asin: z.array(z.string()).optional(),
    sku: z.array(z.string().min(1)).min(1).max(10),
    revenue_abcd_class: z.array(z.enum(['A', 'B', 'C', 'D'])).optional(),
    output_mode: z.enum(['detail_only', 'total_only', 'detail_plus_total']).default('detail_only').optional(),
    traffic_weight_3d: z.coerce.number().min(0).default(0.5).optional(),
    traffic_weight_7d: z.coerce.number().min(0).default(0.3).optional(),
    traffic_weight_30d: z.coerce.number().min(0).default(0.2).optional(),
    coverage_days_override: z.coerce.number().int().min(1).optional(),
    months_ahead: z.coerce.number().int().min(1).max(5).default(3).optional(),
    limit: z.coerce.number().int().min(1).default(200).optional(),
  })
  .strict();

function calculateMedian(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function computeIssues(row: {
  traffic_3d: number;
  traffic_7d: number;
  traffic_30d: number;
  traffic_weighted_recent: number;
  plan_month_1_units: number;
  plan_month_2_units: number;
  plan_horizon_units_per_day: number;
  units_sold_last_30_days: number;
}): DiagnosticIssue[] {
  const issues: DiagnosticIssue[] = [];

  const traffic3 = row.traffic_3d;
  const traffic7 = row.traffic_7d;
  const traffic30 = row.traffic_30d;
  const recent = row.traffic_weighted_recent;
  const planM1 = row.plan_month_1_units;
  const planM2 = row.plan_month_2_units;
  const planH = row.plan_horizon_units_per_day;

  // insufficient data volume
  if ((row.units_sold_last_30_days ?? 0) < 5 && recent <= 0.25) {
    issues.push({
      code: 'insufficient_data_volume',
      severity: 'info',
      explanation: 'Low 30d unit volume; velocity signals may be noisy.',
    });
  }

  // sudden drops/spikes
  if (traffic30 > 0.25) {
    const ratio3to30 = traffic3 / traffic30;
    if (ratio3to30 < 0.3) {
      issues.push({
        code: 'sudden_demand_drop',
        severity: 'critical',
        explanation: `3d velocity (${traffic3.toFixed(2)}) is <30% of 30d velocity (${traffic30.toFixed(2)}).`,
      });
    } else if (ratio3to30 > 2.5) {
      issues.push({
        code: 'sudden_demand_spike',
        severity: 'warn',
        explanation: `3d velocity (${traffic3.toFixed(2)}) is >250% of 30d velocity (${traffic30.toFixed(2)}).`,
      });
    }
  }

  // high disagreement across realized sources
  const realized = [traffic3, traffic7, traffic30].filter((v) => Number.isFinite(v));
  const realizedMean = realized.length ? realized.reduce((s, v) => s + v, 0) / realized.length : 0;
  const realizedRange = realized.length ? Math.max(...realized) - Math.min(...realized) : 0;
  if (realizedMean > 0 && realizedRange / realizedMean > 0.8) {
    issues.push({
      code: 'high_disagreement_realized_sources',
      severity: 'warn',
      explanation: '3d/7d/30d realized velocities disagree significantly; treat recommendations with caution.',
    });
  }

  // plan increasing while recent realized decreasing
  if (planM1 > 0 && planM2 > planM1 * 1.15 && traffic30 > 0 && recent < traffic30 * 0.85) {
    issues.push({
      code: 'plan_increasing_while_sales_decreasing',
      severity: 'warn',
      explanation: `Plan appears to increase (M2 ${planM2.toFixed(0)} > M1 ${planM1.toFixed(0)}) while recent realized demand is below 30d baseline.`,
    });
  }

  // large plan vs actual divergence
  if (recent > 0.1 && planH > 0.1) {
    const ratio = planH / recent;
    if (ratio > 1.8 || ratio < 0.55) {
      issues.push({
        code: 'large_plan_vs_actual_divergence',
        severity: ratio > 2.5 || ratio < 0.4 ? 'critical' : 'warn',
        explanation: `Plan-horizon velocity (${planH.toFixed(2)}/day) diverges from realized recent velocity (${recent.toFixed(2)}/day).`,
      });
    }
  }

  return issues;
}

function computeConfidence(opts: {
  base: number;
  issues: DiagnosticIssue[];
  unitsSold30d: number;
}): number {
  let conf = opts.base;

  if ((opts.unitsSold30d ?? 0) < 5) conf -= 0.2;
  if ((opts.unitsSold30d ?? 0) < 1) conf -= 0.2;

  for (const issue of opts.issues) {
    if (issue.severity === 'warn') conf -= 0.15;
    if (issue.severity === 'critical') conf -= 0.3;
  }

  return clamp01(conf);
}

function resolveRequestedCompanyId(parsed: z.infer<typeof inputSchema>): { companyId?: number; error?: string } {
  if (typeof parsed.company_id === 'number' && Number.isFinite(parsed.company_id) && parsed.company_id > 0) {
    return { companyId: parsed.company_id };
  }

  if (Array.isArray(parsed.company_ids)) {
    const ids = parsed.company_ids
      .map((v) => toInt(v))
      .filter((v): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0);
    if (ids.length === 1) return { companyId: ids[0] };
    if (ids.length > 1) {
      return { error: 'company_ids accepts exactly one id for this tool. Use company_id.' };
    }
  }

  if (typeof parsed.company === 'string') {
    const asInt = toInt(parsed.company);
    if (asInt && asInt > 0) return { companyId: asInt };
    return { error: 'company must be a numeric company_id. Use company_id.' };
  }

  return {};
}

export function registerSupplyChainAnalyzeSalesVelocityTool(registry: ToolRegistry) {
  const toolJsonPath = path.join(__dirname, 'tool.json');
  const sqlPath = path.join(__dirname, 'query.sql');

  let specJson: ToolSpecJson | undefined;
  try {
    if (fs.existsSync(toolJsonPath)) {
      specJson = JSON.parse(fs.readFileSync(toolJsonPath, 'utf8')) as ToolSpecJson;
    }
  } catch {
    specJson = undefined;
  }

  registry.register({
    name: 'supply_chain_analyze_sales_velocity',
    description:
      'Analyze sales velocity signals + plan, detect anomalies, and produce explainable recommended velocities (read-only).',
    isConsequential: false,
    inputSchema,
    outputSchema: specJson?.outputSchema ?? { type: 'object', additionalProperties: true },
    specJson,
    execute: async (args, context) => {
      const parsed = inputSchema.parse(args);
      const warnings: string[] = [];

      const requested = resolveRequestedCompanyId(parsed);
      if (requested.error) {
        return { items: [], meta: { warnings, error: requested.error } };
      }

      // Permission gate - user needs at least ONE of these permissions
      const permissions = [
        'view:quicksight_group.inventory_management_new',
        'view:quicksight_group.finance-new',
      ];

      const allPermittedCompanyIds = new Set<number>();
      for (const permission of permissions) {
        try {
          const permissionResponse = await neonPanelRequest<CompaniesWithPermissionResponse>({
            token: context.userToken,
            path: `/api/v1/permissions/${encodeURIComponent(permission)}/companies`,
          });

          const permittedCompanies = (permissionResponse.companies ?? []).filter(
            (c): c is { company_id?: number; companyId?: number; id?: number } => c !== null && typeof c === 'object',
          );

          permittedCompanies.forEach((c) => {
            const id = c.company_id ?? c.companyId ?? c.id;
            if (typeof id === 'number' && Number.isFinite(id) && id > 0) {
              allPermittedCompanyIds.add(id);
            }
          });
        } catch (err) {
          // Continue if one permission check fails
        }
      }

      const permittedCompanyIds = Array.from(allPermittedCompanyIds);
      const requestedCompanyIds = requested.companyId ? [requested.companyId] : permittedCompanyIds;
      const allowedCompanyIds = requestedCompanyIds.filter((id) => permittedCompanyIds.includes(id));

      if (permittedCompanyIds.length === 0 || allowedCompanyIds.length === 0) {
        return { items: [], meta: { warnings } };
      }

      const catalog = config.athena.catalog;
      const database = config.athena.database;
      const table = config.athena.tables.inventoryPlanningSnapshot;
      const forecastingDatabase = config.athena.tables.forecastingDatabase;
      const salesForecastTable = config.athena.tables.salesForecast;

      const limit = parsed.limit ?? 200;

      const skus = (parsed.sku ?? []).filter((v: unknown): v is string => typeof v === 'string' && v.trim().length > 0).map((v: string) => v.trim());
      if (skus.length === 0) {
        return { items: [], meta: { warnings: ['sku is required — provide 1-10 SKUs.'] } };
      }
      if (skus.length > 10) {
        return { items: [], meta: { warnings: ['sku accepts at most 10 SKUs per call.'] } };
      }
      const asins = (parsed.asin ?? []).filter((v: unknown): v is string => typeof v === 'string' && v.trim().length > 0).map((v: string) => v.trim());
      const parentAsins = (parsed.parent_asin ?? [])
        .filter((v: unknown): v is string => typeof v === 'string' && v.trim().length > 0)
        .map((v: string) => v.trim());
      const brands = (parsed.brand ?? [])
        .filter((v: unknown): v is string => typeof v === 'string' && v.trim().length > 0)
        .map((v: string) => v.trim());
      const productFamilies = (parsed.product_family ?? [])
        .filter((v: unknown): v is string => typeof v === 'string' && v.trim().length > 0)
        .map((v: string) => v.trim());

      const revenueAbcdClasses = (parsed.revenue_abcd_class ?? [])
        .map((v: unknown) => (typeof v === 'string' ? v.trim().toUpperCase() : ''))
        .filter((v: string): v is 'A' | 'B' | 'C' | 'D' => v === 'A' || v === 'B' || v === 'C' || v === 'D');

      const marketplaceFilter = parsed.marketplace ?? parsed.marketplaces ?? [];
      const marketplacesRaw = (Array.isArray(marketplaceFilter) ? marketplaceFilter : [marketplaceFilter])
        .map((v: unknown) => (typeof v === 'string' ? v.trim().toUpperCase() : ''))
        .filter((v: string) => v.length > 0);

      // Treat ALL as "no filter" only when it is the only selection.
      const marketplaces = marketplacesRaw.filter((m: string) => m !== 'ALL').filter((m: string) => m === 'US' || m === 'UK');

      if (marketplacesRaw.some((m: string) => m && m !== 'ALL' && m !== 'US' && m !== 'UK')) {
        warnings.push(`marketplace/marketplaces contains unsupported values; allowed: US, UK, ALL.`);
      }

      const weights = {
        w3: Number(parsed.traffic_weight_3d ?? 0.5),
        w7: Number(parsed.traffic_weight_7d ?? 0.3),
        w30: Number(parsed.traffic_weight_30d ?? 0.2),
      };

      const weightSum = weights.w3 + weights.w7 + weights.w30;
      if (Math.abs(weightSum - 1.0) > 0.05) {
        warnings.push(`traffic_weight_* sum to ${weightSum.toFixed(3)} (recommended: 1.0).`);
      }

      const monthsAhead = Math.max(1, Math.min(5, Number(parsed.months_ahead ?? 3)));

      const coverageOverride = parsed.coverage_days_override;

      const template = await loadTextFile(sqlPath);
      const query = renderSqlTemplate(template, {
        catalog,
        database,
        table,
        forecasting_database: forecastingDatabase,
        sales_forecast_table: salesForecastTable,

        company_ids_array: sqlCompanyIdArrayExpr(allowedCompanyIds),
        skus_array: sqlVarcharArrayExpr(skus),
        asins_array: sqlVarcharArrayExpr(asins),
        parent_asins_array: sqlVarcharArrayExpr(parentAsins),
        brands_array: sqlVarcharArrayExpr(brands),
        product_families_array: sqlVarcharArrayExpr(productFamilies),
        marketplaces_array: sqlVarcharArrayExpr(marketplaces),
        revenue_abcd_classes_array: sqlVarcharArrayExpr(revenueAbcdClasses),

        traffic_weight_3d: weights.w3,
        traffic_weight_7d: weights.w7,
        traffic_weight_30d: weights.w30,
        coverage_days_override_sql: coverageOverride ? String(Math.trunc(coverageOverride)) : 'CAST(NULL AS INTEGER)',

        limit_top_n: Number(limit),
      });

      const athenaResult = await runAthenaQuery({
        query,
        database,
        workGroup: config.athena.workgroup,
        outputLocation: config.athena.outputLocation,
        maxRows: Math.min(5000, limit),
      });

      const rows = (athenaResult.rows ?? []) as Array<Record<string, unknown>>;

      const items = rows.map((r) => {
        const item_ref = {
          inventory_id: toInt(getRowValue(r, 'item_ref_inventory_id')) ?? undefined,
          sku: (getRowValue(r, 'item_ref_sku') ?? undefined) as string | undefined,
          asin: (getRowValue(r, 'item_ref_asin') ?? undefined) as string | undefined,
          marketplace: (getRowValue(r, 'item_ref_marketplace') ?? undefined) as 'US' | 'UK' | undefined,
          item_name: (getRowValue(r, 'item_ref_item_name') ?? undefined) as string | undefined,
          item_icon_url: (getRowValue(r, 'item_ref_item_icon_url') ?? undefined) as string | undefined,
        };

        const traffic_3d = toNumber(getRowValue(r, 'traffic_3d')) ?? 0;
        const traffic_7d = toNumber(getRowValue(r, 'traffic_7d')) ?? 0;
        const traffic_30d = toNumber(getRowValue(r, 'traffic_30d')) ?? 0;
        const restock_30d = toNumber(getRowValue(r, 'restock_30d')) ?? 0;
        const traffic_weighted_recent = toNumber(getRowValue(r, 'traffic_weighted_recent')) ?? 0;
        const plan_horizon_units_per_day = toNumber(getRowValue(r, 'plan_horizon_units_per_day')) ?? 0;
        const plan_horizon_total_units = toNumber(getRowValue(r, 'plan_horizon_total_units')) ?? 0;
        const planning_horizon_days = toInt(getRowValue(r, 'planning_horizon_days')) ?? 0;
        const units_sold_last_30_days = toNumber(getRowValue(r, 'units_sold_last_30_days')) ?? 0;

        const planMonths = [
          {
            yyyy_mm: (getRowValue(r, 'plan_month_1_yyyy_mm') ?? undefined) as string | undefined,
            planned_units: toNumber(getRowValue(r, 'plan_month_1_units')) ?? 0,
          },
          {
            yyyy_mm: (getRowValue(r, 'plan_month_2_yyyy_mm') ?? undefined) as string | undefined,
            planned_units: toNumber(getRowValue(r, 'plan_month_2_units')) ?? 0,
          },
          {
            yyyy_mm: (getRowValue(r, 'plan_month_3_yyyy_mm') ?? undefined) as string | undefined,
            planned_units: toNumber(getRowValue(r, 'plan_month_3_units')) ?? 0,
          },
          {
            yyyy_mm: (getRowValue(r, 'plan_month_4_yyyy_mm') ?? undefined) as string | undefined,
            planned_units: toNumber(getRowValue(r, 'plan_month_4_units')) ?? 0,
          },
          {
            yyyy_mm: (getRowValue(r, 'plan_month_5_yyyy_mm') ?? undefined) as string | undefined,
            planned_units: toNumber(getRowValue(r, 'plan_month_5_units')) ?? 0,
          },
        ]
          .filter((m) => typeof m.yyyy_mm === 'string' && m.yyyy_mm.length > 0)
          .slice(0, monthsAhead);

        const issues = computeIssues({
          traffic_3d,
          traffic_7d,
          traffic_30d,
          traffic_weighted_recent,
          plan_month_1_units: planMonths[0]?.planned_units ?? 0,
          plan_month_2_units: planMonths[1]?.planned_units ?? 0,
          plan_horizon_units_per_day,
          units_sold_last_30_days,
        });

        const fba_confidence = computeConfidence({ base: 0.9, issues, unitsSold30d: units_sold_last_30_days });
        const po_confidence = computeConfidence({ base: 0.85, issues, unitsSold30d: units_sold_last_30_days });

        const fba_rec = {
          units_per_day: traffic_weighted_recent,
          source: 'traffic_weighted_recent',
          confidence: fba_confidence,
        };

        const po_rec = {
          units_per_day: plan_horizon_units_per_day,
          source: 'plan_horizon_units_per_day',
          planning_horizon_days,
          confidence: po_confidence,
        };

        return {
          company_id: toInt(getRowValue(r, 'company_id')) ?? undefined,
          child_asin: (getRowValue(r, 'child_asin') ?? undefined) as string | undefined,
          parent_asin: (getRowValue(r, 'parent_asin') ?? undefined) as string | undefined,
          brand: (getRowValue(r, 'brand') ?? undefined) as string | undefined,
          product_family: (getRowValue(r, 'product_family') ?? undefined) as string | undefined,
          revenue_abcd_class: (getRowValue(r, 'revenue_abcd_class') ?? undefined) as string | undefined,

          item_ref,
          presentation: buildItemPresentation({
            sku: item_ref.sku,
            asin: item_ref.asin,
            inventory_id: item_ref.inventory_id,
            marketplace_code: item_ref.marketplace,
            image_url: item_ref.item_icon_url,
            image_source_field: 'item_ref.item_icon_url',
          }),

          realized_velocities: {
            traffic_3d,
            traffic_7d,
            traffic_30d,
            restock_30d,
          },

          derived: {
            traffic_weighted_recent,
          },

          plan: {
            months: planMonths,
          },

          plan_horizon: {
            planning_horizon_days,
            total_planned_units: plan_horizon_total_units,
            units_per_day_in_horizon: plan_horizon_units_per_day,
          },

          recommendations: {
            fba_replenishment: fba_rec,
            po_placement: po_rec,
          },

          diagnostics: issues,

          raw_inputs: {
            weights: { ...weights },
            months_ahead: monthsAhead,
          },
        };
      });

      const output_mode: OutputMode = (parsed.output_mode ?? 'detail_only') as OutputMode;

      const summary = (() => {
        const severityCounts: Record<Severity, number> = { info: 0, warn: 0, critical: 0 };
        let fbaConfSum = 0;
        let poConfSum = 0;
        let highRisk = 0;

        const ratios: number[] = [];

        for (const it of items) {
          const issues: DiagnosticIssue[] = Array.isArray((it as any).diagnostics) ? (it as any).diagnostics : [];
          for (const issue of issues) severityCounts[issue.severity] = (severityCounts[issue.severity] ?? 0) + 1;
          if (issues.some((i) => i.severity === 'critical')) highRisk += 1;

          fbaConfSum += (it as any).recommendations?.fba_replenishment?.confidence ?? 0;
          poConfSum += (it as any).recommendations?.po_placement?.confidence ?? 0;

          const recent = (it as any).derived?.traffic_weighted_recent ?? 0;
          const planV = (it as any).plan_horizon?.units_per_day_in_horizon ?? 0;
          if (recent > 0.05 && planV > 0) ratios.push(planV / recent);
        }

        return {
          item_count: items.length,
          alert_counts_by_severity: severityCounts,
          high_risk_item_count: highRisk,
          plan_vs_actual_ratio_avg: ratios.length ? ratios.reduce((s, v) => s + v, 0) / ratios.length : null,
          plan_vs_actual_ratio_median: calculateMedian(ratios),
          avg_confidence: {
            fba_replenishment: items.length ? fbaConfSum / items.length : null,
            po_placement: items.length ? poConfSum / items.length : null,
          },
        };
      })();

      if (output_mode === 'total_only') {
        return { summary, meta: { warnings } };
      }

      if (output_mode === 'detail_plus_total') {
        return { items, summary, meta: { warnings } };
      }

      return { items, meta: { warnings } };
    },
  });
}
