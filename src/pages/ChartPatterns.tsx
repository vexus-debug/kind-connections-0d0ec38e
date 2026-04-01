import { PatternPageShell } from '@/components/PatternPageShell';
import { useSharedPatternScanner } from '@/contexts/PatternScannerContext';

const ChartPatternsPage = () => {
  const { chartGroups, scanning, lastScanTime, scanProgress, runScan } = useSharedPatternScanner();

  return (
    <PatternPageShell
      title="Chart Patterns"
      subtitle="Triangles, H&S, Wedges, Channels, Double Top/Bottom"
      groups={chartGroups}
      scanning={scanning}
      lastScanTime={lastScanTime}
      scanProgress={scanProgress}
      onRescan={runScan}
    />
  );
};

export default ChartPatternsPage;
