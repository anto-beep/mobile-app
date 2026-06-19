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
import * as Print from 'expo-print';
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
  //   • 'original' → GET /api/statements/{id}/download (server-rendered TXT)
  //   • 'csv'      → built CLIENT-SIDE from stmt.line_items (no API call)
  //   • 'pdf'      → built CLIENT-SIDE: HTML printed via expo-print on native /
  //                  print window on web (no API call)
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

      // ---------- DECODED PDF — client-side ----------
      if (kind === 'pdf') {
        // Helpers are inlined here (not at module scope) to guarantee they're
        // in the closure of every template-literal call below — bypasses any
        // Hermes/Metro scope quirks where module-level consts referenced only
        // inside `${...}` interpolation can be dead-stripped.
        const _esc = (s: any): string =>
          String(s ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
        const _money = (n: any): string => {
          const v = typeof n === 'number' ? n : parseFloat(n);
          if (!Number.isFinite(v)) return '';
          return `$${v.toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
        };

        const lis: any[] = stmt.line_items || [];
        const anomalies: any[] = (stmt as any).anomalies || [];
        // Aggregate the three KPI totals exactly like the web app's Decoded PDF.
        const grossTotal = lis.reduce((a: number, li: any) => a + (Number(li.total) || Number(li.gross) || 0), 0);
        const partContrib = lis.reduce((a: number, li: any) => a + (Number(li.contribution_paid) || Number(li.participant_contribution) || 0), 0);
        // Government paid = sum if present, else derived (gross − participant contribution).
        const govPaid = lis.reduce((a: number, li: any) => {
          const g = Number(li.government_paid ?? li.gov_paid);
          if (Number.isFinite(g)) return a + g;
          const gross = Number(li.total) || Number(li.gross) || 0;
          const part = Number(li.contribution_paid) || Number(li.participant_contribution) || 0;
          return a + Math.max(0, gross - part);
        }, 0);
        const periodLabel = stmt.period_label || stmt.filename || 'Statement';
        const todayAu = new Date().toLocaleDateString('en-AU');

        const rowsHtml = lis.map((li: any) => {
          const rowGross = Number(li.total) || Number(li.gross) || 0;
          const rowPart = Number(li.contribution_paid) || Number(li.participant_contribution) || 0;
          const rowGov = Number.isFinite(Number(li.government_paid ?? li.gov_paid))
            ? Number(li.government_paid ?? li.gov_paid)
            : Math.max(0, rowGross - rowPart);
          return `
          <tr>
            <td>${_esc(li.date || li.service_date || '')}</td>
            <td>${_esc(li.service || li.support_code || li.service_code || '')}</td>
            <td>${_esc(li.stream || li.budget_stream || '')}</td>
            <td style="text-align:right;">${_esc(li.hours ?? li.quantity ?? '')}</td>
            <td style="text-align:right;">${rowGross && (li.unit_price || li.rate) ? _money(li.unit_price ?? li.rate) : ''}</td>
            <td style="text-align:right;">${_money(rowGross)}</td>
            <td style="text-align:right;">${_money(rowPart)}</td>
            <td style="text-align:right;">${_money(rowGov)}</td>
          </tr>`;
        }).join('');

        const sevColor = (sev: string) => {
          const s = String(sev || '').toLowerCase();
          if (s === 'alert' || s === 'error') return { bg: '#FDE8E2', fg: '#A54030' };
          if (s === 'warning' || s === 'warn') return { bg: '#FAEFD4', fg: '#5C3D11' };
          return { bg: '#E8F0F0', fg: '#0E4D52' }; // info / default
        };
        const anomaliesHtml = anomalies.length === 0 ? '' : `
  <h2 class="section">Anomalies (${anomalies.length})</h2>
  ${anomalies.map((a: any) => {
    const p = sevColor(a.severity);
    return `
    <div class="anomaly">
      <div class="anomaly-header">
        <span class="badge" style="background:${p.bg};color:${p.fg};">${_esc(String(a.severity || 'info').toUpperCase())}</span>
        <span class="anomaly-title">${_esc(a.title || a.summary || a.message || '')}</span>
      </div>
      ${a.detail || a.body ? `<p class="anomaly-body">${_esc(a.detail || a.body)}</p>` : ''}
      ${a.action || a.next_action ? `<p class="anomaly-action">→ ${_esc(a.action || a.next_action)}</p>` : ''}
    </div>`;
  }).join('')}`;

        const html = `<!doctype html>
<html><head><meta charset="utf-8"/><title>Decoded statement - ${_esc(periodLabel)}</title>
<style>
  @page { size: A4; margin: 18mm 14mm; }
  body { font-family: -apple-system, "Helvetica Neue", Arial, sans-serif; color: #1A2B3F; margin: 0; background: #FBF9F3; }
  .header { border-bottom: 2px solid #0E4D52; padding-bottom: 10px; margin-bottom: 18px; }
  h1 { font-size: 22px; color: #0E4D52; margin: 0; letter-spacing: -0.3px; }
  .disclaimer { color: #6B7C92; font-size: 11px; margin-top: 6px; font-style: italic; }
  h2.section { font-size: 14px; color: #0E4D52; margin: 22px 0 10px; letter-spacing: 0.3px; }
  .period { font-size: 12px; color: #1A2B3F; margin-bottom: 12px; }
  .period strong { color: #0E4D52; }
  .kpis { display: flex; gap: 10px; margin-bottom: 18px; }
  .kpi { flex: 1; border: 1px solid #E6E2D6; border-radius: 8px; padding: 12px; background: #FFFFFF; }
  .kpi-label { font-size: 9px; color: #6B7C92; letter-spacing: 1.2px; text-transform: uppercase; margin-bottom: 4px; }
  .kpi-value { font-size: 18px; color: #0E4D52; font-weight: 700; }
  .kpi.gold .kpi-value { color: #A5512B; }
  .kpi.gov .kpi-value { color: #5B7B5A; }
  table { width: 100%; border-collapse: collapse; font-size: 10px; background: #FFFFFF; border-radius: 6px; overflow: hidden; }
  th { text-align: left; padding: 8px 6px; background: #F4EFE3; border-bottom: 2px solid #0E4D52; color: #0E4D52; font-weight: 700; font-size: 10px; }
  td { padding: 7px 6px; border-bottom: 1px solid #E6E2D6; }
  tr:nth-child(even) td { background: #FBF9F3; }
  .anomaly { border: 1px solid #E6E2D6; border-left: 3px solid #A5512B; border-radius: 6px; padding: 10px 12px; margin-bottom: 10px; background: #FFFFFF; }
  .anomaly-header { display: flex; gap: 8px; align-items: center; margin-bottom: 4px; }
  .badge { font-size: 9px; padding: 2px 6px; border-radius: 4px; font-weight: 700; letter-spacing: 0.4px; }
  .anomaly-title { font-size: 12px; color: #1A2B3F; font-weight: 600; }
  .anomaly-body { font-size: 11px; color: #4A5A70; margin: 4px 0 6px; line-height: 1.5; }
  .anomaly-action { font-size: 11px; color: #0E4D52; margin: 0; font-weight: 600; }
  .footer { margin-top: 28px; font-size: 9px; color: #9AA5B5; text-align: center; border-top: 1px solid #E6E2D6; padding-top: 10px; }
  .container { padding: 24px; }
</style></head>
<body>
<div class="container">
  <div class="header">
    <h1>Decoded statement - ${_esc(periodLabel)}</h1>
    <div class="disclaimer">Decoded by Wayly. AI-generated summary — please verify against the original statement before acting.</div>
  </div>

  <h2 class="section">Summary</h2>
  <div class="period">Period: <strong>${_esc(periodLabel)}</strong></div>
  <div class="kpis">
    <div class="kpi">
      <div class="kpi-label">Gross total</div>
      <div class="kpi-value">${_money(grossTotal)}</div>
    </div>
    <div class="kpi gold">
      <div class="kpi-label">Participant contribution</div>
      <div class="kpi-value">${_money(partContrib)}</div>
    </div>
    <div class="kpi gov">
      <div class="kpi-label">Government paid</div>
      <div class="kpi-value">${_money(govPaid)}</div>
    </div>
  </div>

  <h2 class="section">Line items (${lis.length})</h2>
  <table>
    <thead>
      <tr>
        <th>Date</th>
        <th>Service</th>
        <th>Stream</th>
        <th style="text-align:right;">Hrs</th>
        <th style="text-align:right;">Rate</th>
        <th style="text-align:right;">Gross</th>
        <th style="text-align:right;">Contrib.</th>
        <th style="text-align:right;">Gov paid</th>
      </tr>
    </thead>
    <tbody>${rowsHtml || '<tr><td colspan="8" style="text-align:center;color:#9AA5B5;padding:18px;">No line items</td></tr>'}</tbody>
  </table>
${anomaliesHtml}
  <div class="footer">Generated by Wayly. ${_esc(todayAu)}. This is an AI summary; the original statement remains the source of truth.</div>
</div>
</body></html>`;

        if (Platform.OS === 'web') {
          // Mirror the web app: open a popup with the HTML and let the user
          // print/save as PDF from the print dialog.
          const w = (globalThis as any).window?.open?.('', '_blank');
          if (!w) throw new Error('Popup blocked');
          w.document.write(html);
          w.document.close();
          w.focus();
          setTimeout(() => { try { w.print(); } catch {} }, 250);
          return;
        }
        // Native: expo-print renders to a real PDF file we can share via the OS sheet.
        const { uri } = await Print.printToFileAsync({ html, base64: false });
        if (await Sharing.isAvailableAsync()) {
          await Sharing.shareAsync(uri, { mimeType: 'application/pdf' });
        } else {
          Alert.alert('Downloaded', `Saved to ${uri}`);
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
