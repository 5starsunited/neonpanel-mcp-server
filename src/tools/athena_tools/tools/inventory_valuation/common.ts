import type { ToolExecutionContext } from '../../../types';
import { getPermittedCompanyIds } from '../../../../lib/permitted-companies';

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
  const allPermittedCompanyIds = await getPermittedCompanyIds(context.userToken, permissions);

  const permittedCompanyIds = Array.from(allPermittedCompanyIds);
  const allowedCompanyIds = requestedCompanyIds.filter((id) => permittedCompanyIds.includes(id));

  return { permittedCompanyIds, allowedCompanyIds };
}