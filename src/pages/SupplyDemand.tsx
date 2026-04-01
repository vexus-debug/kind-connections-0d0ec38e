import { useMemo, useState } from 'react';
import { useSharedScanner } from '@/contexts/ScannerContext';
import { getSector, getSectorEmoji } from '@/lib/sectors';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Input } from '@/components/ui/input';
import { Search, Layers } from 'lucide-react';
import type { ConfirmedTrend } from '@/lib/indicators';
import { ALL_TIMEFRAMES, TIMEFRAME_LABELS, type Timeframe, type AssetTrend } from '@/types/scanner';

interface Zone {
  type: 'supply' | 'demand';
  high: number;
  low: number;
  strength: number;
  timeframe: Timeframe;
}

function detectZones(asset: AssetTrend): Zone[] {
  const zones: Zone[] = [];
  const price = asset.price;

  for (const tf of ALL_TIMEFRAMES) {
    const sig = asset.signals[tf] as ConfirmedTrend | undefined;
    if (!sig) continue;
    const { ema9, ema21, ema50, ema200, atr } = sig as any;
    if (!ema9 || !ema21) continue;
    const atrVal = atr || price * 0.015;

    const emas = [
      { val: ema200, weight: 3 },
      { val: ema50, weight: 2 },
      { val: ema21, weight: 1 },
    ];

    for (const { val, weight } of emas) {
      if (!val) continue;
      const dist = ((price - val) / price) * 100;
      if (dist > 0 && dist < 5) {
        zones.push({ type: 'demand', high: val + atrVal * 0.3, low: val - atrVal * 0.3, strength: Math.min(3, weight), timeframe: tf });
      }
      if (dist < 0 && dist > -5) {
        zones.push({ type: 'supply', high: val + atrVal * 0.3, low: val - atrVal * 0.3, strength: Math.min(3, weight), timeframe: tf });
      }
    }
  }

  const unique: Zone[] = [];
  for (const z of zones) {
    const overlap = unique.find(u => u.type === z.type && u.timeframe === z.timeframe && Math.abs(u.low - z.low) / z.low < 0.02);
    if (overlap) {
      overlap.strength = Math.min(3, overlap.strength + 1);
    } else {
      unique.push({ ...z });
    }
  }
  return unique.sort((a, b) => b.strength - a.strength);
}

function fmt(v: number) {
  return v < 1 ? v.toPrecision(4) : v.toFixed(2);
}

function ZoneBar({ zones, price }: { zones: Zone[]; price: number }) {
  if (zones.length === 0) return <div className="text-[10px] text-muted-foreground py-2">No zones</div>;
  const allPrices = [price, ...zones.flatMap(z => [z.high, z.low])];
  const min = Math.min(...allPrices) * 0.995;
  const max = Math.max(...allPrices) * 1.005;
  const range = max - min;
  const pricePos = range > 0 ? ((price - min) / range) * 100 : 50;

  return (
    <div className="relative h-6 rounded bg-secondary/50 overflow-hidden">
      {zones.map((z, i) => {
        const left = range > 0 ? ((z.low - min) / range) * 100 : 0;
        const width = range > 0 ? ((z.high - z.low) / range) * 100 : 10;
        const opacity = z.strength === 3 ? 0.5 : z.strength === 2 ? 0.35 : 0.2;
        return (
          <div key={i} className="absolute top-0 h-full rounded" style={{
            left: `${Math.max(0, left)}%`,
            width: `${Math.min(100 - left, width)}%`,
            backgroundColor: z.type === 'demand' ? `hsl(var(--trend-bull) / ${opacity})` : `hsl(var(--trend-bear) / ${opacity})`,
            borderLeft: `2px solid ${z.type === 'demand' ? 'hsl(var(--trend-bull))' : 'hsl(var(--trend-bear))'}`,
          }} />
        );
      })}
      <div className="absolute top-0 h-full w-0.5 bg-foreground z-10" style={{ left: `${pricePos}%` }} />
    </div>
  );
}

function ZoneList({ zones }: { zones: Zone[] }) {
  return (
    <div className="space-y-1 mt-1">
      {zones.map((z, i) => (
        <div key={i} className="flex items-center gap-2 text-[10px]">
          <span className={`rounded px-1.5 py-0.5 font-bold text-[9px] ${z.type === 'demand' ? 'bg-primary/15 trend-bull' : 'bg-destructive/15 trend-bear'}`}>
            {z.type === 'demand' ? 'DEMAND' : 'SUPPLY'}
          </span>
          <span className="tabular-nums text-foreground">${fmt(z.low)} — ${fmt(z.high)}</span>
          <span className="ml-auto flex gap-0.5">
            {Array.from({ length: z.strength }).map((_, j) => (
              <span key={j} className={`h-1.5 w-1.5 rounded-full ${z.type === 'demand' ? 'bg-primary' : 'bg-destructive'}`} />
            ))}
          </span>
        </div>
      ))}
    </div>
  );
}

/** Detail view: one symbol, zones grouped by timeframe */
function SymbolDetail({ asset, zones, onBack }: { asset: AssetTrend; zones: Zone[]; onBack: () => void }) {
  const byTf = ALL_TIMEFRAMES.map(tf => ({ tf, zones: zones.filter(z => z.timeframe === tf) })).filter(g => g.zones.length > 0);

  return (
    <div className="flex flex-col h-full">
      <button onClick={onBack} className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground px-4 py-2 self-start">
        ← Back
      </button>
      <div className="px-4 pb-2 border-b border-border">
        <div className="flex items-center gap-2">
          <span className="text-sm font-bold">{asset.symbol.replace('USDT', '')}</span>
          <span className="text-[9px]">{getSectorEmoji(getSector(asset.symbol))}</span>
          <span className={`text-xs tabular-nums font-medium ${asset.change24h >= 0 ? 'text-primary' : 'text-destructive'}`}>
            {asset.change24h >= 0 ? '+' : ''}{asset.change24h.toFixed(2)}%
          </span>
          <span className="ml-auto text-xs tabular-nums text-muted-foreground">${fmt(asset.price)}</span>
        </div>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-3 space-y-3">
          {byTf.map(({ tf, zones: tfZones }) => (
            <div key={tf} className="rounded-lg border border-border p-3">
              <div className="text-[11px] font-bold text-accent mb-2">{TIMEFRAME_LABELS[tf]}</div>
              <ZoneBar zones={tfZones} price={asset.price} />
              <ZoneList zones={tfZones} />
            </div>
          ))}
          {byTf.length === 0 && (
            <div className="text-center text-xs text-muted-foreground py-8">No zones detected for this symbol</div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

const SupplyDemand = () => {
  const { assets } = useSharedScanner();
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<string | null>(null);

  const allRows = useMemo(() => {
    return assets.map(asset => ({ asset, zones: detectZones(asset) })).filter(r => r.zones.length > 0)
      .sort((a, b) => Math.max(...b.zones.map(z => z.strength)) - Math.max(...a.zones.map(z => z.strength)));
  }, [assets]);

  const filtered = useMemo(() => {
    if (!search) return allRows;
    return allRows.filter(r => r.asset.symbol.toLowerCase().includes(search.toLowerCase()));
  }, [allRows, search]);

  const selectedRow = selected ? allRows.find(r => r.asset.symbol === selected) : null;

  if (selectedRow) {
    return (
      <div className="flex h-full flex-col overflow-hidden bg-background">
        <header className="border-b border-border px-4 py-2">
          <h1 className="text-sm font-bold uppercase tracking-[0.15em] text-foreground flex items-center gap-2">
            <Layers className="h-4 w-4 text-accent" />
            SUPPLY & DEMAND
          </h1>
        </header>
        <SymbolDetail asset={selectedRow.asset} zones={selectedRow.zones} onBack={() => setSelected(null)} />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background">
      <header className="border-b border-border px-4 py-2">
        <h1 className="text-sm font-bold uppercase tracking-[0.15em] text-foreground flex items-center gap-2">
          <Layers className="h-4 w-4 text-accent" />
          SUPPLY & DEMAND
        </h1>
        <p className="text-[10px] text-muted-foreground">Tap a symbol to see zones by timeframe</p>
      </header>

      <div className="border-b border-border px-4 py-2">
        <div className="relative max-w-[240px]">
          <Search className="absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
          <Input className="h-7 bg-secondary pl-7 text-xs" placeholder="Search symbol…" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-3 space-y-1">
          {filtered.map(({ asset, zones }) => {
            const demandCount = zones.filter(z => z.type === 'demand').length;
            const supplyCount = zones.filter(z => z.type === 'supply').length;
            const tfs = [...new Set(zones.map(z => z.timeframe))];

            return (
              <button
                key={asset.symbol}
                onClick={() => setSelected(asset.symbol)}
                className="w-full rounded-lg border border-border p-3 text-left hover:bg-secondary/50 transition-colors"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-bold">{asset.symbol.replace('USDT', '')}</span>
                    <span className="text-[8px]">{getSectorEmoji(getSector(asset.symbol))}</span>
                    <span className={`text-[10px] tabular-nums font-medium ${asset.change24h >= 0 ? 'text-primary' : 'text-destructive'}`}>
                      {asset.change24h >= 0 ? '+' : ''}{asset.change24h.toFixed(2)}%
                    </span>
                  </div>
                  <span className="text-[10px] tabular-nums text-muted-foreground">${fmt(asset.price)}</span>
                </div>
                <div className="flex items-center gap-2 mt-1.5">
                  {demandCount > 0 && <span className="text-[9px] text-primary font-medium">🟢 {demandCount} demand</span>}
                  {supplyCount > 0 && <span className="text-[9px] text-destructive font-medium">🔴 {supplyCount} supply</span>}
                  <span className="ml-auto text-[9px] text-muted-foreground">{tfs.map(t => TIMEFRAME_LABELS[t]).join(', ')}</span>
                </div>
              </button>
            );
          })}
          {filtered.length === 0 && (
            <div className="px-4 py-12 text-center text-xs text-muted-foreground">
              {assets.length === 0 ? 'Waiting for scan data…' : 'No zones detected'}
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
};

export default SupplyDemand;
