import { useState, useEffect, useCallback } from 'react';
import { useSharedScanner } from '@/contexts/ScannerContext';
import { fetchKlines } from '@/lib/bybit-api';
import { useIsMobile } from '@/hooks/use-mobile';
import { RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useNavigate } from 'react-router-dom';
import type { Candle } from '@/types/scanner';

function calculateCorrelation(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n < 10) return 0;
  const sliceA = a.slice(-n);
  const sliceB = b.slice(-n);
  const meanA = sliceA.reduce((s, v) => s + v, 0) / n;
  const meanB = sliceB.reduce((s, v) => s + v, 0) / n;
  let num = 0, denA = 0, denB = 0;
  for (let i = 0; i < n; i++) {
    const da = sliceA[i] - meanA;
    const db = sliceB[i] - meanB;
    num += da * db;
    denA += da * da;
    denB += db * db;
  }
  const den = Math.sqrt(denA * denB);
  return den === 0 ? 0 : num / den;
}

function getCorrelationColor(corr: number): string {
  const abs = Math.abs(corr);
  const opacity = Math.max(0.1, abs * 0.8);
  if (corr > 0) return `hsl(142 72% 45% / ${opacity})`;
  return `hsl(0 72% 50% / ${opacity})`;
}

const TOP_PAIRS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 'ADAUSDT', 'DOGEUSDT', 'AVAXUSDT', 'DOTUSDT', 'LINKUSDT', 'NEARUSDT', 'SUIUSDT'];

const CorrelationMatrix = () => {
  const { assets } = useSharedScanner();
  const [matrix, setMatrix] = useState<Map<string, Map<string, number>>>(new Map());
  const [loading, setLoading] = useState(false);
  const isMobile = useIsMobile();
  const navigate = useNavigate();

  const symbols = TOP_PAIRS.filter(s => assets.some(a => a.symbol === s)).slice(0, isMobile ? 6 : 12);

  const compute = useCallback(async () => {
    if (symbols.length < 2) return;
    setLoading(true);
    try {
      const returns = new Map<string, number[]>();
      for (let i = 0; i < symbols.length; i += 3) {
        const batch = symbols.slice(i, i + 3);
        await Promise.all(batch.map(async (sym) => {
          try {
            const candles = await fetchKlines(sym, 'D', 'linear', 60);
            const rets = candles.slice(1).map((c, j) => (c.close - candles[j].close) / candles[j].close);
            returns.set(sym, rets);
          } catch { /* skip */ }
        }));
      }

      const mat = new Map<string, Map<string, number>>();
      for (const a of symbols) {
        const row = new Map<string, number>();
        for (const b of symbols) {
          if (a === b) { row.set(b, 1); continue; }
          const ra = returns.get(a);
          const rb = returns.get(b);
          row.set(b, ra && rb ? calculateCorrelation(ra, rb) : 0);
        }
        mat.set(a, row);
      }
      setMatrix(mat);
    } catch { /* skip */ }
    setLoading(false);
  }, [symbols.join(',')]);

  useEffect(() => { if (assets.length > 0) compute(); }, [assets.length > 0]);

  const short = (s: string) => s.replace('USDT', '');

  return (
    <div className="flex h-full flex-col bg-background">
      <header className="flex items-center justify-between border-b border-border px-3 py-2">
        <h1 className="text-xs font-bold uppercase tracking-[0.15em] text-primary">CORRELATION MATRIX</h1>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-muted-foreground">60D daily returns</span>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={compute} disabled={loading}>
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </header>

      <div className="flex-1 overflow-auto p-3">
        {matrix.size === 0 ? (
          <div className="flex h-full items-center justify-center text-muted-foreground text-sm">
            {loading ? 'Computing correlations...' : 'Run scanner first, then correlations will compute automatically'}
          </div>
        ) : (
          <div className="overflow-auto">
            <table className="text-[10px]">
              <thead>
                <tr>
                  <th className="p-1 text-muted-foreground"></th>
                  {symbols.map(s => (
                    <th key={s} className="p-1 text-muted-foreground font-mono cursor-pointer hover:text-foreground"
                      onClick={() => navigate(`/symbol/${s}`)}
                    >
                      {short(s)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {symbols.map(a => (
                  <tr key={a}>
                    <td className="p-1 font-mono text-muted-foreground font-medium cursor-pointer hover:text-foreground"
                      onClick={() => navigate(`/symbol/${a}`)}
                    >
                      {short(a)}
                    </td>
                    {symbols.map(b => {
                      const corr = matrix.get(a)?.get(b) ?? 0;
                      return (
                        <td
                          key={b}
                          className="p-1 text-center font-mono cursor-default"
                          style={{
                            background: a === b ? 'hsl(var(--secondary))' : getCorrelationColor(corr),
                            color: 'hsl(var(--foreground))',
                            minWidth: isMobile ? 36 : 44,
                          }}
                          title={`${short(a)} vs ${short(b)}: ${corr.toFixed(3)}`}
                        >
                          {a === b ? '1.00' : corr.toFixed(2)}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="mt-4 flex items-center gap-4 text-[10px] text-muted-foreground">
              <span className="flex items-center gap-1">
                <span className="inline-block h-3 w-3 rounded" style={{ background: 'hsl(142 72% 45% / 0.6)' }} /> Positive
              </span>
              <span className="flex items-center gap-1">
                <span className="inline-block h-3 w-3 rounded" style={{ background: 'hsl(0 72% 50% / 0.6)' }} /> Negative
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default CorrelationMatrix;
