import type { JwtPayload } from 'jsonwebtoken';
import type { ValidatedAccessToken } from '../../auth/token-validator';
import { z } from 'zod';

export const JsonRpcRequestSchema = z.object({
  jsonrpc: z.literal('2.0'),
  id: z.union([z.string(), z.number(), z.null()]).optional(),
  method: z.string(),
  params: z.unknown().optional(),
});

export type JsonRpcRequest = z.infer<typeof JsonRpcRequestSchema>;

export type JsonRpcSuccess = {
  jsonrpc: '2.0';
  id: JsonRpcRequest['id'];
  result: unknown;
};

export type JsonRpcFailure = {
  jsonrpc: '2.0';
  id: JsonRpcRequest['id'];
  error: {
    code: number;
    message: string;
    data?: unknown;
  };
};

export type JsonRpcResponse = JsonRpcSuccess | JsonRpcFailure;

export interface RpcContext {
  token: string;
  scopes: string[];
  subject?: string;
  payload: JwtPayload;
  validatedToken: ValidatedAccessToken;
}

export type RpcHandler = (params: unknown, context: RpcContext) => Promise<unknown>;
