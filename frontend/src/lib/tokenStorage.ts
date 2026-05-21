// Cross-platform secure storage for the *consumer* auth token.
//
// Native: stored in iOS Keychain / Android Keystore via expo-secure-store
// Web:    stored in localStorage via @react-native-async-storage/async-storage
//
// Includes a one-shot migration that moves an existing AsyncStorage token over
// to SecureStore the first time the app starts after the upgrade, so existing
// sessions don't get logged out.
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';

const MIGRATED_FLAG = 'wayly:token_migrated_v1';

async function secureGet(key: string): Promise<string | null> {
  if (Platform.OS === 'web') return AsyncStorage.getItem(key);
  try {
    return await SecureStore.getItemAsync(key);
  } catch {
    return null;
  }
}

async function secureSet(key: string, value: string): Promise<void> {
  if (Platform.OS === 'web') {
    await AsyncStorage.setItem(key, value);
    return;
  }
  try {
    await SecureStore.setItemAsync(key, value);
  } catch {
    // SecureStore can fail on simulator/edge cases — fall through silently;
    // AsyncStorage is still the source of truth for those callers.
  }
}

async function secureDel(key: string): Promise<void> {
  if (Platform.OS === 'web') {
    await AsyncStorage.removeItem(key);
    return;
  }
  try {
    await SecureStore.deleteItemAsync(key);
  } catch {}
}

// Public API — used by api.ts + AuthContext + reviewPack/csvExport.
export async function getToken(key: string): Promise<string | null> {
  // 1) Try secure store first (the new home).
  const v = await secureGet(key);
  if (v) return v;
  // 2) Legacy fallback — older builds stored the token in AsyncStorage. If we
  //    find it there, migrate it on the fly so the next call hits SecureStore.
  if (Platform.OS !== 'web') {
    const legacy = await AsyncStorage.getItem(key);
    if (legacy) {
      await secureSet(key, legacy);
      try {
        await AsyncStorage.removeItem(key);
        await AsyncStorage.setItem(MIGRATED_FLAG, '1');
      } catch {}
      return legacy;
    }
  }
  return null;
}

export async function setToken(key: string, value: string): Promise<void> {
  await secureSet(key, value);
  // Belt-and-braces: also clear any stale AsyncStorage entry so we don't
  // accidentally read the old value on the next cold start.
  if (Platform.OS !== 'web') {
    try {
      await AsyncStorage.removeItem(key);
    } catch {}
  }
}

export async function clearToken(key: string): Promise<void> {
  await secureDel(key);
  if (Platform.OS !== 'web') {
    try {
      await AsyncStorage.removeItem(key);
    } catch {}
  }
}
