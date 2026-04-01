import type { Candle } from '@/types/scanner';
import type { SmcAnalysis, SmcEvent } from './types';
import { findSwings } from './swings';
import { detectBosChoch, detectContinuationPatterns, countFailedChoch } from './bos-choch';
import { detectLiquidityPools, detectLiquiditySweeps, detectInducement } from './liquidity';
import { detectFVGs, detectOrderBlocks } from './fvg-ob';
import { detectMarketPhase, detectRange, detectRangeEvents, detectSession } from './market-phase';
import { calcATR, isVolatilityOk, detectVolatilityExpansion } from './volatility-filter';
import { detectKeyLevels, detectKeyLevelEvents } from './key-levels';
import { detectTrapPatterns, detectReversalPatterns } from './patterns';
import { enrichEvents, calcProbabilities } from './scoring';

export type { SmcEvent, SmcAnalysis, SmcMeta, MarketPhase, TradingSession, LiquidityPool, RangeZone, KeyLevel } from './types';

/**
 * Full SMC analysis on a set of candles.
 * Returns enriched events with scores, probabilities, and metadata.
 */
export function analyzeSmartMoneyConcepts(candles: Candle[], htfBias?: 'bullish' | 'bearish' | null): SmcAnalysis {
  if (candles.length < 20) {
    return {
      events: [],
      liquidityPools: [],
      range: null,
      marketPhase: 'accumulation',
      session: detectSession(),
      atr: 0,
      volatilityOk: false,
      volatilityExpansion: false,
      probBull: 50,
      probBear: 50,
      keyLevels: [],
    };
  }

  // Core analysis
  const swings = findSwings(candles, 3);
  const atr = calcATR(candles);
  const volOk = isVolatilityOk(candles, atr);
  const { expansion, events: volEvents } = detectVolatilityExpansion(candles);
  const session = detectSession(candles[candles.length - 1].time);
  const range = detectRange(candles, atr);
  const marketPhase = detectMarketPhase(candles, swings, atr);
  const keyLevels = detectKeyLevels(candles);

  // Collect all events
  const allEvents: SmcEvent[] = [];

  allEvents.push(...detectBosChoch(candles, swings));
  
  const { events: liqEvents, pools } = detectLiquidityPools(candles, swings);
  allEvents.push(...liqEvents);
  allEvents.push(...detectLiquiditySweeps(candles, pools));
  allEvents.push(...detectInducement(candles, swings));
  allEvents.push(...detectFVGs(candles));
  allEvents.push(...detectOrderBlocks(candles));
  allEvents.push(...detectRangeEvents(candles, range));
  allEvents.push(...detectKeyLevelEvents(candles, keyLevels));
  allEvents.push(...detectTrapPatterns(candles, swings));
  allEvents.push(...detectReversalPatterns(candles, swings, pools));
  allEvents.push(...detectContinuationPatterns(candles, swings));
  allEvents.push(...volEvents);

  // Enrich with scores
  const htfAligned = htfBias != null;
  const enriched = enrichEvents(allEvents, {
    candles,
    volatilityOk: volOk,
    session,
    range,
    keyLevels,
    swings,
    pools,
    htfAligned,
  });

  // Filter: only keep B+ quality signals unless very few
  let filtered = enriched.filter(e => e.meta?.signalQuality !== 'C');
  if (filtered.length < 3) filtered = enriched;

  // Calculate probabilities
  const { probBull, probBear } = calcProbabilities(filtered);

  // Count failed CHoCH in the current trend
  const chochFailures = countFailedChoch(candles, swings);

  // Apply probabilities and chochFailures to each event
  const finalEvents = filtered.map(e => ({
    ...e,
    meta: { ...e.meta, probBull, probBear, marketPhase, chochFailures },
  }));

  return {
    events: finalEvents,
    liquidityPools: pools,
    range,
    marketPhase,
    session,
    atr,
    volatilityOk: volOk,
    volatilityExpansion: expansion,
    probBull,
    probBear,
    keyLevels,
  };
}

/**
 * Backward-compatible wrapper that returns MarketStructureEvent[] format.
 * Used by the existing usePatternScanner hook.
 */
export function detectMarketStructureV2(candles: Candle[], htfBias?: 'bullish' | 'bearish' | null) {
  const analysis = analyzeSmartMoneyConcepts(candles, htfBias);
  return {
    events: analysis.events,
    analysis,
  };
}
