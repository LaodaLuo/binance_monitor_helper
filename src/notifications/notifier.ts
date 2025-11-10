import axios, { AxiosInstance } from 'axios';
import pRetry from 'p-retry';
import { appConfig } from '../config/index.js';
import { logger } from '../utils/logger.js';
import type { CardPayload } from './types.js';

export class FeishuNotifier {
  private readonly client: AxiosInstance;
  private readonly maxRetry: number;

  constructor(options: { webhookUrl: string; maxRetry?: number }) {
    const webhookUrl = options.webhookUrl;
    this.maxRetry = options.maxRetry ?? appConfig.maxRetry;
    this.client = axios.create({
      baseURL: webhookUrl,
      headers: {
        'Content-Type': 'application/json'
      },
      timeout: 10000
    });
  }

  async send(card: CardPayload): Promise<void> {
    await pRetry(
      async (attempt) => {
        try {
          const response = await this.client.post('', card);
          if (response.status >= 200 && response.status < 300) {
            logger.info({ attempt }, 'Feishu notification sent');
            return;
          }
          throw new Error(`Unexpected status ${response.status}: ${JSON.stringify(response.data)}`);
        } catch (error) {
          const err = error as any;
          logger.warn(
            {
              attempt,
              error: err,
              response: err?.response?.data
            },
            'Feishu notification attempt failed'
          );
          throw error;
        }
      },
      {
        retries: this.maxRetry,
        factor: 2,
        minTimeout: 500,
        maxTimeout: 5000
      }
    );
  }
}
