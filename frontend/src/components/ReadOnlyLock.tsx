// ReadOnlyLock — replacement composer shown to expired-trial users on any
// screen that would otherwise present an editor / add form / send button.
//
// Mirrors the web `<ReadOnlyLock />` component: lock icon, subscribe copy,
// clay-500 pill CTA that routes to /settings/plan. Screens use this by
// wrapping their composer with `useExpiredTrial()` and swapping in this
// component when the hook returns `true`.
import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Fonts } from '../lib/theme';
import type { ColorPalette } from '../lib/theme';
import { useColors } from '../hooks/useColors';
import { useThemedStyles } from '../hooks/useThemedStyles';

type Props = {
  /** Optional short label describing the action being blocked. Defaults to
   *  "add or change anything" to match the web app. */
  action?: string;
  /** Optional test id (defaults to `read-only-lock`). */
  testID?: string;
};

export function ReadOnlyLock({ action, testID = 'read-only-lock' }: Props) {
  const c = useColors();
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const verb = action || 'add or change anything';
  return (
    <View style={styles.card} testID={testID}>
      <View style={styles.iconWrap}>
        <Ionicons name="lock-closed" size={22} color={c.brandSecondary} />
      </View>
      <Text style={styles.title}>Subscribe to {verb}</Text>
      <Text style={styles.body}>
        Your trial has ended. You can still view everything you have already saved.
      </Text>
      <TouchableOpacity
        style={styles.cta}
        onPress={() => router.push('/settings/plan' as any)}
        activeOpacity={0.85}
        testID="read-only-lock-cta"
        accessibilityRole="link"
        accessibilityLabel="Subscribe, opens plans"
      >
        <Text style={styles.ctaText}>Subscribe</Text>
      </TouchableOpacity>
    </View>
  );
}

function makeStyles(c: ColorPalette) { return StyleSheet.create({
  card: {
    padding: 24,
    borderRadius: 16,
    backgroundColor: c.cardBg,
    borderWidth: 1,
    borderColor: c.borderSubtle,
    alignItems: 'center',
    gap: 10,
    marginVertical: 12,
  },
  iconWrap: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: 'rgba(165, 81, 43, 0.10)',
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 4,
  },
  title: {
    fontFamily: Fonts.heading, fontSize: 20, color: c.brandPrimary,
    textAlign: 'center', letterSpacing: -0.2,
  },
  body: {
    fontFamily: Fonts.body, fontSize: 13.5, color: c.textSecondary,
    textAlign: 'center', lineHeight: 20, paddingHorizontal: 8, marginBottom: 4,
  },
  cta: {
    backgroundColor: c.brandSecondary,
    paddingHorizontal: 24, paddingVertical: 11, borderRadius: 9999,
    marginTop: 4,
  },
  ctaText: {
    color: c.textInverse, fontFamily: Fonts.bodySemi, fontSize: 14, letterSpacing: 0.3,
  },
}); }
