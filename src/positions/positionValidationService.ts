import { appConfig } from '../config/index.js';
import { BinanceAccountFetcher } from './accountFetcher.js';
import { PositionRuleEngine } from './ruleEngine.js';
import { AlertLimiter } from './alertLimiter.js';
import type { AlertEvent, ValidationIssue } from './types.js';
import { buildPositionAlertDigestCard } from '../notifications/positionCardBuilder.js';
import type { PositionAlertDigestEvent } from '../notifications/positionCardBuilder.js';
import { FeishuNotifier } from '../notifications/notifier.js';
import { logger } from '../utils/logger.js';
import { SymbolMetricsFetcher } from './marketDataFetcher.js';

const POSITION_ALERT_WEBHOOK = 'https://open.feishu.cn/open-apis/bot/v2/hook/ed82732d-cd38-41f3-bb50-c2d9cfd081a4';

interface PositionValidationServiceOptions {
  fetcher?: BinanceAccountFetcher;
  ruleEngine?: PositionRuleEngine;
  alertLimiter?: AlertLimiter;
  notifier?: FeishuNotifier;
  intervalMs?: number;
  metricsFetcher?: SymbolMetricsFetcher;
}

const MIN_ALERT_COOLDOWN_MINUTES = 60;

const RULE_LABEL_MAP: Record<ValidationIssue['rule'], string> = {
  whitelist_violation: '白名单限制',
  blacklist_violation: '黑名单限制',
  config_error: '配置异常',
  leverage_limit: '杠杆限制',
  margin_share_limit: '单币保证金占比',
  total_margin_usage: '总保证金使用率',
  funding_rate_limit: '资金费率',
  data_missing: '数据异常',
  oi_share_limit: '仓位占比OI检测',
  oi_minimum: 'OI检测',
  market_cap_minimum: '市值检测',
  volume_24h_minimum: '24小时交易量检测',
  concentration_hhi_limit: '集中度检测'
};

function toPercent(value: number | null | undefined): string | undefined {
  if (value === null || value === undefined) return undefined;
  return `${(value * 100).toFixed(2)}%`;
}

function formatNumber(value: number | null | undefined): string | undefined {
  if (value === null || value === undefined) return undefined;
  const abs = Math.abs(value);
  if (abs >= 1) {
    return value.toLocaleString('en-US', { maximumFractionDigits: value % 1 === 0 ? 0 : 2 });
  }
  return value.toFixed(4);
}

function resolveScope(issue: ValidationIssue): string {
  if (issue.direction === 'global') {
    return '账户';
  }
  const directionLabel = issue.direction === 'long' ? '多头' : '空头';
  return `${issue.baseAsset} ${directionLabel}`;
}

function resolveValueLabel(issue: ValidationIssue): string | undefined {
  if (issue.rule === 'margin_share_limit' || issue.rule === 'total_margin_usage' || issue.rule === 'funding_rate_limit') {
    return toPercent(issue.value ?? undefined);
  }
  if (issue.rule === 'leverage_limit' && typeof issue.value === 'number') {
    return issue.value.toFixed(2);
  }
  if ((issue.rule === 'whitelist_violation' || issue.rule === 'blacklist_violation') && typeof issue.value === 'number') {
    return issue.value.toFixed(2);
  }
  if (issue.rule === 'oi_share_limit' && typeof issue.value === 'number') {
    return toPercent(issue.value);
  }
  if (
    (issue.rule === 'oi_minimum' ||
      issue.rule === 'market_cap_minimum' ||
      issue.rule === 'volume_24h_minimum' ||
      issue.rule === 'concentration_hhi_limit') &&
    typeof issue.value === 'number'
  ) {
    return formatNumber(issue.value);
  }
  return undefined;
}

function resolveThresholdLabel(issue: ValidationIssue): string | undefined {
  if (issue.rule === 'margin_share_limit' || issue.rule === 'total_margin_usage' || issue.rule === 'funding_rate_limit') {
    return toPercent(issue.threshold ?? undefined);
  }
  if (issue.rule === 'leverage_limit' && typeof issue.threshold === 'number') {
    return issue.threshold.toFixed(2);
  }
  if (issue.rule === 'oi_share_limit' && typeof issue.threshold === 'number') {
    return toPercent(issue.threshold);
  }
  if (
    (issue.rule === 'oi_minimum' ||
      issue.rule === 'market_cap_minimum' ||
      issue.rule === 'volume_24h_minimum' ||
      issue.rule === 'concentration_hhi_limit') &&
    typeof issue.threshold === 'number'
  ) {
    return formatNumber(issue.threshold);
  }
  return undefined;
}

export class PositionValidationService {
  private readonly fetcher: BinanceAccountFetcher;
  private readonly ruleEngine: PositionRuleEngine;
  private readonly alertLimiter: AlertLimiter;
  private readonly notifier: FeishuNotifier;
  private readonly intervalMs: number;
  private readonly metricsFetcher: SymbolMetricsFetcher;
  private running = false;

  constructor(options?: PositionValidationServiceOptions) {
    this.fetcher = options?.fetcher ?? new BinanceAccountFetcher();
    this.ruleEngine = options?.ruleEngine ?? new PositionRuleEngine();
    this.alertLimiter = options?.alertLimiter ?? new AlertLimiter({ minCooldownMinutes: MIN_ALERT_COOLDOWN_MINUTES });
    this.notifier = options?.notifier ?? new FeishuNotifier({ webhookUrl: POSITION_ALERT_WEBHOOK });
    this.intervalMs = options?.intervalMs ?? appConfig.positionValidationIntervalMs;
    this.metricsFetcher = options?.metricsFetcher ?? new SymbolMetricsFetcher();
  }

  getIntervalMs(): number {
    return this.intervalMs;
  }

  async run(): Promise<void> {
    if (this.running) {
      logger.warn('Position validation already running, skip this cycle');
      return;
    }

    this.running = true;
    const startedAt = Date.now();
    try {
      const context = await this.fetcher.fetchAccountContext();
      const metrics = await this.metricsFetcher.fetchMetrics(context.snapshots);
      const issues = this.ruleEngine.evaluate(context, metrics);
      const events = this.alertLimiter.process(issues, context.fetchedAt);

      if (events.length === 0) {
        logger.debug({ issues: issues.length }, 'Position validation completed without new notifications');
        return;
      }

      const digestCard = this.buildDigestCard(events, context.fetchedAt);
      await this.notifier.send(digestCard);
      logger.info({ eventCount: events.length }, 'Position validation digest sent');
    } catch (error) {
      logger.error({ error }, 'Position validation run failed');
    } finally {
      this.running = false;
      logger.debug({ durationMs: Date.now() - startedAt }, 'Position validation cycle finished');
    }
  }

  private buildDigestCard(events: AlertEvent[], triggeredAt: number) {
    const digestEvents = events.map((event) => this.buildDigestEvent(event, triggeredAt));
    return buildPositionAlertDigestCard({
      triggeredAt,
      events: digestEvents
    });
  }

  private buildDigestEvent(event: AlertEvent, triggeredAt: number): PositionAlertDigestEvent {
    const issue = event.issue;
    const statusLabel = event.type === 'recovery' ? '恢复' : '告警';
    const ruleLabel = RULE_LABEL_MAP[issue.rule] ?? issue.rule;
    const valueLabel = event.type === 'recovery' ? undefined : resolveValueLabel(issue);
    const thresholdLabel = event.type === 'recovery' ? undefined : resolveThresholdLabel(issue);

    const extraFields: Array<{ label: string; value: string }> = [];
    if (issue.details?.symbols && event.type !== 'recovery') {
      extraFields.push({ label: '涉及交易对', value: String(issue.details.symbols) });
    }
    if (issue.details?.shareDisplay && issue.rule === 'margin_share_limit' && event.type !== 'recovery') {
      extraFields.push({ label: '占比', value: String(issue.details.shareDisplay) });
    }
    if (issue.details?.symbol && typeof issue.details.symbol === 'string' && event.type !== 'recovery') {
      extraFields.push({ label: '交易对', value: issue.details.symbol });
    }
    if (issue.details?.whitelist && event.type !== 'recovery') {
      extraFields.push({ label: '白名单', value: String(issue.details.whitelist) });
    }
    if (issue.details?.blacklist && event.type !== 'recovery') {
      extraFields.push({ label: '黑名单', value: String(issue.details.blacklist) });
    }

    const message =
      event.type === 'recovery' ? `${ruleLabel} 告警已恢复，当前状态符合配置` : issue.message;
    const scopeLabel = resolveScope(issue);
    const title = `${ruleLabel} - ${scopeLabel}`;

    return {
      title,
      scopeLabel,
      statusLabel,
      severity: issue.severity,
      ruleLabel,
      message,
      valueLabel,
      thresholdLabel,
      extraFields: extraFields.length > 0 ? extraFields : undefined,
      firstDetectedAt: event.firstDetectedAt,
      triggeredAt,
      repeat: event.repeat
    };
  }
}
