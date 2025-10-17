import { z } from 'zod';
import { config } from '../config';
import { JsonRpcError } from '../lib/errors';
import { RpcDispatcher } from './rpc/dispatcher';
import { ToolRegistry } from '../tools/types';
import { registerNeonPanelTools } from '../tools/neonpanel';
import { userTokenProvider, type UserTokenProvider } from '../auth/user-token-provider';

const ToolCallParamsSchema = z.object({
  name: z.string().min(1),
  arguments: z.unknown().optional(),
});

const ToolListParamsSchema = z.object({}).optional();

export interface RpcFactoryOptions {
  userTokenProvider?: UserTokenProvider;
}

export function createRpcDispatcher(options: RpcFactoryOptions = {}): RpcDispatcher {
  const registry = new ToolRegistry();
  registerNeonPanelTools(registry);
  const provider = options.userTokenProvider ?? userTokenProvider;

  return RpcDispatcher.fromRecord({
    initialize: async () => ({
      serverInfo: {
        name: config.mcp.serverName,
        version: config.buildVersion,
      },
      protocolVersion: config.mcp.protocolVersion,
      capabilities: {
        tools: true,
      },
    }),
    'tools/list': async (params) => {
      ToolListParamsSchema.parse(params);
      return {
        tools: registry.list(),
      };
    },
    'tools/call': async (params, context) => {
      const parsed = ToolCallParamsSchema.parse(params);
      const tool = registry.get(parsed.name);

      if (!tool) {
        throw new JsonRpcError(`Tool not found: ${parsed.name}`, {
          status: 404,
          rpcCode: -32601,
          code: 'tool_not_found',
        });
      }

      const args = tool.inputSchema.parse(parsed.arguments ?? {});
      const userToken = await provider.getToken(context.validatedToken);
      const result = await tool.execute(args, {
        accessToken: context.token,
        userToken,
        scopes: context.scopes,
        subject: context.subject,
        payload: context.payload,
      });

      return {
        name: tool.name,
        result,
      };
    },
  });
}
