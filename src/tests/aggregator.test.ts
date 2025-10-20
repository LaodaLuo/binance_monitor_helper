import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AccountMetricsProvider, AccountSummary } from '../orders/accountMetricsProvider.js';

type AggregatorModule = typeof import('../orders/aggregator.js');
type TypesModule = typeof import('../orders/types.js');
type EventMapperModule = typeof import('../orders/eventMapper.js');

let OrderAggregator: AggregatorModule['OrderAggregator'];
let Scenario: TypesModule['Scenario'];
let toOrderEvent: EventMapperModule['toOrderEvent'];
let metricsProvider: AccountMetricsProvider;
let metricsSummary: AccountSummary;
let getSummaryMock: ReturnType<typeof vi.fn>;

const BASE_EVENT = {
  e: 'ORDER_TRADE_UPDATE' as const,
  E: Date.now(),
  T: Date.now(),
  o: {
    s: 'BTCUSDT',
    c: 'TP-001',
    S: 'BUY',
    o: 'STOP_MARKET',
    x: 'TRADE',
    X: 'FILLED',
    i: 1,
    q: '1',
    z: '1',
    l: '1',
    ap: '45000',
    L: '45000',
    p: '0',
    sp: '45000',
    rp: '0',
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
  if (raw.o.sp === undefined) {
    (raw.o as any).sp = undefined;
  }
  if (raw.o.p === undefined) {
    (raw.o as any).p = undefined;
  }
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
    metricsSummary = {
      totalFunds: 100000,
      fetchedAt: Date.now(),
      positions: new Map()
    };
    getSummaryMock = vi.fn().mockResolvedValue(metricsSummary);
    metricsProvider = {
      getSummary: getSummaryMock
    };

    aggregator = new OrderAggregator({ aggregationWindowMs: 1000, metricsProvider });
    aggregator.onNotify((notification) => {
      notifications.push(notification);
    });
  });

  it('handles 普通订单一次性全部成交', async () => {
    const event = buildEvent({ o: 'LIMIT', X: 'FILLED', q: '1', z: '1', l: '1', c: 'ORD-1', p: '45000', sp: undefined });
    await aggregator.handleEvent(event);

    expect(notifications).toHaveLength(1);
    expect(notifications[0].scenario).toBe(Scenario.GENERAL_SINGLE);
    expect(notifications[0].side).toBe('BUY');
    expect(notifications[0].source).toBe('其他');
    expect(notifications[0].stateLabel).toBe('成交');
    expect(notifications[0].title).toBe('BTCUSDT-其他');
    expect(notifications[0].priceSource).toBe('average');
    expect(notifications[0].displayPrice).toBe('45000.00000000');
    expect(notifications[0].cumulativeQuote).toBe('45000.00000000');
    expect(notifications[0].cumulativeQuoteDisplay).toBe('45000.00 USDT');
    expect(notifications[0].cumulativeQuoteRatioDisplay).toBe('45.00%');
    expect(notifications[0].tradePnlDisplay).toBe('0.00 USDT');
    expect(getSummaryMock).toHaveBeenCalledTimes(1);
  });

  it('handles 普通订单分批成交且 10 秒内全部完成', async () => {
    const partial = buildEvent({ o: 'LIMIT', X: 'PARTIALLY_FILLED', z: '0.5', l: '0.5', c: 'ORD-2', p: '45000', sp: undefined });
    const filled = buildEvent({ o: 'LIMIT', X: 'FILLED', z: '1', l: '0.5', c: 'ORD-2', p: '45000', sp: undefined });

    await aggregator.handleEvent(partial);
    await aggregator.handleEvent(filled);

    expect(notifications).toHaveLength(1);
    expect(notifications[0].scenario).toBe(Scenario.GENERAL_AGGREGATED);
    expect(notifications[0].source).toBe('其他');
    expect(notifications[0].title).toBe('BTCUSDT-其他');
    expect(notifications[0].priceSource).toBe('average');
    expect(notifications[0].displayPrice).toBe('45000.00000000');
    expect(notifications[0].cumulativeQuoteDisplay).toBe('45000.00 USDT');
    expect(notifications[0].cumulativeQuoteRatioDisplay).toBe('45.00%');
    expect(notifications[0].tradePnlDisplay).toBe('0.00 USDT');
    expect(getSummaryMock).toHaveBeenCalledTimes(1);
  });

  it('aggregates 实现盈亏 rp 字段', async () => {
    const partial = buildEvent({
      o: 'LIMIT',
      X: 'PARTIALLY_FILLED',
      z: '0.5',
      l: '0.5',
      c: 'ORD-PNL',
      p: '45000',
      sp: undefined,
      rp: '2.5'
    });
    const filled = buildEvent({
      o: 'LIMIT',
      X: 'FILLED',
      z: '1',
      l: '0.5',
      c: 'ORD-PNL',
      p: '45000',
      sp: undefined,
      rp: '1.5'
    });

    await aggregator.handleEvent(partial);
    await aggregator.handleEvent(filled);

    expect(notifications).toHaveLength(1);
    expect(notifications[0].tradePnl).toBe('4.00000000');
    expect(notifications[0].tradePnlDisplay).toBe('+4.00 USDT');
    expect(getSummaryMock).toHaveBeenCalledTimes(1);
  });

  it('handles 普通订单分批成交但 10 秒内无新增成交', async () => {
    const partial = buildEvent({ o: 'LIMIT', X: 'PARTIALLY_FILLED', z: '0.3', l: '0.3', c: 'ORD-3', p: '45000', sp: undefined });
    await aggregator.handleEvent(partial);

    vi.advanceTimersByTime(1000);
    await vi.runAllTimersAsync();

    expect(notifications).toHaveLength(1);
    expect(notifications[0].scenario).toBe(Scenario.GENERAL_TIMEOUT);
    expect(notifications[0].stateLabel).toBe('部分成交');
    expect(notifications[0].source).toBe('其他');
    expect(notifications[0].cumulativeQuoteDisplay).toBe('13500.00 USDT');
    expect(notifications[0].cumulativeQuoteRatioDisplay).toBe('13.50%');
    expect(notifications[0].tradePnlDisplay).toBe('0.00 USDT');
    expect(notifications[0].priceSource).toBe('average');
    expect(notifications[0].displayPrice).toBe('45000.00000000');
    expect(getSummaryMock).toHaveBeenCalledTimes(1);
  });

  it('handles SL/TP 创建', async () => {
    const event = buildEvent({
      o: 'STOP_MARKET',
      X: 'NEW',
      x: 'NEW',
      p: '0',
      sp: '43000',
      c: 'SL123',
      q: '2',
      z: '0'
    });
    await aggregator.handleEvent(event);

    expect(notifications).toHaveLength(1);
    expect(notifications[0].scenario).toBe(Scenario.SLTP_NEW);
    expect(notifications[0].source).toBe('止损');
    expect(notifications[0].stateLabel).toBe('创建');
    expect(notifications[0].title).toBe('BTCUSDT-5%成本止损');
    expect(notifications[0].cumulativeQuote).toBeUndefined();
    expect(notifications[0].cumulativeQuoteDisplay).toBeUndefined();
    expect(notifications[0].tradePnlDisplay).toBeUndefined();
    expect(notifications[0].priceSource).toBe('order');
    expect(notifications[0].displayPrice).toBe('43000');
    expect(getSummaryMock).not.toHaveBeenCalled();
  });

  it('handles SL/TP 取消', async () => {
    const event = buildEvent({
      o: 'STOP_MARKET',
      X: 'CANCELED',
      x: 'CANCELED',
      p: '0',
      sp: '43500',
      c: 'SL999',
      z: '0'
    });
    await aggregator.handleEvent(event);

    expect(notifications).toHaveLength(1);
    expect(notifications[0].scenario).toBe(Scenario.SLTP_CANCELED);
    expect(notifications[0].source).toBe('止损');
    expect(notifications[0].stateLabel).toBe('取消');
    expect(notifications[0].title).toBe('BTCUSDT-5%成本止损');
    expect(notifications[0].cumulativeQuote).toBeUndefined();
    expect(notifications[0].tradePnlDisplay).toBeUndefined();
    expect(notifications[0].priceSource).toBe('order');
    expect(notifications[0].displayPrice).toBe('43500');
    expect(getSummaryMock).not.toHaveBeenCalled();
  });

  it('handles SL/TP 完全成交', async () => {
    const event = buildEvent({ o: 'STOP_MARKET', X: 'FILLED', z: '1', l: '1', c: 'TP-100' });
    await aggregator.handleEvent(event);

    expect(notifications).toHaveLength(1);
    expect(notifications[0].scenario).toBe(Scenario.SLTP_FILLED);
    expect(notifications[0].source).toBe('止盈');
    expect(notifications[0].stateLabel).toBe('成交');
    expect(notifications[0].title).toBe('BTCUSDT-止盈');
    expect(notifications[0].cumulativeQuoteDisplay).toBe('45000.00 USDT');
    expect(notifications[0].cumulativeQuoteRatioDisplay).toBe('45.00%');
    expect(notifications[0].tradePnlDisplay).toBe('0.00 USDT');
    expect(notifications[0].priceSource).toBe('average');
    expect(notifications[0].displayPrice).toBe('45000.00000000');
    expect(getSummaryMock).toHaveBeenCalledTimes(1);
  });

  it('applies TP1 专属标题', async () => {
    const event = buildEvent({ o: 'STOP_MARKET', X: 'FILLED', z: '1', l: '1', c: 'TP1-001' });
    await aggregator.handleEvent(event);

    expect(notifications).toHaveLength(1);
    expect(notifications[0].source).toBe('止盈');
    expect(notifications[0].title).toBe('BTCUSDT-反弹1/5减仓');
    expect(getSummaryMock).toHaveBeenCalledTimes(1);
  });

  it('applies FT 标题及来源', async () => {
    const event = buildEvent({ o: 'STOP_MARKET', X: 'FILLED', z: '1', l: '1', c: 'FT-001' });
    await aggregator.handleEvent(event);

    expect(notifications).toHaveLength(1);
    expect(notifications[0].source).toBe('追踪止损');
    expect(notifications[0].title).toBe('BTCUSDT-跟踪交易止损');
    expect(getSummaryMock).toHaveBeenCalledTimes(1);
  });

  it('handles SL/TP 部分成交且 10 秒内完成', async () => {
    const partial = buildEvent({ o: 'STOP_MARKET', X: 'PARTIALLY_FILLED', z: '0.6', l: '0.6', c: 'TP-200' });
    const filled = buildEvent({ o: 'STOP_MARKET', X: 'FILLED', z: '1', l: '0.4', c: 'TP-200' });

    await aggregator.handleEvent(partial);
    await aggregator.handleEvent(filled);

    expect(notifications).toHaveLength(1);
    expect(notifications[0].scenario).toBe(Scenario.SLTP_PARTIAL_COMPLETED);
    expect(notifications[0].source).toBe('止盈');
    expect(notifications[0].stateLabel).toBe('成交');
    expect(notifications[0].title).toBe('BTCUSDT-止盈');
    expect(notifications[0].cumulativeQuoteDisplay).toBe('45000.00 USDT');
    expect(notifications[0].cumulativeQuoteRatioDisplay).toBe('45.00%');
    expect(notifications[0].tradePnlDisplay).toBe('0.00 USDT');
    expect(notifications[0].priceSource).toBe('average');
  });

  it('handles SL/TP 部分成交但 10 秒内未补足', async () => {
    const partial = buildEvent({ o: 'STOP_MARKET', X: 'PARTIALLY_FILLED', z: '0.4', l: '0.4', c: 'TP-300' });
    await aggregator.handleEvent(partial);

    vi.advanceTimersByTime(1000);
    await vi.runAllTimersAsync();

    expect(notifications).toHaveLength(1);
    expect(notifications[0].scenario).toBe(Scenario.SLTP_PARTIAL_TIMEOUT);
    expect(notifications[0].source).toBe('止盈');
    expect(notifications[0].stateLabel).toBe('部分成交');
    expect(notifications[0].title).toBe('BTCUSDT-止盈');
    expect(notifications[0].cumulativeQuoteDisplay).toBe('18000.00 USDT');
    expect(notifications[0].cumulativeQuoteRatioDisplay).toBe('18.00%');
    expect(notifications[0].tradePnlDisplay).toBe('0.00 USDT');
    expect(notifications[0].priceSource).toBe('average');
    expect(getSummaryMock).toHaveBeenCalledTimes(1);
  });

  it('handles SL/TP 部分成交后取消', async () => {
    const partial = buildEvent({ o: 'STOP_MARKET', X: 'PARTIALLY_FILLED', z: '0.5', l: '0.5', c: 'TP-400' });
    const cancel = buildEvent({ o: 'STOP_MARKET', X: 'CANCELED', x: 'CANCELED', z: '0.5', l: '0', c: 'TP-400' });

    await aggregator.handleEvent(partial);
    await aggregator.handleEvent(cancel);

    expect(notifications).toHaveLength(1);
    expect(notifications[0].scenario).toBe(Scenario.SLTP_PARTIAL_CANCELED);
    expect(notifications[0].source).toBe('止盈');
    expect(notifications[0].stateLabel).toBe('取消');
    expect(notifications[0].title).toBe('BTCUSDT-止盈');
    expect(notifications[0].cumulativeQuoteDisplay).toBe('22500.00 USDT');
    expect(notifications[0].cumulativeQuoteRatioDisplay).toBe('22.50%');
    expect(notifications[0].tradePnlDisplay).toBe('0.00 USDT');
    expect(notifications[0].priceSource).toBe('average');
    expect(getSummaryMock).toHaveBeenCalledTimes(1);
  });

  it('ignores 非 SL/TP 的 NEW 状态', async () => {
    const event = buildEvent({ o: 'LIMIT', X: 'NEW', x: 'NEW', c: 'ORD-IGNORED', sp: undefined, p: '45000' });
    await aggregator.handleEvent(event);

    expect(notifications).toHaveLength(0);
    expect(getSummaryMock).not.toHaveBeenCalled();
  });

  it('handles 普通订单部分成交后取消', async () => {
    const partial = buildEvent({ o: 'LIMIT', X: 'PARTIALLY_FILLED', z: '0.2', l: '0.2', c: 'ORD-4', p: '45000', sp: undefined });
    const cancel = buildEvent({ o: 'LIMIT', X: 'CANCELED', z: '0.2', l: '0', c: 'ORD-4', p: '45000', sp: undefined });

    await aggregator.handleEvent(partial);
    await aggregator.handleEvent(cancel);

    expect(notifications).toHaveLength(1);
    expect(notifications[0].scenario).toBe(Scenario.GENERAL_PARTIAL_CANCELED);
    expect(notifications[0].source).toBe('其他');
    expect(notifications[0].stateLabel).toBe('取消');
    expect(notifications[0].title).toBe('BTCUSDT-其他');
    expect(notifications[0].cumulativeQuoteDisplay).toBe('9000.00 USDT');
    expect(notifications[0].cumulativeQuoteRatioDisplay).toBe('9.00%');
    expect(notifications[0].tradePnlDisplay).toBe('0.00 USDT');
    expect(notifications[0].priceSource).toBe('average');
    expect(notifications[0].displayPrice).toBe('45000.00000000');
    expect(getSummaryMock).toHaveBeenCalledTimes(1);
  });

  it('ignores SL/TP 触发生成的执行单创建', async () => {
    const triggerNew = buildEvent({ o: 'MARKET', X: 'NEW', x: 'NEW', l: '0', z: '0', c: 'TP-TRIG', sp: undefined, p: '0' });
    await aggregator.handleEvent(triggerNew);
    expect(notifications).toHaveLength(0);
    expect(getSummaryMock).not.toHaveBeenCalled();
  });
});
