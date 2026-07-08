import type { JwtPayload } from 'jsonwebtoken';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { config } from '../config';

export type ToolSecurityScheme =
  | {
      type: 'noauth';
    }
  | {
      type: 'oauth2';
      scopes?: string[];
    };

const DEFAULT_MCP_SCOPE = 'neonpanel.mcp';

function getAdvertisedOauthScopes(): string[] {
  const configured = config.neonpanel.requiredScopes;
  if (Array.isArray(configured) && configured.length > 0) {
    return configured;
  }
  return [DEFAULT_MCP_SCOPE];
}

export interface ToolExecutionContext {
  accessToken: string;
  userToken: string;
  scopes: string[];
  subject?: string;
  payload: JwtPayload;
}

export interface ToolExample {
  name: string;
  description?: string;
  arguments: unknown;
}

export interface ToolSpecJson {
  name: string;
  description: string;
  isConsequential?: boolean;
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  examples?: ToolExample[];
}

export interface ToolDefinition<TSchema extends z.ZodTypeAny = z.ZodTypeAny> {
  name: string;
  description: string;
  /**
   * If true, tool is considered consequential (write actions, side effects).
   * ChatGPT may hide consequential tools by default.
   * If omitted, we infer a safe default.
   */
  isConsequential?: boolean;
  inputSchema: TSchema;
  outputSchema: Record<string, unknown>;
  examples?: ToolExample[];
  /**
   * Optional: override the JSON emitted by tools/list (stored in versioned JSON files).
   * This enables a "JSON is the source of truth" workflow while keeping Zod-based
   * runtime validation for tools/call.
   */
  specJson?: ToolSpecJson;
  execute: (args: z.infer<TSchema>, context: ToolExecutionContext) => Promise<unknown>;
}

export interface ToolListEntry {
  name: string;
  description: string;
  _meta?: {
    'openai/visibility'?: 'public' | 'private';
    securitySchemes?: ToolSecurityScheme[];
  };
  annotations?: {
    title?: string;
    readOnlyHint?: boolean;
    idempotentHint?: boolean;
    destructiveHint?: boolean;
    openWorldHint?: boolean;
  };
  /**
   * Tool safety/visibility hints for ChatGPT connectors.
   * We include both camelCase and snake_case to maximize compatibility.
   */
  is_consequential?: boolean;
  isConsequential?: boolean;
  'x-openai-isConsequential'?: boolean;
  inputSchema: Record<string, unknown>;
  // Omitted from tools/list in lean mode (config.mcp.leanToolList) to cut the
  // per-turn tool-schema payload the model must ingest. The server still knows
  // each tool's outputSchema internally for tools/call structured output.
  outputSchema?: Record<string, unknown>;
  examples?: ToolExample[];
}

export class ToolRegistry {
  private readonly tools = new Map<string, ToolDefinition>();

  private normalizeToolInputSchema(schema: unknown): Record<string, unknown> {
    if (!schema || typeof schema !== 'object' || Array.isArray(schema)) {
      return {
        type: 'object',
        properties: {},
        additionalProperties: true,
      };
    }

    const record = schema as Record<string, unknown>;
    if (record.type !== 'object') {
      record.type = 'object';
    }
    return record;
  }

  /**
   * Many tools declare `{ query: { filters, limit, sort, ... } }` but AI clients
   * commonly send `{ filters, limit }` flat — then fail client-side schema validation
   * before the request ever reaches our server.
   *
   * This method promotes `query`'s sub-properties to the top level in the *emitted*
   * inputSchema so clients see the flat shape.  The server-side auto-wrap in
   * `createRpcDispatcher` re-adds the `query` wrapper before Zod validation.
   */
  private flattenQueryWrapper(schema: Record<string, unknown>): Record<string, unknown> {
    const props = schema.properties as Record<string, unknown> | undefined;
    if (!props || typeof props !== 'object') return schema;

    const queryProp = props.query;
    if (!queryProp || typeof queryProp !== 'object') return schema;

    const queryObj = queryProp as Record<string, unknown>;
    const querySubProps = queryObj.properties as Record<string, unknown> | undefined;
    if (!querySubProps || typeof querySubProps !== 'object') return schema;

    // Only flatten when query contains `filters` (the query-pattern indicator).
    if (!querySubProps.filters) return schema;

    // Promote query sub-properties to top level alongside any siblings (e.g. tool_specific).
    const { query: _q, ...otherTopLevelProps } = props;
    const newProps = { ...querySubProps, ...otherTopLevelProps };

    // Merge required arrays: drop 'query', add query's own required fields.
    const oldRequired = Array.isArray(schema.required) ? (schema.required as string[]) : [];
    const queryRequired = Array.isArray(queryObj.required) ? (queryObj.required as string[]) : [];
    const newRequired = [
      ...oldRequired.filter((r: string) => r !== 'query'),
      ...queryRequired,
    ];

    const newSchema: Record<string, unknown> = { ...schema };
    newSchema.properties = newProps;
    newSchema.required = newRequired.length > 0 ? newRequired : undefined;
    // Remove additionalProperties: false since we've restructured the shape.
    delete newSchema.additionalProperties;

    return newSchema;
  }

  private inferConsequentiality(toolName: string): boolean {
    const lowered = toolName.toLowerCase();
    // Conservative: anything that suggests creation/import/write is consequential.
    if (
      lowered.includes('create') ||
      lowered.includes('import') ||
      lowered.includes('delete') ||
      lowered.includes('update') ||
      lowered.includes('write')
    ) {
      return true;
    }
    return false;
  }

  register(definition: ToolDefinition): this {
    if (this.tools.has(definition.name)) {
      throw new Error(`Duplicate tool registration: ${definition.name}`);
    }
    this.tools.set(definition.name, definition);
    return this;
  }

  // In lean mode, cap long descriptions at a sentence/word boundary near the
  // configured max so a few very verbose tools don't dominate the payload.
  // Selection-relevant text lives in the opening sentences; deep usage guidance
  // (workflows, KB links) is what gets trimmed.
  private trimDescription(description: string): string {
    if (!config.mcp.leanToolList) return description;
    const max = config.mcp.toolDescriptionMaxChars;
    if (description.length <= max) return description;
    const head = description.slice(0, max);
    // Prefer to cut at the last sentence end, else last space, within the head.
    const lastStop = Math.max(head.lastIndexOf('. '), head.lastIndexOf('.\n'));
    const cut = lastStop >= max * 0.6 ? lastStop + 1 : (head.lastIndexOf(' ') > 0 ? head.lastIndexOf(' ') : max);
    return description.slice(0, cut).trimEnd() + ' …';
  }

  list(): ToolListEntry[] {
    return Array.from(this.tools.values()).map((tool) => {
      const spec = tool.specJson;

      const jsonSchema =
        spec?.inputSchema ??
        (zodToJsonSchema(tool.inputSchema, {
          name: `${tool.name}Input`,
          target: 'openApi3',
        }) as any);

      // Flatten the schema - extract the actual schema from $ref if present
      let inputSchema: Record<string, unknown>;
      if ((jsonSchema as any).$ref && (jsonSchema as any).definitions) {
        const refKey = (jsonSchema as any).$ref.replace('#/definitions/', '');
        inputSchema = (jsonSchema as any).definitions[refKey] || (jsonSchema as any);
      } else {
        inputSchema = jsonSchema as Record<string, unknown>;
      }

      // Some strict tool validators require the root schema type to be exactly "object".
      // Guard against schemas that flatten to a $ref-only or otherwise non-object shape.
      inputSchema = this.normalizeToolInputSchema(inputSchema);

      // Flatten { query: { filters, limit, ... } } → { filters, limit, ... } in the
      // emitted schema so AI clients can send the simple flat shape.
      inputSchema = this.flattenQueryWrapper(inputSchema);

      const isConsequential =
        spec?.isConsequential ?? tool.isConsequential ?? this.inferConsequentiality(tool.name);
      const oauthScopes = getAdvertisedOauthScopes();
      const lean = config.mcp.leanToolList;

      const entry: ToolListEntry = {
        name: tool.name,
        description: this.trimDescription(spec?.description ?? tool.description),
        _meta: {
          'openai/visibility': isConsequential ? 'private' : 'public',
          securitySchemes: [{ type: 'oauth2', scopes: oauthScopes }],
        },
        annotations: {
          title: tool.name,
          readOnlyHint: !isConsequential,
          idempotentHint: !isConsequential,
          destructiveHint: false,
          openWorldHint: false,
        },
        is_consequential: isConsequential,
        isConsequential,
        'x-openai-isConsequential': isConsequential,
        inputSchema,
      };

      // Lean mode: outputSchema and examples aren't used for tool selection, so
      // omit them from tools/list to shrink the per-turn payload. tools/call
      // still uses the internal outputSchema for structured output.
      if (!lean) {
        entry.outputSchema = spec?.outputSchema ?? tool.outputSchema;
        entry.examples = spec?.examples ?? tool.examples;
      }

      return entry;
    });
  }

  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }
}
