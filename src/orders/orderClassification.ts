import type { OrderPositionSide, OrderSide } from './types.js';
import { extractTimeWindowFromClientOrderId } from './types.js';

export type OrderCategoryKind = 'tp' | 'sl' | 'ft' | 'tw' | 'other';

export interface OrderCategory {
  kind: OrderCategoryKind;
  level?: number;
  timeFrame?: string;
  rawClientOrderId: string;
}

const TP_LEVEL_REGEXP = /^TP(\d+)/i;
const SL_LEVEL_REGEXP = /^SL(\d+)/i;

export function classifyOrder(clientOrderId: string): OrderCategory {
  const normalized = (clientOrderId ?? '').trim();
  const upper = normalized.toUpperCase();

  if (upper.startsWith('TW_')) {
    const timeFrame = extractTimeWindowFromClientOrderId(clientOrderId);
    return {
      kind: 'tw',
      timeFrame,
      rawClientOrderId: clientOrderId
    };
  }

  if (upper.startsWith('TP')) {
    const levelMatch = upper.match(TP_LEVEL_REGEXP);
    return {
      kind: 'tp',
      level: levelMatch ? Number.parseInt(levelMatch[1], 10) : undefined,
      rawClientOrderId: clientOrderId
    };
  }

  if (upper.startsWith('SL')) {
    const levelMatch = upper.match(SL_LEVEL_REGEXP);
    return {
      kind: 'sl',
      level: levelMatch ? Number.parseInt(levelMatch[1], 10) : undefined,
      rawClientOrderId: clientOrderId
    };
  }

  if (upper.startsWith('FT')) {
    return {
      kind: 'ft',
      rawClientOrderId: clientOrderId
    };
  }

  return {
    kind: 'other',
    rawClientOrderId: clientOrderId
  };
}

export function resolveLifecycleTitle(symbol: string, category: OrderCategory): string {
  switch (category.kind) {
    case 'tp':
      return `${symbol}-${resolveMovingStopLabel(category)}`;
    case 'sl':
      return `${symbol}-${resolveHardStopLabel(category)}`;
    case 'ft':
      return `${symbol}-追踪止损单`;
    case 'tw':
      return `${symbol}-${resolveTimeWindowStopLabel(category)}`;
    default:
      return `${symbol}-其他来源订单`;
  }
}

export function resolveFillSourceLabel(category: OrderCategory): string {
  switch (category.kind) {
    case 'tp':
      return resolveMovingStopLabel(category);
    case 'sl':
      return resolveHardStopLabel(category);
    case 'ft':
      return '追踪止损';
    case 'tw':
      return resolveTimeWindowStopLabel(category);
    default:
      return '其他来源';
  }
}

export function resolveSideLabelForLifecycle(side: OrderSide): string {
  return side === 'SELL' ? '做空' : '做多';
}

export function resolveSideLabelForFill(side: OrderSide): string {
  return side === 'SELL' ? '卖出' : '买入';
}

export function resolvePositionDirectionLabel(side: OrderSide): string {
  return side === 'SELL' ? '空' : '多';
}

export function resolvePositionActionLabel(
  side: OrderSide,
  category: OrderCategory,
  positionSide?: OrderPositionSide
): string {
  if (category.kind === 'tp' || category.kind === 'sl' || category.kind === 'ft' || category.kind === 'tw') {
    return '减仓';
  }

  if (positionSide === 'LONG') {
    return side === 'SELL' ? '减仓' : '加仓';
  }

  if (positionSide === 'SHORT') {
    return side === 'BUY' ? '减仓' : '加仓';
  }

  // positionSide 为空或 BOTH 时缺乏明确持仓方向，退回到按下单方向推断
  return side === 'SELL' ? '减仓' : '加仓';
}

function resolveMovingStopLabel(category: OrderCategory): string {
  if (category.level && Number.isFinite(category.level)) {
    return `移动止损第${category.level}档`;
  }
  return '移动止损单';
}

function resolveHardStopLabel(category: OrderCategory): string {
  if (category.level && Number.isFinite(category.level)) {
    return `硬止损第${category.level}档`;
  }
  return '硬止损单';
}

function resolveTimeWindowStopLabel(category: OrderCategory): string {
  const timeFrame = category.timeFrame?.trim();
  if (timeFrame) {
    return `${timeFrame} 时间周期止损单`;
  }
  return '时间周期止损单';
}
