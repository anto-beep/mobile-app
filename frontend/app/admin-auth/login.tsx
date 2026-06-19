// Admin sign-in — step 1: email + password
import React, { useState } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAdminAuth } from '../../src/context/AdminAuthContext';
import { Fonts, Radius, Spacing } from '../../src/lib/theme';
import type { ColorPalette } from '../../src/lib/theme';
import { useColors } from '../../src/hooks/useColors';
import { useThemedStyles } from '../../src/hooks/useThemedStyles';

export default function AdminLogin() {
  const c = useColors();
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const { login } = useAdminAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [busy, setBusy] = useState(false);

  const onSubmit = async () => {
    if (!email.trim() || !password) {
      Alert.alert('Missing details', 'Email and password are required.');
      return;
    }
    setBusy(true);
    try {
      const res = await login(email, password);
      if (res.kind === '2fa') {
        router.replace({ pathname: '/admin-auth/2fa', params: { temp_token: res.temp_token, role: res.role } });
      } else {
        router.replace({
          pathname: '/admin-auth/setup',
          params: { setup_token: res.setup_token, qr_data_uri: res.qr_data_uri, secret: res.secret, role: res.role },
        });
      }
    } catch (e: any) {
      Alert.alert("Couldn't sign in", e.message || 'Try again');
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <TouchableOpacity style={styles.back} onPress={() => router.replace('/(auth)/login' as any)} testID="admin-login-back">
            <Ionicons name="chevron-back" size={20} color={c.brandPrimary} />
            <Text style={styles.backText}>Back to Wayly</Text>
          </TouchableOpacity>

          <View style={styles.badge}>
            <Ionicons name="shield-checkmark" size={20} color={c.brandSecondary} />
            <Text style={styles.badgeText}>Wayly staff</Text>
          </View>
          <Text style={styles.title}>Admin sign in</Text>
          <Text style={styles.sub}>Two-factor required. If you haven’t set it up yet, we’ll walk you through it.</Text>

          <Text style={styles.label}>Email</Text>
          <TextInput
            value={email}
            onChangeText={setEmail}
            placeholder="name@wayly.com.au"
            placeholderTextColor={c.textMuted}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            style={styles.input}
            testID="admin-email"
          />

          <Text style={styles.label}>Password</Text>
          <View style={styles.pwRow}>
            <TextInput
              value={password}
              onChangeText={setPassword}
              placeholder="Your password"
              placeholderTextColor={c.textMuted}
              secureTextEntry={!showPw}
              autoCapitalize="none"
              autoCorrect={false}
              style={[styles.input, { flex: 1, marginBottom: 0 }]}
              testID="admin-password"
            />
            <TouchableOpacity onPress={() => setShowPw((s) => !s)} hitSlop={12} style={styles.pwToggle} testID="admin-pw-toggle">
              <Ionicons name={showPw ? 'eye-off' : 'eye'} size={18} color={c.textMuted} />
            </TouchableOpacity>
          </View>

          <TouchableOpacity style={[styles.primary, busy && { opacity: 0.6 }]} onPress={onSubmit} disabled={busy} testID="admin-login-submit">
            {busy ? <ActivityIndicator color={c.cream} /> : <Text style={styles.primaryText}>Continue</Text>}
          </TouchableOpacity>

          <View style={styles.foot}>
            <Ionicons name="lock-closed-outline" size={12} color={c.textMuted} />
            <Text style={styles.footText}>Sessions sign out automatically after 30 minutes of inactivity.</Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function makeStyles(c: ColorPalette) { return StyleSheet.create({
  safe: { flex: 1, backgroundColor: c.background },
  scroll: { padding: Spacing.lg, paddingTop: Spacing.md, gap: 4 },
  back: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', marginBottom: Spacing.lg },
  backText: { fontFamily: Fonts.bodyMed, fontSize: 14, color: c.brandPrimary },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', backgroundColor: 'rgba(183, 121, 31, 0.15)', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 100, marginBottom: Spacing.sm },
  badgeText: { fontFamily: Fonts.bodySemi, fontSize: 11, color: c.brandSecondary, letterSpacing: 0.5, textTransform: 'uppercase' },
  title: { fontFamily: Fonts.heading, fontSize: 30, color: c.brandPrimary, letterSpacing: -0.5, marginBottom: 6 },
  sub: { fontFamily: Fonts.body, fontSize: 13, color: c.textSecondary, marginBottom: Spacing.lg, lineHeight: 19 },
  label: { fontFamily: Fonts.bodyMed, fontSize: 12, color: c.textSecondary, marginBottom: 6, marginTop: 6 },
  input: { backgroundColor: c.cardBg, borderRadius: Radius.md, paddingHorizontal: Spacing.md, paddingVertical: 12, fontFamily: Fonts.body, fontSize: 15, color: c.textPrimary, borderWidth: 1, borderColor: c.border, marginBottom: Spacing.sm, minHeight: 48 },
  pwRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: Spacing.sm },
  pwToggle: { padding: 12 },
  primary: { backgroundColor: c.brandPrimary, borderRadius: Radius.md, paddingVertical: 14, alignItems: 'center', marginTop: Spacing.md, minHeight: 48 },
  primaryText: { fontFamily: Fonts.bodySemi, fontSize: 15, color: c.cream },
  foot: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: Spacing.lg },
  footText: { fontFamily: Fonts.body, fontSize: 11, color: c.textMuted, flex: 1 },
}); }
