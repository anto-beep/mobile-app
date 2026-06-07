// Forgot password — enumeration-safe (always shows success)
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
  ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { api, extractErrorMessage } from '../../src/lib/api';
import { Colors, Fonts, Radius, Spacing } from '../../src/lib/theme';

export default function Forgot() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async () => {
    const e = email.trim();
    if (!e.includes('@')) {
      setError('Enter a valid email address.');
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      await api.post('/auth/forgot', { email: e });
      setDone(true);
    } catch (err) {
      setError(extractErrorMessage(err, "Couldn't send the reset link"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <TouchableOpacity style={styles.back} onPress={() => router.back()} testID="forgot-back">
            <Ionicons name="chevron-back" size={22} color={Colors.brandPrimary} />
            <Text style={styles.backText}>Sign in</Text>
          </TouchableOpacity>

          <View style={styles.brand}>
            <View style={styles.logo}>
              <Ionicons name="key-outline" size={18} color={Colors.cream} />
            </View>
            <Text style={styles.brandText}>Wayly</Text>
          </View>

          <View style={styles.card}>
            {done ? (
              <>
                <View style={styles.successIcon}><Ionicons name="mail" size={28} color={Colors.brandPrimary} /></View>
                <Text style={styles.h1}>Check your inbox</Text>
                <Text style={styles.sub}>
                  If an account with <Text style={{ fontFamily: Fonts.bodySemi }}>{email.trim()}</Text> exists, we've sent a password reset link. It expires in 1 hour.
                </Text>
                <Text style={[styles.sub, { marginTop: Spacing.md }]}>Didn't get it? Check your spam folder, then try again.</Text>
                <TouchableOpacity style={styles.btn} onPress={() => router.replace('/(auth)/login')} testID="forgot-back-to-login">
                  <Text style={styles.btnText}>Back to sign in</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.ghostBtn} onPress={() => setDone(false)} testID="forgot-resend">
                  <Text style={styles.ghostBtnText}>Try a different email</Text>
                </TouchableOpacity>
              </>
            ) : (
              <>
                <Text style={styles.overline}>Forgot password</Text>
                <Text style={styles.h1}>Reset your password</Text>
                <Text style={styles.sub}>Enter the email on your Wayly account and we'll send you a secure link.</Text>

                <Text style={styles.label}>Email</Text>
                <TextInput
                  value={email}
                  onChangeText={setEmail}
                  autoCapitalize="none"
                  autoComplete="email"
                  autoCorrect={false}
                  keyboardType="email-address"
                  inputMode="email"
                  placeholder="you@example.com"
                  placeholderTextColor={Colors.textMuted}
                  style={styles.input}
                  testID="forgot-email"
                />

                {error ? <Text style={styles.error}>{error}</Text> : null}

                <TouchableOpacity onPress={onSubmit} disabled={submitting} style={[styles.btn, submitting && { opacity: 0.6 }]} testID="forgot-submit">
                  {submitting ? <ActivityIndicator color={Colors.cream} /> : <Text style={styles.btnText}>Send reset link</Text>}
                </TouchableOpacity>

                <Text style={styles.help}>We'll never share your email. Links expire after 1 hour for safety.</Text>
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
  scroll: { flexGrow: 1, padding: Spacing.lg },
  back: { flexDirection: 'row', alignItems: 'center', minHeight: 44, marginBottom: Spacing.md },
  backText: { fontFamily: Fonts.bodyMed, fontSize: 15, color: Colors.brandPrimary, marginLeft: 2 },
  brand: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginBottom: Spacing.lg, alignSelf: 'center' },
  logo: { width: 36, height: 36, borderRadius: 18, backgroundColor: Colors.brandPrimary, alignItems: 'center', justifyContent: 'center' },
  brandText: { fontFamily: Fonts.heading, fontSize: 22, color: Colors.brandPrimary, letterSpacing: -0.5 },
  card: { backgroundColor: Colors.cardBg, borderRadius: Radius.lg, padding: Spacing.lg + 4, borderWidth: 1, borderColor: Colors.borderSubtle },
  overline: { fontFamily: Fonts.bodyMed, fontSize: 11, letterSpacing: 1.5, textTransform: 'uppercase', color: Colors.textMuted, marginBottom: Spacing.sm },
  h1: { fontFamily: Fonts.heading, fontSize: 26, color: Colors.brandPrimary, letterSpacing: -0.5 },
  sub: { fontFamily: Fonts.body, fontSize: 14, color: Colors.textSecondary, marginTop: Spacing.sm, lineHeight: 21 },
  label: { fontFamily: Fonts.bodyMed, fontSize: 13, color: Colors.textSecondary, marginTop: Spacing.lg, marginBottom: 6 },
  input: { fontFamily: Fonts.body, fontSize: 16, color: Colors.textPrimary, backgroundColor: Colors.inputBg, borderRadius: Radius.md, paddingHorizontal: Spacing.md, paddingVertical: 14, borderWidth: 1, borderColor: Colors.border },
  error: { fontFamily: Fonts.bodyMed, fontSize: 13, color: Colors.severityAlert, marginTop: Spacing.md },
  btn: { marginTop: Spacing.lg, backgroundColor: Colors.brandPrimary, borderRadius: Radius.md, paddingVertical: 16, alignItems: 'center', minHeight: 52, justifyContent: 'center' },
  btnText: { fontFamily: Fonts.bodySemi, fontSize: 16, color: Colors.cream },
  ghostBtn: { marginTop: Spacing.sm, paddingVertical: 14, alignItems: 'center', minHeight: 44, justifyContent: 'center' },
  ghostBtnText: { fontFamily: Fonts.bodyMed, fontSize: 14, color: Colors.brandPrimary },
  successIcon: { width: 60, height: 60, borderRadius: 30, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(183, 121, 31, 0.15)', alignSelf: 'center', marginBottom: Spacing.md },
  help: { fontFamily: Fonts.body, fontSize: 11, color: Colors.textMuted, marginTop: Spacing.md, textAlign: 'center' },
});
