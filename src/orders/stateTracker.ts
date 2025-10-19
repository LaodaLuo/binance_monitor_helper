import Big from 'big.js';
import {
  aggregationKey,
  type AggregationContext,
  type OrderEvent,
  type OrderSource
} from './types.js';

const ZERO = new Big(0);

function safeBig(value: string | undefined | null): Big {
  if (!value) return ZERO;
  try {
    return new Big(value);
  } catch {
    return ZERO;
  }
}

export class OrderStateTracker {
  private readonly store = new Map<string, AggregationContext>();

  update(event: OrderEvent, source: OrderSource): AggregationContext {
    const key = aggregationKey(event);
    const existing = this.store.get(key);

    const baseContext: AggregationContext = existing ?? {
      symbol: event.symbol,
      orderId: event.orderId,
      clientOrderId: event.clientOrderId,
      orderType: event.orderType,
      side: event.side,
      source,
      originalQuantity: event.originalQuantity,
      cumulativeQuantity: '0',
      cumulativeQuote: '0',
      lastAveragePrice: '0',
      lastStatus: event.status,
      lastEventTime: event.eventTime,
      events: []
    };

    const lastQty = safeBig(event.lastQuantity);
    const lastPrice = safeBig(event.lastPrice || event.averagePrice || event.orderPrice);
    const cumulativeQty = safeBig(event.cumulativeQuantity);

    let cumulativeQuote = safeBig(baseContext.cumulativeQuote);
    if (lastQty.gt(0) && lastPrice.gt(0)) {
      cumulativeQuote = cumulativeQuote.plus(lastQty.times(lastPrice));
    }

    const next: AggregationContext = {
      ...baseContext,
      orderType: event.orderType,
      side: event.side,
      source,
      cumulativeQuantity: event.cumulativeQuantity,
      cumulativeQuote: cumulativeQuote.toString(),
      lastAveragePrice: event.averagePrice,
      lastStatus: event.status,
      lastEventTime: event.eventTime,
      events: [...baseContext.events, event]
    };

    // Guard against division by zero when Binance sends averagePrice "0"
    if ((next.lastAveragePrice === '0' || next.lastAveragePrice === '') && cumulativeQty.gt(0)) {
      try {
        next.lastAveragePrice = cumulativeQuote.div(cumulativeQty).toFixed(8);
      } catch {
        // keep default
      }
    }

    this.store.set(key, next);
    return next;
  }

  get(event: OrderEvent): AggregationContext | undefined {
    return this.store.get(aggregationKey(event));
  }

  getByIds(symbol: string, orderId: number, clientOrderId: string): AggregationContext | undefined {
    const key = `${symbol}:${orderId}:${clientOrderId}`;
    return this.store.get(key);
  }

  delete(event: OrderEvent): void {
    const key = aggregationKey(event);
    const context = this.store.get(key);
    if (context?.timer) {
      clearTimeout(context.timer);
    }
    this.store.delete(key);
  }

  setContext(context: AggregationContext): void {
    const key = `${context.symbol}:${context.orderId}:${context.clientOrderId}`;
    this.store.set(key, context);
  }
}
