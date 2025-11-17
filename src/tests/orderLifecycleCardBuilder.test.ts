import { describe, expect, it } from 'vitest';
import { buildOrderLifecycleCard } from '../notifications/orderLifecycleCardBuilder.js';
import type { OrderEvent, RawOrderTradeUpdate } from '../orders/types.js';

const baseTimestamp = Date.parse('2024-05-01T00:00:00Z');

describe('buildOrderLifecycleCard', () => {
  it('为 TP 档位生成移动止损标题，并展示方向与数量', () => {
    const event = createOrderEvent({
      clientOrderId: 'TP1_alpha',
      status: 'NEW',
      orderPrice: '65000',
      eventTime: new Date(baseTimestamp)
    });

    const card = buildOrderLifecycleCard(event, 'NEW');
    const cardBody = card.card as any;
    const header = cardBody.header;
    expect(header.title.content).toBe('BTCUSDT-移动止损第1档');
    expect(header.template).toBe('blue');

    const elements = cardBody.elements as any[];
    const fields = elements[1].fields as any[];
    expect(fields[0].text.content).toContain('做多');
    expect(fields[1].text.content).toContain('0.5');
  });

  it('过期事件会追加过期原因', () => {
    const event = createOrderEvent({
      clientOrderId: 'SL_stop',
      status: 'EXPIRED',
      orderType: 'STOP',
      orderPrice: '0',
      stopPrice: '64000',
      raw: createRaw({
        c: 'SL_stop',
        X: 'EXPIRED',
        x: 'EXPIRED_IN_MATCH',
        o: 'STOP',
        sp: '64000'
      })
    });

    const card = buildOrderLifecycleCard(event, 'EXPIRED', '撮合过程中超时 (EXPIRED_IN_MATCH)');
    const cardBody = card.card as any;
    const header = cardBody.header;
    expect(header.title.content).toBe('BTCUSDT-硬止损单');
    const reasonElement = cardBody.elements[3] as any;
    expect(reasonElement.text.content).toContain('过期原因');
    expect(reasonElement.text.content).toContain('EXPIRED_IN_MATCH');
  });

  it('跟踪止损订单优先展示激活价格', () => {
    const event = createOrderEvent({
      clientOrderId: 'FT_move',
      orderType: 'TRAILING_STOP_MARKET',
      activationPrice: '65500',
      stopPrice: '0',
      orderPrice: '0',
      raw: createRaw({
        c: 'FT_move',
        o: 'TRAILING_STOP_MARKET',
        AP: '65500',
        sp: '0',
        p: '0'
      })
    });

    const card = buildOrderLifecycleCard(event, 'NEW');
    const cardBody = card.card as any;
    const priceFields = cardBody.elements[2].fields as any[];
    expect(priceFields[0].text.content).toContain('65500');
  });

  it('为 TW_ 时间周期止损单生成带周期的标题', () => {
    const event = createOrderEvent({
      clientOrderId: 'TW_1m',
      status: 'NEW'
    });

    const card = buildOrderLifecycleCard(event, 'NEW');
    const cardBody = card.card as any;
    const header = cardBody.header;
    expect(header.title.content).toBe('BTCUSDT-1m 时间周期止损单');
    expect(header.template).toBe('blue');
  });
});

function createOrderEvent(overrides: Partial<OrderEvent> = {}): OrderEvent {
  return {
    symbol: 'BTCUSDT',
    orderId: 1,
    clientOrderId: 'TP1_alpha',
    originalClientOrderId: undefined,
    side: 'BUY',
    orderType: 'LIMIT',
    status: 'NEW',
    eventTime: new Date(baseTimestamp),
    tradeTime: new Date(baseTimestamp),
    originalQuantity: '0.5',
    cumulativeQuantity: '0',
    lastQuantity: '0',
    averagePrice: '0',
    lastPrice: '0',
    orderPrice: '65000',
    stopPrice: '64000',
    activationPrice: overrides.activationPrice,
    callbackRate: undefined,
    isMaker: false,
    raw: createRaw(),
    ...overrides
  };
}

function createRaw(overrides: Partial<RawOrderTradeUpdate['o']> = {}): RawOrderTradeUpdate {
  const merged = {
    s: 'BTCUSDT',
    c: 'TP1_alpha',
    C: undefined,
    S: 'BUY' as const,
    o: 'LIMIT',
    x: 'NEW',
    X: 'NEW',
    i: 1,
    q: '0.5',
    z: '0',
    l: '0',
    ap: '0',
    L: '0',
    p: '65000',
    sp: '64000',
    AP: overrides.AP,
    cr: overrides.cr,
    rp: '0',
    b: '0',
    a: '0',
    m: false,
    T: baseTimestamp,
    ...overrides
  };

  return {
    e: 'ORDER_TRADE_UPDATE',
    E: baseTimestamp,
    T: baseTimestamp,
    o: merged
  };
}
