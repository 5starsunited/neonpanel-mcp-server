import type { ToolRegistry } from '../types';
import { registerSupplyChainInspectInventorySkuSnapshotTool } from './tools/supply_chain_inspect_inventory_sku_snapshot/register';
import { registerSupplyChainListProductLogisticsParametersTool } from './tools/supply_chain_list_product_logistics_parameters/register';
import { registerSupplyChainListFbaReplenishmentCandidatesTool } from './tools/supply_chain_list_fba_replenishment_candidates/register';
import { registerSupplyChainListPoPlacementCandidatesTool } from './tools/supply_chain_list_po_placement_candidates/register';

export function registerAthenaTools(registry: ToolRegistry) {
  // Keep this list small and explicit to control ordering in tools/list.
  registerSupplyChainListFbaReplenishmentCandidatesTool(registry);
  registerSupplyChainListPoPlacementCandidatesTool(registry);
  registerSupplyChainInspectInventorySkuSnapshotTool(registry);
  registerSupplyChainListProductLogisticsParametersTool(registry);
}
