import type { Candle } from '@/types/scanner';
import type { ChartPattern } from '@/lib/chart-patterns';
import type { CandlestickPattern } from '@/lib/candlestick-patterns';
import type { MarketStructureEvent } from '@/lib/market-structure';
import { detectChartPatterns } from '@/lib/chart-patterns';
import { detectCandlestickPatterns } from '@/lib/candlestick-patterns';
import { detectMarketStructure } from '@/lib/market-structure';

export interface PatternDrawing {
  /** Lines to draw on the chart (trendlines, necklines, etc.) */
  lines: PatternLine[];
  /** Markers/labels to place on specific candles */
  markers: PatternMarker[];
  /** Horizontal zones (e.g., FVG, order blocks) */
  zones: PatternZone[];
  /** Pattern label */
  label: string;
  type: 'bullish' | 'bearish' | 'neutral';
}

export interface PatternLine {
  startTime: number; // unix seconds
  startPrice: number;
  endTime: number;
  endPrice: number;
  color: string;
  width: number;
  style: 'solid' | 'dashed';
}

export interface PatternMarker {
  time: number; // unix seconds
  position: 'aboveBar' | 'belowBar';
  color: string;
  shape: 'arrowUp' | 'arrowDown' | 'circle';
  text: string;
}

export interface PatternZone {
  startTime: number;
  endTime: number;
  highPrice: number;
  lowPrice: number;
  color: string;
}

const BULL_COLOR = 'hsl(142, 72%, 45%)';
const BEAR_COLOR = 'hsl(0, 72%, 50%)';
const NEUTRAL_COLOR = 'hsl(45, 90%, 55%)';
const LINE_COLOR = 'hsl(217, 90%, 60%)';

function timeAt(candles: Candle[], idx: number): number {
  const clamped = Math.max(0, Math.min(idx, candles.length - 1));
  return candles[clamped].time / 1000;
}

function findSwingPoints(candles: Candle[], startIdx: number, endIdx: number, type: 'high' | 'low'): { index: number; price: number }[] {
  const points: { index: number; price: number }[] = [];
  const lb = 2;
  for (let i = Math.max(lb, startIdx); i <= Math.min(endIdx, candles.length - 1 - lb); i++) {
    let isSwing = true;
    for (let j = 1; j <= lb; j++) {
      if (type === 'high') {
        if (candles[i].high <= candles[i - j].high || candles[i].high <= candles[i + j].high) { isSwing = false; break; }
      } else {
        if (candles[i].low >= candles[i - j].low || candles[i].low >= candles[i + j].low) { isSwing = false; break; }
      }
    }
    if (isSwing) points.push({ index: i, price: type === 'high' ? candles[i].high : candles[i].low });
  }
  return points;
}

export function buildPatternDrawing(
  candles: Candle[],
  patternName: string,
  category: 'candlestick' | 'chart' | 'structure'
): PatternDrawing | null {
  if (candles.length < 20) return null;

  const closedCandles = candles.slice(0, -1);
  if (closedCandles.length < 20) return null;

  if (category === 'chart') return buildChartPatternDrawing(closedCandles, patternName);
  if (category === 'candlestick') return buildCandlestickDrawing(closedCandles, patternName);
  if (category === 'structure') return buildStructureDrawing(closedCandles, patternName);

  return null;
}

function buildChartPatternDrawing(candles: Candle[], patternName: string): PatternDrawing | null {
  const patterns = detectChartPatterns(candles);
  const match = patterns.find(p => p.name === patternName);
  if (!match) return null;

  const drawing: PatternDrawing = {
    lines: [],
    markers: [],
    zones: [],
    label: match.name,
    type: match.type,
  };

  const color = match.type === 'bullish' ? BULL_COLOR : match.type === 'bearish' ? BEAR_COLOR : NEUTRAL_COLOR;
  const si = match.startIndex;
  const ei = match.endIndex;

  const swingHighs = findSwingPoints(candles, si, ei, 'high');
  const swingLows = findSwingPoints(candles, si, ei, 'low');

  switch (match.name) {
    case 'Double Top': {
      if (swingHighs.length >= 2) {
        const h1 = swingHighs[0], h2 = swingHighs[swingHighs.length - 1];
        // Resistance line connecting the two tops
        drawing.lines.push({
          startTime: timeAt(candles, h1.index), startPrice: h1.price,
          endTime: timeAt(candles, h2.index), endPrice: h2.price,
          color: BEAR_COLOR, width: 2, style: 'solid',
        });
        // Neckline
        if (swingLows.length >= 1) {
          const neck = swingLows.reduce((a, b) => a.price < b.price ? a : b);
          drawing.lines.push({
            startTime: timeAt(candles, si), startPrice: neck.price,
            endTime: timeAt(candles, ei), endPrice: neck.price,
            color: LINE_COLOR, width: 1, style: 'dashed',
          });
        }
        drawing.markers.push(
          { time: timeAt(candles, h1.index), position: 'aboveBar', color: BEAR_COLOR, shape: 'arrowDown', text: 'Top 1' },
          { time: timeAt(candles, h2.index), position: 'aboveBar', color: BEAR_COLOR, shape: 'arrowDown', text: 'Top 2' },
        );
      }
      break;
    }
    case 'Double Bottom': {
      if (swingLows.length >= 2) {
        const l1 = swingLows[0], l2 = swingLows[swingLows.length - 1];
        drawing.lines.push({
          startTime: timeAt(candles, l1.index), startPrice: l1.price,
          endTime: timeAt(candles, l2.index), endPrice: l2.price,
          color: BULL_COLOR, width: 2, style: 'solid',
        });
        if (swingHighs.length >= 1) {
          const neck = swingHighs.reduce((a, b) => a.price > b.price ? a : b);
          drawing.lines.push({
            startTime: timeAt(candles, si), startPrice: neck.price,
            endTime: timeAt(candles, ei), endPrice: neck.price,
            color: LINE_COLOR, width: 1, style: 'dashed',
          });
        }
        drawing.markers.push(
          { time: timeAt(candles, l1.index), position: 'belowBar', color: BULL_COLOR, shape: 'arrowUp', text: 'Bot 1' },
          { time: timeAt(candles, l2.index), position: 'belowBar', color: BULL_COLOR, shape: 'arrowUp', text: 'Bot 2' },
        );
      }
      break;
    }
    case 'Head & Shoulders': {
      if (swingHighs.length >= 3) {
        const [ls, hd, rs] = [swingHighs[0], swingHighs[1], swingHighs[2]];
        // Connect shoulders
        drawing.lines.push({
          startTime: timeAt(candles, ls.index), startPrice: ls.price,
          endTime: timeAt(candles, hd.index), endPrice: hd.price,
          color: BEAR_COLOR, width: 2, style: 'solid',
        });
        drawing.lines.push({
          startTime: timeAt(candles, hd.index), startPrice: hd.price,
          endTime: timeAt(candles, rs.index), endPrice: rs.price,
          color: BEAR_COLOR, width: 2, style: 'solid',
        });
        // Neckline
        if (swingLows.length >= 2) {
          const nl1 = swingLows[0], nl2 = swingLows[swingLows.length - 1];
          drawing.lines.push({
            startTime: timeAt(candles, nl1.index), startPrice: nl1.price,
            endTime: timeAt(candles, nl2.index), endPrice: nl2.price,
            color: LINE_COLOR, width: 1, style: 'dashed',
          });
        }
        drawing.markers.push(
          { time: timeAt(candles, ls.index), position: 'aboveBar', color: BEAR_COLOR, shape: 'circle', text: 'LS' },
          { time: timeAt(candles, hd.index), position: 'aboveBar', color: BEAR_COLOR, shape: 'arrowDown', text: 'Head' },
          { time: timeAt(candles, rs.index), position: 'aboveBar', color: BEAR_COLOR, shape: 'circle', text: 'RS' },
        );
      }
      break;
    }
    case 'Inverse H&S': {
      if (swingLows.length >= 3) {
        const [ls, hd, rs] = [swingLows[0], swingLows[1], swingLows[2]];
        drawing.lines.push({
          startTime: timeAt(candles, ls.index), startPrice: ls.price,
          endTime: timeAt(candles, hd.index), endPrice: hd.price,
          color: BULL_COLOR, width: 2, style: 'solid',
        });
        drawing.lines.push({
          startTime: timeAt(candles, hd.index), startPrice: hd.price,
          endTime: timeAt(candles, rs.index), endPrice: rs.price,
          color: BULL_COLOR, width: 2, style: 'solid',
        });
        if (swingHighs.length >= 2) {
          const nl1 = swingHighs[0], nl2 = swingHighs[swingHighs.length - 1];
          drawing.lines.push({
            startTime: timeAt(candles, nl1.index), startPrice: nl1.price,
            endTime: timeAt(candles, nl2.index), endPrice: nl2.price,
            color: LINE_COLOR, width: 1, style: 'dashed',
          });
        }
        drawing.markers.push(
          { time: timeAt(candles, ls.index), position: 'belowBar', color: BULL_COLOR, shape: 'circle', text: 'LS' },
          { time: timeAt(candles, hd.index), position: 'belowBar', color: BULL_COLOR, shape: 'arrowUp', text: 'Head' },
          { time: timeAt(candles, rs.index), position: 'belowBar', color: BULL_COLOR, shape: 'circle', text: 'RS' },
        );
      }
      break;
    }
    // Triangle / Wedge / Channel patterns: draw upper and lower trendlines
    case 'Ascending Triangle':
    case 'Descending Triangle':
    case 'Symmetrical Triangle':
    case 'Rising Wedge':
    case 'Falling Wedge':
    case 'Ascending Channel':
    case 'Descending Channel': {
      if (swingHighs.length >= 2) {
        const h1 = swingHighs[0], h2 = swingHighs[swingHighs.length - 1];
        drawing.lines.push({
          startTime: timeAt(candles, h1.index), startPrice: h1.price,
          endTime: timeAt(candles, h2.index), endPrice: h2.price,
          color: BEAR_COLOR, width: 2, style: 'solid',
        });
      }
      if (swingLows.length >= 2) {
        const l1 = swingLows[0], l2 = swingLows[swingLows.length - 1];
        drawing.lines.push({
          startTime: timeAt(candles, l1.index), startPrice: l1.price,
          endTime: timeAt(candles, l2.index), endPrice: l2.price,
          color: BULL_COLOR, width: 2, style: 'solid',
        });
      }
      // Breakout projection
      if (swingHighs.length >= 1 && swingLows.length >= 1) {
        const projColor = match.type === 'bullish' ? BULL_COLOR : match.type === 'bearish' ? BEAR_COLOR : NEUTRAL_COLOR;
        drawing.markers.push({
          time: timeAt(candles, ei),
          position: match.type === 'bullish' ? 'aboveBar' : 'belowBar',
          color: projColor,
          shape: match.type === 'bullish' ? 'arrowUp' : 'arrowDown',
          text: 'Breakout',
        });
      }
      break;
    }
  }

  return drawing;
}

function buildCandlestickDrawing(candles: Candle[], patternName: string): PatternDrawing | null {
  const patterns = detectCandlestickPatterns(candles, false);
  const match = patterns.find(p => p.name === patternName);
  if (!match) return null;

  const color = match.type === 'bullish' ? BULL_COLOR : match.type === 'bearish' ? BEAR_COLOR : NEUTRAL_COLOR;
  const position = match.type === 'bullish' ? 'belowBar' as const : 'aboveBar' as const;
  const shape = match.type === 'bullish' ? 'arrowUp' as const : match.type === 'bearish' ? 'arrowDown' as const : 'circle' as const;

  return {
    lines: [],
    markers: [{
      time: timeAt(candles, match.candleIndex),
      position,
      color,
      shape,
      text: match.name,
    }],
    zones: [],
    label: match.name,
    type: match.type,
  };
}

function buildStructureDrawing(candles: Candle[], patternName: string): PatternDrawing | null {
  const events = detectMarketStructure(candles);
  const match = events.find(e => e.name === patternName);
  if (!match) return null;

  const color = match.type === 'bullish' ? BULL_COLOR : match.type === 'bearish' ? BEAR_COLOR : NEUTRAL_COLOR;
  const drawing: PatternDrawing = {
    lines: [],
    markers: [{
      time: timeAt(candles, match.candleIndex),
      position: match.type === 'bullish' ? 'belowBar' : 'aboveBar',
      color,
      shape: match.type === 'bullish' ? 'arrowUp' : match.type === 'bearish' ? 'arrowDown' : 'circle',
      text: match.name,
    }],
    zones: [],
    label: match.name,
    type: match.type,
  };

  // Draw zone for FVG / Order Blocks
  if (match.zone) {
    const startTime = timeAt(candles, Math.max(0, match.candleIndex - 2));
    const endTime = timeAt(candles, Math.min(candles.length - 1, match.candleIndex + 10));
    drawing.zones.push({
      startTime,
      endTime,
      highPrice: match.zone.high,
      lowPrice: match.zone.low,
      color: match.type === 'bullish' ? 'rgba(76, 175, 80, 0.15)' : 'rgba(244, 67, 54, 0.15)',
    });
  }

  // Price line at the event
  drawing.lines.push({
    startTime: timeAt(candles, Math.max(0, match.candleIndex - 5)),
    startPrice: match.price,
    endTime: timeAt(candles, Math.min(candles.length - 1, match.candleIndex + 10)),
    endPrice: match.price,
    color,
    width: 1,
    style: 'dashed',
  });

  return drawing;
}
