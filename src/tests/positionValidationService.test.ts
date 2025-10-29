import { describe, expect, it, vi } from 'vitest';
import type { AlertEvent, ValidationIssue } from '../positions/types.js';

describe('PositionValidationService', () => {
  it('在同一轮检测中合并告警并只发送一次通知', async () => {
    const now = Date.parse('2024-05-01T04:30:00Z');
    const context = {
      totalInitialMargin: 120_000,
      totalMarginBalance: 150_000,
      availableBalance: 90_000,
      snapshots: [],
      fetchedAt: now
    };

    const issueA: ValidationIssue = {
      rule: 'leverage_limit',
      baseAsset: 'BTC',
      direction: 'long',
      severity: 'warning',
      message: 'BTC 杠杆过高',
      cooldownMinutes: 0,
      notifyOnRecovery: true,
      value: 12,
      threshold: 5,
      details: { symbol: 'BTCUSDT' }
    };

    const issueB: ValidationIssue = {
      rule: 'margin_share_limit',
      baseAsset: 'ETH',
      direction: 'short',
      severity: 'critical',
      message: 'ETH 占比过高',
      cooldownMinutes: 0,
      notifyOnRecovery: true,
      value: 0.4,
      threshold: 0.2,
      details: { shareDisplay: '40%' }
    };

    const events: AlertEvent[] = [
      {
        type: 'alert',
        issue: issueA,
        repeat: false,
        firstDetectedAt: now - 60 * 1000,
        lastSentAt: null
      },
      {
        type: 'alert',
        issue: issueB,
        repeat: false,
        firstDetectedAt: now - 120 * 1000,
        lastSentAt: null
      }
    ];

    const fetcher = {
      fetchAccountContext: vi.fn().mockResolvedValue(context)
    };
    const ruleEngine = {
      evaluate: vi.fn().mockReturnValue([issueA, issueB])
    };
    const alertLimiter = {
      process: vi.fn().mockReturnValue(events)
    };
    const notifier = {
      send: vi.fn().mockResolvedValue(undefined)
    };
    const metricsResult = new Map();
    const metricsFetcher = {
      fetchMetrics: vi.fn().mockResolvedValue(metricsResult)
    };

    const { PositionValidationService } = await import('../positions/positionValidationService.js');

    const service = new PositionValidationService({
      fetcher: fetcher as any,
      ruleEngine: ruleEngine as any,
      alertLimiter: alertLimiter as any,
      notifier: notifier as any,
      metricsFetcher: metricsFetcher as any
    });

    await service.run();

    expect(ruleEngine.evaluate).toHaveBeenCalledWith(context, metricsResult);
    expect(alertLimiter.process).toHaveBeenCalledWith([issueA, issueB], now);
    expect(notifier.send).toHaveBeenCalledTimes(1);

    const [cardPayload] = notifier.send.mock.calls[0] as any[];
    const card = cardPayload.card;
    expect(card.header.title.content).toContain('2 条提醒');
    expect(card.elements[0].text.content).toContain('**事件数量:** 2');

    const firstDetail = card.elements[1].text.content as string;
    expect(firstDetail).toContain('BTC 杠杆过高');
    const secondDetail = card.elements[3].text.content as string;
    expect(secondDetail).toContain('ETH 占比过高');
  });
});
