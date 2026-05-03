import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ToolRegistry } from '../src/tools/types';
import { registerProjectManagementTools } from '../src/tools/project_management';
import {
  createProjectInputSchema,
  recordPaymentInputSchema,
  updatePaymentRequestInputSchema,
} from '../src/tools/project_management/schemas';

test('project management registers bill and payment write tools', () => {
  const registry = new ToolRegistry();
  registerProjectManagementTools(registry);

  const tools = registry.list();
  const byName = new Map(tools.map((tool) => [tool.name, tool]));

  assert.ok(byName.has('project_management_create_project'));
  assert.ok(byName.has('project_management_update_payment_request'));
  assert.ok(byName.has('project_management_record_payment'));
  assert.equal(byName.get('project_management_update_payment_request')?.isConsequential, true);
  assert.equal(byName.get('project_management_record_payment')?.isConsequential, true);
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
      details: [{ service: 'Freight Forwarding', quantity: 3, rate: 250 }],
    },
  });

  assert.equal(parsed.project_type, 'bill');
  assert.equal(parsed.project.details?.[0]?.service, 'Freight Forwarding');
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