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
  isValidIntentIdSlug,
  sqlNullableDouble,
  sqlNullableInt,
  sqlNullableString,
  sqlString,
} from '../_intent_common';

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

function buildMappingsValuesSql(
  rows: Array<{
    id: number;
    companyId: number;
    term: string;
    intentIdSlug: string;
    confidence: number;
    contributionPct: number;
    source: string;
    userId: string;
  }>,
): string {
  return rows
    .map(
      (r) =>
        `(${r.id}, ${r.companyId}, ${sqlString(r.term)}, ${sqlString(r.intentIdSlug)}, ` +
        `${sqlNullableDouble(r.confidence)}, ${sqlNullableDouble(r.contributionPct)}, ` +
        `${sqlString(r.source)}, current_timestamp, ${sqlString(r.userId)})`,
    )
    .join(',\n  ');
}

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
  const insertIntentSqlPath = path.join(__dirname, 'insert_intent.sql');
  const insertMappingsSqlPath = path.join(__dirname, 'insert_mappings.sql');
  const selectAuditSqlPath = path.join(__dirname, 'select_audit.sql');
  const deleteAuditSqlPath = path.join(__dirname, 'delete_audit.sql');
  const insertAuditSqlPath = path.join(__dirname, 'insert_audit.sql');

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
      const catalog = config.athena.catalog;

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
        catalog,
        company_id: companyId,
        intent_id: sqlString(intentIdSlug),
      });
      const checkResult = await runAthenaQuery({
        query: checkSql,
        database: 'brand_analytics_iceberg',
        workGroup: config.athena.workgroup,
        outputLocation: config.athena.outputLocation,
        maxRows: 1,
      });
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
      const insertIntentTemplate = await loadTextFile(insertIntentSqlPath);
      const insertIntentSql = renderSqlTemplate(insertIntentTemplate, {
        catalog,
        id: intentRowId,
        company_id: companyId,
        intent_id: sqlString(intentIdSlug),
        intent_name: sqlString(parsed.intent_name),
        customer_need: sqlString(parsed.customer_need),
        search_term_count: dedupedTerms.length,
        source: sqlString(source),
        clustering_run_id: clusteringRunId == null ? 'NULL' : String(clusteringRunId),
        created_by: sqlString(userId),
      });
      await runAthenaQuery({
        query: insertIntentSql,
        database: 'brand_analytics_iceberg',
        workGroup: config.athena.workgroup,
        outputLocation: config.athena.outputLocation,
        maxRows: 0,
      });

      // Insert mapping rows (if any).
      if (dedupedTerms.length > 0) {
        const insertMappingsTemplate = await loadTextFile(insertMappingsSqlPath);
        // Build distinct ids per row.
        const baseId = generateBigintId();
        const rows = dedupedTerms.map((t, idx) => ({
          id: baseId + idx,
          companyId,
          term: t.term,
          intentIdSlug,
          confidence: t.confidence ?? 0.95,
          contributionPct: t.contribution_pct ?? 1.0,
          source,
          userId,
        }));
        const insertMappingsSql = renderSqlTemplate(insertMappingsTemplate, {
          catalog,
          mappings_values_sql: buildMappingsValuesSql(rows),
        });
        await runAthenaQuery({
          query: insertMappingsSql,
          database: 'brand_analytics_iceberg',
          workGroup: config.athena.workgroup,
          outputLocation: config.athena.outputLocation,
          maxRows: 0,
        });
      }

      // Finalize audit row, if a clustering_run_id is supplied.
      let auditFinalized = false;
      if (clusteringRunId != null) {
        try {
          const selectAuditTemplate = await loadTextFile(selectAuditSqlPath);
          const selectAuditSql = renderSqlTemplate(selectAuditTemplate, {
            catalog,
            run_id: clusteringRunId,
            company_id: companyId,
          });
          const auditRead = await runAthenaQuery({
            query: selectAuditSql,
            database: 'brand_analytics_iceberg',
            workGroup: config.athena.workgroup,
            outputLocation: config.athena.outputLocation,
            maxRows: 1,
          });
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

            const deleteAuditTemplate = await loadTextFile(deleteAuditSqlPath);
            const deleteAuditSql = renderSqlTemplate(deleteAuditTemplate, {
              catalog,
              run_id: clusteringRunId,
              company_id: companyId,
            });
            await runAthenaQuery({
              query: deleteAuditSql,
              database: 'brand_analytics_iceberg',
              workGroup: config.athena.workgroup,
              outputLocation: config.athena.outputLocation,
              maxRows: 0,
            });

            const insertAuditTemplate = await loadTextFile(insertAuditSqlPath);
            const createdAtExpr = createdAtStr
              ? `CAST(${sqlString(createdAtStr)} AS TIMESTAMP)`
              : 'current_timestamp';
            const insertAuditSql = renderSqlTemplate(insertAuditTemplate, {
              catalog,
              run_id: clusteringRunId,
              company_id: companyId,
              operation_type: sqlString(operationType),
              input_search_terms_count: inputCount,
              output_intents_count: nextOutputIntents,
              output_mapping: sqlNullableString(outputMapping),
              llm_model: sqlNullableString(llmModel),
              llm_input_tokens: sqlNullableInt(llmIn ?? null),
              llm_output_tokens: sqlNullableInt(llmOut ?? null),
              created_at_expr: createdAtExpr,
              created_by: sqlString(createdByStr),
            });
            await runAthenaQuery({
              query: insertAuditSql,
              database: 'brand_analytics_iceberg',
              workGroup: config.athena.workgroup,
              outputLocation: config.athena.outputLocation,
              maxRows: 0,
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
