// Full-screen interstitial shown when login returns 403 email_verification_required.
// Lets the user resend the verification email (public endpoint, anti-enumeration
// safe) or switch accounts.
import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Image,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { api } from '../../src/lib/api';
import { toast } from '../../src/components/Toast';
import { Fonts, Radius, Spacing } from '../../src/lib/theme';
import type { ColorPalette } from '../../src/lib/theme';
import { useColors } from '../../src/hooks/useColors';
import { useThemedStyles } from '../../src/hooks/useThemedStyles';

export default function VerifyRequired() {
  const c = useColors();
  const styles = useThemedStyles(makeStyles);
  const params = useLocalSearchParams<{ email?: string }>();
  const router = useRouter();
  const email = String(params.email || '');
  const [sending, setSending] = useState(false);
  const [cooldownSec, setCooldownSec] = useState(0);
  const [lastSentAt, setLastSentAt] = useState<number | null>(null);
  const timerRef = useRef<any>(null);

  useEffect(() => {
    if (cooldownSec <= 0) return;
    timerRef.current = setInterval(() => {
      setCooldownSec((s) => (s <= 1 ? 0 : s - 1));
    }, 1000);
    return () => clearInterval(timerRef.current);
  }, [cooldownSec]);

  const onResend = async () => {
    if (!email || sending || cooldownSec > 0) return;
    setSending(true);
    try {
      // Public endpoint; backend always returns 200 unless 429.
      await api.post('/auth/resend-verification-email', { email });
      setLastSentAt(Date.now());
      setCooldownSec(60);
      toast.success(`Verification link sent to ${email}.`);
    } catch (err: any) {
      const status = err?.response?.status;
      const detail = err?.response?.data?.detail;
      if (status === 429) {
        const m = String(detail || '').match(/(\d+)\s*second/i);
        const secs = m ? parseInt(m[1], 10) : 60;
        setCooldownSec(secs);
        toast.warning(`Please wait ${secs} seconds before resending.`);
      } else {
        toast.error('Could not send verification email. Try again.');
      }
    } finally {
      setSending(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']} testID="verify-required-screen">
      <View style={styles.body}>
        <View style={styles.brand}>
          <Image
            source={require('../../assets/branding/wayly-mark.png')}
            style={styles.logoImg}
            accessibilityLabel="Wayly"
            resizeMode="contain"
          />
          <Text style={styles.brandText}>Wayly</Text>
        </View>

        <View style={styles.card}>
          <View style={styles.iconBlob}>
            <Ionicons name="mail-unread-outline" size={28} color={c.brandPrimary} />
          </View>
          <Text style={styles.h1} testID="verify-required-title">
            Verify your email to sign in
          </Text>
          <Text style={styles.sub}>
            We sent a verification link to{'\n'}
            <Text style={styles.bold}>{email || 'your inbox'}</Text>.
          </Text>
          <Text style={styles.help}>
            Open the email and tap the link. The link is valid for 24 hours.
            Check your spam folder if you do not see it.
          </Text>

          <TouchableOpacity
            style={[styles.primaryBtn, (sending || cooldownSec > 0) && { opacity: 0.55 }]}
            onPress={onResend}
            disabled={sending || cooldownSec > 0 || !email}
            testID="verify-required-resend"
            accessibilityRole="button"
          >
            {sending ? (
              <ActivityIndicator color={c.cream} />
            ) : (
              <Text style={styles.primaryBtnText}>
                {cooldownSec > 0 ? `Resend in ${cooldownSec}s` : 'Resend verification email'}
              </Text>
            )}
          </TouchableOpacity>

          {lastSentAt && cooldownSec > 0 && (
            <Text style={styles.sentNote} testID="verify-required-sent-note">
              Sent. Check your inbox.
            </Text>
          )}

          <TouchableOpacity
            style={styles.secondaryBtn}
            onPress={() => router.replace('/(auth)/login' as any)}
            testID="verify-required-switch-account"
            accessibilityRole="button"
          >
            <Text style={styles.secondaryBtnText}>Try a different account</Text>
          </TouchableOpacity>
        </View>
      </View>
    </SafeAreaView>
  );
}

function makeStyles(c: ColorPalette) { return StyleSheet.create({
  safe: { flex: 1, backgroundColor: c.background },
  body: { flex: 1, padding: Spacing.lg, justifyContent: 'center' },
  brand: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginBottom: Spacing.xl, alignSelf: 'center' },
  logoImg: { width: 40, height: 40, borderRadius: 8 },
  brandText: { fontFamily: Fonts.heading, fontSize: 22, color: c.brandPrimary, letterSpacing: -0.5 },
  card: {
    backgroundColor: c.cardBg,
    borderRadius: Radius.lg,
    padding: Spacing.lg + 4,
    borderWidth: 1,
    borderColor: c.borderSubtle,
  },
  iconBlob: {
    width: 60, height: 60, borderRadius: 30,
    backgroundColor: 'rgba(14, 77, 82, 0.08)',
    alignItems: 'center', justifyContent: 'center',
    alignSelf: 'center', marginBottom: Spacing.md,
  },
  h1: {
    fontFamily: Fonts.heading, fontSize: 22,
    color: c.brandPrimary, letterSpacing: -0.3,
    textAlign: 'center',
  },
  sub: {
    fontFamily: Fonts.body, fontSize: 15, color: c.textSecondary,
    marginTop: Spacing.sm, lineHeight: 22, textAlign: 'center',
  },
  bold: { fontFamily: Fonts.bodySemi, color: c.textPrimary },
  help: {
    fontFamily: Fonts.body, fontSize: 12, color: c.textMuted,
    marginTop: Spacing.md, textAlign: 'center', lineHeight: 17,
  },
  primaryBtn: {
    marginTop: Spacing.lg, backgroundColor: c.brandPrimary,
    borderRadius: Radius.md, paddingVertical: 14,
    alignItems: 'center', justifyContent: 'center', minHeight: 48,
  },
  primaryBtnText: { fontFamily: Fonts.bodySemi, fontSize: 15, color: c.cream },
  sentNote: {
    fontFamily: Fonts.bodyMed, fontSize: 12, color: c.success,
    marginTop: Spacing.sm, textAlign: 'center',
  },
  secondaryBtn: {
    marginTop: Spacing.md, paddingVertical: 12,
    alignItems: 'center', justifyContent: 'center',
  },
  secondaryBtnText: {
    fontFamily: Fonts.bodyMed, fontSize: 13,
    color: c.brandPrimary, textDecorationLine: 'underline',
  },
}); }
