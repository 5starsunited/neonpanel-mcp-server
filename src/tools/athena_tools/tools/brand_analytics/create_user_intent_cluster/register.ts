import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import type { ToolRegistry, ToolSpecJson } from '../../../../types';
import { loadTextFile } from '../../../runtime/load-assets';
import { renderSqlTemplate } from '../../../runtime/render-sql';
import {
  executeBrandAnalyticsQuery,
  insertBrandAnalyticsState,
  nowVersion,
  sqlStringLiteral,
} from '../_clickhouse';
import { generateBigintId, isAuthorizedForCompany, isValidIntentIdSlug } from '../_intent_common';

const INTENTS_TABLE = 'analytics.ba_user_intents';
const INTENTS_COLUMNS = [
  'id',
  'company_id',
  'intent_id',
  'intent_name',
  'customer_need',
  'status',
  'search_term_count',
  'source',
  'clustering_run_id',
  'created_at',
  'created_by',
  'is_active',
  'version',
];

const MAPPINGS_TABLE = 'analytics.ba_search_term_to_intent';
const MAPPINGS_COLUMNS = [
  'id',
  'company_id',
  'search_term',
  'intent_id',
  'confidence',
  'contribution_pct',
  'source',
  'created_at',
  'created_by',
  'is_active',
  'version',
];

const AUDIT_TABLE = 'analytics.ba_intent_cluster_audit';
const AUDIT_COLUMNS = [
  'id',
  'company_id',
  'operation_type',
  'status',
  'input_search_terms_count',
  'output_intents_count',
  'output_mapping',
  'llm_model',
  'llm_input_tokens',
  'llm_output_tokens',
  'created_at',
  'created_by',
  'is_active',
  'version',
];

const searchTermItem = z.object({
  term: z.string().min(1).max(300),
  confidence: z.coerce.number().min(0).max(1).default(0.95).optional(),
  contribution_pct: z.coerce.number().min(0).max(1).default(1.0).optional(),
});

const llmAuditPayloadSchema = z
  .object({
    llm_model: z.string().max(100).optional(),
    llm_input_tokens: z.coerce.number().int().min(0).optional(),
    llm_output_tokens: z.coerce.number().int().min(0).optional(),
    output_mapping: z.record(z.unknown()).optional(),
  })
  .strict();

const inputSchema = z
  .object({
    company_id: z.coerce.number().int().min(1),
    intent_id: z.string().min(1).max(64),
    intent_name: z.string().min(1).max(200),
    customer_need: z.string().min(1).max(1000),
    source: z.enum(['manual', 'llm_proposed', 'imported']).default('manual').optional(),
    clustering_run_id: z.coerce.number().int().min(1).nullable().optional(),
    dry_run: z.boolean().default(true).optional(),
    search_terms: z.array(searchTermItem).min(0).max(1000),
    llm_audit_payload: llmAuditPayloadSchema.nullable().optional(),
  })
  .strict();

type WriteItem = z.infer<typeof searchTermItem>;

function dedupSearchTerms(items: WriteItem[]): WriteItem[] {
  const seen = new Set<string>();
  const out: WriteItem[] = [];
  for (const it of items) {
    const term = it.term.trim().toLowerCase();
    if (!term || seen.has(term)) continue;
    seen.add(term);
    out.push({ ...it, term });
  }
  return out;
}

export function registerBrandAnalyticsCreateUserIntentClusterTool(registry: ToolRegistry) {
  const toolJsonPath = path.join(__dirname, 'tool.json');
  const checkSqlPath = path.join(__dirname, 'check_intent_id.sql');
  const selectAuditSqlPath = path.join(__dirname, 'select_audit.sql');

  let specJson: ToolSpecJson | undefined;
  try {
    if (fs.existsSync(toolJsonPath)) {
      specJson = JSON.parse(fs.readFileSync(toolJsonPath, 'utf8')) as ToolSpecJson;
    }
  } catch {
    specJson = undefined;
  }

  registry.register({
    name: specJson?.name ?? 'brand_analytics_create_user_intent_cluster',
    description:
      specJson?.description ??
      'Creates an intent cluster (a row in user_intents + N rows in search_term_to_intent).',
    isConsequential: true,
    inputSchema,
    outputSchema: specJson?.outputSchema ?? { type: 'object', additionalProperties: true },
    specJson,
    execute: async (args, context) => {
      const parsed = inputSchema.parse(args);
      const companyId = parsed.company_id;
      const intentIdSlug = parsed.intent_id;
      const dryRun = parsed.dry_run !== false;
      const source = parsed.source ?? 'manual';
      const clusteringRunId = parsed.clustering_run_id ?? null;
      const userId = context.subject ?? 'unknown';
      // One request-scoped version stamps the intent, its mappings and the audit
      // row so a partially applied write is identifiable after the fact.
      const version = nowVersion();

      if (!isValidIntentIdSlug(intentIdSlug)) {
        return {
          dry_run: dryRun,
          error: `intent_id must match ^[a-z0-9][a-z0-9_]{0,63}$ (got: ${JSON.stringify(intentIdSlug)}).`,
        };
      }

      const authorized = await isAuthorizedForCompany(companyId, context);
      if (!authorized) {
        return { dry_run: dryRun, error: 'Not authorized for this company.' };
      }

      const dedupedTerms = dedupSearchTerms(parsed.search_terms);

      if (dryRun) {
        return {
          dry_run: true,
          intent_id: intentIdSlug,
          intent_name: parsed.intent_name,
          search_term_count: dedupedTerms.length,
          clustering_run_id: clusteringRunId,
          audit_finalized: false,
          message: `Dry run: would create intent "${intentIdSlug}" with ${dedupedTerms.length} mapped search term(s). Set dry_run=false to persist.`,
          next_steps: [
            'Review the proposed intent with the user.',
            `Re-call this tool with dry_run=false to persist intent "${intentIdSlug}".`,
          ],
        };
      }

      // Uniqueness pre-check.
      const checkTemplate = await loadTextFile(checkSqlPath);
      const checkSql = renderSqlTemplate(checkTemplate, {
        company_id: companyId,
        intent_id: sqlStringLiteral(intentIdSlug),
      });
      const checkResult = await executeBrandAnalyticsQuery(checkSql);
      const existingCountRaw = checkResult.rows?.[0]?.existing_count ?? '0';
      const existingCount = Number.parseInt(String(existingCountRaw), 10) || 0;
      if (existingCount > 0) {
        return {
          dry_run: false,
          intent_id: intentIdSlug,
          intent_name: parsed.intent_name,
          search_term_count: 0,
          clustering_run_id: clusteringRunId,
          audit_finalized: false,
          error: `intent_id "${intentIdSlug}" already exists for company_id=${companyId}. Choose a different slug or archive the existing intent first.`,
        };
      }

      // Insert the intent row.
      const intentRowId = generateBigintId();
      await insertBrandAnalyticsState({
        table: INTENTS_TABLE,
        columns: INTENTS_COLUMNS,
        rows: [
          {
            id: intentRowId,
            company_id: companyId,
            intent_id: intentIdSlug,
            intent_name: parsed.intent_name,
            customer_need: parsed.customer_need,
            status: 'active',
            search_term_count: dedupedTerms.length,
            source,
            clustering_run_id: clusteringRunId,
            created_at: version,
            created_by: userId,
            is_active: 1,
            version,
          },
        ],
      });

      // Insert mapping rows (if any). The intent row is already durable, so a
      // failure here is surfaced as a partial write rather than rolled back.
      if (dedupedTerms.length > 0) {
        const baseId = generateBigintId();
        try {
          await insertBrandAnalyticsState({
            table: MAPPINGS_TABLE,
            columns: MAPPINGS_COLUMNS,
            rows: dedupedTerms.map((t, idx) => ({
              id: baseId + idx,
              company_id: companyId,
              search_term: t.term,
              intent_id: intentIdSlug,
              confidence: t.confidence ?? 0.95,
              contribution_pct: t.contribution_pct ?? 1.0,
              source,
              created_at: version,
              created_by: userId,
              is_active: 1,
              version,
            })),
          });
        } catch (err) {
          return {
            dry_run: false,
            id: intentRowId,
            intent_id: intentIdSlug,
            intent_name: parsed.intent_name,
            search_term_count: 0,
            clustering_run_id: clusteringRunId,
            audit_finalized: false,
            error:
              `Partial write: intent "${intentIdSlug}" was created (id=${intentRowId}) but its ` +
              `${dedupedTerms.length} search-term mapping(s) failed to persist: ` +
              `${err instanceof Error ? err.message : String(err)}. ` +
              `Re-run with the same intent_id after archiving the orphaned intent, or add the mappings separately.`,
          };
        }
      }

      // Finalize audit row, if a clustering_run_id is supplied.
      let auditFinalized = false;
      if (clusteringRunId != null) {
        try {
          const selectAuditTemplate = await loadTextFile(selectAuditSqlPath);
          const selectAuditSql = renderSqlTemplate(selectAuditTemplate, {
            run_id: clusteringRunId,
            company_id: companyId,
          });
          const auditRead = await executeBrandAnalyticsQuery(selectAuditSql);
          const existing = auditRead.rows?.[0];
          if (existing) {
            const payload = parsed.llm_audit_payload ?? null;
            const prevOutputIntents = Number.parseInt(String(existing.output_intents_count ?? '0'), 10) || 0;
            const nextOutputIntents = prevOutputIntents + 1;
            const inputCount = Number.parseInt(String(existing.input_search_terms_count ?? '0'), 10) || 0;
            const operationType = String(existing.operation_type ?? 'cluster_with_llm');
            const createdAtStr = String(existing.created_at ?? '');
            const createdByStr = String(existing.created_by ?? userId);

            // Prefer new llm fields from payload, otherwise keep previous values.
            const llmModel = payload?.llm_model ?? (existing.llm_model == null ? null : String(existing.llm_model));
            const llmIn = payload?.llm_input_tokens ?? (existing.llm_input_tokens == null ? null : Number.parseInt(String(existing.llm_input_tokens), 10));
            const llmOut = payload?.llm_output_tokens ?? (existing.llm_output_tokens == null ? null : Number.parseInt(String(existing.llm_output_tokens), 10));
            const outputMapping = payload?.output_mapping
              ? JSON.stringify(payload.output_mapping)
              : existing.output_mapping == null
                ? null
                : String(existing.output_mapping);

            // Re-insert the same (company_id, id) with a newer version; the
            // ReplacingMergeTree collapses it onto the pending row.
            await insertBrandAnalyticsState({
              table: AUDIT_TABLE,
              columns: AUDIT_COLUMNS,
              rows: [
                {
                  id: clusteringRunId,
                  company_id: companyId,
                  operation_type: operationType,
                  status: 'completed',
                  input_search_terms_count: inputCount,
                  output_intents_count: nextOutputIntents,
                  output_mapping: outputMapping ?? '',
                  llm_model: llmModel ?? '',
                  llm_input_tokens: llmIn ?? null,
                  llm_output_tokens: llmOut ?? null,
                  created_at: createdAtStr || version,
                  created_by: createdByStr,
                  is_active: 1,
                  version,
                },
              ],
            });
            auditFinalized = true;
          }
        } catch {
          // Audit finalization is best-effort; the intent has already been persisted.
          auditFinalized = false;
        }
      }

      return {
        dry_run: false,
        id: intentRowId,
        intent_id: intentIdSlug,
        intent_name: parsed.intent_name,
        search_term_count: dedupedTerms.length,
        clustering_run_id: clusteringRunId,
        audit_finalized: auditFinalized,
        message: `Intent "${intentIdSlug}" created for company_id=${companyId} with ${dedupedTerms.length} mapped search term(s).`,
        next_steps: clusteringRunId == null
          ? [
              `Call brand_analytics_list_user_intent_clusters(company_id=${companyId}) to verify.`,
            ]
          : [
              `If more proposed intents remain for clustering_run_id=${clusteringRunId}, call this tool again per intent (same clustering_run_id; do NOT resend llm_audit_payload).`,
              `When all intents are persisted, call brand_analytics_list_user_intent_clusters(company_id=${companyId}) to verify.`,
            ],
      };
    },
  });
}
