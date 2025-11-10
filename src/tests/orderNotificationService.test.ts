import { describe, expect, it, vi } from 'vitest';
import { OrderNotificationService } from '../orders/orderNotificationService.js';
import type { OrderEvent, OrderStatus, RawOrderTradeUpdate } from '../orders/types.js';

describe('OrderNotificationService', () => {
  it('NEW/CANCELED/EXPIRED 事件走 BOT_1', async () => {
    const lifecycleNotifier = createNotifier();
    const fillNotifier = createNotifier();
    const service = new OrderNotificationService({ lifecycleNotifier, fillNotifier });

    await service.handle(createEvent('NEW'));
    expect(lifecycleNotifier.send).toHaveBeenCalledTimes(1);
    expect(fillNotifier.send).not.toHaveBeenCalled();
  });

  it('FILLED 事件走 BOT_2', async () => {
    const lifecycleNotifier = createNotifier();
    const fillNotifier = createNotifier();
    const service = new OrderNotificationService({ lifecycleNotifier, fillNotifier });

    await service.handle(createEvent('FILLED'));
    expect(fillNotifier.send).toHaveBeenCalledTimes(1);
    expect(lifecycleNotifier.send).not.toHaveBeenCalled();
  });

  it('EXPIRED_IN_MATCH 视为 EXPIRED 并生成原因', async () => {
    const lifecycleNotifier = createNotifier();
    const fillNotifier = createNotifier();
    const service = new OrderNotificationService({ lifecycleNotifier, fillNotifier });

    const event = createEvent('EXPIRED', {
      raw: createRaw({
        X: 'EXPIRED_IN_MATCH',
        x: 'EXPIRED_IN_MATCH'
      })
    });

    await service.handle(event);
    expect(lifecycleNotifier.send).toHaveBeenCalledTimes(1);
    const payload = lifecycleNotifier.send.mock.calls[0][0];
    expect(payload.card.elements[3].text.content).toContain('EXPIRED_IN_MATCH');
    expect(fillNotifier.send).not.toHaveBeenCalled();
  });

  it('忽略未在白名单内的状态', async () => {
    const lifecycleNotifier = createNotifier();
    const fillNotifier = createNotifier();
    const service = new OrderNotificationService({ lifecycleNotifier, fillNotifier });
    await service.handle(createEvent('PARTIALLY_FILLED'));
    expect(lifecycleNotifier.send).not.toHaveBeenCalled();
    expect(fillNotifier.send).not.toHaveBeenCalled();
  });
});

function createNotifier() {
  return {
    send: vi.fn().mockResolvedValue(undefined)
  };
}

function createEvent(status: OrderStatus, overrides: Partial<OrderEvent> = {}): OrderEvent {
  return {
    symbol: 'BTCUSDT',
    orderId: 9,
    clientOrderId: 'TP1_unit',
    originalClientOrderId: undefined,
    side: 'BUY',
    orderType: status === 'FILLED' ? 'MARKET' : 'LIMIT',
    status,
    eventTime: new Date('2024-05-01T00:00:00Z'),
    tradeTime: new Date('2024-05-01T00:00:00Z'),
    originalQuantity: '1',
    cumulativeQuantity: status === 'FILLED' ? '1' : '0',
    lastQuantity: status === 'FILLED' ? '1' : '0',
    averagePrice: status === 'FILLED' ? '60000' : '0',
    lastPrice: status === 'FILLED' ? '60000' : '0',
    orderPrice: '59000',
    stopPrice: undefined,
    isMaker: false,
    raw: overrides.raw ?? createRaw({ X: status, x: status }),
    ...overrides
  };
}

function createRaw(overrides: Partial<RawOrderTradeUpdate['o']> = {}): RawOrderTradeUpdate {
  return {
    e: 'ORDER_TRADE_UPDATE',
    E: Date.parse('2024-05-01T00:00:00Z'),
    T: Date.parse('2024-05-01T00:00:00Z'),
    o: {
      s: 'BTCUSDT',
      c: 'TP1_unit',
      C: undefined,
      S: 'BUY',
      o: 'LIMIT',
      x: 'NEW',
      X: 'NEW',
      i: 9,
      q: '1',
      z: '0',
      l: '0',
      ap: '0',
      L: '0',
      p: '59000',
      sp: undefined,
      rp: '0',
      b: '0',
      a: '0',
      m: false,
      T: Date.parse('2024-05-01T00:00:00Z'),
      ...overrides
    }
  };
}
