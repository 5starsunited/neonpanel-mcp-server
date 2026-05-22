/**
 * RequestContext: Generate unique request IDs and timestamps for tracing.
 * Injected into every tool invocation to enable log correlation and debugging.
 */

export interface RequestContextData {
  request_id: string;
  timestamp: string;
}

/**
 * Generate a unique request ID and timestamp for tracing tool invocations.
 * Format: brand-analytics-{timestamp}-{random}
 * Example: brand-analytics-1716389716000-abc123def
 */
export function generateRequestContext(): RequestContextData {
  const timestamp = Date.now();
  const random = Math.random().toString(36).slice(2, 9);
  return {
    request_id: `brand-analytics-${timestamp}-${random}`,
    timestamp: new Date().toISOString(),
  };
}
