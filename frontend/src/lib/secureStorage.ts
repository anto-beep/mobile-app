// Centralised secure-storage utilities + global clearAllUserData().
// ----------------------------------------------------------------
// Phase 1 of the mobile security hardening: a single import surface for
// wiping every piece of user data the app caches. Call this on:
//   • Manual logout
//   • Forced logout (idle, 401 from server, account deleted)
//   • Suspected device compromise / "Sign out everywhere" path
//
// What gets wiped:
//   1. Consumer JWT (SecureStore + AsyncStorage dual-write)
//   2. Admin JWT (SecureStore)
//   3. Offline mutation queue (AsyncStorage)
//   4. Biometric-lock setting flag (AsyncStorage)
//   5. Chat draft / last-active timestamps (AsyncStorage)
//   6. Notification dismissal markers (AsyncStorage)
//   7. Best-effort: any other key starting with `wayly:` in AsyncStorage,
//      EXCEPT accessibility prefs (we keep these so a re-login feels familiar)
//
// What it does NOT wipe (intentional):
//   • OS-level Keychain entries that other apps put there (we'd need keys)
//   • Background notifications queued by the OS (Apple/Google control)
//   • Files outside our app sandbox
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';

// Public keys used across the app — kept here so refactors stay safe.
export const STORAGE_KEYS = {
  consumerToken: 'wayly:token',
  adminToken: 'wayly:admin:token',
  adminLastActivity: 'wayly:admin:lastActivity',
  offlineQueue: 'wayly:offline_queue_v1',
  biometricFlag: 'wayly:biometric_lock',
  chatLastActive: 'wayly:chat:last_active',
  chatResumeDismissed: 'wayly:chat:resume_dismissed',
  accessibilityPrefs: 'wayly:accessibility:v1',
} as const;

// Keys we intentionally KEEP on a full wipe — UX preferences only.
const KEEP_ON_WIPE: ReadonlyArray<string> = [STORAGE_KEYS.accessibilityPrefs];

async function tryDelSecure(key: string): Promise<void> {
  if (Platform.OS === 'web') return;
  try {
    await SecureStore.deleteItemAsync(key);
  } catch {}
}

async function tryDelAsync(key: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(key);
  } catch {}
}

/**
 * Nuke all user data — auth, queues, flags, drafts.
 * Idempotent and crash-safe (best-effort per key).
 */
export async function clearAllUserData(): Promise<void> {
  // 1) Tokens out of the secure store
  await Promise.all([
    tryDelSecure(STORAGE_KEYS.consumerToken),
    tryDelSecure(STORAGE_KEYS.adminToken),
  ]);

  // 2) Sweep AsyncStorage — keep accessibility prefs.
  try {
    const keys = await AsyncStorage.getAllKeys();
    const toRemove = keys.filter(
      (k) => k.startsWith('wayly:') && !KEEP_ON_WIPE.includes(k as any)
    );
    if (toRemove.length) {
      await AsyncStorage.multiRemove(toRemove);
    }
  } catch {
    // Fallback: at least clear the well-known keys.
    await Promise.all(
      Object.values(STORAGE_KEYS)
        .filter((k) => !KEEP_ON_WIPE.includes(k as any))
        .map(tryDelAsync)
    );
  }
}
