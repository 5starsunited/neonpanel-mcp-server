# Project Management Toolset Implementation Plan

## Goal

Create a new MCP toolset named `project_management` in the existing NeonPanel MCP server. This toolset exposes NeonPanel project-like document records through type-specific MCP tools for listing, reading, creating, updating, and eventually deleting records.

Supported document types:

- Inventory Orders / Purchase Orders
- Bills
- Manual invoices
- Inventory adjustments
- Assembly orders, list-only
- NeonPanel routes from `documents.yaml`
- Base URL: `https://my.neonpanel.com/api/v1`

This is not a separate MCP server. The new module registers tools into the same existing `ToolRegistry`, so clients continue using the same MCP endpoint, auth flow, `tools/list`, and `tools/call`.

## Folder Layout

Planned source layout:

```text
src/tools/project_management/
  IMPLEMENTATION_PLAN.md
  index.ts
  schemas.ts
  adapters.ts
```

Recommended responsibilities:

- `index.ts`: registers the MCP tools with the shared `ToolRegistry`.
- `schemas.ts`: contains Zod input schemas for project-management tools, Inventory Order payloads, Bill payloads, and payment request updates.
- `adapters.ts`: maps document-type operations to concrete NeonPanel REST endpoints.

If shared NeonPanel helpers are needed, extract them from `src/tools/neonpanel.ts` into a small shared module such as `src/tools/neonpanel-common.ts`.

## Project Document Tools

The MCP surface is intentionally separated by NeonPanel document type so AI clients can choose a precise tool with a precise schema.

Inventory Orders / Purchase Orders:

- `project_management_list_inventory_orders` -> `GET /api/v1/companies/{companyUuid}/inventory-orders`
- `project_management_get_inventory_order` -> `GET /api/v1/companies/{companyUuid}/inventory-orders/{orderId}`
- `project_management_create_inventory_order` -> `POST /api/v1/companies/{companyUuid}/inventory-orders`
- `project_management_update_inventory_order` -> `PUT /api/v1/companies/{companyUuid}/inventory-orders/{orderId}`

Bills:

- `project_management_list_bills` -> `GET /api/v1/companies/{companyUuid}/bills`
- `project_management_get_bill` -> `GET /api/v1/companies/{companyUuid}/bills/{billId}`
- `project_management_create_bill` -> `POST /api/v1/companies/{companyUuid}/bills`
- `project_management_update_bill` -> `PUT /api/v1/companies/{companyUuid}/bills/{billId}`

Manual invoices:

- `project_management_list_invoices` -> `GET /api/v1/companies/{companyUuid}/invoices`
- `project_management_get_invoice` -> `GET /api/v1/companies/{companyUuid}/invoices/{invoiceId}`
- `project_management_create_invoice` -> `POST /api/v1/companies/{companyUuid}/invoices`
- `project_management_update_invoice` -> `PUT /api/v1/companies/{companyUuid}/invoices/{invoiceId}`

Inventory adjustments:

- `project_management_list_adjustments` -> `GET /api/v1/companies/{companyUuid}/adjustments`
- `project_management_get_adjustment` -> `GET /api/v1/companies/{companyUuid}/adjustments/{adjustmentId}`
- `project_management_create_adjustment` -> `POST /api/v1/companies/{companyUuid}/adjustments`
- `project_management_update_adjustment` -> `PUT /api/v1/companies/{companyUuid}/adjustments/{adjustmentId}`

Assembly orders:

- `project_management_list_assembly_orders` -> `GET /api/v1/companies/{companyUuid}/assembly-orders`

Behavior:

- Accept `company_id` or `companyUuid`.
- Resolve `company_id` to UUID using the shared company lookup helper.
- List tools pass through supported filters such as `search`, `warehouses`, `vendors`, `start_date`, and `end_date` where relevant.
- Create and update tools accept type-specific fields directly at the top level, without a generic `project_type` or `project` wrapper.
- Create and update tools are consequential.
- `details` replaces all existing line items when provided on update.
- `payment_term_id` can regenerate payment request installments when provided.
- Bill `documents` must be an array of `{type,id}` references; mixed document types are split into multiple NeonPanel requests by the MCP tool.

## Payment Request Management Tools

Payment requests are managed as first-class project-management resources through direct endpoints.

The live documents schema now confirms these endpoints:

```text
GET /api/v1/companies/{companyUuid}/payment-requests
PUT /api/v1/companies/{companyUuid}/payment-requests/{paymentRequestId}
```

Other direct endpoints remain future additions until they appear in the documents schema:

```text
GET /api/v1/companies/{companyUuid}/payment-requests/{paymentRequestId}
POST /api/v1/companies/{companyUuid}/payment-requests
DELETE /api/v1/companies/{companyUuid}/payment-requests/{paymentRequestId}
```

Use direct payment-request endpoints for payment request management. Do not spend implementation effort on nested `payment_requests` updates through Inventory Orders or Bills when the direct endpoints are being delivered.

### `project_management_list_payment_requests`

List payment request installments for a company across supported document types.

Initial support:

```json
{
  "company_id": 230,
  "start_date": "2026-05-01",
  "end_date": "2026-05-31"
}
```

Maps to:

```text
GET /api/v1/companies/{companyUuid}/payment-requests
```

Behavior:

- Accept `company_id` or `companyUuid`.
- Resolve `company_id` to UUID using the existing company lookup pattern.
- Pass through supported filters: `start_date`, `end_date`.
- Return paginated `PaymentRequestListResponse`.
- Each item includes payment request fields and nested `document` context.
- Mark as non-consequential.

Known response fields:

- `amount_due`
- `paid_amount`
- `due_date`
- `payment_date`
- `currency`
- `description`
- `classification`
- `transaction_number`
- `memo`
- `document.id`
- `document.type`
- `document.link`
- `document.status`
- `document.completed`
- `document.ref_number`
- `document.date`

Implementation note:

- The list response includes a stable payment request `id`, used by `project_management_update_payment_request`.

### `project_management_get_payment_request`

Read one payment request by stable ID.

Planned support:

```json
{
  "company_id": 230,
  "payment_request_id": 12345
}
```

Expected mapping:

```text
GET /api/v1/companies/{companyUuid}/payment-requests/{paymentRequestId}
```

Behavior:

- Return one payment request with parent document context.
- Mark as non-consequential.
- Implement only after the endpoint appears in the documents schema or is confirmed with request/response examples.

### `project_management_update_payment_request`

Update payment request fields by stable ID.

Supported:

```json
{
  "company_id": 230,
  "payment_id": 12345,
  "payment": {
    "paid_amount": 500,
    "payment_date": "2026-05-03",
    "transaction_number": "WIRE-12345",
    "memo": "First installment paid"
  }
}
```

Mapping:

```text
PUT /api/v1/companies/{companyUuid}/payment-requests/{paymentRequestId}
```

Behavior:

- Send only fields the caller intends to update.
- Return the updated payment request resource.
- Mark as consequential.
- The API uses `PUT` with sparse-update semantics.

Allowed update fields should match `PaymentRequestInput`:

- `paid_amount`
- `payment_date`
- `transaction_number`
- `memo`

### `project_management_record_payment`

Convenience wrapper for marking a payment installment as paid.

Supported:

```json
{
  "company_id": 230,
  "payment_id": 12345,
  "paid_amount": 500,
  "payment_date": "2026-05-03",
  "transaction_number": "WIRE-12345",
  "memo": "First installment paid"
}
```

Mapping:

```text
PUT /api/v1/companies/{companyUuid}/payment-requests/{paymentRequestId}
```

Behavior:

- A narrower, safer wrapper over `project_management_update_payment_request`.
- Validate `paid_amount` and `payment_date` are present.
- Mark as consequential.
- Uses the same direct update endpoint as `project_management_update_payment_request`.

### `project_management_create_payment_request`

Create a new payment request installment.

Planned only if API supports direct creation:

```text
POST /api/v1/companies/{companyUuid}/payment-requests
```

Open API questions before implementation:

- How does the new payment request attach to a parent document?
- Does the payload use `document_type` and `document_id`, or another reference?
- Which fields are required beyond amount and due date?
- Can the API create payment requests independently of `payment_term_id` generation?

Do not implement until the request schema is confirmed.

### `project_management_delete_payment_request`

Delete a payment request installment.

Planned only if API supports deletion:

```text
DELETE /api/v1/companies/{companyUuid}/payment-requests/{paymentRequestId}
```

Behavior:

- Mark as consequential and destructive.
- Implement only when the API documents delete behavior and response shape.
- Clarify whether deleting generated installments is allowed or only manually created requests can be deleted.

### Delete Support

Do not implement `project_management_delete_project` for Inventory Orders yet.

The current `documents.yaml` excerpt defines `GET` and `PUT` for `/companies/{companyUuid}/inventory-orders/{orderId}`, but it does not define `DELETE`.

Options when delete endpoints exist:

- Register `project_management_delete_project` only after at least one project type supports deletion.
- Or register it with an adapter capability check and return a clear `unsupported_project_operation` error for unsupported types.

The safer first version is to omit delete until the API supports it.

## Shared Company Resolution

Project-management tools should accept the same company identifiers as other MCP tools:

- `company_id`: numeric ID, preferred for consistency with Athena tools.
- `companyUuid`: UUID accepted by NeonPanel REST endpoints.

Implementation options:

1. Extract the existing resolver from `src/tools/neonpanel.ts` into `src/tools/neonpanel-common.ts`.
2. Reuse it from both `neonpanel.ts` and `project_management/index.ts`.

The shared helper should expose:

- `companyIdentifierSchema`
- `resolveCompanyUuid(opts, token)`

## Adapter Model

Use an internal adapter map so generic tool names can support more project types over time.

Initial shape:

```ts
const projectAdapters = {
  inventory_order: {
    listPath: (companyUuid) => `/api/v1/companies/${companyUuid}/inventory-orders`,
    getPath: (companyUuid, projectId) => `/api/v1/companies/${companyUuid}/inventory-orders/${projectId}`,
    createPath: (companyUuid) => `/api/v1/companies/${companyUuid}/inventory-orders`,
    updatePath: (companyUuid, projectId) => `/api/v1/companies/${companyUuid}/inventory-orders/${projectId}`,
    supportsDelete: false,
  },
  bill: {
    listPath: (companyUuid) => `/api/v1/companies/${companyUuid}/bills`,
    getPath: (companyUuid, projectId) => `/api/v1/companies/${companyUuid}/bills/${projectId}`,
    createPath: (companyUuid) => `/api/v1/companies/${companyUuid}/bills`,
    updatePath: (companyUuid, projectId) => `/api/v1/companies/${companyUuid}/bills/${projectId}`,
    supportsDelete: false,
  },
};
```

Later additions should add type-specific public tool names when the NeonPanel document type has a distinct endpoint and payload shape.

## Validation

Use Zod schemas for runtime validation and tool schema emission.

Common fields:

- `company_id` or `companyUuid`.
- Type-specific document ID for get/update, such as `inventory_order_id`, `bill_id`, `invoice_id`, or `adjustment_id`.
- `payment_id`: positive integer for direct payment request update.

Inventory Order payload fields:

- `name`
- `ref_number`
- `date_order_placed`
- `date_manufacturing_completed`
- `market`
- `currency`
- `vendor_id`
- `warehouse_id`
- `payment_term_id`
- `details`


Inventory Order line item fields:

- `inventory_id`
- `quantity`
- `price`

Payment request fields:

- `paid_amount`
- `payment_date`
- `transaction_number`
- `memo`

Bill payload fields:

- `name`
- `ref_number`
- `date`
- `market`
- `currency`
- `vendor_id`
- `payment_term_id`
- `details`

Bill line item fields:

- `service`
- `quantity`
- `rate`

Payment request list filters:

- `start_date`
- `end_date`

## Registration

Add a function:

```ts
export function registerProjectManagementTools(registry: ToolRegistry) {
  registry
    .register(/* project_management_list_inventory_orders */)
    .register(/* project_management_get_inventory_order */)
    .register(/* project_management_create_inventory_order */)
    .register(/* project_management_update_inventory_order */)
    .register(/* project_management_list_bills */)
    .register(/* project_management_get_bill */)
    .register(/* project_management_create_bill */)
    .register(/* project_management_update_bill */)
    .register(/* project_management_list_invoices */)
    .register(/* project_management_get_invoice */)
    .register(/* project_management_create_invoice */)
    .register(/* project_management_update_invoice */)
    .register(/* project_management_list_adjustments */)
    .register(/* project_management_get_adjustment */)
    .register(/* project_management_create_adjustment */)
    .register(/* project_management_update_adjustment */)
    .register(/* project_management_list_assembly_orders */)
    .register(/* project_management_list_payment_requests */)
    .register(/* project_management_update_payment_request */)
    .register(/* project_management_list_vendors */)
    .register(/* project_management_list_payment_terms */)
    .register(/* project_management_get_payment_request */)
    .register(/* project_management_record_payment */);
}
```

Register `project_management_get_payment_request` only after a direct read endpoint is confirmed. `project_management_list_payment_requests`, `project_management_update_payment_request`, and `project_management_record_payment` are available now from the live documents schema.

Then wire it into the existing server tool registration flow next to the existing NeonPanel and Athena tool registrations.

Clients will continue using the same MCP server and will see the new tools in `tools/list`.

## Testing Plan

Add focused tests for:

- Tool registration exposes all initial project-management tools.
- Type-specific list tools map filters to query params.
- Type-specific get tools map document IDs to concrete NeonPanel endpoints.
- Type-specific create tools send the expected POST body.
- Type-specific update tools send the expected sparse PUT body.
- `project_management_list_payment_requests` maps `start_date` and `end_date` filters correctly.
- `project_management_update_payment_request` sends only payment fields.
- `project_management_record_payment` requires `paid_amount` and `payment_date` and sends optional memo/reference fields.
- Delete is not exposed for Inventory Orders or Bills until DELETE endpoints exist.

Manual smoke-test order:

1. Register tools and build the project.
2. Inspect `tools/list` to confirm schemas and consequential flags.
3. Run `project_management_list_inventory_orders` against a known company.
4. Run `project_management_get_inventory_order` for a known Inventory Order.
5. Run `project_management_list_payment_requests` for a known company/date range.
6. Only then test type-specific update tools, `project_management_update_payment_request`, or `project_management_record_payment` on a safe record.

## Rollout Sequence

1. Create `src/tools/project_management/index.ts`, `schemas.ts`, and `adapters.ts`.
2. Extract or share company UUID resolution.
3. Implement list and get first.
4. Add create and update with consequential flags.
5. Implement `project_management_list_payment_requests` from the confirmed endpoint.
6. Add `project_management_update_payment_request` from the confirmed direct update endpoint.
7. Add `project_management_record_payment` convenience wrapper over the direct update endpoint.
8. Add `bill` support as the next adapter from `documents.yaml`.
9. Add tests.
10. Build and inspect `tools/list`.
11. Smoke test read-only tools.
12. Smoke test write tools on safe records.
13. Add delete only after supported API endpoints exist.