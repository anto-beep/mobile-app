import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  TouchableOpacity,
  Platform,
  Linking,
  Alert,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { api } from '../../src/lib/api';
import { getAccessToken } from '../../src/lib/tokens';
import { Colors, Fonts, formatAUD2, Radius, Spacing } from '../../src/lib/theme';
import BackHeader from '../../src/components/BackHeader';
import { toast } from '../../src/components/Toast';
import { useSensitiveScreen } from '../../src/lib/useSensitiveScreen';

const SEVERITY: Record<string, { color: string; bg: string; icon: any }> = {
  alert: { color: Colors.severityAlert, bg: 'rgba(192, 57, 43, 0.08)', icon: 'alert-circle' },
  warning: { color: Colors.severityWarning, bg: 'rgba(183, 121, 31, 0.08)', icon: 'warning' },
  info: { color: Colors.severityInfo, bg: 'rgba(139, 155, 130, 0.08)', icon: 'information-circle' },
};

type Stmt = {
  id: string;
  filename: string;
  period_label?: string | null;
  uploaded_at: string;
  summary?: string;
  line_items: any[];
  anomalies: { id: string; severity: 'alert' | 'warning' | 'info'; title: string; detail: string; suggested_action?: string | null; rule?: string | null; dollar_impact?: number | null; evidence?: string[] | null }[];
  anomaly_dollar_impact_total?: number | null;
  informational_notes?: { kind?: string; title?: string; detail?: string }[];
};

export default function StatementDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [stmt, setStmt] = useState<Stmt | null>(null);
  const [loading, setLoading] = useState(true);
  const [downloadingKind, setDownloadingKind] = useState<null | 'original' | 'pdf' | 'csv'>(null);

  // Phase 6 hardening: prevent screenshots / screen-recording / task-switcher
  // snapshots while a statement detail (line items, anomalies, dollar amounts) is on screen.
  useSensitiveScreen();

  useEffect(() => {
    (async () => {
      try {
        const { data } = await api.get<Stmt>(`/statements/${id}`);
        setStmt(data);
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

  // Download mirrors the web app's three download buttons exactly:
  //   • 'original' → GET /api/statements/{id}/download       (server-rendered TXT)
  //   • 'csv'      → GET /api/statements/{id}/decoded.csv    (server-rendered CSV)
  //   • 'pdf'      → GET /api/statements/{id}/decoded.pdf    (server-rendered PDF — identical bytes for every caller)
  // Server endpoints live in /app/backend/routes/statements.py; once deployed
  // the web app will move to the same endpoints so web + mobile share one PDF.
  const download = async (kind: 'original' | 'pdf' | 'csv') => {
    if (!stmt) return;
    setDownloadingKind(kind);
    try {
      const baseName = (stmt.period_label || stmt.filename || 'statement').replace(/[^\w.-]+/g, '-');
      const today = new Date().toISOString().slice(0, 10);

      // ---------- ORIGINAL (TXT) — server fetch ----------
      if (kind === 'original') {
        const base = (api.defaults?.baseURL || '').replace(/\/+$/, '');
        const url = `${base}/statements/${stmt.id}/download`;
        const token = await getAccessToken();
        if (!token) throw new Error('Not signed in');
        const filename = `wayly-${baseName}-original.txt`;

        if (Platform.OS === 'web') {
          const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const blob = await res.blob();
          const objUrl = URL.createObjectURL(blob);
          const a = (globalThis as any).document?.createElement?.('a');
          if (a) {
            a.href = objUrl; a.download = filename; a.style.display = 'none';
            (globalThis as any).document.body.appendChild(a); a.click(); a.remove();
          } else { Linking.openURL(objUrl); }
          return;
        }
        const dest = (FileSystem.cacheDirectory || '') + filename;
        const dl = await FileSystem.downloadAsync(url, dest, { headers: { Authorization: `Bearer ${token}` } });
        if (dl.status !== 200) throw new Error(`HTTP ${dl.status}`);
        if (await Sharing.isAvailableAsync()) {
          await Sharing.shareAsync(dl.uri, { mimeType: 'text/plain' });
        } else {
          Alert.alert('Downloaded', `Saved to ${dl.uri}`);
        }
        return;
      }

      // ---------- DECODED CSV — client-side ----------
      if (kind === 'csv') {
        const lis: any[] = stmt.line_items || [];
        const esc = (v: any) => {
          const s = v == null ? '' : String(v);
          return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
        };
        // Match the web app's decoded PDF column set: Date | Service | Stream | Hrs | Rate | Gross | Contrib. | Gov paid
        const header = ['Date', 'Service', 'Stream', 'Hrs', 'Rate', 'Gross', 'Contrib.', 'Gov paid'];
        const rows = lis.map((li: any) => {
          const gross = Number(li.total) || Number(li.gross) || 0;
          const part = Number(li.contribution_paid) || Number(li.participant_contribution) || 0;
          const govRaw = Number(li.government_paid ?? li.gov_paid);
          const gov = Number.isFinite(govRaw) ? govRaw : Math.max(0, gross - part);
          return [
            li.date || li.service_date || '',
            li.service || li.support_code || li.service_code || '',
            li.stream || li.budget_stream || '',
            li.hours ?? li.quantity ?? '',
            li.unit_price ?? li.rate ?? '',
            gross,
            part,
            gov,
          ];
        });
        const csv = [header, ...rows].map((r) => r.map(esc).join(',')).join('\n');
        const filename = `statement-decoded-${today}.csv`;

        if (Platform.OS === 'web') {
          const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
          const objUrl = URL.createObjectURL(blob);
          const a = (globalThis as any).document?.createElement?.('a');
          if (a) {
            a.href = objUrl; a.download = filename; a.style.display = 'none';
            (globalThis as any).document.body.appendChild(a); a.click(); a.remove();
          }
          return;
        }
        const dest = (FileSystem.cacheDirectory || '') + filename;
        await FileSystem.writeAsStringAsync(dest, csv, { encoding: FileSystem.EncodingType.UTF8 });
        if (await Sharing.isAvailableAsync()) {
          await Sharing.shareAsync(dest, { mimeType: 'text/csv', UTI: 'public.comma-separated-values-text' });
        } else {
          Alert.alert('Downloaded', `Saved to ${dest}`);
        }
        return;
      }

      // ---------- DECODED PDF — server-rendered ----------
      if (kind === 'pdf') {
        // Mirror the Original-TXT download path: fetch the server-rendered PDF
        // from GET /api/statements/{id}/decoded.pdf (the same endpoint the web
        // app uses once deployed), then save/share via the OS share sheet on
        // native or a download anchor on web. This guarantees the BYTES are
        // identical across web + iOS + Android.
        const base = (api.defaults?.baseURL || '').replace(/\/+$/, '');
        const url = `${base}/statements/${stmt.id}/decoded.pdf`;
        const token = await getAccessToken();
        if (!token) throw new Error('Not signed in');
        const filename = `wayly-${baseName}-decoded.pdf`;

        if (Platform.OS === 'web') {
          const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const blob = await res.blob();
          const objUrl = URL.createObjectURL(blob);
          const a = (globalThis as any).document?.createElement?.('a');
          if (a) {
            a.href = objUrl; a.download = filename; a.style.display = 'none';
            (globalThis as any).document.body.appendChild(a); a.click(); a.remove();
          } else { Linking.openURL(objUrl); }
          return;
        }
        const dest = (FileSystem.cacheDirectory || '') + filename;
        const dl = await FileSystem.downloadAsync(url, dest, { headers: { Authorization: `Bearer ${token}` } });
        if (dl.status !== 200) throw new Error(`HTTP ${dl.status}`);
        if (await Sharing.isAvailableAsync()) {
          await Sharing.shareAsync(dl.uri, { mimeType: 'application/pdf' });
        } else {
          Alert.alert('Downloaded', `Saved to ${dl.uri}`);
        }
        return;
      }
    } catch (e: any) {
      toast.error(e?.message || `Could not download ${kind === 'csv' ? 'CSV' : kind === 'pdf' ? 'PDF' : 'file'}.`);
    } finally {
      setDownloadingKind(null);
    }
  };

  const askWayly = () => {
    if (!stmt) return;
    // Deep-link to the Ask Wayly tab and seed the conversation with a
    // statement-scoped prompt. The chat screen reads `?statement_id=` and
    // `?prompt=` from the URL and prefills the composer (mirror of the web
    // app's "Ask Wayly about this statement" button on /app/statements/[id]).
    const period = stmt.period_label || stmt.filename || 'this statement';
    router.push({
      pathname: '/(tabs)/chat' as any,
      params: {
        statement_id: stmt.id,
        prompt: `Help me understand ${period}.`,
      },
    });
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <BackHeader title="Statement" />
        <View style={styles.loadingFill}>
          <ActivityIndicator size="large" color={Colors.brandPrimary} />
        </View>
      </SafeAreaView>
    );
  }

  if (!stmt) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <BackHeader title="Statement" />
        <View style={styles.loadingFill}>
          <Text style={styles.emptyText}>Statement not found.</Text>
        </View>
      </SafeAreaView>
    );
  }

  const total = (stmt.line_items || []).reduce((acc, li: any) => acc + (li.total || 0), 0);
  const totalContribution = (stmt.line_items || []).reduce(
    (acc, li: any) => acc + (li.contribution_paid || 0),
    0
  );

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <BackHeader title="Statement" />
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.overline}>Statement</Text>
        <Text style={styles.h1}>{stmt.period_label || stmt.filename}</Text>
        <Text style={styles.subline}>
          {(stmt.line_items || []).length} line items · {formatAUD2(total)} total ·{' '}
          {formatAUD2(totalContribution)} you paid
        </Text>

        {/* Ask Wayly — top primary CTA, mirrors the web app's prominent "Ask
            Wayly about this statement" button at the top of the page. */}
        <TouchableOpacity
          style={styles.askBtn}
          onPress={askWayly}
          testID="statement-ask-wayly"
          accessibilityRole="button"
          activeOpacity={0.85}
        >
          <Ionicons name="chatbubbles" size={18} color="#FFFFFF" />
          <Text style={styles.askBtnText}>Ask Wayly about this statement</Text>
        </TouchableOpacity>

        {/* Download tiles — three large, equally-prominent cards matching
            the web app's download row. Each tile has icon on top, label
            below, and a clear secondary "Download" hint. */}
        <Text style={styles.downloadsLabel}>Downloads</Text>
        <View style={styles.tilesRow} testID="statement-actions-row">
          <TouchableOpacity
            style={[styles.tile, downloadingKind === 'original' && styles.tileBusy]}
            onPress={() => download('original')}
            disabled={!!downloadingKind}
            testID="statement-download-original"
            accessibilityRole="button"
            accessibilityLabel="Download original file"
            activeOpacity={0.85}
          >
            {downloadingKind === 'original' ? (
              <ActivityIndicator color={Colors.brandPrimary} size="small" />
            ) : (
              <View style={styles.tileIconWrap}>
                <Ionicons name="document-text" size={22} color={Colors.brandPrimary} />
              </View>
            )}
            <Text style={styles.tileLabel}>Original (TXT)</Text>
            <Text style={styles.tileHint}>As received</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.tile, downloadingKind === 'pdf' && styles.tileBusy]}
            onPress={() => download('pdf')}
            disabled={!!downloadingKind}
            testID="statement-download-decoded-pdf"
            accessibilityRole="button"
            accessibilityLabel="Download decoded PDF"
            activeOpacity={0.85}
          >
            {downloadingKind === 'pdf' ? (
              <ActivityIndicator color={Colors.brandPrimary} size="small" />
            ) : (
              <View style={[styles.tileIconWrap, { backgroundColor: 'rgba(183, 121, 31, 0.10)' }]}>
                <Ionicons name="sparkles" size={22} color={Colors.brandSecondary} />
              </View>
            )}
            <Text style={styles.tileLabel}>Decoded PDF</Text>
            <Text style={styles.tileHint}>Plain English</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.tile, downloadingKind === 'csv' && styles.tileBusy]}
            onPress={() => download('csv')}
            disabled={!!downloadingKind}
            testID="statement-download-csv"
            accessibilityRole="button"
            accessibilityLabel="Download decoded CSV"
            activeOpacity={0.85}
          >
            {downloadingKind === 'csv' ? (
              <ActivityIndicator color={Colors.brandPrimary} size="small" />
            ) : (
              <View style={[styles.tileIconWrap, { backgroundColor: 'rgba(139, 155, 130, 0.14)' }]}>
                <Ionicons name="grid" size={22} color="#5B7B5A" />
              </View>
            )}
            <Text style={styles.tileLabel}>Decoded CSV</Text>
            <Text style={styles.tileHint}>Spreadsheet</Text>
          </TouchableOpacity>
        </View>

        {stmt.summary && (
          <View style={styles.summaryCard} testID="statement-detail-summary">
            <Text style={styles.summaryOverline}>In plain English</Text>
            <Text style={styles.summaryText}>{stmt.summary}</Text>
          </View>
        )}

        {(stmt.anomalies || []).length > 0 && (
          <View style={styles.section}>
            <View style={styles.anomaliesHead}>
              <Text style={styles.sectionTitle}>Things to know</Text>
              {(stmt.anomaly_dollar_impact_total ?? 0) > 0 ? (
                <View style={styles.impactPill} testID="anomalies-total-impact">
                  <Text style={styles.impactPillText}>Potential impact: {formatAUD2(stmt.anomaly_dollar_impact_total || 0)}</Text>
                </View>
              ) : null}
            </View>
            {stmt.anomalies.map((a) => {
              const s = SEVERITY[a.severity] || SEVERITY.info;
              return (
                <View
                  key={a.id}
                  style={[styles.anomalyCard, { borderColor: s.color, backgroundColor: s.bg }]}
                  testID={`anomaly-${a.rule || a.id}`}
                >
                  <View style={styles.anomalyHead}>
                    <Ionicons name={s.icon} size={18} color={s.color} />
                    <Text style={[styles.anomalyTitle, { color: s.color }]}>{a.title}</Text>
                    {a.dollar_impact != null && a.dollar_impact > 0 ? (
                      <Text style={[styles.anomalyDollar, { color: s.color }]} testID={`anomaly-dollar-${a.id}`}>{formatAUD2(a.dollar_impact)}</Text>
                    ) : null}
                  </View>
                  <Text style={styles.anomalyDetail}>{a.detail}</Text>
                  {a.suggested_action && (
                    <Text style={styles.anomalyAction}>→ {a.suggested_action}</Text>
                  )}
                  {Array.isArray(a.evidence) && a.evidence.length > 0 ? (
                    <View testID={`anomaly-evidence-${a.id}`} style={styles.evidenceBox}>
                      <Text style={styles.evidenceTitle}>Why was this flagged?</Text>
                      {a.evidence.slice(0, 4).map((line, i) => (
                        <Text key={i} style={styles.evidenceLine}>• {line}</Text>
                      ))}
                    </View>
                  ) : null}
                  {a.rule ? (
                    <Text style={styles.anomalyRule} testID={`anomaly-rule-${a.id}`}>{a.rule}</Text>
                  ) : null}
                </View>
              );
            })}
          </View>
        )}

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Line items</Text>
          {(stmt.line_items || []).map((li: any) => {
            const streamColor = Colors.streams[li.stream] || Colors.textMuted;
            return (
              <View key={li.id} style={styles.lineItem} testID={`statement-line-item-${li.id}`}>
                <View style={styles.lineItemHead}>
                  <Text style={styles.lineDate}>{li.date}</Text>
                  <Text style={styles.lineTotal}>{formatAUD2(li.total)}</Text>
                </View>
                <Text style={styles.lineService}>{li.service_name}</Text>
                <View style={styles.lineMetaRow}>
                  <View
                    style={[styles.streamChip, { backgroundColor: `${streamColor}20` }]}
                    testID="statement-line-item-stream-chip"
                  >
                    <View style={[styles.streamDot, { backgroundColor: streamColor }]} />
                    <Text style={[styles.streamChipText, { color: streamColor }]}>
                      {li.stream}
                    </Text>
                  </View>
                  <Text style={styles.lineMetaText}>
                    {li.units} × {formatAUD2(li.unit_price)}
                  </Text>
                </View>
                {li.contribution_paid > 0 && (
                  <Text style={styles.lineYouPaid}>
                    You paid {formatAUD2(li.contribution_paid)}
                  </Text>
                )}
              </View>
            );
          })}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  loadingFill: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyText: { fontFamily: Fonts.body, color: Colors.textSecondary },
  scroll: { padding: Spacing.lg, paddingBottom: Spacing.xl },
  overline: {
    fontFamily: Fonts.bodyMed, fontSize: 11, letterSpacing: 1.5, textTransform: 'uppercase',
    color: Colors.textMuted, marginBottom: 4,
  },
  h1: { fontFamily: Fonts.heading, fontSize: 28, color: Colors.brandPrimary, letterSpacing: -0.5 },
  subline: { fontFamily: Fonts.body, fontSize: 13, color: Colors.textSecondary, marginTop: 6, marginBottom: Spacing.md },
  askBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
    backgroundColor: Colors.brandPrimary, borderRadius: Radius.md,
    paddingVertical: 14, marginBottom: Spacing.md, minHeight: 50,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.08, shadowRadius: 6, elevation: 2,
  },
  askBtnText: { fontFamily: Fonts.bodySemi, fontSize: 15, color: '#FFFFFF', letterSpacing: 0.2 },
  downloadsLabel: {
    fontFamily: Fonts.bodyMed, fontSize: 11, letterSpacing: 1.2, textTransform: 'uppercase',
    color: Colors.textMuted, marginBottom: 10,
  },
  tilesRow: { flexDirection: 'row', gap: 10, marginBottom: Spacing.lg },
  tile: {
    flex: 1, alignItems: 'center', justifyContent: 'flex-start',
    paddingVertical: 14, paddingHorizontal: 8, minHeight: 108,
    borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.borderSubtle,
    backgroundColor: Colors.cardBg,
  },
  tileBusy: { opacity: 0.55 },
  tileIconWrap: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: 'rgba(14, 77, 82, 0.08)',
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 8,
  },
  tileLabel: { fontFamily: Fonts.bodySemi, fontSize: 13, color: Colors.brandPrimary, textAlign: 'center' },
  tileHint: { fontFamily: Fonts.body, fontSize: 11, color: Colors.textMuted, marginTop: 2, textAlign: 'center' },
  summaryCard: {
    backgroundColor: 'rgba(183, 121, 31, 0.08)', borderRadius: Radius.lg, padding: Spacing.md + 4,
    borderWidth: 1, borderColor: 'rgba(183, 121, 31, 0.3)', marginBottom: Spacing.lg,
  },
  summaryOverline: {
    fontFamily: Fonts.bodyMed, fontSize: 10, letterSpacing: 1, textTransform: 'uppercase',
    color: Colors.brandSecondary, marginBottom: 6,
  },
  summaryText: { fontFamily: Fonts.body, fontSize: 15, color: Colors.brandPrimary, lineHeight: 22 },
  section: { marginBottom: Spacing.lg },
  sectionTitle: { fontFamily: Fonts.headingMed, fontSize: 17, color: Colors.brandPrimary, marginBottom: Spacing.md },
  anomalyCard: {
    borderRadius: Radius.md, padding: Spacing.md, borderLeftWidth: 4,
    marginBottom: Spacing.sm,
  },
  anomalyHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  anomalyTitle: { fontFamily: Fonts.bodySemi, fontSize: 15, flex: 1 },
  anomalyDetail: { fontFamily: Fonts.body, fontSize: 13, color: Colors.textPrimary, marginTop: 6, lineHeight: 19 },
  anomalyAction: { fontFamily: Fonts.bodyMed, fontSize: 13, color: Colors.brandPrimary, fontStyle: 'italic', marginTop: 8 },
  anomalyDollar: { fontFamily: Fonts.bodySemi, fontSize: 13 },
  anomaliesHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: Spacing.md, gap: 8, flexWrap: 'wrap' },
  impactPill: { backgroundColor: 'rgba(192, 57, 43, 0.10)', borderRadius: 100, paddingHorizontal: 10, paddingVertical: 5 },
  impactPillText: { fontFamily: Fonts.bodySemi, fontSize: 11, color: Colors.severityAlert, letterSpacing: 0.3 },
  evidenceBox: { marginTop: Spacing.sm, paddingTop: Spacing.sm, borderTopWidth: 1, borderTopColor: 'rgba(0,0,0,0.08)' },
  evidenceTitle: { fontFamily: Fonts.bodyMed, fontSize: 11, color: Colors.textSecondary, marginBottom: 4, letterSpacing: 0.3, textTransform: 'uppercase' },
  evidenceLine: { fontFamily: Fonts.body, fontSize: 12, color: Colors.textPrimary, lineHeight: 17 },
  anomalyRule: { fontFamily: 'Courier', fontSize: 10, color: Colors.textMuted, marginTop: 8, letterSpacing: 0.3 },
  lineItem: {
    backgroundColor: Colors.cardBg, borderRadius: Radius.md, padding: Spacing.md,
    marginBottom: Spacing.sm, borderWidth: 1, borderColor: Colors.borderSubtle,
  },
  lineItemHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  lineDate: { fontFamily: Fonts.bodyMed, fontSize: 12, color: Colors.textMuted },
  lineTotal: { fontFamily: Fonts.bodySemi, fontSize: 15, color: Colors.brandPrimary },
  lineService: { fontFamily: Fonts.bodySemi, fontSize: 15, color: Colors.brandPrimary, marginTop: 6 },
  lineMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 8, flexWrap: 'wrap' },
  streamChip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 100 },
  streamDot: { width: 8, height: 8, borderRadius: 4 },
  streamChipText: { fontFamily: Fonts.bodySemi, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 },
  lineMetaText: { fontFamily: Fonts.body, fontSize: 12, color: Colors.textSecondary },
  lineYouPaid: { fontFamily: Fonts.bodyMed, fontSize: 12, color: Colors.textSecondary, marginTop: 6 },
});
