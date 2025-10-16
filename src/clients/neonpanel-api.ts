import axios, { AxiosInstance } from 'axios';
import { getIATAccessToken } from '../auth/iat-client.js';

export interface NeonPanelApiOptions {
  useUserToken?: boolean;
  userToken?: string;
}

export interface SearchOrdersParams {
  q?: string;
  from?: string;
  to?: string;
  limit?: number;
  status?: string;
}

const DEFAULT_TIMEOUT = Number.parseInt(process.env.NEONPANEL_HTTP_TIMEOUT_MS || '15000', 10);

function getBaseUrl(): string {
  return (process.env.NEONPANEL_API_BASE || process.env.NEONPANEL_BASE_URL || 'https://my.neonpanel.com').replace(/\/$/, '');
}

function createClient(): AxiosInstance {
  return axios.create({
    baseURL: getBaseUrl(),
    timeout: DEFAULT_TIMEOUT,
  });
}

const client = createClient();

async function resolveAuthHeader(options: NeonPanelApiOptions = {}): Promise<string> {
  if (options.useUserToken) {
    if (!options.userToken) {
      throw new Error('User token requested but not provided.');
    }
    return `Bearer ${options.userToken}`;
  }

  const accessToken = await getIATAccessToken(getBaseUrl());
  return `Bearer ${accessToken}`;
}

export async function getAccount(accountId: string, options: NeonPanelApiOptions = {}) {
  if (!accountId) {
    throw new Error('accountId is required');
  }

  const Authorization = await resolveAuthHeader(options);
  const response = await client.get(`/api/v1/accounts/${encodeURIComponent(accountId)}`, {
    headers: { Authorization }
  });

  return response.data;
}

export async function searchOrders(params: SearchOrdersParams = {}, options: NeonPanelApiOptions = {}) {
  const Authorization = await resolveAuthHeader(options);
  const response = await client.get('/api/v1/orders', {
    headers: { Authorization },
    params
  });

  return response.data;
}
