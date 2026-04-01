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

interface BreakoutSignal {
  symbol: string;
  price: number;
  change24h: number;
  turnover24h: number;
  timeframe: string;
  direction: 'bull' | 'bear';
  score: number;
  breakoutType: 'squeeze' | 'consolidation' | 'accumulation' | 'range';
  candlesAgo: number; // how many candles ago the breakout occurred (0 = current, 1 = last closed)
  priorCondition: {
    squeezeBars: number;       // how many bars BB was inside KC
    consolidationBars: number; // how many bars in tight range
    rangeWidth: number;        // % width of the prior range
    rangeHigh: number;
    rangeLow: number;
  };
  confirmation: {
    volumeSpike: boolean;
    volumeRatio: number;
    adxRising: boolean;
    adx: number;
    macdConfirm: boolean;
    macdHist: number;
    rsi: number;
    rsiHealthy: boolean;  // not overbought/oversold
    bbExpansion: boolean;
    atrExpansion: number;
    obvConfirm: boolean;
    emaTrendAligned: boolean;
    candleBody: number;   // body-to-range ratio of breakout candle
    closeStrength: number; // how close the close is to the high (bull) or low (bear)
    htfTrend: string;
    donchianBreak: boolean;
    mfiConfirm: boolean;
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

function calcMACD(closes: number[]): { macd: number[]; signal: number[]; hist: number[] } {
  const ema12 = ema(closes, 12);
  const ema26 = ema(closes, 26);
  const macdLine = ema12.map((v, i) => v - ema26[i]);
  const signalLine = ema(macdLine, 9);
  const hist = macdLine.map((v, i) => v - signalLine[i]);
  return { macd: macdLine, signal: signalLine, hist };
}

function calcADX(candles: Candle[], period = 14): { adx: number[]; plusDI: number[]; minusDI: number[] } {
  const len = candles.length;
  const adx: number[] = new Array(len).fill(NaN);
  const plusDIArr: number[] = new Array(len).fill(0);
  const minusDIArr: number[] = new Array(len).fill(0);
  if (len < period * 2) return { adx, plusDI: plusDIArr, minusDI: minusDIArr };
  const tr: number[] = [];
  const plusDM: number[] = [];
  const minusDM: number[] = [];
  for (let i = 0; i < len; i++) {
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
  for (let i = 0; i < len; i++) {
    const pdi = smoothTR[i] ? (smoothPlusDM[i] / smoothTR[i]) * 100 : 0;
    const mdi = smoothTR[i] ? (smoothMinusDM[i] / smoothTR[i]) * 100 : 0;
    plusDIArr[i] = pdi;
    minusDIArr[i] = mdi;
    const sum = pdi + mdi;
    dx.push(sum === 0 ? 0 : (Math.abs(pdi - mdi) / sum) * 100);
  }
  const adxSmooth = ema(dx, period);
  for (let i = 0; i < len; i++) {
    if (i >= period * 2) adx[i] = adxSmooth[i];
  }
  return { adx, plusDI: plusDIArr, minusDI: minusDIArr };
}

function calcATR(candles: Candle[], period = 14): number[] {
  const tr = candles.map((c, i) => {
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

function calcBB(closes: number[], period = 20, stdMult = 2): { upper: number[]; lower: number[]; middle: number[]; width: number[] } {
  const mid = sma(closes, period);
  const upper: number[] = [];
  const lower: number[] = [];
  const width: number[] = [];
  for (let i = 0; i < closes.length; i++) {
    if (i < period - 1) { upper.push(NaN); lower.push(NaN); width.push(NaN); continue; }
    let variance = 0;
    for (let j = i - period + 1; j <= i; j++) variance += (closes[j] - mid[i]) ** 2;
    const std = Math.sqrt(variance / period);
    upper.push(mid[i] + stdMult * std);
    lower.push(mid[i] - stdMult * std);
    width.push(mid[i] !== 0 ? (4 * std) / mid[i] : 0);
  }
  return { upper, lower, middle: mid, width };
}

function calcKeltner(candles: Candle[], emaPeriod = 20, atrPeriod = 10, mult = 1.5): { upper: number[]; lower: number[] } {
  const closes = candles.map(c => c.close);
  const emaArr = ema(closes, emaPeriod);
  const atrArr = calcATR(candles, atrPeriod);
  const upper = emaArr.map((e, i) => e + mult * atrArr[i]);
  const lower = emaArr.map((e, i) => e - mult * atrArr[i]);
  return { upper, lower };
}

function calcMFI(candles: Candle[], period = 14): number {
  const len = candles.length;
  if (len < period + 1) return 50;
  let posFlow = 0, negFlow = 0;
  for (let i = len - period; i < len; i++) {
    const tp = (candles[i].high + candles[i].low + candles[i].close) / 3;
    const prevTP = (candles[i - 1].high + candles[i - 1].low + candles[i - 1].close) / 3;
    const mf = tp * candles[i].volume;
    if (tp > prevTP) posFlow += mf;
    else if (tp < prevTP) negFlow += mf;
  }
  if (negFlow === 0) return 100;
  return 100 - 100 / (1 + posFlow / negFlow);
}

// ─── Prior condition detectors ───

// Detect BB-inside-KC squeeze: count consecutive bars where BB is inside KC
function detectSqueeze(candles: Candle[], maxLookback = 80): { squeezeBars: number; wasSqueezed: boolean; squeezeJustReleased: boolean } {
  const closes = candles.map(c => c.close);
  const bb = calcBB(closes, 20, 2);
  const kc = calcKeltner(candles, 20, 10, 1.5);

  let squeezeBars = 0;
  let squeezeEndIdx = -1;
  const len = candles.length;

  // Walk backwards from 2 bars ago to find squeeze
  for (let i = len - 3; i >= Math.max(0, len - maxLookback); i--) {
    if (isNaN(bb.upper[i]) || isNaN(kc.upper[i])) break;
    const inSqueeze = bb.lower[i] > kc.lower[i] && bb.upper[i] < kc.upper[i];
    if (inSqueeze) {
      squeezeBars++;
      if (squeezeEndIdx === -1) squeezeEndIdx = i;
    } else if (squeezeBars > 0) {
      break; // found the start of squeeze
    }
  }

  // Check if squeeze just released (last 1-2 bars are NOT in squeeze but prior bars were)
  const lastInSqueeze = !isNaN(bb.upper[len - 1]) && !isNaN(kc.upper[len - 1]) &&
    bb.lower[len - 1] > kc.lower[len - 1] && bb.upper[len - 1] < kc.upper[len - 1];
  const prevInSqueeze = !isNaN(bb.upper[len - 2]) && !isNaN(kc.upper[len - 2]) &&
    bb.lower[len - 2] > kc.lower[len - 2] && bb.upper[len - 2] < kc.upper[len - 2];

  const squeezeJustReleased = !lastInSqueeze && (prevInSqueeze || squeezeBars >= 5);

  return { squeezeBars, wasSqueezed: squeezeBars >= 5, squeezeJustReleased };
}

// Detect consolidation: tight price range for consecutive bars
function detectConsolidation(candles: Candle[], minBars = 8, maxBars = 80): {
  isConsolidating: boolean; bars: number; rangeHigh: number; rangeLow: number; rangeWidth: number;
} {
  const len = candles.length;
  if (len < minBars + 2) return { isConsolidating: false, bars: 0, rangeHigh: 0, rangeLow: 0, rangeWidth: 0 };

  // Start from 2 bars ago (to check breakout on last 1-2 bars)
  let bars = 0;
  let hh = candles[len - 3].high;
  let ll = candles[len - 3].low;

  for (let i = len - 4; i >= Math.max(0, len - maxBars - 2); i--) {
    const testHigh = Math.max(hh, candles[i].high);
    const testLow = Math.min(ll, candles[i].low);
    const mid = (testHigh + testLow) / 2;
    const pct = mid > 0 ? ((testHigh - testLow) / mid) * 100 : 0;
    if (pct > 4.0) break; // range too wide, stop
    hh = testHigh;
    ll = testLow;
    bars++;
  }

  const mid = (hh + ll) / 2;
  const rangeWidth = mid > 0 ? ((hh - ll) / mid) * 100 : 0;

  return { isConsolidating: bars >= minBars, bars, rangeHigh: hh, rangeLow: ll, rangeWidth: Math.round(rangeWidth * 100) / 100 };
}

// Detect accumulation: price in tight range with increasing volume / OBV trending up
function detectAccumulation(candles: Candle[], minBars = 10, maxBars = 60): {
  isAccumulating: boolean; bars: number; rangeHigh: number; rangeLow: number;
} {
  const consol = detectConsolidation(candles, minBars, maxBars);
  if (!consol.isConsolidating) return { isAccumulating: false, bars: 0, rangeHigh: 0, rangeLow: 0 };

  // Check if volume is increasing or OBV trending up during consolidation
  const start = Math.max(0, candles.length - consol.bars - 2);
  const consolidationCandles = candles.slice(start, candles.length - 2);
  if (consolidationCandles.length < 6) return { isAccumulating: false, bars: 0, rangeHigh: 0, rangeLow: 0 };

  const halfLen = Math.floor(consolidationCandles.length / 2);
  const firstHalfVol = consolidationCandles.slice(0, halfLen).reduce((s, c) => s + c.volume, 0) / halfLen;
  const secondHalfVol = consolidationCandles.slice(halfLen).reduce((s, c) => s + c.volume, 0) / (consolidationCandles.length - halfLen);

  // Volume increasing or steady during consolidation = accumulation
  const volIncreasing = secondHalfVol >= firstHalfVol * 0.9;

  // OBV check
  const obv = calcOBV(consolidationCandles);
  const obvFirstHalf = obv.slice(0, halfLen);
  const obvSecondHalf = obv.slice(halfLen);
  const obvFirst = obvFirstHalf.reduce((s, v) => s + v, 0) / obvFirstHalf.length;
  const obvSecond = obvSecondHalf.reduce((s, v) => s + v, 0) / obvSecondHalf.length;
  const obvRising = obvSecond > obvFirst;

  return {
    isAccumulating: volIncreasing && obvRising,
    bars: consol.bars,
    rangeHigh: consol.rangeHigh,
    rangeLow: consol.rangeLow,
  };
}

// Detect Donchian channel breakout
function detectDonchian(candles: Candle[], period = 20): { breakoutUp: boolean; breakoutDown: boolean } {
  if (candles.length < period + 2) return { breakoutUp: false, breakoutDown: false };
  const lookback = candles.slice(-period - 1, -1);
  let hh = -Infinity, ll = Infinity;
  for (const c of lookback) {
    if (c.high > hh) hh = c.high;
    if (c.low < ll) ll = c.low;
  }
  const last = candles[candles.length - 1];
  return { breakoutUp: last.close > hh, breakoutDown: last.close < ll };
}

// ─── HTF trend check ───
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

// ─── Main breakout detection ───

function detectBreakout(
  candles: Candle[],
  timeframe: string,
  htfTrend: 'bull' | 'bear' | 'neutral',
): Omit<BreakoutSignal, 'symbol' | 'price' | 'change24h' | 'turnover24h'> | null {
  if (candles.length < 80) return null;

  const closes = candles.map(c => c.close);
  const len = closes.length;
  const last = len - 1;
  const prev = len - 2;
  const prev2 = len - 3;

  // ── Step 1: Detect prior condition (MANDATORY - at least one must be present) ──
  const squeeze = detectSqueeze(candles);
  const consol = detectConsolidation(candles);
  const accum = detectAccumulation(candles);
  const donchian = detectDonchian(candles, 20);

  const hasSqueeze = squeeze.wasSqueezed && squeeze.squeezeBars >= 5;
  const hasConsolidation = consol.isConsolidating && consol.bars >= 8;
  const hasAccumulation = accum.isAccumulating && accum.bars >= 10;

  // MUST have at least one prior condition
  if (!hasSqueeze && !hasConsolidation && !hasAccumulation) return null;

  // Determine the range boundaries from the best prior condition
  let rangeHigh = 0, rangeLow = 0, priorBars = 0, rangeWidth = 0;
  let breakoutType: 'squeeze' | 'consolidation' | 'accumulation' | 'range' = 'range';

  if (hasAccumulation) {
    breakoutType = 'accumulation';
    rangeHigh = accum.rangeHigh;
    rangeLow = accum.rangeLow;
    priorBars = accum.bars;
  } else if (hasSqueeze) {
    breakoutType = 'squeeze';
    // For squeeze, use consolidation range if available, else BB range
    if (hasConsolidation) {
      rangeHigh = consol.rangeHigh;
      rangeLow = consol.rangeLow;
    } else {
      const bb = calcBB(closes, 20, 2);
      rangeHigh = bb.upper[prev2] ?? closes[prev2];
      rangeLow = bb.lower[prev2] ?? closes[prev2];
    }
    priorBars = squeeze.squeezeBars;
  } else if (hasConsolidation) {
    breakoutType = 'consolidation';
    rangeHigh = consol.rangeHigh;
    rangeLow = consol.rangeLow;
    priorBars = consol.bars;
  }

  const mid = (rangeHigh + rangeLow) / 2;
  rangeWidth = mid > 0 ? ((rangeHigh - rangeLow) / mid) * 100 : 0;

  // ── Step 2: Check if breakout just happened (within last 2 candles) ──
  const breakUp1 = closes[last] > rangeHigh;
  const breakUp2 = closes[prev] > rangeHigh && closes[prev2] <= rangeHigh;
  const breakDown1 = closes[last] < rangeLow;
  const breakDown2 = closes[prev] < rangeLow && closes[prev2] >= rangeLow;

  const isBullBreakout = breakUp1 || breakUp2;
  const isBearBreakout = breakDown1 || breakDown2;

  if (!isBullBreakout && !isBearBreakout) return null;

  const direction: 'bull' | 'bear' = isBullBreakout ? 'bull' : 'bear';
  const candlesAgo = (direction === 'bull' ? breakUp1 : breakDown1) ? 0 : 1;

  // The bar where breakout occurred
  const boIdx = candlesAgo === 0 ? last : prev;

  // ── Step 3: Calculate confirmation indicators ──
  const rsi = calcRSI(closes);
  const { hist: macdHist } = calcMACD(closes);
  const { adx: adxArr } = calcADX(candles);
  const atrArr = calcATR(candles);
  const obv = calcOBV(candles);
  const obvEma20 = ema(obv, 20);
  const ema9 = ema(closes, 9);
  const ema21 = ema(closes, 21);
  const ema50 = ema(closes, 50);
  const bb = calcBB(closes, 20, 2);
  const mfi = calcMFI(candles);

  // Volume analysis
  const volumes = candles.map(c => c.volume);
  const boVol = volumes[boIdx];
  const priorVolSlice = volumes.slice(Math.max(0, boIdx - 20), boIdx);
  const avgVol = priorVolSlice.length > 0 ? priorVolSlice.reduce((a, b) => a + b, 0) / priorVolSlice.length : 1;
  const volumeRatio = avgVol > 0 ? boVol / avgVol : 1;
  const volumeSpike = volumeRatio >= 1.5;

  // ADX
  const curADX = adxArr[last] ?? 0;
  const prevADX = adxArr[prev] ?? 0;
  const prevADX2 = adxArr[prev2] ?? 0;
  const adxRising = curADX > prevADX && prevADX > prevADX2;

  // MACD
  const curMACDHist = macdHist[last] ?? 0;
  const prevMACDHist = macdHist[prev] ?? 0;
  const macdConfirm = direction === 'bull'
    ? curMACDHist > 0 || (curMACDHist > prevMACDHist)
    : curMACDHist < 0 || (curMACDHist < prevMACDHist);

  // RSI
  const curRSI = rsi[last] ?? 50;
  const rsiHealthy = direction === 'bull' ? (curRSI > 45 && curRSI < 78) : (curRSI > 22 && curRSI < 55);

  // BB expansion
  const bbExpansion = !isNaN(bb.width[last]) && !isNaN(bb.width[prev]) && bb.width[last] > bb.width[prev] * 1.05;

  // ATR expansion
  const atrCur = atrArr[last] ?? 0;
  const atrPrior = atrArr[Math.max(0, last - 10)] ?? 0;
  const atrExpansion = atrPrior > 0 ? atrCur / atrPrior : 1;

  // OBV
  const obvConfirm = direction === 'bull'
    ? obv[last] > obvEma20[last]
    : obv[last] < obvEma20[last];

  // EMA alignment
  const emaTrendAligned = direction === 'bull'
    ? ema9[last] > ema21[last]
    : ema9[last] < ema21[last];

  // Breakout candle quality
  const boCandle = candles[boIdx];
  const bodySize = Math.abs(boCandle.close - boCandle.open);
  const totalRange = boCandle.high - boCandle.low;
  const candleBody = totalRange > 0 ? bodySize / totalRange : 0;

  // Close strength: for bull, close near high; for bear, close near low
  const closeStrength = totalRange > 0
    ? (direction === 'bull'
      ? (boCandle.close - boCandle.low) / totalRange
      : (boCandle.high - boCandle.close) / totalRange)
    : 0.5;

  // Donchian
  const donchianBreak = direction === 'bull' ? donchian.breakoutUp : donchian.breakoutDown;

  // MFI
  const mfiConfirm = direction === 'bull' ? mfi > 50 : mfi < 50;

  // ── Step 4: Quality filtering ──

  // MUST have volume confirmation (relaxed for squeeze releases)
  if (!volumeSpike && !hasSqueeze) return null;
  if (volumeRatio < 1.3) return null;

  // RSI must be healthy (not overextended)
  if (!rsiHealthy) return null;

  // Breakout candle must have decent body (>40% of range)
  if (candleBody < 0.35) return null;

  // Close strength must be decent (>50%)
  if (closeStrength < 0.45) return null;

  // ── Step 5: Scoring ──
  let score = 0;

  // Prior condition quality (max 30)
  if (hasSqueeze) score += squeeze.squeezeBars >= 10 ? 15 : 10;
  if (hasConsolidation) score += consol.bars >= 15 ? 15 : 10;
  if (hasAccumulation) score += 15;

  // Volume (max 20)
  if (volumeRatio >= 3.0) score += 20;
  else if (volumeRatio >= 2.0) score += 15;
  else if (volumeRatio >= 1.5) score += 10;
  else score += 5;

  // Confirmations (max 50)
  if (adxRising) score += 7;
  if (curADX > 20) score += 5;
  if (macdConfirm) score += 7;
  if (bbExpansion) score += 5;
  if (atrExpansion > 1.3) score += 5;
  if (obvConfirm) score += 5;
  if (emaTrendAligned) score += 5;
  if (donchianBreak) score += 5;
  if (mfiConfirm) score += 3;
  if (candleBody > 0.6) score += 3;
  if (closeStrength > 0.7) score += 3;
  if (htfTrend === direction) score += 7;

  // Must have minimum quality
  if (score < 35) return null;

  // At least 3 confirmation indicators must agree
  const confirmCount = [volumeSpike, adxRising, macdConfirm, bbExpansion, obvConfirm, emaTrendAligned, donchianBreak, mfiConfirm]
    .filter(Boolean).length;
  if (confirmCount < 3) return null;

  return {
    timeframe,
    direction,
    score: Math.min(score, 100),
    breakoutType,
    candlesAgo,
    priorCondition: {
      squeezeBars: squeeze.squeezeBars,
      consolidationBars: consol.bars,
      rangeWidth: Math.round(rangeWidth * 100) / 100,
      rangeHigh: Math.round(rangeHigh * 1e8) / 1e8,
      rangeLow: Math.round(rangeLow * 1e8) / 1e8,
    },
    confirmation: {
      volumeSpike,
      volumeRatio: Math.round(volumeRatio * 100) / 100,
      adxRising,
      adx: Math.round(curADX * 100) / 100,
      macdConfirm,
      macdHist: Math.round(curMACDHist * 1e8) / 1e8,
      rsi: Math.round(curRSI * 100) / 100,
      rsiHealthy,
      bbExpansion,
      atrExpansion: Math.round(atrExpansion * 100) / 100,
      obvConfirm,
      emaTrendAligned,
      candleBody: Math.round(candleBody * 100) / 100,
      closeStrength: Math.round(closeStrength * 100) / 100,
      htfTrend: htfTrend,
      donchianBreak,
      mfiConfirm,
    },
    timestamp: Date.now(),
  };
}

// ─── Bybit API helpers ───

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
    const timeframes = ['15', '60', '240', 'D'];
    const allSignals: BreakoutSignal[] = [];
    const htfTrends = new Map<string, 'bull' | 'bear' | 'neutral'>();
    const batchSize = 8;

    // First pass: HTF trend (1h)
    for (let i = 0; i < tickers.length; i += batchSize) {
      const batch = tickers.slice(i, i + batchSize);
      await Promise.all(batch.map(async (t) => {
        try {
          const candles = await fetchKlines(t.symbol, '60', 100);
          htfTrends.set(t.symbol, checkHTFTrend(candles));
        } catch { htfTrends.set(t.symbol, 'neutral'); }
      }));
      if (i + batchSize < tickers.length) await new Promise(r => setTimeout(r, 50));
    }

    // Second pass: breakout detection across timeframes
    for (let i = 0; i < tickers.length; i += batchSize) {
      const batch = tickers.slice(i, i + batchSize);
      const promises = batch.flatMap(ticker =>
        timeframes.map(async (tf) => {
          try {
            const candles = await fetchKlines(ticker.symbol, tf, 150);
            const htfTrend = htfTrends.get(ticker.symbol) ?? 'neutral';
            const result = detectBreakout(candles, tf, htfTrend);
            if (result) {
              allSignals.push({
                ...result,
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
