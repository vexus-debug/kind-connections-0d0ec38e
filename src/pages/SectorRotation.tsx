import { useMemo } from 'react';
import { useSharedScanner } from '@/contexts/ScannerContext';
import { getSector, getSectorColor, getSectorEmoji, ALL_SECTORS, type CryptoSector } from '@/lib/sectors';
import { useIsMobile } from '@/hooks/use-mobile';
import { useNavigate } from 'react-router-dom';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';

interface SectorData {
  sector: CryptoSector;
  avgChange: number;
  avgScore: number;
  bullCount: number;
  bearCount: number;
  totalCount: number;
  topPerformer: { symbol: string; change: number } | null;
  worstPerformer: { symbol: string; change: number } | null;
}

const SectorRotation = () => {
  const { assets } = useSharedScanner();
  const isMobile = useIsMobile();
  const navigate = useNavigate();

  const sectorData = useMemo((): SectorData[] => {
    const map = new Map<CryptoSector, typeof assets>();
    for (const a of assets) {
      const s = getSector(a.symbol);
      if (!map.has(s)) map.set(s, []);
      map.get(s)!.push(a);
    }

    return ALL_SECTORS.map(sector => {
      const items = map.get(sector) || [];
      if (items.length === 0) return {
        sector, avgChange: 0, avgScore: 0, bullCount: 0, bearCount: 0, totalCount: 0,
        topPerformer: null, worstPerformer: null,
      };

      const avgChange = items.reduce((s, a) => s + a.change24h, 0) / items.length;
      
      let bullCount = 0, bearCount = 0, totalScore = 0, scoreCount = 0;
      for (const a of items) {
        const sig = a.signals['60'] || a.signals['240'];
        if (sig) {
          if (sig.direction === 'bull') bullCount++;
          if (sig.direction === 'bear') bearCount++;
          totalScore += sig.score;
          scoreCount++;
        }
      }

      const sorted = [...items].sort((a, b) => b.change24h - a.change24h);
      return {
        sector,
        avgChange,
        avgScore: scoreCount > 0 ? totalScore / scoreCount : 0,
        bullCount,
        bearCount,
        totalCount: items.length,
        topPerformer: sorted[0] ? { symbol: sorted[0].symbol, change: sorted[0].change24h } : null,
        worstPerformer: sorted[sorted.length - 1] ? { symbol: sorted[sorted.length - 1].symbol, change: sorted[sorted.length - 1].change24h } : null,
      };
    }).filter(s => s.totalCount > 0).sort((a, b) => b.avgChange - a.avgChange);
  }, [assets]);

  const dirIcon = (change: number) => {
    if (change > 1) return <TrendingUp className="h-3.5 w-3.5 text-[hsl(var(--trend-bull))]" />;
    if (change < -1) return <TrendingDown className="h-3.5 w-3.5 text-[hsl(var(--trend-bear))]" />;
    return <Minus className="h-3.5 w-3.5 text-muted-foreground" />;
  };

  return (
    <div className="flex h-full flex-col bg-background">
      <header className="flex items-center justify-between border-b border-border px-3 py-2">
        <h1 className="text-xs font-bold uppercase tracking-[0.15em] text-primary">SECTOR ROTATION</h1>
        <span className="text-[10px] text-muted-foreground">{assets.length} assets tracked</span>
      </header>

      <div className="flex-1 overflow-auto p-3">
        {sectorData.length === 0 ? (
          <div className="flex h-full items-center justify-center text-muted-foreground text-sm">
            Run scanner first to populate sector data
          </div>
        ) : (
          <div className={isMobile ? 'space-y-2' : 'grid grid-cols-2 gap-2'}>
            {sectorData.map(s => (
              <div key={s.sector} className="rounded border border-border bg-card p-3">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span style={{ color: getSectorColor(s.sector) }} className="text-sm font-semibold">
                      {getSectorEmoji(s.sector)} {s.sector}
                    </span>
                    <span className="text-[10px] text-muted-foreground">{s.totalCount} assets</span>
                  </div>
                  <div className="flex items-center gap-1">
                    {dirIcon(s.avgChange)}
                    <span className={`text-xs font-mono ${s.avgChange >= 0 ? 'text-[hsl(var(--trend-bull))]' : 'text-[hsl(var(--trend-bear))]'}`}>
                      {s.avgChange >= 0 ? '+' : ''}{s.avgChange.toFixed(2)}%
                    </span>
                  </div>
                </div>

                {/* Strength bar */}
                <div className="mb-2 flex gap-0.5 h-1.5 rounded overflow-hidden bg-secondary">
                  {s.bullCount > 0 && (
                    <div className="bg-[hsl(var(--trend-bull))]" style={{ width: `${(s.bullCount / s.totalCount) * 100}%` }} />
                  )}
                  {s.bearCount > 0 && (
                    <div className="bg-[hsl(var(--trend-bear))]" style={{ width: `${(s.bearCount / s.totalCount) * 100}%` }} />
                  )}
                </div>

                <div className="flex justify-between text-[10px] text-muted-foreground">
                  <span>🟢 {s.bullCount} bull</span>
                  <span>🔴 {s.bearCount} bear</span>
                  <span>Score {s.avgScore.toFixed(0)}</span>
                </div>

                {(s.topPerformer || s.worstPerformer) && (
                  <div className="mt-2 flex justify-between text-[10px]">
                    {s.topPerformer && (
                      <span
                        className="text-[hsl(var(--trend-bull))] cursor-pointer hover:underline"
                        onClick={() => navigate(`/symbol/${s.topPerformer!.symbol}`)}
                      >
                        🏆 {s.topPerformer.symbol.replace('USDT', '')} +{s.topPerformer.change.toFixed(1)}%
                      </span>
                    )}
                    {s.worstPerformer && s.worstPerformer.change < 0 && (
                      <span
                        className="text-[hsl(var(--trend-bear))] cursor-pointer hover:underline"
                        onClick={() => navigate(`/symbol/${s.worstPerformer!.symbol}`)}
                      >
                        📉 {s.worstPerformer.symbol.replace('USDT', '')} {s.worstPerformer.change.toFixed(1)}%
                      </span>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default SectorRotation;
