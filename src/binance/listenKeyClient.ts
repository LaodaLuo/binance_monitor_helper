import axios, { AxiosInstance } from 'axios';
import { appConfig } from '../config/index.js';
import { logger } from '../utils/logger.js';

export class ListenKeyClient {
  private readonly client: AxiosInstance;

  constructor(private readonly apiKey: string, baseURL: string) {
    this.client = axios.create({
      baseURL,
      headers: {
        'X-MBX-APIKEY': apiKey
      },
      timeout: 10000
    });
  }

  static createDefault(): ListenKeyClient {
    return new ListenKeyClient(appConfig.binanceApiKey, appConfig.binanceBaseUrl);
  }

  async create(): Promise<string> {
    const response = await this.client.post('/fapi/v1/listenKey');
    const listenKey = response.data?.listenKey;
    if (!listenKey) {
      throw new Error('Failed to obtain listenKey from Binance');
    }
    logger.info({ listenKey }, 'Obtained listenKey');
    return listenKey;
  }

  async keepAlive(listenKey: string): Promise<void> {
    await this.client.put('/fapi/v1/listenKey', null, {
      params: { listenKey }
    });
    logger.debug({ listenKey }, 'Refreshed listenKey');
  }

  async destroy(listenKey: string): Promise<void> {
    try {
      await this.client.delete('/fapi/v1/listenKey', {
        params: { listenKey }
      });
      logger.info({ listenKey }, 'Destroyed listenKey');
    } catch (error) {
      logger.warn({ listenKey, error }, 'Failed to destroy listenKey');
    }
  }
}
