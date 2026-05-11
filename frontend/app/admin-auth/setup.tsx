// First-time TOTP setup — show QR + manual secret + verify code; afterwards display backup codes once.
import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, Alert, Image, Linking } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { useAdminAuth } from '../../src/context/AdminAuthContext';
import { Colors, Fonts, Radius, Spacing } from '../../src/lib/theme';
import { toast } from '../../src/components/Toast';

const BASE = process.env.EXPO_PUBLIC_BACKEND_URL;

export default function AdminSetup() {
  const router = useRouter();
  const { enable2FA } = useAdminAuth();
  const params = useLocalSearchParams<{ setup_token: string; qr_data_uri: string; secret: string; role: string }>();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState<'scan' | 'verify' | 'codes'>('scan');
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const inputRef = useRef<TextInput | null>(null);

  useEffect(() => {
    if (step === 'verify') {
      const t = setTimeout(() => inputRef.current?.focus(), 300);
      return () => clearTimeout(t);
    }
  }, [step]);

  const onCopySecret = async () => {
    try {
      await Clipboard.setStringAsync(params.secret || '');
      toast.success('Secret copied to clipboard', 2200);
    } catch {}
  };

  const onVerify = async () => {
    const cleaned = code.trim().replace(/\s/g, '');
    if (!/^\d{6}$/.test(cleaned)) {
      Alert.alert('Six digits', 'Enter the 6-digit code from your authenticator.');
      return;
    }
    setBusy(true);
    try {
      const res = await enable2FA(params.setup_token, cleaned);
      setBackupCodes(res.backupCodes);
      setStep('codes');
    } catch (e: any) {
      Alert.alert("Code didn't match", e.message || 'Try again', [
        { text: 'OK', onPress: () => { setCode(''); inputRef.current?.focus(); } },
      ]);
    } finally { setBusy(false); }
  };

  const onCopyBackup = async () => {
    try {
      await Clipboard.setStringAsync(backupCodes.join('\n'));
      toast.success('Backup codes copied', 2200);
    } catch {}
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <View style={styles.badge}>
            <Ionicons name="shield-checkmark" size={20} color={Colors.brandSecondary} />
            <Text style={styles.badgeText}>First-time setup</Text>
          </View>

          {step === 'scan' && (
            <>
              <Text style={styles.title}>Add Wayly to your authenticator</Text>
              <Text style={styles.sub}>Scan the QR code with Google Authenticator, 1Password or any TOTP app.</Text>
              {params.qr_data_uri ? (
                <Image source={{ uri: params.qr_data_uri }} style={styles.qr} />
              ) : null}
              <Text style={styles.helperLabel}>Can’t scan? Type this secret in by hand:</Text>
              <TouchableOpacity onPress={onCopySecret} style={styles.secretBox} testID="copy-secret">
                <Text style={styles.secretText}>{params.secret}</Text>
                <Ionicons name="copy-outline" size={16} color={Colors.brandPrimary} />
              </TouchableOpacity>
              <View style={styles.appLinks}>
                <TouchableOpacity onPress={() => Linking.openURL('https://apps.apple.com/app/google-authenticator/id388497605')} style={styles.appLink}>
                  <Ionicons name="logo-apple-appstore" size={14} color={Colors.brandPrimary} />
                  <Text style={styles.appLinkText}>Authenticator (iOS)</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => Linking.openURL('https://play.google.com/store/apps/details?id=com.google.android.apps.authenticator2')} style={styles.appLink}>
                  <Ionicons name="logo-google-playstore" size={14} color={Colors.brandPrimary} />
                  <Text style={styles.appLinkText}>Authenticator (Android)</Text>
                </TouchableOpacity>
              </View>
              <TouchableOpacity style={styles.primary} onPress={() => setStep('verify')} testID="setup-continue">
                <Text style={styles.primaryText}>I’ve scanned it</Text>
              </TouchableOpacity>
            </>
          )}

          {step === 'verify' && (
            <>
              <Text style={styles.title}>Confirm the code</Text>
              <Text style={styles.sub}>Type the current 6-digit code your authenticator is showing.</Text>
              <TextInput
                ref={inputRef}
                value={code}
                onChangeText={(t) => setCode(t.replace(/[^\d]/g, ''))}
                placeholder="· · · · · ·"
                placeholderTextColor={Colors.textMuted}
                keyboardType="number-pad"
                maxLength={6}
                style={styles.codeInput}
                testID="setup-verify-code"
              />
              <TouchableOpacity style={[styles.primary, busy && { opacity: 0.6 }]} onPress={onVerify} disabled={busy} testID="setup-verify-submit">
                {busy ? <ActivityIndicator color={Colors.cream} /> : <Text style={styles.primaryText}>Verify & finish setup</Text>}
              </TouchableOpacity>
              <TouchableOpacity onPress={() => setStep('scan')} style={styles.toggle}>
                <Text style={styles.toggleText}>Show the QR code again</Text>
              </TouchableOpacity>

              <DevCodeHint />
            </>
          )}

          {step === 'codes' && (
            <>
              <Text style={styles.title}>Save your backup codes</Text>
              <Text style={styles.sub}>Use one of these 8-character codes if you ever lose your authenticator. They’re only shown once.</Text>
              <View style={styles.codesGrid}>
                {backupCodes.map((c) => (
                  <View key={c} style={styles.codeCell}><Text style={styles.codeCellText}>{c}</Text></View>
                ))}
              </View>
              <TouchableOpacity onPress={onCopyBackup} style={styles.secondaryBtn} testID="copy-backup">
                <Ionicons name="copy-outline" size={16} color={Colors.brandPrimary} />
                <Text style={styles.secondaryText}>Copy all codes</Text>
              </TouchableOpacity>
              <View style={styles.warnBox}>
                <Ionicons name="warning-outline" size={14} color={Colors.brandSecondary} />
                <Text style={styles.warnText}>Save these somewhere safe — your password manager, a sealed envelope, anywhere offline. You can’t see them again.</Text>
              </View>
              <TouchableOpacity style={styles.primary} onPress={() => router.replace('/admin-app' as any)} testID="setup-done">
                <Text style={styles.primaryText}>I’ve saved them — continue</Text>
              </TouchableOpacity>
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.lg, gap: 4, paddingBottom: Spacing.xl },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', backgroundColor: 'rgba(212, 162, 78, 0.15)', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 100, marginBottom: Spacing.sm },
  badgeText: { fontFamily: Fonts.bodySemi, fontSize: 11, color: Colors.brandSecondary, letterSpacing: 0.5, textTransform: 'uppercase' },
  title: { fontFamily: Fonts.heading, fontSize: 26, color: Colors.brandPrimary, letterSpacing: -0.5, marginBottom: 6 },
  sub: { fontFamily: Fonts.body, fontSize: 13, color: Colors.textSecondary, marginBottom: Spacing.lg, lineHeight: 19 },
  qr: { width: 240, height: 240, alignSelf: 'center', borderRadius: Radius.md, marginVertical: Spacing.md, backgroundColor: '#fff' },
  helperLabel: { fontFamily: Fonts.bodyMed, fontSize: 11, color: Colors.textMuted, letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 6, marginTop: 8 },
  secretBox: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: Colors.cardBg, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.border, paddingHorizontal: Spacing.md, paddingVertical: 12 },
  secretText: { flex: 1, fontFamily: Fonts.bodySemi, fontSize: 14, color: Colors.brandPrimary, letterSpacing: 1.2 },
  appLinks: { flexDirection: 'row', gap: 8, marginTop: Spacing.md, marginBottom: Spacing.md, flexWrap: 'wrap' },
  appLink: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 100, backgroundColor: 'rgba(31, 58, 95, 0.06)' },
  appLinkText: { fontFamily: Fonts.bodyMed, fontSize: 12, color: Colors.brandPrimary },
  codeInput: { backgroundColor: Colors.cardBg, borderRadius: Radius.md, paddingVertical: 16, paddingHorizontal: Spacing.md, fontFamily: Fonts.bodySemi, fontSize: 24, color: Colors.brandPrimary, borderWidth: 1, borderColor: Colors.border, textAlign: 'center', letterSpacing: 6, minHeight: 56, marginBottom: Spacing.md },
  primary: { backgroundColor: Colors.brandPrimary, borderRadius: Radius.md, paddingVertical: 14, alignItems: 'center', minHeight: 48, marginTop: Spacing.md },
  primaryText: { fontFamily: Fonts.bodySemi, fontSize: 15, color: Colors.cream },
  toggle: { alignItems: 'center', paddingVertical: Spacing.md },
  toggleText: { fontFamily: Fonts.bodyMed, fontSize: 13, color: Colors.brandSecondary, textDecorationLine: 'underline' },
  codesGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginVertical: Spacing.sm },
  codeCell: { flexBasis: '47%', flexGrow: 1, paddingVertical: 10, paddingHorizontal: 14, backgroundColor: Colors.cardBg, borderRadius: Radius.sm, borderWidth: 1, borderColor: Colors.border, alignItems: 'center' },
  codeCellText: { fontFamily: Fonts.bodySemi, fontSize: 14, color: Colors.brandPrimary, letterSpacing: 1.2 },
  secondaryBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 12, borderRadius: Radius.md, backgroundColor: 'rgba(31, 58, 95, 0.06)', marginTop: 8 },
  secondaryText: { fontFamily: Fonts.bodySemi, fontSize: 13, color: Colors.brandPrimary },
  warnBox: { flexDirection: 'row', gap: 8, padding: Spacing.md, backgroundColor: 'rgba(212, 162, 78, 0.1)', borderLeftWidth: 3, borderLeftColor: Colors.brandSecondary, borderRadius: Radius.sm, marginTop: Spacing.md },
  warnText: { flex: 1, fontFamily: Fonts.body, fontSize: 12, color: Colors.brandPrimary, lineHeight: 17 },
});

function DevCodeHint() {
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState<string | null>(null);
  const [validFor, setValidFor] = useState<number | null>(null);
  const fetchCode = async () => {
    setBusy(true);
    try {
      const r = await fetch(`${BASE}/api/admin/auth/dev/current-code?email=hello@techglove.com.au`);
      if (!r.ok) throw new Error('Could not fetch');
      const d = await r.json();
      setCode(d.code);
      setValidFor(d.valid_seconds || 30);
      toast.info('Dev code fetched — paste it above', 4000);
    } catch (e: any) {
      toast.error('Could not fetch dev code');
    } finally { setBusy(false); }
  };
  return (
    <View style={devStyles.box}>
      <View style={devStyles.titleRow}>
        <Ionicons name="construct-outline" size={12} color={Colors.brandSecondary} />
        <Text style={devStyles.title}>DEV SHORTCUT</Text>
      </View>
      <Text style={devStyles.body}>
        Container clock differs from your phone, so authenticator codes won't match. Tap below to fetch the code computed on the server.
      </Text>
      <TouchableOpacity style={devStyles.btn} onPress={fetchCode} disabled={busy} testID="admin-setup-devcode">
        {busy ? <ActivityIndicator size="small" color={Colors.brandPrimary} /> : <Text style={devStyles.btnText}>{code ? `Code: ${code} (refresh)` : 'Show current code'}</Text>}
      </TouchableOpacity>
      {code ? <Text style={devStyles.foot}>Valid for ~{validFor}s. Paste into the input above.</Text> : null}
    </View>
  );
}

const devStyles = StyleSheet.create({
  box: { marginTop: Spacing.lg, padding: Spacing.md, backgroundColor: 'rgba(212, 162, 78, 0.08)', borderRadius: Radius.md, borderWidth: 1, borderColor: 'rgba(212, 162, 78, 0.3)', borderStyle: 'dashed' as any },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 4 },
  title: { fontFamily: Fonts.bodySemi, fontSize: 10, letterSpacing: 1.2, color: Colors.brandSecondary },
  body: { fontFamily: Fonts.body, fontSize: 11, color: Colors.textSecondary, lineHeight: 16, marginBottom: 8 },
  btn: { paddingVertical: 10, borderRadius: Radius.sm, backgroundColor: Colors.cardBg, alignItems: 'center', borderWidth: 1, borderColor: Colors.border, minHeight: 36 },
  btnText: { fontFamily: Fonts.bodySemi, fontSize: 13, color: Colors.brandPrimary, letterSpacing: 0.5 },
  foot: { fontFamily: Fonts.body, fontSize: 10, color: Colors.textMuted, textAlign: 'center', marginTop: 6 },
});
