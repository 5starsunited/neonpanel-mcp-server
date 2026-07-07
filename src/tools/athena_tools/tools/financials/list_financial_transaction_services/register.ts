import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { runAthenaQuery } from '../../../../../clients/athena';
import { neonPanelRequest } from '../../../../../clients/neonpanel-api';
import { config } from '../../../../../config';
import type { ToolRegistry, ToolSpecJson } from '../../../../types';
import { loadTextFile } from '../../../runtime/load-assets';
import { renderSqlTemplate } from '../../../runtime/render-sql';

type CompaniesWithPermissionResponse = {
  companies?: Array<{ company_id?: number; companyId?: number; id?: number }>;
};

function sqlEscapeString(value: string): string {
  return value.replace(/'/g, "''");
}
function sqlStringLiteral(value: string): string {
  return `'${sqlEscapeString(value)}'`;
}
function sqlVarcharArrayExpr(values: string[]): string {
  if (values.length === 0) return 'CAST(ARRAY[] AS ARRAY(VARCHAR))';
  return `CAST(ARRAY[${values.map(sqlStringLiteral).join(',')}] AS ARRAY(VARCHAR))`;
}

// Curated explanations of how each service arises from Amazon SP-API transaction data.
// A "service" is the classification key: the verbatim Amazon breakdownType leaf, a composite
// '<type>:<description>' for context-dependent leaves, or 'TXN:<type>' for breakdown-less
// transactions. Unknown keys get a generic explanation derived from line_kind.
const SERVICE_EXPLANATIONS: Record<string, string> = {
  OurPricePrincipal: 'Item price principal. The product-charge leaf inside Order Payment (Shipment) and Refund transactions. Positive = product sale; negative = product sale refund.',
  OurPriceDiscount: 'Seller-funded discount on item price (promotions) inside order/refund transactions. Negative on sales (promotional rebate); positive on refunds (rebate refund).',
  OurPriceTax: 'Sales tax collected on the item price, inside order/refund transactions.',
  Commission: 'Amazon referral fee (selling fee) on orders/refunds. Resolves per fulfillment: AFN = FBA selling fees, MFN = Seller-fulfilled selling fees.',
  RefundCommission: 'The portion of referral fee Amazon keeps when refunding an order ("refund administration fee").',
  FBAPerUnitFulfillmentFee: 'FBA pick-pack-ship fee per unit, inside Order Payment transactions (incl. MCF orders on the Non-Amazon marketplace).',
  'FBADisposalFee': 'FBA removal order disposal fee (ServiceFee/FBADisposal). Since ~2026-06-19 Amazon groups it under FBA transaction fees.',
  'FBADisposalFee:legacy': 'FBA disposal fee posted before 2026-06-19 (Amazon then grouped it under FBA inventory and inbound services fees). Date split applied by the ledger.',
  ShippingPrincipal: 'Shipping charged to the buyer. Positive = shipping credit; negative = shipping credit refund.',
  ShippingDiscount: 'Seller-funded shipping discount (promotional rebate on shipping).',
  ShippingChargeback: 'Shipping cost Amazon charges back to the seller on FBA orders (buyer got free/discounted shipping). Part of FBA transaction fees per Amazon statements.',
  ShippingTax: 'Tax collected on shipping charges.',
  GiftwrapPrincipal: 'Gift wrap charged to the buyer (gift wrap credit).',
  GiftwrapChargeback: 'Gift wrap cost charged back to the seller on FBA orders; grouped with FBA transaction fees per Amazon statements.',
  GiftwrapTax: 'Tax collected on gift wrap charges.',
  Promo: 'Promotion amount leaf on order/refund transactions (promotional rebates).',
  'Promo:AWDTransportationFee': 'Promo/discount component inside an AWD transportation ServiceFee transaction -- a fee discount, NOT a sales promotion. Netted into FBA transaction fees.',
  'MarketplaceFacilitatorTax-Principal': 'Marketplace-facilitator tax Amazon withholds on the item price (offsets collected tax).',
  'MarketplaceFacilitatorTax-Shipping': 'Marketplace-facilitator tax Amazon withholds on shipping.',
  'MarketplaceFacilitatorTax-Other': 'Marketplace-facilitator withholding, other categories.',
  'MarketplaceFacilitatorVAT-Principal': 'VAT Amazon withholds on the item price (EU/UK marketplaces).',
  'MarketplaceFacilitatorVAT-Shipping': 'VAT Amazon withholds on shipping.',
  'LowValueGoodsTax-Principal': 'Low-value-goods import tax withheld by Amazon.',
  TaxOnRevenue: 'Tax on revenue leaf appearing in some order transactions (collected side).',
  RecommerceLiquidation: 'Gross proceeds from FBA liquidation orders (RemovalShipment transactions).',
  AmazonFees: 'Fee rollup captured whole when it has no named children -- in practice the liquidation brokerage fee on RemovalShipment/Recommerce transactions ("Liquidations fees" on statements).',
  FBAStorageFee: 'Monthly FBA storage fee (ServiceFee/FBAStorageBilling).',
  FBALongTermStorageFee: 'FBA long-term (aged inventory) storage surcharge.',
  STARStorageFee: 'AWD storage fee (ServiceFee/STARStorageBilling; "AWD Storage Fee" on statements -- grouped under FBA transaction fees).',
  AmazonUpstreamProcessingFee: 'AWD processing fee (ServiceFee/AWDProcessingFee; grouped under FBA transaction fees).',
  AmazonUpstreamStorageTransportationFee: 'AWD upstream storage transportation fee.',
  'Base:AWDTransportationFee': 'Base component of an AWD transportation ServiceFee transaction (orphan sub-leaf keyed by description). Grouped under FBA transaction fees.',
  'BaseTax:Retrocharge': 'Tax detail of Retrocharge transactions (Amazon retro-charging marketplace tax). Collected side; the offsetting MarketplaceFacilitatorTax leaf lands in withheld.',
  'Tax:RecommerceAfterMarketplaceAdjustmentItem': 'Tax orphan leaf on liquidation Adjustment transactions; collected-side per Amazon statements.',
  FBAInboundTransportationFee: 'Amazon partnered-carrier inbound transportation fee.',
  FBAInboundConvenienceFee: 'FBA inbound placement/convenience service fee.',
  FBAInboundDefectFee: 'Fee (or reversal) for inbound shipments not matching requirements (ServiceFee/FBAInboundDefect).',
  FBARemovalFee: 'FBA removal order fee (return-to-seller).',
  FBACustomerReturnPerUnitFee: 'FBA customer returns processing fee per unit.',
  CustomerReturnHRRUnitFee: 'FBA customer returns fee for high-return-rate products (ServiceFee/CustomerReturnHRREvent). Grouped under FBA transaction fees.',
  Subscription: 'Professional selling plan monthly subscription (ServiceFee/Subscription).',
  PaidServicesFee: 'Paid Amazon services fee.',
  DigitalServicesFee: 'Digital services fee (DST surcharge in some countries).',
  VineFee: 'Amazon Vine enrollment fee.',
  CouponParticipationFee: 'Coupon participation (setup) fee.',
  CouponPerformanceFee: 'Coupon per-redemption fee.',
  DealParticipationFee: 'Deal (Lightning/7-day) participation fee.',
  DealPerformanceFee: 'Deal performance-based fee.',
  EPRChargebackEcoFee: 'Extended producer responsibility (eco-contribution) chargeback.',
  FBAInventoryReimbursement: 'Amazon reimbursement for lost/damaged inventory (transaction-level; description carries the reason, e.g. MISSING_FROM_INBOUND, Customer Return). Negative = reimbursement clawback (Adjustments).',
  FBAReversedReimbursement: 'Reversal of a previous inventory reimbursement (Expenses/Adjustments on statements).',
  RestockingDeductionPrincipal: 'Restocking fee deducted from a customer refund (kept by seller; nets inside product sale refunds).',
  RestockingDeductionTax: 'Tax component of the restocking deduction (refunded-tax line on statements).',
  Other: 'Verbatim Amazon leaf literally named "Other" -- seen on MiscellaneousLedgerAdjustment (e.g. FBAStorageFeeAdjustment). Statements group it under Adjustments.',
  ReserveDebit: 'Account-level reserve hold (money moved into reserve).',
  ReserveCredit: 'Account-level reserve release.',
  FailedDisbursement: 'A bank transfer that failed and was returned to the account balance.',
  DebtPayment: 'Repayment of a balance Amazon is owed.',
  PointsGranted: 'Amazon Points granted (JP marketplace) -- treated as promotional rebates.',
  PointsReclaimed: 'Amazon Points reclaimed on refunds (JP).',
  'TXN:Transfer': 'Disbursement to (or charge from) the bank account. Transaction-level: Transfer transactions carry no breakdowns; sign negated so payouts are negative.',
  'TXN:FTBalanceDeduction': 'Balance deduction (e.g. Transparency program charges) -- "Receivables Deductions" on statements.',
  'TXN:ServiceFee': 'Service-fee transaction with no breakdown detail; classified by its transaction total.',
  'TXN:Retrocharge': 'Retrocharge transaction with no breakdown detail.',
  'TXN:FBAInventoryReimbursement': 'Inventory reimbursement transaction with no breakdown detail.',
  'TXN:PayWithAmazon': 'Pay-with-Amazon (off-Amazon checkout) order transaction.',
};

function explanationFor(serviceKey: string, lineKind: string): string {
  if (SERVICE_EXPLANATIONS[serviceKey]) return SERVICE_EXPLANATIONS[serviceKey];
  const base = serviceKey.split(':')[0];
  if (SERVICE_EXPLANATIONS[base]) return SERVICE_EXPLANATIONS[base];
  if (serviceKey.startsWith('TXN:')) {
    return `Transaction-level line: '${serviceKey.slice(4)}' transactions carry no per-item fee breakdowns, so the transaction/item total is booked as one line.`;
  }
  if (lineKind === 'breakdown') {
    return `Verbatim Amazon breakdown leaf '${serviceKey}' captured from the fee breakdown tree of the transaction (see origin transaction types/descriptions). New/rare Amazon fee type -- map it in financial_transaction_class_map if unclassified.`;
  }
  return `Service '${serviceKey}' derived from Amazon financial transactions.`;
}

const querySchema = z
  .object({
    filters: z
      .object({
        company_id: z.coerce.number().int().min(1),
        report_months: z.array(z.string().regex(/^\d{4}-\d{2}$/)).optional(),
        search: z.string().min(1).optional(),
        only_unclassified: z.boolean().optional(),
      })
      .strict(),
    limit: z.coerce.number().int().min(1).max(500).default(200).optional(),
  })
  .strict();

type QueryInput = z.infer<typeof querySchema>;

const inputSchema = z
  .object({
    query: querySchema.optional(),
    filters: z.unknown().optional(),
    limit: z.unknown().optional(),
  })
  .strict();

export function registerFinancialsListFinancialTransactionServicesTool(registry: ToolRegistry) {
  const toolJsonPath = path.join(__dirname, 'tool.json');
  const sqlPath = path.join(__dirname, 'query.sql');

  let specJson: ToolSpecJson | undefined;
  try {
    if (fs.existsSync(toolJsonPath)) {
      specJson = JSON.parse(fs.readFileSync(toolJsonPath, 'utf8')) as ToolSpecJson;
    }
  } catch {
    specJson = undefined;
  }

  registry.register({
    name: 'financials_list_financial_transaction_services',
    description:
      'Catalogs the SERVICES (fee/charge line types) observed in a company\'s Amazon financial transactions (neonpanel_iceberg.financial_transaction_lines_v1): each service\'s key, an explanation of how it arises from Amazon transaction data (which transaction types/descriptions produce it), months active, volumes, and how each sign (charge vs refund) maps to summary classes. Use financials_list_financial_transaction_class_map for the full classification rulebook.',
    isConsequential: false,
    inputSchema,
    outputSchema: specJson?.outputSchema ?? { type: 'object', additionalProperties: true },
    specJson,
    execute: async (args, context) => {
      const parsed = inputSchema.parse(args);
      const query = querySchema.parse(
        parsed.query ?? { filters: parsed.filters, limit: parsed.limit },
      ) as QueryInput;

      const permissions = ['view:quicksight_group.finance-new'];

      const allPermittedCompanyIds = new Set<number>();
      for (const permission of permissions) {
        try {
          const permissionResponse = await neonPanelRequest<CompaniesWithPermissionResponse>({
            token: context.userToken,
            path: `/api/v1/permissions/${encodeURIComponent(permission)}/companies`,
          });
          (permissionResponse.companies ?? []).forEach((c) => {
            const id = c?.company_id ?? c?.companyId ?? c?.id;
            if (typeof id === 'number' && Number.isFinite(id) && id > 0) {
              allPermittedCompanyIds.add(id);
            }
          });
        } catch {
          // Continue if one permission check fails.
        }
      }

      const companyId = Math.trunc(query.filters.company_id);
      if (!allPermittedCompanyIds.has(companyId)) {
        return { items: [] };
      }

      const reportMonths = (query.filters.report_months ?? []).map((s) => s.trim()).filter(Boolean);
      const limitTopN = query.limit ?? 200;

      const template = await loadTextFile(sqlPath);
      const rendered = renderSqlTemplate(template, {
        catalog: config.athena.catalog,
        company_id: companyId,
        report_months_array: sqlVarcharArrayExpr(reportMonths),
        search: query.filters.search ? sqlStringLiteral(query.filters.search) : 'CAST(NULL AS VARCHAR)',
        only_unclassified: query.filters.only_unclassified ? 'TRUE' : 'FALSE',
        limit_top_n: Number(limitTopN),
      });

      const athenaResult = await runAthenaQuery({
        query: rendered,
        database: 'neonpanel_iceberg',
        workGroup: config.athena.workgroup,
        outputLocation: config.athena.outputLocation,
        maxRows: limitTopN,
      });

      const items = (athenaResult.rows ?? []).map((row) => {
        const r = row as Record<string, unknown>;
        return {
          ...r,
          explanation: explanationFor(String(r.service_key ?? ''), String(r.line_kind ?? '')),
        };
      });

      return {
        items,
        model_notes: [
          'A service is one fee/charge line type extracted from Amazon SP-API financial transactions: the verbatim breakdownType leaf of the fee tree, a composite "<type>:<description>" key for context-dependent leaves, or "TXN:<transactionType>" for transactions without breakdowns.',
          'Classification into summary classes is sign-dependent (POS=charge/credit, NEG=fee/refund) and can be fulfillment-specific (AFN/MFN). See financials_list_financial_transaction_class_map for the rulebook.',
          'is_unclassified=1 means at least one observed sign has no mapping row yet -- such lines report under summary_class "Unclassified" until a class-map row is added.',
        ],
      };
    },
  });
}
