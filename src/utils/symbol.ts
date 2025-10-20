const KNOWN_QUOTE_ASSETS = [
  'USDT',
  'BUSD',
  'USDC',
  'TUSD',
  'FDUSD',
  'USDP',
  'DAI',
  'BIDR',
  'BRL',
  'EUR',
  'GBP',
  'AUD',
  'CAD',
  'JPY',
  'RUB',
  'TRY',
  'UAH',
  'NGN',
  'CZK',
  'CHF',
  'ZAR',
  'SEK',
  'NOK',
  'DKK',
  'ARS',
  'MXN',
  'COP',
  'CLP',
  'PEN',
  'KRW',
  'IDR',
  'VND',
  'THB',
  'HKD',
  'SGD',
  'PHP',
  'INR',
  'BTC',
  'ETH',
  'BNB'
];

export function resolveSymbolParts(symbol: string): { base: string; quote: string } {
  const normalized = symbol.trim().toUpperCase();
  for (const quote of KNOWN_QUOTE_ASSETS) {
    if (normalized.endsWith(quote)) {
      return {
        base: normalized.slice(0, normalized.length - quote.length),
        quote
      };
    }
  }
  return {
    base: normalized,
    quote: ''
  };
}

export function resolveQuoteAsset(symbol: string): string {
  return resolveSymbolParts(symbol).quote;
}
