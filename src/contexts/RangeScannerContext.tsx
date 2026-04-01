import { createContext, useContext, ReactNode } from 'react';
import { useRangeScanner } from '@/hooks/useRangeScanner';

type RangeScannerContextType = ReturnType<typeof useRangeScanner>;

const RangeScannerContext = createContext<RangeScannerContextType | null>(null);

export function RangeScannerProvider({ children }: { children: ReactNode }) {
  const hook = useRangeScanner();
  return (
    <RangeScannerContext.Provider value={hook}>
      {children}
    </RangeScannerContext.Provider>
  );
}

export function useSharedRangeScanner(): RangeScannerContextType {
  const ctx = useContext(RangeScannerContext);
  if (!ctx) throw new Error('useSharedRangeScanner must be used within RangeScannerProvider');
  return ctx;
}
