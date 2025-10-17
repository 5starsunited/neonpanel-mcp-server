import pino from 'pino';
import { config } from '../config';

export const logger = pino({
  level: config.logging.level,
  base: {
    service: config.mcp.serverName,
    version: config.buildVersion,
  },
  redact: {
    paths: ['req.headers.authorization', 'req.headers.cookie'],
    censor: '[Redacted]',
  },
  transport:
    config.env === 'development'
      ? {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'SYS:standard',
            ignore: 'pid,hostname',
          },
        }
      : undefined,
});
