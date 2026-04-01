import { useState } from 'react';
import type { ScannerSettings } from '@/types/scanner';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Settings as SettingsIcon } from 'lucide-react';
import { requestNotificationPermission } from '@/lib/alerts';

interface SettingsPanelProps {
  settings: ScannerSettings;
  onUpdate: (updates: Partial<ScannerSettings>) => void;
}

export function SettingsPanel({ settings, onUpdate }: SettingsPanelProps) {
  const [open, setOpen] = useState(false);

  const handleNotificationToggle = async (enabled: boolean) => {
    if (enabled) {
      const granted = await requestNotificationPermission();
      onUpdate({ browserNotifications: granted });
    } else {
      onUpdate({ browserNotifications: false });
    }
  };

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" className="h-7 w-7">
          <SettingsIcon className="h-3.5 w-3.5" />
        </Button>
      </SheetTrigger>
      <SheetContent className="border-border bg-card w-72">
        <SheetHeader>
          <SheetTitle className="text-xs uppercase tracking-widest">Settings</SheetTitle>
        </SheetHeader>

        <div className="mt-6 space-y-6 text-xs">
          <div className="space-y-2">
            <Label className="text-[10px] uppercase tracking-widest text-muted-foreground">
              Scan Interval: {settings.scanInterval}s
            </Label>
            <Slider
              value={[settings.scanInterval]}
              onValueChange={([v]) => onUpdate({ scanInterval: v })}
              min={15}
              max={120}
              step={5}
              className="w-full"
            />
          </div>

          <div className="space-y-2">
            <Label className="text-[10px] uppercase tracking-widest text-muted-foreground">
              ADX Threshold: {settings.adxThreshold}
            </Label>
            <Slider
              value={[settings.adxThreshold]}
              onValueChange={([v]) => onUpdate({ adxThreshold: v })}
              min={15}
              max={50}
              step={1}
              className="w-full"
            />
          </div>

          <div className="space-y-2">
            <Label className="text-[10px] uppercase tracking-widest text-muted-foreground">
              Market
            </Label>
            <Select
              value={settings.marketFilter}
              onValueChange={(v) => onUpdate({ marketFilter: v as ScannerSettings['marketFilter'] })}
            >
              <SelectTrigger className="h-7 bg-secondary text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="both">Both</SelectItem>
                <SelectItem value="linear">Derivatives</SelectItem>
                <SelectItem value="spot">Spot</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label className="text-[10px] uppercase tracking-widest text-muted-foreground">
              Min Alert Strength
            </Label>
            <Select
              value={settings.minStrength}
              onValueChange={(v) => onUpdate({ minStrength: v as ScannerSettings['minStrength'] })}
            >
              <SelectTrigger className="h-7 bg-secondary text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="weak">Weak</SelectItem>
                <SelectItem value="moderate">Moderate</SelectItem>
                <SelectItem value="strong">Strong</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center justify-between">
            <Label className="text-[10px] uppercase tracking-widest text-muted-foreground">
              Browser Alerts
            </Label>
            <Switch
              checked={settings.browserNotifications}
              onCheckedChange={handleNotificationToggle}
            />
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
