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
import { Colors, Fonts, formatAUD, Radius, Spacing } from '../../src/lib/theme';
import { useAuth } from '../../src/context/AuthContext';
import UploadSheet from '../../src/components/UploadSheet';
import { registerForPushNotifications } from '../../src/lib/push';

type StreamRow = {
  stream: string;
  allocated?: number;
  spent?: number;
  remaining?: number;
  pct?: number;
};

type RawBudget = {
  participant_name?: string;
  classification?: number;
  classification_label?: string;
  quarter_label?: string;
  quarterly_total?: number;
  spent_this_quarter?: number;       // mobile shape
  remaining_this_quarter?: number;   // mobile shape
  burn_pct?: number;                 // mobile shape
  streams?: StreamRow[];
  lifetime_cap?: number;
  lifetime_contributions?: number;
  lifetime_pct?: number;
  alert_count?: number;              // mobile shape
  statement_count?: number;
  latest_statement?: null | {
    id: string;
    period_label?: string | null;
    summary?: string | null;
    anomaly_count?: number;
    line_item_count?: number;
  };
};

type Derived = {
  participant_name: string;
  classification_label: string;
  quarter_label: string;
  quarterly_total: number;
  spent_this_quarter: number;
  remaining_this_quarter: number;
  burn_pct: number;
  streams: { stream: string; allocated: number; spent: number; remaining: number; pct: number }[];
  lifetime_cap: number;
  lifetime_contributions: number;
  lifetime_pct: number;
  alert_count: number;
  latest_statement: null | {
    id: string;
    period_label: string;
    summary: string;
    anomaly_count: number;
    line_item_count: number;
  };
};

const num = (v: any, fallback = 0): number => {
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
};

export default function Today() {
  const router = useRouter();
  const { user } = useAuth();
  const [data, setData] = useState<Derived | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    try {
      setError(null);
      // Fetch in parallel — graceful for any failures
      const [bRes, hRes, sRes, nRes] = await Promise.all([
        api.get<RawBudget>('/budget/current').catch((e) => ({ data: null, _err: e })),
        api.get('/household').catch(() => ({ data: null })),
        api.get('/statements').catch(() => ({ data: [] })),
        api.get('/notifications').catch(() => ({ data: { items: [], unread: 0 } })),
      ]);

      // If budget call failed (e.g. no household), surface the error
      if (!bRes.data) {
        const err = (bRes as any)._err;
        const detail = err?.response?.data?.detail || extractErrorMessage(err, "We couldn't load your dashboard.");
        setError(detail);
        setLoading(false);
        setRefreshing(false);
        return;
      }

      const b = bRes.data;
      const household = (hRes as any).data;
      const statements: any[] = (sRes as any).data || [];

      // Compute streams in a stable shape
      const streams = (b.streams || []).map((s) => {
        const allocated = num(s.allocated);
        const spent = num(s.spent);
        const remaining = num(s.remaining, allocated - spent);
        const pct = num(s.pct, allocated > 0 ? (spent / allocated) * 100 : 0);
        return { stream: s.stream, allocated, spent, remaining, pct };
      });

      const quarterlyTotal = num(b.quarterly_total, streams.reduce((a, s) => a + s.allocated, 0));
      const spentThisQuarter = num(
        b.spent_this_quarter,
        streams.reduce((a, s) => a + s.spent, 0)
      );
      const remainingThisQuarter = num(
        b.remaining_this_quarter,
        Math.max(0, quarterlyTotal - spentThisQuarter)
      );
      const burnPct = num(
        b.burn_pct,
        quarterlyTotal > 0 ? (spentThisQuarter / quarterlyTotal) * 100 : 0
      );

      // Alert count + latest statement — derive from /api/statements if production omits them
      let alertCount = num(b.alert_count, NaN);
      if (!Number.isFinite(alertCount)) {
        alertCount = statements.reduce((acc, st) => {
          const sevs = (st.anomalies || []).filter(
            (a: any) => a.severity === 'alert' || a.severity === 'warning'
          );
          return acc + sevs.length;
        }, 0);
      }

      let latest: Derived['latest_statement'] = null;
      if (b.latest_statement) {
        const ls = b.latest_statement;
        latest = {
          id: ls.id,
          period_label: ls.period_label || '',
          summary: ls.summary || '',
          anomaly_count: num(ls.anomaly_count),
          line_item_count: num(ls.line_item_count),
        };
      } else if (statements.length > 0) {
        const sorted = [...statements].sort((x, y) =>
          (y.uploaded_at || '').localeCompare(x.uploaded_at || '')
        );
        const ls = sorted[0];
        latest = {
          id: ls.id,
          period_label: ls.period_label || ls.filename || '',
          summary: ls.summary || '',
          anomaly_count: (ls.anomalies || []).length,
          line_item_count: (ls.line_items || []).length,
        };
      }

      setData({
        participant_name: b.participant_name || household?.participant_name || '',
        classification_label: b.classification_label || (household ? `Level ${household.classification}` : ''),
        quarter_label: b.quarter_label || '',
        quarterly_total: quarterlyTotal,
        spent_this_quarter: spentThisQuarter,
        remaining_this_quarter: remainingThisQuarter,
        burn_pct: burnPct,
        streams,
        lifetime_cap: num(b.lifetime_cap),
        lifetime_contributions: num(b.lifetime_contributions),
        lifetime_pct: num(b.lifetime_pct),
        alert_count: alertCount,
        latest_statement: latest,
      });
      setUnread(num((nRes as any).data?.unread));
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
        <View style={styles.header}>
          <View style={{ flex: 1 }}>
            <Text style={styles.overline}>Wellbeing summary</Text>
            <Text style={styles.greeting} testID="today-greeting">
              {data?.participant_name ? `${data.participant_name}, this quarter` : `Hello, ${user?.name?.split(' ')[0] || ''}`}
            </Text>
            {data && (data.quarter_label || data.classification_label) && (
              <Text style={styles.subline}>
                {[data.quarter_label, data.classification_label].filter(Boolean).join(' · ')}
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

        {error && !data && (
          <View style={styles.emptyCard} testID="today-error-card">
            <Text style={styles.emptyTitle}>
              {noHousehold ? 'Set up your household first' : "We couldn't load your dashboard"}
            </Text>
            <Text style={styles.emptyBody}>
              {noHousehold
                ? "Wayly works best once you tell us about your parent. Open the More tab to add their name and classification level."
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

        {data && (
          <>
            <View style={styles.heroCard} testID="today-budget-summary">
              <Text style={styles.heroOverline}>Remaining this quarter</Text>
              <Text style={styles.heroAmount} testID="today-budget-remaining">
                {formatAUD(data.remaining_this_quarter)}
              </Text>
              <Text style={styles.heroSub}>
                of {formatAUD(data.quarterly_total)} ·{' '}
                <Text style={styles.heroSubBold}>{formatAUD(data.spent_this_quarter)} spent</Text>
              </Text>
              <View style={styles.progressTrack}>
                <View style={[styles.progressFill, { width: `${Math.min(100, data.burn_pct)}%` }]} />
              </View>
              <Text style={styles.progressLabel}>{data.burn_pct.toFixed(1)}% used</Text>
            </View>

            <View style={styles.statRow}>
              <TouchableOpacity
                onPress={() => router.push('/(tabs)/notifications' as any)}
                style={[styles.statCard, data.alert_count > 0 && styles.statCardAlert]}
                testID="today-alert-chip"
              >
                <View style={styles.statHeader}>
                  <Ionicons
                    name="alert-circle-outline"
                    size={16}
                    color={data.alert_count > 0 ? Colors.severityAlert : Colors.textMuted}
                  />
                  <Text style={styles.statOverline}>Alerts</Text>
                </View>
                <Text
                  style={[styles.statValue, data.alert_count > 0 && { color: Colors.severityAlert }]}
                >
                  {data.alert_count}
                </Text>
                <Text style={styles.statHint}>
                  {data.alert_count === 0 ? 'Nothing unusual' : 'Things to review'}
                </Text>
              </TouchableOpacity>

              <View style={styles.statCard} testID="today-lifetime-cap-bar">
                <View style={styles.statHeader}>
                  <Ionicons name="trending-up-outline" size={16} color={Colors.textMuted} />
                  <Text style={styles.statOverline}>Lifetime cap</Text>
                </View>
                <Text style={styles.statValue}>{data.lifetime_pct.toFixed(1)}%</Text>
                <Text style={styles.statHint}>
                  used of {formatAUD(data.lifetime_cap)}
                </Text>
              </View>
            </View>

            {data.streams.length > 0 && (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Spending by stream</Text>
                {data.streams.map((s) => (
                  <View key={s.stream} style={styles.streamRow} testID={`today-stream-${s.stream}`}>
                    <View style={styles.streamHead}>
                      <View style={styles.streamLabel}>
                        <View
                          style={[
                            styles.streamDot,
                            { backgroundColor: Colors.streams[s.stream] || Colors.textMuted },
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
                            backgroundColor: Colors.streams[s.stream] || Colors.brandSecondary,
                          },
                        ]}
                      />
                    </View>
                  </View>
                ))}
              </View>
            )}

            {data.latest_statement && (
              <TouchableOpacity
                style={styles.latestCard}
                onPress={() => router.push(`/statements/${data.latest_statement!.id}` as any)}
                testID="today-latest-statement-card"
              >
                <View style={styles.latestHead}>
                  <Text style={styles.overline}>Latest statement</Text>
                  <Ionicons name="chevron-forward" size={18} color={Colors.textMuted} />
                </View>
                <Text style={styles.latestTitle}>{data.latest_statement.period_label || 'Statement'}</Text>
                {data.latest_statement.summary ? (
                  <Text style={styles.latestSummary} numberOfLines={3}>
                    {data.latest_statement.summary}
                  </Text>
                ) : null}
                <View style={styles.latestMeta}>
                  <Text style={styles.latestMetaText}>
                    {data.latest_statement.line_item_count} line items
                  </Text>
                  {data.latest_statement.anomaly_count > 0 && (
                    <View style={styles.anomalyBadge}>
                      <Ionicons name="alert-circle" size={12} color={Colors.severityAlert} />
                      <Text style={styles.anomalyBadgeText}>
                        {data.latest_statement.anomaly_count} alert
                        {data.latest_statement.anomaly_count > 1 ? 's' : ''}
                      </Text>
                    </View>
                  )}
                </View>
              </TouchableOpacity>
            )}

            {!data.latest_statement && (
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
  overline: { fontFamily: Fonts.bodyMed, fontSize: 11, letterSpacing: 1.5, textTransform: 'uppercase', color: Colors.textMuted, marginBottom: 4 },
  greeting: { fontFamily: Fonts.heading, fontSize: 26, color: Colors.brandPrimary, letterSpacing: -0.5 },
  subline: { fontFamily: Fonts.body, fontSize: 13, color: Colors.textSecondary, marginTop: 4 },
  bell: { width: 42, height: 42, borderRadius: 21, backgroundColor: Colors.cardBg, alignItems: 'center', justifyContent: 'center', marginLeft: Spacing.md, borderWidth: 1, borderColor: Colors.border },
  bellDot: { position: 'absolute', top: 8, right: 9, width: 10, height: 10, borderRadius: 5, backgroundColor: Colors.severityAlert, borderWidth: 2, borderColor: Colors.cardBg },
  heroCard: { backgroundColor: Colors.cardBg, borderRadius: Radius.xl, padding: Spacing.lg, borderWidth: 1, borderColor: Colors.borderSubtle, marginBottom: Spacing.md, shadowColor: Colors.brandPrimary, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.05, shadowRadius: 8, elevation: 2 },
  heroOverline: { fontFamily: Fonts.bodyMed, fontSize: 11, letterSpacing: 1.5, textTransform: 'uppercase', color: Colors.textSecondary, marginBottom: Spacing.sm },
  heroAmount: { fontFamily: Fonts.heading, fontSize: 44, color: Colors.brandPrimary, letterSpacing: -1 },
  heroSub: { fontFamily: Fonts.body, fontSize: 13, color: Colors.textSecondary, marginTop: 4 },
  heroSubBold: { fontFamily: Fonts.bodySemi, color: Colors.brandPrimary },
  progressTrack: { marginTop: Spacing.md, height: 6, backgroundColor: 'rgba(31, 58, 95, 0.08)', borderRadius: 3, overflow: 'hidden' },
  progressFill: { height: '100%', backgroundColor: Colors.brandSecondary },
  progressLabel: { fontFamily: Fonts.bodyMed, fontSize: 11, color: Colors.textMuted, marginTop: 6 },
  statRow: { flexDirection: 'row', gap: Spacing.md, marginBottom: Spacing.lg },
  statCard: { flex: 1, backgroundColor: Colors.cardBg, borderRadius: Radius.lg, padding: Spacing.md, borderWidth: 1, borderColor: Colors.borderSubtle },
  statCardAlert: { borderColor: 'rgba(160, 85, 69, 0.3)', backgroundColor: 'rgba(160, 85, 69, 0.04)' },
  statHeader: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  statOverline: { fontFamily: Fonts.bodyMed, fontSize: 10, letterSpacing: 1, textTransform: 'uppercase', color: Colors.textMuted },
  statValue: { fontFamily: Fonts.heading, fontSize: 28, color: Colors.brandPrimary, marginTop: 6 },
  statHint: { fontFamily: Fonts.body, fontSize: 11, color: Colors.textSecondary, marginTop: 2 },
  section: { marginBottom: Spacing.lg },
  sectionTitle: { fontFamily: Fonts.headingMed, fontSize: 16, color: Colors.brandPrimary, marginBottom: Spacing.md },
  streamRow: { backgroundColor: Colors.cardBg, borderRadius: Radius.md, padding: Spacing.md, marginBottom: Spacing.sm, borderWidth: 1, borderColor: Colors.borderSubtle },
  streamHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  streamLabel: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  streamDot: { width: 10, height: 10, borderRadius: 5 },
  streamName: { fontFamily: Fonts.bodySemi, fontSize: 14, color: Colors.brandPrimary },
  streamAmt: { fontFamily: Fonts.bodyMed, fontSize: 13, color: Colors.brandPrimary },
  streamMuted: { color: Colors.textSecondary, fontFamily: Fonts.body },
  streamTrack: { height: 4, backgroundColor: 'rgba(31, 58, 95, 0.06)', borderRadius: 2, overflow: 'hidden' },
  streamFill: { height: '100%' },
  latestCard: { backgroundColor: Colors.cardBg, borderRadius: Radius.lg, padding: Spacing.md + 4, borderWidth: 1, borderColor: Colors.borderSubtle },
  latestHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  latestTitle: { fontFamily: Fonts.headingMed, fontSize: 18, color: Colors.brandPrimary, marginTop: 4 },
  latestSummary: { fontFamily: Fonts.body, fontSize: 14, color: Colors.textSecondary, marginTop: 8, lineHeight: 20 },
  latestMeta: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginTop: Spacing.md },
  latestMetaText: { fontFamily: Fonts.bodyMed, fontSize: 12, color: Colors.textMuted },
  anomalyBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(160, 85, 69, 0.1)', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 100 },
  anomalyBadgeText: { fontFamily: Fonts.bodySemi, fontSize: 11, color: Colors.severityAlert },
  emptyCard: { backgroundColor: Colors.cardBg, borderRadius: Radius.lg, padding: Spacing.lg, borderWidth: 1, borderColor: Colors.borderSubtle, marginBottom: Spacing.md },
  emptyTitle: { fontFamily: Fonts.headingMed, fontSize: 18, color: Colors.brandPrimary },
  emptyBody: { fontFamily: Fonts.body, fontSize: 14, color: Colors.textSecondary, marginTop: 6, lineHeight: 20 },
  emptyBtn: { marginTop: Spacing.md, backgroundColor: Colors.brandPrimary, paddingVertical: 12, borderRadius: Radius.md, alignItems: 'center' },
  emptyBtnText: { fontFamily: Fonts.bodySemi, fontSize: 14, color: Colors.cream },
  emptyStmt: { backgroundColor: Colors.cardBg, borderRadius: Radius.lg, padding: Spacing.lg, alignItems: 'center', borderWidth: 1, borderColor: Colors.borderSubtle, gap: 6 },
  emptyStmtTitle: { fontFamily: Fonts.bodySemi, fontSize: 15, color: Colors.brandPrimary },
  emptyStmtBody: { fontFamily: Fonts.body, fontSize: 13, color: Colors.textSecondary, textAlign: 'center' },
  fab: { position: 'absolute', right: Spacing.lg, bottom: Spacing.lg, width: 60, height: 60, borderRadius: 30, backgroundColor: Colors.brandPrimary, alignItems: 'center', justifyContent: 'center', shadowColor: Colors.brandPrimary, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.25, shadowRadius: 12, elevation: 6 },
});
