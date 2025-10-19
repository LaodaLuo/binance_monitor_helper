import Big from 'big.js';
import { appConfig } from '../config/index.js';
import { logger } from '../utils/logger.js';
import { OrderStateTracker } from './stateTracker.js';
import {
  Scenario,
  aggregationKey,
  isStopLossOrTakeProfit,
  type AggregationContext,
  type OrderEvent,
  type OrderNotificationInput,
  type ScenarioKey
} from './types.js';

const ZERO = new Big(0);

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

    const isMarketOrder = event.orderType === 'MARKET';
    const isSlTpOrder = isStopLossOrTakeProfit(event.clientOrderId);

    if (!isMarketOrder && !isSlTpOrder) {
      logger.debug({ event }, 'Ignoring non-target order');
      return;
    }

    const context = this.tracker.update(event);

    if (isMarketOrder) {
      await this.handleMarketOrder(event, context);
      return;
    }

    await this.handleSlTpOrder(event, context);
  }

  private async handleMarketOrder(event: OrderEvent, context: AggregationContext): Promise<void> {
    switch (event.status) {
      case 'NEW':
        // 市价单 NEW 不需要通知
        return;
      case 'PARTIALLY_FILLED':
        this.ensureTimer(context, Scenario.MARKET_TIMEOUT);
        return;
      case 'FILLED': {
        const prevEvents = context.events.slice(0, -1);
        if (prevEvents.length === 0) {
          await this.emitNotification(context, Scenario.MARKET_SINGLE, {
            stateLabel: '市价成交',
            includeCumulative: true
          });
          this.clearContext(event);
          return;
        }

        const scenario = context.timer ? Scenario.MARKET_AGGREGATED : Scenario.MARKET_SINGLE;
        if (context.timer) {
          clearTimeout(context.timer);
        }
        await this.emitNotification(context, scenario, {
          stateLabel: '市价成交',
          includeCumulative: true
        });
        this.clearContext(event);
        return;
      }
      default:
        return;
    }
  }

  private async handleSlTpOrder(event: OrderEvent, context: AggregationContext): Promise<void> {
    switch (event.status) {
      case 'NEW': {
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
          priceSource: 'order'
        });
        this.clearContext(event);
        return;
      }
      case 'PARTIALLY_FILLED': {
        this.ensureTimer(context, Scenario.SLTP_PARTIAL_TIMEOUT);
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

  private ensureTimer(context: AggregationContext, defaultScenario: ScenarioKey): void {
    if (context.timer) {
      // 更新计时触发点
      clearTimeout(context.timer);
    }

    const key = `${context.symbol}:${context.orderId}:${context.clientOrderId}`;
    const timer = setTimeout(async () => {
      try {
        const scenario = this.resolveTimeoutScenario(context, defaultScenario);
        await this.emitNotification(context, scenario, {
          stateLabel: scenario.includes('市价单') ? '市价成交' : '部分成交',
          includeCumulative: true,
          priceSource: scenario.includes('市价单') ? 'average' : 'average'
        });
        this.tracker.delete({
          ...context.events[context.events.length - 1]
        });
      } catch (error) {
        logger.error({ error, context }, 'Failed to emit notification on timeout');
      }
    }, this.aggregationWindowMs);

    this.tracker.setContext({
      ...context,
      timer,
      scenarioHint: defaultScenario
    });

    logger.debug({ key }, 'Aggregation timer started');
  }

  private resolveTimeoutScenario(context: AggregationContext, fallback: ScenarioKey): ScenarioKey {
    if (context.orderType === 'MARKET') {
      return Scenario.MARKET_TIMEOUT;
    }
    return context.events.some((evt) => evt.status === 'PARTIALLY_FILLED')
      ? Scenario.SLTP_PARTIAL_TIMEOUT
      : fallback;
  }

  private async emitNotification(
    context: AggregationContext,
    scenario: ScenarioKey,
    options: {
      stateLabel: string;
      includeCumulative: boolean;
      priceSource?: 'average' | 'order';
    }
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

    const payload: OrderNotificationInput = {
      scenario,
      symbol: latestEvent.symbol,
      stateLabel: options.stateLabel,
      size: latestEvent.originalQuantity,
      cumulativeQuantity: options.includeCumulative && cumulativeQty.gt(0)
        ? cumulativeQty.toString()
        : undefined,
      displayPrice,
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
