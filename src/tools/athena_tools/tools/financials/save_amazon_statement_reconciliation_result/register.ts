import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { runAthenaQuery } from '../../../../../clients/athena';
import { neonPanelRequest } from '../../../../../clients/neonpanel-api';
import { config } from '../../../../../config';
import type { ToolExecutionContext, ToolRegistry, ToolSpecJson } from '../../../../types';
import { loadTextFile } from '../../../runtime/load-assets';
import { renderSqlTemplate } from '../../../runtime/render-sql';
import { isAppError } from '../../../../../lib/errors';

// ── Types ──────────────────────────────────────────────────────────────────────

type CompaniesWithPermissionResponse = {
  companies?: Array<{
    company_id?: number;
    companyId?: number;
    id?: number;
  }>;
};

// ── SQL helpers ────────────────────────────────────────────────────────────────

function sqlEscapeString(value: string): string {
  return value.replace(/'/g, "''");
}

function sqlStringLiteral(value: string): string {
  return `'${sqlEscapeString(value)}'`;
}

function sqlNullableVarcharExpr(value: string | null | undefined): string {
  if (value === null || value === undefined) return 'CAST(NULL AS VARCHAR)';
  const trimmed = String(value).trim();
  if (trimmed.length === 0) return 'CAST(NULL AS VARCHAR)';
  return sqlStringLiteral(trimmed);
}

function sqlNullableDecimalExpr(value: number | null | undefined): string {
  if (value === null || value === undefined) return 'CAST(NULL AS DECIMAL(18,2))';
  if (!Number.isFinite(value)) return 'CAST(NULL AS DECIMAL(18,2))';
  return `CAST(${value} AS DECIMAL(18,2))`;
}

function sqlBooleanLiteral(value: boolean): string {
  return value ? 'TRUE' : 'FALSE';
}

// ── Zod schemas ────────────────────────────────────────────────────────────────

function pickFirstNonEmptyString(...candidates: Array<unknown>): string | null {
  for (const c of candidates) {
    if (typeof c === 'string') {
      const t = c.trim();
      if (t.length > 0) return t;
    }
  }
  return null;
}

function deriveAuthorName(
  authorNameInput: string | undefined,
  context: ToolExecutionContext,
): { value: string; source: string } {
  const fromInput = pickFirstNonEmptyString(authorNameInput);
  if (fromInput) return { value: fromInput, source: 'author.name' };

  const payload = (context.payload ?? {}) as Record<string, unknown>;
  const fromJwt = pickFirstNonEmptyString(
    payload.name,
    payload.preferred_username,
    payload.email,
    payload.upn,
    payload.nickname,
  );
  if (fromJwt) return { value: fromJwt, source: 'jwt' };

  const fromSub = pickFirstNonEmptyString(context.subject);
  if (fromSub) return { value: fromSub, source: 'sub' };

  return { value: 'unknown', source: 'unknown' };
}

const authorSchema = z
  .object({
    type: z.enum(['user', 'ai', 'system']).default('user'),
    name: z.string().optional(),
    id: z.string().optional(),
  })
  .strict()
  .superRefine((a, ctx) => {
    if (a.type === 'ai') {
      const name = (a.name ?? '').trim();
      if (name.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'author.name is required when author.type is "ai".',
        });
      }
    }
  });

const summarySchema = z
  .object({
    legal_name: z.string().optional(),
    total_income: z.coerce.number(),
    total_expenses: z.coerce.number(),
    total_tax: z.coerce.number(),
    total_transfers: z.coerce.number(),
    status: z.enum(['Match', 'Discrepancy', 'Unknown']),
  })
  .strict();

const detailItemSchema = z
  .object({
    category: z.string().min(1),
    item_description: z.string().min(1),
    debit_amount: z.coerce.number(),
    credit_amount: z.coerce.number(),
    status: z.enum(['Match', 'Discrepancy', 'Unknown']),
    memo: z.string().optional(),
  })
  .strict();

const inputSchema = z
  .object({
    company_id: z.coerce.number().int().min(1),
    year: z.coerce.number().int().min(2020).max(2030),
    author: authorSchema.optional(),
    reason: z.string().min(3),
    dry_run: z.boolean().default(true).optional(),
    write_mode: z.enum(['append', 'replace']).default('append').optional(),
    debug_sql: z.boolean().optional(),
    summary: summarySchema,
    details: z.array(detailItemSchema).min(1).max(500),
  })
  .strict();

// ── Helpers ────────────────────────────────────────────────────────────────────

function toBoolean(value: unknown): boolean {
  if (value === true) return true;
  if (value === false) return false;
  if (typeof value === 'string') {
    const v = value.trim().toLowerCase();
    return v === 'true' || v === '1' || v === 't' || v === 'yes' || v === 'y';
  }
  if (typeof value === 'number') return value !== 0;
  return false;
}

function truncateForDebug(value: string, maxLen: number): string {
  if (value.length <= maxLen) return value;
  return `${value.slice(0, maxLen)}\n-- [truncated]`;
}

async function isAuthorizedForCompany(
  companyId: number,
  context: ToolExecutionContext,
): Promise<boolean> {
  const permission = 'view:quicksight_group.sales_and_marketing_new';
  const permissionResponse = await neonPanelRequest<CompaniesWithPermissionResponse>({
    token: context.userToken,
    path: `/api/v1/permissions/${encodeURIComponent(permission)}/companies`,
  });

  const permittedCompanyIds = (permissionResponse.companies ?? [])
    .map((c) => c.company_id ?? c.companyId ?? c.id)
    .filter((id): id is number => typeof id === 'number' && Number.isFinite(id) && id > 0);

  return permittedCompanyIds.includes(companyId);
}

/**
 * Build a VALUES clause for the detail rows.
 * Column order: category, item_description, debit_amount, credit_amount, status, memo
 */
function buildDetailsValuesSql(details: Array<z.infer<typeof detailItemSchema>>): string {
  return details
    .map((d) => {
      const categoryExpr = sqlNullableVarcharExpr(d.category);
      const descExpr = sqlNullableVarcharExpr(d.item_description);
      const debitExpr = sqlNullableDecimalExpr(d.debit_amount);
      const creditExpr = sqlNullableDecimalExpr(d.credit_amount);
      const statusExpr = sqlNullableVarcharExpr(d.status);
      const memoExpr = sqlNullableVarcharExpr(d.memo ?? null);

      return `(${[categoryExpr, descExpr, debitExpr, creditExpr, statusExpr, memoExpr].join(', ')})`;
    })
    .join(',\n      ');
}

// ── Register ───────────────────────────────────────────────────────────────────

export function registerFinancialsSaveAmazonStatementReconciliationResultTool(
  registry: ToolRegistry,
) {
  const toolJsonPath = path.join(__dirname, 'tool.json');
  const querySqlPath = path.join(__dirname, 'query.sql');
  const insertSummarySqlPath = path.join(__dirname, 'insert_summary.sql');
  const insertDetailsSqlPath = path.join(__dirname, 'insert_details.sql');

  let specJson: ToolSpecJson | undefined;
  try {
    if (fs.existsSync(toolJsonPath)) {
      specJson = JSON.parse(fs.readFileSync(toolJsonPath, 'utf8')) as ToolSpecJson;
    }
  } catch {
    specJson = undefined;
  }

  registry.register({
    name: 'financials_save_amazon_statement_reconciliation_result',
    description:
      'Persist reconciliation results (summary + details) to Iceberg tables. Dry-run by default.',
    isConsequential: true,
    inputSchema,
    outputSchema: specJson?.outputSchema ?? { type: 'object', additionalProperties: true },
    specJson,
    execute: async (args, context) => {
      const parsed = inputSchema.parse(args);
      const companyId = Math.trunc(parsed.company_id);
      const year = Math.trunc(parsed.year);
      const warnings: string[] = [];

      // ── Authorization ──────────────────────────────────────────────
      const authorized = await isAuthorizedForCompany(companyId, context);
      if (!authorized) {
        return {
          dry_run: true,
          accepted_summary: 0,
          accepted_details: 0,
          written_summary: 0,
          written_details: 0,
          items: [],
          meta: { warnings: ['Not authorized for requested company_id.'] },
        };
      }

      const dryRun = parsed.dry_run ?? true;
      const writeMode = parsed.write_mode ?? 'append';
      const debugSql = parsed.debug_sql === true;

      // ── Author / user_id ───────────────────────────────────────────
      const author = parsed.author ?? { type: 'user' as const };
      const derived = deriveAuthorName(author.name, context);
      const resolvedAuthorName = derived.value;
      if (derived.source !== 'author.name') {
        warnings.push(`author.name not provided; using ${derived.source} for user_id.`);
      }

      // ── Common SQL vars ────────────────────────────────────────────
      const userIdSql = sqlNullableVarcharExpr(author.id ?? resolvedAuthorName);
      const reasonSql = sqlStringLiteral(parsed.reason);
      const legalNameSql = sqlNullableVarcharExpr(parsed.summary.legal_name ?? null);
      const totalIncomeSql = sqlNullableDecimalExpr(parsed.summary.total_income);
      const totalExpensesSql = sqlNullableDecimalExpr(parsed.summary.total_expenses);
      const totalTaxSql = sqlNullableDecimalExpr(parsed.summary.total_tax);
      const totalTransfersSql = sqlNullableDecimalExpr(parsed.summary.total_transfers);
      const summaryStatusSql = sqlStringLiteral(parsed.summary.status);
      const detailsValuesSql = buildDetailsValuesSql(parsed.details);

      const faCatalog = config.athena.catalog;
      const faDatabase = config.athena.tables.financialAccountingDatabase;
      const faTableSummaries = config.athena.tables.paymentsSummaries;
      const faTableDetails = config.athena.tables.paymentsTransactionDetails;

      const commonVars = {
        company_id: companyId,
        year,
        user_id_sql: userIdSql,
        reason_sql: reasonSql,
        legal_name_sql: legalNameSql,
        total_income_sql: totalIncomeSql,
        total_expenses_sql: totalExpensesSql,
        total_tax_sql: totalTaxSql,
        total_transfers_sql: totalTransfersSql,
        summary_status_sql: summaryStatusSql,
        details_values_sql: detailsValuesSql,
        fa_catalog: faCatalog,
        fa_database: faDatabase,
        fa_table_summaries: faTableSummaries,
        fa_table_details: faTableDetails,
      };

      // ── Dry-run: validate + preview ────────────────────────────────
      const queryTemplate = await loadTextFile(querySqlPath);
      const renderedQuery = renderSqlTemplate(queryTemplate, commonVars);

      let athenaResult: Awaited<ReturnType<typeof runAthenaQuery>>;
      try {
        athenaResult = await runAthenaQuery({
          query: renderedQuery,
          database: faDatabase,
          workGroup: config.athena.workgroup,
          outputLocation: config.athena.outputLocation,
          maxRows: 600,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown Athena error.';
        const errDetails = isAppError(error)
          ? { code: error.code, details: error.details }
          : undefined;

        return {
          dry_run: true,
          accepted_summary: 0,
          accepted_details: 0,
          written_summary: 0,
          written_details: 0,
          items: [],
          meta: {
            warnings,
            error: {
              message,
              ...(errDetails ? { details: errDetails } : {}),
              rendered_sql_snippet: truncateForDebug(renderedQuery, 8_000),
            },
            ...(debugSql ? { debug: { rendered_sql: renderedQuery } } : {}),
          },
        };
      }

      const previewRows = (athenaResult.rows ?? []) as Array<Record<string, unknown>>;

      const summaryRows = previewRows.filter((r) => r.row_type === 'summary');
      const detailRows = previewRows.filter((r) => r.row_type === 'detail');

      const invalidRows = previewRows.filter((r) => !toBoolean(r.ok));

      const items = previewRows.map((r) => {
        const ok = toBoolean(r.ok);
        return {
          type: r.row_type as string,
          status: ok ? ('ok' as const) : ('error' as const),
          category: r.category ?? undefined,
          item_description: r.item_description ?? undefined,
          message: ok
            ? dryRun
              ? 'Validated (dry run).'
              : 'Validated (ready to write).'
            : 'Validation failed.',
        };
      });

      if (dryRun) {
        return {
          dry_run: true,
          accepted_summary: summaryRows.length,
          accepted_details: detailRows.length,
          written_summary: 0,
          written_details: 0,
          items,
          meta: {
            warnings,
            ...(debugSql ? { debug: { rendered_sql: renderedQuery } } : {}),
          },
        };
      }

      // ── Refuse if validation errors ────────────────────────────────
      if (invalidRows.length > 0) {
        warnings.push(`Refusing to write: ${invalidRows.length} row(s) failed validation.`);
        return {
          dry_run: true,
          accepted_summary: summaryRows.length,
          accepted_details: detailRows.length,
          written_summary: 0,
          written_details: 0,
          items,
          meta: { warnings },
        };
      }

      // ── Replace mode: delete existing rows first ───────────────────
      if (writeMode === 'replace') {
        const deleteSummaryTemplate = await loadTextFile(
          path.join(__dirname, 'delete_summary.sql'),
        );
        const deleteDetailsTemplate = await loadTextFile(
          path.join(__dirname, 'delete_details.sql'),
        );

        const deleteVars = {
          fa_catalog: faCatalog,
          fa_database: faDatabase,
          fa_table_summaries: faTableSummaries,
          fa_table_details: faTableDetails,
          company_id: companyId,
          year,
        };

        const deleteSummaryRendered = renderSqlTemplate(deleteSummaryTemplate, deleteVars);
        const deleteDetailsRendered = renderSqlTemplate(deleteDetailsTemplate, deleteVars);

        await runAthenaQuery({
          query: deleteSummaryRendered,
          database: faDatabase,
          workGroup: config.athena.workgroup,
          outputLocation: config.athena.outputLocation,
          maxRows: 1,
        });

        await runAthenaQuery({
          query: deleteDetailsRendered,
          database: faDatabase,
          workGroup: config.athena.workgroup,
          outputLocation: config.athena.outputLocation,
          maxRows: 1,
        });
      }

      // ── INSERT summary ─────────────────────────────────────────────
      const insertSummaryTemplate = await loadTextFile(insertSummarySqlPath);
      const insertSummaryRendered = renderSqlTemplate(insertSummaryTemplate, commonVars);

      try {
        await runAthenaQuery({
          query: insertSummaryRendered,
          database: faDatabase,
          workGroup: config.athena.workgroup,
          outputLocation: config.athena.outputLocation,
          maxRows: 1,
        });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Unknown Athena error on summary insert.';
        const errDetails = isAppError(error)
          ? { code: error.code, details: error.details }
          : undefined;

        return {
          dry_run: false,
          accepted_summary: summaryRows.length,
          accepted_details: detailRows.length,
          written_summary: 0,
          written_details: 0,
          items,
          meta: {
            warnings,
            error: {
              message,
              ...(errDetails ? { details: errDetails } : {}),
              insert_summary_sql_snippet: truncateForDebug(insertSummaryRendered, 8_000),
            },
          },
        };
      }

      // ── INSERT details ─────────────────────────────────────────────
      const insertDetailsTemplate = await loadTextFile(insertDetailsSqlPath);
      const insertDetailsRendered = renderSqlTemplate(insertDetailsTemplate, commonVars);

      try {
        await runAthenaQuery({
          query: insertDetailsRendered,
          database: faDatabase,
          workGroup: config.athena.workgroup,
          outputLocation: config.athena.outputLocation,
          maxRows: 1,
        });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Unknown Athena error on details insert.';
        const errDetails = isAppError(error)
          ? { code: error.code, details: error.details }
          : undefined;

        return {
          dry_run: false,
          accepted_summary: summaryRows.length,
          accepted_details: detailRows.length,
          written_summary: 1,
          written_details: 0,
          items,
          meta: {
            warnings: [...warnings, 'Summary was written but details insert failed.'],
            error: {
              message,
              ...(errDetails ? { details: errDetails } : {}),
              insert_details_sql_snippet: truncateForDebug(insertDetailsRendered, 8_000),
            },
          },
        };
      }

      // ── Success ────────────────────────────────────────────────────
      return {
        dry_run: false,
        accepted_summary: 1,
        accepted_details: parsed.details.length,
        written_summary: 1,
        written_details: parsed.details.length,
        items: items.map((it) => ({
          ...it,
          message: it.status === 'ok' ? `Written (${writeMode}).` : it.message,
        })),
        meta: {
          warnings,
          ...(debugSql
            ? {
                debug: {
                  rendered_query_sql: renderedQuery,
                  insert_summary_sql: insertSummaryRendered,
                  insert_details_sql: insertDetailsRendered,
                },
              }
            : {}),
        },
      };
    },
  });
}
