export type PositionDirection = 'long' | 'short';

export interface PositionSnapshot {
  baseAsset: string;
  symbol: string;
  positionAmt: number;
  notional: number;
  leverage: number;
  initialMargin: number;
  isolatedMargin: number;
  marginType: 'cross' | 'isolated';
  direction: PositionDirection;
  markPrice: number;
  predictedFundingRate: number | null;
  updatedAt: number;
}

export interface AccountContext {
  totalInitialMargin: number;
  totalMarginBalance: number;
  availableBalance: number;
  snapshots: PositionSnapshot[];
  fetchedAt: number;
}

export type ValidationRuleType =
  | 'whitelist_violation'
  | 'blacklist_violation'
  | 'config_error'
  | 'leverage_limit'
  | 'margin_share_limit'
  | 'total_margin_usage'
  | 'funding_rate_limit'
  | 'data_missing';

export type ValidationSeverity = 'warning' | 'critical';

export interface ValidationIssue {
  rule: ValidationRuleType;
  baseAsset: string;
  direction: PositionDirection | 'global';
  severity: ValidationSeverity;
  message: string;
  cooldownMinutes: number;
  notifyOnRecovery: boolean;
  symbol?: string;
  value?: number | null;
  threshold?: number | null;
  details?: Record<string, unknown>;
}

export interface AlertEvent {
  type: 'alert' | 'recovery';
  issue: ValidationIssue;
  repeat: boolean;
  firstDetectedAt: number;
  lastSentAt: number | null;
}

export interface AlertState {
  lastIssue: ValidationIssue;
  firstDetectedAt: number;
  lastSentAt: number | null;
  notifyOnRecovery: boolean;
}

export interface GroupedPositions {
  long: PositionSnapshot[];
  short: PositionSnapshot[];
}
