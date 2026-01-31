import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { z } from 'zod';
import type { ToolExecutionContext, ToolRegistry, ToolSpecJson } from '../../../../types';

// Define Zod input schema
const inputSchema = z.object({
  historical_data: z.array(z.object({
    period: z.string(),
    units_sold: z.number(),
    sales_amount: z.number().optional()
  })).min(3).max(60),
  forecast_config: z.object({
    methods: z.array(z.string()).optional(),
    horizon_months: z.number().int().min(1).max(24).optional(),
    start_period: z.string().optional(),
    seasonality_pattern: z.string().optional(),
    availability_growth_annual: z.number().optional()
  }).optional(),
  item_metadata: z.object({
    sku: z.string().optional(),
    currency: z.string().optional(),
    marketplace: z.string().optional()
  }).optional()
});

// Fallback output schema (JSON Schema format)
const fallbackOutputSchema = { type: 'object', additionalProperties: true } as const;

type ForecastInput = z.infer<typeof inputSchema>;

async function handler(
  args: unknown,
  context: ToolExecutionContext
): Promise<unknown> {
  const params = inputSchema.parse(args);
    // Validate input
    if (!params.historical_data || params.historical_data.length < 3) {
      throw new Error('historical_data must contain at least 3 months of data');
    }

    // Ensure sales_amount is calculated if missing
    const enrichedData = params.historical_data.map(row => ({
      period: row.period,
      units_sold: row.units_sold,
      sales_amount: row.sales_amount ?? 0
    }));

    const input: ForecastInput = {
      historical_data: enrichedData,
      forecast_config: params.forecast_config || {},
      item_metadata: params.item_metadata || {}
    };

    // Call Python forecast engine
    const pythonScript = path.join(__dirname, 'forecast_engine.py');
    
    return new Promise((resolve, reject) => {
      const python = spawn('python3', [pythonScript]);
      
      let stdoutData = '';
      let stderrData = '';

      python.stdout.on('data', (data) => {
        stdoutData += data.toString();
      });

      python.stderr.on('data', (data) => {
        stderrData += data.toString();
      });

      python.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(`Python forecast engine failed with code ${code}: ${stderrData}`));
          return;
        }

        try {
          const result = JSON.parse(stdoutData);
          
          if (!result.success) {
            reject(new Error(`Forecast generation failed: ${result.error} (${result.error_type})`));
            return;
          }

          resolve(result);
        } catch (error) {
          reject(new Error(`Failed to parse Python output: ${error}\n\nStdout: ${stdoutData}\n\nStderr: ${stderrData}`));
        }
      });

      python.on('error', (error) => {
        reject(new Error(`Failed to spawn Python process: ${error.message}`));
      });

      // Send input data to Python via stdin
      python.stdin.write(JSON.stringify(input));
      python.stdin.end();
    });
}

/**
 * Register the tool with the registry.
 */
export function registerForecastingGenerateSalesForecastTool(registry: ToolRegistry): void {
  const toolSpecPath = path.join(__dirname, 'tool.json');
  let toolSpec: ToolSpecJson | undefined;
  
  try {
    if (fs.existsSync(toolSpecPath)) {
      toolSpec = JSON.parse(fs.readFileSync(toolSpecPath, 'utf8'));
    }
  } catch {
    toolSpec = undefined;
  }
  
  registry.register({
    name: 'forecasting_generate_sales_forecast',
    description: 'Generate on-demand sales forecasts using multiple statistical methods',
    isConsequential: false,
    inputSchema,
    outputSchema: toolSpec?.outputSchema ?? fallbackOutputSchema,
    specJson: toolSpec,
    execute: handler
  });
}
