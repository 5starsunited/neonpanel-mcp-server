import { neonPanelRequest } from '../../../../clients/neonpanel-api';
import type { ToolExecutionContext } from '../../../types';

export interface CompaniesWithPermissionResponse {
  companies?: Array<{ company_id?: number; companyId?: number; id?: number } | null>;
}

export function sqlStringLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

export function sqlNullableDateLiteral(value: string | undefined): string {
  return value ? `DATE ${sqlStringLiteral(value)}` : 'CAST(NULL AS DATE)';
}

export function sqlVarcharArrayExpr(values: string[]): string {
  if (values.length === 0) return 'CAST(ARRAY[] AS ARRAY(VARCHAR))';
  return `CAST(ARRAY[${values.map(sqlStringLiteral).join(', ')}] AS ARRAY(VARCHAR))`;
}

export function sqlBigintArrayExpr(values: number[]): string {
  if (values.length === 0) return 'CAST(ARRAY[] AS ARRAY(BIGINT))';
  return `CAST(ARRAY[${values.map((value) => String(Math.trunc(value))).join(', ')}] AS ARRAY(BIGINT))`;
}

export async function getAllowedInventoryValuationCompanyIds(
  requestedCompanyIds: number[],
  context: ToolExecutionContext,
): Promise<{ permittedCompanyIds: number[]; allowedCompanyIds: number[] }> {
  const permissions = ['view:quicksight_group.inventory_management_new', 'view:quicksight_group.finance-new'];
  const allPermittedCompanyIds = new Set<number>();

  for (const permission of permissions) {
    try {
      const permissionResponse = await neonPanelRequest<CompaniesWithPermissionResponse>({
        token: context.userToken,
        path: `/api/v1/permissions/${encodeURIComponent(permission)}/companies`,
      });

      const permittedCompanies = (permissionResponse.companies ?? []).filter(
        (company): company is { company_id?: number; companyId?: number; id?: number } =>
          company !== null && typeof company === 'object',
      );

      for (const company of permittedCompanies) {
        const id = company.company_id ?? company.companyId ?? company.id;
        if (typeof id === 'number' && Number.isFinite(id) && id > 0) {
          allPermittedCompanyIds.add(id);
        }
      }
    } catch {
      // Some tokens may not be eligible for one permission group; the other group can still authorize access.
    }
  }

  const permittedCompanyIds = Array.from(allPermittedCompanyIds);
  const allowedCompanyIds = requestedCompanyIds.filter((id) => permittedCompanyIds.includes(id));

  return { permittedCompanyIds, allowedCompanyIds };
}