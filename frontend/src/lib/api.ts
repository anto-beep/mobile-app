import axios, { AxiosInstance, AxiosError } from 'axios';
import { toast } from '../components/Toast';
import { getAccessToken, refreshSession, clearTokens } from './tokens';
import { getActiveParticipantId, isImpersonating } from './activeParticipant';

const BASE = process.env.EXPO_PUBLIC_BACKEND_URL;

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
    toast.warning('Read-only mode — write actions are disabled while impersonating.', 4500);
    const ce = new axios.Cancel('Impersonation read-only mode');
    throw ce;
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

    // Global toast policy (unchanged from before).
    try {
      const isAuthMe = url.endsWith('/auth/me');
      if (!isAuthMe) {
        if (status === 429) {
          toast.warning('Slow down — please try again in a moment.', 5000);
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
  if (Array.isArray(detail) && detail[0]?.msg) return detail[0].msg;
  if (typeof detail === 'object' && detail?.message) return String(detail.message);
  return err?.message || fallback;
};
