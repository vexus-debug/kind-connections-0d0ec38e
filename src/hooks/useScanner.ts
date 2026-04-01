import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { fetchTickers, fetchKlines } from '@/lib/bybit-api';
import { analyzeTrend } from '@/lib/indicators';
import { shouldAlert, createAlert, sendBrowserNotification } from '@/lib/alerts';
import type {
  AssetTrend,
  AlertEntry,
  ScannerSettings,
  Timeframe,
  WatchlistItem,
} from '@/types/scanner';
import { ALL_TIMEFRAMES } from '@/types/scanner';

const MAX_ALERTS = 200;
const TOP_SYMBOLS_COUNT = 50;
const BATCH_SIZE = 6;
const DB_POLL_INTERVAL = 30_000; // check DB every 30s for fresh server results

export function useScanner(settings: ScannerSettings, watchlist: WatchlistItem[]) {
  const [assets, setAssets] = useState<Map<string, AssetTrend>>(new Map());
  const [alerts, setAlerts] = useState<AlertEntry[]>([]);
  const [scanning, setScanning] = useState(false);
  const [lastScanTime, setLastScanTime] = useState<number>(0);
  const [scanProgress, setScanProgress] = useState({ current: 0, total: 0 });
  const [serverScanTime, setServerScanTime] = useState<number>(0);
  const intervalRef = useRef<ReturnType<typeof setInterval>>();
  const pollRef = useRef<ReturnType<typeof setInterval>>();
  const scanningRef = useRef(false);

  // Load cached results from DB on mount and poll for updates
  const loadFromDB = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('scan_cache')
        .select('id, data, scanned_at')
        .in('id', ['trends', 'alerts']);

      if (error || !data) return false;

      const trendsRow = data.find((r: any) => r.id === 'trends');
      const alertsRow = data.find((r: any) => r.id === 'alerts');

      if (trendsRow && Array.isArray(trendsRow.data) && trendsRow.data.length > 0) {
        const serverTime = new Date(trendsRow.scanned_at).getTime();
        
        // Only update if server data is newer than what we have
        if (serverTime > serverScanTime) {
          const newAssets = new Map<string, AssetTrend>();
          for (const asset of trendsRow.data as unknown as AssetTrend[]) {
            newAssets.set(asset.symbol, asset);
          }
          setAssets(newAssets);
          setLastScanTime(serverTime);
          setServerScanTime(serverTime);
        }
      }

      if (alertsRow && Array.isArray(alertsRow.data) && alertsRow.data.length > 0) {
        const serverTime = new Date(alertsRow.scanned_at).getTime();
        if (serverTime > serverScanTime) {
          setAlerts(prev => {
            // Merge server alerts with local, dedup by id
            const existing = new Set(prev.map(a => a.id));
            const newAlerts = (alertsRow.data as unknown as AlertEntry[]).filter(a => !existing.has(a.id));
            return [...newAlerts, ...prev].slice(0, MAX_ALERTS);
          });
        }
      }

      return true;
    } catch (err) {
      console.error('Failed to load from DB:', err);
      return false;
    }
  }, [serverScanTime]);

  // Initial load from DB
  useEffect(() => {
    loadFromDB();
    // Poll DB for server updates
    pollRef.current = setInterval(loadFromDB, DB_POLL_INTERVAL);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [loadFromDB]);

  const addAlert = useCallback(
    (alert: AlertEntry) => {
      setAlerts((prev) => [alert, ...prev].slice(0, MAX_ALERTS));

      if (settings.browserNotifications) {
        const isWatched = watchlist.find((w) => w.symbol === alert.symbol && w.alertsEnabled);
        if (isWatched) {
          sendBrowserNotification(alert);
        }
      }
    },
    [settings.browserNotifications, watchlist]
  );

  const scanSymbol = useCallback(
    async (
      symbol: string,
      category: 'spot' | 'linear',
      price: number,
      change24h: number,
      volume24h: number,
      timeframes: Timeframe[]
    ) => {
      const signals: AssetTrend['signals'] = {};

      for (const tf of timeframes) {
        try {
          const candles = await fetchKlines(symbol, tf, category);
          if (candles.length < 50) continue;

          const signal = analyzeTrend(candles, settings.emaPeriods, settings.adxThreshold);
          if (signal) {
            signals[tf] = signal;

            const meetsStrength =
              settings.minStrength === 'weak' ||
              (settings.minStrength === 'moderate' && signal.strength !== 'weak') ||
              (settings.minStrength === 'strong' && signal.strength === 'strong');

            if (meetsStrength && shouldAlert(symbol, tf, signal.direction)) {
              const alert = createAlert(symbol, tf, signal.direction, signal.strength, price, signal.score);
              addAlert(alert);
            }
          }
        } catch {
          // Skip failed timeframes
        }
      }

      return { symbol, price, change24h, volume24h, signals, lastUpdated: Date.now(), marketType: category } as AssetTrend;
    },
    [settings, addAlert]
  );

  // Manual scan (triggered by user clicking refresh button)
  const runScan = useCallback(async () => {
    if (scanningRef.current) return;
    scanningRef.current = true;
    setScanning(true);

    try {
      const categories: ('spot' | 'linear')[] =
        settings.marketFilter === 'both' ? ['linear', 'spot'] :
        [settings.marketFilter];

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
              allSymbols.push({
                symbol: t.symbol,
                category: cat,
                price: parseFloat(t.lastPrice),
                change: parseFloat(t.price24hPcnt) * 100,
                vol: parseFloat(t.volume24h),
              });
            }
          }
        } catch (err) {
          console.error(`Failed to fetch tickers for ${cat}:`, err);
        }
      }

      const symbolMap = new Map<string, typeof allSymbols[0]>();
      for (const s of allSymbols) {
        if (!symbolMap.has(s.symbol) || s.category === 'linear') {
          symbolMap.set(s.symbol, s);
        }
      }

      const uniqueSymbols = Array.from(symbolMap.values());
      setScanProgress({ current: 0, total: uniqueSymbols.length });

      const newAssets = new Map<string, AssetTrend>();

      for (let i = 0; i < uniqueSymbols.length; i += BATCH_SIZE) {
        const batch = uniqueSymbols.slice(i, i + BATCH_SIZE);
        const results = await Promise.all(
          batch.map((s) => scanSymbol(s.symbol, s.category, s.price, s.change, s.vol, ALL_TIMEFRAMES))
        );
        for (const result of results) {
          newAssets.set(result.symbol, result);
        }
        setScanProgress({ current: Math.min(i + BATCH_SIZE, uniqueSymbols.length), total: uniqueSymbols.length });

        if (i + BATCH_SIZE < uniqueSymbols.length) {
          await new Promise((r) => setTimeout(r, 100));
        }
      }

      setAssets(newAssets);
      setLastScanTime(Date.now());
    } catch (err) {
      console.error('Scan error:', err);
    } finally {
      scanningRef.current = false;
      setScanning(false);
    }
  }, [settings, scanSymbol]);

  // No longer auto-scan on mount — we load from DB instead.
  // Only manual scans via the runScan button.

  const clearAlerts = useCallback(() => setAlerts([]), []);

  return {
    assets: Array.from(assets.values()),
    alerts,
    scanning,
    lastScanTime,
    scanProgress,
    clearAlerts,
    runScan,
  };
}
