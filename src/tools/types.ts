import type { JwtPayload } from 'jsonwebtoken';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

export type ToolAuthMode = 'user' | 'service' | 'hybrid';

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

export interface ToolDefinition<TSchema extends z.ZodTypeAny = z.ZodTypeAny> {
  name: string;
  description: string;
  auth: ToolAuthMode;
  inputSchema: TSchema;
  outputSchema: Record<string, unknown>;
  examples?: ToolExample[];
  execute: (args: z.infer<TSchema>, context: ToolExecutionContext) => Promise<unknown>;
}

export interface ToolListEntry {
  name: string;
  description: string;
  auth: ToolAuthMode;
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  examples?: ToolExample[];
}

export class ToolRegistry {
  private readonly tools = new Map<string, ToolDefinition>();

  register(definition: ToolDefinition): this {
    if (this.tools.has(definition.name)) {
      throw new Error(`Duplicate tool registration: ${definition.name}`);
    }
    this.tools.set(definition.name, definition);
    return this;
  }

  list(): ToolListEntry[] {
    return Array.from(this.tools.values()).map((tool) => {
      const jsonSchema = zodToJsonSchema(tool.inputSchema, {
        name: `${tool.name}Input`,
        target: 'openApi3',
      }) as any;
      
      // Flatten the schema - extract the actual schema from $ref if present
      let inputSchema: Record<string, unknown>;
      if (jsonSchema.$ref && jsonSchema.definitions) {
        const refKey = jsonSchema.$ref.replace('#/definitions/', '');
        inputSchema = jsonSchema.definitions[refKey] || jsonSchema;
      } else {
        inputSchema = jsonSchema;
      }
      
      return {
        name: tool.name,
        description: tool.description,
        auth: tool.auth,
        inputSchema,
        outputSchema: tool.outputSchema,
        examples: tool.examples,
      };
    });
  }

  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }
}
