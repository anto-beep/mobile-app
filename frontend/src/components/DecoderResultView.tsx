// Shared decoder result view — mobile mirror of the web `<DecoderResultView>`.
//
// Renders the six sections (A–F) mandated by the Statement Decoder web-parity
// spec (`/app/MOBILE_AGENT_STATEMENT_DECODER_PROMPT.md`), driven by a single
// `Stmt`-like data blob. Consumers:
//
//   • `/app/statements/[id].tsx`         → passes the persisted-statement doc
//   • `/app/tools/statement-decoder.tsx` → passes the transient job result
//
// Keeping this in one component guarantees zero divergence between the two
// screens (spec §7 last checkbox).
import React, { useMemo, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Fonts, Radius, Spacing, formatAUD2 } from '../lib/theme';
import type { ColorPalette } from '../lib/theme';
import { useColors } from '../hooks/useColors';
import { useThemedStyles } from '../hooks/useThemedStyles';
import { formatDate } from '../lib/formatDate';

/* ------------------------------ types ------------------------------------- */

export type DecoderAnomaly = {
  id?: string;
  severity?: string;                 // 'alert'|'warning'|'info' OR 'high'|'medium'|'low'
  raw_severity?: string;             // original 'high'|'medium'|'low' when backend translates
  rule?: string | null;
  headline?: string | null;
  title?: string | null;
  detail?: string | null;
  suggested_action?: string | null;
  dollar_impact?: number | null;
  evidence?: string[] | null;
};

export type DecoderLineItem = {
  id?: string;
  date?: string | null;
  service_code?: string | null;
  service_name?: string | null;
  service?: string | null;
  stream?: string | null;
  units?: number | null;
  unit_price?: number | null;
  total?: number | null;
  contribution_paid?: number | null;
  participant_contribution?: number | null;
  government_paid?: number | null;
  gross?: number | null;
};

export type DecoderData = {
  id?: string;
  filename?: string | null;
  period_label?: string | null;
  input_method?: 'text_paste' | 'file_upload' | 'dashboard_upload' | string | null;
  summary?: string | null;
  parsing_warnings?: string[] | null;
  audit_json?: {
    statement_summary?: {
      participant_name?: string | null;
      period?: string | null;
      provider?: string | null;
      classification?: string | number | null;
      total_line_items?: number | null;
      total_gross?: number | null;
      total_participant_contribution?: number | null;
      total_government_paid?: number | null;
      care_management_fee?: number | null;
      budget_remaining?: number | null;
      adjusted_budget_remaining?: number | null;
    } | null;
    stream_breakdown?: {
      stream: string;
      line_item_count?: number;
      gross_total?: number;
      participant_contribution?: number;
      government_paid?: number;
    }[] | null;
    anomaly_count?: { high?: number; medium?: number; low?: number } | null;
    anomalies?: DecoderAnomaly[] | null;
  } | null;
  extracted_json?: any;
  line_items?: DecoderLineItem[] | null;
  anomalies?: DecoderAnomaly[] | null;
};

type Props = {
  data: DecoderData;
  /** Hide Section F if the caller provides its own action row. */
  showActions?: boolean;
  /** Called when user taps Download PDF (Section F). */
  onDownloadPdf?: () => void;
  /** Called when user taps Download CSV (Section F). */
  onDownloadCsv?: () => void;
  /** AI-Tools only. When present, shows the "Saved to your Statements" strip. */
  persistedStatementId?: string | null;
  /** AI-Tools only. Primary CTA when a decode was auto-saved. */
  onOpenInStatements?: () => void;
  /** AI-Tools only. Secondary CTA. */
  onDecodeAnother?: () => void;
};

/* ------------------------------ helpers ----------------------------------- */

const HIGH_KEYS = new Set(['high', 'alert']);
const MED_KEYS = new Set(['medium', 'warning']);
// LOW is the fallback in canonicalSeverity(), so we don't need an explicit set.

/** Normalise to canonical `HIGH`/`MEDIUM`/`LOW`. Spec §9 says do NOT translate,
 * but the persisted-statement endpoint already normalises to alert/warning/info.
 * We accept both, then always render as HIGH/MEDIUM/LOW at the display layer
 * because that is what the spec's Section C mandates. */
function canonicalSeverity(a: DecoderAnomaly): 'HIGH' | 'MEDIUM' | 'LOW' {
  const raw = (a.raw_severity || a.severity || 'low').toString().toLowerCase();
  if (HIGH_KEYS.has(raw)) return 'HIGH';
  if (MED_KEYS.has(raw)) return 'MEDIUM';
  return 'LOW';
}

const SEV_ORDER: Record<'HIGH' | 'MEDIUM' | 'LOW', number> = { HIGH: 0, MEDIUM: 1, LOW: 2 };

function inputMethodLabel(m: string | null | undefined): string | null {
  if (!m) return null;
  const key = m.toLowerCase();
  if (key === 'text_paste') return 'From pasted text';
  if (key === 'file_upload') return 'From uploaded file';
  if (key === 'dashboard_upload') return 'From dashboard upload';
  return null;
}

/** Insert spaces into `EverydayLiving` → `Everyday Living` for readability.
 * Kept minimal so we don't accidentally alter multi-word backend labels like
 * `Care Management` or `AT-HM`. */
function prettifyStream(s: string): string {
  if (!s) return '';
  if (s.indexOf(' ') !== -1 || s.indexOf('-') !== -1) return s;
  // camelCase → space-separated: `EverydayLiving` → `Everyday Living`
  return s.replace(/([a-z])([A-Z])/g, '$1 $2');
}

/* ------------------------------- component -------------------------------- */

export function DecoderResultView(props: Props) {
  const {
    data,
    showActions = true,
    onDownloadPdf,
    onDownloadCsv,
    persistedStatementId,
    onOpenInStatements,
    onDecodeAnother,
  } = props;

  const c = useColors();
  const styles = useThemedStyles(makeStyles);
  const [showLineItems, setShowLineItems] = useState(false);
  const [expandedStreams, setExpandedStreams] = useState<Record<string, boolean>>({});

  const summary = (data.summary || '').trim();
  const summaryParas = useMemo(() => (summary ? summary.split(/\n{2,}/) : []), [summary]);

  const parsingWarnings = (data.parsing_warnings || []).filter(Boolean);
  const stmtSummary = data.audit_json?.statement_summary || null;
  const streamBreakdown = data.audit_json?.stream_breakdown || [];
  const backendAnomalies = data.audit_json?.anomalies || [];
  const topLevelAnomalies = data.anomalies || [];

  // Prefer audit_json.anomalies when present (has rich `headline`, `evidence`),
  // otherwise fall back to top-level (which may be the old shape with `title`).
  const anomalies: DecoderAnomaly[] = useMemo(() => {
    const source = backendAnomalies.length ? backendAnomalies : topLevelAnomalies;
    return [...source].sort(
      (a, b) => SEV_ORDER[canonicalSeverity(a)] - SEV_ORDER[canonicalSeverity(b)],
    );
  }, [backendAnomalies, topLevelAnomalies]);

  const highCount = anomalies.filter((a) => canonicalSeverity(a) === 'HIGH').length;
  const medCount = anomalies.filter((a) => canonicalSeverity(a) === 'MEDIUM').length;
  const lowCount = anomalies.filter((a) => canonicalSeverity(a) === 'LOW').length;

  const lineItems = data.line_items || [];
  const methodChip = inputMethodLabel(data.input_method as any);

  /* -------------------------------- render ------------------------------- */
  return (
    <View style={styles.wrap}>
      {/* Auto-saved strip for AI-Tools decodes */}
      {persistedStatementId ? (
        <View style={styles.savedStrip} testID="decoder-saved-strip">
          <Ionicons name="checkmark-circle" size={16} color="#FFFFFF" />
          <Text style={styles.savedStripText}>Saved to your Statements</Text>
        </View>
      ) : null}

      {/* ─────────────────── Section A · In plain English ────────────────── */}
      {summaryParas.length > 0 && (
        <View style={styles.plainCard} testID="decoder-plain-english-summary">
          <View style={styles.plainHead}>
            <View style={styles.plainIconWrap}>
              <Ionicons name="information-circle" size={18} color="#FFFFFF" />
            </View>
            <Text style={styles.plainOverline}>IN PLAIN ENGLISH</Text>
          </View>
          {summaryParas.map((para, i) => (
            <Text key={i} style={[styles.plainPara, i > 0 && { marginTop: 12 }]}>
              {para}
            </Text>
          ))}
          <Text style={styles.plainDisclaimer}>
            AI-generated summary. Always verify important figures with your provider or My Aged Care before acting.
          </Text>
        </View>
      )}

      {/* Parsing warnings strip (spec §2 note) */}
      {parsingWarnings.length > 0 && (
        <View style={styles.warnStrip} testID="decoder-parsing-warnings">
          <Ionicons name="warning-outline" size={16} color={c.severityWarning} />
          <View style={{ flex: 1 }}>
            {parsingWarnings.map((w, i) => (
              <Text key={i} style={styles.warnText}>{w}</Text>
            ))}
          </View>
        </View>
      )}

      {/* ─────────────────── Section B · Summary banner (teal) ───────────── */}
      {stmtSummary && (
        <View style={styles.banner} testID="decoder-summary-banner">
          {methodChip && (
            <View style={styles.methodChip}>
              <Text style={styles.methodChipText}>{methodChip}</Text>
            </View>
          )}
          <Text style={styles.bannerHead}>
            {[stmtSummary.period, stmtSummary.participant_name,
              stmtSummary.classification ? `Class ${stmtSummary.classification}` : null,
              stmtSummary.provider,
            ].filter(Boolean).join(' · ')}
          </Text>
          <View style={styles.metricGrid}>
            <MetricTile label="GROSS BILLED" value={formatAUD2(stmtSummary.total_gross || 0)} />
            <MetricTile label="YOUR CONTRIBUTION" value={formatAUD2(stmtSummary.total_participant_contribution || 0)} />
            <MetricTile label="GOVERNMENT PAID" value={formatAUD2(stmtSummary.total_government_paid || 0)} />
            <MetricTile
              label="BUDGET REMAINING"
              value={formatAUD2(stmtSummary.adjusted_budget_remaining ?? stmtSummary.budget_remaining ?? 0)}
            />
          </View>
        </View>
      )}

      {/* ─────────────────── Section C · Anomaly panel ───────────────────── */}
      {anomalies.length > 0 && (
        <View style={styles.section} testID="decoder-anomaly-panel">
          <Text style={styles.sectionHead}>Things To Check</Text>
          <View style={styles.severityRow}>
            {highCount > 0 && <SeverityCountChip label="HIGH" count={highCount} color="#B33327" bg="rgba(192,57,43,0.10)" />}
            {medCount > 0 && <SeverityCountChip label="MEDIUM" count={medCount} color="#A26B15" bg="rgba(183,121,31,0.10)" />}
            {lowCount > 0 && <SeverityCountChip label="LOW" count={lowCount} color="#587657" bg="rgba(122,155,126,0.15)" />}
          </View>
          {anomalies.map((a, i) => (
            <AnomalyCard key={a.id || i} a={a} index={i} palette={c} />
          ))}
        </View>
      )}

      {/* ─────────────────── Section D · Stream breakdown ────────────────── */}
      {streamBreakdown.length > 0 && (
        <View style={styles.section} testID="decoder-stream-breakdown">
          <Text style={styles.sectionHead}>Stream breakdown</Text>
          <View style={styles.tableHeadRow}>
            <Text style={[styles.thText, { flex: 2 }]}>Stream</Text>
            <Text style={[styles.thText, styles.numCol]}>Items</Text>
            <Text style={[styles.thText, styles.numCol]}>Gross</Text>
            <Text style={[styles.thText, styles.numCol]}>You paid</Text>
            <Text style={[styles.thText, styles.numCol]}>Govt paid</Text>
          </View>
          {streamBreakdown.map((s, i) => {
            const expanded = !!expandedStreams[s.stream];
            const rows = (lineItems || []).filter((li) => (li.stream || '') === s.stream);
            return (
              <View key={i}>
                <TouchableOpacity
                  activeOpacity={0.7}
                  onPress={() => setExpandedStreams((prev) => ({ ...prev, [s.stream]: !prev[s.stream] }))}
                  style={[styles.tableRow, i % 2 === 1 && styles.tableRowAlt]}
                >
                  <View style={{ flex: 2, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Ionicons name={expanded ? 'chevron-down' : 'chevron-forward'} size={12} color={c.textMuted} />
                    <Text style={styles.tdStrong}>{prettifyStream(s.stream)}</Text>
                  </View>
                  <Text style={[styles.tdText, styles.numCol]}>{s.line_item_count || 0}</Text>
                  <Text style={[styles.tdText, styles.numCol]}>{formatAUD2(s.gross_total || 0)}</Text>
                  <Text style={[styles.tdText, styles.numCol]}>{formatAUD2(s.participant_contribution || 0)}</Text>
                  <Text style={[styles.tdText, styles.numCol]}>{formatAUD2(s.government_paid || 0)}</Text>
                </TouchableOpacity>
                {expanded && rows.length > 0 && (
                  <View style={styles.streamDetail}>
                    {rows.map((li, ri) => (
                      <Text key={ri} style={styles.streamDetailLine}>
                        · {formatDate(li.date)} — {li.service_name || li.service || 'Service'}
                      </Text>
                    ))}
                  </View>
                )}
              </View>
            );
          })}
        </View>
      )}

      {/* ─────────────────── Section E · Full line-item table ────────────── */}
      {lineItems.length > 0 && (
        <View style={styles.section}>
          <TouchableOpacity
            onPress={() => setShowLineItems((v) => !v)}
            style={styles.toggleBtn}
            activeOpacity={0.7}
            testID="decoder-line-items-toggle"
          >
            <Ionicons name={showLineItems ? 'chevron-up' : 'chevron-down'} size={14} color={c.brandPrimary} />
            <Text style={styles.toggleBtnText}>
              {showLineItems ? 'Hide full line-item table' : 'Show full line-item table'}
            </Text>
            <Text style={styles.toggleBtnMuted}>({lineItems.length})</Text>
          </TouchableOpacity>
          {showLineItems && (
            <View testID="decoder-line-items-table" style={styles.liTableWrap}>
              <View style={styles.liHeadRow}>
                <Text style={[styles.thText, { flex: 1.2 }]}>Date</Text>
                <Text style={[styles.thText, { flex: 2.2 }]}>Service</Text>
                <Text style={[styles.thText, { flex: 1.4 }]}>Stream</Text>
                <Text style={[styles.thText, styles.numCol]}>Units</Text>
                <Text style={[styles.thText, styles.numCol]}>Rate</Text>
                <Text style={[styles.thText, styles.numCol]}>Gross</Text>
              </View>
              {lineItems.map((li, i) => {
                const gross = Number(li.total ?? li.gross ?? 0);
                const rate = Number(li.unit_price ?? 0);
                return (
                  <View
                    key={li.id || i}
                    testID={`decoder-line-item-${li.id || i}`}
                    style={[styles.liRow, i % 2 === 1 && styles.tableRowAlt]}
                  >
                    <Text style={[styles.tdText, { flex: 1.2 }]}>{formatDate(li.date)}</Text>
                    <Text style={[styles.tdText, { flex: 2.2 }]} numberOfLines={2}>
                      {li.service_name || li.service || '—'}
                    </Text>
                    <Text style={[styles.tdText, { flex: 1.4 }]} numberOfLines={1}>
                      {prettifyStream(li.stream || '')}
                    </Text>
                    <Text style={[styles.tdText, styles.numCol]}>{Number(li.units || 0)}</Text>
                    <Text style={[styles.tdText, styles.numCol]}>{formatAUD2(rate)}</Text>
                    <Text style={[styles.tdText, styles.numCol]}>{formatAUD2(gross)}</Text>
                  </View>
                );
              })}
            </View>
          )}
        </View>
      )}

      {/* ─────────────────── Section F · Actions ────────────────────────── */}
      {showActions && (onDownloadPdf || onDownloadCsv || onOpenInStatements || onDecodeAnother) && (
        <View style={styles.actionRow}>
          {onOpenInStatements && (
            <TouchableOpacity
              onPress={onOpenInStatements}
              activeOpacity={0.85}
              style={styles.primaryBtn}
              testID="decoder-open-in-statements-btn"
            >
              <Ionicons name="folder-open" size={16} color="#FFFFFF" />
              <Text style={styles.primaryBtnText}>Open in Statements</Text>
            </TouchableOpacity>
          )}
          {onDownloadPdf && (
            <TouchableOpacity
              onPress={onDownloadPdf}
              activeOpacity={0.85}
              style={styles.secondaryBtn}
              testID="decoder-download-pdf-btn"
            >
              <Ionicons name="document-text" size={16} color={c.brandPrimary} />
              <Text style={styles.secondaryBtnText}>Download PDF</Text>
            </TouchableOpacity>
          )}
          {onDownloadCsv && (
            <TouchableOpacity
              onPress={onDownloadCsv}
              activeOpacity={0.85}
              style={styles.secondaryBtn}
              testID="decoder-download-csv-btn"
            >
              <Ionicons name="grid" size={16} color={c.brandPrimary} />
              <Text style={styles.secondaryBtnText}>Download CSV</Text>
            </TouchableOpacity>
          )}
          {onDecodeAnother && (
            <TouchableOpacity
              onPress={onDecodeAnother}
              activeOpacity={0.85}
              style={styles.secondaryBtn}
              testID="decoder-decode-another-btn"
            >
              <Ionicons name="refresh" size={16} color={c.brandPrimary} />
              <Text style={styles.secondaryBtnText}>Decode another</Text>
            </TouchableOpacity>
          )}
        </View>
      )}
    </View>
  );
}

/* --------------------------- sub-components ------------------------------- */

function MetricTile({ label, value }: { label: string; value: string }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.metricTile}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={styles.metricValue}>{value}</Text>
    </View>
  );
}

function SeverityCountChip({ label, count, color, bg }:
  { label: string; count: number; color: string; bg: string }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={[styles.sevChip, { backgroundColor: bg, borderColor: color }]}>
      <Text style={[styles.sevChipText, { color }]}>{count} {label}</Text>
    </View>
  );
}

function AnomalyCard({ a, index, palette }: { a: DecoderAnomaly; index: number; palette: ColorPalette }) {
  const styles = useThemedStyles(makeStyles);
  const sev = canonicalSeverity(a);
  const cfg =
    sev === 'HIGH' ? { color: '#B33327', bg: 'rgba(192,57,43,0.06)' } :
    sev === 'MEDIUM' ? { color: '#A26B15', bg: 'rgba(183,121,31,0.06)' } :
    { color: '#587657', bg: 'rgba(122,155,126,0.10)' };
  const evidence = Array.isArray(a.evidence) ? a.evidence : [];
  const dollar = Number(a.dollar_impact || 0);

  return (
    <View
      testID={`decoder-anomaly-${index}`}
      style={[styles.anomalyCard, { borderLeftColor: cfg.color, backgroundColor: cfg.bg }]}
    >
      <View style={styles.anomalyHead}>
        <View style={[styles.sevPill, { backgroundColor: cfg.color }]}>
          <Text style={styles.sevPillText}>{sev}</Text>
        </View>
        <Text style={styles.anomalyHeadline}>{a.headline || a.title || 'Flagged item'}</Text>
        {dollar > 0 && (
          <View style={[styles.riskChip, { borderColor: cfg.color }]}>
            <Text style={[styles.riskChipText, { color: cfg.color }]}>{formatAUD2(dollar)} at risk</Text>
          </View>
        )}
      </View>
      {a.detail ? <Text style={styles.anomalyDetail}>{a.detail}</Text> : null}
      {evidence.length > 0 && (
        <View style={styles.evidenceBox}>
          {evidence.map((e, i) => {
            const displayed = e.replace(/(Line item date )(\d{4})-(\d{2})-(\d{2})/g, (_m, p, y, mo, d) => `${p}${d}/${mo}/${y}`);
            return (
              <Text key={i} style={styles.evidenceLine}>• {displayed}</Text>
            );
          })}
        </View>
      )}
      {a.suggested_action ? (
        <View style={styles.actionBox}>
          <Text style={styles.actionLabel}>Suggested action</Text>
          <Text style={styles.actionText}>{a.suggested_action}</Text>
        </View>
      ) : null}
      {a.rule ? <Text style={styles.ruleTag}>{a.rule}</Text> : null}
    </View>
  );
}

/* ------------------------------- styles ----------------------------------- */

function makeStyles(c: ColorPalette) { return StyleSheet.create({
  wrap: { gap: Spacing.md },

  // Saved strip
  savedStrip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: c.severityInfo, borderRadius: Radius.md, paddingHorizontal: 12, paddingVertical: 8,
  },
  savedStripText: { fontFamily: Fonts.bodySemi, fontSize: 12, color: '#FFFFFF', letterSpacing: 0.2 },

  // Section A — Plain English
  plainCard: {
    backgroundColor: '#F4F1EA',
    borderRadius: Radius.lg, padding: Spacing.md + 4,
    borderWidth: 1, borderColor: 'rgba(14,77,82,0.10)',
  },
  plainHead: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  plainIconWrap: {
    width: 26, height: 26, borderRadius: 13,
    backgroundColor: '#0E4D52', alignItems: 'center', justifyContent: 'center',
  },
  plainOverline: {
    fontFamily: Fonts.bodySemi, fontSize: 11, letterSpacing: 1.5, color: '#0E4D52',
    textTransform: 'uppercase',
  },
  plainPara: { fontFamily: Fonts.body, fontSize: 14.5, lineHeight: 22, color: '#0E4D52' },
  plainDisclaimer: {
    fontFamily: Fonts.body, fontSize: 11, color: 'rgba(14,77,82,0.65)',
    marginTop: 14, fontStyle: 'italic', lineHeight: 16,
  },

  // Parsing warnings
  warnStrip: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    backgroundColor: 'rgba(183,121,31,0.08)', borderRadius: Radius.md, padding: 10,
    borderWidth: 1, borderColor: 'rgba(183,121,31,0.25)',
  },
  warnText: { fontFamily: Fonts.body, fontSize: 12, color: c.textPrimary, lineHeight: 17 },

  // Section B — Teal banner (always dark teal + white text — spec §3.B)
  banner: {
    backgroundColor: '#0E4D52',
    borderRadius: Radius.lg, padding: Spacing.md + 4,
    position: 'relative',
  },
  bannerHead: {
    fontFamily: Fonts.bodySemi, fontSize: 11.5, letterSpacing: 1.2,
    color: '#FFFFFF', textTransform: 'uppercase', marginBottom: 14, paddingRight: 110,
    lineHeight: 18,
  },
  methodChip: {
    position: 'absolute', top: 12, right: 12,
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: 9999,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.5)',
  },
  methodChipText: { fontFamily: Fonts.bodySemi, fontSize: 10, color: '#FFFFFF', letterSpacing: 0.4 },
  metricGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  metricTile: {
    flexBasis: '48%', flexGrow: 1,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: Radius.md, padding: 10, gap: 4,
  },
  metricLabel: {
    fontFamily: Fonts.bodySemi, fontSize: 9.5, color: '#FFFFFF',
    letterSpacing: 1.1, textTransform: 'uppercase', opacity: 0.85,
  },
  metricValue: {
    fontFamily: Fonts.monoSemi, fontVariant: ['tabular-nums' as const],
    fontSize: 18, color: '#FFFFFF', letterSpacing: -0.3,
  },

  // Sections shared
  section: { gap: 10 },
  sectionHead: {
    fontFamily: Fonts.heading, fontSize: 20, color: c.brandPrimary, letterSpacing: -0.3,
  },
  severityRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  sevChip: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 9999, borderWidth: 1 },
  sevChipText: { fontFamily: Fonts.bodySemi, fontSize: 11, letterSpacing: 0.6 },

  // Anomaly card
  anomalyCard: {
    borderRadius: Radius.md, padding: Spacing.md,
    borderLeftWidth: 4, gap: 8,
  },
  anomalyHead: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  sevPill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 4 },
  sevPillText: { fontFamily: Fonts.bodySemi, fontSize: 9.5, letterSpacing: 0.8, color: '#FFFFFF' },
  anomalyHeadline: { flex: 1, fontFamily: Fonts.bodySemi, fontSize: 14, color: c.textPrimary, lineHeight: 19 },
  riskChip: { borderWidth: 1, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 9999 },
  riskChipText: { fontFamily: Fonts.bodySemi, fontSize: 10.5, letterSpacing: 0.2 },
  anomalyDetail: { fontFamily: Fonts.body, fontSize: 13, color: c.textPrimary, lineHeight: 19 },
  evidenceBox: {
    backgroundColor: 'rgba(0,0,0,0.03)', borderRadius: 6, padding: 8, gap: 3,
  },
  evidenceLine: { fontFamily: Fonts.body, fontSize: 12, color: c.textSecondary, lineHeight: 17 },
  actionBox: {
    backgroundColor: c.surfaceTint, borderRadius: 6, padding: 10, gap: 3,
    borderWidth: 1, borderColor: c.borderSubtle,
  },
  actionLabel: { fontFamily: Fonts.bodySemi, fontSize: 10.5, letterSpacing: 0.8, textTransform: 'uppercase', color: c.brandPrimary },
  actionText: { fontFamily: Fonts.body, fontSize: 12.5, color: c.textPrimary, lineHeight: 18 },
  ruleTag: { fontFamily: Fonts.mono, fontSize: 10, color: c.textMuted, letterSpacing: 0.3 },

  // Stream / line-item tables
  tableHeadRow: {
    flexDirection: 'row', gap: 6, paddingHorizontal: 6, paddingVertical: 8,
    borderBottomWidth: 1, borderBottomColor: c.borderSubtle,
  },
  thText: {
    fontFamily: Fonts.bodySemi, fontSize: 10, letterSpacing: 0.6, textTransform: 'uppercase',
    color: c.textMuted,
  },
  tableRow: { flexDirection: 'row', gap: 6, paddingHorizontal: 6, paddingVertical: 8, alignItems: 'center' },
  tableRowAlt: { backgroundColor: c.surfaceTint },
  tdText: { fontFamily: Fonts.body, fontSize: 12.5, color: c.textPrimary },
  tdStrong: { fontFamily: Fonts.bodySemi, fontSize: 12.5, color: c.brandPrimary },
  numCol: {
    flex: 1, textAlign: 'right',
    fontVariant: ['tabular-nums' as const],
  },
  streamDetail: { paddingHorizontal: 24, paddingBottom: 8, paddingTop: 2, gap: 2 },
  streamDetailLine: { fontFamily: Fonts.body, fontSize: 12, color: c.textSecondary, lineHeight: 17 },

  // Line items
  liTableWrap: { borderWidth: 1, borderColor: c.borderSubtle, borderRadius: Radius.md, overflow: 'hidden' },
  liHeadRow: {
    flexDirection: 'row', gap: 6, paddingHorizontal: 8, paddingVertical: 8,
    borderBottomWidth: 1, borderBottomColor: c.borderSubtle,
    backgroundColor: c.surfaceTint,
  },
  liRow: { flexDirection: 'row', gap: 6, paddingHorizontal: 8, paddingVertical: 8, alignItems: 'center' },

  toggleBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start',
    paddingVertical: 6, paddingHorizontal: 10, borderRadius: 9999,
    borderWidth: 1, borderColor: c.borderSubtle, backgroundColor: c.cardBg,
  },
  toggleBtnText: { fontFamily: Fonts.bodySemi, fontSize: 12.5, color: c.brandPrimary },
  toggleBtnMuted: { fontFamily: Fonts.body, fontSize: 11.5, color: c.textMuted },

  // Actions
  actionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  primaryBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: c.brandPrimary, paddingHorizontal: 14, paddingVertical: 12,
    borderRadius: 9999,
  },
  primaryBtnText: { fontFamily: Fonts.bodySemi, fontSize: 14, color: '#FFFFFF', letterSpacing: 0.2 },
  secondaryBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    borderWidth: 1, borderColor: c.brandPrimary,
    paddingHorizontal: 14, paddingVertical: 12,
    borderRadius: 9999, backgroundColor: c.cardBg,
  },
  secondaryBtnText: { fontFamily: Fonts.bodySemi, fontSize: 14, color: c.brandPrimary, letterSpacing: 0.2 },
}); }

export default DecoderResultView;
