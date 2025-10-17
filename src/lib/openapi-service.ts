import { readFile, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fetch as undiciFetch } from 'undici';
import { logger } from '../logging/logger';
import { config } from '../config';

export interface OpenApiStatusOptions {
  includeCache?: boolean;
  pingRemote?: boolean;
}

export interface OpenApiStatus {
  source: 'memory' | 'local-file' | 'remote' | 'unknown';
  lastFetchedAt?: string;
  cacheTtlMs: number;
  cacheAgeMs?: number;
  cacheExpiresAt?: string;
  etag?: string;
  remote?: {
    reachable: boolean;
    status?: number;
    checkedAt?: string;
  };
}

export class OpenApiService {
  private cache: unknown | null = null;
  private lastFetchedAt: number | null = null;
  private etag: string | null = null;
  private source: OpenApiStatus['source'] = 'unknown';
  private refreshing: Promise<void> | null = null;

  constructor(
    private readonly remoteUrl = config.neonpanel.openApiUrl,
    private readonly localPath = config.openApi.localPath,
    private readonly cacheTtlMs = config.openApi.cacheTtlMs,
    private readonly fetchFn: typeof undiciFetch = undiciFetch,
  ) {}

  public async getDocument(forceRefresh = false): Promise<unknown> {
    if (forceRefresh) {
      await this.refreshFromRemote();
      return cloneValue(this.cache);
    }

    if (this.cache && !this.isCacheExpired()) {
      return cloneValue(this.cache);
    }

    if (!this.cache) {
      await this.loadFromDisk();
    }

    if (!this.cache || this.isCacheExpired()) {
      await this.refreshFromRemote();
    }

    return cloneValue(this.cache);
  }

  public async getDocumentAsYaml(): Promise<string> {
    const document = await this.getDocument();
    return jsonToYaml(document);
  }

  public async getStatus(options: OpenApiStatusOptions = {}): Promise<OpenApiStatus> {
    const now = Date.now();
    const status: OpenApiStatus = {
      source: this.source,
      cacheTtlMs: this.cacheTtlMs,
      etag: this.etag ?? undefined,
    };

    if (this.lastFetchedAt) {
      status.lastFetchedAt = new Date(this.lastFetchedAt).toISOString();
      status.cacheAgeMs = Math.max(0, now - this.lastFetchedAt);
      status.cacheExpiresAt = new Date(this.lastFetchedAt + this.cacheTtlMs).toISOString();
    }

    if (options.includeCache && !this.cache && existsSync(this.localPath)) {
      try {
        const fileStats = await stat(this.localPath);
        status.source = status.source === 'unknown' ? 'local-file' : status.source;
        status.lastFetchedAt = new Date(fileStats.mtimeMs).toISOString();
      } catch (error) {
        logger.debug({ err: error }, 'Unable to inspect OpenAPI cache file');
      }
    }

    if (options.pingRemote) {
      try {
        const response = await this.fetchFn(this.remoteUrl, {
          method: 'HEAD',
        });
        status.remote = {
          reachable: response.ok,
          status: response.status,
          checkedAt: new Date().toISOString(),
        };
      } catch (error) {
        status.remote = {
          reachable: false,
          status: undefined,
          checkedAt: new Date().toISOString(),
        };
        logger.warn({ err: error }, 'Failed to reach NeonPanel OpenAPI endpoint');
      }
    }

    return status;
  }

  public async refreshFromRemote(): Promise<void> {
    if (this.refreshing) {
      await this.refreshing;
      return;
    }

    this.refreshing = this.performRemoteRefresh();
    try {
      await this.refreshing;
    } finally {
      this.refreshing = null;
    }
  }

  private async performRemoteRefresh() {
    logger.info({ url: this.remoteUrl }, 'Refreshing OpenAPI schema from NeonPanel');

    const response = await this.fetchFn(this.remoteUrl, {
      headers: this.etag ? { 'If-None-Match': this.etag } : undefined,
    });

    if (response.status === 304) {
      logger.debug('OpenAPI schema not modified; using cached version');
      this.lastFetchedAt = Date.now();
      this.source = 'remote';
      return;
    }

    if (!response.ok) {
      const body = await response.text().catch(() => '<unavailable>');
      logger.warn({ status: response.status, body }, 'Failed to refresh OpenAPI schema from remote');
      if (!this.cache) {
        await this.loadFromDisk();
      }
      return;
    }

    const document = await response.json().catch((error) => {
      logger.error({ err: error }, 'Failed to parse OpenAPI schema JSON');
      throw error;
    });

    this.cache = document;
    this.lastFetchedAt = Date.now();
    this.etag = response.headers.get('etag');
    this.source = 'remote';
    await this.persistToDisk(document);
  }

  private async loadFromDisk() {
    if (!existsSync(this.localPath)) {
      return;
    }

    try {
      const raw = await readFile(this.localPath, 'utf8');
      this.cache = JSON.parse(raw);
      const fileStats = await stat(this.localPath);
      this.lastFetchedAt = fileStats.mtimeMs;
      this.source = 'local-file';
      logger.info({ path: this.localPath }, 'Loaded OpenAPI schema from local cache');
    } catch (error) {
      logger.warn({ err: error }, 'Failed to load OpenAPI document from disk');
    }
  }

  private async persistToDisk(document: unknown) {
    try {
      const serialized = JSON.stringify(document, null, 2);
      await writeFile(this.localPath, serialized, 'utf8');
      logger.info({ path: this.localPath }, 'Persisted OpenAPI schema to disk');
    } catch (error) {
      logger.warn({ err: error }, 'Unable to persist OpenAPI document locally');
    }
  }

  private isCacheExpired(): boolean {
    if (!this.cache || !this.lastFetchedAt) {
      return true;
    }

    return Date.now() - this.lastFetchedAt >= this.cacheTtlMs;
  }
}

function jsonToYaml(value: unknown, indent = 0): string {
  const indentation = '  '.repeat(indent);

  if (value === null || value === undefined) {
    return 'null';
  }

  if (typeof value === 'string') {
    return JSON.stringify(value);
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  if (Array.isArray(value)) {
    if (value.length === 0) {
      return '[]';
    }

    return value
      .map((item) => `${indentation}- ${formatYamlValue(item, indent + 1)}`)
      .join('\n');
  }

  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) {
      return '{}';
    }

    return entries
      .map(([key, val]) => {
        const formatted = formatYamlValue(val, indent + 1);
        if (isPrimitive(val) || (Array.isArray(val) && val.length === 0)) {
          return `${indentation}${key}: ${formatted}`;
        }
        return `${indentation}${key}:\n${formatted}`;
      })
      .join('\n');
  }

  return JSON.stringify(value);
}

function formatYamlValue(value: unknown, indent: number): string {
  const indentation = '  '.repeat(indent);
  const serialized = jsonToYaml(value, indent);
  if (serialized.includes('\n')) {
    return serialized
      .split('\n')
      .map((line, index) => (index === 0 ? line : `${indentation}${line}`))
      .join('\n');
  }
  return serialized;
}

function isPrimitive(value: unknown): boolean {
  return value === null || ['string', 'number', 'boolean'].includes(typeof value);
}

function cloneValue<T>(value: T): T {
  if (typeof globalThis.structuredClone === 'function') {
    return globalThis.structuredClone(value);
  }

  return JSON.parse(JSON.stringify(value)) as T;
}
