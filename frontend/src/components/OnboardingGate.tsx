// OnboardingGate — sits inside the auth tree, between AuthProvider and the
// router. If the signed-in user has no `account_id`/`household_id` and zero
// participants, we route them to /onboarding so the first-run wizard runs
// before they hit Dashboard.
//
// We don't redirect away from auth screens or from /onboarding itself.
import React, { useEffect } from 'react';
import { useRouter, useSegments } from 'expo-router';
import { useAuth } from '../context/AuthContext';
import { useParticipants } from '../context/ParticipantsContext';

const AUTH_SEGMENTS = new Set(['login', 'signup', 'reset-password', 'forgot', 'onboarding', 'admin-auth']);

export function OnboardingGate() {
  const router = useRouter();
  const segments = useSegments();
  const { user, loading: authLoading } = useAuth();
  const { loading: pLoading, participants } = useParticipants();

  useEffect(() => {
    if (authLoading || pLoading) return;
    if (!user) return;
    // Don't redirect off auth/onboarding screens.
    const top = (segments[0] || '').toString();
    if (AUTH_SEGMENTS.has(top) || top.startsWith('(auth)')) return;

    const hasAccount = !!(user.account_id || user.household_id);
    const hasParticipants = participants.length > 0;
    if (!hasAccount && !hasParticipants) {
      router.replace('/onboarding' as any);
    }
  }, [authLoading, pLoading, user, participants.length, segments, router]);

  return null;
}
