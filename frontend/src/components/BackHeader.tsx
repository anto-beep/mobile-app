// Reusable back button row for screens pushed from a tab.
// Use this at the very top of screens that don't get a native Stack header.
import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Colors, Fonts, Spacing } from '../lib/theme';

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
        <Ionicons name="chevron-back" size={22} color="#FFFFFF" />
        <Text style={styles.backText}>{label}</Text>
      </TouchableOpacity>
      {title ? <Text style={styles.title} numberOfLines={1}>{title}</Text> : <View style={{ flex: 1 }} />}
      <View style={styles.right}>{rightAccessory}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.md,
    paddingVertical: Platform.OS === 'ios' ? 10 : 10,
    minHeight: 52,
    gap: 6,
    backgroundColor: Colors.brandPrimary, // teal banner on every sub-screen
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
    color: '#FFFFFF',
    marginLeft: 2,
  },
  title: {
    flex: 1,
    fontFamily: Fonts.bodySemi,
    fontSize: 16,
    color: '#FFFFFF',
    textAlign: 'center',
    marginRight: 44,
  },
  right: {
    minWidth: 0,
  },
});
