import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ─── Types ───────────────────────────────────────────────────────────
interface Candle { time: number; open: number; high: number; low: number; close: number; volume: number; }
type Timeframe = "15" | "60" | "240" | "D" | "W";
const REVERSAL_TIMEFRAMES: Timeframe[] = ["15", "60", "240", "D", "W"];
const TOP_SYMBOLS = 50;
const BATCH_SIZE = 5;

interface ReversalConfirmation {
  category: string;
  signal: "bull" | "bear";
  name: string;
  weight: number;
  detail: string;
}

interface ReversalSignal {
  symbol: string;
  price: number;
  change24h: number;
  volume24h: number;
  timeframe: string;
  direction: "bull" | "bear";
  score: number;
  grade: "S" | "A" | "B" | "C";
  confirmations: ReversalConfirmation[];
  categoryCount: number;
  topReason: string;
  timestamp: number;
  invalidation: number;
  target: number;
  riskReward: number;
}

// ─── Bybit API ──────────────────────────────────────────────────────
async function bybitFetch(path: string) {
  const res = await fetch(`https://api.bybit.com${path}`);
  if (!res.ok) throw new Error(`Bybit ${res.status}`);
  return res.json();
}

async function fetchTickers(cat: "spot" | "linear") {
  return bybitFetch(`/v5/market/tickers?category=${cat}`);
}

async function fetchKlines(symbol: string, tf: Timeframe, cat: "spot" | "linear", limit = 220): Promise<Candle[]> {
  const data = await bybitFetch(`/v5/market/kline?category=${cat}&symbol=${symbol}&interval=${tf}&limit=${limit}`);
  if (data.retCode !== 0 || !data.result?.list) return [];
  return data.result.list
    .map((k: string[]) => ({ time: parseInt(k[0]), open: +k[1], high: +k[2], low: +k[3], close: +k[4], volume: +k[5] }))
    .reverse();
}

// ─── Indicator Functions ────────────────────────────────────────────
function calculateEMA(data: number[], period: number): number[] {
  const ema: number[] = [];
  if (!data.length) return ema;
  const k = 2 / (period + 1);
  ema[0] = data[0];
  for (let i = 1; i < data.length; i++) ema[i] = data[i] * k + ema[i - 1] * (1 - k);
  return ema;
}

function calculateSMA(data: number[], period: number): number[] {
  const sma: number[] = [];
  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) sma.push(NaN);
    else { let s = 0; for (let j = i - period + 1; j <= i; j++) s += data[j]; sma.push(s / period); }
  }
  return sma;
}

function calculateTR(candles: Candle[]): number[] {
  const tr = [candles[0].high - candles[0].low];
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i], pc = candles[i - 1].close;
    tr.push(Math.max(c.high - c.low, Math.abs(c.high - pc), Math.abs(c.low - pc)));
  }
  return tr;
}

function smoothedAvg(data: number[], period: number): number[] {
  const r: number[] = []; let s = 0;
  for (let i = 0; i < data.length; i++) {
    if (i < period) { s += data[i]; r.push(s / (i + 1)); }
    else r.push((r[i - 1] * (period - 1) + data[i]) / period);
  }
  return r;
}

function calculateATR(candles: Candle[], period = 14): number {
  const a = smoothedAvg(calculateTR(candles), period);
  return a[a.length - 1] || 0;
}

function calculateRSI(closes: number[], period = 14): number {
  if (closes.length < period + 1) return 50;
  let g = 0, l = 0;
  for (let i = 1; i <= period; i++) { const d = closes[i] - closes[i - 1]; if (d > 0) g += d; else l -= d; }
  let ag = g / period, al = l / period;
  for (let i = period + 1; i < closes.length; i++) { const d = closes[i] - closes[i - 1]; ag = (ag * (period - 1) + (d > 0 ? d : 0)) / period; al = (al * (period - 1) + (d < 0 ? -d : 0)) / period; }
  return al === 0 ? 100 : 100 - 100 / (1 + ag / al);
}

function getRSISeries(closes: number[], period = 14): number[] {
  const series: number[] = [];
  for (let end = period + 1; end <= closes.length; end++) {
    series.push(calculateRSI(closes.slice(0, end), period));
  }
  return series;
}

function calculateMACD(closes: number[], fast = 12, slow = 26, signal = 9) {
  if (closes.length < slow + signal) return { macd: 0, signal: 0, histogram: 0, prevHistogram: 0 };
  const ef = calculateEMA(closes, fast), es = calculateEMA(closes, slow);
  const ml = ef.map((v, i) => v - es[i]);
  const sl = calculateEMA(ml.slice(slow - 1), signal);
  const mv = ml[ml.length - 1], sv = sl[sl.length - 1];
  const prevMv = ml[ml.length - 2] ?? mv, prevSv = sl[sl.length - 2] ?? sv;
  return { macd: mv, signal: sv, histogram: mv - sv, prevHistogram: prevMv - prevSv };
}

function calculateStochastic(candles: Candle[], kP = 14, dP = 3) {
  if (candles.length < kP + dP) return { k: 50, d: 50 };
  const kV: number[] = [];
  for (let i = kP - 1; i < candles.length; i++) {
    let h = -Infinity, l = Infinity;
    for (let j = i - kP + 1; j <= i; j++) { if (candles[j].high > h) h = candles[j].high; if (candles[j].low < l) l = candles[j].low; }
    const r = h - l; kV.push(r === 0 ? 50 : ((candles[i].close - l) / r) * 100);
  }
  const dV: number[] = [];
  for (let i = dP - 1; i < kV.length; i++) { let s = 0; for (let j = i - dP + 1; j <= i; j++) s += kV[j]; dV.push(s / dP); }
  return { k: kV[kV.length - 1], d: dV[dV.length - 1] };
}

function calculateStochRSI(closes: number[], rsiP = 14, stochP = 14, kS = 3, dS = 3) {
  if (closes.length < rsiP + stochP + kS) return { k: 50, d: 50 };
  const rs: number[] = [];
  for (let end = rsiP + 1; end <= closes.length; end++) rs.push(calculateRSI(closes.slice(0, end), rsiP));
  if (rs.length < stochP) return { k: 50, d: 50 };
  const sv: number[] = [];
  for (let i = stochP - 1; i < rs.length; i++) {
    let h = -Infinity, l = Infinity;
    for (let j = i - stochP + 1; j <= i; j++) { if (rs[j] > h) h = rs[j]; if (rs[j] < l) l = rs[j]; }
    const r = h - l; sv.push(r === 0 ? 50 : ((rs[i] - l) / r) * 100);
  }
  const kk = calculateEMA(sv, kS), dd = calculateEMA(kk, dS);
  return { k: kk[kk.length - 1], d: dd[dd.length - 1] };
}

function calculateWilliamsR(candles: Candle[], period = 14): number {
  if (candles.length < period) return -50;
  const r = candles.slice(-period);
  let h = -Infinity, l = Infinity;
  for (const c of r) { if (c.high > h) h = c.high; if (c.low < l) l = c.low; }
  const rng = h - l; return rng === 0 ? -50 : ((h - candles[candles.length - 1].close) / rng) * -100;
}

function calculateCCI(candles: Candle[], period = 20): number {
  if (candles.length < period) return 0;
  const r = candles.slice(-period), tps = r.map(c => (c.high + c.low + c.close) / 3);
  const m = tps.reduce((s, v) => s + v, 0) / period;
  const md = tps.reduce((s, v) => s + Math.abs(v - m), 0) / period;
  return md === 0 ? 0 : (tps[tps.length - 1] - m) / (0.015 * md);
}

function calculateMFI(candles: Candle[], period = 14): number {
  if (candles.length < period + 1) return 50;
  let pf = 0, nf = 0;
  for (let i = candles.length - period; i < candles.length; i++) {
    const tp = (candles[i].high + candles[i].low + candles[i].close) / 3;
    const pt = (candles[i - 1].high + candles[i - 1].low + candles[i - 1].close) / 3;
    const mf = tp * candles[i].volume;
    if (tp > pt) pf += mf; else if (tp < pt) nf += mf;
  }
  return nf === 0 ? 100 : 100 - 100 / (1 + pf / nf);
}

function calculateTSI(closes: number[], lp = 25, sp = 13): number {
  if (closes.length < lp + sp + 1) return 0;
  const mom: number[] = []; for (let i = 1; i < closes.length; i++) mom.push(closes[i] - closes[i - 1]);
  const am = mom.map(Math.abs);
  const sm2 = calculateEMA(calculateEMA(mom, lp), sp);
  const sa2 = calculateEMA(calculateEMA(am, lp), sp);
  const d = sa2[sa2.length - 1];
  return d === 0 ? 0 : (sm2[sm2.length - 1] / d) * 100;
}

function calculateROC(closes: number[], period = 12): number {
  if (closes.length <= period) return 0;
  const p = closes[closes.length - 1 - period];
  return p === 0 ? 0 : ((closes[closes.length - 1] - p) / p) * 100;
}

function calculateADX(candles: Candle[], period = 14) {
  if (candles.length < period + 1) return { adx: 0, plusDI: 0, minusDI: 0 };
  const pDM = [0], mDM = [0];
  for (let i = 1; i < candles.length; i++) {
    const up = candles[i].high - candles[i - 1].high, dn = candles[i - 1].low - candles[i].low;
    pDM.push(up > dn && up > 0 ? up : 0); mDM.push(dn > up && dn > 0 ? dn : 0);
  }
  const tr = calculateTR(candles), sTR = smoothedAvg(tr, period), sPDM = smoothedAvg(pDM, period), sMDM = smoothedAvg(mDM, period);
  const dx: number[] = []; let lp = 0, lm = 0;
  for (let i = 0; i < sTR.length; i++) {
    if (sTR[i] === 0) { dx.push(0); continue; }
    lp = (sPDM[i] / sTR[i]) * 100; lm = (sMDM[i] / sTR[i]) * 100;
    const ds = lp + lm; dx.push(ds === 0 ? 0 : (Math.abs(lp - lm) / ds) * 100);
  }
  const adx = smoothedAvg(dx, period);
  return { adx: adx[adx.length - 1] || 0, plusDI: lp, minusDI: lm };
}

function calculateBollingerBands(closes: number[], period = 20, stdDev = 2) {
  if (closes.length < period) { const p = closes[closes.length - 1] || 0; return { upper: p, middle: p, lower: p, bandwidth: 0, percentB: 0.5, squeeze: false }; }
  const r = closes.slice(-period), mid = r.reduce((s, v) => s + v, 0) / period;
  const sd = Math.sqrt(r.reduce((s, v) => s + (v - mid) ** 2, 0) / period);
  const u = mid + stdDev * sd, l = mid - stdDev * sd, bw = mid === 0 ? 0 : (u - l) / mid;
  const price = closes[closes.length - 1], rng = u - l;
  return { upper: u, middle: mid, lower: l, bandwidth: bw, percentB: rng === 0 ? 0.5 : (price - l) / rng, squeeze: bw < 0.04 };
}

function calculateKeltnerChannels(candles: Candle[], emaPeriod = 20, atrPeriod = 10, multiplier = 1.5) {
  const closes = candles.map(c => c.close), ev = calculateEMA(closes, emaPeriod);
  const mid = ev[ev.length - 1], atr = calculateATR(candles, atrPeriod);
  return { upper: mid + multiplier * atr, middle: mid, lower: mid - multiplier * atr };
}

function calculateParabolicSAR(candles: Candle[], afStart = 0.02, afStep = 0.02, afMax = 0.2) {
  if (candles.length < 3) return { sar: candles[0]?.low ?? 0, direction: "bull" as const, prevDirection: "bull" as const };
  let bull = true, sar = candles[0].low, ep = candles[0].high, af = afStart;
  let prevBull = bull;
  for (let i = 1; i < candles.length; i++) {
    const prev = candles[i - 1], curr = candles[i];
    prevBull = bull;
    sar = sar + af * (ep - sar);
    if (bull) {
      sar = Math.min(sar, prev.low, i >= 2 ? candles[i - 2].low : prev.low);
      if (curr.low < sar) { bull = false; sar = ep; ep = curr.low; af = afStart; }
      else if (curr.high > ep) { ep = curr.high; af = Math.min(af + afStep, afMax); }
    } else {
      sar = Math.max(sar, prev.high, i >= 2 ? candles[i - 2].high : prev.high);
      if (curr.high > sar) { bull = true; sar = ep; ep = curr.high; af = afStart; }
      else if (curr.low < ep) { ep = curr.low; af = Math.min(af + afStep, afMax); }
    }
  }
  return { sar, direction: bull ? "bull" as const : "bear" as const, prevDirection: prevBull ? "bull" as const : "bear" as const };
}

function calculateSupertrend(candles: Candle[], period = 10, multiplier = 3) {
  const atrV = calculateTR(candles), atrS = smoothedAvg(atrV, period);
  let ub = 0, lb = 0, st = 0, dir: "bull" | "bear" = "bull", prevDir: "bull" | "bear" = "bull";
  for (let i = period; i < candles.length; i++) {
    const hl2 = (candles[i].high + candles[i].low) / 2, atr = atrS[i];
    const bu = hl2 + multiplier * atr, bl = hl2 - multiplier * atr;
    ub = bu < ub || candles[i - 1].close > ub ? bu : ub;
    lb = bl > lb || candles[i - 1].close < lb ? bl : lb;
    prevDir = dir;
    st = st === ub ? (candles[i].close > ub ? lb : ub) : (candles[i].close < lb ? ub : lb);
    dir = candles[i].close > st ? "bull" : "bear";
  }
  return { value: st, direction: dir, prevDirection: prevDir };
}

function calculateIchimoku(candles: Candle[], tp = 9, kp = 26, sp = 52) {
  const hl = (s: number, e: number) => { let h = -Infinity, l = Infinity; for (let i = s; i <= e; i++) { if (candles[i].high > h) h = candles[i].high; if (candles[i].low < l) l = candles[i].low; } return (h + l) / 2; };
  const len = candles.length;
  if (len < sp + kp) return { tenkan: 0, kijun: 0, senkouA: 0, senkouB: 0, cloudDirection: "neutral" as const, priceVsCloud: "inside" as const, tkCross: "none" as const };
  const tenkan = hl(len - tp, len - 1), kijun = hl(len - kp, len - 1);
  const prevTenkan = len > tp + 1 ? hl(len - tp - 1, len - 2) : tenkan;
  const prevKijun = len > kp + 1 ? hl(len - kp - 1, len - 2) : kijun;
  const senkouA = (tenkan + kijun) / 2, senkouB = hl(len - sp, len - 1);
  const price = candles[len - 1].close;
  const ct = Math.max(senkouA, senkouB), cb = Math.min(senkouA, senkouB);
  
  let tkCross: "bull" | "bear" | "none" = "none";
  if (tenkan > kijun && prevTenkan <= prevKijun) tkCross = "bull";
  else if (tenkan < kijun && prevTenkan >= prevKijun) tkCross = "bear";
  
  return {
    tenkan, kijun, senkouA, senkouB,
    cloudDirection: senkouA > senkouB ? "bull" as const : senkouA < senkouB ? "bear" as const : "neutral" as const,
    priceVsCloud: price > ct ? "above" as const : price < cb ? "below" as const : "inside" as const,
    tkCross,
  };
}

function calculateOBV(candles: Candle[]) {
  if (candles.length < 2) return { value: 0, trend: "neutral" as const };
  let obv = 0; const os = [0];
  for (let i = 1; i < candles.length; i++) { if (candles[i].close > candles[i - 1].close) obv += candles[i].volume; else if (candles[i].close < candles[i - 1].close) obv -= candles[i].volume; os.push(obv); }
  const lb = Math.min(10, os.length), r = os.slice(-lb), m = Math.floor(lb / 2);
  const a1 = r.slice(0, m).reduce((s, v) => s + v, 0) / m, a2 = r.slice(m).reduce((s, v) => s + v, 0) / (lb - m);
  const pc = a1 === 0 ? 0 : ((a2 - a1) / Math.abs(a1)) * 100;
  return { value: obv, trend: pc > 5 ? "bull" as const : pc < -5 ? "bear" as const : "neutral" as const };
}

function calculateCMF(candles: Candle[], period = 20): number {
  if (candles.length < period) return 0;
  const r = candles.slice(-period);
  let ms = 0, vs = 0;
  for (const c of r) { const rng = c.high - c.low; const mfm = rng === 0 ? 0 : ((c.close - c.low) - (c.high - c.close)) / rng; ms += mfm * c.volume; vs += c.volume; }
  return vs === 0 ? 0 : ms / vs;
}

function calculateVolumeRatio(candles: Candle[], lookback = 20): number {
  if (candles.length < 2) return 1;
  const cur = candles[candles.length - 1].volume;
  const sl = candles.slice(-Math.min(lookback + 1, candles.length), -1);
  if (!sl.length) return 1;
  const avg = sl.reduce((s, c) => s + c.volume, 0) / sl.length;
  return avg === 0 ? 1 : cur / avg;
}

// ─── Candlestick reversal patterns ──────────────────────────────────
function detectReversalCandlesticks(candles: Candle[]): { name: string; type: "bullish" | "bearish"; strength: number }[] {
  if (candles.length < 5) return [];
  const results: { name: string; type: "bullish" | "bearish"; strength: number }[] = [];
  const len = candles.length;
  const c = candles[len - 1], prev = candles[len - 2], prev2 = candles[len - 3];
  const body = Math.abs(c.close - c.open), range = c.high - c.low;
  const prevBody = Math.abs(prev.close - prev.open);
  const isBull = c.close > c.open, prevBull = prev.close > prev.open;
  const avgBody = candles.slice(-14).reduce((s, x) => s + Math.abs(x.close - x.open), 0) / 14;

  const upperWick = c.high - Math.max(c.open, c.close);
  const lowerWick = Math.min(c.open, c.close) - c.low;

  // Hammer
  if (lowerWick > body * 2 && upperWick < body * 0.5 && !prevBull) {
    results.push({ name: "Hammer", type: "bullish", strength: 8 });
  }
  // Inverted Hammer
  if (upperWick > body * 2 && lowerWick < body * 0.5 && !prevBull) {
    results.push({ name: "Inverted Hammer", type: "bullish", strength: 6 });
  }
  // Shooting Star
  if (upperWick > body * 2 && lowerWick < body * 0.5 && prevBull) {
    results.push({ name: "Shooting Star", type: "bearish", strength: 8 });
  }
  // Hanging Man
  if (lowerWick > body * 2 && upperWick < body * 0.5 && prevBull) {
    results.push({ name: "Hanging Man", type: "bearish", strength: 7 });
  }
  // Bullish Engulfing
  if (isBull && !prevBull && c.close > prev.open && c.open < prev.close && body > prevBody) {
    results.push({ name: "Bullish Engulfing", type: "bullish", strength: 9 });
  }
  // Bearish Engulfing
  if (!isBull && prevBull && c.close < prev.open && c.open > prev.close && body > prevBody) {
    results.push({ name: "Bearish Engulfing", type: "bearish", strength: 9 });
  }
  // Morning Star (3 candle)
  if (len >= 3) {
    const p2Bull = prev2.close > prev2.open;
    const p2Body = Math.abs(prev2.close - prev2.open);
    if (!p2Bull && p2Body > avgBody * 0.5 && prevBody < avgBody * 0.3 && isBull && body > avgBody * 0.5) {
      results.push({ name: "Morning Star", type: "bullish", strength: 10 });
    }
  }
  // Evening Star (3 candle)
  if (len >= 3) {
    const p2Bull = prev2.close > prev2.open;
    const p2Body = Math.abs(prev2.close - prev2.open);
    if (p2Bull && p2Body > avgBody * 0.5 && prevBody < avgBody * 0.3 && !isBull && body > avgBody * 0.5) {
      results.push({ name: "Evening Star", type: "bearish", strength: 10 });
    }
  }
  // Doji after trend (reversal signal)
  if (body < range * 0.1 && range > 0) {
    // Check 3-candle trend before doji
    const recentBull = candles.slice(-4, -1).every(x => x.close > x.open);
    const recentBear = candles.slice(-4, -1).every(x => x.close < x.open);
    if (recentBull) results.push({ name: "Doji after uptrend", type: "bearish", strength: 6 });
    if (recentBear) results.push({ name: "Doji after downtrend", type: "bullish", strength: 6 });
  }
  // Piercing Line
  if (isBull && !prevBull && c.open < prev.low && c.close > (prev.open + prev.close) / 2 && c.close < prev.open) {
    results.push({ name: "Piercing Line", type: "bullish", strength: 7 });
  }
  // Dark Cloud Cover
  if (!isBull && prevBull && c.open > prev.high && c.close < (prev.open + prev.close) / 2 && c.close > prev.open) {
    results.push({ name: "Dark Cloud Cover", type: "bearish", strength: 7 });
  }
  // Three White Soldiers / Three Black Crows
  if (len >= 3) {
    const all3Bull = [prev2, prev, c].every(x => x.close > x.open && Math.abs(x.close - x.open) > avgBody * 0.5);
    const all3Bear = [prev2, prev, c].every(x => x.close < x.open && Math.abs(x.close - x.open) > avgBody * 0.5);
    if (all3Bull && c.close > prev.close && prev.close > prev2.close) {
      results.push({ name: "Three White Soldiers", type: "bullish", strength: 9 });
    }
    if (all3Bear && c.close < prev.close && prev.close < prev2.close) {
      results.push({ name: "Three Black Crows", type: "bearish", strength: 9 });
    }
  }

  return results;
}

// ─── RSI Divergence Detection ───────────────────────────────────────
function detectRSIDivergence(candles: Candle[], closes: number[]): { type: "bull" | "bear"; strength: number } | null {
  if (candles.length < 30) return null;
  const rsiSeries = getRSISeries(closes, 14);
  if (rsiSeries.length < 20) return null;
  
  const lookback = 20;
  const recentCandles = candles.slice(-lookback);
  const recentRSI = rsiSeries.slice(-lookback);
  
  // Find swing lows in price and RSI for bullish divergence
  let priceLow1 = Infinity, priceLow2 = Infinity, rsiLow1 = 100, rsiLow2 = 100;
  let low1Idx = -1, low2Idx = -1;
  
  for (let i = 2; i < recentCandles.length - 2; i++) {
    if (recentCandles[i].low < recentCandles[i-1].low && recentCandles[i].low < recentCandles[i-2].low &&
        recentCandles[i].low < recentCandles[i+1].low && recentCandles[i].low < recentCandles[i+2].low) {
      if (low1Idx === -1) { priceLow1 = recentCandles[i].low; rsiLow1 = recentRSI[i]; low1Idx = i; }
      else { priceLow2 = recentCandles[i].low; rsiLow2 = recentRSI[i]; low2Idx = i; }
    }
  }
  
  // Regular bullish divergence: price makes lower low, RSI makes higher low
  if (low2Idx > low1Idx && priceLow2 < priceLow1 && rsiLow2 > rsiLow1 && rsiLow2 < 40) {
    return { type: "bull", strength: rsiLow2 < 30 ? 8 : 6 };
  }
  
  // Find swing highs for bearish divergence
  let priceHigh1 = -Infinity, priceHigh2 = -Infinity, rsiHigh1 = 0, rsiHigh2 = 0;
  let high1Idx = -1, high2Idx = -1;
  
  for (let i = 2; i < recentCandles.length - 2; i++) {
    if (recentCandles[i].high > recentCandles[i-1].high && recentCandles[i].high > recentCandles[i-2].high &&
        recentCandles[i].high > recentCandles[i+1].high && recentCandles[i].high > recentCandles[i+2].high) {
      if (high1Idx === -1) { priceHigh1 = recentCandles[i].high; rsiHigh1 = recentRSI[i]; high1Idx = i; }
      else { priceHigh2 = recentCandles[i].high; rsiHigh2 = recentRSI[i]; high2Idx = i; }
    }
  }
  
  // Regular bearish divergence: price makes higher high, RSI makes lower high
  if (high2Idx > high1Idx && priceHigh2 > priceHigh1 && rsiHigh2 < rsiHigh1 && rsiHigh2 > 60) {
    return { type: "bear", strength: rsiHigh2 > 70 ? 8 : 6 };
  }
  
  return null;
}

// ─── Market Structure Detection ─────────────────────────────────────
function detectStructureShift(candles: Candle[]): { type: "bull" | "bear"; name: string } | null {
  if (candles.length < 20) return null;
  const lookback = 3;
  const highs: { idx: number; price: number }[] = [];
  const lows: { idx: number; price: number }[] = [];
  
  for (let i = lookback; i < candles.length - lookback; i++) {
    let isHigh = true, isLow = true;
    for (let j = 1; j <= lookback; j++) {
      if (candles[i].high <= candles[i - j].high || candles[i].high <= candles[i + j].high) isHigh = false;
      if (candles[i].low >= candles[i - j].low || candles[i].low >= candles[i + j].low) isLow = false;
    }
    if (isHigh) highs.push({ idx: i, price: candles[i].high });
    if (isLow) lows.push({ idx: i, price: candles[i].low });
  }
  
  const price = candles[candles.length - 1].close;
  
  // CHoCH: Change of Character — prior trend structure broken
  if (highs.length >= 2 && lows.length >= 2) {
    const lastTwoHighs = highs.slice(-2);
    const lastTwoLows = lows.slice(-2);
    
    // Was making lower highs + lower lows (bearish), now breaks above last high → bullish CHoCH
    if (lastTwoHighs[0].price > lastTwoHighs[1].price && lastTwoLows[0].price > lastTwoLows[1].price) {
      // Was bearish structure
      if (price > lastTwoHighs[1].price) {
        return { type: "bull", name: "CHoCH (Bullish)" };
      }
    }
    // Was making higher highs + higher lows (bullish), now breaks below last low → bearish CHoCH
    if (lastTwoHighs[1].price > lastTwoHighs[0].price && lastTwoLows[1].price > lastTwoLows[0].price) {
      // Was bullish structure
      if (price < lastTwoLows[1].price) {
        return { type: "bear", name: "CHoCH (Bearish)" };
      }
    }
  }
  
  return null;
}

// ─── Main Reversal Analysis ─────────────────────────────────────────
function analyzeReversal(candles: Candle[]): { direction: "bull" | "bear"; score: number; confirmations: ReversalConfirmation[]; categoryCount: number; invalidation: number; target: number } | null {
  if (candles.length < 60) return null;
  
  const closes = candles.map(c => c.close);
  const price = closes[closes.length - 1];
  const atr = calculateATR(candles, 14);
  const confirmations: ReversalConfirmation[] = [];
  
  // ─── 1. MOMENTUM REVERSAL (max ~25 pts) ───
  const rsi = calculateRSI(closes, 14);
  const macd = calculateMACD(closes);
  const stoch = calculateStochastic(candles);
  const stochRSI = calculateStochRSI(closes);
  const willR = calculateWilliamsR(candles);
  const cci = calculateCCI(candles);
  const mfi = calculateMFI(candles);
  const tsi = calculateTSI(closes);
  const roc = calculateROC(closes);

  // RSI extremes
  if (rsi < 25) confirmations.push({ category: "momentum", signal: "bull", name: "RSI Oversold", weight: 5, detail: `RSI at ${rsi.toFixed(1)}` });
  else if (rsi < 35) confirmations.push({ category: "momentum", signal: "bull", name: "RSI Near Oversold", weight: 3, detail: `RSI at ${rsi.toFixed(1)}` });
  if (rsi > 75) confirmations.push({ category: "momentum", signal: "bear", name: "RSI Overbought", weight: 5, detail: `RSI at ${rsi.toFixed(1)}` });
  else if (rsi > 65) confirmations.push({ category: "momentum", signal: "bear", name: "RSI Near Overbought", weight: 3, detail: `RSI at ${rsi.toFixed(1)}` });

  // RSI Divergence
  const rsiDiv = detectRSIDivergence(candles, closes);
  if (rsiDiv) confirmations.push({ category: "momentum", signal: rsiDiv.type, name: "RSI Divergence", weight: rsiDiv.strength, detail: `${rsiDiv.type === "bull" ? "Bullish" : "Bearish"} RSI divergence detected` });

  // MACD histogram reversal
  if (macd.histogram > 0 && macd.prevHistogram < 0) confirmations.push({ category: "momentum", signal: "bull", name: "MACD Hist Cross Up", weight: 5, detail: `Histogram flipped positive (${macd.histogram.toFixed(4)})` });
  if (macd.histogram < 0 && macd.prevHistogram > 0) confirmations.push({ category: "momentum", signal: "bear", name: "MACD Hist Cross Down", weight: 5, detail: `Histogram flipped negative (${macd.histogram.toFixed(4)})` });
  // MACD converging (weakening)
  if (Math.abs(macd.histogram) < Math.abs(macd.prevHistogram) * 0.5) {
    const dir = macd.prevHistogram > 0 ? "bear" : "bull";
    confirmations.push({ category: "momentum", signal: dir, name: "MACD Weakening", weight: 3, detail: `Histogram shrinking rapidly` });
  }

  // Stochastic cross in extreme
  if (stoch.k < 20 && stoch.k > stoch.d) confirmations.push({ category: "momentum", signal: "bull", name: "Stoch Oversold Cross", weight: 5, detail: `%K=${stoch.k.toFixed(1)} crossed above %D=${stoch.d.toFixed(1)}` });
  if (stoch.k > 80 && stoch.k < stoch.d) confirmations.push({ category: "momentum", signal: "bear", name: "Stoch Overbought Cross", weight: 5, detail: `%K=${stoch.k.toFixed(1)} crossed below %D=${stoch.d.toFixed(1)}` });

  // StochRSI
  if (stochRSI.k < 15) confirmations.push({ category: "momentum", signal: "bull", name: "StochRSI Oversold", weight: 4, detail: `StochRSI K=${stochRSI.k.toFixed(1)}` });
  if (stochRSI.k > 85) confirmations.push({ category: "momentum", signal: "bear", name: "StochRSI Overbought", weight: 4, detail: `StochRSI K=${stochRSI.k.toFixed(1)}` });

  // Williams %R
  if (willR < -80) confirmations.push({ category: "momentum", signal: "bull", name: "Williams %R Oversold", weight: 3, detail: `%R=${willR.toFixed(1)}` });
  if (willR > -20) confirmations.push({ category: "momentum", signal: "bear", name: "Williams %R Overbought", weight: 3, detail: `%R=${willR.toFixed(1)}` });

  // CCI
  if (cci < -200) confirmations.push({ category: "momentum", signal: "bull", name: "CCI Extreme Low", weight: 4, detail: `CCI=${cci.toFixed(0)}` });
  if (cci > 200) confirmations.push({ category: "momentum", signal: "bear", name: "CCI Extreme High", weight: 4, detail: `CCI=${cci.toFixed(0)}` });

  // MFI
  if (mfi < 20) confirmations.push({ category: "momentum", signal: "bull", name: "MFI Oversold", weight: 3, detail: `MFI=${mfi.toFixed(1)}` });
  if (mfi > 80) confirmations.push({ category: "momentum", signal: "bear", name: "MFI Overbought", weight: 3, detail: `MFI=${mfi.toFixed(1)}` });

  // TSI
  if (tsi < -25) confirmations.push({ category: "momentum", signal: "bull", name: "TSI Extreme Low", weight: 3, detail: `TSI=${tsi.toFixed(1)}` });
  if (tsi > 25) confirmations.push({ category: "momentum", signal: "bear", name: "TSI Extreme High", weight: 3, detail: `TSI=${tsi.toFixed(1)}` });

  // ROC
  if (roc < -10) confirmations.push({ category: "momentum", signal: "bull", name: "ROC Extreme Drop", weight: 3, detail: `ROC=${roc.toFixed(1)}%` });
  if (roc > 10) confirmations.push({ category: "momentum", signal: "bear", name: "ROC Extreme Rise", weight: 3, detail: `ROC=${roc.toFixed(1)}%` });

  // ─── 2. TREND EXHAUSTION (max ~20 pts) ───
  const { adx, plusDI, minusDI } = calculateADX(candles);
  const supertrend = calculateSupertrend(candles);
  const psar = calculateParabolicSAR(candles);
  const ichimoku = calculateIchimoku(candles);
  const ema9 = calculateEMA(closes, 9);
  const ema21 = calculateEMA(closes, 21);
  const ema50 = calculateEMA(closes, 50);
  const ema200 = calculateEMA(closes, 200);

  // Supertrend flip
  if (supertrend.direction !== supertrend.prevDirection) {
    confirmations.push({ category: "trend", signal: supertrend.direction, name: "Supertrend Flip", weight: 7, detail: `Supertrend flipped to ${supertrend.direction}` });
  }

  // Parabolic SAR flip
  if (psar.direction !== psar.prevDirection) {
    confirmations.push({ category: "trend", signal: psar.direction, name: "Parabolic SAR Flip", weight: 6, detail: `SAR flipped to ${psar.direction} at ${psar.sar.toPrecision(5)}` });
  }

  // ADX declining + DI cross
  if (adx > 25 && plusDI > minusDI && minusDI > plusDI * 0.7) {
    confirmations.push({ category: "trend", signal: "bear", name: "DI Convergence (Bear)", weight: 5, detail: `+DI=${plusDI.toFixed(1)} narrowing vs -DI=${minusDI.toFixed(1)}` });
  }
  if (adx > 25 && minusDI > plusDI && plusDI > minusDI * 0.7) {
    confirmations.push({ category: "trend", signal: "bull", name: "DI Convergence (Bull)", weight: 5, detail: `-DI=${minusDI.toFixed(1)} narrowing vs +DI=${plusDI.toFixed(1)}` });
  }

  // Price mean reversion from EMAs
  const e50 = ema50[ema50.length - 1], e200 = ema200[ema200.length - 1];
  const distFrom50 = ((price - e50) / e50) * 100;
  if (distFrom50 > 8) confirmations.push({ category: "trend", signal: "bear", name: "Overextended Above MA50", weight: 5, detail: `${distFrom50.toFixed(1)}% above EMA50` });
  if (distFrom50 < -8) confirmations.push({ category: "trend", signal: "bull", name: "Overextended Below MA50", weight: 5, detail: `${Math.abs(distFrom50).toFixed(1)}% below EMA50` });

  // Ichimoku TK cross
  if (ichimoku.tkCross === "bull") confirmations.push({ category: "trend", signal: "bull", name: "Ichimoku TK Cross Up", weight: 5, detail: `Tenkan crossed above Kijun` });
  if (ichimoku.tkCross === "bear") confirmations.push({ category: "trend", signal: "bear", name: "Ichimoku TK Cross Down", weight: 5, detail: `Tenkan crossed below Kijun` });

  // ─── 3. VOLATILITY SIGNALS (max ~15 pts) ───
  const bb = calculateBollingerBands(closes);
  const kc = calculateKeltnerChannels(candles);
  const squeeze = bb.lower > kc.lower && bb.upper < kc.upper;
  const prevBB = calculateBollingerBands(closes.slice(0, -1));
  const prevSqueeze = prevBB.squeeze;

  // BB pierce + return
  if (bb.percentB < 0 && closes[closes.length - 1] > bb.lower) {
    confirmations.push({ category: "volatility", signal: "bull", name: "BB Lower Pierce Return", weight: 6, detail: `Price pierced lower band and recovered` });
  }
  if (bb.percentB > 1 && closes[closes.length - 1] < bb.upper) {
    confirmations.push({ category: "volatility", signal: "bear", name: "BB Upper Pierce Return", weight: 6, detail: `Price pierced upper band and rejected` });
  }
  // BB extremes
  if (bb.percentB < 0.05) confirmations.push({ category: "volatility", signal: "bull", name: "BB Lower Extreme", weight: 4, detail: `%B=${(bb.percentB * 100).toFixed(1)}%` });
  if (bb.percentB > 0.95) confirmations.push({ category: "volatility", signal: "bear", name: "BB Upper Extreme", weight: 4, detail: `%B=${(bb.percentB * 100).toFixed(1)}%` });

  // Squeeze release
  if (!squeeze && prevSqueeze) {
    const dir = closes[closes.length - 1] > bb.middle ? "bull" : "bear";
    confirmations.push({ category: "volatility", signal: dir, name: "Squeeze Release", weight: 5, detail: `Bollinger squeezed and expanding ${dir === "bull" ? "upward" : "downward"}` });
  }

  // ─── 4. VOLUME CONFIRMATION (max ~15 pts) ───
  const volRatio = calculateVolumeRatio(candles);
  const obv = calculateOBV(candles);
  const cmf = calculateCMF(candles);

  // Volume spike on reversal candle
  const lastCandle = candles[candles.length - 1];
  const lastIsBull = lastCandle.close > lastCandle.open;
  if (volRatio > 2) {
    confirmations.push({ category: "volume", signal: lastIsBull ? "bull" : "bear", name: "Volume Spike", weight: 5, detail: `Volume ${volRatio.toFixed(1)}x average` });
  }

  // OBV divergence from price
  const priceUp = closes[closes.length - 1] > closes[closes.length - 6];
  if (priceUp && obv.trend === "bear") confirmations.push({ category: "volume", signal: "bear", name: "OBV Bearish Divergence", weight: 5, detail: `Price rising but OBV declining` });
  if (!priceUp && obv.trend === "bull") confirmations.push({ category: "volume", signal: "bull", name: "OBV Bullish Divergence", weight: 5, detail: `Price falling but OBV rising` });

  // CMF
  if (cmf < -0.15) confirmations.push({ category: "volume", signal: "bear", name: "CMF Selling Pressure", weight: 4, detail: `CMF=${cmf.toFixed(3)}` });
  if (cmf > 0.15) confirmations.push({ category: "volume", signal: "bull", name: "CMF Buying Pressure", weight: 4, detail: `CMF=${cmf.toFixed(3)}` });

  // Climax volume (very high volume on reversal candle)
  if (volRatio > 3.5) {
    confirmations.push({ category: "volume", signal: lastIsBull ? "bull" : "bear", name: "Climax Volume", weight: 5, detail: `Extreme volume ${volRatio.toFixed(1)}x — possible exhaustion` });
  }

  // ─── 5. PATTERN CONFIRMATION (max ~15 pts) ───
  const candlePatterns = detectReversalCandlesticks(candles.slice(0, -1)); // closed candles
  for (const cp of candlePatterns) {
    confirmations.push({ category: "pattern", signal: cp.type === "bullish" ? "bull" : "bear", name: cp.name, weight: cp.strength, detail: `${cp.name} candlestick pattern` });
  }

  // Market structure shift
  const structShift = detectStructureShift(candles);
  if (structShift) {
    confirmations.push({ category: "structure", signal: structShift.type, name: structShift.name, weight: 7, detail: `Market structure changed — ${structShift.name}` });
  }

  // ─── Aggregate ─────────────────────────────────────────────────────
  if (confirmations.length === 0) return null;

  // Count bull vs bear
  let bullScore = 0, bearScore = 0;
  const bullConfs = confirmations.filter(c => c.signal === "bull");
  const bearConfs = confirmations.filter(c => c.signal === "bear");
  
  for (const c of bullConfs) bullScore += c.weight;
  for (const c of bearConfs) bearScore += c.weight;

  // Determine dominant direction
  const direction = bullScore > bearScore ? "bull" : "bear";
  const dominantConfs = direction === "bull" ? bullConfs : bearConfs;
  const rawScore = direction === "bull" ? bullScore : bearScore;
  
  // Count unique categories
  const categories = new Set(dominantConfs.map(c => c.category));
  const categoryCount = categories.size;
  
  // Category bonus: more categories = higher confidence
  let categoryBonus = 0;
  if (categoryCount >= 5) categoryBonus = 15;
  else if (categoryCount >= 4) categoryBonus = 10;
  else if (categoryCount >= 3) categoryBonus = 5;
  
  // Opposing signals penalty
  const opposingScore = direction === "bull" ? bearScore : bullScore;
  const conflictPenalty = Math.min(15, opposingScore * 0.5);
  
  const score = Math.min(100, Math.max(0, rawScore + categoryBonus - conflictPenalty));

  // Need minimum 1 category and score >= 30 to qualify
  if (categoryCount < 1 || score < 30) return null;

  // Calculate invalidation and target
  const invalidation = direction === "bull" 
    ? price - 2 * atr 
    : price + 2 * atr;
  const target = direction === "bull"
    ? price + 3 * atr
    : price - 3 * atr;

  return { direction, score, confirmations: dominantConfs, categoryCount, invalidation, target };
}

// ─── Main scan function ─────────────────────────────────────────────
async function runReversalScan(supabase: any) {
  const startTime = Date.now();
  console.log("Starting reversal scan...");
  
  // 1. Fetch top symbols by volume
  const tickerData = await fetchTickers("linear");
  if (tickerData.retCode !== 0 || !tickerData.result?.list) throw new Error("Failed to fetch tickers");
  
  const symbols = tickerData.result.list
    .filter((t: any) => t.symbol.endsWith("USDT"))
    .sort((a: any, b: any) => parseFloat(b.turnover24h) - parseFloat(a.turnover24h))
    .slice(0, TOP_SYMBOLS);

  const allReversals: ReversalSignal[] = [];

  // 2. Scan each symbol across timeframes
  for (let i = 0; i < symbols.length; i += BATCH_SIZE) {
    const batch = symbols.slice(i, i + BATCH_SIZE);
    await Promise.all(batch.map(async (ticker: any) => {
      const symbol = ticker.symbol;
      const price = parseFloat(ticker.lastPrice);
      const change24h = parseFloat(ticker.price24hPcnt) * 100;
      const volume24h = parseFloat(ticker.volume24h);

      for (const tf of REVERSAL_TIMEFRAMES) {
        try {
          const candles = await fetchKlines(symbol, tf, "linear", 220);
          if (candles.length < 60) continue;

          const result = analyzeReversal(candles);
          if (!result) continue;

          const grade: "S" | "A" | "B" | "C" = 
            result.score >= 75 ? "S" :
            result.score >= 60 ? "A" :
            result.score >= 45 ? "B" : "C";

          // Include score >= 35
          if (result.score < 35) continue;

          const rr = Math.abs(result.target - price) / Math.abs(price - result.invalidation);

          allReversals.push({
            symbol,
            price,
            change24h,
            volume24h,
            timeframe: tf,
            direction: result.direction,
            score: Math.round(result.score),
            grade,
            confirmations: result.confirmations,
            categoryCount: result.categoryCount,
            topReason: result.confirmations.sort((a, b) => b.weight - a.weight)[0]?.name ?? "Multiple signals",
            timestamp: Date.now(),
            invalidation: result.invalidation,
            target: result.target,
            riskReward: Math.round(rr * 10) / 10,
          });
        } catch { /* skip */ }
      }
    }));
    if (i + BATCH_SIZE < symbols.length) await new Promise(r => setTimeout(r, 100));
  }

  // 3. Sort by score, take top 50
  allReversals.sort((a, b) => b.score - a.score);
  const topReversals = allReversals.slice(0, 50);

  // 4. Store in DB
  const now = new Date().toISOString();
  const { error } = await supabase.from("scan_cache").upsert({
    id: "reversals",
    data: topReversals,
    scanned_at: now,
  });
  if (error) console.error("Failed to upsert reversals:", error);

  const duration = Date.now() - startTime;
  console.log(`Reversal scan complete in ${(duration / 1000).toFixed(1)}s — ${topReversals.length} reversals found (${allReversals.length} total)`);

  return { duration, total: allReversals.length, top: topReversals.length, symbolsScanned: symbols.length };
}

// ─── Handler ────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const result = await runReversalScan(supabase);

    return new Response(JSON.stringify({ success: true, ...result }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Reversal scanner error:", message);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
