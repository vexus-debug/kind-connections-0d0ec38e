const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface SRLevel {
  price: number;
  type: 'support' | 'resistance';
  touches: number;
  strength: number; // 0-100
  firstSeen: number;
  lastTouched: number;
}

interface SRSignal {
  symbol: string;
  price: number;
  change24h: number;
  timeframe: string;
  level: SRLevel;
  distance: number; // % distance from level
  approaching: 'from_above' | 'from_below';
  score: number; // 0-100 overall quality
}

const BYBIT_BASE = 'https://api.bybit.com';
const TIMEFRAMES = ['5', '15', '60', '240', 'D'] as const;
const TF_LABELS: Record<string, string> = { '5': '5m', '15': '15m', '60': '1H', '240': '4H', 'D': '1D' };
const KLINE_LIMITS: Record<string, number> = { '5': 200, '15': 200, '60': 200, '240': 200, 'D': 120 };

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Bybit ${res.status}`);
  return res.json();
}

async function getTopSymbols(limit = 80): Promise<{ symbol: string; price: number; change24h: number }[]> {
  const data = await fetchJson<any>(`${BYBIT_BASE}/v5/market/tickers?category=linear`);
  if (data.retCode !== 0) return [];
  return data.result.list
    .filter((t: any) => t.symbol.endsWith('USDT'))
    .sort((a: any, b: any) => parseFloat(b.turnover24h) - parseFloat(a.turnover24h))
    .slice(0, limit)
    .map((t: any) => ({
      symbol: t.symbol,
      price: parseFloat(t.lastPrice),
      change24h: parseFloat(t.price24hPcnt) * 100,
    }));
}

async function fetchKlines(symbol: string, interval: string, limit: number): Promise<Candle[]> {
  const data = await fetchJson<any>(
    `${BYBIT_BASE}/v5/market/kline?category=linear&symbol=${symbol}&interval=${interval}&limit=${limit}`
  );
  if (data.retCode !== 0 || !data.result?.list) return [];
  return data.result.list
    .map((k: string[]) => ({
      time: parseInt(k[0]),
      open: parseFloat(k[1]),
      high: parseFloat(k[2]),
      low: parseFloat(k[3]),
      close: parseFloat(k[4]),
      volume: parseFloat(k[5]),
    }))
    .reverse();
}

function findSwingPoints(candles: Candle[], lookback = 3): { highs: number[]; lows: number[] } {
  const highs: number[] = [];
  const lows: number[] = [];
  for (let i = lookback; i < candles.length - lookback; i++) {
    let isHigh = true, isLow = true;
    for (let j = 1; j <= lookback; j++) {
      if (candles[i].high <= candles[i - j].high || candles[i].high <= candles[i + j].high) isHigh = false;
      if (candles[i].low >= candles[i - j].low || candles[i].low >= candles[i + j].low) isLow = false;
    }
    if (isHigh) highs.push(candles[i].high);
    if (isLow) lows.push(candles[i].low);
  }
  return { highs, lows };
}

function clusterLevels(prices: number[], threshold: number): { price: number; count: number }[] {
  if (prices.length === 0) return [];
  const sorted = [...prices].sort((a, b) => a - b);
  const clusters: { prices: number[]; sum: number }[] = [];
  
  let current = { prices: [sorted[0]], sum: sorted[0] };
  for (let i = 1; i < sorted.length; i++) {
    const avg = current.sum / current.prices.length;
    if (Math.abs(sorted[i] - avg) / avg < threshold) {
      current.prices.push(sorted[i]);
      current.sum += sorted[i];
    } else {
      clusters.push(current);
      current = { prices: [sorted[i]], sum: sorted[i] };
    }
  }
  clusters.push(current);
  
  return clusters
    .filter(c => c.prices.length >= 2)
    .map(c => ({ price: c.sum / c.prices.length, count: c.prices.length }));
}

function detectSRLevels(candles: Candle[]): SRLevel[] {
  if (candles.length < 20) return [];
  
  const { highs, lows } = findSwingPoints(candles, 3);
  const lastPrice = candles[candles.length - 1].close;
  
  // Cluster swing highs for resistance, swing lows for support
  const resistanceClusters = clusterLevels(highs, 0.008);
  const supportClusters = clusterLevels(lows, 0.008);
  
  const levels: SRLevel[] = [];
  
  for (const c of resistanceClusters) {
    // Count how many candles touched this level (wick within 0.3%)
    let touches = 0;
    let firstSeen = candles.length;
    let lastTouched = 0;
    for (let i = 0; i < candles.length; i++) {
      if (Math.abs(candles[i].high - c.price) / c.price < 0.003) {
        touches++;
        if (i < firstSeen) firstSeen = i;
        if (i > lastTouched) lastTouched = i;
      }
    }
    const recency = lastTouched / candles.length; // 0-1, higher = more recent
    const strength = Math.min(100, touches * 15 + c.count * 10 + recency * 20);
    
    if (c.price > lastPrice) {
      levels.push({
        price: c.price,
        type: 'resistance',
        touches: Math.max(touches, c.count),
        strength,
        firstSeen: candles[Math.max(0, firstSeen)]?.time ?? 0,
        lastTouched: candles[Math.min(candles.length - 1, lastTouched)]?.time ?? 0,
      });
    }
  }
  
  for (const c of supportClusters) {
    let touches = 0;
    let firstSeen = candles.length;
    let lastTouched = 0;
    for (let i = 0; i < candles.length; i++) {
      if (Math.abs(candles[i].low - c.price) / c.price < 0.003) {
        touches++;
        if (i < firstSeen) firstSeen = i;
        if (i > lastTouched) lastTouched = i;
      }
    }
    const recency = lastTouched / candles.length;
    const strength = Math.min(100, touches * 15 + c.count * 10 + recency * 20);
    
    if (c.price < lastPrice) {
      levels.push({
        price: c.price,
        type: 'support',
        touches: Math.max(touches, c.count),
        strength,
        firstSeen: candles[Math.max(0, firstSeen)]?.time ?? 0,
        lastTouched: candles[Math.min(candles.length - 1, lastTouched)]?.time ?? 0,
      });
    }
  }
  
  return levels.sort((a, b) => b.strength - a.strength);
}

function findNearestSR(candles: Candle[], levels: SRLevel[], maxDist = 0.03): SRSignal | null {
  if (levels.length === 0 || candles.length === 0) return null;
  const last = candles[candles.length - 1];
  const price = last.close;
  
  let best: { level: SRLevel; dist: number } | null = null;
  for (const lvl of levels) {
    const dist = Math.abs(price - lvl.price) / price;
    if (dist <= maxDist && (!best || dist < best.dist || (dist === best.dist && lvl.strength > best.level.strength))) {
      best = { level: lvl, dist };
    }
  }
  if (!best) return null;
  
  const approaching = price > best.level.price ? 'from_above' : 'from_below';
  // Score: closer = higher, stronger level = higher
  const proximityScore = Math.max(0, 100 - (best.dist / maxDist) * 100);
  const score = Math.round(proximityScore * 0.6 + best.level.strength * 0.4);
  
  return {
    symbol: '',
    price,
    change24h: 0,
    timeframe: '',
    level: best.level,
    distance: Math.round(best.dist * 10000) / 100, // percentage
    approaching,
    score,
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  
  try {
    const symbols = await getTopSymbols(80);
    const allSignals: SRSignal[] = [];
    
    // Process in batches of 5
    for (let i = 0; i < symbols.length; i += 5) {
      const batch = symbols.slice(i, i + 5);
      const promises = batch.flatMap(({ symbol, price, change24h }) =>
        TIMEFRAMES.map(async (tf) => {
          try {
            const candles = await fetchKlines(symbol, tf, KLINE_LIMITS[tf]);
            if (candles.length < 20) return;
            const levels = detectSRLevels(candles);
            // Only nearest strong level within 2%
            const signal = findNearestSR(candles, levels, 0.02);
            if (signal && signal.score >= 40) {
              signal.symbol = symbol;
              signal.change24h = change24h;
              signal.timeframe = TF_LABELS[tf] || tf;
              allSignals.push(signal);
            }
          } catch { /* skip */ }
        })
      );
      await Promise.all(promises);
      if (i + 5 < symbols.length) await new Promise(r => setTimeout(r, 150));
    }
    
    // Sort by score desc
    allSignals.sort((a, b) => b.score - a.score);
    
    return new Response(JSON.stringify({ signals: allSignals, scannedAt: Date.now() }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
