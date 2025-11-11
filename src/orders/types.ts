export type OrderSide = 'BUY' | 'SELL';
export type OrderPositionSide = 'LONG' | 'SHORT' | 'BOTH';

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

export type OrderSource = '止盈' | '止损' | '追踪止损' | '其他';

export type OrderClassification = 'TP1' | 'TP2' | 'TP' | 'SL' | 'FT' | 'GENERAL';

export interface OrderPresentation {
  source: OrderSource;
  classification: OrderClassification;
  titleSuffix: string;
}

export interface RawOrderTradeUpdate {
  e: 'ORDER_TRADE_UPDATE';
  E: number;
  T: number;
  o: {
    s: string;
    c: string;
    C?: string;
    S: OrderSide;
    ps?: OrderPositionSide;
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
    sp?: string;
    AP?: string;
    cr?: string;
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
  originalClientOrderId?: string;
  side: OrderSide;
  positionSide?: OrderPositionSide;
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
  stopPrice?: string;
  activationPrice?: string;
  callbackRate?: string;
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
  presentation: OrderPresentation;
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
  title: string;
  stateLabel: string;
  displayPrice: string;
  priceSource: PriceSource;
  notifyTime: Date;
  orderType: OrderType;
  status: OrderStatus;
  rawEvents: OrderEvent[];
  cumulativeQuote?: string;
  cumulativeQuoteDisplay?: string;
  cumulativeQuoteRatio?: string;
  cumulativeQuoteRatioDisplay?: string;
  tradePnl?: string;
  tradePnlDisplay?: string;
  longShortRatio?: string;
  longShortRatioDisplay?: string;
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
  const normalized = clientOrderId.toUpperCase();
  return normalized.startsWith('SL') || normalized.startsWith('TP') || normalized.startsWith('FT');
}

export function resolveOrderPresentation(clientOrderId: string): OrderPresentation {
  const normalized = clientOrderId.trim().toUpperCase();

  if (normalized.startsWith('FT')) {
    return {
      source: '追踪止损',
      classification: 'FT',
      titleSuffix: '跟踪交易止损'
    };
  }

  if (normalized.startsWith('TP1')) {
    return {
      source: '止盈',
      classification: 'TP1',
      titleSuffix: '反弹1/4减仓30%'
    };
  }

  if (normalized.startsWith('TP2')) {
    return {
      source: '止盈',
      classification: 'TP2',
      titleSuffix: '反弹1/2减仓40%'
    };
  }

  if (normalized.startsWith('TP')) {
    return {
      source: '止盈',
      classification: 'TP',
      titleSuffix: '止盈'
    };
  }

  if (normalized.startsWith('SL')) {
    return {
      source: '止损',
      classification: 'SL',
      titleSuffix: '5%成本止损'
    };
  }

  return {
    source: '其他',
    classification: 'GENERAL',
    titleSuffix: '其他'
  };
}

export function resolveOrderSource(clientOrderId: string): OrderSource {
  return resolveOrderPresentation(clientOrderId).source;
}

export function aggregationKey(event: OrderEvent): string {
  return `${event.symbol}:${event.orderId}:${event.clientOrderId}`;
}
