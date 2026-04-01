import type { Candle, TrendSignal, TrendDirection, TrendStrength } from '@/types/scanner';
import { calculateEMA, calculateDEMA, calculateVWAP, calculateLinearRegression } from './moving-averages';
import { calculateADX, calculateATR, calculateParabolicSAR, calculateSupertrend, calculateIchimoku } from './trend';
import { calculateRSI, calculateMACD, calculateStochastic, calculateStochRSI, calculateWilliamsR, calculateCCI, calculateROC, calculateMFI, calculateCMF, calculateTSI } from './momentum';
import { calculateBollingerBands, calculateKeltnerChannels, calculateDonchianChannels, calculateHistoricalVolatility, detectSqueeze } from './volatility';
import { calculateVolumeRatio, calculateOBV, calculateAD, calculateVPT, detectVolumeSpikes, detectVolumeClusters } from './volume';
import { detectTrendlines } from './trendlines';
import { detectDivergences } from '@/lib/divergence';

export interface IndicatorDetail {
  name: string;
  signal: 'bull' | 'bear' | 'neutral';
  value: string;
  confirmed: boolean;
  weight: number; // importance weight for scoring
}

export interface SupportResistance {
  nearestSupport: number;
  nearestResistance: number;
  supportDistance: number;
  resistanceDistance: number;
}

export interface TrendDuration {
  bars: number;
  startPrice: number;
  startTime: number;
  currentPrice: number;
  trendMove: number; // percentage
  fibRetrace382: number;
  fibRetrace500: number;
  fibRetrace618: number;
  fibExtend1272: number;
  fibExtend1618: number;
  exhaustionRisk: 'low' | 'medium' | 'high';
  exhaustionSignals: string[];
  atrStop: number; // ATR-based trailing stop
  invalidationLevel: number; // most recent HL (uptrend) or LH (downtrend)
  invalidationDescription: string;
}

export interface ConfirmedTrend extends TrendSignal {
  confirmations: number;
  totalChecks: number;
  indicators: IndicatorDetail[];
  rsi: number;
  macdHistogram: number;
  priceStructure: 'bull' | 'bear' | 'neutral';
  plusDI: number;
  minusDI: number;
  probability: number;
  supportResistance: SupportResistance;
  trendDuration: TrendDuration;
}

/** Calculate trend duration by walking back through candles to find where EMA crossover started */
function calculateTrendDuration(
  candles: Candle[],
  direction: TrendDirection,
  ema9: number[], ema21: number[],
  rsi: number,
  macdHist: number,
  adx: number,
  volumeRatio: number,
  atr: number
): TrendDuration {
  const price = candles[candles.length - 1].close;
  const isBull = direction === 'bull';

  // Walk backwards to find where EMA9 crossed EMA21 (trend start)
  let trendStartIdx = candles.length - 1;
  for (let i = candles.length - 2; i >= 0; i--) {
    if (i >= ema9.length || i >= ema21.length) break;
    const wasAligned = isBull ? ema9[i] > ema21[i] : ema9[i] < ema21[i];
    if (!wasAligned) {
      trendStartIdx = i + 1;
      break;
    }
    if (i === 0) trendStartIdx = 0;
  }

  const bars = candles.length - 1 - trendStartIdx;
  const startPrice = candles[trendStartIdx]?.close ?? price;
  const startTime = candles[trendStartIdx]?.time ?? 0;
  const trendMove = ((price - startPrice) / startPrice) * 100;

  // Find the extreme of the trend move for Fibonacci
  let extreme = startPrice;
  for (let i = trendStartIdx; i < candles.length; i++) {
    if (isBull) {
      if (candles[i].high > extreme) extreme = candles[i].high;
    } else {
      if (candles[i].low < extreme) extreme = candles[i].low;
    }
  }

  // Fibonacci retracement levels (from trend extreme back towards start)
  const moveRange = extreme - startPrice;
  const fibRetrace382 = extreme - moveRange * 0.382;
  const fibRetrace500 = extreme - moveRange * 0.5;
  const fibRetrace618 = extreme - moveRange * 0.618;

  // Fibonacci extension levels
  const fibExtend1272 = startPrice + moveRange * 1.272;
  const fibExtend1618 = startPrice + moveRange * 1.618;

  // ATR-based trailing stop (2x ATR from current price)
  const atrStop = isBull ? price - 2 * atr : price + 2 * atr;

  // ─── Find invalidation level: most recent HL (uptrend) or LH (downtrend) ───
  let invalidationLevel = startPrice;
  let invalidationDescription = '';

  const trendCandles = candles.slice(Math.max(0, trendStartIdx - 2));
  const swingHighs: { price: number; idx: number }[] = [];
  const swingLows: { price: number; idx: number }[] = [];

  for (let i = 2; i < trendCandles.length - 2; i++) {
    const c = trendCandles[i];
    if (c.high > trendCandles[i-1].high && c.high > trendCandles[i-2].high &&
        c.high > trendCandles[i+1].high && c.high > trendCandles[i+2].high) {
      swingHighs.push({ price: c.high, idx: i });
    }
    if (c.low < trendCandles[i-1].low && c.low < trendCandles[i-2].low &&
        c.low < trendCandles[i+1].low && c.low < trendCandles[i+2].low) {
      swingLows.push({ price: c.low, idx: i });
    }
  }

  if (isBull) {
    if (swingLows.length >= 1) {
      const recentHL = swingLows[swingLows.length - 1];
      invalidationLevel = recentHL.price;
      invalidationDescription = swingLows.length >= 2 && recentHL.price > swingLows[swingLows.length - 2].price
        ? 'Most recent Higher Low — break below invalidates uptrend'
        : 'Most recent swing low — break below signals reversal';
    } else {
      invalidationDescription = 'Trend start price — no swing low formed yet';
    }
  } else {
    if (swingHighs.length >= 1) {
      const recentLH = swingHighs[swingHighs.length - 1];
      invalidationLevel = recentLH.price;
      invalidationDescription = swingHighs.length >= 2 && recentLH.price < swingHighs[swingHighs.length - 2].price
        ? 'Most recent Lower High — break above invalidates downtrend'
        : 'Most recent swing high — break above signals reversal';
    } else {
      invalidationDescription = 'Trend start price — no swing high formed yet';
    }
  }

  // Exhaustion analysis
  const exhaustionSignals: string[] = [];
  if (isBull && rsi > 75) exhaustionSignals.push(`RSI overbought (${rsi.toFixed(0)})`);
  if (!isBull && rsi < 25) exhaustionSignals.push(`RSI oversold (${rsi.toFixed(0)})`);
  if (isBull && macdHist < 0) exhaustionSignals.push('MACD histogram negative');
  if (!isBull && macdHist > 0) exhaustionSignals.push('MACD histogram positive');
  if (bars > 50) exhaustionSignals.push(`Extended duration (${bars} bars)`);
  if (adx < 20) exhaustionSignals.push(`ADX weak (${adx.toFixed(0)})`);
  if (volumeRatio < 0.7) exhaustionSignals.push(`Low volume (${volumeRatio.toFixed(1)}x)`);
  const pctFromStart = Math.abs(trendMove);
  if (pctFromStart > 20) exhaustionSignals.push(`Large move (${pctFromStart.toFixed(1)}%)`);

  let exhaustionRisk: 'low' | 'medium' | 'high' = 'low';
  if (exhaustionSignals.length >= 3) exhaustionRisk = 'high';
  else if (exhaustionSignals.length >= 1) exhaustionRisk = 'medium';

  return {
    bars, startPrice, startTime, currentPrice: price, trendMove,
    fibRetrace382, fibRetrace500, fibRetrace618, fibExtend1272, fibExtend1618,
    exhaustionRisk, exhaustionSignals, atrStop, invalidationLevel, invalidationDescription,
  };
}

/** Find nearest support and resistance */
function findSupportResistance(candles: Candle[], emas: { e9: number; e21: number; e50: number; e200: number }): SupportResistance {
  const price = candles[candles.length - 1].close;
  const lookback = Math.min(candles.length, 100);
  const recent = candles.slice(-lookback);

  const levels: number[] = [];
  for (let i = 2; i < recent.length - 2; i++) {
    if (recent[i].high > recent[i - 1].high && recent[i].high > recent[i - 2].high &&
        recent[i].high > recent[i + 1].high && recent[i].high > recent[i + 2].high) {
      levels.push(recent[i].high);
    }
    if (recent[i].low < recent[i - 1].low && recent[i].low < recent[i - 2].low &&
        recent[i].low < recent[i + 1].low && recent[i].low < recent[i + 2].low) {
      levels.push(recent[i].low);
    }
  }

  levels.push(emas.e9, emas.e21, emas.e50, emas.e200);

  const supports = levels.filter(l => l < price).sort((a, b) => b - a);
  const resistances = levels.filter(l => l > price).sort((a, b) => a - b);

  const nearestSupport = supports[0] ?? price * 0.95;
  const nearestResistance = resistances[0] ?? price * 1.05;

  return {
    nearestSupport,
    nearestResistance,
    supportDistance: ((price - nearestSupport) / price) * 100,
    resistanceDistance: ((nearestResistance - price) / price) * 100,
  };
}

/** Price structure analysis: HH/HL (bull) or LH/LL (bear) */
function analyzePriceStructure(candles: Candle[], lookback = 30): 'bull' | 'bear' | 'neutral' {
  const recent = candles.slice(-lookback);
  if (recent.length < 8) return 'neutral';

  const swingHighs: number[] = [];
  const swingLows: number[] = [];
  for (let i = 2; i < recent.length - 2; i++) {
    if (recent[i].high > recent[i - 1].high && recent[i].high > recent[i - 2].high &&
        recent[i].high > recent[i + 1].high && recent[i].high > recent[i + 2].high) {
      swingHighs.push(recent[i].high);
    }
    if (recent[i].low < recent[i - 1].low && recent[i].low < recent[i - 2].low &&
        recent[i].low < recent[i + 1].low && recent[i].low < recent[i + 2].low) {
      swingLows.push(recent[i].low);
    }
  }

  if (swingHighs.length < 2 || swingLows.length < 2) return 'neutral';

  const hhCount = swingHighs.slice(1).filter((h, i) => h > swingHighs[i]).length;
  const hlCount = swingLows.slice(1).filter((l, i) => l > swingLows[i]).length;
  const lhCount = swingHighs.slice(1).filter((h, i) => h < swingHighs[i]).length;
  const llCount = swingLows.slice(1).filter((l, i) => l < swingLows[i]).length;

  const bullStructure = hhCount + hlCount;
  const bearStructure = lhCount + llCount;

  if (bullStructure >= 2 && bullStructure > bearStructure) return 'bull';
  if (bearStructure >= 2 && bearStructure > bullStructure) return 'bear';
  return 'neutral';
}

/** Calculate trend consistency over N periods (established trend filter) */
function calculateTrendConsistency(candles: Candle[], emaPeriod: number, lookbackBars = 20): number {
  const closes = candles.map(c => c.close);
  const ema = calculateEMA(closes, emaPeriod);
  if (ema.length < lookbackBars) return 0;

  let consistent = 0;
  const recent = ema.slice(-lookbackBars);
  const recentCloses = closes.slice(-lookbackBars);
  const direction = recentCloses[recentCloses.length - 1] > recent[recent.length - 1] ? 'above' : 'below';

  for (let i = 0; i < lookbackBars; i++) {
    const isAbove = recentCloses[i] > recent[i];
    if ((direction === 'above' && isAbove) || (direction === 'below' && !isAbove)) {
      consistent++;
    }
  }

  return consistent / lookbackBars; // 0-1, higher = more established
}

export function analyzeTrend(
  candles: Candle[],
  emaPeriods = { fast: 9, slow: 21, mid: 50, long: 200 },
  adxThreshold = 25
): ConfirmedTrend | null {
  if (candles.length < emaPeriods.long + 10) return null;

  const closes = candles.map(c => c.close);
  const ema9 = calculateEMA(closes, emaPeriods.fast);
  const ema21 = calculateEMA(closes, emaPeriods.slow);
  const ema50 = calculateEMA(closes, emaPeriods.mid);
  const ema200 = calculateEMA(closes, emaPeriods.long);

  const lastIdx = closes.length - 1;
  const e9 = ema9[lastIdx];
  const e21 = ema21[lastIdx];
  const e50 = ema50[lastIdx];
  const e200 = ema200[lastIdx];
  const price = closes[lastIdx];

  // Core indicators
  const { adx, plusDI, minusDI } = calculateADX(candles);
  const rsi = calculateRSI(closes);
  const macd = calculateMACD(closes);
  const volumeRatio = calculateVolumeRatio(candles);
  const priceStructure = analyzePriceStructure(candles);

  // New trend indicators
  const dema21 = calculateDEMA(closes, 21);
  const demaVal = dema21[dema21.length - 1];
  const ichimoku = calculateIchimoku(candles);
  const psar = calculateParabolicSAR(candles);
  const supertrend = calculateSupertrend(candles);
  const vwap = calculateVWAP(candles);
  const linReg = calculateLinearRegression(closes, 50);

  // New momentum indicators
  const stoch = calculateStochastic(candles);
  const stochRsi = calculateStochRSI(closes);
  const williamsR = calculateWilliamsR(candles);
  const cci = calculateCCI(candles);
  const roc = calculateROC(closes);
  const mfi = calculateMFI(candles);
  const cmf = calculateCMF(candles);
  const tsi = calculateTSI(closes);

  // Volatility indicators
  const bb = calculateBollingerBands(closes);
  const kc = calculateKeltnerChannels(candles);
  const donchian = calculateDonchianChannels(candles);
  const histVol = calculateHistoricalVolatility(closes);
  const isSqueeze = detectSqueeze(bb.upper, bb.lower, kc.upper, kc.lower);
  const atr = calculateATR(candles);

  // Volume analysis
  const obv = calculateOBV(candles);
  const ad = calculateAD(candles);
  const vpt = calculateVPT(candles);
  const volSpike = detectVolumeSpikes(candles);
  const volClusters = detectVolumeClusters(candles);

  // Trend consistency (established trend filter)
  const consistency50 = calculateTrendConsistency(candles, 50, 20);
  const consistency200 = calculateTrendConsistency(candles, 200, 30);

  // ==========================================
  // WEIGHTED VOTING SYSTEM (focused on established trends)
  // ==========================================
  const indicators: IndicatorDetail[] = [];
  let bullScore = 0, bearScore = 0, totalWeight = 0;

  // --- TREND INDICATORS (high weight — establish direction) ---

  // 1. EMA Ribbon (weight: 2.0)
  const w1 = 2.0;
  totalWeight += w1;
  const emaAligned = e9 > e21 && e21 > e50 && e50 > e200;
  const emaBearAligned = e9 < e21 && e21 < e50 && e50 < e200;
  if (emaAligned) { bullScore += w1; indicators.push({ name: 'EMA Ribbon', signal: 'bull', value: 'Fully aligned ↑', confirmed: true, weight: w1 }); }
  else if (emaBearAligned) { bearScore += w1; indicators.push({ name: 'EMA Ribbon', signal: 'bear', value: 'Fully aligned ↓', confirmed: true, weight: w1 }); }
  else if (e9 > e21 && price > e50) { bullScore += w1 * 0.4; indicators.push({ name: 'EMA Ribbon', signal: 'bull', value: 'Partial ↑', confirmed: false, weight: w1 }); }
  else if (e9 < e21 && price < e50) { bearScore += w1 * 0.4; indicators.push({ name: 'EMA Ribbon', signal: 'bear', value: 'Partial ↓', confirmed: false, weight: w1 }); }
  else { indicators.push({ name: 'EMA Ribbon', signal: 'neutral', value: 'Mixed', confirmed: false, weight: w1 }); }

  // 2. ADX + DI (weight: 1.8)
  const w2 = 1.8;
  totalWeight += w2;
  if (adx >= adxThreshold) {
    if (plusDI > minusDI) { bullScore += w2; indicators.push({ name: 'ADX/DI', signal: 'bull', value: `ADX ${adx.toFixed(0)} +DI>-DI`, confirmed: true, weight: w2 }); }
    else { bearScore += w2; indicators.push({ name: 'ADX/DI', signal: 'bear', value: `ADX ${adx.toFixed(0)} -DI>+DI`, confirmed: true, weight: w2 }); }
  } else {
    indicators.push({ name: 'ADX/DI', signal: 'neutral', value: `ADX ${adx.toFixed(0)} (weak)`, confirmed: false, weight: w2 });
  }

  // 3. Ichimoku Cloud (weight: 2.0 — comprehensive system)
  const w3 = 2.0;
  totalWeight += w3;
  const ichiFullBull = ichimoku.priceVsCloud === 'above' && ichimoku.cloudDirection === 'bull' && ichimoku.tenkan > ichimoku.kijun && ichimoku.chikouVsPrice > 0;
  const ichiFullBear = ichimoku.priceVsCloud === 'below' && ichimoku.cloudDirection === 'bear' && ichimoku.tenkan < ichimoku.kijun && ichimoku.chikouVsPrice < 0;
  if (ichiFullBull) { bullScore += w3; indicators.push({ name: 'Ichimoku', signal: 'bull', value: 'All 5 lines bullish', confirmed: true, weight: w3 }); }
  else if (ichiFullBear) { bearScore += w3; indicators.push({ name: 'Ichimoku', signal: 'bear', value: 'All 5 lines bearish', confirmed: true, weight: w3 }); }
  else if (ichimoku.priceVsCloud === 'above') { bullScore += w3 * 0.4; indicators.push({ name: 'Ichimoku', signal: 'bull', value: `Above cloud (${ichimoku.cloudDirection})`, confirmed: false, weight: w3 }); }
  else if (ichimoku.priceVsCloud === 'below') { bearScore += w3 * 0.4; indicators.push({ name: 'Ichimoku', signal: 'bear', value: `Below cloud (${ichimoku.cloudDirection})`, confirmed: false, weight: w3 }); }
  else { indicators.push({ name: 'Ichimoku', signal: 'neutral', value: 'Inside cloud', confirmed: false, weight: w3 }); }

  // 4. Parabolic SAR (weight: 1.2)
  const w4 = 1.2;
  totalWeight += w4;
  if (psar.direction === 'bull') { bullScore += w4; indicators.push({ name: 'Parabolic SAR', signal: 'bull', value: `SAR below price`, confirmed: true, weight: w4 }); }
  else { bearScore += w4; indicators.push({ name: 'Parabolic SAR', signal: 'bear', value: `SAR above price`, confirmed: true, weight: w4 }); }

  // 5. Supertrend (weight: 1.5)
  const w5 = 1.5;
  totalWeight += w5;
  if (supertrend.direction === 'bull') { bullScore += w5; indicators.push({ name: 'Supertrend', signal: 'bull', value: `Uptrend ${supertrend.value.toPrecision(5)}`, confirmed: true, weight: w5 }); }
  else { bearScore += w5; indicators.push({ name: 'Supertrend', signal: 'bear', value: `Downtrend ${supertrend.value.toPrecision(5)}`, confirmed: true, weight: w5 }); }

  // 6. VWAP (weight: 1.0)
  const w6 = 1.0;
  totalWeight += w6;
  if (price > vwap * 1.002) { bullScore += w6; indicators.push({ name: 'VWAP', signal: 'bull', value: `Price above VWAP`, confirmed: true, weight: w6 }); }
  else if (price < vwap * 0.998) { bearScore += w6; indicators.push({ name: 'VWAP', signal: 'bear', value: `Price below VWAP`, confirmed: true, weight: w6 }); }
  else { indicators.push({ name: 'VWAP', signal: 'neutral', value: `At VWAP`, confirmed: false, weight: w6 }); }

  // 7. Linear Regression (weight: 1.3)
  const w7 = 1.3;
  totalWeight += w7;
  if (linReg.rSquared > 0.6 && linReg.slope > 0) { bullScore += w7; indicators.push({ name: 'Lin Regression', signal: 'bull', value: `R²=${linReg.rSquared.toFixed(2)} slope ↑`, confirmed: true, weight: w7 }); }
  else if (linReg.rSquared > 0.6 && linReg.slope < 0) { bearScore += w7; indicators.push({ name: 'Lin Regression', signal: 'bear', value: `R²=${linReg.rSquared.toFixed(2)} slope ↓`, confirmed: true, weight: w7 }); }
  else { indicators.push({ name: 'Lin Regression', signal: 'neutral', value: `R²=${linReg.rSquared.toFixed(2)} (weak fit)`, confirmed: false, weight: w7 }); }

  // 8. DEMA confirmation (weight: 0.8)
  const w8 = 0.8;
  totalWeight += w8;
  if (price > demaVal && demaVal > e50) { bullScore += w8; indicators.push({ name: 'DEMA', signal: 'bull', value: `Price > DEMA > EMA50`, confirmed: true, weight: w8 }); }
  else if (price < demaVal && demaVal < e50) { bearScore += w8; indicators.push({ name: 'DEMA', signal: 'bear', value: `Price < DEMA < EMA50`, confirmed: true, weight: w8 }); }
  else { indicators.push({ name: 'DEMA', signal: 'neutral', value: 'Mixed DEMA signals', confirmed: false, weight: w8 }); }

  // 9. Price vs 200 EMA (weight: 1.5 — long-term bias)
  const w9 = 1.5;
  totalWeight += w9;
  const pctFrom200 = ((price - e200) / e200) * 100;
  if (price > e200) { bullScore += w9; indicators.push({ name: '200 EMA', signal: 'bull', value: `+${pctFrom200.toFixed(1)}% above`, confirmed: true, weight: w9 }); }
  else { bearScore += w9; indicators.push({ name: '200 EMA', signal: 'bear', value: `${pctFrom200.toFixed(1)}% below`, confirmed: true, weight: w9 }); }

  // 10. Price Structure HH/HL or LH/LL (weight: 1.8)
  const w10 = 1.8;
  totalWeight += w10;
  if (priceStructure === 'bull') { bullScore += w10; indicators.push({ name: 'Structure', signal: 'bull', value: 'HH + HL pattern', confirmed: true, weight: w10 }); }
  else if (priceStructure === 'bear') { bearScore += w10; indicators.push({ name: 'Structure', signal: 'bear', value: 'LH + LL pattern', confirmed: true, weight: w10 }); }
  else { indicators.push({ name: 'Structure', signal: 'neutral', value: 'No clear pattern', confirmed: false, weight: w10 }); }

  // --- MOMENTUM INDICATORS (medium weight — confirm strength) ---

  // 11. RSI (weight: 1.2)
  const w11 = 1.2;
  totalWeight += w11;
  if (rsi > 55 && rsi < 75) { bullScore += w11; indicators.push({ name: 'RSI', signal: 'bull', value: `${rsi.toFixed(0)} bullish`, confirmed: true, weight: w11 }); }
  else if (rsi < 45 && rsi > 25) { bearScore += w11; indicators.push({ name: 'RSI', signal: 'bear', value: `${rsi.toFixed(0)} bearish`, confirmed: true, weight: w11 }); }
  else { indicators.push({ name: 'RSI', signal: 'neutral', value: `${rsi.toFixed(0)}`, confirmed: false, weight: w11 }); }

  // 12. MACD (weight: 1.3)
  const w12 = 1.3;
  totalWeight += w12;
  if (macd.histogram > 0 && macd.macd > 0) { bullScore += w12; indicators.push({ name: 'MACD', signal: 'bull', value: `Hist +${macd.histogram.toPrecision(3)}`, confirmed: true, weight: w12 }); }
  else if (macd.histogram < 0 && macd.macd < 0) { bearScore += w12; indicators.push({ name: 'MACD', signal: 'bear', value: `Hist ${macd.histogram.toPrecision(3)}`, confirmed: true, weight: w12 }); }
  else { indicators.push({ name: 'MACD', signal: 'neutral', value: 'Diverging', confirmed: false, weight: w12 }); }

  // 13. Stochastic (weight: 0.8)
  const w13 = 0.8;
  totalWeight += w13;
  if (stoch.k > 50 && stoch.k < 80 && stoch.k > stoch.d) { bullScore += w13; indicators.push({ name: 'Stochastic', signal: 'bull', value: `%K=${stoch.k.toFixed(0)} > %D`, confirmed: true, weight: w13 }); }
  else if (stoch.k < 50 && stoch.k > 20 && stoch.k < stoch.d) { bearScore += w13; indicators.push({ name: 'Stochastic', signal: 'bear', value: `%K=${stoch.k.toFixed(0)} < %D`, confirmed: true, weight: w13 }); }
  else { indicators.push({ name: 'Stochastic', signal: 'neutral', value: `%K=${stoch.k.toFixed(0)}`, confirmed: false, weight: w13 }); }

  // 14. StochRSI (weight: 0.7)
  const w14 = 0.7;
  totalWeight += w14;
  if (stochRsi.k > 50 && stochRsi.k < 85) { bullScore += w14; indicators.push({ name: 'StochRSI', signal: 'bull', value: `K=${stochRsi.k.toFixed(0)}`, confirmed: true, weight: w14 }); }
  else if (stochRsi.k < 50 && stochRsi.k > 15) { bearScore += w14; indicators.push({ name: 'StochRSI', signal: 'bear', value: `K=${stochRsi.k.toFixed(0)}`, confirmed: true, weight: w14 }); }
  else { indicators.push({ name: 'StochRSI', signal: 'neutral', value: `K=${stochRsi.k.toFixed(0)} (extreme)`, confirmed: false, weight: w14 }); }

  // 15. Williams %R (weight: 0.6)
  const w15 = 0.6;
  totalWeight += w15;
  if (williamsR > -50 && williamsR > -20) { bullScore += w15; indicators.push({ name: 'Williams %R', signal: 'bull', value: `${williamsR.toFixed(0)}`, confirmed: true, weight: w15 }); }
  else if (williamsR < -50 && williamsR < -80) { bearScore += w15; indicators.push({ name: 'Williams %R', signal: 'bear', value: `${williamsR.toFixed(0)}`, confirmed: true, weight: w15 }); }
  else { indicators.push({ name: 'Williams %R', signal: 'neutral', value: `${williamsR.toFixed(0)}`, confirmed: false, weight: w15 }); }

  // 16. CCI (weight: 0.8)
  const w16 = 0.8;
  totalWeight += w16;
  if (cci > 50 && cci < 200) { bullScore += w16; indicators.push({ name: 'CCI', signal: 'bull', value: `${cci.toFixed(0)} bullish`, confirmed: true, weight: w16 }); }
  else if (cci < -50 && cci > -200) { bearScore += w16; indicators.push({ name: 'CCI', signal: 'bear', value: `${cci.toFixed(0)} bearish`, confirmed: true, weight: w16 }); }
  else { indicators.push({ name: 'CCI', signal: 'neutral', value: `${cci.toFixed(0)}`, confirmed: false, weight: w16 }); }

  // 17. ROC (weight: 0.7)
  const w17 = 0.7;
  totalWeight += w17;
  if (roc > 1) { bullScore += w17; indicators.push({ name: 'ROC', signal: 'bull', value: `+${roc.toFixed(1)}%`, confirmed: true, weight: w17 }); }
  else if (roc < -1) { bearScore += w17; indicators.push({ name: 'ROC', signal: 'bear', value: `${roc.toFixed(1)}%`, confirmed: true, weight: w17 }); }
  else { indicators.push({ name: 'ROC', signal: 'neutral', value: `${roc.toFixed(1)}%`, confirmed: false, weight: w17 }); }

  // 18. MFI (weight: 1.0 — volume-weighted momentum)
  const w18 = 1.0;
  totalWeight += w18;
  if (mfi > 55 && mfi < 80) { bullScore += w18; indicators.push({ name: 'MFI', signal: 'bull', value: `${mfi.toFixed(0)} inflow`, confirmed: true, weight: w18 }); }
  else if (mfi < 45 && mfi > 20) { bearScore += w18; indicators.push({ name: 'MFI', signal: 'bear', value: `${mfi.toFixed(0)} outflow`, confirmed: true, weight: w18 }); }
  else { indicators.push({ name: 'MFI', signal: 'neutral', value: `${mfi.toFixed(0)}`, confirmed: false, weight: w18 }); }

  // 19. CMF (weight: 1.0)
  const w19 = 1.0;
  totalWeight += w19;
  if (cmf > 0.05) { bullScore += w19; indicators.push({ name: 'CMF', signal: 'bull', value: `${cmf.toFixed(3)} accumulation`, confirmed: true, weight: w19 }); }
  else if (cmf < -0.05) { bearScore += w19; indicators.push({ name: 'CMF', signal: 'bear', value: `${cmf.toFixed(3)} distribution`, confirmed: true, weight: w19 }); }
  else { indicators.push({ name: 'CMF', signal: 'neutral', value: `${cmf.toFixed(3)}`, confirmed: false, weight: w19 }); }

  // 20. TSI (weight: 0.9)
  const w20 = 0.9;
  totalWeight += w20;
  if (tsi > 5) { bullScore += w20; indicators.push({ name: 'TSI', signal: 'bull', value: `${tsi.toFixed(1)} positive`, confirmed: true, weight: w20 }); }
  else if (tsi < -5) { bearScore += w20; indicators.push({ name: 'TSI', signal: 'bear', value: `${tsi.toFixed(1)} negative`, confirmed: true, weight: w20 }); }
  else { indicators.push({ name: 'TSI', signal: 'neutral', value: `${tsi.toFixed(1)}`, confirmed: false, weight: w20 }); }

  // --- VOLATILITY INDICATORS (context weight) ---

  // 21. Bollinger Bands position (weight: 0.8)
  const w21 = 0.8;
  totalWeight += w21;
  if (bb.percentB > 0.6 && bb.percentB < 0.95) { bullScore += w21; indicators.push({ name: 'Bollinger', signal: 'bull', value: `%B=${(bb.percentB*100).toFixed(0)} upper half`, confirmed: true, weight: w21 }); }
  else if (bb.percentB < 0.4 && bb.percentB > 0.05) { bearScore += w21; indicators.push({ name: 'Bollinger', signal: 'bear', value: `%B=${(bb.percentB*100).toFixed(0)} lower half`, confirmed: true, weight: w21 }); }
  else { indicators.push({ name: 'Bollinger', signal: 'neutral', value: `%B=${(bb.percentB*100).toFixed(0)}`, confirmed: false, weight: w21 }); }

  // 22. Donchian breakout (weight: 1.2)
  const w22 = 1.2;
  totalWeight += w22;
  if (donchian.breakoutUp) { bullScore += w22; indicators.push({ name: 'Donchian', signal: 'bull', value: 'Breakout above', confirmed: true, weight: w22 }); }
  else if (donchian.breakoutDown) { bearScore += w22; indicators.push({ name: 'Donchian', signal: 'bear', value: 'Breakout below', confirmed: true, weight: w22 }); }
  else if (price > donchian.middle) { bullScore += w22 * 0.3; indicators.push({ name: 'Donchian', signal: 'bull', value: 'Upper half', confirmed: false, weight: w22 }); }
  else if (price < donchian.middle) { bearScore += w22 * 0.3; indicators.push({ name: 'Donchian', signal: 'bear', value: 'Lower half', confirmed: false, weight: w22 }); }
  else { indicators.push({ name: 'Donchian', signal: 'neutral', value: 'Middle', confirmed: false, weight: w22 }); }

  // 23. Squeeze detection (context — boosts confidence)
  if (isSqueeze) {
    indicators.push({ name: 'Squeeze', signal: 'neutral', value: 'BB inside KC — breakout imminent', confirmed: false, weight: 0 });
  }

  // --- VOLUME ANALYSIS (confirmation weight) ---

  // 24. Volume ratio (weight: 1.0)
  const w24 = 1.0;
  totalWeight += w24;
  if (volumeRatio > 1.3) {
    const dir = bullScore > bearScore ? 'bull' : bearScore > bullScore ? 'bear' : 'neutral';
    if (dir !== 'neutral') {
      if (dir === 'bull') bullScore += w24; else bearScore += w24;
      indicators.push({ name: 'Volume', signal: dir, value: `${volumeRatio.toFixed(1)}x avg`, confirmed: true, weight: w24 });
    } else {
      indicators.push({ name: 'Volume', signal: 'neutral', value: `${volumeRatio.toFixed(1)}x avg`, confirmed: false, weight: w24 });
    }
  } else {
    indicators.push({ name: 'Volume', signal: 'neutral', value: `${volumeRatio.toFixed(1)}x avg (low)`, confirmed: false, weight: w24 });
  }

  // 25. OBV trend (weight: 1.0)
  const w25 = 1.0;
  totalWeight += w25;
  if (obv.trend === 'bull') { bullScore += w25; indicators.push({ name: 'OBV', signal: 'bull', value: 'Rising', confirmed: true, weight: w25 }); }
  else if (obv.trend === 'bear') { bearScore += w25; indicators.push({ name: 'OBV', signal: 'bear', value: 'Falling', confirmed: true, weight: w25 }); }
  else { indicators.push({ name: 'OBV', signal: 'neutral', value: 'Flat', confirmed: false, weight: w25 }); }

  // 26. A/D Line (weight: 0.8)
  const w26 = 0.8;
  totalWeight += w26;
  if (ad.trend === 'bull') { bullScore += w26; indicators.push({ name: 'A/D Line', signal: 'bull', value: 'Accumulation', confirmed: true, weight: w26 }); }
  else if (ad.trend === 'bear') { bearScore += w26; indicators.push({ name: 'A/D Line', signal: 'bear', value: 'Distribution', confirmed: true, weight: w26 }); }
  else { indicators.push({ name: 'A/D Line', signal: 'neutral', value: 'Flat', confirmed: false, weight: w26 }); }

  // 27. VPT (weight: 0.7)
  const w27 = 0.7;
  totalWeight += w27;
  if (vpt.trend === 'bull') { bullScore += w27; indicators.push({ name: 'VPT', signal: 'bull', value: 'Rising', confirmed: true, weight: w27 }); }
  else if (vpt.trend === 'bear') { bearScore += w27; indicators.push({ name: 'VPT', signal: 'bear', value: 'Falling', confirmed: true, weight: w27 }); }
  else { indicators.push({ name: 'VPT', signal: 'neutral', value: 'Flat', confirmed: false, weight: w27 }); }

  // 28. Volume clusters (weight: 0.6)
  const w28 = 0.6;
  totalWeight += w28;
  if (volClusters.highVolumeZone === 'support') { bullScore += w28; indicators.push({ name: 'Vol Clusters', signal: 'bull', value: `Support at VPOC`, confirmed: true, weight: w28 }); }
  else if (volClusters.highVolumeZone === 'resistance') { bearScore += w28; indicators.push({ name: 'Vol Clusters', signal: 'bear', value: `Resistance at VPOC`, confirmed: true, weight: w28 }); }
  else { indicators.push({ name: 'Vol Clusters', signal: 'neutral', value: volClusters.highVolumeZone === 'fair_value' ? 'At fair value' : 'No cluster', confirmed: false, weight: w28 }); }

  // --- NEW: TRENDLINE ANALYSIS (weight: 2.0 — geometric confirmation) ---
  const w29 = 2.0;
  totalWeight += w29;
  const trendlineResult = detectTrendlines(candles);
  if (trendlineResult.direction === 'bull' && trendlineResult.fitQuality > 0.5) {
    const bonus = trendlineResult.priceRespecting ? w29 : w29 * 0.6;
    bullScore += bonus;
    indicators.push({ name: 'Trendline', signal: 'bull', value: trendlineResult.description, confirmed: trendlineResult.fitQuality > 0.65, weight: w29 });
  } else if (trendlineResult.direction === 'bear' && trendlineResult.fitQuality > 0.5) {
    const bonus = trendlineResult.priceRespecting ? w29 : w29 * 0.6;
    bearScore += bonus;
    indicators.push({ name: 'Trendline', signal: 'bear', value: trendlineResult.description, confirmed: trendlineResult.fitQuality > 0.65, weight: w29 });
  } else {
    indicators.push({ name: 'Trendline', signal: 'neutral', value: trendlineResult.description, confirmed: false, weight: w29 });
  }

  // --- NEW: DIVERGENCE ANALYSIS (weight: 1.8 — reversal warning / continuation confirmation) ---
  const w30 = 1.8;
  totalWeight += w30;
  const divergences = detectDivergences(candles);
  const recentDivs = divergences.filter(d => d.endIndex >= candles.length - 10);

  if (recentDivs.length > 0) {
    // Hidden divergences CONFIRM trend (continuation), regular divergences WARN against it
    const hiddenBull = recentDivs.filter(d => d.type === 'hidden_bull');
    const hiddenBear = recentDivs.filter(d => d.type === 'hidden_bear');
    const regularBull = recentDivs.filter(d => d.type === 'regular_bull');
    const regularBear = recentDivs.filter(d => d.type === 'regular_bear');

    if (hiddenBull.length > 0) {
      bullScore += w30;
      indicators.push({ name: 'Divergence', signal: 'bull', value: `Hidden bull div (${hiddenBull[0].indicator}) — continuation`, confirmed: true, weight: w30 });
    } else if (hiddenBear.length > 0) {
      bearScore += w30;
      indicators.push({ name: 'Divergence', signal: 'bear', value: `Hidden bear div (${hiddenBear[0].indicator}) — continuation`, confirmed: true, weight: w30 });
    } else if (regularBear.length > 0) {
      // Regular bearish divergence penalizes bull signals
      bearScore += w30 * 0.5;
      indicators.push({ name: 'Divergence', signal: 'bear', value: `⚠ Bear div (${regularBear[0].indicator}) — reversal risk`, confirmed: true, weight: w30 });
    } else if (regularBull.length > 0) {
      bullScore += w30 * 0.5;
      indicators.push({ name: 'Divergence', signal: 'bull', value: `⚠ Bull div (${regularBull[0].indicator}) — reversal risk`, confirmed: true, weight: w30 });
    } else {
      indicators.push({ name: 'Divergence', signal: 'neutral', value: 'No actionable divergence', confirmed: false, weight: w30 });
    }
  } else {
    indicators.push({ name: 'Divergence', signal: 'neutral', value: 'No divergence detected', confirmed: false, weight: w30 });
  }

  // --- NEW: MULTI-EMA SLOPE MOMENTUM (weight: 1.2) ---
  // All EMAs should be sloping in the same direction for high-accuracy trends
  const w31 = 1.2;
  totalWeight += w31;
  const ema9Slope = ema9.length > 5 ? (ema9[ema9.length - 1] - ema9[ema9.length - 5]) / ema9[ema9.length - 5] * 100 : 0;
  const ema21Slope = ema21.length > 5 ? (ema21[ema21.length - 1] - ema21[ema21.length - 5]) / ema21[ema21.length - 5] * 100 : 0;
  const ema50Slope = ema50.length > 10 ? (ema50[ema50.length - 1] - ema50[ema50.length - 10]) / ema50[ema50.length - 10] * 100 : 0;
  const allSlopesUp = ema9Slope > 0 && ema21Slope > 0 && ema50Slope > 0;
  const allSlopesDown = ema9Slope < 0 && ema21Slope < 0 && ema50Slope < 0;
  if (allSlopesUp) { bullScore += w31; indicators.push({ name: 'EMA Slopes', signal: 'bull', value: `All EMAs rising`, confirmed: true, weight: w31 }); }
  else if (allSlopesDown) { bearScore += w31; indicators.push({ name: 'EMA Slopes', signal: 'bear', value: `All EMAs falling`, confirmed: true, weight: w31 }); }
  else { indicators.push({ name: 'EMA Slopes', signal: 'neutral', value: 'Mixed EMA slopes', confirmed: false, weight: w31 }); }

  // --- NEW: CLOSE POSITION IN RANGE (weight: 1.0) ---
  // For bullish: price should be closing in upper 30% of recent range
  const w32 = 1.0;
  totalWeight += w32;
  const rangeLookback = Math.min(candles.length, 20);
  const recentCandles = candles.slice(-rangeLookback);
  const rangeHigh = Math.max(...recentCandles.map(c => c.high));
  const rangeLow = Math.min(...recentCandles.map(c => c.low));
  const rangePos = rangeHigh === rangeLow ? 0.5 : (price - rangeLow) / (rangeHigh - rangeLow);
  if (rangePos > 0.7) { bullScore += w32; indicators.push({ name: 'Range Position', signal: 'bull', value: `${(rangePos * 100).toFixed(0)}% (upper zone)`, confirmed: true, weight: w32 }); }
  else if (rangePos < 0.3) { bearScore += w32; indicators.push({ name: 'Range Position', signal: 'bear', value: `${(rangePos * 100).toFixed(0)}% (lower zone)`, confirmed: true, weight: w32 }); }
  else { indicators.push({ name: 'Range Position', signal: 'neutral', value: `${(rangePos * 100).toFixed(0)}% (mid-range)`, confirmed: false, weight: w32 }); }

  // ==========================================
  // ESTABLISHED TREND FILTER (stricter)
  // ==========================================
  const isEstablished = consistency50 > 0.65 || consistency200 > 0.7;

  // ==========================================
  // DETERMINE FINAL TREND
  // ==========================================
  const maxScore = Math.max(bullScore, bearScore);
  const scoreRatio = totalWeight > 0 ? maxScore / totalWeight : 0;

  // Need at least 55% weighted agreement AND trend must be established
  if (scoreRatio < 0.55 || !isEstablished) return null;

  // NEW: Penalize if there's a strong opposing divergence
  const hasOpposingDiv = recentDivs.some(d => {
    const dirFromDiv = d.type.includes('bull') ? 'bull' : 'bear';
    const mainDir = bullScore > bearScore ? 'bull' : 'bear';
    return d.type.startsWith('regular_') && dirFromDiv === mainDir;
  });

  const direction: TrendDirection = bullScore > bearScore ? 'bull' : 'bear';

  // Count confirmed indicators
  const confirmedCount = indicators.filter(i => i.confirmed && i.signal === direction).length;
  const totalChecks = indicators.length;

  let strength: TrendStrength = 'weak';
  if (scoreRatio >= 0.75 && confirmedCount >= 20) strength = 'strong';
  else if (scoreRatio >= 0.65 && confirmedCount >= 15) strength = 'moderate';

  const score = direction === 'bull' ? Math.round(bullScore * 4) : -Math.round(bearScore * 4);

  // Probability calculation (enhanced)
  const baseProbability = scoreRatio * 70;
  let probability = baseProbability;

  // Established trend bonus (up to 10%)
  probability += Math.min((consistency50 + consistency200) / 2, 1) * 10;

  // ADX strength bonus (up to 5%)
  probability += Math.min(adx / 60, 1) * 5;

  // Volume confirmation bonus (up to 5%)
  if (volumeRatio > 1.3 || volSpike.consecutiveHighVolume >= 2) probability += 5;

  // Trendline confirmation bonus (up to 5%)
  if (trendlineResult.direction === direction && trendlineResult.fitQuality > 0.6) probability += 5;

  // Hidden divergence confirmation bonus (up to 3%)
  const hiddenDivConfirm = recentDivs.some(d => d.type === (direction === 'bull' ? 'hidden_bull' : 'hidden_bear'));
  if (hiddenDivConfirm) probability += 3;

  // Squeeze reduces reliability
  if (isSqueeze) probability -= 3;

  // Opposing divergence penalty
  if (hasOpposingDiv) probability -= 5;

  // Opposing signal penalty
  const opposingRatio = Math.min(bullScore, bearScore) / totalWeight;
  probability -= opposingRatio * 10;

  probability = Math.max(15, Math.min(95, Math.round(probability)));

  const supportResistance = findSupportResistance(candles, { e9, e21, e50, e200 });

  const trendDuration = calculateTrendDuration(candles, direction, ema9, ema21, rsi, macd.histogram, adx, volumeRatio, atr);

  return {
    direction, strength,
    ema9: e9, ema21: e21, ema50: e50, ema200: e200,
    adx, volumeRatio, score,
    confirmations: confirmedCount, totalChecks,
    indicators,
    rsi, macdHistogram: macd.histogram,
    priceStructure, plusDI, minusDI,
    probability, supportResistance, trendDuration,
  };
}
