import { neonPanelRequest } from '../../../../clients/neonpanel-api';
import type { ToolExecutionContext } from '../../../types';

type CompaniesWithPermissionResponse = {
  companies?: Array<{
    company_id?: number;
    companyId?: number;
    id?: number;
  }>;
};

const inventoryPermissions = [
  'view:quicksight_group.inventory_management_new',
  'view:quicksight_group.finance-new',
];

export async function canReadSupplyChainCompany(
  context: ToolExecutionContext,
  companyId: number,
): Promise<boolean> {
  for (const permission of inventoryPermissions) {
    try {
      const response = await neonPanelRequest<CompaniesWithPermissionResponse>({
        token: context.userToken,
        path: `/api/v1/permissions/${encodeURIComponent(permission)}/companies`,
      });

      if (
        (response.companies ?? []).some(
          (company) => (company.company_id ?? company.companyId ?? company.id) === companyId,
        )
      ) {
        return true;
      }
    } catch {
      // Either inventory permission is sufficient.
    }
  }

  return false;
}

function sqlString(value: string): string {
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

export function sqlStringArray(values: string[]): string {
  return values.length === 0 ? "CAST([], 'Array(String)')" : `[${values.map(sqlString).join(',')}]`;
}

export function sqlUInt64Array(values: number[]): string {
  return values.length === 0
    ? "CAST([], 'Array(UInt64)')"
    : `[${values.map((value) => String(Math.trunc(value))).join(',')}]`;
}