import { getConfiguredAssets, getTotalMarginUsageLimit, positionRulesConfig, resolvePositionRule } from '../config/positionRules.js';
import type { AccountContext, GroupedPositions, PositionSnapshot, SymbolMetrics, ValidationIssue } from './types.js';

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

function groupPositionsBySymbol(snapshots: PositionSnapshot[]): Map<string, PositionSnapshot[]> {
  const grouped = new Map<string, PositionSnapshot[]>();
  for (const snapshot of snapshots) {
    const current = grouped.get(snapshot.symbol) ?? [];
    current.push(snapshot);
    grouped.set(snapshot.symbol, current);
  }
  return grouped;
}

function aggregateNotional(positions: PositionSnapshot[]): number {
  return positions.reduce((sum, position) => sum + Math.abs(position.notional), 0);
}

export class PositionRuleEngine {
  evaluate(context: AccountContext, symbolMetrics?: Map<string, SymbolMetrics>): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    const grouped = groupPositionsByAsset(context.snapshots);
    const groupedBySymbol = groupPositionsBySymbol(context.snapshots);
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
          } else if (position.predictedFundingRate > threshold) {
            issues.push({
              rule: 'funding_rate_limit',
              baseAsset: asset,
              direction: 'long',
              severity: 'warning',
              message: `${position.symbol} 多头资金费率 ${formatPercent(position.predictedFundingRate)} 高于阈值 ${formatPercent(threshold)}`,
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

    this.evaluateSymbolMetrics(issues, groupedBySymbol, symbolMetrics);

    return issues;
  }

  private evaluateSymbolMetrics(
    issues: ValidationIssue[],
    groupedBySymbol: Map<string, PositionSnapshot[]>,
    symbolMetrics: Map<string, SymbolMetrics> | undefined
  ): void {
    const shareThreshold = 0.02;
    const minOpenInterest = 2_000_000;
    const minMarketCap = 50_000_000;
    const minVolume24h = 1_000_000;
    const maxHhi = 0.2;

    for (const [symbol, positions] of groupedBySymbol.entries()) {
      if (positions.length === 0) continue;
      const metrics = symbolMetrics?.get(symbol);
      const baseRule = resolvePositionRule(positions[0]?.baseAsset ?? symbol);
      const cooldownMinutes = baseRule.cooldownMinutes;
      const notifyRecovery = baseRule.notifyRecovery;
      const missingFields = new Set<string>();

      const openInterestSize = metrics?.openInterest ?? null;
      const referencePrice = metrics?.referencePrice ?? null;
      const openInterestNotional = metrics?.openInterestNotional ?? null;
      if (openInterestNotional !== null && openInterestNotional > 0) {
        const totalNotional = aggregateNotional(positions);
        const share = totalNotional / openInterestNotional;
        if (share > shareThreshold) {
          issues.push({
            rule: 'oi_share_limit',
            baseAsset: symbol,
            direction: 'global',
            severity: 'critical',
            message: `${symbol} 持仓名义金额占 OI ${(share * 100).toFixed(2)}%，超过阈值 ${(shareThreshold * 100).toFixed(
              2
            )}%`,
            cooldownMinutes,
            notifyOnRecovery: notifyRecovery,
            value: share,
            threshold: shareThreshold,
            details: {
              symbol,
              openInterestSize,
              referencePrice,
              openInterestNotional,
              positionNotional: totalNotional
            }
          });
        }

        if (openInterestNotional < minOpenInterest) {
          issues.push({
            rule: 'oi_minimum',
            baseAsset: symbol,
            direction: 'global',
            severity: 'warning',
            message: `${symbol} 当前 OI 名义金额 ${openInterestNotional.toLocaleString()} 低于阈值 ${minOpenInterest.toLocaleString()}`,
            cooldownMinutes,
            notifyOnRecovery: notifyRecovery,
            value: openInterestNotional,
            threshold: minOpenInterest,
            details: {
              symbol,
              openInterestSize,
              referencePrice,
              openInterestNotional
            }
          });
        }
      } else {
        missingFields.add('OI');
        if (referencePrice === null) {
          missingFields.add('价格');
        } else {
          missingFields.add('OI名义金额');
        }
      }

      const marketCap = metrics?.marketCap ?? null;
      if (marketCap !== null) {
        if (marketCap < minMarketCap) {
          issues.push({
            rule: 'market_cap_minimum',
            baseAsset: symbol,
            direction: 'global',
            severity: 'warning',
            message: `${symbol} 市值 ${marketCap.toLocaleString()} 低于阈值 ${minMarketCap.toLocaleString()}`,
            cooldownMinutes,
            notifyOnRecovery: notifyRecovery,
            value: marketCap,
            threshold: minMarketCap,
            details: {
              symbol,
              marketCap
            }
          });
        }
      } else {
        missingFields.add('市值');
      }

      const volume24h = metrics?.volume24h ?? null;
      if (volume24h !== null) {
        if (volume24h < minVolume24h) {
          issues.push({
            rule: 'volume_24h_minimum',
            baseAsset: symbol,
            direction: 'global',
            severity: 'warning',
            message: `${symbol} 24小时成交量 ${volume24h.toLocaleString()} 低于阈值 ${minVolume24h.toLocaleString()}`,
            cooldownMinutes,
            notifyOnRecovery: notifyRecovery,
            value: volume24h,
            threshold: minVolume24h,
            details: {
              symbol,
              volume24h
            }
          });
        }
      } else {
        missingFields.add('24小时成交量');
      }

      const hhi = metrics?.hhi ?? null;
      if (hhi !== null) {
        if (hhi > maxHhi) {
          issues.push({
            rule: 'concentration_hhi_limit',
            baseAsset: symbol,
            direction: 'global',
            severity: 'warning',
            message: `${symbol} 市场集中度 HHI ${(hhi * 100).toFixed(2)}% 高于阈值 ${(maxHhi * 100).toFixed(2)}%`,
            cooldownMinutes,
            notifyOnRecovery: notifyRecovery,
            value: hhi,
            threshold: maxHhi,
            details: {
              symbol,
              hhi
            }
          });
        }
      } else {
        missingFields.add('集中度HHI');
      }

      if (missingFields.size > 0) {
        issues.push({
          rule: 'data_missing',
          baseAsset: symbol,
          direction: 'global',
          severity: 'warning',
          message: `${symbol} 缺少数据：${Array.from(missingFields).join('、')}，无法完成全部检测`,
          cooldownMinutes,
          notifyOnRecovery: notifyRecovery,
          details: {
            symbol,
            missingFields: Array.from(missingFields)
          }
        });
      }
    }
  }
}

export { groupPositionsByAsset };
