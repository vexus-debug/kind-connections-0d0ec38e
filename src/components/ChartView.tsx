import { useEffect, useRef, useState, useCallback } from 'react';
import { createChart, CandlestickSeries, HistogramSeries, LineSeries, type IChartApi, type ISeriesApi, ColorType, LineStyle } from 'lightweight-charts';
import { fetchKlines } from '@/lib/bybit-api';
import type { Candle, Timeframe } from '@/types/scanner';
import { TIMEFRAME_LABELS, ALL_TIMEFRAMES } from '@/types/scanner';
import { X, Maximize2, Minimize2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { buildPatternDrawing, type PatternDrawing } from '@/lib/pattern-drawing';

export interface PatternHighlight {
  name: string;
  category: 'candlestick' | 'chart' | 'structure';
}

interface ChartViewProps {
  symbol: string;
  initialTimeframe?: Timeframe;
  onClose?: () => void;
  supportLevels?: number[];
  resistanceLevels?: number[];
  patternHighlight?: PatternHighlight;
}

export function ChartView({
  symbol, initialTimeframe = '60', onClose,
  supportLevels = [], resistanceLevels = [],
  patternHighlight,
}: ChartViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<any>(null);
  const volumeSeriesRef = useRef<any>(null);
  const emaSeriesRefs = useRef<any[]>([]);
  const patternSeriesRefs = useRef<any[]>([]);
  const [timeframe, setTimeframe] = useState<Timeframe>(initialTimeframe);
  const [loading, setLoading] = useState(true);
  const [candles, setCandles] = useState<Candle[]>([]);
  const [showEMAs, setShowEMAs] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [patternDrawing, setPatternDrawing] = useState<PatternDrawing | null>(null);

  // Create chart
  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: 'hsl(0, 0%, 4%)' },
        textColor: 'hsl(0, 0%, 45%)',
        fontSize: 10,
      },
      grid: {
        vertLines: { color: 'hsl(0, 0%, 10%)' },
        horzLines: { color: 'hsl(0, 0%, 10%)' },
      },
      crosshair: {
        mode: 0,
        vertLine: { color: 'hsl(0, 0%, 30%)', style: LineStyle.Dashed, width: 1, labelBackgroundColor: 'hsl(0, 0%, 15%)' },
        horzLine: { color: 'hsl(0, 0%, 30%)', style: LineStyle.Dashed, width: 1, labelBackgroundColor: 'hsl(0, 0%, 15%)' },
      },
      rightPriceScale: {
        borderColor: 'hsl(0, 0%, 14%)',
        scaleMargins: { top: 0.1, bottom: 0.2 },
      },
      timeScale: {
        borderColor: 'hsl(0, 0%, 14%)',
        timeVisible: true,
        secondsVisible: false,
      },
    });

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: 'hsl(142, 72%, 45%)',
      downColor: 'hsl(0, 72%, 50%)',
      borderDownColor: 'hsl(0, 72%, 50%)',
      borderUpColor: 'hsl(142, 72%, 45%)',
      wickDownColor: 'hsl(0, 72%, 40%)',
      wickUpColor: 'hsl(142, 72%, 35%)',
    });

    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceFormat: { type: 'volume' },
      priceScaleId: 'volume',
    });

    chart.priceScale('volume').applyOptions({
      scaleMargins: { top: 0.85, bottom: 0 },
    });

    chartRef.current = chart;
    candleSeriesRef.current = candleSeries;
    volumeSeriesRef.current = volumeSeries;

    const handleResize = () => {
      if (containerRef.current) {
        chart.applyOptions({ width: containerRef.current.clientWidth, height: containerRef.current.clientHeight });
      }
    };

    const ro = new ResizeObserver(handleResize);
    ro.observe(containerRef.current);

    return () => {
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
    };
  }, []);

  // Load data when symbol/timeframe changes
  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchKlines(symbol, timeframe, 'linear', 220);
      if (data.length === 0) {
        const spotData = await fetchKlines(symbol, timeframe, 'spot', 220);
        setCandles(spotData);
      } else {
        setCandles(data);
      }
    } catch (err) {
      console.error('Failed to load chart data:', err);
    } finally {
      setLoading(false);
    }
  }, [symbol, timeframe]);

  useEffect(() => { loadData(); }, [loadData]);

  // Build pattern drawing when candles load and pattern is specified
  useEffect(() => {
    if (!patternHighlight || candles.length < 20) {
      setPatternDrawing(null);
      return;
    }
    const drawing = buildPatternDrawing(candles, patternHighlight.name, patternHighlight.category);
    setPatternDrawing(drawing);
  }, [candles, patternHighlight]);

  // Update chart data
  useEffect(() => {
    const chart = chartRef.current;
    if (!candleSeriesRef.current || !volumeSeriesRef.current || !chart || candles.length === 0) return;

    // Remove old EMA series
    for (const s of emaSeriesRefs.current) {
      try { chart.removeSeries(s); } catch {}
    }
    emaSeriesRefs.current = [];

    // Remove old pattern series
    for (const s of patternSeriesRefs.current) {
      try { chart.removeSeries(s); } catch {}
    }
    patternSeriesRefs.current = [];

    const candleData = candles.map(c => ({
      time: (c.time / 1000) as any,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
    }));

    const volumeData = candles.map(c => ({
      time: (c.time / 1000) as any,
      value: c.volume,
      color: c.close >= c.open ? 'rgba(76, 175, 80, 0.3)' : 'rgba(244, 67, 54, 0.3)',
    }));

    candleSeriesRef.current.setData(candleData);
    volumeSeriesRef.current.setData(volumeData);

    // Support lines
    for (const level of supportLevels) {
      candleSeriesRef.current.createPriceLine({
        price: level,
        color: 'hsl(142, 72%, 45%)',
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: 'S',
      });
    }

    // Resistance lines
    for (const level of resistanceLevels) {
      candleSeriesRef.current.createPriceLine({
        price: level,
        color: 'hsl(0, 72%, 50%)',
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: 'R',
      });
    }

    // EMA overlays
    if (showEMAs && candles.length > 50) {
      const closes = candles.map(c => c.close);
      const ema9 = calcEMAForChart(closes, 9);
      const ema21 = calcEMAForChart(closes, 21);
      const ema50 = calcEMAForChart(closes, 50);

      const ema9Series = chart.addSeries(LineSeries, { color: 'hsl(45, 90%, 55%)', lineWidth: 1, priceLineVisible: false, lastValueVisible: false });
      const ema21Series = chart.addSeries(LineSeries, { color: 'hsl(217, 90%, 60%)', lineWidth: 1, priceLineVisible: false, lastValueVisible: false });
      const ema50Series = chart.addSeries(LineSeries, { color: 'hsl(280, 72%, 55%)', lineWidth: 1, priceLineVisible: false, lastValueVisible: false });

      ema9Series.setData(ema9.map((v, i) => ({ time: (candles[i].time / 1000) as any, value: v })).filter((d: any) => d.value > 0));
      ema21Series.setData(ema21.map((v, i) => ({ time: (candles[i].time / 1000) as any, value: v })).filter((d: any) => d.value > 0));
      ema50Series.setData(ema50.map((v, i) => ({ time: (candles[i].time / 1000) as any, value: v })).filter((d: any) => d.value > 0));

      emaSeriesRefs.current = [ema9Series, ema21Series, ema50Series];
    }

    // Pattern overlay lines
    if (patternDrawing) {
      for (const line of patternDrawing.lines) {
        const lineSeries = chart.addSeries(LineSeries, {
          color: line.color,
          lineWidth: line.width as 1 | 2 | 3 | 4,
          lineStyle: line.style === 'dashed' ? LineStyle.Dashed : LineStyle.Solid,
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: false,
        });
        lineSeries.setData([
          { time: line.startTime as any, value: line.startPrice },
          { time: line.endTime as any, value: line.endPrice },
        ]);
        patternSeriesRefs.current.push(lineSeries);
      }

      // Pattern markers on candle series
      if (patternDrawing.markers.length > 0) {
        const markers = patternDrawing.markers
          .map(m => ({
            time: m.time as any,
            position: m.position,
            color: m.color,
            shape: m.shape,
            text: m.text,
          }))
          .sort((a: any, b: any) => a.time - b.time);
        candleSeriesRef.current.setMarkers(markers);
      }

      // Zone overlays (rendered as area between two line series)
      for (const zone of patternDrawing.zones) {
        const upperLine = chart.addSeries(LineSeries, {
          color: zone.color,
          lineWidth: 1,
          lineStyle: LineStyle.Dotted,
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: false,
        });
        const lowerLine = chart.addSeries(LineSeries, {
          color: zone.color,
          lineWidth: 1,
          lineStyle: LineStyle.Dotted,
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: false,
        });
        upperLine.setData([
          { time: zone.startTime as any, value: zone.highPrice },
          { time: zone.endTime as any, value: zone.highPrice },
        ]);
        lowerLine.setData([
          { time: zone.startTime as any, value: zone.lowPrice },
          { time: zone.endTime as any, value: zone.lowPrice },
        ]);
        patternSeriesRefs.current.push(upperLine, lowerLine);
      }
    }

    chart.timeScale().fitContent();
  }, [candles, supportLevels, resistanceLevels, showEMAs, patternDrawing]);

  return (
    <div className={`flex flex-col bg-background border border-border rounded-lg overflow-hidden ${isFullscreen ? 'fixed inset-0 z-50' : 'h-full'}`}>
      {/* Chart header */}
      <div className="flex items-center justify-between border-b border-border px-3 py-1.5">
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold">{symbol.replace('USDT', '')}/USDT</span>
          {patternDrawing && (
            <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded ${
              patternDrawing.type === 'bullish' ? 'bg-primary/20 text-primary' :
              patternDrawing.type === 'bearish' ? 'bg-destructive/20 text-destructive' :
              'bg-accent/20 text-accent'
            }`}>
              {patternDrawing.label}
            </span>
          )}
          {loading && <span className="h-1.5 w-1.5 rounded-full bg-accent animate-pulse-dot" />}
        </div>
        <div className="flex items-center gap-1">
          {ALL_TIMEFRAMES.map(tf => (
            <button
              key={tf}
              onClick={() => setTimeframe(tf)}
              className={`rounded px-1.5 py-0.5 text-[9px] font-medium transition-colors ${
                timeframe === tf ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {TIMEFRAME_LABELS[tf]}
            </button>
          ))}
          <div className="w-px h-4 bg-border mx-1" />
          <button
            onClick={() => setShowEMAs(!showEMAs)}
            className={`rounded px-1.5 py-0.5 text-[9px] transition-colors ${showEMAs ? 'bg-accent/20 text-accent' : 'text-muted-foreground'}`}
          >
            EMA
          </button>
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setIsFullscreen(!isFullscreen)}>
            {isFullscreen ? <Minimize2 className="h-3 w-3" /> : <Maximize2 className="h-3 w-3" />}
          </Button>
          {onClose && (
            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onClose}>
              <X className="h-3 w-3" />
            </Button>
          )}
        </div>
      </div>

      {/* Chart container */}
      <div ref={containerRef} className="flex-1 min-h-[300px]" />
    </div>
  );
}

function calcEMAForChart(closes: number[], period: number): number[] {
  const result = new Array(closes.length).fill(0);
  if (closes.length < period) return result;

  let sum = 0;
  for (let i = 0; i < period; i++) sum += closes[i];
  result[period - 1] = sum / period;

  const k = 2 / (period + 1);
  for (let i = period; i < closes.length; i++) {
    result[i] = closes[i] * k + result[i - 1] * (1 - k);
  }

  return result;
}
