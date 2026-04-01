import type { Candle } from '@/types/scanner';
import type { RangeSignal, RangeIndicator, RangeLevel } from '@/types/range-scanner';
import { calculateEMA } from './moving-averages';
import { calculateADX, calculateATR } from './trend';
import { calculateRSI, calculateMACD, calculateStochastic } from './momentum';
import { calculateBollingerBands, calculateKeltnerChannels, calculateDonchianChannels, detectSqueeze } from './volatility';
import { calculateVolumeRatio } from './volume';

function calculateLinearRegression(closes: number[], period = 50) {
  const data = closes.slice(-period), n = data.length;
  if (n < 5) return { slope: 0, rSquared: 0 };
  let sx = 0, sy = 0, sxy = 0, sx2 = 0;
  for (let i = 0; i < n; i++) { sx += i; sy += data[i]; sxy += i * data[i]; sx2 += i * i; }
  const slope = (n * sxy - sx * sy) / (n * sx2 - sx * sx);
  const meanY = sy / n;
  const intercept = meanY - slope * (sx / n);
  let ssTot = 0, ssRes = 0;
  for (let i = 0; i < n; i++) { ssTot += (data[i] - meanY) ** 2; ssRes += (data[i] - (slope * i + intercept)) ** 2; }
  return { slope, rSquared: ssTot === 0 ? 0 : 1 - ssRes / ssTot };
}

function analyzePriceStructure(candles: Candle[], lookback = 30): 'bull' | 'bear' | 'neutral' {
  const r = candles.slice(-lookback);
  if (r.length < 8) return 'neutral';
  const sh: number[] = [], sl: number[] = [];
  for (let i = 2; i < r.length - 2; i++) {
    if (r[i].high > r[i-1].high && r[i].high > r[i-2].high && r[i].high > r[i+1].high && r[i].high > r[i+2].high) sh.push(r[i].high);
    if (r[i].low < r[i-1].low && r[i].low < r[i-2].low && r[i].low < r[i+1].low && r[i].low < r[i+2].low) sl.push(r[i].low);
  }
  if (sh.length < 2 || sl.length < 2) return 'neutral';
  const hh = sh.slice(1).filter((h, i) => h > sh[i]).length + sl.slice(1).filter((l, i) => l > sl[i]).length;
  const ll = sh.slice(1).filter((h, i) => h < sh[i]).length + sl.slice(1).filter((l, i) => l < sl[i]).length;
  if (hh >= 2 && hh > ll) return 'bull';
  if (ll >= 2 && ll > hh) return 'bear';
  return 'neutral';
}

function calcTrendConsistency(candles: Candle[], emaPeriod: number, lookbackBars = 20): number {
  const closes = candles.map(c => c.close), ema = calculateEMA(closes, emaPeriod);
  if (ema.length < lookbackBars) return 0;
  const re = ema.slice(-lookbackBars), rc = closes.slice(-lookbackBars);
  const dir = rc[rc.length - 1] > re[re.length - 1] ? 'above' : 'below';
  let con = 0;
  for (let i = 0; i < lookbackBars; i++) { const ab = rc[i] > re[i]; if ((dir === 'above' && ab) || (dir === 'below' && !ab)) con++; }
  return con / lookbackBars;
}

function findSwingPoints(candles: Candle[], lookback = 3) {
  const pts: { price: number; type: 'high' | 'low' }[] = [];
  for (let i = lookback; i < candles.length - lookback; i++) {
    let isH = true, isL = true;
    for (let j = 1; j <= lookback; j++) {
      if (candles[i].high <= candles[i-j].high || candles[i].high <= candles[i+j].high) isH = false;
      if (candles[i].low >= candles[i-j].low || candles[i].low >= candles[i+j].low) isL = false;
    }
    if (isH) pts.push({ price: candles[i].high, type: 'high' });
    if (isL) pts.push({ price: candles[i].low, type: 'low' });
  }
  return pts;
}

export function analyzeRange(
  candles: Candle[],
  emaPeriods = { fast: 9, slow: 21, mid: 50, long: 200 },
  adxThreshold = 25
): RangeSignal | null {
  if (candles.length < emaPeriods.long + 10) return null;

  const closes = candles.map(c => c.close);
  const price = closes[closes.length - 1];
  const ema9 = calculateEMA(closes, emaPeriods.fast);
  const ema21 = calculateEMA(closes, emaPeriods.slow);
  const ema50 = calculateEMA(closes, emaPeriods.mid);
  const ema200 = calculateEMA(closes, emaPeriods.long);
  const li = closes.length - 1;
  const e9 = ema9[li], e21 = ema21[li], e50 = ema50[li], e200 = ema200[li];

  const { adx, plusDI, minusDI } = calculateADX(candles);
  const rsi = calculateRSI(closes);
  const bb = calculateBollingerBands(closes);
  const kc = calculateKeltnerChannels(candles);
  const donchian = calculateDonchianChannels(candles);
  const atr = calculateATR(candles);
  const volumeRatio = calculateVolumeRatio(candles);
  const isSqueeze = detectSqueeze(bb.upper, bb.lower, kc.upper, kc.lower);
  const linReg = calculateLinearRegression(closes, 50);
  const macd = calculateMACD(closes);
  const stoch = calculateStochastic(candles);
  const consistency50 = calcTrendConsistency(candles, 50, 20);
  const priceStructure = analyzePriceStructure(candles);

  const indicators: RangeIndicator[] = [];
  let rangeScore = 0, totalWeight = 0;

  // 1. ADX (2.5)
  const w1 = 2.5; totalWeight += w1;
  if (adx < 20) { rangeScore += w1; indicators.push({ name: 'ADX', signal: 'range', value: `${adx.toFixed(0)} (very weak)`, confirmed: true, weight: w1 }); }
  else if (adx < adxThreshold) { rangeScore += w1 * 0.7; indicators.push({ name: 'ADX', signal: 'range', value: `${adx.toFixed(0)} (weak)`, confirmed: true, weight: w1 }); }
  else { indicators.push({ name: 'ADX', signal: 'trend', value: `${adx.toFixed(0)} (trending)`, confirmed: false, weight: w1 }); }

  // 2. DI convergence (1.5)
  const w2 = 1.5; totalWeight += w2;
  const diDiff = Math.abs(plusDI - minusDI);
  if (diDiff < 5) { rangeScore += w2; indicators.push({ name: 'DI Spread', signal: 'range', value: `${diDiff.toFixed(1)} (converged)`, confirmed: true, weight: w2 }); }
  else if (diDiff < 10) { rangeScore += w2 * 0.5; indicators.push({ name: 'DI Spread', signal: 'range', value: `${diDiff.toFixed(1)} (narrow)`, confirmed: true, weight: w2 }); }
  else { indicators.push({ name: 'DI Spread', signal: 'trend', value: `${diDiff.toFixed(1)} (wide)`, confirmed: false, weight: w2 }); }

  // 3. BB bandwidth (2.0)
  const w3 = 2.0; totalWeight += w3;
  if (bb.bandwidth < 0.04) { rangeScore += w3; indicators.push({ name: 'BB Width', signal: 'range', value: `${(bb.bandwidth*100).toFixed(1)}% (tight)`, confirmed: true, weight: w3 }); }
  else if (bb.bandwidth < 0.08) { rangeScore += w3 * 0.6; indicators.push({ name: 'BB Width', signal: 'range', value: `${(bb.bandwidth*100).toFixed(1)}% (mod)`, confirmed: true, weight: w3 }); }
  else { indicators.push({ name: 'BB Width', signal: 'trend', value: `${(bb.bandwidth*100).toFixed(1)}% (wide)`, confirmed: false, weight: w3 }); }

  // 4. BB %B mid (1.5)
  const w4 = 1.5; totalWeight += w4;
  if (bb.percentB > 0.3 && bb.percentB < 0.7) { rangeScore += w4; indicators.push({ name: 'BB %B', signal: 'range', value: `${(bb.percentB*100).toFixed(0)}% (mid)`, confirmed: true, weight: w4 }); }
  else { indicators.push({ name: 'BB %B', signal: 'trend', value: `${(bb.percentB*100).toFixed(0)}% (extreme)`, confirmed: false, weight: w4 }); }

  // 5. Squeeze (1.8)
  const w5 = 1.8; totalWeight += w5;
  if (isSqueeze) { rangeScore += w5; indicators.push({ name: 'Squeeze', signal: 'range', value: 'Active', confirmed: true, weight: w5 }); }
  else { indicators.push({ name: 'Squeeze', signal: 'neutral', value: 'None', confirmed: false, weight: w5 }); }

  // 6. RSI near 50 (1.3)
  const w6 = 1.3; totalWeight += w6;
  if (rsi > 40 && rsi < 60) { rangeScore += w6; indicators.push({ name: 'RSI', signal: 'range', value: `${rsi.toFixed(0)} (neutral)`, confirmed: true, weight: w6 }); }
  else { indicators.push({ name: 'RSI', signal: 'trend', value: `${rsi.toFixed(0)}`, confirmed: false, weight: w6 }); }

  // 7. EMA convergence (2.0)
  const w7 = 2.0; totalWeight += w7;
  const emaSpread = Math.max(e9, e21, e50) - Math.min(e9, e21, e50);
  const emaSpreadPct = (emaSpread / price) * 100;
  if (emaSpreadPct < 0.5) { rangeScore += w7; indicators.push({ name: 'EMA Spread', signal: 'range', value: `${emaSpreadPct.toFixed(2)}% (converged)`, confirmed: true, weight: w7 }); }
  else if (emaSpreadPct < 1.5) { rangeScore += w7 * 0.5; indicators.push({ name: 'EMA Spread', signal: 'range', value: `${emaSpreadPct.toFixed(2)}% (narrow)`, confirmed: true, weight: w7 }); }
  else { indicators.push({ name: 'EMA Spread', signal: 'trend', value: `${emaSpreadPct.toFixed(2)}%`, confirmed: false, weight: w7 }); }

  // 8. Lin Reg R² low (1.5)
  const w8 = 1.5; totalWeight += w8;
  if (linReg.rSquared < 0.3) { rangeScore += w8; indicators.push({ name: 'Lin Reg R²', signal: 'range', value: `${linReg.rSquared.toFixed(2)} (no trend)`, confirmed: true, weight: w8 }); }
  else if (linReg.rSquared < 0.5) { rangeScore += w8 * 0.5; indicators.push({ name: 'Lin Reg R²', signal: 'range', value: `${linReg.rSquared.toFixed(2)} (weak)`, confirmed: true, weight: w8 }); }
  else { indicators.push({ name: 'Lin Reg R²', signal: 'trend', value: `${linReg.rSquared.toFixed(2)}`, confirmed: false, weight: w8 }); }

  // 9. MACD near zero (1.2)
  const w9 = 1.2; totalWeight += w9;
  const macdNorm = price > 0 ? Math.abs(macd.macd / price) * 100 : 0;
  if (macdNorm < 0.1) { rangeScore += w9; indicators.push({ name: 'MACD', signal: 'range', value: 'Near zero', confirmed: true, weight: w9 }); }
  else { indicators.push({ name: 'MACD', signal: 'trend', value: `${macd.macd > 0 ? '+' : ''}${macd.macd.toPrecision(3)}`, confirmed: false, weight: w9 }); }

  // 10. Structure neutral (1.5)
  const w10 = 1.5; totalWeight += w10;
  if (priceStructure === 'neutral') { rangeScore += w10; indicators.push({ name: 'Structure', signal: 'range', value: 'No pattern', confirmed: true, weight: w10 }); }
  else { indicators.push({ name: 'Structure', signal: 'trend', value: priceStructure === 'bull' ? 'HH/HL' : 'LH/LL', confirmed: false, weight: w10 }); }

  // 11. Low consistency (1.2)
  const w11 = 1.2; totalWeight += w11;
  if (consistency50 < 0.55) { rangeScore += w11; indicators.push({ name: 'Consistency', signal: 'range', value: `${(consistency50*100).toFixed(0)}% (choppy)`, confirmed: true, weight: w11 }); }
  else { indicators.push({ name: 'Consistency', signal: 'trend', value: `${(consistency50*100).toFixed(0)}%`, confirmed: false, weight: w11 }); }

  // 12. Stochastic mid (1.0)
  const w12 = 1.0; totalWeight += w12;
  if (stoch.k > 25 && stoch.k < 75 && Math.abs(stoch.k - stoch.d) < 10) { rangeScore += w12; indicators.push({ name: 'Stochastic', signal: 'range', value: `K=${stoch.k.toFixed(0)} ~D`, confirmed: true, weight: w12 }); }
  else { indicators.push({ name: 'Stochastic', signal: 'trend', value: `K=${stoch.k.toFixed(0)}`, confirmed: false, weight: w12 }); }

  const scoreRatio = totalWeight > 0 ? rangeScore / totalWeight : 0;
  if (scoreRatio < 0.45) return null;

  const confirmedCount = indicators.filter(i => i.confirmed).length;

  // Range bounds
  const ranges: RangeLevel[] = [];
  ranges.push({ upper: bb.upper, lower: bb.lower, midpoint: bb.middle, width: ((bb.upper - bb.lower) / bb.middle) * 100 });
  ranges.push({ upper: donchian.upper, lower: donchian.lower, midpoint: donchian.middle, width: ((donchian.upper - donchian.lower) / donchian.middle) * 100 });
  ranges.push({ upper: kc.upper, lower: kc.lower, midpoint: kc.middle, width: ((kc.upper - kc.lower) / kc.middle) * 100 });

  const swings = findSwingPoints(candles, 3);
  const recentHighs = swings.filter(s => s.type === 'high').slice(-5).map(s => s.price);
  const recentLows = swings.filter(s => s.type === 'low').slice(-5).map(s => s.price);
  if (recentHighs.length >= 2 && recentLows.length >= 2) {
    const avgH = recentHighs.reduce((s, v) => s + v, 0) / recentHighs.length;
    const avgL = recentLows.reduce((s, v) => s + v, 0) / recentLows.length;
    ranges.push({ upper: avgH, lower: avgL, midpoint: (avgH + avgL) / 2, width: ((avgH - avgL) / ((avgH + avgL) / 2)) * 100 });
  }

  const primaryUpper = ranges.reduce((s, r) => s + r.upper, 0) / ranges.length;
  const primaryLower = ranges.reduce((s, r) => s + r.lower, 0) / ranges.length;
  const primaryMid = (primaryUpper + primaryLower) / 2;
  const primaryWidth = ((primaryUpper - primaryLower) / primaryMid) * 100;
  const rangeSize = primaryUpper - primaryLower;
  const positionInRange = rangeSize > 0 ? ((price - primaryLower) / rangeSize) * 100 : 50;

  let strength: 'weak' | 'moderate' | 'strong' = 'weak';
  if (scoreRatio >= 0.75 && confirmedCount >= 9) strength = 'strong';
  else if (scoreRatio >= 0.6 && confirmedCount >= 6) strength = 'moderate';

  let probability = scoreRatio * 70;
  if (adx < 20) probability += 10; else if (adx < 25) probability += 5;
  if (isSqueeze) probability += 5;
  if (bb.bandwidth < 0.04) probability += 5;
  if (priceStructure === 'neutral') probability += 5;
  probability = Math.max(15, Math.min(95, Math.round(probability)));

  return {
    isRanging: true, strength, probability,
    adx, rsi, volumeRatio,
    ema9: e9, ema21: e21, ema50: e50, ema200: e200,
    bbBandwidth: bb.bandwidth, squeeze: isSqueeze,
    confirmations: confirmedCount, totalChecks: indicators.length,
    indicators,
    primaryRange: { upper: primaryUpper, lower: primaryLower, midpoint: primaryMid, width: primaryWidth },
    ranges, positionInRange, atr,
    score: Math.round(rangeScore * 4),
  };
}
