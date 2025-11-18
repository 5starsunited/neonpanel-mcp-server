import { z } from 'zod';
import { config } from '../config';
import { JsonRpcError } from '../lib/errors';
import { RpcDispatcher } from './rpc/dispatcher';
import { ToolRegistry } from '../tools/types';
import { registerNeonPanelTools } from '../tools/neonpanel';
import { userTokenProvider, type UserTokenProvider } from '../auth/user-token-provider';
import { logger } from '../logging/logger';

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
    initialize: async (_params, context) => {
      logger.info(
        {
          method: 'initialize',
          subject: context.subject,
          scopes: context.scopes,
          authenticated: Boolean(context.token),
        },
        'RPC initialize invoked',
      );
      return {
        serverInfo: {
          name: config.mcp.serverName,
          version: config.buildVersion,
        },
        protocolVersion: config.mcp.protocolVersion,
        capabilities: {
          tools: {
            listChanged: false,
          },
        },
      };
    },
    'tools/list': async (params, context) => {
      ToolListParamsSchema.parse(params);
      const tools = registry.list();
      logger.info(
        {
          method: 'tools/list',
          subject: context.subject,
          scopes: context.scopes,
          authenticated: Boolean(context.token),
          toolCount: tools.length,
        },
        'RPC tools/list invoked',
      );
      return {
        tools,
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
