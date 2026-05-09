import axios, { AxiosInstance } from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';

const BASE = process.env.EXPO_PUBLIC_BACKEND_URL;

export const TOKEN_KEY = 'wayly:token';

export const api: AxiosInstance = axios.create({
  baseURL: `${BASE}/api`,
  timeout: 30_000,
});

api.interceptors.request.use(async (config) => {
  const token = await AsyncStorage.getItem(TOKEN_KEY);
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

export const extractErrorMessage = (err: any, fallback = 'Something went wrong'): string => {
  const detail = err?.response?.data?.detail;
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail) && detail[0]?.msg) return detail[0].msg;
  return err?.message || fallback;
};
