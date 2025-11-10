import type { OrderEvent } from '../orders/types.js';
import {
  classifyOrder,
  resolveLifecycleTitle,
  resolveSideLabelForLifecycle
} from '../orders/orderClassification.js';
import type { CardPayload } from './types.js';
import { formatDisplayTime } from '../utils/time.js';

export type LifecycleStatus = 'NEW' | 'CANCELED' | 'EXPIRED';

const TEMPLATE_MAP: Record<LifecycleStatus, string> = {
  NEW: 'blue',
  CANCELED: 'red',
  EXPIRED: 'orange'
};

export function buildOrderLifecycleCard(event: OrderEvent, status: LifecycleStatus, expireReason?: string): CardPayload {
  const category = classifyOrder(event.clientOrderId);
  const title = resolveLifecycleTitle(event.symbol, category);
  const typeLabel = resolveLifecycleTypeLabel(status);
  const direction = resolveSideLabelForLifecycle(event.side);
  const quantity = formatQuantity(event.originalQuantity);
  const price = resolveLifecyclePrice(event);
  const orderTime = formatDisplayTime(event.eventTime, undefined, true);

  const elements: Record<string, unknown>[] = [
    {
      tag: 'div',
      text: {
        tag: 'lark_md',
        content: `**类型:** ${typeLabel}`
      }
    },
    {
      tag: 'div',
      fields: [
        {
          is_short: true,
          text: {
            tag: 'lark_md',
            content: `**方向:**\n${direction}`
          }
        },
        {
          is_short: true,
          text: {
            tag: 'lark_md',
            content: `**数量:**\n${quantity}`
          }
        }
      ]
    },
    {
      tag: 'div',
      fields: [
        {
          is_short: true,
          text: {
            tag: 'lark_md',
            content: `**价格:**\n${price}`
          }
        },
        {
          is_short: true,
          text: {
            tag: 'lark_md',
            content: `**挂单时间:**\n${orderTime}`
          }
        }
      ]
    }
  ];

  if (status === 'EXPIRED' && expireReason) {
    elements.push({
      tag: 'div',
      text: {
        tag: 'lark_md',
        content: `**过期原因:** ${expireReason}`
      }
    });
  }

  return {
    msg_type: 'interactive',
    card: {
      config: {
        wide_screen_mode: true,
        enable_forward: true
      },
      header: {
        template: TEMPLATE_MAP[status] ?? 'blue',
        title: {
          tag: 'plain_text',
          content: title
        }
      },
      elements
    }
  };
}

function resolveLifecycleTypeLabel(status: LifecycleStatus): string {
  switch (status) {
    case 'NEW':
      return '创建';
    case 'CANCELED':
      return '取消';
    case 'EXPIRED':
      return '过期';
    default:
      return status;
  }
}

function resolveLifecyclePrice(event: OrderEvent): string {
  const normalizedType = (event.orderType ?? '').toUpperCase();
  const candidates = buildPriceCandidates(normalizedType, event);
  return formatDecimalFromCandidates(candidates);
}

function buildPriceCandidates(normalizedType: string, event: OrderEvent): Array<string | undefined> {
  if (normalizedType.includes('TRAILING_STOP')) {
    return [
      event.activationPrice,
      event.stopPrice,
      event.orderPrice,
      event.lastPrice,
      event.averagePrice
    ];
  }

  if (normalizedType.includes('STOP') || normalizedType.includes('PROFIT')) {
    return [
      event.stopPrice,
      event.orderPrice,
      event.activationPrice,
      event.averagePrice,
      event.lastPrice
    ];
  }

  if (normalizedType.includes('MARKET')) {
    return [event.averagePrice, event.lastPrice, event.orderPrice];
  }

  return [event.orderPrice, event.stopPrice, event.activationPrice, event.averagePrice, event.lastPrice];
}

function formatDecimalFromCandidates(candidates: Array<string | undefined>): string {
  for (const candidate of candidates) {
    const formatted = formatPrice(candidate);
    if (formatted !== '-') {
      return formatted;
    }
  }
  return '-';
}

function formatPrice(value?: string): string {
  if (!value) return '-';
  const trimmed = value.trim();
  if (!trimmed) return '-';
  const numeric = Number.parseFloat(trimmed);
  if (!Number.isNaN(numeric) && numeric === 0) {
    return '-';
  }
  return trimmed;
}

function formatQuantity(value?: string): string {
  if (!value) return '-';
  const trimmed = value.trim();
  return trimmed || '-';
}
