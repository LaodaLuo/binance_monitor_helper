import { describe, expect, it, vi } from 'vitest';

vi.mock('../config/index.js', () => ({
  appConfig: {
    binanceApiKey: 'test',
    binanceApiSecret: 'test',
    binanceBaseUrl: 'https://example.com',
    binanceWsBaseUrl: 'wss://example.com/ws',
    feishuWebhookUrl: 'https://example.com/hook',
    feishuSecondaryWebhookUrl: 'https://example.com/hook2',
    aggregationWindowMs: 10000,
    listenKeyKeepAliveMs: 60000,
    logLevel: 'silent',
    maxRetry: 1,
    positionValidationIntervalMs: 30000
  }
}));

import { parseFundingRate } from '../positions/accountFetcher.js';

describe('parseFundingRate', () => {
  it('uses predictedFundingRate when present (DYMUSDT)', () => {
    const rate = parseFundingRate({ symbol: 'DYMUSDT', predictedFundingRate: '-0.000123', lastFundingRate: '-0.000200' });
    expect(rate).toBeCloseTo(-0.000123);
  });

  it('falls back to lastFundingRate when predicted is missing (LAYERUSDT)', () => {
    const rate = parseFundingRate({ symbol: 'LAYERUSDT', lastFundingRate: '-0.000456' });
    expect(rate).toBeCloseTo(-0.000456);
  });

  it('falls back when predicted is empty string (MELANIAUSDT)', () => {
    const rate = parseFundingRate({ symbol: 'MELANIAUSDT', predictedFundingRate: '', lastFundingRate: '-0.000789' });
    expect(rate).toBeCloseTo(-0.000789);
  });
});
