import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { fetchTickers, fetchKlines } from '@/lib/bybit-api';
import { detectCandlestickPatterns, type CandlestickPattern } from '@/lib/candlestick-patterns';
import { detectChartPatterns, type ChartPattern } from '@/lib/chart-patterns';
import { analyzeSmartMoneyConcepts, type SmcEvent, type SmcAnalysis } from '@/lib/smc';
import type { Timeframe, AssetTrend } from '@/types/scanner';
import { TIMEFRAME_LABELS } from '@/types/scanner';

const SCAN_TIMEFRAMES: Timeframe[] = ['5', '15', '60', '240', 'D', 'W'];
const TOP_SYMBOLS = 50;
const MAX_PER_TIMEFRAME = 10;
const DB_POLL_INTERVAL = 30_000;

export interface DetectedPattern {
  id: string;
  symbol: string;
  timeframe: Timeframe;
  pattern: CandlestickPattern | ChartPattern | SmcEvent;
  price: number;
  detectedAt: number;
  formedAt: number;
  category: 'candlestick' | 'chart' | 'structure';
  trendAligned?: boolean;
}

export interface PatternGroup {
  timeframe: Timeframe;
  label: string;
  patterns: DetectedPattern[];
}

function adjustSignificance(
  baseSig: 'high' | 'medium' | 'low',
  patternType: string,
  symbol: string,
  tf: Timeframe,
  trendAssets: AssetTrend[]
): { significance: 'high' | 'medium' | 'low'; aligned: boolean } {
  const fullSymbol = symbol.includes('USDT') ? symbol : `${symbol}USDT`;
  const asset = trendAssets.find(a => a.symbol === fullSymbol);
  if (!asset) return { significance: baseSig, aligned: false };
  const signal = asset.signals[tf];
  if (!signal || !signal.direction) return { significance: baseSig, aligned: false };
  const trendDir = signal.direction;
  const patternDir = patternType === 'bullish' ? 'bull' : patternType === 'bearish' ? 'bear' : null;
  if (!patternDir) return { significance: baseSig, aligned: false };
  const aligned = patternDir === trendDir;
  if (aligned) return { significance: baseSig === 'low' ? 'medium' : 'high', aligned: true };
  return { significance: baseSig === 'high' ? 'medium' : 'low', aligned: false };
}

export function usePatternScanner(trendAssets: AssetTrend[] = []) {
  const [candlestickPatterns, setCandlestickPatterns] = useState<DetectedPattern[]>([]);
  const [chartPatterns, setChartPatterns] = useState<DetectedPattern[]>([]);
  const [structurePatterns, setStructurePatterns] = useState<DetectedPattern[]>([]);
  const [smcAnalysis, setSmcAnalysis] = useState<SmcAnalysis | null>(null);
  const [scanning, setScanning] = useState(false);
  const [lastScanTime, setLastScanTime] = useState<number>(0);
  const [scanProgress, setScanProgress] = useState({ current: 0, total: 0 });
  const [serverScanTime, setServerScanTime] = useState<number>(0);
  const scanningRef = useRef(false);
  const intervalRef = useRef<ReturnType<typeof setInterval>>();
  const pollRef = useRef<ReturnType<typeof setInterval>>();
  const trendAssetsRef = useRef(trendAssets);
  trendAssetsRef.current = trendAssets;

  // Load cached pattern results from DB
  const loadFromDB = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('scan_cache')
        .select('id, data, scanned_at')
        .in('id', ['candlestick', 'chart', 'structure']);

      if (error || !data) return false;

      for (const row of data as any[]) {
        const serverTime = new Date(row.scanned_at).getTime();
        if (serverTime <= serverScanTime) continue;
        
        const patterns = (row.data || []) as unknown as DetectedPattern[];
        if (row.id === 'candlestick') setCandlestickPatterns(patterns);
        else if (row.id === 'chart') setChartPatterns(patterns);
        else if (row.id === 'structure') setStructurePatterns(patterns);
      }

      const maxTime = Math.max(...data.map((r: any) => new Date(r.scanned_at).getTime()));
      if (maxTime > serverScanTime) {
        setServerScanTime(maxTime);
        setLastScanTime(maxTime);
      }

      return true;
    } catch (err) {
      console.error('Failed to load patterns from DB:', err);
      return false;
    }
  }, [serverScanTime]);

  // Initial load from DB + polling
  useEffect(() => {
    loadFromDB();
    pollRef.current = setInterval(loadFromDB, DB_POLL_INTERVAL);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [loadFromDB]);

  // Manual scan (user-triggered)
  const runScan = useCallback(async () => {
    if (scanningRef.current) return;
    scanningRef.current = true;
    setScanning(true);

    try {
      const categories: ('spot' | 'linear')[] = ['linear', 'spot'];
      const symbolMap = new Map<string, { symbol: string; category: 'spot' | 'linear'; price: number }>();

      for (const cat of categories) {
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

      const newCandlestick: DetectedPattern[] = [];
      const newChart: DetectedPattern[] = [];
      const newStructure: DetectedPattern[] = [];
      let progress = 0;
      const currentTrends = trendAssetsRef.current;

      const BATCH = 8;
      for (let i = 0; i < symbols.length; i += BATCH) {
        const batch = symbols.slice(i, i + BATCH);
        await Promise.all(batch.map(async ({ symbol, category, price }) => {
          for (const tf of SCAN_TIMEFRAMES) {
            try {
              const candles = await fetchKlines(symbol, tf, category);
              if (candles.length < 20) { progress++; continue; }

              // Exclude last (incomplete) candle for pattern detection
              const closedCandles = candles.slice(0, -1);
              if (closedCandles.length < 20) { progress++; continue; }

              const now = Date.now();
              const sym = symbol.replace('USDT', '');

              const cPatterns = detectCandlestickPatterns(closedCandles, false); // already sliced
              for (const p of cPatterns) {
                const candleTime = (p.candleIndex >= 0 && p.candleIndex < closedCandles.length) ? closedCandles[p.candleIndex].time : 0;
                const formedAt = candleTime > 0 ? candleTime : (closedCandles[closedCandles.length - 1]?.time ?? now);
                const { significance, aligned } = adjustSignificance(p.significance, p.type, sym, tf, currentTrends);
                // High-probability filter: only keep high significance, or medium+trend-aligned
                if (significance === 'low') continue;
                if (significance === 'medium' && !aligned && p.type === 'neutral') continue;
                newCandlestick.push({ id: `cs-${symbol}-${tf}-${p.name}-${now}`, symbol: sym, timeframe: tf, pattern: { ...p, significance }, price, detectedAt: now, formedAt, category: 'candlestick', trendAligned: aligned });
              }

              const chPatterns = detectChartPatterns(closedCandles);
              for (const p of chPatterns) {
                const candleTime = (p.endIndex >= 0 && p.endIndex < closedCandles.length) ? closedCandles[p.endIndex].time : 0;
                const formedAt = candleTime > 0 ? candleTime : (closedCandles[closedCandles.length - 1]?.time ?? now);
                const { significance, aligned } = adjustSignificance(p.significance, p.type, sym, tf, currentTrends);
                newChart.push({ id: `ch-${symbol}-${tf}-${p.name}-${now}`, symbol: sym, timeframe: tf, pattern: { ...p, significance }, price, detectedAt: now, formedAt, category: 'chart', trendAligned: aligned });
              }

              const smcResult = analyzeSmartMoneyConcepts(closedCandles);
              // Store the latest analysis for the dashboard (from highest-volume symbol)
              if (tf === '60' || tf === '240') {
                setSmcAnalysis(prev => prev && prev.events.length > smcResult.events.length ? prev : smcResult);
              }
              for (const p of smcResult.events) {
                const candleTime = (p.candleIndex >= 0 && p.candleIndex < closedCandles.length) ? closedCandles[p.candleIndex].time : 0;
                const formedAt = candleTime > 0 ? candleTime : (closedCandles[closedCandles.length - 1]?.time ?? now);
                const { significance, aligned } = adjustSignificance(p.significance, p.type, sym, tf, currentTrends);
                newStructure.push({ id: `ms-${symbol}-${tf}-${p.name}-${now}`, symbol: sym, timeframe: tf, pattern: { ...p, significance }, price, detectedAt: now, formedAt, category: 'structure', trendAligned: aligned });
              }
            } catch { /* skip */ }
            progress++;
            setScanProgress({ current: progress, total: totalOps });
          }
        }));

        if (i + BATCH < symbols.length) {
          await new Promise(r => setTimeout(r, 100));
        }
      }

      setCandlestickPatterns(newCandlestick);
      setChartPatterns(newChart);
      setStructurePatterns(newStructure);
      setLastScanTime(Date.now());
    } catch (err) {
      console.error('Pattern scan error:', err);
    } finally {
      scanningRef.current = false;
      setScanning(false);
    }
  }, []);

  const groupByTimeframe = (patterns: DetectedPattern[]): PatternGroup[] => {
    const groups: PatternGroup[] = [];
    for (const tf of SCAN_TIMEFRAMES) {
      const tfPatterns = patterns
        .filter(p => p.timeframe === tf)
        .sort((a, b) => {
          const timeDiff = b.formedAt - a.formedAt;
          if (timeDiff !== 0) return timeDiff;
          if (a.trendAligned !== b.trendAligned) return a.trendAligned ? -1 : 1;
          const sigOrder = { high: 0, medium: 1, low: 2 };
          return sigOrder[a.pattern.significance] - sigOrder[b.pattern.significance];
        })
        .slice(0, MAX_PER_TIMEFRAME);
      if (tfPatterns.length > 0) {
        groups.push({ timeframe: tf, label: TIMEFRAME_LABELS[tf], patterns: tfPatterns });
      }
    }
    return groups;
  };

  return {
    candlestickPatterns,
    chartPatterns,
    structurePatterns,
    smcAnalysis,
    candlestickGroups: groupByTimeframe(candlestickPatterns),
    chartGroups: groupByTimeframe(chartPatterns),
    structureGroups: groupByTimeframe(structurePatterns),
    scanning,
    lastScanTime,
    scanProgress,
    runScan,
  };
}
