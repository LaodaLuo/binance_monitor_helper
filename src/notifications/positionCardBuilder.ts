import dayjs from 'dayjs';
import type { ValidationSeverity } from '../positions/types.js';
import type { CardPayload } from './cardBuilder.js';

const SEVERITY_TEMPLATE: Record<ValidationSeverity, string> = {
  critical: 'red',
  warning: 'orange'
};

export interface PositionAlertCardInput {
  title: string;
  scopeLabel: string;
  statusLabel: string;
  severity: ValidationSeverity;
  ruleLabel: string;
  message: string;
  valueLabel?: string;
  thresholdLabel?: string;
  extraFields?: Array<{ label: string; value: string }>;
  firstDetectedAt: number;
  triggeredAt: number;
  repeat: boolean;
}

function resolveTemplate(severity: ValidationSeverity, statusLabel: string): string {
  if (statusLabel.includes('恢复')) {
    return 'green';
  }
  return SEVERITY_TEMPLATE[severity] ?? 'blue';
}

export function buildPositionAlertCard(input: PositionAlertCardInput): CardPayload {
  const elements: Record<string, unknown>[] = [];

  elements.push({
    tag: 'div',
    text: {
      tag: 'lark_md',
      content: `**状态:** ${input.statusLabel}${input.repeat ? '（持续）' : ''}`
    }
  });

  elements.push({
    tag: 'div',
    text: {
      tag: 'lark_md',
      content: `**规则:** ${input.ruleLabel}`
    }
  });

  elements.push({
    tag: 'div',
    text: {
      tag: 'lark_md',
      content: `**说明:** ${input.message}`
    }
  });

  const fields: Array<{ is_short: boolean; text: { tag: 'lark_md'; content: string } }> = [];

  if (input.valueLabel) {
    fields.push({
      is_short: true,
      text: {
        tag: 'lark_md',
        content: `**当前值:**\n${input.valueLabel}`
      }
    });
  }

  if (input.thresholdLabel) {
    fields.push({
      is_short: true,
      text: {
        tag: 'lark_md',
        content: `**阈值:**\n${input.thresholdLabel}`
      }
    });
  }

  if (input.extraFields) {
    for (const extra of input.extraFields) {
      fields.push({
        is_short: true,
        text: {
          tag: 'lark_md',
          content: `**${extra.label}:**\n${extra.value}`
        }
      });
    }
  }

  if (fields.length > 0) {
    elements.push({
      tag: 'div',
      fields
    });
  }

  elements.push({
    tag: 'div',
    text: {
      tag: 'lark_md',
      content: `**首次发现:** ${dayjs(input.firstDetectedAt).format('YYYY-MM-DD HH:mm:ss')}`
    }
  });

  elements.push({
    tag: 'div',
    text: {
      tag: 'lark_md',
      content: `**最新检测:** ${dayjs(input.triggeredAt).format('YYYY-MM-DD HH:mm:ss')}`
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
        template: resolveTemplate(input.severity, input.statusLabel),
        title: {
          tag: 'plain_text',
          content: input.title
        }
      },
      elements
    }
  };
}
