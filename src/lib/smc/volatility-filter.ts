import type { Candle } from '@/types/scanner';
import type { SmcEvent } from './types';
import { calculateTR, smoothedAvg } from '@/lib/indicators/trend';

/** Calculate ATR for a candle series */
export function calcATR(candles: Candle[], period: number = 14): number {
  if (candles.length < period) return 0;
  const tr = calculateTR(candles);
  const atr = smoothedAvg(tr, period);
  return atr[atr.length - 1] || 0;
}

/** Check if volatility is sufficient for reliable signals */
export function isVolatilityOk(candles: Candle[], atr: number): boolean {
  if (candles.length < 20) return true;
  const avgClose = candles.slice(-20).reduce((s, c) => s + c.close, 0) / 20;
  const atrPercent = avgClose > 0 ? (atr / avgClose) * 100 : 0;
  // Minimum 0.3% ATR relative to price for meaningful signals
  return atrPercent > 0.3;
}

/** Detect volatility expansion: transition from low to high volatility */
export function detectVolatilityExpansion(candles: Candle[]): { expansion: boolean; events: SmcEvent[] } {
  const events: SmcEvent[] = [];
  if (candles.length < 30) return { expansion: false, events };
  
  // Compare recent ATR (5 candles) vs lookback ATR (20 candles)
  const recentCandles = candles.slice(-5);
  const lookbackCandles = candles.slice(-25, -5);
  
  const recentTR = recentCandles.reduce((s, c) => s + (c.high - c.low), 0) / recentCandles.length;
  const lookbackTR = lookbackCandles.reduce((s, c) => s + (c.high - c.low), 0) / lookbackCandles.length;
  
  const expansion = lookbackTR > 0 && recentTR / lookbackTR > 1.8;
  
  if (expansion) {
    const ratio = (recentTR / lookbackTR).toFixed(1);
    events.push({
      name: 'Volatility Expansion',
      type: 'neutral',
      significance: 'high',
      description: `Range expanded ${ratio}x — potential start of directional move`,
      candleIndex: candles.length - 1,
      price: candles[candles.length - 1].close,
      meta: { volatilityExpansion: true },
    });
  }
  
  return { expansion, events };
}
