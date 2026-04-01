import { useState, useMemo } from 'react';
import { useSharedRangeScanner } from '@/contexts/RangeScannerContext';
import { useIsMobile } from '@/hooks/use-mobile';
import { RefreshCw, Search, ChevronDown, ChevronUp, Gauge, Shield, ShieldCheck, ShieldAlert, Layers } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import type { AssetRange, RangeSignal, RangeIndicator } from '@/types/range-scanner';
import type { Timeframe } from '@/types/scanner';
import { ALL_TIMEFRAMES, TIMEFRAME_LABELS } from '@/types/scanner';

interface RangeEntry {
  asset: AssetRange;
  tf: Timeframe;
  sig: RangeSignal;
}

const RangeScanner = () => {
  const { assets, scanning, lastScanTime, scanProgress, runScan } = useSharedRangeScanner();
  const isMobile = useIsMobile();

  const lastScanStr = lastScanTime
    ? new Date(lastScanTime).toLocaleTimeString('en-US', { hour12: false })
    : '—';

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background">
      <header className={`flex items-center justify-between border-b border-border px-3 ${isMobile ? 'py-2' : 'py-1.5'}`}>
        <div className="flex items-center gap-3">
          <h1 className={`font-bold uppercase tracking-[0.15em] text-accent ${isMobile ? 'text-xs' : 'text-xs'}`}>
            RANGE SCANNER
          </h1>
          <span className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
            <span className={`h-1.5 w-1.5 rounded-full ${scanning ? 'bg-accent animate-pulse-dot' : 'bg-muted-foreground'}`} />
            {!isMobile && (scanning ? 'SCANNING' : 'IDLE')}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {!isMobile && (
            <>
              <span className="text-[10px] tabular-nums text-muted-foreground">Last: {lastScanStr}</span>
              <span className="text-[10px] text-muted-foreground">{assets.length} ranging</span>
            </>
          )}
          {isMobile && <span className="text-[10px] tabular-nums text-muted-foreground">{assets.length}</span>}
          <Button variant="ghost" size="icon" className={isMobile ? 'h-8 w-8' : 'h-7 w-7'} onClick={runScan} disabled={scanning} title="Force scan">
            <RefreshCw className={`${isMobile ? 'h-4 w-4' : 'h-3.5 w-3.5'} ${scanning ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </header>

      <RangeMatrix assets={assets} scanning={scanning} scanProgress={scanProgress} />
    </div>
  );
};

function RangeMatrix({ assets, scanning, scanProgress }: { assets: AssetRange[]; scanning: boolean; scanProgress: { current: number; total: number } }) {
  const [search, setSearch] = useState('');
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [filterTf, setFilterTf] = useState<Timeframe | 'all'>('all');

  const entries = useMemo(() => {
    const result: RangeEntry[] = [];
    for (const asset of assets) {
      if (search && !asset.symbol.toLowerCase().includes(search.toLowerCase())) continue;
      const timeframes = filterTf === 'all' ? ALL_TIMEFRAMES : [filterTf];
      for (const tf of timeframes) {
        const sig = asset.signals[tf];
        if (sig && sig.isRanging) {
          if (sig.confirmations === undefined) (sig as any).confirmations = 0;
          if (sig.totalChecks === undefined) (sig as any).totalChecks = 0;
          result.push({ asset, tf, sig });
        }
      }
    }
    result.sort((a, b) => {
      const confDiff = b.sig.confirmations - a.sig.confirmations;
      if (confDiff !== 0) return confDiff;
      return b.sig.score - a.sig.score;
    });
    return result;
  }, [assets, search, filterTf]);

  const strongCount = entries.filter(e => e.sig.strength === 'strong').length;
  const modCount = entries.filter(e => e.sig.strength === 'moderate').length;

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border px-3 py-2 space-y-2">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
            <Input className="h-7 bg-secondary pl-7 text-xs" placeholder="Search symbols…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
        </div>
        <div className="flex items-center gap-1 flex-wrap">
          <span className="text-[9px] uppercase text-muted-foreground mr-1">TF:</span>
          <button onClick={() => setFilterTf('all')} className={`rounded px-1.5 py-0.5 text-[9px] transition-colors ${filterTf === 'all' ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:text-foreground'}`}>ALL</button>
          {ALL_TIMEFRAMES.map(tf => (
            <button key={tf} onClick={() => setFilterTf(tf)} className={`rounded px-1.5 py-0.5 text-[9px] transition-colors ${filterTf === tf ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:text-foreground'}`}>{TIMEFRAME_LABELS[tf]}</button>
          ))}
        </div>
        <div className="flex items-center gap-3 text-[10px]">
          <span className="text-muted-foreground">{entries.length} ranges</span>
          <span className="text-accent flex items-center gap-0.5"><ShieldCheck className="h-2.5 w-2.5" />{strongCount} strong</span>
          <span className="text-muted-foreground flex items-center gap-0.5"><Shield className="h-2.5 w-2.5" />{modCount} mod</span>
        </div>
      </div>

      {scanning && (
        <div className="flex items-center gap-2 border-b border-border bg-secondary/50 px-3 py-1">
          <span className="h-1.5 w-1.5 rounded-full bg-accent animate-pulse-dot" />
          <span className="text-[10px] text-muted-foreground">Scanning {scanProgress.current}/{scanProgress.total}</span>
          <div className="flex-1">
            <div className="h-0.5 rounded-full bg-muted">
              <div className="h-full rounded-full bg-accent transition-all duration-300" style={{ width: scanProgress.total > 0 ? `${(scanProgress.current / scanProgress.total) * 100}%` : '0%' }} />
            </div>
          </div>
        </div>
      )}

      <ScrollArea className="flex-1">
        <div className="p-2 space-y-1.5">
          {entries.map((entry, idx) => {
            const key = `${entry.asset.symbol}-${entry.tf}`;
            return (
              <RangeCard
                key={key}
                rank={idx + 1}
                entry={entry}
                expanded={expandedKey === key}
                onToggle={() => setExpandedKey(expandedKey === key ? null : key)}
              />
            );
          })}
          {entries.length === 0 && !scanning && (
            <div className="px-4 py-12 text-center text-xs text-muted-foreground">
              {assets.length === 0 ? 'Waiting for data…' : 'No ranging coins found'}
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

function RangeCard({ rank, entry, expanded, onToggle }: { rank: number; entry: RangeEntry; expanded: boolean; onToggle: () => void }) {
  const { asset, tf, sig } = entry;
  const changeColor = asset.change24h >= 0 ? 'trend-bull' : 'trend-bear';
  const ConfIcon = sig.strength === 'strong' ? ShieldCheck : sig.strength === 'moderate' ? Shield : ShieldAlert;

  const formatPrice = (p: number) => p < 1 ? p.toPrecision(4) : p.toFixed(2);

  return (
    <div className="rounded border transition-colors" style={{ borderColor: 'hsl(217 90% 60% / 0.2)', backgroundColor: 'hsl(217 90% 60% / 0.03)' }}>
      <button onClick={onToggle} className="flex w-full items-center gap-2 px-3 py-2 text-left">
        <span className="text-[10px] tabular-nums text-muted-foreground w-4 flex-shrink-0 text-right">#{rank}</span>
        <div className="flex items-center gap-1.5 min-w-0 flex-1">
          <Layers className="h-3.5 w-3.5 text-accent flex-shrink-0" />
          <span className="text-xs font-bold truncate">{asset.symbol.replace('USDT', '')}</span>
          <span className="rounded bg-secondary px-1 py-0.5 text-[9px] text-muted-foreground">{TIMEFRAME_LABELS[tf]}</span>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <span className="text-[10px] tabular-nums text-foreground hidden sm:inline">${formatPrice(asset.price)}</span>
          <span className={`text-[10px] tabular-nums ${changeColor}`}>{asset.change24h >= 0 ? '+' : ''}{asset.change24h.toFixed(2)}%</span>
          <div className={`flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[9px] font-bold ${
            sig.strength === 'strong' ? 'bg-accent/20 text-accent' : sig.strength === 'moderate' ? 'bg-accent/10 text-accent' : 'bg-muted text-muted-foreground'
          }`}>
            <ConfIcon className="h-2.5 w-2.5" />
            {sig.confirmations}/{sig.totalChecks}
          </div>
          {expanded ? <ChevronUp className="h-3 w-3 text-muted-foreground" /> : <ChevronDown className="h-3 w-3 text-muted-foreground" />}
        </div>
      </button>

      {expanded && (
        <div className="border-t border-border/50 px-3 py-2 space-y-2">
          {/* Range Bounds */}
          <div className="space-y-1">
            <div className="text-[9px] uppercase text-muted-foreground font-medium">Primary Range ({TIMEFRAME_LABELS[tf]})</div>
            <div className="grid grid-cols-3 gap-2">
              <div className="rounded bg-destructive/10 px-2 py-1.5">
                <div className="text-[8px] uppercase text-muted-foreground">Upper</div>
                <div className="text-[11px] font-bold text-destructive tabular-nums">${formatPrice(sig.primaryRange.upper)}</div>
              </div>
              <div className="rounded bg-accent/10 px-2 py-1.5 text-center">
                <div className="text-[8px] uppercase text-muted-foreground">Width</div>
                <div className="text-[11px] font-bold text-accent tabular-nums">{sig.primaryRange.width.toFixed(2)}%</div>
              </div>
              <div className="rounded bg-primary/10 px-2 py-1.5">
                <div className="text-[8px] uppercase text-muted-foreground">Lower</div>
                <div className="text-[11px] font-bold text-primary tabular-nums">${formatPrice(sig.primaryRange.lower)}</div>
              </div>
            </div>
          </div>

          {/* Position in range */}
          <div className="space-y-1">
            <div className="text-[9px] uppercase text-muted-foreground font-medium">Position in Range</div>
            <div className="flex items-center gap-2">
              <span className="text-[9px] text-primary">Low</span>
              <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden relative">
                <div className="absolute inset-0 flex">
                  <div className="flex-1 bg-primary/20 rounded-l-full" />
                  <div className="flex-1 bg-accent/20" />
                  <div className="flex-1 bg-destructive/20 rounded-r-full" />
                </div>
                <div className="absolute top-0 h-full w-1 bg-foreground rounded-full transition-all" style={{ left: `${Math.max(0, Math.min(100, sig.positionInRange))}%` }} />
              </div>
              <span className="text-[9px] text-destructive">High</span>
              <span className="text-[10px] tabular-nums font-bold text-foreground">{sig.positionInRange.toFixed(0)}%</span>
            </div>
          </div>

          {/* All detected ranges */}
          {sig.ranges.length > 1 && (
            <div className="space-y-1">
              <div className="text-[9px] uppercase text-muted-foreground font-medium">All Detected Ranges</div>
              <div className="space-y-0.5">
                {['Bollinger', 'Donchian', 'Keltner', 'Swing H/L'].slice(0, sig.ranges.length).map((name, i) => (
                  <div key={i} className="flex items-center justify-between text-[10px]">
                    <span className="text-muted-foreground">{name}</span>
                    <span className="tabular-nums text-foreground">
                      ${formatPrice(sig.ranges[i].lower)} — ${formatPrice(sig.ranges[i].upper)}
                      <span className="text-muted-foreground ml-1">({sig.ranges[i].width.toFixed(1)}%)</span>
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Indicator breakdown */}
          <div className="space-y-0.5">
            <div className="text-[9px] uppercase text-muted-foreground font-medium mb-1">Indicator Breakdown ({TIMEFRAME_LABELS[tf]})</div>
            {(sig.indicators ?? []).map((ind: RangeIndicator) => (
              <div key={ind.name} className="flex items-center justify-between text-[10px]">
                <div className="flex items-center gap-1.5">
                  <span className={`h-1.5 w-1.5 rounded-full ${
                    ind.signal === 'range' ? 'bg-accent' : ind.signal === 'trend' ? 'bg-destructive' : 'bg-muted-foreground'
                  }`} />
                  <span className="text-foreground font-medium">{ind.name}</span>
                </div>
                <span className={`tabular-nums ${ind.confirmed ? 'text-accent' : 'text-muted-foreground'}`}>{ind.value}</span>
              </div>
            ))}
          </div>

          {/* Probability */}
          <div className="flex items-center gap-2 py-1.5 border-t border-border/30">
            <Gauge className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-[10px] text-muted-foreground font-medium">Probability</span>
            <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
              <div className="h-full rounded-full transition-all duration-500" style={{
                width: `${sig.probability}%`,
                backgroundColor: sig.probability >= 75 ? 'hsl(var(--accent))' : sig.probability >= 50 ? 'hsl(var(--accent) / 0.7)' : 'hsl(var(--muted-foreground))',
              }} />
            </div>
            <span className={`text-[11px] font-bold tabular-nums ${sig.probability >= 75 ? 'text-accent' : sig.probability >= 50 ? 'text-accent' : 'text-muted-foreground'}`}>{sig.probability}%</span>
          </div>

          {/* Quick stats */}
          <div className="flex gap-3 pt-1 border-t border-border/30 text-[9px] text-muted-foreground">
            <span>ADX: {sig.adx.toFixed(0)}</span>
            <span>RSI: {sig.rsi.toFixed(0)}</span>
            <span>BB: {(sig.bbBandwidth * 100).toFixed(1)}%</span>
            <span>Vol: {sig.volumeRatio.toFixed(1)}x</span>
            {sig.squeeze && <span className="text-accent">SQUEEZE</span>}
          </div>
        </div>
      )}
    </div>
  );
}

export default RangeScanner;
