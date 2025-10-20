import pRetry from 'p-retry';
import { appConfig } from '../config/index.js';
import { ListenKeyClient } from '../binance/listenKeyClient.js';
import { StreamClient } from '../binance/streamClient.js';
import { buildFeishuCard } from '../notifications/cardBuilder.js';
import { FeishuNotifier } from '../notifications/notifier.js';
import { OrderAggregator } from '../orders/aggregator.js';
import { parseRawOrderTradeUpdate, toOrderEvent } from '../orders/eventMapper.js';
import { logger } from '../utils/logger.js';

const listenKeyClient = ListenKeyClient.createDefault();
const streamClient = new StreamClient();
const aggregator = new OrderAggregator();
const notifier = new FeishuNotifier();

let listenKey: string;
let keepAliveTimer: NodeJS.Timeout | undefined;

aggregator.onNotify(async (notification) => {
  const card = buildFeishuCard(notification);
  await notifier.send(card);
});

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
    logger.debug({event}, 'Event emit');
    aggregator
      .handleEvent(event)
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
    logger.info('Binance order monitoring service started');
  } catch (error) {
    logger.error({ error }, 'Failed to start monitoring service');
    process.exitCode = 1;
  }
}

function setupGracefulShutdown(): void {
  const shutdown = async (signal: NodeJS.Signals) => {
    logger.info({ signal }, 'Shutting down service');
    if (keepAliveTimer) {
      clearInterval(keepAliveTimer);
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
