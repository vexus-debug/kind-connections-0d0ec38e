import { createContext, useContext, ReactNode } from 'react';
import { usePatternScanner } from '@/hooks/usePatternScanner';
import { useSharedScanner } from '@/contexts/ScannerContext';

type PatternScannerContextType = ReturnType<typeof usePatternScanner>;

const PatternScannerContext = createContext<PatternScannerContextType | null>(null);

export function PatternScannerProvider({ children }: { children: ReactNode }) {
  const { assets } = useSharedScanner();
  const scanner = usePatternScanner(assets);
  return (
    <PatternScannerContext.Provider value={scanner}>
      {children}
    </PatternScannerContext.Provider>
  );
}

export function useSharedPatternScanner(): PatternScannerContextType {
  const ctx = useContext(PatternScannerContext);
  if (!ctx) throw new Error('useSharedPatternScanner must be used within PatternScannerProvider');
  return ctx;
}
