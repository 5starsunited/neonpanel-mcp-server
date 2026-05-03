import { neonPanelRequest } from '../../clients/neonpanel-api';
import type { ToolRegistry } from '../types';
import { resolveCompanyUuid } from '../neonpanel-common';
import { projectAdapters } from './adapters';
import {
  createProjectInputSchema,
  getProjectInputSchema,
  listPaymentRequestsInputSchema,
  listPaymentTermsInputSchema,
  listProjectsInputSchema,
  listVendorsInputSchema,
  passthroughOutputSchema,
  updateProjectInputSchema,
} from './schemas';

function getProjectAdapter(projectType: 'inventory_order' | undefined) {
  return projectAdapters[projectType ?? 'inventory_order'];
}

export function registerProjectManagementTools(registry: ToolRegistry) {
  registry
    .register({
      name: 'project_management_list_projects',
      description: 'List NeonPanel project records for a company. Initial support is project_type="inventory_order" / Purchase Orders (NeonPanel: GET /api/v1/companies/{uuid}/inventory-orders). Optional filters: search, warehouses, vendors, date. Use company_id when available; companyUuid is also accepted.',
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
            date: parsed.date,
          },
        });
      },
    })
    .register({
      name: 'project_management_get_project',
      description: 'Get one NeonPanel project record by ID. Initial support is project_type="inventory_order" / Purchase Orders (NeonPanel: GET /api/v1/companies/{uuid}/inventory-orders/{orderId}). Returns full project details including line items, vendor, warehouse, and payment request data when present.',
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
      ],
      execute: async (args, context) => {
        const parsed = getProjectInputSchema.parse(args);
        const companyUuid = await resolveCompanyUuid(parsed, context.userToken);
        const adapter = getProjectAdapter(parsed.project_type);
        return neonPanelRequest({
          token: context.userToken,
          path: adapter.getPath(companyUuid, parsed.project_id),
        });
      },
    })
    .register({
      name: 'project_management_create_project',
      description: 'Create a NeonPanel project record. Initial support is project_type="inventory_order" / Purchase Orders (NeonPanel: POST /api/v1/companies/{uuid}/inventory-orders). Supply project fields such as ref_number, dates, market, currency, vendor_id, warehouse_id, payment_term_id, and details[]. Payment request mutation is handled by direct payment request tools as those endpoints are delivered.',
      isConsequential: true,
      inputSchema: createProjectInputSchema,
      outputSchema: passthroughOutputSchema,
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
      ],
      execute: async (args, context) => {
        const parsed = createProjectInputSchema.parse(args);
        const companyUuid = await resolveCompanyUuid(parsed, context.userToken);
        const adapter = getProjectAdapter(parsed.project_type);
        return neonPanelRequest({
          token: context.userToken,
          path: adapter.createPath(companyUuid),
          method: 'POST',
          body: parsed.project,
        });
      },
    })
    .register({
      name: 'project_management_update_project',
      description: 'Sparse-update a NeonPanel project record. Initial support is project_type="inventory_order" / Purchase Orders (NeonPanel: PUT /api/v1/companies/{uuid}/inventory-orders/{orderId}). Only send project fields that should change. Warning: details[] replaces existing line items when provided; payment_term_id may regenerate payment schedule server-side. Do not use this tool for payment request mutation once direct payment request endpoints are available.',
      isConsequential: true,
      inputSchema: updateProjectInputSchema,
      outputSchema: passthroughOutputSchema,
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
      ],
      execute: async (args, context) => {
        const parsed = updateProjectInputSchema.parse(args);
        const companyUuid = await resolveCompanyUuid(parsed, context.userToken);
        const adapter = getProjectAdapter(parsed.project_type);
        return neonPanelRequest({
          token: context.userToken,
          path: adapter.updatePath(companyUuid, parsed.project_id),
          method: 'PUT',
          body: parsed.project,
        });
      },
    })
    .register({
      name: 'project_management_list_payment_requests',
      description: 'List payment request installments for a company across document types such as Inventory Orders and Bills (NeonPanel: GET /api/v1/companies/{uuid}/payment-requests). Supports due-date range filters start_date and end_date. This is read-only; direct mutation tools will be added when payment request update endpoints are delivered.',
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