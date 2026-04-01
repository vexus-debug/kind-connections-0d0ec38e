import { useMemo, useState } from 'react';
import { useSharedScanner } from '@/contexts/ScannerContext';
import { getSector, getSectorEmoji, ALL_SECTORS, type CryptoSector } from '@/lib/sectors';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Grid3X3 } from 'lucide-react';

type ColorBy = 'change' | 'volume';

function getChangeColor(change: number): string {
  const clamped = Math.max(-15, Math.min(15, change));
  const intensity = Math.abs(clamped) / 15;
  if (change >= 0) {
    return `hsl(var(--trend-bull) / ${0.15 + intensity * 0.75})`;
  }
  return `hsl(var(--trend-bear) / ${0.15 + intensity * 0.75})`;
}

const Heatmap = () => {
  const { assets } = useSharedScanner();
  const [colorBy, setColorBy] = useState<ColorBy>('change');
  const [filterSector, setFilterSector] = useState<CryptoSector | 'all'>('all');

  const tiles = useMemo(() => {
    let filtered = assets;
    if (filterSector !== 'all') {
      filtered = filtered.filter(a => getSector(a.symbol) === filterSector);
    }

    // Sort by volume (largest tiles first)
    return [...filtered].sort((a, b) => b.volume24h - a.volume24h);
  }, [assets, filterSector]);

  const maxVol = tiles[0]?.volume24h || 1;

  if (assets.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
        Waiting for scan data…
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background">
      <header className="border-b border-border px-4 py-2">
        <h1 className="text-sm font-bold uppercase tracking-[0.15em] text-foreground flex items-center gap-2">
          <Grid3X3 className="h-4 w-4 text-accent" />
          MARKET HEATMAP
        </h1>
        <p className="text-[10px] text-muted-foreground">Visual overview — sized by volume, colored by % change</p>
      </header>

      <div className="border-b border-border px-4 py-2 flex items-center gap-2 flex-wrap">
        <select
          className="h-6 rounded bg-secondary px-1.5 text-[10px] text-foreground border-0 outline-none"
          value={filterSector}
          onChange={e => setFilterSector(e.target.value as any)}
        >
          <option value="all">All Sectors</option>
          {ALL_SECTORS.map(s => <option key={s} value={s}>{getSectorEmoji(s)} {s}</option>)}
        </select>
        <div className="flex gap-1">
          <button onClick={() => setColorBy('change')} className={`rounded px-2 py-0.5 text-[9px] ${colorBy === 'change' ? 'bg-accent text-accent-foreground' : 'text-muted-foreground'}`}>% Change</button>
          <button onClick={() => setColorBy('volume')} className={`rounded px-2 py-0.5 text-[9px] ${colorBy === 'volume' ? 'bg-accent text-accent-foreground' : 'text-muted-foreground'}`}>Volume</button>
        </div>
        {/* Legend */}
        <div className="ml-auto flex items-center gap-1 text-[9px] text-muted-foreground">
          <span className="h-2.5 w-2.5 rounded" style={{ backgroundColor: 'hsl(var(--trend-bear) / 0.7)' }} />
          <span>-15%</span>
          <span className="h-2.5 w-8 rounded" style={{ background: 'linear-gradient(to right, hsl(var(--trend-bear) / 0.5), hsl(var(--secondary)), hsl(var(--trend-bull) / 0.5))' }} />
          <span>+15%</span>
          <span className="h-2.5 w-2.5 rounded" style={{ backgroundColor: 'hsl(var(--trend-bull) / 0.7)' }} />
        </div>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-3">
          <div className="flex flex-wrap gap-1">
            {tiles.map(asset => {
              const relVol = asset.volume24h / maxVol;
              // Tile size based on relative volume (min 48px, max 120px)
              const size = Math.max(48, Math.min(120, 48 + relVol * 72));
              const bgColor = colorBy === 'change'
                ? getChangeColor(asset.change24h)
                : `hsl(var(--accent) / ${0.1 + relVol * 0.7})`;

              return (
                <div
                  key={asset.symbol}
                  className="rounded border border-border/30 flex flex-col items-center justify-center transition-all hover:border-foreground/30 cursor-default"
                  style={{
                    width: `${size}px`,
                    height: `${size}px`,
                    backgroundColor: bgColor,
                  }}
                  title={`${asset.symbol}\n${asset.change24h >= 0 ? '+' : ''}${asset.change24h.toFixed(2)}%\nVol: ${asset.volume24h > 1e6 ? (asset.volume24h / 1e6).toFixed(1) + 'M' : (asset.volume24h / 1e3).toFixed(0) + 'K'}`}
                >
                  <span className="text-[9px] font-bold text-foreground leading-tight truncate max-w-full px-0.5">
                    {asset.symbol.replace('USDT', '')}
                  </span>
                  <span className={`text-[8px] font-bold tabular-nums ${asset.change24h >= 0 ? 'trend-bull' : 'trend-bear'}`}>
                    {asset.change24h >= 0 ? '+' : ''}{asset.change24h.toFixed(1)}%
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </ScrollArea>
    </div>
  );
};

export default Heatmap;
