// Admin sign-in — step 2: enter 6-digit TOTP code (or 8-char backup code)
import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAdminAuth } from '../../src/context/AdminAuthContext';
import { Colors, Fonts, Radius, Spacing } from '../../src/lib/theme';
import type { ColorPalette } from '../../src/lib/theme';
import { useColors } from '../../src/hooks/useColors';
import { useThemedStyles } from '../../src/hooks/useThemedStyles';
import { toast } from '../../src/components/Toast';

const BASE = process.env.EXPO_PUBLIC_BACKEND_URL;

export default function Admin2FA() {
  const c = useColors();
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const { verify2FA } = useAdminAuth();
  const { temp_token, role } = useLocalSearchParams<{ temp_token: string; role: string }>();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [useBackup, setUseBackup] = useState(false);
  const inputRef = useRef<TextInput | null>(null);

  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 300);
    return () => clearTimeout(t);
  }, []);

  const onSubmit = async () => {
    const cleaned = code.trim().replace(/\s/g, '');
    if (!cleaned) return;
    if (!useBackup && !/^\d{6}$/.test(cleaned)) {
      Alert.alert('Six digits', 'Enter the 6-digit code from your authenticator app.');
      return;
    }
    if (useBackup && cleaned.length !== 8) {
      Alert.alert('Backup codes are 8 characters', 'Each backup code is 8 characters long.');
      return;
    }
    setBusy(true);
    try {
      await verify2FA(temp_token, cleaned);
      router.replace('/admin-app' as any);
    } catch (e: any) {
      Alert.alert("Code didn't match", e.message || 'Try again', [
        { text: 'OK', onPress: () => { setCode(''); inputRef.current?.focus(); } },
      ]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <TouchableOpacity style={styles.back} onPress={() => router.replace('/admin-auth/login' as any)}>
            <Ionicons name="chevron-back" size={20} color={c.brandPrimary} />
            <Text style={styles.backText}>Use a different account</Text>
          </TouchableOpacity>

          <View style={styles.badge}>
            <Ionicons name="shield-checkmark" size={20} color={c.brandSecondary} />
            <Text style={styles.badgeText}>{role || 'staff'}</Text>
          </View>
          <Text style={styles.title}>Verification code</Text>
          <Text style={styles.sub}>
            {useBackup
              ? 'Enter one of your 8-character backup codes.'
              : 'Open your authenticator app and enter the 6-digit code for Wayly Admin.'}
          </Text>

          <TextInput
            ref={inputRef}
            value={code}
            onChangeText={(t) => setCode(useBackup ? t.toUpperCase() : t.replace(/[^\d]/g, ''))}
            placeholder={useBackup ? 'ABCD1234' : '· · · · · ·'}
            placeholderTextColor={c.textMuted}
            keyboardType={useBackup ? 'default' : 'number-pad'}
            maxLength={useBackup ? 8 : 6}
            autoCapitalize="characters"
            autoCorrect={false}
            style={styles.codeInput}
            testID="admin-2fa-code"
          />

          <TouchableOpacity style={[styles.primary, busy && { opacity: 0.6 }]} onPress={onSubmit} disabled={busy} testID="admin-2fa-submit">
            {busy ? <ActivityIndicator color={c.cream} /> : <Text style={styles.primaryText}>Verify</Text>}
          </TouchableOpacity>

          <TouchableOpacity onPress={() => { setUseBackup((b) => !b); setCode(''); }} style={styles.toggle} testID="admin-2fa-toggle-backup">
            <Text style={styles.toggleText}>{useBackup ? 'Use authenticator code instead' : "Can't open your authenticator? Use a backup code"}</Text>
          </TouchableOpacity>

          <DevCodeHint />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

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
        <Ionicons name="construct-outline" size={12} color={c.brandSecondary} />
        <Text style={devStyles.title}>DEV SHORTCUT</Text>
      </View>
      <Text style={devStyles.body}>
        Container clock differs from your phone, so authenticator codes won't match. Tap below to fetch the code computed on the server.
      </Text>
      <TouchableOpacity style={devStyles.btn} onPress={fetchCode} disabled={busy} testID="admin-2fa-devcode">
        {busy ? <ActivityIndicator size="small" color={c.brandPrimary} /> : <Text style={devStyles.btnText}>{code ? `Code: ${code} (refresh)` : 'Show current code'}</Text>}
      </TouchableOpacity>
      {code ? <Text style={devStyles.foot}>Valid for ~{validFor}s. Paste into the input above.</Text> : null}
    </View>
  );
}

const devStyles = StyleSheet.create({
  box: { marginTop: Spacing.lg, padding: Spacing.md, backgroundColor: 'rgba(183, 121, 31, 0.08)', borderRadius: Radius.md, borderWidth: 1, borderColor: 'rgba(183, 121, 31, 0.3)', borderStyle: 'dashed' as any },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 4 },
  title: { fontFamily: Fonts.bodySemi, fontSize: 10, letterSpacing: 1.2, color: Colors.brandSecondary },
  body: { fontFamily: Fonts.body, fontSize: 11, color: Colors.textSecondary, lineHeight: 16, marginBottom: 8 },
  btn: { paddingVertical: 10, borderRadius: Radius.sm, backgroundColor: Colors.cardBg, alignItems: 'center', borderWidth: 1, borderColor: Colors.border, minHeight: 36 },
  btnText: { fontFamily: Fonts.bodySemi, fontSize: 13, color: Colors.brandPrimary, letterSpacing: 0.5 },
  foot: { fontFamily: Fonts.body, fontSize: 10, color: Colors.textMuted, textAlign: 'center', marginTop: 6 },
});

function makeStyles(c: ColorPalette) { return StyleSheet.create({
  safe: { flex: 1, backgroundColor: c.background },
  scroll: { padding: Spacing.lg, gap: 4 },
  back: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', marginBottom: Spacing.lg },
  backText: { fontFamily: Fonts.bodyMed, fontSize: 14, color: c.brandPrimary },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', backgroundColor: 'rgba(183, 121, 31, 0.15)', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 100, marginBottom: Spacing.sm },
  badgeText: { fontFamily: Fonts.bodySemi, fontSize: 11, color: c.brandSecondary, letterSpacing: 0.5, textTransform: 'uppercase' },
  title: { fontFamily: Fonts.heading, fontSize: 28, color: c.brandPrimary, letterSpacing: -0.5, marginBottom: 6 },
  sub: { fontFamily: Fonts.body, fontSize: 13, color: c.textSecondary, marginBottom: Spacing.lg, lineHeight: 19 },
  codeInput: { backgroundColor: c.cardBg, borderRadius: Radius.md, paddingVertical: 16, paddingHorizontal: Spacing.md, fontFamily: Fonts.bodySemi, fontSize: 24, color: c.brandPrimary, borderWidth: 1, borderColor: c.border, textAlign: 'center', letterSpacing: 6, minHeight: 56, marginBottom: Spacing.md },
  primary: { backgroundColor: c.brandPrimary, borderRadius: Radius.md, paddingVertical: 14, alignItems: 'center', minHeight: 48 },
  primaryText: { fontFamily: Fonts.bodySemi, fontSize: 15, color: c.cream },
  toggle: { alignItems: 'center', paddingVertical: Spacing.md, marginTop: Spacing.sm },
  toggleText: { fontFamily: Fonts.bodyMed, fontSize: 13, color: c.brandSecondary, textDecorationLine: 'underline' },
}); }
