import * as fs from 'fs';
import * as path from 'path';
import { z } from 'zod';
import type { ToolExecutionContext, ToolRegistry } from '../../../../types';
import { loadTextFile } from '../../../runtime/load-assets';
import { renderSqlTemplate } from '../../../runtime/render-sql';
import { runAthenaQuery } from '../../../../../clients/athena';
import { config } from '../../../../../config';

const inputSchema = z.object({
  company_id: z.array(z.number().int()).min(1),
  search: z.string().optional(),
  project_name: z.string().optional(),
  project_ref_number: z.string().optional(),
  project_key: z.string().optional(),
}).refine(
  (data) => data.search || data.project_name || data.project_ref_number || data.project_key,
  {
    message: 'At least one search parameter (search, project_name, project_ref_number, or project_key) must be provided',
  }
);

type Input = z.infer<typeof inputSchema>;

export function registerSearchNeonpanelProjectUrl(registry: ToolRegistry) {
  const toolJsonPath = path.join(__dirname, 'tool.json');
  const sqlPath = path.join(__dirname, 'query.sql');

  let specJson: any;
  try {
    if (fs.existsSync(toolJsonPath)) {
      specJson = JSON.parse(fs.readFileSync(toolJsonPath, 'utf-8'));
    }
  } catch {
    specJson = undefined;
  }

  registry.register({
    name: 'search_neonpanel_project_url',
    description: 'Search for NeonPanel projects by name, reference number, or project key',
    inputSchema,
    outputSchema: { type: 'object', additionalProperties: true },
    specJson,
    execute: async (args, context: ToolExecutionContext) => {
      const input = inputSchema.parse(args);
      // Build filter expressions
      const companyList = input.company_id.join(', ');
      const companyFilter = `company_id IN (${companyList})`;

      // General search across all fields (if provided, this takes precedence)
      let projectNameFilter = '1=1';
      let refNumberFilter = '1=1';
      let projectKeyFilter = '1=1';

      if (input.search) {
        // Search term appears in any of the three fields
        const searchLower = input.search.toLowerCase();
        projectNameFilter = `LOWER(project_name) LIKE '%${searchLower}%'`;
        refNumberFilter = `LOWER(project_ref_number) LIKE '%${searchLower}%'`;
        projectKeyFilter = `LOWER(project_key) LIKE '%${searchLower}%'`;
      } else {
        // Specific field searches
        // Project name filter (case-insensitive partial match)
        if (input.project_name) {
          const nameLower = input.project_name.toLowerCase();
          projectNameFilter = `LOWER(project_name) LIKE '%${nameLower}%'`;
        }

        // Reference number filter (exact match)
        if (input.project_ref_number) {
          refNumberFilter = `project_ref_number = '${input.project_ref_number}'`;
        }

        // Project key filter (exact match on project_key column)
        if (input.project_key) {
          projectKeyFilter = `project_key = '${input.project_key}'`;
        }
      }

      // Render SQL template
      const templateData = {
        company_filter: companyFilter,
        search_mode: input.search ? 'OR' : 'AND',
        project_name_filter: projectNameFilter,
        ref_number_filter: refNumberFilter,
        project_key_filter: projectKeyFilter,
      };

      // Load SQL template
      const template = await loadTextFile(sqlPath);

      const sql = renderSqlTemplate(template, templateData);

      // Execute query
      const result = await runAthenaQuery({
        query: sql,
        database: config.athena.database,
        workGroup: config.athena.workgroup,
        outputLocation: config.athena.outputLocation,
      });

      return {
        items: result.rows || [],
        meta: {
          query: input,
          row_count: result.rows?.length || 0,
        },
      };
    },
  });
}
