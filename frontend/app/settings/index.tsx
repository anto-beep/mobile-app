import React from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Fonts, Radius, Spacing } from '../../src/lib/theme';
import { useAuth } from '../../src/context/AuthContext';
import BackHeader from '../../src/components/BackHeader';

const ITEMS = [
  {
    key: 'plan',
    title: 'Plan & Billing',
    sub: 'View, upgrade, or cancel your Wayly plan',
    icon: 'card-outline',
    color: Colors.brandSecondary,
  },
  {
    key: 'documents',
    title: 'Document vault',
    sub: 'Securely store statements, care plans, assessments',
    icon: 'folder-outline',
    color: Colors.streams['Independence'],
    route: '/documents',
  },
  {
    key: 'adviser',
    title: 'Adviser portal',
    sub: 'Manage your client roster · adviser plan',
    icon: 'briefcase-outline',
    color: Colors.brandPrimary,
    route: '/adviser',
    advisersOnly: true,
  },
  {
    key: 'members',
    title: 'Family members',
    sub: 'Invite family to share the dashboard',
    icon: 'people-outline',
    color: Colors.severityInfo,
  },
  {
    key: 'notifications',
    title: 'Notification preferences',
    sub: 'Choose which alerts reach you',
    icon: 'notifications-outline',
    color: Colors.brandPrimary,
  },
  {
    key: 'usage',
    title: 'Your usage',
    sub: 'Statements decoded · tools used this month',
    icon: 'stats-chart-outline',
    color: Colors.streams.Clinical,
  },
  {
    key: 'security',
    title: 'Security',
    sub: 'Password, account deletion',
    icon: 'shield-checkmark-outline',
    color: Colors.severityAlert,
  },
];

export default function SettingsHome() {
  const router = useRouter();
  const { user } = useAuth();

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <BackHeader title="Settings" />
      <ScrollView contentContainerStyle={styles.scroll} testID="settings-scroll">
        <View style={styles.header}>
          <Text style={styles.userName}>{user?.name || 'Your account'}</Text>
          <Text style={styles.userMeta}>
            {user?.email} · <Text style={styles.bold}>{(user?.plan || 'free').toUpperCase()}</Text>
          </Text>
        </View>

        {ITEMS.filter((it) => !it.advisersOnly || user?.plan === 'adviser').map((item) => (
          <TouchableOpacity
            key={item.key}
            style={styles.row}
            onPress={() => router.push(((item as any).route || `/settings/${item.key}`) as any)}
            testID={`settings-row-${item.key}`}
          >
            <View style={[styles.iconWrap, { backgroundColor: `${item.color}15` }]}>
              <Ionicons name={item.icon as any} size={22} color={item.color} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowTitle}>{item.title}</Text>
              <Text style={styles.rowSub}>{item.sub}</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={Colors.textMuted} />
          </TouchableOpacity>
        ))}

        <Text style={styles.footnote}>
          Wayly is a companion to your aged-care provider — it doesn't replace them. For urgent help, call My Aged Care on 1800 200 422.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.lg, paddingBottom: 60 },
  header: {
    backgroundColor: Colors.cardBg, padding: Spacing.md + 4, borderRadius: Radius.lg,
    borderWidth: 1, borderColor: Colors.borderSubtle, marginBottom: Spacing.lg,
  },
  userName: { fontFamily: Fonts.heading, fontSize: 22, color: Colors.brandPrimary, letterSpacing: -0.3 },
  userMeta: { fontFamily: Fonts.body, fontSize: 13, color: Colors.textSecondary, marginTop: 4 },
  bold: { fontFamily: Fonts.bodySemi, color: Colors.brandSecondary, letterSpacing: 0.5 },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    backgroundColor: Colors.cardBg, borderRadius: Radius.md, padding: Spacing.md + 2,
    marginBottom: Spacing.sm, borderWidth: 1, borderColor: Colors.borderSubtle,
  },
  iconWrap: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },
  rowTitle: { fontFamily: Fonts.bodySemi, fontSize: 15, color: Colors.brandPrimary },
  rowSub: { fontFamily: Fonts.body, fontSize: 12, color: Colors.textSecondary, marginTop: 2 },
  footnote: { fontFamily: Fonts.body, fontSize: 11, color: Colors.textMuted, textAlign: 'center', marginTop: Spacing.lg, lineHeight: 16, paddingHorizontal: Spacing.md },
});
