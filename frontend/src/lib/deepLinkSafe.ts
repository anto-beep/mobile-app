// Phase 7 hardening — deep-link safety.
// ----------------------------------------------------------------
// Centralises the rules for "is this URL safe to navigate to?".
//
// Rules:
//   1. Scheme must be `wayly` (custom scheme) or `https` (Universal Link).
//   2. For `https://`, host must be in HOST_ALLOWLIST. This blocks an
//      attacker placing a forged `https://wayly-evil.com.au/...` link into
//      a phishing email — the OS may hand the URL to our app, but we route
//      to a safe fallback instead of acting on it.
//   3. Path is normalised to lower-case + leading slash stripped.
//   4. Path must match one of ALLOWED_PATH_RX. Anything else → null.
//   5. Query params are extracted, but the caller is responsible for
//      validating their *content* (e.g. token shape).
//
// This module is intentionally framework-free so the same parser can run
// inside unit tests.

export const HOST_ALLOWLIST: ReadonlyArray<string> = [
  'wayly.com.au',
  'app.wayly.com.au',
  'www.wayly.com.au',
];

const ALLOWED_PATH_RX: ReadonlyArray<RegExp> = [
  /^reset-password$/,
  /^signup$/,
  /^\(auth\)\/signup$/,
  /^(app\/)?statements\/[\w-]{1,128}$/, // UUID-ish only, no traversal
  /^billing\/(success|cancel)$/,
  /^admin-app(\/.*)?$/,
  /^admin-auth(\/.*)?$/,
];

export type ParsedDeepLink =
  | { kind: 'reset-password'; token: string }
  | { kind: 'signup'; params: Record<string, string> }
  | { kind: 'statement'; statementId: string }
  | { kind: 'billing-success' }
  | { kind: 'billing-cancel' }
  | { kind: 'admin'; subPath: string };

/**
 * Returns a safe, typed deep-link descriptor — or `null` if the URL fails
 * any validation step. Callers MUST treat `null` as "ignore, do not route".
 */
export function safeParseDeepLink(rawUrl: string | null | undefined): ParsedDeepLink | null {
  if (!rawUrl || typeof rawUrl !== 'string') return null;
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return null;
  }

  const scheme = parsed.protocol.replace(':', '').toLowerCase();
  if (scheme !== 'wayly' && scheme !== 'https') return null;

  if (scheme === 'https' && !HOST_ALLOWLIST.includes(parsed.host.toLowerCase())) {
    return null;
  }

  // expo-linking surfaces the path under `parsed.pathname` for the URL form.
  // For custom schemes (wayly://reset-password?...), some platforms put the
  // path into `parsed.host` instead. Normalise both.
  let raw = parsed.pathname || '';
  if (scheme === 'wayly') {
    // wayly://reset-password?token=... → host="reset-password", path=""
    raw = parsed.host + parsed.pathname;
  }
  const path = raw.replace(/^\/+/, '').toLowerCase();
  // Reject path traversal early
  if (path.includes('..') || path.includes('//')) return null;

  if (!ALLOWED_PATH_RX.some((rx) => rx.test(path))) return null;

  const qp: Record<string, string> = {};
  parsed.searchParams.forEach((v, k) => {
    qp[k] = v;
  });

  if (path === 'reset-password') {
    const token = qp.token || '';
    if (!/^[A-Za-z0-9_\-]{16,256}$/.test(token)) return null;
    return { kind: 'reset-password', token };
  }
  if (path === 'signup' || path === '(auth)/signup') {
    return { kind: 'signup', params: qp };
  }
  const stmt = path.match(/^(?:app\/)?statements\/([\w-]{1,128})$/);
  if (stmt) {
    const id = stmt[1];
    if (!/^[A-Za-z0-9_\-]{1,128}$/.test(id)) return null;
    return { kind: 'statement', statementId: id };
  }
  if (path === 'billing/success') return { kind: 'billing-success' };
  if (path === 'billing/cancel') return { kind: 'billing-cancel' };
  if (path.startsWith('admin-app') || path.startsWith('admin-auth')) {
    return { kind: 'admin', subPath: path };
  }
  return null;
}
