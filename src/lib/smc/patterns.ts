import type { Candle } from '@/types/scanner';
import type { SwingPoint, SmcEvent, LiquidityPool } from './types';

/** Detect trap patterns (false BOS that traps traders) */
export function detectTrapPatterns(candles: Candle[], swings: SwingPoint[]): SmcEvent[] {
  const events: SmcEvent[] = [];
  const highs = swings.filter(s => s.type === 'high');
  const lows = swings.filter(s => s.type === 'low');
  const recent = candles.length - 10;
  
  // Bull trap: breaks above resistance then reverses sharply
  for (let i = Math.max(0, highs.length - 3); i < highs.length; i++) {
    const h = highs[i];
    for (let j = h.index + 1; j < candles.length; j++) {
      if (candles[j].high > h.price) {
        // Check if it reversed within 3 candles
        let reversed = false;
        for (let k = j + 1; k < Math.min(j + 4, candles.length); k++) {
          if (candles[k].close < h.price) {
            reversed = true;
            if (k >= recent) {
              events.push({
                name: 'Bull Trap',
                type: 'bearish',
                significance: 'high',
                description: `False breakout above $${h.price.toPrecision(5)} — trapped longs`,
                candleIndex: k,
                price: h.price,
                meta: { isTrap: true },
              });
            }
            break;
          }
        }
        if (reversed) break;
        break; // only check first break
      }
    }
  }
  
  // Bear trap: breaks below support then reverses
  for (let i = Math.max(0, lows.length - 3); i < lows.length; i++) {
    const l = lows[i];
    for (let j = l.index + 1; j < candles.length; j++) {
      if (candles[j].low < l.price) {
        let reversed = false;
        for (let k = j + 1; k < Math.min(j + 4, candles.length); k++) {
          if (candles[k].close > l.price) {
            reversed = true;
            if (k >= recent) {
              events.push({
                name: 'Bear Trap',
                type: 'bullish',
                significance: 'high',
                description: `False breakdown below $${l.price.toPrecision(5)} — trapped shorts`,
                candleIndex: k,
                price: l.price,
                meta: { isTrap: true },
              });
            }
            break;
          }
        }
        if (reversed) break;
        break;
      }
    }
  }
  
  return events;
}

/** Detect reversal sequences: liquidity sweep → CHoCH → BOS */
export function detectReversalPatterns(candles: Candle[], swings: SwingPoint[], pools: LiquidityPool[]): SmcEvent[] {
  const events: SmcEvent[] = [];
  const highs = swings.filter(s => s.type === 'high');
  const lows = swings.filter(s => s.type === 'low');
  
  if (lows.length < 3 || highs.length < 2) return events;
  
  // Bullish reversal: sweep below lows → CHoCH up → BOS up
  const lastLows = lows.slice(-3);
  if (lastLows[1].price < lastLows[0].price) {
    // Check for sweep (wick below)
    const sweepCandle = candles[lastLows[1].index];
    const closedAbove = sweepCandle && sweepCandle.close > lastLows[0].price;
    
    // Check for CHoCH after
    const lastHighs = highs.slice(-2);
    if (lastHighs.length >= 2 && lastHighs[1].price > lastHighs[0].price && lastHighs[1].index > lastLows[1].index) {
      if (lastHighs[1].index >= candles.length - 10) {
        events.push({
          name: 'Bullish Reversal Sequence',
          type: 'bullish',
          significance: 'high',
          description: 'Liquidity sweep → CHoCH → structure shift bullish',
          candleIndex: lastHighs[1].index,
          price: lastHighs[1].price,
          meta: { isReversal: true, liquiditySweep: closedAbove },
        });
      }
    }
  }
  
  // Bearish reversal
  const lastHighs = highs.slice(-3);
  if (lastHighs.length >= 3 && lastHighs[1].price > lastHighs[0].price) {
    const sweepCandle = candles[lastHighs[1].index];
    const closedBelow = sweepCandle && sweepCandle.close < lastHighs[0].price;
    
    const lastLows2 = lows.slice(-2);
    if (lastLows2.length >= 2 && lastLows2[1].price < lastLows2[0].price && lastLows2[1].index > lastHighs[1].index) {
      if (lastLows2[1].index >= candles.length - 10) {
        events.push({
          name: 'Bearish Reversal Sequence',
          type: 'bearish',
          significance: 'high',
          description: 'Liquidity sweep → CHoCH → structure shift bearish',
          candleIndex: lastLows2[1].index,
          price: lastLows2[1].price,
          meta: { isReversal: true, liquiditySweep: closedBelow },
        });
      }
    }
  }
  
  return events;
}
