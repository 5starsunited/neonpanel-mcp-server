import { neonPanelRequest } from '../../clients/neonpanel-api';
import type { ProjectType } from './adapters';
import type { ToolRegistry } from '../types';
import { resolveCompanyUuid } from '../neonpanel-common';
import { projectAdapters } from './adapters';
import {
  createAdjustmentInputSchema,
  createBillInputSchema,
  createInventoryOrderInputSchema,
  createInvoiceInputSchema,
  getAdjustmentInputSchema,
  getBillInputSchema,
  getInventoryOrderInputSchema,
  getInvoiceInputSchema,
  listAdjustmentsInputSchema,
  listAssemblyOrdersInputSchema,
  listBillsInputSchema,
  listInvoicesInputSchema,
  listInventoryOrdersInputSchema,
  listPaymentRequestsInputSchema,
  listPaymentTermsInputSchema,
  listServicesInputSchema,
  listShipmentsInputSchema,
  listVendorsInputSchema,
  passthroughOutputSchema,
  recordPaymentInputSchema,
  updateAdjustmentInputSchema,
  updateBillInputSchema,
  updateInventoryOrderInputSchema,
  updateInvoiceInputSchema,
  updatePaymentRequestInputSchema,
} from './schemas';

function getProjectAdapter(projectType: ProjectType | undefined) {
  return projectAdapters[projectType ?? 'inventory_order'];
}

function requireProjectPath(pathFactory: ((companyUuid: string, projectId: number) => string) | undefined, projectType: ProjectType | undefined, action: string) {
  if (!pathFactory) {
    throw new Error(`project document type ${projectType ?? 'inventory_order'} does not support ${action}`);
  }
  return pathFactory;
}

function requireProjectCollectionPath(pathFactory: ((companyUuid: string) => string) | undefined, projectType: ProjectType | undefined, action: string) {
  if (!pathFactory) {
    throw new Error(`project document type ${projectType ?? 'inventory_order'} does not support ${action}`);
  }
  return pathFactory;
}

type BillDocumentType = 'InventoryOrder' | 'AssemblyOrder' | 'Shipment';
type BillDocumentLink = { type: BillDocumentType; id: number };
type BillProjectPayload = { documents?: BillDocumentLink[] | null };

function groupBillDocumentsByType(documents: BillDocumentLink[] | null | undefined): BillDocumentLink[][] {
  if (!documents || documents.length === 0) {
    return [];
  }

  const grouped = new Map<BillDocumentType, BillDocumentLink[]>();
  for (const document of documents) {
    const links = grouped.get(document.type) ?? [];
    links.push(document);
    grouped.set(document.type, links);
  }

  return Array.from(grouped.values());
}

const companyIdentifierJsonSchema = {
  company_id: {
    type: 'integer',
    minimum: 1,
    description: 'Numeric company ID. Provide this or companyUuid.',
  },
  companyUuid: {
    type: 'string',
    minLength: 1,
    description: 'Company UUID. Provide this or company_id.',
  },
};

const inventoryOrderProjectJsonSchema = {
  type: 'object',
  description: 'Inventory Order / Purchase Order payload.',
  properties: {
    name: { type: ['string', 'null'], description: 'Free-text display name for the order.' },
    ref_number: { type: 'string', description: 'Human-readable PO reference.' },
    date_order_placed: { type: ['string', 'null'], pattern: '^\\d{4}-\\d{2}-\\d{2}$', description: 'Date the purchase order was placed (YYYY-MM-DD).' },
    date_manufacturing_completed: { type: ['string', 'null'], pattern: '^\\d{4}-\\d{2}-\\d{2}$', description: 'Date manufacturing was completed / goods were received (YYYY-MM-DD).' },
    market: { type: ['string', 'null'], minLength: 2, maxLength: 2, description: 'ISO 3166-1 alpha-2 marketplace/country code.' },
    currency: { type: ['string', 'null'], minLength: 3, maxLength: 3, description: 'ISO 4217 currency code.' },
    vendor_id: { type: ['integer', 'null'], minimum: 1, description: 'Vendor ID.' },
    warehouse_id: { type: ['integer', 'null'], minimum: 1, description: 'Destination warehouse ID.' },
    payment_term_id: { type: ['integer', 'null'], minimum: 1, description: 'Payment term ID used to generate payment requests.' },
    details: {
      type: 'array',
      description: 'Inventory order line items. On update, providing details replaces all existing line items.',
      items: {
        type: 'object',
        properties: {
          inventory_id: { type: 'integer', minimum: 1, description: 'Inventory record ID.' },
          quantity: { type: 'integer', minimum: 1 },
          price: { type: 'number', minimum: 0 },
        },
        required: ['inventory_id', 'quantity', 'price'],
        additionalProperties: false,
      },
    },
  },
  additionalProperties: false,
};

const billProjectJsonSchema = {
  type: 'object',
  description: 'Bill payload.',
  properties: {
    name: { type: ['string', 'null'], description: 'Free-text display name for the bill.' },
    ref_number: { type: 'string', description: 'Human-readable bill reference.' },
    date: { type: ['string', 'null'], pattern: '^\\d{4}-\\d{2}-\\d{2}$', description: 'Bill date (YYYY-MM-DD).' },
    market: { type: ['string', 'null'], minLength: 2, maxLength: 2, description: 'ISO 3166-1 alpha-2 marketplace/country code.' },
    currency: { type: ['string', 'null'], minLength: 3, maxLength: 3, description: 'ISO 4217 currency code.' },
    vendor_id: { type: ['integer', 'null'], minimum: 1, description: 'Vendor ID.' },
    payment_term_id: { type: ['integer', 'null'], minimum: 1, description: 'Payment term ID used to generate payment requests.' },
    documents: {
      type: ['array', 'null'],
      description: 'Source documents linked to this bill. Send an array of {type,id} objects, not a JSON string. Supported types: InventoryOrder, Shipment, AssemblyOrder. NeonPanel accepts one document type per upstream request; this MCP tool automatically splits mixed-type bill updates into separate requests.',
      items: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: ['InventoryOrder', 'AssemblyOrder', 'Shipment'], description: 'Short class name of the referenced document.' },
          id: { type: 'integer', minimum: 1, description: 'Primary key of the referenced document.' },
        },
        required: ['type', 'id'],
        additionalProperties: false,
      },
    },
    details: {
      type: 'array',
      description: 'Bill line items. On update, providing details replaces all existing line items. Use project_management_list_services to find service IDs.',
      items: {
        type: 'object',
        properties: {
          service_id: { type: 'integer', minimum: 1, description: 'ID of an existing service. Use project_management_list_services to search and obtain the ID.' },
          quantity: { type: 'integer', minimum: 1 },
          rate: { type: 'number', minimum: 0 },
        },
        required: ['service_id', 'quantity', 'rate'],
        additionalProperties: false,
      },
    },
  },
  additionalProperties: false,
};

const invoiceProjectJsonSchema = {
  type: 'object',
  description: 'Manual invoice payload. Only manual invoices can be updated via the API.',
  properties: {
    name: { type: ['string', 'null'], description: 'Free-text display name for the invoice.' },
    ref_number: { type: 'string', description: 'Human-readable invoice reference. Accepted on create only by NeonPanel.' },
    date: { type: ['string', 'null'], pattern: '^\\d{4}-\\d{2}-\\d{2}$', description: 'Invoice transaction date (YYYY-MM-DD).' },
    market: { type: ['string', 'null'], minLength: 2, maxLength: 2, description: 'ISO 3166-1 alpha-2 marketplace/country code.' },
    currency: { type: ['string', 'null'], minLength: 3, maxLength: 3, description: 'ISO 4217 currency code.' },
    warehouse_id: { type: ['integer', 'null'], minimum: 1, description: 'Warehouse ID associated with the invoice.' },
    customer_id: { type: ['integer', 'null'], minimum: 1, description: 'Customer ID for the invoice.' },
    sales_channel_id: { type: ['integer', 'null'], minimum: 1, description: 'Sales channel ID.' },
    details: {
      type: ['array', 'null'],
      description: 'Invoice line items. On update, providing details replaces all existing line items. Positive quantity means stock sold; negative quantity means customer return.',
      items: {
        type: 'object',
        properties: {
          inventory_id: { type: 'integer', minimum: 1, description: 'Inventory record ID.' },
          service_id: { type: 'integer', minimum: 1, description: 'Associated service ID.' },
          quantity: { type: 'integer', description: 'Display quantity. Positive=sold, negative=returned.' },
          amount: { type: 'number', description: 'Total monetary amount for this line.' },
        },
        required: ['inventory_id', 'service_id', 'quantity', 'amount'],
        additionalProperties: false,
      },
    },
  },
  additionalProperties: false,
};

const adjustmentProjectJsonSchema = {
  type: 'object',
  description: 'Inventory adjustment payload.',
  properties: {
    name: { type: ['string', 'null'], description: 'Free-text display name for the adjustment.' },
    ref_number: { type: 'string', description: 'Human-readable adjustment reference. Accepted on create only by NeonPanel.' },
    date: { type: ['string', 'null'], pattern: '^\\d{4}-\\d{2}-\\d{2}$', description: 'Adjustment transaction date (YYYY-MM-DD).' },
    market: { type: ['string', 'null'], minLength: 2, maxLength: 2, description: 'ISO 3166-1 alpha-2 marketplace/country code.' },
    currency: { type: ['string', 'null'], minLength: 3, maxLength: 3, description: 'ISO 4217 currency code.' },
    reason: { type: ['string', 'null'], description: 'Adjustment reason, such as Damaged, Misplaced, or Administrative Errors.' },
    warehouse_id: { type: ['integer', 'null'], minimum: 1, description: 'Warehouse ID where the adjustment applies.' },
    details: {
      type: ['array', 'null'],
      description: 'Adjustment line items. On update, providing details replaces all existing line items. Positive quantity means stock removed; negative quantity means stock added.',
      items: {
        type: 'object',
        properties: {
          inventory_id: { type: 'integer', minimum: 1, description: 'Inventory record ID.' },
          service_id: { type: 'integer', minimum: 1, description: 'Associated service ID.' },
          quantity: { type: 'integer', description: 'Display quantity. Positive=stock removed, negative=stock added.' },
          rate: { type: 'number', description: 'Unit cost used to calculate line amount.' },
        },
        required: ['inventory_id', 'service_id', 'quantity', 'rate'],
        additionalProperties: false,
      },
    },
  },
  additionalProperties: false,
};

function projectInputJsonSchema(projectJsonSchema: { properties: Record<string, unknown> }, idProperty?: [string, string]) {
  const idProperties = idProperty
    ? {
        [idProperty[0]]: {
          type: 'integer',
          minimum: 1,
          description: idProperty[1],
        },
      }
    : {};

  return {
    type: 'object',
    properties: {
      ...companyIdentifierJsonSchema,
      ...idProperties,
      ...projectJsonSchema.properties,
    },
    required: idProperty ? [idProperty[0]] : [],
    additionalProperties: false,
  };
}

const createInventoryOrderInputJsonSchema = projectInputJsonSchema(inventoryOrderProjectJsonSchema);
const updateInventoryOrderInputJsonSchema = projectInputJsonSchema(inventoryOrderProjectJsonSchema, ['inventory_order_id', 'Inventory Order / Purchase Order ID.']);
const createBillInputJsonSchema = projectInputJsonSchema(billProjectJsonSchema);
const updateBillInputJsonSchema = projectInputJsonSchema(billProjectJsonSchema, ['bill_id', 'Bill ID.']);
const createInvoiceInputJsonSchema = projectInputJsonSchema(invoiceProjectJsonSchema);
const updateInvoiceInputJsonSchema = projectInputJsonSchema(invoiceProjectJsonSchema, ['invoice_id', 'Manual invoice ID.']);
const createAdjustmentInputJsonSchema = projectInputJsonSchema(adjustmentProjectJsonSchema);
const updateAdjustmentInputJsonSchema = projectInputJsonSchema(adjustmentProjectJsonSchema, ['adjustment_id', 'Inventory adjustment ID.']);

type CompanyScopedArgs = { company_id?: number; companyUuid?: string };
type ProjectListArgs = CompanyScopedArgs & {
  search?: string;
  warehouses?: number[];
  vendors?: number[];
  start_date?: string;
  end_date?: string;
};

function projectBodyFromArgs(args: Record<string, unknown>, idProperty?: string) {
  const body = { ...args };
  delete body.company_id;
  delete body.companyUuid;
  if (idProperty) delete body[idProperty];
  return body;
}

function projectListQuery(args: ProjectListArgs) {
  return {
    search: args.search,
    warehouses: args.warehouses,
    vendors: args.vendors,
    start_date: args.start_date,
    end_date: args.end_date,
  };
}

async function listProjectRecords(projectType: ProjectType, args: ProjectListArgs, token: string) {
  const companyUuid = await resolveCompanyUuid(args, token);
  const adapter = getProjectAdapter(projectType);
  return neonPanelRequest({
    token,
    path: adapter.listPath(companyUuid),
    query: projectListQuery(args),
  });
}

async function getProjectRecord(projectType: ProjectType, args: CompanyScopedArgs, projectId: number, token: string) {
  const companyUuid = await resolveCompanyUuid(args, token);
  const adapter = getProjectAdapter(projectType);
  const getPath = requireProjectPath(adapter.getPath, projectType, 'get');
  return neonPanelRequest({
    token,
    path: getPath(companyUuid, projectId),
  });
}

async function createProjectRecord(projectType: ProjectType, args: CompanyScopedArgs, body: Record<string, unknown>, token: string) {
  const companyUuid = await resolveCompanyUuid(args, token);
  const adapter = getProjectAdapter(projectType);
  const createPath = requireProjectCollectionPath(adapter.createPath, projectType, 'create');
  return neonPanelRequest({
    token,
    path: createPath(companyUuid),
    method: 'POST',
    body,
  });
}

async function updateProjectRecord(projectType: ProjectType, args: CompanyScopedArgs, projectId: number, body: Record<string, unknown>, token: string) {
  const companyUuid = await resolveCompanyUuid(args, token);
  const adapter = getProjectAdapter(projectType);
  const updatePath = requireProjectPath(adapter.updatePath, projectType, 'update');
  const getPath = requireProjectPath(adapter.getPath, projectType, 'get');

  if (projectType === 'bill') {
    const documentGroups = groupBillDocumentsByType((body as BillProjectPayload).documents);
    if (documentGroups.length > 1) {
      const { documents: _documents, ...baseProject } = body as BillProjectPayload & Record<string, unknown>;

      if (Object.keys(baseProject).length > 0) {
        await neonPanelRequest({
          token,
          path: updatePath(companyUuid, projectId),
          method: 'PUT',
          body: baseProject,
        });
      }

      for (const documents of documentGroups) {
        await neonPanelRequest({
          token,
          path: updatePath(companyUuid, projectId),
          method: 'PUT',
          body: { documents },
        });
      }

      return neonPanelRequest({
        token,
        path: getPath(companyUuid, projectId),
      });
    }
  }

  return neonPanelRequest({
    token,
    path: updatePath(companyUuid, projectId),
    method: 'PUT',
    body,
  });
}

export function registerProjectManagementTools(registry: ToolRegistry) {
  registry
    .register({
      name: 'project_management_list_inventory_orders',
      description: 'List NeonPanel Inventory Orders / Purchase Orders for a company (NeonPanel: GET /api/v1/companies/{uuid}/inventory-orders). Optional filters: search, warehouses, vendors, and date range (start_date, end_date). Use company_id when available; companyUuid is also accepted.',
      isConsequential: false,
      inputSchema: listInventoryOrdersInputSchema,
      outputSchema: passthroughOutputSchema,
      examples: [
        {
          name: 'List Inventory Orders',
          arguments: {
            company_id: 230,
            search: 'PO-2024',
          },
        },
      ],
      execute: async (args, context) => {
        const parsed = listInventoryOrdersInputSchema.parse(args);
        return listProjectRecords('inventory_order', parsed, context.userToken);
      },
    })
    .register({
      name: 'project_management_get_inventory_order',
      description: 'Get one NeonPanel Inventory Order / Purchase Order by ID, including line items and related context when present.',
      isConsequential: false,
      inputSchema: getInventoryOrderInputSchema,
      outputSchema: passthroughOutputSchema,
      examples: [
        {
          name: 'Get Inventory Order',
          arguments: {
            company_id: 230,
            inventory_order_id: 42,
          },
        },
      ],
      execute: async (args, context) => {
        const parsed = getInventoryOrderInputSchema.parse(args);
        return getProjectRecord('inventory_order', parsed, parsed.inventory_order_id, context.userToken);
      },
    })
    .register({
      name: 'project_management_create_inventory_order',
      description: 'Create a NeonPanel Inventory Order / Purchase Order. Details use inventory_id, quantity, and price. payment_term_id may generate payment requests server-side.',
      isConsequential: true,
      inputSchema: createInventoryOrderInputSchema,
      outputSchema: passthroughOutputSchema,
      specJson: {
        name: 'project_management_create_inventory_order',
        description: 'Create a NeonPanel Inventory Order / Purchase Order. Details use inventory_id, quantity, and price. payment_term_id may generate payment requests server-side.',
        isConsequential: true,
        inputSchema: createInventoryOrderInputJsonSchema,
        outputSchema: passthroughOutputSchema,
      },
      examples: [
        {
          name: 'Create Inventory Order',
          arguments: {
            company_id: 230,
            ref_number: 'REF-0042',
            date_order_placed: '2026-05-03',
            market: 'US',
            currency: 'USD',
            vendor_id: 7,
            warehouse_id: 3,
            details: [{ inventory_id: 101, quantity: 50, price: 12.99 }],
          },
        },
      ],
      execute: async (args, context) => {
        const parsed = createInventoryOrderInputSchema.parse(args);
        return createProjectRecord('inventory_order', parsed, projectBodyFromArgs(parsed), context.userToken);
      },
    })
    .register({
      name: 'project_management_update_inventory_order',
      description: 'Sparse-update a NeonPanel Inventory Order / Purchase Order. Only send fields that should change. Providing details replaces all existing line items.',
      isConsequential: true,
      inputSchema: updateInventoryOrderInputSchema,
      outputSchema: passthroughOutputSchema,
      specJson: {
        name: 'project_management_update_inventory_order',
        description: 'Sparse-update a NeonPanel Inventory Order / Purchase Order. Only send fields that should change. Providing details replaces all existing line items.',
        isConsequential: true,
        inputSchema: updateInventoryOrderInputJsonSchema,
        outputSchema: passthroughOutputSchema,
      },
      examples: [
        {
          name: 'Update Inventory Order Completion Date',
          arguments: {
            company_id: 230,
            inventory_order_id: 42,
            date_manufacturing_completed: '2026-06-15',
          },
        },
      ],
      execute: async (args, context) => {
        const parsed = updateInventoryOrderInputSchema.parse(args);
        return updateProjectRecord('inventory_order', parsed, parsed.inventory_order_id, projectBodyFromArgs(parsed, 'inventory_order_id'), context.userToken);
      },
    })
    .register({
      name: 'project_management_list_bills',
      description: 'List NeonPanel Bills for a company (NeonPanel: GET /api/v1/companies/{uuid}/bills). Optional filters: search, vendors, and date range (start_date, end_date). Use company_id when available; companyUuid is also accepted.',
      isConsequential: false,
      inputSchema: listBillsInputSchema,
      outputSchema: passthroughOutputSchema,
      examples: [
        {
          name: 'List Bills',
          arguments: {
            company_id: 230,
            vendors: [7],
          },
        },
      ],
      execute: async (args, context) => {
        const parsed = listBillsInputSchema.parse(args);
        return listProjectRecords('bill', parsed, context.userToken);
      },
    })
    .register({
      name: 'project_management_get_bill',
      description: 'Get one NeonPanel Bill by ID, including line items, source documents, and payment context when present.',
      isConsequential: false,
      inputSchema: getBillInputSchema,
      outputSchema: passthroughOutputSchema,
      examples: [
        {
          name: 'Get Bill',
          arguments: {
            company_id: 230,
            bill_id: 17,
          },
        },
      ],
      execute: async (args, context) => {
        const parsed = getBillInputSchema.parse(args);
        return getProjectRecord('bill', parsed, parsed.bill_id, context.userToken);
      },
    })
    .register({
      name: 'project_management_create_bill',
      description: 'Create a NeonPanel Bill. Details use service_id, quantity, and rate. Bills may link source documents with {type,id} for InventoryOrder, Shipment, or AssemblyOrder.',
      isConsequential: true,
      inputSchema: createBillInputSchema,
      outputSchema: passthroughOutputSchema,
      specJson: {
        name: 'project_management_create_bill',
        description: 'Create a NeonPanel Bill. Details use service_id, quantity, and rate. Bills may link source documents with {type,id} for InventoryOrder, Shipment, or AssemblyOrder.',
        isConsequential: true,
        inputSchema: createBillInputJsonSchema,
        outputSchema: passthroughOutputSchema,
      },
      examples: [
        {
          name: 'Create Bill',
          arguments: {
            company_id: 230,
            ref_number: 'REF-BILL-001',
            date: '2026-05-03',
            market: 'US',
            currency: 'USD',
            vendor_id: 7,
            payment_term_id: 2,
            documents: [{ type: 'InventoryOrder', id: 3690 }],
            details: [{ service_id: 55, quantity: 3, rate: 250 }],
          },
        },
      ],
      execute: async (args, context) => {
        const parsed = createBillInputSchema.parse(args);
        return createProjectRecord('bill', parsed, projectBodyFromArgs(parsed), context.userToken);
      },
    })
    .register({
      name: 'project_management_update_bill',
      description: 'Sparse-update a NeonPanel Bill. Only send fields that should change. documents must be an array of {type,id} objects. Mixed document types are automatically split into separate NeonPanel requests because the upstream API ignores mixed types in one request. Providing details replaces all existing line items; payment_term_id may regenerate payment schedule server-side.',
      isConsequential: true,
      inputSchema: updateBillInputSchema,
      outputSchema: passthroughOutputSchema,
      specJson: {
        name: 'project_management_update_bill',
        description: 'Sparse-update a NeonPanel Bill. Only send fields that should change. documents must be an array of {type,id} objects. Mixed document types are automatically split into separate NeonPanel requests because the upstream API ignores mixed types in one request. Providing details replaces all existing line items; payment_term_id may regenerate payment schedule server-side.',
        isConsequential: true,
        inputSchema: updateBillInputJsonSchema,
        outputSchema: passthroughOutputSchema,
      },
      examples: [
        {
          name: 'Update Bill Source Documents',
          arguments: {
            company_id: 230,
            bill_id: 17,
            documents: [
              { type: 'InventoryOrder', id: 3690 },
              { type: 'Shipment', id: 812 },
            ],
          },
        },
      ],
      execute: async (args, context) => {
        const parsed = updateBillInputSchema.parse(args);
        return updateProjectRecord('bill', parsed, parsed.bill_id, projectBodyFromArgs(parsed, 'bill_id'), context.userToken);
      },
    })
    .register({
      name: 'project_management_get_invoice',
      description: 'Get one NeonPanel manual invoice by ID, including line items and related context when present.',
      isConsequential: false,
      inputSchema: getInvoiceInputSchema,
      outputSchema: passthroughOutputSchema,
      examples: [
        {
          name: 'Get Invoice',
          arguments: {
            company_id: 230,
            invoice_id: 17,
          },
        },
      ],
      execute: async (args, context) => {
        const parsed = getInvoiceInputSchema.parse(args);
        return getProjectRecord('invoice', parsed, parsed.invoice_id, context.userToken);
      },
    })
    .register({
      name: 'project_management_create_invoice',
      description: 'Create a NeonPanel manual invoice. Details use inventory_id, service_id, quantity, and amount.',
      isConsequential: true,
      inputSchema: createInvoiceInputSchema,
      outputSchema: passthroughOutputSchema,
      specJson: {
        name: 'project_management_create_invoice',
        description: 'Create a NeonPanel manual invoice. Details use inventory_id, service_id, quantity, and amount.',
        isConsequential: true,
        inputSchema: createInvoiceInputJsonSchema,
        outputSchema: passthroughOutputSchema,
      },
      examples: [
        {
          name: 'Create Manual Invoice',
          arguments: {
            company_id: 230,
            ref_number: 'REF-INV-001',
            date: '2026-05-03',
            market: 'US',
            currency: 'USD',
            warehouse_id: 3,
            customer_id: 7,
            sales_channel_id: 2,
            details: [{ inventory_id: 101, service_id: 55, quantity: 5, amount: 125 }],
          },
        },
      ],
      execute: async (args, context) => {
        const parsed = createInvoiceInputSchema.parse(args);
        return createProjectRecord('invoice', parsed, projectBodyFromArgs(parsed), context.userToken);
      },
    })
    .register({
      name: 'project_management_update_invoice',
      description: 'Sparse-update a NeonPanel manual invoice. Only manual invoices can be updated via the API. Providing details replaces all existing line items.',
      isConsequential: true,
      inputSchema: updateInvoiceInputSchema,
      outputSchema: passthroughOutputSchema,
      specJson: {
        name: 'project_management_update_invoice',
        description: 'Sparse-update a NeonPanel manual invoice. Only manual invoices can be updated via the API. Providing details replaces all existing line items.',
        isConsequential: true,
        inputSchema: updateInvoiceInputJsonSchema,
        outputSchema: passthroughOutputSchema,
      },
      examples: [
        {
          name: 'Update Invoice Date',
          arguments: {
            company_id: 230,
            invoice_id: 17,
            date: '2026-05-03',
          },
        },
      ],
      execute: async (args, context) => {
        const parsed = updateInvoiceInputSchema.parse(args);
        return updateProjectRecord('invoice', parsed, parsed.invoice_id, projectBodyFromArgs(parsed, 'invoice_id'), context.userToken);
      },
    })
    .register({
      name: 'project_management_list_adjustments',
      description: 'List NeonPanel inventory adjustments for a company (NeonPanel: GET /api/v1/companies/{uuid}/adjustments). Optional filters: search, warehouses, and date range (start_date, end_date). Use company_id when available; companyUuid is also accepted.',
      isConsequential: false,
      inputSchema: listAdjustmentsInputSchema,
      outputSchema: passthroughOutputSchema,
      examples: [
        {
          name: 'List Adjustments',
          arguments: {
            company_id: 230,
            search: 'Damaged',
          },
        },
      ],
      execute: async (args, context) => {
        const parsed = listAdjustmentsInputSchema.parse(args);
        return listProjectRecords('adjustment', parsed, context.userToken);
      },
    })
    .register({
      name: 'project_management_get_adjustment',
      description: 'Get one NeonPanel inventory adjustment by ID, including line items and related context when present.',
      isConsequential: false,
      inputSchema: getAdjustmentInputSchema,
      outputSchema: passthroughOutputSchema,
      examples: [
        {
          name: 'Get Adjustment',
          arguments: {
            company_id: 230,
            adjustment_id: 88,
          },
        },
      ],
      execute: async (args, context) => {
        const parsed = getAdjustmentInputSchema.parse(args);
        return getProjectRecord('adjustment', parsed, parsed.adjustment_id, context.userToken);
      },
    })
    .register({
      name: 'project_management_create_adjustment',
      description: 'Create a NeonPanel inventory adjustment. Details use inventory_id, service_id, quantity, and rate. Positive quantity means stock removed; negative quantity means stock added.',
      isConsequential: true,
      inputSchema: createAdjustmentInputSchema,
      outputSchema: passthroughOutputSchema,
      specJson: {
        name: 'project_management_create_adjustment',
        description: 'Create a NeonPanel inventory adjustment. Details use inventory_id, service_id, quantity, and rate. Positive quantity means stock removed; negative quantity means stock added.',
        isConsequential: true,
        inputSchema: createAdjustmentInputJsonSchema,
        outputSchema: passthroughOutputSchema,
      },
      examples: [
        {
          name: 'Create Adjustment',
          arguments: {
            company_id: 230,
            ref_number: 'REF-ADJ-001',
            date: '2026-05-03',
            market: 'US',
            currency: 'USD',
            reason: 'Damaged',
            warehouse_id: 3,
            details: [{ inventory_id: 101, service_id: 55, quantity: 10, rate: 25 }],
          },
        },
      ],
      execute: async (args, context) => {
        const parsed = createAdjustmentInputSchema.parse(args);
        return createProjectRecord('adjustment', parsed, projectBodyFromArgs(parsed), context.userToken);
      },
    })
    .register({
      name: 'project_management_update_adjustment',
      description: 'Sparse-update a NeonPanel inventory adjustment. Only send fields that should change. Providing details replaces all existing line items.',
      isConsequential: true,
      inputSchema: updateAdjustmentInputSchema,
      outputSchema: passthroughOutputSchema,
      specJson: {
        name: 'project_management_update_adjustment',
        description: 'Sparse-update a NeonPanel inventory adjustment. Only send fields that should change. Providing details replaces all existing line items.',
        isConsequential: true,
        inputSchema: updateAdjustmentInputJsonSchema,
        outputSchema: passthroughOutputSchema,
      },
      examples: [
        {
          name: 'Update Adjustment Reason',
          arguments: {
            company_id: 230,
            adjustment_id: 88,
            reason: 'Administrative Errors',
          },
        },
      ],
      execute: async (args, context) => {
        const parsed = updateAdjustmentInputSchema.parse(args);
        return updateProjectRecord('adjustment', parsed, parsed.adjustment_id, projectBodyFromArgs(parsed, 'adjustment_id'), context.userToken);
      },
    })
    .register({
      name: 'project_management_list_assembly_orders',
      description: 'List NeonPanel assembly orders for a company (NeonPanel: GET /api/v1/companies/{uuid}/assembly-orders). Assembly orders are currently list-only in the NeonPanel Documents API. Optional filters: search, warehouses, and date range (start_date, end_date).',
      isConsequential: false,
      inputSchema: listAssemblyOrdersInputSchema,
      outputSchema: passthroughOutputSchema,
      examples: [
        {
          name: 'List Assembly Orders',
          arguments: {
            company_id: 230,
          },
        },
      ],
      execute: async (args, context) => {
        const parsed = listAssemblyOrdersInputSchema.parse(args);
        return listProjectRecords('assembly_order', parsed, context.userToken);
      },
    })
    .register({
      name: 'project_management_list_payment_requests',
      description: 'List payment request installments for a company across document types such as Inventory Orders and Bills (NeonPanel: GET /api/v1/companies/{uuid}/payment-requests). Supports due-date range filters start_date and end_date. Returns payment request fields with parent document context.',
      isConsequential: false,
      inputSchema: listPaymentRequestsInputSchema,
      outputSchema: passthroughOutputSchema,
      examples: [
        {
          name: 'List May Payment Requests',
          arguments: {
            company_id: 230,
            start_date: '2026-05-01',
            end_date: '2026-05-31',
          },
        },
      ],
      execute: async (args, context) => {
        const parsed = listPaymentRequestsInputSchema.parse(args);
        const companyUuid = await resolveCompanyUuid(parsed, context.userToken);
        return neonPanelRequest({
          token: context.userToken,
          path: `/api/v1/companies/${encodeURIComponent(companyUuid)}/payment-requests`,
          query: {
            start_date: parsed.start_date,
            end_date: parsed.end_date,
          },
        });
      },
    })
    .register({
      name: 'project_management_update_payment_request',
      description: 'Sparse-update a NeonPanel payment request installment (NeonPanel: PUT /api/v1/companies/{uuid}/payment-requests/{paymentId}). Supports paid_amount, payment_date, transaction_number, and memo. Use list_payment_requests first to identify the payment_id and parent document context.',
      isConsequential: true,
      inputSchema: updatePaymentRequestInputSchema,
      outputSchema: passthroughOutputSchema,
      examples: [
        {
          name: 'Record Payment Request Details',
          arguments: {
            company_id: 230,
            payment_id: 9,
            payment: {
              paid_amount: 500,
              payment_date: '2026-05-03',
              transaction_number: 'TXN-9988776',
              memo: 'Wire transfer - first installment',
            },
          },
        },
      ],
      execute: async (args, context) => {
        const parsed = updatePaymentRequestInputSchema.parse(args);
        const companyUuid = await resolveCompanyUuid(parsed, context.userToken);
        return neonPanelRequest({
          token: context.userToken,
          path: `/api/v1/companies/${encodeURIComponent(companyUuid)}/payment-requests/${encodeURIComponent(String(parsed.payment_id))}`,
          method: 'PUT',
          body: parsed.payment,
        });
      },
    })
    .register({
      name: 'project_management_record_payment',
      description: 'Convenience wrapper for recording payment details on a NeonPanel payment request installment (NeonPanel: PUT /api/v1/companies/{uuid}/payment-requests/{paymentId}). Requires paid_amount and payment_date; optionally sends transaction_number and memo.',
      isConsequential: true,
      inputSchema: recordPaymentInputSchema,
      outputSchema: passthroughOutputSchema,
      examples: [
        {
          name: 'Record Paid Installment',
          arguments: {
            company_id: 230,
            payment_id: 9,
            paid_amount: 500,
            payment_date: '2026-05-03',
            transaction_number: 'TXN-9988776',
            memo: 'Wire transfer - first installment',
          },
        },
      ],
      execute: async (args, context) => {
        const parsed = recordPaymentInputSchema.parse(args);
        const companyUuid = await resolveCompanyUuid(parsed, context.userToken);
        return neonPanelRequest({
          token: context.userToken,
          path: `/api/v1/companies/${encodeURIComponent(companyUuid)}/payment-requests/${encodeURIComponent(String(parsed.payment_id))}`,
          method: 'PUT',
          body: {
            paid_amount: parsed.paid_amount,
            payment_date: parsed.payment_date,
            transaction_number: parsed.transaction_number,
            memo: parsed.memo,
          },
        });
      },
    })
    .register({
      name: 'project_management_list_vendors',
      description: 'List vendors for a company for use when creating or updating project records (NeonPanel: GET /api/v1/companies/{uuid}/vendors). Supports optional search and per_page.',
      isConsequential: false,
      inputSchema: listVendorsInputSchema,
      outputSchema: passthroughOutputSchema,
      examples: [
        {
          name: 'Search Vendors',
          arguments: {
            company_id: 230,
            search: 'Acme',
            per_page: 50,
          },
        },
      ],
      execute: async (args, context) => {
        const parsed = listVendorsInputSchema.parse(args);
        const companyUuid = await resolveCompanyUuid(parsed, context.userToken);
        return neonPanelRequest({
          token: context.userToken,
          path: `/api/v1/companies/${encodeURIComponent(companyUuid)}/vendors`,
          query: {
            search: parsed.search,
            per_page: parsed.per_page,
          },
        });
      },
    })
    .register({
      name: 'project_management_list_invoices',
      description: 'List invoices for a company (NeonPanel: GET /api/v1/companies/{uuid}/invoices). Supports optional search and transaction date range filters start_date and end_date. Returns invoices with line items, customer, warehouse, marketplace, and sales channel context.',
      isConsequential: false,
      inputSchema: listInvoicesInputSchema,
      outputSchema: passthroughOutputSchema,
      examples: [
        {
          name: 'List May Invoices',
          arguments: {
            company_id: 230,
            start_date: '2026-05-01',
            end_date: '2026-05-31',
          },
        },
      ],
      execute: async (args, context) => {
        const parsed = listInvoicesInputSchema.parse(args);
        const companyUuid = await resolveCompanyUuid(parsed, context.userToken);
        return neonPanelRequest({
          token: context.userToken,
          path: `/api/v1/companies/${encodeURIComponent(companyUuid)}/invoices`,
          query: {
            search: parsed.search,
            start_date: parsed.start_date,
            end_date: parsed.end_date,
          },
        });
      },
    })
    .register({
      name: 'project_management_list_shipments',
      description: 'List shipments for a company (NeonPanel: GET /api/v1/companies/{uuid}/shipments). Supports optional search, warehouses, and date range filters start_date and end_date.',
      isConsequential: false,
      inputSchema: listShipmentsInputSchema,
      outputSchema: passthroughOutputSchema,
      examples: [
        {
          name: 'List May Shipments',
          arguments: {
            company_id: 230,
            start_date: '2026-05-01',
            end_date: '2026-05-31',
          },
        },
      ],
      execute: async (args, context) => {
        const parsed = listShipmentsInputSchema.parse(args);
        const companyUuid = await resolveCompanyUuid(parsed, context.userToken);
        return neonPanelRequest({
          token: context.userToken,
          path: `/api/v1/companies/${encodeURIComponent(companyUuid)}/shipments`,
          query: {
            search: parsed.search,
            warehouses: parsed.warehouses,
            start_date: parsed.start_date,
            end_date: parsed.end_date,
          },
        });
      },
    })
    .register({
      name: 'project_management_list_services',
      description: 'List services for a company for use when creating or updating Bill line items (NeonPanel: GET /api/v1/companies/{uuid}/services). Search for a service by name to obtain its ID, then pass that ID as service_id in bill details. Supports optional search and per_page.',
      isConsequential: false,
      inputSchema: listServicesInputSchema,
      outputSchema: passthroughOutputSchema,
      examples: [
        {
          name: 'Search Services',
          arguments: {
            company_id: 230,
            search: 'Freight',
            per_page: 50,
          },
        },
      ],
      execute: async (args, context) => {
        const parsed = listServicesInputSchema.parse(args);
        const companyUuid = await resolveCompanyUuid(parsed, context.userToken);
        return neonPanelRequest({
          token: context.userToken,
          path: `/api/v1/companies/${encodeURIComponent(companyUuid)}/services`,
          query: {
            search: parsed.search,
            per_page: parsed.per_page,
          },
        });
      },
    })
    .register({
      name: 'project_management_list_payment_terms',
      description: 'List global NeonPanel payment terms available for project/document creation (NeonPanel: GET /api/v1/payment-terms). Terms are not company-scoped and include the document type they apply to, such as InventoryOrder or Bill.',
      isConsequential: false,
      inputSchema: listPaymentTermsInputSchema,
      outputSchema: passthroughOutputSchema,
      examples: [
        {
          name: 'List Payment Terms',
          arguments: {},
        },
      ],
      execute: async (args, context) => {
        listPaymentTermsInputSchema.parse(args);
        return neonPanelRequest({
          token: context.userToken,
          path: '/api/v1/payment-terms',
        });
      },
    });
}