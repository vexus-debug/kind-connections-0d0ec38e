import { PatternPageShell } from '@/components/PatternPageShell';
import { useSharedPatternScanner } from '@/contexts/PatternScannerContext';

const CandlestickPatternsPage = () => {
  const { candlestickGroups, scanning, lastScanTime, scanProgress, runScan } = useSharedPatternScanner();

  return (
    <PatternPageShell
      title="Candlestick Patterns"
      subtitle="Doji, Engulfing, Hammer, Morning Star, and more"
      groups={candlestickGroups}
      scanning={scanning}
      lastScanTime={lastScanTime}
      scanProgress={scanProgress}
      onRescan={runScan}
    />
  );
};

export default CandlestickPatternsPage;
