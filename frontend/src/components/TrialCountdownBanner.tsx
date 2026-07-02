// TrialCountdownBanner — shows above the main content while the account is
// in a `trialing` subscription state. Mirrors the web's TrialCountdownBanner
// behaviour: shows the day-count and the end date in AU format, plus a CTA
// straight to /settings/plan.
import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useParticipants } from '../context/ParticipantsContext';
import { Colors, Fonts, Spacing } from '../lib/theme';
import { daysUntil, formatAUWeekday } from '../lib/format';

export function TrialCountdownBanner() {
  const router = useRouter();
  const { summary } = useParticipants();
  if (!summary?.trial_ends_at) return null;
  const days = daysUntil(summary.trial_ends_at);
  if (days == null) return null;

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
});
