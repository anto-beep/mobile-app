// useFetch — small re-usable hook that re-runs on participantSig change so
// every Phase C/D screen refreshes when the user switches participants.
import { useCallback, useEffect, useState } from 'react';
import { useParticipants } from '../context/ParticipantsContext';
import { api } from './api';

export function useApi<T = any>(url: string, deps: ReadonlyArray<unknown> = []) {
  const { participantSig, active } = useParticipants();
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true); else setLoading(true);
    setError(null);
    try {
      const { data } = await api.get<T>(url);
      setData(data);
    } catch (e: any) {
      setError(e?.response?.data?.detail || e?.message || 'Failed to load');
    } finally {
      setLoading(false); setRefreshing(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, participantSig, active?.id, ...deps]);

  useEffect(() => { void load(false); }, [load]);

  return { data, loading, refreshing, error, refresh: () => load(true) };
}
