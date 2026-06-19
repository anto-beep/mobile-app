// Security — biometric lock, password reset, account deletion
import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, ActivityIndicator, Alert, Switch, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import BackHeader from '../../src/components/BackHeader';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { api, extractErrorMessage } from '../../src/lib/api';
import { useAuth } from '../../src/context/AuthContext';
import { Fonts, Radius, Spacing } from '../../src/lib/theme';
import type { ColorPalette } from '../../src/lib/theme';
import { useColors } from '../../src/hooks/useColors';
import { useThemedStyles } from '../../src/hooks/useThemedStyles';
import { confirmWithBiometric, biometryLabel } from '../../src/lib/biometric';
import { isBiometricLockEnabled, setBiometricLockEnabled } from '../../src/components/BiometricGate';
import { toast } from '../../src/components/Toast';

export default function Security() {
  const c = useColors();
  const styles = useThemedStyles(makeStyles);
  const { user, logout } = useAuth();
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [bioOn, setBioOn] = useState(false);
  const [bioReady, setBioReady] = useState(false);

  useEffect(() => {
    (async () => {
      const v = await isBiometricLockEnabled();
      setBioOn(v);
      setBioReady(true);
    })();
  }, []);

  const toggleBio = async (next: boolean) => {
    if (Platform.OS === 'web') {
      toast.warning('Biometric lock is only available on the iOS / Android app.');
      return;
    }
    if (next) {
      // Require successful biometric BEFORE enabling, so we never lock the user out.
      const r = await confirmWithBiometric('Confirm to enable biometric lock');
      if (!r.success) {
        if (r.reason === 'no-enrolled') toast.warning('Set up Face ID / Touch ID in iOS Settings first.');
        else if (r.reason === 'unavailable') toast.warning('This device doesn’t support biometric auth.');
        else if (r.reason !== 'cancelled') toast.error('Biometric check failed. Try again.');
        return;
      }
    }
    await setBiometricLockEnabled(next);
    setBioOn(next);
    toast.success(next ? 'Biometric lock turned on.' : 'Biometric lock turned off.');
  };

  const sendReset = async () => {
    if (!user?.email) return;
    setBusy('reset');
    try {
      await api.post('/auth/forgot', { email: user.email });
      Alert.alert('Check your inbox', `We've sent a password reset link to ${user.email}.`);
    } catch (e) {
      Alert.alert("Couldn't send the link", extractErrorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const deleteAccount = () => {
    Alert.alert(
      'Delete account?',
      "This permanently deletes your Wayly account, household, statements, and family thread. This can't be undone.",
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete forever',
          style: 'destructive',
          onPress: async () => {
            setBusy('delete');
            try {
              await api.delete('/auth/account');
              await logout();
              router.replace('/(auth)/login');
            } catch (e) {
              Alert.alert("Couldn't delete", extractErrorMessage(e));
              setBusy(null);
            }
          },
        },
      ]
    );
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <BackHeader title="Security" />
      <ScrollView contentContainerStyle={styles.scroll} testID="security-scroll">
        <View style={styles.card} testID="security-biometric-card">
          <View style={styles.cardHead}>
            <View style={[styles.iconWrap, { backgroundColor: 'rgba(14, 77, 82, 0.08)' }]}>
              <Ionicons name="finger-print" size={20} color={c.brandPrimary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.cardTitle}>Biometric lock</Text>
              <Text style={styles.cardSub}>
                {Platform.OS === 'web'
                  ? 'Only available on the iOS / Android app.'
                  : `Require ${biometryLabel()} to open Wayly.`}
              </Text>
            </View>
            <Switch
              value={bioOn}
              onValueChange={toggleBio}
              disabled={!bioReady || Platform.OS === 'web'}
              trackColor={{ false: c.borderSubtle, true: c.brandPrimary }}
              thumbColor={c.cream}
              testID="security-biometric-switch"
            />
          </View>
          <Text style={styles.helpText}>
            When enabled, you’ll be prompted on every cold start and after 30 seconds in the background.
          </Text>
        </View>

        <View style={styles.card}>
          <View style={styles.cardHead}>
            <View style={[styles.iconWrap, { backgroundColor: 'rgba(14, 77, 82, 0.08)' }]}>
              <Ionicons name="key-outline" size={20} color={c.brandPrimary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.cardTitle}>Reset your password</Text>
              <Text style={styles.cardSub}>We'll email a link to {user?.email || 'you'}.</Text>
            </View>
          </View>
          <TouchableOpacity onPress={sendReset} disabled={busy === 'reset'} style={[styles.btn, busy === 'reset' && { opacity: 0.6 }]} testID="security-send-reset">
            {busy === 'reset' ? <ActivityIndicator color={c.cream} /> : <Text style={styles.btnText}>Send reset link</Text>}
          </TouchableOpacity>
        </View>

        <View style={[styles.card, styles.dangerCard]}>
          <View style={styles.cardHead}>
            <View style={[styles.iconWrap, { backgroundColor: 'rgba(192, 57, 43, 0.1)' }]}>
              <Ionicons name="trash-outline" size={20} color={c.severityAlert} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.cardTitle}>Delete account</Text>
              <Text style={styles.cardSub}>Permanently removes your account and all your data.</Text>
            </View>
          </View>
          <TouchableOpacity onPress={deleteAccount} disabled={busy === 'delete'} style={[styles.dangerBtn, busy === 'delete' && { opacity: 0.6 }]} testID="security-delete-account">
            <Text style={styles.dangerBtnText}>{busy === 'delete' ? 'Deleting…' : 'Delete account'}</Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.footnote}>
          Wayly stores your data in encrypted form on Australian servers. We never sell your information. See our privacy policy in the web account for full details.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

function makeStyles(c: ColorPalette) { return StyleSheet.create({
  safe: { flex: 1, backgroundColor: c.background },
  scroll: { padding: Spacing.lg, paddingBottom: 60 },
  card: { backgroundColor: c.cardBg, borderRadius: Radius.lg, padding: Spacing.lg, borderWidth: 1, borderColor: c.borderSubtle, marginBottom: Spacing.md },
  dangerCard: { borderColor: 'rgba(192, 57, 43, 0.3)', backgroundColor: 'rgba(192, 57, 43, 0.04)' },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, marginBottom: Spacing.md },
  iconWrap: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  cardTitle: { fontFamily: Fonts.bodySemi, fontSize: 16, color: c.brandPrimary },
  cardSub: { fontFamily: Fonts.body, fontSize: 13, color: c.textSecondary, marginTop: 2 },
  btn: { backgroundColor: c.brandPrimary, borderRadius: Radius.md, paddingVertical: 12, alignItems: 'center', minHeight: 46, justifyContent: 'center' },
  btnText: { fontFamily: Fonts.bodySemi, fontSize: 14, color: c.cream },
  dangerBtn: { backgroundColor: c.severityAlert, borderRadius: Radius.md, paddingVertical: 12, alignItems: 'center' },
  dangerBtnText: { fontFamily: Fonts.bodySemi, fontSize: 14, color: c.cream },
  footnote: { fontFamily: Fonts.body, fontSize: 11, color: c.textMuted, textAlign: 'center', marginTop: Spacing.lg, lineHeight: 16 },
  helpText: { fontFamily: Fonts.body, fontSize: 12, color: c.textMuted, marginTop: -Spacing.sm, lineHeight: 16 },
}); }
