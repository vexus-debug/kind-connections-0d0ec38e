import { createContext, useContext, ReactNode } from 'react';
import { useScanner } from '@/hooks/useScanner';
import { useSettings } from '@/hooks/useSettings';
import { useWatchlist } from '@/hooks/useWatchlist';

type ScannerContextType = ReturnType<typeof useScanner> &
  ReturnType<typeof useSettings> &
  ReturnType<typeof useWatchlist>;

const ScannerContext = createContext<ScannerContextType | null>(null);

export function ScannerProvider({ children }: { children: ReactNode }) {
  const settingsHook = useSettings();
  const watchlistHook = useWatchlist();
  const scannerHook = useScanner(settingsHook.settings, watchlistHook.watchlist);

  return (
    <ScannerContext.Provider value={{ ...scannerHook, ...settingsHook, ...watchlistHook }}>
      {children}
    </ScannerContext.Provider>
  );
}

export function useSharedScanner(): ScannerContextType {
  const ctx = useContext(ScannerContext);
  if (!ctx) throw new Error('useSharedScanner must be used within ScannerProvider');
  return ctx;
}
