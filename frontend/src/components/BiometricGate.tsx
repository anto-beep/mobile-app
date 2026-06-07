// BiometricGate
// --------------------------------------------------------------------
// Optional app-launch biometric lock for the *consumer* app. When the
// user opts in (Settings → Security), we render this gate over the app
// every cold-start and after a long background period. The gate stays
// up until biometric auth (Face ID / Touch ID / Android biometric) succeeds.
//
// Settings flag: AsyncStorage key `wayly:biometric_lock` = "1" | (absent)
// Background grace: 30 seconds (matches industry norm for banking apps).
//
// Web is a no-op — there's no Face ID in a browser tab, so we never gate.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, AppState, AppStateStatus, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Colors, Fonts, Radius, Spacing } from '../lib/theme';
import { confirmWithBiometric, biometryLabel } from '../lib/biometric';
import { useAuth } from '../context/AuthContext';

export const BIOMETRIC_FLAG_KEY = 'wayly:biometric_lock';
const BACKGROUND_GRACE_MS = 30_000;

export async function isBiometricLockEnabled(): Promise<boolean> {
  try {
    const v = await AsyncStorage.getItem(BIOMETRIC_FLAG_KEY);
    return v === '1';
  } catch {
    return false;
  }
}

export async function setBiometricLockEnabled(enabled: boolean): Promise<void> {
  try {
    if (enabled) await AsyncStorage.setItem(BIOMETRIC_FLAG_KEY, '1');
    else await AsyncStorage.removeItem(BIOMETRIC_FLAG_KEY);
  } catch {}
}

export function BiometricGate({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [locked, setLocked] = useState(false);
  const [checking, setChecking] = useState(true);
  const [authing, setAuthing] = useState(false);
  const lastBgRef = useRef<number | null>(null);

  // On every user-id change (login/logout), reset gate state.
  useEffect(() => {
    let mounted = true;
    (async () => {
      // No biometric gate when signed out or on web.
      if (!user || Platform.OS === 'web') {
        if (mounted) {
          setLocked(false);
          setChecking(false);
        }
        return;
      }
      const on = await isBiometricLockEnabled();
      if (!mounted) return;
      setLocked(on);
      setChecking(false);
    })();
    return () => {
      mounted = false;
    };
  }, [user?.id]);

  // Re-lock when app returns from a long background pause.
  useEffect(() => {
    if (Platform.OS === 'web' || !user) return;
    const sub = AppState.addEventListener('change', async (next: AppStateStatus) => {
      if (next === 'background' || next === 'inactive') {
        lastBgRef.current = Date.now();
      } else if (next === 'active') {
        const at = lastBgRef.current;
        lastBgRef.current = null;
        if (!at) return;
        if (Date.now() - at < BACKGROUND_GRACE_MS) return;
        const on = await isBiometricLockEnabled();
        if (on) setLocked(true);
      }
    });
    return () => sub.remove();
  }, [user?.id]);

  const tryUnlock = useCallback(async () => {
    if (authing) return;
    setAuthing(true);
    try {
      const r = await confirmWithBiometric('Unlock Wayly');
      if (r.success) setLocked(false);
    } finally {
      setAuthing(false);
    }
  }, [authing]);

  // Auto-prompt when the gate first appears.
  useEffect(() => {
    if (locked && !checking && !authing) {
      tryUnlock();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locked, checking]);

  if (checking) return <>{children}</>;
  if (!locked) return <>{children}</>;

  return (
    <View style={styles.shell}>
      <View style={styles.iconWrap}>
        <Ionicons name="lock-closed" size={32} color={Colors.brandPrimary} />
      </View>
      <Text style={styles.title}>Wayly is locked</Text>
      <Text style={styles.sub}>Unlock with {biometryLabel()} to continue.</Text>
      <TouchableOpacity style={styles.cta} onPress={tryUnlock} disabled={authing} testID="biometric-unlock">
        <Ionicons name="finger-print" size={16} color={Colors.cream} />
        <Text style={styles.ctaText}>{authing ? 'Unlocking…' : 'Unlock'}</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  shell: {
    flex: 1,
    backgroundColor: Colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.xl,
    gap: Spacing.sm,
  },
  iconWrap: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: 'rgba(14, 77, 82, 0.08)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.sm,
  },
  title: { fontFamily: Fonts.heading, fontSize: 22, color: Colors.brandPrimary, marginTop: 4 },
  sub: { fontFamily: Fonts.body, fontSize: 14, color: Colors.textSecondary, textAlign: 'center', lineHeight: 20 },
  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: Colors.brandPrimary,
    paddingVertical: 14,
    paddingHorizontal: 22,
    borderRadius: Radius.md,
    marginTop: Spacing.md,
    minHeight: 48,
  },
  ctaText: { fontFamily: Fonts.bodySemi, fontSize: 14, color: Colors.cream },
});

export default BiometricGate;
