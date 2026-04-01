import type { Candle } from '@/types/scanner';
import { calculateEMA } from './moving-averages';

/** RSI */
export function calculateRSI(closes: number[], period: number = 14): number {
  if (closes.length < period + 1) return 50;
  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) gains += diff; else losses -= diff;
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;
  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    avgGain = (avgGain * (period - 1) + (diff > 0 ? diff : 0)) / period;
    avgLoss = (avgLoss * (period - 1) + (diff < 0 ? -diff : 0)) / period;
  }
  if (avgLoss === 0) return 100;
  return 100 - 100 / (1 + avgGain / avgLoss);
}

/** MACD */
export function calculateMACD(closes: number[], fast = 12, slow = 26, signal = 9): { macd: number; signal: number; histogram: number } {
  if (closes.length < slow + signal) return { macd: 0, signal: 0, histogram: 0 };
  const emaFast = calculateEMA(closes, fast);
  const emaSlow = calculateEMA(closes, slow);
  const macdLine = emaFast.map((v, i) => v - emaSlow[i]);
  const signalLine = calculateEMA(macdLine.slice(slow - 1), signal);
  const macdVal = macdLine[macdLine.length - 1];
  const signalVal = signalLine[signalLine.length - 1];
  return { macd: macdVal, signal: signalVal, histogram: macdVal - signalVal };
}

/** Stochastic Oscillator (%K / %D) */
export function calculateStochastic(candles: Candle[], kPeriod = 14, dPeriod = 3): { k: number; d: number } {
  if (candles.length < kPeriod + dPeriod) return { k: 50, d: 50 };

  const kValues: number[] = [];
  for (let i = kPeriod - 1; i < candles.length; i++) {
    let highest = -Infinity, lowest = Infinity;
    for (let j = i - kPeriod + 1; j <= i; j++) {
      if (candles[j].high > highest) highest = candles[j].high;
      if (candles[j].low < lowest) lowest = candles[j].low;
    }
    const range = highest - lowest;
    kValues.push(range === 0 ? 50 : ((candles[i].close - lowest) / range) * 100);
  }

  // %D = SMA of %K
  const dValues: number[] = [];
  for (let i = dPeriod - 1; i < kValues.length; i++) {
    let sum = 0;
    for (let j = i - dPeriod + 1; j <= i; j++) sum += kValues[j];
    dValues.push(sum / dPeriod);
  }

  return { k: kValues[kValues.length - 1], d: dValues[dValues.length - 1] };
}

/** Stochastic RSI */
export function calculateStochRSI(closes: number[], rsiPeriod = 14, stochPeriod = 14, kSmooth = 3, dSmooth = 3): { k: number; d: number } {
  if (closes.length < rsiPeriod + stochPeriod + kSmooth) return { k: 50, d: 50 };

  // Calculate RSI series
  const rsiSeries: number[] = [];
  for (let end = rsiPeriod + 1; end <= closes.length; end++) {
    rsiSeries.push(calculateRSI(closes.slice(0, end), rsiPeriod));
  }

  if (rsiSeries.length < stochPeriod) return { k: 50, d: 50 };

  const stochValues: number[] = [];
  for (let i = stochPeriod - 1; i < rsiSeries.length; i++) {
    let highest = -Infinity, lowest = Infinity;
    for (let j = i - stochPeriod + 1; j <= i; j++) {
      if (rsiSeries[j] > highest) highest = rsiSeries[j];
      if (rsiSeries[j] < lowest) lowest = rsiSeries[j];
    }
    const range = highest - lowest;
    stochValues.push(range === 0 ? 50 : ((rsiSeries[i] - lowest) / range) * 100);
  }

  // Smooth %K
  const kSmoothed = calculateEMA(stochValues, kSmooth);
  const dSmoothed = calculateEMA(kSmoothed, dSmooth);

  return { k: kSmoothed[kSmoothed.length - 1], d: dSmoothed[dSmoothed.length - 1] };
}

/** Williams %R */
export function calculateWilliamsR(candles: Candle[], period = 14): number {
  if (candles.length < period) return -50;
  const recent = candles.slice(-period);
  let highest = -Infinity, lowest = Infinity;
  for (const c of recent) {
    if (c.high > highest) highest = c.high;
    if (c.low < lowest) lowest = c.low;
  }
  const range = highest - lowest;
  if (range === 0) return -50;
  return ((highest - candles[candles.length - 1].close) / range) * -100;
}

/** Commodity Channel Index */
export function calculateCCI(candles: Candle[], period = 20): number {
  if (candles.length < period) return 0;
  const recent = candles.slice(-period);
  const tps = recent.map(c => (c.high + c.low + c.close) / 3);
  const meanTP = tps.reduce((s, v) => s + v, 0) / period;
  const meanDev = tps.reduce((s, v) => s + Math.abs(v - meanTP), 0) / period;
  if (meanDev === 0) return 0;
  return (tps[tps.length - 1] - meanTP) / (0.015 * meanDev);
}

/** Rate of Change (%) */
export function calculateROC(closes: number[], period = 12): number {
  if (closes.length <= period) return 0;
  const prev = closes[closes.length - 1 - period];
  if (prev === 0) return 0;
  return ((closes[closes.length - 1] - prev) / prev) * 100;
}

/** Money Flow Index (volume-weighted RSI) */
export function calculateMFI(candles: Candle[], period = 14): number {
  if (candles.length < period + 1) return 50;
  let posFlow = 0, negFlow = 0;

  for (let i = candles.length - period; i < candles.length; i++) {
    const tp = (candles[i].high + candles[i].low + candles[i].close) / 3;
    const prevTP = (candles[i - 1].high + candles[i - 1].low + candles[i - 1].close) / 3;
    const mf = tp * candles[i].volume;
    if (tp > prevTP) posFlow += mf;
    else if (tp < prevTP) negFlow += mf;
  }

  if (negFlow === 0) return 100;
  const mfr = posFlow / negFlow;
  return 100 - 100 / (1 + mfr);
}

/** Chaikin Money Flow */
export function calculateCMF(candles: Candle[], period = 20): number {
  if (candles.length < period) return 0;
  const recent = candles.slice(-period);
  let mfvSum = 0, volSum = 0;
  for (const c of recent) {
    const range = c.high - c.low;
    const mfm = range === 0 ? 0 : ((c.close - c.low) - (c.high - c.close)) / range;
    mfvSum += mfm * c.volume;
    volSum += c.volume;
  }
  return volSum === 0 ? 0 : mfvSum / volSum;
}

/** True Strength Index */
export function calculateTSI(closes: number[], longPeriod = 25, shortPeriod = 13): number {
  if (closes.length < longPeriod + shortPeriod + 1) return 0;

  const momentum: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    momentum.push(closes[i] - closes[i - 1]);
  }

  const absMomentum = momentum.map(Math.abs);

  const smoothMom1 = calculateEMA(momentum, longPeriod);
  const smoothMom2 = calculateEMA(smoothMom1, shortPeriod);

  const smoothAbs1 = calculateEMA(absMomentum, longPeriod);
  const smoothAbs2 = calculateEMA(smoothAbs1, shortPeriod);

  const denom = smoothAbs2[smoothAbs2.length - 1];
  if (denom === 0) return 0;
  return (smoothMom2[smoothMom2.length - 1] / denom) * 100;
}
