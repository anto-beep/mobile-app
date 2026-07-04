import React, { useEffect } from 'react';
import { Stack, useRouter, useSegments } from 'expo-router';
import { View, StyleSheet, ActivityIndicator } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import * as SplashScreen from 'expo-splash-screen';
import { AuthProvider, useAuth } from '../src/context/AuthContext';
import { AdminAuthProvider } from '../src/context/AdminAuthContext';
import { AccessibilityProvider } from '../src/context/AccessibilityContext';
import { ParticipantsProvider } from '../src/context/ParticipantsContext';
import { ScenarioProvider } from '../src/context/ScenarioContext';
import { OnboardingGate } from '../src/components/OnboardingGate';
import { SchemaBanner } from '../src/components/SchemaBanner';
import { PushDeepLinkListener } from '../src/components/PushDeepLinkListener';
import { ToastProvider } from '../src/components/Toast';
import { ThemedShell } from '../src/components/ThemedShell';
import { DeepLinkHandler } from '../src/components/DeepLinkHandler';
import { NotificationRouter } from '../src/components/NotificationRouter';
import { NetworkProvider } from '../src/components/NetworkProvider';
import { BiometricGate } from '../src/components/BiometricGate';
import { ThemeProvider, useTheme } from '../src/context/ThemeContext';
import { Colors } from '../src/lib/theme';
import type { ColorPalette } from '../src/lib/theme';
import { useColors } from '../src/hooks/useColors';
import { useThemedStyles } from '../src/hooks/useThemedStyles';
import { installLogRedactor } from '../src/lib/logRedactor';

// Phase 10 hardening: install console redactor BEFORE any other code runs.
// In production builds this neuters console.log/info/debug and redacts JWTs,
// emails, push tokens, AU phone numbers, TFNs from warn/error payloads.
// In `__DEV__` it's a no-op so iteration speed stays fast.
installLogRedactor();

function RootStack() {
  const { user, loading } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    const inAuthGroup = segments[0] === '(auth)';
    const inAdminGroup = segments[0] === 'admin-auth' || segments[0] === 'admin-app';
    const isPublicRoute = segments[0] === 'reset-password';
    if (inAdminGroup || isPublicRoute) return; // these routes manage their own auth
    if (!user && !inAuthGroup) {
      router.replace('/(auth)/login');
    } else if (user && inAuthGroup) {
      router.replace('/(tabs)/today');
    }
  }, [user, loading, segments]);

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: Colors.background, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={Colors.brandPrimary} size="large" />
      </View>
    );
  }

  return (
    <>
      <BiometricGate>
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: Colors.background } }}>
          <Stack.Screen name="(auth)" />
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="admin-auth" />
          <Stack.Screen name="admin-app" />
          <Stack.Screen name="reset-password" />
          <Stack.Screen name="statements/[id]" />
        </Stack>
      </BiometricGate>
      <DeepLinkHandler />
      <NotificationRouter />
      {/* AccessibilityWidget removed per request, settings still accessible via More → Settings → Appearance. */}
    </>
  );
}

export default function RootLayout() {
  const c = useColors();
  const styles = useThemedStyles(makeStyles);
  // Bundled Wayly brand fonts — Feb 2026 refresh.
  // IMPORTANT: We don't block app render on font loading. If a variable TTF
  // fails to register on a given device (rare but does happen on older Expo Go
  // builds), the app would otherwise be stuck on a white screen forever.
  // Instead we hide the splash + render after EITHER fonts load OR a 1.5s
  // safety timeout. Components fall back to the system font stack defined in
  // theme.ts → SystemFonts.
  const [fontsLoaded, fontsError] = useFonts({
    Fraunces: require('../assets/fonts/Fraunces-Variable.ttf'),
    Inter: require('../assets/fonts/Inter-VariableFont.ttf'),
    'IBM Plex Mono': require('../assets/fonts/IBMPlexMono-Regular.ttf'),
    'IBM Plex Mono Medium': require('../assets/fonts/IBMPlexMono-Medium.ttf'),
    'IBM Plex Mono SemiBold': require('../assets/fonts/IBMPlexMono-SemiBold.ttf'),
  });
  const [ready, setReady] = React.useState(false);

  // Try to prevent the native splash from auto-hiding until we're ready.
  // expo-splash-screen throws on web — guard with try/catch.
  React.useEffect(() => {
    try {
      SplashScreen.preventAutoHideAsync();
    } catch {}
  }, []);

  React.useEffect(() => {
    if (fontsLoaded || fontsError) {
      setReady(true);
      return;
    }
    // Safety net: never block on fonts for more than 1.5s.
    const t = setTimeout(() => setReady(true), 1500);
    return () => clearTimeout(t);
  }, [fontsLoaded, fontsError]);

  React.useEffect(() => {
    if (ready) {
      try {
        SplashScreen.hideAsync();
      } catch {}
    }
  }, [ready]);

  if (!ready) {
    // Single warm-bg view while we wait — splash is still up on native, this is
    // only visible on web.
    return <View style={styles.loading} />;
  }

  return (
    <ThemeProvider>
      <ThemedRoot />
    </ThemeProvider>
  );
}

// Internal component that consumes the theme to drive the StatusBar +
// SafeAreaProvider background. Sits inside ThemeProvider so it can read.
function ThemedRoot() {
  const { effective } = useTheme();
  const isDark = effective === 'dark';
  // Light mode: cream bg behind status bar → dark icons so time is visible.
  // Dark mode: dark bg behind status bar → light (white) icons.
  const safeBg = isDark ? '#1A1A1F' : Colors.background;
  return (
    <SafeAreaProvider style={{ backgroundColor: safeBg }}>
      <KeyboardProvider>
        <AccessibilityProvider>
          <ToastProvider>
            <NetworkProvider>
              <AdminAuthProvider>
                <AuthProvider>
                  <ParticipantsProvider>
                    <ScenarioProvider>
                      <StatusBar style={isDark ? 'light' : 'dark'} backgroundColor={safeBg} translucent={false} />
                      <OnboardingGate />
                      <SchemaBanner />
                      <PushDeepLinkListener />
                      <ThemedShell>
                        <RootStack />
                      </ThemedShell>
                    </ScenarioProvider>
                  </ParticipantsProvider>
                </AuthProvider>
              </AdminAuthProvider>
            </NetworkProvider>
          </ToastProvider>
        </AccessibilityProvider>
      </KeyboardProvider>
    </SafeAreaProvider>
  );
}

function makeStyles(c: ColorPalette) { return StyleSheet.create({
  loading: {
    flex: 1,
    backgroundColor: c.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
}); }
