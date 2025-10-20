import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';

const DEFAULT_CONFIG_PATH = 'config/position-rules.json';

const listSchema = z.array(z.string());

const assetRuleSchema = z.object({
  whitelistLong: listSchema.optional(),
  whitelistShort: listSchema.optional(),
  blacklistLong: listSchema.optional(),
  blacklistShort: listSchema.optional(),
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
  whitelistLong?: string[] | null;
  whitelistShort?: string[] | null;
  blacklistLong?: string[] | null;
  blacklistShort?: string[] | null;
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
  whitelistLong: Set<string> | null;
  whitelistShort: Set<string> | null;
  blacklistLong: Set<string> | null;
  blacklistShort: Set<string> | null;
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
    whitelistLong: string[] | null;
    whitelistShort: string[] | null;
    blacklistLong: string[] | null;
    blacklistShort: string[] | null;
    maxLeverage: number | null;
    maxMarginShare: number | null;
    fundingThresholdLong: number | null;
    fundingThresholdShort: number | null;
    cooldownMinutes: number;
    notifyRecovery: boolean;
    minFundingRateDelta: number;
    totalMarginUsageLimit: number | null;
  };
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

function normalizeDefaultList(list?: string[]): string[] | null {
  if (!list || list.length === 0) {
    return null;
  }
  return list.map(normalizeAssetId);
}

function normalizeOverrideList(list?: string[]): string[] | null | undefined {
  if (list === undefined) {
    return undefined;
  }
  if (list.length === 0) {
    return null;
  }
  return list.map(normalizeAssetId);
}

function normalizeDefaults(raw: Partial<DefaultsInput> | undefined): NormalizedPositionRulesConfig['defaults'] {
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
    raw?.cooldownMinutes === undefined
      ? FALLBACK_DEFAULTS.cooldownMinutes
      : raw.cooldownMinutes ?? FALLBACK_DEFAULTS.cooldownMinutes;
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
    whitelistLong: normalizeDefaultList(raw?.whitelistLong),
    whitelistShort: normalizeDefaultList(raw?.whitelistShort),
    blacklistLong: normalizeDefaultList(raw?.blacklistLong),
    blacklistShort: normalizeDefaultList(raw?.blacklistShort),
    maxLeverage,
    maxMarginShare,
    fundingThresholdLong,
    fundingThresholdShort,
    cooldownMinutes: cooldownMinutes ?? FALLBACK_DEFAULTS.cooldownMinutes,
    notifyRecovery,
    minFundingRateDelta: minFundingRateDelta ?? FALLBACK_DEFAULTS.minFundingRateDelta,
    totalMarginUsageLimit
  };
}

function normalizeOverrides(raw: Record<string, AssetRuleInput>): Record<string, NormalizedAssetRule> {
  const normalizedEntries: [string, NormalizedAssetRule][] = Object.entries(raw).map(([asset, rule]) => {
    const normalized: NormalizedAssetRule = {};
    const whitelistLong = normalizeOverrideList(rule.whitelistLong);
    if (whitelistLong !== undefined) normalized.whitelistLong = whitelistLong;
    const whitelistShort = normalizeOverrideList(rule.whitelistShort);
    if (whitelistShort !== undefined) normalized.whitelistShort = whitelistShort;
    const blacklistLong = normalizeOverrideList(rule.blacklistLong);
    if (blacklistLong !== undefined) normalized.blacklistLong = blacklistLong;
    const blacklistShort = normalizeOverrideList(rule.blacklistShort);
    if (blacklistShort !== undefined) normalized.blacklistShort = blacklistShort;

    if (rule.maxLeverage !== undefined) normalized.maxLeverage = rule.maxLeverage;
    if (rule.maxMarginShare !== undefined) normalized.maxMarginShare = rule.maxMarginShare;
    if (rule.fundingThresholdLong !== undefined)
      normalized.fundingThresholdLong = rule.fundingThresholdLong;
    if (rule.fundingThresholdShort !== undefined)
      normalized.fundingThresholdShort = rule.fundingThresholdShort;
    if (rule.cooldownMinutes !== undefined) normalized.cooldownMinutes = rule.cooldownMinutes;
    if (rule.notifyRecovery !== undefined) normalized.notifyRecovery = rule.notifyRecovery;
    if (rule.minFundingRateDelta !== undefined)
      normalized.minFundingRateDelta = rule.minFundingRateDelta;

    return [normalizeAssetId(asset), normalized];
  });

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

const configuredAssets = new Set<string>();

function collect(list: string[] | null | undefined): void {
  if (!list) return;
  for (const asset of list) {
    configuredAssets.add(asset);
  }
}

collect(normalizedDefaults.whitelistLong);
collect(normalizedDefaults.whitelistShort);
collect(normalizedDefaults.blacklistLong);
collect(normalizedDefaults.blacklistShort);

for (const [asset, rule] of Object.entries(normalizedOverrides)) {
  configuredAssets.add(asset);
  collect(rule.whitelistLong);
  collect(rule.whitelistShort);
  collect(rule.blacklistLong);
  collect(rule.blacklistShort);
}

export const positionRulesConfig: NormalizedPositionRulesConfig = {
  defaults: normalizedDefaults,
  overrides: normalizedOverrides,
  configuredAssets
};

function overrideHasKey<T extends keyof NormalizedAssetRule>(rule: NormalizedAssetRule | undefined, key: T): boolean {
  return rule ? Object.prototype.hasOwnProperty.call(rule, key) : false;
}

function toSet(list: string[] | null | undefined): Set<string> | null {
  if (!list) return null;
  return new Set(list);
}

export function resolvePositionRule(baseAsset: string): ResolvedAssetRule {
  const assetKey = normalizeAssetId(baseAsset);
  const override = positionRulesConfig.overrides[assetKey];

  const whitelistLong = overrideHasKey(override, 'whitelistLong')
    ? toSet(override?.whitelistLong ?? null)
    : toSet(positionRulesConfig.defaults.whitelistLong);
  const whitelistShort = overrideHasKey(override, 'whitelistShort')
    ? toSet(override?.whitelistShort ?? null)
    : toSet(positionRulesConfig.defaults.whitelistShort);
  const blacklistLong = overrideHasKey(override, 'blacklistLong')
    ? toSet(override?.blacklistLong ?? null)
    : toSet(positionRulesConfig.defaults.blacklistLong);
  const blacklistShort = overrideHasKey(override, 'blacklistShort')
    ? toSet(override?.blacklistShort ?? null)
    : toSet(positionRulesConfig.defaults.blacklistShort);

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
    whitelistLong,
    whitelistShort,
    blacklistLong,
    blacklistShort,
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
