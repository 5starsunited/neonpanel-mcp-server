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
  outputSchema: Record<string, unknown>;
  examples?: ToolExample[];
}

export class ToolRegistry {
  private readonly tools = new Map<string, ToolDefinition>();

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

      const isConsequential =
        spec?.isConsequential ?? tool.isConsequential ?? this.inferConsequentiality(tool.name);
      const oauthScopes = getAdvertisedOauthScopes();
      
      return {
        name: tool.name,
        description: spec?.description ?? tool.description,
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
        outputSchema: spec?.outputSchema ?? tool.outputSchema,
        examples: spec?.examples ?? tool.examples,
      };
    });
  }

  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }
}
