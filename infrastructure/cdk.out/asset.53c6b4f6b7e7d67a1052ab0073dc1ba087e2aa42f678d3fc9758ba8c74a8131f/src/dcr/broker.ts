import axios, { AxiosError } from 'axios';

export const DEFAULT_DCR_BASE_URL = 'https://my.neonpanel.com/oauth2';

export type ClientMetadata = {
  client_name: string;
  redirect_uris: string[];
  grant_types?: string[];
  response_types?: string[];
  token_endpoint_auth_method?: string;
  scope?: string;
  application_type?: string;
  jwks_uri?: string;
  jwks?: unknown;
  logo_uri?: string;
  client_uri?: string;
  tos_uri?: string;
  policy_uri?: string;
  contacts?: string[];
  [key: string]: unknown;
};

export interface RegistrationResponse {
  client_id: string;
  client_secret?: string;
  client_id_issued_at?: number;
  client_secret_expires_at?: number;
  registration_access_token: string;
  registration_client_uri: string;
  token_endpoint_auth_method?: string;
  grant_types?: string[];
  redirect_uris?: string[];
  response_types?: string[];
  scope?: string;
  [key: string]: unknown;
}

export interface RegisterClientOptions {
  baseUrl?: string;
  metadata: ClientMetadata;
  initialAccessToken: string;
}

export interface FetchClientOptions {
  registrationUri: string;
  registrationAccessToken: string;
}

export interface UpdateClientOptions extends FetchClientOptions {
  metadata: ClientMetadata;
  usePatch?: boolean;
}

export interface DeleteClientOptions extends FetchClientOptions {}

export async function registerClient(options: RegisterClientOptions): Promise<RegistrationResponse> {
  const baseUrl = sanitizeBaseUrl(options.baseUrl ?? DEFAULT_DCR_BASE_URL);
  const url = `${baseUrl}/register`;

  try {
    const response = await axios.post(url, options.metadata, {
      headers: {
        Authorization: `Bearer ${options.initialAccessToken}`,
        'Content-Type': 'application/json',
      },
      validateStatus: () => true,
    });

    if (response.status < 200 || response.status >= 300) {
      throw buildBrokerError('register', response.status, response.data);
    }

    return response.data as RegistrationResponse;
  } catch (error) {
    throw normalizeAxiosError('register', error);
  }
}

export async function fetchClient(options: FetchClientOptions): Promise<RegistrationResponse> {
  try {
    const response = await axios.get(options.registrationUri, {
      headers: {
        Authorization: `Bearer ${options.registrationAccessToken}`,
      },
      validateStatus: () => true,
    });

    if (response.status < 200 || response.status >= 300) {
      throw buildBrokerError('fetch', response.status, response.data);
    }

    return response.data as RegistrationResponse;
  } catch (error) {
    throw normalizeAxiosError('fetch', error);
  }
}

export async function updateClient(options: UpdateClientOptions): Promise<RegistrationResponse> {
  try {
    const method = options.usePatch ? 'patch' : 'put';
    const response = await axios.request({
      url: options.registrationUri,
      method,
      data: options.metadata,
      headers: {
        Authorization: `Bearer ${options.registrationAccessToken}`,
        'Content-Type': 'application/json',
      },
      validateStatus: () => true,
    });

    if (response.status < 200 || response.status >= 300) {
      throw buildBrokerError('update', response.status, response.data);
    }

    return response.data as RegistrationResponse;
  } catch (error) {
    throw normalizeAxiosError('update', error);
  }
}

export async function deleteClient(options: DeleteClientOptions): Promise<void> {
  try {
    const response = await axios.delete(options.registrationUri, {
      headers: {
        Authorization: `Bearer ${options.registrationAccessToken}`,
      },
      validateStatus: () => true,
    });

    if (response.status < 200 || response.status >= 300) {
      throw buildBrokerError('delete', response.status, response.data);
    }
  } catch (error) {
    throw normalizeAxiosError('delete', error);
  }
}

function sanitizeBaseUrl(value: string): string {
  return value.replace(/\/+$/u, '');
}

function buildBrokerError(stage: string, statusCode: number, data: unknown): Error {
  const summary = summarizePayload(data);
  const message = `DCR ${stage} failed with status ${statusCode}${summary ? `: ${summary}` : ''}`;
  const error = new Error(message);
  (error as BrokerError).statusCode = statusCode;
  (error as BrokerError).payload = data;
  return error;
}

function summarizePayload(data: unknown): string {
  if (!data) {
    return '';
  }

  if (typeof data === 'string') {
    return data.length > 200 ? `${data.slice(0, 200)}…` : data;
  }

  try {
    const json = JSON.stringify(data);
    return json.length > 200 ? `${json.slice(0, 200)}…` : json;
  } catch {
    return '[unserializable payload]';
  }
}

function normalizeAxiosError(stage: string, error: unknown): Error {
  if (axios.isAxiosError(error)) {
    const axiosError = error as AxiosError;
    const status = axiosError.response?.status ?? 0;
    const payload = axiosError.response?.data;
    const wrapped = buildBrokerError(stage, status, payload);
    wrapped.stack = error instanceof Error && error.stack ? `${wrapped.message}\nCaused by: ${error.stack}` : wrapped.message;
    return wrapped;
  }

  if (error instanceof Error) {
    return error;
  }

  return new Error(`Unexpected error during DCR ${stage}: ${String(error)}`);
}

interface BrokerError extends Error {
  statusCode?: number;
  payload?: unknown;
}
