import axios, { AxiosInstance } from 'axios';
import type { PositionSnapshot, SymbolMetrics } from './types.js';
import { appConfig } from '../config/index.js';
import { logger } from '../utils/logger.js';
import { resolveSymbolParts } from '../utils/symbol.js';

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

interface TokenInfoData {
  marketCap: number | null;
  volume24h: number | null;
}

interface SymbolMetricsFetcherOptions {
  cacheTtlMs?: number;
  concurrency?: number;
  apexBaseUrl?: string;
}

const DEFAULT_CACHE_TTL_MS = 3 * 60 * 1000;
const DEFAULT_CONCURRENCY = 5;
const DEFAULT_APEX_BASE_URL = 'https://www.binance.com';

export class SymbolMetricsFetcher {
  private readonly futuresClient: AxiosInstance;
  private readonly apexClient: AxiosInstance;
  private readonly cacheTtlMs: number;
  private readonly concurrency: number;
  private readonly oiCache = new Map<string, CacheEntry<number | null>>();
  private readonly tokenCache = new Map<string, CacheEntry<TokenInfoData>>();

  constructor(options?: SymbolMetricsFetcherOptions) {
    this.cacheTtlMs = options?.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
    this.concurrency = Math.max(1, options?.concurrency ?? DEFAULT_CONCURRENCY);
    this.futuresClient = axios.create({
      baseURL: appConfig.binanceBaseUrl,
      timeout: 15000
    });
    this.apexClient = axios.create({
      baseURL: options?.apexBaseUrl ?? DEFAULT_APEX_BASE_URL,
      timeout: 15000
    });
  }

  async fetchMetrics(snapshots: PositionSnapshot[]): Promise<Map<string, SymbolMetrics>> {
    const symbols = Array.from(new Set(snapshots.map((snapshot) => snapshot.symbol)));
    const now = Date.now();

    const [openInterestMap, tokenInfoMap] = await Promise.all([
      this.fetchOpenInterestBatch(symbols, now),
      this.fetchTokenInfoBatch(symbols, now)
    ]);

    const metrics = new Map<string, SymbolMetrics>();
    for (const symbol of symbols) {
      const baseAssetFromSnapshot =
        snapshots.find((snapshot) => snapshot.symbol === symbol)?.baseAsset ?? symbol;
      const openInterest = openInterestMap.get(symbol) ?? null;
      const tokenInfo = tokenInfoMap.get(symbol);
      metrics.set(symbol, {
        symbol,
        baseAsset: baseAssetFromSnapshot,
        openInterest,
        marketCap: tokenInfo?.marketCap ?? null,
        volume24h: tokenInfo?.volume24h ?? null,
        fetchedAt: now
      });
    }

    return metrics;
  }

  private async fetchOpenInterestBatch(symbols: string[], timestamp: number): Promise<Map<string, number | null>> {
    const result = new Map<string, number | null>();
    const pending: Array<() => Promise<void>> = [];

    for (const symbol of symbols) {
      const cached = this.getCacheEntry(this.oiCache, symbol, timestamp);
      if (cached !== undefined) {
        result.set(symbol, cached);
        continue;
      }

      pending.push(async () => {
        const value = await this.fetchOpenInterest(symbol);
        this.oiCache.set(symbol, { value, expiresAt: timestamp + this.cacheTtlMs });
        result.set(symbol, value);
      });
    }

    await this.runWithConcurrency(pending);
    return result;
  }

  private async fetchTokenInfoBatch(symbols: string[], timestamp: number): Promise<Map<string, TokenInfoData>> {
    const result = new Map<string, TokenInfoData>();
    const pending: Array<() => Promise<void>> = [];

    for (const symbol of symbols) {
      const cached = this.getCacheEntry(this.tokenCache, symbol, timestamp);
      if (cached !== undefined) {
        result.set(symbol, cached);
        continue;
      }

      pending.push(async () => {
        const value = await this.fetchTokenInfo(symbol);
        this.tokenCache.set(symbol, { value, expiresAt: timestamp + this.cacheTtlMs });
        result.set(symbol, value);
      });
    }

    await this.runWithConcurrency(pending);
    return result;
  }

  private getCacheEntry<T>(cache: Map<string, CacheEntry<T>>, key: string, now: number): T | undefined {
    const entry = cache.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt >= now) {
      return entry.value;
    }
    cache.delete(key);
    return undefined;
  }

  private async runWithConcurrency(tasks: Array<() => Promise<void>>): Promise<void> {
    if (tasks.length === 0) return;
    let index = 0;
    const workers = Array.from({ length: Math.min(this.concurrency, tasks.length) }, async () => {
      while (index < tasks.length) {
        const taskIndex = index++;
        try {
          await tasks[taskIndex]();
        } catch (error) {
          logger.warn({ error }, 'Symbol metrics fetch task failed');
        }
      }
    });
    await Promise.all(workers);
  }

  private async fetchOpenInterest(symbol: string): Promise<number | null> {
    try {
      const { data } = await this.futuresClient.get<{ openInterest?: string }>(
        '/fapi/v1/openInterest',
        { params: { symbol } }
      );
      const value = this.parseNumber(data?.openInterest);
      if (value === null) {
        logger.warn({ symbol, data }, 'Open interest response missing or invalid');
      }
      return value;
    } catch (error) {
      logger.warn({ symbol, error }, 'Failed to fetch open interest data');
      return null;
    }
  }

  private async fetchTokenInfo(symbol: string): Promise<TokenInfoData> {
    const { base } = resolveSymbolParts(symbol);
    if (!base) {
      logger.warn({ symbol }, 'Unable to resolve base asset for token info');
      return { marketCap: null, volume24h: null };
    }

    try {
      const { data } = await this.apexClient.get<{
        code?: string;
        message?: string | null;
        messageDetail?: string | null;
        data?: { mc?: string | number | null; v?: string | number | null };
      }>('/bapi/apex/v1/friendly/apex/marketing/web/token-info', {
        params: { symbol: base }
      });

      if (data?.code !== '000000' || !data?.data) {
        logger.warn({ symbol, response: data }, 'Token info response indicates failure');
        return { marketCap: null, volume24h: null };
      }

      const marketCap = this.parseNumber(data.data.mc);
      const volume24h = this.parseNumber(data.data.v);
      if (marketCap === null || volume24h === null) {
        logger.warn({ symbol, payload: data.data }, 'Token info data missing numeric fields');
      }
      return { marketCap, volume24h };
    } catch (error) {
      logger.warn({ symbol, error }, 'Failed to fetch token info data');
      return { marketCap: null, volume24h: null };
    }
  }

  private parseNumber(value: unknown): number | null {
    if (value === null || value === undefined) {
      return null;
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === 'string') {
      const normalized = value.replace(/,/g, '').trim();
      if (normalized === '') {
        return null;
      }
      const parsed = Number(normalized);
      return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
  }
}
