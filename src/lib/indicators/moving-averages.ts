import type { Candle } from '@/types/scanner';

/** Simple Moving Average */
export function calculateSMA(data: number[], period: number): number[] {
  const sma: number[] = [];
  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) {
      sma.push(NaN);
    } else {
      let sum = 0;
      for (let j = i - period + 1; j <= i; j++) sum += data[j];
      sma.push(sum / period);
    }
  }
  return sma;
}

/** Exponential Moving Average */
export function calculateEMA(data: number[], period: number): number[] {
  const ema: number[] = [];
  if (data.length === 0) return ema;
  const k = 2 / (period + 1);
  ema[0] = data[0];
  for (let i = 1; i < data.length; i++) {
    ema[i] = data[i] * k + ema[i - 1] * (1 - k);
  }
  return ema;
}

/** Double Exponential Moving Average — 2*EMA(n) - EMA(EMA(n)) */
export function calculateDEMA(data: number[], period: number): number[] {
  const ema1 = calculateEMA(data, period);
  const ema2 = calculateEMA(ema1, period);
  return ema1.map((v, i) => 2 * v - ema2[i]);
}

/** Triple Exponential Moving Average — 3*EMA - 3*EMA(EMA) + EMA(EMA(EMA)) */
export function calculateTEMA(data: number[], period: number): number[] {
  const ema1 = calculateEMA(data, period);
  const ema2 = calculateEMA(ema1, period);
  const ema3 = calculateEMA(ema2, period);
  return ema1.map((v, i) => 3 * v - 3 * ema2[i] + ema3[i]);
}

/** Volume-Weighted Average Price */
export function calculateVWAP(candles: Candle[]): number {
  let cumVol = 0;
  let cumTP = 0;
  for (const c of candles) {
    const tp = (c.high + c.low + c.close) / 3;
    cumTP += tp * c.volume;
    cumVol += c.volume;
  }
  return cumVol === 0 ? candles[candles.length - 1].close : cumTP / cumVol;
}

/** Linear Regression Channel — returns slope, intercept, r², upper & lower bands */
export function calculateLinearRegression(closes: number[], period: number = 50): {
  slope: number;
  intercept: number;
  rSquared: number;
  upper: number;
  lower: number;
  value: number;
} {
  const data = closes.slice(-period);
  const n = data.length;
  if (n < 5) return { slope: 0, intercept: 0, rSquared: 0, upper: 0, lower: 0, value: 0 };

  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
  for (let i = 0; i < n; i++) {
    sumX += i;
    sumY += data[i];
    sumXY += i * data[i];
    sumX2 += i * i;
  }

  const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
  const intercept = (sumY - slope * sumX) / n;
  const value = slope * (n - 1) + intercept;

  // R-squared
  const meanY = sumY / n;
  let ssTot = 0, ssRes = 0;
  for (let i = 0; i < n; i++) {
    const predicted = slope * i + intercept;
    ssTot += (data[i] - meanY) ** 2;
    ssRes += (data[i] - predicted) ** 2;
  }
  const rSquared = ssTot === 0 ? 0 : 1 - ssRes / ssTot;

  // Standard error for channel bands
  const stdErr = Math.sqrt(ssRes / (n - 2));
  const upper = value + 2 * stdErr;
  const lower = value - 2 * stdErr;

  return { slope, intercept, rSquared, upper, lower, value };
}
