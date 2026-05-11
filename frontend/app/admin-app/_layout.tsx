// Admin app shell — post-auth. Wrapped in RequireAdminAuth guard.
import React, { useEffect } from 'react';
import { Stack, useRouter } from 'expo-router';
import { ActivityIndicator, View, StyleSheet } from 'react-native';
import { useAdminAuth } from '../../src/context/AdminAuthContext';
import { Colors } from '../../src/lib/theme';

export default function AdminAppLayout() {
  const { admin, loading } = useAdminAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !admin) {
      router.replace('/admin-auth/login' as any);
    }
  }, [admin, loading, router]);

  if (loading || !admin) {
    return (
      <View style={styles.fill}><ActivityIndicator color={Colors.brandPrimary} size="large" /></View>
    );
  }

  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: Colors.background } }} />
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.background },
});
