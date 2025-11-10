import type { OrderEvent } from './types.js';
import type { CardPayload } from '../notifications/types.js';
import { buildOrderLifecycleCard } from '../notifications/orderLifecycleCardBuilder.js';
import { buildOrderFillCard } from '../notifications/orderFillCardBuilder.js';
import { logger } from '../utils/logger.js';

type LifecycleStatus = 'NEW' | 'CANCELED' | 'EXPIRED';

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

  constructor(options: OrderNotificationServiceOptions) {
    this.lifecycleNotifier = options.lifecycleNotifier;
    this.fillNotifier = options.fillNotifier;
  }

  async handle(event: OrderEvent): Promise<void> {
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
