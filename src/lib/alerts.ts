import type { AlertEntry, TrendDirection, Timeframe, TrendStrength } from '@/types/scanner';

const COOLDOWN_MS = 5 * 60 * 1000;
const alertCooldowns = new Map<string, number>();

function cooldownKey(symbol: string, timeframe: Timeframe, direction: TrendDirection): string {
  return `${symbol}:${timeframe}:${direction}`;
}

export function shouldAlert(symbol: string, timeframe: Timeframe, direction: TrendDirection): boolean {
  const key = cooldownKey(symbol, timeframe, direction);
  const last = alertCooldowns.get(key);
  if (last && Date.now() - last < COOLDOWN_MS) return false;
  alertCooldowns.set(key, Date.now());
  return true;
}

export function createAlert(
  symbol: string,
  timeframe: Timeframe,
  direction: TrendDirection,
  strength: TrendStrength,
  price: number,
  score: number
): AlertEntry {
  return {
    id: `${symbol}-${timeframe}-${Date.now()}`,
    symbol,
    timeframe,
    direction,
    strength,
    price,
    timestamp: Date.now(),
    score,
  };
}

export function sendBrowserNotification(alert: AlertEntry) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;

  const arrow = alert.direction === 'bull' ? '↑' : '↓';
  const tf = { '1': '1m', '5': '5m', '15': '15m', '60': '1h', '240': '4h', 'D': '1D', 'W': '1W' }[alert.timeframe];

  new Notification(`${arrow} ${alert.symbol} — ${tf}`, {
    body: `${alert.strength.toUpperCase()} ${alert.direction === 'bull' ? 'uptrend' : 'downtrend'} @ $${alert.price.toFixed(2)}`,
    icon: '/favicon.ico',
    tag: alert.id,
  });
}

export async function requestNotificationPermission(): Promise<boolean> {
  if (!('Notification' in window)) return false;
  if (Notification.permission === 'granted') return true;
  const result = await Notification.requestPermission();
  return result === 'granted';
}
