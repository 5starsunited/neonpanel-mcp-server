import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { runAthenaQuery } from '../../../../../clients/athena';
import { config } from '../../../../../config';
import type { ToolRegistry, ToolSpecJson } from '../../../../types';
import { loadTextFile } from '../../../runtime/load-assets';
import { renderSqlTemplate } from '../../../runtime/render-sql';
import { isAuthorizedForCompany, sqlString } from '../_intent_common';

const inputSchema = z
  .object({
    company_id: z.coerce.number().int().min(1),
    status: z.enum(['active', 'archived', 'merged', 'all']).default('active').optional(),
    intent_ids: z.array(z.string().min(1).max(64)).optional(),
    search_terms: z.array(z.string().min(1).max(300)).min(1).max(2000).optional(),
    limit: z.coerce.number().int().min(1).max(500).default(50).optional(),
    offset: z.coerce.number().int().min(0).default(0).optional(),
  })
  .strict();

function parseIntOrZero(v: unknown): number {
  if (v == null) return 0;
  const n = Number.parseInt(String(v), 10);
  return Number.isFinite(n) ? n : 0;
}

function parseFloatOrNull(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = Number.parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
}

export function registerBrandAnalyticsListUserIntentClustersTool(registry: ToolRegistry) {
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

  const coverageSqlPath = path.join(__dirname, 'coverage_query.sql');

  registry.register({
    name: specJson?.name ?? 'brand_analytics_list_user_intent_clusters',
    description:
      specJson?.description ??
      'Lists intent clusters for a company with rolled-up search-term counts and avg confidence.',
    isConsequential: false,
    inputSchema,
    outputSchema: specJson?.outputSchema ?? { type: 'object', additionalProperties: true },
    specJson,
    execute: async (args, context) => {
      const parsed = inputSchema.parse(args);
      const companyId = parsed.company_id;
      const status = parsed.status ?? 'active';
      const limit = parsed.limit ?? 50;
      const offset = parsed.offset ?? 0;
      const catalog = config.athena.catalog;
      const inputSearchTerms = parsed.search_terms ?? null;

      const authorized = await isAuthorizedForCompany(companyId, context);
      if (!authorized) {
        return { intents: [], total_count: 0, limit, offset, error: 'Not authorized for this company.' };
      }

      const statusFilterSql = status === 'all' ? 'TRUE' : `li.status = ${sqlString(status)}`;
      const intentIds = parsed.intent_ids ?? [];
      const intentIdsFilterSql =
        intentIds.length === 0
          ? 'TRUE'
          : `li.intent_id IN (${intentIds.map((s) => sqlString(s)).join(', ')})`;

      const template = await loadTextFile(sqlPath);
      const rendered = renderSqlTemplate(template, {
        catalog,
        company_id: companyId,
        status_filter_sql: statusFilterSql,
        intent_ids_filter_sql: intentIdsFilterSql,
        offset,
        limit_top_n: limit,
      });

      const athenaResult = await runAthenaQuery({
        query: rendered,
        database: 'brand_analytics_iceberg',
        workGroup: config.athena.workgroup,
        outputLocation: config.athena.outputLocation,
        maxRows: limit,
      });

      const rows = athenaResult.rows ?? [];
      const totalCount = rows.length > 0 ? parseIntOrZero(rows[0]?.total_count) : 0;
      const intents = rows.map((r) => ({
        id: parseIntOrZero(r.id),
        company_id: parseIntOrZero(r.company_id),
        intent_id: r.intent_id ?? '',
        intent_name: r.intent_name ?? '',
        customer_need: r.customer_need ?? '',
        status: r.status ?? '',
        source: r.source ?? null,
        clustering_run_id: r.clustering_run_id == null ? null : parseIntOrZero(r.clustering_run_id),
        search_term_count: parseIntOrZero(r.search_term_count),
        avg_confidence: parseFloatOrNull(r.avg_confidence),
        created_at: r.created_at ?? '',
        created_by: r.created_by ?? null,
      }));

      return {
        intents,
        total_count: totalCount,
        limit,
        offset,
        ...(await buildCoverageBlock({
          inputSearchTerms,
          companyId,
          catalog,
          coverageSqlPath,
        })),
      };
    },
  });
}

async function buildCoverageBlock(opts: {
  inputSearchTerms: string[] | null;
  companyId: number;
  catalog: string;
  coverageSqlPath: string;
}): Promise<{
  coverage?: {
    input_count: number;
    covered_count: number;
    uncovered_count: number;
    covered: Array<{ term: string; intent_ids: string[] }>;
    uncovered: string[];
  };
  next_steps?: string[];
}> {
  if (!opts.inputSearchTerms || opts.inputSearchTerms.length === 0) return {};

  // Dedup + lowercase the input.
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const raw of opts.inputSearchTerms) {
    const t = raw.trim().toLowerCase();
    if (t && !seen.has(t)) {
      seen.add(t);
      normalized.push(t);
    }
  }
  if (normalized.length === 0) return {};

  const termsInListSql = normalized.map((t) => sqlString(t)).join(', ');
  const template = await loadTextFile(opts.coverageSqlPath);
  const sql = renderSqlTemplate(template, {
    catalog: opts.catalog,
    company_id: opts.companyId,
    terms_in_list_sql: termsInListSql,
  });

  const result = await runAthenaQuery({
    query: sql,
    database: 'brand_analytics_iceberg',
    workGroup: config.athena.workgroup,
    outputLocation: config.athena.outputLocation,
    maxRows: normalized.length * 5,
  });

  const byTerm = new Map<string, Set<string>>();
  for (const row of result.rows ?? []) {
    const term = String(row.search_term ?? '').toLowerCase();
    const intentId = String(row.intent_id ?? '');
    if (!term || !intentId) continue;
    let set = byTerm.get(term);
    if (!set) {
      set = new Set<string>();
      byTerm.set(term, set);
    }
    set.add(intentId);
  }

  const covered = normalized
    .filter((t) => byTerm.has(t))
    .map((t) => ({ term: t, intent_ids: Array.from(byTerm.get(t) ?? []).sort() }));
  const uncovered = normalized.filter((t) => !byTerm.has(t));

  const nextSteps: string[] = [];
  if (uncovered.length > 0) {
    nextSteps.push(
      `Cluster the ${uncovered.length} uncovered term(s) via brand_analytics_cluster_search_terms (use the \`uncovered\` array as \`search_terms\`).`,
    );
  } else {
    nextSteps.push('All input search terms are already mapped to intents. No clustering needed.');
  }

  return {
    coverage: {
      input_count: normalized.length,
      covered_count: covered.length,
      uncovered_count: uncovered.length,
      covered,
      uncovered,
    },
    next_steps: nextSteps,
  };
}
