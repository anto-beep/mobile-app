// useExpiredTrial — mobile mirror of the web `useExpiredTrial()` hook.
//
// Contract (matches the web app):
//   • Returns `true` iff:
//       plan NOT IN ("solo","family","adviser")
//       AND subscription_status === "expired"
//   • Paid users (solo / family / adviser) are NEVER treated as read-only,
//     even if a stale `expired` flag lingers on their subscription row.
//   • Refreshes automatically because `useAuth()` re-hydrates from
//     `/api/auth/me` on app resume (see AuthContext) and after every 402
//     (see api.ts response interceptor).
import { useAuth } from '../context/AuthContext';

const PAID_PLANS = new Set(['solo', 'family', 'adviser']);

export function useExpiredTrial(): boolean {
  const { user } = useAuth();
  if (!user) return false;
  const plan = (user.plan || '').toString().toLowerCase();
  const status = (user.subscription_status || '').toString().toLowerCase();
  if (PAID_PLANS.has(plan)) return false;
  return status === 'expired';
}
