import type { Candle } from '@/types/scanner';
import { calculateRSI } from './indicators/momentum';
import { calculateEMA } from './indicators/moving-averages';

export interface Divergence {
  type: 'regular_bull' | 'regular_bear' | 'hidden_bull' | 'hidden_bear';
  indicator: 'RSI' | 'MACD';
  strength: 'strong' | 'moderate' | 'weak';
  description: string;
  startIndex: number;
  endIndex: number;
  priceStart: number;
  priceEnd: number;
  indicatorStart: number;
  indicatorEnd: number;
}

interface SwingPoint {
  index: number;
  price: number;
  indicator: number;
}

function findPriceSwingHighs(candles: Candle[], lookback = 3): SwingPoint[] {
  const points: SwingPoint[] = [];
  for (let i = lookback; i < candles.length - lookback; i++) {
    let isHigh = true;
    for (let j = 1; j <= lookback; j++) {
      if (candles[i].high <= candles[i - j].high || candles[i].high <= candles[i + j].high) {
        isHigh = false;
        break;
      }
    }
    if (isHigh) points.push({ index: i, price: candles[i].high, indicator: 0 });
  }
  return points;
}

function findPriceSwingLows(candles: Candle[], lookback = 3): SwingPoint[] {
  const points: SwingPoint[] = [];
  for (let i = lookback; i < candles.length - lookback; i++) {
    let isLow = true;
    for (let j = 1; j <= lookback; j++) {
      if (candles[i].low >= candles[i - j].low || candles[i].low >= candles[i + j].low) {
        isLow = false;
        break;
      }
    }
    if (isLow) points.push({ index: i, price: candles[i].low, indicator: 0 });
  }
  return points;
}

function getRSISeries(candles: Candle[], period = 14): number[] {
  const rsiSeries: number[] = [];
  const closes = candles.map(c => c.close);
  for (let end = period + 1; end <= closes.length; end++) {
    rsiSeries.push(calculateRSI(closes.slice(0, end), period));
  }
  // Pad beginning with 50
  const padded = new Array(candles.length - rsiSeries.length).fill(50);
  return [...padded, ...rsiSeries];
}

function getMACDHistSeries(candles: Candle[]): number[] {
  const closes = candles.map(c => c.close);
  const fast = 12, slow = 26, signal = 9;
  if (closes.length < slow + signal) return new Array(candles.length).fill(0);

  const emaFast = calculateEMA(closes, fast);
  const emaSlow = calculateEMA(closes, slow);
  const macdLine = emaFast.map((v, i) => v - emaSlow[i]);
  const signalLine = calculateEMA(macdLine.slice(slow - 1), signal);
  
  const hist: number[] = new Array(candles.length).fill(0);
  const offset = candles.length - signalLine.length;
  for (let i = 0; i < signalLine.length; i++) {
    hist[offset + i] = macdLine[slow - 1 + i] - signalLine[i];
  }
  return hist;
}

function findIndicatorSwingHighs(values: number[], lookback = 3): { index: number; value: number }[] {
  const points: { index: number; value: number }[] = [];
  for (let i = lookback; i < values.length - lookback; i++) {
    let isHigh = true;
    for (let j = 1; j <= lookback; j++) {
      if (values[i] <= values[i - j] || values[i] <= values[i + j]) { isHigh = false; break; }
    }
    if (isHigh) points.push({ index: i, value: values[i] });
  }
  return points;
}

function findIndicatorSwingLows(values: number[], lookback = 3): { index: number; value: number }[] {
  const points: { index: number; value: number }[] = [];
  for (let i = lookback; i < values.length - lookback; i++) {
    let isLow = true;
    for (let j = 1; j <= lookback; j++) {
      if (values[i] >= values[i - j] || values[i] >= values[i + j]) { isLow = false; break; }
    }
    if (isLow) points.push({ index: i, value: values[i] });
  }
  return points;
}

function detectDivergencesForIndicator(
  candles: Candle[],
  indicatorValues: number[],
  indicatorName: 'RSI' | 'MACD'
): Divergence[] {
  const divergences: Divergence[] = [];
  const priceHighs = findPriceSwingHighs(candles);
  const priceLows = findPriceSwingLows(candles);
  const indHighs = findIndicatorSwingHighs(indicatorValues);
  const indLows = findIndicatorSwingLows(indicatorValues);
  const len = candles.length;

  // Only check recent swing points (last 50 candles)
  const recentThreshold = len - 50;

  // Regular Bullish: Price makes LL, indicator makes HL
  for (let i = 0; i < priceLows.length - 1; i++) {
    const pl1 = priceLows[i];
    const pl2 = priceLows[i + 1];
    if (pl2.index < recentThreshold) continue;
    if (pl2.price < pl1.price) {
      // Find indicator lows near these price lows
      const il1 = indLows.find(il => Math.abs(il.index - pl1.index) <= 3);
      const il2 = indLows.find(il => Math.abs(il.index - pl2.index) <= 3);
      if (il1 && il2 && il2.value > il1.value) {
        const strength = (pl1.price - pl2.price) / pl1.price > 0.02 ? 'strong' : 'moderate';
        divergences.push({
          type: 'regular_bull',
          indicator: indicatorName,
          strength,
          description: `Price made lower low but ${indicatorName} made higher low — bullish reversal signal`,
          startIndex: pl1.index,
          endIndex: pl2.index,
          priceStart: pl1.price,
          priceEnd: pl2.price,
          indicatorStart: il1.value,
          indicatorEnd: il2.value,
        });
      }
    }
  }

  // Regular Bearish: Price makes HH, indicator makes LH
  for (let i = 0; i < priceHighs.length - 1; i++) {
    const ph1 = priceHighs[i];
    const ph2 = priceHighs[i + 1];
    if (ph2.index < recentThreshold) continue;
    if (ph2.price > ph1.price) {
      const ih1 = indHighs.find(ih => Math.abs(ih.index - ph1.index) <= 3);
      const ih2 = indHighs.find(ih => Math.abs(ih.index - ph2.index) <= 3);
      if (ih1 && ih2 && ih2.value < ih1.value) {
        const strength = (ph2.price - ph1.price) / ph1.price > 0.02 ? 'strong' : 'moderate';
        divergences.push({
          type: 'regular_bear',
          indicator: indicatorName,
          strength,
          description: `Price made higher high but ${indicatorName} made lower high — bearish reversal signal`,
          startIndex: ph1.index,
          endIndex: ph2.index,
          priceStart: ph1.price,
          priceEnd: ph2.price,
          indicatorStart: ih1.value,
          indicatorEnd: ih2.value,
        });
      }
    }
  }

  // Hidden Bullish: Price makes HL, indicator makes LL (trend continuation)
  for (let i = 0; i < priceLows.length - 1; i++) {
    const pl1 = priceLows[i];
    const pl2 = priceLows[i + 1];
    if (pl2.index < recentThreshold) continue;
    if (pl2.price > pl1.price) {
      const il1 = indLows.find(il => Math.abs(il.index - pl1.index) <= 3);
      const il2 = indLows.find(il => Math.abs(il.index - pl2.index) <= 3);
      if (il1 && il2 && il2.value < il1.value) {
        divergences.push({
          type: 'hidden_bull',
          indicator: indicatorName,
          strength: 'moderate',
          description: `Price made higher low but ${indicatorName} made lower low — hidden bullish continuation`,
          startIndex: pl1.index,
          endIndex: pl2.index,
          priceStart: pl1.price,
          priceEnd: pl2.price,
          indicatorStart: il1.value,
          indicatorEnd: il2.value,
        });
      }
    }
  }

  // Hidden Bearish: Price makes LH, indicator makes HH
  for (let i = 0; i < priceHighs.length - 1; i++) {
    const ph1 = priceHighs[i];
    const ph2 = priceHighs[i + 1];
    if (ph2.index < recentThreshold) continue;
    if (ph2.price < ph1.price) {
      const ih1 = indHighs.find(ih => Math.abs(ih.index - ph1.index) <= 3);
      const ih2 = indHighs.find(ih => Math.abs(ih.index - ph2.index) <= 3);
      if (ih1 && ih2 && ih2.value > ih1.value) {
        divergences.push({
          type: 'hidden_bear',
          indicator: indicatorName,
          strength: 'moderate',
          description: `Price made lower high but ${indicatorName} made higher high — hidden bearish continuation`,
          startIndex: ph1.index,
          endIndex: ph2.index,
          priceStart: ph1.price,
          priceEnd: ph2.price,
          indicatorStart: ih1.value,
          indicatorEnd: ih2.value,
        });
      }
    }
  }

  return divergences;
}

export function detectDivergences(candles: Candle[]): Divergence[] {
  if (candles.length < 50) return [];

  const rsiValues = getRSISeries(candles);
  const macdValues = getMACDHistSeries(candles);

  const rsiDivs = detectDivergencesForIndicator(candles, rsiValues, 'RSI');
  const macdDivs = detectDivergencesForIndicator(candles, macdValues, 'MACD');

  return [...rsiDivs, ...macdDivs];
}
