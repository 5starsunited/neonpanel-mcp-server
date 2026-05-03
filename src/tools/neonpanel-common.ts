import { z } from 'zod';
import { neonPanelRequest, NeonPanelApiError } from '../clients/neonpanel-api';

interface CompanyEntry {
  id?: number;
  company_id?: number;
  uuid?: string;
  name?: string;
}

const companyCache = new Map<string, { ts: number; entries: CompanyEntry[] }>();
const CACHE_TTL_MS = 5 * 60 * 1000;

async function fetchCompanyList(token: string): Promise<CompanyEntry[]> {
  const cached = companyCache.get(token);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) return cached.entries;

  const res = await neonPanelRequest<{ data?: CompanyEntry[] }>({
    token,
    path: '/api/v1/companies',
    query: { per_page: 60 },
  });

  const entries = Array.isArray(res?.data) ? res.data : [];
  companyCache.set(token, { ts: Date.now(), entries });
  return entries;
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

  const companies = await fetchCompanyList(token);
  const match = companies.find(
    (company) => (company.id ?? company.company_id) === opts.company_id,
  );

  if (!match?.uuid) {
    throw new NeonPanelApiError(
      `Company with id ${opts.company_id} not found or has no UUID. Available companies: ${companies.map((company) => `${company.id ?? company.company_id}=${company.name ?? '?'}`).join(', ')}`,
      { status: 404, code: 'company_not_found' },
    );
  }

  return match.uuid;
}

export const companyIdentifierSchema = {
  company_id: z.coerce.number().int().min(1).optional()
    .describe('Numeric company ID (preferred; same as in Athena-based tools). Provide this OR companyUuid.'),
  companyUuid: z.string().min(1).optional()
    .describe('Company UUID string. Use company_id instead when possible.'),
};

export function hasCompanyIdentifier(data: { company_id?: number; companyUuid?: string }): boolean {
  return Boolean(data.company_id || data.companyUuid);
}