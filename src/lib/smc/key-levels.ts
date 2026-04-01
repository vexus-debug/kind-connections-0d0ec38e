import type { Candle } from '@/types/scanner';
import type { KeyLevel, SmcEvent } from './types';

/** Generate key levels from candle data */
export function detectKeyLevels(candles: Candle[]): KeyLevel[] {
  const levels: KeyLevel[] = [];
  if (candles.length < 2) return levels;
  
  const lastPrice = candles[candles.length - 1].close;
  
  // Previous day high/low (approximate from last 24 candles if intraday)
  const dayCandles = candles.slice(-48); // rough
  if (dayCandles.length >= 24) {
    const prevDaySlice = dayCandles.slice(0, 24);
    const pdh = Math.max(...prevDaySlice.map(c => c.high));
    const pdl = Math.min(...prevDaySlice.map(c => c.low));
    levels.push({ price: pdh, name: 'Prev Day High', type: 'pdh' });
    levels.push({ price: pdl, name: 'Prev Day Low', type: 'pdl' });
  }
  
  // Previous week high/low
  if (candles.length >= 168) { // ~1 week of hourly candles
    const prevWeek = candles.slice(-336, -168);
    if (prevWeek.length > 0) {
      const pwh = Math.max(...prevWeek.map(c => c.high));
      const pwl = Math.min(...prevWeek.map(c => c.low));
      levels.push({ price: pwh, name: 'Prev Week High', type: 'pwh' });
      levels.push({ price: pwl, name: 'Prev Week Low', type: 'pwl' });
    }
  }
  
  // Psychological levels (round numbers)
  const magnitude = Math.pow(10, Math.floor(Math.log10(lastPrice)));
  const step = magnitude >= 1000 ? 1000 : magnitude >= 100 ? 100 : magnitude >= 10 ? 10 : magnitude >= 1 ? 1 : 0.1;
  const nearestRound = Math.round(lastPrice / step) * step;
  for (let m = -2; m <= 2; m++) {
    const lvl = nearestRound + m * step;
    if (lvl > 0) {
      levels.push({ price: lvl, name: `$${lvl}`, type: 'psychological' });
    }
  }
  
  return levels;
}

/** Check if price is near a key level */
export function findNearbyKeyLevel(price: number, levels: KeyLevel[], threshold: number = 0.005): KeyLevel | null {
  for (const level of levels) {
    const dist = Math.abs(price - level.price) / price;
    if (dist < threshold) return level;
  }
  return null;
}

/** Count breakout attempts at a level */
export function countBreakoutAttempts(candles: Candle[], level: number, lookback: number = 30): number {
  const start = Math.max(0, candles.length - lookback);
  let attempts = 0;
  let wasBelow = candles[start].close < level;
  
  for (let i = start + 1; i < candles.length; i++) {
    const isBelow = candles[i].close < level;
    if (wasBelow !== isBelow) {
      attempts++;
      wasBelow = isBelow;
    }
  }
  
  return Math.floor(attempts / 2); // each cross-and-return counts as one attempt
}

/** Generate events for key level interactions */
export function detectKeyLevelEvents(candles: Candle[], levels: KeyLevel[]): SmcEvent[] {
  const events: SmcEvent[] = [];
  if (candles.length < 3) return events;
  
  const last = candles[candles.length - 1];
  const prev = candles[candles.length - 2];
  
  for (const level of levels) {
    // Price crossing a key level
    if (prev.close < level.price && last.close > level.price) {
      const attempts = countBreakoutAttempts(candles, level.price);
      events.push({
        name: `Break Above ${level.name}`,
        type: 'bullish',
        significance: attempts >= 3 ? 'high' : 'medium',
        description: `Price broke above ${level.name} ($${level.price.toPrecision(5)}) — ${attempts} prior attempts`,
        candleIndex: candles.length - 1,
        price: level.price,
        meta: { breakAttempts: attempts, nearKeyLevel: true, keyLevelName: level.name },
      });
    } else if (prev.close > level.price && last.close < level.price) {
      const attempts = countBreakoutAttempts(candles, level.price);
      events.push({
        name: `Break Below ${level.name}`,
        type: 'bearish',
        significance: attempts >= 3 ? 'high' : 'medium',
        description: `Price broke below ${level.name} ($${level.price.toPrecision(5)}) — ${attempts} prior attempts`,
        candleIndex: candles.length - 1,
        price: level.price,
        meta: { breakAttempts: attempts, nearKeyLevel: true, keyLevelName: level.name },
      });
    }
  }
  
  return events;
}
