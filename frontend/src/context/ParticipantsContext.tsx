// ParticipantsContext — Phase A spine of the app.
// ----------------------------------------------------------------
// Mirrors `frontend/src/context/ParticipantsContext.jsx` on the web.
//
// Responsibilities:
//   1. Hydrate `/api/account` on first authenticated load.
//   2. Compute the active participant from a persisted `wayly_active_participant_id`,
//      falling back to `is_primary === true`, then `participants[0]`.
//   3. Provide `setActive(id)` that:
//        - persists the new id,
//        - bumps `participantSig` (a monotonic counter every page can read so
//          they refetch when it changes — our equivalent of the web's
//          `wayly:participant-changed` event + `key={activeParticipant.id}`
//          remount trick),
//        - returns the new participant object.
//   4. Expose `refetch()` for after CRUD ops (create/edit/delete participants).
//   5. Cooperate with `api.ts`: that file imports `getActiveParticipantId()` to
//      inject `X-Participant-Id` on every request. We register a tiny global
//      getter via `setActiveParticipantGetter` so api.ts stays decoupled from
//      React.
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { api } from '../lib/api';
import { setActiveParticipantGetter } from '../lib/activeParticipant';
import { useAuth } from './AuthContext';

export type Participant = {
  id: string;
  account_id: string;
  household_id: string | null;
  first_name: string;
  last_name: string;
  date_of_birth: string | null;
  classification: number;
  provider_name: string;
  provider_id: string | null;
  household_email: string;
  is_primary: boolean;
  status: 'ACTIVE' | 'PENDING_REMOVAL' | 'REMOVED';
  color_index: number;
  created_at: string;
  updated_at: string;
  removal_scheduled_at?: string | null;
};

export type AccountSummary = {
  account_id: string;
  base_plan: 'FREE' | 'SOLO' | 'FAMILY';
  base_plan_status: string;
  trial_ends_at: string | null;
  base_price_monthly: number;
  addon_price_monthly: number;
  addon_count: number;
  addon_monthly_total: number;
  monthly_total: number;
  participants_included: number;
  participants_active: number;
  participants_max: number;
  seat_limit: number;
  seats_used: number;
  pending_downgrade_to: string | null;
  pending_downgrade_at: string | null;
};

export type Addon = {
  id?: string;
  participant_id: string;
  status: 'ACTIVE' | 'PAUSED' | 'CANCELED';
  price_monthly: number;
};

type Ctx = {
  loading: boolean;
  participants: Participant[];
  summary: AccountSummary | null;
  addons: Addon[];
  active: Participant | null;
  /** Monotonically increases on every participant switch — screens use it as a refetch dep. */
  participantSig: number;
  setActive: (id: string) => Promise<Participant | null>;
  refetch: () => Promise<void>;
};

const PARTICIPANTS = createContext<Ctx | null>(null);
const LS_KEY = 'wayly_active_participant_id';

export function ParticipantsProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [summary, setSummary] = useState<AccountSummary | null>(null);
  const [addons, setAddons] = useState<Addon[]>([]);
  const [activeId, setActiveIdState] = useState<string | null>(null);
  const [participantSig, setSig] = useState(0);

  const fetchAccount = useCallback(async (): Promise<void> => {
    if (!user) {
      setParticipants([]); setSummary(null); setAddons([]); setActiveIdState(null);
      setLoading(false);
      return;
    }
    try {
      const { data } = await api.get('/account');

      // Schema-tolerant unpacking. We've seen the response shape vary
      // between our sandbox builds and the prod web app:
      //   - sandbox  : { summary, participants, addons }
      //   - alt v1   : { account: {...}, participants: [...] }
      //   - flat     : { participants: [...] }  (no summary; web computes it)
      const rawParts = (data?.participants ?? data?.account?.participants ?? []) as any[];
      const parts: Participant[] = (rawParts || [])
        .filter((p: any) => (p?.status || 'ACTIVE') !== 'REMOVED')
        // Normalise: fold the alternative `flag_keys` shape into `flags` so
        // the MeansNotDisclosedChip selector always reads from the same key.
        .map((p: any) => ({
          ...p,
          flags: Array.isArray(p?.flags)
            ? p.flags
            : (Array.isArray(p?.flag_keys) ? p.flag_keys : []),
        }));
      setParticipants(parts);

      // Synthesise summary if the prod payload doesn't carry one. We mirror
      // the sandbox shape so every downstream consumer (Billing tile-card,
      // ParticipantSwitcher cap-check) keeps working.
      const fromServer = data?.summary || data?.account?.summary;
      if (fromServer) {
        setSummary(fromServer);
      } else if (parts.length > 0) {
        const plan = (user?.plan || 'free').toUpperCase() as AccountSummary['base_plan'];
        const max = plan === 'FAMILY' ? 10 : 1;
        const included = plan === 'FAMILY' ? 2 : 1;
        const addonCount = Math.max(0, parts.length - included);
        setSummary({
          account_id: data?.account?.id || user?.account_id || user?.household_id || 'derived',
          base_plan: plan,
          base_plan_status: user?.subscription_status || 'derived',
          trial_ends_at: user?.trial_ends_at || null,
          base_price_monthly: plan === 'FAMILY' ? 39 : plan === 'SOLO' ? 19 : 0,
          addon_price_monthly: 19,
          addon_count: addonCount,
          addon_monthly_total: addonCount * 19,
          monthly_total: (plan === 'FAMILY' ? 39 : plan === 'SOLO' ? 19 : 0) + addonCount * 19,
          participants_included: included,
          participants_active: parts.length,
          participants_max: max,
          seat_limit: max,
          seats_used: parts.length,
          pending_downgrade_to: null,
          pending_downgrade_at: null,
        });
      } else {
        setSummary(null);
      }

      setAddons((data?.addons ?? data?.account?.addons ?? []) as Addon[]);
      // Resolve active.
      const saved = await AsyncStorage.getItem(LS_KEY).catch(() => null);
      const fromSaved = saved && parts.find((p) => p.id === saved);
      const primary = parts.find((p) => p.is_primary);
      const next = fromSaved || primary || parts[0] || null;
      if (next) {
        setActiveIdState(next.id);
        await AsyncStorage.setItem(LS_KEY, next.id).catch(() => {});
      } else {
        setActiveIdState(null);
      }
    } catch {
      // 401s flow through to api.ts which will trigger logout if refresh fails.
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => { void fetchAccount(); }, [fetchAccount]);

  // Wire the global getter so axios interceptor can inject X-Participant-Id.
  useEffect(() => {
    setActiveParticipantGetter(() => activeId);
    return () => setActiveParticipantGetter(() => null);
  }, [activeId]);

  const setActive = useCallback(async (id: string): Promise<Participant | null> => {
    const p = participants.find((x) => x.id === id);
    if (!p) return null;
    setActiveIdState(id);
    await AsyncStorage.setItem(LS_KEY, id).catch(() => {});
    setSig((n) => n + 1);
    return p;
  }, [participants]);

  const active = useMemo(() => participants.find((p) => p.id === activeId) || null, [participants, activeId]);

  const value: Ctx = useMemo(() => ({
    loading, participants, summary, addons, active, participantSig,
    setActive, refetch: fetchAccount,
  }), [loading, participants, summary, addons, active, participantSig, setActive, fetchAccount]);

  return <PARTICIPANTS.Provider value={value}>{children}</PARTICIPANTS.Provider>;
}

export function useParticipants(): Ctx {
  const ctx = useContext(PARTICIPANTS);
  if (!ctx) throw new Error('useParticipants must be used inside ParticipantsProvider');
  return ctx;
}
