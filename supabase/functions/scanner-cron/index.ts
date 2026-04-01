import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ─── Types ───────────────────────────────────────────────────────────
interface Candle { time: number; open: number; high: number; low: number; close: number; volume: number; }
type Timeframe = "1" | "5" | "15" | "60" | "240" | "D" | "W";

const SCAN_TIMEFRAMES: Timeframe[] = ["5", "15", "60", "240", "D", "W"];
const ALL_TIMEFRAMES: Timeframe[] = ["1", "5", "15", "60", "240", "D", "W"];
const TOP_SYMBOLS = 30; // reduced for server perf
const BATCH_SIZE = 6;

// ─── Bybit API helpers ──────────────────────────────────────────────
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

// ─── Indicator Functions (self-contained) ───────────────────────────

function calculateSMA(data: number[], period: number): number[] {
  const sma: number[] = [];
  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) sma.push(NaN);
    else { let s = 0; for (let j = i - period + 1; j <= i; j++) s += data[j]; sma.push(s / period); }
  }
  return sma;
}

function calculateEMA(data: number[], period: number): number[] {
  const ema: number[] = [];
  if (!data.length) return ema;
  const k = 2 / (period + 1);
  ema[0] = data[0];
  for (let i = 1; i < data.length; i++) ema[i] = data[i] * k + ema[i - 1] * (1 - k);
  return ema;
}

function calculateDEMA(data: number[], period: number): number[] {
  const e1 = calculateEMA(data, period), e2 = calculateEMA(e1, period);
  return e1.map((v, i) => 2 * v - e2[i]);
}

function calculateVWAP(candles: Candle[]): number {
  let cv = 0, ct = 0;
  for (const c of candles) { const tp = (c.high + c.low + c.close) / 3; ct += tp * c.volume; cv += c.volume; }
  return cv === 0 ? candles[candles.length - 1].close : ct / cv;
}

function calculateLinearRegression(closes: number[], period = 50) {
  const data = closes.slice(-period), n = data.length;
  if (n < 5) return { slope: 0, intercept: 0, rSquared: 0, upper: 0, lower: 0, value: 0 };
  let sx = 0, sy = 0, sxy = 0, sx2 = 0;
  for (let i = 0; i < n; i++) { sx += i; sy += data[i]; sxy += i * data[i]; sx2 += i * i; }
  const slope = (n * sxy - sx * sy) / (n * sx2 - sx * sx);
  const intercept = (sy - slope * sx) / n;
  const value = slope * (n - 1) + intercept;
  const meanY = sy / n;
  let ssTot = 0, ssRes = 0;
  for (let i = 0; i < n; i++) { ssTot += (data[i] - meanY) ** 2; ssRes += (data[i] - (slope * i + intercept)) ** 2; }
  const rSquared = ssTot === 0 ? 0 : 1 - ssRes / ssTot;
  const stdErr = Math.sqrt(ssRes / (n - 2));
  return { slope, intercept, rSquared, upper: value + 2 * stdErr, lower: value - 2 * stdErr, value };
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

function calculateParabolicSAR(candles: Candle[], afStart = 0.02, afStep = 0.02, afMax = 0.2) {
  if (candles.length < 3) return { sar: candles[0]?.low ?? 0, direction: "bull" as const };
  let bull = true, sar = candles[0].low, ep = candles[0].high, af = afStart;
  for (let i = 1; i < candles.length; i++) {
    const prev = candles[i - 1], curr = candles[i];
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
  return { sar, direction: bull ? "bull" as const : "bear" as const };
}

function calculateSupertrend(candles: Candle[], period = 10, multiplier = 3) {
  const atrV = calculateTR(candles), atrS = smoothedAvg(atrV, period);
  let ub = 0, lb = 0, st = 0, dir: "bull" | "bear" = "bull";
  for (let i = period; i < candles.length; i++) {
    const hl2 = (candles[i].high + candles[i].low) / 2, atr = atrS[i];
    const bu = hl2 + multiplier * atr, bl = hl2 - multiplier * atr;
    ub = bu < ub || candles[i - 1].close > ub ? bu : ub;
    lb = bl > lb || candles[i - 1].close < lb ? bl : lb;
    st = st === ub ? (candles[i].close > ub ? lb : ub) : (candles[i].close < lb ? ub : lb);
    dir = candles[i].close > st ? "bull" : "bear";
  }
  return { value: st, direction: dir };
}

function calculateIchimoku(candles: Candle[], tp = 9, kp = 26, sp = 52) {
  const hl = (s: number, e: number) => { let h = -Infinity, l = Infinity; for (let i = s; i <= e; i++) { if (candles[i].high > h) h = candles[i].high; if (candles[i].low < l) l = candles[i].low; } return (h + l) / 2; };
  const len = candles.length;
  if (len < sp + kp) return { tenkan: 0, kijun: 0, senkouA: 0, senkouB: 0, chikouVsPrice: 0, cloudDirection: "neutral" as const, priceVsCloud: "inside" as const };
  const tenkan = hl(len - tp, len - 1), kijun = hl(len - kp, len - 1);
  const senkouA = (tenkan + kijun) / 2, senkouB = hl(len - sp, len - 1);
  const price = candles[len - 1].close;
  const chikouVsPrice = len > kp ? price - candles[len - kp].close : 0;
  const ct = Math.max(senkouA, senkouB), cb = Math.min(senkouA, senkouB);
  return { tenkan, kijun, senkouA, senkouB, chikouVsPrice, cloudDirection: senkouA > senkouB ? "bull" as const : senkouA < senkouB ? "bear" as const : "neutral" as const, priceVsCloud: price > ct ? "above" as const : price < cb ? "below" as const : "inside" as const };
}

function calculateRSI(closes: number[], period = 14): number {
  if (closes.length < period + 1) return 50;
  let g = 0, l = 0;
  for (let i = 1; i <= period; i++) { const d = closes[i] - closes[i - 1]; if (d > 0) g += d; else l -= d; }
  let ag = g / period, al = l / period;
  for (let i = period + 1; i < closes.length; i++) { const d = closes[i] - closes[i - 1]; ag = (ag * (period - 1) + (d > 0 ? d : 0)) / period; al = (al * (period - 1) + (d < 0 ? -d : 0)) / period; }
  return al === 0 ? 100 : 100 - 100 / (1 + ag / al);
}

function calculateMACD(closes: number[], fast = 12, slow = 26, signal = 9) {
  if (closes.length < slow + signal) return { macd: 0, signal: 0, histogram: 0 };
  const ef = calculateEMA(closes, fast), es = calculateEMA(closes, slow);
  const ml = ef.map((v, i) => v - es[i]);
  const sl = calculateEMA(ml.slice(slow - 1), signal);
  const mv = ml[ml.length - 1], sv = sl[sl.length - 1];
  return { macd: mv, signal: sv, histogram: mv - sv };
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

function calculateROC(closes: number[], period = 12): number {
  if (closes.length <= period) return 0;
  const p = closes[closes.length - 1 - period];
  return p === 0 ? 0 : ((closes[closes.length - 1] - p) / p) * 100;
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

function calculateCMF(candles: Candle[], period = 20): number {
  if (candles.length < period) return 0;
  const r = candles.slice(-period);
  let ms = 0, vs = 0;
  for (const c of r) { const rng = c.high - c.low; const mfm = rng === 0 ? 0 : ((c.close - c.low) - (c.high - c.close)) / rng; ms += mfm * c.volume; vs += c.volume; }
  return vs === 0 ? 0 : ms / vs;
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

function calculateDonchianChannels(candles: Candle[], period = 20) {
  if (candles.length < period) { const p = candles[candles.length - 1]?.close || 0; return { upper: p, lower: p, middle: p, breakoutUp: false, breakoutDown: false }; }
  const lb = candles.slice(-period - 1, -1);
  let h = -Infinity, l = Infinity;
  for (const c of lb) { if (c.high > h) h = c.high; if (c.low < l) l = c.low; }
  const price = candles[candles.length - 1].close;
  return { upper: h, lower: l, middle: (h + l) / 2, breakoutUp: price > h, breakoutDown: price < l };
}

function calculateHistoricalVolatility(closes: number[], period = 20): number {
  if (closes.length < period + 1) return 0;
  const ret: number[] = [];
  for (let i = closes.length - period; i < closes.length; i++) if (closes[i - 1] !== 0) ret.push(Math.log(closes[i] / closes[i - 1]));
  if (ret.length < 2) return 0;
  const m = ret.reduce((s, v) => s + v, 0) / ret.length;
  return Math.sqrt(ret.reduce((s, v) => s + (v - m) ** 2, 0) / (ret.length - 1) * 252) * 100;
}

function detectSqueeze(bbU: number, bbL: number, kcU: number, kcL: number): boolean { return bbL > kcL && bbU < kcU; }

function calculateVolumeRatio(candles: Candle[], lookback = 20): number {
  if (candles.length < 2) return 1;
  const cur = candles[candles.length - 1].volume;
  const sl = candles.slice(-Math.min(lookback + 1, candles.length), -1);
  if (!sl.length) return 1;
  const avg = sl.reduce((s, c) => s + c.volume, 0) / sl.length;
  return avg === 0 ? 1 : cur / avg;
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

function calculateAD(candles: Candle[]) {
  if (candles.length < 2) return { value: 0, trend: "neutral" as const };
  let ad = 0; const as_: number[] = [];
  for (const c of candles) { const r = c.high - c.low; ad += (r === 0 ? 0 : ((c.close - c.low) - (c.high - c.close)) / r) * c.volume; as_.push(ad); }
  const lb = Math.min(10, as_.length), r = as_.slice(-lb), m = Math.floor(lb / 2);
  const a1 = r.slice(0, m).reduce((s, v) => s + v, 0) / m, a2 = r.slice(m).reduce((s, v) => s + v, 0) / (lb - m);
  const d = a1 === 0 ? 0 : ((a2 - a1) / Math.abs(a1 || 1)) * 100;
  return { value: ad, trend: d > 5 ? "bull" as const : d < -5 ? "bear" as const : "neutral" as const };
}

function calculateVPT(candles: Candle[]) {
  if (candles.length < 2) return { value: 0, trend: "neutral" as const };
  let vpt = 0; const vs = [0];
  for (let i = 1; i < candles.length; i++) { vpt += candles[i].volume * (candles[i - 1].close === 0 ? 0 : (candles[i].close - candles[i - 1].close) / candles[i - 1].close); vs.push(vpt); }
  const lb = Math.min(10, vs.length), r = vs.slice(-lb), m = Math.floor(lb / 2);
  const a1 = r.slice(0, m).reduce((s, v) => s + v, 0) / m, a2 = r.slice(m).reduce((s, v) => s + v, 0) / (lb - m);
  const d = a1 === 0 ? 0 : ((a2 - a1) / Math.abs(a1 || 1)) * 100;
  return { value: vpt, trend: d > 5 ? "bull" as const : d < -5 ? "bear" as const : "neutral" as const };
}

function detectVolumeSpikes(candles: Candle[], threshold = 2.5, lookback = 20) {
  if (candles.length < lookback + 1) return { isSpike: false, ratio: 1, consecutiveHighVolume: 0 };
  const as_ = candles.slice(-lookback - 1, -1), av = as_.reduce((s, c) => s + c.volume, 0) / as_.length;
  const cv = candles[candles.length - 1].volume, ratio = av === 0 ? 1 : cv / av;
  let con = 0;
  for (let i = candles.length - 1; i >= Math.max(0, candles.length - 10); i--) { if (candles[i].volume > av * 1.3) con++; else break; }
  return { isSpike: ratio >= threshold, ratio, consecutiveHighVolume: con };
}

function detectVolumeClusters(candles: Candle[], bins = 20) {
  if (candles.length < 10) return { highVolumeZone: "none" as const, vpocPrice: 0 };
  const lb = Math.min(candles.length, 100), r = candles.slice(-lb), price = candles[candles.length - 1].close;
  let mn = Infinity, mx = -Infinity;
  for (const c of r) { if (c.low < mn) mn = c.low; if (c.high > mx) mx = c.high; }
  const rng = mx - mn;
  if (rng === 0) return { highVolumeZone: "none" as const, vpocPrice: price };
  const bs = rng / bins, vap = new Array(bins).fill(0);
  for (const c of r) { const tp = (c.high + c.low + c.close) / 3; vap[Math.min(Math.floor((tp - mn) / bs), bins - 1)] += c.volume; }
  let mv = 0, vb = 0;
  for (let i = 0; i < bins; i++) if (vap[i] > mv) { mv = vap[i]; vb = i; }
  const vp = mn + (vb + 0.5) * bs, pb = Math.min(Math.floor((price - mn) / bs), bins - 1);
  const z = Math.abs(pb - vb) <= 1 ? "fair_value" : vb < pb ? "support" : "resistance";
  return { highVolumeZone: z as "support" | "resistance" | "fair_value" | "none", vpocPrice: vp };
}

// ─── Trend Duration & Reversal Analysis ─────────────────────────────
function calculateTrendDuration(
  candles: Candle[],
  direction: "bull" | "bear",
  ema9: number[], ema21: number[],
  rsi: number, macdHist: number, adx: number,
  volumeRatio: number, atr: number
) {
  const price = candles[candles.length - 1].close;
  const isBull = direction === "bull";

  let trendStartIdx = candles.length - 1;
  for (let i = candles.length - 2; i >= 0; i--) {
    if (i >= ema9.length || i >= ema21.length) break;
    const wasAligned = isBull ? ema9[i] > ema21[i] : ema9[i] < ema21[i];
    if (!wasAligned) { trendStartIdx = i + 1; break; }
    if (i === 0) trendStartIdx = 0;
  }

  const bars = candles.length - 1 - trendStartIdx;
  const startPrice = candles[trendStartIdx]?.close ?? price;
  const startTime = candles[trendStartIdx]?.time ?? 0;
  const trendMove = ((price - startPrice) / startPrice) * 100;

  let extreme = startPrice;
  for (let i = trendStartIdx; i < candles.length; i++) {
    if (isBull) { if (candles[i].high > extreme) extreme = candles[i].high; }
    else { if (candles[i].low < extreme) extreme = candles[i].low; }
  }

  const moveRange = extreme - startPrice;
  const fibRetrace382 = extreme - moveRange * 0.382;
  const fibRetrace500 = extreme - moveRange * 0.5;
  const fibRetrace618 = extreme - moveRange * 0.618;
  const fibExtend1272 = startPrice + moveRange * 1.272;
  const fibExtend1618 = startPrice + moveRange * 1.618;
  const atrStop = isBull ? price - 2 * atr : price + 2 * atr;

  // Find invalidation level
  let invalidationLevel = startPrice;
  let invalidationDescription = "";
  const trendCandles = candles.slice(Math.max(0, trendStartIdx - 2));
  const sHighs: { price: number }[] = [], sLows: { price: number }[] = [];
  for (let i = 2; i < trendCandles.length - 2; i++) {
    const c = trendCandles[i];
    if (c.high > trendCandles[i-1].high && c.high > trendCandles[i-2].high && c.high > trendCandles[i+1].high && c.high > trendCandles[i+2].high) sHighs.push({ price: c.high });
    if (c.low < trendCandles[i-1].low && c.low < trendCandles[i-2].low && c.low < trendCandles[i+1].low && c.low < trendCandles[i+2].low) sLows.push({ price: c.low });
  }
  if (isBull) {
    if (sLows.length >= 1) {
      invalidationLevel = sLows[sLows.length - 1].price;
      invalidationDescription = sLows.length >= 2 && sLows[sLows.length - 1].price > sLows[sLows.length - 2].price
        ? "Most recent Higher Low — break below invalidates uptrend" : "Most recent swing low — break below signals reversal";
    } else { invalidationDescription = "Trend start price — no swing low formed yet"; }
  } else {
    if (sHighs.length >= 1) {
      invalidationLevel = sHighs[sHighs.length - 1].price;
      invalidationDescription = sHighs.length >= 2 && sHighs[sHighs.length - 1].price < sHighs[sHighs.length - 2].price
        ? "Most recent Lower High — break above invalidates downtrend" : "Most recent swing high — break above signals reversal";
    } else { invalidationDescription = "Trend start price — no swing high formed yet"; }
  }

  const exhaustionSignals: string[] = [];
  if (isBull && rsi > 75) exhaustionSignals.push(`RSI overbought (${rsi.toFixed(0)})`);
  if (!isBull && rsi < 25) exhaustionSignals.push(`RSI oversold (${rsi.toFixed(0)})`);
  if (isBull && macdHist < 0) exhaustionSignals.push("MACD histogram negative");
  if (!isBull && macdHist > 0) exhaustionSignals.push("MACD histogram positive");
  if (bars > 50) exhaustionSignals.push(`Extended duration (${bars} bars)`);
  if (adx < 20) exhaustionSignals.push(`ADX weak (${adx.toFixed(0)})`);
  if (volumeRatio < 0.7) exhaustionSignals.push(`Low volume (${volumeRatio.toFixed(1)}x)`);
  const pctFromStart = Math.abs(trendMove);
  if (pctFromStart > 20) exhaustionSignals.push(`Large move (${pctFromStart.toFixed(1)}%)`);

  let exhaustionRisk: "low" | "medium" | "high" = "low";
  if (exhaustionSignals.length >= 3) exhaustionRisk = "high";
  else if (exhaustionSignals.length >= 1) exhaustionRisk = "medium";

  return { bars, startPrice, startTime, currentPrice: price, trendMove, fibRetrace382, fibRetrace500, fibRetrace618, fibExtend1272, fibExtend1618, exhaustionRisk, exhaustionSignals, atrStop, invalidationLevel, invalidationDescription };
}

// ─── Support & Resistance ───────────────────────────────────────────
function findSupportResistance(candles: Candle[], emas: { e9: number; e21: number; e50: number; e200: number }) {
  const price = candles[candles.length - 1].close;
  const lookback = Math.min(candles.length, 100), recent = candles.slice(-lookback);
  const levels: number[] = [];
  for (let i = 2; i < recent.length - 2; i++) {
    if (recent[i].high > recent[i-1].high && recent[i].high > recent[i-2].high && recent[i].high > recent[i+1].high && recent[i].high > recent[i+2].high) levels.push(recent[i].high);
    if (recent[i].low < recent[i-1].low && recent[i].low < recent[i-2].low && recent[i].low < recent[i+1].low && recent[i].low < recent[i+2].low) levels.push(recent[i].low);
  }
  levels.push(emas.e9, emas.e21, emas.e50, emas.e200);
  const supports = levels.filter(l => l < price).sort((a, b) => b - a);
  const resistances = levels.filter(l => l > price).sort((a, b) => a - b);
  return {
    nearestSupport: supports[0] ?? price * 0.95, nearestResistance: resistances[0] ?? price * 1.05,
    supportDistance: ((price - (supports[0] ?? price * 0.95)) / price) * 100,
    resistanceDistance: (((resistances[0] ?? price * 1.05) - price) / price) * 100,
  };
}
function analyzePriceStructure(candles: Candle[], lookback = 30): "bull" | "bear" | "neutral" {
  const r = candles.slice(-lookback);
  if (r.length < 8) return "neutral";
  const sh: number[] = [], sl: number[] = [];
  for (let i = 2; i < r.length - 2; i++) {
    if (r[i].high > r[i-1].high && r[i].high > r[i-2].high && r[i].high > r[i+1].high && r[i].high > r[i+2].high) sh.push(r[i].high);
    if (r[i].low < r[i-1].low && r[i].low < r[i-2].low && r[i].low < r[i+1].low && r[i].low < r[i+2].low) sl.push(r[i].low);
  }
  if (sh.length < 2 || sl.length < 2) return "neutral";
  const hh = sh.slice(1).filter((h, i) => h > sh[i]).length;
  const hl = sl.slice(1).filter((l, i) => l > sl[i]).length;
  const lh = sh.slice(1).filter((h, i) => h < sh[i]).length;
  const ll = sl.slice(1).filter((l, i) => l < sl[i]).length;
  const bs = hh + hl, br = lh + ll;
  if (bs >= 2 && bs > br) return "bull";
  if (br >= 2 && br > bs) return "bear";
  return "neutral";
}

function calcTrendConsistency(candles: Candle[], emaPeriod: number, lookbackBars = 20): number {
  const closes = candles.map(c => c.close), ema = calculateEMA(closes, emaPeriod);
  if (ema.length < lookbackBars) return 0;
  const re = ema.slice(-lookbackBars), rc = closes.slice(-lookbackBars);
  const dir = rc[rc.length - 1] > re[re.length - 1] ? "above" : "below";
  let con = 0;
  for (let i = 0; i < lookbackBars; i++) { const ab = rc[i] > re[i]; if ((dir === "above" && ab) || (dir === "below" && !ab)) con++; }
  return con / lookbackBars;
}

function analyzeTrend(candles: Candle[], emaPeriods = { fast: 9, slow: 21, mid: 50, long: 200 }, adxThreshold = 25): any {
  if (candles.length < emaPeriods.long + 10) return null;
  const closes = candles.map(c => c.close);
  const ema9 = calculateEMA(closes, emaPeriods.fast), ema21 = calculateEMA(closes, emaPeriods.slow);
  const ema50 = calculateEMA(closes, emaPeriods.mid), ema200 = calculateEMA(closes, emaPeriods.long);
  const li = closes.length - 1;
  const e9 = ema9[li], e21 = ema21[li], e50 = ema50[li], e200 = ema200[li], price = closes[li];

  const { adx, plusDI, minusDI } = calculateADX(candles);
  const rsi = calculateRSI(closes), macd = calculateMACD(closes);
  const volumeRatio = calculateVolumeRatio(candles);
  const priceStructure = analyzePriceStructure(candles);
  const dema21 = calculateDEMA(closes, 21), demaVal = dema21[dema21.length - 1];
  const ichimoku = calculateIchimoku(candles), psar = calculateParabolicSAR(candles);
  const supertrend = calculateSupertrend(candles), vwap = calculateVWAP(candles);
  const linReg = calculateLinearRegression(closes, 50);
  const stoch = calculateStochastic(candles), stochRsi = calculateStochRSI(closes);
  const williamsR = calculateWilliamsR(candles), cci = calculateCCI(candles);
  const roc = calculateROC(closes), mfi = calculateMFI(candles);
  const cmf = calculateCMF(candles), tsi = calculateTSI(closes);
  const bb = calculateBollingerBands(closes), kc = calculateKeltnerChannels(candles);
  const donchian = calculateDonchianChannels(candles);
  const isSqueeze = detectSqueeze(bb.upper, bb.lower, kc.upper, kc.lower);
  const obv = calculateOBV(candles), ad = calculateAD(candles), vpt = calculateVPT(candles);
  const volSpike = detectVolumeSpikes(candles), volClusters = detectVolumeClusters(candles);
  const consistency50 = calcTrendConsistency(candles, 50, 20), consistency200 = calcTrendConsistency(candles, 200, 30);

  // Weighted voting with indicators array (matches client-side)
  const indicators: any[] = [];
  let bull = 0, bear = 0, tw = 0;

  const vote = (w: number, sig: "bull" | "bear" | "neutral", name: string, value: string) => {
    tw += w;
    const confirmed = sig !== "neutral";
    if (sig === "bull") bull += w;
    else if (sig === "bear") bear += w;
    indicators.push({ name, signal: sig, value, confirmed, weight: w });
  };
  const skip = (w: number, name: string, value: string) => {
    tw += w;
    indicators.push({ name, signal: "neutral", value, confirmed: false, weight: w });
  };

  // EMA Ribbon
  const emaAligned = e9 > e21 && e21 > e50 && e50 > e200;
  const emaBear = e9 < e21 && e21 < e50 && e50 < e200;
  if (emaAligned) vote(2, "bull", "EMA Ribbon", "Fully aligned ↑");
  else if (emaBear) vote(2, "bear", "EMA Ribbon", "Fully aligned ↓");
  else if (e9 > e21 && price > e50) { tw += 2; bull += 0.8; indicators.push({ name: "EMA Ribbon", signal: "bull", value: "Partial ↑", confirmed: false, weight: 2 }); }
  else if (e9 < e21 && price < e50) { tw += 2; bear += 0.8; indicators.push({ name: "EMA Ribbon", signal: "bear", value: "Partial ↓", confirmed: false, weight: 2 }); }
  else skip(2, "EMA Ribbon", "Mixed");

  // ADX
  if (adx >= adxThreshold) vote(1.8, plusDI > minusDI ? "bull" : "bear", "ADX/DI", `ADX ${adx.toFixed(0)} ${plusDI > minusDI ? "+DI>-DI" : "-DI>+DI"}`);
  else skip(1.8, "ADX/DI", `ADX ${adx.toFixed(0)} (weak)`);

  // Ichimoku
  const iFB = ichimoku.priceVsCloud === "above" && ichimoku.cloudDirection === "bull" && ichimoku.tenkan > ichimoku.kijun && ichimoku.chikouVsPrice > 0;
  const iFBr = ichimoku.priceVsCloud === "below" && ichimoku.cloudDirection === "bear" && ichimoku.tenkan < ichimoku.kijun && ichimoku.chikouVsPrice < 0;
  if (iFB) vote(2, "bull", "Ichimoku", "All 5 lines bullish");
  else if (iFBr) vote(2, "bear", "Ichimoku", "All 5 lines bearish");
  else if (ichimoku.priceVsCloud === "above") { tw += 2; bull += 0.8; indicators.push({ name: "Ichimoku", signal: "bull", value: `Above cloud (${ichimoku.cloudDirection})`, confirmed: false, weight: 2 }); }
  else if (ichimoku.priceVsCloud === "below") { tw += 2; bear += 0.8; indicators.push({ name: "Ichimoku", signal: "bear", value: `Below cloud (${ichimoku.cloudDirection})`, confirmed: false, weight: 2 }); }
  else skip(2, "Ichimoku", "Inside cloud");

  vote(1.2, psar.direction, "Parabolic SAR", psar.direction === "bull" ? "SAR below price" : "SAR above price");
  vote(1.5, supertrend.direction, "Supertrend", `${supertrend.direction === "bull" ? "Uptrend" : "Downtrend"} ${supertrend.value.toPrecision(5)}`);
  if (price > vwap * 1.002) vote(1, "bull", "VWAP", "Price above VWAP"); else if (price < vwap * 0.998) vote(1, "bear", "VWAP", "Price below VWAP"); else skip(1, "VWAP", "At VWAP");
  if (linReg.rSquared > 0.6) vote(1.3, linReg.slope > 0 ? "bull" : "bear", "Lin Regression", `R²=${linReg.rSquared.toFixed(2)} slope ${linReg.slope > 0 ? "↑" : "↓"}`); else skip(1.3, "Lin Regression", `R²=${linReg.rSquared.toFixed(2)} (weak fit)`);
  if (price > demaVal && demaVal > e50) vote(0.8, "bull", "DEMA", "Price > DEMA > EMA50"); else if (price < demaVal && demaVal < e50) vote(0.8, "bear", "DEMA", "Price < DEMA < EMA50"); else skip(0.8, "DEMA", "Mixed DEMA signals");
  const pctFrom200 = ((price - e200) / e200) * 100;
  vote(1.5, price > e200 ? "bull" : "bear", "200 EMA", `${pctFrom200 >= 0 ? "+" : ""}${pctFrom200.toFixed(1)}% ${price > e200 ? "above" : "below"}`);
  if (priceStructure !== "neutral") vote(1.8, priceStructure, "Structure", priceStructure === "bull" ? "HH + HL pattern" : "LH + LL pattern"); else skip(1.8, "Structure", "No clear pattern");

  // Momentum
  if (rsi > 55 && rsi < 75) vote(1.2, "bull", "RSI", `${rsi.toFixed(0)} bullish`); else if (rsi < 45 && rsi > 25) vote(1.2, "bear", "RSI", `${rsi.toFixed(0)} bearish`); else skip(1.2, "RSI", `${rsi.toFixed(0)}`);
  if (macd.histogram > 0 && macd.macd > 0) vote(1.3, "bull", "MACD", `Hist +${macd.histogram.toPrecision(3)}`); else if (macd.histogram < 0 && macd.macd < 0) vote(1.3, "bear", "MACD", `Hist ${macd.histogram.toPrecision(3)}`); else skip(1.3, "MACD", "Diverging");
  if (stoch.k > 50 && stoch.k < 80 && stoch.k > stoch.d) vote(0.8, "bull", "Stochastic", `%K=${stoch.k.toFixed(0)} > %D`); else if (stoch.k < 50 && stoch.k > 20 && stoch.k < stoch.d) vote(0.8, "bear", "Stochastic", `%K=${stoch.k.toFixed(0)} < %D`); else skip(0.8, "Stochastic", `%K=${stoch.k.toFixed(0)}`);
  if (stochRsi.k > 50 && stochRsi.k < 85) vote(0.7, "bull", "StochRSI", `K=${stochRsi.k.toFixed(0)}`); else if (stochRsi.k < 50 && stochRsi.k > 15) vote(0.7, "bear", "StochRSI", `K=${stochRsi.k.toFixed(0)}`); else skip(0.7, "StochRSI", `K=${stochRsi.k.toFixed(0)} (extreme)`);
  if (williamsR > -50 && williamsR > -20) vote(0.6, "bull", "Williams %R", `${williamsR.toFixed(0)}`); else if (williamsR < -50 && williamsR < -80) vote(0.6, "bear", "Williams %R", `${williamsR.toFixed(0)}`); else skip(0.6, "Williams %R", `${williamsR.toFixed(0)}`);
  if (cci > 50 && cci < 200) vote(0.8, "bull", "CCI", `${cci.toFixed(0)} bullish`); else if (cci < -50 && cci > -200) vote(0.8, "bear", "CCI", `${cci.toFixed(0)} bearish`); else skip(0.8, "CCI", `${cci.toFixed(0)}`);
  if (roc > 1) vote(0.7, "bull", "ROC", `+${roc.toFixed(1)}%`); else if (roc < -1) vote(0.7, "bear", "ROC", `${roc.toFixed(1)}%`); else skip(0.7, "ROC", `${roc.toFixed(1)}%`);
  if (mfi > 55 && mfi < 80) vote(1, "bull", "MFI", `${mfi.toFixed(0)} inflow`); else if (mfi < 45 && mfi > 20) vote(1, "bear", "MFI", `${mfi.toFixed(0)} outflow`); else skip(1, "MFI", `${mfi.toFixed(0)}`);
  if (cmf > 0.05) vote(1, "bull", "CMF", `${cmf.toFixed(3)} accumulation`); else if (cmf < -0.05) vote(1, "bear", "CMF", `${cmf.toFixed(3)} distribution`); else skip(1, "CMF", `${cmf.toFixed(3)}`);
  if (tsi > 5) vote(0.9, "bull", "TSI", `${tsi.toFixed(1)} positive`); else if (tsi < -5) vote(0.9, "bear", "TSI", `${tsi.toFixed(1)} negative`); else skip(0.9, "TSI", `${tsi.toFixed(1)}`);

  // Volatility
  if (bb.percentB > 0.6 && bb.percentB < 0.95) vote(0.8, "bull", "Bollinger", `%B=${(bb.percentB*100).toFixed(0)} upper half`); else if (bb.percentB < 0.4 && bb.percentB > 0.05) vote(0.8, "bear", "Bollinger", `%B=${(bb.percentB*100).toFixed(0)} lower half`); else skip(0.8, "Bollinger", `%B=${(bb.percentB*100).toFixed(0)}`);
  if (donchian.breakoutUp) vote(1.2, "bull", "Donchian", "Breakout above"); else if (donchian.breakoutDown) vote(1.2, "bear", "Donchian", "Breakout below");
  else if (price > donchian.middle) { tw += 1.2; bull += 0.36; indicators.push({ name: "Donchian", signal: "bull", value: "Upper half", confirmed: false, weight: 1.2 }); }
  else if (price < donchian.middle) { tw += 1.2; bear += 0.36; indicators.push({ name: "Donchian", signal: "bear", value: "Lower half", confirmed: false, weight: 1.2 }); }
  else skip(1.2, "Donchian", "Middle");
  if (isSqueeze) indicators.push({ name: "Squeeze", signal: "neutral", value: "BB inside KC — breakout imminent", confirmed: false, weight: 0 });

  // Volume
  if (volumeRatio > 1.3) { const d = bull > bear ? "bull" : bear > bull ? "bear" : "neutral"; if (d !== "neutral") vote(1, d as any, "Volume", `${volumeRatio.toFixed(1)}x avg`); else skip(1, "Volume", `${volumeRatio.toFixed(1)}x avg`); } else skip(1, "Volume", `${volumeRatio.toFixed(1)}x avg (low)`);
  if (obv.trend !== "neutral") vote(1, obv.trend, "OBV", obv.trend === "bull" ? "Rising" : "Falling"); else skip(1, "OBV", "Flat");
  if (ad.trend !== "neutral") vote(0.8, ad.trend, "A/D Line", ad.trend === "bull" ? "Accumulation" : "Distribution"); else skip(0.8, "A/D Line", "Flat");
  if (vpt.trend !== "neutral") vote(0.7, vpt.trend, "VPT", vpt.trend === "bull" ? "Rising" : "Falling"); else skip(0.7, "VPT", "Flat");
  if (volClusters.highVolumeZone === "support") vote(0.6, "bull", "Vol Clusters", "Support at VPOC"); else if (volClusters.highVolumeZone === "resistance") vote(0.6, "bear", "Vol Clusters", "Resistance at VPOC"); else skip(0.6, "Vol Clusters", volClusters.highVolumeZone === "fair_value" ? "At fair value" : "No cluster");

  const maxS = Math.max(bull, bear), sr = tw > 0 ? maxS / tw : 0;
  const isEst = consistency50 > 0.65 || consistency200 > 0.7;
  if (sr < 0.55 || !isEst) return null;

  const direction = bull > bear ? "bull" : "bear";
  const strength = sr >= 0.75 ? "strong" : sr >= 0.65 ? "moderate" : "weak";
  const score = direction === "bull" ? Math.round(bull * 4) : -Math.round(bear * 4);

  let probability = sr * 70 + Math.min((consistency50 + consistency200) / 2, 1) * 10 + Math.min(adx / 60, 1) * 5;
  if (volumeRatio > 1.3 || volSpike.consecutiveHighVolume >= 2) probability += 5;
  if (isSqueeze) probability -= 3;
  probability -= (Math.min(bull, bear) / tw) * 10;
  probability = Math.max(15, Math.min(95, Math.round(probability)));

  const confirmations = indicators.filter(i => i.confirmed && i.signal === direction).length;
  const totalChecks = indicators.length;

  const atr = calculateATR(candles);
  const trendDuration = calculateTrendDuration(candles, direction, ema9, ema21, rsi, macd.histogram, adx, volumeRatio, atr);
  const supportResistance = findSupportResistance(candles, { e9, e21, e50, e200 });

  return { direction, strength, ema9: e9, ema21: e21, ema50: e50, ema200: e200, adx, volumeRatio, score, rsi, macdHistogram: macd.histogram, priceStructure, plusDI, minusDI, probability, confirmations, totalChecks, indicators, trendDuration, supportResistance };
}

// ─── Pattern Detection ──────────────────────────────────────────────
function detectCandlestickPatterns(candles: Candle[]) {
  if (candles.length < 5) return [];
  const patterns: any[] = [], len = candles.length;
  const avgB = (() => { const sl = candles.slice(-14); return sl.reduce((s, c) => s + Math.abs(c.close - c.open), 0) / sl.length; })();
  const bs = (c: Candle) => Math.abs(c.close - c.open);
  const uw = (c: Candle) => c.high - Math.max(c.open, c.close);
  const lw = (c: Candle) => Math.min(c.open, c.close) - c.low;
  const isBull = (c: Candle) => c.close > c.open;
  const isBear = (c: Candle) => c.close < c.open;
  const rng = (c: Candle) => c.high - c.low;

  // Exclude last (incomplete/still-forming) candle
  for (let i = Math.max(2, len - 4); i < len - 1; i++) {
    const c = candles[i], p = candles[i - 1], p2 = i >= 2 ? candles[i - 2] : null;
    const r = rng(c), b = bs(c);
    if (b < r * 0.1 && r > 0) patterns.push({ name: "Doji", type: "neutral", significance: "medium", candleIndex: i });
    if (lw(c) > b * 2 && uw(c) < b * 0.5 && isBear(p)) patterns.push({ name: "Hammer", type: "bullish", significance: "high", candleIndex: i });
    if (uw(c) > b * 2 && lw(c) < b * 0.5 && isBear(p)) patterns.push({ name: "Inverted Hammer", type: "bullish", significance: "medium", candleIndex: i });
    if (uw(c) > b * 2 && lw(c) < b * 0.5 && isBull(p)) patterns.push({ name: "Shooting Star", type: "bearish", significance: "high", candleIndex: i });
    if (lw(c) > b * 2 && uw(c) < b * 0.5 && isBull(p)) patterns.push({ name: "Hanging Man", type: "bearish", significance: "medium", candleIndex: i });
    if (b > avgB * 1.5 && uw(c) < b * 0.05 && lw(c) < b * 0.05) patterns.push({ name: isBull(c) ? "Bullish Marubozu" : "Bearish Marubozu", type: isBull(c) ? "bullish" : "bearish", significance: "high", candleIndex: i });
    if (b < r * 0.3 && uw(c) > b && lw(c) > b && r > avgB * 0.5) patterns.push({ name: "Spinning Top", type: "neutral", significance: "low", candleIndex: i });
    if (isBull(c) && isBear(p) && c.open <= p.close && c.close >= p.open && b > bs(p)) patterns.push({ name: "Bullish Engulfing", type: "bullish", significance: "high", candleIndex: i });
    if (isBear(c) && isBull(p) && c.open >= p.close && c.close <= p.open && b > bs(p)) patterns.push({ name: "Bearish Engulfing", type: "bearish", significance: "high", candleIndex: i });
    if (isBull(c) && isBear(p) && c.open < p.low && c.close > (p.open + p.close) / 2 && c.close < p.open) patterns.push({ name: "Piercing Line", type: "bullish", significance: "medium", candleIndex: i });
    if (isBear(c) && isBull(p) && c.open > p.high && c.close < (p.open + p.close) / 2 && c.close > p.open) patterns.push({ name: "Dark Cloud Cover", type: "bearish", significance: "medium", candleIndex: i });
    if (isBull(c) && isBear(p) && Math.abs(c.low - p.low) / avgB < 0.05) patterns.push({ name: "Tweezer Bottom", type: "bullish", significance: "medium", candleIndex: i });
    if (isBear(c) && isBull(p) && Math.abs(c.high - p.high) / avgB < 0.05) patterns.push({ name: "Tweezer Top", type: "bearish", significance: "medium", candleIndex: i });
    if (p2) {
      if (isBear(p2) && bs(p) < avgB * 0.3 && isBull(c) && c.close > (p2.open + p2.close) / 2) patterns.push({ name: "Morning Star", type: "bullish", significance: "high", candleIndex: i });
      if (isBull(p2) && bs(p) < avgB * 0.3 && isBear(c) && c.close < (p2.open + p2.close) / 2) patterns.push({ name: "Evening Star", type: "bearish", significance: "high", candleIndex: i });
      if (isBull(p2) && isBull(p) && isBull(c) && p.close > p2.close && c.close > p.close && bs(p2) > avgB * 0.5 && bs(p) > avgB * 0.5 && b > avgB * 0.5) patterns.push({ name: "Three White Soldiers", type: "bullish", significance: "high", candleIndex: i });
      if (isBear(p2) && isBear(p) && isBear(c) && p.close < p2.close && c.close < p.close && bs(p2) > avgB * 0.5 && bs(p) > avgB * 0.5 && b > avgB * 0.5) patterns.push({ name: "Three Black Crows", type: "bearish", significance: "high", candleIndex: i });
    }
  }
  return patterns;
}

function findSwingPoints(candles: Candle[], lookback = 3) {
  const pts: { index: number; price: number; type: "high" | "low" }[] = [];
  for (let i = lookback; i < candles.length - lookback; i++) {
    let isH = true, isL = true;
    for (let j = 1; j <= lookback; j++) {
      if (candles[i].high <= candles[i - j].high || candles[i].high <= candles[i + j].high) isH = false;
      if (candles[i].low >= candles[i - j].low || candles[i].low >= candles[i + j].low) isL = false;
    }
    if (isH) pts.push({ index: i, price: candles[i].high, type: "high" });
    if (isL) pts.push({ index: i, price: candles[i].low, type: "low" });
  }
  return pts;
}

function pctDiff(a: number, b: number): number { return Math.abs(a - b) / Math.max(a, b) * 100; }

function detectChartPatterns(candles: Candle[]) {
  if (candles.length < 30) return [];
  const patterns: any[] = [], swings = findSwingPoints(candles, 3);
  const highs = swings.filter(s => s.type === "high"), lows = swings.filter(s => s.type === "low");

  for (let i = 0; i < highs.length - 1; i++) {
    const h1 = highs[i], h2 = highs[i + 1];
    if (h2.index - h1.index >= 5 && pctDiff(h1.price, h2.price) < 1.5) {
      const v = lows.find(l => l.index > h1.index && l.index < h2.index);
      if (v && v.price < h1.price * 0.97) patterns.push({ name: "Double Top", type: "bearish", significance: "high", startIndex: h1.index, endIndex: h2.index });
    }
  }
  for (let i = 0; i < lows.length - 1; i++) {
    const l1 = lows[i], l2 = lows[i + 1];
    if (l2.index - l1.index >= 5 && pctDiff(l1.price, l2.price) < 1.5) {
      const p = highs.find(h => h.index > l1.index && h.index < l2.index);
      if (p && p.price > l1.price * 1.03) patterns.push({ name: "Double Bottom", type: "bullish", significance: "high", startIndex: l1.index, endIndex: l2.index });
    }
  }
  for (let i = 0; i < highs.length - 2; i++) {
    const ls = highs[i], hd = highs[i + 1], rs = highs[i + 2];
    if (hd.price > ls.price && hd.price > rs.price && pctDiff(ls.price, rs.price) < 3 && hd.price > ls.price * 1.02)
      patterns.push({ name: "Head & Shoulders", type: "bearish", significance: "high", startIndex: ls.index, endIndex: rs.index });
  }
  for (let i = 0; i < lows.length - 2; i++) {
    const ls = lows[i], hd = lows[i + 1], rs = lows[i + 2];
    if (hd.price < ls.price && hd.price < rs.price && pctDiff(ls.price, rs.price) < 3 && hd.price < ls.price * 0.98)
      patterns.push({ name: "Inverse H&S", type: "bullish", significance: "high", startIndex: ls.index, endIndex: rs.index });
  }

  if (highs.length >= 2 && lows.length >= 2) {
    const rh = highs.slice(-3), rl = lows.slice(-3);
    if (rh.length >= 2 && rl.length >= 2) {
      const flatTop = pctDiff(rh[0].price, rh[rh.length - 1].price) < 1;
      const risingLows = rl[rl.length - 1].price > rl[0].price * 1.01;
      if (flatTop && risingLows) patterns.push({ name: "Ascending Triangle", type: "bullish", significance: "high", startIndex: Math.min(rh[0].index, rl[0].index), endIndex: candles.length - 1 });

      const fallingHighs = rh[rh.length - 1].price < rh[0].price * 0.99;
      const flatBottom = pctDiff(rl[0].price, rl[rl.length - 1].price) < 1;
      if (fallingHighs && flatBottom) patterns.push({ name: "Descending Triangle", type: "bearish", significance: "high", startIndex: Math.min(rh[0].index, rl[0].index), endIndex: candles.length - 1 });

      if (fallingHighs && risingLows) patterns.push({ name: "Symmetrical Triangle", type: "neutral", significance: "medium", startIndex: Math.min(rh[0].index, rl[0].index), endIndex: candles.length - 1 });
    }
  }

  return patterns;
}

function detectMarketStructure(candles: Candle[]) {
  if (candles.length < 20) return [];
  const events: any[] = [], swings = findSwingPoints(candles, 3);
  const highs = swings.filter(s => s.type === "high"), lows = swings.filter(s => s.type === "low");

  // BOS
  for (let i = 1; i < highs.length; i++) {
    const ph = highs[i - 1];
    for (let j = ph.index + 1; j < candles.length; j++) {
      if (candles[j].close > ph.price) { if (j >= candles.length - 5) events.push({ name: "Bullish BOS", type: "bullish", significance: "high", candleIndex: j, price: ph.price }); break; }
    }
  }
  for (let i = 1; i < lows.length; i++) {
    const pl = lows[i - 1];
    for (let j = pl.index + 1; j < candles.length; j++) {
      if (candles[j].close < pl.price) { if (j >= candles.length - 5) events.push({ name: "Bearish BOS", type: "bearish", significance: "high", candleIndex: j, price: pl.price }); break; }
    }
  }

  // CHoCH
  if (highs.length >= 3) {
    const l3 = highs.slice(-3);
    if (l3[1].price < l3[0].price && l3[2].price > l3[1].price) events.push({ name: "Bullish CHoCH", type: "bullish", significance: "high", candleIndex: l3[2].index, price: l3[2].price });
  }
  if (lows.length >= 3) {
    const l3 = lows.slice(-3);
    if (l3[1].price > l3[0].price && l3[2].price < l3[1].price) events.push({ name: "Bearish CHoCH", type: "bearish", significance: "high", candleIndex: l3[2].index, price: l3[2].price });
  }

  // FVG
  const fs = Math.max(1, candles.length - 20);
  for (let i = fs; i < candles.length - 1; i++) {
    const c0 = candles[i - 1], c2 = candles[i + 1];
    if (c2.low > c0.high) events.push({ name: "Bullish FVG", type: "bullish", significance: "medium", candleIndex: i, price: (c0.high + c2.low) / 2 });
    if (c2.high < c0.low) events.push({ name: "Bearish FVG", type: "bearish", significance: "medium", candleIndex: i, price: (c0.low + c2.high) / 2 });
  }

  // Order Blocks
  for (let i = Math.max(1, candles.length - 15); i < candles.length - 2; i++) {
    const c = candles[i], n = candles[i + 1], n2 = candles[i + 2];
    if (c.close < c.open && n.close > c.high && n2.close > n.close) events.push({ name: "Bullish Order Block", type: "bullish", significance: "high", candleIndex: i, price: c.low });
    if (c.close > c.open && n.close < c.low && n2.close < n.close) events.push({ name: "Bearish Order Block", type: "bearish", significance: "high", candleIndex: i, price: c.high });
  }

  // Equal highs/lows
  if (highs.length >= 2) {
    const l2 = highs.slice(-2);
    if (Math.abs(l2[0].price - l2[1].price) / l2[0].price * 100 < 0.3)
      events.push({ name: "Equal Highs (Liquidity)", type: "bearish", significance: "medium", candleIndex: l2[1].index, price: l2[1].price });
  }
  if (lows.length >= 2) {
    const l2 = lows.slice(-2);
    if (Math.abs(l2[0].price - l2[1].price) / l2[0].price * 100 < 0.3)
      events.push({ name: "Equal Lows (Liquidity)", type: "bullish", significance: "medium", candleIndex: l2[1].index, price: l2[1].price });
  }

  return events;
}

// ─── Range Detection ────────────────────────────────────────────────
interface RangeLevel {
  upper: number;
  lower: number;
  midpoint: number;
  width: number; // percentage width
}

function analyzeRange(candles: Candle[], emaPeriods = { fast: 9, slow: 21, mid: 50, long: 200 }, adxThreshold = 25): any {
  if (candles.length < emaPeriods.long + 10) return null;

  const closes = candles.map(c => c.close);
  const price = closes[closes.length - 1];
  const ema9 = calculateEMA(closes, emaPeriods.fast);
  const ema21 = calculateEMA(closes, emaPeriods.slow);
  const ema50 = calculateEMA(closes, emaPeriods.mid);
  const ema200 = calculateEMA(closes, emaPeriods.long);
  const li = closes.length - 1;
  const e9 = ema9[li], e21 = ema21[li], e50 = ema50[li], e200 = ema200[li];

  const { adx, plusDI, minusDI } = calculateADX(candles);
  const rsi = calculateRSI(closes);
  const bb = calculateBollingerBands(closes);
  const kc = calculateKeltnerChannels(candles);
  const donchian = calculateDonchianChannels(candles);
  const atr = calculateATR(candles);
  const volumeRatio = calculateVolumeRatio(candles);
  const isSqueeze = detectSqueeze(bb.upper, bb.lower, kc.upper, kc.lower);
  const linReg = calculateLinearRegression(closes, 50);
  const macd = calculateMACD(closes);
  const stoch = calculateStochastic(candles);
  const consistency50 = calcTrendConsistency(candles, 50, 20);
  const priceStructure = analyzePriceStructure(candles);

  // ─── Range Indicators (inverted from trend — we WANT low directional movement) ───
  const indicators: any[] = [];
  let rangeScore = 0, totalWeight = 0;

  // 1. ADX < threshold = ranging (weight: 2.5 — most important)
  const w1 = 2.5;
  totalWeight += w1;
  if (adx < 20) { rangeScore += w1; indicators.push({ name: "ADX", signal: "range", value: `${adx.toFixed(0)} (very weak trend)`, confirmed: true, weight: w1 }); }
  else if (adx < adxThreshold) { rangeScore += w1 * 0.7; indicators.push({ name: "ADX", signal: "range", value: `${adx.toFixed(0)} (weak trend)`, confirmed: true, weight: w1 }); }
  else { indicators.push({ name: "ADX", signal: "trend", value: `${adx.toFixed(0)} (trending)`, confirmed: false, weight: w1 }); }

  // 2. DI convergence (weight: 1.5)
  const w2 = 1.5;
  totalWeight += w2;
  const diDiff = Math.abs(plusDI - minusDI);
  if (diDiff < 5) { rangeScore += w2; indicators.push({ name: "DI Spread", signal: "range", value: `${diDiff.toFixed(1)} (converged)`, confirmed: true, weight: w2 }); }
  else if (diDiff < 10) { rangeScore += w2 * 0.5; indicators.push({ name: "DI Spread", signal: "range", value: `${diDiff.toFixed(1)} (narrow)`, confirmed: true, weight: w2 }); }
  else { indicators.push({ name: "DI Spread", signal: "trend", value: `${diDiff.toFixed(1)} (wide)`, confirmed: false, weight: w2 }); }

  // 3. Bollinger bandwidth (weight: 2.0)
  const w3 = 2.0;
  totalWeight += w3;
  if (bb.bandwidth < 0.04) { rangeScore += w3; indicators.push({ name: "BB Width", signal: "range", value: `${(bb.bandwidth * 100).toFixed(1)}% (tight)`, confirmed: true, weight: w3 }); }
  else if (bb.bandwidth < 0.08) { rangeScore += w3 * 0.6; indicators.push({ name: "BB Width", signal: "range", value: `${(bb.bandwidth * 100).toFixed(1)}% (moderate)`, confirmed: true, weight: w3 }); }
  else { indicators.push({ name: "BB Width", signal: "trend", value: `${(bb.bandwidth * 100).toFixed(1)}% (wide)`, confirmed: false, weight: w3 }); }

  // 4. BB %B near middle (weight: 1.5)
  const w4 = 1.5;
  totalWeight += w4;
  if (bb.percentB > 0.3 && bb.percentB < 0.7) { rangeScore += w4; indicators.push({ name: "BB %B", signal: "range", value: `${(bb.percentB * 100).toFixed(0)}% (mid-band)`, confirmed: true, weight: w4 }); }
  else { indicators.push({ name: "BB %B", signal: "trend", value: `${(bb.percentB * 100).toFixed(0)}% (extreme)`, confirmed: false, weight: w4 }); }

  // 5. Squeeze (BB inside KC) (weight: 1.8)
  const w5 = 1.8;
  totalWeight += w5;
  if (isSqueeze) { rangeScore += w5; indicators.push({ name: "Squeeze", signal: "range", value: "Active (BB inside KC)", confirmed: true, weight: w5 }); }
  else { indicators.push({ name: "Squeeze", signal: "neutral", value: "None", confirmed: false, weight: w5 }); }

  // 6. RSI near 50 (weight: 1.3)
  const w6 = 1.3;
  totalWeight += w6;
  if (rsi > 40 && rsi < 60) { rangeScore += w6; indicators.push({ name: "RSI", signal: "range", value: `${rsi.toFixed(0)} (neutral zone)`, confirmed: true, weight: w6 }); }
  else { indicators.push({ name: "RSI", signal: "trend", value: `${rsi.toFixed(0)} (directional)`, confirmed: false, weight: w6 }); }

  // 7. EMA convergence (weight: 2.0)
  const w7 = 2.0;
  totalWeight += w7;
  const emaSpread = Math.max(e9, e21, e50) - Math.min(e9, e21, e50);
  const emaSpreadPct = (emaSpread / price) * 100;
  if (emaSpreadPct < 0.5) { rangeScore += w7; indicators.push({ name: "EMA Spread", signal: "range", value: `${emaSpreadPct.toFixed(2)}% (converged)`, confirmed: true, weight: w7 }); }
  else if (emaSpreadPct < 1.5) { rangeScore += w7 * 0.5; indicators.push({ name: "EMA Spread", signal: "range", value: `${emaSpreadPct.toFixed(2)}% (narrow)`, confirmed: true, weight: w7 }); }
  else { indicators.push({ name: "EMA Spread", signal: "trend", value: `${emaSpreadPct.toFixed(2)}% (wide)`, confirmed: false, weight: w7 }); }

  // 8. Linear Regression R² low (weight: 1.5)
  const w8 = 1.5;
  totalWeight += w8;
  if (linReg.rSquared < 0.3) { rangeScore += w8; indicators.push({ name: "Lin Reg R²", signal: "range", value: `${linReg.rSquared.toFixed(2)} (no trend)`, confirmed: true, weight: w8 }); }
  else if (linReg.rSquared < 0.5) { rangeScore += w8 * 0.5; indicators.push({ name: "Lin Reg R²", signal: "range", value: `${linReg.rSquared.toFixed(2)} (weak fit)`, confirmed: true, weight: w8 }); }
  else { indicators.push({ name: "Lin Reg R²", signal: "trend", value: `${linReg.rSquared.toFixed(2)} (trending)`, confirmed: false, weight: w8 }); }

  // 9. MACD near zero (weight: 1.2)
  const w9 = 1.2;
  totalWeight += w9;
  const macdNorm = price > 0 ? Math.abs(macd.macd / price) * 100 : 0;
  if (macdNorm < 0.1) { rangeScore += w9; indicators.push({ name: "MACD", signal: "range", value: `Near zero line`, confirmed: true, weight: w9 }); }
  else { indicators.push({ name: "MACD", signal: "trend", value: `${macd.macd > 0 ? "+" : ""}${macd.macd.toPrecision(3)}`, confirmed: false, weight: w9 }); }

  // 10. Price structure neutral (weight: 1.5)
  const w10 = 1.5;
  totalWeight += w10;
  if (priceStructure === "neutral") { rangeScore += w10; indicators.push({ name: "Structure", signal: "range", value: "No HH/HL or LH/LL", confirmed: true, weight: w10 }); }
  else { indicators.push({ name: "Structure", signal: "trend", value: priceStructure === "bull" ? "HH/HL" : "LH/LL", confirmed: false, weight: w10 }); }

  // 11. Low trend consistency (weight: 1.2)
  const w11 = 1.2;
  totalWeight += w11;
  if (consistency50 < 0.55) { rangeScore += w11; indicators.push({ name: "Consistency", signal: "range", value: `${(consistency50 * 100).toFixed(0)}% (choppy)`, confirmed: true, weight: w11 }); }
  else { indicators.push({ name: "Consistency", signal: "trend", value: `${(consistency50 * 100).toFixed(0)}% (consistent)`, confirmed: false, weight: w11 }); }

  // 12. Stochastic oscillating in mid zone (weight: 1.0)
  const w12 = 1.0;
  totalWeight += w12;
  if (stoch.k > 25 && stoch.k < 75 && Math.abs(stoch.k - stoch.d) < 10) { rangeScore += w12; indicators.push({ name: "Stochastic", signal: "range", value: `K=${stoch.k.toFixed(0)} ~D (oscillating)`, confirmed: true, weight: w12 }); }
  else { indicators.push({ name: "Stochastic", signal: "trend", value: `K=${stoch.k.toFixed(0)}`, confirmed: false, weight: w12 }); }

  // ─── Determine if ranging ───
  const scoreRatio = totalWeight > 0 ? rangeScore / totalWeight : 0;
  if (scoreRatio < 0.45) return null; // not ranging enough

  const confirmedCount = indicators.filter(i => i.confirmed).length;

  // ─── Calculate range bounds ───
  // Use multiple methods and find consensus
  const ranges: RangeLevel[] = [];

  // Method 1: Bollinger Bands
  ranges.push({ upper: bb.upper, lower: bb.lower, midpoint: bb.middle, width: ((bb.upper - bb.lower) / bb.middle) * 100 });

  // Method 2: Donchian Channels
  ranges.push({ upper: donchian.upper, lower: donchian.lower, midpoint: donchian.middle, width: ((donchian.upper - donchian.lower) / donchian.middle) * 100 });

  // Method 3: Keltner Channels
  ranges.push({ upper: kc.upper, lower: kc.lower, midpoint: kc.middle, width: ((kc.upper - kc.lower) / kc.middle) * 100 });

  // Method 4: Swing high/low based range
  const swings = findSwingPoints(candles, 3);
  const recentHighs = swings.filter(s => s.type === "high").slice(-5).map(s => s.price);
  const recentLows = swings.filter(s => s.type === "low").slice(-5).map(s => s.price);
  if (recentHighs.length >= 2 && recentLows.length >= 2) {
    const avgHigh = recentHighs.reduce((s, v) => s + v, 0) / recentHighs.length;
    const avgLow = recentLows.reduce((s, v) => s + v, 0) / recentLows.length;
    ranges.push({ upper: avgHigh, lower: avgLow, midpoint: (avgHigh + avgLow) / 2, width: ((avgHigh - avgLow) / ((avgHigh + avgLow) / 2)) * 100 });
  }

  // Primary range = average of all methods
  const primaryUpper = ranges.reduce((s, r) => s + r.upper, 0) / ranges.length;
  const primaryLower = ranges.reduce((s, r) => s + r.lower, 0) / ranges.length;
  const primaryMid = (primaryUpper + primaryLower) / 2;
  const primaryWidth = ((primaryUpper - primaryLower) / primaryMid) * 100;

  // Position within range
  const rangeSize = primaryUpper - primaryLower;
  const positionInRange = rangeSize > 0 ? ((price - primaryLower) / rangeSize) * 100 : 50;

  // Strength
  let strength: "weak" | "moderate" | "strong" = "weak";
  if (scoreRatio >= 0.75 && confirmedCount >= 9) strength = "strong";
  else if (scoreRatio >= 0.6 && confirmedCount >= 6) strength = "moderate";

  // Probability
  let probability = scoreRatio * 70;
  if (adx < 20) probability += 10;
  else if (adx < 25) probability += 5;
  if (isSqueeze) probability += 5;
  if (bb.bandwidth < 0.04) probability += 5;
  if (priceStructure === "neutral") probability += 5;
  probability = Math.max(15, Math.min(95, Math.round(probability)));

  return {
    isRanging: true,
    strength,
    probability,
    adx, rsi, volumeRatio,
    ema9: e9, ema21: e21, ema50: e50, ema200: e200,
    bbBandwidth: bb.bandwidth,
    squeeze: isSqueeze,
    confirmations: confirmedCount,
    totalChecks: indicators.length,
    indicators,
    // Range bounds
    primaryRange: { upper: primaryUpper, lower: primaryLower, midpoint: primaryMid, width: primaryWidth },
    ranges, // all detected ranges
    positionInRange, // 0-100, where price is within the range
    atr,
    score: Math.round(rangeScore * 4),
  };
}

// ─── Main Scanner Logic ─────────────────────────────────────────────
async function runFullScan(supabase: any) {
  console.log("Starting full scan...");
  const startTime = Date.now();

  // 1. Fetch tickers
  const categories: ("spot" | "linear")[] = ["linear", "spot"];
  const symbolMap = new Map<string, { symbol: string; category: "spot" | "linear"; price: number; change: number; vol: number }>();

  for (const cat of categories) {
    try {
      const data = await fetchTickers(cat);
      if (data.retCode === 0 && data.result?.list) {
        const sorted = data.result.list
          .filter((t: any) => t.symbol.endsWith("USDT"))
          .sort((a: any, b: any) => parseFloat(b.turnover24h) - parseFloat(a.turnover24h))
          .slice(0, TOP_SYMBOLS);
        for (const t of sorted) {
          if (!symbolMap.has(t.symbol) || cat === "linear") {
            symbolMap.set(t.symbol, { symbol: t.symbol, category: cat, price: +t.lastPrice, change: +t.price24hPcnt * 100, vol: +t.volume24h });
          }
        }
      }
    } catch (e) { console.error(`Tickers ${cat}:`, e); }
  }

  const symbols = Array.from(symbolMap.values());
  console.log(`Found ${symbols.length} symbols`);

  // 2. Trend scan
  const trendResults: any[] = [];
  const alertResults: any[] = [];
  const alertCooldowns = new Map<string, number>();

  for (let i = 0; i < symbols.length; i += BATCH_SIZE) {
    const batch = symbols.slice(i, i + BATCH_SIZE);
    const results = await Promise.all(batch.map(async ({ symbol, category, price, change, vol }) => {
      const signals: any = {};
      for (const tf of ALL_TIMEFRAMES) {
        try {
          const candles = await fetchKlines(symbol, tf, category);
          if (candles.length < 50) continue;
          const signal = analyzeTrend(candles);
          if (signal) {
            signals[tf] = signal;
            // Generate alert
            const key = `${symbol}:${tf}:${signal.direction}`;
            const last = alertCooldowns.get(key);
            if (!last || Date.now() - last > 300000) {
              alertCooldowns.set(key, Date.now());
              alertResults.push({
                id: `${symbol}-${tf}-${Date.now()}`,
                symbol, timeframe: tf, direction: signal.direction,
                strength: signal.strength, price, timestamp: Date.now(), score: signal.score,
              });
            }
          }
        } catch { /* skip */ }
      }
      return { symbol, price, change24h: change, volume24h: vol, signals, lastUpdated: Date.now(), marketType: category };
    }));
    trendResults.push(...results);
    if (i + BATCH_SIZE < symbols.length) await new Promise(r => setTimeout(r, 50));
  }

  // 2.5. Range scan — detect ranging/consolidating coins
  const rangeResults: any[] = [];
  for (let i = 0; i < symbols.length; i += BATCH_SIZE) {
    const batch = symbols.slice(i, i + BATCH_SIZE);
    const results = await Promise.all(batch.map(async ({ symbol, category, price, change, vol }) => {
      const signals: any = {};
      for (const tf of ALL_TIMEFRAMES) {
        try {
          const candles = await fetchKlines(symbol, tf, category);
          if (candles.length < 50) continue;
          const signal = analyzeRange(candles);
          if (signal) signals[tf] = signal;
        } catch { /* skip */ }
      }
      if (Object.keys(signals).length === 0) return null;
      return { symbol, price, change24h: change, volume24h: vol, signals, lastUpdated: Date.now(), marketType: category };
    }));
    rangeResults.push(...results.filter(Boolean));
    if (i + BATCH_SIZE < symbols.length) await new Promise(r => setTimeout(r, 50));
  }

  // 2.7. Indicator Signal scan + Reversal analysis — detect flips, crossovers, breakouts, reversals
  const INDICATOR_TFS: Timeframe[] = ["15", "60", "240", "D", "W"];
  const indicatorSignalResults: any[] = [];
  const reversalResults: any[] = [];

  for (let i = 0; i < symbols.length; i += BATCH_SIZE) {
    const batch = symbols.slice(i, i + BATCH_SIZE);
    await Promise.all(batch.map(async ({ symbol, category, price, change, vol }) => {
      for (const tf of INDICATOR_TFS) {
        try {
          const candles = await fetchKlines(symbol, tf, category, 220);
          if (candles.length < 60) continue;

          // Current = all closed candles, Previous = exclude last closed candle
          const curr = candles.slice(0, -1); // closed candles
          const prev = candles.slice(0, -2); // one bar earlier

          if (curr.length < 55 || prev.length < 55) continue;

          const closesC = curr.map(c => c.close);
          const closesP = prev.map(c => c.close);
          const priceNow = closesC[closesC.length - 1];
          const sym = symbol.replace("USDT", "");
          const now = Date.now();

          // --- 1. Parabolic SAR Flip ---
          const psarC = calculateParabolicSAR(curr);
          const psarP = calculateParabolicSAR(prev);
          if (psarC.direction !== psarP.direction) {
            indicatorSignalResults.push({
              id: `ind-psar-${symbol}-${tf}-${now}`, symbol: sym, timeframe: tf,
              indicator: "Parabolic SAR Flip", direction: psarC.direction,
              value: `SAR flipped to ${psarC.direction === "bull" ? "BULLISH" : "BEARISH"}`,
              price: priceNow, change24h: change, volume24h: vol, timestamp: now,
              strength: "high",
            });
          }

          // --- 2. Supertrend Flip ---
          const stC = calculateSupertrend(curr);
          const stP = calculateSupertrend(prev);
          if (stC.direction !== stP.direction) {
            indicatorSignalResults.push({
              id: `ind-st-${symbol}-${tf}-${now}`, symbol: sym, timeframe: tf,
              indicator: "Supertrend Flip", direction: stC.direction,
              value: `Supertrend flipped to ${stC.direction === "bull" ? "BULLISH" : "BEARISH"}`,
              price: priceNow, change24h: change, volume24h: vol, timestamp: now,
              strength: "high",
            });
          }

          // --- 3. MACD Crossover ---
          const macdC = calculateMACD(closesC);
          const macdP = calculateMACD(closesP);
          if ((macdC.histogram > 0 && macdP.histogram <= 0) || (macdC.histogram < 0 && macdP.histogram >= 0)) {
            const dir = macdC.histogram > 0 ? "bull" : "bear";
            indicatorSignalResults.push({
              id: `ind-macd-${symbol}-${tf}-${now}`, symbol: sym, timeframe: tf,
              indicator: "MACD Crossover", direction: dir,
              value: `MACD ${dir === "bull" ? "bullish" : "bearish"} crossover (hist: ${macdC.histogram.toPrecision(3)})`,
              price: priceNow, change24h: change, volume24h: vol, timestamp: now,
              strength: Math.abs(macdC.histogram) > Math.abs(macdP.histogram) * 1.5 ? "high" : "medium",
            });
          }

          // --- 4. Bollinger Band Break ---
          const bbC = calculateBollingerBands(closesC);
          const bbP = calculateBollingerBands(closesP);
          if (bbC.percentB > 1 && bbP.percentB <= 1) {
            indicatorSignalResults.push({
              id: `ind-bbu-${symbol}-${tf}-${now}`, symbol: sym, timeframe: tf,
              indicator: "Bollinger Upper Break", direction: "bull" as const,
              value: `Price broke above upper BB (%B: ${(bbC.percentB*100).toFixed(0)}%)`,
              price: priceNow, change24h: change, volume24h: vol, timestamp: now,
              strength: "high",
            });
          }
          if (bbC.percentB < 0 && bbP.percentB >= 0) {
            indicatorSignalResults.push({
              id: `ind-bbl-${symbol}-${tf}-${now}`, symbol: sym, timeframe: tf,
              indicator: "Bollinger Lower Break", direction: "bear" as const,
              value: `Price broke below lower BB (%B: ${(bbC.percentB*100).toFixed(0)}%)`,
              price: priceNow, change24h: change, volume24h: vol, timestamp: now,
              strength: "high",
            });
          }

          // --- 5. RSI Extreme Entry ---
          const rsiC = calculateRSI(closesC);
          const rsiP = calculateRSI(closesP);
          if (rsiC > 70 && rsiP <= 70) {
            indicatorSignalResults.push({
              id: `ind-rsio-${symbol}-${tf}-${now}`, symbol: sym, timeframe: tf,
              indicator: "RSI Overbought", direction: "bear" as const,
              value: `RSI entered overbought zone (${rsiC.toFixed(1)})`,
              price: priceNow, change24h: change, volume24h: vol, timestamp: now,
              strength: rsiC > 80 ? "high" : "medium",
            });
          }
          if (rsiC < 30 && rsiP >= 30) {
            indicatorSignalResults.push({
              id: `ind-rsis-${symbol}-${tf}-${now}`, symbol: sym, timeframe: tf,
              indicator: "RSI Oversold", direction: "bull" as const,
              value: `RSI entered oversold zone (${rsiC.toFixed(1)})`,
              price: priceNow, change24h: change, volume24h: vol, timestamp: now,
              strength: rsiC < 20 ? "high" : "medium",
            });
          }

          // --- 6. Stochastic Crossover ---
          const stochC = calculateStochastic(curr);
          const stochP = calculateStochastic(prev);
          if (stochC.k > stochC.d && stochP.k <= stochP.d && stochC.k < 30) {
            indicatorSignalResults.push({
              id: `ind-stochb-${symbol}-${tf}-${now}`, symbol: sym, timeframe: tf,
              indicator: "Stochastic Bullish Cross", direction: "bull" as const,
              value: `%K crossed above %D in oversold (K:${stochC.k.toFixed(0)} D:${stochC.d.toFixed(0)})`,
              price: priceNow, change24h: change, volume24h: vol, timestamp: now,
              strength: stochC.k < 20 ? "high" : "medium",
            });
          }
          if (stochC.k < stochC.d && stochP.k >= stochP.d && stochC.k > 70) {
            indicatorSignalResults.push({
              id: `ind-stochs-${symbol}-${tf}-${now}`, symbol: sym, timeframe: tf,
              indicator: "Stochastic Bearish Cross", direction: "bear" as const,
              value: `%K crossed below %D in overbought (K:${stochC.k.toFixed(0)} D:${stochC.d.toFixed(0)})`,
              price: priceNow, change24h: change, volume24h: vol, timestamp: now,
              strength: stochC.k > 80 ? "high" : "medium",
            });
          }

          // --- 7. EMA Cross (9/21) ---
          const ema9C = calculateEMA(closesC, 9);
          const ema21C = calculateEMA(closesC, 21);
          const ema9P = calculateEMA(closesP, 9);
          const ema21P = calculateEMA(closesP, 21);
          const e9c = ema9C[ema9C.length - 1], e21c = ema21C[ema21C.length - 1];
          const e9p = ema9P[ema9P.length - 1], e21p = ema21P[ema21P.length - 1];
          if (e9c > e21c && e9p <= e21p) {
            indicatorSignalResults.push({
              id: `ind-emaxb-${symbol}-${tf}-${now}`, symbol: sym, timeframe: tf,
              indicator: "EMA 9/21 Golden Cross", direction: "bull" as const,
              value: `EMA9 crossed above EMA21`,
              price: priceNow, change24h: change, volume24h: vol, timestamp: now,
              strength: "high",
            });
          }
          if (e9c < e21c && e9p >= e21p) {
            indicatorSignalResults.push({
              id: `ind-emaxs-${symbol}-${tf}-${now}`, symbol: sym, timeframe: tf,
              indicator: "EMA 9/21 Death Cross", direction: "bear" as const,
              value: `EMA9 crossed below EMA21`,
              price: priceNow, change24h: change, volume24h: vol, timestamp: now,
              strength: "high",
            });
          }

          // --- 8. CCI Extreme ---
          const cciC = calculateCCI(curr);
          const cciP = calculateCCI(prev);
          if (cciC > 100 && cciP <= 100) {
            indicatorSignalResults.push({
              id: `ind-cciu-${symbol}-${tf}-${now}`, symbol: sym, timeframe: tf,
              indicator: "CCI Overbought", direction: "bull" as const,
              value: `CCI crossed above +100 (${cciC.toFixed(0)})`,
              price: priceNow, change24h: change, volume24h: vol, timestamp: now,
              strength: cciC > 200 ? "high" : "medium",
            });
          }
          if (cciC < -100 && cciP >= -100) {
            indicatorSignalResults.push({
              id: `ind-ccid-${symbol}-${tf}-${now}`, symbol: sym, timeframe: tf,
              indicator: "CCI Oversold", direction: "bear" as const,
              value: `CCI crossed below -100 (${cciC.toFixed(0)})`,
              price: priceNow, change24h: change, volume24h: vol, timestamp: now,
              strength: cciC < -200 ? "high" : "medium",
            });
          }

          // --- 9. Williams %R Extreme ---
          const wrC = calculateWilliamsR(curr);
          const wrP = calculateWilliamsR(prev);
          if (wrC > -20 && wrP <= -20) {
            indicatorSignalResults.push({
              id: `ind-wru-${symbol}-${tf}-${now}`, symbol: sym, timeframe: tf,
              indicator: "Williams %R Overbought", direction: "bear" as const,
              value: `%R entered overbought (${wrC.toFixed(0)})`,
              price: priceNow, change24h: change, volume24h: vol, timestamp: now,
              strength: "medium",
            });
          }
          if (wrC < -80 && wrP >= -80) {
            indicatorSignalResults.push({
              id: `ind-wrd-${symbol}-${tf}-${now}`, symbol: sym, timeframe: tf,
              indicator: "Williams %R Oversold", direction: "bull" as const,
              value: `%R entered oversold (${wrC.toFixed(0)})`,
              price: priceNow, change24h: change, volume24h: vol, timestamp: now,
              strength: "medium",
            });
          }

          // --- 10. MFI Extreme ---
          const mfiC = calculateMFI(curr);
          const mfiP = calculateMFI(prev);
          if (mfiC > 80 && mfiP <= 80) {
            indicatorSignalResults.push({
              id: `ind-mfio-${symbol}-${tf}-${now}`, symbol: sym, timeframe: tf,
              indicator: "MFI Overbought", direction: "bear" as const,
              value: `MFI entered overbought (${mfiC.toFixed(0)})`,
              price: priceNow, change24h: change, volume24h: vol, timestamp: now,
              strength: "medium",
            });
          }
          if (mfiC < 20 && mfiP >= 20) {
            indicatorSignalResults.push({
              id: `ind-mfis-${symbol}-${tf}-${now}`, symbol: sym, timeframe: tf,
              indicator: "MFI Oversold", direction: "bull" as const,
              value: `MFI entered oversold (${mfiC.toFixed(0)})`,
              price: priceNow, change24h: change, volume24h: vol, timestamp: now,
              strength: "medium",
            });
          }

          // --- 11. Ichimoku Cloud Break ---
          const ichC = calculateIchimoku(curr);
          const ichP = calculateIchimoku(prev);
          if (ichC.priceVsCloud === "above" && ichP.priceVsCloud !== "above") {
            indicatorSignalResults.push({
              id: `ind-ichu-${symbol}-${tf}-${now}`, symbol: sym, timeframe: tf,
              indicator: "Ichimoku Cloud Breakout", direction: "bull" as const,
              value: `Price broke above Ichimoku cloud`,
              price: priceNow, change24h: change, volume24h: vol, timestamp: now,
              strength: ichC.cloudDirection === "bull" ? "high" : "medium",
            });
          }
          if (ichC.priceVsCloud === "below" && ichP.priceVsCloud !== "below") {
            indicatorSignalResults.push({
              id: `ind-ichd-${symbol}-${tf}-${now}`, symbol: sym, timeframe: tf,
              indicator: "Ichimoku Cloud Breakdown", direction: "bear" as const,
              value: `Price broke below Ichimoku cloud`,
              price: priceNow, change24h: change, volume24h: vol, timestamp: now,
              strength: ichC.cloudDirection === "bear" ? "high" : "medium",
            });
          }

          // --- 12. Donchian Breakout ---
          const donC = calculateDonchianChannels(curr);
          const donP = calculateDonchianChannels(prev);
          if (donC.breakoutUp && !donP.breakoutUp) {
            indicatorSignalResults.push({
              id: `ind-donu-${symbol}-${tf}-${now}`, symbol: sym, timeframe: tf,
              indicator: "Donchian Breakout Up", direction: "bull" as const,
              value: `Price broke above ${donC.upper.toPrecision(5)} Donchian high`,
              price: priceNow, change24h: change, volume24h: vol, timestamp: now,
              strength: "high",
            });
          }
          if (donC.breakoutDown && !donP.breakoutDown) {
            indicatorSignalResults.push({
              id: `ind-dond-${symbol}-${tf}-${now}`, symbol: sym, timeframe: tf,
              indicator: "Donchian Breakout Down", direction: "bear" as const,
              value: `Price broke below ${donC.lower.toPrecision(5)} Donchian low`,
              price: priceNow, change24h: change, volume24h: vol, timestamp: now,
              strength: "high",
            });
          }

          // --- 13. Squeeze Release ---
          const kcC = calculateKeltnerChannels(curr);
          const kcP = calculateKeltnerChannels(prev);
          const sqC = detectSqueeze(bbC.upper, bbC.lower, kcC.upper, kcC.lower);
          const sqP = detectSqueeze(bbP.upper, bbP.lower, kcP.upper, kcP.lower);
          if (!sqC && sqP) {
            const dir = priceNow > bbC.middle ? "bull" : "bear";
            indicatorSignalResults.push({
              id: `ind-sqr-${symbol}-${tf}-${now}`, symbol: sym, timeframe: tf,
              indicator: "Squeeze Release", direction: dir,
              value: `BB-KC squeeze released — ${dir === "bull" ? "bullish" : "bearish"} expansion`,
              price: priceNow, change24h: change, volume24h: vol, timestamp: now,
              strength: "high",
            });
          }

          // --- Reversal analysis (reuse candles already fetched) ---
          const revResult = analyzeReversalCron(candles);
          if (revResult) {
            const grade: "S" | "A" | "B" | "C" = revResult.score >= 75 ? "S" : revResult.score >= 60 ? "A" : revResult.score >= 45 ? "B" : "C";
            if (revResult.score >= 35) {
              const rr = Math.abs(revResult.target - price) / Math.abs(price - revResult.invalidation);
              reversalResults.push({
                symbol, price, change24h: change, volume24h: vol, timeframe: tf,
                direction: revResult.direction, score: Math.round(revResult.score), grade,
                confirmations: revResult.confirmations, categoryCount: revResult.categoryCount,
                topReason: revResult.confirmations.sort((a: any, b: any) => b.weight - a.weight)[0]?.name ?? "Multiple signals",
                timestamp: Date.now(), invalidation: revResult.invalidation, target: revResult.target,
                riskReward: Math.round(rr * 10) / 10,
              });
            }
          }

        } catch { /* skip */ }
      }
    }));
    if (i + BATCH_SIZE < symbols.length) await new Promise(r => setTimeout(r, 50));
  }


  // 3. Pattern scan
  const candlestickResults: any[] = [];
  const chartResults: any[] = [];
  const structureResults: any[] = [];

  for (let i = 0; i < symbols.length; i += BATCH_SIZE) {
    const batch = symbols.slice(i, i + BATCH_SIZE);
    await Promise.all(batch.map(async ({ symbol, category, price }) => {
      for (const tf of SCAN_TIMEFRAMES) {
        try {
          const candles = await fetchKlines(symbol, tf, category);
          // Use closed candles only (exclude last still-forming candle)
          const closedCandles = candles.slice(0, -1);
          if (closedCandles.length < 20) continue;
          const now = Date.now(), sym = symbol.replace("USDT", "");

          const adjustSig = (baseSig: string, patternType: string) => {
            const asset = trendResults.find((a: any) => a.symbol === symbol);
            if (!asset) return { significance: baseSig, aligned: false };
            const sig = asset.signals[tf];
            if (!sig?.direction) return { significance: baseSig, aligned: false };
            const pDir = patternType === "bullish" ? "bull" : patternType === "bearish" ? "bear" : null;
            if (!pDir) return { significance: baseSig, aligned: false };
            const aligned = pDir === sig.direction;
            if (aligned) return { significance: baseSig === "low" ? "medium" : "high", aligned: true };
            return { significance: baseSig === "high" ? "medium" : "low", aligned: false };
          };

          for (const p of detectCandlestickPatterns(closedCandles)) {
            const ci = p.candleIndex >= 0 && p.candleIndex < closedCandles.length ? closedCandles[p.candleIndex].time : closedCandles[closedCandles.length - 1]?.time ?? now;
            const { significance, aligned } = adjustSig(p.significance, p.type);
            // High-probability filter: skip low significance and unaligned neutral
            if (significance === "low") continue;
            if (significance === "medium" && !aligned && p.type === "neutral") continue;
            candlestickResults.push({ id: `cs-${symbol}-${tf}-${p.name}-${now}`, symbol: sym, timeframe: tf, pattern: { ...p, significance }, price, detectedAt: now, formedAt: ci > 0 ? ci : now, category: "candlestick", trendAligned: aligned });
          }
          for (const p of detectChartPatterns(closedCandles)) {
            const ci = p.endIndex >= 0 && p.endIndex < closedCandles.length ? closedCandles[p.endIndex].time : closedCandles[closedCandles.length - 1]?.time ?? now;
            const { significance, aligned } = adjustSig(p.significance, p.type);
            chartResults.push({ id: `ch-${symbol}-${tf}-${p.name}-${now}`, symbol: sym, timeframe: tf, pattern: { ...p, significance }, price, detectedAt: now, formedAt: ci > 0 ? ci : now, category: "chart", trendAligned: aligned });
          }
          for (const p of detectMarketStructure(closedCandles)) {
            const ci = p.candleIndex >= 0 && p.candleIndex < closedCandles.length ? closedCandles[p.candleIndex].time : closedCandles[closedCandles.length - 1]?.time ?? now;
            const { significance, aligned } = adjustSig(p.significance, p.type);
            structureResults.push({ id: `ms-${symbol}-${tf}-${p.name}-${now}`, symbol: sym, timeframe: tf, pattern: { ...p, significance }, price, detectedAt: now, formedAt: ci > 0 ? ci : now, category: "structure", trendAligned: aligned });
          }
        } catch { /* skip */ }
      }
    }));
    if (i + BATCH_SIZE < symbols.length) await new Promise(r => setTimeout(r, 50));
  }

  // 3b. Reversal helper functions (reversalResults populated in indicator scan loop above)

  function getRSISeriesCron(closes: number[], period = 14): number[] {
    const series: number[] = [];
    for (let end = period + 1; end <= closes.length; end++) series.push(calculateRSI(closes.slice(0, end), period));
    return series;
  }

  function detectReversalCandlesticksCron(candles: Candle[]): { name: string; type: "bullish" | "bearish"; strength: number }[] {
    if (candles.length < 5) return [];
    const results: { name: string; type: "bullish" | "bearish"; strength: number }[] = [];
    const len = candles.length;
    const c = candles[len - 1], prev0 = candles[len - 2], prev1 = candles[len - 3];
    const body = Math.abs(c.close - c.open), range = c.high - c.low;
    const prevBody = Math.abs(prev0.close - prev0.open);
    const isBull = c.close > c.open, prevBull = prev0.close > prev0.open;
    const avgBody = candles.slice(-14).reduce((s, x) => s + Math.abs(x.close - x.open), 0) / 14;
    const upperWick = c.high - Math.max(c.open, c.close);
    const lowerWick = Math.min(c.open, c.close) - c.low;
    if (lowerWick > body * 2 && upperWick < body * 0.5 && !prevBull) results.push({ name: "Hammer", type: "bullish", strength: 8 });
    if (upperWick > body * 2 && lowerWick < body * 0.5 && !prevBull) results.push({ name: "Inverted Hammer", type: "bullish", strength: 6 });
    if (upperWick > body * 2 && lowerWick < body * 0.5 && prevBull) results.push({ name: "Shooting Star", type: "bearish", strength: 8 });
    if (lowerWick > body * 2 && upperWick < body * 0.5 && prevBull) results.push({ name: "Hanging Man", type: "bearish", strength: 7 });
    if (isBull && !prevBull && c.close > prev0.open && c.open < prev0.close && body > prevBody) results.push({ name: "Bullish Engulfing", type: "bullish", strength: 9 });
    if (!isBull && prevBull && c.close < prev0.open && c.open > prev0.close && body > prevBody) results.push({ name: "Bearish Engulfing", type: "bearish", strength: 9 });
    if (len >= 3) {
      const p2Bull = prev1.close > prev1.open, p2Body = Math.abs(prev1.close - prev1.open);
      if (!p2Bull && p2Body > avgBody * 0.5 && prevBody < avgBody * 0.3 && isBull && body > avgBody * 0.5) results.push({ name: "Morning Star", type: "bullish", strength: 10 });
      if (p2Bull && p2Body > avgBody * 0.5 && prevBody < avgBody * 0.3 && !isBull && body > avgBody * 0.5) results.push({ name: "Evening Star", type: "bearish", strength: 10 });
    }
    if (body < range * 0.1 && range > 0) {
      const recentBull = candles.slice(-4, -1).every(x => x.close > x.open);
      const recentBear = candles.slice(-4, -1).every(x => x.close < x.open);
      if (recentBull) results.push({ name: "Doji after uptrend", type: "bearish", strength: 6 });
      if (recentBear) results.push({ name: "Doji after downtrend", type: "bullish", strength: 6 });
    }
    if (isBull && !prevBull && c.open < prev0.low && c.close > (prev0.open + prev0.close) / 2 && c.close < prev0.open) results.push({ name: "Piercing Line", type: "bullish", strength: 7 });
    if (!isBull && prevBull && c.open > prev0.high && c.close < (prev0.open + prev0.close) / 2 && c.close > prev0.open) results.push({ name: "Dark Cloud Cover", type: "bearish", strength: 7 });
    if (len >= 3) {
      const all3Bull = [prev1, prev0, c].every(x => x.close > x.open && Math.abs(x.close - x.open) > avgBody * 0.5);
      const all3Bear = [prev1, prev0, c].every(x => x.close < x.open && Math.abs(x.close - x.open) > avgBody * 0.5);
      if (all3Bull && c.close > prev0.close && prev0.close > prev1.close) results.push({ name: "Three White Soldiers", type: "bullish", strength: 9 });
      if (all3Bear && c.close < prev0.close && prev0.close < prev1.close) results.push({ name: "Three Black Crows", type: "bearish", strength: 9 });
    }
    return results;
  }

  function detectRSIDivergenceCron(candles: Candle[], closes: number[]): { type: "bull" | "bear"; strength: number } | null {
    if (candles.length < 30) return null;
    const rsiSeries = getRSISeriesCron(closes, 14);
    if (rsiSeries.length < 20) return null;
    const lookback = 20, rc = candles.slice(-lookback), rr = rsiSeries.slice(-lookback);
    let pL1 = Infinity, pL2 = Infinity, rL1 = 100, rL2 = 100, l1 = -1, l2 = -1;
    for (let i = 2; i < rc.length - 2; i++) {
      if (rc[i].low < rc[i-1].low && rc[i].low < rc[i-2].low && rc[i].low < rc[i+1].low && rc[i].low < rc[i+2].low) {
        if (l1 === -1) { pL1 = rc[i].low; rL1 = rr[i]; l1 = i; }
        else { pL2 = rc[i].low; rL2 = rr[i]; l2 = i; }
      }
    }
    if (l2 > l1 && pL2 < pL1 && rL2 > rL1 && rL2 < 40) return { type: "bull", strength: rL2 < 30 ? 8 : 6 };
    let pH1 = -Infinity, pH2 = -Infinity, rH1 = 0, rH2 = 0, h1 = -1, h2 = -1;
    for (let i = 2; i < rc.length - 2; i++) {
      if (rc[i].high > rc[i-1].high && rc[i].high > rc[i-2].high && rc[i].high > rc[i+1].high && rc[i].high > rc[i+2].high) {
        if (h1 === -1) { pH1 = rc[i].high; rH1 = rr[i]; h1 = i; }
        else { pH2 = rc[i].high; rH2 = rr[i]; h2 = i; }
      }
    }
    if (h2 > h1 && pH2 > pH1 && rH2 < rH1 && rH2 > 60) return { type: "bear", strength: rH2 > 70 ? 8 : 6 };
    return null;
  }

  function detectStructureShiftCron(candles: Candle[]): { type: "bull" | "bear"; name: string } | null {
    if (candles.length < 20) return null;
    const lb = 3, highs: { idx: number; price: number }[] = [], lows: { idx: number; price: number }[] = [];
    for (let i = lb; i < candles.length - lb; i++) {
      let isH = true, isL = true;
      for (let j = 1; j <= lb; j++) { if (candles[i].high <= candles[i-j].high || candles[i].high <= candles[i+j].high) isH = false; if (candles[i].low >= candles[i-j].low || candles[i].low >= candles[i+j].low) isL = false; }
      if (isH) highs.push({ idx: i, price: candles[i].high });
      if (isL) lows.push({ idx: i, price: candles[i].low });
    }
    const price = candles[candles.length - 1].close;
    if (highs.length >= 2 && lows.length >= 2) {
      const lth = highs.slice(-2), ltl = lows.slice(-2);
      if (lth[0].price > lth[1].price && ltl[0].price > ltl[1].price && price > lth[1].price) return { type: "bull", name: "CHoCH (Bullish)" };
      if (lth[1].price > lth[0].price && ltl[1].price > ltl[0].price && price < ltl[1].price) return { type: "bear", name: "CHoCH (Bearish)" };
    }
    return null;
  }

  function analyzeReversalCron(candles: Candle[]): { direction: "bull" | "bear"; score: number; confirmations: any[]; categoryCount: number; invalidation: number; target: number } | null {
    if (candles.length < 60) return null;
    const closes = candles.map(c => c.close), price = closes[closes.length - 1], atr = calculateATR(candles, 14);
    const confirmations: any[] = [];

    // Momentum
    const rsi = calculateRSI(closes, 14), macd = calculateMACD(closes), stoch = calculateStochastic(candles);
    const stochRSI = calculateStochRSI(closes), willR = calculateWilliamsR(candles), cci = calculateCCI(candles);
    const mfi = calculateMFI(candles), tsi = calculateTSI(closes), roc = calculateROC(closes);

    if (rsi < 25) confirmations.push({ category: "momentum", signal: "bull", name: "RSI Oversold", weight: 5, detail: `RSI ${rsi.toFixed(1)}` });
    else if (rsi < 35) confirmations.push({ category: "momentum", signal: "bull", name: "RSI Near Oversold", weight: 3, detail: `RSI ${rsi.toFixed(1)}` });
    if (rsi > 75) confirmations.push({ category: "momentum", signal: "bear", name: "RSI Overbought", weight: 5, detail: `RSI ${rsi.toFixed(1)}` });
    else if (rsi > 65) confirmations.push({ category: "momentum", signal: "bear", name: "RSI Near Overbought", weight: 3, detail: `RSI ${rsi.toFixed(1)}` });

    const rsiDiv = detectRSIDivergenceCron(candles, closes);
    if (rsiDiv) confirmations.push({ category: "momentum", signal: rsiDiv.type, name: "RSI Divergence", weight: rsiDiv.strength, detail: `${rsiDiv.type} divergence` });

    if (macd.histogram > 0 && (macd as any).prevHistogram !== undefined) {
      // Use simple histogram sign check
    }
    // MACD histogram cross - compute prev manually
    const prevCloses = closes.slice(0, -1);
    const prevMacd = calculateMACD(prevCloses);
    if (macd.histogram > 0 && prevMacd.histogram < 0) confirmations.push({ category: "momentum", signal: "bull", name: "MACD Hist Cross Up", weight: 5, detail: `Histogram flipped positive` });
    if (macd.histogram < 0 && prevMacd.histogram > 0) confirmations.push({ category: "momentum", signal: "bear", name: "MACD Hist Cross Down", weight: 5, detail: `Histogram flipped negative` });
    if (Math.abs(macd.histogram) < Math.abs(prevMacd.histogram) * 0.5) {
      confirmations.push({ category: "momentum", signal: prevMacd.histogram > 0 ? "bear" : "bull", name: "MACD Weakening", weight: 3, detail: `Histogram shrinking` });
    }

    if (stoch.k < 20 && stoch.k > stoch.d) confirmations.push({ category: "momentum", signal: "bull", name: "Stoch Oversold Cross", weight: 5, detail: `%K=${stoch.k.toFixed(1)}` });
    if (stoch.k > 80 && stoch.k < stoch.d) confirmations.push({ category: "momentum", signal: "bear", name: "Stoch Overbought Cross", weight: 5, detail: `%K=${stoch.k.toFixed(1)}` });
    if (stochRSI.k < 15) confirmations.push({ category: "momentum", signal: "bull", name: "StochRSI Oversold", weight: 4, detail: `K=${stochRSI.k.toFixed(1)}` });
    if (stochRSI.k > 85) confirmations.push({ category: "momentum", signal: "bear", name: "StochRSI Overbought", weight: 4, detail: `K=${stochRSI.k.toFixed(1)}` });
    if (willR < -80) confirmations.push({ category: "momentum", signal: "bull", name: "Williams %R Oversold", weight: 3, detail: `%R=${willR.toFixed(1)}` });
    if (willR > -20) confirmations.push({ category: "momentum", signal: "bear", name: "Williams %R Overbought", weight: 3, detail: `%R=${willR.toFixed(1)}` });
    if (cci < -200) confirmations.push({ category: "momentum", signal: "bull", name: "CCI Extreme Low", weight: 4, detail: `CCI=${cci.toFixed(0)}` });
    if (cci > 200) confirmations.push({ category: "momentum", signal: "bear", name: "CCI Extreme High", weight: 4, detail: `CCI=${cci.toFixed(0)}` });
    if (mfi < 20) confirmations.push({ category: "momentum", signal: "bull", name: "MFI Oversold", weight: 3, detail: `MFI=${mfi.toFixed(1)}` });
    if (mfi > 80) confirmations.push({ category: "momentum", signal: "bear", name: "MFI Overbought", weight: 3, detail: `MFI=${mfi.toFixed(1)}` });
    if (tsi < -25) confirmations.push({ category: "momentum", signal: "bull", name: "TSI Extreme Low", weight: 3, detail: `TSI=${tsi.toFixed(1)}` });
    if (tsi > 25) confirmations.push({ category: "momentum", signal: "bear", name: "TSI Extreme High", weight: 3, detail: `TSI=${tsi.toFixed(1)}` });
    if (roc < -10) confirmations.push({ category: "momentum", signal: "bull", name: "ROC Extreme Drop", weight: 3, detail: `ROC=${roc.toFixed(1)}%` });
    if (roc > 10) confirmations.push({ category: "momentum", signal: "bear", name: "ROC Extreme Rise", weight: 3, detail: `ROC=${roc.toFixed(1)}%` });

    // Trend exhaustion
    const { adx: adxV, plusDI, minusDI } = calculateADX(candles);
    const supertrend = calculateSupertrend(candles);
    const psar = calculateParabolicSAR(candles);
    const ichimoku = calculateIchimoku(candles);
    const ema50 = calculateEMA(closes, 50);
    const e50 = ema50[ema50.length - 1];
    const distFrom50 = ((price - e50) / e50) * 100;

    // Supertrend — check direction change via prev candles
    const prevSupertrend = calculateSupertrend(candles.slice(0, -1));
    if (supertrend.direction !== prevSupertrend.direction) confirmations.push({ category: "trend", signal: supertrend.direction, name: "Supertrend Flip", weight: 7, detail: `Flipped to ${supertrend.direction}` });

    const prevPsar = calculateParabolicSAR(candles.slice(0, -1));
    if (psar.direction !== prevPsar.direction) confirmations.push({ category: "trend", signal: psar.direction, name: "Parabolic SAR Flip", weight: 6, detail: `SAR flipped to ${psar.direction}` });

    if (adxV > 25 && plusDI > minusDI && minusDI > plusDI * 0.7) confirmations.push({ category: "trend", signal: "bear", name: "DI Convergence", weight: 5, detail: `+DI narrowing vs -DI` });
    if (adxV > 25 && minusDI > plusDI && plusDI > minusDI * 0.7) confirmations.push({ category: "trend", signal: "bull", name: "DI Convergence", weight: 5, detail: `-DI narrowing vs +DI` });
    if (distFrom50 > 8) confirmations.push({ category: "trend", signal: "bear", name: "Overextended Above MA50", weight: 5, detail: `${distFrom50.toFixed(1)}% above` });
    if (distFrom50 < -8) confirmations.push({ category: "trend", signal: "bull", name: "Overextended Below MA50", weight: 5, detail: `${Math.abs(distFrom50).toFixed(1)}% below` });

    // Ichimoku TK cross
    const prevIchi = calculateIchimoku(candles.slice(0, -1));
    const tkNow = ichimoku.tenkan > ichimoku.kijun;
    const tkPrev = prevIchi.tenkan > prevIchi.kijun;
    if (tkNow && !tkPrev) confirmations.push({ category: "trend", signal: "bull", name: "Ichimoku TK Cross Up", weight: 5, detail: `Tenkan crossed above Kijun` });
    if (!tkNow && tkPrev) confirmations.push({ category: "trend", signal: "bear", name: "Ichimoku TK Cross Down", weight: 5, detail: `Tenkan crossed below Kijun` });

    // Volatility
    const bb = calculateBollingerBands(closes);
    const kc = calculateKeltnerChannels(candles);
    const squeeze = bb.lower > kc.lower && bb.upper < kc.upper;
    const prevBB = calculateBollingerBands(closes.slice(0, -1));
    const prevKC = calculateKeltnerChannels(candles.slice(0, -1));
    const prevSqueeze = prevBB.lower > prevKC.lower && prevBB.upper < prevKC.upper;
    if (bb.percentB < 0 && price > bb.lower) confirmations.push({ category: "volatility", signal: "bull", name: "BB Lower Pierce Return", weight: 6, detail: `Price pierced lower band and recovered` });
    if (bb.percentB > 1 && price < bb.upper) confirmations.push({ category: "volatility", signal: "bear", name: "BB Upper Pierce Return", weight: 6, detail: `Price pierced upper band and rejected` });
    if (bb.percentB < 0.05) confirmations.push({ category: "volatility", signal: "bull", name: "BB Lower Extreme", weight: 4, detail: `%B=${(bb.percentB * 100).toFixed(1)}%` });
    if (bb.percentB > 0.95) confirmations.push({ category: "volatility", signal: "bear", name: "BB Upper Extreme", weight: 4, detail: `%B=${(bb.percentB * 100).toFixed(1)}%` });
    if (!squeeze && prevSqueeze) {
      const dir = price > bb.middle ? "bull" : "bear";
      confirmations.push({ category: "volatility", signal: dir, name: "Squeeze Release", weight: 5, detail: `BB squeezed and expanding ${dir}ward` });
    }

    // Volume
    const volRatio = calculateVolumeRatio(candles);
    const obv = calculateOBV(candles);
    const cmf = calculateCMF(candles);
    const lastCandle = candles[candles.length - 1], lastIsBull = lastCandle.close > lastCandle.open;
    if (volRatio > 2) confirmations.push({ category: "volume", signal: lastIsBull ? "bull" : "bear", name: "Volume Spike", weight: 5, detail: `Volume ${volRatio.toFixed(1)}x avg` });
    const priceUp = closes[closes.length - 1] > closes[closes.length - 6];
    if (priceUp && obv.trend === "bear") confirmations.push({ category: "volume", signal: "bear", name: "OBV Bearish Divergence", weight: 5, detail: `Price up, OBV down` });
    if (!priceUp && obv.trend === "bull") confirmations.push({ category: "volume", signal: "bull", name: "OBV Bullish Divergence", weight: 5, detail: `Price down, OBV up` });
    if (cmf < -0.15) confirmations.push({ category: "volume", signal: "bear", name: "CMF Selling Pressure", weight: 4, detail: `CMF=${cmf.toFixed(3)}` });
    if (cmf > 0.15) confirmations.push({ category: "volume", signal: "bull", name: "CMF Buying Pressure", weight: 4, detail: `CMF=${cmf.toFixed(3)}` });
    if (volRatio > 3.5) confirmations.push({ category: "volume", signal: lastIsBull ? "bull" : "bear", name: "Climax Volume", weight: 5, detail: `Extreme volume ${volRatio.toFixed(1)}x` });

    // Pattern
    const cp = detectReversalCandlesticksCron(candles.slice(0, -1));
    for (const p of cp) confirmations.push({ category: "pattern", signal: p.type === "bullish" ? "bull" : "bear", name: p.name, weight: p.strength, detail: `${p.name} pattern` });

    // Structure
    const ss = detectStructureShiftCron(candles);
    if (ss) confirmations.push({ category: "structure", signal: ss.type, name: ss.name, weight: 7, detail: ss.name });

    if (confirmations.length === 0) return null;
    let bullScore = 0, bearScore = 0;
    const bullConfs = confirmations.filter((c: any) => c.signal === "bull");
    const bearConfs = confirmations.filter((c: any) => c.signal === "bear");
    for (const c of bullConfs) bullScore += c.weight;
    for (const c of bearConfs) bearScore += c.weight;
    const direction = bullScore > bearScore ? "bull" as const : "bear" as const;
    const dominantConfs = direction === "bull" ? bullConfs : bearConfs;
    const rawScore = direction === "bull" ? bullScore : bearScore;
    const categories = new Set(dominantConfs.map((c: any) => c.category));
    const categoryCount = categories.size;
    let categoryBonus = categoryCount >= 5 ? 15 : categoryCount >= 4 ? 10 : categoryCount >= 3 ? 5 : 0;
    const opposingScore = direction === "bull" ? bearScore : bullScore;
    const conflictPenalty = Math.min(15, opposingScore * 0.5);
    const score = Math.min(100, Math.max(0, rawScore + categoryBonus - conflictPenalty));
    if (categoryCount < 1 || score < 30) return null;
    const invalidation = direction === "bull" ? price - 2 * atr : price + 2 * atr;
    const target = direction === "bull" ? price + 3 * atr : price - 3 * atr;
    return { direction, score, confirmations: dominantConfs, categoryCount, invalidation, target };
  }

  reversalResults.sort((a: any, b: any) => b.score - a.score);
  const topReversals = reversalResults.slice(0, 50);

  // 4. Store results in DB
  const now = new Date().toISOString();
  const updates = [
    { id: "trends", data: trendResults, scanned_at: now },
    { id: "ranges", data: rangeResults, scanned_at: now },
    { id: "candlestick", data: candlestickResults, scanned_at: now },
    { id: "chart", data: chartResults, scanned_at: now },
    { id: "structure", data: structureResults, scanned_at: now },
    { id: "alerts", data: alertResults.slice(0, 200), scanned_at: now },
    { id: "indicator_signals", data: indicatorSignalResults, scanned_at: now },
    { id: "reversals", data: topReversals, scanned_at: now },
    { id: "metadata", data: { duration: Date.now() - startTime, symbolCount: symbols.length, trendCount: trendResults.filter((t: any) => Object.keys(t.signals).length > 0).length, rangeCount: rangeResults.length, patternCount: candlestickResults.length + chartResults.length + structureResults.length, indicatorSignals: indicatorSignalResults.length, reversals: topReversals.length }, scanned_at: now },
  ];

  for (const u of updates) {
    const { error } = await supabase.from("scan_cache").upsert(u);
    if (error) console.error(`Failed to upsert ${u.id}:`, error);
  }

  const duration = Date.now() - startTime;
  console.log(`Scan complete in ${(duration / 1000).toFixed(1)}s — ${trendResults.length} trends, ${rangeResults.length} ranges, ${candlestickResults.length + chartResults.length + structureResults.length} patterns, ${topReversals.length} reversals, ${alertResults.length} alerts`);

  return { duration, symbols: symbols.length, trends: trendResults.length, ranges: rangeResults.length, patterns: candlestickResults.length + chartResults.length + structureResults.length, alerts: alertResults.length };
}

// ─── Handler ────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const result = await runFullScan(supabase);

    return new Response(JSON.stringify({ success: true, ...result }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Scanner error:", message);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
