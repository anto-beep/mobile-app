// Cross-platform helper that downloads the adviser review-pack PDF.
// - Web: fetch with Bearer header, then trigger an <a download> on a Blob URL.
// - Native: use expo-file-system to download to cache + expo-sharing to open the share sheet.
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
// expo-file-system v19 moved the classic API (downloadAsync, cacheDirectory) into the
// `expo-file-system/legacy` submodule. The new File/Directory class API doesn't yet
// expose a simple downloadAsync with auth headers, so we deliberately use legacy here.
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { TOKEN_KEY } from './api';

function backendUrl(): string {
  // EXPO_PUBLIC_BACKEND_URL is the canonical env entry; fall back to relative for web.
  const env = (process.env as any).EXPO_PUBLIC_BACKEND_URL || '';
  if (env) return env.replace(/\/$/, '');
  if (Platform.OS === 'web') return '';
  return '';
}

export async function downloadReviewPack(clientId: string, clientName?: string): Promise<{ ok: boolean; uri?: string; error?: string }> {
  const token = await AsyncStorage.getItem(TOKEN_KEY);
  if (!token) return { ok: false, error: 'Not signed in.' };
  const safe = (clientName || 'client').replace(/[^A-Za-z0-9 _-]/g, '').replace(/\s+/g, '_') || 'client';
  const filename = `wayly-review-${safe}.pdf`;
  const url = `${backendUrl()}/api/adviser/clients/${clientId}/review-pack.pdf`;

  if (Platform.OS === 'web') {
    try {
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        return { ok: false, error: `Server returned ${res.status}. ${body.slice(0, 120)}` };
      }
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(blobUrl), 2000);
      return { ok: true, uri: blobUrl };
    } catch (e: any) {
      return { ok: false, error: e?.message || 'Download failed.' };
    }
  }

  try {
    const dest = `${FileSystem.cacheDirectory}${filename}`;
    const res = await FileSystem.downloadAsync(url, dest, { headers: { Authorization: `Bearer ${token}` } });
    if (res.status !== 200) {
      return { ok: false, error: `Server returned ${res.status}.` };
    }
    const can = await Sharing.isAvailableAsync();
    if (can) {
      await Sharing.shareAsync(res.uri, { mimeType: 'application/pdf', dialogTitle: 'Wayly review pack', UTI: 'com.adobe.pdf' });
    }
    return { ok: true, uri: res.uri };
  } catch (e: any) {
    return { ok: false, error: e?.message || 'Download failed.' };
  }
}
