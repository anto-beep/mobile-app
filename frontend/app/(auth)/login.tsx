import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Alert,
} from 'react-native';
import { Link, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../src/context/AuthContext';
import { Colors, Fonts, Radius, Spacing } from '../../src/lib/theme';

export default function Login() {
  const { login, loginWithGoogle } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState('demo@wayly.com.au');
  const [password, setPassword] = useState('Wayly123!');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async () => {
    setError(null);
    setSubmitting(true);
    try {
      const u = await login(email.trim(), password);
      router.replace('/(tabs)/today');
    } catch (e: any) {
      setError(e?.message || 'Could not sign in');
    } finally {
      setSubmitting(false);
    }
  };

  const onGoogle = async () => {
    setError(null);
    setSubmitting(true);
    try {
      await loginWithGoogle();
      router.replace('/(tabs)/today');
    } catch (e: any) {
      if (e?.message !== 'REDIRECTING') {
        setError(e?.message || 'Google sign-in failed');
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.kb}
      >
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <View style={styles.brand} testID="auth-brand">
            <View style={styles.logo}>
              <Ionicons name="leaf-outline" size={20} color={Colors.cream} />
            </View>
            <Text style={styles.brandText}>Wayly</Text>
          </View>

          <View style={styles.card}>
            <Text style={styles.overline}>Sign in</Text>
            <Text style={styles.h1} testID="auth-title">Welcome back</Text>
            <Text style={styles.sub}>
              Calm, clear-headed care for your parent's Support at Home journey.
            </Text>

            <View style={{ height: Spacing.lg }} />

            <Text style={styles.label}>Email</Text>
            <TextInput
              testID="auth-email-input"
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              autoComplete="email"
              keyboardType="email-address"
              placeholder="you@example.com"
              placeholderTextColor={Colors.textMuted}
              style={styles.input}
            />

            <View style={{ height: Spacing.md }} />

            <Text style={styles.label}>Password</Text>
            <TextInput
              testID="auth-password-input"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              placeholder="••••••••"
              placeholderTextColor={Colors.textMuted}
              style={styles.input}
            />

            {error && (
              <Text style={styles.error} testID="auth-error">
                {error}
              </Text>
            )}

            <TouchableOpacity
              testID="auth-login-button"
              onPress={onSubmit}
              disabled={submitting}
              style={[styles.btn, submitting && { opacity: 0.6 }]}
            >
              <Text style={styles.btnText}>{submitting ? 'Signing in…' : 'Sign in'}</Text>
            </TouchableOpacity>

            <View style={styles.dividerRow}>
              <View style={styles.dividerLine} />
              <Text style={styles.dividerText}>or</Text>
              <View style={styles.dividerLine} />
            </View>

            <TouchableOpacity
              testID="auth-google-button"
              onPress={onGoogle}
              disabled={submitting}
              style={[styles.googleBtn, submitting && { opacity: 0.6 }]}
            >
              <Ionicons name="logo-google" size={18} color={Colors.brandPrimary} />
              <Text style={styles.googleBtnText}>Continue with Google</Text>
            </TouchableOpacity>

            <View style={styles.switchRow}>
              <Text style={styles.muted}>No account yet?</Text>
              <Link href="/(auth)/signup" asChild>
                <TouchableOpacity testID="auth-switch-mode-button">
                  <Text style={styles.linkText}> Create one</Text>
                </TouchableOpacity>
              </Link>
            </View>

            <View style={styles.demoChip} testID="auth-demo-chip">
              <Ionicons name="information-circle-outline" size={14} color={Colors.textSecondary} />
              <Text style={styles.demoText}>
                Try the demo: <Text style={styles.demoBold}>demo@wayly.com.au / Wayly123!</Text>
              </Text>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  kb: { flex: 1 },
  scroll: { flexGrow: 1, padding: Spacing.lg, justifyContent: 'center' },
  brand: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginBottom: Spacing.xl, alignSelf: 'center' },
  logo: {
    width: 32, height: 32, borderRadius: 16, backgroundColor: Colors.brandPrimary,
    alignItems: 'center', justifyContent: 'center',
  },
  brandText: { fontFamily: Fonts.heading, fontSize: 22, color: Colors.brandPrimary, letterSpacing: -0.5 },
  card: {
    backgroundColor: Colors.cardBg, borderRadius: Radius.lg, padding: Spacing.lg + 4,
    borderWidth: 1, borderColor: Colors.borderSubtle,
    shadowColor: Colors.brandPrimary, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.05, shadowRadius: 8, elevation: 2,
  },
  overline: {
    fontFamily: Fonts.bodyMed, fontSize: 11, letterSpacing: 1.5, textTransform: 'uppercase',
    color: Colors.textMuted, marginBottom: Spacing.sm,
  },
  h1: { fontFamily: Fonts.heading, fontSize: 30, color: Colors.brandPrimary, letterSpacing: -0.5 },
  sub: { fontFamily: Fonts.body, fontSize: 15, color: Colors.textSecondary, marginTop: Spacing.sm, lineHeight: 22 },
  label: { fontFamily: Fonts.bodyMed, fontSize: 13, color: Colors.textSecondary, marginBottom: 6 },
  input: {
    fontFamily: Fonts.body, fontSize: 16, color: Colors.textPrimary,
    backgroundColor: Colors.inputBg, borderRadius: Radius.md, paddingHorizontal: Spacing.md, paddingVertical: 14,
    borderWidth: 1, borderColor: Colors.border,
  },
  error: {
    fontFamily: Fonts.bodyMed, fontSize: 13, color: Colors.severityAlert, marginTop: Spacing.md,
  },
  btn: {
    marginTop: Spacing.lg, backgroundColor: Colors.brandPrimary, borderRadius: Radius.md,
    paddingVertical: 16, alignItems: 'center', minHeight: 52, justifyContent: 'center',
  },
  btnText: { fontFamily: Fonts.bodySemi, fontSize: 16, color: Colors.cream },
  switchRow: { flexDirection: 'row', justifyContent: 'center', marginTop: Spacing.lg },
  muted: { fontFamily: Fonts.body, fontSize: 14, color: Colors.textSecondary },
  linkText: { fontFamily: Fonts.bodySemi, fontSize: 14, color: Colors.brandPrimary, textDecorationLine: 'underline' },
  dividerRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: Spacing.md },
  dividerLine: { flex: 1, height: 1, backgroundColor: Colors.border },
  dividerText: { fontFamily: Fonts.bodyMed, fontSize: 11, color: Colors.textMuted, letterSpacing: 1, textTransform: 'uppercase' },
  googleBtn: {
    marginTop: Spacing.md, backgroundColor: Colors.cardBg, borderRadius: Radius.md,
    paddingVertical: 14, alignItems: 'center', justifyContent: 'center',
    flexDirection: 'row', gap: 10, minHeight: 52,
    borderWidth: 1, borderColor: Colors.border,
  },
  googleBtnText: { fontFamily: Fonts.bodySemi, fontSize: 15, color: Colors.brandPrimary },
  demoChip: {
    marginTop: Spacing.lg, padding: Spacing.md, backgroundColor: 'rgba(139, 155, 130, 0.08)',
    borderRadius: Radius.md, flexDirection: 'row', alignItems: 'center', gap: 8,
  },
  demoText: { fontFamily: Fonts.body, fontSize: 12, color: Colors.textSecondary, flex: 1 },
  demoBold: { fontFamily: Fonts.bodySemi, color: Colors.textPrimary },
});
