import { describe, expect, it } from 'vitest';
import { buildFeishuCard } from '../notifications/cardBuilder.js';
import { Scenario } from '../orders/types.js';

describe('buildFeishuCard', () => {
  it('builds card for普通订单成交 场景 with平均成交价格', () => {
    const payload = buildFeishuCard({
      scenario: Scenario.GENERAL_SINGLE,
      symbol: 'BTCUSDT',
      side: 'BUY',
      source: '其他',
      title: 'BTCUSDT-其他',
      stateLabel: '成交',
      displayPrice: '45000',
      priceSource: 'average',
      notifyTime: new Date('2024-01-01T00:00:00Z'),
      orderType: 'LIMIT',
      status: 'FILLED',
      rawEvents: [],
      cumulativeQuote: '45000.00000000',
      cumulativeQuoteDisplay: '45000.00 USDT',
      cumulativeQuoteRatioDisplay: '45.00%',
      tradePnlDisplay: '+5.00 USDT',
      longShortRatioDisplay: '1.50:1.00'
    });

    expect(payload.msg_type).toBe('interactive');
    const card = payload.card as any;
    const header = card.header;
    expect(header.title.content).toBe('BTCUSDT-其他');
    const directionField = card.elements[1].fields[0].text.content;
    expect(directionField).toContain('方向');
    expect(directionField).toContain('买入');
    const amountField = card.elements[1].fields[1].text.content;
    expect(amountField).toContain('累计成交金额');
    expect(amountField).toContain('45000.00 USDT');
    const pnlField = card.elements[2].fields[1].text.content;
    expect(pnlField).toContain('该笔交易累计PnL');
    expect(pnlField).toContain('+5.00 USDT');
    const ratioText = card.elements[3].text.content;
    expect(ratioText).toContain('多空名义比');
    expect(ratioText).toContain('1.50:1.00');
    const priceText = card.elements[4].text.content;
    expect(priceText).toContain('平均成交价格');
    const notifyText = card.elements[5].text.content;
    expect(notifyText).toContain('通知时间');
    expect(notifyText).toContain('2024-01-01 08:00:00 (UTC+8)');
  });

  it('builds card for 创建场景 with 挂单价格 label', () => {
    const payload = buildFeishuCard({
      scenario: Scenario.SLTP_NEW,
      symbol: 'ETHUSDT',
      side: 'BUY',
      source: '止损',
      title: 'ETHUSDT-5%成本止损',
      stateLabel: '创建',
      displayPrice: '2300',
      priceSource: 'order',
      notifyTime: new Date('2024-01-01T00:00:00Z'),
      orderType: 'STOP_MARKET',
      status: 'NEW',
      rawEvents: []
    });

    const card = payload.card as any;
    expect(card.header.title.content).toBe('ETHUSDT-5%成本止损');
    const directionField = card.elements[1].fields[0].text.content;
    expect(directionField).toContain('方向');
    expect(directionField).toContain('买入');
    const amountField = card.elements[1].fields[1].text.content;
    expect(amountField).toContain('累计成交金额');
    expect(amountField).toContain('-');
    const ratioField = card.elements[2].fields[0].text.content;
    expect(ratioField).toContain('累计成交金额占比');
    expect(ratioField).toContain('-');
    const priceText = card.elements[3].text.content;
    expect(priceText).toContain('价格');
    expect(priceText).not.toContain('平均');
    const notifyText = card.elements[4].text.content;
    expect(notifyText).toContain('通知时间');
    expect(notifyText).toContain('2024-01-01 08:00:00 (UTC+8)');
  });
});
