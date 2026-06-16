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

type AuthState = {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<User>;
  signup: (email: string, password: string, name: string) => Promise<User>;
  loginWithGoogle: () => Promise<User>;
  finishGoogleSession: (sessionId: string) => Promise<User>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

// Reconcile the user record with the live Stripe subscription so that the
// rest of the app (paywalls, header badge, trial CTAs) sees the SAME effective
// plan everywhere — production data can drift if a Stripe webhook missed, and
// `users.plan` will say "free" while `/billing/subscription` says "family".
// Always trust the subscription when it's active or trialing.
async function reconcileUserWithSubscription(u: User): Promise<User> {
  try {
    const { data } = await api.get('/billing/subscription');
    if (!data) return u;
    const subPlan: string = String(data.plan || '').toLowerCase();
    const status: string | null = data.status || null;
    const subActive = status === 'active' || status === 'trialing';
    return {
      ...u,
      // When the subscription is active/trialing, its plan is the source of truth.
      plan: subActive && subPlan && subPlan !== 'free' ? subPlan : u.plan,
      subscription_status: status ?? u.subscription_status ?? null,
      trial_ends_at: data.trial_ends_at ?? u.trial_ends_at ?? null,
      // If the user is currently in a trial OR has ever been in one, mark as used.
      trial_used: u.trial_used || status === 'trialing' || !!data.trial_ends_at,
    };
  } catch {
    return u;
  }
}

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    try {
      const { data } = await api.get<User>('/auth/me');
      const merged = await reconcileUserWithSubscription(data);
      setUser(merged);
    } catch {
      setUser(null);
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

  const persistAndSet = async (token: string, refresh: string | undefined, u: User) => {
    await persistTokens(token, refresh);
    const merged = await reconcileUserWithSubscription(u);
    setUser(merged);
  };

  const login = async (email: string, password: string) => {
    try {
      // Phase A: prefer /v2 (returns refresh_token). Falls back to legacy /login if /v2 is unavailable.
      const { data } = await api.post('/auth/login/v2', { email, password });
      await persistAndSet(data.token, data.refresh_token, data.user);
      return data.user as User;
    } catch (err) {
      // Fallback to legacy /login (no refresh token) so older backends still work.
      const status = (err as any)?.response?.status;
      if (status === 404 || status === 405) {
        const { data } = await api.post('/auth/login', { email, password });
        await persistAndSet(data.token, undefined, data.user);
        return data.user as User;
      }
      throw new Error(extractErrorMessage(err, 'Could not sign in'));
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
    <AuthContext.Provider value={{ user, loading, login, signup, loginWithGoogle, finishGoogleSession, logout, refresh }}>
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
