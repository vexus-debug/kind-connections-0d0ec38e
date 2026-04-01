import type { BybitTickerResponse, BybitKlineResponse, Candle, Timeframe } from '@/types/scanner';
import { supabase } from '@/integrations/supabase/client';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

async function fetchJson<T>(path: string): Promise<T> {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/bybit-proxy`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_KEY,
    },
    body: JSON.stringify({ path }),
  });

  if (!res.ok) {
    throw new Error(`Edge function error: ${res.status}`);
  }

  return res.json();
}

export async function fetchTickers(category: 'spot' | 'linear'): Promise<BybitTickerResponse> {
  return fetchJson(`/v5/market/tickers?category=${category}`);
}

export async function fetchKlines(
  symbol: string,
  interval: Timeframe,
  category: 'spot' | 'linear',
  limit: number = 220
): Promise<Candle[]> {
  const data = await fetchJson<BybitKlineResponse>(
    `/v5/market/kline?category=${category}&symbol=${symbol}&interval=${interval}&limit=${limit}`
  );

  if (data.retCode !== 0 || !data.result?.list) return [];

  return data.result.list
    .map((k) => ({
      time: parseInt(k[0]),
      open: parseFloat(k[1]),
      high: parseFloat(k[2]),
      low: parseFloat(k[3]),
      close: parseFloat(k[4]),
      volume: parseFloat(k[5]),
    }))
    .reverse();
}

export async function fetchKlinesBatch(
  symbols: string[],
  interval: Timeframe,
  category: 'spot' | 'linear',
  batchSize: number = 5,
  delayMs: number = 200
): Promise<Map<string, Candle[]>> {
  const results = new Map<string, Candle[]>();

  for (let i = 0; i < symbols.length; i += batchSize) {
    const batch = symbols.slice(i, i + batchSize);
    const promises = batch.map(async (symbol) => {
      try {
        const candles = await fetchKlines(symbol, interval, category);
        results.set(symbol, candles);
      } catch {
        // Skip failed symbols
      }
    });
    await Promise.all(promises);
    if (i + batchSize < symbols.length) {
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }

  return results;
}
