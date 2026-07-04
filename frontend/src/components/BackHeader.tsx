// BackHeader — Phase 2 of the global header refactor.
//
// User-requested model: every screen shows the WaylyHeader (brand banner with
// logo · participant · plan · notifications). Sub-screens additionally render
// a small inline "← Back" chip with the page title underneath the banner.
//
// This keeps the Wayly brand identity visible everywhere and gives sub-screens
// a clear "step back" affordance without taking up an entire teal slab.
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Fonts, Spacing } from '../lib/theme';
import type { ColorPalette } from '../lib/theme';
import { useThemedStyles } from '../hooks/useThemedStyles';
import { WaylyHeader } from './WaylyHeader';

type Props = {
  title: string;
  label?: string;
  onBack?: () => void;
  /** Optional right-side accessory (e.g. an action button). */
  rightAccessory?: React.ReactNode;
  /** Hide the persistent WaylyHeader (used by very rare hero screens). */
  hideBrand?: boolean;
};

export default function BackHeader({ title, label = 'Back', onBack, rightAccessory, hideBrand }: Props) {
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const goBack = () => {
    if (onBack) return onBack();
    if (router.canGoBack && router.canGoBack()) return router.back();
    router.replace('/(tabs)/today' as any);
  };

  return (
    <View>
      {!hideBrand && <WaylyHeader />}
      <View style={styles.row}>
        <Pressable
          onPress={goBack}
          style={({ pressed }) => [styles.chip, pressed && styles.chipPressed]}
          accessibilityRole="button"
          accessibilityLabel={label}
          hitSlop={8}
          testID="back-header-back"
        >
          <Ionicons name="chevron-back" size={18} color={styles.__chipIcon.color as string} />
          <Text style={styles.chipText}>{label}</Text>
        </Pressable>
        <View style={styles.spacer} />
        <View style={styles.right}>{rightAccessory}</View>
      </View>
    </View>
  );
}

function makeStyles(c: ColorPalette) { return StyleSheet.create({
  // Tucked-in back row beneath the WaylyHeader.
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.md,
    paddingTop: 10,
    paddingBottom: 4,
    gap: 10,
    backgroundColor: c.background,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 9999,
    backgroundColor: c.surfaceTint,
    borderWidth: 1,
    borderColor: c.borderSubtle,
    minHeight: 32,
  },
  chipPressed: {
    backgroundColor: c.border,
  },
  __chipIcon: { color: c.brandPrimary } as any,
  chipText: {
    fontFamily: Fonts.bodySemi,
    fontSize: 13,
    color: c.brandPrimary,
  },
  title: {
    flex: 1,
    fontFamily: Fonts.heading,
    fontSize: 18,
    color: c.textPrimary,
    fontWeight: '600',
  },
  spacer: { flex: 1 },
  right: {
    minWidth: 0,
  },
}); }
