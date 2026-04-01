// Re-exports from new SMC modules for backward compatibility
import type { Candle } from '@/types/scanner';
import { analyzeSmartMoneyConcepts, type SmcEvent } from '@/lib/smc';

export type MarketStructureEvent = SmcEvent;

/**
 * Backward-compatible entry point.
 * Delegates to the new comprehensive SMC analysis system.
 */
export function detectMarketStructure(candles: Candle[]): MarketStructureEvent[] {
  const analysis = analyzeSmartMoneyConcepts(candles);
  return analysis.events;
}

export { analyzeSmartMoneyConcepts, type SmcAnalysis, type SmcMeta, type MarketPhase, type TradingSession } from '@/lib/smc';
