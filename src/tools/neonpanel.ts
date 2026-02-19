import { z } from 'zod';
import { neonPanelRequest, NeonPanelApiError } from '../clients/neonpanel-api';
import type { ToolRegistry } from './types';

// ── Company ID → UUID resolver ─────────────────────────────────────────────────
// Agents already know company_id from Athena tools.  The NeonPanel REST API
// requires a UUID.  This helper bridges the gap so every NeonPanel tool can
// accept *either* company_id (number) or companyUuid (string).

interface CompanyEntry {
  id?: number;
  company_id?: number;
  uuid?: string;
  name?: string;
}

// Simple per-request cache keyed by bearer token (avoids repeated /api/v1/companies calls).
const _companyCache = new Map<string, { ts: number; entries: CompanyEntry[] }>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 min

async function fetchCompanyList(token: string): Promise<CompanyEntry[]> {
  const cached = _companyCache.get(token);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) return cached.entries;

  const res = await neonPanelRequest<{ data?: CompanyEntry[] }>({
    token,
    path: '/api/v1/companies',
    query: { per_page: 60 },
  });

  const entries = Array.isArray(res?.data) ? res.data : [];
  _companyCache.set(token, { ts: Date.now(), entries });
  return entries;
}

/**
 * Accepts company_id (number) **or** companyUuid (string) and always returns a UUID.
 * When company_id is provided, calls /api/v1/companies to find the matching UUID.
 */
async function resolveCompanyUuid(
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
    (c) => (c.id ?? c.company_id) === opts.company_id,
  );

  if (!match?.uuid) {
    throw new NeonPanelApiError(
      `Company with id ${opts.company_id} not found or has no UUID. Available companies: ${companies.map((c) => `${c.id ?? c.company_id}=${c.name ?? '?'}`).join(', ')}`,
      { status: 404, code: 'company_not_found' },
    );
  }

  return match.uuid;
}

/** Reusable Zod fragment: accept company_id (preferred) or companyUuid. */
const companyIdentifierSchema = {
  company_id: z.coerce.number().int().min(1).optional()
    .describe('Numeric company ID (preferred – same as in Athena-based tools). Provide this OR companyUuid.'),
  companyUuid: z.string().min(1).optional()
    .describe('Company UUID string. Use company_id instead when possible.'),
};

const listCompaniesInputSchema = z.object({
  page: z.number().int().min(1).optional(),
  perPage: z.number().int().min(10).max(60).optional(),
});

const listCompaniesOutputSchema = {
  type: 'object',
  properties: {
    data: {
      type: 'array',
      items: { type: 'object', additionalProperties: true },
    },
    pagination: {
      type: 'object',
      additionalProperties: true,
      nullable: true,
    },
  },
  required: ['data'],
};

const listReportsOutputSchema = {
  type: 'object',
  properties: {
    count: {
      type: 'integer',
      description: 'Total number of reports accessible to the user.',
    },
    data: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'integer', description: 'Report ID. Use with neonpanel_getReportDetails.' },
          title: { type: 'string', description: 'Report name.' },
          group: { type: 'string', description: 'Report group/category.' },
          description: { type: 'string' },
          link: { type: 'string', description: 'Base URL to open the report.' },
        },
        additionalProperties: true,
      },
    },
  },
  required: ['data'],
};

const reportDetailsOutputSchema = {
  type: 'object',
  properties: {
    id: { type: 'integer', description: 'Report ID.' },
    title: { type: 'string', description: 'Report name.' },
    group: { type: 'string', description: 'Report group/category.' },
    description: { type: 'string' },
    link: { type: 'string', description: 'Base URL. Append query parameters to build the full report URL.' },
    sheets: {
      type: 'array',
      description: 'Available sheets. Each sheet has its own slug and supported parameters.',
      items: {
        type: 'object',
        properties: {
          slug: { type: 'string', description: 'Sheet identifier. Use as ?sheet={slug} in the report URL.' },
          title: { type: 'string', description: 'Sheet display name.' },
          description: { type: ['string', 'null'] },
          parameters: {
            type: 'array',
            description: 'Query parameters supported by this sheet.',
            items: {
              type: 'object',
              properties: {
                slug: { type: 'string', description: 'Parameter name for the URL (e.g., start-date, brand).' },
                title: { type: 'string', description: 'Human-readable parameter label.' },
                type: {
                  type: 'string',
                  enum: ['Dropdown', 'TextField', 'TextArea', 'Slider', 'DateTimePicker', 'DateTimeRangePicker'],
                  description: 'UI control type. DateTimePicker=YYYY-MM-DD, Dropdown+multiselect=comma-separated.',
                },
                multiselect: { type: 'boolean', description: 'If true and type=Dropdown, pass comma-separated values.' },
              },
              additionalProperties: true,
            },
          },
        },
        additionalProperties: true,
      },
    },
  },
  additionalProperties: true,
};

const companiesWithPermissionInputSchema = z.object({
  permission: z.string().min(1, 'permission is required'),
  companyUuids: z
    .array(z.string().min(1))
    .nonempty()
    .optional()
    .describe('Optional: limit results to a set of company UUIDs.'),
});

const companiesWithPermissionOutputSchema = {
  type: 'object',
  additionalProperties: true,
};

const listInventoryItemsInputSchema = z.object({
  ...companyIdentifierSchema,
  page: z.number().int().min(1).optional(),
  perPage: z.number().int().min(10).max(60).optional(),
  countryCode: z.string().length(2).optional(),
  search: z.string().optional(),
  fnsku: z.string().optional(),
  asin: z.string().optional(),
  sku: z.string().optional(),
}).refine((d) => d.company_id || d.companyUuid, { message: 'Provide company_id or companyUuid' });

const listInventoryItemsOutputSchema = {
  type: 'object',
  properties: {
    data: {
      type: 'array',
      items: { type: 'object', additionalProperties: true },
    },
    pagination: {
      type: 'object',
      additionalProperties: true,
      nullable: true,
    },
  },
  required: ['data'],
};

const listingDetailsByAsinInputSchema = z.object({
  ...companyIdentifierSchema,
  asin: z.string().min(1, 'asin is required'),
  sync: z.boolean().default(true).optional(),
}).refine((d) => d.company_id || d.companyUuid, { message: 'Provide company_id or companyUuid' });

const listingDetailsByAsinOutputSchema = {
  type: 'object',
  properties: {
    listingId: { type: ['integer', 'null'] },
    listing: { type: ['object', 'null'], additionalProperties: true },
    listings: {
      type: 'array',
      items: { type: 'object', additionalProperties: true },
    },
    synced: { type: 'boolean' },
  },
  required: ['listingId', 'listing', 'listings', 'synced'],
};

const listWarehousesInputSchema = z.object({
  ...companyIdentifierSchema,
  page: z.number().int().min(1).optional(),
  perPage: z.number().int().min(10).max(60).optional(),
  search: z.string().optional(),
}).refine((d) => d.company_id || d.companyUuid, { message: 'Provide company_id or companyUuid' });

const listWarehousesOutputSchema = {
  type: 'object',
  properties: {
    data: {
      type: 'array',
      items: { type: 'object', additionalProperties: true },
    },
    pagination: {
      type: 'object',
      additionalProperties: true,
      nullable: true,
    },
  },
  required: ['data'],
};

const warehouseBalancesInputSchema = z.object({
  ...companyIdentifierSchema,
  warehouseUuid: z.string().min(1, 'warehouseUuid is required'),
  page: z.number().int().min(1).optional(),
  perPage: z.number().int().min(10).max(60).optional(),
  balancesDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'balancesDate must be YYYY-MM-DD')
    .optional(),
}).refine((d) => d.company_id || d.companyUuid, { message: 'Provide company_id or companyUuid' });

const warehouseBalancesOutputSchema = {
  type: 'object',
  properties: {
    data: {
      type: 'array',
      items: { type: 'object', additionalProperties: true },
    },
    pagination: {
      type: 'object',
      additionalProperties: true,
      nullable: true,
    },
  },
  required: ['data'],
};

const inventoryDetailsInputSchema = z.object({
  ...companyIdentifierSchema,
  inventoryId: z.number().int('inventoryId must be an integer'),
  balancesDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'balancesDate must be YYYY-MM-DD')
    .optional(),
}).refine((d) => d.company_id || d.companyUuid, { message: 'Provide company_id or companyUuid' });

const inventoryDetailsOutputSchema = {
  type: 'object',
  additionalProperties: true,
};

const inventoryLandedCostInputSchema = z.object({
  ...companyIdentifierSchema,
  inventoryId: z.number().int('inventoryId must be an integer'),
  warehouseUuid: z.string().min(1, 'warehouseUuid is required'),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'startDate must be YYYY-MM-DD'),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  page: z.number().int().min(1).optional(),
  perPage: z.number().int().min(10).max(60).optional(),
}).refine((d) => d.company_id || d.companyUuid, { message: 'Provide company_id or companyUuid' });

const inventoryLandedCostOutputSchema = {
  type: 'object',
  additionalProperties: true,
};

const inventoryCogsInputSchema = z.object({
  ...companyIdentifierSchema,
  inventoryId: z.number().int('inventoryId must be an integer'),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'startDate must be YYYY-MM-DD'),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  page: z.number().int().min(1).optional(),
  perPage: z.number().int().min(10).max(60).optional(),
}).refine((d) => d.company_id || d.companyUuid, { message: 'Provide company_id or companyUuid' });

const inventoryCogsOutputSchema = {
  type: 'object',
  additionalProperties: true,
};

const importTypeEnum = z.enum(['bill']);

const importInstructionsInputSchema = z.object({
  type: importTypeEnum,
});

const importInstructionsOutputSchema = {
  type: 'object',
  additionalProperties: true,
};

const createDocumentsInputSchema = z.object({
  ...companyIdentifierSchema,
  type: importTypeEnum,
  data: z.record(z.string(), z.any()).describe('Document payload matching import instructions'),
}).refine((d) => d.company_id || d.companyUuid, { message: 'Provide company_id or companyUuid' });

const createDocumentsOutputSchema = {
  type: 'object',
  additionalProperties: true,
};

const createDocumentsByPdfInputSchema = z.object({
  ...companyIdentifierSchema,
  type: importTypeEnum,
  file: z.object({
    name: z.string().min(1, 'file.name is required'),
    link: z.string().url('file.link must be a valid URL'),
  }),
}).refine((d) => d.company_id || d.companyUuid, { message: 'Provide company_id or companyUuid' });

const createDocumentsByPdfOutputSchema = {
  type: 'object',
  additionalProperties: true,
};

const checkImportStatusInputSchema = z.object({
  ...companyIdentifierSchema,
  type: importTypeEnum,
  requestId: z.string().min(1, 'requestId is required'),
}).refine((d) => d.company_id || d.companyUuid, { message: 'Provide company_id or companyUuid' });

const checkImportStatusOutputSchema = {
  type: 'object',
  additionalProperties: true,
};

const revenueAndCogsInputSchema = z.object({
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'startDate must be YYYY-MM-DD'),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  companyUuids: z.array(z.string()).nonempty().optional(),
  countryCodes: z.array(z.string()).nonempty().optional(),
  grouping: z.array(z.enum(['company', 'country', 'invoice'])).nonempty().optional(),
  periodicity: z.enum(['total', 'yearly', 'quarterly', 'monthly']).optional(),
});

const revenueAndCogsOutputSchema = {
  type: 'object',
  additionalProperties: true,
};

const companyForecastingSettingsSchema = z.object({
  status: z.enum(['active', 'trial', 'inactive']).optional(),
  default_seasonality: z.string().optional(),
  default_scenario_id: z.number().int().nullable().optional(),
  default_lead_time_days: z.number().int().nullable().optional(),
  default_safety_stock_days: z.number().int().nullable().optional(),
  default_fba_lead_time: z.number().int().nullable().optional(),
  default_fba_safety_stock: z.number().int().nullable().optional(),
  default_planned_po_frequency: z.number().int().optional(),
  default_fba_replenishment_frequency: z.number().int().optional(),
  default_safety_stock_multiplicator_class_a: z.number().optional(),
  default_safety_stock_multiplicator_class_b: z.number().optional(),
  default_safety_stock_multiplicator_class_c: z.number().optional(),
  default_safety_stock_multiplicator_class_d: z.number().optional(),
  default_revenue_class_a: z.number().optional(),
  default_revenue_class_b: z.number().optional(),
  default_revenue_class_c: z.number().optional(),
  default_pareto_class_a: z.number().optional(),
  default_pareto_class_b: z.number().optional(),
  default_pareto_class_c: z.number().optional(),
});

const getCompanyForecastingSettingsInputSchema = z.object({
  ...companyIdentifierSchema,
}).refine((d) => d.company_id || d.companyUuid, { message: 'Provide company_id or companyUuid' });

const updateCompanyForecastingSettingsInputSchema = companyForecastingSettingsSchema.extend({
  ...companyIdentifierSchema,
}).refine((d) => d.company_id || d.companyUuid, { message: 'Provide company_id or companyUuid' });

const companyForecastingSettingsOutputSchema = {
  type: 'object',
  properties: {
    status: {
      type: 'string',
      enum: ['active', 'trial', 'inactive'],
      default: 'trial',
    },
    default_seasonality: {
      type: 'string',
      description: '12 multipliers for each month in a year separated by semicolon',
      example: '1;1;1;1;1;1;1;1;1;0.8;1.5;2.5',
      default: '1;1;1;1;1;1;1;1;1;1;1;1',
    },
    default_scenario_id: {
      type: 'integer',
      nullable: true,
      description: 'Scenario ID',
    },
    default_lead_time_days: {
      type: 'integer',
      nullable: true,
      description: 'Default supplier lead time in days',
    },
    default_safety_stock_days: {
      type: 'integer',
      nullable: true,
      description: 'Default safety stock coverage in days',
    },
    default_fba_lead_time: {
      type: 'integer',
      nullable: true,
      description: 'Default Amazon FBA lead time in days',
    },
    default_fba_safety_stock: {
      type: 'integer',
      nullable: true,
      description: 'Default FBA safety stock coverage in days',
    },
    default_planned_po_frequency: {
      type: 'integer',
      default: 30,
    },
    default_fba_replenishment_frequency: {
      type: 'integer',
      default: 7,
    },
    default_safety_stock_multiplicator_class_a: {
      type: 'number',
      default: 1.2,
    },
    default_safety_stock_multiplicator_class_b: {
      type: 'number',
      default: 1,
    },
    default_safety_stock_multiplicator_class_c: {
      type: 'number',
      default: 0.6,
    },
    default_safety_stock_multiplicator_class_d: {
      type: 'number',
      default: 0.5,
    },
    default_revenue_class_a: {
      type: 'number',
      default: 10,
    },
    default_revenue_class_b: {
      type: 'number',
      default: 3,
    },
    default_revenue_class_c: {
      type: 'number',
      default: 0.5,
    },
    default_pareto_class_a: {
      type: 'number',
      default: 80,
    },
    default_pareto_class_b: {
      type: 'number',
      default: 15,
    },
    default_pareto_class_c: {
      type: 'number',
      default: 5,
    },
  },
};

const updateCompanyForecastingSettingsOutputSchema = {
  type: 'object',
  properties: {
    success: {
      type: 'boolean',
      description: 'Indication that parameters have been saved successfully',
    },
  },
  required: ['success'],
};

export function registerNeonPanelTools(registry: ToolRegistry) {
  registry
    .register({
      name: 'neonpanel_listCompanies',
      description: 'Retrieve companies the authenticated user can access (NeonPanel: GET /api/v1/companies).\n\nReturns paginated list of companies with: id (numeric), uuid (string for REST API calls), name, short_name (used as company identifier in report URLs), currency (base currency), timezone.\n\nUse this tool to:\n- Resolve company_id → uuid for other NeonPanel REST API tools\n- Get short_name values for building report URLs (e.g., ?company=5SU,KEM)\n- List all companies the user has access to\n\nPagination: page (default 1), per_page (10–60, default 30).\n\nNote: Most Athena-based tools accept company_id (numeric). NeonPanel REST tools accept either company_id or companyUuid — the server resolves automatically.',
      isConsequential: false,
      inputSchema: listCompaniesInputSchema,
      outputSchema: listCompaniesOutputSchema,
      examples: [
        {
          name: 'First Page',
          description: 'Get the first page of companies with default pagination.',
          arguments: {},
        },
      ],
      execute: async (args, context) => {
        const parsed = listCompaniesInputSchema.parse(args);
        return neonPanelRequest({
          token: context.userToken,
          path: '/api/v1/companies',
          query: {
            page: parsed.page,
            per_page: parsed.perPage,
          },
        });
      },
    })
    .register({
      name: 'neonpanel_listReports',
      description: 'Retrieve the list of available reports with groups, descriptions, and direct URLs (NeonPanel: GET /api/v1/reports).\n\nEach report has: id (use with neonpanel_getReportDetails for sheets and parameters), title, group (report category), description, link (base URL to open the report).\n\nWorkflow:\n1. Call this tool to browse available reports\n2. Call neonpanel_getReportDetails with reportId to get sheets and URL parameters\n3. Build the report URL: {link}?company={short_name}&sheet={slug}&{param}={value}\n\nThe company parameter uses short_name values from neonpanel_listCompanies (e.g., ?company=5SU,KEM).\n\nNo input parameters required — returns all reports accessible to the authenticated user.',
      isConsequential: false,
      inputSchema: z.object({}),
      outputSchema: listReportsOutputSchema,
      examples: [
        {
          name: 'List Reports',
          description: 'Get all available reports with their URLs and descriptions.',
          arguments: {},
        },
      ],
      execute: async (_args, context) => {
        return neonPanelRequest({
          token: context.userToken,
          path: '/api/v1/reports',
        });
      },
    })
    .register({
      name: 'neonpanel_getReportDetails',
      description: 'Retrieve full report details including sheets and URL query parameters (NeonPanel: GET /api/v1/reports/{reportId}).\n\nReturns: id, title, group, description, link (base URL), and sheets[] — each sheet has slug, title, description, and parameters[].\n\nURL building pattern:\n  {link}?sheet={sheets[].slug}&{parameter.slug}={value}&...\n\nURL rules:\n- sheet is optional — if omitted, the first sheet opens by default\n- company parameter: comma-separated short_name values from neonpanel_listCompanies (e.g., ?company=5SU,KEM)\n- Parameter order does not matter\n- Parameter types determine formatting:\n  • DateTimePicker → YYYY-MM-DD (e.g., 2026-02-01)\n  • DateTimeRangePicker → usually two params like start-date / end-date\n  • Dropdown with multiselect=true → comma-separated (e.g., brand=Nike,Adidas)\n\nExample URL:\nhttps://my.neonpanel.com/app/reports/basic_suite_new/v3-inventory-transactions-bas-user?company=5SU,KEM&sheet=transaction-list&start-date=2026-02-01&end-date=2026-02-13\n\nWorkflow: Call neonpanel_listReports first to get reportId values, then call this tool for the full sheet/parameter details.',
      isConsequential: false,
      inputSchema: z.object({
        reportId: z.number().int().min(1).describe('Report ID obtained from neonpanel_listReports.'),
      }),
      outputSchema: reportDetailsOutputSchema,
      examples: [
        {
          name: 'Get Report Details',
          description: 'Retrieve sheets and parameters for a specific report.',
          arguments: { reportId: 42 },
        },
      ],
      execute: async (args, context) => {
        const parsed = z.object({ reportId: z.number().int().min(1) }).parse(args);
        return neonPanelRequest({
          token: context.userToken,
          path: `/api/v1/reports/${encodeURIComponent(String(parsed.reportId))}`,
        });
      },
    })
    .register({
      name: 'neonpanel_getCompaniesWithPermission',
      description:
        'Check which companies the user has a specific permission for (NeonPanel: GET /api/v1/permissions/{permission}/companies).\n\nUse this tool before calling Athena-based tools that require specific permissions. For example, before calling financials_analyze_general_ledger, check which companies the user can access with permission "view:quicksight_group.bookkeeping".\n\nReturns an array of Company objects (id, uuid, name, short_name, currency, timezone) where the user holds the given permission.\n\nOptionally filter to specific companies by passing companyUuids.',
      isConsequential: false,
      inputSchema: companiesWithPermissionInputSchema,
      outputSchema: companiesWithPermissionOutputSchema,
      examples: [
        {
          name: 'Business planning permission (all permitted companies)',
          arguments: {
            permission: 'view:quicksight_group.business_planning_new',
          },
        },
        {
          name: 'Check permission for one company',
          arguments: {
            permission: 'view:quicksight_group.business_planning_new',
            companyUuids: ['company-uuid'],
          },
        },
      ],
      execute: async (args, context) => {
        const parsed = companiesWithPermissionInputSchema.parse(args);
        return neonPanelRequest({
          token: context.userToken,
          path: `/api/v1/permissions/${encodeURIComponent(parsed.permission)}/companies`,
          query: {
            company_uuids: parsed.companyUuids,
          },
        });
      },
    })
    .register({
      name: 'neonpanel_listInventoryItems',
      description: 'List inventory items for a company with optional filters (NeonPanel: GET /api/v1/companies/{uuid}/inventory-items).\n\nReturns paginated list of inventory items with: id, name, fnsku, asin, sku, image, country_code, weight/length/height/depth (imperial units: pounds/inches).\n\nSearch: The search field matches by SKU, ASIN, FnSKU, ID, or Name. Alternatively use the specific fnsku, asin, or sku filters for exact matching. Filter by country_code (2-letter ISO, e.g., "US", "DE") to narrow by marketplace.\n\nPagination: page (default 1), per_page (10–60, default 30).\n\nRelated tools: Use neonpanel_getInventoryDetails for restock data and warehouse balances, neonpanel_getInventoryCogs for COGS breakdown, neonpanel_getInventoryLandedCost for manufacturing costs.',
      isConsequential: false,
      inputSchema: listInventoryItemsInputSchema,
      outputSchema: listInventoryItemsOutputSchema,
      examples: [
        {
          name: 'Search by SKU',
          arguments: {
            company_id: 42,
            search: 'SKU12345',
            perPage: 20,
          },
        },
      ],
      execute: async (args, context) => {
        const parsed = listInventoryItemsInputSchema.parse(args);
        const companyUuid = await resolveCompanyUuid(parsed, context.userToken);
        return neonPanelRequest({
          token: context.userToken,
          path: `/api/v1/companies/${encodeURIComponent(companyUuid)}/inventory-items`,
          query: {
            page: parsed.page,
            per_page: parsed.perPage,
            country_code: parsed.countryCode,
            search: parsed.search,
            fnsku: parsed.fnsku,
            asin: parsed.asin,
            sku: parsed.sku,
          },
        });
      },
    })
    .register({
      name: 'neonpanel_getListingDetailsByAsin',
      description:
        'Find listing by ASIN and return the latest listing details, optionally syncing from Amazon (NeonPanel: GET+POST /api/v1/companies/{uuid}/listings).\n\nReturns: listingId, listing object (id, asin, parent_asin, title, brand, color, image, bullet_points grouped by language), listings array (all matches), synced (boolean).\n\nBullet points are keyed by BCP 47 language tag (e.g., en_US, de_DE) with ordered arrays of strings.\n\nWhen sync=true (default), triggers a live sync from Amazon to get the freshest data. Set sync=false to skip the sync and return cached data only.',
      isConsequential: false,
      inputSchema: listingDetailsByAsinInputSchema,
      outputSchema: listingDetailsByAsinOutputSchema,
      examples: [
        {
          name: 'Fetch listing details by ASIN',
          arguments: {
            company_id: 42,
            asin: 'B000123456',
          },
        },
      ],
      execute: async (args, context) => {
        const parsed = listingDetailsByAsinInputSchema.parse(args);
        const companyUuid = await resolveCompanyUuid(parsed, context.userToken);
        const { asin, sync } = parsed;

        const listPath = `/api/v1/companies/${encodeURIComponent(companyUuid)}/listings`;
        let listingsResponse: any;

        try {
          listingsResponse = await neonPanelRequest({
            token: context.userToken,
            path: listPath,
            method: 'POST',
            body: { asin },
          });
        } catch (error) {
          if (error instanceof NeonPanelApiError && [400, 404, 405].includes(error.status ?? 0)) {
            try {
              listingsResponse = await neonPanelRequest({
                token: context.userToken,
                path: listPath,
                query: { asin },
              });
            } catch (fallbackError) {
              if (fallbackError instanceof NeonPanelApiError && [400, 404].includes(fallbackError.status ?? 0)) {
                listingsResponse = await neonPanelRequest({
                  token: context.userToken,
                  path: listPath,
                  query: { search: asin },
                });
              } else {
                throw fallbackError;
              }
            }
          } else {
            throw error;
          }
        }

        const listings = Array.isArray((listingsResponse as any)?.data)
          ? (listingsResponse as any).data
          : [];
        const listing = listings[0] ?? null;
        const listingId = listing && typeof listing.id === 'number' ? listing.id : null;

        if (!listingId) {
          return {
            listingId: null,
            listing: null,
            listings,
            synced: false,
          };
        }

        if (sync) {
          try {
            const syncedListing = await neonPanelRequest({
              token: context.userToken,
              path: `/api/v1/companies/${encodeURIComponent(companyUuid)}/listings/${encodeURIComponent(
                String(listingId),
              )}/sync`,
              method: 'POST',
            });

            return {
              listingId,
              listing: syncedListing ?? listing,
              listings,
              synced: true,
            };
          } catch (syncError) {
            if (syncError instanceof NeonPanelApiError) {
              return {
                listingId,
                listing,
                listings,
                synced: false,
                sync_error: syncError.details ?? syncError.message,
              } as any;
            }
            throw syncError;
          }
        }

        return {
          listingId,
          listing,
          listings,
          synced: false,
        };
      },
    })
    .register({
      name: 'neonpanel_getCompanyForecastingSettings',
      description: 'Retrieve forecasting settings for a company (NeonPanel: GET /api/v1/companies/{uuid}/settings/forecasts).\n\nReturns: status (active/trial/inactive), default_seasonality (12 monthly multipliers separated by semicolons, e.g., "1;1;1;1;1;1;1;1;1;0.8;1.5;2.5"), default_scenario_id, and default planning parameters: lead_time_days, safety_stock_days, fba_lead_time, fba_safety_stock, planned_po_frequency, fba_replenishment_frequency, and ABC classification thresholds (safety_stock_multiplicator / revenue_class / pareto_class for A/B/C/D).\n\nRelated: Use neonpanel_updateCompanyForecastingSettings to modify these values. Use forecasting_generate_sales_forecast and forecasting_write_sales_forecast for actual forecast generation.',
      isConsequential: false,
      inputSchema: getCompanyForecastingSettingsInputSchema,
      outputSchema: companyForecastingSettingsOutputSchema,
      examples: [
        {
          name: 'Get Forecasting Settings',
          arguments: {
            company_id: 42,
          },
        },
      ],
      execute: async (args, context) => {
        const parsed = getCompanyForecastingSettingsInputSchema.parse(args);
        const companyUuid = await resolveCompanyUuid(parsed, context.userToken);
        return neonPanelRequest({
          token: context.userToken,
          path: `/api/v1/companies/${encodeURIComponent(companyUuid)}/settings/forecasts`,
        });
      },
    })
    .register({
      name: 'neonpanel_updateCompanyForecastingSettings',
      description: 'Update forecasting settings for a company (NeonPanel: PUT /api/v1/companies/{uuid}/settings/forecasts).\n\nPass only the fields you want to change — all are optional. Returns { success: true } on success.\n\nKey fields: status (active/trial/inactive), default_seasonality (12 semicolon-separated monthly multipliers), default_lead_time_days, default_safety_stock_days, default_fba_lead_time, default_fba_safety_stock, default_planned_po_frequency, default_fba_replenishment_frequency, and ABC classification parameters.\n\nUse neonpanel_getCompanyForecastingSettings first to see current values before updating.',
      isConsequential: true,
      inputSchema: updateCompanyForecastingSettingsInputSchema,
      outputSchema: updateCompanyForecastingSettingsOutputSchema,
      examples: [
        {
          name: 'Update Default Lead Time',
          arguments: {
            company_id: 42,
            default_lead_time_days: 14,
          },
        },
      ],
      execute: async (args, context) => {
        const parsed = updateCompanyForecastingSettingsInputSchema.parse(args);
        const companyUuid = await resolveCompanyUuid(parsed, context.userToken);
        const { company_id: _cid, companyUuid: _cuuid, ...settings } = parsed;
        return neonPanelRequest({
          token: context.userToken,
          path: `/api/v1/companies/${encodeURIComponent(companyUuid)}/settings/forecasts`,
          method: 'PUT',
          body: settings,
        });
      },
    })
    .register({
      name: 'neonpanel_listWarehouses',
      description: 'Retrieve warehouses for a company (NeonPanel: GET /api/v1/companies/{uuid}/warehouses).\n\nReturns paginated list of warehouses with: uuid, name, type (e.g., "Asset"), country_code (e.g., "US").\n\nUse the search parameter to filter by warehouse name. Pagination: page (default 1), per_page (10–60, default 30).\n\nRelated: Use warehouse uuid with neonpanel_getWarehouseBalances to see inventory balances per warehouse, or with neonpanel_getInventoryLandedCost as the warehouse_uuid filter.',
      isConsequential: false,
      inputSchema: listWarehousesInputSchema,
      outputSchema: listWarehousesOutputSchema,
      examples: [
        {
          name: 'List Warehouses',
          arguments: {
            company_id: 42,
          },
        },
      ],
      execute: async (args, context) => {
        const parsed = listWarehousesInputSchema.parse(args);
        const companyUuid = await resolveCompanyUuid(parsed, context.userToken);
        return neonPanelRequest({
          token: context.userToken,
          path: `/api/v1/companies/${encodeURIComponent(companyUuid)}/warehouses`,
          query: {
            page: parsed.page,
            per_page: parsed.perPage,
            search: parsed.search,
          },
        });
      },
    })
    .register({
      name: 'neonpanel_getWarehouseBalances',
      description: 'Retrieve inventory balances for a warehouse (NeonPanel: GET /api/v1/companies/{uuid}/warehouses/{uuid}/balances).\n\nReturns paginated list of items with: inventory (InventoryItem object), balance (quantity in stock).\n\nUse balancesDate (YYYY-MM-DD) to retrieve historical balances at a past date. Defaults to current date if omitted.\n\nPagination: page (default 1), per_page (10–60, default 30).\n\nRelated: Get the warehouseUuid from neonpanel_listWarehouses first.',
      isConsequential: false,
      inputSchema: warehouseBalancesInputSchema,
      outputSchema: warehouseBalancesOutputSchema,
      examples: [
        {
          name: 'Warehouse Balances',
          arguments: {
            company_id: 42,
            warehouseUuid: 'warehouse-uuid',
          },
        },
      ],
      execute: async (args, context) => {
        const parsed = warehouseBalancesInputSchema.parse(args);
        const companyUuid = await resolveCompanyUuid(parsed, context.userToken);
        return neonPanelRequest({
          token: context.userToken,
          path: `/api/v1/companies/${encodeURIComponent(companyUuid)}/warehouses/${encodeURIComponent(parsed.warehouseUuid)}/balances`,
          query: {
            page: parsed.page,
            per_page: parsed.perPage,
            balances_date: parsed.balancesDate,
          },
        });
      },
    })
    .register({
      name: 'neonpanel_getInventoryDetails',
      description: 'Retrieve full inventory item details with restock data and warehouse balances (NeonPanel: GET /api/v1/companies/{uuid}/inventory-items/{id}/balances).\n\nReturns:\n- inventory: item details (id, name, fnsku, asin, sku, image, country_code, dimensions)\n- restock_data: daily_sales_target, unit_vendor_price, unit_landed_cost, estimated_daily_sales, lead_time_days, safety_stock_days, fba_lead_time_days, fba_safety_stock_days, target_fba_fee, target_price, target_referral_percentage\n- balances_data: balances_date + balances_list (warehouse + balance per warehouse)\n\nUse balancesDate (YYYY-MM-DD) for historical balance snapshots. Defaults to today.\n\nRelated: Use neonpanel_getInventoryCogs for COGS detail, neonpanel_getInventoryLandedCost for manufacturing costs, supply_chain_inspect_inventory_sku_snapshot for Athena-based snapshot data.',
      isConsequential: false,
      inputSchema: inventoryDetailsInputSchema,
      outputSchema: inventoryDetailsOutputSchema,
      examples: [
        {
          name: 'Inventory Details',
          arguments: {
            company_id: 42,
            inventoryId: 123,
          },
        },
      ],
      execute: async (args, context) => {
        const parsed = inventoryDetailsInputSchema.parse(args);
        const companyUuid = await resolveCompanyUuid(parsed, context.userToken);
        return neonPanelRequest({
          token: context.userToken,
          path: `/api/v1/companies/${encodeURIComponent(companyUuid)}/inventory-items/${encodeURIComponent(String(parsed.inventoryId))}/details`,
          query: {
            balances_date: parsed.balancesDate,
          },
        });
      },
    })
    .register({
      name: 'neonpanel_getInventoryLandedCost',
      description: 'Retrieve landed cost (manufacturing expenses) for an inventory item (NeonPanel: GET /api/v1/companies/{uuid}/inventory-items/{id}/landed-cost).\n\nReturns: company, inventory, warehouse, currency, total amount, total quantity, and paginated data[] of cost batches. Each batch has: batch document, currency, amount, quantity, and details[] (type: "Purchase Price" etc., document, amount, quantity).\n\nRequired: warehouseUuid (from neonpanel_listWarehouses), startDate (YYYY-MM-DD). endDate defaults to today.\n\nPagination: page (default 1), per_page (10–60, default 30).\n\nRelated: For COGS (cost of goods sold = cost allocated to sales), use neonpanel_getInventoryCogs instead. Landed cost covers manufacturing/purchase expenses regardless of sales.',
      isConsequential: false,
      inputSchema: inventoryLandedCostInputSchema,
      outputSchema: inventoryLandedCostOutputSchema,
      examples: [
        {
          name: 'Landed Cost for Warehouse',
          arguments: {
            company_id: 42,
            inventoryId: 123,
            warehouseUuid: 'warehouse-uuid',
            startDate: '2024-01-01',
            endDate: '2024-02-01',
          },
        },
      ],
      execute: async (args, context) => {
        const parsed = inventoryLandedCostInputSchema.parse(args);
        const companyUuid = await resolveCompanyUuid(parsed, context.userToken);
        return neonPanelRequest({
          token: context.userToken,
          path: `/api/v1/companies/${encodeURIComponent(companyUuid)}/inventory-items/${encodeURIComponent(String(parsed.inventoryId))}/landed-cost`,
          query: {
            warehouse_uuid: parsed.warehouseUuid,
            start_date: parsed.startDate,
            end_date: parsed.endDate,
            page: parsed.page,
            per_page: parsed.perPage,
          },
        });
      },
    })
    .register({
      name: 'neonpanel_getInventoryCogs',
      description: 'Retrieve cost of goods sold (COGS) for an inventory item (NeonPanel: GET /api/v1/companies/{uuid}/inventory-items/{id}/cogs).\n\nReturns: company, inventory, currency, amount (total COGS), lost_amount, total_amount, quantity, and paginated details[] of sales documents. Each sale has: document (type/link/status/date/ref_number), currency, amount, quantity, and details[] of cost batches written off (type: "Purchase Price" etc., batch document, amount, quantity).\n\nRequired: startDate (YYYY-MM-DD). endDate defaults to today.\n\nPagination: page (default 1), per_page (10–60, default 30).\n\nCOGS = cost of inventory consumed by sales. For manufacturing/purchase costs independent of sales, use neonpanel_getInventoryLandedCost. For FIFO COGS analysis via Athena, use cogs_analyze_fifo_cogs.',
      isConsequential: false,
      inputSchema: inventoryCogsInputSchema,
      outputSchema: inventoryCogsOutputSchema,
      examples: [
        {
          name: 'Inventory COGS',
          arguments: {
            company_id: 42,
            inventoryId: 123,
            startDate: '2024-01-01',
          },
        },
      ],
      execute: async (args, context) => {
        const parsed = inventoryCogsInputSchema.parse(args);
        const companyUuid = await resolveCompanyUuid(parsed, context.userToken);
        return neonPanelRequest({
          token: context.userToken,
          path: `/api/v1/companies/${encodeURIComponent(companyUuid)}/inventory-items/${encodeURIComponent(String(parsed.inventoryId))}/cogs`,
          query: {
            start_date: parsed.startDate,
            end_date: parsed.endDate,
            page: parsed.page,
            per_page: parsed.perPage,
          },
        });
      },
    })
    .register({
      name: 'neonpanel_getImportInstructions',
      description: 'Retrieve document upload instructions for a supported import type (NeonPanel: GET /api/v1/import/{type}/instructions).\n\nReturns: attributes (object with parameter names as keys and descriptions as values) and general (text with specifications and tips).\n\nCurrently only type="bill" is supported. Use the returned attribute names/descriptions to build the JSON payload for neonpanel_createDocuments.\n\nWorkflow: 1) Call this tool → 2) Build document data object → 3) Call neonpanel_createDocuments or neonpanel_createDocumentsByPdf.',
      isConsequential: false,
      inputSchema: importInstructionsInputSchema,
      outputSchema: importInstructionsOutputSchema,
      examples: [
        {
          name: 'Import Instructions',
          arguments: {
            type: 'bill',
          },
        },
      ],
      execute: async (args, context) => {
        const parsed = importInstructionsInputSchema.parse(args);
        return neonPanelRequest({
          token: context.userToken,
          path: `/api/v1/import/${encodeURIComponent(parsed.type)}/instructions`,
        });
      },
    })
    .register({
      name: 'neonpanel_createDocuments',
      description: 'Create documents for a company from a structured JSON payload (NeonPanel: POST /api/v1/companies/{uuid}/create/{type}).\n\nReturns: request_id (UUID), status ("queued"/"processing"/"done"/"error"), and documents[] array of created documents.\n\nThe data object structure must match the schema from neonpanel_getImportInstructions. Currently only type="bill" is supported.\n\nWorkflow: 1) neonpanel_getImportInstructions → 2) Build data payload → 3) This tool → 4) If status is not "done", poll with neonpanel_checkImportStatus using the returned request_id.',
      isConsequential: true,
      inputSchema: createDocumentsInputSchema,
      outputSchema: createDocumentsOutputSchema,
      examples: [
        {
          name: 'Create Bill Document',
          arguments: {
            company_id: 42,
            type: 'bill',
            data: { example: 'payload' },
          },
        },
      ],
      execute: async (args, context) => {
        const parsed = createDocumentsInputSchema.parse(args);
        const companyUuid = await resolveCompanyUuid(parsed, context.userToken);
        return neonPanelRequest({
          token: context.userToken,
          path: `/api/v1/companies/${encodeURIComponent(companyUuid)}/create/${encodeURIComponent(parsed.type)}`,
          method: 'POST',
          body: {
            data: parsed.data,
          },
        });
      },
    })
    .register({
      name: 'neonpanel_createDocumentsByPdf',
      description: 'Create documents for a company by providing a downloadable PDF link (NeonPanel: POST /api/v1/companies/{uuid}/import/{type}/pdf).\n\nProvide a file object with name (original filename) and link (short-lived URL for the server to download the PDF).\n\nReturns: request_id (UUID) and status ("queued"/"processing"). This is asynchronous — after receiving the response, WAIT 15 seconds then poll neonpanel_checkImportStatus with the request_id. Continue polling every 5 seconds until status is "done" or "error".\n\nCurrently only type="bill" is supported.',
      isConsequential: true,
      inputSchema: createDocumentsByPdfInputSchema,
      outputSchema: createDocumentsByPdfOutputSchema,
      examples: [
        {
          name: 'Create Bill From PDF Link',
          arguments: {
            company_id: 42,
            type: 'bill',
            file: {
              name: 'invoice.pdf',
              link: 'https://example.com/invoice.pdf',
            },
          },
        },
      ],
      execute: async (args, context) => {
        const parsed = createDocumentsByPdfInputSchema.parse(args);
        const companyUuid = await resolveCompanyUuid(parsed, context.userToken);
        return neonPanelRequest({
          token: context.userToken,
          path: `/api/v1/companies/${encodeURIComponent(companyUuid)}/import/${encodeURIComponent(parsed.type)}/pdf`,
          method: 'POST',
          body: {
            file: parsed.file,
          },
        });
      },
    })
    .register({
      name: 'neonpanel_checkImportStatus',
      description: 'Poll the processing status of a previously uploaded document import (NeonPanel: GET /api/v1/companies/{uuid}/import/{type}/status/{requestId}).\n\nReturns: request_id, status ("queued"/"processing"/"done"/"error"), and documents[] when done.\n\nPolling behaviour: If processing is not finished, the server returns HTTP 202 with a Retry-After header (default 5 seconds). WAIT the indicated seconds then poll again. When status is "done", the documents array contains the created Document objects (type, link, status, ref_number, date).\n\nWorkflow: neonpanel_createDocuments or neonpanel_createDocumentsByPdf → wait 15s → this tool → repeat every 5s until done/error.',
      isConsequential: false,
      inputSchema: checkImportStatusInputSchema,
      outputSchema: checkImportStatusOutputSchema,
      examples: [
        {
          name: 'Check Import Status',
          arguments: {
            company_id: 42,
            type: 'bill',
            requestId: '00000000-0000-0000-0000-000000000000',
          },
        },
      ],
      execute: async (args, context) => {
        const parsed = checkImportStatusInputSchema.parse(args);
        const companyUuid = await resolveCompanyUuid(parsed, context.userToken);
        return neonPanelRequest({
          token: context.userToken,
          path: `/api/v1/companies/${encodeURIComponent(companyUuid)}/import/${encodeURIComponent(parsed.type)}/status/${encodeURIComponent(parsed.requestId)}`,
        });
      },
    })

    .register({
      name: 'neonpanel_getRevenueAndCogs',
      description: 'Retrieve Revenue & COGS summary broken down by period and grouping (NeonPanel: GET /api/v1/revenue-and-cogs).\n\nReturns filters (echo of applied filters) and data[] with: start_date, end_date, revenue_amount, cogs_amount, currency, and optional company/country_code/invoice depending on grouping.\n\nGrouping options: company (revenue/COGS per company), country (per marketplace country), invoice (per invoice document). Multiple groupings can be combined.\n\nPeriodicity: total (default), yearly, quarterly, monthly.\n\nstartDate is required (YYYY-MM-DD). endDate defaults to today.\n\nFilter by companyUuids and/or countryCodes. If no companyUuids are given, returns data for all accessible companies.\n\nFor deeper COGS analysis at the inventory level, use neonpanel_getInventoryCogs or cogs_analyze_fifo_cogs.',
      isConsequential: false,
      inputSchema: revenueAndCogsInputSchema,
      outputSchema: revenueAndCogsOutputSchema,
      examples: [
        {
          name: 'Quarterly by Company',
          arguments: {
            startDate: '2024-01-01',
            endDate: '2024-06-30',
            grouping: ['company'],
            periodicity: 'quarterly',
          },
        },
      ],
      execute: async (args, context) => {
        const parsed = revenueAndCogsInputSchema.parse(args);
        return neonPanelRequest({
          token: context.userToken,
          path: '/api/v1/revenue-and-cogs',
          query: {
            start_date: parsed.startDate,
            end_date: parsed.endDate,
            periodicity: parsed.periodicity,
            company_uuids: parsed.companyUuids,
            country_codes: parsed.countryCodes,
            grouping: parsed.grouping,
          },
        });
      },
    })
    ;
}
