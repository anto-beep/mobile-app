// Admin app shell — post-auth. Wrapped in RequireAdminAuth guard.
import React, { useEffect } from 'react';
import { Stack, useRouter } from 'expo-router';
import { ActivityIndicator, View, StyleSheet } from 'react-native';
import { useAdminAuth } from '../../src/context/AdminAuthContext';
import type { ColorPalette } from '../../src/lib/theme';
import { useColors } from '../../src/hooks/useColors';
import { useThemedStyles } from '../../src/hooks/useThemedStyles';

export default function AdminAppLayout() {
  const c = useColors();
  const styles = useThemedStyles(makeStyles);
  const { admin, loading } = useAdminAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !admin) {
      router.replace('/admin-auth/login' as any);
    }
  }, [admin, loading, router]);

  if (loading || !admin) {
    return (
      <View style={styles.fill}><ActivityIndicator color={c.brandPrimary} size="large" /></View>
    );
  }

  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: c.background } }} />
  );
}

function makeStyles(c: ColorPalette) { return StyleSheet.create({
  fill: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: c.background },
}); }
