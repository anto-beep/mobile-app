import React, { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { api, TOKEN_KEY, extractErrorMessage } from '../lib/api';
import { getAccessToken, persistTokens, clearTokens } from '../lib/tokens';
import { clearAllUserData } from '../lib/secureStorage';
import { unregisterPushNotifications } from '../lib/push';

export type User = {
  id: string;
  email: string;
  name: string;
  role: 'caregiver' | 'participant';
  plan: string;
  household_id?: string | null;
  account_id?: string | null;
  created_at: string;
  is_admin?: boolean;
  subscription_status?: string | null;
  trial_ends_at?: string | null;
  trial_used?: boolean;
};

export type Subscription = {
  plan: string;          // 'FREE' | 'SOLO' | 'FAMILY' (server returns upper)
  status: string | null; // 'active' | 'trialing' | null
  trial_ends_at?: string | null;
  current_period_end?: string | null;
  cancel_at_period_end?: boolean;
  stub_mode?: boolean;
};

export type VerificationState = {
  email: string;
  email_verified: boolean;
  email_verified_at?: string | null;
  verification_deadline?: string | null;
  days_remaining: number;
  past_deadline: boolean;
  grace_days?: number;
};

// Thrown by login() when the backend returns 403 with code "email_verification_required".
// Caught by the login screen so it can route to the full-screen interstitial.
export class EmailVerificationRequiredError extends Error {
  email: string;
  constructor(email: string, message?: string) {
    super(message || 'Please verify your email before signing in.');
    this.name = 'EmailVerificationRequiredError';
    this.email = email;
  }
}

type AuthState = {
  user: User | null;
  subscription: Subscription | null;
  verification: VerificationState | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<User>;
  signup: (email: string, password: string, name: string) => Promise<User>;
  loginWithGoogle: () => Promise<User>;
  finishGoogleSession: (sessionId: string) => Promise<User>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  refreshVerification: () => Promise<VerificationState | null>;
};

const AuthContext = createContext<AuthState | null>(null);

// Fetch the Stripe subscription. Single source of truth for the active plan.
async function fetchSubscription(): Promise<Subscription | null> {
  try {
    const { data } = await api.get('/billing/subscription');
    if (!data) return null;
    return {
      plan: String(data.plan || 'FREE').toUpperCase(),
      status: data.status || null,
      trial_ends_at: data.trial_ends_at ?? null,
      current_period_end: data.current_period_end ?? null,
      cancel_at_period_end: !!data.cancel_at_period_end,
      stub_mode: !!data.stub_mode,
    };
  } catch (err) {
    if (typeof console !== 'undefined') {
      // eslint-disable-next-line no-console
      console.warn('[auth] subscription fetch failed; falling back to user.plan', err);
    }
    return null;
  }
}

// Reconcile the user record with the live Stripe subscription so that the
// rest of the app (paywalls, header badge, trial CTAs) sees the SAME effective
// plan everywhere — production data can drift if a Stripe webhook missed and
// `users.plan` will say "free" while `/billing/subscription` says "family".
function mergeUserWithSub(u: User, sub: Subscription | null): User {
  if (!sub) return u;
  const subPlan = sub.plan.toLowerCase();
  const subActive = sub.status === 'active' || sub.status === 'trialing';
  return {
    ...u,
    plan: subActive && subPlan && subPlan !== 'free' ? subPlan : u.plan,
    subscription_status: sub.status ?? u.subscription_status ?? null,
    trial_ends_at: sub.trial_ends_at ?? u.trial_ends_at ?? null,
    trial_used: u.trial_used || sub.status === 'trialing' || !!sub.trial_ends_at,
  };
}

// Fetch the email-verification status for the currently-authenticated user.
// Returns null when no token is present or the call fails (treat as "unknown").
async function fetchVerification(): Promise<VerificationState | null> {
  try {
    const { data } = await api.get('/auth/verification-status');
    if (!data || !data.email) return null;
    return {
      email: String(data.email),
      email_verified: !!data.email_verified,
      email_verified_at: data.email_verified_at ?? null,
      verification_deadline: data.verification_deadline ?? null,
      days_remaining: typeof data.days_remaining === 'number' ? data.days_remaining : 0,
      past_deadline: !!data.past_deadline,
      grace_days: typeof data.grace_days === 'number' ? data.grace_days : undefined,
    };
  } catch {
    return null;
  }
}

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [verification, setVerification] = useState<VerificationState | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshVerification = async () => {
    const v = await fetchVerification();
    setVerification(v);
    return v;
  };

  const refresh = async () => {
    try {
      const { data } = await api.get<User>('/auth/me');
      const [sub, ver] = await Promise.all([fetchSubscription(), fetchVerification()]);
      setSubscription(sub);
      setVerification(ver);
      setUser(mergeUserWithSub(data, sub));
    } catch {
      setUser(null);
      setSubscription(null);
      setVerification(null);
    }
  };

  useEffect(() => {
    (async () => {
      const token = await getAccessToken();
      if (token) {
        await refresh();
      }
      setLoading(false);
    })();
  }, []);

  const persistAndSet = async (token: string, refreshToken: string | undefined, u: User) => {
    await persistTokens(token, refreshToken);
    const [sub, ver] = await Promise.all([fetchSubscription(), fetchVerification()]);
    setSubscription(sub);
    setVerification(ver);
    setUser(mergeUserWithSub(u, sub));
  };

  const login = async (email: string, password: string) => {
    // Detect the 403 verification-required signal BEFORE the generic friendly
    // error path swallows it — we need the email so the interstitial can
    // pre-fill the resend form.
    const handleLoginError = (err: unknown): never => {
      const ax = err as any;
      const status: number | undefined = ax?.response?.status;
      const detail = ax?.response?.data?.detail;
      if (status === 403 && detail && typeof detail === 'object' && detail.code === 'email_verification_required') {
        throw new EmailVerificationRequiredError(String(detail.email || email), String(detail.message || ''));
      }
      throw new Error(extractErrorMessage(err, 'Could not sign in'));
    };

    try {
      // Phase A: prefer /v2 (returns refresh_token). Falls back to legacy /login if /v2 is unavailable.
      const { data } = await api.post('/auth/login/v2', { email, password });
      await persistAndSet(data.token, data.refresh_token, data.user);
      return data.user as User;
    } catch (err) {
      const status = (err as any)?.response?.status;
      if (status === 404 || status === 405) {
        try {
          const { data } = await api.post('/auth/login', { email, password });
          await persistAndSet(data.token, undefined, data.user);
          return data.user as User;
        } catch (err2) {
          return handleLoginError(err2);
        }
      }
      return handleLoginError(err);
    }
  };

  const signup = async (email: string, password: string, name: string) => {
    try {
      const { data } = await api.post('/auth/signup', { email, password, name, role: 'caregiver' });
      await persistAndSet(data.token, data.refresh_token, data.user);
      return data.user as User;
    } catch (err) {
      throw new Error(extractErrorMessage(err, 'Could not create your account'));
    }
  };

  const logout = async () => {
    try { await unregisterPushNotifications(); } catch {}
    try { await api.post('/auth/logout', {}); } catch {}
    try { await clearAllUserData(); }
    catch { await clearTokens(); }
    setUser(null);
    setSubscription(null);
    setVerification(null);
  };

  const loginWithGoogle = async () => {
    const { startGoogleAuth } = await import('../lib/google');
    const { token, user: u } = await startGoogleAuth();
    await persistAndSet(token, undefined, u);
    return u as User;
  };

  const finishGoogleSession = async (sessionId: string) => {
    const { data } = await api.post('/auth/google-session', { session_id: sessionId });
    await persistAndSet(data.token, data.refresh_token, data.user);
    return data.user as User;
  };

  return (
    <AuthContext.Provider value={{ user, subscription, verification, loading, login, signup, loginWithGoogle, finishGoogleSession, logout, refresh, refreshVerification }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = (): AuthState => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
};

// Re-export TOKEN_KEY for back-compat callers.
export { TOKEN_KEY };
