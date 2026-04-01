import type { AssetTrend, Timeframe } from '@/types/scanner';
import type { AssetRange } from '@/types/range-scanner';
import type { DetectedPattern } from '@/hooks/usePatternScanner';
import type { Divergence } from './divergence';

export interface ConfluenceSignal {
  symbol: string;
  timeframe: Timeframe;
  direction: 'bull' | 'bear' | 'range' | 'neutral';
  score: number; // 0-100
  components: ConfluenceComponent[];
  topReason: string;
}

export interface ConfluenceComponent {
  source: 'trend' | 'pattern' | 'structure' | 'range' | 'divergence';
  signal: 'bull' | 'bear' | 'neutral' | 'range';
  strength: number; // 0-100
  label: string;
}

export interface ConfluenceCell {
  symbol: string;
  timeframe: Timeframe;
  signal: ConfluenceSignal | null;
}

/**
 * Calculate confluence score for a symbol on a specific timeframe.
 * Combines: trend scanner, candlestick patterns, chart patterns, market structure, range, divergences.
 */
export function calculateConfluence(
  symbol: string,
  tf: Timeframe,
  trendAssets: AssetTrend[],
  rangeAssets: AssetRange[],
  patterns: DetectedPattern[],
  divergences: Map<string, Divergence[]>
): ConfluenceSignal {
  const components: ConfluenceComponent[] = [];
  let bullScore = 0;
  let bearScore = 0;
  let rangeScore = 0;

  // 1. Trend Scanner (weight: 35%)
  const trendAsset = trendAssets.find(a => a.symbol === symbol);
  if (trendAsset) {
    const sig = trendAsset.signals[tf] as any;
    if (sig && sig.direction) {
      const strength = sig.strength === 'strong' ? 90 : sig.strength === 'moderate' ? 65 : 40;
      const conf = sig.confirmations ?? 0;
      const total = sig.totalChecks ?? 0;
      components.push({
        source: 'trend',
        signal: sig.direction,
        strength,
        label: `${sig.strength} ${sig.direction === 'bull' ? 'uptrend' : 'downtrend'} (${conf}/${total})`,
      });
      if (sig.direction === 'bull') bullScore += strength * 0.35;
      else bearScore += strength * 0.35;
    }
  }

  // 2. Patterns (weight: 25%)
  const symbolPatterns = patterns.filter(
    p => (p.symbol === symbol || p.symbol === symbol.replace('USDT', '')) && p.timeframe === tf
  );
  if (symbolPatterns.length > 0) {
    const bullPatterns = symbolPatterns.filter(p => p.pattern.type === 'bullish');
    const bearPatterns = symbolPatterns.filter(p => p.pattern.type === 'bearish');
    
    if (bullPatterns.length > 0) {
      const bestSig = bullPatterns[0].pattern.significance;
      const strength = bestSig === 'high' ? 85 : bestSig === 'medium' ? 60 : 35;
      components.push({
        source: 'pattern',
        signal: 'bull',
        strength,
        label: `${bullPatterns.length} bullish pattern(s): ${bullPatterns.map(p => p.pattern.name).join(', ')}`,
      });
      bullScore += strength * 0.25;
    }
    if (bearPatterns.length > 0) {
      const bestSig = bearPatterns[0].pattern.significance;
      const strength = bestSig === 'high' ? 85 : bestSig === 'medium' ? 60 : 35;
      components.push({
        source: 'pattern',
        signal: 'bear',
        strength,
        label: `${bearPatterns.length} bearish pattern(s): ${bearPatterns.map(p => p.pattern.name).join(', ')}`,
      });
      bearScore += strength * 0.25;
    }
  }

  // 3. Market Structure (weight: 20%)
  const structurePatterns = symbolPatterns.filter(p => p.category === 'structure');
  if (structurePatterns.length > 0) {
    const bullStruct = structurePatterns.filter(p => p.pattern.type === 'bullish');
    const bearStruct = structurePatterns.filter(p => p.pattern.type === 'bearish');
    
    if (bullStruct.length > bearStruct.length) {
      components.push({
        source: 'structure',
        signal: 'bull',
        strength: 75,
        label: bullStruct.map(p => p.pattern.name).join(', '),
      });
      bullScore += 75 * 0.2;
    } else if (bearStruct.length > bullStruct.length) {
      components.push({
        source: 'structure',
        signal: 'bear',
        strength: 75,
        label: bearStruct.map(p => p.pattern.name).join(', '),
      });
      bearScore += 75 * 0.2;
    }
  }

  // 4. Range Scanner (weight: 10%)
  const rangeAsset = rangeAssets.find(a => a.symbol === symbol);
  if (rangeAsset) {
    const rangeSig = rangeAsset.signals[tf];
    if (rangeSig && rangeSig.isRanging) {
      const strength = rangeSig.strength === 'strong' ? 85 : rangeSig.strength === 'moderate' ? 60 : 35;
      components.push({
        source: 'range',
        signal: 'range',
        strength,
        label: `Ranging (${rangeSig.primaryRange.width.toFixed(1)}% width, pos: ${rangeSig.positionInRange.toFixed(0)}%)`,
      });
      rangeScore += strength * 0.1;
    }
  }

  // 5. Divergences (weight: 10%)
  const divKey = `${symbol}-${tf}`;
  const divs = divergences.get(divKey) || [];
  if (divs.length > 0) {
    const bullDivs = divs.filter(d => d.type === 'regular_bull' || d.type === 'hidden_bull');
    const bearDivs = divs.filter(d => d.type === 'regular_bear' || d.type === 'hidden_bear');
    
    if (bullDivs.length > 0) {
      const strength = bullDivs[0].strength === 'strong' ? 85 : 60;
      components.push({
        source: 'divergence',
        signal: 'bull',
        strength,
        label: `${bullDivs[0].type.replace('_', ' ')} ${bullDivs[0].indicator} divergence`,
      });
      bullScore += strength * 0.1;
    }
    if (bearDivs.length > 0) {
      const strength = bearDivs[0].strength === 'strong' ? 85 : 60;
      components.push({
        source: 'divergence',
        signal: 'bear',
        strength,
        label: `${bearDivs[0].type.replace('_', ' ')} ${bearDivs[0].indicator} divergence`,
      });
      bearScore += strength * 0.1;
    }
  }

  // Determine final direction
  const maxScore = Math.max(bullScore, bearScore, rangeScore);
  let direction: ConfluenceSignal['direction'] = 'neutral';
  let score = 0;

  if (maxScore < 15) {
    direction = 'neutral';
    score = 0;
  } else if (rangeScore > bullScore && rangeScore > bearScore) {
    direction = 'range';
    score = Math.round(rangeScore);
  } else if (bullScore > bearScore) {
    direction = 'bull';
    score = Math.round(bullScore);
    // Bonus if multiple sources agree
    const bullComponents = components.filter(c => c.signal === 'bull');
    if (bullComponents.length >= 3) score = Math.min(100, score + 10);
  } else {
    direction = 'bear';
    score = Math.round(bearScore);
    const bearComponents = components.filter(c => c.signal === 'bear');
    if (bearComponents.length >= 3) score = Math.min(100, score + 10);
  }

  score = Math.min(100, Math.max(0, score));

  const topReason = components.length > 0
    ? components.sort((a, b) => b.strength - a.strength)[0].label
    : 'No signals';

  return { symbol, timeframe: tf, direction, score, components, topReason };
}

export function getConfluenceColor(score: number, direction: string): string {
  if (score === 0 || direction === 'neutral') return 'transparent';
  const opacity = Math.max(0.1, Math.min(0.8, score / 100));
  
  if (direction === 'bull') return `hsl(142 72% 45% / ${opacity})`;
  if (direction === 'bear') return `hsl(0 72% 50% / ${opacity})`;
  if (direction === 'range') return `hsl(217 90% 60% / ${opacity})`;
  return 'transparent';
}

export function getConfluenceLabel(score: number): string {
  if (score >= 75) return 'A+';
  if (score >= 60) return 'A';
  if (score >= 45) return 'B';
  if (score >= 30) return 'C';
  if (score >= 15) return 'D';
  return '—';
}
