import { supabase } from '@/integrations/supabase/client';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

export interface FundingRate {
  symbol: string;
  fundingRate: number;
  nextFundingTime: number;
  predictedRate: number;
}

export interface OpenInterest {
  symbol: string;
  openInterest: number;
  openInterestValue: number;
}

async function fetchBybitEndpoint<T>(path: string): Promise<T> {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/bybit-proxy`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_KEY,
    },
    body: JSON.stringify({ path }),
  });
  if (!res.ok) throw new Error(`Edge function error: ${res.status}`);
  return res.json();
}

export async function fetchFundingRates(symbols?: string[]): Promise<FundingRate[]> {
  try {
    const data = await fetchBybitEndpoint<any>('/v5/market/tickers?category=linear');
    if (data.retCode !== 0 || !data.result?.list) return [];

    let tickers = data.result.list.filter((t: any) => t.symbol.endsWith('USDT'));
    
    if (symbols && symbols.length > 0) {
      const set = new Set(symbols);
      tickers = tickers.filter((t: any) => set.has(t.symbol));
    }

    return tickers.map((t: any) => ({
      symbol: t.symbol,
      fundingRate: parseFloat(t.fundingRate || '0'),
      nextFundingTime: parseInt(t.nextFundingTime || '0'),
      predictedRate: parseFloat(t.predictedFundingRate || t.fundingRate || '0'),
    })).sort((a: FundingRate, b: FundingRate) => Math.abs(b.fundingRate) - Math.abs(a.fundingRate));
  } catch (err) {
    console.error('Failed to fetch funding rates:', err);
    return [];
  }
}

export async function fetchOpenInterest(symbol: string): Promise<OpenInterest | null> {
  try {
    const data = await fetchBybitEndpoint<any>(`/v5/market/open-interest?category=linear&symbol=${symbol}&intervalTime=5min&limit=1`);
    if (data.retCode !== 0 || !data.result?.list?.[0]) return null;

    const item = data.result.list[0];
    return {
      symbol,
      openInterest: parseFloat(item.openInterest),
      openInterestValue: parseFloat(item.openInterest) * parseFloat(item.openInterest), // approximate
    };
  } catch {
    return null;
  }
}

export function formatFundingRate(rate: number): string {
  return `${(rate * 100).toFixed(4)}%`;
}

export function getFundingRateColor(rate: number): string {
  if (rate > 0.001) return 'hsl(142 72% 45%)'; // very positive = bullish
  if (rate > 0.0001) return 'hsl(142 72% 45% / 0.6)';
  if (rate < -0.001) return 'hsl(0 72% 50%)';
  if (rate < -0.0001) return 'hsl(0 72% 50% / 0.6)';
  return 'hsl(0 0% 45%)';
}
