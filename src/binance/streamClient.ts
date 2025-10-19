import EventEmitter from 'events';
import WebSocket from 'ws';
import { appConfig } from '../config/index.js';
import { logger } from '../utils/logger.js';

export interface StreamClientEvents {
  message: (payload: unknown) => void;
  listenKeyExpired: () => void;
  error: (error: Error) => void;
  closed: () => void;
}

type EventKeys = keyof StreamClientEvents;

export class StreamClient extends EventEmitter {
  private ws?: WebSocket;
  private listenKey?: string;
  private reconnectAttempts = 0;
  private manualClose = false;

  constructor(private readonly baseUrl = appConfig.binanceWsBaseUrl) {
    super();
  }

  connect(listenKey: string): void {
    this.listenKey = listenKey;
    const url = `${this.baseUrl}/${listenKey}`;
    logger.info({ url }, 'Connecting to Binance user data stream');
    this.ws = new WebSocket(url);
    this.manualClose = false;

    this.ws.on('open', () => {
      this.reconnectAttempts = 0;
      logger.info('WebSocket connection established');
    });

    this.ws.on('message', (data) => {
      try {
        const text = data.toString();
        const payload = JSON.parse(text);
        if (payload?.e === 'listenKeyExpired') {
          logger.warn('Received listenKeyExpired event');
          this.emitEvent('listenKeyExpired');
          return;
        }
        this.emitEvent('message', payload);
      } catch (error) {
        logger.error({ error }, 'Failed to parse WebSocket message');
      }
    });

    this.ws.on('error', (error) => {
      logger.error({ error }, 'WebSocket error');
      this.emitEvent('error', error);
    });

    this.ws.on('close', (code, reason) => {
      logger.warn({ code, reason: reason.toString() }, 'WebSocket closed');
      this.emitEvent('closed');
      if (!this.manualClose) {
        this.scheduleReconnect();
      }
    });
  }

  close(): void {
    this.manualClose = true;
    this.ws?.close();
  }

  private scheduleReconnect(): void {
    if (!this.listenKey) return;
    const delay = Math.min(2 ** this.reconnectAttempts * 1000, 30000);
    this.reconnectAttempts += 1;
    logger.info({ delay }, 'Scheduling WebSocket reconnect');
    setTimeout(() => {
      if (this.listenKey) {
        this.connect(this.listenKey);
      }
    }, delay);
  }

  private emitEvent<T extends EventKeys>(event: T, ...args: Parameters<StreamClientEvents[T]>): void {
    this.emit(event, ...args);
  }
}
