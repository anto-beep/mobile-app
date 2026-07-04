// TrialCountdownBanner — top-of-screen banner shown to users on a free trial.
//
// Two variants:
//   • Active trial   → beige/tan bar counting down remaining days.
//   • Expired trial  → clay-red bar with white text prompting the user to pick a plan.
//
// Matches the web banner styling (clay #A5512B fill + white text) for the
// expired state so the mobile experience feels the same as the web.
import React from 'react';
import { StyleSheet, Text, TouchableOpacity } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useParticipants } from '../context/ParticipantsContext';
import { useAuth, isTrialExpired } from '../context/AuthContext';
import { Colors, Fonts, Spacing } from '../lib/theme';
import { daysUntil, formatAUWeekday } from '../lib/format';

export function TrialCountdownBanner() {
  const router = useRouter();
  const { summary } = useParticipants();
  const { user } = useAuth();
  const expired = isTrialExpired(user);

  // Expired trial → clay banner with white text (matches web).
  if (expired) {
    return (
      <TouchableOpacity
        testID="trial-expired-banner"
        onPress={() => router.push('/settings/plan' as any)}
        activeOpacity={0.85}
        style={styles.expiredBar}
        accessibilityRole="link"
        accessibilityLabel="Your trial has ended. Tap to choose a plan."
      >
        <Ionicons name="alert-circle" size={16} color={Colors.textInverse} />
        <Text style={styles.expiredLabel}>
          <Text style={styles.expiredBold}>Your trial has ended.</Text> Subscribe to add or change anything.
        </Text>
        <Text style={styles.expiredCta}>Choose Plan</Text>
      </TouchableOpacity>
    );
  }

  // Active trial → beige countdown bar.
  if (!summary?.trial_ends_at) return null;
  const days = daysUntil(summary.trial_ends_at);
  if (days == null || days < 0) return null;

  return (
    <TouchableOpacity
      testID="billing-trial-remaining"
      onPress={() => router.push('/settings/plan' as any)}
      activeOpacity={0.85}
      style={styles.bar}
      accessibilityRole="link"
      accessibilityLabel={`Free trial, ${days} day(s) left, ends ${formatAUWeekday(summary.trial_ends_at)}`}
    >
      <Ionicons name="ribbon" size={16} color="#5C3D11" />
      <Text style={styles.label}>
        Free trial · <Text style={styles.bold}>{days} day{days === 1 ? '' : 's'} left</Text> · ends {formatAUWeekday(summary.trial_ends_at)}
      </Text>
      <Text style={styles.cta}>Manage</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  // Active-trial (tan)
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: Spacing.md,
    paddingVertical: 10,
    backgroundColor: '#FAEFD4',
    borderBottomWidth: 1,
    borderBottomColor: '#E8D9B3',
  },
  label: { flex: 1, color: '#5C3D11', fontFamily: Fonts.body, fontSize: 13 },
  bold: { fontFamily: Fonts.bodySemi, fontWeight: '700' },
  cta: { color: '#5C3D11', fontFamily: Fonts.bodySemi, fontSize: 13, fontWeight: '700', textDecorationLine: 'underline' },

  // Expired-trial (clay + white)
  expiredBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: Spacing.md,
    paddingVertical: 11,
    backgroundColor: Colors.brandSecondary, // clay 500 (#A5512B)
    borderBottomWidth: 1,
    borderBottomColor: '#7E3F22',           // clay pressed
  },
  expiredLabel: {
    flex: 1,
    color: Colors.textInverse,
    fontFamily: Fonts.body,
    fontSize: 13,
    lineHeight: 18,
  },
  expiredBold: { fontFamily: Fonts.bodySemi, fontWeight: '700' },
  expiredCta: {
    color: Colors.textInverse,
    fontFamily: Fonts.bodySemi,
    fontSize: 13,
    fontWeight: '700',
    textDecorationLine: 'underline',
  },
});
