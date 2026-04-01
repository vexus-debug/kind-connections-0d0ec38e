import { useState, useMemo } from 'react';
import { RefreshCw, TrendingUp, TrendingDown, Clock, Filter, X, Target, ArrowUpRight, ArrowDownRight, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { ChartView, type PatternHighlight } from '@/components/ChartView';
import type { PatternGroup, DetectedPattern } from '@/hooks/usePatternScanner';
import { TIMEFRAME_LABELS, type Timeframe } from '@/types/scanner';

type TypeFilter = 'all' | 'bullish' | 'bearish' | 'neutral';
type SigFilter = 'all' | 'high' | 'medium' | 'low';

const SCAN_TIMEFRAMES: Timeframe[] = ['5', '15', '60', '240', 'D', 'W'];

interface PatternPageShellProps {
  title: string;
  subtitle: string;
  groups: PatternGroup[];
  scanning: boolean;
  lastScanTime: number;
  scanProgress: { current: number; total: number };
  onRescan: () => void;
}

interface SelectedPattern {
  symbol: string;
  timeframe: Timeframe;
  patternName: string;
  category: 'candlestick' | 'chart' | 'structure';
}

export function PatternPageShell({
  title, subtitle, groups, scanning, lastScanTime, scanProgress, onRescan,
}: PatternPageShellProps) {
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [sigFilter, setSigFilter] = useState<SigFilter>('all');
  const [tfFilter, setTfFilter] = useState<Timeframe | 'all'>('all');
  const [selectedPattern, setSelectedPattern] = useState<SelectedPattern | null>(null);

  const lastScanStr = lastScanTime
    ? new Date(lastScanTime).toLocaleTimeString('en-US', { hour12: false })
    : '—';

  const filteredGroups = useMemo(() => {
    const result: PatternGroup[] = [];
    const timeframes = tfFilter === 'all' ? SCAN_TIMEFRAMES : [tfFilter];

    for (const tf of timeframes) {
      const group = groups.find(g => g.timeframe === tf);
      if (!group) continue;

      const filtered = group.patterns.filter(dp => {
        if (typeFilter !== 'all' && dp.pattern.type !== typeFilter) return false;
        if (sigFilter !== 'all' && dp.pattern.significance !== sigFilter) return false;
        return true;
      });

      if (filtered.length > 0) {
        result.push({ ...group, patterns: filtered });
      }
    }
    return result;
  }, [groups, typeFilter, sigFilter, tfFilter]);

  const totalPatterns = filteredGroups.reduce((s, g) => s + g.patterns.length, 0);
  const hasFilters = typeFilter !== 'all' || sigFilter !== 'all' || tfFilter !== 'all';

  const clearFilters = () => {
    setTypeFilter('all');
    setSigFilter('all');
    setTfFilter('all');
  };

  const handlePatternClick = (dp: DetectedPattern) => {
    const fullSymbol = dp.symbol.includes('USDT') ? dp.symbol : `${dp.symbol}USDT`;
    setSelectedPattern({
      symbol: fullSymbol,
      timeframe: dp.timeframe,
      patternName: dp.pattern.name,
      category: dp.category,
    });
  };

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <header className="flex items-center justify-between border-b border-border px-4 py-3">
        <div>
          <h1 className="text-sm font-bold uppercase tracking-[0.15em] text-foreground">{title}</h1>
          <p className="text-[10px] text-muted-foreground">{subtitle}</p>
        </div>
        <div className="flex items-center gap-2">
          {scanning && (
            <span className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
              <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
              {scanProgress.current}/{scanProgress.total}
            </span>
          )}
          <span className="text-[10px] tabular-nums text-muted-foreground">
            {totalPatterns} found
          </span>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onRescan} disabled={scanning}>
            <RefreshCw className={`h-3.5 w-3.5 ${scanning ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </header>

      {/* Filter bar */}
      <div className="border-b border-border px-4 py-2">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-1">
            {(['all', 'bullish', 'bearish'] as TypeFilter[]).map(t => (
              <button
                key={t}
                onClick={() => setTypeFilter(t)}
                className={`rounded-full px-2.5 py-1 text-[10px] font-medium transition-colors ${
                  typeFilter === t
                    ? t === 'bullish' ? 'bg-primary/20 text-primary'
                    : t === 'bearish' ? 'bg-destructive/20 text-destructive'
                    : 'bg-secondary text-foreground'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {t === 'all' ? 'All' : t === 'bullish' ? '↑ Buy' : '↓ Sell'}
              </button>
            ))}
          </div>

          <div className="h-4 w-px bg-border" />

          <div className="flex items-center gap-1">
            <button
              onClick={() => setTfFilter('all')}
              className={`rounded-full px-2 py-1 text-[10px] font-medium transition-colors ${
                tfFilter === 'all' ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              All TF
            </button>
            {SCAN_TIMEFRAMES.map(tf => (
              <button
                key={tf}
                onClick={() => setTfFilter(tf)}
                className={`rounded-full px-2 py-1 text-[10px] font-medium transition-colors ${
                  tfFilter === tf ? 'bg-accent/20 text-accent' : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {TIMEFRAME_LABELS[tf]}
              </button>
            ))}
          </div>

          {hasFilters && (
            <button
              onClick={clearFilters}
              className="flex items-center gap-0.5 rounded-full px-2 py-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
            >
              <X className="h-2.5 w-2.5" />
              Clear
            </button>
          )}
        </div>
      </div>

      {/* Scanning progress bar */}
      {scanning && (
        <div className="h-0.5 bg-muted">
          <div
            className="h-full bg-primary transition-all duration-300"
            style={{ width: scanProgress.total > 0 ? `${(scanProgress.current / scanProgress.total) * 100}%` : '0%' }}
          />
        </div>
      )}

      {/* Chart overlay when pattern selected */}
      {selectedPattern && (
        <div className="border-b border-border" style={{ height: '350px' }}>
          <ChartView
            symbol={selectedPattern.symbol}
            initialTimeframe={selectedPattern.timeframe}
            onClose={() => setSelectedPattern(null)}
            patternHighlight={{
              name: selectedPattern.patternName,
              category: selectedPattern.category,
            }}
          />
        </div>
      )}

      {/* Pattern cards */}
      <ScrollArea className="flex-1">
        <div className="p-3 space-y-5">
          {filteredGroups.length === 0 && !scanning && (
            <div className="py-16 text-center text-xs text-muted-foreground">
              {groups.length === 0
                ? 'Scanning in background… Results will appear automatically.'
                : 'No patterns match the current filters.'}
            </div>
          )}

          {filteredGroups.map((group) => (
            <div key={group.timeframe}>
              <div className="flex items-center gap-2 mb-3">
                <span className="rounded-full bg-accent/15 px-3 py-0.5 text-[11px] font-bold text-accent">
                  {group.label}
                </span>
                <span className="text-[10px] text-muted-foreground">
                  {group.patterns.length} pattern{group.patterns.length !== 1 ? 's' : ''}
                </span>
                <div className="flex-1 h-px bg-border" />
              </div>
              <div className="space-y-3">
                {group.patterns.map((dp) => (
                  <PatternCard
                    key={dp.id}
                    pattern={dp}
                    isSelected={selectedPattern?.symbol === (dp.symbol.includes('USDT') ? dp.symbol : `${dp.symbol}USDT`) && selectedPattern?.patternName === dp.pattern.name && selectedPattern?.timeframe === dp.timeframe}
                    onClick={() => handlePatternClick(dp)}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}

function PatternCard({ pattern: dp, isSelected, onClick }: { pattern: DetectedPattern; isSelected: boolean; onClick: () => void }) {
  const p = dp.pattern;
  const isBull = p.type === 'bullish';
  const isBear = p.type === 'bearish';
  const signalLabel = isBull ? 'Buy signal' : isBear ? 'Sell signal' : 'Neutral';
  const aligned = dp.trendAligned;
  const formedTime = formatFormedTime(dp.formedAt, dp.timeframe);
  const tradingTip = getTradingTip(p.name, p.type, dp.price);

  return (
    <div
      onClick={onClick}
      className={`rounded-lg border overflow-hidden cursor-pointer transition-all hover:brightness-110 ${
        isSelected ? 'ring-1 ring-accent' : ''
      }`}
      style={{
        borderColor: isBull
          ? 'hsl(142 72% 45% / 0.25)'
          : isBear
          ? 'hsl(0 72% 50% / 0.25)'
          : 'hsl(var(--border))',
      }}
    >
      {/* Top bar with badges */}
      <div className="flex items-center gap-2 px-3 py-2 bg-secondary/30">
        <Badge
          variant="outline"
          className="text-[9px] px-2 py-0 rounded-full border-accent/30 text-accent"
        >
          {TIMEFRAME_LABELS[dp.timeframe]}
        </Badge>
        <Badge
          className={`text-[9px] px-2 py-0 rounded-full border-0 ${
            isBull
              ? 'bg-primary/20 text-primary'
              : isBear
              ? 'bg-destructive/20 text-destructive'
              : 'bg-muted text-muted-foreground'
          }`}
        >
          {signalLabel}
        </Badge>
        {aligned && (
          <Badge className="text-[9px] px-2 py-0 rounded-full border-0 bg-accent/20 text-accent">
            ✓ Trend aligned
          </Badge>
        )}
        <div className="flex-1" />
        <SignificanceDots significance={p.significance} />
      </div>

      {/* Main content */}
      <div className="px-3 py-3 space-y-2">
        <div className="flex items-start justify-between">
          <div>
            <h3 className="text-base font-bold text-foreground leading-tight">{dp.symbol}</h3>
            <p className="text-xs font-semibold" style={{
              color: isBull ? 'hsl(var(--trend-bull))' : isBear ? 'hsl(var(--trend-bear))' : 'hsl(var(--muted-foreground))',
            }}>
              {p.name}
            </p>
          </div>
          <div className="flex items-center gap-1 mt-0.5">
            {isBull ? (
              <ArrowUpRight className="h-5 w-5 text-primary" />
            ) : isBear ? (
              <ArrowDownRight className="h-5 w-5 text-destructive" />
            ) : null}
          </div>
        </div>

        <p className="text-[11px] leading-relaxed text-muted-foreground">
          {p.description}
        </p>

        {tradingTip && (
          <div className="rounded bg-secondary/50 px-2.5 py-2 flex items-start gap-2">
            <Target className="h-3.5 w-3.5 text-accent mt-0.5 flex-shrink-0" />
            <p className="text-[10px] leading-relaxed text-foreground/80">{tradingTip}</p>
          </div>
        )}

        <div className="flex items-center justify-between pt-1">
          <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
            <span className="tabular-nums font-medium text-foreground/70">
              ${dp.price < 1 ? dp.price.toPrecision(4) : dp.price.toLocaleString(undefined, { maximumFractionDigits: 2 })}
            </span>
            <span className="flex items-center gap-0.5">
              <Clock className="h-2.5 w-2.5" />
              {formedTime}
            </span>
          </div>
          <div className="flex items-center gap-1">
            <Zap className={`h-3 w-3 ${
              p.significance === 'high' ? 'text-primary' : p.significance === 'medium' ? 'text-accent' : 'text-muted-foreground'
            }`} />
            <span className="text-[9px] font-medium uppercase text-muted-foreground">{p.significance}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function SignificanceDots({ significance }: { significance: 'high' | 'medium' | 'low' }) {
  const count = significance === 'high' ? 3 : significance === 'medium' ? 2 : 1;
  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3].map(i => (
        <div
          key={i}
          className={`h-1.5 w-1.5 rounded-full ${
            i <= count ? 'bg-primary' : 'bg-muted'
          }`}
        />
      ))}
    </div>
  );
}

function getTradingTip(name: string, type: string, price: number): string | null {
  const direction = type === 'bullish' ? 'long' : type === 'bearish' ? 'short' : null;
  if (!direction) return null;

  const tips: Record<string, string> = {
    'Bullish Engulfing': `Look for ${direction} entries on confirmation. Place stop below the engulfing candle low.`,
    'Bearish Engulfing': `Consider ${direction} entries after next candle confirms. Stop above the engulfing candle high.`,
    'Hammer': `Potential reversal. Enter ${direction} on next candle close above hammer high. Stop below hammer low.`,
    'Shooting Star': `Potential reversal. Enter ${direction} on break below shooting star low. Stop above high.`,
    'Morning Star': `Strong reversal signal. Enter ${direction} with stop below the pattern low.`,
    'Evening Star': `Strong reversal signal. Enter ${direction} with stop above the pattern high.`,
    'Doji': `Indecision candle. Wait for directional confirmation before entering.`,
    'Dragonfly Doji': `Potential ${direction} reversal. Confirm with next candle.`,
    'Gravestone Doji': `Potential ${direction} reversal. Confirm with next candle close.`,
    'Double Top': `Enter ${direction} on neckline break. Target = pattern height projected from neckline.`,
    'Double Bottom': `Enter ${direction} on neckline break. Target = pattern height projected upward from neckline.`,
    'Head and Shoulders': `Enter ${direction} on neckline break with volume. Target = head-to-neckline distance.`,
    'Ascending Triangle': `Enter ${direction} on resistance breakout. Target = triangle height from breakout.`,
    'Descending Triangle': `Enter ${direction} on support breakdown. Target = triangle height from breakdown.`,
    'Symmetrical Triangle': `Enter on breakout direction. Target = widest part of triangle projected from breakout.`,
    'Rising Wedge': `Enter ${direction} on lower trendline break. Target = wedge height.`,
    'Falling Wedge': `Enter ${direction} on upper trendline break. Target = wedge height.`,
    'Bull Flag': `Enter ${direction} on flag breakout. Target = flagpole height from breakout point.`,
    'Bear Flag': `Enter ${direction} on flag breakdown. Target = flagpole height from breakdown point.`,
    'Break of Structure (BOS)': `Trend continuation confirmed. Look for pullback entries in the direction of the break.`,
    'Change of Character (CHoCH)': `Potential trend reversal. Wait for pullback to enter in the new trend direction.`,
    'Fair Value Gap (FVG)': `Price may revisit this imbalance zone. Look for entries when price retests the gap.`,
    'Bullish Order Block': `Institutional buying zone. Enter ${direction} when price retests this level.`,
    'Bearish Order Block': `Institutional selling zone. Enter ${direction} when price retests this level.`,
  };

  return tips[name] || `${type === 'bullish' ? 'Bullish' : 'Bearish'} pattern detected. Look for ${direction} setups with proper risk management.`;
}

function formatFormedTime(ts: number, timeframe: string): string {
  const d = new Date(ts);
  const date = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  if (timeframe === 'D' || timeframe === 'W') {
    return date;
  }
  const time = d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
  return `${date} ${time}`;
}
