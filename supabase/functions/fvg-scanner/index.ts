const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface FvgSignal {
  symbol: string;
  price: number;
  change24h: number;
  turnover24h: number;
  timeframe: string;
  direction: 'bull' | 'bear';
  score: number;
  signalType: 'fvg' | 'impulse' | 'imbalance';
  candleIndex: number;
  fvg?: { gapHigh: number; gapLow: number; gapSize: number; gapPct: number };
  impulse?: { bodyPct: number; rangeAtr: number; volumeRatio: number };
  extension: {
    emaDist9: number;       // % distance from EMA9
    emaDist21: number;      // % distance from EMA21
    consecutiveBars: number; // consecutive bars in same direction
    volumeDecline: boolean; // volume declining over last 3 bars
    rsiExtreme: boolean;    // RSI > 80 or < 20
    extensionLevel: 'normal' | 'extended' | 'overextended' | 'exhaustion';
  };
  confirmation: {
    atr: number;
    atrRatio: number;
    bodyToRange: number;
    volumeRatio: number;
    rsi: number;
    emaAligned: boolean;
    candlesAgo: number;
  };
  timestamp: number;
}

// ─── Indicators ───

function ema(data: number[], period: number): number[] {
  const k = 2 / (period + 1);
  const result: number[] = [data[0]];
  for (let i = 1; i < data.length; i++) {
    result.push(data[i] * k + result[i - 1] * (1 - k));
  }
  return result;
}

function calcATR(candles: Candle[], period = 14): number[] {
  const tr = candles.map((c, i) => {
    if (i === 0) return c.high - c.low;
    const pc = candles[i - 1].close;
    return Math.max(c.high - c.low, Math.abs(c.high - pc), Math.abs(c.low - pc));
  });
  return ema(tr, period);
}

function calcRSI(closes: number[], period = 14): number[] {
  const rsi: number[] = new Array(closes.length).fill(50);
  if (closes.length < period + 1) return rsi;
  let avgGain = 0, avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) avgGain += diff; else avgLoss -= diff;
  }
  avgGain /= period; avgLoss /= period;
  rsi[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    avgGain = (avgGain * (period - 1) + (diff > 0 ? diff : 0)) / period;
    avgLoss = (avgLoss * (period - 1) + (diff < 0 ? -diff : 0)) / period;
    rsi[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return rsi;
}

// ─── FVG & Impulse Detection ───

function calcExtension(
  candles: Candle[],
  i: number,
  direction: 'bull' | 'bear',
  ema9: number[],
  ema21: number[],
  rsi: number,
): FvgSignal['extension'] {
  const close = candles[i].close;
  const emaDist9 = ema9[i] > 0 ? ((close - ema9[i]) / ema9[i]) * 100 : 0;
  const emaDist21 = ema21[i] > 0 ? ((close - ema21[i]) / ema21[i]) * 100 : 0;

  // Count consecutive bars in same direction
  let consecutiveBars = 0;
  for (let j = i; j >= 1; j--) {
    const isBull = candles[j].close > candles[j].open;
    if ((direction === 'bull' && isBull) || (direction === 'bear' && !isBull)) {
      consecutiveBars++;
    } else break;
  }

  // Volume decline: check if volume is declining over last 3 bars
  let volumeDecline = false;
  if (i >= 2) {
    volumeDecline = candles[i].volume < candles[i - 1].volume && candles[i - 1].volume < candles[i - 2].volume;
  }

  const rsiExtreme = rsi > 80 || rsi < 20;
  const absEmaDist = Math.abs(emaDist21);

  let extensionLevel: FvgSignal['extension']['extensionLevel'] = 'normal';
  if (volumeDecline && rsiExtreme && (consecutiveBars >= 5 || absEmaDist > 8)) {
    extensionLevel = 'exhaustion';
  } else if (absEmaDist > 6 || consecutiveBars >= 6 || (rsiExtreme && absEmaDist > 4)) {
    extensionLevel = 'overextended';
  } else if (absEmaDist > 3 || consecutiveBars >= 4) {
    extensionLevel = 'extended';
  }

  return {
    emaDist9: Math.round(emaDist9 * 100) / 100,
    emaDist21: Math.round(emaDist21 * 100) / 100,
    consecutiveBars,
    volumeDecline,
    rsiExtreme,
    extensionLevel,
  };
}

function detectFvgSignals(
  candles: Candle[],
  timeframe: string,
): Omit<FvgSignal, 'symbol' | 'price' | 'change24h' | 'turnover24h'>[] {
  if (candles.length < 50) return [];

  const closes = candles.map(c => c.close);
  const len = candles.length;
  const atrArr = calcATR(candles, 14);
  const rsiArr = calcRSI(closes, 14);
  const ema9 = ema(closes, 9);
  const ema21 = ema(closes, 21);

  // Calculate average ATR over last 20 bars for ratio comparison
  const avgAtrSlice = atrArr.slice(Math.max(0, len - 25), len - 5);
  const avgAtr = avgAtrSlice.length > 0 ? avgAtrSlice.reduce((a, b) => a + b, 0) / avgAtrSlice.length : 1;

  const signals: Omit<FvgSignal, 'symbol' | 'price' | 'change24h' | 'turnover24h'>[] = [];

  // Scan only the most current candle (last closed + current)
  const scanStart = Math.max(2, len - 3);

  for (let i = scanStart; i < len - 1; i++) {
    const c0 = candles[i - 1]; // candle before gap
    const c1 = candles[i];     // middle candle (the impulse)
    const c2 = candles[i + 1]; // candle after gap

    const curAtr = atrArr[i] ?? 0;
    const atrRatio = avgAtr > 0 ? curAtr / avgAtr : 1;

    // ATR must be elevated — filter weak moves
    if (atrRatio < 1.3) continue;

    // Volume analysis
    const volumes = candles.map(c => c.volume);
    const volSlice = volumes.slice(Math.max(0, i - 20), i);
    const avgVol = volSlice.length > 0 ? volSlice.reduce((a, b) => a + b, 0) / volSlice.length : 1;
    const volumeRatio = avgVol > 0 ? c1.volume / avgVol : 1;

    // Body analysis of impulse candle
    const body = Math.abs(c1.close - c1.open);
    const range = c1.high - c1.low;
    const bodyToRange = range > 0 ? body / range : 0;
    const isBullCandle = c1.close > c1.open;
    const direction: 'bull' | 'bear' = isBullCandle ? 'bull' : 'bear';

    // EMA alignment
    const emaAligned = direction === 'bull'
      ? ema9[i] > ema21[i]
      : ema9[i] < ema21[i];

    const candlesAgo = len - 1 - i;
    const rsi = rsiArr[i] ?? 50;

    const extension = calcExtension(candles, i, direction, ema9, ema21, rsi);

    const baseConfirmation = {
      atr: Math.round(curAtr * 1e6) / 1e6,
      atrRatio: Math.round(atrRatio * 100) / 100,
      bodyToRange: Math.round(bodyToRange * 100) / 100,
      volumeRatio: Math.round(volumeRatio * 100) / 100,
      rsi: Math.round(rsi * 100) / 100,
      emaAligned,
      candlesAgo,
    };

    // ── 1. Fair Value Gap detection ──
    if (i + 1 < len) {
      // Bullish FVG: c2.low > c0.high (gap up)
      if (c2.low > c0.high) {
        const gapSize = c2.low - c0.high;
        const gapPct = c0.high > 0 ? (gapSize / c0.high) * 100 : 0;
        // Only significant gaps (> 0.3% of price AND > 0.5x ATR)
        if (gapPct > 0.3 && gapSize > curAtr * 0.5) {
          let score = calcFvgScore(gapPct, atrRatio, volumeRatio, bodyToRange, emaAligned, true, rsi);
          if (score >= 40) {
            signals.push({
              timeframe, direction: 'bull', score, signalType: 'fvg',
              candleIndex: i,
              fvg: { gapHigh: c2.low, gapLow: c0.high, gapSize: Math.round(gapSize * 1e6) / 1e6, gapPct: Math.round(gapPct * 100) / 100 },
              extension,
              confirmation: baseConfirmation,
              timestamp: Date.now(),
            });
          }
        }
      }

      // Bearish FVG: c2.high < c0.low (gap down)
      if (c2.high < c0.low) {
        const gapSize = c0.low - c2.high;
        const gapPct = c0.low > 0 ? (gapSize / c0.low) * 100 : 0;
        if (gapPct > 0.3 && gapSize > curAtr * 0.5) {
          let score = calcFvgScore(gapPct, atrRatio, volumeRatio, bodyToRange, emaAligned, false, rsi);
          if (score >= 40) {
            signals.push({
              timeframe, direction: 'bear', score, signalType: 'fvg',
              candleIndex: i,
              fvg: { gapHigh: c0.low, gapLow: c2.high, gapSize: Math.round(gapSize * 1e6) / 1e6, gapPct: Math.round(gapPct * 100) / 100 },
              extension,
              confirmation: baseConfirmation,
              timestamp: Date.now(),
            });
          }
        }
      }
    }

    // ── 2. Huge impulse candle detection ──
    // Body > 70% of range, range > 2x ATR, high volume
    const rangeVsAtr = curAtr > 0 ? range / curAtr : 0;
    if (bodyToRange > 0.65 && rangeVsAtr > 2.0 && volumeRatio > 1.5) {
      let score = calcImpulseScore(rangeVsAtr, bodyToRange, volumeRatio, atrRatio, emaAligned, direction === 'bull', rsi);
      if (score >= 40) {
        signals.push({
          timeframe, direction, score, signalType: 'impulse',
          candleIndex: i,
          impulse: {
            bodyPct: Math.round(bodyToRange * 100),
            rangeAtr: Math.round(rangeVsAtr * 100) / 100,
            volumeRatio: Math.round(volumeRatio * 100) / 100,
          },
          extension,
          confirmation: baseConfirmation,
          timestamp: Date.now(),
        });
      }
    }

    // ── 3. Imbalance candle (huge candle with wicks < 15% each side) ──
    if (range > 0) {
      const upperWick = isBullCandle ? (c1.high - c1.close) / range : (c1.high - c1.open) / range;
      const lowerWick = isBullCandle ? (c1.open - c1.low) / range : (c1.close - c1.low) / range;
      if (upperWick < 0.15 && lowerWick < 0.15 && rangeVsAtr > 1.8 && volumeRatio > 1.3) {
        let score = calcImbalanceScore(rangeVsAtr, upperWick, lowerWick, volumeRatio, atrRatio, emaAligned, direction === 'bull', rsi);
        // Avoid duplicating with impulse
        const alreadyHasImpulse = signals.some(s => s.candleIndex === i && s.signalType === 'impulse' && s.timeframe === timeframe);
        if (score >= 40 && !alreadyHasImpulse) {
          signals.push({
            timeframe, direction, score, signalType: 'imbalance',
            candleIndex: i,
            impulse: {
              bodyPct: Math.round(bodyToRange * 100),
              rangeAtr: Math.round(rangeVsAtr * 100) / 100,
              volumeRatio: Math.round(volumeRatio * 100) / 100,
            },
            extension,
            confirmation: baseConfirmation,
            timestamp: Date.now(),
          });
        }
      }
    }
  }

  return signals;
}

function calcFvgScore(gapPct: number, atrRatio: number, volRatio: number, bodyRatio: number, emaAligned: boolean, isBull: boolean, rsi: number): number {
  let score = 0;
  // Gap size (max 30)
  if (gapPct > 2.0) score += 30;
  else if (gapPct > 1.0) score += 22;
  else if (gapPct > 0.5) score += 15;
  else score += 8;

  // ATR ratio (max 20)
  if (atrRatio > 2.5) score += 20;
  else if (atrRatio > 1.8) score += 15;
  else if (atrRatio > 1.3) score += 10;

  // Volume (max 20)
  if (volRatio > 3.0) score += 20;
  else if (volRatio > 2.0) score += 15;
  else if (volRatio > 1.5) score += 10;
  else score += 5;

  // Body quality (max 15)
  if (bodyRatio > 0.8) score += 15;
  else if (bodyRatio > 0.6) score += 10;
  else score += 5;

  // EMA alignment (max 10)
  if (emaAligned) score += 10;

  // RSI confirmation (max 5)
  if (isBull && rsi > 50 && rsi < 80) score += 5;
  if (!isBull && rsi < 50 && rsi > 20) score += 5;

  return Math.min(score, 100);
}

function calcImpulseScore(rangeAtr: number, bodyRatio: number, volRatio: number, atrRatio: number, emaAligned: boolean, isBull: boolean, rsi: number): number {
  let score = 0;
  // Range vs ATR (max 30)
  if (rangeAtr > 4.0) score += 30;
  else if (rangeAtr > 3.0) score += 22;
  else if (rangeAtr > 2.0) score += 15;

  // Body dominance (max 20)
  if (bodyRatio > 0.85) score += 20;
  else if (bodyRatio > 0.75) score += 15;
  else if (bodyRatio > 0.65) score += 10;

  // Volume (max 20)
  if (volRatio > 3.0) score += 20;
  else if (volRatio > 2.0) score += 15;
  else if (volRatio > 1.5) score += 10;

  // ATR expansion (max 15)
  if (atrRatio > 2.5) score += 15;
  else if (atrRatio > 1.8) score += 10;
  else if (atrRatio > 1.3) score += 5;

  // EMA + RSI (max 15)
  if (emaAligned) score += 10;
  if (isBull && rsi > 55) score += 5;
  if (!isBull && rsi < 45) score += 5;

  return Math.min(score, 100);
}

function calcImbalanceScore(rangeAtr: number, upperWick: number, lowerWick: number, volRatio: number, atrRatio: number, emaAligned: boolean, isBull: boolean, rsi: number): number {
  let score = 0;
  // Range vs ATR (max 25)
  if (rangeAtr > 3.5) score += 25;
  else if (rangeAtr > 2.5) score += 18;
  else if (rangeAtr > 1.8) score += 12;

  // Wick quality — smaller = more impulsive (max 25)
  const totalWick = upperWick + lowerWick;
  if (totalWick < 0.1) score += 25;
  else if (totalWick < 0.2) score += 18;
  else if (totalWick < 0.3) score += 12;

  // Volume (max 20)
  if (volRatio > 3.0) score += 20;
  else if (volRatio > 2.0) score += 15;
  else if (volRatio > 1.3) score += 8;

  // ATR expansion (max 15)
  if (atrRatio > 2.0) score += 15;
  else if (atrRatio > 1.5) score += 10;
  else score += 5;

  // EMA + RSI (max 15)
  if (emaAligned) score += 10;
  if (isBull && rsi > 55) score += 5;
  if (!isBull && rsi < 45) score += 5;

  return Math.min(score, 100);
}

// ─── Bybit API ───

async function fetchTickers(): Promise<Array<{
  symbol: string; lastPrice: number; price24hPcnt: number; turnover24h: number;
}>> {
  const res = await fetch('https://api.bybit.com/v5/market/tickers?category=linear');
  const data = await res.json();
  if (data.retCode !== 0) return [];
  return data.result.list
    .filter((t: any) => t.symbol.endsWith('USDT'))
    .map((t: any) => ({
      symbol: t.symbol,
      lastPrice: parseFloat(t.lastPrice),
      price24hPcnt: parseFloat(t.price24hPcnt) * 100,
      turnover24h: parseFloat(t.turnover24h),
    }))
    .filter((t: any) => t.turnover24h > 5_000_000)
    .sort((a: any, b: any) => b.turnover24h - a.turnover24h)
    .slice(0, 100);
}

async function fetchKlines(symbol: string, interval: string, limit = 150): Promise<Candle[]> {
  const res = await fetch(`https://api.bybit.com/v5/market/kline?category=linear&symbol=${symbol}&interval=${interval}&limit=${limit}`);
  const data = await res.json();
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

// ─── Main handler ───

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const tickers = await fetchTickers();
    const timeframes = ['60', '240', 'D']; // 1H, 4H, Daily
    const allSignals: FvgSignal[] = [];
    const batchSize = 8;

    for (let i = 0; i < tickers.length; i += batchSize) {
      const batch = tickers.slice(i, i + batchSize);
      const promises = batch.flatMap(ticker =>
        timeframes.map(async (tf) => {
          try {
            const candles = await fetchKlines(ticker.symbol, tf, 150);
            const results = detectFvgSignals(candles, tf);
            for (const r of results) {
              allSignals.push({
                ...r,
                symbol: ticker.symbol,
                price: ticker.lastPrice,
                change24h: ticker.price24hPcnt,
                turnover24h: ticker.turnover24h,
              });
            }
          } catch { /* skip */ }
        })
      );
      await Promise.all(promises);
      if (i + batchSize < tickers.length) await new Promise(r => setTimeout(r, 100));
    }

    allSignals.sort((a, b) => b.score - a.score);

    return new Response(JSON.stringify({
      signals: allSignals,
      scannedAt: new Date().toISOString(),
      totalScanned: tickers.length,
      totalTimeframes: timeframes.length,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
