import { createRequire } from 'node:module';
import { z } from 'zod';

const require = createRequire(import.meta.url);

try {
  // dotenv is optional; skip silently if not installed.
  const { config: loadEnv } = require('dotenv');
  loadEnv();
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== 'MODULE_NOT_FOUND') {
    throw error;
  }
}

const configSchema = z.object({
  BINANCE_API_KEY: z.string().min(1, 'BINANCE_API_KEY is required'),
  BINANCE_API_SECRET: z.string().min(1, 'BINANCE_API_SECRET is required'),
  BINANCE_BASE_URL: z.string().url().default('https://fapi.binance.com'),
  BINANCE_WS_BASE_URL: z.string().url().default('wss://fstream.binance.com/ws'),
  FEISHU_BOT1_WEBHOOK_URL: z.string().url('FEISHU_BOT1_WEBHOOK_URL must be a valid URL'),
  FEISHU_BOT2_WEBHOOK_URL: z.string().url('FEISHU_BOT2_WEBHOOK_URL must be a valid URL'),
  POSITION_ALERT_WEBHOOK_URL: z.string().url('POSITION_ALERT_WEBHOOK_URL must be a valid URL'),
  AGGREGATION_WINDOW_MS: z
    .string()
    .transform((val) => Number(val))
    .or(z.number())
    .default(10000),
  LISTEN_KEY_KEEP_ALIVE_MS: z
    .string()
    .transform((val) => Number(val))
    .or(z.number())
    .default(25 * 60 * 1000),
  LOG_LEVEL: z.string().default('info'),
  MAX_RETRY: z
    .string()
    .transform((val) => Number(val))
    .or(z.number())
    .default(3),
  POSITION_VALIDATION_INTERVAL_MS: z
    .string()
    .transform((val) => Number(val))
    .or(z.number())
    .default(30_000)
});

type ConfigSchema = z.infer<typeof configSchema>;

const parsed = configSchema.safeParse(process.env);

if (!parsed.success) {
  const errors = parsed.error.errors.map((err) => `${err.path.join('.')}: ${err.message}`);
  throw new Error(`Configuration validation failed:\n${errors.join('\n')}`);
}

const rawConfig = parsed.data;

export interface AppConfig {
  binanceApiKey: string;
  binanceApiSecret: string;
  binanceBaseUrl: string;
  binanceWsBaseUrl: string;
  feishuBot1WebhookUrl: string;
  feishuBot2WebhookUrl: string;
  positionAlertWebhookUrl: string;
  aggregationWindowMs: number;
  listenKeyKeepAliveMs: number;
  logLevel: string;
  maxRetry: number;
  positionValidationIntervalMs: number;
}

export const appConfig: AppConfig = {
  binanceApiKey: rawConfig.BINANCE_API_KEY,
  binanceApiSecret: rawConfig.BINANCE_API_SECRET,
  binanceBaseUrl: rawConfig.BINANCE_BASE_URL,
  binanceWsBaseUrl: rawConfig.BINANCE_WS_BASE_URL,
  feishuBot1WebhookUrl: rawConfig.FEISHU_BOT1_WEBHOOK_URL,
  feishuBot2WebhookUrl: rawConfig.FEISHU_BOT2_WEBHOOK_URL,
  positionAlertWebhookUrl: rawConfig.POSITION_ALERT_WEBHOOK_URL,
  aggregationWindowMs: Number(rawConfig.AGGREGATION_WINDOW_MS) || 10000,
  listenKeyKeepAliveMs: Number(rawConfig.LISTEN_KEY_KEEP_ALIVE_MS) || 25 * 60 * 1000,
  logLevel: rawConfig.LOG_LEVEL,
  maxRetry: Number(rawConfig.MAX_RETRY) || 3,
  positionValidationIntervalMs: Number(rawConfig.POSITION_VALIDATION_INTERVAL_MS) || 30_000
};
