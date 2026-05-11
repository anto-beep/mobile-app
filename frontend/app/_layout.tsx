import React, { useEffect } from 'react';
import { Stack, useRouter, useSegments } from 'expo-router';
import { ActivityIndicator, View, StyleSheet } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import {
  useFonts as useOutfit,
  Outfit_600SemiBold,
  Outfit_700Bold,
} from '@expo-google-fonts/outfit';
import {
  useFonts as useFigtree,
  Figtree_400Regular,
  Figtree_500Medium,
  Figtree_600SemiBold,
} from '@expo-google-fonts/figtree';
import { AuthProvider, useAuth } from '../src/context/AuthContext';
import { AccessibilityProvider } from '../src/context/AccessibilityContext';
import { ToastProvider } from '../src/components/Toast';
import { AccessibilityWidget } from '../src/components/AccessibilityWidget';
import { Colors } from '../src/lib/theme';

function RootStack() {
  const { user, loading } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    const inAuthGroup = segments[0] === '(auth)';
    if (!user && !inAuthGroup) {
      router.replace('/(auth)/login');
    } else if (user && inAuthGroup) {
      router.replace('/(tabs)/today');
    }
  }, [user, loading, segments]);

  if (loading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={Colors.brandPrimary} size="large" />
      </View>
    );
  }

  return (
    <>
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: Colors.background } }}>
        <Stack.Screen name="(auth)" />
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="statements/[id]" options={{ headerShown: true, headerTitle: '', headerBackTitle: 'Back', headerStyle: { backgroundColor: Colors.background }, headerTintColor: Colors.brandPrimary }} />
      </Stack>
      <AccessibilityWidget />
    </>
  );
}

export default function RootLayout() {
  const [outfitOk] = useOutfit({ Outfit_600SemiBold, Outfit_700Bold });
  const [figtreeOk] = useFigtree({ Figtree_400Regular, Figtree_500Medium, Figtree_600SemiBold });

  if (!outfitOk || !figtreeOk) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={Colors.brandPrimary} size="large" />
      </View>
    );
  }

  return (
    <SafeAreaProvider>
      <AccessibilityProvider>
        <ToastProvider>
          <AuthProvider>
            <StatusBar style="dark" />
            <RootStack />
          </AuthProvider>
        </ToastProvider>
      </AccessibilityProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    backgroundColor: Colors.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
