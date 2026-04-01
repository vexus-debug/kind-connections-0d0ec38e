export type Timeframe = '1' | '5' | '15' | '60' | '240' | 'D' | 'W';

export const TIMEFRAME_LABELS: Record<Timeframe, string> = {
  '1': '1m',
  '5': '5m',
  '15': '15m',
  '60': '1h',
  '240': '4h',
  'D': '1D',
  'W': '1W',
};

export const ALL_TIMEFRAMES: Timeframe[] = ['1', '5', '15', '60', '240', 'D', 'W'];

export type TrendDirection = 'bull' | 'bear' | null;
export type TrendStrength = 'weak' | 'moderate' | 'strong';

export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface TrendSignal {
  direction: TrendDirection;
  strength: TrendStrength;
  ema9: number;
  ema21: number;
  ema50: number;
  ema200: number;
  adx: number;
  volumeRatio: number;
  score: number;
}

export interface AssetTrend {
  symbol: string;
  price: number;
  change24h: number;
  volume24h: number;
  signals: Partial<Record<Timeframe, TrendSignal>>;
  lastUpdated: number;
  marketType: 'spot' | 'linear';
}

export interface AlertEntry {
  id: string;
  symbol: string;
  timeframe: Timeframe;
  direction: TrendDirection;
  strength: TrendStrength;
  price: number;
  timestamp: number;
  score: number;
}

export interface WatchlistItem {
  symbol: string;
  alertsEnabled: boolean;
  addedAt: number;
}

export interface ScannerSettings {
  scanInterval: number;
  adxThreshold: number;
  emaPeriods: { fast: number; slow: number; mid: number; long: number };
  marketFilter: 'spot' | 'linear' | 'both';
  browserNotifications: boolean;
  minStrength: TrendStrength;
}

export const DEFAULT_SETTINGS: ScannerSettings = {
  scanInterval: 30,
  adxThreshold: 25,
  emaPeriods: { fast: 9, slow: 21, mid: 50, long: 200 },
  marketFilter: 'both',
  browserNotifications: false,
  minStrength: 'weak',
};

export interface BybitTicker {
  symbol: string;
  lastPrice: string;
  price24hPcnt: string;
  volume24h: string;
  turnover24h: string;
}

export interface BybitKlineResponse {
  retCode: number;
  result: {
    symbol: string;
    category: string;
    list: string[][];
  };
}

export interface BybitTickerResponse {
  retCode: number;
  result: {
    category: string;
    list: BybitTicker[];
  };
}
