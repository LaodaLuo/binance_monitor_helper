import type { ValidationSeverity } from '../positions/types.js';
import type { CardPayload } from './types.js';
import { formatDisplayTime } from '../utils/time.js';

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

export interface PositionAlertDigestEvent {
  title: string;
  scopeLabel: string;
  statusLabel: string;
  severity: ValidationSeverity;
  ruleLabel: string;
  message: string;
  valueLabel?: string;
  thresholdLabel?: string;
  extraFields?: Array<{ label: string; value: string }>;
  repeat: boolean;
  firstDetectedAt: number;
  triggeredAt: number;
}

export interface PositionAlertDigestCardInput {
  triggeredAt: number;
  events: PositionAlertDigestEvent[];
}

function resolveTemplate(severity: ValidationSeverity, statusLabel: string): string {
  if (statusLabel.includes('恢复')) {
    return 'green';
  }
  return SEVERITY_TEMPLATE[severity] ?? 'blue';
}

function resolveDigestTemplate(events: PositionAlertDigestEvent[]): string {
  if (events.length === 0) {
    return 'blue';
  }
  const hasAlert = events.some((event) => !event.statusLabel.includes('恢复'));
  if (!hasAlert) {
    return 'green';
  }
  if (events.some((event) => event.severity === 'critical' && !event.statusLabel.includes('恢复'))) {
    return 'red';
  }
  if (events.some((event) => event.severity === 'warning' && !event.statusLabel.includes('恢复'))) {
    return 'orange';
  }
  return 'blue';
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
      content: `**首次发现:** ${formatDisplayTime(input.firstDetectedAt, undefined, true)}`
    }
  });

  elements.push({
    tag: 'div',
    text: {
      tag: 'lark_md',
      content: `**最新检测:** ${formatDisplayTime(input.triggeredAt, undefined, true)}`
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

export function buildPositionAlertDigestCard(input: PositionAlertDigestCardInput): CardPayload {
  const elements: Record<string, unknown>[] = [];

  elements.push({
    tag: 'div',
    text: {
      tag: 'lark_md',
      content: `**本轮检测:** ${formatDisplayTime(input.triggeredAt, undefined, true)}\n**事件数量:** ${input.events.length}`
    }
  });

  input.events.forEach((event, index) => {
    const detailLines: string[] = [
      `**${index + 1}. ${event.title}**`,
      `状态: ${event.statusLabel}${event.repeat ? '（持续）' : ''}`,
      `说明: ${event.message}`
    ];

    if (event.valueLabel) {
      detailLines.push(`当前值: ${event.valueLabel}`);
    }

    if (event.thresholdLabel) {
      detailLines.push(`阈值: ${event.thresholdLabel}`);
    }

    if (event.extraFields) {
      for (const extra of event.extraFields) {
        detailLines.push(`${extra.label}: ${extra.value}`);
      }
    }

    detailLines.push(`首次发现: ${formatDisplayTime(event.firstDetectedAt, undefined, true)}`);
    detailLines.push(`最新检测: ${formatDisplayTime(event.triggeredAt, undefined, true)}`);

    elements.push({
      tag: 'div',
      text: {
        tag: 'lark_md',
        content: detailLines.join('\n')
      }
    });

    if (index < input.events.length - 1) {
      elements.push({ tag: 'hr' });
    }
  });

  const headerTitle = `持仓监控 - ${input.events.length} 条提醒`;

  return {
    msg_type: 'interactive',
    card: {
      config: {
        wide_screen_mode: true,
        enable_forward: true
      },
      header: {
        template: resolveDigestTemplate(input.events),
        title: {
          tag: 'plain_text',
          content: headerTitle
        }
      },
      elements
    }
  };
}
