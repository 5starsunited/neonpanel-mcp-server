import type { Response } from 'express';
import type { ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { logger } from '../../logging/logger';
import { config } from '../../config';

export type SseSession = {
  id: string;
  response: Response;
  createdAt: number;
};

type SessionMap = Map<string, SseSession>;

function writeSseMessage(res: ServerResponse, payload: { data: unknown }) {
  const serialized =
    typeof payload.data === 'string' ? payload.data : JSON.stringify(payload.data, (_key, value) => value ?? null);
  res.write(`data: ${serialized}\n\n`);
}

function writeSseEvent(res: ServerResponse, event: string, data: unknown) {
  const serialized = typeof data === 'string' ? data : JSON.stringify(data, (_key, value) => value ?? null);
  res.write(`event: ${event}\n`);
  res.write(`data: ${serialized}\n\n`);
}

export class SseSessionManager {
  private readonly sessions: SessionMap = new Map();
  private readonly heartbeatInterval: number;
  private heartbeatTimer: NodeJS.Timeout | null = null;

  constructor(private readonly maxConnections = config.sse.maxConnections) {
    this.heartbeatInterval = config.sse.heartbeatMs;
  }

  public connect(response: Response): SseSession {
    if (this.sessions.size >= this.maxConnections) {
      throw new Error('Too many active SSE connections.');
    }

    response.setHeader('Content-Type', 'text/event-stream');
    response.setHeader('Cache-Control', 'no-cache, no-transform');
    response.setHeader('Connection', 'keep-alive');
    response.setHeader('X-Accel-Buffering', 'no');

    const session: SseSession = {
      id: randomUUID(),
      response,
      createdAt: Date.now(),
    };

    this.sessions.set(session.id, session);
    logger.debug({ sessionId: session.id }, 'SSE session established');

    response.on('close', () => {
      this.sessions.delete(session.id);
      logger.debug({ sessionId: session.id }, 'SSE session closed by client');
      this.maybeStopHeartbeat();
    });

    this.ensureHeartbeat();

    // MCP SSE transport: clients (including ChatGPT connectors) commonly expect
    // an initial `endpoint` event containing the JSON-RPC POST URL + sessionId.
    // We send this immediately to avoid client-side timeouts during action refresh.
    writeSseEvent(response, 'endpoint', `/messages?sessionId=${session.id}`);

    // Back-compat: also send a structured ready payload for existing clients.
    writeSseMessage(response, { data: { event: 'ready', sessionId: session.id } });

    return session;
  }

  public send(sessionId: string, payload: { data: unknown }) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      logger.warn({ sessionId }, 'Attempted to send SSE message to unknown session');
      return;
    }

    writeSseMessage(session.response, payload);
  }

  public broadcast(payload: { data: unknown }) {
    for (const session of this.sessions.values()) {
      writeSseMessage(session.response, payload);
    }
  }

  public close(sessionId: string) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return;
    }

    writeSseMessage(session.response, { data: { event: 'close' } });
    session.response.end();
    this.sessions.delete(sessionId);
    this.maybeStopHeartbeat();
  }

  public closeAll() {
    for (const session of this.sessions.values()) {
      try {
        writeSseMessage(session.response, { data: { event: 'shutdown' } });
        session.response.end();
      } catch (error) {
        logger.warn({ sessionId: session.id, error }, 'Failed to close SSE session during shutdown');
      }
    }
    this.sessions.clear();
    this.maybeStopHeartbeat();
  }

  private ensureHeartbeat() {
    if (this.heartbeatTimer) {
      return;
    }

    this.heartbeatTimer = setInterval(() => {
      const now = new Date().toISOString();
      for (const session of this.sessions.values()) {
        writeSseMessage(session.response, { data: { event: 'heartbeat', ts: now } });
      }
    }, this.heartbeatInterval).unref();
  }

  private maybeStopHeartbeat() {
    if (this.sessions.size > 0) {
      return;
    }

    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  public getActiveConnectionCount(): number {
    return this.sessions.size;
  }
}
