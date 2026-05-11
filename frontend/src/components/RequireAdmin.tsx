// Admin guard — redirects non-admins to /today with a toast
import React, { useEffect } from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth } from '../context/AuthContext';
import { toast } from './Toast';
import { Colors } from '../lib/theme';

export function RequireAdmin({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    if (!user || !user.is_admin) {
      toast.warning('Admin access required', 3500);
      router.replace('/(tabs)/today' as any);
    }
  }, [user, loading, router]);

  if (loading || !user?.is_admin) {
    return (
      <View style={styles.fill}>
        <ActivityIndicator color={Colors.brandPrimary} />
      </View>
    );
  }
  return <>{children}</>;
}

const styles = StyleSheet.create({
  fill: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.background },
});
