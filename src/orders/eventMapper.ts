import { z } from 'zod';
import type { OrderEvent, OrderStatus, OrderType, RawOrderTradeUpdate } from './types.js';

const rawOrderTradeUpdateSchema = z.object({
  e: z.literal('ORDER_TRADE_UPDATE'),
  E: z.number(),
  T: z.number(),
  o: z.object({
    s: z.string(),
    c: z.string(),
    S: z.enum(['BUY', 'SELL']),
    o: z.string(),
    x: z.string(),
    X: z.string(),
    i: z.number(),
    q: z.string(),
    z: z.string(),
    l: z.string(),
    ap: z.string(),
    L: z.string(),
    p: z.string(),
    sp: z.string().optional(),
    rp: z.string().optional(),
    b: z.string().optional(),
    a: z.string().optional(),
    m: z.boolean(),
    T: z.number()
  })
});

export function parseRawOrderTradeUpdate(data: unknown): RawOrderTradeUpdate | null {
  const parsed = rawOrderTradeUpdateSchema.safeParse(data);
  if (!parsed.success) {
    return null;
  }
  return parsed.data as RawOrderTradeUpdate;
}

export function toOrderEvent(raw: RawOrderTradeUpdate): OrderEvent {
  const eventTime = new Date(raw.E);
  const tradeTime = new Date(raw.T);

  return {
    symbol: raw.o.s,
    orderId: raw.o.i,
    clientOrderId: raw.o.c,
    side: raw.o.S as OrderEvent['side'],
    orderType: raw.o.o as OrderType,
    status: raw.o.X as OrderStatus,
    eventTime,
    tradeTime,
    originalQuantity: raw.o.q,
    cumulativeQuantity: raw.o.z,
    lastQuantity: raw.o.l,
    averagePrice: raw.o.ap,
    lastPrice: raw.o.L,
    orderPrice: raw.o.p,
    stopPrice: raw.o.sp,
    isMaker: raw.o.m,
    raw
  };
}
