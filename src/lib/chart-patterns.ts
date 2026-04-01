import type { Candle } from '@/types/scanner';

export interface ChartPattern {
  name: string;
  type: 'bullish' | 'bearish' | 'neutral';
  significance: 'high' | 'medium' | 'low';
  description: string;
  startIndex: number;
  endIndex: number;
}

interface SwingPoint {
  index: number;
  price: number;
  type: 'high' | 'low';
}

function findSwingPoints(candles: Candle[], lookback: number = 3): SwingPoint[] {
  const points: SwingPoint[] = [];
  for (let i = lookback; i < candles.length - lookback; i++) {
    let isHigh = true;
    let isLow = true;
    for (let j = 1; j <= lookback; j++) {
      if (candles[i].high <= candles[i - j].high || candles[i].high <= candles[i + j].high) isHigh = false;
      if (candles[i].low >= candles[i - j].low || candles[i].low >= candles[i + j].low) isLow = false;
    }
    if (isHigh) points.push({ index: i, price: candles[i].high, type: 'high' });
    if (isLow) points.push({ index: i, price: candles[i].low, type: 'low' });
  }
  return points;
}

function pctDiff(a: number, b: number): number {
  return Math.abs(a - b) / Math.max(a, b) * 100;
}

export function detectChartPatterns(candles: Candle[]): ChartPattern[] {
  if (candles.length < 30) return [];

  const patterns: ChartPattern[] = [];
  const swings = findSwingPoints(candles, 3);
  const highs = swings.filter(s => s.type === 'high');
  const lows = swings.filter(s => s.type === 'low');

  // === Double Top ===
  for (let i = 0; i < highs.length - 1; i++) {
    const h1 = highs[i];
    const h2 = highs[i + 1];
    if (h2.index - h1.index >= 5 && pctDiff(h1.price, h2.price) < 1.5) {
      // Check for valley between
      const valley = lows.find(l => l.index > h1.index && l.index < h2.index);
      if (valley && valley.price < h1.price * 0.97) {
        patterns.push({
          name: 'Double Top',
          type: 'bearish',
          significance: 'high',
          description: `Two peaks at ~$${h1.price.toPrecision(5)} with neckline valley`,
          startIndex: h1.index,
          endIndex: h2.index,
        });
      }
    }
  }

  // === Double Bottom ===
  for (let i = 0; i < lows.length - 1; i++) {
    const l1 = lows[i];
    const l2 = lows[i + 1];
    if (l2.index - l1.index >= 5 && pctDiff(l1.price, l2.price) < 1.5) {
      const peak = highs.find(h => h.index > l1.index && h.index < l2.index);
      if (peak && peak.price > l1.price * 1.03) {
        patterns.push({
          name: 'Double Bottom',
          type: 'bullish',
          significance: 'high',
          description: `Two troughs at ~$${l1.price.toPrecision(5)} with neckline peak`,
          startIndex: l1.index,
          endIndex: l2.index,
        });
      }
    }
  }

  // === Head and Shoulders ===
  for (let i = 0; i < highs.length - 2; i++) {
    const ls = highs[i]; // left shoulder
    const hd = highs[i + 1]; // head
    const rs = highs[i + 2]; // right shoulder
    if (hd.price > ls.price && hd.price > rs.price &&
      pctDiff(ls.price, rs.price) < 3 &&
      hd.price > ls.price * 1.02) {
      patterns.push({
        name: 'Head & Shoulders',
        type: 'bearish',
        significance: 'high',
        description: `Head at $${hd.price.toPrecision(5)}, shoulders at ~$${ls.price.toPrecision(5)}`,
        startIndex: ls.index,
        endIndex: rs.index,
      });
    }
  }

  // === Inverse Head and Shoulders ===
  for (let i = 0; i < lows.length - 2; i++) {
    const ls = lows[i];
    const hd = lows[i + 1];
    const rs = lows[i + 2];
    if (hd.price < ls.price && hd.price < rs.price &&
      pctDiff(ls.price, rs.price) < 3 &&
      hd.price < ls.price * 0.98) {
      patterns.push({
        name: 'Inverse H&S',
        type: 'bullish',
        significance: 'high',
        description: `Head at $${hd.price.toPrecision(5)}, shoulders at ~$${ls.price.toPrecision(5)}`,
        startIndex: ls.index,
        endIndex: rs.index,
      });
    }
  }

  // === Ascending Triangle ===
  if (highs.length >= 2 && lows.length >= 2) {
    const recentHighs = highs.slice(-3);
    const recentLows = lows.slice(-3);
    const flatTop = recentHighs.length >= 2 && pctDiff(recentHighs[0].price, recentHighs[recentHighs.length - 1].price) < 1;
    const risingLows = recentLows.length >= 2 && recentLows[recentLows.length - 1].price > recentLows[0].price * 1.01;
    if (flatTop && risingLows) {
      patterns.push({
        name: 'Ascending Triangle',
        type: 'bullish',
        significance: 'high',
        description: `Flat resistance ~$${recentHighs[0].price.toPrecision(5)} with rising support`,
        startIndex: Math.min(recentHighs[0].index, recentLows[0].index),
        endIndex: candles.length - 1,
      });
    }
  }

  // === Descending Triangle ===
  if (highs.length >= 2 && lows.length >= 2) {
    const recentHighs = highs.slice(-3);
    const recentLows = lows.slice(-3);
    const fallingHighs = recentHighs.length >= 2 && recentHighs[recentHighs.length - 1].price < recentHighs[0].price * 0.99;
    const flatBottom = recentLows.length >= 2 && pctDiff(recentLows[0].price, recentLows[recentLows.length - 1].price) < 1;
    if (fallingHighs && flatBottom) {
      patterns.push({
        name: 'Descending Triangle',
        type: 'bearish',
        significance: 'high',
        description: `Flat support ~$${recentLows[0].price.toPrecision(5)} with falling resistance`,
        startIndex: Math.min(recentHighs[0].index, recentLows[0].index),
        endIndex: candles.length - 1,
      });
    }
  }

  // === Symmetrical Triangle (wedge) ===
  if (highs.length >= 2 && lows.length >= 2) {
    const recentHighs = highs.slice(-3);
    const recentLows = lows.slice(-3);
    const fallingHighs = recentHighs.length >= 2 && recentHighs[recentHighs.length - 1].price < recentHighs[0].price * 0.99;
    const risingLows = recentLows.length >= 2 && recentLows[recentLows.length - 1].price > recentLows[0].price * 1.01;
    if (fallingHighs && risingLows) {
      patterns.push({
        name: 'Symmetrical Triangle',
        type: 'neutral',
        significance: 'medium',
        description: 'Converging trendlines — breakout imminent',
        startIndex: Math.min(recentHighs[0].index, recentLows[0].index),
        endIndex: candles.length - 1,
      });
    }
  }

  // === Rising Wedge (bearish) ===
  if (highs.length >= 2 && lows.length >= 2) {
    const rh = highs.slice(-3);
    const rl = lows.slice(-3);
    const risingH = rh.length >= 2 && rh[rh.length - 1].price > rh[0].price * 1.01;
    const risingL = rl.length >= 2 && rl[rl.length - 1].price > rl[0].price * 1.01;
    const convergence = risingH && risingL &&
      (rh[rh.length - 1].price - rl[rl.length - 1].price) < (rh[0].price - rl[0].price) * 0.8;
    if (convergence) {
      patterns.push({
        name: 'Rising Wedge',
        type: 'bearish',
        significance: 'medium',
        description: 'Both lines rising but converging — bearish reversal likely',
        startIndex: Math.min(rh[0].index, rl[0].index),
        endIndex: candles.length - 1,
      });
    }
  }

  // === Falling Wedge (bullish) ===
  if (highs.length >= 2 && lows.length >= 2) {
    const rh = highs.slice(-3);
    const rl = lows.slice(-3);
    const fallingH = rh.length >= 2 && rh[rh.length - 1].price < rh[0].price * 0.99;
    const fallingL = rl.length >= 2 && rl[rl.length - 1].price < rl[0].price * 0.99;
    const convergence = fallingH && fallingL &&
      (rh[rh.length - 1].price - rl[rl.length - 1].price) < (rh[0].price - rl[0].price) * 0.8;
    if (convergence) {
      patterns.push({
        name: 'Falling Wedge',
        type: 'bullish',
        significance: 'medium',
        description: 'Both lines falling but converging — bullish reversal likely',
        startIndex: Math.min(rh[0].index, rl[0].index),
        endIndex: candles.length - 1,
      });
    }
  }

  // === Channel Up ===
  if (highs.length >= 2 && lows.length >= 2) {
    const rh = highs.slice(-3);
    const rl = lows.slice(-3);
    const risingH = rh.length >= 2 && rh[rh.length - 1].price > rh[0].price * 1.01;
    const risingL = rl.length >= 2 && rl[rl.length - 1].price > rl[0].price * 1.01;
    const parallel = risingH && risingL &&
      pctDiff(rh[rh.length - 1].price - rl[rl.length - 1].price, rh[0].price - rl[0].price) < 20;
    if (parallel) {
      patterns.push({
        name: 'Ascending Channel',
        type: 'bullish',
        significance: 'medium',
        description: 'Parallel upward channel — trend continuation',
        startIndex: Math.min(rh[0].index, rl[0].index),
        endIndex: candles.length - 1,
      });
    }
  }

  // === Channel Down ===
  if (highs.length >= 2 && lows.length >= 2) {
    const rh = highs.slice(-3);
    const rl = lows.slice(-3);
    const fallingH = rh.length >= 2 && rh[rh.length - 1].price < rh[0].price * 0.99;
    const fallingL = rl.length >= 2 && rl[rl.length - 1].price < rl[0].price * 0.99;
    const parallel = fallingH && fallingL &&
      pctDiff(rh[rh.length - 1].price - rl[rl.length - 1].price, rh[0].price - rl[0].price) < 20;
    if (parallel) {
      patterns.push({
        name: 'Descending Channel',
        type: 'bearish',
        significance: 'medium',
        description: 'Parallel downward channel — trend continuation',
        startIndex: Math.min(rh[0].index, rl[0].index),
        endIndex: candles.length - 1,
      });
    }
  }

  return patterns;
}
