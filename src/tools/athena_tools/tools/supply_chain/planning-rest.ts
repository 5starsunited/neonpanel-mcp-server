import { neonPanelRequest, NeonPanelApiError } from '../../../../clients/neonpanel-api';

interface CompanyEntry {
  id?: number;
  company_id?: number;
  companyId?: number;
  uuid?: string;
  name?: string;
}

export async function resolveCompanyUuid(
  opts: { company_id?: number; companyUuid?: string },
  token: string,
): Promise<string> {
  if (opts.companyUuid) return opts.companyUuid;

  if (!opts.company_id) {
    throw new NeonPanelApiError('Either company_id or companyUuid must be provided', {
      status: 400,
      code: 'missing_company_identifier',
    });
  }

  const response = await neonPanelRequest<{ data?: CompanyEntry[] }>({
    token,
    path: '/api/v1/companies',
    query: { per_page: 60 },
  });

  const companies = Array.isArray(response?.data) ? response.data : [];
  const match = companies.find((company) => {
    const id = company.company_id ?? company.companyId ?? company.id;
    return id === opts.company_id;
  });

  if (!match?.uuid) {
    throw new NeonPanelApiError(`Company with id ${opts.company_id} not found or has no UUID.`, {
      status: 404,
      code: 'company_not_found',
    });
  }

  return match.uuid;
}
