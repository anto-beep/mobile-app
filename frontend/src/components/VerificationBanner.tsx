// Wayly — email verification reminder banner shown on the dashboard until the
// user clicks the link in the verification email. Two states:
//   - days_remaining > 1: gold/clay tone (informational)
//   - days_remaining <= 1: terracotta tone (urgent, login is about to lock)
// Hides itself after Resend success for 90s (visual confirmation) and persists a
// session-only Hide via in-memory ref so the user can dismiss until next launch.
import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../context/AuthContext';
import { api } from '../lib/api';
import { toast } from './Toast';
import { Fonts, Radius, Spacing } from '../lib/theme';

// Module-level so dismissals persist while the JS context is alive but reset on
// a full app cold start — exactly what the spec asks for.
const sessionDismiss = { hidden: false };

export function VerificationBanner() {
  const { verification, refreshVerification } = useAuth();
  const [hidden, setHidden] = useState(sessionDismiss.hidden);
  const [sending, setSending] = useState(false);
  const [cooldownSec, setCooldownSec] = useState(0);
  const timerRef = useRef<any>(null);

  useEffect(() => {
    if (cooldownSec <= 0) return;
    timerRef.current = setInterval(() => {
      setCooldownSec((s) => (s <= 1 ? 0 : s - 1));
    }, 1000);
    return () => clearInterval(timerRef.current);
  }, [cooldownSec]);

  // Nothing to render until the auth ctx has loaded a verification record AND
  // the user is unverified.
  if (!verification) return null;
  if (verification.email_verified) return null;
  if (hidden) return null;

  const urgent = verification.days_remaining <= 1;
  const palette = urgent
    ? { border: '#A5403040', bg: '#A540301A', icon: '#A54030', accent: '#0E2A47' }
    : { border: '#A5512B40', bg: '#A5512B1A', icon: '#0E2A47', accent: '#0E2A47' };

  const days = Math.max(0, Math.round(verification.days_remaining));
  const daysLabel = days === 1 ? '1 day' : `${days} days`;

  const onResend = async () => {
    if (sending || cooldownSec > 0) return;
    setSending(true);
    try {
      await api.post('/auth/send-verification-email', {});
      toast.success(`Verification link sent to ${verification.email}.`);
      setCooldownSec(60);
      try { await refreshVerification(); } catch {}
    } catch (err: any) {
      const status = err?.response?.status;
      const detail = err?.response?.data?.detail;
      if (status === 429) {
        // Backend may surface "Please wait N seconds" — pull it if present.
        const m = String(detail || '').match(/(\d+)\s*second/i);
        const secs = m ? parseInt(m[1], 10) : 60;
        setCooldownSec(secs);
        toast.warning(`Please wait ${secs} seconds before resending.`);
      } else {
        toast.error(typeof detail === 'string' ? detail : 'Could not send verification email. Try again.');
      }
    } finally {
      setSending(false);
    }
  };

  const onHide = () => {
    sessionDismiss.hidden = true;
    setHidden(true);
  };

  return (
    <View
      style={[styles.wrap, { borderColor: palette.border, backgroundColor: palette.bg }]}
      testID="verification-banner"
      accessibilityLiveRegion="polite"
    >
      <View style={styles.row}>
        <Ionicons name="mail-outline" size={20} color={palette.icon} style={styles.icon} />
        <View style={styles.copy}>
          <Text style={[styles.title, { color: palette.accent }]} testID="verification-banner-title">
            Please verify your email
          </Text>
          <Text style={styles.body} numberOfLines={3}>
            We sent a link to <Text style={styles.bold}>{verification.email}</Text>.
            {' '}
            <Text style={{ color: urgent ? '#A54030' : '#6B7C92' }}>
              {daysLabel} remaining before login is locked.
            </Text>
          </Text>
        </View>
      </View>
      <View style={styles.actionRow}>
        <TouchableOpacity
          style={[styles.primaryBtn, (sending || cooldownSec > 0) && { opacity: 0.55 }]}
          onPress={onResend}
          disabled={sending || cooldownSec > 0}
          testID="verification-banner-resend"
          accessibilityRole="button"
        >
          {sending ? (
            <ActivityIndicator color="#FFFFFF" size="small" />
          ) : (
            <Text style={styles.primaryBtnText}>
              {cooldownSec > 0 ? `Resend in ${cooldownSec}s` : 'Resend email'}
            </Text>
          )}
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.secondaryBtn}
          onPress={onHide}
          testID="verification-banner-hide"
          accessibilityRole="button"
        >
          <Text style={styles.secondaryBtnText}>Hide</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginHorizontal: Spacing.md,
    marginTop: Spacing.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: 12,
    borderRadius: 8,
    borderWidth: 1,
  },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  icon: { marginTop: 2 },
  copy: { flex: 1 },
  title: { fontFamily: Fonts.bodySemi, fontSize: 14 },
  body: { fontFamily: Fonts.body, fontSize: 12, color: '#6B7C92', marginTop: 4, lineHeight: 17 },
  bold: { fontFamily: Fonts.bodySemi, color: '#0E2A47' },
  actionRow: { flexDirection: 'row', gap: 10, marginTop: 12, alignItems: 'center' },
  primaryBtn: {
    backgroundColor: '#0E2A47',
    borderRadius: Radius.sm,
    paddingHorizontal: 14,
    paddingVertical: 9,
    minHeight: 36,
    minWidth: 110,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryBtnText: { fontFamily: Fonts.bodySemi, fontSize: 13, color: '#FFFFFF' },
  secondaryBtn: {
    paddingHorizontal: 12,
    paddingVertical: 9,
    minHeight: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryBtnText: { fontFamily: Fonts.bodyMed, fontSize: 13, color: '#6B7C92' },
});
