import type { Candle } from '@/types/scanner';
import type { SwingPoint } from './types';

export function findSwings(candles: Candle[], lookback: number = 3): SwingPoint[] {
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

/** Find clustered swing points near the same price level */
export function findClusteredSwings(swings: SwingPoint[], threshold: number = 0.003): SwingPoint[][] {
  const clusters: SwingPoint[][] = [];
  const used = new Set<number>();

  for (let i = 0; i < swings.length; i++) {
    if (used.has(i)) continue;
    const cluster: SwingPoint[] = [swings[i]];
    used.add(i);
    for (let j = i + 1; j < swings.length; j++) {
      if (used.has(j)) continue;
      if (swings[j].type !== swings[i].type) continue;
      const diff = Math.abs(swings[j].price - swings[i].price) / swings[i].price;
      if (diff < threshold) {
        cluster.push(swings[j]);
        used.add(j);
      }
    }
    if (cluster.length >= 2) {
      clusters.push(cluster);
    }
  }
  return clusters;
}
