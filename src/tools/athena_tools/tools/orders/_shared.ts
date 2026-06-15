import { neonPanelRequest } from '../../../../clients/neonpanel-api';
import { runAthenaQuery } from '../../../../clients/athena';
import { config } from '../../../../config';

interface CompaniesWithPermissionResponse {
  companies?: Array<{ company_id?: number; companyId?: number; id?: number } | null>;
}

export interface CompanyReportingSettings {
  company_id: number;
  main_currency: string | null;
  time_zone: string | null;
}

/**
 * Per-company reporting defaults from neonpanel_iceberg.app_companies:
 * main reporting currency (`currency`) and time zone (`timezone`).
 */
export async function fetchCompanyReportingSettings(
  companyIds: number[],
): Promise<CompanyReportingSettings[]> {
  if (companyIds.length === 0) return [];
  const idList = companyIds.map((n) => String(Math.trunc(n))).join(', ');
  const query = `SELECT id AS company_id, currency AS main_currency, timezone AS time_zone
    FROM "${config.athena.catalog}"."neonpanel_iceberg"."app_companies"
    WHERE id IN (${idList})`;
  try {
    const result = await runAthenaQuery({
      query,
      database: 'neonpanel_iceberg',
      workGroup: config.athena.workgroup,
      outputLocation: config.athena.outputLocation,
      maxRows: 1000,
    });
    return (result.rows ?? []).map((r: Record<string, unknown>) => ({
      company_id: Number(r.company_id),
      main_currency: (r.main_currency as string) ?? null,
      time_zone: (r.time_zone as string) ?? null,
    }));
  } catch {
    return [];
  }
}

/**
 * Resolve the time zone to bucket by: the shared company time zone when all
 * requested companies agree, else the fallback (America/Los_Angeles).
 */
export async function resolveDefaultTimeZone(
  companyIds: number[],
  fallback = 'America/Los_Angeles',
): Promise<string> {
  const settings = await fetchCompanyReportingSettings(companyIds);
  const zones = Array.from(
    new Set(settings.map((s) => s.time_zone).filter((z): z is string => !!z)),
  );
  return zones.length === 1 ? zones[0] : fallback;
}

export async function fetchPermittedCompanyIds(userToken: string): Promise<number[]> {
  const permissions = [
    'view:quicksight_group.sales_and_marketing_new',
    'view:quicksight_group.marketing',
  ];

  const allPermittedCompanyIds = new Set<number>();

  for (const permission of permissions) {
    try {
      const response = await neonPanelRequest<CompaniesWithPermissionResponse>({
        token: userToken,
        path: `/api/v1/permissions/${encodeURIComponent(permission)}/companies`,
      });

      for (const company of response.companies ?? []) {
        if (!company) continue;
        const id = company.company_id ?? company.companyId ?? company.id;
        if (typeof id === 'number' && Number.isFinite(id) && id > 0) {
          allPermittedCompanyIds.add(id);
        }
      }
    } catch {
      // Some tokens may not be eligible for one permission group; the other can still authorize.
    }
  }

  return Array.from(allPermittedCompanyIds);
}

export function sqlStringLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

export function sqlBigintArrayExpr(values: number[]): string {
  if (values.length === 0) return 'CAST(ARRAY[] AS ARRAY(BIGINT))';
  return `CAST(ARRAY[${values.map((v) => String(Math.trunc(v))).join(', ')}] AS ARRAY(BIGINT))`;
}

export function sqlVarcharArrayExpr(values: string[]): string {
  if (values.length === 0) return 'CAST(ARRAY[] AS ARRAY(VARCHAR))';
  return `CAST(ARRAY[${values.map(sqlStringLiteral).join(', ')}] AS ARRAY(VARCHAR))`;
}

export function sqlDateExpr(value?: string): string {
  const trimmed = value?.trim();
  if (!trimmed) return 'CAST(NULL AS DATE)';
  return `DATE ${sqlStringLiteral(trimmed)}`;
}
