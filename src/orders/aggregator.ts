import Big from 'big.js';
import { appConfig } from '../config/index.js';
import { logger } from '../utils/logger.js';
import { resolveQuoteAsset } from '../utils/symbol.js';
import { BinanceAccountMetricsProvider, type AccountMetricsProvider } from './accountMetricsProvider.js';
import { OrderStateTracker } from './stateTracker.js';
import {
  Scenario,
  aggregationKey,
  resolveOrderPresentation,
  type AggregationContext,
  type OrderEvent,
  type OrderNotificationInput,
  type ScenarioKey
} from './types.js';

export type NotificationHandler = (payload: OrderNotificationInput) => Promise<void> | void;

interface AggregatorOptions {
  aggregationWindowMs?: number;
  metricsProvider?: AccountMetricsProvider;
}

export class OrderAggregator {
  private readonly aggregationWindowMs: number;
  private readonly tracker = new OrderStateTracker();
  private readonly metricsProvider: AccountMetricsProvider;
  private notificationHandler?: NotificationHandler;

  constructor(options: AggregatorOptions = {}) {
    this.aggregationWindowMs = options.aggregationWindowMs ?? appConfig.aggregationWindowMs;
    this.metricsProvider = options.metricsProvider ?? new BinanceAccountMetricsProvider();
  }

  onNotify(handler: NotificationHandler): void {
    this.notificationHandler = handler;
  }

  async handleEvent(event: OrderEvent): Promise<void> {
    if (!this.notificationHandler) {
      throw new Error('Notification handler not registered');
    }

    const presentation = resolveOrderPresentation(event.clientOrderId);
    const source = presentation.source;

    if (source === '其他' && event.status === 'NEW') {
      logger.debug({ event }, 'Ignoring NEW status for general order');
      return;
    }

    const context = this.tracker.update(event, presentation);

    if (source === '止盈' || source === '止损' || source === '追踪止损') {
      await this.handleStopLikeOrder(event, context);
      return;
    }

    await this.handleGeneralOrder(event, context);
  }

  private async handleStopLikeOrder(
    event: OrderEvent,
    context: AggregationContext
  ): Promise<void> {
    switch (event.status) {
      case 'NEW': {
        const triggerCreationTypes = ['MARKET', 'LIMIT'];
        if (triggerCreationTypes.includes(event.orderType)) {
          logger.debug({ event }, 'Ignoring triggered execution order creation');
          return;
        }
        await this.emitNotification(context, Scenario.SLTP_NEW, {
          stateLabel: '创建',
          includeCumulative: false,
          priceSource: 'order'
        });
        return;
      }
      case 'CANCELED': {
        const hadPartialFill = context.events.some((evt) => evt.status === 'PARTIALLY_FILLED');
        const scenario = hadPartialFill ? Scenario.SLTP_PARTIAL_CANCELED : Scenario.SLTP_CANCELED;
        if (context.timer) {
          clearTimeout(context.timer);
        }
        await this.emitNotification(context, scenario, {
          stateLabel: '取消',
          includeCumulative: hadPartialFill,
          priceSource: hadPartialFill ? 'average' : 'order'
        });
        this.clearContext(event);
        return;
      }
      case 'PARTIALLY_FILLED': {
        this.ensureTimer(context, Scenario.SLTP_PARTIAL_TIMEOUT, {
          stateLabel: '部分成交',
          includeCumulative: true,
          priceSource: 'average'
        });
        return;
      }
      case 'FILLED': {
        if (context.timer) {
          clearTimeout(context.timer);
        }
        const hadPartial = context.events.some((evt) => evt.status === 'PARTIALLY_FILLED');
        const scenario = hadPartial ? Scenario.SLTP_PARTIAL_COMPLETED : Scenario.SLTP_FILLED;
        await this.emitNotification(context, scenario, {
          stateLabel: '成交',
          includeCumulative: true,
          priceSource: 'average'
        });
        this.clearContext(event);
        return;
      }
      default:
        return;
    }
  }

  private async handleGeneralOrder(
    event: OrderEvent,
    context: AggregationContext
  ): Promise<void> {
    switch (event.status) {
      case 'PARTIALLY_FILLED': {
        this.ensureTimer(context, Scenario.GENERAL_TIMEOUT, {
          stateLabel: '部分成交',
          includeCumulative: true,
          priceSource: 'average'
        });
        return;
      }
      case 'FILLED': {
        const hadPartial = context.events.some((evt) => evt.status === 'PARTIALLY_FILLED');
        if (context.timer) {
          clearTimeout(context.timer);
        }
        const scenario = hadPartial ? Scenario.GENERAL_AGGREGATED : Scenario.GENERAL_SINGLE;
        await this.emitNotification(context, scenario, {
          stateLabel: '成交',
          includeCumulative: true,
          priceSource: 'average'
        });
        this.clearContext(event);
        return;
      }
      case 'CANCELED': {
        const hadPartial = context.events.some((evt) => evt.status === 'PARTIALLY_FILLED');
        if (!hadPartial) {
          this.clearContext(event);
          return;
        }
        if (context.timer) {
          clearTimeout(context.timer);
        }
        await this.emitNotification(context, Scenario.GENERAL_PARTIAL_CANCELED, {
          stateLabel: '取消',
          includeCumulative: true,
          priceSource: 'average'
        });
        this.clearContext(event);
        return;
      }
      default:
        // NEW 及其他状态忽略
        return;
    }
  }

  private ensureTimer(
    context: AggregationContext,
    scenario: ScenarioKey,
    options: EmitOptions
  ): void {
    if (context.timer) {
      clearTimeout(context.timer);
    }

    const key = `${context.symbol}:${context.orderId}:${context.clientOrderId}`;
    const timer = setTimeout(async () => {
      try {
        const latest = this.tracker.getByIds(context.symbol, context.orderId, context.clientOrderId);
        if (!latest) {
          return;
        }
        await this.emitNotification(latest, scenario, options);
        const lastEvent = latest.events[latest.events.length - 1];
        this.clearContext(lastEvent);
      } catch (error) {
        logger.error({ error, context }, 'Failed to emit notification on timeout');
      }
    }, this.aggregationWindowMs);

    this.tracker.setContext({
      ...context,
      timer,
      scenarioHint: scenario
    });

    logger.debug({ key }, 'Aggregation timer started');
  }

  private async emitNotification(
    context: AggregationContext,
    scenario: ScenarioKey,
    options: EmitOptions
  ): Promise<void> {
    if (!this.notificationHandler) return;

    const latestEvent = context.events[context.events.length - 1];
    const cumulativeQty = this.safeBig(latestEvent.cumulativeQuantity) ?? new Big(0);
    let cumulativeQuote = this.safeBig(context.cumulativeQuote);
    if (!cumulativeQuote || cumulativeQuote.lte(0)) {
      cumulativeQuote = this.resolveCumulativeQuote(latestEvent) ?? new Big(0);
    }
    const averagePrice = this.safeBig(latestEvent.averagePrice);
    const lastPrice = this.safeBig(latestEvent.lastPrice);
    const orderPrice = this.safeBig(latestEvent.orderPrice);
    const quoteAsset = resolveQuoteAsset(latestEvent.symbol) || undefined;

    const stopPriceCandidate =
      (latestEvent.stopPrice && latestEvent.stopPrice !== '0' ? latestEvent.stopPrice : undefined) ||
      [...context.events]
        .reverse()
        .map((evt) => evt.stopPrice)
        .find((price) => price && price !== '0');

    let displayPrice = latestEvent.orderPrice;
    if (options.priceSource === 'average' || latestEvent.orderType === 'MARKET') {
      const formattedAverage =
        (averagePrice && averagePrice.gt(0) && this.formatToFixed(averagePrice)) ||
        (context.lastAveragePrice && context.lastAveragePrice !== '0' ? this.formatToFixed(context.lastAveragePrice) : undefined);
      if (formattedAverage) {
        displayPrice = formattedAverage;
      } else if (lastPrice && lastPrice.gt(0)) {
        displayPrice = this.formatToFixed(lastPrice) ?? displayPrice;
      } else if (orderPrice && orderPrice.gt(0)) {
        displayPrice = this.formatToFixed(orderPrice) ?? latestEvent.orderPrice;
      } else if (stopPriceCandidate) {
        displayPrice = stopPriceCandidate;
      }
    } else {
      if (!displayPrice || displayPrice === '0') {
        if (orderPrice && orderPrice.gt(0)) {
          displayPrice = latestEvent.orderPrice;
        } else if (stopPriceCandidate) {
          displayPrice = stopPriceCandidate;
        } else if (averagePrice && averagePrice.gt(0)) {
          displayPrice = this.formatToFixed(averagePrice) ?? displayPrice;
        } else if (lastPrice && lastPrice.gt(0)) {
          displayPrice = this.formatToFixed(lastPrice) ?? displayPrice;
        }
      } else if (orderPrice && orderPrice.gt(0)) {
        displayPrice = latestEvent.orderPrice;
      }
    }

    const priceSource = options.priceSource ?? (latestEvent.orderType === 'MARKET' ? 'average' : 'order');
    const title = `${latestEvent.symbol}-${context.presentation.titleSuffix}`;

    let cumulativeQuoteRaw: string | undefined;
    let cumulativeQuoteDisplay: string | undefined;
    let cumulativeQuoteRatioRaw: string | undefined;
    let cumulativeQuoteRatioDisplay: string | undefined;
    let tradePnlRaw: string | undefined;
    let tradePnlDisplay: string | undefined;

    const shouldProvideAggregates = options.includeCumulative && cumulativeQty.gt(0) && cumulativeQuote.gt(0);

    if (shouldProvideAggregates) {
      cumulativeQuoteRaw = cumulativeQuote.toFixed(8);
      cumulativeQuoteDisplay = this.formatAmount(cumulativeQuote, quoteAsset);

      try {
        const summary = await this.metricsProvider.getSummary();
        if (summary?.totalFunds && summary.totalFunds > 0) {
          const ratioValue = cumulativeQuote.div(summary.totalFunds);
          cumulativeQuoteRatioRaw = ratioValue.toFixed(6);
          cumulativeQuoteRatioDisplay = this.formatPercent(ratioValue);
        }
      } catch (error) {
        logger.warn({ error }, 'Failed to obtain account summary for ratio calculation');
      }

      const realizedPnl = this.sumRealizedPnl(context);
      tradePnlRaw = realizedPnl.toFixed(8);
      tradePnlDisplay = this.formatSignedAmount(realizedPnl, quoteAsset);
    }

    const payload: OrderNotificationInput = {
      scenario,
      symbol: latestEvent.symbol,
      side: latestEvent.side,
      source: context.source,
      title,
      stateLabel: options.stateLabel,
      displayPrice,
      priceSource,
      notifyTime: new Date(),
      orderType: latestEvent.orderType,
      status: latestEvent.status,
      rawEvents: [...context.events],
      cumulativeQuote: cumulativeQuoteRaw,
      cumulativeQuoteDisplay,
      cumulativeQuoteRatio: cumulativeQuoteRatioRaw,
      cumulativeQuoteRatioDisplay,
      tradePnl: tradePnlRaw,
      tradePnlDisplay
    };

    await this.notificationHandler(payload);
  }

  private formatAmount(value: Big, asset?: string): string {
    const abs = value.abs();
    const decimals = abs.gte(1) || abs.eq(0) ? 2 : 4;
    const formatted = value.toFixed(decimals);
    return asset ? `${formatted} ${asset}` : formatted;
  }

  private formatSignedAmount(value: Big, asset?: string): string {
    const abs = value.abs();
    const decimals = abs.gte(1) || abs.eq(0) ? 2 : 4;
    const formatted = abs.toFixed(decimals);
    const prefix = value.gt(0) ? '+' : value.lt(0) ? '-' : '';
    const suffix = asset ? ` ${asset}` : '';
    return `${prefix}${formatted}${suffix}`;
  }

  private formatPercent(value: Big): string {
    return `${value.times(100).toFixed(2)}%`;
  }

  private formatToFixed(value: string | Big | null | undefined): string | undefined {
    if (value === null || value === undefined) {
      return undefined;
    }
    try {
      const big = value instanceof Big ? value : new Big(value);
      return big.toFixed(8);
    } catch {
      return typeof value === 'string' ? value : undefined;
    }
  }

  private resolveCumulativeQuote(event: OrderEvent): Big | null {
    const cumulativeQty = this.safeBig(event.cumulativeQuantity);
    if (!cumulativeQty || cumulativeQty.lte(0)) {
      return null;
    }

    const averagePrice = this.safeBig(event.averagePrice);
    if (averagePrice && averagePrice.gt(0)) {
      return averagePrice.times(cumulativeQty);
    }

    const lastPrice = this.safeBig(event.lastPrice);
    if (lastPrice && lastPrice.gt(0)) {
      return lastPrice.times(cumulativeQty);
    }

    const orderPrice = this.safeBig(event.orderPrice);
    if (orderPrice && orderPrice.gt(0)) {
      return orderPrice.times(cumulativeQty);
    }

    return null;
  }

  private sumRealizedPnl(context: AggregationContext): Big {
    return context.events.reduce((acc, evt) => {
      const realized = evt.raw.o.rp;
      if (!realized) {
        return acc;
      }
      try {
        return acc.plus(new Big(realized));
      } catch (error) {
        logger.debug({ error, realized }, 'Failed to parse realized PnL value');
        return acc;
      }
    }, new Big(0));
  }

  private safeBig(value: string | number | null | undefined): Big | null {
    if (value === undefined || value === null || value === '') {
      return null;
    }
    try {
      return new Big(value);
    } catch {
      return null;
    }
  }

  private clearContext(event: OrderEvent): void {
    const key = aggregationKey(event);
    logger.debug({ key }, 'Clearing aggregation context');
    this.tracker.delete(event);
  }
}

interface EmitOptions {
  stateLabel: string;
  includeCumulative: boolean;
  priceSource?: 'average' | 'order';
}
