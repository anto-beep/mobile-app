// Lightweight global toast — imperative API + provider
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Animated, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Fonts, Radius, Spacing } from '../lib/theme';

export type ToastKind = 'info' | 'success' | 'warning' | 'error';
export type ToastItem = { id: string; kind: ToastKind; message: string; duration?: number };

type Ctx = {
  show: (kind: ToastKind, message: string, duration?: number) => void;
  info: (m: string, d?: number) => void;
  success: (m: string, d?: number) => void;
  warning: (m: string, d?: number) => void;
  error: (m: string, d?: number) => void;
};

const ToastContext = createContext<Ctx | null>(null);

// Module-level emitter so non-React code (e.g. axios interceptors) can dispatch toasts
type Listener = (k: ToastKind, m: string, d?: number) => void;
const listeners = new Set<Listener>();
export const toast = {
  show: (k: ToastKind, m: string, d?: number) => listeners.forEach((l) => l(k, m, d)),
  info: (m: string, d?: number) => listeners.forEach((l) => l('info', m, d)),
  success: (m: string, d?: number) => listeners.forEach((l) => l('success', m, d)),
  warning: (m: string, d?: number) => listeners.forEach((l) => l('warning', m, d)),
  error: (m: string, d?: number) => listeners.forEach((l) => l('error', m, d)),
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);

  const show = useCallback((kind: ToastKind, message: string, duration = 4000) => {
    if (!message) return;
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    setItems((prev) => {
      // Avoid duplicate consecutive toasts with same message
      if (prev[prev.length - 1]?.message === message) return prev;
      return [...prev, { id, kind, message, duration }];
    });
  }, []);

  const remove = useCallback((id: string) => {
    setItems((prev) => prev.filter((t) => t.id !== id));
  }, []);

  // Register module-level listener
  useEffect(() => {
    const fn: Listener = (k, m, d) => show(k, m, d);
    listeners.add(fn);
    return () => { listeners.delete(fn); };
  }, [show]);

  const value: Ctx = {
    show,
    info: (m, d) => show('info', m, d),
    success: (m, d) => show('success', m, d),
    warning: (m, d) => show('warning', m, d),
    error: (m, d) => show('error', m, d),
  };

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastHost items={items} onDone={remove} />
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}

const TONE: Record<ToastKind, { bg: string; fg: string; icon: keyof typeof Ionicons.glyphMap; border: string }> = {
  info: { bg: '#1F3A5F', fg: '#FAF7F2', icon: 'information-circle', border: '#1F3A5F' },
  success: { bg: '#3A5A40', fg: '#FAF7F2', icon: 'checkmark-circle', border: '#3A5A40' },
  warning: { bg: '#D4A24E', fg: '#1F3A5F', icon: 'alert-circle', border: '#D4A24E' },
  error: { bg: '#A05545', fg: '#FAF7F2', icon: 'close-circle', border: '#A05545' },
};

function ToastHost({ items, onDone }: { items: ToastItem[]; onDone: (id: string) => void }) {
  return (
    <SafeAreaView edges={['top']} style={[styles.host, { pointerEvents: 'box-none' }]}>
      {items.map((t) => (
        <ToastBubble key={t.id} item={t} onDone={() => onDone(t.id)} />
      ))}
    </SafeAreaView>
  );
}

function ToastBubble({ item, onDone }: { item: ToastItem; onDone: () => void }) {
  const opacity = useRef(new Animated.Value(0)).current;
  const translate = useRef(new Animated.Value(-20)).current;
  const tone = TONE[item.kind];

  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: 220, useNativeDriver: true }),
      Animated.timing(translate, { toValue: 0, duration: 240, useNativeDriver: true }),
    ]).start();
    const id = setTimeout(() => {
      Animated.parallel([
        Animated.timing(opacity, { toValue: 0, duration: 200, useNativeDriver: true }),
        Animated.timing(translate, { toValue: -20, duration: 220, useNativeDriver: true }),
      ]).start(() => onDone());
    }, item.duration || 4000);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Animated.View
      style={[
        styles.bubble,
        { backgroundColor: tone.bg, borderColor: tone.border, opacity, transform: [{ translateY: translate }] },
      ]}
      testID={`toast-${item.kind}`}
    >
      <Ionicons name={tone.icon} size={18} color={tone.fg} />
      <Text style={[styles.bubbleText, { color: tone.fg }]} numberOfLines={3}>
        {item.message}
      </Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  host: {
    position: 'absolute',
    top: 0, left: 0, right: 0,
    alignItems: 'center',
    paddingHorizontal: Spacing.md,
    paddingTop: Platform.OS === 'ios' ? 0 : Spacing.sm,
    zIndex: 99999,
  },
  bubble: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 48,
    maxWidth: 520,
    width: '100%',
    paddingHorizontal: Spacing.md,
    paddingVertical: 10,
    borderRadius: Radius.md,
    borderLeftWidth: 4,
    marginTop: Spacing.sm,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18,
    shadowRadius: 10,
    elevation: 6,
  },
  bubbleText: { flex: 1, fontFamily: Fonts.bodyMed, fontSize: 13, lineHeight: 18 },
});
