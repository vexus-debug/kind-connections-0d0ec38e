import type { Candle, Timeframe } from '@/types/scanner';

export interface SwingPoint {
  index: number;
  price: number;
  type: 'high' | 'low';
}

export interface SmcEvent {
  name: string;
  type: 'bullish' | 'bearish' | 'neutral';
  significance: 'high' | 'medium' | 'low';
  description: string;
  candleIndex: number;
  price: number;
  zone?: { high: number; low: number };
  // Enhanced SMC metadata
  meta?: SmcMeta;
}

export interface SmcMeta {
  momentum?: number;           // 0-100 break momentum score
  chochStrength?: number;      // 0-100 CHoCH quality
  bosFailure?: boolean;        // failed BOS
  chochFailures?: number;      // count of failed CHoCH in current trend
  liquiditySweep?: boolean;    // sweep detected
  volatilityOk?: boolean;      // passes volatility filter
  marketPhase?: MarketPhase;
  session?: TradingSession;
  breakAttempts?: number;      // how many times level tested
  isTrap?: boolean;            // trap pattern
  isInducement?: boolean;      // inducement pattern
  isContinuation?: boolean;
  isReversal?: boolean;
  htfAligned?: boolean;        // higher timeframe aligned
  structureScore?: number;     // 0-100 combined score
  probBull?: number;           // 0-100
  probBear?: number;           // 0-100
  riskReward?: number;         // estimated R:R
  suggestedStop?: number;      // price level
  suggestedTarget?: number;    // price level
  nearKeyLevel?: boolean;
  keyLevelName?: string;
  rangePosition?: 'upper' | 'middle' | 'lower' | 'outside';
  volatilityExpansion?: boolean;
  signalQuality?: 'A+' | 'A' | 'B' | 'C';
}

export type MarketPhase = 'accumulation' | 'expansion' | 'retracement' | 'distribution';
export type TradingSession = 'asian' | 'london' | 'new_york' | 'off_hours';

export interface LiquidityPool {
  price: number;
  type: 'above' | 'below';
  strength: number; // how many touches
  indices: number[];
}

export interface RangeZone {
  high: number;
  low: number;
  startIndex: number;
  endIndex: number;
  touches: number;
}

export interface KeyLevel {
  price: number;
  name: string;
  type: 'pdh' | 'pdl' | 'pwh' | 'pwl' | 'psychological' | 'swing';
}

export interface SmcAnalysis {
  events: SmcEvent[];
  liquidityPools: LiquidityPool[];
  range: RangeZone | null;
  marketPhase: MarketPhase;
  session: TradingSession;
  atr: number;
  volatilityOk: boolean;
  volatilityExpansion: boolean;
  probBull: number;
  probBear: number;
  keyLevels: KeyLevel[];
}
