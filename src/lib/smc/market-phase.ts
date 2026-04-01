import type { Candle } from '@/types/scanner';
import type { SwingPoint, MarketPhase, TradingSession, RangeZone, SmcEvent } from './types';

/** Detect the current market phase */
export function detectMarketPhase(candles: Candle[], swings: SwingPoint[], atr: number): MarketPhase {
  if (candles.length < 20) return 'accumulation';
  
  const recent = candles.slice(-20);
  const priceRange = Math.max(...recent.map(c => c.high)) - Math.min(...recent.map(c => c.low));
  const avgClose = recent.reduce((s, c) => s + c.close, 0) / recent.length;
  const rangePercent = avgClose > 0 ? priceRange / avgClose * 100 : 0;
  
  const highs = swings.filter(s => s.type === 'high' && s.index >= candles.length - 20);
  const lows = swings.filter(s => s.type === 'low' && s.index >= candles.length - 20);
  
  // Check for directional movement
  const firstClose = recent[0].close;
  const lastClose = recent[recent.length - 1].close;
  const netMove = (lastClose - firstClose) / firstClose * 100;
  
  // Expansion: strong directional move with wide range
  if (Math.abs(netMove) > 2 && rangePercent > atr / avgClose * 200) {
    return 'expansion';
  }
  
  // Retracement: counter-trend move (check last 5 vs previous 15)
  const prevDir = recent[14].close - recent[0].close;
  const recentDir = recent[19].close - recent[14].close;
  if (prevDir * recentDir < 0 && Math.abs(recentDir) < Math.abs(prevDir) * 0.7) {
    return 'retracement';
  }
  
  // Distribution: HH/HL breaking down or LH/LL forming at highs
  if (highs.length >= 2 && lows.length >= 2) {
    const lastHighs = highs.slice(-2);
    const lastLows = lows.slice(-2);
    if (lastHighs[1].price < lastHighs[0].price && lastLows[1].price < lastLows[0].price) {
      return 'distribution';
    }
  }
  
  return 'accumulation';
}

/** Detect consolidation ranges */
export function detectRange(candles: Candle[], atr: number): RangeZone | null {
  if (candles.length < 20) return null;
  
  const lookback = Math.min(50, candles.length);
  const recent = candles.slice(-lookback);
  const high = Math.max(...recent.map(c => c.high));
  const low = Math.min(...recent.map(c => c.low));
  const range = high - low;
  const avgClose = recent.reduce((s, c) => s + c.close, 0) / recent.length;
  
  // If range is less than 3x ATR, it's a consolidation
  if (range < atr * 3) {
    // Count touches of high and low zones
    const zoneTolerance = range * 0.15;
    let touches = 0;
    for (const c of recent) {
      if (c.high > high - zoneTolerance || c.low < low + zoneTolerance) touches++;
    }
    
    if (touches >= 4) {
      return {
        high,
        low,
        startIndex: candles.length - lookback,
        endIndex: candles.length - 1,
        touches,
      };
    }
  }
  
  return null;
}

/** Determine range position of current price */
export function getRangePosition(price: number, range: RangeZone | null): 'upper' | 'middle' | 'lower' | 'outside' {
  if (!range) return 'outside';
  const rangeSize = range.high - range.low;
  if (price > range.high || price < range.low) return 'outside';
  const position = (price - range.low) / rangeSize;
  if (position > 0.7) return 'upper';
  if (position < 0.3) return 'lower';
  return 'middle';
}

/** Detect range events */
export function detectRangeEvents(candles: Candle[], range: RangeZone | null): SmcEvent[] {
  if (!range) return [];
  const events: SmcEvent[] = [];
  const lastCandle = candles[candles.length - 1];
  const pos = getRangePosition(lastCandle.close, range);
  
  if (pos !== 'outside') {
    events.push({
      name: 'Range Detected',
      type: 'neutral',
      significance: 'medium',
      description: `Consolidation $${range.low.toPrecision(5)} – $${range.high.toPrecision(5)} (${range.touches} touches)`,
      candleIndex: candles.length - 1,
      price: (range.high + range.low) / 2,
      zone: { high: range.high, low: range.low },
      meta: { rangePosition: pos },
    });
  }
  
  return events;
}

/** Get the current trading session based on UTC hour */
export function detectSession(timestamp?: number): TradingSession {
  const d = timestamp ? new Date(timestamp) : new Date();
  const hour = d.getUTCHours();
  
  if (hour >= 0 && hour < 8) return 'asian';     // 00:00-08:00 UTC
  if (hour >= 7 && hour < 16) return 'london';    // 07:00-16:00 UTC
  if (hour >= 13 && hour < 22) return 'new_york'; // 13:00-22:00 UTC
  return 'off_hours';
}

/** Get session weight for signal quality */
export function getSessionWeight(session: TradingSession): number {
  switch (session) {
    case 'london': return 1.2;
    case 'new_york': return 1.15;
    case 'asian': return 0.9;
    case 'off_hours': return 0.7;
  }
}
