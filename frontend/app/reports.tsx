// Reports tab — 8 branded PDF generators that mirror the web app's flow.
//
// Contract (per backend/web parity):
//   1. POST /api/reports/generate { report_type: "HOUSEHOLD_SUMMARY", participant_id }
//        → { report_id, status: "GENERATING" }
//   2. Poll GET /api/reports/{report_id} every 2 s (cap ~30 s) until
//      status === "READY" (or "FAILED" → throw error_message).
//   3. GET /api/reports/{report_id}/download → application/pdf bytes.
//      Save to FileSystem.cacheDirectory and hand off to Sharing.
//
// THIS SCREEN MUST NOT RENDER PDFs CLIENT-SIDE. The server (ReportLab) is
// the single source of truth for layout + Wayly branding. Anything else
// will drift like the Decoded PDF mismatch did.
import React, { useCallback, useEffect, useState } from 'react';
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
import { API_BASE_URL, api, extractErrorMessage } from '../src/lib/api';
import { Colors, Fonts, Radius, Spacing, Type } from '../src/lib/theme';
import type { ColorPalette } from '../src/lib/theme';
import { useColors } from '../src/hooks/useColors';
import { useThemedStyles } from '../src/hooks/useThemedStyles';
import BackHeader from '../src/components/BackHeader';
import { toast } from '../src/components/Toast';
import { getActiveParticipantId } from '../src/lib/activeParticipant';
import { getAccessToken } from '../src/lib/tokens';
import { useParticipants } from '../src/context/ParticipantsContext';

// Canonical UPPERCASE enum the backend accepts. Source of truth — DO NOT
// translate/transform these before sending to the API.
type ReportKey =
  | 'HOUSEHOLD_SUMMARY'
  | 'QUARTERLY_BUDGET'
  | 'ANNUAL_FINANCIAL'
  | 'ANOMALY_SAVINGS'
  | 'PROVIDER_PERFORMANCE'
  | 'COMPLAINT_DOSSIER'
  | 'CARE_TIMELINE'
  | 'STATEMENT_DIGEST';

type ReportStatus = 'GENERATING' | 'READY' | 'FAILED' | string;

type ReportRow = {
  id: string;
  participant_id: string;
  report_type: ReportKey;
  report_name?: string;     // server-supplied friendly title
  title?: string;           // older shape — kept for backward compat
  period_label?: string;
  generated_at?: string;
  file_size_bytes?: number;
  size_bytes?: number;       // older shape
  status?: ReportStatus;
  error_message?: string | null;
};

const TYPES: { key: ReportKey; label: string; subtitle: string; bestFor: string; icon: keyof typeof Ionicons.glyphMap; tint: string }[] = [
  { key: 'HOUSEHOLD_SUMMARY',    label: 'Household summary',        subtitle: 'Plan, classification & recent activity at a glance.',         bestFor: 'Family catch-ups & onboarding new carers',     icon: 'home-outline',           tint: Colors.brandPrimary },
  { key: 'QUARTERLY_BUDGET',     label: 'Quarterly budget',         subtitle: 'Spend by service across the current quarter.',                bestFor: 'Quarterly reviews with your provider',         icon: 'pie-chart-outline',      tint: Colors.warning },
  { key: 'ANNUAL_FINANCIAL',     label: 'Annual financial summary', subtitle: 'Twelve-month view with monthly totals and anomaly tally.',    bestFor: 'Tax time and end-of-year care planning',       icon: 'calendar-outline',       tint: Colors.severityInfo },
  { key: 'ANOMALY_SAVINGS',      label: 'Anomaly & savings',        subtitle: 'Flagged items plus estimated overcharges.',                   bestFor: 'Spotting double-charges and missed credits',   icon: 'warning-outline',        tint: Colors.danger },
  { key: 'PROVIDER_PERFORMANCE', label: 'Provider performance',     subtitle: 'Provider scorecard across every statement.',                  bestFor: 'Deciding whether to switch providers',         icon: 'business-outline',       tint: Colors.brandPrimary },
  { key: 'COMPLAINT_DOSSIER',    label: 'Complaint dossier',        subtitle: 'Evidence pack assembled for a complaint or appeal.',          bestFor: 'Raising a formal complaint or AAT review',     icon: 'document-attach-outline',tint: Colors.danger },
  { key: 'CARE_TIMELINE',        label: 'Care timeline',            subtitle: 'Visits, statements and events in chronological order.',       bestFor: 'Sharing the full story with a GP or hospital', icon: 'time-outline',           tint: Colors.severityInfo },
  { key: 'STATEMENT_DIGEST',     label: 'Statement digest',         subtitle: 'Plain-English summary of the latest statement.',              bestFor: 'A 60-second monthly check-in',                 icon: 'document-text-outline',  tint: Colors.warning },
];

// ── Quarter helper for QUARTERLY_BUDGET / ANNUAL_FINANCIAL params ───────
function currentQuarterMeta(now: Date = new Date()) {
  const month = now.getUTCMonth() + 1; // 1-12
  const year = now.getUTCFullYear();
  // Australian financial year: Q1=Jul-Sep, Q2=Oct-Dec, Q3=Jan-Mar, Q4=Apr-Jun.
  // For an FY of (start year)/(start year+1) — e.g. Jul-2025 → Jun-2026 = FY2026.
  let q: 'Q1' | 'Q2' | 'Q3' | 'Q4';
  let financial_year: string;
  if (month >= 7 && month <= 9)        { q = 'Q1'; financial_year = String(year + 1); }
  else if (month >= 10 && month <= 12) { q = 'Q2'; financial_year = String(year + 1); }
  else if (month >= 1 && month <= 3)   { q = 'Q3'; financial_year = String(year);     }
  else                                  { q = 'Q4'; financial_year = String(year);     }
  return { quarter: q, financial_year };
}

function paramsFor(key: ReportKey): Record<string, unknown> | undefined {
  if (key === 'QUARTERLY_BUDGET') return currentQuarterMeta();
  if (key === 'ANNUAL_FINANCIAL') return { financial_year: currentQuarterMeta().financial_year };
  return undefined;
}

const POLL_INTERVAL_MS = 2_000;
const POLL_MAX_ATTEMPTS = 15; // ~30 s cap matches the spec

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export default function Reports() {
  const c = useColors();
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  void router; // reserved for future deep-links from empty-state
  const { participantSig, active } = useParticipants();
  const [items, setItems] = useState<ReportRow[]>([]);
  const [participantId, setParticipantId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busyKey, setBusyKey] = useState<ReportKey | null>(null);

  const load = useCallback(async () => {
    try {
      // List endpoint — backend accepts ?participant_id=… or the
      // X-Participant-Id header (api.ts interceptor already sets the header).
      const { data } = await api.get('/reports');
      const rows: ReportRow[] = data?.items || data?.reports || [];
      setItems(rows);
      setParticipantId(data?.participant_id || getActiveParticipantId());
    } catch (e: any) {
      const status = e?.response?.status;
      if (status !== 404 && status !== 403) {
        toast.error(extractErrorMessage(e, 'Could not load your reports'));
      }
      setItems([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  // Reload when the tab regains focus.
  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      load();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [load, participantSig, active?.id])
  );

  // Refetch when the active participant flips while this screen stays mounted.
  useEffect(() => {
    setLoading(true);
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [participantSig, active?.id]);

  // ── Polling helper ──────────────────────────────────────────────────
  const pollUntilReady = useCallback(async (reportId: string): Promise<ReportRow> => {
    let last: ReportRow | null = null;
    for (let i = 0; i < POLL_MAX_ATTEMPTS; i++) {
      // First attempt is delayed (lets the worker pick up the job).
      await sleep(POLL_INTERVAL_MS);
      const { data } = await api.get<ReportRow>(`/reports/${reportId}`);
      last = data;
      if (data?.status && data.status !== 'GENERATING') break;
    }
    if (!last) throw new Error('Report status never returned.');
    if (last.status !== 'READY') {
      throw new Error(last.error_message || 'Report did not finish in time.');
    }
    return last;
  }, []);

  // ── Generate → poll → download flow ────────────────────────────────
  const generate = async (key: ReportKey) => {
    setBusyKey(key);
    const friendly = TYPES.find((t) => t.key === key)?.label || key;
    try {
      const payload: Record<string, unknown> = {
        report_type: key, // Canonical UPPERCASE enum — must not transform.
      };
      const pid = active?.id || getActiveParticipantId();
      if (pid) payload.participant_id = pid;
      const params = paramsFor(key);
      if (params) payload.parameters = params;

      const { data: gen } = await api.post('/reports/generate', payload);
      const reportId: string | undefined = gen?.report_id || gen?.id;
      if (!reportId) throw new Error('Server did not return a report_id.');

      toast.success(`${friendly} queued. Generating…`);

      const ready = await pollUntilReady(reportId);
      // Refresh the local list optimistically so the new row appears.
      setItems((prev) => [
        { ...ready, id: ready.id || reportId },
        ...prev.filter((x) => x.id !== reportId),
      ]);

      await downloadReportPdf(reportId, ready.report_name || ready.title || friendly);
    } catch (e: any) {
      Alert.alert('Could not generate report', extractErrorMessage(e, 'Try again in a moment.'));
    } finally {
      setBusyKey(null);
    }
  };

  // ── Download helper (Expo / RN Web) ────────────────────────────────
  const downloadReportPdf = async (reportId: string, reportName: string) => {
    const token = await getAccessToken();
    if (!token) throw new Error('Not signed in');

    const safeName = (reportName || 'report')
      .replace(/[^\w-]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'report';
    const url = `${API_BASE_URL}/api/reports/${reportId}/download`;

    if (Platform.OS === 'web') {
      // Web: fetch as blob so the Bearer header is honoured, then open / save.
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
      });
      if (!res.ok) throw new Error(`Server returned ${res.status}`);
      const ctype = res.headers.get('content-type') || '';
      if (!ctype.startsWith('application/pdf')) {
        throw new Error(`Expected PDF, got ${ctype}`);
      }
      const blob = await res.blob();
      const objUrl = URL.createObjectURL(blob);
      // Best UX: trigger a download AND open in a new tab so the user can
      // preview before saving.
      const a = document.createElement('a');
      a.href = objUrl;
      a.download = `${safeName}.pdf`;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(objUrl), 60_000);
      return;
    }

    // Native: download to cache, then hand off to the share sheet.
    const dest = `${FileSystem.cacheDirectory || ''}${safeName}.pdf`;
    const dl = await FileSystem.downloadAsync(url, dest, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (dl.status !== 200) throw new Error(`Server returned ${dl.status}`);
    const ctype = (dl.headers?.['Content-Type'] || dl.headers?.['content-type'] || '') as string;
    if (ctype && !ctype.startsWith('application/pdf')) {
      throw new Error(`Expected PDF, got ${ctype}`);
    }
    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(dl.uri, {
        UTI: 'com.adobe.pdf',
        mimeType: 'application/pdf',
        dialogTitle: reportName,
      });
    } else {
      // Some platforms (e.g. RN Web Tunnel on dev) lack Sharing. Fall back
      // to opening the file URI directly.
      Linking.openURL(dl.uri);
    }
  };

  const openReport = async (row: ReportRow) => {
    try {
      const name = row.report_name || row.title || 'report';
      await downloadReportPdf(row.id, name);
    } catch (e: any) {
      Alert.alert('Could not open report', e?.message || 'Try again later');
    }
  };

  const deleteReport = (row: ReportRow) => {
    Alert.alert(
      'Delete report?',
      `${row.report_name || row.title || 'Report'}${row.period_label ? ` · ${row.period_label}` : ''}`,
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
              style={[styles.tile, busy && { opacity: 0.6 }]}
            >
              <View style={[styles.tileIcon, { backgroundColor: t.tint + '14' }]}>
                <Ionicons name={busy ? 'hourglass-outline' : t.icon} size={20} color={t.tint} />
              </View>
              <Text style={styles.tileLabel}>{t.label}</Text>
              <Text style={styles.tileSub} numberOfLines={2}>{t.subtitle}</Text>
              <Text style={styles.tileBest} numberOfLines={2}>
                <Text style={styles.tileBestLbl}>BEST FOR  </Text>{t.bestFor}
              </Text>
              {busy && (
                <Text style={styles.tileBusy}>Generating…</Text>
              )}
            </TouchableOpacity>
          );
        })}
      </View>

      <Text style={[styles.sectionLabel, { marginTop: Spacing.lg }]}>Your reports</Text>
      {items.length === 0 && !loading ? (
        <View style={styles.empty}>
          <Ionicons name="bar-chart-outline" size={28} color={c.textMuted} />
          <Text style={styles.emptyTitle}>No reports yet</Text>
          <Text style={styles.emptyBody}>Tap any tile above. Generated reports are saved here for this participant only.</Text>
        </View>
      ) : null}
    </View>
  );

  const renderItem = ({ item }: { item: ReportRow }) => {
    const meta = TYPES.find((t) => t.key === item.report_type);
    const sizeBytes = item.file_size_bytes ?? item.size_bytes ?? 0;
    const sizeKb = sizeBytes > 0 ? Math.max(1, Math.round(sizeBytes / 1024)) : null;
    const generatedDate = item.generated_at ? new Date(item.generated_at).toLocaleDateString() : '';
    const status = item.status || 'READY';
    const isReady = status === 'READY';
    return (
      <View style={styles.row}>
        <TouchableOpacity
          onPress={() => isReady && openReport(item)}
          style={styles.rowMain}
          disabled={!isReady}
          testID={`report-open-${item.id}`}
        >
          <View style={[styles.rowIcon, { backgroundColor: (meta?.tint || c.brandPrimary) + '14' }]}>
            <Ionicons name={meta?.icon || 'document-outline'} size={18} color={meta?.tint || c.brandPrimary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.rowTitle}>{item.report_name || item.title || meta?.label || 'Report'}</Text>
            <Text style={styles.rowSub}>
              {[item.period_label, generatedDate, sizeKb ? `${sizeKb} KB` : null]
                .filter(Boolean)
                .join(' · ')}
              {!isReady ? ` · ${status}` : ''}
            </Text>
          </View>
          <Ionicons
            name={isReady ? 'open-outline' : status === 'FAILED' ? 'alert-circle-outline' : 'hourglass-outline'}
            size={18}
            color={isReady ? c.brandPrimary : c.textMuted}
          />
        </TouchableOpacity>
        <TouchableOpacity onPress={() => deleteReport(item)} style={styles.rowDelete} testID={`report-delete-${item.id}`}>
          <Ionicons name="trash-outline" size={18} color={c.textMuted} />
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
            tintColor={c.brandPrimary}
          />
        }
        testID="reports-list"
      />
      {participantId ? (
        <View style={styles.footer}>
          <Ionicons name="lock-closed-outline" size={11} color={c.textMuted} />
          <Text style={styles.footerText}>
            Reports are isolated per participant — switching participants shows a different library.
          </Text>
        </View>
      ) : null}
    </SafeAreaView>
  );
}

function makeStyles(c: ColorPalette) { return StyleSheet.create({
  safe: { flex: 1, backgroundColor: c.background },
  scroll: { paddingHorizontal: Spacing.md, paddingTop: Spacing.sm, paddingBottom: Spacing.xl + 24 },
  sectionLabel: { ...Type.overline, color: c.textMuted, marginTop: Spacing.sm, marginBottom: Spacing.sm },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  tile: {
    flexGrow: 1,
    flexBasis: '47%',
    backgroundColor: c.cardBg,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    borderWidth: 1,
    borderColor: c.border,
    gap: 6,
  },
  tileIcon: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  tileLabel: { ...Type.bodySemi, color: c.textPrimary, fontSize: 14 },
  tileSub: { ...Type.caption, color: c.textSecondary, fontSize: 11, lineHeight: 14 },
  tileBest: {
    ...Type.caption,
    color: c.textPrimary,
    fontSize: 11,
    lineHeight: 14,
    marginTop: 6,
    paddingTop: 6,
    borderTopWidth: 1,
    borderTopColor: c.borderSubtle,
  },
  tileBestLbl: { fontFamily: Fonts.bodySemi, fontSize: 10, color: c.brandPrimary, letterSpacing: 0.6 },
  tileBusy: { fontFamily: Fonts.bodySemi, fontSize: 11, color: c.brandPrimary, marginTop: 4 },
  empty: { alignItems: 'center', paddingVertical: Spacing.xl, gap: 6 },
  emptyTitle: { ...Type.bodySemi, color: c.textPrimary, marginTop: 4 },
  emptyBody: { ...Type.caption, color: c.textSecondary, textAlign: 'center', paddingHorizontal: Spacing.lg },
  row: {
    flexDirection: 'row',
    alignItems: 'stretch',
    backgroundColor: c.cardBg,
    borderRadius: Radius.md,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: c.border,
  },
  rowMain: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1, padding: Spacing.md },
  rowIcon: { width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  rowTitle: { ...Type.bodySemi, color: c.textPrimary, fontSize: 14 },
  rowSub: { ...Type.caption, color: c.textSecondary, fontSize: 11, marginTop: 2 },
  rowDelete: { paddingHorizontal: Spacing.md, justifyContent: 'center', borderLeftWidth: 1, borderLeftColor: c.border },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: Spacing.md,
    paddingBottom: 6,
  },
  footerText: { ...Type.caption, color: c.textMuted, fontSize: 10, flex: 1 },
}); }
