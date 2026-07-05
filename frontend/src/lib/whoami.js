/**
 * Boot-time diagnostic banner — see /app/MOBILE_AGENT_WHOAMI_DIAGNOSTIC.md.
 *
 * Called once from `app/_layout.tsx` on mount. Emits 3 lines to the JS
 * console so we can tell at a glance whether the mobile app is pointing
 * at the correct backend (and whether that backend is reachable).
 *
 * This build adapts the drop-in from the spec to the wayly repo:
 *   • Token key is `wayly:token` (matches `src/lib/api.ts` TOKEN_KEY),
 *     stored primarily in `expo-secure-store` with an AsyncStorage
 *     fallback for Expo Go on web.
 *   • URL resolution supports the new EXPO_PUBLIC_WAYLY_API_URL plus the
 *     existing EXPO_PUBLIC_BACKEND_URL / EXPO_PUBLIC_API_BASE_OVERRIDE
 *     precedence used by `resolveBackend()` — so Jeremy's login bug
 *     (Expo Go pointing at the wrong host) is detected regardless of
 *     which env key the pod was configured with.
 */
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';

const RED    = '\u001b[31m';
const YELLOW = '\u001b[33m';
const GREEN  = '\u001b[32m';
const DIM    = '\u001b[2m';
const RESET  = '\u001b[0m';

const PREVIEW_HOST_RE = /^(?:https?:\/\/)?[a-z0-9-]+\.(?:preview\.)?emergentagent\.com/i;

/**
 * Resolve the effective API base URL, following the same precedence
 * as `src/lib/api.ts::resolveBackend()`:
 *   1. EXPO_PUBLIC_API_BASE_OVERRIDE (explicit escape hatch)
 *   2. EXPO_PUBLIC_WAYLY_API_URL     (canonical name per spec)
 *   3. EXPO_PUBLIC_BACKEND_URL       (legacy — auto-substituted below
 *      to prod if it looks like a preview-pod host)
 *   4. Constants.expoConfig.extra.waylyApiUrl / manifest fallback
 */
export function resolveApiUrl() {
  const override = process.env.EXPO_PUBLIC_API_BASE_OVERRIDE;
  if (override) return override.trim();

  const wayly = (process.env.EXPO_PUBLIC_WAYLY_API_URL || '').trim();
  if (wayly) return wayly;

  const legacy = (process.env.EXPO_PUBLIC_BACKEND_URL || '').trim();
  if (legacy && !PREVIEW_HOST_RE.test(legacy)) return legacy;

  const extraA = Constants?.expoConfig?.extra?.waylyApiUrl;
  const extraB = Constants?.manifest?.extra?.waylyApiUrl;
  if (extraA) return extraA;
  if (extraB) return extraB;

  // Fallback matches api.ts PROD_BACKEND — never let the app resolve to `undefined`.
  return 'https://aged-care-os.emergent.host';
}

function banner(color, title, lines) {
  /* eslint-disable no-console */
  console.log('');
  console.log(`${color}\u250C\u2500\u2500 ${title} \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500${RESET}`);
  for (const l of lines) console.log(`${color}\u2502${RESET} ${l}`);
  console.log(`${color}\u2514\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500${RESET}`);
  console.log('');
  /* eslint-enable no-console */
}

async function readToken() {
  // Wayly stores the JWT under `wayly:token`. Prefer SecureStore (native
  // Expo Go / production), fall back to AsyncStorage on web where
  // SecureStore is a no-op.
  try {
    if (Platform.OS !== 'web') {
      const t = await SecureStore.getItemAsync('wayly:token');
      if (t) return t;
    }
  } catch { /* fall through */ }
  try {
    const t = await AsyncStorage.getItem('wayly:token');
    if (t) return t;
  } catch { /* fall through */ }
  return null;
}

/**
 * Emit the boot diagnostic banner. Idempotent — safe to call more than
 * once, but callers should invoke from `_layout.tsx` only.
 *
 * Returns an object useful for tests; the primary output is the console
 * banner visible in Expo Go / Metro.
 */
export async function runWhoAmI() {
  const apiUrl = resolveApiUrl();
  const runtime = {
    platform: Platform.OS,
    expoVersion: Constants.expoVersion,
    appOwnership: Constants.appOwnership,      // 'expo' == Expo Go
    deviceName: Constants.deviceName,
    expoRuntimeVersion: Constants.expoRuntimeVersion,
  };

  if (!apiUrl) {
    banner(RED, 'WAYLY WHOAMI \u2014 MISCONFIG', [
      '\u274C No API URL resolved.',
      '   Set EXPO_PUBLIC_WAYLY_API_URL in your .env, OR',
      '   Set extra.waylyApiUrl in app.config.js',
      '   Expected value: https://aged-care-os.preview.emergentagent.com',
      '',
      `Runtime: ${JSON.stringify(runtime)}`,
    ]);
    return { ok: false, reason: 'no_api_url', runtime };
  }

  // localhost on a real device (Expo Go) points at the phone, not the laptop.
  const isLocalhost = /^(?:https?:\/\/)?(?:localhost|127\.0\.0\.1|10\.0\.2\.2)(?::\d+)?/i.test(apiUrl);
  if (isLocalhost && Constants.appOwnership === 'expo') {
    banner(YELLOW, 'WAYLY WHOAMI \u2014 LOCALHOST WARNING', [
      `\u26A0 API URL = ${apiUrl}`,
      "   On a real device via Expo Go, 'localhost' refers to the PHONE,",
      '   not your dev laptop. Login will fail with a network error.',
      '   Use the preview URL for shared QA:',
      '     https://aged-care-os.preview.emergentagent.com',
      '   OR your LAN IP (e.g. http://192.168.x.x:8001) for a local backend.',
    ]);
  }

  // Probe /api/health (cheap, unauthenticated).
  let health = null;
  let healthError = null;
  const started = Date.now();
  try {
    const r = await fetch(`${apiUrl}/api/health`);
    const body = await r.text();
    let parsed = body;
    try { parsed = JSON.parse(body); } catch { /* keep raw */ }
    health = { status: r.status, ok: r.ok, body: parsed, latency_ms: Date.now() - started };
  } catch (e) {
    healthError = { message: String(e?.message || e), latency_ms: Date.now() - started };
  }

  // If a token is stored, hit /api/auth/me so we know which account is signed in.
  let me = null;
  let meError = null;
  const token = await readToken();
  if (token) {
    try {
      const r = await fetch(`${apiUrl}/api/auth/me`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = await r.text();
      let parsed = body;
      try { parsed = JSON.parse(body); } catch { /* keep raw */ }
      me = { status: r.status, ok: r.ok, body: parsed };
    } catch (e) {
      meError = String(e?.message || e);
    }
  }

  const healthOk = health?.ok === true;
  const color = healthOk ? GREEN : RED;
  const lines = [
    `API URL     : ${apiUrl}`,
    `Platform    : ${runtime.platform} \u00B7 Expo Go: ${runtime.appOwnership === 'expo' ? 'yes' : 'no'}`,
    `Device      : ${runtime.deviceName || '-'}`,
    '',
    `GET /api/health \u2192 ${health ? `${health.status} in ${health.latency_ms}ms` : `ERROR ${healthError?.message}`}`,
  ];
  if (healthOk && health?.body) {
    lines.push(`  body: ${typeof health.body === 'string' ? health.body : JSON.stringify(health.body)}`);
  }
  if (token) {
    lines.push('');
    lines.push(`GET /api/auth/me (with stored token) \u2192 ${me ? me.status : `ERROR ${meError}`}`);
    if (me?.ok && me?.body?.email) {
      lines.push(`  signed in as: ${me.body.email}  \u00B7  plan=${me.body.plan}  \u00B7  role=${me.body.role}`);
    } else if (me && !me.ok) {
      lines.push('  token appears invalid or expired \u2014 call /auth/refresh or force logout');
    }
  } else {
    lines.push('');
    lines.push(`${DIM}(no stored token \u2014 expected on first launch)${RESET}`);
  }

  banner(color, `WAYLY WHOAMI \u2014 ${healthOk ? 'OK' : 'UNREACHABLE'}`, lines);
  return { ok: healthOk, apiUrl, health, me, token: Boolean(token), runtime };
}

export default runWhoAmI;
