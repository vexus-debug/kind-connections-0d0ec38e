import { useState, useMemo, useEffect } from 'react';
import { useSharedScanner } from '@/contexts/ScannerContext';
import { getSector, getSectorColor, getSectorEmoji, ALL_SECTORS, type CryptoSector } from '@/lib/sectors';
import { fetchFundingRates, formatFundingRate, getFundingRateColor, type FundingRate } from '@/lib/funding-rates';
import { ScrollArea } from '@/components/ui/scroll-area';
import { TrendingUp, TrendingDown, Gauge, DollarSign, Activity, BarChart3, Flame, Snowflake } from 'lucide-react';

const MarketOverview = () => {
  const { assets } = useSharedScanner();
  const [fundingRates, setFundingRates] = useState<FundingRate[]>([]);
  const [loadingFunding, setLoadingFunding] = useState(false);

  // Fetch funding rates
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoadingFunding(true);
      const rates = await fetchFundingRates();
      if (!cancelled) {
        setFundingRates(rates);
        setLoadingFunding(false);
      }
    };
    load();
    const interval = setInterval(load, 60_000);
    return () => { cancelled = true; clearInterval(interval); };
  }, []);

  // Market stats
  const stats = useMemo(() => {
    if (assets.length === 0) return null;

    const gainers = [...assets].sort((a, b) => b.change24h - a.change24h);
    const losers = [...assets].sort((a, b) => a.change24h - b.change24h);
    const byVolume = [...assets].sort((a, b) => b.volume24h - a.volume24h);

    const bullish = assets.filter(a => a.change24h > 0).length;
    const bearish = assets.filter(a => a.change24h < 0).length;
    const avgChange = assets.reduce((s, a) => s + a.change24h, 0) / assets.length;

    // Sector performance
    const sectorPerf: Record<string, { total: number; count: number; assets: typeof assets }> = {};
    for (const asset of assets) {
      const sector = getSector(asset.symbol);
      if (!sectorPerf[sector]) sectorPerf[sector] = { total: 0, count: 0, assets: [] };
      sectorPerf[sector].total += asset.change24h;
      sectorPerf[sector].count++;
      sectorPerf[sector].assets.push(asset);
    }

    const sectors = Object.entries(sectorPerf)
      .map(([sector, data]) => ({
        sector: sector as CryptoSector,
        avgChange: data.total / data.count,
        count: data.count,
        assets: data.assets,
      }))
      .sort((a, b) => b.avgChange - a.avgChange);

    return { gainers, losers, byVolume, bullish, bearish, avgChange, sectors };
  }, [assets]);

  // Top funding rates
  const topFunding = useMemo(() => {
    const positive = fundingRates.filter(f => f.fundingRate > 0).slice(0, 8);
    const negative = fundingRates.filter(f => f.fundingRate < 0).sort((a, b) => a.fundingRate - b.fundingRate).slice(0, 8);
    return { positive, negative };
  }, [fundingRates]);

  if (!stats) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
        Waiting for scan data…
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background">
      <header className="flex items-center justify-between border-b border-border px-4 py-2">
        <div>
          <h1 className="text-sm font-bold uppercase tracking-[0.15em] text-foreground flex items-center gap-2">
            <Activity className="h-4 w-4 text-accent" />
            MARKET OVERVIEW
          </h1>
          <p className="text-[10px] text-muted-foreground">Sentiment, sectors, funding & movers</p>
        </div>
      </header>

      <ScrollArea className="flex-1">
        <div className="p-4 space-y-5 max-w-4xl mx-auto">

          {/* Market Sentiment Bar */}
          <div className="rounded-lg border border-border p-4">
            <h3 className="text-xs font-bold uppercase text-muted-foreground mb-3 flex items-center gap-1.5">
              <Gauge className="h-3.5 w-3.5 text-accent" />
              Market Sentiment
            </h3>
            <div className="flex items-center gap-3 mb-2">
              <div className="flex-1">
                <div className="h-4 rounded-full overflow-hidden flex">
                  <div className="bg-primary/80 transition-all" style={{ width: `${(stats.bullish / assets.length) * 100}%` }} />
                  <div className="bg-destructive/80 transition-all" style={{ width: `${(stats.bearish / assets.length) * 100}%` }} />
                </div>
              </div>
            </div>
            <div className="flex items-center justify-between text-[10px]">
              <span className="trend-bull font-bold flex items-center gap-1"><TrendingUp className="h-3 w-3" />{stats.bullish} Bullish ({((stats.bullish / assets.length) * 100).toFixed(0)}%)</span>
              <span className={`font-bold ${stats.avgChange >= 0 ? 'trend-bull' : 'trend-bear'}`}>
                Avg: {stats.avgChange >= 0 ? '+' : ''}{stats.avgChange.toFixed(2)}%
              </span>
              <span className="trend-bear font-bold flex items-center gap-1"><TrendingDown className="h-3 w-3" />{stats.bearish} Bearish ({((stats.bearish / assets.length) * 100).toFixed(0)}%)</span>
            </div>
          </div>

          {/* Top Movers */}
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-lg border border-primary/20 p-3">
              <h3 className="text-[10px] font-bold uppercase text-primary mb-2 flex items-center gap-1">
                <Flame className="h-3 w-3" /> Top Gainers
              </h3>
              <div className="space-y-1">
                {stats.gainers.slice(0, 8).map((a, i) => (
                  <div key={a.symbol} className="flex items-center justify-between text-[10px]">
                    <div className="flex items-center gap-1.5">
                      <span className="text-muted-foreground w-3">{i + 1}</span>
                      <span className="font-bold">{a.symbol.replace('USDT', '')}</span>
                      <span className="text-[8px]">{getSectorEmoji(getSector(a.symbol))}</span>
                    </div>
                    <span className="trend-bull font-bold tabular-nums">+{a.change24h.toFixed(2)}%</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-lg border border-destructive/20 p-3">
              <h3 className="text-[10px] font-bold uppercase text-destructive mb-2 flex items-center gap-1">
                <Snowflake className="h-3 w-3" /> Top Losers
              </h3>
              <div className="space-y-1">
                {stats.losers.slice(0, 8).map((a, i) => (
                  <div key={a.symbol} className="flex items-center justify-between text-[10px]">
                    <div className="flex items-center gap-1.5">
                      <span className="text-muted-foreground w-3">{i + 1}</span>
                      <span className="font-bold">{a.symbol.replace('USDT', '')}</span>
                      <span className="text-[8px]">{getSectorEmoji(getSector(a.symbol))}</span>
                    </div>
                    <span className="trend-bear font-bold tabular-nums">{a.change24h.toFixed(2)}%</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Sector Performance */}
          <div className="rounded-lg border border-border p-4">
            <h3 className="text-xs font-bold uppercase text-muted-foreground mb-3 flex items-center gap-1.5">
              <BarChart3 className="h-3.5 w-3.5 text-accent" />
              Sector Performance
            </h3>
            <div className="space-y-2">
              {stats.sectors.filter(s => s.count >= 2).map(s => (
                <div key={s.sector} className="flex items-center gap-2">
                  <span className="text-[10px] w-24 flex items-center gap-1">
                    <span>{getSectorEmoji(s.sector)}</span>
                    <span className="font-medium">{s.sector}</span>
                    <span className="text-muted-foreground">({s.count})</span>
                  </span>
                  <div className="flex-1 h-3 rounded-full bg-secondary overflow-hidden relative">
                    {s.avgChange >= 0 ? (
                      <div className="h-full bg-primary/60 rounded-full transition-all" style={{ width: `${Math.min(100, s.avgChange * 10)}%` }} />
                    ) : (
                      <div className="h-full bg-destructive/60 rounded-full transition-all ml-auto" style={{ width: `${Math.min(100, Math.abs(s.avgChange) * 10)}%` }} />
                    )}
                  </div>
                  <span className={`text-[10px] font-bold tabular-nums w-16 text-right ${s.avgChange >= 0 ? 'trend-bull' : 'trend-bear'}`}>
                    {s.avgChange >= 0 ? '+' : ''}{s.avgChange.toFixed(2)}%
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Funding Rates */}
          <div className="rounded-lg border border-border p-4">
            <h3 className="text-xs font-bold uppercase text-muted-foreground mb-3 flex items-center gap-1.5">
              <DollarSign className="h-3.5 w-3.5 text-accent" />
              Funding Rates
              {loadingFunding && <span className="h-1.5 w-1.5 rounded-full bg-accent animate-pulse-dot" />}
            </h3>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="text-[9px] uppercase text-primary font-bold mb-1.5">Highest (Longs Pay)</div>
                <div className="space-y-1">
                  {topFunding.positive.map(f => (
                    <div key={f.symbol} className="flex items-center justify-between text-[10px]">
                      <span className="font-medium">{f.symbol.replace('USDT', '')}</span>
                      <span className="font-bold tabular-nums" style={{ color: getFundingRateColor(f.fundingRate) }}>
                        {formatFundingRate(f.fundingRate)}
                      </span>
                    </div>
                  ))}
                  {topFunding.positive.length === 0 && <span className="text-[10px] text-muted-foreground">Loading…</span>}
                </div>
              </div>
              <div>
                <div className="text-[9px] uppercase text-destructive font-bold mb-1.5">Lowest (Shorts Pay)</div>
                <div className="space-y-1">
                  {topFunding.negative.map(f => (
                    <div key={f.symbol} className="flex items-center justify-between text-[10px]">
                      <span className="font-medium">{f.symbol.replace('USDT', '')}</span>
                      <span className="font-bold tabular-nums" style={{ color: getFundingRateColor(f.fundingRate) }}>
                        {formatFundingRate(f.fundingRate)}
                      </span>
                    </div>
                  ))}
                  {topFunding.negative.length === 0 && <span className="text-[10px] text-muted-foreground">Loading…</span>}
                </div>
              </div>
            </div>
          </div>

          {/* Volume Leaders */}
          <div className="rounded-lg border border-border p-4">
            <h3 className="text-xs font-bold uppercase text-muted-foreground mb-3 flex items-center gap-1.5">
              <BarChart3 className="h-3.5 w-3.5 text-accent" />
              Volume Leaders (24h)
            </h3>
            <div className="space-y-1">
              {stats.byVolume.slice(0, 10).map((a, i) => (
                <div key={a.symbol} className="flex items-center gap-2 text-[10px]">
                  <span className="text-muted-foreground w-4 text-right">{i + 1}</span>
                  <span className="font-bold w-16">{a.symbol.replace('USDT', '')}</span>
                  <div className="flex-1 h-2 rounded-full bg-secondary overflow-hidden">
                    <div className="h-full bg-accent/40 rounded-full" style={{ width: `${(a.volume24h / stats.byVolume[0].volume24h) * 100}%` }} />
                  </div>
                  <span className="tabular-nums text-muted-foreground w-20 text-right">
                    {a.volume24h > 1e9 ? `${(a.volume24h / 1e9).toFixed(1)}B` : a.volume24h > 1e6 ? `${(a.volume24h / 1e6).toFixed(1)}M` : `${(a.volume24h / 1e3).toFixed(0)}K`}
                  </span>
                  <span className={`tabular-nums font-bold w-16 text-right ${a.change24h >= 0 ? 'trend-bull' : 'trend-bear'}`}>
                    {a.change24h >= 0 ? '+' : ''}{a.change24h.toFixed(1)}%
                  </span>
                </div>
              ))}
            </div>
          </div>

        </div>
      </ScrollArea>
    </div>
  );
};

export default MarketOverview;
