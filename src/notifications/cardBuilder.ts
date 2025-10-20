import dayjs from 'dayjs';
import type { OrderNotificationInput } from '../orders/types.js';

const TEMPLATE_COLOR_MAP: Record<string, string> = {
  创建: 'blue',
  取消: 'red',
  部分成交: 'orange',
  市价成交: 'green',
  成交: 'green'
};

function resolveTemplate(stateLabel: string): string {
  if (stateLabel in TEMPLATE_COLOR_MAP) {
    return TEMPLATE_COLOR_MAP[stateLabel];
  }
  if (stateLabel.includes('取消')) return 'red';
  if (stateLabel.includes('部分')) return 'orange';
  return 'green';
}

export interface CardPayload {
  msg_type: 'interactive';
  card: Record<string, unknown>;
}

function resolveDirection(side: OrderNotificationInput['side']): string {
  return side === 'SELL' ? '卖出' : '买入';
}

export function buildFeishuCard(input: OrderNotificationInput): CardPayload {
  const elements: Record<string, unknown>[] = [];

  elements.push({
    tag: 'div',
    text: {
      tag: 'lark_md',
      content: `**状态:** ${input.stateLabel}`
    }
  });

  elements.push({
    tag: 'div',
    fields: [
      {
        is_short: true,
        text: {
          tag: 'lark_md',
          content: `**方向:**\n${resolveDirection(input.side)}`
        }
      }
    ]
  });

  const fields: Record<string, unknown>[] = [
    {
      is_short: true,
      text: {
        tag: 'lark_md',
        content: `**Size:**\n${input.size}`
      }
    }
  ];

  if (input.cumulativeQuantity) {
    fields.push({
      is_short: true,
      text: {
        tag: 'lark_md',
        content: `**累计成交量:**\n${input.cumulativeQuantity}`
      }
    });
  }

  elements.push({
    tag: 'div',
    fields
  });

  const priceLabel = input.priceSource === 'average' ? '平均成交价格' : '价格';

  elements.push({
    tag: 'div',
    text: {
      tag: 'lark_md',
      content: `**${priceLabel}:** ${input.displayPrice}`
    }
  });

  elements.push({
    tag: 'div',
    text: {
      tag: 'lark_md',
      content: `**通知时间:** ${dayjs(input.notifyTime).format('YYYY-MM-DD HH:mm:ss')}`
    }
  });

  return {
    msg_type: 'interactive',
    card: {
      config: {
        wide_screen_mode: true,
        enable_forward: true
      },
      header: {
        template: resolveTemplate(input.stateLabel),
        title: {
          tag: 'plain_text',
          content: `${input.symbol}-${input.source}`
        }
      },
      elements
    }
  };
}
