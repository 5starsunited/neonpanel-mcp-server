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
      description: 'Retrieve companies the authenticated user can access.',
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
      description: 'Retrieve the list of reports with groups, descriptions, and URLs.',
      isConsequential: false,
      inputSchema: z.object({}),
      outputSchema: listReportsOutputSchema,
      examples: [
        {
          name: 'List Reports',
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
      name: 'neonpanel_getCompaniesWithPermission',
      description:
        'Test access: return companies the authenticated user can access for a given permission (NeonPanel: GET /api/v1/permissions/{permission}/companies).',
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
      description: 'List inventory items for a company with optional filters.',
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
        'Find listing by ASIN and return the latest listing details (auto-syncs the listing by default).',
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
      description: 'Retrieve forecasting settings for a company.',
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
      description: 'Update forecasting settings for a company.',
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
      description: 'Retrieve warehouses for a company with optional search.',
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
      description: 'Retrieve paginated inventory balances for a warehouse.',
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
      description: 'Retrieve inventory details including restock information and warehouse balances.',
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
      description: 'Retrieve landed cost (manufacturing expenses) for an inventory item.',
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
      description: 'Retrieve cost of goods sold (COGS) for an inventory item.',
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
      description: 'Retrieve document upload instructions for a supported import type.',
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
      description: 'Create documents for a company using JSON payload data.',
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
      description: 'Create documents for a company by providing a downloadable PDF link.',
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
      description: 'Check the processing status of a previously uploaded document import.',
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
      description: 'Retrieve revenue and COGS summary for the specified period.',
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
