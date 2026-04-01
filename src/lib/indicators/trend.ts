import type { Candle } from '@/types/scanner';
import { calculateEMA } from './moving-averages';

/** True Range for a candle series */
export function calculateTR(candles: Candle[]): number[] {
  const tr: number[] = [candles[0].high - candles[0].low];
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i];
    const prevClose = candles[i - 1].close;
    tr.push(Math.max(c.high - c.low, Math.abs(c.high - prevClose), Math.abs(c.low - prevClose)));
  }
  return tr;
}

/** Smoothed (Wilder) average */
export function smoothedAvg(data: number[], period: number): number[] {
  const result: number[] = [];
  let sum = 0;
  for (let i = 0; i < data.length; i++) {
    if (i < period) {
      sum += data[i];
      result.push(sum / (i + 1));
    } else {
      result.push((result[i - 1] * (period - 1) + data[i]) / period);
    }
  }
  return result;
}

/** Average True Range */
export function calculateATR(candles: Candle[], period: number = 14): number {
  const tr = calculateTR(candles);
  const atr = smoothedAvg(tr, period);
  return atr[atr.length - 1] || 0;
}

/** ADX with +DI / -DI */
export function calculateADX(candles: Candle[], period: number = 14): { adx: number; plusDI: number; minusDI: number } {
  if (candles.length < period + 1) return { adx: 0, plusDI: 0, minusDI: 0 };

  const plusDM: number[] = [0];
  const minusDM: number[] = [0];

  for (let i = 1; i < candles.length; i++) {
    const upMove = candles[i].high - candles[i - 1].high;
    const downMove = candles[i - 1].low - candles[i].low;
    plusDM.push(upMove > downMove && upMove > 0 ? upMove : 0);
    minusDM.push(downMove > upMove && downMove > 0 ? downMove : 0);
  }

  const tr = calculateTR(candles);
  const smoothTR = smoothedAvg(tr, period);
  const smoothPlusDM = smoothedAvg(plusDM, period);
  const smoothMinusDM = smoothedAvg(minusDM, period);

  const dx: number[] = [];
  let lastPlusDI = 0, lastMinusDI = 0;
  for (let i = 0; i < smoothTR.length; i++) {
    if (smoothTR[i] === 0) { dx.push(0); continue; }
    lastPlusDI = (smoothPlusDM[i] / smoothTR[i]) * 100;
    lastMinusDI = (smoothMinusDM[i] / smoothTR[i]) * 100;
    const diSum = lastPlusDI + lastMinusDI;
    dx.push(diSum === 0 ? 0 : (Math.abs(lastPlusDI - lastMinusDI) / diSum) * 100);
  }

  const adx = smoothedAvg(dx, period);
  return { adx: adx[adx.length - 1] || 0, plusDI: lastPlusDI, minusDI: lastMinusDI };
}

/** Parabolic SAR */
export function calculateParabolicSAR(candles: Candle[], afStart = 0.02, afStep = 0.02, afMax = 0.2): {
  sar: number;
  direction: 'bull' | 'bear';
} {
  if (candles.length < 3) return { sar: candles[0]?.low ?? 0, direction: 'bull' };

  let bull = true;
  let sar = candles[0].low;
  let ep = candles[0].high;
  let af = afStart;

  for (let i = 1; i < candles.length; i++) {
    const prev = candles[i - 1];
    const curr = candles[i];

    sar = sar + af * (ep - sar);

    if (bull) {
      sar = Math.min(sar, prev.low, i >= 2 ? candles[i - 2].low : prev.low);
      if (curr.low < sar) {
        bull = false;
        sar = ep;
        ep = curr.low;
        af = afStart;
      } else {
        if (curr.high > ep) {
          ep = curr.high;
          af = Math.min(af + afStep, afMax);
        }
      }
    } else {
      sar = Math.max(sar, prev.high, i >= 2 ? candles[i - 2].high : prev.high);
      if (curr.high > sar) {
        bull = true;
        sar = ep;
        ep = curr.high;
        af = afStart;
      } else {
        if (curr.low < ep) {
          ep = curr.low;
          af = Math.min(af + afStep, afMax);
        }
      }
    }
  }

  return { sar, direction: bull ? 'bull' : 'bear' };
}

/** Supertrend indicator */
export function calculateSupertrend(candles: Candle[], period: number = 10, multiplier: number = 3): {
  value: number;
  direction: 'bull' | 'bear';
} {
  const atrValues = calculateTR(candles);
  const atrSmoothed = smoothedAvg(atrValues, period);

  let upperBand = 0, lowerBand = 0;
  let supertrend = 0;
  let direction: 'bull' | 'bear' = 'bull';

  for (let i = period; i < candles.length; i++) {
    const hl2 = (candles[i].high + candles[i].low) / 2;
    const atr = atrSmoothed[i];

    const basicUpper = hl2 + multiplier * atr;
    const basicLower = hl2 - multiplier * atr;

    upperBand = basicUpper < upperBand || candles[i - 1].close > upperBand ? basicUpper : upperBand;
    lowerBand = basicLower > lowerBand || candles[i - 1].close < lowerBand ? basicLower : lowerBand;

    if (supertrend === upperBand) {
      supertrend = candles[i].close > upperBand ? lowerBand : upperBand;
    } else {
      supertrend = candles[i].close < lowerBand ? upperBand : lowerBand;
    }

    direction = candles[i].close > supertrend ? 'bull' : 'bear';
  }

  return { value: supertrend, direction };
}

/** Ichimoku Cloud */
export function calculateIchimoku(candles: Candle[], tenkanPeriod = 9, kijunPeriod = 26, senkouBPeriod = 52): {
  tenkan: number;
  kijun: number;
  senkouA: number;
  senkouB: number;
  chikouVsPrice: number; // positive = bullish
  cloudDirection: 'bull' | 'bear' | 'neutral';
  priceVsCloud: 'above' | 'below' | 'inside';
} {
  const highLow = (start: number, end: number) => {
    let high = -Infinity, low = Infinity;
    for (let i = start; i <= end; i++) {
      if (candles[i].high > high) high = candles[i].high;
      if (candles[i].low < low) low = candles[i].low;
    }
    return (high + low) / 2;
  };

  const len = candles.length;
  if (len < senkouBPeriod + kijunPeriod) {
    return { tenkan: 0, kijun: 0, senkouA: 0, senkouB: 0, chikouVsPrice: 0, cloudDirection: 'neutral', priceVsCloud: 'inside' };
  }

  const tenkan = highLow(len - tenkanPeriod, len - 1);
  const kijun = highLow(len - kijunPeriod, len - 1);
  const senkouA = (tenkan + kijun) / 2;
  const senkouB = highLow(len - senkouBPeriod, len - 1);

  const price = candles[len - 1].close;
  const chikouVsPrice = len > kijunPeriod ? price - candles[len - kijunPeriod].close : 0;

  const cloudTop = Math.max(senkouA, senkouB);
  const cloudBottom = Math.min(senkouA, senkouB);
  const cloudDirection = senkouA > senkouB ? 'bull' : senkouA < senkouB ? 'bear' : 'neutral';
  const priceVsCloud = price > cloudTop ? 'above' : price < cloudBottom ? 'below' : 'inside';

  return { tenkan, kijun, senkouA, senkouB, chikouVsPrice, cloudDirection, priceVsCloud };
}
