import { fetch, Response } from 'undici';
import { config } from '../config';
import { AppError } from '../lib/errors';

export interface NeonPanelRequestOptions<TBody = unknown> {
  token: string;
  path: string;
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  query?: Record<string, unknown>;
  body?: TBody;
  timeoutMs?: number;
}

export class NeonPanelApiError extends AppError {
  constructor(message: string, options: { status?: number; code?: string; details?: unknown } = {}) {
    super(message, {
      status: options.status ?? 502,
      code: options.code ?? 'neonpanel_api_error',
      details: options.details,
    });
    this.name = 'NeonPanelApiError';
  }
}

export async function neonPanelRequest<TResponse>(options: NeonPanelRequestOptions): Promise<TResponse> {
  const url = buildUrl(options.path, options.query);
  const method = options.method ?? 'GET';
  const controller = new AbortController();
  const timeout = options.timeoutMs ?? config.http.requestTimeoutMs;
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      method,
      headers: buildHeaders(options.token, options.body),
      body: serializeBody(method, options.body),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorPayload = await safeParse(response);
      const errorCode = (errorPayload && 
                        typeof errorPayload === 'object' && 
                        'error' in errorPayload && 
                        errorPayload.error && 
                        typeof errorPayload.error === 'object' && 
                        'code' in errorPayload.error &&
                        typeof errorPayload.error.code === 'string') 
                        ? errorPayload.error.code 
                        : 'neonpanel_api_error';
      throw new NeonPanelApiError('NeonPanel API request failed', {
        status: response.status,
        code: errorCode,
        details: errorPayload,
      });
    }

    if (response.status === 204) {
      return undefined as TResponse;
    }

    const payload = await response.json();
    return payload as TResponse;
  } catch (error) {
    if (error instanceof NeonPanelApiError) {
      throw error;
    }

    if ((error as Error).name === 'AbortError') {
      throw new NeonPanelApiError('NeonPanel API request timed out.', {
        status: 504,
        code: 'neonpanel_timeout',
      });
    }

    throw new NeonPanelApiError('Unexpected NeonPanel API error', {
      status: 500,
      code: 'neonpanel_unexpected_error',
      details: error,
    });
  } finally {
    clearTimeout(timer);
  }
}

function buildUrl(path: string, query?: Record<string, unknown>): string {
  const base = config.neonpanel.apiBaseUrl;
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  const url = new URL(`${base}${normalizedPath}`);

  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null) {
        continue;
      }

      if (Array.isArray(value)) {
        for (const item of value) {
          if (item === undefined || item === null) continue;
          url.searchParams.append(key, String(item));
        }
      } else {
        url.searchParams.set(key, String(value));
      }
    }
  }

  return url.toString();
}

function buildHeaders(token: string, body: unknown) {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/json',
  };

  if (body !== undefined && body !== null) {
    headers['Content-Type'] = 'application/json';
  }

  return headers;
}

function serializeBody(method: string, body: unknown): string | undefined {
  if (method.toUpperCase() === 'GET' || method.toUpperCase() === 'DELETE') {
    return undefined;
  }

  if (body === undefined || body === null) {
    return undefined;
  }

  return JSON.stringify(body);
}

async function safeParse(response: Response) {
  try {
    return await response.json();
  } catch {
    try {
      return await response.text();
    } catch {
      return null;
    }
  }
}
