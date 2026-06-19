// Lightweight theme context — light / dark / system.
//
// We don't fully re-theme the app (cards stay cream); the primary use is
// to switch the system status bar text colour so the time + battery
// icons are always visible regardless of OS appearance.
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useColorScheme } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

export type ThemeChoice = 'light' | 'dark' | 'system';
export type EffectiveTheme = 'light' | 'dark';

const STORAGE_KEY = 'wayly.theme.choice.v1';

type Ctx = {
  choice: ThemeChoice;
  effective: EffectiveTheme;
  setChoice: (c: ThemeChoice) => Promise<void>;
};

const ThemeCtx = createContext<Ctx>({
  choice: 'system',
  effective: 'light',
  setChoice: async () => {},
});

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const systemScheme = useColorScheme();
  const [choice, setChoiceState] = useState<ThemeChoice>('system');

  // Hydrate the stored preference once.
  useEffect(() => {
    let mounted = true;
    AsyncStorage.getItem(STORAGE_KEY)
      .then((v) => {
        if (!mounted) return;
        if (v === 'light' || v === 'dark' || v === 'system') setChoiceState(v);
      })
      .catch(() => {});
    return () => { mounted = false; };
  }, []);

  const setChoice = useCallback(async (c: ThemeChoice) => {
    setChoiceState(c);
    try { await AsyncStorage.setItem(STORAGE_KEY, c); } catch { /* ignore */ }
  }, []);

  const effective: EffectiveTheme = useMemo(() => {
    if (choice === 'system') return systemScheme === 'dark' ? 'dark' : 'light';
    return choice;
  }, [choice, systemScheme]);

  const value = useMemo(() => ({ choice, effective, setChoice }), [choice, effective, setChoice]);
  return <ThemeCtx.Provider value={value}>{children}</ThemeCtx.Provider>;
}

export function useTheme(): Ctx { return useContext(ThemeCtx); }
