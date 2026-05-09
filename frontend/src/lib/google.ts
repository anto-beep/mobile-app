// Emergent-managed Google Auth flow for Expo
// Opens auth.emergentagent.com via WebBrowser, returns session_id, exchanges via /api/auth/google-session
import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';
import { Platform } from 'react-native';
import { api } from './api';

WebBrowser.maybeCompleteAuthSession();

export type GoogleAuthResult = { token: string; user: any };

function parseSessionId(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    // Hash style: ...#session_id=...
    const hashMatch = url.match(/[#&]session_id=([^&]+)/);
    if (hashMatch) return decodeURIComponent(hashMatch[1]);
    const queryMatch = url.match(/[?&]session_id=([^&]+)/);
    if (queryMatch) return decodeURIComponent(queryMatch[1]);
  } catch {}
  return null;
}

export async function startGoogleAuth(): Promise<GoogleAuthResult> {
  // Mobile uses deep link; web uses page-relative redirect
  const redirectUrl =
    Platform.OS === 'web'
      ? `${window.location.origin}/`
      : Linking.createURL('/');

  const authUrl = `https://auth.emergentagent.com/?redirect=${encodeURIComponent(redirectUrl)}`;

  // Web: open in same tab to let postMessage / redirect work natively
  if (Platform.OS === 'web') {
    window.location.href = authUrl;
    // The page reloads; the layout will pick up #session_id on cold start.
    throw new Error('REDIRECTING');
  }

  const result = await WebBrowser.openAuthSessionAsync(authUrl, redirectUrl);

  let sessionId: string | null = null;
  if (result.type === 'success' && result.url) {
    sessionId = parseSessionId(result.url);
  }
  if (!sessionId) {
    // Cold-start fallback
    const initial = await Linking.getInitialURL();
    sessionId = parseSessionId(initial);
  }
  if (!sessionId) {
    throw new Error('Sign-in was cancelled.');
  }

  const { data } = await api.post('/auth/google-session', { session_id: sessionId });
  return { token: data.token, user: data.user };
}

// Web cold-start helper — pulls #session_id off the URL on first paint
export function consumeWebSessionIdFromHash(): string | null {
  if (Platform.OS !== 'web') return null;
  if (typeof window === 'undefined') return null;
  const sid = parseSessionId(window.location.hash) || parseSessionId(window.location.search);
  if (sid) {
    // Clean URL
    try {
      const cleanUrl = window.location.pathname;
      window.history.replaceState({}, document.title, cleanUrl);
    } catch {}
  }
  return sid;
}
