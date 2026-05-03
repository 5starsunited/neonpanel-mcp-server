# Project Management Toolset Implementation Plan

## Goal

Create a new MCP toolset named `project_management` in the existing NeonPanel MCP server. This toolset will expose project-like NeonPanel records through a consistent set of MCP tools for listing, reading, creating, updating, and eventually deleting projects.

The first supported project types are Inventory Orders / Purchase Orders and Bills:

- `project_type: "inventory_order"`
- `project_type: "bill"`
- NeonPanel routes from `documents.yaml`
- Base URL: `https://my.neonpanel.com/api/v1`

Future project types can include:

- `invoice`
- Other NeonPanel project/document records as their endpoints become available

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
- `adapters.ts`: maps generic `project_type` operations to concrete NeonPanel REST endpoints.

If shared NeonPanel helpers are needed, extract them from `src/tools/neonpanel.ts` into a small shared module such as `src/tools/neonpanel-common.ts`.

## Initial Tools

### `project_management_list_projects`

List project records for a company.

Supported examples:

```json
{
  "project_type": "inventory_order",
  "company_id": 230,
  "search": "PO-2024",
  "warehouses": [3],
  "vendors": [7],
  "date": "2024-03-15"
}
```

Maps to:

```text
GET /api/v1/companies/{companyUuid}/inventory-orders
GET /api/v1/companies/{companyUuid}/bills
```

Behavior:

- Accept `company_id` or `companyUuid`.
- Resolve `company_id` to UUID using the existing company lookup pattern.
- Pass through supported filters: `search`, `warehouses` for inventory orders, `vendors`, `date`.
- Return the NeonPanel paginated response.
- Mark as non-consequential.

### `project_management_get_project`

Read one project in full.

Supported examples:

```json
{
  "project_type": "inventory_order",
  "company_id": 230,
  "project_id": 42
}
```

Maps to:

```text
GET /api/v1/companies/{companyUuid}/inventory-orders/{orderId}
GET /api/v1/companies/{companyUuid}/bills/{billId}
```

Behavior:

- Return full project details, including line items, vendor, and payment requests.
- Mark as non-consequential.

### `project_management_create_project`

Create a new project record.

Supported examples:

```json
{
  "project_type": "inventory_order",
  "company_id": 230,
  "project": {
    "name": "PO-2024-Spring",
    "ref_number": "REF-0042",
    "date_order_placed": "2024-03-15",
    "date_manufacturing_completed": "2024-05-01",
    "market": "US",
    "currency": "USD",
    "vendor_id": 7,
    "warehouse_id": 3,
    "payment_term_id": 2,
    "details": [
      {
        "inventory_id": 101,
        "quantity": 50,
        "price": 12.99
      }
    ]
  }
}
```

```json
{
  "project_type": "bill",
  "company_id": 230,
  "project": {
    "name": "Bill-2024-001",
    "ref_number": "REF-BILL-001",
    "date": "2024-03-15",
    "market": "US",
    "currency": "USD",
    "vendor_id": 7,
    "payment_term_id": 2,
    "details": [
      {
        "service": "Freight Forwarding",
        "quantity": 3,
        "rate": 250
      }
    ]
  }
}
```

Maps to:

```text
POST /api/v1/companies/{companyUuid}/inventory-orders
POST /api/v1/companies/{companyUuid}/bills
```

Behavior:

- Send `project` as the request body.
- Return the newly created project resource.
- Mark as consequential.

### `project_management_update_project`

Sparse-update an existing project record.

Supported examples:

```json
{
  "project_type": "inventory_order",
  "company_id": 230,
  "project_id": 42,
  "project": {
    "date_manufacturing_completed": "2026-06-15"
  }
}
```

```json
{
  "project_type": "bill",
  "company_id": 230,
  "project_id": 17,
  "project": {
    "date": "2026-05-03"
  }
}
```

Maps to:

```text
PUT /api/v1/companies/{companyUuid}/inventory-orders/{orderId}
PUT /api/v1/companies/{companyUuid}/bills/{billId}
```

Behavior:

- Send only fields the caller intends to update.
- Return the updated project resource.
- Mark as consequential.

Important safety notes:

- `details` replaces all existing line items when provided.
- `payment_term_id` can regenerate payment request installments when provided.
- Do not use this tool for payment request management once direct payment request endpoints are available.

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

Later additions can add `invoice` and other project/document types without changing the public tool names.

## Validation

Use Zod schemas for runtime validation and tool schema emission.

Common fields:

- `project_type`: enum, currently `inventory_order` or `bill`.
- `company_id` or `companyUuid`.
- `project_id`: positive integer for get/update.
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
    .register(/* project_management_list_projects */)
    .register(/* project_management_get_project */)
    .register(/* project_management_create_project */)
    .register(/* project_management_update_project */)
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
- `project_management_list_projects` maps filters to query params.
- `project_management_get_project` maps `project_id` to `{orderId}`.
- `project_management_create_project` sends the expected POST body.
- `project_management_update_project` sends the expected sparse PUT body.
- `project_management_list_payment_requests` maps `start_date` and `end_date` filters correctly.
- `project_management_update_payment_request` sends only payment fields.
- `project_management_record_payment` requires `paid_amount` and `payment_date` and sends optional memo/reference fields.
- Unsupported `project_type` fails with a clear validation error.
- Delete is not exposed for Inventory Orders or Bills until DELETE endpoints exist.

Manual smoke-test order:

1. Register tools and build the project.
2. Inspect `tools/list` to confirm schemas and consequential flags.
3. Run `project_management_list_projects` against a known company.
4. Run `project_management_get_project` for a known Inventory Order.
5. Run `project_management_list_payment_requests` for a known company/date range.
6. Only then test `project_management_update_project`, `project_management_update_payment_request`, or `project_management_record_payment` on a safe record.

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