import { neonPanelRequest } from '../../../../clients/neonpanel-api';

interface CompaniesWithPermissionResponse {
  companies?: Array<{ company_id?: number; companyId?: number; id?: number } | null>;
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
