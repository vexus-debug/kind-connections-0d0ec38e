import { useState, useEffect, useCallback } from 'react';
import { fetchFundingRates, formatFundingRate, getFundingRateColor, type FundingRate } from '@/lib/funding-rates';
import { getSector, getSectorColor, getSectorEmoji } from '@/lib/sectors';
import { useIsMobile } from '@/hooks/use-mobile';
import { RefreshCw, ArrowUpDown, TrendingUp, TrendingDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useNavigate } from 'react-router-dom';

type SortField = 'rate' | 'predicted' | 'symbol';
type FilterMode = 'all' | 'extreme_positive' | 'extreme_negative' | 'neutral';

const FundingRates = () => {
  const [rates, setRates] = useState<FundingRate[]>([]);
  const [loading, setLoading] = useState(false);
  const [sortField, setSortField] = useState<SortField>('rate');
  const [sortAsc, setSortAsc] = useState(false);
  const [filter, setFilter] = useState<FilterMode>('all');
  const isMobile = useIsMobile();
  const navigate = useNavigate();

  const load = useCallback(async () => {
    setLoading(true);
    const data = await fetchFundingRates();
    setRates(data);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = rates.filter(r => {
    if (filter === 'extreme_positive') return r.fundingRate > 0.0005;
    if (filter === 'extreme_negative') return r.fundingRate < -0.0005;
    if (filter === 'neutral') return Math.abs(r.fundingRate) <= 0.0001;
    return true;
  });

  const sorted = [...filtered].sort((a, b) => {
    let cmp = 0;
    if (sortField === 'rate') cmp = Math.abs(b.fundingRate) - Math.abs(a.fundingRate);
    else if (sortField === 'predicted') cmp = Math.abs(b.predictedRate) - Math.abs(a.predictedRate);
    else cmp = a.symbol.localeCompare(b.symbol);
    return sortAsc ? -cmp : cmp;
  });

  const toggleSort = (field: SortField) => {
    if (sortField === field) setSortAsc(!sortAsc);
    else { setSortField(field); setSortAsc(false); }
  };

  const extremePositive = rates.filter(r => r.fundingRate > 0.0005).length;
  const extremeNegative = rates.filter(r => r.fundingRate < -0.0005).length;
  const avgRate = rates.length > 0 ? rates.reduce((s, r) => s + r.fundingRate, 0) / rates.length : 0;

  return (
    <div className="flex h-full flex-col bg-background">
      <header className="flex items-center justify-between border-b border-border px-3 py-2">
        <h1 className="text-xs font-bold uppercase tracking-[0.15em] text-primary">FUNDING RATES</h1>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-muted-foreground">{rates.length} pairs</span>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={load} disabled={loading}>
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </header>

      {/* Stats */}
      <div className="flex gap-2 border-b border-border px-3 py-2">
        <div className="flex-1 rounded bg-card p-2 text-center">
          <div className="text-[10px] text-muted-foreground">Avg Rate</div>
          <div className="text-xs font-mono" style={{ color: getFundingRateColor(avgRate) }}>{formatFundingRate(avgRate)}</div>
        </div>
        <div className="flex-1 rounded bg-card p-2 text-center">
          <div className="text-[10px] text-muted-foreground">Extreme +</div>
          <div className="text-xs font-mono text-[hsl(var(--trend-bull))]">{extremePositive}</div>
        </div>
        <div className="flex-1 rounded bg-card p-2 text-center">
          <div className="text-[10px] text-muted-foreground">Extreme −</div>
          <div className="text-xs font-mono text-[hsl(var(--trend-bear))]">{extremeNegative}</div>
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-1 border-b border-border px-3 py-1.5 overflow-x-auto">
        {([
          { id: 'all', label: 'All' },
          { id: 'extreme_positive', label: '🔥 High+' },
          { id: 'extreme_negative', label: '❄️ High−' },
          { id: 'neutral', label: '⚖️ Neutral' },
        ] as { id: FilterMode; label: string }[]).map(f => (
          <button
            key={f.id}
            onClick={() => setFilter(f.id)}
            className={`rounded px-2 py-1 text-[10px] font-medium transition-colors ${
              filter === f.id ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground hover:text-foreground'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        <table className="w-full text-[11px]">
          <thead className="sticky top-0 bg-card">
            <tr className="text-muted-foreground">
              <th className="px-3 py-1.5 text-left font-medium cursor-pointer" onClick={() => toggleSort('symbol')}>
                Symbol {sortField === 'symbol' && <ArrowUpDown className="inline h-3 w-3" />}
              </th>
              {!isMobile && <th className="px-2 py-1.5 text-left font-medium">Sector</th>}
              <th className="px-2 py-1.5 text-right font-medium cursor-pointer" onClick={() => toggleSort('rate')}>
                Rate {sortField === 'rate' && <ArrowUpDown className="inline h-3 w-3" />}
              </th>
              <th className="px-2 py-1.5 text-right font-medium cursor-pointer" onClick={() => toggleSort('predicted')}>
                Predicted {sortField === 'predicted' && <ArrowUpDown className="inline h-3 w-3" />}
              </th>
              <th className="px-2 py-1.5 text-right font-medium">Signal</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map(r => {
              const sector = getSector(r.symbol);
              return (
                <tr
                  key={r.symbol}
                  className="border-b border-border/50 hover:bg-secondary/30 cursor-pointer transition-colors"
                  onClick={() => navigate(`/symbol/${r.symbol}`)}
                >
                  <td className="px-3 py-1.5 font-mono font-medium text-foreground">{r.symbol.replace('USDT', '')}</td>
                  {!isMobile && (
                    <td className="px-2 py-1.5" style={{ color: getSectorColor(sector) }}>
                      {getSectorEmoji(sector)} {sector}
                    </td>
                  )}
                  <td className="px-2 py-1.5 text-right font-mono" style={{ color: getFundingRateColor(r.fundingRate) }}>
                    {formatFundingRate(r.fundingRate)}
                  </td>
                  <td className="px-2 py-1.5 text-right font-mono" style={{ color: getFundingRateColor(r.predictedRate) }}>
                    {formatFundingRate(r.predictedRate)}
                  </td>
                  <td className="px-2 py-1.5 text-right">
                    {r.fundingRate > 0.0005 ? (
                      <span className="flex items-center justify-end gap-0.5 text-[hsl(var(--trend-bear))]">
                        <TrendingDown className="h-3 w-3" /> Short bias
                      </span>
                    ) : r.fundingRate < -0.0005 ? (
                      <span className="flex items-center justify-end gap-0.5 text-[hsl(var(--trend-bull))]">
                        <TrendingUp className="h-3 w-3" /> Long bias
                      </span>
                    ) : (
                      <span className="text-muted-foreground">Neutral</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default FundingRates;
