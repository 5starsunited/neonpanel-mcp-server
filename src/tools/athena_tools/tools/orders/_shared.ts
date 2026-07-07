import { runAthenaQuery } from '../../../../clients/athena';
import { config } from '../../../../config';
import { getPermittedCompanyIds } from '../../../../lib/permitted-companies';

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

/**
 * UTC offset (in minutes) for an IANA time zone at a given instant — DST-aware.
 * e.g. America/Los_Angeles → -420 in summer (PDT), -480 in winter (PST).
 * Returns null if the zone can't be resolved.
 */
export function tzOffsetMinutes(timeZone: string, at: Date): number | null {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      timeZoneName: 'shortOffset',
    }).formatToParts(at);
    const name = parts.find((p) => p.type === 'timeZoneName')?.value; // "GMT-7", "GMT+5:30", "GMT"
    if (!name) return null;
    if (name === 'GMT' || name === 'UTC') return 0;
    const m = name.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/);
    if (!m) return null;
    const sign = m[1] === '-' ? -1 : 1;
    return sign * (parseInt(m[2], 10) * 60 + (m[3] ? parseInt(m[3], 10) : 0));
  } catch {
    return null;
  }
}

/**
 * Default bucketing offset (minutes from UTC) derived from the company's
 * app_companies.timezone, DST-aware for the given reference date. No hardcoded
 * offset: it follows whatever zone the company is configured with. Falls back to
 * America/Los_Angeles only if the company has no usable zone.
 */
export async function resolveDefaultUtcOffsetMinutes(
  companyIds: number[],
  referenceDate: Date,
  fallbackZone = 'America/Los_Angeles',
): Promise<number> {
  const zone = await resolveDefaultTimeZone(companyIds, fallbackZone);
  const offset = tzOffsetMinutes(zone, referenceDate);
  if (offset !== null) return offset;
  return tzOffsetMinutes(fallbackZone, referenceDate) ?? -480;
}

export async function fetchPermittedCompanyIds(userToken: string): Promise<number[]> {
  const permissions = [
    'view:quicksight_group.sales_and_marketing_new',
    'view:quicksight_group.marketing',
  ];

  return Array.from(await getPermittedCompanyIds(userToken, permissions));
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
