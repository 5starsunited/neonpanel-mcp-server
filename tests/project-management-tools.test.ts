import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ToolRegistry } from '../src/tools/types';
import { registerProjectManagementTools } from '../src/tools/project_management';
import {
  createBillInputSchema,
  createInvoiceInputSchema,
  createShipmentInputSchema,
  listAssemblyOrdersInputSchema,
  recordPaymentInputSchema,
  updateAdjustmentInputSchema,
  updateBillInputSchema,
  updatePaymentRequestInputSchema,
  updateShipmentInputSchema,
} from '../src/tools/project_management/schemas';

test('project management registers separated project and payment write tools', () => {
  const registry = new ToolRegistry();
  registerProjectManagementTools(registry);

  const tools = registry.list();
  const byName = new Map(tools.map((tool) => [tool.name, tool]));

  assert.ok(byName.has('project_management_list_inventory_orders'));
  assert.ok(byName.has('project_management_create_inventory_order'));
  assert.ok(byName.has('project_management_create_bill'));
  assert.ok(byName.has('project_management_create_invoice'));
  assert.ok(byName.has('project_management_create_adjustment'));
  assert.ok(byName.has('project_management_create_shipment'));
  assert.ok(byName.has('project_management_update_bill'));
  assert.ok(byName.has('project_management_get_shipment'));
  assert.ok(byName.has('project_management_update_shipment'));
  assert.ok(byName.has('project_management_list_assembly_orders'));
  assert.equal(byName.has('project_management_create_project'), false);
  assert.equal(byName.has('project_management_list_projects'), false);
  assert.ok(byName.has('project_management_update_payment_request'));
  assert.ok(byName.has('project_management_record_payment'));
  assert.ok(byName.has('project_management_list_invoices'));
  assert.ok(byName.has('project_management_list_shipments'));
  assert.match(byName.get('project_management_list_assembly_orders')?.description ?? '', /List NeonPanel assembly orders/);
  assert.equal(byName.get('project_management_create_bill')?.isConsequential, true);
  assert.equal(byName.get('project_management_create_shipment')?.isConsequential, true);
  assert.equal(byName.get('project_management_update_shipment')?.isConsequential, true);
  assert.equal(byName.get('project_management_update_payment_request')?.isConsequential, true);
  assert.equal(byName.get('project_management_record_payment')?.isConsequential, true);
  assert.equal(byName.get('project_management_list_invoices')?.isConsequential, false);
  assert.equal(byName.get('project_management_list_shipments')?.isConsequential, false);
});

test('project management accepts shipment project payloads', () => {
  const created = createShipmentInputSchema.parse({
    company_id: 230,
    ref_number: 'REF-SHP-001',
    date_shipment_sent: '2026-05-03',
    date_shipment_arrived: '2026-05-10',
    origin_market: 'US',
    destination_market: 'CA',
    origin_warehouse_id: 2,
    destination_warehouse_id: 5,
    shipment_method: 'SPD',
    items: [{ origin_inventory_id: 101, quantity_shipped: 50, quantity_received: 48 }],
  });

  assert.equal(created.shipment_method, 'SPD');
  assert.equal(created.items?.[0]?.quantity_received, 48);

  const updated = updateShipmentInputSchema.parse({
    company_id: 230,
    shipment_id: 11,
    tracking_number: '1Z999AA10123456784',
  });

  assert.equal(updated.shipment_id, 11);
  assert.equal(updated.tracking_number, '1Z999AA10123456784');
});

test('project management exposes shipment item schema in tool spec', () => {
  const registry = new ToolRegistry();
  registerProjectManagementTools(registry);

  const tool = registry.list().find((entry) => entry.name === 'project_management_create_shipment');
  assert.ok(tool);

  const itemsSchema = (tool.inputSchema.properties?.items as any);

  assert.deepEqual(itemsSchema.type, ['array', 'null']);
  assert.equal(itemsSchema.items.properties.origin_inventory_id.type, 'integer');
  assert.deepEqual(itemsSchema.items.required, ['origin_inventory_id', 'quantity_shipped', 'quantity_received']);
});

test('project management invoice list tool exposes documented filters', () => {
  const registry = new ToolRegistry();
  registerProjectManagementTools(registry);

  const tool = registry.list().find((entry) => entry.name === 'project_management_list_invoices');
  assert.ok(tool);

  assert.equal(tool.inputSchema.properties?.search?.type, 'string');
  assert.equal(tool.inputSchema.properties?.start_date?.type, 'string');
  assert.equal(tool.inputSchema.properties?.end_date?.$ref, '#/definitions/project_management_list_invoicesInput/properties/start_date');
  assert.match(tool.description, /transaction date range/);
});

test('project management accepts bill project payloads', () => {
  const parsed = createBillInputSchema.parse({
    company_id: 230,
    ref_number: 'REF-BILL-001',
    date: '2026-05-03',
    market: 'US',
    currency: 'USD',
    vendor_id: 7,
    payment_term_id: 2,
    documents: [{ type: 'InventoryOrder', id: 3690 }],
    details: [{ service_id: 55, quantity: 3, rate: 250 }],
  });

  assert.deepEqual(parsed.documents, [{ type: 'InventoryOrder', id: 3690 }]);
  assert.equal(parsed.details?.[0]?.service_id, 55);
});

test('project management accepts invoice and adjustment project payloads', () => {
  const invoice = createInvoiceInputSchema.parse({
    company_id: 230,
    ref_number: 'REF-INV-001',
    date: '2026-05-03',
    market: 'US',
    currency: 'USD',
    warehouse_id: 3,
    customer_id: 7,
    sales_channel_id: 2,
    details: [{ inventory_id: 101, service_id: 55, quantity: -1, amount: -25 }],
  });

  assert.equal(invoice.details?.[0]?.quantity, -1);

  const adjustment = updateAdjustmentInputSchema.parse({
    company_id: 230,
    adjustment_id: 88,
    reason: 'Damaged',
    details: [{ inventory_id: 101, service_id: 55, quantity: -10, rate: 25 }],
  });

  assert.equal(adjustment.adjustment_id, 88);
  assert.equal(adjustment.details?.[0]?.rate, 25);
});

test('project management exposes assembly orders as full CRUD tools', () => {
  const parsed = listAssemblyOrdersInputSchema.parse({
    company_id: 230,
  });

  assert.equal(parsed.company_id, 230);

  const registry = new ToolRegistry();
  registerProjectManagementTools(registry);
  const byName = new Map(registry.list().map((tool) => [tool.name, tool]));
  assert.ok(byName.has('project_management_list_assembly_orders'));
  assert.ok(byName.has('project_management_get_assembly_order'));
  assert.ok(byName.has('project_management_create_assembly_order'));
  assert.ok(byName.has('project_management_update_assembly_order'));
  assert.equal(byName.get('project_management_list_assembly_orders')?.isConsequential, false);
  assert.equal(byName.get('project_management_get_assembly_order')?.isConsequential, false);
  assert.equal(byName.get('project_management_create_assembly_order')?.isConsequential, true);
  assert.equal(byName.get('project_management_update_assembly_order')?.isConsequential, true);
});

test('project management advertises bill documents as an array of typed references', () => {
  const registry = new ToolRegistry();
  registerProjectManagementTools(registry);

  const tool = registry.list().find((entry) => entry.name === 'project_management_update_bill');
  assert.ok(tool);

  const documentsSchema = (tool.inputSchema.properties?.documents as any);

  assert.deepEqual(documentsSchema.type, ['array', 'null']);
  assert.deepEqual(documentsSchema.items.properties.type.enum, ['InventoryOrder', 'AssemblyOrder', 'Shipment', 'Invoice']);
  assert.match(documentsSchema.description, /not a JSON string/);
});

test('project management accepts mixed bill document types for update', () => {
  const parsed = updateBillInputSchema.parse({
    company_id: 230,
    bill_id: 8178,
    documents: [
      { type: 'InventoryOrder', id: 3690 },
      { type: 'Shipment', id: 812 },
    ],
  });

  assert.equal(parsed.bill_id, 8178);
  assert.deepEqual(parsed.documents, [
    { type: 'InventoryOrder', id: 3690 },
    { type: 'Shipment', id: 812 },
  ]);
});

test('project management validates direct payment update payloads', () => {
  const parsed = updatePaymentRequestInputSchema.parse({
    company_id: 230,
    payment_id: 9,
    payment: {
      paid_amount: 500,
      payment_date: '2026-05-03',
      transaction_number: 'TXN-9988776',
      memo: 'Wire transfer - first installment',
    },
  });

  assert.equal(parsed.payment_id, 9);
  assert.equal(parsed.payment.payment_date, '2026-05-03');
});

test('project management record payment requires paid amount and payment date', () => {
  assert.throws(() => {
    recordPaymentInputSchema.parse({
      company_id: 230,
      payment_id: 9,
      paid_amount: 500,
    });
  });

  const parsed = recordPaymentInputSchema.parse({
    company_id: 230,
    payment_id: 9,
    paid_amount: 500,
    payment_date: '2026-05-03',
  });

  assert.equal(parsed.paid_amount, 500);
  assert.equal(parsed.payment_date, '2026-05-03');
});