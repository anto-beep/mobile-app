import axios, { AxiosInstance, AxiosError } from 'axios';
import { toast } from '../components/Toast';
import { getAccessToken, refreshSession, clearTokens } from './tokens';
import { getActiveParticipantId, isImpersonating } from './activeParticipant';

// ─────────────────────────────────────────────────────────────────────────
// Backend URL resolution.
//
// `/entrypoint.sh` rewrites `EXPO_PUBLIC_BACKEND_URL` to the pod's preview
// URL (`*.preview.emergentagent.com`) on EVERY container boot. That preview
// pod is the dev sandbox — it does NOT carry the production Wayly schema,
// data, or iter 39-48 endpoints (`/api/public/aged-care-chat`,
// `/api/public/contribution-estimator`, `/api/scenario/*`, etc.).
//
// This mobile app is the renderer for production Wayly, so we always need
// to talk to the prod Wayly API host (`aged-care-os.emergent.host`). To
// survive the entrypoint rewrite we detect the preview-pod pattern at
// runtime and substitute the prod URL.
//
// Override order:
//   1. `EXPO_PUBLIC_API_BASE_OVERRIDE`  — explicit escape hatch for staging
//   2. `EXPO_PUBLIC_BACKEND_URL` if it doesn't look like a preview-pod URL
//   3. Hard-coded production URL — final fallback
//
// To point at a different backend (staging, local), set
// `EXPO_PUBLIC_API_BASE_OVERRIDE=https://your-host` in `frontend/.env`.
// ─────────────────────────────────────────────────────────────────────────
// The real production Wayly API host (confirmed via web-app DevTools).
// wayly.com.au only serves the marketing site + web app shell; the API itself
// is at aged-care-os.emergent.host. If you ever move the API back to
// wayly.com.au, update this constant and the EXPO_PUBLIC_API_BASE_OVERRIDE
// instruction in the comment block above.
const PROD_BACKEND = 'https://aged-care-os.emergent.host';
const PREVIEW_HOST_PATTERN = /\.preview\.emergentagent\.com/i;

function resolveBackend(): string {
  const override = process.env.EXPO_PUBLIC_API_BASE_OVERRIDE;
  if (override && override.trim()) return override.trim().replace(/\/$/, '');

  const envVal = (process.env.EXPO_PUBLIC_BACKEND_URL || '').trim();
  if (envVal && !PREVIEW_HOST_PATTERN.test(envVal)) {
    return envVal.replace(/\/$/, '');
  }

  if (envVal && PREVIEW_HOST_PATTERN.test(envVal) && __DEV__) {
    console.warn(
      `[api] EXPO_PUBLIC_BACKEND_URL is a preview-pod URL (${envVal}). ` +
        `Substituting production (${PROD_BACKEND}). Set EXPO_PUBLIC_API_BASE_OVERRIDE ` +
        `if you really meant to hit a non-production backend.`,
    );
  }
  return PROD_BACKEND;
}

const BASE = resolveBackend();

// ── Trial read-only mode (UI-2 Part F) ─────────────────────────────────────
// Backend blocks writes for expired trials with HTTP 402 `trial_expired`.
// We also block writes BEFORE the network call once the flag is set (from
// AuthContext on login/refresh, or from the first 402 seen).
let trialReadOnly = false;
export const setTrialReadOnly = (v: boolean) => { trialReadOnly = v; };
export const isTrialReadOnly = () => trialReadOnly;
const TRIAL_EXPIRED_MSG = 'Your trial has ended. Subscribe to add or change anything.';

// Exposed so non-axios callers (e.g. `expo-file-system` PDF downloads) can
// build absolute URLs to the same backend without re-running the override
// resolver. NEVER hardcode the URL in screens — import this instead.
export const API_BASE_URL = BASE;

// Re-exported for legacy callers (AuthContext, secureStorage clear flow).
export const TOKEN_KEY = 'wayly:token';

export const api: AxiosInstance = axios.create({
  baseURL: `${BASE}/api`,
  timeout: 30_000,
});

// ── REQUEST ────────────────────────────────────────────────────────────────
// Inject Bearer token + X-Participant-Id + impersonation read-only guard.
api.interceptors.request.use(async (config) => {
  const token = await getAccessToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  // Active participant scoping. Skip auth/account/billing/admin/adviser
  // endpoints — those operate at the account level, not per-participant.
  const url: string = (config.url || '').toString();
  const skipParticipantHeader =
    url.startsWith('/auth') ||
    url.startsWith('/account') ||
    url.startsWith('/billing') ||
    url.startsWith('/admin') ||
    url.startsWith('/adviser') ||
    url.startsWith('/public') ||
    url.startsWith('/participants') ||  // CRUD targets the path id, not the active participant
    url.startsWith('/webhooks');
  if (!skipParticipantHeader) {
    const pid = getActiveParticipantId();
    if (pid) {
      config.headers['X-Participant-Id'] = pid;
    }
  }
  // Impersonation read-only guard — matches frontend/src/lib/api.js (web) lines 139–151.
  // If an admin has impersonated a user, every non-GET request is rejected client-side.
  const method = (config.method || 'get').toUpperCase();
  if (isImpersonating() && method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS') {
    toast.warning('Read-only mode, write actions are disabled while impersonating.', 4500);
    const ce = new axios.Cancel('Impersonation read-only mode');
    throw ce;
  }
  // Trial expired → block writes client-side. Auth + billing stay open so the
  // user can sign in/out and subscribe.
  const isWriteBlockedRoute = !url.startsWith('/auth') && !url.startsWith('/billing');
  if (trialReadOnly && isWriteBlockedRoute && method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS') {
    toast.warning(TRIAL_EXPIRED_MSG, 5000);
    throw new axios.Cancel('Trial expired read-only mode');
  }
  return config;
});

// ── RESPONSE ───────────────────────────────────────────────────────────────
// Refresh-token rotation on 401: try once, retry the original request, then
// give up and surface the 401.
api.interceptors.response.use(
  (r) => r,
  async (err: AxiosError & { config?: any }) => {
    const status = err?.response?.status;
    const url: string = (err?.config?.url || '').toString();
    const isAuthRoute = url.startsWith('/auth/');

    // 401 → try refresh ONCE. /auth/* never refreshes (avoid infinite loops).
    if (status === 401 && !isAuthRoute && err.config && !err.config._retried) {
      const refreshed = await refreshSession();
      if (refreshed) {
        err.config._retried = true;
        err.config.headers = err.config.headers || {};
        err.config.headers.Authorization = `Bearer ${refreshed.token}`;
        return api.request(err.config);
      }
      // Refresh failed → flush tokens; AuthContext.refresh() will null out user.
      await clearTokens();
    }

    // 402 trial_expired → flip the client-side read-only flag + surface the
    // upgrade message (Part F).
    if (status === 402) {
      const detail: any = (err?.response?.data as any)?.detail;
      if (detail && (detail.error === 'trial_expired' || detail.read_only)) {
        trialReadOnly = true;
        try { toast.warning(detail.message || TRIAL_EXPIRED_MSG, 5000); } catch {}
      }
    }

    // Global toast policy (unchanged from before).
    try {
      const isAuthMe = url.endsWith('/auth/me');
      if (!isAuthMe) {
        if (status === 429) {
          toast.warning('Slow down, please try again in a moment.', 5000);
        } else if (status === 503) {
          toast.error('Wayly is temporarily unavailable. Please try again in a minute.', 6000);
        } else if (status && status >= 500 && status < 600) {
          toast.error('Something went wrong on our end. Please try again.', 5000);
        }
      }
    } catch {}
    return Promise.reject(err);
  }
);

export const extractErrorMessage = (err: any, fallback = 'Something went wrong'): string => {
  const detail = err?.response?.data?.detail;
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail) && detail.length > 0) {
    // FastAPI validation errors: surface the first missing/invalid field
    // ("body.name → Field required") so users know what to fix.
    const first = detail[0];
    const field = Array.isArray(first?.loc) ? first.loc.filter((p: any) => p !== 'body').join('.') : '';
    const msg = first?.msg || '';
    if (field && msg) return `${field}: ${msg}`;
    if (msg) return msg;
  }
  if (typeof detail === 'object' && detail?.message) return String(detail.message);
  return err?.message || fallback;
};
