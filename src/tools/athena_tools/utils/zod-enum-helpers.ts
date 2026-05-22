/**
 * Zod schema helpers for enhanced enum validation with friendly error messages.
 * Provides "did you mean" suggestions and clear documentation of valid values.
 */

import { z } from 'zod';

/**
 * Calculate Levenshtein distance for "did you mean" suggestions.
 * Used to find the closest valid enum value to an invalid input.
 */
function levenshteinDistance(a: string, b: string): number {
  const matrix: number[][] = [];
  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }
  return matrix[b.length][a.length];
}

/**
 * Find the closest valid value for a misspelled enum value.
 * Returns null if no close match found (distance > threshold).
 */
function findClosestMatch(
  provided: string,
  validValues: string[],
  threshold: number = 2
): string | null {
  let closest: { value: string; distance: number } | null = null;
  for (const value of validValues) {
    const distance = levenshteinDistance(provided.toLowerCase(), value.toLowerCase());
    if (distance <= threshold && (!closest || distance < closest.distance)) {
      closest = { value, distance };
    }
  }
  return closest?.value ?? null;
}

/**
 * Enhanced group_by enum schema with smart validation errors.
 * Provides suggestions for misspelled values and clear list of valid options.
 *
 * @param validValues - Array of valid enum values (e.g., ['intent', 'company', 'marketplace'])
 * @param context - Optional context for the error message (e.g., "for aggregation")
 * @returns Zod schema with custom error messages
 */
export function createGroupByEnumSchema(validValues: string[], context: string = '') {
  return z
    .array(z.string())
    .superRefine((val, ctx) => {
      const invalidValues: string[] = [];
      const suggestions: Map<string, string> = new Map();

      for (const item of val) {
        if (!validValues.includes(item)) {
          invalidValues.push(item);
          const closest = findClosestMatch(item, validValues);
          if (closest) {
            suggestions.set(item, closest);
          }
        }
      }

      if (invalidValues.length > 0) {
        const messageLines: string[] = [];
        messageLines.push(
          `Invalid group_by value(s): ${invalidValues.map((v) => `'${v}'`).join(', ')}.`
        );

        // Add suggestions
        for (const [provided, suggested] of suggestions) {
          messageLines.push(`  • Did you mean '${suggested}' instead of '${provided}'?`);
        }

        messageLines.push(`Valid values: ${validValues.join(', ')}.`);

        // Add context about output columns if provided
        if (context) {
          messageLines.push(`\nWhen grouped by dimension, output columns are returned as specified in the tool documentation.`);
        }

        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: messageLines.join('\n'),
        });
      }
    });
}

/**
 * Create a detailed error message for invalid aggregation parameters.
 * Includes field path, provided value, valid values, and suggestions.
 *
 * @param fieldPath - Dot-notation path to the field (e.g., "aggregation.group_by")
 * @param providedValue - The value the user provided
 * @param validValues - Array of valid values
 * @param outputColumnMap - Optional map of valid value → output columns
 * @returns Formatted error message
 */
export function buildAggregationErrorMessage(
  fieldPath: string,
  providedValue: unknown,
  validValues: string[],
  outputColumnMap?: Record<string, string[]>
): string {
  const lines: string[] = [];
  const provided = String(providedValue);

  lines.push(`Invalid ${fieldPath} parameter: '${provided}'.`);

  // Add suggestion if close match found
  const suggestion = findClosestMatch(provided, validValues);
  if (suggestion) {
    lines.push(`Did you mean '${suggestion}'?`);
    if (outputColumnMap && outputColumnMap[suggestion]) {
      lines.push(`\n'${suggestion}' returns columns: ${outputColumnMap[suggestion].join(', ')}.`);
    }
  }

  lines.push(`\nValid values: ${validValues.join(', ')}.`);

  if (outputColumnMap) {
    lines.push('\nOutput columns by dimension:');
    for (const [dim, cols] of Object.entries(outputColumnMap)) {
      lines.push(`  • '${dim}' → ${cols.join(', ')}`);
    }
  }

  return lines.join('\n');
}

/**
 * Create a helpful error message for validation errors.
 * Wraps ZodError with user-friendly messaging.
 */
export function formatValidationError(error: z.ZodError, includeDetails: boolean = true): string {
  const lines: string[] = [];
  lines.push('Validation failed:');

  for (const issue of error.errors) {
    const path = issue.path.length > 0 ? issue.path.join('.') : 'root';
    lines.push(`  • ${path}: ${issue.message}`);
  }

  if (includeDetails && error.errors.length > 1) {
    lines.push(`\nTotal issues: ${error.errors.length}`);
  }

  return lines.join('\n');
}
