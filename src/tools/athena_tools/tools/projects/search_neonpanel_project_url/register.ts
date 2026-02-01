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
  project_name: z.string().optional(),
  ref_number: z.string().optional(),
  project_key: z.string().optional(),
}).refine(
  (data) => data.project_name || data.ref_number || data.project_key,
  {
    message: 'At least one search parameter (project_name, ref_number, or project_key) must be provided',
  }
);

type Input = z.infer<typeof inputSchema>;

// Load tool specification
let specJson: any;
try {
  specJson = JSON.parse(
    fs.readFileSync(path.join(__dirname, 'tool.json'), 'utf-8')
  );
} catch (error) {
  console.error('Failed to load tool.json:', error);
  specJson = {};
}

export function registerSearchNeonpanelProjectUrl(registry: ToolRegistry) {
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

      // Project name filter (case-insensitive partial match)
      let projectNameFilter = '1=1';
      if (input.project_name) {
        const nameLower = input.project_name.toLowerCase();
        projectNameFilter = `LOWER(project_name) LIKE '%${nameLower}%'`;
      }

      // Reference number filter (exact match)
      let refNumberFilter = '1=1';
      if (input.ref_number) {
        refNumberFilter = `ref_number = '${input.ref_number}'`;
      }

      // Project key filter (exact match on project_key column)
      let projectKeyFilter = '1=1';
      if (input.project_key) {
        projectKeyFilter = `project_key = '${input.project_key}'`;
      }

      // Render SQL template
      const templateData = {
        company_filter: companyFilter,
        project_name_filter: projectNameFilter,
        ref_number_filter: refNumberFilter,
        project_key_filter: projectKeyFilter,
      };

      // Load SQL template
      const template = await loadTextFile(path.join(__dirname, 'query.sql'));

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
