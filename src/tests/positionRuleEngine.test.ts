import { describe, expect, it, vi } from 'vitest';

const now = Date.now();

vi.mock('../config/positionRules.js', () => {
  const defaultRule = {
    whitelistLong: ['BTC'],
    whitelistShort: null,
    blacklistLong: null,
    blacklistShort: ['BTC'],
    maxLeverage: 3,
    maxMarginShare: 0.05,
    fundingThresholdLong: null,
    fundingThresholdShort: -0.002,
    cooldownMinutes: 60,
    notifyRecovery: false,
    minFundingRateDelta: 0,
    totalMarginUsageLimit: 1
  };

  const overrides: Record<string, any> = {
    BTC: {
      whitelistLong: ['BTC'],
      blacklistShort: ['BTC'],
      maxLeverage: 10,
      maxMarginShare: 0.5,
      fundingThresholdShort: -0.001
    }
  };

  const configuredAssets = new Set(['BTC', 'ETH']);

  const toSet = (list: string[] | null | undefined) => (list && list.length > 0 ? new Set(list.map((item) => item.toUpperCase())) : null);

  const resolveRule = (asset: string) => {
    const upper = asset.toUpperCase();
    const override = overrides[upper];
    const hasOwn = (obj: Record<string, any> | undefined, key: string) => !!obj && Object.prototype.hasOwnProperty.call(obj, key);

    const pickList = (key: 'whitelistLong' | 'whitelistShort' | 'blacklistLong' | 'blacklistShort') => {
      if (hasOwn(override, key)) {
        const value = override?.[key];
        if (!value || value.length === 0) return null;
        return toSet(value);
      }
      const base = defaultRule[key as keyof typeof defaultRule] as string[] | null;
      return toSet(base ?? null);
    };

    return {
      baseAsset: upper,
      whitelistLong: pickList('whitelistLong'),
      whitelistShort: pickList('whitelistShort'),
      blacklistLong: pickList('blacklistLong'),
      blacklistShort: pickList('blacklistShort'),
      maxLeverage: hasOwn(override, 'maxLeverage') ? override?.maxLeverage ?? null : defaultRule.maxLeverage,
      maxMarginShare: hasOwn(override, 'maxMarginShare') ? override?.maxMarginShare ?? null : defaultRule.maxMarginShare,
      fundingThresholdLong: hasOwn(override, 'fundingThresholdLong')
        ? override?.fundingThresholdLong ?? null
        : defaultRule.fundingThresholdLong,
      fundingThresholdShort: hasOwn(override, 'fundingThresholdShort')
        ? override?.fundingThresholdShort ?? null
        : defaultRule.fundingThresholdShort,
      cooldownMinutes: hasOwn(override, 'cooldownMinutes')
        ? override?.cooldownMinutes ?? defaultRule.cooldownMinutes
        : defaultRule.cooldownMinutes,
      notifyRecovery: hasOwn(override, 'notifyRecovery')
        ? Boolean(override?.notifyRecovery)
        : defaultRule.notifyRecovery,
      minFundingRateDelta: hasOwn(override, 'minFundingRateDelta')
        ? override?.minFundingRateDelta ?? defaultRule.minFundingRateDelta
        : defaultRule.minFundingRateDelta
    };
  };

  return {
    positionRulesConfig: { defaults: defaultRule, overrides, configuredAssets },
    resolvePositionRule: resolveRule,
    getConfiguredAssets: () => Array.from(configuredAssets),
    getTotalMarginUsageLimit: () => defaultRule.totalMarginUsageLimit,
    normalizeBaseAssetId: (asset: string) => asset.toUpperCase()
  };
});

import { PositionRuleEngine } from '../positions/ruleEngine.js';
import type { SymbolMetrics } from '../positions/types.js';

const engine = new PositionRuleEngine();

describe('PositionRuleEngine', () => {
  it('flags whitelist violation for unauthorized long positions', () => {
    const issues = engine.evaluate({
      totalInitialMargin: 0,
      totalMarginBalance: 100,
      availableBalance: 80,
      snapshots: [
        {
          baseAsset: 'ETH',
          symbol: 'ETHUSDT',
          positionAmt: 1,
          notional: 100,
          leverage: 2,
          initialMargin: 10,
          isolatedMargin: 0,
          marginType: 'cross' as const,
          direction: 'long' as const,
          markPrice: 100,
          predictedFundingRate: -0.001,
          updatedAt: now
        }
      ],
      fetchedAt: now
    });

    const whitelistIssue = issues.find(
      (issue) => issue.rule === 'whitelist_violation' && issue.baseAsset === 'ETH' && issue.direction === 'long'
    );
    expect(whitelistIssue).toBeDefined();
  });

  it('emits leverage and margin share issues when exceeding thresholds', () => {
    const issues = engine.evaluate({
      totalInitialMargin: 0,
      totalMarginBalance: 100,
      availableBalance: 60,
      snapshots: [
        {
          baseAsset: 'ETH',
          symbol: 'ETHUSDT',
          positionAmt: 1,
          notional: 100,
          leverage: 5,
          initialMargin: 10,
          isolatedMargin: 0,
          marginType: 'cross' as const,
          direction: 'long' as const,
          markPrice: 100,
          predictedFundingRate: -0.001,
          updatedAt: now
        }
      ],
      fetchedAt: now
    });

    const leverageIssue = issues.find((issue) => issue.rule === 'leverage_limit');
    expect(leverageIssue).toBeDefined();
    const marginShareIssue = issues.find((issue) => issue.rule === 'margin_share_limit');
    expect(marginShareIssue).toBeDefined();
  });

  it('evaluates open interest related limits with provided metrics', () => {
    const context = {
      totalInitialMargin: 0,
      totalMarginBalance: 1_000_000,
      availableBalance: 900_000,
      snapshots: [
        {
          baseAsset: 'BTC',
          symbol: 'BTCUSDT',
          positionAmt: 50,
          notional: 100_000,
          leverage: 1,
          initialMargin: 1_000,
          isolatedMargin: 0,
          marginType: 'cross' as const,
          direction: 'long' as const,
          markPrice: 2_000,
          predictedFundingRate: -0.001,
          updatedAt: now
        }
      ],
      fetchedAt: now
    };

    const metrics = new Map<string, SymbolMetrics>([
      [
        'BTCUSDT',
        {
          symbol: 'BTCUSDT',
          baseAsset: 'BTC',
          openInterest: 500, // share = 50 / 500 = 0.1 > 0.02
          marketCap: 100_000_000,
          volume24h: 10_000_000,
          hhi: 0.1,
          fetchedAt: now
        }
      ]
    ]);

    const issues = engine.evaluate(context, metrics);
    const shareIssue = issues.find((issue) => issue.rule === 'oi_share_limit' && issue.baseAsset === 'BTCUSDT');
    expect(shareIssue).toBeDefined();
    expect(shareIssue?.threshold).toBeCloseTo(0.02);
    expect(shareIssue?.value).toBeCloseTo(0.1);
    const oiMinimumIssue = issues.find((issue) => issue.rule === 'oi_minimum' && issue.baseAsset === 'BTCUSDT');
    expect(oiMinimumIssue).toBeDefined();
  });

  it('evaluates market cap and volume limits via metrics', () => {
    const context = {
      totalInitialMargin: 0,
      totalMarginBalance: 1_000_000,
      availableBalance: 800_000,
      snapshots: [
        {
          baseAsset: 'BTC',
          symbol: 'BTCUSDT',
          positionAmt: 10,
          notional: 200_000,
          leverage: 1,
          initialMargin: 500,
          isolatedMargin: 0,
          marginType: 'cross' as const,
          direction: 'long' as const,
          markPrice: 20_000,
          predictedFundingRate: -0.001,
          updatedAt: now
        }
      ],
      fetchedAt: now
    };

    const metrics = new Map<string, SymbolMetrics>([
      [
        'BTCUSDT',
        {
          symbol: 'BTCUSDT',
          baseAsset: 'BTC',
          openInterest: 5_000_000,
          marketCap: 10_000_000, // below 50m
          volume24h: 500_000, // below 1m
          hhi: 0.15,
          fetchedAt: now
        }
      ]
    ]);

    const issues = engine.evaluate(context, metrics);
    const marketCapIssue = issues.find((issue) => issue.rule === 'market_cap_minimum' && issue.baseAsset === 'BTCUSDT');
    expect(marketCapIssue).toBeDefined();
    expect(marketCapIssue?.threshold).toBe(50_000_000);
    const volumeIssue = issues.find((issue) => issue.rule === 'volume_24h_minimum' && issue.baseAsset === 'BTCUSDT');
    expect(volumeIssue).toBeDefined();
  });

  it('reports missing data when metrics are unavailable', () => {
    const context = {
      totalInitialMargin: 0,
      totalMarginBalance: 1_000_000,
      availableBalance: 900_000,
      snapshots: [
        {
          baseAsset: 'BTC',
          symbol: 'BTCUSDT',
          positionAmt: 5,
          notional: 100_000,
          leverage: 1,
          initialMargin: 500,
          isolatedMargin: 0,
          marginType: 'cross' as const,
          direction: 'long' as const,
          markPrice: 20_000,
          predictedFundingRate: -0.001,
          updatedAt: now
        }
      ],
      fetchedAt: now
    };

    const metrics = new Map<string, SymbolMetrics>([
      [
        'BTCUSDT',
        {
          symbol: 'BTCUSDT',
          baseAsset: 'BTC',
          openInterest: null,
          marketCap: null,
          volume24h: null,
          hhi: null,
          fetchedAt: now
        }
      ]
    ]);

    const issues = engine.evaluate(context, metrics);
    const dataMissingIssue = issues.find((issue) => issue.rule === 'data_missing' && issue.baseAsset === 'BTCUSDT');
    expect(dataMissingIssue).toBeDefined();
    expect(Array.isArray(dataMissingIssue?.details?.missingFields)).toBe(true);
    expect(dataMissingIssue?.details?.missingFields).toContain('集中度HHI');
  });

  it('emits concentration issue when HHI exceeds threshold', () => {
    const context = {
      totalInitialMargin: 0,
      totalMarginBalance: 1_000_000,
      availableBalance: 800_000,
      snapshots: [
        {
          baseAsset: 'BTC',
          symbol: 'BTCUSDT',
          positionAmt: 5,
          notional: 100_000,
          leverage: 1,
          initialMargin: 500,
          isolatedMargin: 0,
          marginType: 'cross' as const,
          direction: 'long' as const,
          markPrice: 20_000,
          predictedFundingRate: -0.001,
          updatedAt: now
        }
      ],
      fetchedAt: now
    };

    const metrics = new Map<string, SymbolMetrics>([
      [
        'BTCUSDT',
        {
          symbol: 'BTCUSDT',
          baseAsset: 'BTC',
          openInterest: 10_000_000,
          marketCap: 200_000_000,
          volume24h: 5_000_000,
          hhi: 0.25,
          fetchedAt: now
        }
      ]
    ]);

    const issues = engine.evaluate(context, metrics);
    const hhiIssue = issues.find((issue) => issue.rule === 'concentration_hhi_limit' && issue.baseAsset === 'BTCUSDT');
    expect(hhiIssue).toBeDefined();
    expect(hhiIssue?.threshold).toBeCloseTo(0.2);
    expect(hhiIssue?.value).toBeCloseTo(0.25);
  });

  it('flags blacklist violation for prohibited short positions', () => {
    const issues = engine.evaluate({
      totalInitialMargin: 0,
      totalMarginBalance: 100,
      availableBalance: 70,
      snapshots: [
        {
          baseAsset: 'BTC',
          symbol: 'BTCUSDT',
          positionAmt: -1,
          notional: 100,
          leverage: 2,
          initialMargin: 20,
          isolatedMargin: 0,
          marginType: 'cross',
          direction: 'short',
          markPrice: 100,
          predictedFundingRate: -0.001,
          updatedAt: now
        }
      ],
      fetchedAt: now
    });

    const blacklistIssue = issues.find(
      (issue) => issue.rule === 'blacklist_violation' && issue.baseAsset === 'BTC' && issue.direction === 'short'
    );
    expect(blacklistIssue).toBeDefined();
  });

  it('reports total margin usage when exceeding account limit', () => {
    const issues = engine.evaluate({
      totalInitialMargin: 0,
      totalMarginBalance: 100,
      availableBalance: 50,
      snapshots: [
        {
          baseAsset: 'ETH',
          symbol: 'ETHUSDT',
          positionAmt: 1,
          notional: 100,
          leverage: 2,
          initialMargin: 120,
          isolatedMargin: 0,
          marginType: 'cross',
          direction: 'long',
          markPrice: 100,
          predictedFundingRate: -0.001,
          updatedAt: now
        }
      ],
      fetchedAt: now
    });

    const usageIssue = issues.find((issue) => issue.rule === 'total_margin_usage');
    expect(usageIssue).toBeDefined();
  });
});
