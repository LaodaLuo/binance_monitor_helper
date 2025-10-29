import { describe, expect, it } from 'vitest';
import { buildPositionAlertCard, buildPositionAlertDigestCard } from '../notifications/positionCardBuilder.js';

describe('buildPositionAlertCard', () => {
  it('在卡片中以 UTC+8 展示时间字段', () => {
    const cardPayload = buildPositionAlertCard({
      title: '持仓风险',
      scopeLabel: '全局',
      statusLabel: '告警',
      severity: 'critical',
      ruleLabel: '风险阈值',
      message: '测试消息',
      firstDetectedAt: Date.parse('2024-05-01T00:00:00Z'),
      triggeredAt: Date.parse('2024-05-01T04:30:00Z'),
      repeat: false
    });

    const card = cardPayload.card as any;
    const firstDetected = card.elements[3].text.content;
    expect(firstDetected).toContain('首次发现');
    expect(firstDetected).toContain('2024-05-01 08:00:00');

    const latestDetected = card.elements[4].text.content;
    expect(latestDetected).toContain('最新检测');
    expect(latestDetected).toContain('2024-05-01 12:30:00');
  });
});

describe('buildPositionAlertDigestCard', () => {
  it('汇总卡片包含多条事件并展示时间', () => {
    const triggeredAt = Date.parse('2024-05-01T04:30:00Z');
    const cardPayload = buildPositionAlertDigestCard({
      triggeredAt,
      events: [
        {
          title: '规则A - 账户',
          scopeLabel: '账户',
          statusLabel: '告警',
          severity: 'critical',
          ruleLabel: '规则A',
          message: '示例告警',
          repeat: false,
          firstDetectedAt: Date.parse('2024-05-01T00:00:00Z'),
          triggeredAt,
          extraFields: [{ label: '交易对', value: 'BTCUSDT' }]
        },
        {
          title: '规则B - ETH 多头',
          scopeLabel: 'ETH 多头',
          statusLabel: '恢复',
          severity: 'warning',
          ruleLabel: '规则B',
          message: '示例恢复',
          repeat: false,
          firstDetectedAt: Date.parse('2024-04-30T23:00:00Z'),
          triggeredAt
        }
      ]
    });

    const card = cardPayload.card as any;
    expect(card.header.title.content).toContain('2 条提醒');
    expect(card.header.template).toBe('red');

    const summary = card.elements[0].text.content as string;
    expect(summary).toContain('**事件数量:** 2');
    expect(summary).toContain('2024-05-01 12:30:00');

    const firstDetail = card.elements[1].text.content as string;
    expect(firstDetail).toContain('1. 规则A - 账户');
    expect(firstDetail).toContain('状态: 告警');
    expect(firstDetail).toContain('交易对: BTCUSDT');

    const secondDetail = card.elements[3].text.content as string;
    expect(secondDetail).toContain('2. 规则B - ETH 多头');
    expect(secondDetail).toContain('状态: 恢复');
  });
});
