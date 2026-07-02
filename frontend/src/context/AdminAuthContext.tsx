// Admin auth context — isolated from regular user auth. Uses expo-secure-store for token storage.
// Supports: email/password login, TOTP verification, first-time TOTP setup, backup codes, 30-min idle auto-logout.
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { AppState, AppStateStatus, Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';
import axios from 'axios';
import { toast } from '../components/Toast';

const BASE = process.env.EXPO_PUBLIC_BACKEND_URL;
const ADMIN_TOKEN_KEY = 'wayly:admin:token';
const ADMIN_LAST_ACTIVITY_KEY = 'wayly:admin:lastActivity';
const IDLE_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

export type AdminRole = 'super_admin' | 'operations_admin' | 'support_admin' | 'content_admin';

export type AdminUser = {
  id: string;
  email: string;
  name: string;
  admin_role: AdminRole;
  totp_enabled: boolean;
};

export type LoginResult =
  | { kind: '2fa'; temp_token: string; role: AdminRole }
  | { kind: 'setup'; setup_token: string; qr_data_uri: string; secret: string; role: AdminRole };

type Ctx = {
  admin: AdminUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<LoginResult>;
  verify2FA: (tempToken: string, code: string) => Promise<AdminUser>;
  enable2FA: (setupToken: string, code: string) => Promise<{ admin: AdminUser; backupCodes: string[] }>;
  logout: () => Promise<void>;
  touch: () => void; // call on any user activity to reset idle timer
};

const AdminAuthContext = createContext<Ctx | null>(null);

// Cross-platform secure storage helper. SecureStore on native (Keychain/Keystore); fallback to AsyncStorage on web.
const safeStorage = {
  async get(key: string): Promise<string | null> {
    if (Platform.OS === 'web') return AsyncStorage.getItem(key);
    try { return await SecureStore.getItemAsync(key); } catch { return null; }
  },
  async set(key: string, value: string): Promise<void> {
    if (Platform.OS === 'web') return AsyncStorage.setItem(key, value);
    try { await SecureStore.setItemAsync(key, value); } catch {}
  },
  async del(key: string): Promise<void> {
    if (Platform.OS === 'web') return AsyncStorage.removeItem(key);
    try { await SecureStore.deleteItemAsync(key); } catch {}
  },
};

// Standalone admin axios instance — separate from the consumer api client.
const adminApi = axios.create({ baseURL: `${BASE}/api`, timeout: 30_000 });

adminApi.interceptors.request.use(async (config) => {
  const token = await safeStorage.get(ADMIN_TOKEN_KEY);
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// Surface server-side messages from admin auth errors
export const extractAdminError = (err: any, fallback = "That did not work"): string => {
  const detail = err?.response?.data?.detail;
  if (typeof detail === 'string') return detail;
  return err?.message || fallback;
};

export const AdminAuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [admin, setAdmin] = useState<AdminUser | null>(null);
  const [loading, setLoading] = useState(true);
  const idleTimer = useRef<any>(null);
  const lastActivity = useRef<number>(Date.now());

  const logout = useCallback(async () => {
    try { await adminApi.post('/admin/auth/logout'); } catch {}
    await safeStorage.del(ADMIN_TOKEN_KEY);
    await AsyncStorage.removeItem(ADMIN_LAST_ACTIVITY_KEY);
    setAdmin(null);
    if (idleTimer.current) { clearInterval(idleTimer.current); idleTimer.current = null; }
  }, []);

  const touch = useCallback(() => {
    lastActivity.current = Date.now();
    AsyncStorage.setItem(ADMIN_LAST_ACTIVITY_KEY, String(lastActivity.current)).catch(() => {});
  }, []);

  // Idle watchdog: when active, poll every 60s; if last activity > 30 min, force logout with a toast.
  useEffect(() => {
    if (!admin) return;
    touch();
    idleTimer.current = setInterval(async () => {
      const stored = await AsyncStorage.getItem(ADMIN_LAST_ACTIVITY_KEY);
      const last = stored ? Number(stored) : lastActivity.current;
      if (Date.now() - last > IDLE_TIMEOUT_MS) {
        toast.warning('Signed out after 30 minutes of inactivity.', 5000);
        await logout();
      }
    }, 60_000);
    return () => { if (idleTimer.current) clearInterval(idleTimer.current); };
  }, [admin, logout, touch]);

  // Refresh activity timer when app comes to foreground; also re-check whether we should still be signed in.
  useEffect(() => {
    const sub = AppState.addEventListener('change', async (state: AppStateStatus) => {
      if (state === 'active' && admin) {
        const stored = await AsyncStorage.getItem(ADMIN_LAST_ACTIVITY_KEY);
        const last = stored ? Number(stored) : lastActivity.current;
        if (Date.now() - last > IDLE_TIMEOUT_MS) {
          toast.warning('Signed out after 30 minutes of inactivity.', 5000);
          await logout();
        } else {
          touch();
        }
      }
    });
    return () => sub.remove();
  }, [admin, logout, touch]);

  // Hydrate admin from secure storage on mount.
  useEffect(() => {
    (async () => {
      const token = await safeStorage.get(ADMIN_TOKEN_KEY);
      if (token) {
        try {
          const { data } = await adminApi.get<AdminUser>('/admin/auth/me');
          setAdmin(data);
        } catch {
          await safeStorage.del(ADMIN_TOKEN_KEY);
        }
      }
      setLoading(false);
    })();
  }, []);

  const login = useCallback(async (email: string, password: string): Promise<LoginResult> => {
    try {
      const { data } = await adminApi.post('/admin/auth/login', { email: email.trim(), password });
      if (data.requires_2fa) {
        return { kind: '2fa', temp_token: data.temp_token, role: data.role };
      }
      if (data.requires_2fa_setup) {
        return {
          kind: 'setup',
          setup_token: data.setup_token,
          qr_data_uri: data.qr_data_uri,
          secret: data.secret,
          role: data.role,
        };
      }
      throw new Error('Unexpected login response');
    } catch (err) {
      throw new Error(extractAdminError(err, 'Could not sign in'));
    }
  }, []);

  const verify2FA = useCallback(async (tempToken: string, code: string): Promise<AdminUser> => {
    try {
      const { data } = await adminApi.post('/admin/auth/2fa/verify', { temp_token: tempToken, code });
      await safeStorage.set(ADMIN_TOKEN_KEY, data.token);
      setAdmin(data.admin);
      return data.admin;
    } catch (err) {
      throw new Error(extractAdminError(err, 'Code didn\u2019t match'));
    }
  }, []);

  const enable2FA = useCallback(async (setupToken: string, code: string): Promise<{ admin: AdminUser; backupCodes: string[] }> => {
    try {
      const { data } = await adminApi.post('/admin/auth/2fa/enable', { setup_token: setupToken, code });
      await safeStorage.set(ADMIN_TOKEN_KEY, data.token);
      setAdmin(data.admin);
      return { admin: data.admin, backupCodes: data.backup_codes };
    } catch (err) {
      throw new Error(extractAdminError(err, 'Code didn\u2019t match'));
    }
  }, []);

  return (
    <AdminAuthContext.Provider value={{ admin, loading, login, verify2FA, enable2FA, logout, touch }}>
      {children}
    </AdminAuthContext.Provider>
  );
};

export const useAdminAuth = (): Ctx => {
  const ctx = useContext(AdminAuthContext);
  if (!ctx) throw new Error('useAdminAuth must be used inside AdminAuthProvider');
  return ctx;
};

export { adminApi };
