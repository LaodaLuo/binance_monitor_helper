import { describe, expect, it } from 'vitest';
import {
  classifyOrder,
  resolveFillSourceLabel,
  resolveLifecycleTitle,
  resolveSideLabelForFill,
  resolveSideLabelForLifecycle,
  resolvePositionDirectionLabel,
  resolvePositionActionLabel
} from '../orders/orderClassification.js';

describe('classifyOrder', () => {
  it('识别 TP 前缀并解析档位', () => {
    const result = classifyOrder('TP2_alpha');
    expect(result.kind).toBe('tp');
    expect(result.level).toBe(2);
  });

  it('无档位的 TP 归类为移动止损单', () => {
    const result = classifyOrder('tp_follow');
    expect(result.kind).toBe('tp');
    expect(result.level).toBeUndefined();
  });

  it('识别 SL 前缀', () => {
    const result = classifyOrder('sl_fix_stop');
    expect(result.kind).toBe('sl');
  });

  it('识别 FT 前缀', () => {
    const result = classifyOrder('ft_track');
    expect(result.kind).toBe('ft');
  });

  it('其他前缀归为通用订单', () => {
    const result = classifyOrder('custom');
    expect(result.kind).toBe('other');
  });
});

describe('resolve helpers', () => {
  it('根据分类输出生命周期标题', () => {
    const tp = classifyOrder('TP3_demo');
    expect(resolveLifecycleTitle('BTCUSDT', tp)).toBe('BTCUSDT-移动止损第3档');
    const sl = classifyOrder('SL_demo');
    expect(resolveLifecycleTitle('ETHUSDT', sl)).toBe('ETHUSDT-固定止损单');
  });

  it('根据分类输出成交标题片段', () => {
    const ft = classifyOrder('FT_demo');
    expect(resolveFillSourceLabel(ft)).toBe('追踪止损');
    const other = classifyOrder('random');
    expect(resolveFillSourceLabel(other)).toBe('其他来源');
  });

  it('根据订单方向输出中文标签', () => {
    expect(resolveSideLabelForLifecycle('BUY')).toBe('做多');
    expect(resolveSideLabelForLifecycle('SELL')).toBe('做空');
    expect(resolveSideLabelForFill('BUY')).toBe('买入');
    expect(resolveSideLabelForFill('SELL')).toBe('卖出');
    expect(resolvePositionDirectionLabel('BUY')).toBe('多');
    expect(resolvePositionDirectionLabel('SELL')).toBe('空');
  });

  it('止盈/止损/追踪止损一律视为减仓', () => {
    const tpOrder = classifyOrder('TP1_demo');
    const slOrder = classifyOrder('SL_stop');
    const ftOrder = classifyOrder('FT_track');

    // TP/SL/FT 订单无论 side 是什么，都是减仓
    expect(resolvePositionActionLabel('BUY', tpOrder)).toBe('减仓');
    expect(resolvePositionActionLabel('SELL', tpOrder)).toBe('减仓');
    expect(resolvePositionActionLabel('BUY', slOrder)).toBe('减仓');
    expect(resolvePositionActionLabel('SELL', slOrder)).toBe('减仓');
    expect(resolvePositionActionLabel('BUY', ftOrder)).toBe('减仓');
    expect(resolvePositionActionLabel('SELL', ftOrder)).toBe('减仓');
  });

  it('根据持仓方向与买卖方向判断加仓/减仓', () => {
    const otherOrder = classifyOrder('custom_order');

    expect(resolvePositionActionLabel('BUY', otherOrder, 'LONG')).toBe('加仓');
    expect(resolvePositionActionLabel('SELL', otherOrder, 'LONG')).toBe('减仓');
    expect(resolvePositionActionLabel('SELL', otherOrder, 'SHORT')).toBe('加仓');
    expect(resolvePositionActionLabel('BUY', otherOrder, 'SHORT')).toBe('减仓');

    // positionSide 缺失时退回下单方向判断
    expect(resolvePositionActionLabel('BUY', otherOrder)).toBe('加仓');
    expect(resolvePositionActionLabel('SELL', otherOrder)).toBe('减仓');
  });
});
