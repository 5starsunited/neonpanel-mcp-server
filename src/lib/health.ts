import { fetch as undiciFetch } from 'undici';
import { config } from '../config';

export interface JwksStatus {
  reachable: boolean;
  status?: number;
  checkedAt: string;
  error?: string;
}

export async function checkJwks(fetchFn: typeof undiciFetch = undiciFetch): Promise<JwksStatus> {
  try {
    const response = await fetchFn(config.neonpanel.jwksUri, { method: 'HEAD' });
    return {
      reachable: response.ok,
      status: response.status,
      checkedAt: new Date().toISOString(),
    };
  } catch (error) {
    return {
      reachable: false,
      checkedAt: new Date().toISOString(),
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
