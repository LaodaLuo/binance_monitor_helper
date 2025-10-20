import { describe, expect, it, vi } from 'vitest';

const now = Date.now();

vi.mock('../config/positionRules.js', () => {
  const defaultRule = {
    maxLeverage: 3,
    maxMarginShare: 0.05,
    fundingThresholdLong: null,
    fundingThresholdShort: -0.002,
    cooldownMinutes: 60,
    notifyRecovery: false,
    minFundingRateDelta: 0
  };

  const config = {
    defaults: {
      ...defaultRule,
      totalMarginUsageLimit: 1
    },
    requiredLongAssets: new Set(['BTC']),
    requiredShortAssets: new Set<string>(),
    forbiddenLongAssets: new Set<string>(),
    forbiddenShortAssets: new Set<string>(),
    overrides: {} as Record<string, unknown>,
    configuredAssets: new Set(['BTC'])
  };

  const overrides: Record<string, any> = {
    BTC: {
      requireLong: true,
      maxLeverage: 10,
      maxMarginShare: 0.5,
      fundingThresholdShort: -0.001
    }
  };

  const resolveRule = (asset: string) => {
    const upper = asset.toUpperCase();
    const override = overrides[upper] ?? {};
    return {
      baseAsset: upper,
      requireLong: override.requireLong ?? config.requiredLongAssets.has(upper),
      requireShort: override.requireShort ?? false,
      forbidLong: override.forbidLong ?? false,
      forbidShort: override.forbidShort ?? false,
      maxLeverage: override.maxLeverage ?? config.defaults.maxLeverage,
      maxMarginShare: override.maxMarginShare ?? config.defaults.maxMarginShare,
      fundingThresholdLong: override.fundingThresholdLong ?? config.defaults.fundingThresholdLong,
      fundingThresholdShort: override.fundingThresholdShort ?? config.defaults.fundingThresholdShort,
      cooldownMinutes: override.cooldownMinutes ?? config.defaults.cooldownMinutes,
      notifyRecovery: override.notifyRecovery ?? config.defaults.notifyRecovery,
      minFundingRateDelta: override.minFundingRateDelta ?? config.defaults.minFundingRateDelta
    };
  };

  return {
    positionRulesConfig: config,
    resolvePositionRule: resolveRule,
    getConfiguredAssets: () => Array.from(config.configuredAssets),
    getTotalMarginUsageLimit: () => config.defaults.totalMarginUsageLimit,
    normalizeBaseAssetId: (asset: string) => asset.toUpperCase()
  };
});

import { PositionRuleEngine } from '../positions/ruleEngine.js';

const engine = new PositionRuleEngine();

describe('PositionRuleEngine', () => {
  it('flags missing required BTC long position', () => {
    const issues = engine.evaluate({
      totalInitialMargin: 0,
      totalMarginBalance: 100,
      availableBalance: 80,
      snapshots: [],
      fetchedAt: now
    });

    const missing = issues.find(
      (issue) => issue.rule === 'required_position' && issue.baseAsset === 'BTC' && issue.direction === 'long'
    );
    expect(missing).toBeDefined();
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
          marginType: 'cross',
          direction: 'long',
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
