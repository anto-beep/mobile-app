// More — grouped drawer-like screen accessed from the 4th tab.
// Spec section 5 of MOBILE_AGENT_DASHBOARD_PROMPT.md.
import React, { useRef } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../src/context/AuthContext';
import { useParticipants } from '../src/context/ParticipantsContext';
import { Colors, Fonts, Radius, Spacing, Type } from '../src/lib/theme';
import { WaylyHeader } from '../src/components/WaylyHeader';
import { TrialCountdownBanner } from '../src/components/TrialCountdownBanner';

type Item = {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  href: string;
  testID?: string;
  badge?: string;
};

type Group = { title: string; items: Item[] };

export default function More() {
  const scrollRef = useRef<ScrollView>(null);
  // Tab scroll-to-top — wired in (tabs)/more.tsx wrapper if needed.
  const router = useRouter();
  const { user, logout } = useAuth();
  const { summary } = useParticipants();
  const isAdmin = !!user?.is_admin;
  const groups: Group[] = [
    { title: 'Today', items: [
      { label: 'Dashboard', icon: 'sunny-outline', href: '/(tabs)/today', testID: 'more-link-dashboard' },
      { label: 'Family Wall', icon: 'people-circle-outline', href: '/family-wall', testID: 'more-link-family-wall' },
      { label: 'Ask Wayly', icon: 'chatbubbles-outline', href: '/(tabs)/chat', testID: 'more-link-ask-wayly' },
    ]},
    { title: 'Money & Statements', items: [
      { label: 'Statements', icon: 'document-text-outline', href: '/(tabs)/statements', testID: 'more-link-statements' },
      { label: 'Budget Alerts', icon: 'alert-circle-outline', href: '/budget-alerts', testID: 'more-link-budget-alerts' },
      { label: 'Reports', icon: 'bar-chart-outline', href: '/reports', testID: 'more-link-reports' },
    ]},
    { title: 'Their Care', items: [
      { label: 'Care Team', icon: 'people-outline', href: '/(tabs)/family', testID: 'more-link-care-team' },
      { label: 'Calendar', icon: 'calendar-outline', href: '/visits', testID: 'more-link-calendar' },
      { label: 'Hospital Mode', icon: 'medkit-outline', href: '/hospital', testID: 'more-link-hospital' },
      { label: 'AT & HM', icon: 'construct-outline', href: '/at-hm', testID: 'more-link-at-hm' },
      { label: 'Care-Plan Changes', icon: 'create-outline', href: '/amendments', testID: 'more-link-amendments' },
      { label: 'Log a scenario', icon: 'flag-outline', href: '/log-scenario', testID: 'more-link-log-scenario' },
      { label: 'Timeline', icon: 'time-outline', href: '/timeline', testID: 'more-link-timeline' },
    ]},
    { title: 'Providers & Paperwork', items: [
      { label: 'Documents', icon: 'folder-outline', href: '/documents', testID: 'more-link-documents' },
      { label: 'Correspondence', icon: 'mail-outline', href: '/correspondence', testID: 'more-link-correspondence' },
      { label: 'Switch Provider', icon: 'swap-horizontal-outline', href: '/provider-switch', testID: 'more-link-provider-switch' },
      { label: 'Ratings', icon: 'star-outline', href: '/ratings', testID: 'more-link-ratings' },
    ]},
    { title: 'Your Account', items: [
      { label: 'Participants', icon: 'people-outline', href: '/participants', testID: 'more-link-participants', badge: summary ? `${summary.participants_active}/${summary.participants_max}` : undefined },
      { label: 'Referrals', icon: 'gift-outline', href: '/referrals', testID: 'more-link-referrals' },
      { label: 'Audit Log', icon: 'shield-checkmark-outline', href: '/audit', testID: 'more-link-audit' },
      { label: 'Plan & Billing', icon: 'card-outline', href: '/settings/plan', testID: 'more-link-plan', badge: summary?.base_plan },
      { label: 'Settings', icon: 'settings-outline', href: '/settings', testID: 'more-link-settings' },
      { label: 'Help', icon: 'help-circle-outline', href: '/(tabs)/chat', testID: 'more-link-help' },
      { label: 'Search', icon: 'search-outline', href: '/search', testID: 'more-link-search' },
      // Diagnostics: admin-only — non-admin users should never see this row.
      ...(isAdmin ? [{ label: 'Diagnostics', icon: 'pulse-outline' as const, href: '/diagnostics', testID: 'more-link-diagnostics' }] : []),
    ]},
  ];

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <WaylyHeader />
      <TrialCountdownBanner />
      <ScrollView ref={scrollRef} contentContainerStyle={{ paddingBottom: 40 }}>
        <View style={styles.head}>
          <Text style={Type.h1 as any}>More</Text>
          {!!user && <Text style={styles.meta}>Signed in as {user.name}</Text>}
        </View>
        {groups.map((g) => (
          <View key={g.title} style={styles.group}>
            <Text style={styles.groupTitle}>{g.title}</Text>
            <View style={styles.list}>
              {g.items.map((it, idx) => (
                <TouchableOpacity
                  key={it.label}
                  testID={it.testID}
                  style={[styles.row, idx === g.items.length - 1 && styles.rowLast]}
                  onPress={() => router.push(it.href as any)}
                  accessibilityRole="link"
                >
                  <View style={styles.iconWrap}>
                    <Ionicons name={it.icon} size={20} color={Colors.brandPrimary} />
                  </View>
                  <Text style={styles.rowLabel}>{it.label}</Text>
                  {!!it.badge && <View style={styles.badge}><Text style={styles.badgeText}>{it.badge}</Text></View>}
                  <Ionicons name="chevron-forward" size={18} color={Colors.textMuted} />
                </TouchableOpacity>
              ))}
            </View>
          </View>
        ))}
        <TouchableOpacity style={styles.signout} onPress={async () => { await logout(); router.replace('/login' as any); }}>
          <Ionicons name="log-out-outline" size={18} color={Colors.brandSecondary} />
          <Text style={styles.signoutText}>Sign out</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.bg },
  head: { paddingHorizontal: Spacing.lg, paddingTop: Spacing.lg, paddingBottom: 6, gap: 4 },
  meta: { ...Type.caption, color: Colors.textSecondary },
  group: { marginTop: 18 },
  groupTitle: { ...Type.caption, color: Colors.textMuted, fontFamily: Fonts.bodySemi, textTransform: 'uppercase', letterSpacing: 0.8, paddingHorizontal: Spacing.lg, paddingBottom: 6 },
  list: { backgroundColor: Colors.cardBg, borderRadius: Radius.lg, marginHorizontal: Spacing.md, borderWidth: 1, borderColor: Colors.border, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: Spacing.md, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: Colors.border },
  rowLast: { borderBottomWidth: 0 },
  iconWrap: { width: 32, height: 32, borderRadius: 8, backgroundColor: 'rgba(14,77,82,0.07)', alignItems: 'center', justifyContent: 'center' },
  rowLabel: { flex: 1, ...Type.bodySemi, color: Colors.textPrimary },
  badge: { backgroundColor: 'rgba(14,77,82,0.08)', borderRadius: 9999, paddingHorizontal: 8, paddingVertical: 2 },
  badgeText: { color: Colors.brandPrimary, fontFamily: Fonts.bodySemi, fontSize: 11, fontWeight: '700' },
  signout: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 26, paddingVertical: 14 },
  signoutText: { color: Colors.brandSecondary, fontFamily: Fonts.bodySemi, fontWeight: '700' },
});
