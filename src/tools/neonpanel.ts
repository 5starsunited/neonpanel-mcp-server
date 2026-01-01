import { z } from 'zod';
import { neonPanelRequest } from '../clients/neonpanel-api';
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

const revenueAndCogsOutputSchema = {
  type: 'object',
  additionalProperties: true,
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
      name: 'neonpanel_listWarehouses',
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
      name: 'neonpanel_getWarehouseBalances',
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
      name: 'neonpanel_getInventoryDetails',
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
      name: 'neonpanel_getInventoryLandedCost',
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
      name: 'neonpanel_getInventoryCogs',
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
      name: 'neonpanel_createDocumentsByPdf',
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
      name: 'neonpanel_checkImportStatus',
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
