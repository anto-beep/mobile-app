// Phase A — token + refresh-token storage.
// ----------------------------------------------------------------
// Builds on the existing dual-write tokenStorage helper. Adds a dedicated
// REFRESH_TOKEN_KEY and a single "refresh now" entry point used by both
// the axios 401 interceptor (api.ts) and the AuthContext bootstrap.
//
// Concurrency: a single in-flight refresh is deduplicated via a module-level
// promise (`_refreshPromise`). Mirrors `frontend/src/lib/api.js` in the web.
import { Platform } from 'react-native';
import axios from 'axios';
import { getToken, setToken, clearToken } from './tokenStorage';

export const ACCESS_TOKEN_KEY = 'wayly:token';
export const REFRESH_TOKEN_KEY = 'wayly:refresh';

const BASE = process.env.EXPO_PUBLIC_BACKEND_URL;

let _refreshPromise: Promise<{ token: string; refresh: string } | null> | null = null;

export async function getAccessToken(): Promise<string | null> {
  return await getToken(ACCESS_TOKEN_KEY);
}

export async function getRefreshToken(): Promise<string | null> {
  return await getToken(REFRESH_TOKEN_KEY);
}

export async function persistTokens(token: string, refresh?: string | null): Promise<void> {
  await setToken(ACCESS_TOKEN_KEY, token);
  if (refresh) {
    await setToken(REFRESH_TOKEN_KEY, refresh);
  }
}

export async function clearTokens(): Promise<void> {
  await Promise.all([clearToken(ACCESS_TOKEN_KEY), clearToken(REFRESH_TOKEN_KEY)]);
}

/**
 * Swap the refresh-token for a new access+refresh pair. Returns null if no
 * refresh token is on disk or the server rejects it. Deduplicates concurrent
 * callers via `_refreshPromise`.
 */
export async function refreshSession(): Promise<{ token: string; refresh: string } | null> {
  if (_refreshPromise) return _refreshPromise;
  _refreshPromise = (async () => {
    try {
      const rt = await getRefreshToken();
      if (!rt) return null;
      // Use a bare axios client so we don't recurse through our own interceptor.
      const { data } = await axios.post(
        `${BASE}/api/auth/refresh`,
        { refresh_token: rt },
        { timeout: 15_000 },
      );
      if (!data?.token || !data?.refresh_token) return null;
      await persistTokens(data.token, data.refresh_token);
      return { token: data.token, refresh: data.refresh_token };
    } catch {
      return null;
    } finally {
      // Reset for the next 401, but only after the current promise resolves.
      setTimeout(() => { _refreshPromise = null; }, 0);
    }
  })();
  return _refreshPromise;
}

// Used by the security audit / tests; web is no-op anyway.
export const __platform = Platform.OS;
