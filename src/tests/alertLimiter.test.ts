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
});
