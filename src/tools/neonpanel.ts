import { z } from 'zod';
import { runAthenaQuery } from '../clients/athena';
import { neonPanelRequest } from '../clients/neonpanel-api';
import { config } from '../config';
import { AppError } from '../lib/errors';
import { PeriodInputSchema, resolvePeriod } from '../lib/period/resolve-period';
import type { ToolRegistry } from './types';

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
  companyUuid: z.string().min(1, 'companyUuid is required'),
  page: z.number().int().min(1).optional(),
  perPage: z.number().int().min(10).max(60).optional(),
  countryCode: z.string().length(2).optional(),
  search: z.string().optional(),
  fnsku: z.string().optional(),
  asin: z.string().optional(),
  sku: z.string().optional(),
});

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

const listWarehousesInputSchema = z.object({
  companyUuid: z.string().min(1, 'companyUuid is required'),
  page: z.number().int().min(1).optional(),
  perPage: z.number().int().min(10).max(60).optional(),
  search: z.string().optional(),
});

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
  companyUuid: z.string().min(1, 'companyUuid is required'),
  warehouseUuid: z.string().min(1, 'warehouseUuid is required'),
  page: z.number().int().min(1).optional(),
  perPage: z.number().int().min(10).max(60).optional(),
  balancesDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'balancesDate must be YYYY-MM-DD')
    .optional(),
});

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
  companyUuid: z.string().min(1, 'companyUuid is required'),
  inventoryId: z.number().int('inventoryId must be an integer'),
  balancesDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'balancesDate must be YYYY-MM-DD')
    .optional(),
});

const inventoryDetailsOutputSchema = {
  type: 'object',
  additionalProperties: true,
};

const inventoryLandedCostInputSchema = z.object({
  companyUuid: z.string().min(1, 'companyUuid is required'),
  inventoryId: z.number().int('inventoryId must be an integer'),
  warehouseUuid: z.string().min(1, 'warehouseUuid is required'),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'startDate must be YYYY-MM-DD'),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  page: z.number().int().min(1).optional(),
  perPage: z.number().int().min(10).max(60).optional(),
});

const inventoryLandedCostOutputSchema = {
  type: 'object',
  additionalProperties: true,
};

const inventoryCogsInputSchema = z.object({
  companyUuid: z.string().min(1, 'companyUuid is required'),
  inventoryId: z.number().int('inventoryId must be an integer'),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'startDate must be YYYY-MM-DD'),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  page: z.number().int().min(1).optional(),
  perPage: z.number().int().min(10).max(60).optional(),
});

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
  companyUuid: z.string().min(1, 'companyUuid is required'),
  type: importTypeEnum,
  data: z.record(z.string(), z.any()).describe('Document payload matching import instructions'),
});

const createDocumentsOutputSchema = {
  type: 'object',
  additionalProperties: true,
};

const createDocumentsByPdfInputSchema = z.object({
  companyUuid: z.string().min(1, 'companyUuid is required'),
  type: importTypeEnum,
  file: z.object({
    name: z.string().min(1, 'file.name is required'),
    link: z.string().url('file.link must be a valid URL'),
  }),
});

const createDocumentsByPdfOutputSchema = {
  type: 'object',
  additionalProperties: true,
};

const checkImportStatusInputSchema = z.object({
  companyUuid: z.string().min(1, 'companyUuid is required'),
  type: importTypeEnum,
  requestId: z.string().min(1, 'requestId is required'),
});

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

// Note: keep this schema serializable via zod-to-json-schema for tools/list.
// Cross-field validation (mutual exclusivity, required pairs) is enforced at runtime by resolvePeriod().
const periodRangeInputSchema = z.object({
  period: PeriodInputSchema.optional().describe('Structured period selection (recommended).'),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'startDate must be YYYY-MM-DD').optional(),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'endDate must be YYYY-MM-DD').optional(),
});

const fbsReplenishmentInputSchema = z
  .object({
    companyUuid: z
      .string()
      .min(1, 'companyUuid must be a non-empty string')
      .optional()
      .describe('Optional: run the report for a single company (must be permitted).'),
    inventoryId: z
      .number()
      .int('inventoryId must be an integer')
      .min(1, 'inventoryId must be a positive integer')
      .optional()
      .describe('Optional: filter by a single NeonPanel inventory item ID.'),
    inventoryIds: z
      .array(z.number().int().min(1))
      .nonempty()
      .optional()
      .describe('Optional: filter by a list of NeonPanel inventory item IDs.'),
    sku: z
      .string()
      .min(1, 'sku must be a non-empty string')
      .optional()
      .describe('Optional: filter by a single SKU.'),
    skus: z
      .array(z.string().min(1))
      .nonempty()
      .optional()
      .describe('Optional: filter by a list of SKUs.'),
    topN: z
      .number()
      .int('topN must be an integer')
      .min(1)
      .max(100)
      .optional()
      .describe('Optional: return top N items sorted by urgency. Default 10, max 100.'),
    marketplaces: z
      .array(z.enum(['ALL', 'US', 'UK']))
      .nonempty()
      .optional()
      .describe('Optional: filter marketplaces. Use ALL for both US and UK. Defaults to [ALL].'),
  })
  .merge(periodRangeInputSchema);

const fbsReplenishmentOutputSchema = {
  type: 'object',
  properties: {
    message: { type: 'string' },
    report: {
      nullable: true,
      type: 'object',
      properties: {
        title: { type: 'string', nullable: true },
        group: { type: 'string', nullable: true },
        description: { type: 'string', nullable: true },
        link: { type: 'string', nullable: true },
      },
      additionalProperties: true,
    },
    queryExecutionId: { type: 'string', nullable: true },
    query: { type: 'string', nullable: true },
    columns: {
      nullable: true,
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          type: { type: 'string', nullable: true },
        },
        required: ['name'],
        additionalProperties: false,
      },
    },
    rows: {
      nullable: true,
      type: 'array',
      items: { type: 'object', additionalProperties: { type: ['string', 'null'] } },
    },
  },
  required: ['message', 'report'],
};

const revenueAndCogsOutputSchema = {
  type: 'object',
  additionalProperties: true,
};

export function registerNeonPanelTools(registry: ToolRegistry) {
  registry
    .register({
      name: 'neonpanel.listCompanies',
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
      name: 'neonpanel.listReports',
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
      name: 'neonpanel.getCompaniesWithPermission',
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
      name: 'neonpanel.fba_replenishment',
      description:
        'Return FBA replenishment rows from Athena (Glue Data Catalog: inventory_planning.fba_replenishment).',
      isConsequential: false,
      inputSchema: fbsReplenishmentInputSchema,
      outputSchema: fbsReplenishmentOutputSchema,
      examples: [
        {
          name: 'Default (this week)',
          arguments: {},
        },
        {
          name: 'Next 2 weeks for one company',
          arguments: {
            companyUuid: 'company-uuid',
            marketplaces: ['US'],
            period: { kind: 'relative', direction: 'next', unit: 'week', count: 2 },
          },
        },
        {
          name: 'This month for a specific SKU (both marketplaces)',
          arguments: {
            sku: 'SKU123',
            marketplaces: ['ALL'],
            period: { kind: 'preset', preset: 'this_month' },
          },
        },
        {
          name: 'Top 10 urgent items for multiple SKUs',
          arguments: {
            skus: ['SKU123', 'SKU456'],
            topN: 10,
            marketplaces: ['ALL'],
          },
        },
      ],
      execute: async (args, context) => {
        const parsed = fbsReplenishmentInputSchema.parse(args);

        const inventoryIds = [
          ...(parsed.inventoryId !== undefined ? [parsed.inventoryId] : []),
          ...(parsed.inventoryIds ?? []),
        ];
        const skus = [
          ...(parsed.sku !== undefined ? [parsed.sku] : []),
          ...(parsed.skus ?? []),
        ];

        if (inventoryIds.length > 0 && skus.length > 0) {
          throw new AppError('Provide either inventoryId(s) or sku(s), not both.', {
            status: 400,
            code: 'invalid_filter',
            details: { inventoryIdsCount: inventoryIds.length, skusCount: skus.length },
          });
        }

        // Keep period resolution in place so the contract stays stable for the next Athena-backed phase.
        resolvePeriod({
          period: parsed.period,
          startDate: parsed.startDate,
          endDate: parsed.endDate,
        });

        const permission = 'view:quicksight_group.business_planning_new';
        type CompaniesWithPermissionResponse = {
          companies?: Array<{ uuid?: string; name?: string; short_name?: string }>;
        };

        const permissionResponse = await neonPanelRequest<CompaniesWithPermissionResponse>({
          token: context.userToken,
          path: `/api/v1/permissions/${encodeURIComponent(permission)}/companies`,
          query: {
            company_uuids: parsed.companyUuid ? [parsed.companyUuid] : undefined,
          },
        });

        const permittedCompanies = (permissionResponse.companies ?? []).filter(
          (company): company is { uuid?: string; name?: string; short_name?: string } =>
            company !== null && typeof company === 'object',
        );
        const permittedCompanyUuids = permittedCompanies
          .map((company) => company.uuid)
          .filter((uuid): uuid is string => typeof uuid === 'string' && uuid.trim().length > 0);

        if (parsed.companyUuid && !permittedCompanyUuids.includes(parsed.companyUuid)) {
          return {
            message: `User is denied access to planning data for company ${parsed.companyUuid}.`,
            report: null,
          };
        }

        if (permittedCompanies.length === 0) {
          return {
            message: 'User is denied access to planning data.',
            report: null,
          };
        }

        const companyLabels = permittedCompanies
          .map((company) => (company.short_name ?? company.name ?? company.uuid ?? '').trim())
          .filter((value) => value.length > 0);

        const accessMessage = `User has access to planning data for companies ${companyLabels.join(', ')}.`;

        type ReportsListResponse = {
          data?: Array<{ title?: string; group?: string; description?: string; link?: string }>;
        };

        const reports = await neonPanelRequest<ReportsListResponse>({
          token: context.userToken,
          path: '/api/v1/reports',
        });

        const reportItems = (reports.data ?? []).filter(
          (item): item is { title?: string; group?: string; description?: string; link?: string } =>
            item !== null && typeof item === 'object',
        );

        const exactTitle = 'inventory planning';
        const exactGroup = 'planning & forecasting';

        const exactReport = reportItems.find((item) => {
          const title = (item.title ?? '').trim().toLowerCase();
          const group = (item.group ?? '').trim().toLowerCase();
          return title === exactTitle && group === exactGroup;
        });

        const scoreReport = (item: { title?: string; group?: string; description?: string; link?: string }) => {
          const title = (item.title ?? '').toLowerCase();
          const group = (item.group ?? '').toLowerCase();
          const desc = (item.description ?? '').toLowerCase();
          const haystack = `${group} ${title} ${desc}`;
          let score = 0;
          if (title.includes('inventory planning')) score += 10;
          if (group.includes('planning')) score += 3;
          if (haystack.includes('business planning')) score += 2;
          if (haystack.includes('replenishment')) score += 1;
          if (typeof item.link === 'string' && item.link.trim().length > 0) score += 1;
          return score;
        };

        const bestReport =
          exactReport ??
          reportItems
            .map((item) => ({ item, score: scoreReport(item) }))
            .sort((a, b) => b.score - a.score)[0]?.item;

        const topN = parsed.topN ?? 10;
        const catalog = config.athena.catalog;
        const database = config.athena.database;
        const table = config.athena.tables.fbaReplenishment;

        const query = `SELECT * FROM "${catalog}"."${database}"."${table}" LIMIT ${topN}`;

        const athenaResult = await runAthenaQuery({
          query,
          database,
          workGroup: config.athena.workgroup,
          outputLocation: config.athena.outputLocation,
          maxRows: Math.min(1000, topN + 1),
        });

        return {
          message: accessMessage,
          report: bestReport ?? null,
          queryExecutionId: athenaResult.queryExecutionId,
          query: athenaResult.query,
          columns: athenaResult.columns,
          rows: athenaResult.rows,
        };
      },
    })
    .register({
      name: 'neonpanel.listInventoryItems',
      description: 'List inventory items for a company with optional filters.',
      isConsequential: false,
      inputSchema: listInventoryItemsInputSchema,
      outputSchema: listInventoryItemsOutputSchema,
      examples: [
        {
          name: 'Search by SKU',
          arguments: {
            companyUuid: 'company-uuid',
            search: 'SKU12345',
            perPage: 20,
          },
        },
      ],
      execute: async (args, context) => {
        const parsed = listInventoryItemsInputSchema.parse(args);
        return neonPanelRequest({
          token: context.userToken,
          path: `/api/v1/companies/${encodeURIComponent(parsed.companyUuid)}/inventory-items`,
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
      name: 'neonpanel.listWarehouses',
      description: 'Retrieve warehouses for a company with optional search.',
      isConsequential: false,
      inputSchema: listWarehousesInputSchema,
      outputSchema: listWarehousesOutputSchema,
      examples: [
        {
          name: 'List Warehouses',
          arguments: {
            companyUuid: 'company-uuid',
          },
        },
      ],
      execute: async (args, context) => {
        const parsed = listWarehousesInputSchema.parse(args);
        return neonPanelRequest({
          token: context.userToken,
          path: `/api/v1/companies/${encodeURIComponent(parsed.companyUuid)}/warehouses`,
          query: {
            page: parsed.page,
            per_page: parsed.perPage,
            search: parsed.search,
          },
        });
      },
    })
    .register({
      name: 'neonpanel.getWarehouseBalances',
      description: 'Retrieve paginated inventory balances for a warehouse.',
      isConsequential: false,
      inputSchema: warehouseBalancesInputSchema,
      outputSchema: warehouseBalancesOutputSchema,
      examples: [
        {
          name: 'Warehouse Balances',
          arguments: {
            companyUuid: 'company-uuid',
            warehouseUuid: 'warehouse-uuid',
          },
        },
      ],
      execute: async (args, context) => {
        const parsed = warehouseBalancesInputSchema.parse(args);
        return neonPanelRequest({
          token: context.userToken,
          path: `/api/v1/companies/${encodeURIComponent(parsed.companyUuid)}/warehouses/${encodeURIComponent(parsed.warehouseUuid)}/balances`,
          query: {
            page: parsed.page,
            per_page: parsed.perPage,
            balances_date: parsed.balancesDate,
          },
        });
      },
    })
    .register({
      name: 'neonpanel.getInventoryDetails',
      description: 'Retrieve inventory details including restock information and warehouse balances.',
      isConsequential: false,
      inputSchema: inventoryDetailsInputSchema,
      outputSchema: inventoryDetailsOutputSchema,
      examples: [
        {
          name: 'Inventory Details',
          arguments: {
            companyUuid: 'company-uuid',
            inventoryId: 123,
          },
        },
      ],
      execute: async (args, context) => {
        const parsed = inventoryDetailsInputSchema.parse(args);
        return neonPanelRequest({
          token: context.userToken,
          path: `/api/v1/companies/${encodeURIComponent(parsed.companyUuid)}/inventory-items/${encodeURIComponent(String(parsed.inventoryId))}/details`,
          query: {
            balances_date: parsed.balancesDate,
          },
        });
      },
    })
    .register({
      name: 'neonpanel.getInventoryLandedCost',
      description: 'Retrieve landed cost (manufacturing expenses) for an inventory item.',
      isConsequential: false,
      inputSchema: inventoryLandedCostInputSchema,
      outputSchema: inventoryLandedCostOutputSchema,
      examples: [
        {
          name: 'Landed Cost for Warehouse',
          arguments: {
            companyUuid: 'company-uuid',
            inventoryId: 123,
            warehouseUuid: 'warehouse-uuid',
            startDate: '2024-01-01',
            endDate: '2024-02-01',
          },
        },
      ],
      execute: async (args, context) => {
        const parsed = inventoryLandedCostInputSchema.parse(args);
        return neonPanelRequest({
          token: context.userToken,
          path: `/api/v1/companies/${encodeURIComponent(parsed.companyUuid)}/inventory-items/${encodeURIComponent(String(parsed.inventoryId))}/landed-cost`,
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
      name: 'neonpanel.getInventoryCogs',
      description: 'Retrieve cost of goods sold (COGS) for an inventory item.',
      isConsequential: false,
      inputSchema: inventoryCogsInputSchema,
      outputSchema: inventoryCogsOutputSchema,
      examples: [
        {
          name: 'Inventory COGS',
          arguments: {
            companyUuid: 'company-uuid',
            inventoryId: 123,
            startDate: '2024-01-01',
          },
        },
      ],
      execute: async (args, context) => {
        const parsed = inventoryCogsInputSchema.parse(args);
        return neonPanelRequest({
          token: context.userToken,
          path: `/api/v1/companies/${encodeURIComponent(parsed.companyUuid)}/inventory-items/${encodeURIComponent(String(parsed.inventoryId))}/cogs`,
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
      name: 'neonpanel.getImportInstructions',
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
      name: 'neonpanel.createDocuments',
      description: 'Create documents for a company using JSON payload data.',
      isConsequential: true,
      inputSchema: createDocumentsInputSchema,
      outputSchema: createDocumentsOutputSchema,
      examples: [
        {
          name: 'Create Bill Document',
          arguments: {
            companyUuid: 'company-uuid',
            type: 'bill',
            data: { example: 'payload' },
          },
        },
      ],
      execute: async (args, context) => {
        const parsed = createDocumentsInputSchema.parse(args);
        return neonPanelRequest({
          token: context.userToken,
          path: `/api/v1/companies/${encodeURIComponent(parsed.companyUuid)}/create/${encodeURIComponent(parsed.type)}`,
          method: 'POST',
          body: {
            data: parsed.data,
          },
        });
      },
    })
    .register({
      name: 'neonpanel.createDocumentsByPdf',
      description: 'Create documents for a company by providing a downloadable PDF link.',
      isConsequential: true,
      inputSchema: createDocumentsByPdfInputSchema,
      outputSchema: createDocumentsByPdfOutputSchema,
      examples: [
        {
          name: 'Create Bill From PDF Link',
          arguments: {
            companyUuid: 'company-uuid',
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
        return neonPanelRequest({
          token: context.userToken,
          path: `/api/v1/companies/${encodeURIComponent(parsed.companyUuid)}/import/${encodeURIComponent(parsed.type)}/pdf`,
          method: 'POST',
          body: {
            file: parsed.file,
          },
        });
      },
    })
    .register({
      name: 'neonpanel.checkImportStatus',
      description: 'Check the processing status of a previously uploaded document import.',
      isConsequential: false,
      inputSchema: checkImportStatusInputSchema,
      outputSchema: checkImportStatusOutputSchema,
      examples: [
        {
          name: 'Check Import Status',
          arguments: {
            companyUuid: 'company-uuid',
            type: 'bill',
            requestId: '00000000-0000-0000-0000-000000000000',
          },
        },
      ],
      execute: async (args, context) => {
        const parsed = checkImportStatusInputSchema.parse(args);
        return neonPanelRequest({
          token: context.userToken,
          path: `/api/v1/companies/${encodeURIComponent(parsed.companyUuid)}/import/${encodeURIComponent(parsed.type)}/status/${encodeURIComponent(parsed.requestId)}`,
        });
      },
    })

    .register({
      name: 'neonpanel.getRevenueAndCogs',
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
