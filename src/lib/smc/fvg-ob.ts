import type { Candle } from '@/types/scanner';
import type { SmcEvent } from './types';

/** Detect Fair Value Gaps with imbalance strength */
export function detectFVGs(candles: Candle[]): SmcEvent[] {
  const events: SmcEvent[] = [];
  const start = Math.max(1, candles.length - 25);

  for (let i = start; i < candles.length - 1; i++) {
    const c0 = candles[i - 1];
    const c2 = candles[i + 1];

    // Bullish FVG
    if (c2.low > c0.high) {
      const gapSize = c2.low - c0.high;
      const avgRange = (c0.high - c0.low + c2.high - c2.low) / 2;
      const strength = avgRange > 0 ? Math.min(100, Math.round((gapSize / avgRange) * 50)) : 50;
      events.push({
        name: 'Bullish FVG',
        type: 'bullish',
        significance: strength > 60 ? 'high' : 'medium',
        description: `Gap $${c0.high.toPrecision(5)} → $${c2.low.toPrecision(5)} — strength ${strength}/100`,
        candleIndex: i,
        price: (c0.high + c2.low) / 2,
        zone: { high: c2.low, low: c0.high },
        meta: { momentum: strength },
      });
    }

    // Bearish FVG
    if (c2.high < c0.low) {
      const gapSize = c0.low - c2.high;
      const avgRange = (c0.high - c0.low + c2.high - c2.low) / 2;
      const strength = avgRange > 0 ? Math.min(100, Math.round((gapSize / avgRange) * 50)) : 50;
      events.push({
        name: 'Bearish FVG',
        type: 'bearish',
        significance: strength > 60 ? 'high' : 'medium',
        description: `Gap $${c2.high.toPrecision(5)} → $${c0.low.toPrecision(5)} — strength ${strength}/100`,
        candleIndex: i,
        price: (c0.low + c2.high) / 2,
        zone: { high: c0.low, low: c2.high },
        meta: { momentum: strength },
      });
    }
  }
  return events;
}

/** Detect Order Blocks with volume confirmation */
export function detectOrderBlocks(candles: Candle[]): SmcEvent[] {
  const events: SmcEvent[] = [];
  const start = Math.max(1, candles.length - 20);

  for (let i = start; i < candles.length - 2; i++) {
    const c = candles[i];
    const next = candles[i + 1];
    const next2 = candles[i + 2];
    const avgVol = candles.slice(Math.max(0, i - 10), i).reduce((s, x) => s + x.volume, 0) / 10;
    const volRatio = avgVol > 0 ? next.volume / avgVol : 1;

    // Bullish OB: bearish candle followed by strong bullish move
    if (c.close < c.open && next.close > c.high && next2.close > next.close) {
      const sig = volRatio > 1.5 ? 'high' : 'medium';
      events.push({
        name: 'Bullish Order Block',
        type: 'bullish',
        significance: sig,
        description: `Demand zone $${c.low.toPrecision(5)} – $${c.high.toPrecision(5)} (vol ${volRatio.toFixed(1)}x)`,
        candleIndex: i,
        price: c.low,
        zone: { high: c.high, low: c.low },
        meta: { momentum: Math.min(100, Math.round(volRatio * 33)) },
      });
    }

    // Bearish OB
    if (c.close > c.open && next.close < c.low && next2.close < next.close) {
      const sig = volRatio > 1.5 ? 'high' : 'medium';
      events.push({
        name: 'Bearish Order Block',
        type: 'bearish',
        significance: sig,
        description: `Supply zone $${c.low.toPrecision(5)} – $${c.high.toPrecision(5)} (vol ${volRatio.toFixed(1)}x)`,
        candleIndex: i,
        price: c.high,
        zone: { high: c.high, low: c.low },
        meta: { momentum: Math.min(100, Math.round(volRatio * 33)) },
      });
    }
  }
  return events;
}
