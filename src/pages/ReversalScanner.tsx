import { useState, useEffect, useCallback, useMemo } from 'react';
import { RefreshCw, TrendingUp, TrendingDown, Shield, Zap, Target, Clock, AlertTriangle, ChevronDown, ChevronUp, Filter } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { TIMEFRAME_LABELS } from '@/types/scanner';

interface ReversalConfirmation {
  category: string;
  signal: 'bull' | 'bear';
  name: string;
  weight: number;
  detail: string;
}

interface ReversalSignal {
  symbol: string;
  price: number;
  change24h: number;
  volume24h: number;
  timeframe: string;
  direction: 'bull' | 'bear';
  score: number;
  grade: 'S' | 'A' | 'B' | 'C';
  confirmations: ReversalConfirmation[];
  categoryCount: number;
  topReason: string;
  timestamp: number;
  invalidation: number;
  target: number;
  riskReward: number;
}

type GradeFilter = 'all' | 'S' | 'A' | 'B' | 'C';
type DirFilter = 'all' | 'bull' | 'bear';
type TfFilter = 'all' | '15' | '60' | '240' | 'D' | 'W';

const CATEGORY_COLORS: Record<string, string> = {
  momentum: 'hsl(270 60% 55%)',
  trend: 'hsl(200 70% 50%)',
  volatility: 'hsl(35 90% 55%)',
  volume: 'hsl(160 60% 45%)',
  pattern: 'hsl(340 70% 55%)',
  structure: 'hsl(190 80% 45%)',
};

const CATEGORY_LABELS: Record<string, string> = {
  momentum: 'Momentum',
  trend: 'Trend',
  volatility: 'Volatility',
  volume: 'Volume',
  pattern: 'Pattern',
  structure: 'Structure',
};

const GRADE_STYLES: Record<string, { bg: string; text: string; border: string }> = {
  S: { bg: 'hsl(48 96% 53% / 0.15)', text: 'hsl(48 96% 53%)', border: 'hsl(48 96% 53% / 0.4)' },
  A: { bg: 'hsl(142 72% 45% / 0.15)', text: 'hsl(142 72% 45%)', border: 'hsl(142 72% 45% / 0.4)' },
  B: { bg: 'hsl(217 90% 60% / 0.15)', text: 'hsl(217 90% 60%)', border: 'hsl(217 90% 60% / 0.4)' },
  C: { bg: 'hsl(0 0% 50% / 0.15)', text: 'hsl(0 0% 60%)', border: 'hsl(0 0% 50% / 0.4)' },
};

export default function ReversalScanner() {
  const [reversals, setReversals] = useState<ReversalSignal[]>([]);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [lastScanTime, setLastScanTime] = useState<number>(0);
  const [gradeFilter, setGradeFilter] = useState<GradeFilter>('all');
  const [dirFilter, setDirFilter] = useState<DirFilter>('all');
  const [tfFilter, setTfFilter] = useState<TfFilter>('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const loadFromDB = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('scan_cache')
        .select('data, scanned_at')
        .eq('id', 'reversals')
        .single();

      if (error || !data) { setLoading(false); return; }
      
      const signals = data.data as unknown as ReversalSignal[];
      if (Array.isArray(signals)) {
        setReversals(signals);
        setLastScanTime(new Date(data.scanned_at).getTime());
      }
    } catch (err) {
      console.error('Failed to load reversals:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadFromDB();
    const interval = setInterval(loadFromDB, 30_000);
    return () => clearInterval(interval);
  }, [loadFromDB]);

  const triggerScan = async () => {
    setScanning(true);
    try {
      const res = await supabase.functions.invoke('reversal-scanner');
      if (res.error) throw res.error;
      await loadFromDB();
    } catch (err) {
      console.error('Scan failed:', err);
    } finally {
      setScanning(false);
    }
  };

  const filtered = useMemo(() => {
    return reversals.filter(r => {
      if (gradeFilter !== 'all' && r.grade !== gradeFilter) return false;
      if (dirFilter !== 'all' && r.direction !== dirFilter) return false;
      if (tfFilter !== 'all' && r.timeframe !== tfFilter) return false;
      return true;
    });
  }, [reversals, gradeFilter, dirFilter, tfFilter]);

  const stats = useMemo(() => {
    const sCount = reversals.filter(r => r.grade === 'S').length;
    const aCount = reversals.filter(r => r.grade === 'A').length;
    const bullCount = reversals.filter(r => r.direction === 'bull').length;
    const bearCount = reversals.filter(r => r.direction === 'bear').length;
    return { sCount, aCount, bullCount, bearCount };
  }, [reversals]);

  const lastScanStr = lastScanTime
    ? new Date(lastScanTime).toLocaleTimeString('en-US', { hour12: false })
    : '—';

  const hasFilters = gradeFilter !== 'all' || dirFilter !== 'all' || tfFilter !== 'all';

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <header className="border-b border-border px-4 py-3">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-sm font-bold uppercase tracking-[0.15em] text-foreground">Reversal Scanner</h1>
            <p className="text-[10px] text-muted-foreground">Multi-indicator reversal detection · 15m+ timeframes</p>
          </div>
          <div className="flex items-center gap-2">
            {scanning && (
              <span className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
                Scanning...
              </span>
            )}
            <span className="text-[10px] tabular-nums text-muted-foreground">{lastScanStr}</span>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={triggerScan} disabled={scanning}>
              <RefreshCw className={`h-3.5 w-3.5 ${scanning ? 'animate-spin' : ''}`} />
            </Button>
          </div>
        </div>

        {/* Stats bar */}
        {reversals.length > 0 && (
          <div className="flex items-center gap-3 mt-2">
            <div className="flex items-center gap-1">
              <span className="text-[10px] font-bold" style={{ color: 'hsl(48 96% 53%)' }}>S</span>
              <span className="text-[10px] tabular-nums text-muted-foreground">{stats.sCount}</span>
            </div>
            <div className="flex items-center gap-1">
              <span className="text-[10px] font-bold" style={{ color: 'hsl(142 72% 45%)' }}>A</span>
              <span className="text-[10px] tabular-nums text-muted-foreground">{stats.aCount}</span>
            </div>
            <div className="h-3 w-px bg-border" />
            <div className="flex items-center gap-1">
              <TrendingUp className="h-3 w-3 text-primary" />
              <span className="text-[10px] tabular-nums text-muted-foreground">{stats.bullCount}</span>
            </div>
            <div className="flex items-center gap-1">
              <TrendingDown className="h-3 w-3 text-destructive" />
              <span className="text-[10px] tabular-nums text-muted-foreground">{stats.bearCount}</span>
            </div>
            <div className="flex-1" />
            <span className="text-[10px] text-muted-foreground">{filtered.length} shown</span>
          </div>
        )}
      </header>

      {/* Filter bar */}
      <div className="border-b border-border px-4 py-2">
        <div className="flex items-center gap-3 flex-wrap">
          {/* Direction */}
          <div className="flex items-center gap-1">
            {(['all', 'bull', 'bear'] as DirFilter[]).map(d => (
              <button
                key={d}
                onClick={() => setDirFilter(d)}
                className={`rounded-full px-2.5 py-1 text-[10px] font-medium transition-colors ${
                  dirFilter === d
                    ? d === 'bull' ? 'bg-primary/20 text-primary'
                    : d === 'bear' ? 'bg-destructive/20 text-destructive'
                    : 'bg-secondary text-foreground'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {d === 'all' ? 'All' : d === 'bull' ? '↑ Bull' : '↓ Bear'}
              </button>
            ))}
          </div>
          <div className="h-4 w-px bg-border" />
          {/* Grade */}
          <div className="flex items-center gap-1">
            {(['all', 'S', 'A', 'B', 'C'] as GradeFilter[]).map(g => (
              <button
                key={g}
                onClick={() => setGradeFilter(g)}
                className={`rounded-full px-2.5 py-1 text-[10px] font-bold transition-colors ${
                  gradeFilter === g
                    ? g === 'all' ? 'bg-secondary text-foreground'
                    : `text-foreground`
                    : 'text-muted-foreground hover:text-foreground'
                }`}
                style={gradeFilter === g && g !== 'all' ? {
                  backgroundColor: GRADE_STYLES[g].bg,
                  color: GRADE_STYLES[g].text,
                } : undefined}
              >
                {g === 'all' ? 'All Grades' : `${g}-Tier`}
              </button>
            ))}
          </div>
          <div className="h-4 w-px bg-border" />
          {/* Timeframe */}
          <div className="flex items-center gap-1">
            {(['all', '15', '60', '240', 'D', 'W'] as TfFilter[]).map(tf => (
              <button
                key={tf}
                onClick={() => setTfFilter(tf)}
                className={`rounded-full px-2 py-1 text-[10px] font-medium transition-colors ${
                  tfFilter === tf ? 'bg-accent/20 text-accent' : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {tf === 'all' ? 'All TF' : TIMEFRAME_LABELS[tf as keyof typeof TIMEFRAME_LABELS] ?? tf}
              </button>
            ))}
          </div>
          {hasFilters && (
            <button
              onClick={() => { setGradeFilter('all'); setDirFilter('all'); setTfFilter('all'); }}
              className="text-[10px] text-muted-foreground hover:text-foreground"
            >
              ✕ Clear
            </button>
          )}
        </div>
      </div>

      {/* Content */}
      <ScrollArea className="flex-1">
        <div className="p-3 space-y-2">
          {loading && (
            <div className="py-16 text-center text-xs text-muted-foreground">Loading reversal data...</div>
          )}
          {!loading && filtered.length === 0 && (
            <div className="py-16 text-center">
              <AlertTriangle className="h-8 w-8 text-muted-foreground mx-auto mb-3 opacity-40" />
              <p className="text-xs text-muted-foreground">
                {reversals.length === 0 
                  ? 'No reversal data yet. Click refresh to trigger a scan.'
                  : 'No reversals match the current filters.'}
              </p>
            </div>
          )}
          {filtered.map((r) => (
            <ReversalCard
              key={`${r.symbol}-${r.timeframe}`}
              reversal={r}
              expanded={expandedId === `${r.symbol}-${r.timeframe}`}
              onToggle={() => setExpandedId(
                expandedId === `${r.symbol}-${r.timeframe}` ? null : `${r.symbol}-${r.timeframe}`
              )}
            />
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}

function ReversalCard({ reversal: r, expanded, onToggle }: { reversal: ReversalSignal; expanded: boolean; onToggle: () => void }) {
  const isBull = r.direction === 'bull';
  const gradeStyle = GRADE_STYLES[r.grade];

  // Group confirmations by category
  const grouped = useMemo(() => {
    const map = new Map<string, ReversalConfirmation[]>();
    for (const c of r.confirmations) {
      if (!map.has(c.category)) map.set(c.category, []);
      map.get(c.category)!.push(c);
    }
    return map;
  }, [r.confirmations]);

  return (
    <div
      className="rounded-lg border overflow-hidden transition-all"
      style={{
        borderColor: isBull
          ? 'hsl(142 72% 45% / 0.2)'
          : 'hsl(0 72% 50% / 0.2)',
      }}
    >
      {/* Main row */}
      <button
        onClick={onToggle}
        className="w-full text-left px-3 py-3 hover:bg-secondary/30 transition-colors"
      >
        <div className="flex items-center gap-2">
          {/* Grade badge */}
          <div
            className="flex items-center justify-center h-8 w-8 rounded-lg text-xs font-black shrink-0"
            style={{
              backgroundColor: gradeStyle.bg,
              color: gradeStyle.text,
              border: `1px solid ${gradeStyle.border}`,
            }}
          >
            {r.grade}
          </div>

          {/* Symbol + direction */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="text-sm font-bold text-foreground">{r.symbol.replace('USDT', '')}</span>
              {isBull ? (
                <TrendingUp className="h-3.5 w-3.5 text-primary" />
              ) : (
                <TrendingDown className="h-3.5 w-3.5 text-destructive" />
              )}
              <Badge variant="outline" className="text-[9px] px-1.5 py-0 rounded-full border-accent/30 text-accent">
                {TIMEFRAME_LABELS[r.timeframe as keyof typeof TIMEFRAME_LABELS] ?? r.timeframe}
              </Badge>
            </div>
            <div className="flex items-center gap-2 mt-0.5">
              <span className="text-[10px] text-muted-foreground truncate">{r.topReason}</span>
            </div>
          </div>

          {/* Score + meta */}
          <div className="text-right shrink-0">
            <div className="text-sm font-bold tabular-nums" style={{ color: gradeStyle.text }}>
              {r.score}
            </div>
            <div className="flex items-center gap-1 justify-end">
              <span className="text-[9px] tabular-nums text-muted-foreground">{r.categoryCount} cat</span>
              <span className="text-[9px] text-muted-foreground">·</span>
              <span className="text-[9px] tabular-nums text-muted-foreground">{r.confirmations.length} sig</span>
            </div>
          </div>

          {/* Expand arrow */}
          <div className="shrink-0 text-muted-foreground">
            {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </div>
        </div>

        {/* Category dots */}
        <div className="flex items-center gap-1 mt-2">
          {Array.from(grouped.keys()).map(cat => (
            <div
              key={cat}
              className="flex items-center gap-0.5 rounded-full px-1.5 py-0.5"
              style={{ backgroundColor: `${CATEGORY_COLORS[cat]}20` }}
            >
              <div className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: CATEGORY_COLORS[cat] }} />
              <span className="text-[8px] font-medium" style={{ color: CATEGORY_COLORS[cat] }}>
                {CATEGORY_LABELS[cat] ?? cat}
              </span>
            </div>
          ))}
        </div>
      </button>

      {/* Expanded detail */}
      {expanded && (
        <div className="border-t border-border px-3 py-3 space-y-3 bg-secondary/10">
          {/* Price info */}
          <div className="grid grid-cols-4 gap-2">
            <div>
              <span className="text-[9px] text-muted-foreground block">Price</span>
              <span className="text-xs font-bold tabular-nums text-foreground">
                ${r.price < 1 ? r.price.toPrecision(4) : r.price.toLocaleString(undefined, { maximumFractionDigits: 2 })}
              </span>
            </div>
            <div>
              <span className="text-[9px] text-muted-foreground block">24h</span>
              <span className={`text-xs font-bold tabular-nums ${r.change24h >= 0 ? 'text-primary' : 'text-destructive'}`}>
                {r.change24h >= 0 ? '+' : ''}{r.change24h.toFixed(2)}%
              </span>
            </div>
            <div>
              <span className="text-[9px] text-muted-foreground block">Target</span>
              <span className="text-xs font-bold tabular-nums text-primary">
                ${r.target < 1 ? r.target.toPrecision(4) : r.target.toLocaleString(undefined, { maximumFractionDigits: 2 })}
              </span>
            </div>
            <div>
              <span className="text-[9px] text-muted-foreground block">Stop</span>
              <span className="text-xs font-bold tabular-nums text-destructive">
                ${r.invalidation < 1 ? r.invalidation.toPrecision(4) : r.invalidation.toLocaleString(undefined, { maximumFractionDigits: 2 })}
              </span>
            </div>
          </div>

          {/* Risk/Reward */}
          <div className="flex items-center gap-2">
            <Target className="h-3 w-3 text-accent" />
            <span className="text-[10px] text-muted-foreground">
              Risk/Reward: <span className="font-bold text-foreground">{r.riskReward}:1</span>
            </span>
            <div className="flex-1" />
            <span className="text-[10px] text-muted-foreground">
              Score: <span className="font-bold" style={{ color: gradeStyle.text }}>{r.score}/100</span>
            </span>
          </div>

          {/* Confirmations by category */}
          <div className="space-y-2">
            {Array.from(grouped.entries()).map(([cat, confs]) => (
              <div key={cat}>
                <div className="flex items-center gap-1 mb-1">
                  <div className="h-2 w-2 rounded-full" style={{ backgroundColor: CATEGORY_COLORS[cat] }} />
                  <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: CATEGORY_COLORS[cat] }}>
                    {CATEGORY_LABELS[cat] ?? cat}
                  </span>
                  <span className="text-[9px] text-muted-foreground">
                    +{confs.reduce((s, c) => s + c.weight, 0)} pts
                  </span>
                </div>
                <div className="space-y-0.5 pl-3">
                  {confs.map((c, i) => (
                    <div key={i} className="flex items-center gap-2 text-[10px]">
                      <Shield className="h-2.5 w-2.5 text-muted-foreground shrink-0" />
                      <span className="font-medium text-foreground">{c.name}</span>
                      <span className="text-muted-foreground truncate">{c.detail}</span>
                      <span className="ml-auto text-[9px] tabular-nums text-muted-foreground shrink-0">+{c.weight}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
