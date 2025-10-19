import { describe, expect, it } from 'vitest';
import { buildFeishuCard } from '../notifications/cardBuilder.js';
import { Scenario } from '../orders/types.js';

describe('buildFeishuCard', () => {
  it('builds card for成交类场景 with平均成交价格', () => {
    const payload = buildFeishuCard({
      scenario: Scenario.MARKET_SINGLE,
      symbol: 'BTCUSDT',
      stateLabel: '市价成交',
      size: '1',
      cumulativeQuantity: '1',
      displayPrice: '45000',
      notifyTime: new Date('2024-01-01T00:00:00Z'),
      orderType: 'MARKET',
      status: 'FILLED',
      rawEvents: []
    });

    expect(payload.msg_type).toBe('interactive');
    const card = payload.card as any;
    const header = card.header;
    expect(header.title.content).toBe('交易对 BTCUSDT');
    const pairField = card.elements[1].fields[0].text.content;
    expect(pairField).toContain('交易对');
    const directionField = card.elements[1].fields[1].text.content;
    expect(directionField).toContain('方向');
    expect(directionField).toContain('买入');
    const sizeField = card.elements[2].fields[0].text.content;
    expect(sizeField).toContain('Size');
    const priceText = card.elements[3].text.content;
    expect(priceText).toContain('平均成交价格');
  });

  it('builds card for 创建场景 with 挂单价格 label', () => {
    const payload = buildFeishuCard({
      scenario: Scenario.SLTP_NEW,
      symbol: 'ETHUSDT',
      stateLabel: '创建',
      size: '2',
      displayPrice: '2300',
      notifyTime: new Date('2024-01-01T00:00:00Z'),
      orderType: 'LIMIT',
      status: 'NEW',
      rawEvents: []
    });

    const card = payload.card as any;
    const directionField = card.elements[1].fields[1].text.content;
    expect(directionField).toContain('方向');
    expect(directionField).toContain('买入');
    const priceText = card.elements[3].text.content;
    expect(priceText).toContain('价格');
    expect(priceText).not.toContain('平均');
  });
});
