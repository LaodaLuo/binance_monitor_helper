import type { OrderSide } from './types.js';

export type OrderCategoryKind = 'tp' | 'sl' | 'ft' | 'other';

export interface OrderCategory {
  kind: OrderCategoryKind;
  level?: number;
  rawClientOrderId: string;
}

const TP_LEVEL_REGEXP = /^TP(\d+)/i;

export function classifyOrder(clientOrderId: string): OrderCategory {
  const normalized = (clientOrderId ?? '').trim();
  const upper = normalized.toUpperCase();

  if (upper.startsWith('TP')) {
    const levelMatch = upper.match(TP_LEVEL_REGEXP);
    return {
      kind: 'tp',
      level: levelMatch ? Number.parseInt(levelMatch[1], 10) : undefined,
      rawClientOrderId: clientOrderId
    };
  }

  if (upper.startsWith('SL')) {
    return {
      kind: 'sl',
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
      return `${symbol}-固定止损单`;
    case 'ft':
      return `${symbol}-追踪止损单`;
    default:
      return `${symbol}-其他来源订单`;
  }
}

export function resolveFillSourceLabel(category: OrderCategory): string {
  switch (category.kind) {
    case 'tp':
      return resolveMovingStopLabel(category);
    case 'sl':
      return '固定止损';
    case 'ft':
      return '追踪止损';
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

export function resolvePositionActionLabel(side: OrderSide): string {
  return side === 'SELL' ? '减仓' : '加仓';
}

function resolveMovingStopLabel(category: OrderCategory): string {
  if (category.level && Number.isFinite(category.level)) {
    return `移动止损第${category.level}档`;
  }
  return '移动止损单';
}
