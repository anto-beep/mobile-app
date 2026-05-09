import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { api, extractErrorMessage } from '../../src/lib/api';
import { Colors, Fonts, formatAUD, formatAUD2, Radius, Spacing } from '../../src/lib/theme';
import { useAuth } from '../../src/context/AuthContext';
import UploadSheet from '../../src/components/UploadSheet';
import { registerForPushNotifications } from '../../src/lib/push';

type StreamRow = {
  stream: string;
  allocated: number;
  spent: number;
  remaining: number;
  pct: number;
};

type Budget = {
  participant_name: string;
  classification_label: string;
  quarter_label: string;
  quarterly_total: number;
  spent_this_quarter: number;
  remaining_this_quarter: number;
  burn_pct: number;
  streams: StreamRow[];
  lifetime_cap: number;
  lifetime_contributions: number;
  lifetime_pct: number;
  alert_count: number;
  statement_count: number;
  latest_statement: null | {
    id: string;
    period_label: string;
    summary: string;
    anomaly_count: number;
    line_item_count: number;
  };
};

export default function Today() {
  const router = useRouter();
  const { user } = useAuth();
  const [budget, setBudget] = useState<Budget | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    try {
      setError(null);
      const [bRes, nRes] = await Promise.all([
        api.get<Budget>('/budget/current'),
        api.get('/notifications').catch(() => ({ data: { items: [], unread: 0 } })),
      ]);
      setBudget(bRes.data);
      setUnread(nRes.data?.unread || 0);
    } catch (e: any) {
      setError(extractErrorMessage(e, 'Could not load your dashboard'));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useFocusEffect(
    useCallback(() => {
      load();
    }, [])
  );

  useEffect(() => {
    // Register for push (best-effort) on mount
    registerForPushNotifications().catch(() => {});
  }, []);

  const onRefresh = () => {
    setRefreshing(true);
    load();
  };

  const noHousehold =
    error?.toLowerCase().includes('no household') ||
    error?.toLowerCase().includes('household');

  if (loading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.loadingFill}>
          <ActivityIndicator size="large" color={Colors.brandPrimary} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.brandPrimary} />}
        testID="today-scroll"
      >
        {/* Header — greeting + bell */}
        <View style={styles.header}>
          <View style={{ flex: 1 }}>
            <Text style={styles.overline}>Wellbeing summary</Text>
            <Text style={styles.greeting} testID="today-greeting">
              {budget?.participant_name ? `${budget.participant_name}, this quarter` : `Hello, ${user?.name?.split(' ')[0] || ''}`}
            </Text>
            {budget && (
              <Text style={styles.subline}>
                {budget.quarter_label} · {budget.classification_label}
              </Text>
            )}
          </View>
          <TouchableOpacity
            testID="header-notification-bell"
            onPress={() => router.push('/(tabs)/notifications' as any)}
            style={styles.bell}
          >
            <Ionicons name="notifications-outline" size={22} color={Colors.brandPrimary} />
            {unread > 0 && <View style={styles.bellDot} />}
          </TouchableOpacity>
        </View>

        {error && !budget && (
          <View style={styles.emptyCard} testID="today-error-card">
            <Text style={styles.emptyTitle}>
              {noHousehold ? 'Set up your household first' : 'We couldn\'t load your dashboard'}
            </Text>
            <Text style={styles.emptyBody}>
              {noHousehold
                ? 'Wayly works best once you tell us about your parent. Open the Profile tab to add their name and classification level.'
                : error}
            </Text>
            <TouchableOpacity
              style={styles.emptyBtn}
              onPress={() => router.push('/(tabs)/profile' as any)}
              testID="today-go-to-profile"
            >
              <Text style={styles.emptyBtnText}>Open profile</Text>
            </TouchableOpacity>
          </View>
        )}

        {budget && (
          <>
            {/* Hero — this quarter remaining */}
            <View style={styles.heroCard} testID="today-budget-summary">
              <Text style={styles.heroOverline}>Remaining this quarter</Text>
              <Text style={styles.heroAmount} testID="today-budget-remaining">
                {formatAUD(budget.remaining_this_quarter)}
              </Text>
              <Text style={styles.heroSub}>
                of {formatAUD(budget.quarterly_total)} ·{' '}
                <Text style={styles.heroSubBold}>{formatAUD(budget.spent_this_quarter)} spent</Text>
              </Text>
              <View style={styles.progressTrack}>
                <View
                  style={[
                    styles.progressFill,
                    { width: `${Math.min(100, budget.burn_pct)}%` },
                  ]}
                />
              </View>
              <Text style={styles.progressLabel}>{budget.burn_pct.toFixed(1)}% used</Text>
            </View>

            {/* Two stat cards: alerts + lifetime cap */}
            <View style={styles.statRow}>
              <TouchableOpacity
                onPress={() => router.push('/(tabs)/notifications' as any)}
                style={[styles.statCard, budget.alert_count > 0 && styles.statCardAlert]}
                testID="today-alert-chip"
              >
                <View style={styles.statHeader}>
                  <Ionicons
                    name="alert-circle-outline"
                    size={16}
                    color={budget.alert_count > 0 ? Colors.severityAlert : Colors.textMuted}
                  />
                  <Text style={styles.statOverline}>Alerts</Text>
                </View>
                <Text
                  style={[
                    styles.statValue,
                    budget.alert_count > 0 && { color: Colors.severityAlert },
                  ]}
                >
                  {budget.alert_count}
                </Text>
                <Text style={styles.statHint}>
                  {budget.alert_count === 0 ? 'Nothing unusual' : 'Things to review'}
                </Text>
              </TouchableOpacity>

              <View style={styles.statCard} testID="today-lifetime-cap-bar">
                <View style={styles.statHeader}>
                  <Ionicons name="trending-up-outline" size={16} color={Colors.textMuted} />
                  <Text style={styles.statOverline}>Lifetime cap</Text>
                </View>
                <Text style={styles.statValue}>{budget.lifetime_pct.toFixed(1)}%</Text>
                <Text style={styles.statHint}>
                  used of {formatAUD(budget.lifetime_cap)}
                </Text>
              </View>
            </View>

            {/* Stream breakdown */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Spending by stream</Text>
              {budget.streams.map((s) => (
                <View key={s.stream} style={styles.streamRow} testID={`today-stream-${s.stream}`}>
                  <View style={styles.streamHead}>
                    <View style={styles.streamLabel}>
                      <View
                        style={[
                          styles.streamDot,
                          { backgroundColor: Colors.streams[s.stream] },
                        ]}
                      />
                      <Text style={styles.streamName}>{s.stream}</Text>
                    </View>
                    <Text style={styles.streamAmt}>
                      {formatAUD(s.spent)}{' '}
                      <Text style={styles.streamMuted}>/ {formatAUD(s.allocated)}</Text>
                    </Text>
                  </View>
                  <View style={styles.streamTrack}>
                    <View
                      style={[
                        styles.streamFill,
                        {
                          width: `${Math.min(100, s.pct)}%`,
                          backgroundColor: Colors.streams[s.stream],
                        },
                      ]}
                    />
                  </View>
                </View>
              ))}
            </View>

            {/* Latest statement card */}
            {budget.latest_statement && (
              <TouchableOpacity
                style={styles.latestCard}
                onPress={() => router.push(`/statements/${budget.latest_statement!.id}` as any)}
                testID="today-latest-statement-card"
              >
                <View style={styles.latestHead}>
                  <Text style={styles.overline}>Latest statement</Text>
                  <Ionicons name="chevron-forward" size={18} color={Colors.textMuted} />
                </View>
                <Text style={styles.latestTitle}>{budget.latest_statement.period_label}</Text>
                {budget.latest_statement.summary && (
                  <Text style={styles.latestSummary} numberOfLines={3}>
                    {budget.latest_statement.summary}
                  </Text>
                )}
                <View style={styles.latestMeta}>
                  <Text style={styles.latestMetaText}>
                    {budget.latest_statement.line_item_count} line items
                  </Text>
                  {budget.latest_statement.anomaly_count > 0 && (
                    <View style={styles.anomalyBadge}>
                      <Ionicons name="alert-circle" size={12} color={Colors.severityAlert} />
                      <Text style={styles.anomalyBadgeText}>
                        {budget.latest_statement.anomaly_count} alert
                        {budget.latest_statement.anomaly_count > 1 ? 's' : ''}
                      </Text>
                    </View>
                  )}
                </View>
              </TouchableOpacity>
            )}

            {!budget.latest_statement && (
              <View style={styles.emptyStmt} testID="today-empty-statements">
                <Ionicons name="document-text-outline" size={28} color={Colors.textMuted} />
                <Text style={styles.emptyStmtTitle}>No statements yet</Text>
                <Text style={styles.emptyStmtBody}>
                  Tap the camera button below to snap your first statement.
                </Text>
              </View>
            )}
          </>
        )}

        <View style={{ height: 80 }} />
      </ScrollView>

      {/* FAB */}
      <TouchableOpacity
        style={styles.fab}
        onPress={() => setUploadOpen(true)}
        testID="upload-fab"
      >
        <Ionicons name="camera" size={26} color={Colors.cream} />
      </TouchableOpacity>

      <UploadSheet visible={uploadOpen} onClose={() => setUploadOpen(false)} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  loadingFill: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scroll: { padding: Spacing.lg, paddingBottom: 100 },
  header: { flexDirection: 'row', alignItems: 'flex-end', marginBottom: Spacing.lg },
  overline: {
    fontFamily: Fonts.bodyMed, fontSize: 11, letterSpacing: 1.5, textTransform: 'uppercase',
    color: Colors.textMuted, marginBottom: 4,
  },
  greeting: { fontFamily: Fonts.heading, fontSize: 26, color: Colors.brandPrimary, letterSpacing: -0.5 },
  subline: { fontFamily: Fonts.body, fontSize: 13, color: Colors.textSecondary, marginTop: 4 },
  bell: {
    width: 42, height: 42, borderRadius: 21, backgroundColor: Colors.cardBg,
    alignItems: 'center', justifyContent: 'center', marginLeft: Spacing.md,
    borderWidth: 1, borderColor: Colors.border,
  },
  bellDot: {
    position: 'absolute', top: 8, right: 9, width: 10, height: 10, borderRadius: 5,
    backgroundColor: Colors.severityAlert, borderWidth: 2, borderColor: Colors.cardBg,
  },

  // Hero
  heroCard: {
    backgroundColor: Colors.cardBg, borderRadius: Radius.xl, padding: Spacing.lg,
    borderWidth: 1, borderColor: Colors.borderSubtle, marginBottom: Spacing.md,
    shadowColor: Colors.brandPrimary, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.05, shadowRadius: 8, elevation: 2,
  },
  heroOverline: {
    fontFamily: Fonts.bodyMed, fontSize: 11, letterSpacing: 1.5, textTransform: 'uppercase',
    color: Colors.textSecondary, marginBottom: Spacing.sm,
  },
  heroAmount: { fontFamily: Fonts.heading, fontSize: 44, color: Colors.brandPrimary, letterSpacing: -1 },
  heroSub: { fontFamily: Fonts.body, fontSize: 13, color: Colors.textSecondary, marginTop: 4 },
  heroSubBold: { fontFamily: Fonts.bodySemi, color: Colors.brandPrimary },
  progressTrack: {
    marginTop: Spacing.md, height: 6, backgroundColor: 'rgba(31, 58, 95, 0.08)',
    borderRadius: 3, overflow: 'hidden',
  },
  progressFill: { height: '100%', backgroundColor: Colors.brandSecondary },
  progressLabel: { fontFamily: Fonts.bodyMed, fontSize: 11, color: Colors.textMuted, marginTop: 6 },

  // Stat row
  statRow: { flexDirection: 'row', gap: Spacing.md, marginBottom: Spacing.lg },
  statCard: {
    flex: 1, backgroundColor: Colors.cardBg, borderRadius: Radius.lg,
    padding: Spacing.md, borderWidth: 1, borderColor: Colors.borderSubtle,
  },
  statCardAlert: { borderColor: 'rgba(160, 85, 69, 0.3)', backgroundColor: 'rgba(160, 85, 69, 0.04)' },
  statHeader: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  statOverline: {
    fontFamily: Fonts.bodyMed, fontSize: 10, letterSpacing: 1, textTransform: 'uppercase',
    color: Colors.textMuted,
  },
  statValue: { fontFamily: Fonts.heading, fontSize: 28, color: Colors.brandPrimary, marginTop: 6 },
  statHint: { fontFamily: Fonts.body, fontSize: 11, color: Colors.textSecondary, marginTop: 2 },

  // Streams
  section: { marginBottom: Spacing.lg },
  sectionTitle: {
    fontFamily: Fonts.headingMed, fontSize: 16, color: Colors.brandPrimary, marginBottom: Spacing.md,
  },
  streamRow: {
    backgroundColor: Colors.cardBg, borderRadius: Radius.md, padding: Spacing.md,
    marginBottom: Spacing.sm, borderWidth: 1, borderColor: Colors.borderSubtle,
  },
  streamHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  streamLabel: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  streamDot: { width: 10, height: 10, borderRadius: 5 },
  streamName: { fontFamily: Fonts.bodySemi, fontSize: 14, color: Colors.brandPrimary },
  streamAmt: { fontFamily: Fonts.bodyMed, fontSize: 13, color: Colors.brandPrimary },
  streamMuted: { color: Colors.textSecondary, fontFamily: Fonts.body },
  streamTrack: { height: 4, backgroundColor: 'rgba(31, 58, 95, 0.06)', borderRadius: 2, overflow: 'hidden' },
  streamFill: { height: '100%' },

  // Latest statement
  latestCard: {
    backgroundColor: Colors.cardBg, borderRadius: Radius.lg, padding: Spacing.md + 4,
    borderWidth: 1, borderColor: Colors.borderSubtle,
  },
  latestHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  latestTitle: { fontFamily: Fonts.headingMed, fontSize: 18, color: Colors.brandPrimary, marginTop: 4 },
  latestSummary: { fontFamily: Fonts.body, fontSize: 14, color: Colors.textSecondary, marginTop: 8, lineHeight: 20 },
  latestMeta: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginTop: Spacing.md },
  latestMetaText: { fontFamily: Fonts.bodyMed, fontSize: 12, color: Colors.textMuted },
  anomalyBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: 'rgba(160, 85, 69, 0.1)', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 100,
  },
  anomalyBadgeText: { fontFamily: Fonts.bodySemi, fontSize: 11, color: Colors.severityAlert },

  // Empty
  emptyCard: {
    backgroundColor: Colors.cardBg, borderRadius: Radius.lg, padding: Spacing.lg,
    borderWidth: 1, borderColor: Colors.borderSubtle, marginBottom: Spacing.md,
  },
  emptyTitle: { fontFamily: Fonts.headingMed, fontSize: 18, color: Colors.brandPrimary },
  emptyBody: { fontFamily: Fonts.body, fontSize: 14, color: Colors.textSecondary, marginTop: 6, lineHeight: 20 },
  emptyBtn: {
    marginTop: Spacing.md, backgroundColor: Colors.brandPrimary, paddingVertical: 12, borderRadius: Radius.md,
    alignItems: 'center',
  },
  emptyBtnText: { fontFamily: Fonts.bodySemi, fontSize: 14, color: Colors.cream },
  emptyStmt: {
    backgroundColor: Colors.cardBg, borderRadius: Radius.lg, padding: Spacing.lg,
    alignItems: 'center', borderWidth: 1, borderColor: Colors.borderSubtle, gap: 6,
  },
  emptyStmtTitle: { fontFamily: Fonts.bodySemi, fontSize: 15, color: Colors.brandPrimary },
  emptyStmtBody: { fontFamily: Fonts.body, fontSize: 13, color: Colors.textSecondary, textAlign: 'center' },

  // FAB
  fab: {
    position: 'absolute', right: Spacing.lg, bottom: Spacing.lg, width: 60, height: 60, borderRadius: 30,
    backgroundColor: Colors.brandPrimary, alignItems: 'center', justifyContent: 'center',
    shadowColor: Colors.brandPrimary, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.25, shadowRadius: 12, elevation: 6,
  },
});
