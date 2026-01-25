import type { ToolRegistry } from '../types';
import { registerSupplyChainInspectInventorySkuSnapshotTool } from './tools/supply_chain/inspect_inventory_sku_snapshot/register';
import { registerSupplyChainAnalyzeSalesVelocityTool } from './tools/supply_chain/analyze_sales_velocity/register';
import { registerSupplyChainListProductLogisticsParametersTool } from './tools/supply_chain/list_product_logistics_parameters/register';
import { registerSupplyChainListFbaReplenishmentCandidatesTool } from './tools/supply_chain/list_fba_replenishment_candidates/register';
import { registerSupplyChainListPoPlacementCandidatesTool } from './tools/supply_chain/list_po_placement_candidates/register';
import { registerSupplyChainListStockReplenishmentRiskItemsTool } from './tools/supply_chain/list_stock_replenishment_risk_items/register';
import { registerForecastingListLatestSalesForecastTool } from './tools/forecasting/list_latest_sales_forecast/register';
import { registerForecastingCompareSalesForecastScenariosTool } from './tools/forecasting/compare_sales_forecast_scenarios/register';
import { registerForecastingWriteSalesForecastTool } from './tools/forecasting/write_sales_forecast/register';

export function registerAthenaTools(registry: ToolRegistry) {
  // Keep this list small and explicit to control ordering in tools/list.
  registerForecastingListLatestSalesForecastTool(registry);
  registerForecastingCompareSalesForecastScenariosTool(registry);
  registerForecastingWriteSalesForecastTool(registry);
  registerSupplyChainListFbaReplenishmentCandidatesTool(registry);
  registerSupplyChainListPoPlacementCandidatesTool(registry);
  registerSupplyChainListStockReplenishmentRiskItemsTool(registry);
  registerSupplyChainAnalyzeSalesVelocityTool(registry);
  registerSupplyChainInspectInventorySkuSnapshotTool(registry);
  registerSupplyChainListProductLogisticsParametersTool(registry);
}
