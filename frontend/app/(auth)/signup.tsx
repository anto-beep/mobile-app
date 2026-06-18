import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
} from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { Link, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../src/context/AuthContext';
import { api, extractErrorMessage } from '../../src/lib/api';
import { toast } from '../../src/components/Toast';
import { Colors, Fonts, Radius, Spacing } from '../../src/lib/theme';

export default function Signup() {
  const { signup } = useAuth();
  const router = useRouter();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [participantName, setParticipantName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async () => {
    setError(null);
    if (password.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }
    setSubmitting(true);
    try {
      await signup(email.trim(), password, name.trim());
      // If a parent name is provided, create the household so Today screen has data
      if (participantName.trim()) {
        try {
          await api.post('/household', {
            participant_name: participantName.trim(),
            classification: 4,
            provider_name: 'Your provider',
            is_grandfathered: false,
          });
        } catch (e) {
          // Non-fatal — they can complete this later
        }
      }
      router.replace('/(tabs)/today');
      // One-time onboarding nudge so the user knows to check their inbox.
      const targetEmail = email.trim();
      if (targetEmail) {
        // Delay slightly so the toast renders ABOVE the dashboard (not the
        // signup screen mid-transition).
        setTimeout(() => {
          toast.info(`Welcome to Wayly. Check ${targetEmail} for your verification link.`, 6000);
        }, 400);
      }
    } catch (e: any) {
      setError(e?.message || 'Could not create your account');
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
          <View style={styles.brand}>
            <View style={styles.logo}>
              <Ionicons name="leaf-outline" size={20} color={Colors.cream} />
            </View>
            <Text style={styles.brandText}>Wayly</Text>
          </View>

          <View style={styles.card}>
            <Text style={styles.overline}>Create account</Text>
            <Text style={styles.h1}>Welcome to Wayly</Text>
            <Text style={styles.sub}>
              Helping you keep an eye on your parent's care, calmly.
            </Text>

            <View style={{ height: Spacing.lg }} />

            <Text style={styles.label}>Your name</Text>
            <TextInput
              testID="signup-name-input"
              value={name}
              onChangeText={setName}
              placeholder="Cathy Williams"
              placeholderTextColor={Colors.textMuted}
              style={styles.input}
            />

            <View style={{ height: Spacing.md }} />

            <Text style={styles.label}>Email</Text>
            <TextInput
              testID="signup-email-input"
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
              testID="signup-password-input"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              placeholder="At least 8 characters"
              placeholderTextColor={Colors.textMuted}
              style={styles.input}
            />

            <View style={{ height: Spacing.md }} />

            <Text style={styles.label}>Your parent's first name (optional)</Text>
            <TextInput
              testID="signup-participant-input"
              value={participantName}
              onChangeText={setParticipantName}
              placeholder="Margaret"
              placeholderTextColor={Colors.textMuted}
              style={styles.input}
            />
            <Text style={styles.hint}>You can add this later from your profile.</Text>

            {error && (
              <Text style={styles.error} testID="signup-error">
                {error}
              </Text>
            )}

            <TouchableOpacity
              testID="auth-signup-button"
              onPress={onSubmit}
              disabled={submitting || !name || !email || !password}
              style={[styles.btn, (submitting || !name || !email || !password) && { opacity: 0.5 }]}
            >
              <Text style={styles.btnText}>
                {submitting ? 'Creating your account…' : 'Create account'}
              </Text>
            </TouchableOpacity>

            <View style={styles.switchRow}>
              <Text style={styles.muted}>Already have an account?</Text>
              <Link href="/(auth)/login" asChild>
                <TouchableOpacity testID="signup-switch-to-login">
                  <Text style={styles.linkText}> Sign in</Text>
                </TouchableOpacity>
              </Link>
            </View>
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
  h1: { fontFamily: Fonts.heading, fontSize: 28, color: Colors.brandPrimary, letterSpacing: -0.5 },
  sub: { fontFamily: Fonts.body, fontSize: 15, color: Colors.textSecondary, marginTop: Spacing.sm, lineHeight: 22 },
  label: { fontFamily: Fonts.bodyMed, fontSize: 13, color: Colors.textSecondary, marginBottom: 6 },
  input: {
    fontFamily: Fonts.body, fontSize: 16, color: Colors.textPrimary,
    backgroundColor: Colors.inputBg, borderRadius: Radius.md, paddingHorizontal: Spacing.md, paddingVertical: 14,
    borderWidth: 1, borderColor: Colors.border,
  },
  hint: { fontFamily: Fonts.body, fontSize: 12, color: Colors.textMuted, marginTop: 4 },
  error: { fontFamily: Fonts.bodyMed, fontSize: 13, color: Colors.severityAlert, marginTop: Spacing.md },
  btn: {
    marginTop: Spacing.lg, backgroundColor: Colors.brandPrimary, borderRadius: Radius.md,
    paddingVertical: 16, alignItems: 'center', minHeight: 52, justifyContent: 'center',
  },
  btnText: { fontFamily: Fonts.bodySemi, fontSize: 16, color: Colors.cream },
  switchRow: { flexDirection: 'row', justifyContent: 'center', marginTop: Spacing.lg },
  muted: { fontFamily: Fonts.body, fontSize: 14, color: Colors.textSecondary },
  linkText: { fontFamily: Fonts.bodySemi, fontSize: 14, color: Colors.brandPrimary, textDecorationLine: 'underline' },
});
