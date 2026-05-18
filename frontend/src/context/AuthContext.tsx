import React, { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { api, TOKEN_KEY, extractErrorMessage } from '../lib/api';

export type User = {
  id: string;
  email: string;
  name: string;
  role: 'caregiver' | 'participant';
  plan: string;
  household_id?: string | null;
  created_at: string;
  is_admin?: boolean;
  subscription_status?: string | null;
  trial_ends_at?: string | null;
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

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    try {
      const { data } = await api.get<User>('/auth/me');
      setUser(data);
    } catch {
      setUser(null);
    }
  };

  useEffect(() => {
    (async () => {
      const token = await AsyncStorage.getItem(TOKEN_KEY);
      if (token) {
        await refresh();
      }
      setLoading(false);
    })();
  }, []);

  const persistAndSet = async (token: string, u: User) => {
    await AsyncStorage.setItem(TOKEN_KEY, token);
    setUser(u);
  };

  const login = async (email: string, password: string) => {
    try {
      const { data } = await api.post('/auth/login', { email, password });
      await persistAndSet(data.token, data.user);
      return data.user as User;
    } catch (err) {
      throw new Error(extractErrorMessage(err, 'Could not sign in'));
    }
  };

  const signup = async (email: string, password: string, name: string) => {
    try {
      const { data } = await api.post('/auth/signup', { email, password, name, role: 'caregiver' });
      await persistAndSet(data.token, data.user);
      return data.user as User;
    } catch (err) {
      throw new Error(extractErrorMessage(err, 'Could not create your account'));
    }
  };

  const logout = async () => {
    // Best-effort backend logout (clears push devices, audit log). Don't block the user.
    try {
      await api.post('/auth/logout', {});
    } catch {
      // ignore — token may already be invalid
    }
    await AsyncStorage.removeItem(TOKEN_KEY);
    setUser(null);
  };

  const loginWithGoogle = async () => {
    const { startGoogleAuth } = await import('../lib/google');
    const { token, user: u } = await startGoogleAuth();
    await persistAndSet(token, u);
    return u as User;
  };

  const finishGoogleSession = async (sessionId: string) => {
    const { data } = await api.post('/auth/google-session', { session_id: sessionId });
    await persistAndSet(data.token, data.user);
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
