import { describe, expect, it } from 'vitest';
import { buildPositionAlertCard } from '../notifications/positionCardBuilder.js';

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
