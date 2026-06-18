// Centralised deep-link handler.
// Handles wayly:// scheme + https://wayly.com.au universal links.
// Drop <DeepLinkHandler /> high in the tree once — it's mounted by app/_layout.tsx.
//
// Phase 7 hardening: all URLs run through `safeParseDeepLink` which enforces:
//   - scheme ∈ { wayly, https }
//   - host allowlist for https
//   - path allowlist (no traversal, no arbitrary routes)
//   - reset-password / verify-email token shape validation
// Anything that fails is silently dropped (we don't route — and we don't
// surface an error toast either, to avoid leaking which links are valid).
import { useEffect } from 'react';
import * as Linking from 'expo-linking';
import { useRouter } from 'expo-router';
import { safeParseDeepLink } from '../lib/deepLinkSafe';
import { api } from '../lib/api';
import { toast } from './Toast';
import { useAuth } from '../context/AuthContext';

async function consumeVerifyToken(token: string): Promise<'success' | 'expired' | 'invalid' | 'already_verified' | 'network'> {
  try {
    // The backend redirects to ${FRONTEND_URL}/verify-email?status=…
    // axios follows redirects by default; we want the FINAL URL so we can
    // pull the `?status=` param. Easiest path: hit it via fetch with manual
    // redirect handling so we can read the Location header.
    const baseURL = (api.defaults?.baseURL || '').replace(/\/+$/, '');
    const url = `${baseURL}/auth/verify-email?token=${encodeURIComponent(token)}`;
    // First try manual redirect (lets us read Location directly):
    let location: string | null = null;
    try {
      const r = await fetch(url, { method: 'GET', redirect: 'manual' });
      location = r.headers.get('location');
    } catch {
      // CORS / runtime that can't do manual — fall through to followed-fetch.
    }
    if (!location) {
      // Fallback: let it follow and use the final response URL.
      const r2 = await fetch(url, { method: 'GET', redirect: 'follow' });
      location = r2.url || null;
    }
    if (!location) return 'network';
    const parsed = new URL(location);
    const status = (parsed.searchParams.get('status') || '').toLowerCase();
    if (status === 'success') return 'success';
    if (status === 'expired') return 'expired';
    if (status === 'invalid') return 'invalid';
    if (status === 'already_verified') return 'already_verified';
    return 'invalid';
  } catch {
    return 'network';
  }
}

function routeFromUrl(
  url: string | null,
  router: ReturnType<typeof useRouter>,
  onVerifyEmail: (token: string) => void
) {
  if (!url) return;
  const parsed = safeParseDeepLink(url);
  if (!parsed) return; // Phase 7: untrusted/malformed links are ignored.

  switch (parsed.kind) {
    case 'reset-password':
      router.push({ pathname: '/reset-password' as any, params: { token: parsed.token } });
      return;
    case 'signup':
      router.push({ pathname: '/(auth)/signup' as any, params: parsed.params as any });
      return;
    case 'verify-email':
      onVerifyEmail(parsed.token);
      return;
    case 'statement':
      router.push(`/statements/${parsed.statementId}` as any);
      return;
    case 'billing-success':
    case 'billing-cancel':
      router.push('/settings/plan' as any);
      return;
    case 'admin':
      router.push(`/${parsed.subPath}` as any);
      return;
  }
}

export function DeepLinkHandler() {
  const router = useRouter();
  const { refreshVerification, user } = useAuth();

  const handleVerify = async (token: string) => {
    const result = await consumeVerifyToken(token);
    if (result === 'success' || result === 'already_verified') {
      toast.success(result === 'success' ? 'Email verified \u2713' : 'Email already verified \u2713');
      // Refresh auth state so the banner hides and any 403 lock lifts.
      try { await refreshVerification(); } catch {}
      router.replace(user ? '/(tabs)/today' as any : '/(auth)/login' as any);
      return;
    }
    if (result === 'expired') {
      toast.warning('That verification link has expired. We sent you a new one.');
      // Fire-and-forget a fresh send if we have an authed session.
      try { await api.post('/auth/send-verification-email'); } catch {}
    } else if (result === 'invalid') {
      toast.error('That verification link is no longer valid. Request a new one from Settings.');
    } else {
      toast.error('Couldn\u2019t reach Wayly to verify. Check your connection and try again.');
    }
    router.replace(user ? '/(tabs)/today' as any : '/(auth)/login' as any);
  };

  useEffect(() => {
    // 1) Cold-start: did the app open from a link?
    Linking.getInitialURL().then((url) => routeFromUrl(url, router, handleVerify)).catch(() => {});

    // 2) While running: listen for subsequent links
    const sub = Linking.addEventListener('url', (ev) => routeFromUrl(ev.url, router, handleVerify));
    return () => sub.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}
