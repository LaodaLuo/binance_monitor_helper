import type { OrderEvent } from '../orders/types.js';
import {
  classifyOrder,
  resolveFillSourceLabel,
  resolvePositionActionLabel
} from '../orders/orderClassification.js';
import type { CardPayload } from './types.js';
import { formatDisplayTime } from '../utils/time.js';

export function buildOrderFillCard(event: OrderEvent): CardPayload {
  const category = classifyOrder(event.clientOrderId);
  const sourceLabel = resolveFillSourceLabel(category);
  const actionLabel = resolvePositionActionLabel(event.side, category, event.positionSide);
  const directionMeta = resolveDirectionMeta(event);
  const title = `${event.symbol}-${sourceLabel}`;
  const quantity = formatQuantity(event.originalQuantity);
  const avgPrice = resolveAveragePrice(event);
  const tradeTime = formatDisplayTime(event.tradeTime, undefined, true);
  const actionColor = resolveActionColor(actionLabel);

  const elements: Record<string, unknown>[] = [
    {
      tag: 'div',
      fields: [
        {
          is_short: true,
          text: {
            tag: 'lark_md',
            content: `**持仓方向:**\n${highlightWithColor(directionMeta.color, directionMeta.label)}`
          }
        },
        {
          is_short: true,
          text: {
            tag: 'lark_md',
            content: `**交易动作:**\n${highlightWithColor(actionColor, actionLabel)}`
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
            content: `**数量:**\n${quantity}`
          }
        },
        {
          is_short: true,
          text: {
            tag: 'lark_md',
            content: `**平均成交价格:**\n${avgPrice}`
          }
        }
      ]
    },
    {
      tag: 'div',
      text: {
        tag: 'lark_md',
        content: `**最后成交时间:** ${tradeTime}`
      }
    }
  ];

  return {
    msg_type: 'interactive',
    card: {
      config: {
        wide_screen_mode: true,
        enable_forward: true
      },
      header: {
        template: directionMeta.template,
        title: {
          tag: 'plain_text',
          content: title
        }
      },
      elements
    }
  };
}

function resolveAveragePrice(event: OrderEvent): string {
  const candidates: Array<string | undefined> = [
    event.averagePrice,
    event.lastPrice,
    event.orderPrice
  ];
  for (const value of candidates) {
    const formatted = formatPrice(value);
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

type DirectionColor = 'green' | 'red';

interface DirectionMeta {
  label: string;
  color: DirectionColor;
  template: DirectionColor;
}

function resolveDirectionMeta(event: OrderEvent): DirectionMeta {
  if (event.positionSide === 'LONG') {
    return { label: '做多', color: 'green', template: 'green' };
  }
  if (event.positionSide === 'SHORT') {
    return { label: '做空', color: 'red', template: 'red' };
  }

  if (event.side === 'SELL') {
    return { label: '做空', color: 'red', template: 'red' };
  }

  return { label: '做多', color: 'green', template: 'green' };
}

function resolveActionColor(actionLabel: string): DirectionColor {
  return actionLabel === '加仓' ? 'green' : 'red';
}

function highlightWithColor(color: DirectionColor, text: string): string {
  return `<font color="${color}">${text}</font>`;
}
