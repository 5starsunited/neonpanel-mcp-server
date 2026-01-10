import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import type { ToolRegistry, ToolSpecJson } from '../../../types';
import {
  executeFbaListReplenishAsap,
  fbaListReplenishAsapInputSchema,
} from '../fba_list_replenish_asap/register';

function toInt(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.trunc(n);
}

function hasOwn(obj: unknown, key: string): boolean {
  if (!obj || typeof obj !== 'object') return false;
  return Object.prototype.hasOwnProperty.call(obj, key);
}

const sharedQuerySchema = z
  .object({
    filters: z
      .object({
        company: z.string().optional(),
        company_id: z.coerce.number().int().min(1).optional(),
        brand: z.array(z.string()).optional(),
        marketplace: z.array(z.string()).optional(),
        currency: z.array(z.string()).optional(),
        product_family: z.array(z.string()).optional(),
        parent_asin: z.array(z.string()).optional(),
        asin: z.array(z.string()).optional(),
        sku: z.array(z.string()).optional(),
        revenue_abcd_class: z.array(z.enum(['A', 'B', 'C', 'D'])).optional(),
        pareto_abc_class: z.array(z.enum(['A', 'B', 'C'])).optional(),
        tags: z.array(z.string()).optional(),
      })
      .catchall(z.unknown())
      .optional(),
    aggregation: z
      .object({
        group_by: z.array(z.string()).optional(),
        time: z
          .object({
            periodicity: z.enum(['day', 'week', 'month', 'quarter', 'year']).optional(),
            start_date: z.string().optional(),
            end_date: z.string().optional(),
          })
          .optional(),
      })
      .optional(),
    sort: z
      .object({
        field: z.string().optional(),
        direction: z.enum(['asc', 'desc']).default('desc').optional(),
        nulls: z.enum(['first', 'last']).default('last').optional(),
      })
      .optional(),
    select_fields: z.array(z.string()).optional(),
    limit: z.coerce.number().int().min(1).default(50).optional(),
    cursor: z.string().optional(),
  })
  .strict();

type SharedQuery = z.infer<typeof sharedQuerySchema>;

// tool_specific is a backward-compatible "shadow" of the legacy input.
// We validate it strictly, but keep most fields optional so query can drive defaults.
const toolSpecificSchema = fbaListReplenishAsapInputSchema
  .partial()
  .extend({
    planning_base: z
      .enum(['all', 'targeted_only', 'actively_sold_only', 'planned_only'])
      .default('actively_sold_only'),
  })
  .strict();

type ToolSpecific = z.infer<typeof toolSpecificSchema>;

const inputSchema = z
  .object({
    query: sharedQuerySchema,
    tool_specific: toolSpecificSchema.optional(),
  })
  .strict();

const outputSchema = {
  type: 'object',
  properties: {
    items: { type: 'array', items: { type: 'object', additionalProperties: true } },
    meta: {
      type: 'object',
      properties: {
        applied_sort: { type: 'object', additionalProperties: true },
        selected_fields: { type: 'array', items: { type: 'string' } },
        included_fields: { type: 'array', items: { type: 'string' } },
        warnings: { type: 'array', items: { type: 'string' } },
      },
      additionalProperties: true,
    },
  },
  required: ['items'],
};

function mergeInputs(
  query: SharedQuery,
  toolSpecific: ToolSpecific,
  toolSpecificRaw: unknown,
): { merged: Record<string, unknown>; warnings: string[] } {
  const warnings: string[] = [];
  const filters = query.filters ?? {};

  const merged: Record<string, unknown> = { ...toolSpecific };

  // company / company_id
  if (!hasOwn(toolSpecificRaw, 'company_id') && merged.company_id === undefined) {
    if (typeof (filters as any).company_id === 'number') {
      merged.company_id = (filters as any).company_id;
    } else if (typeof (filters as any).company === 'string') {
      const asInt = toInt((filters as any).company);
      if (asInt && asInt > 0) {
        merged.company_id = asInt;
      } else {
        warnings.push('query.filters.company is not supported unless it is a numeric company_id; pass query.filters.company_id instead.');
      }
    }
  }

  // selector filters
  if (!hasOwn(toolSpecificRaw, 'brand') && merged.brand === undefined && Array.isArray((filters as any).brand)) {
    merged.brand = (filters as any).brand;
  }

  if (!hasOwn(toolSpecificRaw, 'target_skus') && merged.target_skus === undefined && Array.isArray((filters as any).sku)) {
    merged.target_skus = (filters as any).sku;
    if (!hasOwn(toolSpecificRaw, 'planning_base') && merged.planning_base === undefined) merged.planning_base = 'targeted_only';
  }

  if (!hasOwn(toolSpecificRaw, 'target_asins') && merged.target_asins === undefined && Array.isArray((filters as any).asin)) {
    merged.target_asins = (filters as any).asin;
    if (!hasOwn(toolSpecificRaw, 'planning_base') && merged.planning_base === undefined) merged.planning_base = 'targeted_only';
  }

  if (!hasOwn(toolSpecificRaw, 'marketplaces') && merged.marketplaces === undefined && Array.isArray((filters as any).marketplace)) {
    const raw = (filters as any).marketplace as unknown[];
    const normalized = raw
      .map((v) => (typeof v === 'string' ? v.trim().toUpperCase() : ''))
      .filter((v) => v.length > 0);
    const allowed = normalized.filter((v) => v === 'US' || v === 'UK' || v === 'ALL');
    const unknown = normalized.filter((v) => v && !allowed.includes(v));
    if (unknown.length > 0) {
      warnings.push(`query.filters.marketplace contains unsupported values: ${unknown.join(', ')}`);
    }
    if (allowed.length > 0) merged.marketplaces = allowed as any;
  }

  // shared knobs
  if (!hasOwn(toolSpecificRaw, 'limit') && typeof query.limit === 'number') {
    merged.limit = query.limit;
  }

  if (query.cursor) {
    warnings.push('query.cursor is not supported for this tool (no pagination cursor).');
  }

  if (query.select_fields && query.select_fields.length > 0) {
    warnings.push('query.select_fields is not supported yet; returning default fields.');
  }

  if (query.sort && (query.sort.field || query.sort.direction || query.sort.nulls)) {
    warnings.push('query.sort is not supported yet; returning default ordering.');
  }

  const groupBy = query.aggregation?.group_by;
  if (Array.isArray(groupBy) && groupBy.length > 0 && !(groupBy.length === 1 && groupBy[0] === 'none')) {
    warnings.push('query.aggregation.group_by is not supported for this tool; returning SKU-level rows.');
  }

  if (query.aggregation?.time) {
    warnings.push('query.aggregation.time is not supported for this tool; using latest snapshot only.');
  }

  // Warn on common unsupported filters when present.
  const unsupportedFilterKeys = ['currency', 'product_family', 'parent_asin', 'revenue_abcd_class', 'pareto_abc_class', 'tags'];
  for (const key of unsupportedFilterKeys) {
    if ((filters as any)[key] !== undefined) {
      warnings.push(`query.filters.${key} is not supported for this tool yet.`);
    }
  }

  return { merged, warnings };
}

export function registerSupplyChainListFbaReplenishmentCandidatesTool(registry: ToolRegistry) {
  const toolJsonPath = path.join(__dirname, 'tool.json');

  let specJson: ToolSpecJson | undefined;
  try {
    if (fs.existsSync(toolJsonPath)) {
      specJson = JSON.parse(fs.readFileSync(toolJsonPath, 'utf8')) as ToolSpecJson;
    }
  } catch {
    specJson = undefined;
  }

  registry.register({
    name: 'supply_chain_list_fba_replenishment_candidates',
    description:
      'List items needing FBA replenishment based on projected stockout risk and inbound coverage (query envelope; preferred).',
    isConsequential: false,
    inputSchema,
    outputSchema: specJson?.outputSchema ?? outputSchema,
    specJson,
    execute: async (args, context) => {
      const parsed = inputSchema.parse(args);
      const rawToolSpecific = (parsed.tool_specific ?? {}) as unknown;
      const toolSpecificParsed = toolSpecificSchema.parse(rawToolSpecific);

      const { merged, warnings } = mergeInputs(parsed.query, toolSpecificParsed, rawToolSpecific);

      // Convert merged args to the legacy tool's strict schema (to guarantee runtime safety).
      const legacyParsed = fbaListReplenishAsapInputSchema.parse(merged);
      const result = await executeFbaListReplenishAsap(legacyParsed, context);

      return {
        items: result.items ?? [],
        meta: {
          warnings,
          applied_sort: parsed.query.sort ?? null,
          selected_fields: parsed.query.select_fields ?? null,
        },
      };
    },
  });
}
