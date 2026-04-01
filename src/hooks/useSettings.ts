import { useState, useCallback } from 'react';
import { DEFAULT_SETTINGS, type ScannerSettings } from '@/types/scanner';

const STORAGE_KEY = 'bybit-scanner-settings';

function loadSettings(): ScannerSettings {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved ? { ...DEFAULT_SETTINGS, ...JSON.parse(saved) } : DEFAULT_SETTINGS;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function useSettings() {
  const [settings, setSettingsState] = useState<ScannerSettings>(loadSettings);

  const updateSettings = useCallback((updates: Partial<ScannerSettings>) => {
    setSettingsState((prev) => {
      const next = { ...prev, ...updates };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  return { settings, updateSettings };
}
