import { useState, useEffect, useMemo, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useNavigate } from 'react-router-dom';
import { ArrowUp, ArrowDown, Clock, RefreshCw, Zap, Filter } from 'lucide-react';
import { cn } from '@/lib/utils';

interface IndicatorSignal {
  id: string;
  symbol: string;
  timeframe: string;
  indicator: string;
  direction: 'bull' | 'bear';
  value: string;
  price: number;
  change24h: number;
  volume24h: number;
  timestamp: number;
  strength: 'high' | 'medium' | 'low';
}

const TF_LABELS: Record<string, string> = { '15': '15m', '60': '1H', '240': '4H', 'D': '1D' };
const TF_ORDER = ['15', '60', '240', 'D'];

const INDICATOR_GROUPS = [
  { key: 'all', label: 'All Indicators' },
  { key: 'Parabolic SAR Flip', label: 'PSAR Flip' },
  { key: 'Supertrend Flip', label: 'Supertrend' },
  { key: 'MACD Crossover', label: 'MACD Cross' },
  { key: 'bb', label: 'Bollinger Break', match: (s: string) => s.includes('Bollinger') },
  { key: 'rsi', label: 'RSI Extreme', match: (s: string) => s.includes('RSI') },
  { key: 'stoch', label: 'Stochastic Cross', match: (s: string) => s.includes('Stochastic') },
  { key: 'ema', label: 'EMA Cross', match: (s: string) => s.includes('EMA') },
  { key: 'cci', label: 'CCI Extreme', match: (s: string) => s.includes('CCI') },
  { key: 'wr', label: 'Williams %R', match: (s: string) => s.includes('Williams') },
  { key: 'mfi', label: 'MFI Extreme', match: (s: string) => s.includes('MFI') },
  { key: 'ich', label: 'Ichimoku Break', match: (s: string) => s.includes('Ichimoku') },
  { key: 'don', label: 'Donchian Break', match: (s: string) => s.includes('Donchian') },
  { key: 'Squeeze Release', label: 'Squeeze Release' },
];

function matchesGroup(indicator: string, groupKey: string): boolean {
  if (groupKey === 'all') return true;
  const group = INDICATOR_GROUPS.find(g => g.key === groupKey);
  if (!group) return false;
  if ('match' in group && group.match) return group.match(indicator);
  return indicator === groupKey;
}

export default function IndicatorScanner() {
  const [signals, setSignals] = useState<IndicatorSignal[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastScan, setLastScan] = useState<string | null>(null);
  const [selectedTf, setSelectedTf] = useState('all');
  const [selectedIndicator, setSelectedIndicator] = useState('all');
  const [dirFilter, setDirFilter] = useState<'all' | 'bull' | 'bear'>('all');
  const navigate = useNavigate();

  const fetchSignals = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('scan_cache')
        .select('data, scanned_at')
        .eq('id', 'indicator_signals')
        .single();

      if (!error && data) {
        setSignals((data.data as unknown as IndicatorSignal[]) || []);
        setLastScan(data.scanned_at);
      }
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchSignals();
    const interval = setInterval(fetchSignals, 60_000);
    return () => clearInterval(interval);
  }, [fetchSignals]);

  const filtered = useMemo(() => {
    let items = signals;
    if (selectedTf !== 'all') items = items.filter(s => s.timeframe === selectedTf);
    if (selectedIndicator !== 'all') items = items.filter(s => matchesGroup(s.indicator, selectedIndicator));
    if (dirFilter !== 'all') items = items.filter(s => s.direction === dirFilter);
    return items;
  }, [signals, selectedTf, selectedIndicator, dirFilter]);

  // Group by indicator then timeframe, top 20 per group
  const grouped = useMemo(() => {
    const byIndicator = new Map<string, Map<string, IndicatorSignal[]>>();
    for (const sig of filtered) {
      if (!byIndicator.has(sig.indicator)) byIndicator.set(sig.indicator, new Map());
      const tfMap = byIndicator.get(sig.indicator)!;
      if (!tfMap.has(sig.timeframe)) tfMap.set(sig.timeframe, []);
      tfMap.get(sig.timeframe)!.push(sig);
    }
    // Sort each group by strength then volume, limit 20
    const result: { indicator: string; timeframes: { tf: string; signals: IndicatorSignal[] }[] }[] = [];
    for (const [indicator, tfMap] of byIndicator) {
      const timeframes: { tf: string; signals: IndicatorSignal[] }[] = [];
      for (const tf of TF_ORDER) {
        const sigs = tfMap.get(tf);
        if (!sigs?.length) continue;
        sigs.sort((a, b) => {
          if (a.strength !== b.strength) return a.strength === 'high' ? -1 : 1;
          return b.volume24h - a.volume24h;
        });
        timeframes.push({ tf, signals: sigs.slice(0, 20) });
      }
      if (timeframes.length > 0) result.push({ indicator, timeframes });
    }
    result.sort((a, b) => {
      const totalA = a.timeframes.reduce((s, t) => s + t.signals.length, 0);
      const totalB = b.timeframes.reduce((s, t) => s + t.signals.length, 0);
      return totalB - totalA;
    });
    return result;
  }, [filtered]);

  const totalSignals = filtered.length;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex-shrink-0 border-b border-border bg-card px-3 py-2">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <Zap className="h-4 w-4 text-primary" />
            <h1 className="text-sm font-bold text-foreground">Indicator Scanner</h1>
            <Badge variant="outline" className="text-[10px]">{totalSignals} signals</Badge>
          </div>
          <div className="flex items-center gap-2">
            {lastScan && (
              <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                <Clock className="h-3 w-3" />
                {new Date(lastScan).toLocaleTimeString()}
              </span>
            )}
            <button onClick={fetchSignals} className="p-1 rounded hover:bg-secondary text-muted-foreground">
              <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
            </button>
          </div>
        </div>

        {/* Filters */}
        <div className="flex gap-2 flex-wrap">
          <Select value={selectedIndicator} onValueChange={setSelectedIndicator}>
            <SelectTrigger className="h-7 text-[10px] w-[140px] bg-secondary border-border">
              <Filter className="h-3 w-3 mr-1" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {INDICATOR_GROUPS.map(g => (
                <SelectItem key={g.key} value={g.key} className="text-xs">{g.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={selectedTf} onValueChange={setSelectedTf}>
            <SelectTrigger className="h-7 text-[10px] w-[90px] bg-secondary border-border">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all" className="text-xs">All TF</SelectItem>
              {TF_ORDER.map(tf => (
                <SelectItem key={tf} value={tf} className="text-xs">{TF_LABELS[tf]}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <div className="flex rounded-md border border-border overflow-hidden">
            {(['all', 'bull', 'bear'] as const).map(d => (
              <button
                key={d}
                onClick={() => setDirFilter(d)}
                className={cn(
                  "px-2 py-0.5 text-[10px] font-medium transition-colors",
                  dirFilter === d
                    ? d === 'bull' ? 'bg-primary/20 text-primary' : d === 'bear' ? 'bg-destructive/20 text-destructive' : 'bg-secondary text-foreground'
                    : 'text-muted-foreground hover:bg-secondary'
                )}
              >
                {d === 'all' ? 'All' : d === 'bull' ? '↑ Bull' : '↓ Bear'}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-3 space-y-4">
        {loading && signals.length === 0 ? (
          <div className="flex items-center justify-center h-40 text-muted-foreground text-xs">
            <RefreshCw className="h-4 w-4 animate-spin mr-2" /> Loading indicator signals...
          </div>
        ) : grouped.length === 0 ? (
          <div className="flex items-center justify-center h-40 text-muted-foreground text-xs">
            No indicator signals found. Scanner updates every ~15 minutes.
          </div>
        ) : (
          grouped.map(({ indicator, timeframes }) => (
            <div key={indicator} className="bg-card border border-border rounded-lg overflow-hidden">
              <div className="px-3 py-2 bg-secondary/50 border-b border-border flex items-center gap-2">
                <Zap className="h-3.5 w-3.5 text-accent" />
                <span className="text-xs font-bold text-foreground">{indicator}</span>
                <Badge variant="outline" className="text-[9px]">
                  {timeframes.reduce((s, t) => s + t.signals.length, 0)}
                </Badge>
              </div>

              <Tabs defaultValue={timeframes[0]?.tf || '15'} className="w-full">
                <TabsList className="w-full justify-start bg-transparent border-b border-border rounded-none h-7 px-2">
                  {timeframes.map(({ tf, signals: sigs }) => (
                    <TabsTrigger key={tf} value={tf} className="text-[10px] h-6 px-2 data-[state=active]:bg-primary/10 data-[state=active]:text-primary rounded-sm">
                      {TF_LABELS[tf]} <span className="ml-1 text-muted-foreground">({sigs.length})</span>
                    </TabsTrigger>
                  ))}
                </TabsList>

                {timeframes.map(({ tf, signals: sigs }) => (
                  <TabsContent key={tf} value={tf} className="mt-0 p-0">
                    <div className="divide-y divide-border">
                      {sigs.map(sig => (
                        <button
                          key={sig.id}
                          onClick={() => navigate(`/symbol/${sig.symbol}USDT`)}
                          className="w-full flex items-center gap-3 px-3 py-2 hover:bg-secondary/50 transition-colors text-left"
                        >
                          <div className={cn(
                            "flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center",
                            sig.direction === 'bull' ? 'bg-primary/20' : 'bg-destructive/20'
                          )}>
                            {sig.direction === 'bull'
                              ? <ArrowUp className="h-3 w-3 text-primary" />
                              : <ArrowDown className="h-3 w-3 text-destructive" />
                            }
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-bold text-foreground">{sig.symbol}</span>
                              <span className={cn(
                                "text-[10px] font-medium",
                                sig.change24h >= 0 ? 'text-primary' : 'text-destructive'
                              )}>
                                {sig.change24h >= 0 ? '+' : ''}{(sig.change24h * 100).toFixed(2)}%
                              </span>
                              {sig.strength === 'high' && (
                                <Badge className="text-[8px] h-3.5 bg-primary/20 text-primary border-0">HIGH</Badge>
                              )}
                            </div>
                            <p className="text-[10px] text-muted-foreground truncate">{sig.value}</p>
                          </div>
                          <span className="text-[10px] text-muted-foreground tabular-nums flex-shrink-0">
                            ${sig.price < 1 ? sig.price.toPrecision(4) : sig.price.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                          </span>
                        </button>
                      ))}
                    </div>
                  </TabsContent>
                ))}
              </Tabs>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
