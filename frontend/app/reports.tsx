// Reports tab — 8 on-demand generators + persisted "Your reports" library.
// Strictly per-participant: the api.ts interceptor injects `X-Participant-Id`
// so a switched participant only ever sees their own reports.
import React, { useCallback, useState } from 'react';
import {
  Alert,
  FlatList,
  Linking,
  Platform,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { useFocusEffect, useRouter } from 'expo-router';
import { api, extractErrorMessage } from '../src/lib/api';
import { Colors, Fonts, Radius, Spacing, Type } from '../src/lib/theme';
import BackHeader from '../src/components/BackHeader';
import { toast } from '../src/components/Toast';
import { getActiveParticipantId } from '../src/lib/activeParticipant';
import { getAccessToken } from '../src/lib/tokens';
import { useParticipants } from '../src/context/ParticipantsContext';

type ReportKey =
  | 'household_summary'
  | 'quarterly_budget'
  | 'annual_financial'
  | 'anomaly_savings'
  | 'provider_performance'
  | 'complaint_dossier'
  | 'care_timeline'
  | 'statement_digest';

type ReportRow = {
  id: string;
  participant_id: string;
  report_type: ReportKey;
  title: string;
  period_label: string;
  generated_at: string;
  size_bytes: number;
  status: string;
};

const TYPES: { key: ReportKey; label: string; subtitle: string; icon: keyof typeof Ionicons.glyphMap; tint: string }[] = [
  { key: 'household_summary',    label: 'Household summary',       subtitle: 'Snapshot of plan, classification & recent activity', icon: 'home-outline',           tint: Colors.brandPrimary },
  { key: 'quarterly_budget',     label: 'Quarterly budget',        subtitle: 'Spend by service for the current quarter',           icon: 'pie-chart-outline',      tint: Colors.warning },
  { key: 'annual_financial',     label: 'Annual financial summary',subtitle: 'Year view, monthly totals, anomaly tally',           icon: 'calendar-outline',       tint: Colors.severityInfo },
  { key: 'anomaly_savings',      label: 'Anomaly & savings',       subtitle: 'Flagged items + estimated overcharges',              icon: 'warning-outline',        tint: Colors.danger },
  { key: 'provider_performance', label: 'Provider performance',    subtitle: 'Provider scorecard across all statements',           icon: 'business-outline',       tint: Colors.brandPrimary },
  { key: 'complaint_dossier',    label: 'Complaint dossier',       subtitle: 'Evidence pack for a complaint or appeal',            icon: 'document-attach-outline',tint: Colors.danger },
  { key: 'care_timeline',        label: 'Care timeline',           subtitle: 'Visits + statements + events in chronological order',icon: 'time-outline',           tint: Colors.severityInfo },
  { key: 'statement_digest',     label: 'Statement digest',        subtitle: 'Plain-English summary of the latest statement',      icon: 'document-text-outline',  tint: Colors.warning },
];

export default function Reports() {
  const router = useRouter();
  const { participantSig, active } = useParticipants();
  const [items, setItems] = useState<ReportRow[]>([]);
  const [participantId, setParticipantId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busyKey, setBusyKey] = useState<ReportKey | null>(null);

  const load = useCallback(async () => {
    try {
      const { data } = await api.get('/reports');
      setItems(data?.items || []);
      setParticipantId(data?.participant_id || getActiveParticipantId());
    } catch (e: any) {
      toast.error(extractErrorMessage(e, 'Could not load your reports'));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  // Reload whenever the tab regains focus — picks up participant switch.
  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      load();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [load, participantSig, active?.id])
  );

  // Also refetch when the active participant changes while this screen stays mounted.
  React.useEffect(() => {
    setLoading(true);
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [participantSig, active?.id]);

  const generate = async (key: ReportKey) => {
    setBusyKey(key);
    try {
      const { data } = await api.post('/reports/generate', { report_type: key });
      toast.success(`${data?.title || 'Report'} ready`);
      // Optimistically prepend so the user sees it instantly.
      setItems((prev) => [data, ...prev.filter((x) => x.id !== data.id)]);
      // Then offer to open it immediately.
      await openReport(data);
    } catch (e: any) {
      Alert.alert('Could not generate report', extractErrorMessage(e));
    } finally {
      setBusyKey(null);
    }
  };

  const openReport = async (row: ReportRow) => {
    const base = process.env.EXPO_PUBLIC_BACKEND_URL;
    const url = `${base}/api/reports/${row.id}/download`;
    try {
      const token = await getAccessToken();
      if (!token) throw new Error('Not signed in');
      if (Platform.OS === 'web') {
        // Web: fetch as blob so the Bearer token is honoured, then open.
        const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const blob = await res.blob();
        const objUrl = URL.createObjectURL(blob);
        Linking.openURL(objUrl);
        return;
      }
      const dest = (FileSystem.cacheDirectory || '') + `wayly-${row.report_type}-${row.id.slice(0, 8)}.pdf`;
      const dl = await FileSystem.downloadAsync(url, dest, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (dl.status !== 200) throw new Error(`HTTP ${dl.status}`);
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(dl.uri, { mimeType: 'application/pdf' });
      }
    } catch (e: any) {
      Alert.alert('Could not open report', e?.message || 'Try again later');
    }
  };

  const deleteReport = (row: ReportRow) => {
    Alert.alert(
      'Delete report?',
      `${row.title} (${row.period_label})`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await api.delete(`/reports/${row.id}`);
              setItems((prev) => prev.filter((x) => x.id !== row.id));
              toast.success('Report removed');
            } catch (e: any) {
              toast.error(extractErrorMessage(e, 'Could not delete'));
            }
          },
        },
      ]
    );
  };

  const renderHeader = () => (
    <View>
      <Text style={styles.sectionLabel}>Generate a report</Text>
      <View style={styles.grid}>
        {TYPES.map((t) => {
          const busy = busyKey === t.key;
          return (
            <TouchableOpacity
              key={t.key}
              testID={`report-gen-${t.key}`}
              activeOpacity={0.8}
              disabled={!!busyKey}
              onPress={() => generate(t.key)}
              style={[styles.tile, busy && { opacity: 0.5 }]}
            >
              <View style={[styles.tileIcon, { backgroundColor: t.tint + '14' }]}>
                <Ionicons name={busy ? 'hourglass-outline' : t.icon} size={20} color={t.tint} />
              </View>
              <Text style={styles.tileLabel}>{t.label}</Text>
              <Text style={styles.tileSub} numberOfLines={2}>{t.subtitle}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <Text style={[styles.sectionLabel, { marginTop: Spacing.lg }]}>Your reports</Text>
      {items.length === 0 && !loading ? (
        <View style={styles.empty}>
          <Ionicons name="bar-chart-outline" size={28} color={Colors.textMuted} />
          <Text style={styles.emptyTitle}>No reports yet</Text>
          <Text style={styles.emptyBody}>Tap any tile above. Generated reports are saved here for this participant only.</Text>
        </View>
      ) : null}
    </View>
  );

  const renderItem = ({ item }: { item: ReportRow }) => {
    const meta = TYPES.find((t) => t.key === item.report_type);
    const sizeKb = Math.max(1, Math.round((item.size_bytes || 0) / 1024));
    return (
      <View style={styles.row}>
        <TouchableOpacity
          onPress={() => openReport(item)}
          style={styles.rowMain}
          testID={`report-open-${item.id}`}
        >
          <View style={[styles.rowIcon, { backgroundColor: (meta?.tint || Colors.brandPrimary) + '14' }]}>
            <Ionicons name={meta?.icon || 'document-outline'} size={18} color={meta?.tint || Colors.brandPrimary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.rowTitle}>{item.title}</Text>
            <Text style={styles.rowSub}>
              {item.period_label} · {new Date(item.generated_at).toLocaleDateString()} · {sizeKb} KB
            </Text>
          </View>
          <Ionicons name="open-outline" size={18} color={Colors.brandPrimary} />
        </TouchableOpacity>
        <TouchableOpacity onPress={() => deleteReport(item)} style={styles.rowDelete} testID={`report-delete-${item.id}`}>
          <Ionicons name="trash-outline" size={18} color={Colors.textMuted} />
        </TouchableOpacity>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <BackHeader title="Reports" />
      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        ListHeaderComponent={renderHeader}
        contentContainerStyle={styles.scroll}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              load();
            }}
            tintColor={Colors.brandPrimary}
          />
        }
        testID="reports-list"
      />
      {participantId ? (
        <View style={styles.footer}>
          <Ionicons name="lock-closed-outline" size={11} color={Colors.textMuted} />
          <Text style={styles.footerText}>
            Reports are isolated per participant — switching participants shows a different library.
          </Text>
        </View>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingHorizontal: Spacing.md, paddingTop: Spacing.sm, paddingBottom: Spacing.xl + 24 },
  sectionLabel: { ...Type.overline, color: Colors.textMuted, marginTop: Spacing.sm, marginBottom: Spacing.sm },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  tile: {
    flexGrow: 1,
    flexBasis: '47%',
    backgroundColor: Colors.cardBg,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.border,
    gap: 6,
  },
  tileIcon: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  tileLabel: { ...Type.bodySemi, color: Colors.textPrimary, fontSize: 14 },
  tileSub: { ...Type.caption, color: Colors.textSecondary, fontSize: 11, lineHeight: 14 },
  empty: { alignItems: 'center', paddingVertical: Spacing.xl, gap: 6 },
  emptyTitle: { ...Type.bodySemi, color: Colors.textPrimary, marginTop: 4 },
  emptyBody: { ...Type.caption, color: Colors.textSecondary, textAlign: 'center', paddingHorizontal: Spacing.lg },
  row: {
    flexDirection: 'row',
    alignItems: 'stretch',
    backgroundColor: Colors.cardBg,
    borderRadius: Radius.md,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  rowMain: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1, padding: Spacing.md },
  rowIcon: { width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  rowTitle: { ...Type.bodySemi, color: Colors.textPrimary, fontSize: 14 },
  rowSub: { ...Type.caption, color: Colors.textSecondary, fontSize: 11, marginTop: 2 },
  rowDelete: { paddingHorizontal: Spacing.md, justifyContent: 'center', borderLeftWidth: 1, borderLeftColor: Colors.border },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: Spacing.md,
    paddingBottom: 6,
  },
  footerText: { ...Type.caption, color: Colors.textMuted, fontSize: 10, flex: 1 },
});
