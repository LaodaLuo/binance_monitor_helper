import Big from 'big.js';
import {
  aggregationKey,
  type AggregationContext,
  type OrderEvent,
  type OrderPresentation
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

  update(event: OrderEvent, presentation: OrderPresentation): AggregationContext {
    const key = aggregationKey(event);
    const existing = this.store.get(key);

    const baseContext: AggregationContext = existing ?? {
      symbol: event.symbol,
      orderId: event.orderId,
      clientOrderId: event.clientOrderId,
      orderType: event.orderType,
      side: event.side,
      source: presentation.source,
      presentation,
      originalQuantity: event.originalQuantity,
      cumulativeQuantity: '0',
      cumulativeQuote: '0',
      lastAveragePrice: '0',
      lastStatus: event.status,
      lastEventTime: event.eventTime,
      events: []
    };

    const cumulativeQty = safeBig(event.cumulativeQuantity);
    const averagePrice = safeBig(event.averagePrice);
    const lastPrice = safeBig(event.lastPrice);
    const orderPrice = safeBig(event.orderPrice);

    let cumulativeQuote = ZERO;
    if (cumulativeQty.gt(0)) {
      if (averagePrice.gt(0)) {
        cumulativeQuote = averagePrice.times(cumulativeQty);
      } else if (lastPrice.gt(0)) {
        cumulativeQuote = lastPrice.times(cumulativeQty);
      } else if (orderPrice.gt(0)) {
        cumulativeQuote = orderPrice.times(cumulativeQty);
      }
    }

    let resolvedAveragePrice = event.averagePrice;

    if ((resolvedAveragePrice === undefined || resolvedAveragePrice === '' || resolvedAveragePrice === '0') && cumulativeQty.gt(0) && cumulativeQuote.gt(0)) {
      try {
        resolvedAveragePrice = cumulativeQuote.div(cumulativeQty).toFixed(8);
      } catch {
        resolvedAveragePrice = event.lastPrice || event.orderPrice || '0';
      }
    }

    const next: AggregationContext = {
      ...baseContext,
      orderType: event.orderType,
      side: event.side,
      source: presentation.source,
      presentation,
      cumulativeQuantity: event.cumulativeQuantity,
      cumulativeQuote: cumulativeQuote.toFixed(8),
      lastAveragePrice: resolvedAveragePrice,
      lastStatus: event.status,
      lastEventTime: event.eventTime,
      events: [...baseContext.events, event]
    };

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
