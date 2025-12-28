import type { ToolRegistry } from '../types';
import { registerFbaListReplenishAsapTool } from './tools/fba_list_replenish_asap/register';

export function registerAthenaTools(registry: ToolRegistry) {
  // Keep this list small and explicit to control ordering in tools/list.
  registerFbaListReplenishAsapTool(registry);
}
