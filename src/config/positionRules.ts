import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';

const DEFAULT_CONFIG_PATH = 'config/position-rules.json';

const assetRuleSchema = z.object({
  requireLong: z.boolean().optional(),
  requireShort: z.boolean().optional(),
  forbidLong: z.boolean().optional(),
  forbidShort: z.boolean().optional(),
  maxLeverage: z
    .number()
    .positive()
    .nullable()
    .optional(),
  maxMarginShare: z
    .number()
    .min(0)
    .max(1)
    .nullable()
    .optional(),
  fundingThresholdLong: z.number().nullable().optional(),
  fundingThresholdShort: z.number().nullable().optional(),
  cooldownMinutes: z
    .number()
    .int()
    .nonnegative()
    .nullable()
    .optional(),
  notifyRecovery: z.boolean().optional(),
  minFundingRateDelta: z.number().min(0).nullable().optional()
});

const defaultsSchema = assetRuleSchema.extend({
  requireLongAssets: z.array(z.string()).default([]),
  requireShortAssets: z.array(z.string()).default([]),
  forbidLongAssets: z.array(z.string()).default([]),
  forbidShortAssets: z.array(z.string()).default([]),
  totalMarginUsageLimit: z
    .number()
    .positive()
    .nullable()
    .optional()
});

const configSchema = z.object({
  defaults: defaultsSchema.partial().default({}),
  overrides: z.record(assetRuleSchema.partial()).default({})
});

const FALLBACK_DEFAULTS = {
  maxLeverage: 3,
  maxMarginShare: 0.05,
  fundingThresholdLong: null as number | null,
  fundingThresholdShort: -0.002,
  cooldownMinutes: 60,
  notifyRecovery: false,
  minFundingRateDelta: 0,
  totalMarginUsageLimit: 1
};

type AssetRuleInput = z.infer<typeof assetRuleSchema>;
type DefaultsInput = z.infer<typeof defaultsSchema>;

export interface NormalizedAssetRule {
  requireLong?: boolean;
  requireShort?: boolean;
  forbidLong?: boolean;
  forbidShort?: boolean;
  maxLeverage?: number | null;
  maxMarginShare?: number | null;
  fundingThresholdLong?: number | null;
  fundingThresholdShort?: number | null;
  cooldownMinutes?: number | null;
  notifyRecovery?: boolean;
  minFundingRateDelta?: number | null;
}

export interface ResolvedAssetRule {
  baseAsset: string;
  requireLong: boolean;
  requireShort: boolean;
  forbidLong: boolean;
  forbidShort: boolean;
  maxLeverage: number | null;
  maxMarginShare: number | null;
  fundingThresholdLong: number | null;
  fundingThresholdShort: number | null;
  cooldownMinutes: number;
  notifyRecovery: boolean;
  minFundingRateDelta: number;
}

export interface NormalizedPositionRulesConfig {
  defaults: {
    maxLeverage: number | null;
    maxMarginShare: number | null;
    fundingThresholdLong: number | null;
    fundingThresholdShort: number | null;
    cooldownMinutes: number;
    notifyRecovery: boolean;
    minFundingRateDelta: number;
    totalMarginUsageLimit: number | null;
  };
  requiredLongAssets: Set<string>;
  requiredShortAssets: Set<string>;
  forbiddenLongAssets: Set<string>;
  forbiddenShortAssets: Set<string>;
  overrides: Record<string, NormalizedAssetRule>;
  configuredAssets: Set<string>;
}

function normalizeAssetId(asset: string): string {
  return asset.trim().toUpperCase();
}

function readConfigFile(): unknown {
  const customPath = process.env.POSITION_RULES_CONFIG;
  const candidatePath = resolve(process.cwd(), customPath ?? DEFAULT_CONFIG_PATH);

  if (!existsSync(candidatePath)) {
    return {};
  }

  try {
    const content = readFileSync(candidatePath, 'utf8');
    return JSON.parse(content);
  } catch (error) {
    throw new Error(`Failed to read or parse position rules config at ${candidatePath}: ${(error as Error).message}`);
  }
}

function normalizeDefaults(raw: Partial<DefaultsInput> | undefined): NormalizedPositionRulesConfig['defaults'] & {
  requireLongAssets: Set<string>;
  requireShortAssets: Set<string>;
  forbidLongAssets: Set<string>;
  forbidShortAssets: Set<string>;
} {
  const requireLongAssets = new Set((raw?.requireLongAssets ?? []).map(normalizeAssetId));
  const requireShortAssets = new Set((raw?.requireShortAssets ?? []).map(normalizeAssetId));
  const forbidLongAssets = new Set((raw?.forbidLongAssets ?? []).map(normalizeAssetId));
  const forbidShortAssets = new Set((raw?.forbidShortAssets ?? []).map(normalizeAssetId));

  const maxLeverage = raw?.maxLeverage === undefined ? FALLBACK_DEFAULTS.maxLeverage : raw.maxLeverage;
  const maxMarginShare =
    raw?.maxMarginShare === undefined ? FALLBACK_DEFAULTS.maxMarginShare : raw.maxMarginShare;
  const fundingThresholdLong =
    raw?.fundingThresholdLong === undefined
      ? FALLBACK_DEFAULTS.fundingThresholdLong
      : raw.fundingThresholdLong;
  const fundingThresholdShort =
    raw?.fundingThresholdShort === undefined
      ? FALLBACK_DEFAULTS.fundingThresholdShort
      : raw.fundingThresholdShort;
  const cooldownMinutes =
    raw?.cooldownMinutes === undefined ? FALLBACK_DEFAULTS.cooldownMinutes : raw.cooldownMinutes ?? FALLBACK_DEFAULTS.cooldownMinutes;
  const notifyRecovery =
    raw?.notifyRecovery === undefined ? FALLBACK_DEFAULTS.notifyRecovery : raw.notifyRecovery;
  const minFundingRateDelta =
    raw?.minFundingRateDelta === undefined
      ? FALLBACK_DEFAULTS.minFundingRateDelta
      : raw.minFundingRateDelta ?? FALLBACK_DEFAULTS.minFundingRateDelta;
  const totalMarginUsageLimit =
    raw?.totalMarginUsageLimit === undefined
      ? FALLBACK_DEFAULTS.totalMarginUsageLimit
      : raw.totalMarginUsageLimit;

  return {
    maxLeverage,
    maxMarginShare,
    fundingThresholdLong,
    fundingThresholdShort,
    cooldownMinutes: cooldownMinutes ?? FALLBACK_DEFAULTS.cooldownMinutes,
    notifyRecovery,
    minFundingRateDelta: minFundingRateDelta ?? FALLBACK_DEFAULTS.minFundingRateDelta,
    totalMarginUsageLimit,
    requireLongAssets,
    requireShortAssets,
    forbidLongAssets,
    forbidShortAssets
  };
}

function normalizeOverrides(raw: Record<string, AssetRuleInput>): Record<string, NormalizedAssetRule> {
  const normalizedEntries: [string, NormalizedAssetRule][] = Object.entries(raw).map(([asset, rule]) => [
    normalizeAssetId(asset),
    {
      requireLong: rule.requireLong,
      requireShort: rule.requireShort,
      forbidLong: rule.forbidLong,
      forbidShort: rule.forbidShort,
      maxLeverage: rule.maxLeverage,
      maxMarginShare: rule.maxMarginShare,
      fundingThresholdLong: rule.fundingThresholdLong,
      fundingThresholdShort: rule.fundingThresholdShort,
      cooldownMinutes: rule.cooldownMinutes ?? undefined,
      notifyRecovery: rule.notifyRecovery,
      minFundingRateDelta: rule.minFundingRateDelta
    }
  ]);

  return Object.fromEntries(normalizedEntries);
}

const parsedConfig = configSchema.safeParse(readConfigFile());

if (!parsedConfig.success) {
  const { errors } = parsedConfig.error;
  const message = errors.map((err) => `${err.path.join('.') || '<root>'}: ${err.message}`).join('\n');
  throw new Error(`Position rules config validation failed:\n${message}`);
}

const rawDefaults = parsedConfig.data.defaults;
const normalizedDefaults = normalizeDefaults(rawDefaults);
const normalizedOverrides = normalizeOverrides(parsedConfig.data.overrides);

const requiredLongAssets = new Set(normalizedDefaults.requireLongAssets);
const requiredShortAssets = new Set(normalizedDefaults.requireShortAssets);
const forbiddenLongAssets = new Set(normalizedDefaults.forbidLongAssets);
const forbiddenShortAssets = new Set(normalizedDefaults.forbidShortAssets);

for (const [asset, overrideRule] of Object.entries(normalizedOverrides)) {
  if (overrideRule.requireLong === true) {
    requiredLongAssets.add(asset);
  } else if (overrideRule.requireLong === false) {
    requiredLongAssets.delete(asset);
  }

  if (overrideRule.requireShort === true) {
    requiredShortAssets.add(asset);
  } else if (overrideRule.requireShort === false) {
    requiredShortAssets.delete(asset);
  }

  if (overrideRule.forbidLong === true) {
    forbiddenLongAssets.add(asset);
  } else if (overrideRule.forbidLong === false) {
    forbiddenLongAssets.delete(asset);
  }

  if (overrideRule.forbidShort === true) {
    forbiddenShortAssets.add(asset);
  } else if (overrideRule.forbidShort === false) {
    forbiddenShortAssets.delete(asset);
  }
}

const configuredAssets = new Set<string>([
  ...requiredLongAssets,
  ...requiredShortAssets,
  ...forbiddenLongAssets,
  ...forbiddenShortAssets,
  ...Object.keys(normalizedOverrides)
]);

export const positionRulesConfig: NormalizedPositionRulesConfig = {
  defaults: {
    maxLeverage: normalizedDefaults.maxLeverage,
    maxMarginShare: normalizedDefaults.maxMarginShare,
    fundingThresholdLong: normalizedDefaults.fundingThresholdLong,
    fundingThresholdShort: normalizedDefaults.fundingThresholdShort,
    cooldownMinutes: normalizedDefaults.cooldownMinutes,
    notifyRecovery: normalizedDefaults.notifyRecovery,
    minFundingRateDelta: normalizedDefaults.minFundingRateDelta,
    totalMarginUsageLimit: normalizedDefaults.totalMarginUsageLimit
  },
  requiredLongAssets,
  requiredShortAssets,
  forbiddenLongAssets,
  forbiddenShortAssets,
  overrides: normalizedOverrides,
  configuredAssets
};

function overrideHasKey<T extends keyof NormalizedAssetRule>(rule: NormalizedAssetRule | undefined, key: T): boolean {
  return rule ? Object.prototype.hasOwnProperty.call(rule, key) : false;
}

export function resolvePositionRule(baseAsset: string): ResolvedAssetRule {
  const assetKey = normalizeAssetId(baseAsset);
  const override = positionRulesConfig.overrides[assetKey];

  const requireLong = overrideHasKey(override, 'requireLong')
    ? Boolean(override?.requireLong)
    : positionRulesConfig.requiredLongAssets.has(assetKey);
  const requireShort = overrideHasKey(override, 'requireShort')
    ? Boolean(override?.requireShort)
    : positionRulesConfig.requiredShortAssets.has(assetKey);
  const forbidLong = overrideHasKey(override, 'forbidLong')
    ? Boolean(override?.forbidLong)
    : positionRulesConfig.forbiddenLongAssets.has(assetKey);
  const forbidShort = overrideHasKey(override, 'forbidShort')
    ? Boolean(override?.forbidShort)
    : positionRulesConfig.forbiddenShortAssets.has(assetKey);

  const maxLeverage = overrideHasKey(override, 'maxLeverage')
    ? (override?.maxLeverage ?? null)
    : positionRulesConfig.defaults.maxLeverage;
  const maxMarginShare = overrideHasKey(override, 'maxMarginShare')
    ? (override?.maxMarginShare ?? null)
    : positionRulesConfig.defaults.maxMarginShare;
  const fundingThresholdLong = overrideHasKey(override, 'fundingThresholdLong')
    ? (override?.fundingThresholdLong ?? null)
    : positionRulesConfig.defaults.fundingThresholdLong;
  const fundingThresholdShort = overrideHasKey(override, 'fundingThresholdShort')
    ? (override?.fundingThresholdShort ?? null)
    : positionRulesConfig.defaults.fundingThresholdShort;
  const cooldownMinutes = overrideHasKey(override, 'cooldownMinutes')
    ? (override?.cooldownMinutes ?? positionRulesConfig.defaults.cooldownMinutes)
    : positionRulesConfig.defaults.cooldownMinutes;
  const notifyRecovery = overrideHasKey(override, 'notifyRecovery')
    ? Boolean(override?.notifyRecovery)
    : positionRulesConfig.defaults.notifyRecovery;
  const minFundingRateDelta = overrideHasKey(override, 'minFundingRateDelta')
    ? override?.minFundingRateDelta ?? positionRulesConfig.defaults.minFundingRateDelta
    : positionRulesConfig.defaults.minFundingRateDelta;

  return {
    baseAsset: assetKey,
    requireLong,
    requireShort,
    forbidLong,
    forbidShort,
    maxLeverage,
    maxMarginShare,
    fundingThresholdLong,
    fundingThresholdShort,
    cooldownMinutes,
    notifyRecovery,
    minFundingRateDelta
  };
}

export function getTotalMarginUsageLimit(): number | null {
  return positionRulesConfig.defaults.totalMarginUsageLimit;
}

export function getConfiguredAssets(): string[] {
  return Array.from(positionRulesConfig.configuredAssets);
}

export function normalizeBaseAssetId(asset: string): string {
  return normalizeAssetId(asset);
}
