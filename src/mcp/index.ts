import { z } from 'zod';
import { config } from '../config';
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

type McpToolContentItem =
  | { type: 'text'; text: string };

type McpToolCallResult = {
  content: McpToolContentItem[];
  isError?: boolean;
};

function toText(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, (_key, v) => (v === undefined ? null : v), 2);
  } catch {
    return String(value);
  }
}

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
    // MCP lifecycle notification sent by some clients after initialize.
    // We treat it as a no-op and keep it unauthenticated at the HTTP layer.
    initialized: async (_params, context) => {
      logger.info(
        {
          method: 'initialized',
          subject: context.subject,
          scopes: context.scopes,
          authenticated: Boolean(context.token),
        },
        'RPC initialized invoked',
      );
      return { ok: true };
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
      try {
        const parsed = ToolCallParamsSchema.parse(params);
        const tool = registry.get(parsed.name);

        if (!tool) {
          const result: McpToolCallResult = {
            content: [{ type: 'text', text: `Tool not found: ${parsed.name}` }],
            isError: true,
          };
          return result;
        }

        const args = tool.inputSchema.parse(parsed.arguments ?? {});
        const userToken = await provider.getToken(context.validatedToken);
        const toolResult = await tool.execute(args, {
          accessToken: context.token,
          userToken,
          scopes: context.scopes,
          subject: context.subject,
          payload: context.payload,
        });

        const result: McpToolCallResult = {
          // Primary output is text for maximum compatibility with ChatGPT Apps framework.
          content: [{ type: 'text', text: toText(toolResult) }],
        };

        return result;
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown tool execution error.';
        const result: McpToolCallResult = {
          content: [{ type: 'text', text: `Error: ${message}` }],
          isError: true,
        };
        return result;
      }
    },
  });
}
