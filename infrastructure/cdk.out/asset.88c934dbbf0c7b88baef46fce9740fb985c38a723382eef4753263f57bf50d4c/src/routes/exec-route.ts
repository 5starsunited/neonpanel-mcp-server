import { Request, Response, Router } from 'express';
import axios from 'axios';
import { z } from 'zod';
import { getFreshCapabilities } from '../dynamic-capabilities';

const ExecSchema = z.object({
  action: z.string().min(1),
  args: z.record(z.any()).default({})
});

function findActionInCapabilities(capabilities: any[], actionId: string): any | null {
  for (const capability of capabilities) {
    const action = capability.actions.find((a: any) => a.action_id === actionId);
    if (action) {
      return action;
    }
  }
  return null;
}

function getAvailableActions(capabilities: any[]): string[] {
  const actions: string[] = [];
  for (const capability of capabilities) {
    for (const action of capability.actions) {
      actions.push(action.action_id);
    }
  }
  return actions;
}

function buildApiUrl(actionInfo: any, args: Record<string, unknown>): string {
  let path = actionInfo.path;

  for (const param of actionInfo.parameters || []) {
    if (param.in === 'path' && args[param.name] !== undefined) {
      path = path.replace(`{${param.name}}`, encodeURIComponent(String(args[param.name])));
    }
  }

  const queryParams = new URLSearchParams();
  for (const param of actionInfo.parameters || []) {
    if (param.in === 'query' && args[param.name] !== undefined) {
      const value = args[param.name];
      if (Array.isArray(value)) {
        value.forEach(v => queryParams.append(`${param.name}[]`, String(v)));
      } else {
        queryParams.append(param.name, String(value));
      }
    }
  }

  const queryString = queryParams.toString();
  return queryString ? `${path}?${queryString}` : path;
}

async function neonpanelGet(path: string, token: string, baseUrl: string) {
  const url = `${baseUrl}${path}`;
  const res = await axios.get(url, { headers: { Authorization: token, Accept: 'application/json' } });
  return res.data;
}

export interface ExecRouteOptions {
  neonpanelBaseUrl: string;
  attachAuthChallenge: (res: Response, req: Request) => void;
}

export function registerExecRoute(router: Router, options: ExecRouteOptions) {
  router.all('/exec', (req, res, next) => {
    if (req.method === 'POST') {
      return next();
    }

    res.setHeader('Allow', 'POST');

    if (req.method === 'OPTIONS') {
      return res.status(204).end();
    }

    options.attachAuthChallenge(res, req);
    return res.status(405).json({
      ok: false,
      message: 'Method not allowed. Use POST /exec with a Bearer token.'
    });
  });

  router.post('/exec', async (req, res) => {
    try {
      const auth = req.headers['authorization'];
      if (!auth || !auth.toString().toLowerCase().startsWith('bearer ')) {
        options.attachAuthChallenge(res, req);
        return res.status(401).json({ ok: false, message: 'Missing Authorization bearer token' });
      }

      const { action, args } = ExecSchema.parse(req.body || {});

      const capabilities = await getFreshCapabilities();
      const actionInfo = findActionInCapabilities(capabilities, action);

      if (!actionInfo) {
        return res.status(400).json({
          ok: false,
          message: `Unknown or unsupported action '${action}'`,
          available_actions: getAvailableActions(capabilities)
        });
      }

      const apiUrl = buildApiUrl(actionInfo, args);
      const data = await neonpanelGet(apiUrl, auth as string, options.neonpanelBaseUrl);

      res.json({
        ok: true,
        data,
        action: actionInfo.action_id,
        method: actionInfo.method,
        path: actionInfo.path
      });
    } catch (error: any) {
      const status = error?.response?.status || 500;
      const message = error?.response?.data || error?.message || 'Internal error';
      if (status === 401) {
        options.attachAuthChallenge(res, req);
      }
      res.status(status).json({ ok: false, message, action: req.body?.action });
    }
  });
}
