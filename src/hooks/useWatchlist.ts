import { useState, useCallback } from 'react';
import type { WatchlistItem } from '@/types/scanner';

const STORAGE_KEY = 'bybit-scanner-watchlist';

function loadWatchlist(): WatchlistItem[] {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved ? JSON.parse(saved) : [];
  } catch {
    return [];
  }
}

export function useWatchlist() {
  const [watchlist, setWatchlist] = useState<WatchlistItem[]>(loadWatchlist);

  const save = (items: WatchlistItem[]) => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  };

  const addToWatchlist = useCallback((symbol: string) => {
    setWatchlist((prev) => {
      if (prev.find((w) => w.symbol === symbol)) return prev;
      const next = [...prev, { symbol, alertsEnabled: true, addedAt: Date.now() }];
      save(next);
      return next;
    });
  }, []);

  const removeFromWatchlist = useCallback((symbol: string) => {
    setWatchlist((prev) => {
      const next = prev.filter((w) => w.symbol !== symbol);
      save(next);
      return next;
    });
  }, []);

  const toggleAlerts = useCallback((symbol: string) => {
    setWatchlist((prev) => {
      const next = prev.map((w) => (w.symbol === symbol ? { ...w, alertsEnabled: !w.alertsEnabled } : w));
      save(next);
      return next;
    });
  }, []);

  const isWatched = useCallback((symbol: string) => watchlist.some((w) => w.symbol === symbol), [watchlist]);

  return { watchlist, addToWatchlist, removeFromWatchlist, toggleAlerts, isWatched };
}
