// Helper — download CSV from an admin endpoint, save to device cache, and share
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform, Alert } from 'react-native';
import { TOKEN_KEY } from './api';

const BASE = process.env.EXPO_PUBLIC_BACKEND_URL;

export async function downloadAndShareCsv(endpoint: string, filename: string) {
  if (Platform.OS === 'web') {
    // Web fallback: open in new tab with auth header is tricky — fetch + blob link
    try {
      const token = await AsyncStorage.getItem(TOKEN_KEY);
      const res = await fetch(`${BASE}/api${endpoint}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`Server returned ${res.status}`);
      const blob = await res.blob();
      const url = (globalThis as any).URL.createObjectURL(blob);
      const a = (globalThis as any).document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      setTimeout(() => (globalThis as any).URL.revokeObjectURL(url), 4000);
      return true;
    } catch (e: any) {
      Alert.alert('Could not export', e?.message || 'Try again in a moment.');
      return false;
    }
  }

  try {
    const token = await AsyncStorage.getItem(TOKEN_KEY);
    const dest = `${FileSystem.cacheDirectory}${filename}`;
    const dl = await FileSystem.downloadAsync(`${BASE}/api${endpoint}`, dest, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (dl.status !== 200) throw new Error(`Server returned ${dl.status}`);
    const canShare = await Sharing.isAvailableAsync();
    if (canShare) {
      await Sharing.shareAsync(dl.uri, { mimeType: 'text/csv', dialogTitle: 'Share CSV', UTI: 'public.comma-separated-values-text' });
    } else {
      Alert.alert('Saved', `Saved to cache: ${dl.uri}`);
    }
    return true;
  } catch (e: any) {
    Alert.alert('Could not export', e?.message || 'Try again in a moment.');
    return false;
  }
}
