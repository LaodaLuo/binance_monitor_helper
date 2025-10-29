import { describe, expect, it } from 'vitest';
import { AlertLimiter } from '../positions/alertLimiter.js';
import type { ValidationIssue } from '../positions/types.js';

const baseIssue: ValidationIssue = {
  rule: 'leverage_limit',
  baseAsset: 'ETH',
  direction: 'long',
  severity: 'warning',
  message: 'Leverage too high',
  cooldownMinutes: 1,
  notifyOnRecovery: true,
  value: 5,
  threshold: 3
};

describe('AlertLimiter', () => {
  it('throttles alerts and emits recovery events', () => {
    const limiter = new AlertLimiter();

    const firstBatch = limiter.process([baseIssue], 0);
    expect(firstBatch).toHaveLength(1);
    expect(firstBatch[0]).toMatchObject({ type: 'alert', repeat: false });

    const secondBatch = limiter.process([baseIssue], 30 * 1000);
    expect(secondBatch).toHaveLength(0);

    const thirdBatch = limiter.process([baseIssue], 120 * 1000);
    expect(thirdBatch).toHaveLength(1);
    expect(thirdBatch[0]).toMatchObject({ type: 'alert', repeat: true });

    const recoveryBatch = limiter.process([], 200 * 1000);
    expect(recoveryBatch).toHaveLength(1);
    expect(recoveryBatch[0]).toMatchObject({ type: 'recovery' });
  });

  it('enforces minimum cooldown when configured', () => {
    const limiter = new AlertLimiter({ minCooldownMinutes: 60 });
    const issue: ValidationIssue = {
      ...baseIssue,
      cooldownMinutes: 0
    };

    const firstBatch = limiter.process([issue], 0);
    expect(firstBatch).toHaveLength(1);

    const thirtyMinutesLater = limiter.process([issue], 30 * 60 * 1000);
    expect(thirtyMinutesLater).toHaveLength(0);

    const afterOneHour = limiter.process([issue], 61 * 60 * 1000);
    expect(afterOneHour).toHaveLength(1);
    expect(afterOneHour[0]).toMatchObject({ repeat: true });
  });
});
