// Reset password — lands here after tapping the wayly://reset-password?token=... deep link.
import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { api, extractErrorMessage } from '../src/lib/api';
import { Fonts, Radius, Spacing } from '../src/lib/theme';
import type { ColorPalette } from '../src/lib/theme';
import { useColors } from '../src/hooks/useColors';
import { useThemedStyles } from '../src/hooks/useThemedStyles';

function passwordStrength(p: string): { score: number; rules: { ok: boolean; label: string }[] } {
  const rules = [
    { ok: p.length >= 8, label: '8+ characters' },
    { ok: /[a-z]/.test(p), label: 'lowercase letter' },
    { ok: /[A-Z]/.test(p), label: 'uppercase letter' },
    { ok: /\d/.test(p), label: 'number' },
    { ok: /[^A-Za-z0-9]/.test(p), label: 'symbol' },
  ];
  return { score: rules.filter((r) => r.ok).length, rules };
}

export default function ResetPassword() {
  const c = useColors();
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const params = useLocalSearchParams<{ token?: string }>();
  const [token, setToken] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (params.token && typeof params.token === 'string') setToken(params.token);
  }, [params.token]);

  const strength = passwordStrength(password);
  const allValid = strength.score === 5 && password === confirm && token.length >= 20;

  const onSubmit = async () => {
    setError(null);
    if (!token || token.length < 20) {
      setError('Missing or invalid reset token. Open the link from the email again.');
      return;
    }
    if (strength.score < 5) {
      setError('Password must meet all 5 strength rules below.');
      return;
    }
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }
    setSubmitting(true);
    try {
      await api.post('/auth/reset', { token, password });
      setDone(true);
      setTimeout(() => router.replace('/(auth)/login'), 2500);
    } catch (e) {
      setError(extractErrorMessage(e, 'Could not reset password'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <KeyboardAwareScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" bottomOffset={24} showsVerticalScrollIndicator={false}>
          <View style={styles.brand}>
            <View style={styles.logo}>
              <Ionicons name="shield-checkmark" size={18} color={c.cream} />
            </View>
            <Text style={styles.brandText}>Wayly</Text>
          </View>

          <View style={styles.card}>
            {done ? (
              <>
                <View style={styles.successIcon}><Ionicons name="checkmark-circle" size={32} color={c.success} /></View>
                <Text style={styles.h1}>Password updated</Text>
                <Text style={styles.sub}>Taking you back to sign in…</Text>
                <ActivityIndicator color={c.brandPrimary} style={{ marginTop: Spacing.lg }} />
              </>
            ) : (
              <>
                <Text style={styles.overline}>Reset password</Text>
                <Text style={styles.h1}>Choose a new password</Text>
                <Text style={styles.sub}>Pick something only you would know. Reset link expires after 1 hour.</Text>

                <Text style={styles.label}>New password</Text>
                <View style={styles.inputRow}>
                  <TextInput
                    value={password}
                    onChangeText={setPassword}
                    secureTextEntry={!showPassword}
                    autoCapitalize="none"
                    autoComplete="new-password"
                    placeholder="At least 8 characters"
                    placeholderTextColor={c.textMuted}
                    style={styles.input}
                    testID="reset-password"
                  />
                  <TouchableOpacity style={styles.eye} onPress={() => setShowPassword((s) => !s)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                    <Ionicons name={showPassword ? 'eye-off' : 'eye'} size={18} color={c.textMuted} />
                  </TouchableOpacity>
                </View>

                {/* Strength meter */}
                <View style={styles.meterRow}>
                  {[1, 2, 3, 4, 5].map((i) => (
                    <View key={i} style={[styles.meterBar, strength.score >= i && (strength.score >= 5 ? styles.meterStrong : styles.meterPartial)]} />
                  ))}
                </View>
                <View style={styles.rules}>
                  {strength.rules.map((r, i) => (
                    <View key={i} style={styles.ruleRow}>
                      <Ionicons name={r.ok ? 'checkmark-circle' : 'ellipse-outline'} size={12} color={r.ok ? c.success : c.textMuted} />
                      <Text style={[styles.ruleText, r.ok && { color: c.success }]}>{r.label}</Text>
                    </View>
                  ))}
                </View>

                <Text style={styles.label}>Confirm new password</Text>
                <TextInput
                  value={confirm}
                  onChangeText={setConfirm}
                  secureTextEntry={!showPassword}
                  autoCapitalize="none"
                  placeholder="Re-enter password"
                  placeholderTextColor={c.textMuted}
                  style={styles.input}
                  testID="reset-confirm"
                />
                {confirm.length > 0 && confirm !== password ? (
                  <Text style={styles.mismatch}>Passwords don't match yet.</Text>
                ) : null}

                {error ? <Text style={styles.error}>{error}</Text> : null}

                <TouchableOpacity onPress={onSubmit} disabled={submitting || !allValid} style={[styles.btn, (submitting || !allValid) && { opacity: 0.55 }]} testID="reset-submit">
                  {submitting ? <ActivityIndicator color={c.cream} /> : <Text style={styles.btnText}>Update password</Text>}
                </TouchableOpacity>

                <TouchableOpacity onPress={() => router.replace('/(auth)/login')} style={styles.ghostBtn} testID="reset-cancel">
                  <Text style={styles.ghostBtnText}>Cancel</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
      </KeyboardAwareScrollView>
    </SafeAreaView>
  );
}

function makeStyles(c: ColorPalette) { return StyleSheet.create({
  safe: { flex: 1, backgroundColor: c.background },
  scroll: { flexGrow: 1, padding: Spacing.lg, justifyContent: 'center' },
  brand: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginBottom: Spacing.lg, alignSelf: 'center' },
  logo: { width: 36, height: 36, borderRadius: 18, backgroundColor: c.brandPrimary, alignItems: 'center', justifyContent: 'center' },
  brandText: { fontFamily: Fonts.heading, fontSize: 22, color: c.brandPrimary, letterSpacing: -0.5 },
  card: { backgroundColor: c.cardBg, borderRadius: Radius.lg, padding: Spacing.lg + 4, borderWidth: 1, borderColor: c.borderSubtle },
  overline: { fontFamily: Fonts.bodyMed, fontSize: 11, letterSpacing: 1.5, textTransform: 'uppercase', color: c.textMuted, marginBottom: Spacing.sm },
  h1: { fontFamily: Fonts.heading, fontSize: 26, color: c.brandPrimary, letterSpacing: -0.5 },
  sub: { fontFamily: Fonts.body, fontSize: 14, color: c.textSecondary, marginTop: Spacing.sm, lineHeight: 21 },
  label: { fontFamily: Fonts.bodyMed, fontSize: 13, color: c.textSecondary, marginTop: Spacing.lg, marginBottom: 6 },
  inputRow: { position: 'relative' },
  input: { fontFamily: Fonts.body, fontSize: 16, color: c.textPrimary, backgroundColor: c.inputBg, borderRadius: Radius.md, paddingHorizontal: Spacing.md, paddingVertical: 14, paddingRight: 46, borderWidth: 1, borderColor: c.border },
  eye: { position: 'absolute', right: 12, top: 12, padding: 8 },
  meterRow: { flexDirection: 'row', gap: 4, marginTop: 8 },
  meterBar: { flex: 1, height: 4, borderRadius: 2, backgroundColor: c.border },
  meterPartial: { backgroundColor: c.brandSecondary },
  meterStrong: { backgroundColor: c.success },
  rules: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  ruleRow: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 2, paddingHorizontal: 6, borderRadius: 100, backgroundColor: c.background },
  ruleText: { fontFamily: Fonts.body, fontSize: 10, color: c.textMuted },
  mismatch: { fontFamily: Fonts.body, fontSize: 12, color: c.severityWarning, marginTop: 6 },
  error: { fontFamily: Fonts.bodyMed, fontSize: 13, color: c.severityAlert, marginTop: Spacing.md },
  btn: { marginTop: Spacing.lg, backgroundColor: c.brandPrimary, borderRadius: Radius.md, paddingVertical: 16, alignItems: 'center', minHeight: 52, justifyContent: 'center' },
  btnText: { fontFamily: Fonts.bodySemi, fontSize: 16, color: c.cream },
  ghostBtn: { marginTop: Spacing.sm, paddingVertical: 14, alignItems: 'center', minHeight: 44, justifyContent: 'center' },
  ghostBtnText: { fontFamily: Fonts.bodyMed, fontSize: 14, color: c.brandPrimary },
  successIcon: { width: 60, height: 60, borderRadius: 30, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(27, 87, 51, 0.15)', alignSelf: 'center', marginBottom: Spacing.md },
}); }
