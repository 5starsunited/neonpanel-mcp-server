import { z } from 'zod';
import { companyIdentifierSchema, hasCompanyIdentifier } from '../neonpanel-common';

const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD');

export const projectTypeSchema = z.enum(['inventory_order', 'bill', 'invoice', 'adjustment', 'shipment', 'assembly_order']);

const companyScopedBaseSchema = z.object({
  ...companyIdentifierSchema,
});

export const listInventoryOrdersInputSchema = companyScopedBaseSchema.extend({
  search: z.string().optional(),
  warehouses: z.array(z.coerce.number().int().min(1)).optional(),
  vendors: z.array(z.coerce.number().int().min(1)).optional(),
  start_date: isoDateSchema.optional(),
  end_date: isoDateSchema.optional(),
}).refine(hasCompanyIdentifier, { message: 'Provide company_id or companyUuid' });

export const listBillsInputSchema = companyScopedBaseSchema.extend({
  search: z.string().optional(),
  vendors: z.array(z.coerce.number().int().min(1)).optional(),
  start_date: isoDateSchema.optional(),
  end_date: isoDateSchema.optional(),
}).refine(hasCompanyIdentifier, { message: 'Provide company_id or companyUuid' });

export const listAdjustmentsInputSchema = companyScopedBaseSchema.extend({
  search: z.string().optional(),
  warehouses: z.array(z.coerce.number().int().min(1)).optional(),
  start_date: isoDateSchema.optional(),
  end_date: isoDateSchema.optional(),
}).refine(hasCompanyIdentifier, { message: 'Provide company_id or companyUuid' });

export const listAssemblyOrdersInputSchema = companyScopedBaseSchema.extend({
  search: z.string().optional(),
  warehouses: z.array(z.coerce.number().int().min(1)).optional(),
  start_date: isoDateSchema.optional(),
  end_date: isoDateSchema.optional(),
}).refine(hasCompanyIdentifier, { message: 'Provide company_id or companyUuid' });

export const getInventoryOrderInputSchema = companyScopedBaseSchema.extend({
  inventory_order_id: z.coerce.number().int().min(1),
}).refine(hasCompanyIdentifier, { message: 'Provide company_id or companyUuid' });

export const getBillInputSchema = companyScopedBaseSchema.extend({
  bill_id: z.coerce.number().int().min(1),
}).refine(hasCompanyIdentifier, { message: 'Provide company_id or companyUuid' });

export const getInvoiceInputSchema = companyScopedBaseSchema.extend({
  invoice_id: z.coerce.number().int().min(1),
}).refine(hasCompanyIdentifier, { message: 'Provide company_id or companyUuid' });

export const getAdjustmentInputSchema = companyScopedBaseSchema.extend({
  adjustment_id: z.coerce.number().int().min(1),
}).refine(hasCompanyIdentifier, { message: 'Provide company_id or companyUuid' });

export const getShipmentInputSchema = companyScopedBaseSchema.extend({
  shipment_id: z.coerce.number().int().min(1),
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
  service_id: z.coerce.number().int().min(1),
  quantity: z.coerce.number().int().min(1),
  rate: z.coerce.number().min(0),
});

export const billDocumentInputSchema = z.object({
  type: z.enum(['InventoryOrder', 'AssemblyOrder', 'Shipment']),
  id: z.coerce.number().int().min(1),
});

export const billPayloadSchema = z.object({
  name: z.string().nullable().optional(),
  ref_number: z.string().optional(),
  date: isoDateSchema.nullable().optional(),
  market: z.string().length(2).nullable().optional(),
  currency: z.string().length(3).nullable().optional(),
  vendor_id: z.coerce.number().int().min(1).nullable().optional(),
  payment_term_id: z.coerce.number().int().min(1).nullable().optional(),
  documents: z.array(billDocumentInputSchema).nullable().optional(),
  details: z.array(billDetailInputSchema).optional(),
});

export const invoiceDetailInputSchema = z.object({
  inventory_id: z.coerce.number().int().min(1),
  service_id: z.coerce.number().int().min(1),
  quantity: z.coerce.number().int(),
  amount: z.coerce.number(),
});

export const invoicePayloadSchema = z.object({
  name: z.string().nullable().optional(),
  ref_number: z.string().optional(),
  date: isoDateSchema.nullable().optional(),
  market: z.string().length(2).nullable().optional(),
  currency: z.string().length(3).nullable().optional(),
  warehouse_id: z.coerce.number().int().min(1).nullable().optional(),
  customer_id: z.coerce.number().int().min(1).nullable().optional(),
  sales_channel_id: z.coerce.number().int().min(1).nullable().optional(),
  details: z.array(invoiceDetailInputSchema).nullable().optional(),
});

export const adjustmentDetailInputSchema = z.object({
  inventory_id: z.coerce.number().int().min(1),
  service_id: z.coerce.number().int().min(1),
  quantity: z.coerce.number().int(),
  rate: z.coerce.number(),
});

export const adjustmentPayloadSchema = z.object({
  name: z.string().nullable().optional(),
  ref_number: z.string().optional(),
  date: isoDateSchema.nullable().optional(),
  market: z.string().length(2).nullable().optional(),
  currency: z.string().length(3).nullable().optional(),
  reason: z.string().nullable().optional(),
  warehouse_id: z.coerce.number().int().min(1).nullable().optional(),
  details: z.array(adjustmentDetailInputSchema).nullable().optional(),
});

export const shipmentItemInputSchema = z.object({
  origin_inventory_id: z.coerce.number().int().min(1),
  quantity_shipped: z.coerce.number().int().min(1),
  quantity_received: z.coerce.number().int().min(1),
});

export const shipmentPayloadSchema = z.object({
  name: z.string().nullable().optional(),
  ref_number: z.string().optional(),
  date_shipment_sent: isoDateSchema.nullable().optional(),
  date_shipment_arrived: isoDateSchema.nullable().optional(),
  origin_market: z.string().length(2).nullable().optional(),
  destination_market: z.string().length(2).nullable().optional(),
  origin_warehouse_id: z.coerce.number().int().min(1).nullable().optional(),
  destination_warehouse_id: z.coerce.number().int().min(1).nullable().optional(),
  tracking_number: z.string().nullable().optional(),
  shipment_method: z.enum(['LTL', 'FTL', 'SPD']).nullable().optional(),
  items: z.array(shipmentItemInputSchema).nullable().optional(),
});

export const createInventoryOrderInputSchema = companyScopedBaseSchema.merge(inventoryOrderPayloadSchema)
  .refine(hasCompanyIdentifier, { message: 'Provide company_id or companyUuid' });

export const createBillInputSchema = companyScopedBaseSchema.merge(billPayloadSchema)
  .refine(hasCompanyIdentifier, { message: 'Provide company_id or companyUuid' });

export const createInvoiceInputSchema = companyScopedBaseSchema.merge(invoicePayloadSchema)
  .refine(hasCompanyIdentifier, { message: 'Provide company_id or companyUuid' });

export const createAdjustmentInputSchema = companyScopedBaseSchema.merge(adjustmentPayloadSchema)
  .refine(hasCompanyIdentifier, { message: 'Provide company_id or companyUuid' });

export const createShipmentInputSchema = companyScopedBaseSchema.merge(shipmentPayloadSchema)
  .refine(hasCompanyIdentifier, { message: 'Provide company_id or companyUuid' });

export const updateInventoryOrderInputSchema = companyScopedBaseSchema.extend({
  inventory_order_id: z.coerce.number().int().min(1),
}).merge(inventoryOrderPayloadSchema).refine(hasCompanyIdentifier, { message: 'Provide company_id or companyUuid' });

export const updateBillInputSchema = companyScopedBaseSchema.extend({
  bill_id: z.coerce.number().int().min(1),
}).merge(billPayloadSchema).refine(hasCompanyIdentifier, { message: 'Provide company_id or companyUuid' });

export const updateInvoiceInputSchema = companyScopedBaseSchema.extend({
  invoice_id: z.coerce.number().int().min(1),
}).merge(invoicePayloadSchema).refine(hasCompanyIdentifier, { message: 'Provide company_id or companyUuid' });

export const updateAdjustmentInputSchema = companyScopedBaseSchema.extend({
  adjustment_id: z.coerce.number().int().min(1),
}).merge(adjustmentPayloadSchema).refine(hasCompanyIdentifier, { message: 'Provide company_id or companyUuid' });

export const updateShipmentInputSchema = companyScopedBaseSchema.extend({
  shipment_id: z.coerce.number().int().min(1),
}).merge(shipmentPayloadSchema).refine(hasCompanyIdentifier, { message: 'Provide company_id or companyUuid' });

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

export const listServicesInputSchema = companyScopedBaseSchema.extend({
  search: z.string().optional(),
  per_page: z.coerce.number().int().min(1).max(500).optional(),
}).refine(hasCompanyIdentifier, { message: 'Provide company_id or companyUuid' });

export const listInvoicesInputSchema = companyScopedBaseSchema.extend({
  search: z.string().optional(),
  start_date: isoDateSchema.optional(),
  end_date: isoDateSchema.optional(),
}).refine(hasCompanyIdentifier, { message: 'Provide company_id or companyUuid' });

export const listShipmentsInputSchema = companyScopedBaseSchema.extend({
  search: z.string().optional(),
  warehouses: z.array(z.coerce.number().int().min(1)).optional(),
  start_date: isoDateSchema.optional(),
  end_date: isoDateSchema.optional(),
}).refine(hasCompanyIdentifier, { message: 'Provide company_id or companyUuid' });

export const listPaymentTermsInputSchema = z.object({});

export const passthroughOutputSchema = {
  type: 'object',
  additionalProperties: true,
};