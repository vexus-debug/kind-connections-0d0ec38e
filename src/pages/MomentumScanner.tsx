import { useState, useEffect, useCallback } from 'react';
import { Activity, Zap, TrendingUp, TrendingDown, RefreshCw, Filter, Clock, Volume2, BarChart3, Shield, Flame, Target, Layers, BookOpen, DollarSign } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';

interface MomentumSignal {
  symbol: string;
  price: number;
  change24h: number;
  volume24h: number;
  turnover24h: number;
  timeframe: string;
  score: number;
  direction: 'bull' | 'bear';
  signals: {
    rsiBreakout: boolean;
    macdCross: boolean;
    volumeSpike: boolean;
    adxSurge: boolean;
    emaCrossover: boolean;
    priceAcceleration: boolean;
    stochMomentum: boolean;
    obvBreakout: boolean;
    squeezeFire: boolean;
    vwapBreak: boolean;
    momentumAcceleration: boolean;
    earlyMove: boolean;
    rangeBreakout: boolean;
    volatilityExpansion: boolean;
    consolidationBreakout: boolean;
    momentumIgnition: boolean;
    htfTrendAligned: boolean;
    highLiquidity: boolean;
  };
  details: {
    rsi: number;
    macd: number;
    macdSignal: number;
    macdHist: number;
    adx: number;
    volumeRatio: number;
    roc: number;
    stochK: number;
    stochD: number;
    ema9: number;
    ema21: number;
    ema50: number;
    atr: number;
    bbSqueeze: number;
    rocAccel: number;
    rangePosition: number;
    atrExpansion: number;
    consolidationBars: number;
    htfTrend: string;
  };
  marketData?: {
    openInterest?: number;
    oiChange5m?: number;
    fundingRate?: number;
    predictedFunding?: number;
    fundingShift?: number;
    orderBookImbalance?: number;
    bidAskRatio?: number;
  };
  timestamp: number;
}

interface ScanResult {
  signals: MomentumSignal[];
  scannedAt: string;
  totalScanned: number;
  totalTimeframes: number;
}

const TF_LABELS: Record<string, string> = {
  '15': '15m',
  '60': '1H',
  '240': '4H',
  'D': '1D',
};

const SIGNAL_LABELS: Record<string, { label: string; color: string }> = {
  rsiBreakout: { label: 'RSI', color: 'bg-blue-500/20 text-blue-400' },
  macdCross: { label: 'MACD', color: 'bg-purple-500/20 text-purple-400' },
  volumeSpike: { label: 'VOL', color: 'bg-amber-500/20 text-amber-400' },
  adxSurge: { label: 'ADX', color: 'bg-cyan-500/20 text-cyan-400' },
  emaCrossover: { label: 'EMA', color: 'bg-green-500/20 text-green-400' },
  priceAcceleration: { label: 'ACCEL', color: 'bg-orange-500/20 text-orange-400' },
  stochMomentum: { label: 'STOCH', color: 'bg-pink-500/20 text-pink-400' },
  obvBreakout: { label: 'OBV', color: 'bg-teal-500/20 text-teal-400' },
  squeezeFire: { label: 'SQUEEZE', color: 'bg-red-500/20 text-red-400' },
  vwapBreak: { label: 'VWAP', color: 'bg-indigo-500/20 text-indigo-400' },
  momentumAcceleration: { label: 'M-ACCEL', color: 'bg-rose-500/20 text-rose-400' },
  earlyMove: { label: 'EARLY', color: 'bg-lime-500/20 text-lime-400' },
  rangeBreakout: { label: 'RNG-BO', color: 'bg-yellow-500/20 text-yellow-400' },
  volatilityExpansion: { label: 'VOL-EXP', color: 'bg-fuchsia-500/20 text-fuchsia-400' },
  consolidationBreakout: { label: 'CONSOL-BO', color: 'bg-emerald-500/20 text-emerald-400' },
  momentumIgnition: { label: 'IGNITION', color: 'bg-red-600/20 text-red-300' },
  htfTrendAligned: { label: 'HTF', color: 'bg-sky-500/20 text-sky-400' },
  highLiquidity: { label: 'LIQ', color: 'bg-slate-500/20 text-slate-300' },
};

function formatVolume(v: number): string {
  if (v >= 1e9) return `$${(v / 1e9).toFixed(1)}B`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
  return `$${(v / 1e3).toFixed(0)}K`;
}

function formatOI(v: number): string {
  if (v >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
  return v.toFixed(0);
}

function ScoreBar({ score }: { score: number }) {
  const pct = Math.min(score, 100);
  const color = score >= 80 ? 'bg-green-500' : score >= 60 ? 'bg-amber-500' : 'bg-primary';
  return (
    <div className="flex items-center gap-2">
      <div className="w-16 h-1.5 rounded-full bg-muted overflow-hidden">
        <div className={cn('h-full rounded-full transition-all', color)} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs font-bold tabular-nums">{score}</span>
    </div>
  );
}

type SignalFilter = 'all' | 'earlyMove' | 'rangeBreakout' | 'consolidationBreakout' | 'momentumIgnition' | 'volatilityExpansion' | 'htfTrendAligned';

const SIGNAL_FILTER_OPTIONS: { value: SignalFilter; label: string; icon: typeof Flame }[] = [
  { value: 'all', label: 'All', icon: Layers },
  { value: 'earlyMove', label: 'Early', icon: Target },
  { value: 'rangeBreakout', label: 'Range BO', icon: BarChart3 },
  { value: 'consolidationBreakout', label: 'Consol BO', icon: Shield },
  { value: 'momentumIgnition', label: 'Ignition', icon: Flame },
  { value: 'volatilityExpansion', label: 'Vol Exp', icon: Activity },
  { value: 'htfTrendAligned', label: 'HTF Trend', icon: TrendingUp },
];

export default function MomentumScanner() {
  const [data, setData] = useState<ScanResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dirFilter, setDirFilter] = useState<'all' | 'bull' | 'bear'>('all');
  const [tfFilter, setTfFilter] = useState<string>('all');
  const [minScore, setMinScore] = useState(30);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [signalFilter, setSignalFilter] = useState<SignalFilter>('all');
  const [activeTab, setActiveTab] = useState('scanner');

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;
      const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
      const res = await fetch(`https://${projectId}.supabase.co/functions/v1/momentum-scanner`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': key,
        },
        body: JSON.stringify({}),
      });
      if (!res.ok) throw new Error(`Error: ${res.status}`);
      const result = await res.json();
      setData(result);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const filtered = (data?.signals ?? []).filter(s => {
    if (dirFilter !== 'all' && s.direction !== dirFilter) return false;
    if (tfFilter !== 'all' && s.timeframe !== tfFilter) return false;
    if (s.score < minScore) return false;
    if (signalFilter !== 'all' && !s.signals[signalFilter]) return false;
    return true;
  });

  // Group by symbol
  const grouped = new Map<string, MomentumSignal[]>();
  for (const s of filtered) {
    const arr = grouped.get(s.symbol) || [];
    arr.push(s);
    grouped.set(s.symbol, arr);
  }
  const sortedSymbols = [...grouped.entries()]
    .map(([symbol, signals]) => ({
      symbol,
      signals: signals.sort((a, b) => b.score - a.score),
      bestScore: Math.max(...signals.map(s => s.score)),
      tfCount: new Set(signals.map(s => s.timeframe)).size,
    }))
    .sort((a, b) => {
      if (b.tfCount !== a.tfCount) return b.tfCount - a.tfCount;
      return b.bestScore - a.bestScore;
    });

  // Leaderboard: top symbols by best score
  const leaderboard = [...grouped.entries()]
    .map(([symbol, signals]) => {
      const best = signals.sort((a, b) => b.score - a.score)[0];
      return { symbol, best, tfCount: new Set(signals.map(s => s.timeframe)).size };
    })
    .sort((a, b) => b.best.score - a.best.score)
    .slice(0, 20);

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background">
      {/* Header */}
      <div className="border-b border-border bg-card px-4 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Zap className="h-5 w-5 text-primary" />
            <h1 className="text-sm font-bold uppercase tracking-wider text-foreground">Momentum Scanner</h1>
          </div>
          <div className="flex items-center gap-2">
            {data && (
              <span className="text-[10px] text-muted-foreground">
                {data.totalScanned} coins · {new Date(data.scannedAt).toLocaleTimeString()}
              </span>
            )}
            <button
              onClick={fetchData}
              disabled={loading}
              className="flex items-center gap-1 rounded-md bg-primary/10 px-2 py-1 text-xs font-medium text-primary hover:bg-primary/20 transition-colors disabled:opacity-50"
            >
              <RefreshCw className={cn('h-3 w-3', loading && 'animate-spin')} />
              Scan
            </button>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col overflow-hidden">
        <div className="border-b border-border bg-card px-4">
          <TabsList className="h-8 bg-transparent p-0 gap-1">
            <TabsTrigger value="scanner" className="text-[10px] h-7 px-2 data-[state=active]:bg-primary/10 data-[state=active]:text-primary rounded">Scanner</TabsTrigger>
            <TabsTrigger value="leaderboard" className="text-[10px] h-7 px-2 data-[state=active]:bg-primary/10 data-[state=active]:text-primary rounded">Leaderboard</TabsTrigger>
            <TabsTrigger value="market-data" className="text-[10px] h-7 px-2 data-[state=active]:bg-primary/10 data-[state=active]:text-primary rounded">Market Data</TabsTrigger>
          </TabsList>
        </div>

        {/* Scanner tab filters */}
        <TabsContent value="scanner" className="flex-1 flex flex-col overflow-hidden mt-0">
          {/* Filters */}
          <div className="border-b border-border bg-card px-4 py-2 space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-1">
                <Filter className="h-3 w-3 text-muted-foreground" />
                {(['all', 'bull', 'bear'] as const).map(d => (
                  <button
                    key={d}
                    onClick={() => setDirFilter(d)}
                    className={cn(
                      'rounded px-2 py-0.5 text-[10px] font-medium transition-colors',
                      dirFilter === d ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-secondary'
                    )}
                  >
                    {d === 'all' ? 'All' : d === 'bull' ? '🟢 Bull' : '🔴 Bear'}
                  </button>
                ))}
              </div>

              <div className="flex items-center gap-1">
                <Clock className="h-3 w-3 text-muted-foreground" />
                {['all', '15', '60', '240', 'D'].map(tf => (
                  <button
                    key={tf}
                    onClick={() => setTfFilter(tf)}
                    className={cn(
                      'rounded px-2 py-0.5 text-[10px] font-medium transition-colors',
                      tfFilter === tf ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-secondary'
                    )}
                  >
                    {tf === 'all' ? 'All' : TF_LABELS[tf]}
                  </button>
                ))}
              </div>

              <div className="flex items-center gap-1">
                <BarChart3 className="h-3 w-3 text-muted-foreground" />
                {[30, 50, 70].map(s => (
                  <button
                    key={s}
                    onClick={() => setMinScore(s)}
                    className={cn(
                      'rounded px-2 py-0.5 text-[10px] font-medium transition-colors',
                      minScore === s ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-secondary'
                    )}
                  >
                    {s}+
                  </button>
                ))}
              </div>
            </div>

            {/* Signal type filter */}
            <div className="flex flex-wrap items-center gap-1">
              <Target className="h-3 w-3 text-muted-foreground mr-0.5" />
              {SIGNAL_FILTER_OPTIONS.map(opt => (
                <button
                  key={opt.value}
                  onClick={() => setSignalFilter(opt.value)}
                  className={cn(
                    'rounded px-1.5 py-0.5 text-[9px] font-medium transition-colors flex items-center gap-0.5',
                    signalFilter === opt.value ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-secondary'
                  )}
                >
                  <opt.icon className="h-2.5 w-2.5" />
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Signal list */}
          <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
            {loading && !data && (
              <div className="flex flex-col items-center justify-center h-64 gap-3">
                <RefreshCw className="h-8 w-8 text-primary animate-spin" />
                <p className="text-sm text-muted-foreground">Scanning 100 coins across 4 timeframes...</p>
                <p className="text-xs text-muted-foreground">This may take 30-60 seconds</p>
              </div>
            )}

            {error && (
              <div className="flex items-center justify-center h-32">
                <p className="text-sm text-destructive">{error}</p>
              </div>
            )}

            {!loading && data && sortedSymbols.length === 0 && (
              <div className="flex items-center justify-center h-32">
                <p className="text-sm text-muted-foreground">No momentum signals detected with current filters</p>
              </div>
            )}

            {sortedSymbols.map(({ symbol, signals, bestScore, tfCount }) => {
              const best = signals[0];
              const isExpanded = expanded === symbol;
              return (
                <div key={symbol} className="rounded-lg border border-border bg-card overflow-hidden">
                  <button
                    onClick={() => setExpanded(isExpanded ? null : symbol)}
                    className="w-full flex items-center gap-2 px-3 py-2 hover:bg-secondary/50 transition-colors text-left"
                  >
                    <div className={cn(
                      'flex h-7 w-7 items-center justify-center rounded-full flex-shrink-0',
                      best.direction === 'bull' ? 'bg-green-500/15 text-green-400' : 'bg-red-500/15 text-red-400'
                    )}>
                      {best.direction === 'bull'
                        ? <TrendingUp className="h-4 w-4" />
                        : <TrendingDown className="h-4 w-4" />
                      }
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-bold text-foreground">{symbol.replace('USDT', '')}</span>
                        {tfCount > 1 && (
                          <span className="rounded bg-primary/20 px-1 py-0.5 text-[9px] font-bold text-primary">
                            {tfCount}TF
                          </span>
                        )}
                        {best.signals.earlyMove && (
                          <span className="rounded bg-lime-500/20 px-1 py-0.5 text-[9px] font-bold text-lime-400">
                            EARLY
                          </span>
                        )}
                        {best.signals.momentumIgnition && (
                          <span className="rounded bg-red-600/20 px-1 py-0.5 text-[9px] font-bold text-red-300">
                            🔥
                          </span>
                        )}
                        <div className="flex gap-0.5">
                          {signals.map(s => (
                            <span key={s.timeframe} className="text-[9px] text-muted-foreground bg-muted rounded px-1">
                              {TF_LABELS[s.timeframe]}
                            </span>
                          ))}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-[10px] text-muted-foreground">${best.price.toLocaleString()}</span>
                        <span className={cn('text-[10px] font-medium', best.change24h >= 0 ? 'text-green-400' : 'text-red-400')}>
                          {best.change24h >= 0 ? '+' : ''}{best.change24h.toFixed(2)}%
                        </span>
                        <span className="text-[10px] text-muted-foreground">{formatVolume(best.turnover24h || best.volume24h)}</span>
                        {best.details.htfTrend !== 'neutral' && (
                          <span className={cn('text-[9px] font-medium', best.details.htfTrend === 'bull' ? 'text-green-400' : 'text-red-400')}>
                            HTF:{best.details.htfTrend === 'bull' ? '↑' : '↓'}
                          </span>
                        )}
                      </div>
                    </div>

                    <ScoreBar score={bestScore} />
                  </button>

                  {/* Active signals chips */}
                  <div className="px-3 pb-2 flex flex-wrap gap-1">
                    {Object.entries(best.signals).filter(([, v]) => v).map(([key]) => (
                      <span key={key} className={cn('rounded px-1.5 py-0.5 text-[9px] font-semibold', SIGNAL_LABELS[key]?.color)}>
                        {SIGNAL_LABELS[key]?.label}
                      </span>
                    ))}
                  </div>

                  {/* Expanded details */}
                  {isExpanded && (
                    <div className="border-t border-border px-3 py-2 bg-muted/30 space-y-3">
                      {/* Market data section */}
                      {best.marketData && (
                        <div className="rounded-md bg-background/50 p-2 space-y-1">
                          <div className="text-[10px] font-bold text-primary mb-1">Market Data</div>
                          <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1 text-[10px]">
                            {best.marketData.openInterest != null && (
                              <div>
                                <span className="text-muted-foreground">OI:</span>{' '}
                                <span className="font-medium text-foreground">{formatOI(best.marketData.openInterest)}</span>
                              </div>
                            )}
                            {best.marketData.oiChange5m != null && (
                              <div>
                                <span className="text-muted-foreground">OI Δ5m:</span>{' '}
                                <span className={cn('font-medium', best.marketData.oiChange5m > 2 ? 'text-green-400' : best.marketData.oiChange5m < -2 ? 'text-red-400' : 'text-foreground')}>
                                  {best.marketData.oiChange5m > 0 ? '+' : ''}{best.marketData.oiChange5m}%
                                </span>
                              </div>
                            )}
                            {best.marketData.fundingRate != null && (
                              <div>
                                <span className="text-muted-foreground">Funding:</span>{' '}
                                <span className={cn('font-medium', best.marketData.fundingRate > 0.0005 ? 'text-green-400' : best.marketData.fundingRate < -0.0005 ? 'text-red-400' : 'text-foreground')}>
                                  {(best.marketData.fundingRate * 100).toFixed(4)}%
                                </span>
                              </div>
                            )}
                            {best.marketData.predictedFunding != null && (
                              <div>
                                <span className="text-muted-foreground">Pred Fund:</span>{' '}
                                <span className="font-medium text-foreground">
                                  {(best.marketData.predictedFunding * 100).toFixed(4)}%
                                </span>
                              </div>
                            )}
                            {best.marketData.fundingShift != null && best.marketData.fundingShift > 0 && (
                              <div>
                                <span className="text-muted-foreground">Fund Shift:</span>{' '}
                                <span className={cn('font-medium', best.marketData.fundingShift > 0.0005 ? 'text-amber-400' : 'text-foreground')}>
                                  {(best.marketData.fundingShift * 100).toFixed(4)}%
                                </span>
                              </div>
                            )}
                            {best.marketData.orderBookImbalance != null && (
                              <div>
                                <span className="text-muted-foreground">OB Imbal:</span>{' '}
                                <span className={cn('font-medium', best.marketData.orderBookImbalance > 15 ? 'text-green-400' : best.marketData.orderBookImbalance < -15 ? 'text-red-400' : 'text-foreground')}>
                                  {best.marketData.orderBookImbalance > 0 ? '+' : ''}{best.marketData.orderBookImbalance}%
                                </span>
                              </div>
                            )}
                            {best.marketData.bidAskRatio != null && (
                              <div>
                                <span className="text-muted-foreground">Bid/Ask:</span>{' '}
                                <span className={cn('font-medium', best.marketData.bidAskRatio > 1.3 ? 'text-green-400' : best.marketData.bidAskRatio < 0.7 ? 'text-red-400' : 'text-foreground')}>
                                  {best.marketData.bidAskRatio}x
                                </span>
                              </div>
                            )}
                          </div>
                        </div>
                      )}

                      {/* Per-timeframe details */}
                      {signals.map(s => (
                        <div key={s.timeframe} className="mb-2 last:mb-0">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-[10px] font-bold text-primary">{TF_LABELS[s.timeframe]}</span>
                            <ScoreBar score={s.score} />
                          </div>
                          <div className="grid grid-cols-3 sm:grid-cols-4 gap-x-4 gap-y-1 text-[10px]">
                            <div><span className="text-muted-foreground">RSI:</span> <span className="font-medium text-foreground">{s.details.rsi}</span></div>
                            <div><span className="text-muted-foreground">ADX:</span> <span className="font-medium text-foreground">{s.details.adx}</span></div>
                            <div><span className="text-muted-foreground">Vol Ratio:</span> <span className={cn('font-medium', s.details.volumeRatio >= 2 ? 'text-amber-400' : 'text-foreground')}>{s.details.volumeRatio}x</span></div>
                            <div><span className="text-muted-foreground">ROC(5):</span> <span className={cn('font-medium', s.details.roc > 0 ? 'text-green-400' : 'text-red-400')}>{s.details.roc}%</span></div>
                            <div><span className="text-muted-foreground">Stoch K/D:</span> <span className="font-medium text-foreground">{s.details.stochK}/{s.details.stochD}</span></div>
                            <div><span className="text-muted-foreground">BB Squeeze:</span> <span className={cn('font-medium', s.details.bbSqueeze < 1.5 ? 'text-red-400' : 'text-foreground')}>{s.details.bbSqueeze}</span></div>
                            <div><span className="text-muted-foreground">MACD Hist:</span> <span className={cn('font-medium', s.details.macdHist > 0 ? 'text-green-400' : 'text-red-400')}>{s.details.macdHist.toFixed(6)}</span></div>
                            <div><span className="text-muted-foreground">ROC Accel:</span> <span className={cn('font-medium', s.details.rocAccel > 0 ? 'text-green-400' : 'text-red-400')}>{s.details.rocAccel}%</span></div>
                            <div><span className="text-muted-foreground">ATR Exp:</span> <span className={cn('font-medium', s.details.atrExpansion > 1.3 ? 'text-amber-400' : 'text-foreground')}>{s.details.atrExpansion}x</span></div>
                            <div><span className="text-muted-foreground">Range Pos:</span> <span className="font-medium text-foreground">{(s.details.rangePosition * 100).toFixed(0)}%</span></div>
                            {s.details.consolidationBars > 0 && (
                              <div><span className="text-muted-foreground">Consol Bars:</span> <span className="font-medium text-foreground">{s.details.consolidationBars}</span></div>
                            )}
                            <div><span className="text-muted-foreground">HTF Trend:</span> <span className={cn('font-medium', s.details.htfTrend === 'bull' ? 'text-green-400' : s.details.htfTrend === 'bear' ? 'text-red-400' : 'text-muted-foreground')}>{s.details.htfTrend}</span></div>
                          </div>
                          <div className="flex flex-wrap gap-1 mt-1">
                            {Object.entries(s.signals).filter(([, v]) => v).map(([key]) => (
                              <span key={key} className={cn('rounded px-1.5 py-0.5 text-[9px] font-semibold', SIGNAL_LABELS[key]?.color)}>
                                {SIGNAL_LABELS[key]?.label}
                              </span>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </TabsContent>

        {/* Leaderboard tab */}
        <TabsContent value="leaderboard" className="flex-1 overflow-y-auto mt-0">
          <div className="p-2 space-y-1">
            <div className="px-3 py-1.5 text-[10px] text-muted-foreground font-medium">
              Top 20 by Momentum Score
            </div>
            {leaderboard.map(({ symbol, best, tfCount }, idx) => (
              <div key={symbol} className="flex items-center gap-2 px-3 py-2 rounded-lg border border-border bg-card">
                <span className={cn(
                  'flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-bold flex-shrink-0',
                  idx < 3 ? 'bg-primary/20 text-primary' : 'bg-muted text-muted-foreground'
                )}>
                  {idx + 1}
                </span>
                <div className={cn(
                  'flex h-5 w-5 items-center justify-center rounded-full flex-shrink-0',
                  best.direction === 'bull' ? 'bg-green-500/15 text-green-400' : 'bg-red-500/15 text-red-400'
                )}>
                  {best.direction === 'bull' ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1">
                    <span className="text-xs font-bold text-foreground">{symbol.replace('USDT', '')}</span>
                    {tfCount > 1 && <span className="rounded bg-primary/20 px-1 text-[9px] font-bold text-primary">{tfCount}TF</span>}
                    {best.signals.earlyMove && <span className="rounded bg-lime-500/20 px-1 text-[9px] font-bold text-lime-400">EARLY</span>}
                    {best.signals.momentumIgnition && <span className="text-[9px]">🔥</span>}
                  </div>
                  <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                    <span>${best.price.toLocaleString()}</span>
                    <span className={cn(best.change24h >= 0 ? 'text-green-400' : 'text-red-400')}>
                      {best.change24h >= 0 ? '+' : ''}{best.change24h.toFixed(2)}%
                    </span>
                    <span>{formatVolume(best.turnover24h || best.volume24h)}</span>
                  </div>
                </div>
                <div className="flex flex-col items-end gap-0.5">
                  <ScoreBar score={best.score} />
                  <span className="text-[9px] text-muted-foreground">
                    {Object.values(best.signals).filter(Boolean).length} signals
                  </span>
                </div>
              </div>
            ))}
            {leaderboard.length === 0 && !loading && (
              <div className="flex items-center justify-center h-32">
                <p className="text-sm text-muted-foreground">No signals detected yet</p>
              </div>
            )}
          </div>
        </TabsContent>

        {/* Market Data tab: OI, Funding, Order Book for detected signals */}
        <TabsContent value="market-data" className="flex-1 overflow-y-auto mt-0">
          <div className="p-2 space-y-1">
            <div className="px-3 py-1.5 text-[10px] text-muted-foreground font-medium">
              OI · Funding · Order Book for Detected Signals
            </div>
            {/* Deduplicate by symbol for market data view */}
            {(() => {
              const seen = new Set<string>();
              const unique = (data?.signals ?? []).filter(s => {
                if (seen.has(s.symbol)) return false;
                seen.add(s.symbol);
                return !!s.marketData;
              }).sort((a, b) => {
                const aOi = Math.abs(a.marketData?.oiChange5m ?? 0);
                const bOi = Math.abs(b.marketData?.oiChange5m ?? 0);
                return bOi - aOi;
              });

              if (unique.length === 0 && !loading) {
                return (
                  <div className="flex items-center justify-center h-32">
                    <p className="text-sm text-muted-foreground">No market data available</p>
                  </div>
                );
              }

              return unique.map(s => (
                <div key={s.symbol} className="rounded-lg border border-border bg-card px-3 py-2">
                  <div className="flex items-center gap-2 mb-1.5">
                    <div className={cn(
                      'flex h-5 w-5 items-center justify-center rounded-full flex-shrink-0',
                      s.direction === 'bull' ? 'bg-green-500/15 text-green-400' : 'bg-red-500/15 text-red-400'
                    )}>
                      {s.direction === 'bull' ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                    </div>
                    <span className="text-xs font-bold text-foreground">{s.symbol.replace('USDT', '')}</span>
                    <span className="text-[10px] text-muted-foreground">${s.price.toLocaleString()}</span>
                    <ScoreBar score={s.score} />
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-1 text-[10px]">
                    {s.marketData?.openInterest != null && (
                      <div className="flex items-center gap-1">
                        <BookOpen className="h-2.5 w-2.5 text-muted-foreground" />
                        <span className="text-muted-foreground">OI:</span>
                        <span className="font-medium">{formatOI(s.marketData.openInterest)}</span>
                      </div>
                    )}
                    {s.marketData?.oiChange5m != null && (
                      <div>
                        <span className="text-muted-foreground">OI Surge:</span>{' '}
                        <span className={cn('font-medium', s.marketData.oiChange5m > 3 ? 'text-green-400' : s.marketData.oiChange5m < -3 ? 'text-red-400' : 'text-foreground')}>
                          {s.marketData.oiChange5m > 0 ? '+' : ''}{s.marketData.oiChange5m}%
                        </span>
                      </div>
                    )}
                    {s.marketData?.fundingRate != null && (
                      <div className="flex items-center gap-1">
                        <DollarSign className="h-2.5 w-2.5 text-muted-foreground" />
                        <span className="text-muted-foreground">Fund:</span>
                        <span className={cn('font-medium', s.marketData.fundingRate > 0.0005 ? 'text-green-400' : s.marketData.fundingRate < -0.0005 ? 'text-red-400' : 'text-foreground')}>
                          {(s.marketData.fundingRate * 100).toFixed(4)}%
                        </span>
                      </div>
                    )}
                    {s.marketData?.fundingShift != null && s.marketData.fundingShift > 0 && (
                      <div>
                        <span className="text-muted-foreground">Fund Shift:</span>{' '}
                        <span className={cn('font-medium', s.marketData.fundingShift > 0.0005 ? 'text-amber-400' : 'text-foreground')}>
                          Δ{(s.marketData.fundingShift * 100).toFixed(4)}%
                        </span>
                      </div>
                    )}
                    {s.marketData?.orderBookImbalance != null && (
                      <div>
                        <span className="text-muted-foreground">OB Imbalance:</span>{' '}
                        <span className={cn('font-medium', s.marketData.orderBookImbalance > 20 ? 'text-green-400' : s.marketData.orderBookImbalance < -20 ? 'text-red-400' : 'text-foreground')}>
                          {s.marketData.orderBookImbalance > 0 ? '+' : ''}{s.marketData.orderBookImbalance}%
                        </span>
                      </div>
                    )}
                    {s.marketData?.bidAskRatio != null && (
                      <div>
                        <span className="text-muted-foreground">Bid/Ask:</span>{' '}
                        <span className={cn('font-medium', s.marketData.bidAskRatio > 1.5 ? 'text-green-400' : s.marketData.bidAskRatio < 0.6 ? 'text-red-400' : 'text-foreground')}>
                          {s.marketData.bidAskRatio}x
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              ));
            })()}
          </div>
        </TabsContent>
      </Tabs>

      {/* Footer stats */}
      {data && !loading && (
        <div className="border-t border-border bg-card px-4 py-1.5 flex items-center justify-between">
          <span className="text-[10px] text-muted-foreground">
            {filtered.length} signals from {sortedSymbols.length} coins
          </span>
          <span className="text-[10px] text-muted-foreground">
            {filtered.filter(s => s.direction === 'bull').length} bull · {filtered.filter(s => s.direction === 'bear').length} bear
          </span>
        </div>
      )}
    </div>
  );
}
