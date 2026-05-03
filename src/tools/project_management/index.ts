import { neonPanelRequest } from '../../clients/neonpanel-api';
import type { ProjectType } from './adapters';
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
  recordPaymentInputSchema,
  updatePaymentRequestInputSchema,
  updateProjectInputSchema,
} from './schemas';

function getProjectAdapter(projectType: ProjectType | undefined) {
  return projectAdapters[projectType ?? 'inventory_order'];
}

export function registerProjectManagementTools(registry: ToolRegistry) {
  registry
    .register({
      name: 'project_management_list_projects',
      description: 'List NeonPanel project records for a company. Supports project_type="inventory_order" / Purchase Orders and project_type="bill" / Bills. Optional filters: search, warehouses for inventory orders, vendors, and date. Use company_id when available; companyUuid is also accepted.',
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
      description: 'Get one NeonPanel project record by ID. Supports project_type="inventory_order" / Purchase Orders and project_type="bill" / Bills. Returns full project details including line items, vendor, and payment request data when present.',
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
      description: 'Create a NeonPanel project record. Supports project_type="inventory_order" / Purchase Orders and project_type="bill" / Bills. Inventory order details use inventory_id, quantity, price. Bill details use service, quantity, rate. Payment request mutation is handled by direct payment request tools.',
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
              details: [{ service: 'Freight Forwarding', quantity: 3, rate: 250 }],
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
      description: 'Sparse-update a NeonPanel project record. Supports project_type="inventory_order" / Purchase Orders and project_type="bill" / Bills. Only send project fields that should change. Warning: details[] replaces existing line items when provided; payment_term_id may regenerate payment schedule server-side. Use project_management_update_payment_request for payment request mutation.',
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
        {
          name: 'Update Bill',
          arguments: {
            project_type: 'bill',
            company_id: 230,
            project_id: 17,
            project: {
              date: '2026-05-03',
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