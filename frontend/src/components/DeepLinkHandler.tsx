// Centralised deep-link handler.
// Handles wayly:// scheme + https://wayly.com.au universal links.
// Drop <DeepLinkHandler /> high in the tree once — it's mounted by app/_layout.tsx.
//
// Phase 7 hardening: all URLs run through `safeParseDeepLink` which enforces:
//   - scheme ∈ { wayly, https }
//   - host allowlist for https
//   - path allowlist (no traversal, no arbitrary routes)
//   - reset-password token shape validation
// Anything that fails is silently dropped (we don't route — and we don't
// surface an error toast either, to avoid leaking which links are valid).
import { useEffect } from 'react';
import * as Linking from 'expo-linking';
import { useRouter } from 'expo-router';
import { safeParseDeepLink } from '../lib/deepLinkSafe';

function routeFromUrl(url: string | null, router: ReturnType<typeof useRouter>) {
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

  useEffect(() => {
    // 1) Cold-start: did the app open from a link?
    Linking.getInitialURL().then((url) => routeFromUrl(url, router)).catch(() => {});

    // 2) While running: listen for subsequent links
    const sub = Linking.addEventListener('url', (ev) => routeFromUrl(ev.url, router));
    return () => sub.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}
