import type { ToolRegistry } from '../types';
import { registerFbaListReplenishAsapTool } from './tools/fba_list_replenish_asap/register';
import { registerInventoryPoScheduleTool } from './tools/inventory_po_schedule/register';
import { registerInventorySkuDeepDiveTool } from './tools/inventory_sku_deep_dive/register';
import { registerProductListLogisticParametersTool } from './tools/product_list_logistic_parameters/register';
import { registerSupplyChainListFbaReplenishmentCandidatesTool } from './tools/supply_chain_list_fba_replenishment_candidates/register';
import { registerSupplyChainListPoPlacementCandidatesTool } from './tools/supply_chain_list_po_placement_candidates/register';

export function registerAthenaTools(registry: ToolRegistry) {
  // Keep this list small and explicit to control ordering in tools/list.
  registerSupplyChainListFbaReplenishmentCandidatesTool(registry);
  registerSupplyChainListPoPlacementCandidatesTool(registry);
  registerFbaListReplenishAsapTool(registry);
  registerInventoryPoScheduleTool(registry);
  registerInventorySkuDeepDiveTool(registry);
  registerProductListLogisticParametersTool(registry);
}
