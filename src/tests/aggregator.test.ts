import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

type AggregatorModule = typeof import('../orders/aggregator.js');
type TypesModule = typeof import('../orders/types.js');
type EventMapperModule = typeof import('../orders/eventMapper.js');

let OrderAggregator: AggregatorModule['OrderAggregator'];
let Scenario: TypesModule['Scenario'];
let toOrderEvent: EventMapperModule['toOrderEvent'];

const BASE_EVENT = {
  e: 'ORDER_TRADE_UPDATE' as const,
  E: Date.now(),
  T: Date.now(),
  o: {
    s: 'BTCUSDT',
    c: 'TP-001',
    S: 'BUY',
    o: 'LIMIT',
    x: 'TRADE',
    X: 'FILLED',
    i: 1,
    q: '1',
    z: '1',
    l: '1',
    ap: '45000',
    L: '45000',
    p: '45000',
    m: false,
    T: Date.now()
  }
};

function buildEvent(overrides: Partial<typeof BASE_EVENT['o']>, extra?: Partial<typeof BASE_EVENT>) {
  const raw = {
    ...BASE_EVENT,
    ...extra,
    E: extra?.E ?? Date.now(),
    T: extra?.T ?? Date.now(),
    o: {
      ...BASE_EVENT.o,
      ...overrides
    }
  };
  return toOrderEvent(raw as any);
}

beforeAll(async () => {
  process.env.BINANCE_API_KEY = process.env.BINANCE_API_KEY || 'test-key';
  process.env.BINANCE_API_SECRET = process.env.BINANCE_API_SECRET || 'test-secret';
  process.env.BINANCE_BASE_URL = process.env.BINANCE_BASE_URL || 'https://fapi.binance.com';
  process.env.BINANCE_WS_BASE_URL = process.env.BINANCE_WS_BASE_URL || 'wss://fstream.binance.com/ws';
  process.env.FEISHU_WEBHOOK_URL = process.env.FEISHU_WEBHOOK_URL || 'https://example.com/webhook';
  process.env.AGGREGATION_WINDOW_MS = '1000';

  const eventMapperModule = await import('../orders/eventMapper.js');
  const typesModule = await import('../orders/types.js');
  const aggregatorModule = await import('../orders/aggregator.js');

  toOrderEvent = eventMapperModule.toOrderEvent;
  Scenario = typesModule.Scenario;
  OrderAggregator = aggregatorModule.OrderAggregator;
});

describe('OrderAggregator', () => {
  vi.useFakeTimers();

  let notifications: any[];
  let aggregator: InstanceType<typeof OrderAggregator>;

  beforeEach(() => {
    notifications = [];
    aggregator = new OrderAggregator({ aggregationWindowMs: 1000 });
    aggregator.onNotify((notification) => {
      notifications.push(notification);
    });
  });

  it('handles 普通订单一次性全部成交', async () => {
    const event = buildEvent({ o: 'LIMIT', X: 'FILLED', q: '1', z: '1', l: '1', c: 'ORD-1' });
    await aggregator.handleEvent(event);

    expect(notifications).toHaveLength(1);
    expect(notifications[0].scenario).toBe(Scenario.GENERAL_SINGLE);
    expect(notifications[0].side).toBe('BUY');
    expect(notifications[0].source).toBe('其他');
    expect(notifications[0].stateLabel).toBe('成交');
    expect(notifications[0].cumulativeQuantity).toBe('1');
    expect(notifications[0].priceSource).toBe('average');
  });

  it('handles 普通订单分批成交且 10 秒内全部完成', async () => {
    const partial = buildEvent({ o: 'LIMIT', X: 'PARTIALLY_FILLED', z: '0.5', l: '0.5', c: 'ORD-2' });
    const filled = buildEvent({ o: 'LIMIT', X: 'FILLED', z: '1', l: '0.5', c: 'ORD-2' });

    await aggregator.handleEvent(partial);
    await aggregator.handleEvent(filled);

    expect(notifications).toHaveLength(1);
    expect(notifications[0].scenario).toBe(Scenario.GENERAL_AGGREGATED);
    expect(notifications[0].source).toBe('其他');
    expect(notifications[0].cumulativeQuantity).toBe('1');
    expect(notifications[0].priceSource).toBe('average');
  });

  it('handles 普通订单分批成交但 10 秒内无新增成交', async () => {
    const partial = buildEvent({ o: 'LIMIT', X: 'PARTIALLY_FILLED', z: '0.3', l: '0.3', c: 'ORD-3' });
    await aggregator.handleEvent(partial);

    vi.advanceTimersByTime(1000);
    await vi.runAllTimersAsync();

    expect(notifications).toHaveLength(1);
    expect(notifications[0].scenario).toBe(Scenario.GENERAL_TIMEOUT);
    expect(notifications[0].stateLabel).toBe('部分成交');
    expect(notifications[0].source).toBe('其他');
    expect(notifications[0].cumulativeQuantity).toBe('0.3');
    expect(notifications[0].priceSource).toBe('average');
  });

  it('handles SL/TP 创建', async () => {
    const event = buildEvent({ o: 'LIMIT', X: 'NEW', x: 'NEW', p: '43000', c: 'SL123', q: '2', z: '0' });
    await aggregator.handleEvent(event);

    expect(notifications).toHaveLength(1);
    expect(notifications[0].scenario).toBe(Scenario.SLTP_NEW);
    expect(notifications[0].source).toBe('止损');
    expect(notifications[0].stateLabel).toBe('创建');
    expect(notifications[0].cumulativeQuantity).toBeUndefined();
    expect(notifications[0].priceSource).toBe('order');
  });

  it('handles SL/TP 取消', async () => {
    const event = buildEvent({ o: 'LIMIT', X: 'CANCELED', x: 'CANCELED', p: '43000', c: 'SL999', z: '0' });
    await aggregator.handleEvent(event);

    expect(notifications).toHaveLength(1);
    expect(notifications[0].scenario).toBe(Scenario.SLTP_CANCELED);
    expect(notifications[0].source).toBe('止损');
    expect(notifications[0].stateLabel).toBe('取消');
    expect(notifications[0].cumulativeQuantity).toBeUndefined();
    expect(notifications[0].priceSource).toBe('order');
  });

  it('handles SL/TP 完全成交', async () => {
    const event = buildEvent({ o: 'LIMIT', X: 'FILLED', z: '1', l: '1', c: 'TP-100' });
    await aggregator.handleEvent(event);

    expect(notifications).toHaveLength(1);
    expect(notifications[0].scenario).toBe(Scenario.SLTP_FILLED);
    expect(notifications[0].source).toBe('止盈');
    expect(notifications[0].stateLabel).toBe('成交');
    expect(notifications[0].cumulativeQuantity).toBe('1');
    expect(notifications[0].priceSource).toBe('average');
  });

  it('handles SL/TP 部分成交且 10 秒内完成', async () => {
    const partial = buildEvent({ o: 'LIMIT', X: 'PARTIALLY_FILLED', z: '0.6', l: '0.6', c: 'TP-200' });
    const filled = buildEvent({ o: 'LIMIT', X: 'FILLED', z: '1', l: '0.4', c: 'TP-200' });

    await aggregator.handleEvent(partial);
    await aggregator.handleEvent(filled);

    expect(notifications).toHaveLength(1);
    expect(notifications[0].scenario).toBe(Scenario.SLTP_PARTIAL_COMPLETED);
    expect(notifications[0].source).toBe('止盈');
    expect(notifications[0].stateLabel).toBe('成交');
    expect(notifications[0].cumulativeQuantity).toBe('1');
    expect(notifications[0].priceSource).toBe('average');
  });

  it('handles SL/TP 部分成交但 10 秒内未补足', async () => {
    const partial = buildEvent({ o: 'LIMIT', X: 'PARTIALLY_FILLED', z: '0.4', l: '0.4', c: 'TP-300' });
    await aggregator.handleEvent(partial);

    vi.advanceTimersByTime(1000);
    await vi.runAllTimersAsync();

    expect(notifications).toHaveLength(1);
    expect(notifications[0].scenario).toBe(Scenario.SLTP_PARTIAL_TIMEOUT);
    expect(notifications[0].source).toBe('止盈');
    expect(notifications[0].stateLabel).toBe('部分成交');
    expect(notifications[0].cumulativeQuantity).toBe('0.4');
    expect(notifications[0].priceSource).toBe('average');
  });

  it('handles SL/TP 部分成交后取消', async () => {
    const partial = buildEvent({ o: 'LIMIT', X: 'PARTIALLY_FILLED', z: '0.5', l: '0.5', c: 'TP-400' });
    const cancel = buildEvent({ o: 'LIMIT', X: 'CANCELED', x: 'CANCELED', z: '0.5', l: '0', c: 'TP-400' });

    await aggregator.handleEvent(partial);
    await aggregator.handleEvent(cancel);

    expect(notifications).toHaveLength(1);
    expect(notifications[0].scenario).toBe(Scenario.SLTP_PARTIAL_CANCELED);
    expect(notifications[0].source).toBe('止盈');
    expect(notifications[0].stateLabel).toBe('取消');
    expect(notifications[0].cumulativeQuantity).toBe('0.5');
    expect(notifications[0].priceSource).toBe('average');
  });

  it('ignores 非 SL/TP 的非市价订单', async () => {
    const event = buildEvent({ o: 'LIMIT', X: 'NEW', x: 'NEW', c: 'XX-1' });
    await aggregator.handleEvent(event);

    expect(notifications).toHaveLength(0);
  });

  it('handles 普通订单部分成交后取消', async () => {
    const partial = buildEvent({ o: 'LIMIT', X: 'PARTIALLY_FILLED', z: '0.2', l: '0.2', c: 'ORD-4' });
    const cancel = buildEvent({ o: 'LIMIT', X: 'CANCELED', z: '0.2', l: '0', c: 'ORD-4' });

    await aggregator.handleEvent(partial);
    await aggregator.handleEvent(cancel);

    expect(notifications).toHaveLength(1);
    expect(notifications[0].scenario).toBe(Scenario.GENERAL_PARTIAL_CANCELED);
    expect(notifications[0].source).toBe('其他');
    expect(notifications[0].stateLabel).toBe('取消');
    expect(notifications[0].cumulativeQuantity).toBe('0.2');
    expect(notifications[0].priceSource).toBe('average');
  });
});
