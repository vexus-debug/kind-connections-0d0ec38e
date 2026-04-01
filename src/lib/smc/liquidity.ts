import type { Candle } from '@/types/scanner';
import type { SwingPoint, SmcEvent, LiquidityPool } from './types';
import { findClusteredSwings } from './swings';

/** Detect liquidity pools: equal highs, equal lows, and clustered swings */
export function detectLiquidityPools(candles: Candle[], swings: SwingPoint[]): { events: SmcEvent[]; pools: LiquidityPool[] } {
  const events: SmcEvent[] = [];
  const pools: LiquidityPool[] = [];
  const highs = swings.filter(s => s.type === 'high');
  const lows = swings.filter(s => s.type === 'low');

  // Equal highs
  const highClusters = findClusteredSwings(highs, 0.003);
  for (const cluster of highClusters) {
    const avgPrice = cluster.reduce((s, p) => s + p.price, 0) / cluster.length;
    const lastIdx = Math.max(...cluster.map(c => c.index));
    pools.push({ price: avgPrice, type: 'above', strength: cluster.length, indices: cluster.map(c => c.index) });
    events.push({
      name: 'Equal Highs (Liquidity)',
      type: 'bearish',
      significance: cluster.length >= 3 ? 'high' : 'medium',
      description: `${cluster.length} equal highs at ~$${avgPrice.toPrecision(5)} — liquidity above`,
      candleIndex: lastIdx,
      price: avgPrice,
      meta: { breakAttempts: cluster.length },
    });
  }

  // Equal lows
  const lowClusters = findClusteredSwings(lows, 0.003);
  for (const cluster of lowClusters) {
    const avgPrice = cluster.reduce((s, p) => s + p.price, 0) / cluster.length;
    const lastIdx = Math.max(...cluster.map(c => c.index));
    pools.push({ price: avgPrice, type: 'below', strength: cluster.length, indices: cluster.map(c => c.index) });
    events.push({
      name: 'Equal Lows (Liquidity)',
      type: 'bullish',
      significance: cluster.length >= 3 ? 'high' : 'medium',
      description: `${cluster.length} equal lows at ~$${avgPrice.toPrecision(5)} — liquidity below`,
      candleIndex: lastIdx,
      price: avgPrice,
      meta: { breakAttempts: cluster.length },
    });
  }

  return { events, pools };
}

/** Detect liquidity sweeps: price moves beyond a pool then quickly reverses */
export function detectLiquiditySweeps(candles: Candle[], pools: LiquidityPool[]): SmcEvent[] {
  const events: SmcEvent[] = [];
  const recent = candles.length - 8;

  for (const pool of pools) {
    for (let i = Math.max(recent, 0); i < candles.length; i++) {
      if (pool.type === 'above') {
        // Price wicked above pool level then closed below
        if (candles[i].high > pool.price && candles[i].close < pool.price) {
          events.push({
            name: 'Liquidity Sweep (Above)',
            type: 'bearish',
            significance: 'high',
            description: `Swept liquidity above $${pool.price.toPrecision(5)} and reversed — stop hunt detected`,
            candleIndex: i,
            price: pool.price,
            meta: { liquiditySweep: true },
          });
          break;
        }
      } else {
        // Price wicked below pool level then closed above
        if (candles[i].low < pool.price && candles[i].close > pool.price) {
          events.push({
            name: 'Liquidity Sweep (Below)',
            type: 'bullish',
            significance: 'high',
            description: `Swept liquidity below $${pool.price.toPrecision(5)} and reversed — stop hunt detected`,
            candleIndex: i,
            price: pool.price,
            meta: { liquiditySweep: true },
          });
          break;
        }
      }
    }
  }

  return events;
}

/** Detect inducement: internal liquidity taken before a real move */
export function detectInducement(candles: Candle[], swings: SwingPoint[]): SmcEvent[] {
  const events: SmcEvent[] = [];
  if (swings.length < 4) return events;

  // Look for minor swing break (inducement) followed by reversal
  const recent = swings.slice(-6);
  for (let i = 1; i < recent.length - 1; i++) {
    const prev = recent[i - 1];
    const curr = recent[i];
    const next = recent[i + 1];

    // Bullish inducement: minor low broken then price reverses up
    if (prev.type === 'low' && curr.type === 'low' && curr.price < prev.price && next.type === 'high') {
      const recoveredAbove = next.price > prev.price;
      if (recoveredAbove && curr.index >= candles.length - 15) {
        events.push({
          name: 'Bullish Inducement',
          type: 'bullish',
          significance: 'medium',
          description: `Internal liquidity taken at $${curr.price.toPrecision(5)} before reversal up`,
          candleIndex: curr.index,
          price: curr.price,
          meta: { isInducement: true },
        });
      }
    }

    // Bearish inducement
    if (prev.type === 'high' && curr.type === 'high' && curr.price > prev.price && next.type === 'low') {
      const recoveredBelow = next.price < prev.price;
      if (recoveredBelow && curr.index >= candles.length - 15) {
        events.push({
          name: 'Bearish Inducement',
          type: 'bearish',
          significance: 'medium',
          description: `Internal liquidity taken at $${curr.price.toPrecision(5)} before reversal down`,
          candleIndex: curr.index,
          price: curr.price,
          meta: { isInducement: true },
        });
      }
    }
  }

  return events;
}
