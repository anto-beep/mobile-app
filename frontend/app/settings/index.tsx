// Phase E — Settings landing screen with all 11 sub-tabs grouped by purpose.
import React from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Fonts, Radius, Spacing, Type } from '../../src/lib/theme';
import { useAuth } from '../../src/context/AuthContext';
import BackHeader from '../../src/components/BackHeader';

type Item = {
  key: string;
  title: string;
  sub: string;
  icon: keyof typeof Ionicons.glyphMap;
  href?: string;
  advisersOnly?: boolean;
  testID?: string;
};

const GROUPS: Array<{ title: string; items: Item[] }> = [
  { title: 'Account', items: [
    { key: 'profile', title: 'Profile', sub: 'Your name and email', icon: 'person-outline', href: '/settings/profile', testID: 'settings-link-profile' },
    { key: 'plan', title: 'Plan & billing', sub: 'Switch plan, manage trial, billing history', icon: 'card-outline', href: '/settings/plan' },
    { key: 'members', title: 'Family members', sub: 'Invite family to share the dashboard', icon: 'people-outline', href: '/settings/members' },
    { key: 'security', title: 'Security', sub: 'Biometric lock, sessions, password', icon: 'shield-outline', href: '/settings/security' },
  ]},
  { title: 'Notifications', items: [
    { key: 'notifications', title: 'Push & in-app', sub: 'Anomaly alerts, family wall, weekly digest', icon: 'notifications-outline', href: '/settings/notifications' },
    { key: 'sms', title: 'SMS', sub: 'Urgent + billing receipts', icon: 'chatbox-outline', href: '/settings/sms', testID: 'settings-link-sms' },
    { key: 'digest', title: 'Digest', sub: 'Weekly / monthly / off', icon: 'calendar-outline', href: '/settings/digest', testID: 'settings-link-digest' },
  ]},
  { title: 'Experience', items: [
    { key: 'appearance', title: 'Appearance', sub: 'Text size, reduced motion', icon: 'color-palette-outline', href: '/settings/appearance', testID: 'settings-link-appearance' },
    { key: 'usage', title: 'Your usage', sub: 'Storage, AI quota, monthly stats', icon: 'pie-chart-outline', href: '/settings/usage' },
    { key: 'reports', title: 'Summary report', sub: 'On-demand PDF generator', icon: 'document-text-outline', href: '/settings/reports' },
  ]},
  { title: 'Danger zone', items: [
    { key: 'danger', title: 'Danger zone', sub: 'Sign out everywhere, delete account', icon: 'warning-outline', href: '/settings/danger', testID: 'settings-link-danger' },
  ]},
];

const ADVISER_ITEM: Item = { key: 'adviser', title: 'Adviser portal', sub: 'Manage your client roster', icon: 'briefcase-outline', href: '/adviser', advisersOnly: true };

export default function Settings() {
  const router = useRouter();
  const { user } = useAuth();
  const isAdviser = user?.role === 'participant'; // role==='participant' in current schema means adviser; harmless if false

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <BackHeader title="Settings" />
      <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
        {GROUPS.map((g) => (
          <View key={g.title} style={styles.group}>
            <Text style={styles.groupTitle}>{g.title}</Text>
            <View style={styles.list}>
              {g.items.map((it, idx) => (
                <TouchableOpacity
                  key={it.key}
                  style={[styles.row, idx === g.items.length - 1 && styles.rowLast]}
                  onPress={() => it.href && router.push(it.href as any)}
                  testID={it.testID}
                >
                  <View style={styles.iconWrap}>
                    <Ionicons name={it.icon} size={18} color={Colors.brandPrimary} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.title}>{it.title}</Text>
                    <Text style={styles.sub}>{it.sub}</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={Colors.textMuted} />
                </TouchableOpacity>
              ))}
            </View>
          </View>
        ))}
        {isAdviser && (
          <View style={styles.group}>
            <Text style={styles.groupTitle}>Adviser</Text>
            <View style={styles.list}>
              <TouchableOpacity style={[styles.row, styles.rowLast]} onPress={() => router.push(ADVISER_ITEM.href as any)}>
                <View style={styles.iconWrap}>
                  <Ionicons name={ADVISER_ITEM.icon} size={18} color={Colors.brandPrimary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.title}>{ADVISER_ITEM.title}</Text>
                  <Text style={styles.sub}>{ADVISER_ITEM.sub}</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={Colors.textMuted} />
              </TouchableOpacity>
            </View>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  group: { marginTop: 18 },
  groupTitle: { ...Type.caption, color: Colors.textMuted, fontFamily: Fonts.bodySemi, textTransform: 'uppercase', letterSpacing: 0.8, paddingHorizontal: Spacing.lg, paddingBottom: 6 },
  list: { backgroundColor: Colors.cardBg, borderRadius: Radius.lg, marginHorizontal: Spacing.md, borderWidth: 1, borderColor: Colors.border, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: Spacing.md, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: Colors.border },
  rowLast: { borderBottomWidth: 0 },
  iconWrap: { width: 32, height: 32, borderRadius: 8, backgroundColor: 'rgba(14,77,82,0.07)', alignItems: 'center', justifyContent: 'center' },
  title: { ...Type.bodySemi, color: Colors.textPrimary },
  sub: { ...Type.caption, color: Colors.textSecondary, marginTop: 3, lineHeight: 17 },
});
