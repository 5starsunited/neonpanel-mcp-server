import { z } from 'zod';
import { companyIdentifierSchema, hasCompanyIdentifier } from '../neonpanel-common';

const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD');

export const projectTypeSchema = z.enum(['inventory_order', 'bill']);

const companyScopedBaseSchema = z.object({
  ...companyIdentifierSchema,
});

export const listProjectsInputSchema = companyScopedBaseSchema.extend({
  project_type: projectTypeSchema.default('inventory_order').optional(),
  search: z.string().optional(),
  warehouses: z.array(z.coerce.number().int().min(1)).optional(),
  vendors: z.array(z.coerce.number().int().min(1)).optional(),
  start_date: isoDateSchema.optional(),
  end_date: isoDateSchema.optional(),
}).refine(hasCompanyIdentifier, { message: 'Provide company_id or companyUuid' });

export const getProjectInputSchema = companyScopedBaseSchema.extend({
  project_type: projectTypeSchema.default('inventory_order').optional(),
  project_id: z.coerce.number().int().min(1),
}).refine(hasCompanyIdentifier, { message: 'Provide company_id or companyUuid' });

export const inventoryOrderDetailInputSchema = z.object({
  inventory_id: z.coerce.number().int().min(1),
  quantity: z.coerce.number().int().min(1),
  price: z.coerce.number().min(0),
});

export const inventoryOrderPayloadSchema = z.object({
  name: z.string().nullable().optional(),
  ref_number: z.string().optional(),
  date_order_placed: isoDateSchema.nullable().optional(),
  date_manufacturing_completed: isoDateSchema.nullable().optional(),
  market: z.string().length(2).nullable().optional(),
  currency: z.string().length(3).nullable().optional(),
  vendor_id: z.coerce.number().int().min(1).nullable().optional(),
  warehouse_id: z.coerce.number().int().min(1).nullable().optional(),
  payment_term_id: z.coerce.number().int().min(1).nullable().optional(),
  details: z.array(inventoryOrderDetailInputSchema).optional(),
});

export const billDetailInputSchema = z.object({
  service: z.string().min(1),
  quantity: z.coerce.number().int().min(1),
  rate: z.coerce.number().min(0),
});

export const billPayloadSchema = z.object({
  name: z.string().nullable().optional(),
  ref_number: z.string().optional(),
  date: isoDateSchema.nullable().optional(),
  market: z.string().length(2).nullable().optional(),
  currency: z.string().length(3).nullable().optional(),
  vendor_id: z.coerce.number().int().min(1).nullable().optional(),
  payment_term_id: z.coerce.number().int().min(1).nullable().optional(),
  details: z.array(billDetailInputSchema).optional(),
});

const inventoryOrderCreateInputSchema = companyScopedBaseSchema.extend({
  project_type: z.literal('inventory_order').default('inventory_order').optional(),
  project: inventoryOrderPayloadSchema,
}).refine(hasCompanyIdentifier, { message: 'Provide company_id or companyUuid' });

const billCreateInputSchema = companyScopedBaseSchema.extend({
  project_type: z.literal('bill'),
  project: billPayloadSchema,
}).refine(hasCompanyIdentifier, { message: 'Provide company_id or companyUuid' });

export const createProjectInputSchema = z.union([
  billCreateInputSchema,
  inventoryOrderCreateInputSchema,
]);

const inventoryOrderUpdateInputSchema = companyScopedBaseSchema.extend({
  project_type: z.literal('inventory_order').default('inventory_order').optional(),
  project_id: z.coerce.number().int().min(1),
  project: inventoryOrderPayloadSchema,
}).refine(hasCompanyIdentifier, { message: 'Provide company_id or companyUuid' });

const billUpdateInputSchema = companyScopedBaseSchema.extend({
  project_type: z.literal('bill'),
  project_id: z.coerce.number().int().min(1),
  project: billPayloadSchema,
}).refine(hasCompanyIdentifier, { message: 'Provide company_id or companyUuid' });

export const updateProjectInputSchema = z.union([
  billUpdateInputSchema,
  inventoryOrderUpdateInputSchema,
]);

export const listPaymentRequestsInputSchema = companyScopedBaseSchema.extend({
  start_date: isoDateSchema.optional(),
  end_date: isoDateSchema.optional(),
}).refine(hasCompanyIdentifier, { message: 'Provide company_id or companyUuid' });

export const paymentRequestUpdatePayloadSchema = z.object({
  paid_amount: z.coerce.number().min(0).nullable().optional(),
  payment_date: isoDateSchema.nullable().optional(),
  transaction_number: z.string().max(255).nullable().optional(),
  memo: z.string().max(255).nullable().optional(),
}).refine((payload) => Object.keys(payload).length > 0, {
  message: 'Provide at least one payment request field to update',
});

export const updatePaymentRequestInputSchema = companyScopedBaseSchema.extend({
  payment_id: z.coerce.number().int().min(1),
  payment: paymentRequestUpdatePayloadSchema,
}).refine(hasCompanyIdentifier, { message: 'Provide company_id or companyUuid' });

export const recordPaymentInputSchema = companyScopedBaseSchema.extend({
  payment_id: z.coerce.number().int().min(1),
  paid_amount: z.coerce.number().min(0),
  payment_date: isoDateSchema,
  transaction_number: z.string().max(255).nullable().optional(),
  memo: z.string().max(255).nullable().optional(),
}).refine(hasCompanyIdentifier, { message: 'Provide company_id or companyUuid' });

export const listVendorsInputSchema = companyScopedBaseSchema.extend({
  search: z.string().optional(),
  per_page: z.coerce.number().int().min(1).max(500).optional(),
}).refine(hasCompanyIdentifier, { message: 'Provide company_id or companyUuid' });

export const listPaymentTermsInputSchema = z.object({});

export const passthroughOutputSchema = {
  type: 'object',
  additionalProperties: true,
};