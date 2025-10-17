import { JsonRpcError } from '../../lib/errors';
import { logger } from '../../logging/logger';
import {
  JsonRpcRequest,
  JsonRpcRequestSchema,
  JsonRpcResponse,
  RpcContext,
  RpcHandler,
} from './types';

export class RpcDispatcher {
  constructor(private readonly handlers: Map<string, RpcHandler>) {}

  public static fromRecord(record: Record<string, RpcHandler>) {
    return new RpcDispatcher(new Map(Object.entries(record)));
  }

  public async handle(payload: unknown, context: RpcContext): Promise<JsonRpcResponse> {
    let request: JsonRpcRequest;
    try {
      request = JsonRpcRequestSchema.parse(payload);
    } catch (error) {
      logger.warn({ error }, 'Invalid JSON-RPC request payload');
      return {
        jsonrpc: '2.0',
        id: null,
        error: {
          code: -32600,
          message: 'Invalid Request',
          data: (error as Error).message,
        },
      };
    }

    const handler = this.handlers.get(request.method);
    if (!handler) {
      return {
        jsonrpc: '2.0',
        id: request.id ?? null,
        error: {
          code: -32601,
          message: `Method not found: ${request.method}`,
        },
      };
    }

    try {
      const result = await handler(request.params, context);
      return {
        jsonrpc: '2.0',
        id: request.id ?? null,
        result,
      };
    } catch (error) {
      return this.handleError(error, request);
    }
  }

  private handleError(error: unknown, request: JsonRpcRequest): JsonRpcResponse {
    if (error instanceof JsonRpcError) {
      return {
        jsonrpc: '2.0',
        id: request.id ?? null,
        error: {
          code: error.rpcCode,
          message: error.message,
          data: error.rpcData ?? error.details,
        },
      };
    }

    logger.error({ error, method: request.method }, 'Unhandled error during JSON-RPC call');
    return {
      jsonrpc: '2.0',
      id: request.id ?? null,
      error: {
        code: -32603,
        message: 'Internal error',
      },
    };
  }
}
