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

export interface OrderNotificationInput {
  scenario: ScenarioKey;
  symbol: string;
  side: OrderSide;
  stateLabel: string;
  size: string;
  cumulativeQuantity?: string;
  displayPrice: string;
  notifyTime: Date;
  orderType: OrderType;
  status: OrderStatus;
  rawEvents: OrderEvent[];
}

export const Scenario = {
  MARKET_SINGLE: '市价单相关/一次性全部成交',
  MARKET_AGGREGATED: '市价单相关/分批成交且 10 秒内全部完成',
  MARKET_TIMEOUT: '市价单相关/分批成交但 10 秒内无新增成交',
  SLTP_IGNORED: 'SL/TP 订单/客户端订单号不以 SL 或 TP 开头',
  SLTP_NEW: 'SL/TP 订单/创建 (NEW)',
  SLTP_CANCELED: 'SL/TP 订单/取消 (CANCELED)',
  SLTP_FILLED: 'SL/TP 订单/完全成交 (FILLED)',
  SLTP_PARTIAL_COMPLETED: 'SL/TP 订单/部分成交且 10 秒内完成',
  SLTP_PARTIAL_TIMEOUT: 'SL/TP 订单/部分成交但 10 秒内未补足',
  SLTP_PARTIAL_CANCELED: 'SL/TP 订单/部分成交后取消'
} as const;

export type ScenarioKey = (typeof Scenario)[keyof typeof Scenario];

export const MARKET_WINDOW_SCENARIOS: ScenarioKey[] = [
  Scenario.MARKET_AGGREGATED,
  Scenario.MARKET_TIMEOUT
];

export const SLTP_WINDOW_SCENARIOS: ScenarioKey[] = [
  Scenario.SLTP_PARTIAL_COMPLETED,
  Scenario.SLTP_PARTIAL_TIMEOUT,
  Scenario.SLTP_PARTIAL_CANCELED
];

export function isStopLossOrTakeProfit(clientOrderId: string): boolean {
  return clientOrderId.startsWith('SL') || clientOrderId.startsWith('TP');
}

export function aggregationKey(event: OrderEvent): string {
  return `${event.symbol}:${event.orderId}:${event.clientOrderId}`;
}
