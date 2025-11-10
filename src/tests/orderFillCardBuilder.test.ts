import { describe, expect, it } from 'vitest';
import { buildOrderFillCard } from '../notifications/orderFillCardBuilder.js';
import type { OrderEvent, RawOrderTradeUpdate } from '../orders/types.js';

const tradeTimestamp = Date.parse('2024-05-01T04:30:00Z');

describe('buildOrderFillCard', () => {
  it('根据前缀和方向生成标题', () => {
    const event = createFilledEvent({
      clientOrderId: 'SL_stop',
      side: 'SELL'
    });
    const card = buildOrderFillCard(event);
    const header = card.card.header as any;
    expect(header.title.content).toBe('BTCUSDT-卖出-固定止损');
  });

  it('展示数量、均价和成交时间', () => {
    const event = createFilledEvent({
      originalQuantity: '1.25',
      averagePrice: '62888.5'
    });
    const card = buildOrderFillCard(event);
    const fields = card.card.elements[0].fields as any[];
    expect(fields[0].text.content).toContain('1.25');
    expect(fields[1].text.content).toContain('62888.5');

    const timeLine = card.card.elements[1].text.content as string;
    expect(timeLine).toContain('最后成交时间');
    expect(timeLine).toContain('2024-05-01 12:30:00 (UTC+8)');
  });
});

function createFilledEvent(overrides: Partial<OrderEvent> = {}): OrderEvent {
  return {
    symbol: 'BTCUSDT',
    orderId: 2,
    clientOrderId: 'TP2_alpha',
    originalClientOrderId: undefined,
    side: 'BUY',
    orderType: 'LIMIT',
    status: 'FILLED',
    eventTime: new Date(tradeTimestamp),
    tradeTime: new Date(tradeTimestamp),
    originalQuantity: '0.8',
    cumulativeQuantity: '0.8',
    lastQuantity: '0.8',
    averagePrice: '62000',
    lastPrice: '62000',
    orderPrice: '62000',
    stopPrice: undefined,
    isMaker: false,
    raw: createFillRaw(),
    ...overrides
  };
}

function createFillRaw(overrides: Partial<RawOrderTradeUpdate['o']> = {}): RawOrderTradeUpdate {
  const merged = {
    s: 'BTCUSDT',
    c: 'TP2_alpha',
    C: undefined,
    S: 'BUY' as const,
    o: 'LIMIT',
    x: 'TRADE',
    X: 'FILLED',
    i: 2,
    q: '0.8',
    z: '0.8',
    l: '0.8',
    ap: '62000',
    L: '62000',
    p: '62000',
    sp: undefined,
    rp: '0',
    b: '0',
    a: '0',
    m: false,
    T: tradeTimestamp,
    ...overrides
  };

  return {
    e: 'ORDER_TRADE_UPDATE',
    E: tradeTimestamp,
    T: tradeTimestamp,
    o: merged
  };
}
