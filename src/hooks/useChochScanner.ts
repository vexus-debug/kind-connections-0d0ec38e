import { useState, useRef, useCallback } from 'react';
import { fetchTickers, fetchKlines } from '@/lib/bybit-api';
import { findSwings } from '@/lib/smc/swings';
import { countFailedChoch } from '@/lib/smc/bos-choch';
import type { Timeframe } from '@/types/scanner';
import { TIMEFRAME_LABELS } from '@/types/scanner';

const SCAN_TIMEFRAMES: Timeframe[] = ['1', '5', '15', '60', '240', 'D', 'W'];
const TOP_SYMBOLS = 50;
const BATCH = 10; // larger batch since we're doing much less work per symbol

export interface ChochResult {
  id: string;
  symbol: string;
  timeframe: Timeframe;
  chochFailures: number;
  trendDirection: 'bullish' | 'bearish' | 'unknown';
  price: number;
  detectedAt: number;
}

export interface ChochGroup {
  timeframe: Timeframe;
  label: string;
  results: ChochResult[];
}

export function useChochScanner() {
  const [results, setResults] = useState<ChochResult[]>([]);
  const [scanning, setScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState({ current: 0, total: 0 });
  const [lastScanTime, setLastScanTime] = useState(0);
  const scanningRef = useRef(false);

  const runScan = useCallback(async () => {
    if (scanningRef.current) return;
    scanningRef.current = true;
    setScanning(true);

    try {
      // Fetch top symbols by volume
      const symbolMap = new Map<string, { symbol: string; category: 'spot' | 'linear'; price: number }>();
      for (const cat of ['linear', 'spot'] as const) {
        try {
          const tickerData = await fetchTickers(cat);
          if (tickerData.retCode === 0 && tickerData.result?.list) {
            const sorted = tickerData.result.list
              .filter(t => t.symbol.endsWith('USDT'))
              .sort((a, b) => parseFloat(b.turnover24h) - parseFloat(a.turnover24h))
              .slice(0, TOP_SYMBOLS);
            for (const t of sorted) {
              if (!symbolMap.has(t.symbol) || cat === 'linear') {
                symbolMap.set(t.symbol, { symbol: t.symbol, category: cat, price: parseFloat(t.lastPrice) });
              }
            }
          }
        } catch { /* skip */ }
      }

      const symbols = Array.from(symbolMap.values());
      const totalOps = symbols.length * SCAN_TIMEFRAMES.length;
      setScanProgress({ current: 0, total: totalOps });

      const newResults: ChochResult[] = [];
      let progress = 0;

      for (let i = 0; i < symbols.length; i += BATCH) {
        const batch = symbols.slice(i, i + BATCH);
        await Promise.all(batch.map(async ({ symbol, category, price }) => {
          for (const tf of SCAN_TIMEFRAMES) {
            try {
              const candles = await fetchKlines(symbol, tf, category);
              if (candles.length < 20) { progress++; continue; }

              const closedCandles = candles.slice(0, -1);
              if (closedCandles.length < 20) { progress++; continue; }

              const swings = findSwings(closedCandles, 3);
              const highs = swings.filter(s => s.type === 'high');
              const lows = swings.filter(s => s.type === 'low');

              const failures = countFailedChoch(closedCandles, swings);

              // Determine current trend direction
              let trendDirection: 'bullish' | 'bearish' | 'unknown' = 'unknown';
              if (highs.length >= 2 && lows.length >= 2) {
                const lastHH = highs[highs.length - 1].price > highs[highs.length - 2].price;
                const lastHL = lows[lows.length - 1].price > lows[lows.length - 2].price;
                const lastLH = highs[highs.length - 1].price < highs[highs.length - 2].price;
                const lastLL = lows[lows.length - 1].price < lows[lows.length - 2].price;
                if (lastHH && lastHL) trendDirection = 'bullish';
                else if (lastLH && lastLL) trendDirection = 'bearish';
              }

              const sym = symbol.replace('USDT', '');
              newResults.push({
                id: `choch-${symbol}-${tf}-${Date.now()}`,
                symbol: sym,
                timeframe: tf,
                chochFailures: failures,
                trendDirection,
                price,
                detectedAt: Date.now(),
              });
            } catch { /* skip */ }
            progress++;
            setScanProgress({ current: progress, total: totalOps });
          }
        }));

        if (i + BATCH < symbols.length) {
          await new Promise(r => setTimeout(r, 50));
        }
      }

      setResults(newResults);
      setLastScanTime(Date.now());
    } catch (err) {
      console.error('CHoCH scan error:', err);
    } finally {
      scanningRef.current = false;
      setScanning(false);
    }
  }, []);

  const groupByTimeframe = useCallback((items: ChochResult[]): ChochGroup[] => {
    const groups: ChochGroup[] = [];
    for (const tf of SCAN_TIMEFRAMES) {
      const tfResults = items
        .filter(r => r.timeframe === tf)
        .sort((a, b) => b.chochFailures - a.chochFailures);
      if (tfResults.length > 0) {
        groups.push({ timeframe: tf, label: TIMEFRAME_LABELS[tf], results: tfResults });
      }
    }
    return groups;
  }, []);

  return { results, scanning, scanProgress, lastScanTime, runScan, groupByTimeframe };
}
