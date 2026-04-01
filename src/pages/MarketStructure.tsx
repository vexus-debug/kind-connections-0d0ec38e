import { useState, useMemo } from 'react';
import { useChochScanner, type ChochResult } from '@/hooks/useChochScanner';
import { TIMEFRAME_LABELS, type Timeframe } from '@/types/scanner';

import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { RefreshCw, Shield, TrendingUp, TrendingDown, X, AlertTriangle } from 'lucide-react';

const SCAN_TIMEFRAMES: Timeframe[] = ['1', '5', '15', '60', '240', 'D', 'W'];
const CHOCH_FAIL_OPTIONS = ['all', '1+', '2+', '3+', '5+'] as const;
type ChochFailFilter = typeof CHOCH_FAIL_OPTIONS[number];
type TrendFilter = 'all' | 'bullish' | 'bearish';

const MarketStructurePage = () => {
  const { results, scanning, scanProgress, lastScanTime, runScan, groupByTimeframe } = useChochScanner();
  const [tfFilter, setTfFilter] = useState<Timeframe | 'all'>('all');
  const [chochFailFilter, setChochFailFilter] = useState<ChochFailFilter>('all');
  const [trendFilter, setTrendFilter] = useState<TrendFilter>('all');

  const filtered = useMemo(() => {
    const minFails = chochFailFilter === 'all' ? 0 : parseInt(chochFailFilter);
    return results.filter(r => {
      if (tfFilter !== 'all' && r.timeframe !== tfFilter) return false;
      if (minFails > 0 && r.chochFailures < minFails) return false;
      if (trendFilter !== 'all' && r.trendDirection !== trendFilter) return false;
      // Only show results with at least 1 failure by default when no filter
      if (chochFailFilter === 'all' && r.chochFailures === 0) return false;
      return true;
    });
  }, [results, tfFilter, chochFailFilter, trendFilter]);

  const groups = useMemo(() => groupByTimeframe(filtered), [filtered, groupByTimeframe]);
  const totalResults = filtered.length;
  const hasFilters = tfFilter !== 'all' || chochFailFilter !== 'all' || trendFilter !== 'all';

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <header className="flex items-center justify-between border-b border-border px-4 py-3">
        <div>
          <h1 className="text-sm font-bold uppercase tracking-[0.15em] text-foreground">CHoCH Failure Counter</h1>
          <p className="text-[10px] text-muted-foreground">Failed Change of Character attempts in current trend</p>
        </div>
        <div className="flex items-center gap-2">
          {scanning && (
            <span className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
              <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
              {scanProgress.current}/{scanProgress.total}
            </span>
          )}
          <span className="text-[10px] tabular-nums text-muted-foreground">{totalResults} results</span>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={runScan} disabled={scanning}>
            <RefreshCw className={`h-3.5 w-3.5 ${scanning ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </header>

      {/* Filters */}
      <div className="border-b border-border px-4 py-2">
        <div className="flex items-center gap-3 flex-wrap">
          {/* Trend filter */}
          <div className="flex items-center gap-1">
            {(['all', 'bullish', 'bearish'] as TrendFilter[]).map(t => (
              <button
                key={t}
                onClick={() => setTrendFilter(t)}
                className={`rounded-full px-2.5 py-1 text-[10px] font-medium transition-colors ${
                  trendFilter === t
                    ? t === 'bullish' ? 'bg-primary/20 text-primary'
                    : t === 'bearish' ? 'bg-destructive/20 text-destructive'
                    : 'bg-secondary text-foreground'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {t === 'all' ? 'All' : t === 'bullish' ? '↑ Bull' : '↓ Bear'}
              </button>
            ))}
          </div>
          <div className="h-4 w-px bg-border" />
          {/* Timeframe filter */}
          <div className="flex items-center gap-1 overflow-x-auto">
            <button
              onClick={() => setTfFilter('all')}
              className={`rounded-full px-2 py-1 text-[10px] font-medium transition-colors whitespace-nowrap ${
                tfFilter === 'all' ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:text-foreground'
              }`}
            >All TF</button>
            {SCAN_TIMEFRAMES.map(tf => (
              <button
                key={tf}
                onClick={() => setTfFilter(tf)}
                className={`rounded-full px-2 py-1 text-[10px] font-medium transition-colors whitespace-nowrap ${
                  tfFilter === tf ? 'bg-accent/20 text-accent' : 'text-muted-foreground hover:text-foreground'
                }`}
              >{TIMEFRAME_LABELS[tf]}</button>
            ))}
          </div>
          <div className="h-4 w-px bg-border" />
          {/* CHoCH fail count filter */}
          <div className="flex items-center gap-1">
            <span className="text-[9px] text-muted-foreground mr-0.5">Fails:</span>
            {CHOCH_FAIL_OPTIONS.map(opt => (
              <button
                key={opt}
                onClick={() => setChochFailFilter(opt)}
                className={`rounded-full px-2 py-1 text-[10px] font-medium transition-colors ${
                  chochFailFilter === opt ? 'bg-destructive/20 text-destructive' : 'text-muted-foreground hover:text-foreground'
                }`}
              >{opt === 'all' ? 'Any' : opt}</button>
            ))}
          </div>
          {hasFilters && (
            <button onClick={() => { setTfFilter('all'); setChochFailFilter('all'); setTrendFilter('all'); }}
              className="flex items-center gap-0.5 rounded-full px-2 py-1 text-[10px] text-muted-foreground hover:text-foreground">
              <X className="h-2.5 w-2.5" /> Clear
            </button>
          )}
        </div>
      </div>

      {/* Progress bar */}
      {scanning && (
        <div className="h-0.5 bg-muted">
          <div className="h-full bg-primary transition-all duration-300"
            style={{ width: scanProgress.total > 0 ? `${(scanProgress.current / scanProgress.total) * 100}%` : '0%' }} />
        </div>
      )}

      {/* Results */}
      <ScrollArea className="flex-1">
        <div className="p-3 space-y-5">
          {groups.length === 0 && !scanning && (
            <div className="py-16 text-center text-xs text-muted-foreground">
              {results.length === 0
                ? 'Hit ↻ to scan for failed CHoCH attempts across all symbols.'
                : 'No results match filters. Try adjusting.'}
            </div>
          )}

          {groups.map(group => (
            <div key={group.timeframe}>
              <div className="flex items-center gap-2 mb-3">
                <span className="rounded-full bg-accent/15 px-3 py-0.5 text-[11px] font-bold text-accent">
                  {group.label}
                </span>
                <span className="text-[10px] text-muted-foreground">
                  {group.results.length} symbol{group.results.length !== 1 ? 's' : ''}
                </span>
                <div className="flex-1 h-px bg-border" />
              </div>
              <div className="space-y-2">
                {group.results.map(r => (
                  <ChochCard key={r.id} result={r} />
                ))}
              </div>
            </div>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
};

function ChochCard({ result }: { result: ChochResult }) {
  const { symbol, chochFailures, trendDirection, price, timeframe } = result;
  const isBull = trendDirection === 'bullish';
  const isBear = trendDirection === 'bearish';

  const severityColor = chochFailures >= 5
    ? 'text-destructive'
    : chochFailures >= 3
    ? 'text-accent'
    : 'text-foreground';

  const severityLabel = chochFailures >= 5
    ? 'Critical'
    : chochFailures >= 3
    ? 'Elevated'
    : 'Low';

  return (
    <div
      className="rounded-lg border overflow-hidden transition-all"
      style={{
        borderColor: isBull
          ? 'hsl(142 72% 45% / 0.2)'
          : isBear
          ? 'hsl(0 72% 50% / 0.2)'
          : 'hsl(var(--border))',
      }}
    >
      <div className="flex items-center gap-3 px-3 py-2.5">
        {/* Symbol + trend */}
        <div className="flex items-center gap-2 min-w-0">
          <h3 className="text-sm font-bold text-foreground truncate">{symbol}</h3>
          <Badge variant="outline" className="text-[9px] px-2 py-0 rounded-full border-accent/30 text-accent shrink-0">
            {TIMEFRAME_LABELS[timeframe]}
          </Badge>
          {trendDirection !== 'unknown' && (
            <Badge className={`text-[9px] px-2 py-0 rounded-full border-0 shrink-0 ${
              isBull ? 'bg-primary/20 text-primary' : 'bg-destructive/20 text-destructive'
            }`}>
              {isBull ? <TrendingUp className="h-2.5 w-2.5 mr-0.5 inline" /> : <TrendingDown className="h-2.5 w-2.5 mr-0.5 inline" />}
              {isBull ? 'Uptrend' : 'Downtrend'}
            </Badge>
          )}
        </div>

        <div className="flex-1" />

        {/* Price */}
        <span className="text-[10px] tabular-nums text-muted-foreground shrink-0">
          ${price < 1 ? price.toPrecision(4) : price.toLocaleString(undefined, { maximumFractionDigits: 2 })}
        </span>

        {/* CHoCH failure count — the star of the show */}
        <div className="flex items-center gap-1.5 shrink-0 rounded-full bg-secondary/60 px-2.5 py-1">
          <Shield className={`h-3.5 w-3.5 ${severityColor}`} />
          <span className={`text-sm font-black tabular-nums ${severityColor}`}>{chochFailures}</span>
          <span className="text-[8px] text-muted-foreground">fails</span>
        </div>
      </div>

      {/* Severity bar */}
      {chochFailures >= 2 && (
        <div className="px-3 pb-2">
          <div className="flex items-center gap-2 text-[9px]">
            <AlertTriangle className={`h-2.5 w-2.5 ${severityColor}`} />
            <span className={`font-medium ${severityColor}`}>{severityLabel}</span>
            <span className="text-muted-foreground">
              — {chochFailures} failed reversal attempt{chochFailures !== 1 ? 's' : ''} in current {isBull ? 'uptrend' : isBear ? 'downtrend' : 'trend'}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

export default MarketStructurePage;
