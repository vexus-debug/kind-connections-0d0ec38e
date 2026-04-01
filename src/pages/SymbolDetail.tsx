import { useParams, useNavigate } from 'react-router-dom';
import { useSharedScanner } from '@/contexts/ScannerContext';
import { useSharedPatternScanner } from '@/contexts/PatternScannerContext';
import { useSharedRangeScanner } from '@/contexts/RangeScannerContext';
import { getSector, getSectorColor, getSectorEmoji } from '@/lib/sectors';
import { TIMEFRAME_LABELS, ALL_TIMEFRAMES, type Timeframe } from '@/types/scanner';
import { fetchFundingRates, formatFundingRate, getFundingRateColor } from '@/lib/funding-rates';
import { useEffect, useState } from 'react';
import { ArrowLeft, TrendingUp, TrendingDown, Minus, Activity, Layers, ChartCandlestick, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useIsMobile } from '@/hooks/use-mobile';

const SymbolDetail = () => {
  const { symbol } = useParams<{ symbol: string }>();
  const navigate = useNavigate();
  const { assets, alerts } = useSharedScanner();
  const { candlestickPatterns, chartPatterns, structurePatterns } = useSharedPatternScanner();
  const patterns = [...candlestickPatterns, ...chartPatterns, ...structurePatterns];
  const { assets: rangeAssets } = useSharedRangeScanner();
  const isMobile = useIsMobile();
  const [fundingRate, setFundingRate] = useState<number | null>(null);

  const asset = assets.find(a => a.symbol === symbol);
  const symbolAlerts = alerts.filter(a => a.symbol === symbol);
  const symbolPatterns = patterns.filter(p => p.symbol === symbol || p.symbol === symbol?.replace('USDT', ''));
  const rangeAsset = rangeAssets.find(a => a.symbol === symbol);
  const sector = symbol ? getSector(symbol) : 'Other';

  useEffect(() => {
    if (!symbol) return;
    fetchFundingRates([symbol]).then(rates => {
      if (rates.length > 0) setFundingRate(rates[0].fundingRate);
    });
  }, [symbol]);

  if (!symbol || !asset) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <div className="text-center">
          <p className="text-sm">Symbol not found</p>
          <Button variant="ghost" size="sm" className="mt-2" onClick={() => navigate('/')}>
            <ArrowLeft className="mr-1 h-3 w-3" /> Back to Scanner
          </Button>
        </div>
      </div>
    );
  }

  const dirIcon = (dir: string | null) => {
    if (dir === 'bull') return <TrendingUp className="h-3.5 w-3.5 text-[hsl(var(--trend-bull))]" />;
    if (dir === 'bear') return <TrendingDown className="h-3.5 w-3.5 text-[hsl(var(--trend-bear))]" />;
    return <Minus className="h-3.5 w-3.5 text-muted-foreground" />;
  };

  return (
    <div className="flex h-full flex-col overflow-auto bg-background">
      {/* Header */}
      <header className="flex items-center gap-2 border-b border-border px-3 py-2">
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => navigate(-1)}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex items-center gap-2">
          <h1 className="text-sm font-bold text-foreground">{symbol}</h1>
          <span className="rounded bg-secondary px-1.5 py-0.5 text-[10px]" style={{ color: getSectorColor(sector) }}>
            {getSectorEmoji(sector)} {sector}
          </span>
        </div>
        <div className="ml-auto flex items-center gap-3 text-xs">
          <span className="font-mono text-foreground">${asset.price.toLocaleString()}</span>
          <span className={asset.change24h >= 0 ? 'text-[hsl(var(--trend-bull))]' : 'text-[hsl(var(--trend-bear))]'}>
            {asset.change24h >= 0 ? '+' : ''}{asset.change24h.toFixed(2)}%
          </span>
          {fundingRate !== null && (
            <span className="text-[10px]" style={{ color: getFundingRateColor(fundingRate) }}>
              FR: {formatFundingRate(fundingRate)}
            </span>
          )}
        </div>
      </header>

      <div className={`flex-1 overflow-auto p-3 ${isMobile ? 'space-y-3' : 'grid grid-cols-2 gap-3'}`}>
        {/* Trend Signals */}
        <section className="rounded border border-border bg-card p-3">
          <h2 className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-foreground">
            <Activity className="h-3.5 w-3.5 text-primary" /> Trend Signals
          </h2>
          <div className="space-y-1">
            {ALL_TIMEFRAMES.map(tf => {
              const sig = asset.signals[tf];
              return (
                <div key={tf} className="flex items-center justify-between rounded bg-secondary/50 px-2 py-1.5 text-[11px]">
                  <span className="font-mono text-muted-foreground w-8">{TIMEFRAME_LABELS[tf]}</span>
                  {sig ? (
                    <>
                      <span className="flex items-center gap-1">
                        {dirIcon(sig.direction)}
                        <span className={sig.direction === 'bull' ? 'text-[hsl(var(--trend-bull))]' : sig.direction === 'bear' ? 'text-[hsl(var(--trend-bear))]' : 'text-muted-foreground'}>
                          {sig.strength}
                        </span>
                      </span>
                      <span className="font-mono text-muted-foreground">ADX {sig.adx.toFixed(0)}</span>
                      <span className="font-mono text-muted-foreground">Score {sig.score}</span>
                    </>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        {/* Patterns */}
        <section className="rounded border border-border bg-card p-3">
          <h2 className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-foreground">
            <ChartCandlestick className="h-3.5 w-3.5 text-primary" /> Detected Patterns
          </h2>
          {symbolPatterns.length === 0 ? (
            <p className="text-[11px] text-muted-foreground">No patterns detected</p>
          ) : (
            <div className="space-y-1 max-h-48 overflow-auto">
              {symbolPatterns.slice(0, 20).map((p, i) => (
                <div key={i} className="flex items-center justify-between rounded bg-secondary/50 px-2 py-1.5 text-[11px]">
                  <span className="flex items-center gap-1">
                    {dirIcon(p.pattern.type === 'bullish' ? 'bull' : p.pattern.type === 'bearish' ? 'bear' : null)}
                    <span className="text-foreground">{p.pattern.name}</span>
                  </span>
                  <span className="font-mono text-muted-foreground">{TIMEFRAME_LABELS[p.timeframe as Timeframe] || p.timeframe}</span>
                  <span className={`text-[10px] ${p.pattern.significance === 'high' ? 'text-primary' : 'text-muted-foreground'}`}>
                    {p.pattern.significance}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Range Analysis */}
        <section className="rounded border border-border bg-card p-3">
          <h2 className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-foreground">
            <Layers className="h-3.5 w-3.5 text-accent" /> Range Analysis
          </h2>
          {rangeAsset ? (
            <div className="space-y-1">
              {ALL_TIMEFRAMES.map(tf => {
                const sig = rangeAsset.signals[tf];
                if (!sig || !sig.isRanging) return null;
                return (
                  <div key={tf} className="flex items-center justify-between rounded bg-secondary/50 px-2 py-1.5 text-[11px]">
                    <span className="font-mono text-muted-foreground w-8">{TIMEFRAME_LABELS[tf]}</span>
                    <span className="text-accent">{sig.strength} range</span>
                    <span className="font-mono text-muted-foreground">Width {sig.primaryRange.width.toFixed(1)}%</span>
                    <span className="font-mono text-muted-foreground">Pos {sig.positionInRange.toFixed(0)}%</span>
                  </div>
                );
              })}
              {!ALL_TIMEFRAMES.some(tf => rangeAsset.signals[tf]?.isRanging) && (
                <p className="text-[11px] text-muted-foreground">Not ranging on any timeframe</p>
              )}
            </div>
          ) : (
            <p className="text-[11px] text-muted-foreground">No range data available</p>
          )}
        </section>

        {/* Recent Alerts */}
        <section className="rounded border border-border bg-card p-3">
          <h2 className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-foreground">
            <Zap className="h-3.5 w-3.5 text-[hsl(var(--confluence-hot))]" /> Recent Alerts
          </h2>
          {symbolAlerts.length === 0 ? (
            <p className="text-[11px] text-muted-foreground">No recent alerts</p>
          ) : (
            <div className="space-y-1 max-h-48 overflow-auto">
              {symbolAlerts.slice(0, 15).map(a => (
                <div key={a.id} className="flex items-center justify-between rounded bg-secondary/50 px-2 py-1.5 text-[11px]">
                  <span className="flex items-center gap-1">
                    {dirIcon(a.direction)}
                    <span className="text-foreground">{a.strength}</span>
                  </span>
                  <span className="font-mono text-muted-foreground">{TIMEFRAME_LABELS[a.timeframe]}</span>
                  <span className="font-mono text-muted-foreground">${a.price.toFixed(2)}</span>
                  <span className="text-[10px] text-muted-foreground">
                    {new Date(a.timestamp).toLocaleTimeString('en-US', { hour12: false })}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
};

export default SymbolDetail;
