import axios, { AxiosInstance } from 'axios';
import { toast } from '../components/Toast';
import { getToken } from './tokenStorage';

const BASE = process.env.EXPO_PUBLIC_BACKEND_URL;

export const TOKEN_KEY = 'wayly:token';

export const api: AxiosInstance = axios.create({
  baseURL: `${BASE}/api`,
  timeout: 30_000,
});

api.interceptors.request.use(async (config) => {
  const token = await getToken(TOKEN_KEY);
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Global error toast — 429 warning, 503 error. Other 5xx surfaced as errors too.
// Per-call Alert.alert calls in screens still fire; toast is supplementary global signal.
api.interceptors.response.use(
  (r) => r,
  (err) => {
    try {
      const status = err?.response?.status;
      const url: string = err?.config?.url || '';
      // Skip noise on auth/me probes and known 404s for billing endpoints on local backend
      const isAuthMe = url.endsWith('/auth/me');
      if (!isAuthMe) {
        if (status === 429) {
          const retry = err?.response?.data?.retry_after_seconds || err?.response?.data?.retry_at;
          const msg = retry
            ? `Slow down — please try again in a moment.`
            : 'Too many requests. Please try again shortly.';
          toast.warning(msg, 5000);
        } else if (status === 503) {
          toast.error('Wayly is temporarily unavailable. Please try again in a minute.', 6000);
        } else if (status >= 500 && status < 600) {
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
  return err?.message || fallback;
};
