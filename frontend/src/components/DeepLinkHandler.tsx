// Centralised deep-link handler.
// Handles wayly:// scheme + https://wayly.com.au universal links.
// Drop <DeepLinkHandler /> high in the tree once — it's mounted by app/_layout.tsx.
import { useEffect } from 'react';
import * as Linking from 'expo-linking';
import { useRouter } from 'expo-router';

function parseAndRoute(url: string | null, router: ReturnType<typeof useRouter>) {
  if (!url) return;
  try {
    const parsed = Linking.parse(url);
    const path = (parsed.path || '').replace(/^\/+/, '').toLowerCase();
    const qp = parsed.queryParams || {};

    // wayly://reset-password?token=...
    if (path === 'reset-password' || path.startsWith('reset-password')) {
      const token = (qp.token as string) || '';
      router.push({ pathname: '/reset-password' as any, params: { token } });
      return;
    }

    // wayly://signup?invite=xxx&plan=family
    if (path === 'signup' || path === '(auth)/signup') {
      router.push({ pathname: '/(auth)/signup' as any, params: qp as any });
      return;
    }

    // wayly://app/statements/<id>
    const stmtMatch = path.match(/^(?:app\/)?statements\/([\w-]+)/);
    if (stmtMatch) {
      router.push(`/statements/${stmtMatch[1]}` as any);
      return;
    }

    // wayly://billing/success  or  /billing/cancel
    if (path === 'billing/success' || path === 'billing/cancel') {
      router.push('/settings/plan' as any);
      return;
    }

    // wayly://admin/...  — keep admin path verbatim
    if (path.startsWith('admin-app') || path.startsWith('admin-auth')) {
      router.push(`/${path}` as any);
      return;
    }
  } catch {
    // ignore malformed links
  }
}

export function DeepLinkHandler() {
  const router = useRouter();

  useEffect(() => {
    // 1) Cold-start: did the app open from a link?
    Linking.getInitialURL().then((url) => parseAndRoute(url, router)).catch(() => {});

    // 2) While running: listen for subsequent links
    const sub = Linking.addEventListener('url', (ev) => parseAndRoute(ev.url, router));
    return () => sub.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}
