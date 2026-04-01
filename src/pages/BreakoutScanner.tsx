import { useState, useEffect, useCallback, useRef } from 'react';
import { Crosshair, TrendingUp, TrendingDown, RefreshCw, Filter, Clock, BarChart3, Shield, Zap, Target, Volume2, ArrowUpRight, ArrowDownRight } from 'lucide-react';
import { cn } from '@/lib/utils';

interface BreakoutSignal {
  symbol: string;
  price: number;
  change24h: number;
  turnover24h: number;
  timeframe: string;
  direction: 'bull' | 'bear';
  score: number;
  breakoutType: 'squeeze' | 'consolidation' | 'accumulation' | 'range';
  candlesAgo: number;
  priorCondition: {
    squeezeBars: number;
    consolidationBars: number;
    rangeWidth: number;
    rangeHigh: number;
    rangeLow: number;
  };
  confirmation: {
    volumeSpike: boolean;
    volumeRatio: number;
    adxRising: boolean;
    adx: number;
    macdConfirm: boolean;
    macdHist: number;
    rsi: number;
    rsiHealthy: boolean;
    bbExpansion: boolean;
    atrExpansion: number;
    obvConfirm: boolean;
    emaTrendAligned: boolean;
    candleBody: number;
    closeStrength: number;
    htfTrend: string;
    donchianBreak: boolean;
    mfiConfirm: boolean;
  };
  timestamp: number;
}

interface ScanResult {
  signals: BreakoutSignal[];
  scannedAt: string;
  totalScanned: number;
  totalTimeframes: number;
}

const TF_LABELS: Record<string, string> = { '15': '15m', '60': '1H', '240': '4H', 'D': '1D' };

const TYPE_COLORS: Record<string, string> = {
  squeeze: 'bg-red-500/15 text-red-400',
  consolidation: 'bg-emerald-500/15 text-emerald-400',
  accumulation: 'bg-amber-500/15 text-amber-400',
  range: 'bg-blue-500/15 text-blue-400',
};

const TYPE_LABELS: Record<string, string> = {
  squeeze: 'SQUEEZE',
  consolidation: 'CONSOLIDATION',
  accumulation: 'ACCUMULATION',
  range: 'RANGE',
};

const CONFIRMATION_LABELS: Record<string, { label: string; color: string }> = {
  volumeSpike: { label: 'VOL SPIKE', color: 'bg-amber-500/20 text-amber-400' },
  adxRising: { label: 'ADX↑', color: 'bg-cyan-500/20 text-cyan-400' },
  macdConfirm: { label: 'MACD', color: 'bg-purple-500/20 text-purple-400' },
  bbExpansion: { label: 'BB EXP', color: 'bg-pink-500/20 text-pink-400' },
  obvConfirm: { label: 'OBV', color: 'bg-teal-500/20 text-teal-400' },
  emaTrendAligned: { label: 'EMA', color: 'bg-green-500/20 text-green-400' },
  donchianBreak: { label: 'DONCH', color: 'bg-indigo-500/20 text-indigo-400' },
  mfiConfirm: { label: 'MFI', color: 'bg-rose-500/20 text-rose-400' },
};

function formatVolume(v: number): string {
  if (v >= 1e9) return `$${(v / 1e9).toFixed(1)}B`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
  return `$${(v / 1e3).toFixed(0)}K`;
}

function ScoreBar({ score }: { score: number }) {
  const pct = Math.min(score, 100);
  const color = score >= 75 ? 'bg-green-500' : score >= 50 ? 'bg-amber-500' : 'bg-primary';
  return (
    <div className="flex items-center gap-2">
      <div className="w-16 h-1.5 rounded-full bg-muted overflow-hidden">
        <div className={cn('h-full rounded-full transition-all', color)} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs font-bold tabular-nums">{score}</span>
    </div>
  );
}

type TypeFilter = 'all' | 'squeeze' | 'consolidation' | 'accumulation';

const AUTO_REFRESH_MS = 15 * 60 * 1000; // 15 minutes

export default function BreakoutScanner() {
  const [data, setData] = useState<ScanResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dirFilter, setDirFilter] = useState<'all' | 'bull' | 'bear'>('all');
  const [tfFilter, setTfFilter] = useState<string>('all');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [minScore, setMinScore] = useState(35);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [countdown, setCountdown] = useState(AUTO_REFRESH_MS);
  const lastFetchRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval>>();

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;
      const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
      const res = await fetch(`https://${projectId}.supabase.co/functions/v1/breakout-scanner`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': key },
        body: JSON.stringify({}),
      });
      if (!res.ok) throw new Error(`Error: ${res.status}`);
      const result = await res.json();
      setData(result);
      lastFetchRef.current = Date.now();
      setCountdown(AUTO_REFRESH_MS);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial fetch + auto-refresh every 15 min
  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, AUTO_REFRESH_MS);
    return () => clearInterval(interval);
  }, [fetchData]);

  // Countdown timer
  useEffect(() => {
    timerRef.current = setInterval(() => {
      setCountdown(prev => {
        const elapsed = Date.now() - lastFetchRef.current;
        const remaining = Math.max(0, AUTO_REFRESH_MS - elapsed);
        return remaining;
      });
    }, 1000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, []);

  const formatCountdown = (ms: number) => {
    const min = Math.floor(ms / 60000);
    const sec = Math.floor((ms % 60000) / 1000);
    return `${min}:${sec.toString().padStart(2, '0')}`;
  };

  const filtered = (data?.signals ?? []).filter(s => {
    if (dirFilter !== 'all' && s.direction !== dirFilter) return false;
    if (tfFilter !== 'all' && s.timeframe !== tfFilter) return false;
    if (typeFilter !== 'all' && s.breakoutType !== typeFilter) return false;
    if (s.score < minScore) return false;
    return true;
  });

  // Group by symbol
  const grouped = new Map<string, BreakoutSignal[]>();
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

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background">
      {/* Header */}
      <div className="border-b border-border bg-card px-4 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Crosshair className="h-5 w-5 text-primary" />
            <h1 className="text-sm font-bold uppercase tracking-wider text-foreground">Breakout Scanner</h1>
          </div>
          <div className="flex items-center gap-2">
            {data && (
              <span className="text-[10px] text-muted-foreground">
                {data.totalScanned} coins · {new Date(data.scannedAt).toLocaleTimeString()}
              </span>
            )}
            <span className="text-[10px] text-muted-foreground tabular-nums bg-muted px-1.5 py-0.5 rounded">
              {formatCountdown(countdown)}
            </span>
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
            {[35, 50, 70].map(s => (
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

        {/* Type filter */}
        <div className="flex flex-wrap items-center gap-1">
          <Target className="h-3 w-3 text-muted-foreground mr-0.5" />
          {([
            { value: 'all' as TypeFilter, label: 'All Types', icon: Shield },
            { value: 'squeeze' as TypeFilter, label: 'Squeeze', icon: Zap },
            { value: 'consolidation' as TypeFilter, label: 'Consolidation', icon: BarChart3 },
            { value: 'accumulation' as TypeFilter, label: 'Accumulation', icon: Volume2 },
          ]).map(opt => (
            <button
              key={opt.value}
              onClick={() => setTypeFilter(opt.value)}
              className={cn(
                'rounded px-1.5 py-0.5 text-[9px] font-medium transition-colors flex items-center gap-0.5',
                typeFilter === opt.value ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-secondary'
              )}
            >
              <opt.icon className="h-2.5 w-2.5" />
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Results */}
      <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
        {loading && !data && (
          <div className="flex flex-col items-center justify-center h-64 gap-3">
            <RefreshCw className="h-8 w-8 text-primary animate-spin" />
            <p className="text-sm text-muted-foreground">Scanning 100 coins for valid breakouts...</p>
            <p className="text-xs text-muted-foreground">Checking squeeze, consolidation &amp; accumulation patterns</p>
          </div>
        )}

        {error && (
          <div className="flex items-center justify-center h-32">
            <p className="text-sm text-destructive">{error}</p>
          </div>
        )}

        {!loading && data && sortedSymbols.length === 0 && (
          <div className="flex flex-col items-center justify-center h-32 gap-1">
            <p className="text-sm text-muted-foreground">No valid breakouts detected</p>
            <p className="text-[10px] text-muted-foreground">Only breakouts with prior consolidation/squeeze/accumulation are shown</p>
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
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-xs font-bold text-foreground">{symbol.replace('USDT', '')}</span>
                    {tfCount > 1 && (
                      <span className="rounded bg-primary/20 px-1 py-0.5 text-[9px] font-bold text-primary">
                        {tfCount}TF
                      </span>
                    )}
                    <span className={cn('rounded px-1.5 py-0.5 text-[9px] font-bold', TYPE_COLORS[best.breakoutType])}>
                      {TYPE_LABELS[best.breakoutType]}
                    </span>
                    {best.candlesAgo === 0 && (
                      <span className="rounded bg-lime-500/20 px-1 py-0.5 text-[9px] font-bold text-lime-400">
                        LIVE
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
                    <span className="text-[10px] text-muted-foreground">{formatVolume(best.turnover24h)}</span>
                    {best.confirmation.htfTrend !== 'neutral' && (
                      <span className={cn('text-[9px] font-medium', best.confirmation.htfTrend === 'bull' ? 'text-green-400' : 'text-red-400')}>
                        HTF:{best.confirmation.htfTrend === 'bull' ? '↑' : '↓'}
                      </span>
                    )}
                  </div>
                </div>

                <ScoreBar score={bestScore} />
              </button>

              {/* Confirmation chips */}
              <div className="px-3 pb-2 flex flex-wrap gap-1">
                {Object.entries(best.confirmation).filter(([key, v]) => v === true && CONFIRMATION_LABELS[key]).map(([key]) => (
                  <span key={key} className={cn('rounded px-1.5 py-0.5 text-[9px] font-semibold', CONFIRMATION_LABELS[key]?.color)}>
                    {CONFIRMATION_LABELS[key]?.label}
                  </span>
                ))}
              </div>

              {/* Expanded details */}
              {isExpanded && (
                <div className="border-t border-border px-3 py-2 bg-muted/30 space-y-3">
                  {signals.map(s => (
                    <div key={s.timeframe} className="mb-2 last:mb-0">
                      <div className="flex items-center gap-2 mb-1.5">
                        <span className="text-[10px] font-bold text-primary">{TF_LABELS[s.timeframe]}</span>
                        <ScoreBar score={s.score} />
                        <span className={cn('rounded px-1.5 py-0.5 text-[9px] font-bold', TYPE_COLORS[s.breakoutType])}>
                          {TYPE_LABELS[s.breakoutType]}
                        </span>
                        {s.candlesAgo === 0 && (
                          <span className="text-[9px] text-lime-400 font-bold">● LIVE</span>
                        )}
                        {s.candlesAgo === 1 && (
                          <span className="text-[9px] text-muted-foreground">1 bar ago</span>
                        )}
                      </div>

                      {/* Prior condition */}
                      <div className="rounded-md bg-background/50 p-2 mb-2">
                        <div className="text-[10px] font-bold text-accent mb-1">Prior Condition</div>
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1 text-[10px]">
                          {s.priorCondition.squeezeBars > 0 && (
                            <div>
                              <span className="text-muted-foreground">Squeeze:</span>{' '}
                              <span className="font-medium text-red-400">{s.priorCondition.squeezeBars} bars</span>
                            </div>
                          )}
                          {s.priorCondition.consolidationBars > 0 && (
                            <div>
                              <span className="text-muted-foreground">Consolidation:</span>{' '}
                              <span className="font-medium text-emerald-400">{s.priorCondition.consolidationBars} bars</span>
                            </div>
                          )}
                          <div>
                            <span className="text-muted-foreground">Range Width:</span>{' '}
                            <span className="font-medium text-foreground">{s.priorCondition.rangeWidth}%</span>
                          </div>
                          <div>
                            <span className="text-muted-foreground">Range High:</span>{' '}
                            <span className="font-medium text-foreground">${s.priorCondition.rangeHigh}</span>
                          </div>
                          <div>
                            <span className="text-muted-foreground">Range Low:</span>{' '}
                            <span className="font-medium text-foreground">${s.priorCondition.rangeLow}</span>
                          </div>
                        </div>
                      </div>

                      {/* Confirmation details */}
                      <div className="grid grid-cols-3 sm:grid-cols-4 gap-x-4 gap-y-1 text-[10px]">
                        <div>
                          <span className="text-muted-foreground">Vol Ratio:</span>{' '}
                          <span className={cn('font-medium', s.confirmation.volumeRatio >= 2 ? 'text-amber-400' : 'text-foreground')}>
                            {s.confirmation.volumeRatio}x
                          </span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">ADX:</span>{' '}
                          <span className={cn('font-medium', s.confirmation.adxRising ? 'text-cyan-400' : 'text-foreground')}>
                            {s.confirmation.adx}{s.confirmation.adxRising ? '↑' : ''}
                          </span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">RSI:</span>{' '}
                          <span className="font-medium text-foreground">{s.confirmation.rsi}</span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">ATR Exp:</span>{' '}
                          <span className={cn('font-medium', s.confirmation.atrExpansion > 1.3 ? 'text-amber-400' : 'text-foreground')}>
                            {s.confirmation.atrExpansion}x
                          </span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Body:</span>{' '}
                          <span className="font-medium text-foreground">{(s.confirmation.candleBody * 100).toFixed(0)}%</span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Close Str:</span>{' '}
                          <span className={cn('font-medium', s.confirmation.closeStrength > 0.7 ? 'text-green-400' : 'text-foreground')}>
                            {(s.confirmation.closeStrength * 100).toFixed(0)}%
                          </span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">HTF:</span>{' '}
                          <span className={cn('font-medium', s.confirmation.htfTrend === 'bull' ? 'text-green-400' : s.confirmation.htfTrend === 'bear' ? 'text-red-400' : 'text-muted-foreground')}>
                            {s.confirmation.htfTrend}
                          </span>
                        </div>
                      </div>

                      <div className="flex flex-wrap gap-1 mt-1.5">
                        {Object.entries(s.confirmation).filter(([key, v]) => v === true && CONFIRMATION_LABELS[key]).map(([key]) => (
                          <span key={key} className={cn('rounded px-1.5 py-0.5 text-[9px] font-semibold', CONFIRMATION_LABELS[key]?.color)}>
                            {CONFIRMATION_LABELS[key]?.label}
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

      {/* Footer */}
      {data && !loading && (
        <div className="border-t border-border bg-card px-4 py-1.5 flex items-center justify-between">
          <span className="text-[10px] text-muted-foreground">
            {filtered.length} breakouts from {sortedSymbols.length} coins
          </span>
          <span className="text-[10px] text-muted-foreground">
            {filtered.filter(s => s.direction === 'bull').length} bull · {filtered.filter(s => s.direction === 'bear').length} bear
          </span>
        </div>
      )}
    </div>
  );
}
