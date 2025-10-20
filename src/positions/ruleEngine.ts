import { getConfiguredAssets, getTotalMarginUsageLimit, positionRulesConfig, resolvePositionRule } from '../config/positionRules.js';
import type { AccountContext, GroupedPositions, PositionSnapshot, ValidationIssue } from './types.js';

function groupPositionsByAsset(snapshots: PositionSnapshot[]): Map<string, GroupedPositions> {
  const grouped = new Map<string, GroupedPositions>();

  for (const snapshot of snapshots) {
    const entry = grouped.get(snapshot.baseAsset) ?? { long: [], short: [] };
    entry[snapshot.direction].push(snapshot);
    grouped.set(snapshot.baseAsset, entry);
  }

  return grouped;
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(2)}%`;
}

function aggregateInitialMargin(positions: PositionSnapshot[]): number {
  return positions.reduce((sum, position) => sum + Math.abs(position.initialMargin), 0);
}

function aggregateNotional(positions: PositionSnapshot[]): number {
  return positions.reduce((sum, position) => sum + Math.abs(position.notional), 0);
}

export class PositionRuleEngine {
  evaluate(context: AccountContext): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    const grouped = groupPositionsByAsset(context.snapshots);
    const candidateAssets = new Set<string>([...getConfiguredAssets(), ...grouped.keys()]);

    const totalMarginBalance = context.totalMarginBalance;

    for (const asset of candidateAssets) {
      const rule = resolvePositionRule(asset);
      const positions = grouped.get(asset) ?? { long: [], short: [] };

      const whitelistLong = rule.whitelistLong;
      const whitelistShort = rule.whitelistShort;
      const blacklistLong = rule.blacklistLong;
      const blacklistShort = rule.blacklistShort;

      if (whitelistLong && whitelistLong.has(asset) && blacklistLong && blacklistLong.has(asset)) {
        issues.push({
          rule: 'config_error',
          baseAsset: asset,
          direction: 'long',
          severity: 'critical',
          message: `${asset} 多头同时存在白名单与黑名单配置，需检查配置冲突`,
          cooldownMinutes: rule.cooldownMinutes,
          notifyOnRecovery: rule.notifyRecovery,
          details: {
            whitelist: Array.from(whitelistLong),
            blacklist: Array.from(blacklistLong)
          }
        });
      }

      if (whitelistShort && whitelistShort.has(asset) && blacklistShort && blacklistShort.has(asset)) {
        issues.push({
          rule: 'config_error',
          baseAsset: asset,
          direction: 'short',
          severity: 'critical',
          message: `${asset} 空头同时存在白名单与黑名单配置，需检查配置冲突`,
          cooldownMinutes: rule.cooldownMinutes,
          notifyOnRecovery: rule.notifyRecovery,
          details: {
            whitelist: Array.from(whitelistShort),
            blacklist: Array.from(blacklistShort)
          }
        });
      }

      if (whitelistLong && !whitelistLong.has(asset) && positions.long.length > 0) {
        const symbols = positions.long.map((pos) => pos.symbol).join(', ');
        issues.push({
          rule: 'whitelist_violation',
          baseAsset: asset,
          direction: 'long',
          severity: 'critical',
          message: `${asset} 多头不在白名单内，当前持仓包括 ${symbols}`,
          cooldownMinutes: rule.cooldownMinutes,
          notifyOnRecovery: rule.notifyRecovery,
          value: aggregateNotional(positions.long),
          details: {
            symbols,
            whitelist: Array.from(whitelistLong)
          }
        });
      }

      if (whitelistShort && !whitelistShort.has(asset) && positions.short.length > 0) {
        const symbols = positions.short.map((pos) => pos.symbol).join(', ');
        issues.push({
          rule: 'whitelist_violation',
          baseAsset: asset,
          direction: 'short',
          severity: 'critical',
          message: `${asset} 空头不在白名单内，当前持仓包括 ${symbols}`,
          cooldownMinutes: rule.cooldownMinutes,
          notifyOnRecovery: rule.notifyRecovery,
          value: aggregateNotional(positions.short),
          details: {
            symbols,
            whitelist: Array.from(whitelistShort)
          }
        });
      }

      if (blacklistLong && blacklistLong.has(asset) && positions.long.length > 0) {
        const symbols = positions.long.map((pos) => pos.symbol).join(', ');
        issues.push({
          rule: 'blacklist_violation',
          baseAsset: asset,
          direction: 'long',
          severity: 'critical',
          message: `${asset} 多头被列入黑名单，但当前持有 ${symbols}`,
          cooldownMinutes: rule.cooldownMinutes,
          notifyOnRecovery: rule.notifyRecovery,
          value: aggregateNotional(positions.long),
          details: {
            symbols,
            blacklist: Array.from(blacklistLong)
          }
        });
      }

      if (blacklistShort && blacklistShort.has(asset) && positions.short.length > 0) {
        const symbols = positions.short.map((pos) => pos.symbol).join(', ');
        issues.push({
          rule: 'blacklist_violation',
          baseAsset: asset,
          direction: 'short',
          severity: 'critical',
          message: `${asset} 空头被列入黑名单，但当前持有 ${symbols}`,
          cooldownMinutes: rule.cooldownMinutes,
          notifyOnRecovery: rule.notifyRecovery,
          value: aggregateNotional(positions.short),
          details: {
            symbols,
            blacklist: Array.from(blacklistShort)
          }
        });
      }

      if (rule.maxLeverage !== null) {
        for (const position of [...positions.long, ...positions.short]) {
          if (position.leverage > rule.maxLeverage) {
            issues.push({
              rule: 'leverage_limit',
              baseAsset: asset,
              direction: position.direction,
              severity: 'warning',
              message: `${position.symbol} 杠杆 ${position.leverage} 超过上限 ${rule.maxLeverage}`,
              cooldownMinutes: rule.cooldownMinutes,
              notifyOnRecovery: rule.notifyRecovery,
              value: position.leverage,
              threshold: rule.maxLeverage,
              details: { symbol: position.symbol }
            });
          }
        }
      }

      if (rule.maxMarginShare !== null && totalMarginBalance > 0) {
        const longShare = aggregateInitialMargin(positions.long) / totalMarginBalance;
        const shortShare = aggregateInitialMargin(positions.short) / totalMarginBalance;

        if (longShare > rule.maxMarginShare) {
          issues.push({
            rule: 'margin_share_limit',
            baseAsset: asset,
            direction: 'long',
            severity: 'warning',
            message: `${asset} 多头保证金占比 ${formatPercent(longShare)} 超过上限 ${formatPercent(rule.maxMarginShare)}`,
            cooldownMinutes: rule.cooldownMinutes,
            notifyOnRecovery: rule.notifyRecovery,
            value: longShare,
            threshold: rule.maxMarginShare,
            details: {
              shareDisplay: formatPercent(longShare)
            }
          });
        }

        if (shortShare > rule.maxMarginShare) {
          issues.push({
            rule: 'margin_share_limit',
            baseAsset: asset,
            direction: 'short',
            severity: 'warning',
            message: `${asset} 空头保证金占比 ${formatPercent(shortShare)} 超过上限 ${formatPercent(rule.maxMarginShare)}`,
            cooldownMinutes: rule.cooldownMinutes,
            notifyOnRecovery: rule.notifyRecovery,
            value: shortShare,
            threshold: rule.maxMarginShare,
            details: {
              shareDisplay: formatPercent(shortShare)
            }
          });
        }
      }

      for (const position of positions.short) {
        const threshold = rule.fundingThresholdShort;
        if (threshold !== null) {
          if (position.predictedFundingRate === null) {
            issues.push({
              rule: 'data_missing',
              baseAsset: asset,
              direction: 'short',
              severity: 'warning',
              message: `${position.symbol} 空头预测资金费率缺失`,
              cooldownMinutes: rule.cooldownMinutes,
              notifyOnRecovery: rule.notifyRecovery,
              details: { symbol: position.symbol }
            });
          } else if (position.predictedFundingRate < threshold) {
            issues.push({
              rule: 'funding_rate_limit',
              baseAsset: asset,
              direction: 'short',
              severity: 'warning',
              message: `${position.symbol} 空头资金费率 ${formatPercent(position.predictedFundingRate)} 低于阈值 ${formatPercent(threshold)}`,
              cooldownMinutes: rule.cooldownMinutes,
              notifyOnRecovery: rule.notifyRecovery,
              value: position.predictedFundingRate,
              threshold,
              details: { symbol: position.symbol }
            });
          }
        }
      }

      for (const position of positions.long) {
        const threshold = rule.fundingThresholdLong;
        if (threshold !== null) {
          if (position.predictedFundingRate === null) {
            issues.push({
              rule: 'data_missing',
              baseAsset: asset,
              direction: 'long',
              severity: 'warning',
              message: `${position.symbol} 多头预测资金费率缺失`,
              cooldownMinutes: rule.cooldownMinutes,
              notifyOnRecovery: rule.notifyRecovery,
              details: { symbol: position.symbol }
            });
          } else if (position.predictedFundingRate < threshold) {
            issues.push({
              rule: 'funding_rate_limit',
              baseAsset: asset,
              direction: 'long',
              severity: 'warning',
              message: `${position.symbol} 多头资金费率 ${formatPercent(position.predictedFundingRate)} 低于阈值 ${formatPercent(threshold)}`,
              cooldownMinutes: rule.cooldownMinutes,
              notifyOnRecovery: rule.notifyRecovery,
              value: position.predictedFundingRate,
              threshold,
              details: { symbol: position.symbol }
            });
          }
        }
      }
    }

    const totalMarginUsageLimit = getTotalMarginUsageLimit();
    if (totalMarginBalance <= 0) {
      issues.push({
        rule: 'data_missing',
        baseAsset: '__account__',
        direction: 'global',
        severity: 'critical',
        message: '账户总保证金数据异常，无法计算占用率',
        cooldownMinutes: positionRulesConfig.defaults.cooldownMinutes,
        notifyOnRecovery: positionRulesConfig.defaults.notifyRecovery,
        details: {}
      });
    } else if (totalMarginUsageLimit !== null) {
      const aggregatedInitialMargin = context.snapshots.reduce((sum, snap) => sum + Math.abs(snap.initialMargin), 0);
      const usage = aggregatedInitialMargin / totalMarginBalance;
      if (usage > totalMarginUsageLimit) {
        issues.push({
          rule: 'total_margin_usage',
          baseAsset: '__account__',
          direction: 'global',
          severity: 'critical',
          message: `总保证金占用率 ${formatPercent(usage)} 超过上限 ${formatPercent(totalMarginUsageLimit)}`,
          cooldownMinutes: positionRulesConfig.defaults.cooldownMinutes,
          notifyOnRecovery: positionRulesConfig.defaults.notifyRecovery,
          value: usage,
          threshold: totalMarginUsageLimit,
          details: {}
        });
      }
    }

    return issues;
  }
}

export { groupPositionsByAsset };
