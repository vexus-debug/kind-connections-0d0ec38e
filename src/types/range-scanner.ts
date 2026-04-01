import type { Timeframe } from './scanner';

export interface RangeLevel {
  upper: number;
  lower: number;
  midpoint: number;
  width: number; // percentage
}

export interface RangeIndicator {
  name: string;
  signal: 'range' | 'trend' | 'neutral';
  value: string;
  confirmed: boolean;
  weight: number;
}

export interface RangeSignal {
  isRanging: boolean;
  strength: 'weak' | 'moderate' | 'strong';
  probability: number;
  adx: number;
  rsi: number;
  volumeRatio: number;
  ema9: number;
  ema21: number;
  ema50: number;
  ema200: number;
  bbBandwidth: number;
  squeeze: boolean;
  confirmations: number;
  totalChecks: number;
  indicators: RangeIndicator[];
  primaryRange: RangeLevel;
  ranges: RangeLevel[];
  positionInRange: number; // 0-100
  atr: number;
  score: number;
}

export interface AssetRange {
  symbol: string;
  price: number;
  change24h: number;
  volume24h: number;
  signals: Partial<Record<Timeframe, RangeSignal>>;
  lastUpdated: number;
  marketType: 'spot' | 'linear';
}
