// Reset password — lands here after tapping the wayly://reset-password?token=... deep link.
import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { api, extractErrorMessage } from '../src/lib/api';
import { Colors, Fonts, Radius, Spacing } from '../src/lib/theme';

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
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <View style={styles.brand}>
            <View style={styles.logo}>
              <Ionicons name="shield-checkmark" size={18} color={Colors.cream} />
            </View>
            <Text style={styles.brandText}>Wayly</Text>
          </View>

          <View style={styles.card}>
            {done ? (
              <>
                <View style={styles.successIcon}><Ionicons name="checkmark-circle" size={32} color={Colors.success} /></View>
                <Text style={styles.h1}>Password updated</Text>
                <Text style={styles.sub}>Taking you back to sign in…</Text>
                <ActivityIndicator color={Colors.brandPrimary} style={{ marginTop: Spacing.lg }} />
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
                    placeholderTextColor={Colors.textMuted}
                    style={styles.input}
                    testID="reset-password"
                  />
                  <TouchableOpacity style={styles.eye} onPress={() => setShowPassword((s) => !s)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                    <Ionicons name={showPassword ? 'eye-off' : 'eye'} size={18} color={Colors.textMuted} />
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
                      <Ionicons name={r.ok ? 'checkmark-circle' : 'ellipse-outline'} size={12} color={r.ok ? Colors.success : Colors.textMuted} />
                      <Text style={[styles.ruleText, r.ok && { color: Colors.success }]}>{r.label}</Text>
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
                  placeholderTextColor={Colors.textMuted}
                  style={styles.input}
                  testID="reset-confirm"
                />
                {confirm.length > 0 && confirm !== password ? (
                  <Text style={styles.mismatch}>Passwords don't match yet.</Text>
                ) : null}

                {error ? <Text style={styles.error}>{error}</Text> : null}

                <TouchableOpacity onPress={onSubmit} disabled={submitting || !allValid} style={[styles.btn, (submitting || !allValid) && { opacity: 0.55 }]} testID="reset-submit">
                  {submitting ? <ActivityIndicator color={Colors.cream} /> : <Text style={styles.btnText}>Update password</Text>}
                </TouchableOpacity>

                <TouchableOpacity onPress={() => router.replace('/(auth)/login')} style={styles.ghostBtn} testID="reset-cancel">
                  <Text style={styles.ghostBtnText}>Cancel</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { flexGrow: 1, padding: Spacing.lg, justifyContent: 'center' },
  brand: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginBottom: Spacing.lg, alignSelf: 'center' },
  logo: { width: 36, height: 36, borderRadius: 18, backgroundColor: Colors.brandPrimary, alignItems: 'center', justifyContent: 'center' },
  brandText: { fontFamily: Fonts.heading, fontSize: 22, color: Colors.brandPrimary, letterSpacing: -0.5 },
  card: { backgroundColor: Colors.cardBg, borderRadius: Radius.lg, padding: Spacing.lg + 4, borderWidth: 1, borderColor: Colors.borderSubtle },
  overline: { fontFamily: Fonts.bodyMed, fontSize: 11, letterSpacing: 1.5, textTransform: 'uppercase', color: Colors.textMuted, marginBottom: Spacing.sm },
  h1: { fontFamily: Fonts.heading, fontSize: 26, color: Colors.brandPrimary, letterSpacing: -0.5 },
  sub: { fontFamily: Fonts.body, fontSize: 14, color: Colors.textSecondary, marginTop: Spacing.sm, lineHeight: 21 },
  label: { fontFamily: Fonts.bodyMed, fontSize: 13, color: Colors.textSecondary, marginTop: Spacing.lg, marginBottom: 6 },
  inputRow: { position: 'relative' },
  input: { fontFamily: Fonts.body, fontSize: 16, color: Colors.textPrimary, backgroundColor: Colors.inputBg, borderRadius: Radius.md, paddingHorizontal: Spacing.md, paddingVertical: 14, paddingRight: 46, borderWidth: 1, borderColor: Colors.border },
  eye: { position: 'absolute', right: 12, top: 12, padding: 8 },
  meterRow: { flexDirection: 'row', gap: 4, marginTop: 8 },
  meterBar: { flex: 1, height: 4, borderRadius: 2, backgroundColor: Colors.border },
  meterPartial: { backgroundColor: Colors.brandSecondary },
  meterStrong: { backgroundColor: Colors.success },
  rules: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  ruleRow: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 2, paddingHorizontal: 6, borderRadius: 100, backgroundColor: Colors.background },
  ruleText: { fontFamily: Fonts.body, fontSize: 10, color: Colors.textMuted },
  mismatch: { fontFamily: Fonts.body, fontSize: 12, color: Colors.severityWarning, marginTop: 6 },
  error: { fontFamily: Fonts.bodyMed, fontSize: 13, color: Colors.severityAlert, marginTop: Spacing.md },
  btn: { marginTop: Spacing.lg, backgroundColor: Colors.brandPrimary, borderRadius: Radius.md, paddingVertical: 16, alignItems: 'center', minHeight: 52, justifyContent: 'center' },
  btnText: { fontFamily: Fonts.bodySemi, fontSize: 16, color: Colors.cream },
  ghostBtn: { marginTop: Spacing.sm, paddingVertical: 14, alignItems: 'center', minHeight: 44, justifyContent: 'center' },
  ghostBtnText: { fontFamily: Fonts.bodyMed, fontSize: 14, color: Colors.brandPrimary },
  successIcon: { width: 60, height: 60, borderRadius: 30, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(27, 87, 51, 0.15)', alignSelf: 'center', marginBottom: Spacing.md },
});
