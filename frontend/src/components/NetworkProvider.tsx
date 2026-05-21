// Network connectivity context + sticky offline banner.
// -------------------------------------------------------
// Watches connectivity via @react-native-community/netinfo.
// • Subscribes once at app root.
// • Exposes `useNetwork()` hook returning `{ online, pendingMutations }`.
// • When connectivity recovers, flushes the offline mutation queue and shows
//   a brief toast with the result.
// • Renders a slim sticky banner at the top of the screen when offline.
import React, { createContext, useContext, useEffect, useRef, useState, ReactNode } from 'react';
import { View, Text, StyleSheet, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import NetInfo, { NetInfoState } from '@react-native-community/netinfo';
import { Colors, Fonts, Spacing } from '../lib/theme';
import { flushQueue, getQueue } from '../lib/offlineQueue';
import { toast } from './Toast';

type NetworkCtx = {
  online: boolean;
  pendingMutations: number;
  refreshPending: () => Promise<void>;
};

const Ctx = createContext<NetworkCtx>({ online: true, pendingMutations: 0, refreshPending: async () => {} });

export const useNetwork = () => useContext(Ctx);

export const NetworkProvider = ({ children }: { children: ReactNode }) => {
  // Initialize as `online` so we don't flash a banner on a healthy cold-start.
  const [online, setOnline] = useState(true);
  const [pending, setPending] = useState(0);
  const wasOnline = useRef(true);

  const refreshPending = async () => {
    try {
      const q = await getQueue();
      setPending(q.length);
    } catch {
      setPending(0);
    }
  };

  useEffect(() => {
    // Initial fetch + queue snapshot
    refreshPending();
    let mounted = true;

    const apply = (nextOnline: boolean) => {
      if (!mounted) return;
      setOnline(nextOnline);
      // When transitioning offline→online, drain the queue.
      if (!wasOnline.current && nextOnline) {
        flushQueue().then((res) => {
          if (res.replayed > 0) toast.success(`Caught up — ${res.replayed} action${res.replayed > 1 ? 's' : ''} sent.`);
          if (res.dropped > 0) toast.warning(`${res.dropped} action${res.dropped > 1 ? 's' : ''} couldn't be sent and were dropped.`);
          refreshPending();
        }).catch(() => {});
      }
      wasOnline.current = nextOnline;
    };

    const applyFromState = (state: NetInfoState) => {
      // `isInternetReachable` can be null on slow boot — fall back to isConnected only.
      const next = state.isConnected !== false && state.isInternetReachable !== false;
      apply(next);
    };

    // Native + initial fetch
    NetInfo.fetch().then(applyFromState).catch(() => {});
    const unsub = NetInfo.addEventListener(applyFromState);

    // Web fallback — NetInfo's web implementation can be flaky; mirror the
    // browser's own `online`/`offline` events so the banner reacts immediately
    // when the OS connection drops.
    let removeWebListeners: (() => void) | null = null;
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      const onOnline = () => apply(true);
      const onOffline = () => apply(false);
      window.addEventListener('online', onOnline);
      window.addEventListener('offline', onOffline);
      // Initial state from navigator.onLine if defined
      try {
        if (typeof navigator !== 'undefined' && 'onLine' in navigator) {
          apply(Boolean(navigator.onLine));
        }
      } catch {}
      removeWebListeners = () => {
        window.removeEventListener('online', onOnline);
        window.removeEventListener('offline', onOffline);
      };
    }

    return () => {
      mounted = false;
      unsub();
      if (removeWebListeners) removeWebListeners();
    };
  }, []);

  return (
    <Ctx.Provider value={{ online, pendingMutations: pending, refreshPending }}>
      {children}
      {!online ? <OfflineBanner pending={pending} /> : null}
    </Ctx.Provider>
  );
};

function OfflineBanner({ pending }: { pending: number }) {
  return (
    <View style={styles.banner} pointerEvents="none" testID="offline-banner">
      <Ionicons name="cloud-offline-outline" size={14} color={Colors.cream} />
      <Text style={styles.text}>
        Offline{pending > 0 ? ` · ${pending} change${pending > 1 ? 's' : ''} waiting to sync` : ' · we’ll catch up when you’re back'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 54 : 24,
    left: 12,
    right: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: Spacing.md,
    paddingVertical: 8,
    backgroundColor: Colors.severityAlert,
    borderRadius: 100,
    minHeight: 32,
    justifyContent: 'center',
    // soft shadow on iOS, elevation on Android
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
    zIndex: 999,
  },
  text: {
    fontFamily: Fonts.bodySemi,
    fontSize: 12,
    color: Colors.cream,
  },
});
