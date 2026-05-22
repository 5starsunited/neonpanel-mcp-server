/**
 * BrandAnalyticsError: Unified error response class for all brand analytics tools.
 * Provides consistent error format with request_id, error_code, HTTP status, and details.
 */

export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'PERMISSION_DENIED'
  | 'QUERY_FAILED'
  | 'PARSE_ERROR'
  | 'INVALID_AGGREGATION'
  | 'UNKNOWN';

export interface BrandAnalyticsErrorResponse {
  error: string;
  error_code: ErrorCode;
  http_status: number;
  request_id?: string;
  query_execution_id?: string;
  message?: string;
  details?: Record<string, any>;
  timestamp?: string;
}

export class BrandAnalyticsError extends Error {
  public readonly response: BrandAnalyticsErrorResponse;

  constructor(
    errorCode: ErrorCode,
    errorMessage: string,
    httpStatus: number = 500,
    options?: {
      details?: Record<string, any>;
      request_id?: string;
      query_execution_id?: string;
      message?: string;
    }
  ) {
    super(errorMessage);
    this.name = 'BrandAnalyticsError';

    this.response = {
      error: errorMessage,
      error_code: errorCode,
      http_status: httpStatus,
      request_id: options?.request_id,
      query_execution_id: options?.query_execution_id,
      message: options?.message,
      details: options?.details,
      timestamp: new Date().toISOString(),
    };

    // Remove undefined fields
    Object.keys(this.response).forEach(
      (key) =>
        this.response[key as keyof BrandAnalyticsErrorResponse] === undefined &&
        delete this.response[key as keyof BrandAnalyticsErrorResponse]
    );
  }

  /**
   * Create a validation error with field-specific details.
   */
  static validationError(
    message: string,
    details?: Record<string, any>,
    request_id?: string
  ): BrandAnalyticsError {
    return new BrandAnalyticsError('VALIDATION_ERROR', message, 400, {
      details,
      request_id,
    });
  }

  /**
   * Create a permission error.
   */
  static permissionDenied(
    message: string,
    details?: Record<string, any>,
    request_id?: string
  ): BrandAnalyticsError {
    return new BrandAnalyticsError('PERMISSION_DENIED', message, 403, {
      details,
      request_id,
    });
  }

  /**
   * Create a query execution error with Athena query ID.
   */
  static queryFailed(
    message: string,
    query_execution_id?: string,
    request_id?: string,
    details?: Record<string, any>
  ): BrandAnalyticsError {
    return new BrandAnalyticsError('QUERY_FAILED', message, 500, {
      details,
      request_id,
      query_execution_id,
    });
  }

  /**
   * Create an aggregation parameter error.
   */
  static invalidAggregation(
    message: string,
    details?: Record<string, any>,
    request_id?: string
  ): BrandAnalyticsError {
    return new BrandAnalyticsError('INVALID_AGGREGATION', message, 400, {
      details,
      request_id,
    });
  }

  /**
   * Get the response object for sending to the client.
   */
  toResponse(): BrandAnalyticsErrorResponse {
    return this.response;
  }
}
