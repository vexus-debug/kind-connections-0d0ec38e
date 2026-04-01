import type { Candle } from '@/types/scanner';

export interface CandlestickPattern {
  name: string;
  type: 'bullish' | 'bearish' | 'neutral';
  significance: 'high' | 'medium' | 'low';
  candleIndex: number; // index in candles array where pattern ends
  description: string;
}

function bodySize(c: Candle): number {
  return Math.abs(c.close - c.open);
}

function upperWick(c: Candle): number {
  return c.high - Math.max(c.open, c.close);
}

function lowerWick(c: Candle): number {
  return Math.min(c.open, c.close) - c.low;
}

function isBullish(c: Candle): boolean {
  return c.close > c.open;
}

function isBearish(c: Candle): boolean {
  return c.close < c.open;
}

function range(c: Candle): number {
  return c.high - c.low;
}

function avgBody(candles: Candle[], lookback: number = 10): number {
  const slice = candles.slice(-lookback);
  return slice.reduce((s, c) => s + bodySize(c), 0) / slice.length;
}

/**
 * Detect candlestick patterns on CLOSED candles only.
 * Pass excludeLastCandle=true (default) to drop the still-forming candle.
 */
export function detectCandlestickPatterns(candles: Candle[], excludeLastCandle = true): CandlestickPattern[] {
  const data = excludeLastCandle ? candles.slice(0, -1) : candles;
  if (data.length < 5) return [];

  const patterns: CandlestickPattern[] = [];
  const len = data.length;
  const avg = avgBody(data, 14);

  // Only check last 3 candles for current patterns
  for (let i = Math.max(2, len - 3); i < len; i++) {
    const c = data[i];
    const prev = data[i - 1];
    const prev2 = i >= 2 ? data[i - 2] : null;
    const r = range(c);
    const body = bodySize(c);

    // === Single candle patterns ===

    // Doji
    if (body < r * 0.1 && r > 0) {
      patterns.push({ name: 'Doji', type: 'neutral', significance: 'medium', candleIndex: i, description: 'Indecision — open ≈ close. Wait for the next candle to confirm direction before entering.' });
    }

    // Hammer (bullish reversal at bottom)
    if (lowerWick(c) > body * 2 && upperWick(c) < body * 0.5 && isBearish(prev)) {
      patterns.push({ name: 'Hammer', type: 'bullish', significance: 'high', candleIndex: i, description: 'Bullish reversal — long lower wick shows buyers stepping in. Enter long on next candle close above hammer high. Stop below hammer low. Target: 1:2 RR or next resistance.' });
    }

    // Inverted Hammer
    if (upperWick(c) > body * 2 && lowerWick(c) < body * 0.5 && isBearish(prev)) {
      patterns.push({ name: 'Inverted Hammer', type: 'bullish', significance: 'medium', candleIndex: i, description: 'Potential bullish reversal after downtrend. Confirm with next bullish candle close. Enter long above high, stop below low.' });
    }

    // Shooting Star (bearish reversal at top)
    if (upperWick(c) > body * 2 && lowerWick(c) < body * 0.5 && isBullish(prev)) {
      patterns.push({ name: 'Shooting Star', type: 'bearish', significance: 'high', candleIndex: i, description: 'Bearish reversal — long upper wick at top shows rejection. Enter short on break below low. Stop above high. Target: 1:2 RR or next support.' });
    }

    // Hanging Man
    if (lowerWick(c) > body * 2 && upperWick(c) < body * 0.5 && isBullish(prev)) {
      patterns.push({ name: 'Hanging Man', type: 'bearish', significance: 'medium', candleIndex: i, description: 'Bearish reversal at top of uptrend. Confirm with next bearish close. Enter short below low, stop above high.' });
    }

    // Marubozu (strong momentum)
    if (body > avg * 1.5 && upperWick(c) < body * 0.05 && lowerWick(c) < body * 0.05) {
      patterns.push({
        name: isBullish(c) ? 'Bullish Marubozu' : 'Bearish Marubozu',
        type: isBullish(c) ? 'bullish' : 'bearish',
        significance: 'high',
        candleIndex: i,
        description: 'Strong momentum — no wicks. Trade in the direction of the candle. Can enter on pullback to candle midpoint with stop at opposite end.',
      });
    }

    // Spinning Top
    if (body < r * 0.3 && upperWick(c) > body && lowerWick(c) > body && r > avg * 0.5) {
      patterns.push({ name: 'Spinning Top', type: 'neutral', significance: 'low', candleIndex: i, description: 'Indecision with equal wicks' });
    }

    // === Two candle patterns ===

    // Bullish Engulfing
    if (isBullish(c) && isBearish(prev) && c.open <= prev.close && c.close >= prev.open && body > bodySize(prev)) {
      patterns.push({ name: 'Bullish Engulfing', type: 'bullish', significance: 'high', candleIndex: i, description: 'Bull candle fully engulfs prior bear. Strong reversal signal. Enter long above high, stop below engulfing low. Target nearest resistance or 1:2 RR.' });
    }

    // Bearish Engulfing
    if (isBearish(c) && isBullish(prev) && c.open >= prev.close && c.close <= prev.open && body > bodySize(prev)) {
      patterns.push({ name: 'Bearish Engulfing', type: 'bearish', significance: 'high', candleIndex: i, description: 'Bear candle fully engulfs prior bull. Strong reversal signal. Enter short below low, stop above engulfing high. Target nearest support or 1:2 RR.' });
    }

    // Piercing Line
    if (isBullish(c) && isBearish(prev) && c.open < prev.low && c.close > (prev.open + prev.close) / 2 && c.close < prev.open) {
      patterns.push({ name: 'Piercing Line', type: 'bullish', significance: 'medium', candleIndex: i, description: 'Bull candle closes above midpoint of prior bear. Enter long on confirmation, stop below pattern low.' });
    }

    // Dark Cloud Cover
    if (isBearish(c) && isBullish(prev) && c.open > prev.high && c.close < (prev.open + prev.close) / 2 && c.close > prev.open) {
      patterns.push({ name: 'Dark Cloud Cover', type: 'bearish', significance: 'medium', candleIndex: i, description: 'Bear candle closes below midpoint of prior bull. Enter short on confirmation, stop above pattern high.' });
    }

    // Tweezer Bottom
    if (isBullish(c) && isBearish(prev) && Math.abs(c.low - prev.low) / avg < 0.05) {
      patterns.push({ name: 'Tweezer Bottom', type: 'bullish', significance: 'medium', candleIndex: i, description: 'Equal lows — potential reversal up' });
    }

    // Tweezer Top
    if (isBearish(c) && isBullish(prev) && Math.abs(c.high - prev.high) / avg < 0.05) {
      patterns.push({ name: 'Tweezer Top', type: 'bearish', significance: 'medium', candleIndex: i, description: 'Equal highs — potential reversal down' });
    }

    // === Three candle patterns ===
    if (prev2) {
      // Morning Star
      if (isBearish(prev2) && bodySize(prev) < avg * 0.3 && isBullish(c) && c.close > (prev2.open + prev2.close) / 2) {
        patterns.push({ name: 'Morning Star', type: 'bullish', significance: 'high', candleIndex: i, description: 'Three-candle bullish reversal (bear → small body → bull). Enter long above third candle high. Stop below pattern low. High reliability at support.' });
      }

      // Evening Star
      if (isBullish(prev2) && bodySize(prev) < avg * 0.3 && isBearish(c) && c.close < (prev2.open + prev2.close) / 2) {
        patterns.push({ name: 'Evening Star', type: 'bearish', significance: 'high', candleIndex: i, description: 'Three-candle bearish reversal (bull → small body → bear). Enter short below third candle low. Stop above pattern high. High reliability at resistance.' });
      }

      // Three White Soldiers
      if (isBullish(prev2) && isBullish(prev) && isBullish(c) &&
        prev.close > prev2.close && c.close > prev.close &&
        bodySize(prev2) > avg * 0.5 && bodySize(prev) > avg * 0.5 && body > avg * 0.5) {
        patterns.push({ name: 'Three White Soldiers', type: 'bullish', significance: 'high', candleIndex: i, description: 'Three consecutive strong bull candles — strong uptrend continuation. Enter long on pullback to last candle body. Stop below first soldier low.' });
      }

      // Three Black Crows
      if (isBearish(prev2) && isBearish(prev) && isBearish(c) &&
        prev.close < prev2.close && c.close < prev.close &&
        bodySize(prev2) > avg * 0.5 && bodySize(prev) > avg * 0.5 && body > avg * 0.5) {
        patterns.push({ name: 'Three Black Crows', type: 'bearish', significance: 'high', candleIndex: i, description: 'Three consecutive strong bear candles — strong downtrend continuation. Enter short on pullback to last candle body. Stop above first crow high.' });
      }

      // Three Inside Up
      if (isBearish(prev2) && isBullish(prev) && prev.open > prev2.close && prev.close < prev2.open && isBullish(c) && c.close > prev2.open) {
        patterns.push({ name: 'Three Inside Up', type: 'bullish', significance: 'medium', candleIndex: i, description: 'Bullish harami confirmed by third candle' });
      }

      // Three Inside Down
      if (isBullish(prev2) && isBearish(prev) && prev.open < prev2.close && prev.close > prev2.open && isBearish(c) && c.close < prev2.open) {
        patterns.push({ name: 'Three Inside Down', type: 'bearish', significance: 'medium', candleIndex: i, description: 'Bearish harami confirmed by third candle' });
      }
    }
  }

  return patterns;
}
