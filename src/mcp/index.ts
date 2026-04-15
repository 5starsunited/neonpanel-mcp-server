import { z } from 'zod';
import { config } from '../config';
import { RpcDispatcher } from './rpc/dispatcher';
import { ToolRegistry } from '../tools/types';
import { registerAthenaTools } from '../tools/athena_tools';
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
  structuredContent?: Record<string, unknown>;
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

// ---------------------------------------------------------------------------
// Schema-based type coercion for structuredContent
// ---------------------------------------------------------------------------
// Athena returns all values as VarCharValue strings. When the outputSchema
// declares integer/number/object/boolean types, we coerce the raw strings
// so structuredContent passes client-side schema validation.

function coerceToSchema(value: unknown, schema: Record<string, unknown> | undefined): unknown {
  if (!schema || value === undefined) return value;

  const schemaType = schema.type as string | string[] | undefined;

  // Handle anyOf / oneOf (pick first matching primitive hint)
  if (!schemaType) {
    const candidates = (schema.anyOf ?? schema.oneOf) as Record<string, unknown>[] | undefined;
    if (candidates && Array.isArray(candidates)) {
      for (const candidate of candidates) {
        const coerced = coerceToSchema(value, candidate);
        if (coerced !== value) return coerced;
      }
    }
    return value;
  }

  // Normalise type to a single string (JSON Schema allows arrays)
  const types = Array.isArray(schemaType) ? schemaType : [schemaType];

  // null is valid when the schema includes "null" in its type list
  if (value === null && types.includes('null')) return null;

  // NaN / Infinity (number values) → null when schema allows null
  if (typeof value === 'number' && !Number.isFinite(value)) {
    return types.includes('null') ? null : 0;
  }

  // --- object ---------------------------------------------------------------
  if (types.includes('object')) {
    // JSON-encoded string → parse into object
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
        try { return JSON.parse(trimmed); } catch { /* keep as-is */ }
      }
    }
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const properties = schema.properties as Record<string, Record<string, unknown>> | undefined;
      if (!properties) return value;
      const record = value as Record<string, unknown>;
      const result: Record<string, unknown> = {};
      for (const [key, val] of Object.entries(record)) {
        result[key] = properties[key] ? coerceToSchema(val, properties[key]) : val;
      }
      return result;
    }
    return value;
  }

  // --- array ----------------------------------------------------------------
  if (types.includes('array')) {
    // JSON-encoded string → parse into array
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed.startsWith('[')) {
        try {
          const parsed = JSON.parse(trimmed);
          if (Array.isArray(parsed)) {
            const items = schema.items as Record<string, unknown> | undefined;
            return items ? parsed.map((item: unknown) => coerceToSchema(item, items)) : parsed;
          }
        } catch { /* keep as-is */ }
      }
    }
    if (Array.isArray(value)) {
      const items = schema.items as Record<string, unknown> | undefined;
      if (!items) return value;
      return value.map((item) => coerceToSchema(item, items));
    }
    return value;
  }

  // --- integer --------------------------------------------------------------
  if (types.includes('integer') && typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return Math.round(parsed);
    // "NaN" / "Infinity" → null when schema allows null, otherwise 0
    if (types.includes('null')) return null;
    return 0;
  }

  // --- number ---------------------------------------------------------------
  if (types.includes('number') && typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
    // "NaN" / "Infinity" → null when schema allows null, otherwise 0
    if (types.includes('null')) return null;
    return 0;
  }

  // --- string (null → '') ---------------------------------------------------
  if (types.includes('string') && (value === null || value === 'None')) {
    return '';
  }

  // --- boolean --------------------------------------------------------------
  if (types.includes('boolean') && typeof value === 'string') {
    if (value.toLowerCase() === 'true') return true;
    if (value.toLowerCase() === 'false') return false;
  }

  return value;
}

export function unwrapToolArguments(raw: unknown): unknown {
  // Some MCP/OpenAPI clients wrap tool arguments like: { params: { ...actualArgs } }.
  // To keep tool schemas focused on the actual payload, unwrap this single wrapper.
  let current: unknown = raw;

  const tryParseJsonString = (value: unknown): unknown => {
    if (typeof value !== 'string') return value;
    const trimmed = value.trim();
    // Only attempt JSON.parse when it looks like JSON to avoid surprising coercion.
    const looksJsonObject = trimmed.startsWith('{') && trimmed.endsWith('}');
    const looksJsonArray = trimmed.startsWith('[') && trimmed.endsWith(']');
    if (!looksJsonObject && !looksJsonArray) return value;
    try {
      return JSON.parse(trimmed) as unknown;
    } catch {
      return value;
    }
  };

  for (let i = 0; i < 5; i++) {
    current = tryParseJsonString(current);
    if (!current || typeof current !== 'object') return current;
    const record = current as Record<string, unknown>;
    const keys = Object.keys(record);
    if (keys.length === 1 && keys[0] === 'params' && record.params && typeof record.params === 'object') {
      current = record.params;
      continue;
    }
    return current;
  }

  return current;
}

export interface RpcFactoryOptions {
  userTokenProvider?: UserTokenProvider;
}

export function createRpcDispatcher(options: RpcFactoryOptions = {}): RpcDispatcher {
  const registry = new ToolRegistry();
  // Register Athena-backed tools first to keep high-value tools early in tools/list.
  registerAthenaTools(registry);
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
          title: 'NeonPanel',
          version: config.buildVersion,
          description: 'Amazon Seller analytics MCP server — inventory, revenue, supply-chain, brand analytics, and forecasting tools.',
          icons: [
            {
              src: 'https://www.neonpanel.com/images/tild3765-6438-4834-b163-316664653565__favicon.webp',
              mimeType: 'image/webp',
              sizes: ['32x32'],
            },
          ],
          websiteUrl: 'https://neonpanel.com',
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

        const normalizedArguments = unwrapToolArguments(parsed.arguments ?? {});

        // AI clients often send { filters, limit, ... } flat instead of { query: { filters, limit, ... } }.
        // Auto-wrap into { query: {...} } when the input has `filters` but no `query` key.
        const QUERY_KEYS = new Set(['filters', 'limit', 'sort', 'aggregation', 'cursor']);
        let finalArguments: unknown = normalizedArguments;
        if (
          normalizedArguments &&
          typeof normalizedArguments === 'object' &&
          !Array.isArray(normalizedArguments) &&
          'filters' in normalizedArguments &&
          !('query' in normalizedArguments)
        ) {
          const record = normalizedArguments as Record<string, unknown>;
          const query: Record<string, unknown> = {};
          const rest: Record<string, unknown> = {};
          for (const [k, v] of Object.entries(record)) {
            if (QUERY_KEYS.has(k)) {
              query[k] = v;
            } else {
              rest[k] = v;
            }
          }
          finalArguments = { query, ...rest };
        }

        const args = tool.inputSchema.parse(finalArguments);
        const userToken = await provider.getToken(context.validatedToken);
        const toolResult = await tool.execute(args, {
          accessToken: context.token,
          userToken,
          scopes: context.scopes,
          subject: context.subject,
          payload: context.payload,
        });

        // MCP 2025-03-26: tools with outputSchema must return structuredContent.
        // Keep text content alongside for backward compatibility with older clients.
        const outputSchema = tool.specJson?.outputSchema ?? tool.outputSchema;
        const rawStructured =
          toolResult && typeof toolResult === 'object' && !Array.isArray(toolResult)
            ? (toolResult as Record<string, unknown>)
            : { result: toolResult };

        // Coerce Athena string values to the types declared in outputSchema
        // (integers, numbers, booleans, nested objects from JSON strings, etc.)
        const structuredContent = coerceToSchema(rawStructured, outputSchema) as Record<string, unknown>;

        const result: McpToolCallResult = {
          content: [{ type: 'text', text: toText(toolResult) }],
          structuredContent,
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
