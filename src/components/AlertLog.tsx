import { useRef, useEffect } from 'react';
import type { AlertEntry } from '@/types/scanner';
import { TIMEFRAME_LABELS } from '@/types/scanner';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { Trash2 } from 'lucide-react';

interface AlertLogProps {
  alerts: AlertEntry[];
  onClear: () => void;
}

export function AlertLog({ alerts, onClear }: AlertLogProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [alerts.length]);

  return (
    <div className="flex h-full flex-col md:border-r border-border">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          Alert Log
        </h2>
        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onClear} title="Clear alerts">
          <Trash2 className="h-3 w-3" />
        </Button>
      </div>
      <ScrollArea className="flex-1">
        <div className="flex flex-col-reverse p-2 space-y-reverse space-y-0.5">
          {alerts.length === 0 && (
            <p className="px-2 py-8 text-center text-xs text-muted-foreground">
              Waiting for signals…
            </p>
          )}
          {alerts.map((alert) => (
            <AlertRow key={alert.id} alert={alert} />
          ))}
          <div ref={bottomRef} />
        </div>
      </ScrollArea>
    </div>
  );
}

function AlertRow({ alert }: { alert: AlertEntry }) {
  const isBull = alert.direction === 'bull';
  const arrow = isBull ? '↑' : '↓';
  const time = new Date(alert.timestamp).toLocaleTimeString('en-US', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  const strengthDot =
    alert.strength === 'strong' ? 'bg-trend-bull' :
    alert.strength === 'moderate' ? 'bg-accent' : 'bg-muted-foreground';

  return (
    <div
      className={`flex items-center gap-2 rounded-sm px-2 py-2 md:py-1 text-xs md:text-[10px] leading-tight transition-colors hover:bg-secondary ${
        isBull ? 'text-trend-bull' : 'text-trend-bear'
      }`}
    >
      <span className="text-muted-foreground">{time}</span>
      <span className="font-semibold">{alert.symbol.replace('USDT', '')}</span>
      <span className="text-muted-foreground">{TIMEFRAME_LABELS[alert.timeframe]}</span>
      <span className="text-sm">{arrow}</span>
      <span className={`h-1.5 w-1.5 rounded-full ${strengthDot}`} />
      <span className="ml-auto tabular-nums text-muted-foreground">
        ${alert.price < 1 ? alert.price.toPrecision(4) : alert.price.toFixed(2)}
      </span>
    </div>
  );
}
