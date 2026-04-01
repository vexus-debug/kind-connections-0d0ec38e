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

interface MomentumSignal {
  symbol: string;
  price: number;
  change24h: number;
  volume24h: number;
  turnover24h: number;
  timeframe: string;
  score: number;
  direction: 'bull' | 'bear';
  signals: {
    rsiBreakout: boolean;
    macdCross: boolean;
    volumeSpike: boolean;
    adxSurge: boolean;
    emaCrossover: boolean;
    priceAcceleration: boolean;
    stochMomentum: boolean;
    obvBreakout: boolean;
    squeezeFire: boolean;
    vwapBreak: boolean;
    // New signals
    momentumAcceleration: boolean;
    earlyMove: boolean;
    rangeBreakout: boolean;
    volatilityExpansion: boolean;
    consolidationBreakout: boolean;
    momentumIgnition: boolean;
    htfTrendAligned: boolean;
    highLiquidity: boolean;
  };
  details: {
    rsi: number;
    macd: number;
    macdSignal: number;
    macdHist: number;
    adx: number;
    volumeRatio: number;
    roc: number;
    stochK: number;
    stochD: number;
    ema9: number;
    ema21: number;
    ema50: number;
    atr: number;
    bbSqueeze: number;
    // New details
    rocAccel: number;
    rangePosition: number;
    atrExpansion: number;
    consolidationBars: number;
    htfTrend: string;
  };
  // New market data fields
  marketData?: {
    openInterest?: number;
    oiChange5m?: number;
    fundingRate?: number;
    predictedFunding?: number;
    fundingShift?: number;
    orderBookImbalance?: number;
    bidAskRatio?: number;
  };
  timestamp: number;
}

// ─── Indicator calculations ───

function ema(data: number[], period: number): number[] {
  const k = 2 / (period + 1);
  const result: number[] = [data[0]];
  for (let i = 1; i < data.length; i++) {
    result.push(data[i] * k + result[i - 1] * (1 - k));
  }
  return result;
}

function sma(data: number[], period: number): number[] {
  const result: number[] = [];
  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) { result.push(NaN); continue; }
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += data[j];
    result.push(sum / period);
  }
  return result;
}

function calcRSI(closes: number[], period = 14): number[] {
  const rsi: number[] = new Array(closes.length).fill(NaN);
  if (closes.length < period + 1) return rsi;
  let avgGain = 0, avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) avgGain += diff; else avgLoss -= diff;
  }
  avgGain /= period;
  avgLoss /= period;
  rsi[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    avgGain = (avgGain * (period - 1) + (diff > 0 ? diff : 0)) / period;
    avgLoss = (avgLoss * (period - 1) + (diff < 0 ? -diff : 0)) / period;
    rsi[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return rsi;
}

function calcMACD(closes: number[]): { macd: number[]; signal: number[]; hist: number[] } {
  const ema12 = ema(closes, 12);
  const ema26 = ema(closes, 26);
  const macdLine = ema12.map((v, i) => v - ema26[i]);
  const signalLine = ema(macdLine, 9);
  const hist = macdLine.map((v, i) => v - signalLine[i]);
  return { macd: macdLine, signal: signalLine, hist };
}

function calcADX(candles: Candle[], period = 14): number[] {
  const adx: number[] = new Array(candles.length).fill(NaN);
  if (candles.length < period * 2) return adx;
  const tr: number[] = [];
  const plusDM: number[] = [];
  const minusDM: number[] = [];
  for (let i = 0; i < candles.length; i++) {
    if (i === 0) { tr.push(candles[i].high - candles[i].low); plusDM.push(0); minusDM.push(0); continue; }
    const h = candles[i].high, l = candles[i].low, pc = candles[i - 1].close;
    tr.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
    const upMove = h - candles[i - 1].high;
    const downMove = candles[i - 1].low - l;
    plusDM.push(upMove > downMove && upMove > 0 ? upMove : 0);
    minusDM.push(downMove > upMove && downMove > 0 ? downMove : 0);
  }
  const smoothTR = ema(tr, period);
  const smoothPlusDM = ema(plusDM, period);
  const smoothMinusDM = ema(minusDM, period);
  const dx: number[] = [];
  for (let i = 0; i < candles.length; i++) {
    const pdi = smoothTR[i] ? (smoothPlusDM[i] / smoothTR[i]) * 100 : 0;
    const mdi = smoothTR[i] ? (smoothMinusDM[i] / smoothTR[i]) * 100 : 0;
    const sum = pdi + mdi;
    dx.push(sum === 0 ? 0 : (Math.abs(pdi - mdi) / sum) * 100);
  }
  const adxSmooth = ema(dx, period);
  for (let i = 0; i < candles.length; i++) {
    if (i >= period * 2) adx[i] = adxSmooth[i];
  }
  return adx;
}

function calcStochastic(candles: Candle[], kPeriod = 14, dPeriod = 3): { k: number[]; d: number[] } {
  const kArr: number[] = new Array(candles.length).fill(NaN);
  for (let i = kPeriod - 1; i < candles.length; i++) {
    let hh = -Infinity, ll = Infinity;
    for (let j = i - kPeriod + 1; j <= i; j++) {
      if (candles[j].high > hh) hh = candles[j].high;
      if (candles[j].low < ll) ll = candles[j].low;
    }
    const range = hh - ll;
    kArr[i] = range === 0 ? 50 : ((candles[i].close - ll) / range) * 100;
  }
  const dArr = sma(kArr.map(v => isNaN(v) ? 50 : v), dPeriod);
  return { k: kArr, d: dArr };
}

function calcATR(candles: Candle[], period = 14): number[] {
  const tr: number[] = candles.map((c, i) => {
    if (i === 0) return c.high - c.low;
    const pc = candles[i - 1].close;
    return Math.max(c.high - c.low, Math.abs(c.high - pc), Math.abs(c.low - pc));
  });
  return ema(tr, period);
}

function calcOBV(candles: Candle[]): number[] {
  const obv: number[] = [0];
  for (let i = 1; i < candles.length; i++) {
    if (candles[i].close > candles[i - 1].close) obv.push(obv[i - 1] + candles[i].volume);
    else if (candles[i].close < candles[i - 1].close) obv.push(obv[i - 1] - candles[i].volume);
    else obv.push(obv[i - 1]);
  }
  return obv;
}

function calcBBWidth(closes: number[], period = 20): number[] {
  const smaArr = sma(closes, period);
  const width: number[] = new Array(closes.length).fill(NaN);
  for (let i = period - 1; i < closes.length; i++) {
    let variance = 0;
    for (let j = i - period + 1; j <= i; j++) {
      variance += (closes[j] - smaArr[i]) ** 2;
    }
    const std = Math.sqrt(variance / period);
    width[i] = smaArr[i] !== 0 ? (4 * std) / smaArr[i] : 0;
  }
  return width;
}

// ─── New: Range / Consolidation detection ───

function detectRange(candles: Candle[], lookback: number): { inRange: boolean; rangeHigh: number; rangeLow: number; bars: number } {
  if (candles.length < lookback + 1) return { inRange: false, rangeHigh: 0, rangeLow: 0, bars: 0 };
  const slice = candles.slice(-lookback - 1, -1);
  let hh = -Infinity, ll = Infinity;
  for (const c of slice) {
    if (c.high > hh) hh = c.high;
    if (c.low < ll) ll = c.low;
  }
  const rangeWidth = hh - ll;
  const avgPrice = (hh + ll) / 2;
  const rangePct = avgPrice > 0 ? (rangeWidth / avgPrice) * 100 : 0;
  // Consider it a range if price moved less than 4% over the lookback
  const inRange = rangePct < 4;
  return { inRange, rangeHigh: hh, rangeLow: ll, bars: lookback };
}

function detectConsolidation(candles: Candle[], minBars = 10, maxBars = 60): { isConsolidating: boolean; bars: number; rangeHigh: number; rangeLow: number } {
  if (candles.length < minBars + 1) return { isConsolidating: false, bars: 0, rangeHigh: 0, rangeLow: 0 };
  
  // Walk backwards to find how many bars were in a tight range
  const closedCandles = candles.slice(0, -1);
  let bars = 0;
  let hh = closedCandles[closedCandles.length - 1].high;
  let ll = closedCandles[closedCandles.length - 1].low;
  
  for (let i = closedCandles.length - 2; i >= Math.max(0, closedCandles.length - maxBars); i--) {
    const testHigh = Math.max(hh, closedCandles[i].high);
    const testLow = Math.min(ll, closedCandles[i].low);
    const mid = (testHigh + testLow) / 2;
    const pct = mid > 0 ? ((testHigh - testLow) / mid) * 100 : 0;
    if (pct > 3.5) break; // Range too wide
    hh = testHigh;
    ll = testLow;
    bars++;
  }
  
  return { isConsolidating: bars >= minBars, bars, rangeHigh: hh, rangeLow: ll };
}

// ─── New: HTF trend check using simple EMA alignment ───

function checkHTFTrend(candles: Candle[]): 'bull' | 'bear' | 'neutral' {
  if (candles.length < 55) return 'neutral';
  const closes = candles.map(c => c.close);
  const e21 = ema(closes, 21);
  const e50 = ema(closes, 50);
  const last = closes.length - 1;
  if (closes[last] > e21[last] && e21[last] > e50[last]) return 'bull';
  if (closes[last] < e21[last] && e21[last] < e50[last]) return 'bear';
  return 'neutral';
}

// ─── Core momentum detection ───

function detectMomentum(
  candles: Candle[],
  timeframe: string,
  htfTrend: 'bull' | 'bear' | 'neutral' = 'neutral',
  turnover24h: number = 0,
): Omit<MomentumSignal, 'symbol' | 'price' | 'change24h' | 'volume24h' | 'turnover24h' | 'marketData'> | null {
  if (candles.length < 60) return null;

  const closes = candles.map(c => c.close);
  const volumes = candles.map(c => c.volume);
  const len = closes.length;
  const last = len - 1;
  const prev = len - 2;
  const prev2 = len - 3;

  // Calculate all indicators
  const rsi = calcRSI(closes);
  const { macd, signal: macdSig, hist: macdHist } = calcMACD(closes);
  const adxArr = calcADX(candles);
  const { k: stochK, d: stochD } = calcStochastic(candles);
  const ema9 = ema(closes, 9);
  const ema21 = ema(closes, 21);
  const ema50 = ema(closes, 50);
  const atrArr = calcATR(candles);
  const obv = calcOBV(candles);
  const obvEma = ema(obv, 20);
  const bbWidth = calcBBWidth(closes);

  // Volume analysis
  const recentVolAvg = (volumes[last] + volumes[prev] + volumes[prev2]) / 3;
  const priorVolSlice = volumes.slice(Math.max(0, last - 23), last - 3);
  const priorVolAvg = priorVolSlice.length > 0 ? priorVolSlice.reduce((a, b) => a + b, 0) / priorVolSlice.length : 1;
  const volumeRatio = priorVolAvg > 0 ? recentVolAvg / priorVolAvg : 1;

  // Rate of change (5-bar)
  const roc5 = closes[last - 5] !== 0 ? ((closes[last] - closes[last - 5]) / closes[last - 5]) * 100 : 0;
  const roc5prev = closes[last - 10] !== 0 ? ((closes[last - 5] - closes[last - 10]) / closes[last - 10]) * 100 : 0;
  const acceleration = roc5 - roc5prev;

  // ROC acceleration (3-bar vs prior 3-bar)
  const roc3 = closes[last - 3] !== 0 ? ((closes[last] - closes[last - 3]) / closes[last - 3]) * 100 : 0;
  const roc3prev = closes[last - 6] !== 0 ? ((closes[last - 3] - closes[last - 6]) / closes[last - 6]) * 100 : 0;
  const rocAccel = roc3 - roc3prev;

  // VWAP
  let vwapNum = 0, vwapDen = 0;
  for (let i = Math.max(0, last - 19); i <= last; i++) {
    const typical = (candles[i].high + candles[i].low + candles[i].close) / 3;
    vwapNum += typical * candles[i].volume;
    vwapDen += candles[i].volume;
  }
  const vwap = vwapDen > 0 ? vwapNum / vwapDen : closes[last];

  // BB Squeeze
  const recentBBW = bbWidth.slice(Math.max(0, last - 50));
  const minBBW = Math.min(...recentBBW.filter(v => !isNaN(v)));
  const bbSqueezeRatio = !isNaN(bbWidth[last]) && minBBW > 0 ? bbWidth[last] / minBBW : 999;
  const wasSqueezed = !isNaN(bbWidth[prev2]) && minBBW > 0 && bbWidth[prev2] / minBBW < 1.2;
  const isExpanding = !isNaN(bbWidth[last]) && !isNaN(bbWidth[prev]) && bbWidth[last] > bbWidth[prev] * 1.05;

  // ATR expansion
  const atrRecent = atrArr[last] ?? 0;
  const atrPrior = atrArr[Math.max(0, last - 10)] ?? 0;
  const atrExpansion = atrPrior > 0 ? atrRecent / atrPrior : 1;

  // Current values
  const curRSI = rsi[last] ?? 50;
  const curMACD = macd[last] ?? 0;
  const curMACDSig = macdSig[last] ?? 0;
  const curMACDHist = macdHist[last] ?? 0;
  const curADX = adxArr[last] ?? 0;
  const curStochK = stochK[last] ?? 50;
  const curStochD = stochD[last] ?? 50;
  const prevMACDHist = macdHist[prev] ?? 0;
  const prevRSI = rsi[prev] ?? 50;
  const curATR = atrArr[last] ?? 0;

  // Determine direction
  const isBullish = closes[last] > ema21[last] && ema9[last] > ema21[last];
  const isBearish = closes[last] < ema21[last] && ema9[last] < ema21[last];
  if (!isBullish && !isBearish) return null;
  const direction: 'bull' | 'bear' = isBullish ? 'bull' : 'bear';

  // ─── Original signals ───
  const rsiBreakout = direction === 'bull'
    ? (prevRSI < 55 && curRSI > 50 && curRSI < 75)
    : (prevRSI > 45 && curRSI < 50 && curRSI > 25);

  const macdCross = direction === 'bull'
    ? (prevMACDHist <= 0 && curMACDHist > 0) || (curMACDHist > prevMACDHist && curMACDHist > 0)
    : (prevMACDHist >= 0 && curMACDHist < 0) || (curMACDHist < prevMACDHist && curMACDHist < 0);

  const volumeSpike = volumeRatio >= 1.8;

  const prevADX = adxArr[prev] ?? 0;
  const adxSurge = curADX > 20 && curADX > prevADX && (curADX - prevADX) > 1;

  const emaCrossover = direction === 'bull'
    ? (ema9[prev] <= ema21[prev] && ema9[last] > ema21[last]) || (ema9[last] > ema21[last] && ema21[last] > ema50[last])
    : (ema9[prev] >= ema21[prev] && ema9[last] < ema21[last]) || (ema9[last] < ema21[last] && ema21[last] < ema50[last]);

  const priceAcceleration = direction === 'bull' ? acceleration > 0.1 : acceleration < -0.1;

  const prevStochK = stochK[prev] ?? 50;
  const prevStochD = stochD[prev] ?? 50;
  const stochMomentum = direction === 'bull'
    ? (prevStochK <= prevStochD && curStochK > curStochD && curStochK < 80)
    : (prevStochK >= prevStochD && curStochK < curStochD && curStochK > 20);

  const obvBreakout = direction === 'bull'
    ? obv[last] > obvEma[last] && obv[prev] <= obvEma[prev]
    : obv[last] < obvEma[last] && obv[prev] >= obvEma[prev];

  const squeezeFire = wasSqueezed && isExpanding && (
    direction === 'bull' ? roc5 > 0 : roc5 < 0
  );

  const vwapBreak = direction === 'bull'
    ? closes[last] > vwap && closes[prev] <= vwap
    : closes[last] < vwap && closes[prev] >= vwap;

  // ─── NEW SIGNALS ───

  // 11. Momentum Acceleration: ROC is accelerating (rate of rate of change)
  const momentumAcceleration = direction === 'bull'
    ? rocAccel > 0.15 && roc3 > 0
    : rocAccel < -0.15 && roc3 < 0;

  // 12. Early Move Filter: RSI between 45-65 (bull) or 35-55 (bear), not overextended
  // + ADX just starting to rise (< 30) + recent EMA cross
  const earlyMove = direction === 'bull'
    ? (curRSI > 45 && curRSI < 65 && curADX < 30 && curADX > 18 && ema9[last] > ema21[last])
    : (curRSI > 35 && curRSI < 55 && curADX < 30 && curADX > 18 && ema9[last] < ema21[last]);

  // 13. Range Breakout: Was in a range (30, 60 bars), now breaking out
  const range30 = detectRange(candles, 30);
  const range60 = detectRange(candles, 60);
  const rangeBreakout = (
    (range30.inRange && (
      (direction === 'bull' && closes[last] > range30.rangeHigh) ||
      (direction === 'bear' && closes[last] < range30.rangeLow)
    )) ||
    (range60.inRange && (
      (direction === 'bull' && closes[last] > range60.rangeHigh) ||
      (direction === 'bear' && closes[last] < range60.rangeLow)
    ))
  );

  // Range position: where price is relative to recent range (0=bottom, 1=top)
  const rHigh = range30.rangeHigh || candles[last].high;
  const rLow = range30.rangeLow || candles[last].low;
  const rangePosition = (rHigh - rLow) > 0 ? (closes[last] - rLow) / (rHigh - rLow) : 0.5;

  // 14. Volatility Expansion: ATR expanding significantly
  const volatilityExpansion = atrExpansion > 1.4 && volumeRatio > 1.5;

  // 15. Consolidation Breakout: Was consolidating, now breaking out
  const consol = detectConsolidation(candles);
  const consolidationBreakout = consol.isConsolidating && (
    (direction === 'bull' && closes[last] > consol.rangeHigh) ||
    (direction === 'bear' && closes[last] < consol.rangeLow)
  );

  // 16. Momentum Ignition: Sudden large candle with volume (>2 ATR move in 1-2 bars)
  const lastBarRange = Math.abs(closes[last] - candles[last].open);
  const momentumIgnition = curATR > 0 && lastBarRange > curATR * 1.5 && volumeRatio > 2.0 && (
    (direction === 'bull' && closes[last] > candles[last].open) ||
    (direction === 'bear' && closes[last] < candles[last].open)
  );

  // 17. HTF Trend Aligned
  const htfTrendAligned = htfTrend === direction;

  // 18. High Liquidity Filter
  const highLiquidity = turnover24h > 10_000_000;

  const signals = {
    rsiBreakout,
    macdCross,
    volumeSpike,
    adxSurge,
    emaCrossover,
    priceAcceleration,
    stochMomentum,
    obvBreakout,
    squeezeFire,
    vwapBreak,
    momentumAcceleration,
    earlyMove,
    rangeBreakout,
    volatilityExpansion,
    consolidationBreakout,
    momentumIgnition,
    htfTrendAligned,
    highLiquidity,
  };

  // Weighted scoring
  const weights: Record<string, number> = {
    rsiBreakout: 8,
    macdCross: 12,
    volumeSpike: 15,
    adxSurge: 12,
    emaCrossover: 10,
    priceAcceleration: 7,
    stochMomentum: 7,
    obvBreakout: 6,
    squeezeFire: 10,
    vwapBreak: 7,
    momentumAcceleration: 8,
    earlyMove: 10,
    rangeBreakout: 12,
    volatilityExpansion: 8,
    consolidationBreakout: 12,
    momentumIgnition: 14,
    htfTrendAligned: 10,
    highLiquidity: 5,
  };

  let score = 0;
  for (const [key, val] of Object.entries(signals)) {
    if (val) score += weights[key] ?? 0;
  }

  const signalCount = Object.values(signals).filter(Boolean).length;
  if (signalCount >= 6) score += 10;
  if (signalCount >= 9) score += 15;

  // ─── Filtering: require meaningful confluence ───
  // Must have volume confirmation
  if (!volumeSpike) return null;
  if (volumeRatio < 2.0) return null;

  // Must have at least 4 confirming signals and decent score
  if (signalCount < 4 || score < 40) return null;

  // Must have at least one trend engine signal (MACD or ADX or EMA)
  if (!macdCross && !adxSurge && !emaCrossover) return null;

  // RSI not overextended
  if (direction === 'bull' && curRSI > 80) return null;
  if (direction === 'bear' && curRSI < 20) return null;

  return {
    timeframe,
    score: Math.min(score, 100),
    direction,
    signals,
    details: {
      rsi: Math.round(curRSI * 100) / 100,
      macd: Math.round(curMACD * 1e8) / 1e8,
      macdSignal: Math.round(curMACDSig * 1e8) / 1e8,
      macdHist: Math.round(curMACDHist * 1e8) / 1e8,
      adx: Math.round(curADX * 100) / 100,
      volumeRatio: Math.round(volumeRatio * 100) / 100,
      roc: Math.round(roc5 * 100) / 100,
      stochK: Math.round(curStochK * 100) / 100,
      stochD: Math.round(curStochD * 100) / 100,
      ema9: ema9[last],
      ema21: ema21[last],
      ema50: ema50[last],
      atr: curATR,
      bbSqueeze: Math.round(bbSqueezeRatio * 100) / 100,
      rocAccel: Math.round(rocAccel * 100) / 100,
      rangePosition: Math.round(rangePosition * 100) / 100,
      atrExpansion: Math.round(atrExpansion * 100) / 100,
      consolidationBars: consol.bars,
      htfTrend: htfTrend,
    },
    timestamp: Date.now(),
  };
}

// ─── Bybit API helpers ───

async function fetchTickers(): Promise<Array<{ symbol: string; lastPrice: number; price24hPcnt: number; volume24h: number; turnover24h: number; fundingRate: number; predictedFunding: number }>> {
  const res = await fetch('https://api.bybit.com/v5/market/tickers?category=linear');
  const data = await res.json();
  if (data.retCode !== 0) return [];
  return data.result.list
    .filter((t: any) => t.symbol.endsWith('USDT'))
    .map((t: any) => ({
      symbol: t.symbol,
      lastPrice: parseFloat(t.lastPrice),
      price24hPcnt: parseFloat(t.price24hPcnt) * 100,
      volume24h: parseFloat(t.volume24h),
      turnover24h: parseFloat(t.turnover24h),
      fundingRate: parseFloat(t.fundingRate || '0'),
      predictedFunding: parseFloat(t.predictedFundingRate || t.fundingRate || '0'),
    }))
    .filter((t: any) => t.turnover24h > 5_000_000)
    .sort((a: any, b: any) => b.turnover24h - a.turnover24h)
    .slice(0, 100);
}

async function fetchKlines(symbol: string, interval: string, limit = 100): Promise<Candle[]> {
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

async function fetchOpenInterest(symbol: string): Promise<{ oi: number; oiChange5m: number } | null> {
  try {
    const res = await fetch(`https://api.bybit.com/v5/market/open-interest?category=linear&symbol=${symbol}&intervalTime=5min&limit=3`);
    const data = await res.json();
    if (data.retCode !== 0 || !data.result?.list?.length) return null;
    const list = data.result.list;
    const current = parseFloat(list[0].openInterest);
    const prev = list.length > 1 ? parseFloat(list[1].openInterest) : current;
    const change = prev > 0 ? ((current - prev) / prev) * 100 : 0;
    return { oi: current, oiChange5m: Math.round(change * 100) / 100 };
  } catch {
    return null;
  }
}

async function fetchOrderbook(symbol: string): Promise<{ imbalance: number; bidAskRatio: number } | null> {
  try {
    const res = await fetch(`https://api.bybit.com/v5/market/orderbook?category=linear&symbol=${symbol}&limit=25`);
    const data = await res.json();
    if (data.retCode !== 0 || !data.result) return null;
    const bids = (data.result.b || []) as string[][];
    const asks = (data.result.a || []) as string[][];
    let bidVol = 0, askVol = 0;
    for (const b of bids) bidVol += parseFloat(b[1]);
    for (const a of asks) askVol += parseFloat(a[1]);
    const total = bidVol + askVol;
    const imbalance = total > 0 ? ((bidVol - askVol) / total) * 100 : 0;
    const bidAskRatio = askVol > 0 ? bidVol / askVol : 1;
    return { imbalance: Math.round(imbalance * 100) / 100, bidAskRatio: Math.round(bidAskRatio * 100) / 100 };
  } catch {
    return null;
  }
}

// ─── Main handler ───

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const tickers = await fetchTickers();
    const timeframes = ['15', '60', '240', 'D'];
    const allSignals: MomentumSignal[] = [];

    // Pre-fetch HTF (1h) candles for trend filter
    const htfTrends = new Map<string, 'bull' | 'bear' | 'neutral'>();

    // Process in batches
    const batchSize = 8;

    // First pass: fetch 1h candles for HTF trend
    for (let i = 0; i < tickers.length; i += batchSize) {
      const batch = tickers.slice(i, i + batchSize);
      await Promise.all(batch.map(async (ticker) => {
        try {
          const candles = await fetchKlines(ticker.symbol, '60', 100);
          htfTrends.set(ticker.symbol, checkHTFTrend(candles));
        } catch {
          htfTrends.set(ticker.symbol, 'neutral');
        }
      }));
      if (i + batchSize < tickers.length) await new Promise(r => setTimeout(r, 50));
    }

    // Second pass: run momentum detection on all timeframes + fetch market data for signals
    for (let i = 0; i < tickers.length; i += batchSize) {
      const batch = tickers.slice(i, i + batchSize);
      const batchPromises = batch.flatMap(ticker =>
        timeframes.map(async (tf) => {
          try {
            const candles = await fetchKlines(ticker.symbol, tf, 100);
            const htfTrend = htfTrends.get(ticker.symbol) ?? 'neutral';
            const result = detectMomentum(candles, tf, htfTrend, ticker.turnover24h);
            if (result) {
              // Fetch additional market data for qualifying signals
              const [oiData, obData] = await Promise.all([
                fetchOpenInterest(ticker.symbol),
                fetchOrderbook(ticker.symbol),
              ]);

              const fundingShift = Math.abs(ticker.predictedFunding - ticker.fundingRate);

              allSignals.push({
                ...result,
                symbol: ticker.symbol,
                price: ticker.lastPrice,
                change24h: ticker.price24hPcnt,
                volume24h: ticker.volume24h,
                turnover24h: ticker.turnover24h,
                marketData: {
                  openInterest: oiData?.oi,
                  oiChange5m: oiData?.oiChange5m,
                  fundingRate: ticker.fundingRate,
                  predictedFunding: ticker.predictedFunding,
                  fundingShift: Math.round(fundingShift * 10000) / 10000,
                  orderBookImbalance: obData?.imbalance,
                  bidAskRatio: obData?.bidAskRatio,
                },
              });
            }
          } catch {
            // skip
          }
        })
      );
      await Promise.all(batchPromises);
      if (i + batchSize < tickers.length) {
        await new Promise(r => setTimeout(r, 100));
      }
    }

    // Sort by score descending
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
