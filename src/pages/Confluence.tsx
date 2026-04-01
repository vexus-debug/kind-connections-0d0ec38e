import { useState, useMemo, useCallback } from 'react';
import { useSharedScanner } from '@/contexts/ScannerContext';
import { useSharedPatternScanner } from '@/contexts/PatternScannerContext';
import { useSharedRangeScanner } from '@/contexts/RangeScannerContext';
import { calculateConfluence, getConfluenceColor, getConfluenceLabel, type ConfluenceSignal } from '@/lib/confluence';
import { getSector, getSectorColor, getSectorEmoji, ALL_SECTORS, type CryptoSector } from '@/lib/sectors';
import type { Timeframe } from '@/types/scanner';
import { ALL_TIMEFRAMES, TIMEFRAME_LABELS } from '@/types/scanner';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Input } from '@/components/ui/input';
import { Search, TrendingUp, TrendingDown, Layers, ChevronDown, ChevronUp, Zap, Target, ArrowUpRight, ArrowDownRight } from 'lucide-react';

const DISPLAY_TIMEFRAMES: Timeframe[] = ['5', '15', '60', '240', 'D', 'W'];

const Confluence = () => {
  const { assets } = useSharedScanner();
  const { candlestickPatterns, chartPatterns, structurePatterns } = useSharedPatternScanner();
  const { assets: rangeAssets } = useSharedRangeScanner();

  const [search, setSearch] = useState('');
  const [selectedSector, setSelectedSector] = useState<CryptoSector | 'all'>('all');
  const [expandedSymbol, setExpandedSymbol] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<'score' | 'name' | 'change'>('score');

  const allPatterns = useMemo(() => [...candlestickPatterns, ...chartPatterns, ...structurePatterns], [candlestickPatterns, chartPatterns, structurePatterns]);

  // Build confluence grid
  const confluenceData = useMemo(() => {
    const symbols = [...new Set(assets.map(a => a.symbol))];
    const emptyDivMap = new Map();

    const symbolData: { symbol: string; sector: CryptoSector; change24h: number; price: number; signals: Map<Timeframe, ConfluenceSignal>; bestScore: number; bestDirection: string }[] = [];

    for (const symbol of symbols) {
      if (search && !symbol.toLowerCase().includes(search.toLowerCase())) continue;
      const sector = getSector(symbol);
      if (selectedSector !== 'all' && sector !== selectedSector) continue;

      const asset = assets.find(a => a.symbol === symbol);
      const signals = new Map<Timeframe, ConfluenceSignal>();
      let bestScore = 0;
      let bestDirection = 'neutral';

      for (const tf of DISPLAY_TIMEFRAMES) {
        const signal = calculateConfluence(symbol, tf, assets, rangeAssets, allPatterns, emptyDivMap);
        signals.set(tf, signal);
        if (signal.score > bestScore) {
          bestScore = signal.score;
          bestDirection = signal.direction;
        }
      }

      symbolData.push({
        symbol,
        sector,
        change24h: asset?.change24h ?? 0,
        price: asset?.price ?? 0,
        signals,
        bestScore,
        bestDirection,
      });
    }

    // Sort
    if (sortBy === 'score') symbolData.sort((a, b) => b.bestScore - a.bestScore);
    else if (sortBy === 'name') symbolData.sort((a, b) => a.symbol.localeCompare(b.symbol));
    else symbolData.sort((a, b) => Math.abs(b.change24h) - Math.abs(a.change24h));

    return symbolData;
  }, [assets, rangeAssets, allPatterns, search, selectedSector, sortBy]);

  // Stats
  const bullCount = confluenceData.filter(d => d.bestDirection === 'bull' && d.bestScore >= 30).length;
  const bearCount = confluenceData.filter(d => d.bestDirection === 'bear' && d.bestScore >= 30).length;
  const hotSetups = confluenceData.filter(d => d.bestScore >= 60).length;

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background">
      <header className="flex items-center justify-between border-b border-border px-4 py-2">
        <div>
          <h1 className="text-sm font-bold uppercase tracking-[0.15em] text-foreground flex items-center gap-2">
            <Zap className="h-4 w-4 text-accent" />
            CONFLUENCE MAP
          </h1>
          <p className="text-[10px] text-muted-foreground">Multi-scanner agreement heatmap</p>
        </div>
        <div className="flex items-center gap-3 text-[10px]">
          <span className="text-muted-foreground">{confluenceData.length} symbols</span>
          <span className="trend-bull flex items-center gap-0.5"><TrendingUp className="h-2.5 w-2.5" />{bullCount}</span>
          <span className="trend-bear flex items-center gap-0.5"><TrendingDown className="h-2.5 w-2.5" />{bearCount}</span>
          <span className="text-accent flex items-center gap-0.5"><Zap className="h-2.5 w-2.5" />{hotSetups} hot</span>
        </div>
      </header>

      {/* Filters */}
      <div className="border-b border-border px-4 py-2 space-y-2">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
            <Input className="h-7 bg-secondary pl-7 text-xs" placeholder="Search…" value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <select
            className="h-7 rounded bg-secondary px-2 text-[10px] text-foreground border-0 outline-none"
            value={sortBy}
            onChange={e => setSortBy(e.target.value as any)}
          >
            <option value="score">Sort: Score</option>
            <option value="name">Sort: Name</option>
            <option value="change">Sort: Change</option>
          </select>
        </div>
        {/* Sector pills */}
        <div className="flex items-center gap-1 flex-wrap">
          <button
            onClick={() => setSelectedSector('all')}
            className={`rounded-full px-2 py-0.5 text-[9px] font-medium transition-colors ${selectedSector === 'all' ? 'bg-accent/20 text-accent' : 'text-muted-foreground hover:text-foreground'}`}
          >
            All
          </button>
          {ALL_SECTORS.filter(s => s !== 'Other').map(sector => (
            <button
              key={sector}
              onClick={() => setSelectedSector(sector === selectedSector ? 'all' : sector)}
              className={`rounded-full px-2 py-0.5 text-[9px] font-medium transition-colors ${selectedSector === sector ? 'bg-accent/20 text-accent' : 'text-muted-foreground hover:text-foreground'}`}
            >
              {getSectorEmoji(sector)} {sector}
            </button>
          ))}
        </div>
      </div>

      {/* Heatmap Grid */}
      <ScrollArea className="flex-1">
        {/* TF Header */}
        <div className="sticky top-0 z-10 bg-background border-b border-border">
          <div className="flex items-center px-3 py-1.5">
            <div className="w-28 flex-shrink-0 text-[9px] text-muted-foreground uppercase">Symbol</div>
            {DISPLAY_TIMEFRAMES.map(tf => (
              <div key={tf} className="flex-1 text-center text-[9px] text-muted-foreground font-medium">{TIMEFRAME_LABELS[tf]}</div>
            ))}
            <div className="w-14 text-center text-[9px] text-muted-foreground">Best</div>
          </div>
        </div>

        <div className="divide-y divide-border/50">
          {confluenceData.map(item => (
            <ConfluenceRow
              key={item.symbol}
              item={item}
              expanded={expandedSymbol === item.symbol}
              onToggle={() => setExpandedSymbol(expandedSymbol === item.symbol ? null : item.symbol)}
            />
          ))}
          {confluenceData.length === 0 && (
            <div className="py-16 text-center text-xs text-muted-foreground">
              {assets.length === 0 ? 'Waiting for scan data…' : 'No symbols match filters'}
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
};

function ConfluenceRow({ item, expanded, onToggle }: {
  item: { symbol: string; sector: CryptoSector; change24h: number; price: number; signals: Map<Timeframe, ConfluenceSignal>; bestScore: number; bestDirection: string };
  expanded: boolean;
  onToggle: () => void;
}) {
  const changeColor = item.change24h >= 0 ? 'trend-bull' : 'trend-bear';

  return (
    <div>
      <button onClick={onToggle} className="flex w-full items-center px-3 py-1.5 hover:bg-secondary/30 transition-colors">
        {/* Symbol info */}
        <div className="w-28 flex-shrink-0 flex items-center gap-1.5">
          <span className="text-[9px]">{getSectorEmoji(item.sector)}</span>
          <div className="text-left">
            <div className="text-xs font-bold truncate">{item.symbol.replace('USDT', '')}</div>
            <div className={`text-[9px] tabular-nums ${changeColor}`}>
              {item.change24h >= 0 ? '+' : ''}{item.change24h.toFixed(1)}%
            </div>
          </div>
        </div>

        {/* Heatmap cells */}
        {DISPLAY_TIMEFRAMES.map(tf => {
          const sig = item.signals.get(tf);
          if (!sig || sig.score === 0) {
            return <div key={tf} className="flex-1 flex items-center justify-center"><span className="text-[9px] text-muted-foreground/30">—</span></div>;
          }
          return (
            <div key={tf} className="flex-1 flex items-center justify-center px-0.5">
              <div
                className="w-full max-w-[48px] rounded px-1 py-1 text-center transition-all"
                style={{ backgroundColor: getConfluenceColor(sig.score, sig.direction) }}
              >
                <div className="text-[10px] font-bold text-foreground">{getConfluenceLabel(sig.score)}</div>
                <div className="text-[8px] text-foreground/70 tabular-nums">{sig.score}</div>
              </div>
            </div>
          );
        })}

        {/* Best score */}
        <div className="w-14 flex items-center justify-center gap-1">
          {item.bestDirection === 'bull' && <ArrowUpRight className="h-3 w-3 trend-bull" />}
          {item.bestDirection === 'bear' && <ArrowDownRight className="h-3 w-3 trend-bear" />}
          {item.bestDirection === 'range' && <Layers className="h-3 w-3 text-accent" />}
          <span className={`text-xs font-bold tabular-nums ${
            item.bestScore >= 60 ? 'text-accent' : item.bestScore >= 30 ? 'text-foreground' : 'text-muted-foreground'
          }`}>
            {item.bestScore}
          </span>
          {expanded ? <ChevronUp className="h-2.5 w-2.5 text-muted-foreground" /> : <ChevronDown className="h-2.5 w-2.5 text-muted-foreground" />}
        </div>
      </button>

      {/* Expanded details */}
      {expanded && (
        <div className="px-4 pb-3 space-y-2 bg-secondary/20">
          {DISPLAY_TIMEFRAMES.map(tf => {
            const sig = item.signals.get(tf);
            if (!sig || sig.score === 0) return null;
            return (
              <div key={tf} className="rounded border border-border/50 px-3 py-2">
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center gap-2">
                    <span className="rounded bg-accent/15 px-1.5 py-0.5 text-[9px] font-bold text-accent">{TIMEFRAME_LABELS[tf]}</span>
                    <span className={`text-[10px] font-bold ${
                      sig.direction === 'bull' ? 'trend-bull' : sig.direction === 'bear' ? 'trend-bear' : 'text-accent'
                    }`}>
                      {sig.direction === 'bull' ? '↑ BULLISH' : sig.direction === 'bear' ? '↓ BEARISH' : '↔ RANGING'}
                    </span>
                  </div>
                  <span className="text-xs font-bold tabular-nums text-foreground">{sig.score}/100</span>
                </div>
                <div className="space-y-1">
                  {sig.components.map((comp, i) => (
                    <div key={i} className="flex items-center gap-2 text-[10px]">
                      <span className={`h-1.5 w-1.5 rounded-full ${
                        comp.signal === 'bull' ? 'bg-trend-bull' : comp.signal === 'bear' ? 'bg-trend-bear' : comp.signal === 'range' ? 'bg-accent' : 'bg-muted-foreground'
                      }`} />
                      <span className="text-muted-foreground uppercase text-[8px] w-14">{comp.source}</span>
                      <span className="text-foreground flex-1">{comp.label}</span>
                      <span className="tabular-nums text-muted-foreground">{comp.strength}%</span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default Confluence;
