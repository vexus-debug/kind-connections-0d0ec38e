import type { Candle } from '@/types/scanner';
import { calculateEMA } from './moving-averages';
import { calculateATR } from './trend';

/** Bollinger Bands */
export function calculateBollingerBands(closes: number[], period = 20, stdDev = 2): {
  upper: number;
  middle: number;
  lower: number;
  bandwidth: number;
  percentB: number;
  squeeze: boolean;
} {
  if (closes.length < period) {
    const p = closes[closes.length - 1] || 0;
    return { upper: p, middle: p, lower: p, bandwidth: 0, percentB: 0.5, squeeze: false };
  }

  const recent = closes.slice(-period);
  const middle = recent.reduce((s, v) => s + v, 0) / period;
  const variance = recent.reduce((s, v) => s + (v - middle) ** 2, 0) / period;
  const sd = Math.sqrt(variance);

  const upper = middle + stdDev * sd;
  const lower = middle - stdDev * sd;
  const bandwidth = middle === 0 ? 0 : (upper - lower) / middle;
  const price = closes[closes.length - 1];
  const range = upper - lower;
  const percentB = range === 0 ? 0.5 : (price - lower) / range;

  // Squeeze: bandwidth is in the lowest 20% of recent bandwidth values
  // Simplified: bandwidth < 0.04 is considered a squeeze
  const squeeze = bandwidth < 0.04;

  return { upper, middle, lower, bandwidth, percentB, squeeze };
}

/** Keltner Channels */
export function calculateKeltnerChannels(candles: Candle[], emaPeriod = 20, atrPeriod = 10, multiplier = 1.5): {
  upper: number;
  middle: number;
  lower: number;
  squeeze: boolean; // Bollinger inside Keltner = squeeze
} {
  const closes = candles.map(c => c.close);
  const emaValues = calculateEMA(closes, emaPeriod);
  const middle = emaValues[emaValues.length - 1];
  const atr = calculateATR(candles, atrPeriod);

  const upper = middle + multiplier * atr;
  const lower = middle - multiplier * atr;

  return { upper, middle, lower, squeeze: false }; // squeeze detected externally
}

/** Donchian Channels */
export function calculateDonchianChannels(candles: Candle[], period = 20): {
  upper: number;
  lower: number;
  middle: number;
  breakoutUp: boolean;
  breakoutDown: boolean;
} {
  if (candles.length < period) {
    const p = candles[candles.length - 1]?.close || 0;
    return { upper: p, lower: p, middle: p, breakoutUp: false, breakoutDown: false };
  }

  const lookback = candles.slice(-period - 1, -1); // exclude current candle for breakout detection
  let highest = -Infinity, lowest = Infinity;
  for (const c of lookback) {
    if (c.high > highest) highest = c.high;
    if (c.low < lowest) lowest = c.low;
  }

  const price = candles[candles.length - 1].close;
  const upper = highest;
  const lower = lowest;
  const middle = (upper + lower) / 2;

  return {
    upper, lower, middle,
    breakoutUp: price > upper,
    breakoutDown: price < lower,
  };
}

/** Historical Volatility (annualized) */
export function calculateHistoricalVolatility(closes: number[], period = 20): number {
  if (closes.length < period + 1) return 0;
  const returns: number[] = [];
  for (let i = closes.length - period; i < closes.length; i++) {
    if (closes[i - 1] !== 0) {
      returns.push(Math.log(closes[i] / closes[i - 1]));
    }
  }
  if (returns.length < 2) return 0;
  const mean = returns.reduce((s, v) => s + v, 0) / returns.length;
  const variance = returns.reduce((s, v) => s + (v - mean) ** 2, 0) / (returns.length - 1);
  return Math.sqrt(variance * 252) * 100; // annualized %
}

/** Detect Bollinger-Keltner squeeze (BB inside KC) */
export function detectSqueeze(
  bbUpper: number, bbLower: number,
  kcUpper: number, kcLower: number
): boolean {
  return bbLower > kcLower && bbUpper < kcUpper;
}
