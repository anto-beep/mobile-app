import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Image,
} from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { Link, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useAuth, EmailVerificationRequiredError } from '../../src/context/AuthContext';
import { Colors, Fonts, Radius, Spacing } from '../../src/lib/theme';

export default function Login() {
  const { login, loginWithGoogle } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 429 cool-down — backend signals "Please wait N minute(s)". We parse the
  // hint, start a local countdown, and disable the Sign-in button until it
  // reaches zero so users don't keep slamming the rate limiter.
  const [cooldownSec, setCooldownSec] = useState(0);
  const timerRef = useRef<any>(null);

  useEffect(() => {
    if (cooldownSec <= 0) return;
    timerRef.current = setInterval(() => {
      setCooldownSec((s) => (s <= 1 ? 0 : s - 1));
    }, 1000);
    return () => clearInterval(timerRef.current);
  }, [cooldownSec]);

  function startCooldown(seconds: number) {
    setCooldownSec(Math.max(1, Math.min(600, Math.round(seconds))));
  }

  function friendlyError(err: any): string {
    const status = err?.response?.status;
    const detail = err?.response?.data?.detail || err?.message || '';
    // Backend phrases its 429 as "...wait 1 minute(s)..." or similar.
    if (status === 429 || /too many|rate limit|wait \d+ minute/i.test(String(detail))) {
      const m = String(detail).match(/(\d+)\s*minute/i);
      const mins = m ? parseInt(m[1], 10) : 1;
      startCooldown(mins * 60);
      return `Too many sign-in attempts. Try again in ${mins} minute${mins === 1 ? '' : 's'} — Wayly is just rate-limiting to keep accounts safe.`;
    }
    if (status === 401 || /invalid (email|password|credentials)/i.test(String(detail))) {
      return 'That email and password combination didn\u2019t match. Try again or use "Forgot password?" below.';
    }
    if (!status || /network/i.test(String(detail))) {
      return 'Couldn\u2019t reach Wayly. Check your internet connection and try again.';
    }
    return detail || 'Could not sign in';
  }

  const onSubmit = async () => {
    if (cooldownSec > 0) return;
    setError(null);
    setSubmitting(true);
    try {
      await login(email.trim(), password);
      router.replace('/(tabs)/today');
    } catch (e: any) {
      if (e instanceof EmailVerificationRequiredError) {
        router.replace({ pathname: '/(auth)/verify-required' as any, params: { email: e.email } });
        return;
      }
      setError(friendlyError(e));
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
      <KeyboardAwareScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        bottomOffset={24}
        showsVerticalScrollIndicator={false}
      >
          <View style={styles.brand} testID="auth-brand">
            <Image
              source={require('../../assets/branding/wayly-mark.png')}
              style={styles.logoImg}
              accessibilityLabel="Wayly"
              resizeMode="contain"
            />
            <Text style={styles.brandText}>Wayly</Text>
          </View>

          <View style={styles.card}>
            <Text style={styles.overline}>Sign in</Text>
            <Text style={styles.h1} testID="auth-title">Welcome back</Text>
            <Text style={styles.sub}>
              Calm, clear-headed care for your parent&apos;s Support at Home journey.
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
            <View style={styles.passwordWrap}>
              <TextInput
                testID="auth-password-input"
                value={password}
                onChangeText={setPassword}
                secureTextEntry={!showPassword}
                placeholder="••••••••"
                placeholderTextColor={Colors.textMuted}
                style={[styles.input, styles.passwordInput]}
                autoComplete="password"
                autoCapitalize="none"
              />
              <TouchableOpacity
                testID="auth-password-toggle"
                onPress={() => setShowPassword((s) => !s)}
                style={styles.eyeBtn}
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel={showPassword ? 'Hide password' : 'Show password'}
              >
                <Ionicons name={showPassword ? 'eye-off-outline' : 'eye-outline'} size={20} color={Colors.textSecondary} />
              </TouchableOpacity>
            </View>

            {error && (
              <Text style={styles.error} testID="auth-error">
                {error}
              </Text>
            )}

            <TouchableOpacity
              onPress={() => router.push('/(auth)/forgot' as any)}
              style={styles.forgotRow}
              testID="auth-forgot-link"
              accessibilityRole="link"
            >
              <Text style={styles.forgotText}>Forgot password?</Text>
            </TouchableOpacity>

            <TouchableOpacity
              testID="auth-login-button"
              onPress={onSubmit}
              disabled={submitting || cooldownSec > 0}
              style={[styles.btn, (submitting || cooldownSec > 0) && { opacity: 0.6 }]}
            >
              <Text style={styles.btnText}>
                {cooldownSec > 0
                  ? `Try again in ${Math.ceil(cooldownSec / 60)} min`
                  : submitting
                  ? 'Signing in…'
                  : 'Sign in'}
              </Text>
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

            <TouchableOpacity
              style={styles.staffLink}
              onPress={() => router.push('/admin-auth/login' as any)}
              testID="admin-signin-link"
            >
              <Ionicons name="shield-checkmark-outline" size={13} color={Colors.textMuted} />
              <Text style={styles.staffLinkText}>Wayly staff sign-in</Text>
            </TouchableOpacity>
          </View>
      </KeyboardAwareScrollView>
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
  logoImg: { width: 40, height: 40, borderRadius: 8 },
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
  passwordWrap: { position: 'relative', justifyContent: 'center' },
  passwordInput: { paddingRight: 48 },
  eyeBtn: { position: 'absolute', right: 4, top: 0, bottom: 0, width: 44, alignItems: 'center', justifyContent: 'center' },
  error: {
    fontFamily: Fonts.bodyMed, fontSize: 13, color: Colors.severityAlert, marginTop: Spacing.md,
  },
  btn: {
    marginTop: Spacing.lg, backgroundColor: Colors.brandPrimary, borderRadius: Radius.md,
    paddingVertical: 16, alignItems: 'center', minHeight: 52, justifyContent: 'center',
  },
  btnText: { fontFamily: Fonts.bodySemi, fontSize: 16, color: Colors.cream },
  forgotRow: { alignSelf: 'flex-end', paddingVertical: 6, paddingHorizontal: 4, marginTop: 8, minHeight: 32, justifyContent: 'center' },
  forgotText: { fontFamily: Fonts.bodyMed, fontSize: 13, color: Colors.brandPrimary, textDecorationLine: 'underline' },
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
  staffLink: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: Spacing.md, paddingVertical: 10 },
  staffLinkText: { fontFamily: Fonts.bodyMed, fontSize: 12, color: Colors.textMuted, textDecorationLine: 'underline' },
});
