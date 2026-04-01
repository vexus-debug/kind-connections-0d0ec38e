import { useMemo, useState } from 'react';
import { useSharedScanner } from '@/contexts/ScannerContext';
import { getSector, getSectorEmoji } from '@/lib/sectors';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Input } from '@/components/ui/input';
import { Search, Zap } from 'lucide-react';
import type { AssetTrend } from '@/types/scanner';

interface VolRow {
  asset: AssetTrend;
  range24h: number;       // (high - low) / close as %
  priceRange: number;     // absolute range
  volatilityScore: number; // composite 0-100
}

function calculateVolMetrics(asset: AssetTrend): VolRow {
  // Use 24h change magnitude as a volatility proxy
  const absChange = Math.abs(asset.change24h);

  // Estimate intraday range from available data
  // Use price and change to estimate high/low
  const estimatedMove = asset.price * (absChange / 100);
  const range24h = absChange; // % range
  const priceRange = estimatedMove;

  // Composite volatility score (0-100)
  const volatilityScore = Math.min(100, absChange * 5 + (asset.volume24h > 1e8 ? 10 : 0));

  return { asset, range24h, priceRange, volatilityScore };
}

type SortBy = 'volatility' | 'change' | 'volume';

const VolatilityRanking = () => {
  const { assets } = useSharedScanner();
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<SortBy>('volatility');

  const rows = useMemo(() => {
    let filtered = assets.filter(a =>
      !search || a.symbol.toLowerCase().includes(search.toLowerCase())
    );

    const scored = filtered.map(a => calculateVolMetrics(a));

    scored.sort((a, b) => {
      if (sortBy === 'volatility') return b.volatilityScore - a.volatilityScore;
      if (sortBy === 'change') return Math.abs(b.asset.change24h) - Math.abs(a.asset.change24h);
      return b.asset.volume24h - a.asset.volume24h;
    });

    return scored;
  }, [assets, search, sortBy]);

  const maxVol = rows[0]?.volatilityScore || 1;

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background">
      <header className="border-b border-border px-4 py-2">
        <h1 className="text-sm font-bold uppercase tracking-[0.15em] text-foreground flex items-center gap-2">
          <Zap className="h-4 w-4 text-accent" />
          VOLATILITY RANKING
        </h1>
        <p className="text-[10px] text-muted-foreground">Pairs ranked by price movement intensity</p>
      </header>

      <div className="border-b border-border px-4 py-2 flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[120px] max-w-[200px]">
          <Search className="absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
          <Input className="h-7 bg-secondary pl-7 text-xs" placeholder="Search…" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <div className="flex gap-1">
          {(['volatility', 'change', 'volume'] as SortBy[]).map(s => (
            <button key={s} onClick={() => setSortBy(s)} className={`rounded px-2 py-0.5 text-[9px] transition-colors ${sortBy === s ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:text-foreground'}`}>
              {s === 'volatility' ? 'Volatility' : s === 'change' ? '% Change' : 'Volume'}
            </button>
          ))}
        </div>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-3 space-y-1">
          {rows.map((row, idx) => {
            const { asset, volatilityScore, range24h } = row;
            const barWidth = maxVol > 0 ? (volatilityScore / maxVol) * 100 : 0;
            const isHot = volatilityScore >= 50;
            const isWarm = volatilityScore >= 25;

            return (
              <div key={asset.symbol} className="flex items-center gap-2 rounded px-3 py-1.5 hover:bg-secondary/30 transition-colors">
                {/* Rank */}
                <span className="text-[10px] tabular-nums text-muted-foreground w-5 text-right">
                  {idx + 1}
                </span>

                {/* Symbol */}
                <div className="w-20 flex items-center gap-1 flex-shrink-0">
                  <span className="text-xs font-bold truncate">{asset.symbol.replace('USDT', '')}</span>
                  <span className="text-[8px]">{getSectorEmoji(getSector(asset.symbol))}</span>
                </div>

                {/* Volatility bar */}
                <div className="flex-1 h-4 rounded bg-secondary/50 overflow-hidden relative">
                  <div
                    className="h-full rounded transition-all duration-300"
                    style={{
                      width: `${barWidth}%`,
                      backgroundColor: isHot
                        ? 'hsl(var(--confluence-hot) / 0.6)'
                        : isWarm
                          ? 'hsl(var(--confluence-warm) / 0.5)'
                          : 'hsl(var(--accent) / 0.3)',
                    }}
                  />
                  <span className="absolute inset-0 flex items-center px-2 text-[9px] font-bold text-foreground">
                    {volatilityScore.toFixed(0)}
                  </span>
                </div>

                {/* Change */}
                <span className={`text-[10px] font-bold tabular-nums w-14 text-right ${
                  asset.change24h >= 0 ? 'trend-bull' : 'trend-bear'
                }`}>
                  {asset.change24h >= 0 ? '+' : ''}{asset.change24h.toFixed(1)}%
                </span>

                {/* Volume */}
                <span className="text-[10px] tabular-nums text-muted-foreground w-14 text-right">
                  {asset.volume24h > 1e9 ? `${(asset.volume24h / 1e9).toFixed(1)}B` :
                   asset.volume24h > 1e6 ? `${(asset.volume24h / 1e6).toFixed(1)}M` :
                   `${(asset.volume24h / 1e3).toFixed(0)}K`}
                </span>
              </div>
            );
          })}
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

export default VolatilityRanking;
