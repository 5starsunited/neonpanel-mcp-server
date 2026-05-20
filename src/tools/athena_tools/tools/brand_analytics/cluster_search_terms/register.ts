import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { runAthenaQuery } from '../../../../../clients/athena';
import { config } from '../../../../../config';
import type { ToolRegistry, ToolSpecJson } from '../../../../types';
import { loadTextFile } from '../../../runtime/load-assets';
import { renderSqlTemplate } from '../../../runtime/render-sql';
import {
  generateBigintId,
  isAuthorizedForCompany,
  sqlString,
} from '../_intent_common';

const inputSchema = z
  .object({
    company_id: z.coerce.number().int().min(1),
    search_terms: z.array(z.string().min(1).max(300)).min(50).max(1000),
    product_category: z.string().max(200).nullable().optional(),
    target_cluster_count: z.coerce.number().int().min(3).max(20).default(9).optional(),
    mode: z
      .enum(['auto', 'use_existing', 'restrict_existing', 'suggest_to_agent'])
      .default('auto')
      .optional(),
  })
  .strict();

const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    intents: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          intent_id: {
            type: 'string',
            description: 'Slug: lowercase letters / digits / underscores, e.g. "plantar_fasciitis_relief".',
          },
          intent_name: { type: 'string' },
          customer_need: { type: 'string' },
          search_terms: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                term: { type: 'string' },
                confidence: { type: 'number', minimum: 0, maximum: 1 },
                contribution_pct: { type: 'number', minimum: 0, maximum: 1 },
              },
              required: ['term', 'confidence'],
            },
          },
        },
        required: ['intent_id', 'intent_name', 'customer_need', 'search_terms'],
      },
    },
  },
  required: ['intents'],
};

function buildInstructions(targetClusters: number, productCategory: string | null): string {
  const categoryHint = productCategory
    ? ` The brand sells in the "${productCategory}" category — use this to inform intent names.`
    : '';
  return [
    `You are clustering raw Amazon search terms into ${targetClusters} or so semantic customer-intent groups.${categoryHint}`,
    '',
    'For each intent produce:',
    '  - intent_id   : a stable slug, lowercase_with_underscores (max 64 chars).',
    '  - intent_name : a short human-readable label (e.g. "Plantar Fasciitis Relief").',
    '  - customer_need : one sentence describing the underlying problem the customer is trying to solve.',
    '  - search_terms : the subset of input terms that belong to this intent, each with a confidence in [0,1].',
    '',
    'Rules:',
    '  1. Every input term should be assigned to at least one intent (target coverage >= 95%).',
    '  2. A term MAY appear in more than one intent if genuinely ambiguous; in that case provide contribution_pct in [0,1] summing to <=1 across intents.',
    '  3. Aim for ~3..20 intents; merge near-duplicates.',
    '  4. Do not invent terms that were not in the input.',
    '',
    'Then persist each intent by calling tool `brand_analytics_create_user_intent_cluster` once per intent, passing `clustering_run_id` returned by this tool, and on the FIRST such call include `llm_audit_payload` with the model id and approximate input/output token counts you used.',
  ].join('\n');
}

function normalizeTerms(terms: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of terms) {
    const t = raw.trim().toLowerCase();
    if (!t) continue;
    if (seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

export function registerBrandAnalyticsClusterSearchTermsTool(registry: ToolRegistry) {
  const toolJsonPath = path.join(__dirname, 'tool.json');
  const auditInsertSqlPath = path.join(__dirname, 'audit_insert.sql');

  let specJson: ToolSpecJson | undefined;
  try {
    if (fs.existsSync(toolJsonPath)) {
      specJson = JSON.parse(fs.readFileSync(toolJsonPath, 'utf8')) as ToolSpecJson;
    }
  } catch {
    specJson = undefined;
  }

  registry.register({
    name: specJson?.name ?? 'brand_analytics_cluster_search_terms',
    description:
      specJson?.description ??
      'Prepares search terms for agent-driven intent clustering and opens an audit row.',
    isConsequential: false,
    inputSchema,
    outputSchema: specJson?.outputSchema ?? { type: 'object', additionalProperties: true },
    specJson,
    execute: async (args, context) => {
      const parsed = inputSchema.parse(args);
      const companyId = parsed.company_id;
      const mode = parsed.mode ?? 'auto';
      const targetClusters = parsed.target_cluster_count ?? 9;
      const productCategory = parsed.product_category ?? null;
      const userId = context.subject ?? 'unknown';
      const catalog = config.athena.catalog;

      const authorized = await isAuthorizedForCompany(companyId, context);
      if (!authorized) {
        return {
          clustering_run_id: 0,
          company_id: companyId,
          prepared_terms: [],
          input_search_terms_count: 0,
          target_cluster_count: targetClusters,
          product_category: productCategory,
          clustering_instructions: '',
          response_schema: {},
          error: 'Not authorized for this company.',
        };
      }

      const preparedTerms = normalizeTerms(parsed.search_terms);
      const runId = generateBigintId();

      const auditTemplate = await loadTextFile(auditInsertSqlPath);
      const auditSql = renderSqlTemplate(auditTemplate, {
        catalog,
        run_id: runId,
        company_id: companyId,
        input_count: preparedTerms.length,
        created_by: sqlString(userId),
      });
      await runAthenaQuery({
        query: auditSql,
        database: 'brand_analytics_iceberg',
        workGroup: config.athena.workgroup,
        outputLocation: config.athena.outputLocation,
        maxRows: 0,
      });

      // If requested, fetch existing intents and example terms to include in instructions
      let existingIntents: Array<{
        intent_id: string;
        intent_name: string;
        customer_need: string | null;
        sample_terms: string[];
      }> = [];
      if (mode !== 'auto') {
        const intentsSql = `
WITH latest_intent AS (
  SELECT
    intent_id,
    intent_name,
    customer_need,
    ROW_NUMBER() OVER (PARTITION BY intent_id ORDER BY created_at DESC, id DESC) AS rn
  FROM "${catalog}"."brand_analytics_iceberg"."user_intents"
  WHERE company_id = ${companyId}
)
SELECT intent_id, intent_name, customer_need
FROM latest_intent
WHERE rn = 1
  AND intent_id IS NOT NULL
`;
        const intentResult = await runAthenaQuery({
          query: intentsSql,
          database: 'brand_analytics_iceberg',
          workGroup: config.athena.workgroup,
          outputLocation: config.athena.outputLocation,
          maxRows: 1000,
        });
        const intentRows = intentResult.rows ?? [];
        // fetch sample terms per intent (top 5 by confidence)
        const mappingSql = `
WITH ranked AS (
  SELECT intent_id, search_term AS term, confidence,
    ROW_NUMBER() OVER (PARTITION BY intent_id ORDER BY confidence DESC) rn
  FROM "${catalog}"."brand_analytics_iceberg"."search_term_to_intent"
  WHERE company_id = ${companyId}
)
SELECT intent_id, term
FROM ranked
WHERE rn <= 5
ORDER BY intent_id, rn
`;
        const mappingResult = await runAthenaQuery({
          query: mappingSql,
          database: 'brand_analytics_iceberg',
          workGroup: config.athena.workgroup,
          outputLocation: config.athena.outputLocation,
          maxRows: 5000,
        });
        const mappingRows = mappingResult.rows ?? [];
        const samplesByIntent = new Map<string, string[]>();
        for (const r of mappingRows) {
          const id = String(r.intent_id ?? '');
          const term = String(r.term ?? '').toLowerCase();
          if (!id) continue;
          const arr = samplesByIntent.get(id) ?? [];
          if (term && !arr.includes(term)) arr.push(term);
          samplesByIntent.set(id, arr);
        }
        for (const r of intentRows) {
          const id = String(r.intent_id ?? '');
          if (!id) continue;
          existingIntents.push({
            intent_id: id,
            intent_name: String(r.intent_name ?? ''),
            customer_need: r.customer_need ?? null,
            sample_terms: samplesByIntent.get(id) ?? [],
          });
        }
      }

      const instructionsExtra =
        existingIntents.length === 0
          ? ''
          : [
              '',
              'Existing intents for this company (prefer assigning terms to these when appropriate):',
              ...existingIntents.map((ei) =>
                `- ${ei.intent_id} : ${ei.intent_name} — examples: ${ei.sample_terms.slice(0,5).join(', ')}`,
              ),
              '',
              mode === 'restrict_existing'
                ? 'NOTE: mode=restrict_existing — do not create new intents. Only map input terms to existing intents.'
                : 'If a term does not fit any existing intent, create a new intent as needed (unless mode=restrict_existing).',
            ].join('\n');

      return {
        clustering_run_id: runId,
        company_id: companyId,
        prepared_terms: preparedTerms,
        input_search_terms_count: preparedTerms.length,
        target_cluster_count: targetClusters,
        product_category: productCategory,
        clustering_instructions: `${buildInstructions(targetClusters, productCategory)}${instructionsExtra}`,
        response_schema: RESPONSE_SCHEMA,
        message: `Pending audit row created (clustering_run_id=${runId}). Cluster the ${preparedTerms.length} terms then call brand_analytics_create_user_intent_cluster per intent.`,
        existing_intents: existingIntents,
        next_steps: [
          `Run your LLM with the returned clustering_instructions + response_schema to produce ~${targetClusters} intent proposals from prepared_terms.`,
          `For each proposed intent, call brand_analytics_create_user_intent_cluster with company_id=${companyId} and clustering_run_id=${runId}. Include llm_audit_payload on the FIRST call only (model + token counts).`,
          `When all intents are persisted, call brand_analytics_list_user_intent_clusters(company_id=${companyId}) to verify.`,
        ],
      };
    },
  });
}
