import { useMemo, useState } from 'react';
import { useSharedScanner } from '@/contexts/ScannerContext';
import { ALL_TIMEFRAMES, TIMEFRAME_LABELS, type Timeframe, type AssetTrend } from '@/types/scanner';
import { getSector, getSectorEmoji } from '@/lib/sectors';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Input } from '@/components/ui/input';
import { Search, ArrowUpDown } from 'lucide-react';
import type { ConfirmedTrend } from '@/lib/indicators';

type SortBy = 'alignment' | 'name' | 'change';

const MultiTimeframe = () => {
  const { assets } = useSharedScanner();
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<SortBy>('alignment');

  const rows = useMemo(() => {
    let filtered = assets.filter(a =>
      !search || a.symbol.toLowerCase().includes(search.toLowerCase())
    );

    // Calculate alignment score per asset
    const scored = filtered.map(asset => {
      let bullCount = 0, bearCount = 0, totalSignals = 0;
      for (const tf of ALL_TIMEFRAMES) {
        const sig = asset.signals[tf] as ConfirmedTrend | undefined;
        if (sig?.direction) {
          totalSignals++;
          if (sig.direction === 'bull') bullCount++;
          else bearCount++;
        }
      }
      const alignment = totalSignals > 0
        ? Math.max(bullCount, bearCount) / totalSignals
        : 0;
      const dominantDir = bullCount >= bearCount ? 'bull' : 'bear';
      return { asset, bullCount, bearCount, totalSignals, alignment, dominantDir };
    });

    // Sort
    scored.sort((a, b) => {
      if (sortBy === 'alignment') return b.alignment - a.alignment || b.totalSignals - a.totalSignals;
      if (sortBy === 'name') return a.asset.symbol.localeCompare(b.asset.symbol);
      return Math.abs(b.asset.change24h) - Math.abs(a.asset.change24h);
    });

    return scored;
  }, [assets, search, sortBy]);

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background">
      <header className="border-b border-border px-4 py-2">
        <h1 className="text-sm font-bold uppercase tracking-[0.15em] text-foreground flex items-center gap-2">
          <ArrowUpDown className="h-4 w-4 text-accent" />
          MTF ALIGNMENT
        </h1>
        <p className="text-[10px] text-muted-foreground">Trend direction across all timeframes</p>
      </header>

      <div className="border-b border-border px-4 py-2 flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[120px] max-w-[200px]">
          <Search className="absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
          <Input className="h-7 bg-secondary pl-7 text-xs" placeholder="Search…" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <div className="flex gap-1">
          {(['alignment', 'name', 'change'] as SortBy[]).map(s => (
            <button key={s} onClick={() => setSortBy(s)} className={`rounded px-2 py-0.5 text-[9px] transition-colors ${sortBy === s ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:text-foreground'}`}>
              {s === 'alignment' ? 'Alignment' : s === 'name' ? 'A-Z' : '%Chg'}
            </button>
          ))}
        </div>
      </div>

      <ScrollArea className="flex-1">
        {/* Timeframe header */}
        <div className="sticky top-0 z-10 bg-card border-b border-border flex items-center px-4 py-1.5 gap-1">
          <div className="w-24 flex-shrink-0 text-[9px] uppercase text-muted-foreground font-bold">Symbol</div>
          {ALL_TIMEFRAMES.map(tf => (
            <div key={tf} className="flex-1 text-center text-[9px] uppercase text-muted-foreground font-bold min-w-[36px]">
              {TIMEFRAME_LABELS[tf]}
            </div>
          ))}
          <div className="w-14 text-right text-[9px] uppercase text-muted-foreground font-bold">Score</div>
        </div>

        <div className="divide-y divide-border/50">
          {rows.map(({ asset, bullCount, bearCount, totalSignals, alignment, dominantDir }) => (
            <div key={asset.symbol} className="flex items-center px-4 py-1.5 gap-1 hover:bg-secondary/30 transition-colors">
              {/* Symbol */}
              <div className="w-24 flex-shrink-0 flex items-center gap-1">
                <span className="text-xs font-bold truncate">{asset.symbol.replace('USDT', '')}</span>
                <span className="text-[8px]">{getSectorEmoji(getSector(asset.symbol))}</span>
              </div>

              {/* TF cells */}
              {ALL_TIMEFRAMES.map(tf => {
                const sig = asset.signals[tf] as ConfirmedTrend | undefined;
                if (!sig?.direction) {
                  return <div key={tf} className="flex-1 flex justify-center min-w-[36px]"><span className="h-5 w-5 rounded bg-secondary/50 flex items-center justify-center text-[9px] text-muted-foreground">—</span></div>;
                }
                const isBull = sig.direction === 'bull';
                const strength = sig.strength;
                const opacity = strength === 'strong' ? '1' : strength === 'moderate' ? '0.7' : '0.4';
                return (
                  <div key={tf} className="flex-1 flex justify-center min-w-[36px]">
                    <span
                      className="h-5 w-5 rounded flex items-center justify-center text-[9px] font-bold"
                      style={{
                        backgroundColor: isBull ? `hsl(var(--trend-bull) / ${opacity})` : `hsl(var(--trend-bear) / ${opacity})`,
                        color: 'hsl(var(--foreground))',
                      }}
                      title={`${TIMEFRAME_LABELS[tf]}: ${sig.direction} (${strength}) — ${sig.confirmations}/${sig.totalChecks}`}
                    >
                      {isBull ? '↑' : '↓'}
                    </span>
                  </div>
                );
              })}

              {/* Alignment score */}
              <div className="w-14 text-right">
                <span className={`text-[10px] font-bold tabular-nums ${
                  totalSignals === 0 ? 'text-muted-foreground' :
                  alignment >= 0.8 ? (dominantDir === 'bull' ? 'trend-bull' : 'trend-bear') :
                  'text-muted-foreground'
                }`}>
                  {totalSignals > 0 ? `${bullCount}↑ ${bearCount}↓` : '—'}
                </span>
              </div>
            </div>
          ))}
          {rows.length === 0 && (
            <div className="px-4 py-12 text-center text-xs text-muted-foreground">
              {assets.length === 0 ? 'Waiting for scan data…' : 'No results'}
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
};

export default MultiTimeframe;
