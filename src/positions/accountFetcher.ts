import axios, { AxiosInstance } from 'axios';
import { createHmac } from 'node:crypto';
import { URLSearchParams } from 'node:url';
import { appConfig } from '../config/index.js';
import { normalizeBaseAssetId } from '../config/positionRules.js';
import type { AccountContext, PositionDirection, PositionSnapshot } from './types.js';

interface AccountResponse {
  totalInitialMargin: string;
  totalMarginBalance: string;
  availableBalance: string;
}

interface PositionRiskResponse {
  symbol: string;
  positionAmt: string;
  notional: string;
  leverage: string;
  initialMargin: string;
  isolatedMargin: string;
  marginType: 'cross' | 'isolated' | string;
  positionSide: 'LONG' | 'SHORT' | 'BOTH';
  markPrice: string;
  marginAsset: string;
}

interface PremiumIndexResponse {
  symbol: string;
  predictedFundingRate?: string;
}

interface BinanceAccountFetcherOptions {
  baseURL?: string;
  apiKey?: string;
  apiSecret?: string;
  recvWindow?: number;
  timeoutMs?: number;
}

const DEFAULT_RECV_WINDOW = 5000;

function toNumber(value: string | number | undefined): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isNaN(parsed) ? 0 : parsed;
  }
  return 0;
}

function resolveDirection(positionAmt: number, positionSide: PositionRiskResponse['positionSide']): PositionDirection | null {
  if (positionSide === 'LONG') return 'long';
  if (positionSide === 'SHORT') return 'short';
  if (positionAmt > 0) return 'long';
  if (positionAmt < 0) return 'short';
  return null;
}

function deriveBaseAsset(symbol: string, marginAsset: string): string {
  const normalizedMargin = marginAsset?.toUpperCase() ?? '';
  if (normalizedMargin && symbol.toUpperCase().endsWith(normalizedMargin)) {
    return normalizeBaseAssetId(symbol.slice(0, symbol.length - normalizedMargin.length));
  }
  return normalizeBaseAssetId(symbol);
}

export class BinanceAccountFetcher {
  private readonly client: AxiosInstance;
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly apiSecret: string;
  private readonly recvWindow: number;

  constructor(options?: BinanceAccountFetcherOptions) {
    this.baseUrl = options?.baseURL ?? appConfig.binanceBaseUrl;
    this.apiKey = options?.apiKey ?? appConfig.binanceApiKey;
    this.apiSecret = options?.apiSecret ?? appConfig.binanceApiSecret;
    this.recvWindow = options?.recvWindow ?? DEFAULT_RECV_WINDOW;

    this.client = axios.create({
      baseURL: this.baseUrl,
      headers: {
        'X-MBX-APIKEY': this.apiKey
      },
      timeout: options?.timeoutMs ?? 15000
    });
  }

  private createSignature(params: URLSearchParams): string {
    return createHmac('sha256', this.apiSecret).update(params.toString()).digest('hex');
  }

  private async signedGet<T>(path: string, params: Record<string, string | number | undefined> = {}): Promise<T> {
    const searchParams = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value === undefined) return;
      searchParams.set(key, String(value));
    });
    searchParams.set('timestamp', Date.now().toString());
    searchParams.set('recvWindow', String(this.recvWindow));
    const signature = this.createSignature(searchParams);
    searchParams.set('signature', signature);

    const url = `${path}?${searchParams.toString()}`;
    const { data } = await this.client.get<T>(url);
    return data;
  }

  private async publicGet<T>(path: string): Promise<T> {
    const { data } = await this.client.get<T>(path);
    return data;
  }

  private buildSnapshot(
    position: PositionRiskResponse,
    predictedFundingRate: number | null,
    fetchedAt: number
  ): PositionSnapshot | null {
    const positionAmt = toNumber(position.positionAmt);
    const direction = resolveDirection(positionAmt, position.positionSide);
    if (!direction) {
      return null;
    }

    const notional = Math.abs(toNumber(position.notional));
    if (notional === 0 && positionAmt === 0) {
      return null;
    }

    const initialMargin = Math.abs(toNumber(position.initialMargin));
    const isolatedMargin = Math.abs(toNumber(position.isolatedMargin));
    const leverage = Math.abs(toNumber(position.leverage));
    const markPrice = Math.abs(toNumber(position.markPrice));
    const baseAsset = deriveBaseAsset(position.symbol, position.marginAsset);
    const marginType = position.marginType === 'isolated' ? 'isolated' : 'cross';

    return {
      baseAsset,
      symbol: position.symbol,
      positionAmt,
      notional,
      leverage,
      initialMargin,
      isolatedMargin,
      marginType,
      direction,
      markPrice,
      predictedFundingRate,
      updatedAt: fetchedAt
    };
  }

  async fetchAccountContext(): Promise<AccountContext> {
    const fetchedAt = Date.now();
    const [account, positions, premiumIndex] = await Promise.all([
      this.signedGet<AccountResponse>('/fapi/v2/account'),
      this.signedGet<PositionRiskResponse[]>('/fapi/v2/positionRisk'),
      this.publicGet<PremiumIndexResponse[]>('/fapi/v1/premiumIndex')
    ]);

    const predictedFundingMap = new Map<string, number | null>(
      premiumIndex.map((item) => [item.symbol, item.predictedFundingRate ? Number(item.predictedFundingRate) : null])
    );

    const snapshots: PositionSnapshot[] = [];
    for (const position of positions) {
      const snapshot = this.buildSnapshot(position, predictedFundingMap.get(position.symbol) ?? null, fetchedAt);
      if (snapshot) {
        snapshots.push(snapshot);
      }
    }

    return {
      totalInitialMargin: Math.max(0, toNumber(account.totalInitialMargin)),
      totalMarginBalance: Math.max(0, toNumber(account.totalMarginBalance)),
      availableBalance: Math.max(0, toNumber(account.availableBalance)),
      snapshots,
      fetchedAt
    };
  }
}
