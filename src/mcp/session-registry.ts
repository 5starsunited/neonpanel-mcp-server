import { createHash } from 'node:crypto';
import { logger } from '../logging/logger';
import type { AuthContext } from '../middleware/authentication';
import type { SseSession } from './transport/sse';

type SessionRecord = {
  session: SseSession;
  subject?: string;
  tokenHash: string;
  scopes: string[];
};

export class SessionRegistry {
  private readonly sessions = new Map<string, SessionRecord>();

  public register(session: SseSession, authContext: AuthContext) {
    const record: SessionRecord = {
      session,
      subject: authContext.subject,
      scopes: authContext.scopes,
      tokenHash: hashToken(authContext.token),
    };

    this.sessions.set(session.id, record);
    logger.debug({ sessionId: session.id, subject: record.subject }, 'Registered SSE session');
  }

  public unregister(sessionId: string) {
    if (this.sessions.delete(sessionId)) {
      logger.debug({ sessionId }, 'Unregistered SSE session');
    }
  }

  public findMatchingSessions(authContext: AuthContext): SessionRecord[] {
    const tokenHash = hashToken(authContext.token);
    const subject = authContext.subject;

    const matches: SessionRecord[] = [];
    for (const record of this.sessions.values()) {
      if (record.subject && subject && record.subject === subject) {
        matches.push(record);
        continue;
      }

      if (record.tokenHash === tokenHash) {
        matches.push(record);
      }
    }

    return matches;
  }

  public terminateAll() {
    for (const [sessionId, record] of this.sessions.entries()) {
      try {
        record.session.response.end();
      } catch (error) {
        logger.warn({ sessionId, error }, 'Failed to close SSE session on shutdown');
      }
    }
    this.sessions.clear();
  }
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
