import type { AssetTrend, Timeframe, AlertEntry } from '@/types/scanner';
import type { AssetRange } from '@/types/range-scanner';
import type { DetectedPattern } from '@/hooks/usePatternScanner';
import { shouldAlert, createAlert } from '@/lib/alerts';

export interface CrossScannerSignal {
  symbol: string;
  direction: 'bull' | 'bear';
  agreeing: string[]; // which scanners agree
  score: number;
}

/**
 * Detect when 3+ scanners agree on direction for a symbol.
 */
export function detectCrossScannerSignals(
  trendAssets: AssetTrend[],
  rangeAssets: AssetRange[],
  patterns: DetectedPattern[],
  timeframe: Timeframe = '60'
): CrossScannerSignal[] {
  const signals: CrossScannerSignal[] = [];
  const symbolSet = new Set(trendAssets.map(a => a.symbol));

  for (const symbol of symbolSet) {
    const bull: string[] = [];
    const bear: string[] = [];

    // 1. Trend scanner
    const trend = trendAssets.find(a => a.symbol === symbol);
    if (trend) {
      const sig = trend.signals[timeframe];
      if (sig?.direction === 'bull' && sig.strength !== 'weak') bull.push('Trend');
      if (sig?.direction === 'bear' && sig.strength !== 'weak') bear.push('Trend');
    }

    // 2. Pattern scanner
    const sym = symbol.replace('USDT', '');
    const bullPatterns = patterns.filter(p => (p.symbol === symbol || p.symbol === sym) && p.timeframe === timeframe && p.pattern.type === 'bullish');
    const bearPatterns = patterns.filter(p => (p.symbol === symbol || p.symbol === sym) && p.timeframe === timeframe && p.pattern.type === 'bearish');
    if (bullPatterns.length > 0) bull.push('Pattern');
    if (bearPatterns.length > 0) bear.push('Pattern');

    // 3. Range scanner (at extreme = directional signal)
    const range = rangeAssets.find(a => a.symbol === symbol);
    if (range) {
      const rangeSig = range.signals[timeframe];
      if (rangeSig?.isRanging) {
        if (rangeSig.positionInRange < 15) bull.push('Range(bottom)');
        if (rangeSig.positionInRange > 85) bear.push('Range(top)');
      }
    }

    // 4. Funding rate bias (implicit from trend momentum)
    if (trend) {
      const sig = trend.signals[timeframe];
      if (sig && sig.volumeRatio > 1.5 && sig.direction === 'bull') bull.push('Volume');
      if (sig && sig.volumeRatio > 1.5 && sig.direction === 'bear') bear.push('Volume');
    }

    // Only signal when 3+ agree
    if (bull.length >= 3) {
      const score = Math.min(100, bull.length * 25);
      signals.push({ symbol, direction: 'bull', agreeing: bull, score });
    }
    if (bear.length >= 3) {
      const score = Math.min(100, bear.length * 25);
      signals.push({ symbol, direction: 'bear', agreeing: bear, score });
    }
  }

  return signals.sort((a, b) => b.score - a.score);
}

/**
 * Generate alerts from cross-scanner signals.
 */
export function generateCrossScannerAlerts(
  signals: CrossScannerSignal[],
  trendAssets: AssetTrend[],
  timeframe: Timeframe = '60'
): AlertEntry[] {
  const alerts: AlertEntry[] = [];
  for (const sig of signals) {
    if (!shouldAlert(sig.symbol, timeframe, sig.direction)) continue;
    const asset = trendAssets.find(a => a.symbol === sig.symbol);
    const price = asset?.price ?? 0;
    const alert = createAlert(sig.symbol, timeframe, sig.direction, 'strong', price, sig.score);
    alerts.push(alert);
  }
  return alerts;
}
