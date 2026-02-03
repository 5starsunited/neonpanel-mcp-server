import type { ToolRegistry } from '../types';
import { registerSupplyChainInspectInventorySkuSnapshotTool } from './tools/supply_chain/inspect_inventory_sku_snapshot/register';
import { registerSupplyChainAnalyzeSalesVelocityTool } from './tools/supply_chain/analyze_sales_velocity/register';
import { registerSupplyChainListProductLogisticsParametersTool } from './tools/supply_chain/list_product_logistics_parameters/register';
import { registerSupplyChainListFbaReplenishmentCandidatesTool } from './tools/supply_chain/list_fba_replenishment_candidates/register';
import { registerSupplyChainListPoPlacementCandidatesTool } from './tools/supply_chain/list_po_placement_candidates/register';
import { registerSupplyChainListStockReplenishmentRiskItemsTool } from './tools/supply_chain/list_stock_replenishment_risk_items/register';
import { registerShipmentArrivalOracle } from './tools/supply_chain/shipment_arrival_oracle/register';
import { registerForecastingListLatestSalesForecastTool } from './tools/forecasting/list_latest_sales_forecast/register';
import { registerForecastingCompareSalesForecastScenariosTool } from './tools/forecasting/compare_sales_forecast_scenarios/register';
import { registerForecastingWriteSalesForecastTool } from './tools/forecasting/write_sales_forecast/register';
import { registerForecastingGenerateSalesForecastTool } from './tools/forecasting/generate_sales_forecast/register';
import { registerBrandAnalyticsGetCompetitiveLandscapeTool } from './tools/brand_analytics/brand_analytics_get_competitive_landscape/register';
import { registerCogsAnalyzeFifoCogsTool } from './tools/cogs/analyze_fifo_cogs/register';
import { registerCogsExportUnitCostsTool } from './tools/cogs/export_unit_costs/register';
import { registerCogsListLostBatchesTool } from './tools/cogs/list_lost_batches/register';
import { registerInventoryValuationAnalyzeInventoryValueTool } from './tools/inventory_valuation/analyze_inventory_value/register';
import { registerSearchNeonpanelProjectUrl } from './tools/projects/search_neonpanel_project_url/register';

export function registerAthenaTools(registry: ToolRegistry) {
  // Keep this list small and explicit to control ordering in tools/list.
  registerForecastingListLatestSalesForecastTool(registry);
  registerForecastingCompareSalesForecastScenariosTool(registry);
  registerForecastingWriteSalesForecastTool(registry);
  registerForecastingGenerateSalesForecastTool(registry);
  registerSupplyChainListFbaReplenishmentCandidatesTool(registry);
  registerSupplyChainListPoPlacementCandidatesTool(registry);
  registerSupplyChainListStockReplenishmentRiskItemsTool(registry);
  registerSupplyChainAnalyzeSalesVelocityTool(registry);
  registerShipmentArrivalOracle(registry);
  registerSupplyChainInspectInventorySkuSnapshotTool(registry);
  registerSupplyChainListProductLogisticsParametersTool(registry);
  registerBrandAnalyticsGetCompetitiveLandscapeTool(registry);
  registerCogsAnalyzeFifoCogsTool(registry);
  registerCogsExportUnitCostsTool(registry);
  registerCogsListLostBatchesTool(registry);
  registerInventoryValuationAnalyzeInventoryValueTool(registry);
  registerSearchNeonpanelProjectUrl(registry);
}
