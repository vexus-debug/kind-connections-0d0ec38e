import { useState, useMemo } from 'react';
import { useSharedScanner } from '@/contexts/ScannerContext';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Search, Target, Shield, DollarSign, TrendingUp, TrendingDown, Calculator, AlertTriangle } from 'lucide-react';

const TradePlanner = () => {
  const { assets } = useSharedScanner();

  const [search, setSearch] = useState('');
  const [selectedSymbol, setSelectedSymbol] = useState('');
  const [direction, setDirection] = useState<'long' | 'short'>('long');
  const [accountSize, setAccountSize] = useState(1000);
  const [riskPercent, setRiskPercent] = useState(1);
  const [entryPrice, setEntryPrice] = useState(0);
  const [stopLoss, setStopLoss] = useState(0);
  const [tp1Ratio, setTp1Ratio] = useState(1.5);
  const [tp2Ratio, setTp2Ratio] = useState(2.5);
  const [tp3Ratio, setTp3Ratio] = useState(4);
  const [leverage, setLeverage] = useState(1);

  const filteredAssets = useMemo(() => {
    if (!search) return assets.slice(0, 20);
    return assets.filter(a => a.symbol.toLowerCase().includes(search.toLowerCase())).slice(0, 20);
  }, [assets, search]);

  const selectSymbol = (symbol: string) => {
    setSelectedSymbol(symbol);
    const asset = assets.find(a => a.symbol === symbol);
    if (asset) {
      setEntryPrice(asset.price);
      // Auto-set SL based on ATR-like estimate (2% for now)
      const slDistance = asset.price * 0.02;
      setStopLoss(direction === 'long' ? asset.price - slDistance : asset.price + slDistance);
    }
    setSearch('');
  };

  // Calculations
  const riskAmount = accountSize * (riskPercent / 100);
  const slDistance = Math.abs(entryPrice - stopLoss);
  const slPercent = entryPrice > 0 ? (slDistance / entryPrice) * 100 : 0;
  const positionSize = slDistance > 0 ? riskAmount / slDistance : 0;
  const positionValue = positionSize * entryPrice;
  const effectivePosition = positionValue * leverage;
  const marginRequired = leverage > 1 ? effectivePosition / leverage : positionValue;

  const tp1Price = direction === 'long'
    ? entryPrice + slDistance * tp1Ratio
    : entryPrice - slDistance * tp1Ratio;
  const tp2Price = direction === 'long'
    ? entryPrice + slDistance * tp2Ratio
    : entryPrice - slDistance * tp2Ratio;
  const tp3Price = direction === 'long'
    ? entryPrice + slDistance * tp3Ratio
    : entryPrice - slDistance * tp3Ratio;

  const tp1Profit = positionSize * Math.abs(tp1Price - entryPrice);
  const tp2Profit = positionSize * Math.abs(tp2Price - entryPrice);
  const tp3Profit = positionSize * Math.abs(tp3Price - entryPrice);

  const tp1Pct = entryPrice > 0 ? (Math.abs(tp1Price - entryPrice) / entryPrice * 100) : 0;
  const tp2Pct = entryPrice > 0 ? (Math.abs(tp2Price - entryPrice) / entryPrice * 100) : 0;
  const tp3Pct = entryPrice > 0 ? (Math.abs(tp3Price - entryPrice) / entryPrice * 100) : 0;

  const liquidationPrice = leverage > 1
    ? direction === 'long'
      ? entryPrice * (1 - 1 / leverage)
      : entryPrice * (1 + 1 / leverage)
    : 0;

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background">
      <header className="flex items-center justify-between border-b border-border px-4 py-2">
        <div>
          <h1 className="text-sm font-bold uppercase tracking-[0.15em] text-foreground flex items-center gap-2">
            <Calculator className="h-4 w-4 text-accent" />
            TRADE PLANNER
          </h1>
          <p className="text-[10px] text-muted-foreground">Position sizing & risk management</p>
        </div>
      </header>

      <ScrollArea className="flex-1">
        <div className="p-4 space-y-4 max-w-2xl mx-auto">
          {/* Symbol Selection */}
          <div className="rounded-lg border border-border p-3 space-y-2">
            <Label className="text-[10px] uppercase tracking-widest text-muted-foreground">Select Symbol</Label>
            <div className="relative">
              <Search className="absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="h-8 bg-secondary pl-7 text-xs"
                placeholder="Search symbol..."
                value={search || selectedSymbol}
                onChange={e => { setSearch(e.target.value); setSelectedSymbol(''); }}
              />
            </div>
            {search && (
              <div className="flex flex-wrap gap-1">
                {filteredAssets.map(a => (
                  <button
                    key={a.symbol}
                    onClick={() => selectSymbol(a.symbol)}
                    className="rounded bg-secondary px-2 py-1 text-[10px] font-medium text-foreground hover:bg-accent/20 transition-colors"
                  >
                    {a.symbol.replace('USDT', '')} <span className="text-muted-foreground">${a.price < 1 ? a.price.toPrecision(4) : a.price.toFixed(2)}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Direction */}
          <div className="flex gap-2">
            <button
              onClick={() => setDirection('long')}
              className={`flex-1 rounded-lg border py-3 text-sm font-bold transition-all ${
                direction === 'long'
                  ? 'border-primary bg-primary/10 trend-bull'
                  : 'border-border text-muted-foreground hover:border-primary/30'
              }`}
            >
              <TrendingUp className="h-4 w-4 mx-auto mb-1" />
              LONG
            </button>
            <button
              onClick={() => setDirection('short')}
              className={`flex-1 rounded-lg border py-3 text-sm font-bold transition-all ${
                direction === 'short'
                  ? 'border-destructive bg-destructive/10 trend-bear'
                  : 'border-border text-muted-foreground hover:border-destructive/30'
              }`}
            >
              <TrendingDown className="h-4 w-4 mx-auto mb-1" />
              SHORT
            </button>
          </div>

          {/* Account & Risk */}
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-lg border border-border p-3 space-y-1.5">
              <Label className="text-[10px] uppercase tracking-widest text-muted-foreground">Account Size ($)</Label>
              <Input
                type="number"
                className="h-8 bg-secondary text-xs"
                value={accountSize}
                onChange={e => setAccountSize(parseFloat(e.target.value) || 0)}
              />
            </div>
            <div className="rounded-lg border border-border p-3 space-y-1.5">
              <Label className="text-[10px] uppercase tracking-widest text-muted-foreground">Risk %</Label>
              <Input
                type="number"
                step="0.5"
                className="h-8 bg-secondary text-xs"
                value={riskPercent}
                onChange={e => setRiskPercent(parseFloat(e.target.value) || 0)}
              />
              <div className="text-[9px] text-muted-foreground">Risk: ${riskAmount.toFixed(2)}</div>
            </div>
          </div>

          {/* Entry / SL / Leverage */}
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-lg border border-border p-3 space-y-1.5">
              <Label className="text-[10px] uppercase tracking-widest text-muted-foreground">Entry Price</Label>
              <Input
                type="number"
                step="any"
                className="h-8 bg-secondary text-xs"
                value={entryPrice || ''}
                onChange={e => setEntryPrice(parseFloat(e.target.value) || 0)}
              />
            </div>
            <div className="rounded-lg border border-border p-3 space-y-1.5">
              <Label className="text-[10px] uppercase tracking-widest text-destructive">Stop Loss</Label>
              <Input
                type="number"
                step="any"
                className="h-8 bg-secondary text-xs border-destructive/30"
                value={stopLoss || ''}
                onChange={e => setStopLoss(parseFloat(e.target.value) || 0)}
              />
              <div className="text-[9px] text-destructive tabular-nums">-{slPercent.toFixed(2)}%</div>
            </div>
            <div className="rounded-lg border border-border p-3 space-y-1.5">
              <Label className="text-[10px] uppercase tracking-widest text-muted-foreground">Leverage</Label>
              <Input
                type="number"
                className="h-8 bg-secondary text-xs"
                value={leverage}
                onChange={e => setLeverage(Math.max(1, parseInt(e.target.value) || 1))}
              />
            </div>
          </div>

          {/* TP Ratios */}
          <div className="rounded-lg border border-border p-3 space-y-2">
            <Label className="text-[10px] uppercase tracking-widest text-muted-foreground">Take Profit R:R Ratios</Label>
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1">
                <Label className="text-[9px] text-primary">TP1 Ratio</Label>
                <Input type="number" step="0.5" className="h-7 bg-secondary text-xs" value={tp1Ratio} onChange={e => setTp1Ratio(parseFloat(e.target.value) || 0)} />
              </div>
              <div className="space-y-1">
                <Label className="text-[9px] text-primary">TP2 Ratio</Label>
                <Input type="number" step="0.5" className="h-7 bg-secondary text-xs" value={tp2Ratio} onChange={e => setTp2Ratio(parseFloat(e.target.value) || 0)} />
              </div>
              <div className="space-y-1">
                <Label className="text-[9px] text-primary">TP3 Ratio</Label>
                <Input type="number" step="0.5" className="h-7 bg-secondary text-xs" value={tp3Ratio} onChange={e => setTp3Ratio(parseFloat(e.target.value) || 0)} />
              </div>
            </div>
          </div>

          {/* Results */}
          {entryPrice > 0 && stopLoss > 0 && (
            <div className="space-y-3">
              {/* Position Info */}
              <div className="rounded-lg border border-accent/30 bg-accent/5 p-4 space-y-3">
                <h3 className="text-xs font-bold uppercase text-accent flex items-center gap-1.5">
                  <DollarSign className="h-3.5 w-3.5" />
                  Position Summary
                </h3>
                <div className="grid grid-cols-2 gap-3 text-[11px]">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Position Size</span>
                    <span className="font-bold tabular-nums text-foreground">{positionSize.toFixed(4)} units</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Position Value</span>
                    <span className="font-bold tabular-nums text-foreground">${positionValue.toFixed(2)}</span>
                  </div>
                  {leverage > 1 && (
                    <>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Effective Size</span>
                        <span className="font-bold tabular-nums text-foreground">${effectivePosition.toFixed(2)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Margin Required</span>
                        <span className="font-bold tabular-nums text-foreground">${marginRequired.toFixed(2)}</span>
                      </div>
                    </>
                  )}
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Max Loss</span>
                    <span className="font-bold tabular-nums text-destructive">-${riskAmount.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">SL Distance</span>
                    <span className="font-bold tabular-nums text-destructive">-{slPercent.toFixed(2)}%</span>
                  </div>
                </div>
              </div>

              {/* Visual Entry/SL/TP Ladder */}
              <div className="rounded-lg border border-border p-4 space-y-2">
                <h3 className="text-xs font-bold uppercase text-foreground flex items-center gap-1.5">
                  <Target className="h-3.5 w-3.5 text-accent" />
                  Price Ladder
                </h3>
                <div className="space-y-1.5">
                  {/* TP3 */}
                  <PriceLevelBar label="TP3" price={tp3Price} pct={tp3Pct} profit={tp3Profit} ratio={tp3Ratio} color="primary" direction={direction} />
                  <PriceLevelBar label="TP2" price={tp2Price} pct={tp2Pct} profit={tp2Profit} ratio={tp2Ratio} color="primary" direction={direction} />
                  <PriceLevelBar label="TP1" price={tp1Price} pct={tp1Pct} profit={tp1Profit} ratio={tp1Ratio} color="primary" direction={direction} />
                  
                  {/* Entry */}
                  <div className="flex items-center gap-2 py-1.5 border-y border-accent/30">
                    <span className="text-[9px] font-bold text-accent w-8">ENTRY</span>
                    <div className="flex-1 h-1 bg-accent rounded-full" />
                    <span className="text-[11px] font-bold tabular-nums text-accent">${formatPrice(entryPrice)}</span>
                  </div>

                  {/* SL */}
                  <div className="flex items-center gap-2 py-1">
                    <span className="text-[9px] font-bold text-destructive w-8">SL</span>
                    <div className="flex-1">
                      <div className="h-2 rounded-full bg-destructive/20 overflow-hidden">
                        <div className="h-full bg-destructive rounded-full" style={{ width: `${Math.min(100, slPercent * 10)}%` }} />
                      </div>
                    </div>
                    <span className="text-[11px] font-bold tabular-nums text-destructive">${formatPrice(stopLoss)}</span>
                    <span className="text-[9px] text-destructive tabular-nums">-${riskAmount.toFixed(2)}</span>
                  </div>

                  {/* Liquidation */}
                  {leverage > 1 && liquidationPrice > 0 && (
                    <div className="flex items-center gap-2 py-1 border-t border-border">
                      <AlertTriangle className="h-3 w-3 text-destructive" />
                      <span className="text-[9px] font-bold text-destructive">LIQ</span>
                      <div className="flex-1" />
                      <span className="text-[10px] font-bold tabular-nums text-destructive">${formatPrice(liquidationPrice)}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Win Rate Scenarios */}
              <div className="rounded-lg border border-border p-4 space-y-2">
                <h3 className="text-xs font-bold uppercase text-foreground flex items-center gap-1.5">
                  <Shield className="h-3.5 w-3.5 text-accent" />
                  Expected Value Scenarios
                </h3>
                <div className="grid grid-cols-3 gap-2 text-[10px]">
                  {[40, 50, 60].map(wr => {
                    const ev = (wr / 100) * tp1Profit - ((100 - wr) / 100) * riskAmount;
                    return (
                      <div key={wr} className={`rounded p-2 text-center ${ev > 0 ? 'bg-primary/10' : 'bg-destructive/10'}`}>
                        <div className="text-muted-foreground">{wr}% win rate</div>
                        <div className={`font-bold tabular-nums ${ev > 0 ? 'trend-bull' : 'trend-bear'}`}>
                          {ev > 0 ? '+' : ''}${ev.toFixed(2)}/trade
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
};

function PriceLevelBar({ label, price, pct, profit, ratio, color, direction }: {
  label: string; price: number; pct: number; profit: number; ratio: number; color: string; direction: string;
}) {
  return (
    <div className="flex items-center gap-2 py-0.5">
      <span className="text-[9px] font-bold text-primary w-8">{label}</span>
      <div className="flex-1">
        <div className="h-2 rounded-full bg-primary/10 overflow-hidden">
          <div className="h-full bg-primary/40 rounded-full" style={{ width: `${Math.min(100, pct * 5)}%` }} />
        </div>
      </div>
      <span className="text-[10px] font-bold tabular-nums text-primary">${formatPrice(price)}</span>
      <span className="text-[9px] tabular-nums text-primary">+${profit.toFixed(2)}</span>
      <span className="text-[8px] text-muted-foreground">{ratio}R</span>
    </div>
  );
}

function formatPrice(price: number): string {
  if (price < 0.01) return price.toPrecision(4);
  if (price < 1) return price.toPrecision(4);
  return price.toFixed(2);
}

export default TradePlanner;
