export type OrderSide = 'BUY' | 'SELL';

export type OrderStatus =
  | 'NEW'
  | 'PARTIALLY_FILLED'
  | 'FILLED'
  | 'CANCELED'
  | 'EXPIRED'
  | 'EXPIRED_IN_MATCH'
  | 'PENDING_CANCEL'
  | string;

export type OrderType = 'MARKET' | 'LIMIT' | 'STOP' | 'STOP_MARKET' | 'TAKE_PROFIT' | 'TAKE_PROFIT_MARKET' | string;

export type OrderSource = '止盈' | '止损' | '其他';

export interface RawOrderTradeUpdate {
  e: 'ORDER_TRADE_UPDATE';
  E: number;
  T: number;
  o: {
    s: string;
    c: string;
    S: OrderSide;
    o: OrderType;
    x: string;
    X: OrderStatus;
    i: number;
    q: string;
    z: string;
    l: string;
    ap: string;
    L: string;
    p: string;
    rp?: string;
    b?: string;
    a?: string;
    m: boolean;
    T: number;
  };
}

export interface OrderEvent {
  symbol: string;
  orderId: number;
  clientOrderId: string;
  side: OrderSide;
  orderType: OrderType;
  status: OrderStatus;
  eventTime: Date;
  tradeTime: Date;
  originalQuantity: string;
  cumulativeQuantity: string;
  lastQuantity: string;
  averagePrice: string;
  lastPrice: string;
  orderPrice: string;
  isMaker: boolean;
  raw: RawOrderTradeUpdate;
}

export interface AggregationContext {
  symbol: string;
  orderId: number;
  clientOrderId: string;
  orderType: OrderType;
  side: OrderSide;
  source: OrderSource;
  originalQuantity: string;
  cumulativeQuantity: string;
  cumulativeQuote: string;
  lastAveragePrice: string;
  lastStatus: OrderStatus;
  lastEventTime: Date;
  timer?: NodeJS.Timeout;
  events: OrderEvent[];
  scenarioHint?: ScenarioKey;
}

export type PriceSource = 'average' | 'order';

export interface OrderNotificationInput {
  scenario: ScenarioKey;
  symbol: string;
  side: OrderSide;
  source: OrderSource;
  stateLabel: string;
  size: string;
  cumulativeQuantity?: string;
  displayPrice: string;
  priceSource: PriceSource;
  notifyTime: Date;
  orderType: OrderType;
  status: OrderStatus;
  rawEvents: OrderEvent[];
}

export const Scenario = {
  SLTP_NEW: 'SL/TP 订单/创建 (NEW)',
  SLTP_CANCELED: 'SL/TP 订单/取消 (CANCELED)',
  SLTP_FILLED: 'SL/TP 订单/完全成交 (FILLED)',
  SLTP_PARTIAL_COMPLETED: 'SL/TP 订单/部分成交且 10 秒内完成',
  SLTP_PARTIAL_TIMEOUT: 'SL/TP 订单/部分成交但 10 秒内未补足',
  SLTP_PARTIAL_CANCELED: 'SL/TP 订单/部分成交后取消',
  GENERAL_SINGLE: '普通订单/一次性全部成交',
  GENERAL_AGGREGATED: '普通订单/分批成交且 10 秒内全部完成',
  GENERAL_TIMEOUT: '普通订单/分批成交但 10 秒内无新增成交',
  GENERAL_PARTIAL_CANCELED: '普通订单/部分成交后取消'
} as const;

export type ScenarioKey = (typeof Scenario)[keyof typeof Scenario];

export const GENERAL_WINDOW_SCENARIOS: ScenarioKey[] = [
  Scenario.GENERAL_AGGREGATED,
  Scenario.GENERAL_TIMEOUT
];

export const SLTP_WINDOW_SCENARIOS: ScenarioKey[] = [
  Scenario.SLTP_PARTIAL_COMPLETED,
  Scenario.SLTP_PARTIAL_TIMEOUT,
  Scenario.SLTP_PARTIAL_CANCELED
];

export function isStopLossOrTakeProfit(clientOrderId: string): boolean {
  return clientOrderId.startsWith('SL') || clientOrderId.startsWith('TP');
}

export function resolveOrderSource(clientOrderId: string): OrderSource {
  if (clientOrderId.startsWith('TP')) return '止盈';
  if (clientOrderId.startsWith('SL')) return '止损';
  return '其他';
}

export function aggregationKey(event: OrderEvent): string {
  return `${event.symbol}:${event.orderId}:${event.clientOrderId}`;
}
