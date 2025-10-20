import { appConfig } from '../config/index.js';
import { BinanceAccountFetcher } from './accountFetcher.js';
import { PositionRuleEngine } from './ruleEngine.js';
import { AlertLimiter } from './alertLimiter.js';
import type { AlertEvent, ValidationIssue } from './types.js';
import { buildPositionAlertCard } from '../notifications/positionCardBuilder.js';
import { FeishuNotifier } from '../notifications/notifier.js';
import { logger } from '../utils/logger.js';

interface PositionValidationServiceOptions {
  fetcher?: BinanceAccountFetcher;
  ruleEngine?: PositionRuleEngine;
  alertLimiter?: AlertLimiter;
  notifier?: FeishuNotifier;
  intervalMs?: number;
}

const RULE_LABEL_MAP: Record<ValidationIssue['rule'], string> = {
  required_position: '白名单缺失',
  forbidden_position: '黑名单违规',
  leverage_limit: '杠杆限制',
  margin_share_limit: '保证金占比',
  total_margin_usage: '总保证金使用率',
  funding_rate_limit: '资金费率',
  data_missing: '数据异常'
};

function toPercent(value: number | null | undefined): string | undefined {
  if (value === null || value === undefined) return undefined;
  return `${(value * 100).toFixed(2)}%`;
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
  if (issue.rule === 'forbidden_position' && typeof issue.value === 'number') {
    return issue.value.toFixed(2);
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
  return undefined;
}

export class PositionValidationService {
  private readonly fetcher: BinanceAccountFetcher;
  private readonly ruleEngine: PositionRuleEngine;
  private readonly alertLimiter: AlertLimiter;
  private readonly notifier: FeishuNotifier;
  private readonly intervalMs: number;
  private running = false;

  constructor(options?: PositionValidationServiceOptions) {
    this.fetcher = options?.fetcher ?? new BinanceAccountFetcher();
    this.ruleEngine = options?.ruleEngine ?? new PositionRuleEngine();
    this.alertLimiter = options?.alertLimiter ?? new AlertLimiter();
    this.notifier = options?.notifier ?? new FeishuNotifier();
    this.intervalMs = options?.intervalMs ?? appConfig.positionValidationIntervalMs;
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
      const issues = this.ruleEngine.evaluate(context);
      const events = this.alertLimiter.process(issues, context.fetchedAt);

      if (events.length === 0) {
        logger.debug({ issues: issues.length }, 'Position validation completed without new notifications');
        return;
      }

      for (const event of events) {
        await this.dispatchEvent(event, context.fetchedAt);
      }
    } catch (error) {
      logger.error({ error }, 'Position validation run failed');
    } finally {
      this.running = false;
      logger.debug({ durationMs: Date.now() - startedAt }, 'Position validation cycle finished');
    }
  }

  private async dispatchEvent(event: AlertEvent, triggeredAt: number): Promise<void> {
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

    const message =
      event.type === 'recovery' ? `${ruleLabel} 告警已恢复，当前状态符合配置` : issue.message;

    const card = buildPositionAlertCard({
      scopeLabel: resolveScope(issue),
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
    });

    await this.notifier.send(card);
  }
}
