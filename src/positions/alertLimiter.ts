import type { AlertEvent, AlertState, ValidationIssue } from './types.js';

function defaultIssueKey(issue: ValidationIssue): string {
  return `${issue.rule}:${issue.baseAsset}:${issue.direction}`;
}

export interface AlertLimiterOptions {
  keyFn?: (issue: ValidationIssue) => string;
  minCooldownMinutes?: number;
}

export class AlertLimiter {
  private readonly states = new Map<string, AlertState>();
  private readonly keyFn: (issue: ValidationIssue) => string;
  private readonly minCooldownMs: number;

  constructor();
  constructor(keyFn: (issue: ValidationIssue) => string);
  constructor(options: AlertLimiterOptions);
  constructor(arg?: ((issue: ValidationIssue) => string) | AlertLimiterOptions) {
    if (typeof arg === 'function') {
      this.keyFn = arg;
      this.minCooldownMs = 0;
    } else {
      this.keyFn = arg?.keyFn ?? defaultIssueKey;
      const minCooldownMinutes = Math.max(0, arg?.minCooldownMinutes ?? 0);
      this.minCooldownMs = minCooldownMinutes * 60 * 1000;
    }
  }

  process(issues: ValidationIssue[], timestamp: number): AlertEvent[] {
    const events: AlertEvent[] = [];
    const seenKeys = new Set<string>();

    for (const issue of issues) {
      const key = this.keyFn(issue);
      seenKeys.add(key);
      const state = this.states.get(key);

      if (!state) {
        this.states.set(key, {
          lastIssue: issue,
          firstDetectedAt: timestamp,
          lastSentAt: timestamp,
          notifyOnRecovery: issue.notifyOnRecovery
        });
        events.push({
          type: 'alert',
          issue,
          repeat: false,
          firstDetectedAt: timestamp,
          lastSentAt: null
        });
        continue;
      }

      state.lastIssue = issue;
      state.notifyOnRecovery = issue.notifyOnRecovery;

      const issueCooldownMs = Math.max(0, issue.cooldownMinutes) * 60 * 1000;
      const cooldownMs = Math.max(issueCooldownMs, this.minCooldownMs);
      if (state.lastSentAt === null || timestamp - state.lastSentAt >= cooldownMs) {
        events.push({
          type: 'alert',
          issue,
          repeat: state.lastSentAt !== null,
          firstDetectedAt: state.firstDetectedAt,
          lastSentAt: state.lastSentAt
        });
        state.lastSentAt = timestamp;
      }
    }

    for (const [key, state] of this.states.entries()) {
      if (seenKeys.has(key)) continue;
      if (state.notifyOnRecovery) {
        events.push({
          type: 'recovery',
          issue: state.lastIssue,
          repeat: false,
          firstDetectedAt: state.firstDetectedAt,
          lastSentAt: state.lastSentAt
        });
      }
      this.states.delete(key);
    }

    return events;
  }

  clear(): void {
    this.states.clear();
  }
}

export { defaultIssueKey };
