// Admin app home — Milestone 1 landing. Shows admin info + sign out. Inbox/Triage arrives in Milestone 2.
import React from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useAdminAuth, AdminRole } from '../../src/context/AdminAuthContext';
import { Colors, Fonts, Radius, Spacing } from '../../src/lib/theme';

const ROLE_LABEL: Record<AdminRole, string> = {
  super_admin: 'Super admin',
  operations_admin: 'Operations',
  support_admin: 'Support',
  content_admin: 'Content',
};

export default function AdminHome() {
  const router = useRouter();
  const { admin, logout, touch } = useAdminAuth();

  const onLogout = () => {
    Alert.alert('Sign out?', 'You’ll need to enter your password and authenticator code again.', [
      { text: 'Stay', style: 'cancel' },
      {
        text: 'Sign out',
        style: 'destructive',
        onPress: async () => {
          await logout();
          router.replace('/admin-auth/login' as any);
        },
      },
    ]);
  };

  if (!admin) return null;

  return (
    <SafeAreaView style={styles.safe} edges={['top']} onTouchStart={touch}>
      <ScrollView contentContainerStyle={styles.scroll} testID="admin-home-scroll">
        <View style={styles.headerRow}>
          <View>
            <Text style={styles.overline}>Wayly Admin</Text>
            <Text style={styles.h1}>Welcome, {admin.name.split(' ')[0]}</Text>
          </View>
          <View style={styles.avatar}><Ionicons name="shield-checkmark" size={22} color={Colors.brandSecondary} /></View>
        </View>

        <View style={styles.card}>
          <Text style={styles.label}>Signed in as</Text>
          <Text style={styles.value}>{admin.email}</Text>
          <View style={styles.roleRow}>
            <View style={styles.rolePill}><Text style={styles.rolePillText}>{ROLE_LABEL[admin.admin_role] || admin.admin_role}</Text></View>
            {admin.totp_enabled ? (
              <View style={styles.totpPill}><Ionicons name="checkmark-circle" size={12} color="#3A5A40" /><Text style={styles.totpPillText}>2FA on</Text></View>
            ) : null}
          </View>
        </View>

        <Text style={styles.sectionLabel}>Coming next</Text>
        <View style={styles.tile}>
          <View style={styles.tileIcon}><Ionicons name="headset-outline" size={20} color={Colors.brandSecondary} /></View>
          <View style={{ flex: 1 }}>
            <Text style={styles.tileTitle}>Inbox & triage</Text>
            <Text style={styles.tileBody}>P1 tickets, failed payments, privacy requests, health alerts — all in one feed.</Text>
          </View>
          <View style={styles.soonPill}><Text style={styles.soonPillText}>M2</Text></View>
        </View>
        <View style={styles.tile}>
          <View style={styles.tileIcon}><Ionicons name="people-outline" size={20} color={Colors.brandSecondary} /></View>
          <View style={{ flex: 1 }}>
            <Text style={styles.tileTitle}>User lookup</Text>
            <Text style={styles.tileBody}>Search any user, view profile, suspend or extend trial, send reset.</Text>
          </View>
          <View style={styles.soonPill}><Text style={styles.soonPillText}>M2</Text></View>
        </View>
        <View style={styles.tile}>
          <View style={styles.tileIcon}><Ionicons name="pulse-outline" size={20} color={Colors.brandSecondary} /></View>
          <View style={{ flex: 1 }}>
            <Text style={styles.tileTitle}>Health & maintenance</Text>
            <Text style={styles.tileBody}>Service status, biometric-gated maintenance toggle, audit log.</Text>
          </View>
          <View style={styles.soonPill}><Text style={styles.soonPillText}>M3</Text></View>
        </View>

        <TouchableOpacity style={styles.logoutBtn} onPress={onLogout} testID="admin-logout">
          <Ionicons name="log-out-outline" size={16} color={Colors.brandPrimary} />
          <Text style={styles.logoutText}>Sign out</Text>
        </TouchableOpacity>

        <View style={styles.foot}>
          <Ionicons name="information-circle-outline" size={12} color={Colors.textMuted} />
          <Text style={styles.footText}>Sessions auto-expire after 30 minutes of inactivity.</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.lg, paddingBottom: Spacing.xl, gap: 4 },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: Spacing.lg },
  overline: { fontFamily: Fonts.bodyMed, fontSize: 11, letterSpacing: 1.5, textTransform: 'uppercase', color: Colors.textMuted },
  h1: { fontFamily: Fonts.heading, fontSize: 28, color: Colors.brandPrimary, letterSpacing: -0.5 },
  avatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(212, 162, 78, 0.15)', alignItems: 'center', justifyContent: 'center' },
  card: { backgroundColor: Colors.cardBg, borderRadius: Radius.lg, padding: Spacing.md, borderWidth: 1, borderColor: Colors.borderSubtle, marginBottom: Spacing.lg, gap: 4 },
  label: { fontFamily: Fonts.bodyMed, fontSize: 11, letterSpacing: 0.5, textTransform: 'uppercase', color: Colors.textMuted },
  value: { fontFamily: Fonts.bodySemi, fontSize: 16, color: Colors.brandPrimary },
  roleRow: { flexDirection: 'row', gap: 6, marginTop: 8, flexWrap: 'wrap' },
  rolePill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 100, backgroundColor: Colors.brandSecondary },
  rolePillText: { fontFamily: Fonts.bodySemi, fontSize: 10, color: Colors.brandPrimary, letterSpacing: 0.5, textTransform: 'uppercase' },
  totpPill: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 100, backgroundColor: 'rgba(58, 90, 64, 0.12)' },
  totpPillText: { fontFamily: Fonts.bodySemi, fontSize: 10, color: '#3A5A40', letterSpacing: 0.5, textTransform: 'uppercase' },
  sectionLabel: { fontFamily: Fonts.bodyMed, fontSize: 11, letterSpacing: 1.2, textTransform: 'uppercase', color: Colors.textMuted, marginBottom: 8, marginTop: 4 },
  tile: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: Spacing.md, backgroundColor: Colors.cardBg, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.borderSubtle, marginBottom: Spacing.sm },
  tileIcon: { width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(212, 162, 78, 0.12)', alignItems: 'center', justifyContent: 'center' },
  tileTitle: { fontFamily: Fonts.bodySemi, fontSize: 14, color: Colors.brandPrimary },
  tileBody: { fontFamily: Fonts.body, fontSize: 12, color: Colors.textSecondary, marginTop: 2, lineHeight: 17 },
  soonPill: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 100, backgroundColor: 'rgba(31, 58, 95, 0.06)' },
  soonPillText: { fontFamily: Fonts.bodySemi, fontSize: 10, color: Colors.brandPrimary, letterSpacing: 0.5 },
  logoutBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 14, borderRadius: Radius.md, backgroundColor: Colors.cardBg, borderWidth: 1, borderColor: Colors.border, marginTop: Spacing.md },
  logoutText: { fontFamily: Fonts.bodySemi, fontSize: 14, color: Colors.brandPrimary },
  foot: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: Spacing.lg, justifyContent: 'center' },
  footText: { fontFamily: Fonts.body, fontSize: 11, color: Colors.textMuted },
});
