import { neonPanelRequest } from '../../clients/neonpanel-api';
import type { ProjectType } from './adapters';
import type { ToolRegistry } from '../types';
import { resolveCompanyUuid } from '../neonpanel-common';
import { projectAdapters } from './adapters';
import {
  createProjectInputSchema,
  getProjectInputSchema,
  listInvoicesInputSchema,
  listPaymentRequestsInputSchema,
  listPaymentTermsInputSchema,
  listProjectsInputSchema,
  listServicesInputSchema,
  listShipmentsInputSchema,
  listVendorsInputSchema,
  passthroughOutputSchema,
  recordPaymentInputSchema,
  updatePaymentRequestInputSchema,
  updateProjectInputSchema,
} from './schemas';

function getProjectAdapter(projectType: ProjectType | undefined) {
  return projectAdapters[projectType ?? 'inventory_order'];
}

function requireProjectPath(pathFactory: ((companyUuid: string, projectId: number) => string) | undefined, projectType: ProjectType | undefined, action: string) {
  if (!pathFactory) {
    throw new Error(`project_type ${projectType ?? 'inventory_order'} does not support ${action}`);
  }
  return pathFactory;
}

function requireProjectCollectionPath(pathFactory: ((companyUuid: string) => string) | undefined, projectType: ProjectType | undefined, action: string) {
  if (!pathFactory) {
    throw new Error(`project_type ${projectType ?? 'inventory_order'} does not support ${action}`);
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
  description: 'Inventory Order / Purchase Order payload. Use when project_type is inventory_order or omitted.',
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
  description: 'Bill payload. Use when project_type is bill.',
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
  description: 'Manual invoice payload. Use when project_type is invoice. Only manual invoices can be updated via the API.',
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
  description: 'Inventory adjustment payload. Use when project_type is adjustment.',
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

const projectInputJsonSchemaProperties = {
  ...companyIdentifierJsonSchema,
  project_type: {
    type: 'string',
    enum: ['inventory_order', 'bill', 'invoice', 'adjustment'],
    default: 'inventory_order',
    description: 'Project/document type. assembly_order is list-only in the current NeonPanel API and is not accepted for create/update.',
  },
  project: {
    oneOf: [inventoryOrderProjectJsonSchema, billProjectJsonSchema, invoiceProjectJsonSchema, adjustmentProjectJsonSchema],
    description: 'Project payload. Use the shape matching project_type. assembly_order has no create/update payload because it is list-only.',
  },
};

const createProjectInputJsonSchema = {
  type: 'object',
  properties: projectInputJsonSchemaProperties,
  required: ['project'],
  additionalProperties: false,
};

const updateProjectInputJsonSchema = {
  type: 'object',
  properties: {
    ...projectInputJsonSchemaProperties,
    project_id: {
      type: 'integer',
      minimum: 1,
      description: 'Document ID matching project_type: inventory order, bill, invoice, or adjustment.',
    },
  },
  required: ['project_id', 'project'],
  additionalProperties: false,
};

export function registerProjectManagementTools(registry: ToolRegistry) {
  registry
    .register({
      name: 'project_management_list_projects',
      description: 'List NeonPanel project/document records for a company. Supports project_type="inventory_order" / Purchase Orders, "bill" / Bills, "invoice" / manual invoices, "adjustment" / inventory adjustments, and "assembly_order" / assembly orders (list-only). Optional filters: search, warehouses where supported, vendors where supported, and date range (start_date, end_date). Use company_id when available; companyUuid is also accepted.',
      isConsequential: false,
      inputSchema: listProjectsInputSchema,
      outputSchema: passthroughOutputSchema,
      examples: [
        {
          name: 'List Inventory Orders',
          arguments: {
            project_type: 'inventory_order',
            company_id: 230,
            search: 'PO-2024',
          },
        },
        {
          name: 'List Bills',
          arguments: {
            project_type: 'bill',
            company_id: 230,
            vendors: [7],
          },
        },
        {
          name: 'List Manual Invoices',
          arguments: {
            project_type: 'invoice',
            company_id: 230,
            start_date: '2026-05-01',
            end_date: '2026-05-31',
          },
        },
        {
          name: 'List Adjustments',
          arguments: {
            project_type: 'adjustment',
            company_id: 230,
            search: 'Damaged',
          },
        },
        {
          name: 'List Assembly Orders',
          arguments: {
            project_type: 'assembly_order',
            company_id: 230,
          },
        },
      ],
      execute: async (args, context) => {
        const parsed = listProjectsInputSchema.parse(args);
        const companyUuid = await resolveCompanyUuid(parsed, context.userToken);
        const adapter = getProjectAdapter(parsed.project_type);
        return neonPanelRequest({
          token: context.userToken,
          path: adapter.listPath(companyUuid),
          query: {
            search: parsed.search,
            warehouses: parsed.warehouses,
            vendors: parsed.vendors,
            start_date: parsed.start_date,
            end_date: parsed.end_date,
          },
        });
      },
    })
    .register({
      name: 'project_management_get_project',
      description: 'Get one NeonPanel project/document record by ID. Supports project_type="inventory_order" / Purchase Orders, "bill" / Bills, "invoice" / manual invoices, and "adjustment" / inventory adjustments. Assembly orders are currently list-only in the NeonPanel Documents API. Returns full project details including line items and related context when present.',
      isConsequential: false,
      inputSchema: getProjectInputSchema,
      outputSchema: passthroughOutputSchema,
      examples: [
        {
          name: 'Get Inventory Order',
          arguments: {
            project_type: 'inventory_order',
            company_id: 230,
            project_id: 42,
          },
        },
        {
          name: 'Get Bill',
          arguments: {
            project_type: 'bill',
            company_id: 230,
            project_id: 17,
          },
        },
        {
          name: 'Get Invoice',
          arguments: {
            project_type: 'invoice',
            company_id: 230,
            project_id: 17,
          },
        },
      ],
      execute: async (args, context) => {
        const parsed = getProjectInputSchema.parse(args);
        const companyUuid = await resolveCompanyUuid(parsed, context.userToken);
        const adapter = getProjectAdapter(parsed.project_type);
        const getPath = requireProjectPath(adapter.getPath, parsed.project_type, 'get');
        return neonPanelRequest({
          token: context.userToken,
          path: getPath(companyUuid, parsed.project_id),
        });
      },
    })
    .register({
      name: 'project_management_create_project',
      description: 'Create a NeonPanel project/document record. Supports project_type="inventory_order" / Purchase Orders, "bill" / Bills, "invoice" / manual invoices, and "adjustment" / inventory adjustments. Assembly orders are currently list-only. Inventory order details use inventory_id, quantity, price. Bill details use service_id, quantity, rate; bills may link source documents with {type,id} for InventoryOrder, Shipment, or AssemblyOrder. Invoice details use inventory_id, service_id, quantity, amount. Adjustment details use inventory_id, service_id, quantity, rate. Payment request mutation is handled by direct payment request tools.',
      isConsequential: true,
      inputSchema: createProjectInputSchema,
      outputSchema: passthroughOutputSchema,
      specJson: {
        name: 'project_management_create_project',
        description: 'Create a NeonPanel project/document record. Supports project_type="inventory_order" / Purchase Orders, "bill" / Bills, "invoice" / manual invoices, and "adjustment" / inventory adjustments. Assembly orders are currently list-only. Inventory order details use inventory_id, quantity, price. Bill details use service_id, quantity, rate; bills may link source documents with {type,id} for InventoryOrder, Shipment, or AssemblyOrder. Invoice details use inventory_id, service_id, quantity, amount. Adjustment details use inventory_id, service_id, quantity, rate. Payment request mutation is handled by direct payment request tools.',
        isConsequential: true,
        inputSchema: createProjectInputJsonSchema,
        outputSchema: passthroughOutputSchema,
      },
      examples: [
        {
          name: 'Create Inventory Order',
          arguments: {
            project_type: 'inventory_order',
            company_id: 230,
            project: {
              ref_number: 'REF-0042',
              date_order_placed: '2026-05-03',
              market: 'US',
              currency: 'USD',
              vendor_id: 7,
              warehouse_id: 3,
              details: [{ inventory_id: 101, quantity: 50, price: 12.99 }],
            },
          },
        },
        {
          name: 'Create Bill',
          arguments: {
            project_type: 'bill',
            company_id: 230,
            project: {
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
        },
        {
          name: 'Create Manual Invoice',
          arguments: {
            project_type: 'invoice',
            company_id: 230,
            project: {
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
        },
        {
          name: 'Create Adjustment',
          arguments: {
            project_type: 'adjustment',
            company_id: 230,
            project: {
              ref_number: 'REF-ADJ-001',
              date: '2026-05-03',
              market: 'US',
              currency: 'USD',
              reason: 'Damaged',
              warehouse_id: 3,
              details: [{ inventory_id: 101, service_id: 55, quantity: 10, rate: 25 }],
            },
          },
        },
      ],
      execute: async (args, context) => {
        const parsed = createProjectInputSchema.parse(args);
        const companyUuid = await resolveCompanyUuid(parsed, context.userToken);
        const adapter = getProjectAdapter(parsed.project_type);
        const createPath = requireProjectCollectionPath(adapter.createPath, parsed.project_type, 'create');
        return neonPanelRequest({
          token: context.userToken,
          path: createPath(companyUuid),
          method: 'POST',
          body: parsed.project,
        });
      },
    })
    .register({
      name: 'project_management_update_project',
      description: 'Sparse-update a NeonPanel project/document record. Supports project_type="inventory_order" / Purchase Orders, "bill" / Bills, "invoice" / manual invoices, and "adjustment" / inventory adjustments. Assembly orders are currently list-only. Only send project fields that should change. For bills, documents must be an array of {type,id} objects. Supported bill document types are InventoryOrder, Shipment, and AssemblyOrder. Mixed-type bill documents are automatically split into separate NeonPanel requests because the upstream API ignores mixed types in one request. Warning: details[] replaces existing line items when provided; payment_term_id may regenerate payment schedule server-side. Invoice updates only work for manual invoices. Use project_management_update_payment_request for payment request mutation.',
      isConsequential: true,
      inputSchema: updateProjectInputSchema,
      outputSchema: passthroughOutputSchema,
      specJson: {
        name: 'project_management_update_project',
        description: 'Sparse-update a NeonPanel project/document record. Supports project_type="inventory_order" / Purchase Orders, "bill" / Bills, "invoice" / manual invoices, and "adjustment" / inventory adjustments. Assembly orders are currently list-only. Only send project fields that should change. For bills, documents must be an array of {type,id} objects. Supported bill document types are InventoryOrder, Shipment, and AssemblyOrder. Mixed-type bill documents are automatically split into separate NeonPanel requests because the upstream API ignores mixed types in one request. Warning: details[] replaces existing line items when provided; payment_term_id may regenerate payment schedule server-side. Invoice updates only work for manual invoices. Use project_management_update_payment_request for payment request mutation.',
        isConsequential: true,
        inputSchema: updateProjectInputJsonSchema,
        outputSchema: passthroughOutputSchema,
      },
      examples: [
        {
          name: 'Update Inventory Order Memo-Free Fields',
          arguments: {
            project_type: 'inventory_order',
            company_id: 230,
            project_id: 42,
            project: {
              date_manufacturing_completed: '2026-06-15',
            },
          },
        },
        {
          name: 'Update Bill',
          arguments: {
            project_type: 'bill',
            company_id: 230,
            project_id: 17,
            project: {
              documents: [
                { type: 'InventoryOrder', id: 3690 },
                { type: 'Shipment', id: 812 },
              ],
            },
          },
        },
        {
          name: 'Update Adjustment Reason',
          arguments: {
            project_type: 'adjustment',
            company_id: 230,
            project_id: 17,
            project: {
              reason: 'Administrative Errors',
            },
          },
        },
      ],
      execute: async (args, context) => {
        const parsed = updateProjectInputSchema.parse(args);
        const companyUuid = await resolveCompanyUuid(parsed, context.userToken);
        const adapter = getProjectAdapter(parsed.project_type);
        const updatePath = requireProjectPath(adapter.updatePath, parsed.project_type, 'update');
        const getPath = requireProjectPath(adapter.getPath, parsed.project_type, 'get');

        if (parsed.project_type === 'bill') {
          const documentGroups = groupBillDocumentsByType((parsed.project as BillProjectPayload).documents);
          if (documentGroups.length > 1) {
            const { documents: _documents, ...baseProject } = parsed.project as BillProjectPayload & Record<string, unknown>;

            if (Object.keys(baseProject).length > 0) {
              await neonPanelRequest({
                token: context.userToken,
                path: updatePath(companyUuid, parsed.project_id),
                method: 'PUT',
                body: baseProject,
              });
            }

            for (const documents of documentGroups) {
              await neonPanelRequest({
                token: context.userToken,
                path: updatePath(companyUuid, parsed.project_id),
                method: 'PUT',
                body: { documents },
              });
            }

            return neonPanelRequest({
              token: context.userToken,
              path: getPath(companyUuid, parsed.project_id),
            });
          }
        }

        return neonPanelRequest({
          token: context.userToken,
          path: updatePath(companyUuid, parsed.project_id),
          method: 'PUT',
          body: parsed.project,
        });
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