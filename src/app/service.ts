import pRetry from 'p-retry';
import { appConfig } from '../config/index.js';
import { ListenKeyClient } from '../binance/listenKeyClient.js';
import { StreamClient } from '../binance/streamClient.js';
import { FeishuNotifier } from '../notifications/notifier.js';
import { parseRawOrderTradeUpdate, toOrderEvent } from '../orders/eventMapper.js';
import { logger } from '../utils/logger.js';
import { PositionValidationService } from '../positions/positionValidationService.js';
import { OrderNotificationService } from '../orders/orderNotificationService.js';

const listenKeyClient = ListenKeyClient.createDefault();
const streamClient = new StreamClient();
const lifecycleNotifier = new FeishuNotifier({
  webhookUrl: appConfig.feishuBot1WebhookUrl
});
const fillNotifier = new FeishuNotifier({
  webhookUrl: appConfig.feishuBot2WebhookUrl
});
const orderNotificationService = new OrderNotificationService({
  lifecycleNotifier,
  fillNotifier
});
const positionValidationService = new PositionValidationService();

let listenKey: string;
let keepAliveTimer: NodeJS.Timeout | undefined;
let positionValidationTimer: NodeJS.Timeout | undefined;

async function initListenKey(): Promise<string> {
  return await pRetry(() => listenKeyClient.create(), {
    retries: 5,
    factor: 2,
    minTimeout: 1000,
    onFailedAttempt: (error) => {
      logger.warn({ attempt: error.attemptNumber, retriesLeft: error.retriesLeft }, 'listenKey create failed, retrying');
    }
  });
}

async function refreshListenKeyPeriodically(): Promise<void> {
  if (keepAliveTimer) {
    clearInterval(keepAliveTimer);
  }

  keepAliveTimer = setInterval(async () => {
    try {
      await listenKeyClient.keepAlive(listenKey);
    } catch (error) {
      logger.error({ error }, 'Failed to keep listenKey alive, reinitializing');
      await recreateStream();
    }
  }, appConfig.listenKeyKeepAliveMs);
}

async function recreateStream(): Promise<void> {
  streamClient.close();
  listenKey = await initListenKey();
  streamClient.connect(listenKey);
}

function registerStreamHandlers(): void {
  streamClient.on('message', (payload) => {
    const raw = parseRawOrderTradeUpdate(payload);
    if (!raw) return;
    const event = toOrderEvent(raw);
      logger.debug({ event }, 'Event emit');
      orderNotificationService
        .handle(event)
        .catch((error) => logger.error({ error }, 'Failed to process order event'));
  });

  streamClient.on('listenKeyExpired', () => {
    logger.warn('Listen key expired notification received');
    recreateStream().catch((error) => logger.error({ error }, 'Failed to recreate stream after expiration'));
  });

  streamClient.on('error', (error) => {
    logger.error({ error }, 'Stream client error');
  });

  streamClient.on('closed', () => {
    logger.warn('Stream closed');
  });
}

async function start(): Promise<void> {
  try {
    listenKey = await initListenKey();
    registerStreamHandlers();
    streamClient.connect(listenKey);
    await refreshListenKeyPeriodically();
    schedulePositionValidation();
    logger.info('Binance order monitoring service started');
  } catch (error) {
    logger.error({ error }, 'Failed to start monitoring service');
    process.exitCode = 1;
  }
}

function schedulePositionValidation(): void {
  const interval = positionValidationService.getIntervalMs();

  const execute = async () => {
    try {
      await positionValidationService.run();
    } catch (error) {
      logger.error({ error }, 'Position validation execution error');
    }
  };

  execute().catch((error) => logger.error({ error }, 'Initial position validation failed'));

  positionValidationTimer = setInterval(() => {
    void execute();
  }, interval);
}

function setupGracefulShutdown(): void {
  const shutdown = async (signal: NodeJS.Signals) => {
    logger.info({ signal }, 'Shutting down service');
    if (keepAliveTimer) {
      clearInterval(keepAliveTimer);
    }
    if (positionValidationTimer) {
      clearInterval(positionValidationTimer);
    }
    streamClient.close();
    if (listenKey) {
      await listenKeyClient.destroy(listenKey);
    }
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

setupGracefulShutdown();
start().catch((error) => {
  logger.error({ error }, 'Unhandled error in service start');
  process.exitCode = 1;
});
