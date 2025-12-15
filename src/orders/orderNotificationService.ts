import type { OrderEvent } from './types.js';
import type { CardPayload } from '../notifications/types.js';
import { buildOrderLifecycleCard, type LifecycleStatus } from '../notifications/orderLifecycleCardBuilder.js';
import { buildOrderFillCard } from '../notifications/orderFillCardBuilder.js';
import { logger } from '../utils/logger.js';

interface Notifier {
  send(card: CardPayload): Promise<void>;
}

interface OrderNotificationServiceOptions {
  lifecycleNotifier: Notifier;
  fillNotifier: Notifier;
}

export class OrderNotificationService {
  private readonly lifecycleNotifier: Notifier;
  private readonly fillNotifier: Notifier;
  private readonly dedupCache = new Map<string, number>();
  private readonly dedupTtlMs = 60 * 1000;

  constructor(options: OrderNotificationServiceOptions) {
    this.lifecycleNotifier = options.lifecycleNotifier;
    this.fillNotifier = options.fillNotifier;
  }

  async handle(event: OrderEvent): Promise<void> {
    const dedupKey = this.buildDedupKey(event);
    if (this.isDuplicate(dedupKey)) {
      logger.warn(
        { orderId: event.orderId, clientOrderId: event.clientOrderId, status: event.status },
        'Duplicate order event ignored'
      );
      return;
    }
    this.markSeen(dedupKey);

    const normalizedStatus = normalizeStatus(event.status);
    if (!normalizedStatus) {
      logger.debug(
        { clientOrderId: event.clientOrderId, status: event.status },
        'Order event ignored due to unsupported status'
      );
      return;
    }

    if (isLifecycleStatus(normalizedStatus)) {
      const expireReason = normalizedStatus === 'EXPIRED' ? resolveExpireReason(event) : undefined;
      const card = buildOrderLifecycleCard(event, normalizedStatus, expireReason);
      await this.lifecycleNotifier.send(card);
      logger.info(
        { clientOrderId: event.clientOrderId, status: normalizedStatus },
        'Order lifecycle notification dispatched'
      );
      return;
    }

    if (normalizedStatus === 'FILLED') {
      const card = buildOrderFillCard(event);
      await this.fillNotifier.send(card);
      logger.info(
        { clientOrderId: event.clientOrderId, status: normalizedStatus },
        'Order filled notification dispatched'
      );
    }
  }

  private buildDedupKey(event: OrderEvent): string {
    const eventTime = event.raw?.E ?? event.eventTime.getTime();
    const lastQty = event.lastQuantity ?? '';
    const cumQty = event.cumulativeQuantity ?? '';
    return `${event.orderId}:${event.clientOrderId}:${event.status}:${eventTime}:${cumQty}:${lastQty}`;
  }

  private isDuplicate(key: string): boolean {
    const now = Date.now();
    this.prune(now);
    return this.dedupCache.has(key);
  }

  private markSeen(key: string): void {
    this.dedupCache.set(key, Date.now());
  }

  private prune(now: number): void {
    for (const [key, ts] of this.dedupCache.entries()) {
      if (now - ts > this.dedupTtlMs) {
        this.dedupCache.delete(key);
      }
    }
    if (this.dedupCache.size > 2000) {
      this.dedupCache.clear();
    }
  }
}

function normalizeStatus(status: string): LifecycleStatus | 'FILLED' | null {
  const upper = (status ?? '').toUpperCase();
  if (upper === 'NEW' || upper === 'CANCELED' || upper === 'FILLED') {
    return upper as LifecycleStatus | 'FILLED';
  }
  if (upper === 'EXPIRED' || upper === 'EXPIRED_IN_MATCH') {
    return 'EXPIRED';
  }
  return null;
}

function isLifecycleStatus(status: string): status is LifecycleStatus {
  return status === 'NEW' || status === 'CANCELED' || status === 'EXPIRED';
}

function resolveExpireReason(event: OrderEvent): string | undefined {
  const executionType = event.raw?.o?.x?.toUpperCase();
  if (!executionType) {
    return '订单超时未成交';
  }
  if (executionType === 'EXPIRED_IN_MATCH') {
    return '撮合过程中超时 (EXPIRED_IN_MATCH)';
  }
  if (executionType === 'EXPIRED') {
    return '超过有效期自动过期';
  }
  return `执行状态: ${executionType}`;
}
