import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { fetchTickers, fetchKlines } from '@/lib/bybit-api';
import type { AssetRange, RangeSignal } from '@/types/range-scanner';
import type { Timeframe } from '@/types/scanner';
import { ALL_TIMEFRAMES } from '@/types/scanner';
import { analyzeRange } from '@/lib/indicators/range';

const DB_POLL_INTERVAL = 30_000;
const TOP_SYMBOLS_COUNT = 50;
const BATCH_SIZE = 6;

export function useRangeScanner() {
  const [assets, setAssets] = useState<AssetRange[]>([]);
  const [scanning, setScanning] = useState(false);
  const [lastScanTime, setLastScanTime] = useState<number>(0);
  const [scanProgress, setScanProgress] = useState({ current: 0, total: 0 });
  const [serverScanTime, setServerScanTime] = useState<number>(0);
  const pollRef = useRef<ReturnType<typeof setInterval>>();
  const scanningRef = useRef(false);

  const loadFromDB = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('scan_cache')
        .select('id, data, scanned_at')
        .eq('id', 'ranges');

      if (error || !data || data.length === 0) return;

      const row = data[0];
      if (row && Array.isArray(row.data) && row.data.length > 0) {
        const serverTime = new Date(row.scanned_at).getTime();
        if (serverTime > serverScanTime) {
          setAssets(row.data as unknown as AssetRange[]);
          setLastScanTime(serverTime);
          setServerScanTime(serverTime);
        }
      }
    } catch (err) {
      console.error('Failed to load ranges from DB:', err);
    }
  }, [serverScanTime]);

  useEffect(() => {
    loadFromDB();
    pollRef.current = setInterval(loadFromDB, DB_POLL_INTERVAL);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [loadFromDB]);

  const runScan = useCallback(async () => {
    if (scanningRef.current) return;
    scanningRef.current = true;
    setScanning(true);

    try {
      const categories: ('spot' | 'linear')[] = ['linear', 'spot'];
      const allSymbols: { symbol: string; category: 'spot' | 'linear'; price: number; change: number; vol: number }[] = [];

      for (const cat of categories) {
        try {
          const tickerData = await fetchTickers(cat);
          if (tickerData.retCode === 0 && tickerData.result?.list) {
            const sorted = tickerData.result.list
              .filter((t) => t.symbol.endsWith('USDT'))
              .sort((a, b) => parseFloat(b.turnover24h) - parseFloat(a.turnover24h))
              .slice(0, TOP_SYMBOLS_COUNT);
            for (const t of sorted) {
              allSymbols.push({ symbol: t.symbol, category: cat, price: parseFloat(t.lastPrice), change: parseFloat(t.price24hPcnt) * 100, vol: parseFloat(t.volume24h) });
            }
          }
        } catch (err) {
          console.error(`Failed to fetch tickers for ${cat}:`, err);
        }
      }

      const symbolMap = new Map<string, typeof allSymbols[0]>();
      for (const s of allSymbols) {
        if (!symbolMap.has(s.symbol) || s.category === 'linear') symbolMap.set(s.symbol, s);
      }

      const uniqueSymbols = Array.from(symbolMap.values());
      setScanProgress({ current: 0, total: uniqueSymbols.length });
      const newAssets: AssetRange[] = [];

      for (let i = 0; i < uniqueSymbols.length; i += BATCH_SIZE) {
        const batch = uniqueSymbols.slice(i, i + BATCH_SIZE);
        const results = await Promise.all(
          batch.map(async (s) => {
            const signals: AssetRange['signals'] = {};
            for (const tf of ALL_TIMEFRAMES) {
              try {
                const candles = await fetchKlines(s.symbol, tf, s.category);
                if (candles.length < 50) continue;
                const signal = analyzeRange(candles);
                if (signal) signals[tf] = signal;
              } catch { /* skip */ }
            }
            if (Object.keys(signals).length === 0) return null;
            return { symbol: s.symbol, price: s.price, change24h: s.change, volume24h: s.vol, signals, lastUpdated: Date.now(), marketType: s.category } as AssetRange;
          })
        );
        newAssets.push(...results.filter(Boolean) as AssetRange[]);
        setScanProgress({ current: Math.min(i + BATCH_SIZE, uniqueSymbols.length), total: uniqueSymbols.length });
        if (i + BATCH_SIZE < uniqueSymbols.length) await new Promise((r) => setTimeout(r, 100));
      }

      setAssets(newAssets);
      setLastScanTime(Date.now());
    } catch (err) {
      console.error('Range scan error:', err);
    } finally {
      scanningRef.current = false;
      setScanning(false);
    }
  }, []);

  return { assets, scanning, lastScanTime, scanProgress, runScan };
}
