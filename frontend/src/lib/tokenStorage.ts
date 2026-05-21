// Cross-platform secure storage for the *consumer* auth token.
//
// Strategy: **dual-write**. We always persist the token to AsyncStorage and,
// when running on native, ALSO write it to expo-secure-store (Keychain /
// Keystore). On read, we try SecureStore first, then fall back to
// AsyncStorage. This guarantees:
//
//   • New native builds get the security upgrade (token in the OS-managed
//     secure enclave) without losing the AsyncStorage copy as a safety net.
//   • Existing sessions are preserved across the upgrade — no logouts.
//   • If SecureStore ever fails to persist (Expo Go on certain Android OEMs,
//     simulator edge cases), the AsyncStorage copy still lets the user in.
//
// Logout clears BOTH stores, so a deleted session can never be resurrected
// from a stale SecureStore entry.
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';

async function secureStoreGet(key: string): Promise<string | null> {
  if (Platform.OS === 'web') return null;
  try {
    return await SecureStore.getItemAsync(key);
  } catch {
    return null;
  }
}

async function secureStoreSet(key: string, value: string): Promise<void> {
  if (Platform.OS === 'web') return;
  try {
    await SecureStore.setItemAsync(key, value);
  } catch {
    // SecureStore can fail on simulators / Expo Go on some Android OEMs.
    // We silently ignore — AsyncStorage still has the token as a safety net.
  }
}

async function secureStoreDel(key: string): Promise<void> {
  if (Platform.OS === 'web') return;
  try {
    await SecureStore.deleteItemAsync(key);
  } catch {}
}

/** Read the token, trying the more secure store first. */
export async function getToken(key: string): Promise<string | null> {
  // 1) Native secure store
  const v = await secureStoreGet(key);
  if (v) return v;
  // 2) AsyncStorage fallback (always present)
  try {
    return await AsyncStorage.getItem(key);
  } catch {
    return null;
  }
}

/** Write the token to both stores so reads from either return the same value. */
export async function setToken(key: string, value: string): Promise<void> {
  try {
    await AsyncStorage.setItem(key, value);
  } catch {}
  // Dual-write to SecureStore on native (no-op on web).
  await secureStoreSet(key, value);
}

/** Clear from both stores — never resurrect a logged-out session. */
export async function clearToken(key: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(key);
  } catch {}
  await secureStoreDel(key);
}
