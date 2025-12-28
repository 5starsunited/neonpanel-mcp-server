import type { ToolRegistry } from '../types';
import { registerFbaListReplenishAsapTool } from './tools/fba_list_replenish_asap/register';
import { registerInventorySkuDeepDiveTool } from './tools/inventory_sku_deep_dive/register';

export function registerAthenaTools(registry: ToolRegistry) {
  // Keep this list small and explicit to control ordering in tools/list.
  registerFbaListReplenishAsapTool(registry);
  registerInventorySkuDeepDiveTool(registry);
}
