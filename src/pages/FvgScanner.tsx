import { useState, useEffect, useCallback, useRef } from 'react';
import { TrendingUp, TrendingDown, RefreshCw, Filter, Clock, BarChart3, Zap, ArrowUpRight, ArrowDownRight, Layers } from 'lucide-react';
import { cn } from '@/lib/utils';

interface FvgExtension {
  emaDist9: number;
  emaDist21: number;
  consecutiveBars: number;
  volumeDecline: boolean;
  rsiExtreme: boolean;
  extensionLevel: 'normal' | 'extended' | 'overextended' | 'exhaustion';
}

interface FvgSignal {
  symbol: string;
  price: number;
  change24h: number;
  turnover24h: number;
  timeframe: string;
  direction: 'bull' | 'bear';
  score: number;
  signalType: 'fvg' | 'impulse' | 'imbalance';
  candleIndex: number;
  fvg?: { gapHigh: number; gapLow: number; gapSize: number; gapPct: number };
  impulse?: { bodyPct: number; rangeAtr: number; volumeRatio: number };
  extension?: FvgExtension;
  confirmation: {
    atr: number;
    atrRatio: number;
    bodyToRange: number;
    volumeRatio: number;
    rsi: number;
    emaAligned: boolean;
    candlesAgo: number;
  };
  timestamp: number;
}

interface ScanResult {
  signals: FvgSignal[];
  scannedAt: string;
  totalScanned: number;
  totalTimeframes: number;
}

const TF_LABELS: Record<string, string> = { '60': '1H', '240': '4H', 'D': '1D' };

const TYPE_COLORS: Record<string, string> = {
  fvg: 'bg-violet-500/15 text-violet-400',
  impulse: 'bg-amber-500/15 text-amber-400',
  imbalance: 'bg-cyan-500/15 text-cyan-400',
};

const TYPE_LABELS: Record<string, string> = {
  fvg: 'FVG',
  impulse: 'IMPULSE',
  imbalance: 'IMBALANCE',
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

const EXT_COLORS: Record<string, string> = {
  normal: 'bg-muted text-muted-foreground',
  extended: 'bg-yellow-500/15 text-yellow-400',
  overextended: 'bg-orange-500/15 text-orange-400',
  exhaustion: 'bg-red-500/15 text-red-400',
};

const EXT_LABELS: Record<string, string> = {
  normal: 'NORMAL',
  extended: 'EXTENDED',
  overextended: 'OVEREXTENDED',
  exhaustion: 'EXHAUSTION',
};

type ExtFilter = 'all' | 'extended' | 'overextended' | 'exhaustion';
type TypeFilter = 'all' | 'fvg' | 'impulse' | 'imbalance';

const AUTO_REFRESH_MS = 15 * 60 * 1000;

export default function FvgScanner() {
  const [data, setData] = useState<ScanResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dirFilter, setDirFilter] = useState<'all' | 'bull' | 'bear'>('all');
  const [tfFilter, setTfFilter] = useState<string>('all');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [extFilter, setExtFilter] = useState<ExtFilter>('all');
  const [minScore, setMinScore] = useState(40);
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
      const res = await fetch(`https://${projectId}.supabase.co/functions/v1/fvg-scanner`, {
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

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, AUTO_REFRESH_MS);
    return () => clearInterval(interval);
  }, [fetchData]);

  useEffect(() => {
    timerRef.current = setInterval(() => {
      setCountdown(() => {
        const elapsed = Date.now() - lastFetchRef.current;
        return Math.max(0, AUTO_REFRESH_MS - elapsed);
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
    if (typeFilter !== 'all' && s.signalType !== typeFilter) return false;
    if (s.score < minScore) return false;
    if (extFilter !== 'all') {
      const level = s.extension?.extensionLevel ?? 'normal';
      if (extFilter === 'extended' && level === 'normal') return false;
      if (extFilter === 'overextended' && level !== 'overextended' && level !== 'exhaustion') return false;
      if (extFilter === 'exhaustion' && level !== 'exhaustion') return false;
    }
    return true;
  });

  // Group by symbol
  const grouped = new Map<string, FvgSignal[]>();
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
            <Layers className="h-5 w-5 text-primary" />
            <h1 className="text-sm font-bold uppercase tracking-wider text-foreground">FVG / Impulse Scanner</h1>
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
            {['all', '60', '240', 'D'].map(tf => (
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
            {[40, 55, 70].map(s => (
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
          <Zap className="h-3 w-3 text-muted-foreground mr-0.5" />
          {([
            { value: 'all' as TypeFilter, label: 'All Types' },
            { value: 'fvg' as TypeFilter, label: 'FVG' },
            { value: 'impulse' as TypeFilter, label: 'Impulse' },
            { value: 'imbalance' as TypeFilter, label: 'Imbalance' },
          ]).map(opt => (
            <button
              key={opt.value}
              onClick={() => setTypeFilter(opt.value)}
              className={cn(
                'rounded px-1.5 py-0.5 text-[9px] font-medium transition-colors',
                typeFilter === opt.value ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-secondary'
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>

        {/* Extension filter */}
        <div className="flex flex-wrap items-center gap-1">
          <ArrowUpRight className="h-3 w-3 text-muted-foreground mr-0.5" />
          {([
            { value: 'all' as ExtFilter, label: 'All Moves' },
            { value: 'extended' as ExtFilter, label: '⚡ Extended+' },
            { value: 'overextended' as ExtFilter, label: '🔥 Overextended' },
            { value: 'exhaustion' as ExtFilter, label: '💀 Exhaustion' },
          ]).map(opt => (
            <button
              key={opt.value}
              onClick={() => setExtFilter(opt.value)}
              className={cn(
                'rounded px-1.5 py-0.5 text-[9px] font-medium transition-colors',
                extFilter === opt.value ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-secondary'
              )}
            >
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
            <p className="text-sm text-muted-foreground">Scanning 100 coins for FVGs & impulse moves...</p>
            <p className="text-xs text-muted-foreground">1H · 4H · Daily — High ATR only</p>
          </div>
        )}

        {error && (
          <div className="flex items-center justify-center h-32">
            <p className="text-sm text-destructive">{error}</p>
          </div>
        )}

        {!loading && data && sortedSymbols.length === 0 && (
          <div className="flex flex-col items-center justify-center h-32 gap-1">
            <p className="text-sm text-muted-foreground">No FVG / impulse signals detected</p>
            <p className="text-[10px] text-muted-foreground">Only high-ATR impulsive moves are shown</p>
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
                    <span className={cn('rounded px-1.5 py-0.5 text-[9px] font-bold', TYPE_COLORS[best.signalType])}>
                      {TYPE_LABELS[best.signalType]}
                    </span>
                    {best.confirmation.candlesAgo === 0 && (
                      <span className="rounded bg-lime-500/20 px-1 py-0.5 text-[9px] font-bold text-lime-400">
                        LIVE
                      </span>
                    )}
                    <div className="flex gap-0.5">
                      {signals.map((s, idx) => (
                        <span key={idx} className="text-[9px] text-muted-foreground bg-muted rounded px-1">
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
                  </div>
                </div>

                <ScoreBar score={bestScore} />
              </button>

              {/* Confirmation chips */}
              <div className="px-3 pb-2 flex flex-wrap gap-1">
                {best.confirmation.atrRatio > 1.8 && (
                  <span className="rounded px-1.5 py-0.5 text-[9px] font-semibold bg-red-500/20 text-red-400">
                    ATR {best.confirmation.atrRatio.toFixed(1)}x
                  </span>
                )}
                {best.confirmation.volumeRatio > 1.5 && (
                  <span className="rounded px-1.5 py-0.5 text-[9px] font-semibold bg-amber-500/20 text-amber-400">
                    VOL {best.confirmation.volumeRatio.toFixed(1)}x
                  </span>
                )}
                {best.confirmation.bodyToRange > 0.7 && (
                  <span className="rounded px-1.5 py-0.5 text-[9px] font-semibold bg-emerald-500/20 text-emerald-400">
                    BODY {Math.round(best.confirmation.bodyToRange * 100)}%
                  </span>
                )}
                {best.confirmation.emaAligned && (
                  <span className="rounded px-1.5 py-0.5 text-[9px] font-semibold bg-cyan-500/20 text-cyan-400">
                    EMA ✓
                  </span>
                )}
                {best.fvg && (
                  <span className="rounded px-1.5 py-0.5 text-[9px] font-semibold bg-violet-500/20 text-violet-400">
                    GAP {best.fvg.gapPct.toFixed(2)}%
                  </span>
                )}
                {best.impulse && (
                  <span className="rounded px-1.5 py-0.5 text-[9px] font-semibold bg-pink-500/20 text-pink-400">
                    {best.impulse.rangeAtr.toFixed(1)}x ATR
                  </span>
                )}
                {best.extension && best.extension.extensionLevel !== 'normal' && (
                  <span className={cn('rounded px-1.5 py-0.5 text-[9px] font-bold', EXT_COLORS[best.extension.extensionLevel])}>
                    {EXT_LABELS[best.extension.extensionLevel]}
                    {best.extension.emaDist21 !== 0 && ` ${Math.abs(best.extension.emaDist21).toFixed(1)}%`}
                  </span>
                )}
                {best.extension?.consecutiveBars && best.extension.consecutiveBars >= 4 && (
                  <span className="rounded px-1.5 py-0.5 text-[9px] font-semibold bg-orange-500/20 text-orange-400">
                    {best.extension.consecutiveBars} BARS
                  </span>
                )}
                {best.extension?.volumeDecline && (
                  <span className="rounded px-1.5 py-0.5 text-[9px] font-semibold bg-red-500/20 text-red-400">
                    VOL↓
                  </span>
                )}
                {best.extension?.rsiExtreme && (
                  <span className="rounded px-1.5 py-0.5 text-[9px] font-semibold bg-rose-500/20 text-rose-400">
                    RSI {best.confirmation.rsi.toFixed(0)}
                  </span>
                )}
              </div>

              {/* Expanded details */}
              {isExpanded && (
                <div className="border-t border-border px-3 py-2 bg-muted/30 space-y-3">
                  {signals.map((s, idx) => (
                    <div key={idx} className="mb-2 last:mb-0">
                      <div className="flex items-center gap-2 mb-1.5">
                        <span className="text-[10px] font-bold text-primary">{TF_LABELS[s.timeframe]}</span>
                        <ScoreBar score={s.score} />
                        <span className={cn('rounded px-1.5 py-0.5 text-[9px] font-bold', TYPE_COLORS[s.signalType])}>
                          {TYPE_LABELS[s.signalType]}
                        </span>
                        {s.confirmation.candlesAgo === 0 && (
                          <span className="text-[9px] text-lime-400 font-bold">● LIVE</span>
                        )}
                        {s.confirmation.candlesAgo === 1 && (
                          <span className="text-[9px] text-muted-foreground">1 bar ago</span>
                        )}
                      </div>

                      <div className="rounded-md bg-background/50 p-2">
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1 text-[10px]">
                          <div>
                            <span className="text-muted-foreground">ATR Ratio:</span>{' '}
                            <span className={cn('font-medium', s.confirmation.atrRatio > 2 ? 'text-red-400' : 'text-foreground')}>
                              {s.confirmation.atrRatio.toFixed(2)}x
                            </span>
                          </div>
                          <div>
                            <span className="text-muted-foreground">Volume:</span>{' '}
                            <span className={cn('font-medium', s.confirmation.volumeRatio > 2 ? 'text-amber-400' : 'text-foreground')}>
                              {s.confirmation.volumeRatio.toFixed(1)}x
                            </span>
                          </div>
                          <div>
                            <span className="text-muted-foreground">Body:</span>{' '}
                            <span className="font-medium">{Math.round(s.confirmation.bodyToRange * 100)}%</span>
                          </div>
                          <div>
                            <span className="text-muted-foreground">RSI:</span>{' '}
                            <span className="font-medium">{s.confirmation.rsi.toFixed(1)}</span>
                          </div>
                          <div>
                            <span className="text-muted-foreground">EMA:</span>{' '}
                            <span className={cn('font-medium', s.confirmation.emaAligned ? 'text-green-400' : 'text-red-400')}>
                              {s.confirmation.emaAligned ? 'Aligned' : 'Misaligned'}
                            </span>
                          </div>
                          {s.fvg && (
                            <>
                              <div>
                                <span className="text-muted-foreground">Gap:</span>{' '}
                                <span className="font-medium text-violet-400">{s.fvg.gapPct.toFixed(2)}%</span>
                              </div>
                              <div className="col-span-2">
                                <span className="text-muted-foreground">Zone:</span>{' '}
                                <span className="font-medium">${s.fvg.gapLow.toPrecision(5)} → ${s.fvg.gapHigh.toPrecision(5)}</span>
                              </div>
                            </>
                          )}
                          {s.impulse && (
                            <>
                              <div>
                                <span className="text-muted-foreground">Body%:</span>{' '}
                                <span className="font-medium">{s.impulse.bodyPct}%</span>
                              </div>
                              <div>
                                <span className="text-muted-foreground">Range/ATR:</span>{' '}
                                <span className="font-medium text-amber-400">{s.impulse.rangeAtr.toFixed(1)}x</span>
                              </div>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
