import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppLayout } from "@/components/AppLayout";
import { ScannerProvider } from "@/contexts/ScannerContext";
import { PatternScannerProvider } from "@/contexts/PatternScannerContext";
import { RangeScannerProvider } from "@/contexts/RangeScannerContext";
import Dashboard from "./pages/Dashboard.tsx";
import RangeScanner from "./pages/RangeScanner.tsx";
import CandlestickPatterns from "./pages/CandlestickPatterns.tsx";
import ChartPatterns from "./pages/ChartPatterns.tsx";
import MarketStructure from "./pages/MarketStructure.tsx";
import Confluence from "./pages/Confluence.tsx";
import TradePlanner from "./pages/TradePlanner.tsx";
import MarketOverview from "./pages/MarketOverview.tsx";
import MultiTimeframe from "./pages/MultiTimeframe.tsx";
import Heatmap from "./pages/Heatmap.tsx";
import SupplyDemand from "./pages/SupplyDemand.tsx";
import VolatilityRanking from "./pages/VolatilityRanking.tsx";
import SymbolDetail from "./pages/SymbolDetail.tsx";
import FundingRates from "./pages/FundingRates.tsx";
import CorrelationMatrix from "./pages/CorrelationMatrix.tsx";
import SectorRotation from "./pages/SectorRotation.tsx";
import IndicatorScanner from "./pages/IndicatorScanner.tsx";
import ReversalScanner from "./pages/ReversalScanner.tsx";
import MomentumScanner from "./pages/MomentumScanner.tsx";
import BreakoutScanner from "./pages/BreakoutScanner.tsx";
import NotFound from "./pages/NotFound.tsx";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <ScannerProvider>
        <PatternScannerProvider>
          <RangeScannerProvider>
            <BrowserRouter>
              <Routes>
                <Route element={<AppLayout />}>
                  <Route path="/" element={<Dashboard />} />
                  <Route path="/range-scanner" element={<RangeScanner />} />
                  <Route path="/candlestick-patterns" element={<CandlestickPatterns />} />
                  <Route path="/chart-patterns" element={<ChartPatterns />} />
                  <Route path="/market-structure" element={<MarketStructure />} />
                  <Route path="/confluence" element={<Confluence />} />
                  <Route path="/trade-planner" element={<TradePlanner />} />
                  <Route path="/market-overview" element={<MarketOverview />} />
                  <Route path="/multi-timeframe" element={<MultiTimeframe />} />
                  <Route path="/mtf" element={<MultiTimeframe />} />
                  <Route path="/heatmap" element={<Heatmap />} />
                  <Route path="/supply-demand" element={<SupplyDemand />} />
                  <Route path="/volatility" element={<VolatilityRanking />} />
                  <Route path="/symbol/:symbol" element={<SymbolDetail />} />
                  <Route path="/funding-rates" element={<FundingRates />} />
                  <Route path="/funding" element={<FundingRates />} />
                  <Route path="/correlation" element={<CorrelationMatrix />} />
                  <Route path="/sector-rotation" element={<SectorRotation />} />
                  <Route path="/sectors" element={<SectorRotation />} />
                  <Route path="/indicator-scanner" element={<IndicatorScanner />} />
                  <Route path="/reversals" element={<ReversalScanner />} />
                  <Route path="/momentum" element={<MomentumScanner />} />
                  <Route path="/breakouts" element={<BreakoutScanner />} />
                </Route>
                <Route path="*" element={<NotFound />} />
              </Routes>
            </BrowserRouter>
          </RangeScannerProvider>
        </PatternScannerProvider>
      </ScannerProvider>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
