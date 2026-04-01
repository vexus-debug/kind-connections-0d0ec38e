import type { Candle } from '@/types/scanner';

/** Volume ratio: current vs average */
export function calculateVolumeRatio(candles: Candle[], lookback = 20): number {
  if (candles.length < 2) return 1;
  const recent = candles[candles.length - 1].volume;
  const slice = candles.slice(-Math.min(lookback + 1, candles.length), -1);
  if (slice.length === 0) return 1;
  const avg = slice.reduce((s, c) => s + c.volume, 0) / slice.length;
  return avg === 0 ? 1 : recent / avg;
}

/** On-Balance Volume — cumulative volume direction */
export function calculateOBV(candles: Candle[]): { value: number; trend: 'bull' | 'bear' | 'neutral' } {
  if (candles.length < 2) return { value: 0, trend: 'neutral' };

  let obv = 0;
  const obvSeries: number[] = [0];
  for (let i = 1; i < candles.length; i++) {
    if (candles[i].close > candles[i - 1].close) obv += candles[i].volume;
    else if (candles[i].close < candles[i - 1].close) obv -= candles[i].volume;
    obvSeries.push(obv);
  }

  // Determine OBV trend over last 10 bars
  const lookback = Math.min(10, obvSeries.length);
  const recentOBV = obvSeries.slice(-lookback);
  const firstHalf = recentOBV.slice(0, Math.floor(lookback / 2));
  const secondHalf = recentOBV.slice(Math.floor(lookback / 2));
  const avgFirst = firstHalf.reduce((s, v) => s + v, 0) / firstHalf.length;
  const avgSecond = secondHalf.reduce((s, v) => s + v, 0) / secondHalf.length;

  const pctChange = avgFirst === 0 ? 0 : ((avgSecond - avgFirst) / Math.abs(avgFirst)) * 100;
  const trend = pctChange > 5 ? 'bull' : pctChange < -5 ? 'bear' : 'neutral';

  return { value: obv, trend };
}

/** Accumulation/Distribution Line */
export function calculateAD(candles: Candle[]): { value: number; trend: 'bull' | 'bear' | 'neutral' } {
  if (candles.length < 2) return { value: 0, trend: 'neutral' };

  let ad = 0;
  const adSeries: number[] = [];
  for (const c of candles) {
    const range = c.high - c.low;
    const mfm = range === 0 ? 0 : ((c.close - c.low) - (c.high - c.close)) / range;
    ad += mfm * c.volume;
    adSeries.push(ad);
  }

  // Trend from last 10 bars
  const lookback = Math.min(10, adSeries.length);
  const recent = adSeries.slice(-lookback);
  const first = recent.slice(0, Math.floor(lookback / 2));
  const second = recent.slice(Math.floor(lookback / 2));
  const avgFirst = first.reduce((s, v) => s + v, 0) / first.length;
  const avgSecond = second.reduce((s, v) => s + v, 0) / second.length;

  const diff = avgFirst === 0 ? 0 : ((avgSecond - avgFirst) / Math.abs(avgFirst || 1)) * 100;
  const trend = diff > 5 ? 'bull' : diff < -5 ? 'bear' : 'neutral';

  return { value: ad, trend };
}

/** Volume-Price Trend */
export function calculateVPT(candles: Candle[]): { value: number; trend: 'bull' | 'bear' | 'neutral' } {
  if (candles.length < 2) return { value: 0, trend: 'neutral' };

  let vpt = 0;
  const vptSeries: number[] = [0];
  for (let i = 1; i < candles.length; i++) {
    const pctChange = candles[i - 1].close === 0 ? 0 : (candles[i].close - candles[i - 1].close) / candles[i - 1].close;
    vpt += candles[i].volume * pctChange;
    vptSeries.push(vpt);
  }

  const lookback = Math.min(10, vptSeries.length);
  const recent = vptSeries.slice(-lookback);
  const midpoint = Math.floor(lookback / 2);
  const avgFirst = recent.slice(0, midpoint).reduce((s, v) => s + v, 0) / midpoint;
  const avgSecond = recent.slice(midpoint).reduce((s, v) => s + v, 0) / (lookback - midpoint);

  const diff = avgFirst === 0 ? 0 : ((avgSecond - avgFirst) / Math.abs(avgFirst || 1)) * 100;
  const trend = diff > 5 ? 'bull' : diff < -5 ? 'bear' : 'neutral';

  return { value: vpt, trend };
}

/** Volume spike detection */
export function detectVolumeSpikes(candles: Candle[], threshold = 2.5, lookback = 20): {
  isSpike: boolean;
  ratio: number;
  consecutiveHighVolume: number;
} {
  if (candles.length < lookback + 1) return { isSpike: false, ratio: 1, consecutiveHighVolume: 0 };

  const avgSlice = candles.slice(-lookback - 1, -1);
  const avgVol = avgSlice.reduce((s, c) => s + c.volume, 0) / avgSlice.length;
  const currentVol = candles[candles.length - 1].volume;
  const ratio = avgVol === 0 ? 1 : currentVol / avgVol;

  // Count consecutive bars with above-average volume
  let consecutive = 0;
  for (let i = candles.length - 1; i >= Math.max(0, candles.length - 10); i--) {
    if (candles[i].volume > avgVol * 1.3) consecutive++;
    else break;
  }

  return { isSpike: ratio >= threshold, ratio, consecutiveHighVolume: consecutive };
}

/** Simple volume cluster detection at price levels */
export function detectVolumeClusters(candles: Candle[], bins = 20): {
  highVolumeZone: 'support' | 'resistance' | 'fair_value' | 'none';
  vpocPrice: number; // Volume Point of Control
} {
  if (candles.length < 10) return { highVolumeZone: 'none', vpocPrice: 0 };

  const lookback = Math.min(candles.length, 100);
  const recent = candles.slice(-lookback);
  const price = candles[candles.length - 1].close;

  let minPrice = Infinity, maxPrice = -Infinity;
  for (const c of recent) {
    if (c.low < minPrice) minPrice = c.low;
    if (c.high > maxPrice) maxPrice = c.high;
  }

  const range = maxPrice - minPrice;
  if (range === 0) return { highVolumeZone: 'none', vpocPrice: price };

  const binSize = range / bins;
  const volumeAtPrice = new Array(bins).fill(0);

  for (const c of recent) {
    const tp = (c.high + c.low + c.close) / 3;
    const bin = Math.min(Math.floor((tp - minPrice) / binSize), bins - 1);
    volumeAtPrice[bin] += c.volume;
  }

  // Find VPOC (highest volume bin)
  let maxVol = 0, vpocBin = 0;
  for (let i = 0; i < bins; i++) {
    if (volumeAtPrice[i] > maxVol) {
      maxVol = volumeAtPrice[i];
      vpocBin = i;
    }
  }

  const vpocPrice = minPrice + (vpocBin + 0.5) * binSize;
  const priceBin = Math.min(Math.floor((price - minPrice) / binSize), bins - 1);

  let zone: 'support' | 'resistance' | 'fair_value' | 'none' = 'none';
  if (Math.abs(priceBin - vpocBin) <= 1) {
    zone = 'fair_value'; // price is at VPOC = fair value
  } else if (vpocBin < priceBin) {
    zone = 'support'; // high volume zone below = support
  } else {
    zone = 'resistance'; // high volume zone above = resistance
  }

  return { highVolumeZone: zone, vpocPrice };
}
