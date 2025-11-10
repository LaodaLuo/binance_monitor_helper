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
    expect(resolvePositionActionLabel('BUY')).toBe('加仓');
    expect(resolvePositionActionLabel('SELL')).toBe('减仓');
  });
});
