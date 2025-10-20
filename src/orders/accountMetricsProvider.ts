import { BinanceAccountFetcher } from '../positions/accountFetcher.js';
import type { PositionDirection, PositionSnapshot } from '../positions/types.js';
import { logger } from '../utils/logger.js';

export interface AccountSummary {
  totalFunds: number | null;
  fetchedAt: number;
  positions: Map<string, PositionSnapshot>;
}

export interface AccountMetricsProvider {
  getSummary(): Promise<AccountSummary | null>;
}

const DEFAULT_CACHE_TTL_MS = 2000;

export function buildPositionKey(symbol: string, direction: PositionDirection): string {
  return `${symbol}:${direction}`;
}

export class BinanceAccountMetricsProvider implements AccountMetricsProvider {
  private readonly fetcher: BinanceAccountFetcher;
  private readonly cacheTtlMs: number;
  private cache?: {
    summary: AccountSummary;
    cachedAt: number;
  };
  private inflight?: Promise<AccountSummary | null>;

  constructor(options?: { fetcher?: BinanceAccountFetcher; cacheTtlMs?: number }) {
    this.fetcher = options?.fetcher ?? new BinanceAccountFetcher();
    this.cacheTtlMs = options?.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
  }

  async getSummary(): Promise<AccountSummary | null> {
    const now = Date.now();
    if (this.cache && now - this.cache.cachedAt < this.cacheTtlMs) {
      return this.cache.summary;
    }

    if (!this.inflight) {
      this.inflight = this.refresh();
    }

    try {
      return await this.inflight;
    } finally {
      this.inflight = undefined;
    }
  }

  private async refresh(): Promise<AccountSummary | null> {
    try {
      const context = await this.fetcher.fetchAccountContext();
      const positions = new Map<string, PositionSnapshot>();

      for (const snapshot of context.snapshots) {
        positions.set(buildPositionKey(snapshot.symbol, snapshot.direction), snapshot);
      }

      const summary: AccountSummary = {
        totalFunds: Number.isFinite(context.totalMarginBalance) ? context.totalMarginBalance : null,
        fetchedAt: context.fetchedAt,
        positions
      };

      this.cache = {
        summary,
        cachedAt: Date.now()
      };

      return summary;
    } catch (error) {
      logger.warn({ error }, 'Failed to refresh account metrics');
      return this.cache?.summary ?? null;
    }
  }
}
