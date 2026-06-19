// Reusable back button row for screens pushed from a tab.
// Use this at the very top of screens that don't get a native Stack header.
import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Platform, Image } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Colors, Fonts, Spacing } from '../lib/theme';

// Wayly mark — shown next to the screen title on every sub-screen so the
// brand identity is consistent across the app (the tab-level screens use
// the larger <WaylyHeader />).
// eslint-disable-next-line @typescript-eslint/no-require-imports
const WAYLY_MARK = require('../../assets/branding/wayly-mark.png');

type Props = {
  title?: string;
  label?: string; // text next to chevron, default "Back"
  onBack?: () => void; // override default router.back()
  rightAccessory?: React.ReactNode;
};

export default function BackHeader({ title, label = 'Back', onBack, rightAccessory }: Props) {
  const router = useRouter();
  const handleBack = () => {
    if (onBack) return onBack();
    // Safe fallback: if there's nothing in stack, go to More tab
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/(tabs)/profile' as any);
    }
  };

  return (
    <View style={styles.row}>
      <TouchableOpacity
        onPress={handleBack}
        style={styles.backBtn}
        hitSlop={{ top: 10, right: 10, bottom: 10, left: 10 }}
        testID="back-header-btn"
        accessibilityRole="button"
        accessibilityLabel={`${label}, go back`}
      >
        <Ionicons name="chevron-back" size={22} color={Colors.brandPrimary} />
        <Text style={styles.backText}>{label}</Text>
      </TouchableOpacity>
      {title ? (
        <View style={styles.titleRow}>
          <Image source={WAYLY_MARK} style={styles.mark} resizeMode="contain" />
          <Text style={styles.title} numberOfLines={1}>{title}</Text>
        </View>
      ) : <View style={{ flex: 1 }} />}
      <View style={styles.right}>{rightAccessory}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.md,
    paddingVertical: Platform.OS === 'ios' ? 6 : 8,
    minHeight: 48,
    gap: 6,
  },
  backBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 44,
    paddingRight: 8,
  },
  backText: {
    fontFamily: Fonts.bodyMed,
    fontSize: 15,
    color: Colors.brandPrimary,
    marginLeft: 2,
  },
  title: {
    fontFamily: Fonts.bodySemi,
    fontSize: 16,
    color: Colors.brandPrimary,
    textAlign: 'center',
  },
  titleRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginRight: 44, // visual balance with the back button on the left
  },
  mark: { width: 18, height: 18, borderRadius: 4 },
  right: {
    minWidth: 0,
  },
});
