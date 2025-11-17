import { describe, expect, it } from 'vitest';
import { buildOrderFillCard } from '../notifications/orderFillCardBuilder.js';
import type { OrderEvent, RawOrderTradeUpdate } from '../orders/types.js';

const tradeTimestamp = Date.parse('2024-05-01T04:30:00Z');

describe('buildOrderFillCard', () => {
  it('标题仅包含交易对与来源，header 颜色随加/减仓动作', () => {
    const event = createFilledEvent({
      clientOrderId: 'SL_stop',
      side: 'SELL',
      positionSide: 'LONG'
    });
    const card = buildOrderFillCard(event);
    const cardBody = card.card as any;
    const header = cardBody.header;
    expect(header.title.content).toBe('BTCUSDT-硬止损单');
    expect(header.template).toBe('red');
  });

  it('做空仓（BUY 平仓）卡片背景红色，动作标红', () => {
    const event = createFilledEvent({
      clientOrderId: 'TP1_alpha',
      side: 'BUY',  // 平空仓
      positionSide: 'SHORT'
    });
    const card = buildOrderFillCard(event);
    const cardBody = card.card as any;
    const header = cardBody.header;
    expect(header.template).toBe('red');
    const fields = cardBody.elements[0].fields as any[];
    expect(fields[0].text.content).toContain('<font color="red">做空</font>');
    expect(fields[1].text.content).toContain('<font color="red">减仓</font>');
  });

  it('做多仓（SELL 平仓）卡片背景红色，动作标红', () => {
    const event = createFilledEvent({
      clientOrderId: 'TP2_beta',
      side: 'SELL',  // 平多仓
      positionSide: 'LONG'
    });
    const card = buildOrderFillCard(event);
    const cardBody = card.card as any;
    const header = cardBody.header;
    expect(header.template).toBe('red');
    const fields = cardBody.elements[0].fields as any[];
    expect(fields[0].text.content).toContain('<font color="green">做多</font>');
    expect(fields[1].text.content).toContain('<font color="red">减仓</font>');
  });

  it('追踪止损单依旧判定为减仓且标红', () => {
    const event = createFilledEvent({
      clientOrderId: 'FT_track',
      side: 'BUY'
    });
    const card = buildOrderFillCard(event);
    const cardBody = card.card as any;
    const header = cardBody.header;
    expect(header.title.content).toBe('BTCUSDT-追踪止损');
    const fields = cardBody.elements[0].fields as any[];
    expect(fields[1].text.content).toContain('<font color="red">减仓</font>');
  });

  it('时间周期止损单在成交卡片中展示周期且标红', () => {
    const event = createFilledEvent({
      clientOrderId: 'TW_15m',
      side: 'SELL',
      positionSide: 'LONG'
    });
    const card = buildOrderFillCard(event);
    const cardBody = card.card as any;
    const header = cardBody.header;
    expect(header.title.content).toBe('BTCUSDT-15m 时间周期止损单');
    expect(header.template).toBe('red');
  });

  it('其他订单在缺省持仓方向时退回买入/卖出判断，header 颜色跟随动作', () => {
    const event = createFilledEvent({
      clientOrderId: 'custom_order',
      side: 'BUY',
      positionSide: 'BOTH'
    });
    const card = buildOrderFillCard(event);
    const cardBody = card.card as any;
    const header = cardBody.header;
    expect(header.title.content).toBe('BTCUSDT-其他来源');
    expect(header.template).toBe('green');
    const fields = cardBody.elements[0].fields as any[];
    expect(fields[0].text.content).toContain('<font color="green">做多</font>');
    expect(fields[1].text.content).toContain('<font color="green">加仓</font>');
  });

  it('展示数量、均价和成交时间', () => {
    const event = createFilledEvent({
      originalQuantity: '1.25',
      averagePrice: '62888.5'
    });
    const card = buildOrderFillCard(event);
    const cardBody = card.card as any;
    const elements = cardBody.elements as any[];
    const quantityFields = elements[1].fields as any[];
    expect(quantityFields[0].text.content).toContain('1.25');
    expect(quantityFields[1].text.content).toContain('62888.5');

    const timeLine = elements[2].text.content as string;
    expect(timeLine).toContain('最后成交时间');
    expect(timeLine).toContain('2024-05-01 12:30:00 (UTC+8)');
  });
});

function createFilledEvent(overrides: Partial<OrderEvent> = {}): OrderEvent {
  const side = overrides.side ?? 'BUY';
  const positionSide = overrides.positionSide ?? 'LONG';
  const baseEvent: OrderEvent = {
    symbol: 'BTCUSDT',
    orderId: 2,
    clientOrderId: 'TP2_alpha',
    originalClientOrderId: undefined,
    side,
    positionSide,
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
    raw: createFillRaw({ S: side, ps: positionSide })
  };

  return {
    ...baseEvent,
    ...overrides,
    side,
    positionSide,
    raw: overrides.raw ?? baseEvent.raw
  };
}

function createFillRaw(overrides: Partial<RawOrderTradeUpdate['o']> = {}): RawOrderTradeUpdate {
  const merged = {
    s: 'BTCUSDT',
    c: 'TP2_alpha',
    C: undefined,
    S: 'BUY' as const,
    ps: 'LONG' as const,
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
