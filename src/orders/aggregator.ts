import Big from 'big.js';
import { appConfig } from '../config/index.js';
import { logger } from '../utils/logger.js';
import { OrderStateTracker } from './stateTracker.js';
import {
  Scenario,
  aggregationKey,
  resolveOrderSource,
  type AggregationContext,
  type OrderEvent,
  type OrderNotificationInput,
  type ScenarioKey
} from './types.js';

export type NotificationHandler = (payload: OrderNotificationInput) => Promise<void> | void;

interface AggregatorOptions {
  aggregationWindowMs?: number;
}

export class OrderAggregator {
  private readonly aggregationWindowMs: number;
  private readonly tracker = new OrderStateTracker();
  private notificationHandler?: NotificationHandler;

  constructor(options: AggregatorOptions = {}) {
    this.aggregationWindowMs = options.aggregationWindowMs ?? appConfig.aggregationWindowMs;
  }

  onNotify(handler: NotificationHandler): void {
    this.notificationHandler = handler;
  }

  async handleEvent(event: OrderEvent): Promise<void> {
    if (!this.notificationHandler) {
      throw new Error('Notification handler not registered');
    }

    const source = resolveOrderSource(event.clientOrderId);

    if (source === '其他' && event.status === 'NEW') {
      logger.debug({ event }, 'Ignoring NEW status for general order');
      return;
    }

    const context = this.tracker.update(event, source);

    if (source === '止盈' || source === '止损') {
      await this.handleSlTpOrder(event, context);
      return;
    }

    await this.handleGeneralOrder(event, context);
  }

  private async handleSlTpOrder(
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
    const cumulativeQty = new Big(context.cumulativeQuantity || '0');
    const cumulativeQuote = new Big(context.cumulativeQuote || '0');

    let displayPrice = latestEvent.orderPrice;
    if (options.priceSource === 'average' || latestEvent.orderType === 'MARKET') {
      if (cumulativeQty.gt(0) && cumulativeQuote.gt(0)) {
        displayPrice = cumulativeQuote.div(cumulativeQty).toFixed(8);
      } else if (context.lastAveragePrice && context.lastAveragePrice !== '0') {
        displayPrice = context.lastAveragePrice;
      } else if (latestEvent.averagePrice !== '0') {
        displayPrice = latestEvent.averagePrice;
      }
    }

    const priceSource = options.priceSource ?? (latestEvent.orderType === 'MARKET' ? 'average' : 'order');

    const payload: OrderNotificationInput = {
      scenario,
      symbol: latestEvent.symbol,
      side: latestEvent.side,
      source: context.source,
      stateLabel: options.stateLabel,
      size: latestEvent.originalQuantity,
      cumulativeQuantity: options.includeCumulative && cumulativeQty.gt(0)
        ? cumulativeQty.toString()
        : undefined,
      displayPrice,
      priceSource,
      notifyTime: new Date(),
      orderType: latestEvent.orderType,
      status: latestEvent.status,
      rawEvents: [...context.events]
    };

    await this.notificationHandler(payload);
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
