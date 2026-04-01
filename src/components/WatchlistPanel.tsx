import type { AssetTrend, WatchlistItem, Timeframe } from '@/types/scanner';
import { TIMEFRAME_LABELS } from '@/types/scanner';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { X, Bell, BellOff } from 'lucide-react';

interface WatchlistPanelProps {
  watchlist: WatchlistItem[];
  assets: AssetTrend[];
  onRemove: (symbol: string) => void;
  onToggleAlerts: (symbol: string) => void;
}

export function WatchlistPanel({ watchlist, assets, onRemove, onToggleAlerts }: WatchlistPanelProps) {
  const assetMap = new Map(assets.map((a) => [a.symbol, a]));

  return (
    <div className="flex h-full flex-col md:border-l border-border">
      <div className="border-b border-border px-3 py-2">
        <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          Watchlist
          {watchlist.length > 0 && (
            <span className="ml-2 text-foreground">{watchlist.length}</span>
          )}
        </h2>
      </div>

      <ScrollArea className="flex-1">
        {watchlist.length === 0 ? (
          <p className="px-3 py-8 text-center text-xs text-muted-foreground">
            Click ★ on any asset to watch it
          </p>
        ) : (
          <div className="space-y-1 p-2 md:space-y-0.5 md:p-1">
            {watchlist.map((item) => {
              const asset = assetMap.get(item.symbol);
              return (
                <WatchlistRow
                  key={item.symbol}
                  item={item}
                  asset={asset}
                  onRemove={() => onRemove(item.symbol)}
                  onToggleAlerts={() => onToggleAlerts(item.symbol)}
                />
              );
            })}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}

function WatchlistRow({
  item,
  asset,
  onRemove,
  onToggleAlerts,
}: {
  item: WatchlistItem;
  asset?: AssetTrend;
  onRemove: () => void;
  onToggleAlerts: () => void;
}) {
  const signals = asset?.signals || {};
  const bestSignal = Object.entries(signals).reduce<{
    tf: Timeframe | null;
    score: number;
  }>(
    (best, [tf, sig]) => {
      if (sig && Math.abs(sig.score) > Math.abs(best.score)) {
        return { tf: tf as Timeframe, score: sig.score };
      }
      return best;
    },
    { tf: null, score: 0 }
  );

  return (
    <div className="rounded-sm bg-secondary/30 p-2.5 md:p-2 text-xs md:text-[10px]">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <span className="font-semibold text-sm md:text-xs">{item.symbol.replace('USDT', '')}</span>
          {asset && (
            <span className={`tabular-nums ${asset.change24h >= 0 ? 'text-trend-bull' : 'text-trend-bear'}`}>
              {asset.change24h >= 0 ? '+' : ''}{asset.change24h.toFixed(2)}%
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 md:h-5 md:w-5"
            onClick={onToggleAlerts}
            title={item.alertsEnabled ? 'Disable alerts' : 'Enable alerts'}
          >
            {item.alertsEnabled ? <Bell className="h-3.5 w-3.5 md:h-2.5 md:w-2.5 text-accent" /> : <BellOff className="h-3.5 w-3.5 md:h-2.5 md:w-2.5 text-muted-foreground" />}
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7 md:h-5 md:w-5" onClick={onRemove}>
            <X className="h-3.5 w-3.5 md:h-2.5 md:w-2.5 text-muted-foreground" />
          </Button>
        </div>
      </div>

      {asset && (
        <div className="mt-1.5 space-y-1">
          <div className="flex items-center justify-between text-muted-foreground">
            <span>Price</span>
            <span className="tabular-nums text-foreground">
              ${asset.price < 1 ? asset.price.toPrecision(4) : asset.price.toFixed(2)}
            </span>
          </div>

          <div className="flex gap-1 flex-wrap">
            {Object.entries(signals).map(([tf, sig]) => {
              if (!sig?.direction) return null;
              const isBull = sig.direction === 'bull';
              return (
                <div
                  key={tf}
                  className={`flex flex-col items-center rounded px-1.5 py-0.5 ${
                    isBull ? 'bg-trend-bull/10' : 'bg-trend-bear/10'
                  }`}
                >
                  <span className="text-muted-foreground">{TIMEFRAME_LABELS[tf as Timeframe]}</span>
                  <span className={isBull ? 'text-trend-bull' : 'text-trend-bear'}>
                    {isBull ? '↑' : '↓'}
                  </span>
                </div>
              );
            })}
          </div>

          {bestSignal.tf && signals[bestSignal.tf] && (
            <div className="mt-1 rounded bg-muted/50 px-1.5 py-1 text-muted-foreground">
              <div className="flex justify-between">
                <span>ADX</span>
                <span className="text-foreground">{signals[bestSignal.tf]!.adx.toFixed(1)}</span>
              </div>
              <div className="flex justify-between">
                <span>Vol Ratio</span>
                <span className="text-foreground">{signals[bestSignal.tf]!.volumeRatio.toFixed(2)}x</span>
              </div>
              <div className="flex justify-between">
                <span>Score</span>
                <span className={bestSignal.score > 0 ? 'text-trend-bull' : 'text-trend-bear'}>
                  {bestSignal.score > 0 ? '+' : ''}{bestSignal.score}
                </span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
