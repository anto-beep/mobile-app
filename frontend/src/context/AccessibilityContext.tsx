// Global accessibility settings — text size, contrast, dark mode, reduce motion, read aloud
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Speech from 'expo-speech';

export type TextScale = 'sm' | 'md' | 'lg' | 'xl';
export const TEXT_SCALES: Record<TextScale, number> = { sm: 0.9, md: 1.0, lg: 1.15, xl: 1.3 };

type A11yState = {
  textScale: TextScale;
  highContrast: boolean;
  darkMode: boolean;
  reduceMotion: boolean;
  readAloud: boolean;
};

type Ctx = A11yState & {
  setTextScale: (s: TextScale) => void;
  toggleHighContrast: () => void;
  toggleDarkMode: () => void;
  toggleReduceMotion: () => void;
  toggleReadAloud: () => void;
  speak: (text: string) => void;
  stopSpeaking: () => void;
  scale: number;
};

const STORAGE_KEY = 'wayly:a11y';
const DEFAULTS: A11yState = {
  textScale: 'md',
  highContrast: false,
  darkMode: false,
  reduceMotion: false,
  readAloud: false,
};

const AccessibilityContext = createContext<Ctx | null>(null);

export function AccessibilityProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<A11yState>(DEFAULTS);
  const [hydrated, setHydrated] = useState(false);

  // Hydrate from storage on mount
  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        if (raw) setState({ ...DEFAULTS, ...JSON.parse(raw) });
      } catch {}
      setHydrated(true);
    })();
  }, []);

  // Persist on change
  useEffect(() => {
    if (!hydrated) return;
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(state)).catch(() => {});
  }, [state, hydrated]);

  const setTextScale = useCallback((textScale: TextScale) => setState((s) => ({ ...s, textScale })), []);
  const toggleHighContrast = useCallback(() => setState((s) => ({ ...s, highContrast: !s.highContrast })), []);
  const toggleDarkMode = useCallback(() => setState((s) => ({ ...s, darkMode: !s.darkMode })), []);
  const toggleReduceMotion = useCallback(() => setState((s) => ({ ...s, reduceMotion: !s.reduceMotion })), []);
  const toggleReadAloud = useCallback(() => {
    setState((s) => {
      const next = !s.readAloud;
      if (!next) Speech.stop();
      return { ...s, readAloud: next };
    });
  }, []);

  const speak = useCallback((text: string) => {
    if (!text) return;
    Speech.stop();
    Speech.speak(text, { language: 'en-AU', pitch: 1.0, rate: 0.95 });
  }, []);

  const stopSpeaking = useCallback(() => Speech.stop(), []);

  const value = useMemo<Ctx>(() => ({
    ...state,
    scale: TEXT_SCALES[state.textScale],
    setTextScale,
    toggleHighContrast,
    toggleDarkMode,
    toggleReduceMotion,
    toggleReadAloud,
    speak,
    stopSpeaking,
  }), [state, setTextScale, toggleHighContrast, toggleDarkMode, toggleReduceMotion, toggleReadAloud, speak, stopSpeaking]);

  return <AccessibilityContext.Provider value={value}>{children}</AccessibilityContext.Provider>;
}

export function useAccessibility() {
  const ctx = useContext(AccessibilityContext);
  if (!ctx) throw new Error('useAccessibility must be used within AccessibilityProvider');
  return ctx;
}

// Theme override hook — returns adjusted colors based on darkMode + highContrast
export function useA11yColors() {
  const { darkMode, highContrast } = useAccessibility();
  if (darkMode) {
    return {
      background: highContrast ? '#000000' : '#0F1924',
      cardBg: highContrast ? '#0A0A0A' : '#1A2433',
      textPrimary: highContrast ? '#FFFFFF' : '#FAF7F2',
      textSecondary: highContrast ? '#E8E8E8' : '#A8B3C4',
      textMuted: highContrast ? '#C8C8C8' : '#7A8699',
      border: highContrast ? 'rgba(255,255,255,0.5)' : 'rgba(250, 247, 242, 0.12)',
      borderSubtle: highContrast ? 'rgba(255,255,255,0.2)' : 'rgba(250, 247, 242, 0.06)',
      brandPrimary: highContrast ? '#FFFFFF' : '#D4A24E',
      brandSecondary: '#D4A24E',
    };
  }
  if (highContrast) {
    return {
      background: '#FFFFFF',
      cardBg: '#FFFFFF',
      textPrimary: '#000000',
      textSecondary: '#1A1A1A',
      textMuted: '#333333',
      border: 'rgba(0,0,0,0.5)',
      borderSubtle: 'rgba(0,0,0,0.2)',
      brandPrimary: '#000000',
      brandSecondary: '#7A5A18',
    };
  }
  return null;
}
