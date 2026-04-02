import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Shield, ArrowUp, ArrowDown, RefreshCw, Filter } from 'lucide-react';
import { cn } from '@/lib/utils';

interface SRLevel {
  price: number;
  type: 'support' | 'resistance';
  touches: number;
  strength: number;
}

interface SRSignal {
  symbol: string;
  price: number;
  change24h: number;
  timeframe: string;
  level: SRLevel;
  distance: number;
  approaching: 'from_above' | 'from_below';
  score: number;
}

const TIMEFRAMES = ['All', '5m', '15m', '1H', '4H', '1D'] as const;
const STRENGTH_FILTERS = ['All', 'Strong (70+)', 'Medium (50+)', 'Weak (30+)'] as const;

async function fetchSRSignals(): Promise<{ signals: SRSignal[]; scannedAt: number }> {
  const { data, error } = await supabase.functions.invoke('sr-scanner');
  if (error) throw error;
  return data;
}

export default function SupportResistance() {
  const [tfFilter, setTfFilter] = useState<string>('All');
  const [strengthFilter, setStrengthFilter] = useState<string>('All');
  const [typeFilter, setTypeFilter] = useState<'all' | 'support' | 'resistance'>('all');

  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ['sr-scanner'],
    queryFn: fetchSRSignals,
    refetchInterval: 5 * 60 * 1000,
    staleTime: 2 * 60 * 1000,
  });

  const filtered = (data?.signals ?? []).filter(s => {
    if (tfFilter !== 'All' && s.timeframe !== tfFilter) return false;
    if (typeFilter !== 'all' && s.level.type !== typeFilter) return false;
    if (strengthFilter === 'Strong (70+)' && s.level.strength < 70) return false;
    if (strengthFilter === 'Medium (50+)' && s.level.strength < 50) return false;
    if (strengthFilter === 'Weak (30+)' && s.level.strength < 30) return false;
    return true;
  });

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="flex items-center gap-2">
          <Shield className="h-5 w-5 text-primary" />
          <h1 className="text-sm font-bold">Support & Resistance Scanner</h1>
        </div>
        <button
          onClick={() => refetch()}
          disabled={isFetching}
          className="flex items-center gap-1 rounded-md bg-primary/10 px-2 py-1 text-xs text-primary hover:bg-primary/20 disabled:opacity-50"
        >
          <RefreshCw className={cn('h-3 w-3', isFetching && 'animate-spin')} />
          {isFetching ? 'Scanning...' : 'Refresh'}
        </button>
      </div>

      {/* Filters */}
      <div className="px-4 py-2 border-b border-border space-y-2">
        {/* Timeframe filter */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <Filter className="h-3 w-3 text-muted-foreground" />
          {TIMEFRAMES.map(tf => (
            <button
              key={tf}
              onClick={() => setTfFilter(tf)}
              className={cn(
                'rounded px-2 py-0.5 text-[10px] font-medium transition-colors',
                tfFilter === tf ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground hover:text-foreground'
              )}
            >
              {tf}
            </button>
          ))}
        </div>
        {/* Type filter */}
        <div className="flex items-center gap-1.5">
          {(['all', 'support', 'resistance'] as const).map(t => (
            <button
              key={t}
              onClick={() => setTypeFilter(t)}
              className={cn(
                'rounded px-2 py-0.5 text-[10px] font-medium capitalize transition-colors',
                typeFilter === t ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground hover:text-foreground'
              )}
            >
              {t}
            </button>
          ))}
          <span className="mx-1 text-border">|</span>
          {STRENGTH_FILTERS.map(sf => (
            <button
              key={sf}
              onClick={() => setStrengthFilter(sf)}
              className={cn(
                'rounded px-2 py-0.5 text-[10px] font-medium transition-colors',
                strengthFilter === sf ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground hover:text-foreground'
              )}
            >
              {sf}
            </button>
          ))}
        </div>
      </div>

      {/* Results */}
      <div className="flex-1 overflow-y-auto">
        {isLoading && (
          <div className="flex items-center justify-center py-20 text-muted-foreground text-xs">
            <RefreshCw className="h-4 w-4 animate-spin mr-2" /> Scanning all coins...
          </div>
        )}
        {error && (
          <div className="px-4 py-8 text-center text-destructive text-xs">
            Error: {String(error)}
          </div>
        )}
        {!isLoading && !error && filtered.length === 0 && (
          <div className="px-4 py-8 text-center text-muted-foreground text-xs">
            No coins near S/R levels with current filters.
          </div>
        )}
        {filtered.map((s, i) => (
          <SignalRow key={`${s.symbol}-${s.timeframe}-${i}`} signal={s} />
        ))}
      </div>

      {/* Footer */}
      {data && (
        <div className="border-t border-border px-4 py-1.5 text-[10px] text-muted-foreground flex justify-between">
          <span>{filtered.length} signals</span>
          <span>Scanned {new Date(data.scannedAt).toLocaleTimeString()}</span>
        </div>
      )}
    </div>
  );
}

function SignalRow({ signal }: { signal: SRSignal }) {
  const s = signal;
  const isSupport = s.level.type === 'support';

  return (
    <div className="flex items-center gap-3 border-b border-border px-4 py-2.5 hover:bg-secondary/50 transition-colors">
      {/* Icon */}
      <div className={cn(
        'flex h-8 w-8 items-center justify-center rounded-lg',
        isSupport ? 'bg-green-500/10 text-green-500' : 'bg-red-500/10 text-red-500'
      )}>
        {isSupport ? <ArrowUp className="h-4 w-4" /> : <ArrowDown className="h-4 w-4" />}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold">{s.symbol.replace('USDT', '')}</span>
          <span className={cn(
            'text-[10px] font-medium px-1.5 rounded',
            isSupport ? 'bg-green-500/10 text-green-500' : 'bg-red-500/10 text-red-500'
          )}>
            {isSupport ? 'SUPPORT' : 'RESISTANCE'}
          </span>
          <span className="text-[10px] text-muted-foreground bg-secondary px-1.5 rounded">{s.timeframe}</span>
        </div>
        <div className="flex items-center gap-3 mt-0.5 text-[10px] text-muted-foreground">
          <span>Price: ${s.price.toPrecision(6)}</span>
          <span>Level: ${s.level.price.toPrecision(6)}</span>
          <span>{s.distance.toFixed(2)}% away</span>
          <span>{s.level.touches} touches</span>
        </div>
      </div>

      {/* Score & Strength */}
      <div className="flex flex-col items-end gap-0.5">
        <div className={cn(
          'text-xs font-bold',
          s.score >= 75 ? 'text-green-500' : s.score >= 50 ? 'text-yellow-500' : 'text-muted-foreground'
        )}>
          {s.score}
        </div>
        <div className="w-16 h-1.5 rounded-full bg-secondary overflow-hidden">
          <div
            className={cn(
              'h-full rounded-full',
              s.level.strength >= 70 ? 'bg-green-500' : s.level.strength >= 50 ? 'bg-yellow-500' : 'bg-muted-foreground'
            )}
            style={{ width: `${s.level.strength}%` }}
          />
        </div>
        <span className="text-[9px] text-muted-foreground">str {s.level.strength}</span>
      </div>
    </div>
  );
}
