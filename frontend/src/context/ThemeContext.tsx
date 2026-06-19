// Lightweight theme context — light / dark / system.
//
// We don't fully re-theme the app (cards stay cream); the primary use is
// to switch the system status bar text colour so the time + battery
// icons are always visible regardless of OS appearance.
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useColorScheme } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { api } from '../lib/api';

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

  // Phase 1 no-flash: synchronously hydrate from AsyncStorage on mount so the
  // first frame already reflects the user's choice. Then in the background
  // try to load from the server (cross-device sync).
  useEffect(() => {
    let mounted = true;
    AsyncStorage.getItem(STORAGE_KEY)
      .then((v) => {
        if (!mounted) return;
        if (v === 'light' || v === 'dark' || v === 'system') setChoiceState(v);
      })
      .catch(() => {});
    // Server hydrate (auth required; ignore failures silently).
    api.get<{ appearance?: ThemeChoice }>('/users/me/preferences')
      .then(({ data }) => {
        const v = data?.appearance;
        if (!mounted) return;
        if (v === 'light' || v === 'dark' || v === 'system') {
          setChoiceState(v);
          AsyncStorage.setItem(STORAGE_KEY, v).catch(() => {});
        }
      })
      .catch(() => {});
    return () => { mounted = false; };
  }, []);

  const setChoice = useCallback(async (c: ThemeChoice) => {
    setChoiceState(c);
    try { await AsyncStorage.setItem(STORAGE_KEY, c); } catch {}
    // Persist to server (best-effort cross-device sync).
    api.patch('/users/me/preferences', { appearance: c }).catch(() => {});
  }, []);

  const effective: EffectiveTheme = useMemo(() => {
    if (choice === 'system') return systemScheme === 'dark' ? 'dark' : 'light';
    return choice;
  }, [choice, systemScheme]);

  const value = useMemo(() => ({ choice, effective, setChoice }), [choice, effective, setChoice]);
  return <ThemeCtx.Provider value={value}>{children}</ThemeCtx.Provider>;
}

export function useTheme(): Ctx { return useContext(ThemeCtx); }
