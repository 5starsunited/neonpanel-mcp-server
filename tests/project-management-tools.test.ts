import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ToolRegistry } from '../src/tools/types';
import { registerProjectManagementTools } from '../src/tools/project_management';
import {
  createProjectInputSchema,
  recordPaymentInputSchema,
  updatePaymentRequestInputSchema,
  updateProjectInputSchema,
} from '../src/tools/project_management/schemas';

test('project management registers bill and payment write tools', () => {
  const registry = new ToolRegistry();
  registerProjectManagementTools(registry);

  const tools = registry.list();
  const byName = new Map(tools.map((tool) => [tool.name, tool]));

  assert.ok(byName.has('project_management_create_project'));
  assert.ok(byName.has('project_management_update_payment_request'));
  assert.ok(byName.has('project_management_record_payment'));
  assert.ok(byName.has('project_management_list_invoices'));
  assert.ok(byName.has('project_management_list_shipments'));
  assert.equal(byName.get('project_management_update_payment_request')?.isConsequential, true);
  assert.equal(byName.get('project_management_record_payment')?.isConsequential, true);
  assert.equal(byName.get('project_management_list_invoices')?.isConsequential, false);
  assert.equal(byName.get('project_management_list_shipments')?.isConsequential, false);
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
  const parsed = createProjectInputSchema.parse({
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
  });

  assert.equal(parsed.project_type, 'bill');
  assert.deepEqual(parsed.project.documents, [{ type: 'InventoryOrder', id: 3690 }]);
  assert.equal(parsed.project.details?.[0]?.service_id, 55);
});

test('project management advertises bill documents as an array of typed references', () => {
  const registry = new ToolRegistry();
  registerProjectManagementTools(registry);

  const tool = registry.list().find((entry) => entry.name === 'project_management_update_project');
  assert.ok(tool);

  const projectSchema = tool.inputSchema.properties?.project as any;
  const billSchema = projectSchema.oneOf[1];
  const documentsSchema = billSchema.properties.documents;

  assert.deepEqual(documentsSchema.type, ['array', 'null']);
  assert.deepEqual(documentsSchema.items.properties.type.enum, ['InventoryOrder', 'AssemblyOrder', 'Shipment']);
  assert.match(documentsSchema.description, /not a JSON string/);
});

test('project management accepts mixed bill document types for update', () => {
  const parsed = updateProjectInputSchema.parse({
    project_type: 'bill',
    company_id: 230,
    project_id: 8178,
    project: {
      documents: [
        { type: 'InventoryOrder', id: 3690 },
        { type: 'Shipment', id: 812 },
      ],
    },
  });

  assert.equal(parsed.project_type, 'bill');
  assert.deepEqual(parsed.project.documents, [
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