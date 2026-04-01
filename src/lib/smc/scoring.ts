import type { Candle } from '@/types/scanner';
import type { SmcEvent, SmcMeta, LiquidityPool, RangeZone, MarketPhase, TradingSession, SwingPoint, KeyLevel } from './types';
import { getSessionWeight, getRangePosition } from './market-phase';
import { findNearbyKeyLevel } from './key-levels';

/** Calculate a structure strength score (0-100) for an event */
export function calcStructureScore(event: SmcEvent, ctx: {
  volatilityOk: boolean;
  session: TradingSession;
  range: RangeZone | null;
  keyLevels: KeyLevel[];
  htfAligned?: boolean;
}): number {
  let score = 50;
  const meta = event.meta || {};

  // Significance base
  if (event.significance === 'high') score += 15;
  else if (event.significance === 'low') score -= 15;

  // Momentum
  if (meta.momentum) score += (meta.momentum - 50) * 0.3;

  // CHoCH strength
  if (meta.chochStrength) score += (meta.chochStrength - 50) * 0.2;

  // Volatility
  if (!ctx.volatilityOk) score -= 15;
  if (meta.volatilityExpansion) score += 10;

  // Session weight
  score *= getSessionWeight(ctx.session);

  // Range position — middle of range = lower score
  const pos = getRangePosition(event.price, ctx.range);
  if (pos === 'middle') score -= 20;
  if (pos === 'upper' && event.type === 'bearish') score += 10;
  if (pos === 'lower' && event.type === 'bullish') score += 10;

  // Key level proximity
  const nearLevel = findNearbyKeyLevel(event.price, ctx.keyLevels);
  if (nearLevel) score += 10;

  // HTF alignment
  if (ctx.htfAligned) score += 15;
  if (meta.htfAligned) score += 15;

  // Liquidity sweep
  if (meta.liquiditySweep) score += 12;

  // Trap/failure patterns
  if (meta.isTrap) score += 8;
  if (meta.bosFailure) score += 8;

  // Inducement
  if (meta.isInducement) score += 5;

  // Reversal/continuation
  if (meta.isReversal) score += 10;
  if (meta.isContinuation) score += 8;

  // Break attempts
  if (meta.breakAttempts && meta.breakAttempts >= 3) score += 10;

  return Math.max(0, Math.min(100, Math.round(score)));
}

/** Assign signal quality grade */
export function getSignalQuality(score: number): 'A+' | 'A' | 'B' | 'C' {
  if (score >= 80) return 'A+';
  if (score >= 65) return 'A';
  if (score >= 45) return 'B';
  return 'C';
}

/** Calculate probability dashboard values */
export function calcProbabilities(events: SmcEvent[]): { probBull: number; probBear: number } {
  if (events.length === 0) return { probBull: 50, probBear: 50 };

  let bullScore = 0;
  let bearScore = 0;
  let totalWeight = 0;

  for (const e of events) {
    const score = e.meta?.structureScore || 50;
    const weight = e.significance === 'high' ? 3 : e.significance === 'medium' ? 2 : 1;
    totalWeight += weight;

    if (e.type === 'bullish') bullScore += score * weight;
    else if (e.type === 'bearish') bearScore += score * weight;
    else {
      bullScore += score * weight * 0.5;
      bearScore += score * weight * 0.5;
    }
  }

  if (totalWeight === 0) return { probBull: 50, probBear: 50 };

  const total = bullScore + bearScore;
  if (total === 0) return { probBull: 50, probBear: 50 };

  const probBull = Math.round((bullScore / total) * 100);
  const probBear = 100 - probBull;

  return { probBull, probBear };
}

/** Estimate risk-to-reward based on liquidity targets and structural stops */
export function estimateRiskReward(
  price: number,
  type: 'bullish' | 'bearish',
  swings: SwingPoint[],
  pools: LiquidityPool[]
): { rr: number; stop: number; target: number } {
  const recentHighs = swings.filter(s => s.type === 'high').slice(-5);
  const recentLows = swings.filter(s => s.type === 'low').slice(-5);

  if (type === 'bullish') {
    // Stop below nearest swing low
    const stop = recentLows.length > 0 ? Math.min(...recentLows.map(l => l.price)) : price * 0.97;
    // Target: nearest liquidity above or swing high
    const targets = [
      ...recentHighs.map(h => h.price),
      ...pools.filter(p => p.type === 'above' && p.price > price).map(p => p.price),
    ].filter(t => t > price).sort((a, b) => a - b);
    const target = targets[0] || price * 1.03;
    const risk = price - stop;
    const reward = target - price;
    return { rr: risk > 0 ? Math.round((reward / risk) * 10) / 10 : 0, stop, target };
  } else {
    const stop = recentHighs.length > 0 ? Math.max(...recentHighs.map(h => h.price)) : price * 1.03;
    const targets = [
      ...recentLows.map(l => l.price),
      ...pools.filter(p => p.type === 'below' && p.price < price).map(p => p.price),
    ].filter(t => t < price).sort((a, b) => b - a);
    const target = targets[0] || price * 0.97;
    const risk = stop - price;
    const reward = price - target;
    return { rr: risk > 0 ? Math.round((reward / risk) * 10) / 10 : 0, stop, target };
  }
}

/** Apply scoring and quality grades to all events */
export function enrichEvents(
  events: SmcEvent[],
  ctx: {
    candles: Candle[];
    volatilityOk: boolean;
    session: TradingSession;
    range: RangeZone | null;
    keyLevels: KeyLevel[];
    swings: SwingPoint[];
    pools: LiquidityPool[];
    htfAligned?: boolean;
  }
): SmcEvent[] {
  return events.map(e => {
    const score = calcStructureScore(e, ctx);
    const quality = getSignalQuality(score);
    const rangePos = getRangePosition(e.price, ctx.range);
    const nearLevel = findNearbyKeyLevel(e.price, ctx.keyLevels);

    let rr = 0, stop = 0, target = 0;
    if (e.type === 'bullish' || e.type === 'bearish') {
      const est = estimateRiskReward(e.price, e.type, ctx.swings, ctx.pools);
      rr = est.rr;
      stop = est.stop;
      target = est.target;
    }

    return {
      ...e,
      meta: {
        ...e.meta,
        structureScore: score,
        signalQuality: quality,
        rangePosition: rangePos,
        nearKeyLevel: !!nearLevel,
        keyLevelName: nearLevel?.name,
        session: ctx.session,
        volatilityOk: ctx.volatilityOk,
        htfAligned: ctx.htfAligned,
        riskReward: rr,
        suggestedStop: stop,
        suggestedTarget: target,
      },
    };
  });
}
