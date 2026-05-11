// Admin overview — GET /api/admin/analytics + 2x2 stat grid + breakdowns
import React, { useCallback, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, ActivityIndicator, RefreshControl, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { api, extractErrorMessage } from '../../../src/lib/api';
import { Colors, Fonts, Radius, Spacing, formatAUD } from '../../../src/lib/theme';
import { toast } from '../../../src/components/Toast';

type Analytics = {
  total_users?: number;
  new_users_this_week?: number;
  total_households?: number;
  total_statements?: number;
  new_statements_this_week?: number;
  total_revenue?: number;
  plans?: { plan: string; count: number }[];
  subscriptions?: { status: string; count: number }[];
  top_households?: { id: string; participant_name: string; member_count: number; statement_count: number }[];
};

export default function AdminOverview() {
  const router = useRouter();
  const [data, setData] = useState<Analytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const { data } = await api.get<Analytics>('/admin/analytics');
      setData(data);
    } catch (e) {
      toast.error(extractErrorMessage(e));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  if (loading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.fill}><ActivityIndicator color={Colors.brandPrimary} size="large" /></View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={Colors.brandPrimary} />}
        testID="admin-overview-scroll"
      >
        <Text style={styles.overline}>Admin</Text>
        <Text style={styles.h1}>Overview</Text>
        <Text style={styles.sub}>System-wide stats. Pull to refresh.</Text>

        {/* 2x2 grid */}
        <View style={styles.grid}>
          <StatCard
            icon="people-outline"
            label="Total users"
            value={String(data?.total_users ?? 0)}
            delta={data?.new_users_this_week ? `+${data.new_users_this_week} this week` : null}
            onPress={() => router.push('/(tabs)/admin/users' as any)}
            testID="stat-users"
          />
          <StatCard
            icon="home-outline"
            label="Households"
            value={String(data?.total_households ?? 0)}
            onPress={() => router.push('/(tabs)/admin/households' as any)}
            testID="stat-households"
          />
          <StatCard
            icon="document-text-outline"
            label="Statements decoded"
            value={String(data?.total_statements ?? 0)}
            delta={data?.new_statements_this_week ? `+${data.new_statements_this_week} this week` : null}
            onPress={() => router.push('/(tabs)/admin/statements' as any)}
            testID="stat-statements"
          />
          <StatCard
            icon="cash-outline"
            label="Revenue paid"
            value={formatAUD(data?.total_revenue ?? 0)}
            onPress={() => router.push('/(tabs)/admin/payments' as any)}
            testID="stat-revenue"
          />
        </View>

        {/* Plans */}
        <Section title="Plans breakdown">
          {(data?.plans || []).length === 0 ? (
            <Text style={styles.empty}>No plan data yet.</Text>
          ) : (
            data!.plans!.map((p) => (
              <BreakdownRow key={p.plan} label={p.plan} value={p.count} />
            ))
          )}
        </Section>

        {/* Subscriptions */}
        <Section title="Subscriptions">
          {(data?.subscriptions || []).length === 0 ? (
            <Text style={styles.empty}>No subscriptions yet.</Text>
          ) : (
            data!.subscriptions!.map((s) => (
              <BreakdownRow key={s.status} label={s.status} value={s.count} />
            ))
          )}
        </Section>

        {/* Top households */}
        <Section title="Top active households">
          {(data?.top_households || []).length === 0 ? (
            <Text style={styles.empty}>No households yet.</Text>
          ) : (
            data!.top_households!.map((h) => (
              <View key={h.id} style={styles.householdRow} testID={`top-household-${h.id}`}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.householdName}>{h.participant_name || 'Unnamed'}</Text>
                  <Text style={styles.householdMeta}>
                    {h.member_count} {h.member_count === 1 ? 'member' : 'members'} · {h.statement_count} {h.statement_count === 1 ? 'statement' : 'statements'}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color={Colors.textMuted} />
              </View>
            ))
          )}
        </Section>

        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

function StatCard({ icon, label, value, delta, onPress, testID }: { icon: any; label: string; value: string; delta?: string | null; onPress?: () => void; testID?: string }) {
  return (
    <TouchableOpacity style={styles.statCard} onPress={onPress} activeOpacity={0.8} testID={testID}>
      <View style={styles.statIconWrap}>
        <Ionicons name={icon} size={18} color={Colors.brandSecondary} />
      </View>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue}>{value}</Text>
      {delta ? <Text style={styles.statDelta}>{delta}</Text> : null}
    </TouchableOpacity>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.sectionBody}>{children}</View>
    </View>
  );
}

function BreakdownRow({ label, value }: { label: string; value: number }) {
  return (
    <View style={styles.breakdownRow}>
      <Text style={styles.breakdownLabel}>{label}</Text>
      <Text style={styles.breakdownValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  fill: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scroll: { padding: Spacing.lg, paddingBottom: Spacing.xl },
  overline: { fontFamily: Fonts.bodyMed, fontSize: 11, letterSpacing: 1.5, textTransform: 'uppercase', color: Colors.textMuted },
  h1: { fontFamily: Fonts.heading, fontSize: 30, color: Colors.brandPrimary, letterSpacing: -0.5 },
  sub: { fontFamily: Fonts.body, fontSize: 13, color: Colors.textSecondary, marginTop: 4, marginBottom: Spacing.lg },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm, marginBottom: Spacing.lg },
  statCard: { flexBasis: '48%', flexGrow: 1, backgroundColor: Colors.cardBg, borderRadius: Radius.lg, padding: Spacing.md, borderWidth: 1, borderColor: Colors.borderSubtle, gap: 4 },
  statIconWrap: { width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(212, 162, 78, 0.12)', alignItems: 'center', justifyContent: 'center', marginBottom: 6 },
  statLabel: { fontFamily: Fonts.bodyMed, fontSize: 11, letterSpacing: 0.5, textTransform: 'uppercase', color: Colors.textMuted },
  statValue: { fontFamily: Fonts.heading, fontSize: 24, color: Colors.brandPrimary, letterSpacing: -0.5 },
  statDelta: { fontFamily: Fonts.bodyMed, fontSize: 11, color: Colors.streams.Clinical },
  section: { marginBottom: Spacing.lg },
  sectionTitle: { fontFamily: Fonts.bodyMed, fontSize: 11, letterSpacing: 1.2, textTransform: 'uppercase', color: Colors.textMuted, marginBottom: Spacing.sm },
  sectionBody: { backgroundColor: Colors.cardBg, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.borderSubtle, padding: Spacing.sm },
  breakdownRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: Spacing.sm, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: Colors.borderSubtle },
  breakdownLabel: { fontFamily: Fonts.bodyMed, fontSize: 14, color: Colors.brandPrimary, textTransform: 'capitalize' },
  breakdownValue: { fontFamily: Fonts.bodySemi, fontSize: 14, color: Colors.brandSecondary },
  householdRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingHorizontal: Spacing.sm, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: Colors.borderSubtle },
  householdName: { fontFamily: Fonts.bodySemi, fontSize: 14, color: Colors.brandPrimary },
  householdMeta: { fontFamily: Fonts.body, fontSize: 12, color: Colors.textSecondary, marginTop: 2 },
  empty: { fontFamily: Fonts.body, fontSize: 13, color: Colors.textMuted, padding: Spacing.md, textAlign: 'center' },
});
