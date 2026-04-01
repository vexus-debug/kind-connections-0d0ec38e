import type { Candle } from '@/types/scanner';

export interface TrendlineResult {
  /** Whether a valid support trendline was found */
  supportTrendline: boolean;
  /** Whether a valid resistance trendline was found */
  resistanceTrendline: boolean;
  /** Direction implied by trendlines: ascending support = bull, descending resistance = bear */
  direction: 'bull' | 'bear' | 'neutral';
  /** Slope of support trendline (positive = ascending) */
  supportSlope: number;
  /** Slope of resistance trendline (negative = descending) */
  resistanceSlope: number;
  /** How many touches the support trendline has */
  supportTouches: number;
  /** How many touches the resistance trendline has */
  resistanceTouches: number;
  /** Whether price is currently respecting the trendline (near it or bounced off) */
  priceRespecting: boolean;
  /** R² fit quality of best trendline (0-1) */
  fitQuality: number;
  /** Description for UI */
  description: string;
}

interface SwingPoint {
  index: number;
  price: number;
}

function findSwingLows(candles: Candle[], lookback = 3): SwingPoint[] {
  const points: SwingPoint[] = [];
  for (let i = lookback; i < candles.length - lookback; i++) {
    let isLow = true;
    for (let j = 1; j <= lookback; j++) {
      if (candles[i].low >= candles[i - j].low || candles[i].low >= candles[i + j].low) {
        isLow = false;
        break;
      }
    }
    if (isLow) points.push({ index: i, price: candles[i].low });
  }
  return points;
}

function findSwingHighs(candles: Candle[], lookback = 3): SwingPoint[] {
  const points: SwingPoint[] = [];
  for (let i = lookback; i < candles.length - lookback; i++) {
    let isHigh = true;
    for (let j = 1; j <= lookback; j++) {
      if (candles[i].high >= candles[i - j].high || candles[i].high >= candles[i + j].high) {
        isHigh = false;
        break;
      }
    }
    if (isHigh) points.push({ index: i, price: candles[i].high });
  }
  return points;
}

/**
 * Fit a trendline through swing points using least squares,
 * then count how many points are "touched" (within tolerance).
 */
function fitTrendline(points: SwingPoint[], totalBars: number, tolerance: number): {
  slope: number;
  intercept: number;
  touches: number;
  rSquared: number;
  valid: boolean;
} {
  if (points.length < 2) return { slope: 0, intercept: 0, touches: 0, rSquared: 0, valid: false };

  // Use the last N swing points (max 8) for fitting
  const recent = points.slice(-8);
  const n = recent.length;

  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
  for (const p of recent) {
    sumX += p.index;
    sumY += p.price;
    sumXY += p.index * p.price;
    sumX2 += p.index * p.index;
  }

  const denom = n * sumX2 - sumX * sumX;
  if (denom === 0) return { slope: 0, intercept: 0, touches: 0, rSquared: 0, valid: false };

  const slope = (n * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - slope * sumX) / n;

  // R² calculation
  const meanY = sumY / n;
  let ssTot = 0, ssRes = 0;
  for (const p of recent) {
    const predicted = slope * p.index + intercept;
    ssTot += (p.price - meanY) ** 2;
    ssRes += (p.price - predicted) ** 2;
  }
  const rSquared = ssTot === 0 ? 0 : Math.max(0, 1 - ssRes / ssTot);

  // Count touches: points within tolerance of the line
  let touches = 0;
  for (const p of recent) {
    const predicted = slope * p.index + intercept;
    const dist = Math.abs(p.price - predicted) / p.price;
    if (dist < tolerance) touches++;
  }

  // Valid if at least 3 touches and R² > 0.5
  const valid = touches >= 3 && rSquared > 0.5;

  return { slope, intercept, touches, rSquared, valid };
}

/**
 * Detect trendlines by fitting lines through swing highs and swing lows.
 * A valid ascending support trendline = bullish.
 * A valid descending resistance trendline = bearish.
 */
export function detectTrendlines(candles: Candle[], lookback = 80): TrendlineResult {
  const recent = candles.slice(-lookback);
  if (recent.length < 30) {
    return {
      supportTrendline: false, resistanceTrendline: false,
      direction: 'neutral', supportSlope: 0, resistanceSlope: 0,
      supportTouches: 0, resistanceTouches: 0,
      priceRespecting: false, fitQuality: 0,
      description: 'Insufficient data',
    };
  }

  const price = recent[recent.length - 1].close;
  const avgPrice = recent.reduce((s, c) => s + c.close, 0) / recent.length;
  const tolerance = 0.012; // 1.2% tolerance for touch detection

  const swingLows = findSwingLows(recent, 3);
  const swingHighs = findSwingHighs(recent, 3);

  const support = fitTrendline(swingLows, recent.length, tolerance);
  const resistance = fitTrendline(swingHighs, recent.length, tolerance);

  const lastIdx = recent.length - 1;
  const supportAtNow = support.slope * lastIdx + support.intercept;
  const resistanceAtNow = resistance.slope * lastIdx + resistance.intercept;

  // Check if price is near/respecting the trendline
  const nearSupport = support.valid && Math.abs(price - supportAtNow) / price < 0.02;
  const nearResistance = resistance.valid && Math.abs(price - resistanceAtNow) / price < 0.02;
  const priceRespecting = nearSupport || nearResistance;

  // Determine direction
  let direction: 'bull' | 'bear' | 'neutral' = 'neutral';
  if (support.valid && support.slope > 0 && price > supportAtNow) {
    direction = 'bull'; // ascending support with price above
  }
  if (resistance.valid && resistance.slope < 0 && price < resistanceAtNow) {
    direction = 'bear'; // descending resistance with price below
  }
  // Both valid — stronger signal if they agree
  if (support.valid && resistance.valid) {
    if (support.slope > 0 && resistance.slope > 0) direction = 'bull'; // ascending channel
    else if (support.slope < 0 && resistance.slope < 0) direction = 'bear'; // descending channel
  }

  const fitQuality = Math.max(support.rSquared, resistance.rSquared);

  let description = 'No clear trendline';
  if (support.valid && resistance.valid) {
    if (direction === 'bull') description = `Ascending channel (${support.touches}+${resistance.touches} touches, R²=${fitQuality.toFixed(2)})`;
    else if (direction === 'bear') description = `Descending channel (${support.touches}+${resistance.touches} touches, R²=${fitQuality.toFixed(2)})`;
    else description = `Converging trendlines (${support.touches}+${resistance.touches} touches)`;
  } else if (support.valid) {
    description = `${support.slope > 0 ? 'Ascending' : 'Descending'} support (${support.touches} touches, R²=${support.rSquared.toFixed(2)})`;
  } else if (resistance.valid) {
    description = `${resistance.slope > 0 ? 'Ascending' : 'Descending'} resistance (${resistance.touches} touches, R²=${resistance.rSquared.toFixed(2)})`;
  }

  return {
    supportTrendline: support.valid,
    resistanceTrendline: resistance.valid,
    direction,
    supportSlope: support.slope,
    resistanceSlope: resistance.slope,
    supportTouches: support.touches,
    resistanceTouches: resistance.touches,
    priceRespecting,
    fitQuality,
    description,
  };
}
