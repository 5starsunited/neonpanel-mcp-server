export class AppError extends Error {
  public readonly status: number;
  public readonly code: string;
  public readonly details?: unknown;

  constructor(message: string, options: { status?: number; code?: string; details?: unknown } = {}) {
    super(message);
    this.name = 'AppError';
    this.status = options.status ?? 500;
    this.code = options.code ?? 'internal_error';
    this.details = options.details;
  }
}

export class JsonRpcError extends AppError {
  public readonly rpcCode: number;
  public readonly rpcData?: unknown;

  constructor(message: string, options: { code?: string; status?: number; rpcCode?: number; rpcData?: unknown; details?: unknown } = {}) {
    super(message, {
      status: options.status ?? 500,
      code: options.code ?? 'jsonrpc_error',
      details: options.details,
    });
    this.name = 'JsonRpcError';
    this.rpcCode = options.rpcCode ?? -32603;
    this.rpcData = options.rpcData;
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

export function isJsonRpcError(error: unknown): error is JsonRpcError {
  return error instanceof JsonRpcError;
}
