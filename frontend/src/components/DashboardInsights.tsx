// DashboardInsights — mobile parity with web DashboardInsights component.
// Renders:
//   1) MonthlySpendChart — vertical bars of last 6 statements (gross + co-payment in a sheet)
//   2) AnomaliesOverTimeStrip — stacked severity columns for last 8 statements
//   3) LifetimeCapCard — single big card with forest progress bar
//   4) ThingsToKnow — top 6 anomalies across all statements, sorted by severity
import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Modal, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Fonts, formatAUD, formatAUD2, formatShort, Radius, shortPeriod, Spacing } from '../lib/theme';
import type { ColorPalette } from '../lib/theme';
import { useColors } from '../hooks/useColors';
import { useThemedStyles } from '../hooks/useThemedStyles';

type LineItem = { description?: string; total?: number; copayment?: number };
type Anomaly = {
  severity?: string;
  headline?: string;
  title?: string;
  detail?: string;
  description?: string;
  rule?: string;
  suggested_action?: string;
};
type Statement = {
  id: string;
  uploaded_at?: string;
  period_label?: string | null;
  filename?: string | null;
  line_items?: LineItem[];
  anomalies?: Anomaly[];
};

const SEVERITY_BUCKETS = {
  alert: new Set(['alert', 'high', 'HIGH']),
  warn: new Set(['warning', 'medium', 'MEDIUM']),
  info: new Set(['info', 'low', 'LOW']),
};

function severityBucket(s: string | undefined): 'alert' | 'warn' | 'info' {
  if (!s) return 'info';
  const k = s.toLowerCase();
  if (SEVERITY_BUCKETS.alert.has(k) || SEVERITY_BUCKETS.alert.has(s as any)) return 'alert';
  if (SEVERITY_BUCKETS.warn.has(k) || SEVERITY_BUCKETS.warn.has(s as any)) return 'warn';
  return 'info';
}

function severityRank(s: string | undefined): number {
  const b = severityBucket(s);
  return b === 'alert' ? 0 : b === 'warn' ? 1 : 2;
}

// ───────────────────────────── Monthly spend chart ─────────────────────────────
type ChartBar = { id: string; label: string; gross: number; copay: number; statementId: string };

function MonthlySpendChart({ statements }: { statements: Statement[] }) {
  const [sheet, setSheet] = useState<ChartBar | null>(null);
  const bars: ChartBar[] = useMemo(() => {
    const sorted = [...statements].sort((a, b) => (a.uploaded_at || '').localeCompare(b.uploaded_at || ''));
    return sorted.slice(-6).map((s, i) => {
      const gross = (s.line_items || []).reduce((acc, li) => acc + Number(li.total || 0), 0);
      const copay = (s.line_items || []).reduce((acc, li) => acc + Number(li.copayment || 0), 0);
      return {
        id: `${s.id}-${i}`,
        statementId: s.id,
        label: shortPeriod(s.period_label || s.uploaded_at || ''),
        gross,
        copay,
      };
    });
  }, [statements]);

  if (bars.length === 0) return null;
  const max = Math.max(...bars.map((b) => b.gross)) || 1;
  const latest = bars[bars.length - 1];

  return (
    <View style={styles.insightCard} testID="dashboard-monthly-spend">
      <View style={styles.cardHeader}>
        <View style={{ flex: 1 }}>
          <Text style={styles.overline}>Monthly spend</Text>
          <Text style={styles.cardTitle}>Last {bars.length} {bars.length === 1 ? 'month' : 'months'}</Text>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={styles.headerMeta}>Last month gross</Text>
          <Text style={styles.headerStat}>{formatAUD(latest.gross)}</Text>
        </View>
      </View>

      <View style={styles.chartArea}>
        {bars.map((b) => {
          const h = max > 0 ? Math.max(8, (b.gross / max) * 100) : 8;
          return (
            <TouchableOpacity
              key={b.id}
              onPress={() => setSheet(b)}
              style={styles.barCol}
              activeOpacity={0.85}
              testID={`dashboard-bar-${b.label}`}
            >
              <Text style={styles.barValue}>{formatShort(b.gross)}</Text>
              <View style={styles.barTrack}>
                <View style={[styles.bar, { height: `${h}%` }]} />
              </View>
              <Text style={styles.barLabel}>{b.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <Text style={styles.caption}>
        Tap a bar for the gross + co-payment breakdown. Computed from your line items, regardless of period label.
      </Text>

      {/* Detail sheet */}
      <Modal visible={!!sheet} transparent animationType="fade" onRequestClose={() => setSheet(null)}>
        <Pressable style={styles.sheetBackdrop} onPress={() => setSheet(null)}>
          <Pressable style={styles.sheetCard} onPress={() => {}}>
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetTitle}>{sheet?.label}</Text>
            <View style={styles.sheetRow}>
              <Text style={styles.sheetLabel}>Gross</Text>
              <Text style={styles.sheetValue}>{formatAUD2(sheet?.gross || 0)}</Text>
            </View>
            <View style={styles.sheetRow}>
              <Text style={styles.sheetLabel}>Co-payment</Text>
              <Text style={[styles.sheetValue, { color: Colors.severityWarning }]}>{formatAUD2(sheet?.copay || 0)}</Text>
            </View>
            <View style={[styles.sheetRow, styles.sheetDivider]}>
              <Text style={[styles.sheetLabel, { fontFamily: Fonts.bodySemi, color: Colors.brandPrimary }]}>Net</Text>
              <Text style={[styles.sheetValue, { color: Colors.brandPrimary }]}>{formatAUD2((sheet?.gross || 0) - (sheet?.copay || 0))}</Text>
            </View>
            <Pressable style={styles.sheetCta} onPress={() => sheet && (require('expo-router') as any).router.push(`/statements/${sheet.statementId}`)}>
              <Text style={styles.sheetCtaText}>Open statement</Text>
              <Ionicons name="chevron-forward" size={14} color={Colors.cream} />
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

// ───────────────────────────── Anomalies over time ─────────────────────────────
type AnomalyBar = { id: string; label: string; alert: number; warn: number; info: number; total: number; statementId: string };

function AnomaliesOverTimeStrip({ statements }: { statements: Statement[] }) {
  const router = useRouter();
  const bars: AnomalyBar[] = useMemo(() => {
    const sorted = [...statements].sort((a, b) => (a.uploaded_at || '').localeCompare(b.uploaded_at || ''));
    return sorted.slice(-8).map((s, i) => {
      let alert = 0, warn = 0, info = 0;
      for (const an of s.anomalies || []) {
        const bucket = severityBucket(an.severity);
        if (bucket === 'alert') alert += 1;
        else if (bucket === 'warn') warn += 1;
        else info += 1;
      }
      return {
        id: `${s.id}-${i}`,
        statementId: s.id,
        label: shortPeriod(s.period_label || s.uploaded_at || ''),
        alert, warn, info,
        total: alert + warn + info,
      };
    });
  }, [statements]);

  if (bars.length === 0) return null;
  const max = Math.max(...bars.map((b) => b.total)) || 1;
  const totals = bars.reduce((acc, b) => ({ a: acc.a + b.alert, w: acc.w + b.warn, i: acc.i + b.info }), { a: 0, w: 0, i: 0 });

  return (
    <View style={styles.insightCard} testID="dashboard-anomaly-strip">
      <View style={styles.cardHeader}>
        <View style={{ flex: 1 }}>
          <Text style={styles.overline}>Anomalies over time</Text>
          <Text style={styles.cardTitle}>Last {bars.length} statements</Text>
        </View>
        <View style={{ alignItems: 'flex-end', gap: 2 }}>
          <View style={styles.legendInline}>
            <View style={[styles.dot, { backgroundColor: Colors.severityAlert }]} />
            <Text style={styles.legendText}>{totals.a} alert{totals.a === 1 ? '' : 's'}</Text>
          </View>
          <View style={styles.legendInline}>
            <View style={[styles.dot, { backgroundColor: Colors.severityWarning }]} />
            <Text style={styles.legendText}>{totals.w} warn</Text>
          </View>
          <View style={styles.legendInline}>
            <View style={[styles.dot, { backgroundColor: Colors.severityInfo }]} />
            <Text style={styles.legendText}>{totals.i} info</Text>
          </View>
        </View>
      </View>

      <View style={styles.stripArea}>
        {bars.map((b) => {
          const h = max > 0 ? (b.total / max) * 100 : 0;
          const totalSegments = b.alert + b.warn + b.info || 1;
          return (
            <TouchableOpacity
              key={b.id}
              onPress={() => router.push(`/statements/${b.statementId}` as any)}
              style={styles.stripCol}
              activeOpacity={0.85}
              testID={`dashboard-anomaly-col-${b.label}`}
            >
              <Text style={styles.barValue}>{b.total > 0 ? b.total : ''}</Text>
              <View style={styles.stripTrack}>
                <View style={[styles.stripStack, { height: b.total > 0 ? `${Math.max(10, h)}%` : 0 }]}>
                  {b.alert > 0 ? <View style={{ flex: b.alert / totalSegments, backgroundColor: Colors.severityAlert }} /> : null}
                  {b.warn > 0 ? <View style={{ flex: b.warn / totalSegments, backgroundColor: Colors.severityWarning }} /> : null}
                  {b.info > 0 ? <View style={{ flex: b.info / totalSegments, backgroundColor: Colors.severityInfo }} /> : null}
                </View>
              </View>
              <Text style={styles.barLabel}>{b.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <View style={styles.captionRow}>
        <View style={[styles.dot, { backgroundColor: Colors.severityAlert }]} />
        <Text style={styles.caption}>Alert = action recommended</Text>
        <View style={[styles.dot, { backgroundColor: Colors.severityWarning, marginLeft: 8 }]} />
        <Text style={styles.caption}>Warning = check it</Text>
        <View style={[styles.dot, { backgroundColor: Colors.severityInfo, marginLeft: 8 }]} />
        <Text style={styles.caption}>Info = FYI only</Text>
      </View>
    </View>
  );
}

// ───────────────────────────── Lifetime cap card ─────────────────────────────
type LifetimeProps = { lifetime_cap: number; lifetime_contributions: number; lifetime_pct: number; is_grandfathered?: boolean };

function LifetimeCapCard({ lifetime_cap, lifetime_contributions, lifetime_pct, is_grandfathered }: LifetimeProps) {
  return (
    <View style={[styles.insightCard, styles.lifetimeCard]} testID="dashboard-lifetime-cap-card">
      <View style={styles.lifetimeHead}>
        <Text style={styles.overline}>Lifetime contribution cap</Text>
        <View style={styles.statusPill}>
          <Ionicons name={is_grandfathered ? 'shield-checkmark' : 'sparkles-outline'} size={11} color={Colors.brandPrimary} />
          <Text style={styles.statusPillText}>{is_grandfathered ? 'Grandfathered' : 'New entrant'}</Text>
        </View>
      </View>
      <View style={styles.lifetimeNumbers}>
        <View style={{ flex: 1 }}>
          <Text style={styles.lifetimeBig}>{formatAUD2(lifetime_contributions)}</Text>
          <Text style={styles.lifetimeSub}>of {formatAUD(lifetime_cap)} cap</Text>
        </View>
        <Text style={styles.lifetimePct}>{(lifetime_pct || 0).toFixed(2)}%</Text>
      </View>
      <View style={styles.lifetimeTrack}>
        <View style={[styles.lifetimeFill, { width: `${Math.min(100, Math.max(0, lifetime_pct || 0))}%` }]} />
      </View>
    </View>
  );
}

// ───────────────────────────── Things to know ─────────────────────────────
type TopAnomaly = Anomaly & { statementId: string };

function ThingsToKnow({ statements, max = 6 }: { statements: Statement[]; max?: number }) {
  const router = useRouter();
  const items: TopAnomaly[] = useMemo(() => {
    const flat: TopAnomaly[] = [];
    for (const s of statements) {
      for (const a of s.anomalies || []) {
        flat.push({ ...a, statementId: s.id });
      }
    }
    return flat.sort((a, b) => severityRank(a.severity) - severityRank(b.severity)).slice(0, max);
  }, [statements, max]);

  return (
    <View style={styles.insightCard} testID="dashboard-things-to-know">
      <View style={styles.cardHeader}>
        <View style={{ flex: 1 }}>
          <Text style={styles.overline}>Things to know</Text>
          <Text style={styles.cardTitle}>From your recent statements</Text>
        </View>
        {items.length > 0 ? (
          <View style={styles.countPill}>
            <Text style={styles.countPillText}>{items.length} item{items.length === 1 ? '' : 's'}</Text>
          </View>
        ) : null}
      </View>

      {items.length === 0 ? (
        <View style={styles.nothingCard}>
          <Ionicons name="sparkles" size={18} color={Colors.severityInfo} />
          <View style={{ flex: 1 }}>
            <Text style={styles.nothingTitle}>Nothing unusual at the moment.</Text>
            <Text style={styles.nothingBody}>We'll flag anything that doesn't look right once new statements arrive.</Text>
          </View>
        </View>
      ) : (
        items.map((a, i) => {
          const bucket = severityBucket(a.severity);
          const tone = bucket === 'alert'
            ? { c: Colors.severityAlert, icon: 'alert-circle' as const, bg: 'rgba(192, 57, 43, 0.06)' }
            : bucket === 'warn'
              ? { c: Colors.severityWarning, icon: 'warning' as const, bg: 'rgba(183, 121, 31, 0.06)' }
              : { c: Colors.severityInfo, icon: 'information-circle' as const, bg: 'rgba(139, 155, 130, 0.06)' };
          return (
            <TouchableOpacity
              key={`${a.statementId}-${i}`}
              onPress={() => router.push(`/statements/${a.statementId}` as any)}
              style={[styles.anomalyRow, { backgroundColor: tone.bg, borderLeftColor: tone.c }]}
              testID={`dashboard-anomaly-${i}`}
              activeOpacity={0.7}
            >
              <Ionicons name={tone.icon} size={16} color={tone.c} style={{ marginTop: 2 }} />
              <View style={{ flex: 1 }}>
                <Text style={styles.anomalyHeadline}>{a.headline || a.title || a.rule || 'Heads up'}</Text>
                {(a.detail || a.description) ? <Text style={styles.anomalyDetail} numberOfLines={3}>{a.detail || a.description}</Text> : null}
                <View style={styles.anomalyFooter}>
                  <Text style={styles.viewLink}>View statement</Text>
                  <Ionicons name="chevron-forward" size={11} color={Colors.brandPrimary} />
                </View>
              </View>
            </TouchableOpacity>
          );
        })
      )}

      <Text style={styles.disclaimer}>AI may be incorrect — verify before acting.</Text>
    </View>
  );
}

// ───────────────────────────── Public composition ─────────────────────────────
type Props = {
  statements: Statement[];
  lifetime_cap: number;
  lifetime_contributions: number;
  lifetime_pct: number;
  is_grandfathered?: boolean;
};

export default function DashboardInsights({ statements, lifetime_cap, lifetime_contributions, lifetime_pct, is_grandfathered }: Props) {
  const c = useColors();
  const styles = useThemedStyles(makeStyles);
  return (
    <View>
      <MonthlySpendChart statements={statements} />
      <AnomaliesOverTimeStrip statements={statements} />
      <LifetimeCapCard
        lifetime_cap={lifetime_cap}
        lifetime_contributions={lifetime_contributions}
        lifetime_pct={lifetime_pct}
        is_grandfathered={is_grandfathered}
      />
      <ThingsToKnow statements={statements} />
    </View>
  );
}

function makeStyles(c: ColorPalette) { return StyleSheet.create({
  insightCard: { backgroundColor: c.cardBg, borderRadius: Radius.lg, padding: Spacing.md + 4, borderWidth: 1, borderColor: c.borderSubtle, marginBottom: Spacing.md },
  cardHeader: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: Spacing.md, gap: 12 },
  overline: { fontFamily: Fonts.bodyMed, fontSize: 10, letterSpacing: 1.5, textTransform: 'uppercase', color: c.textMuted, marginBottom: 4 },
  cardTitle: { fontFamily: Fonts.headingMed, fontSize: 16, color: c.brandPrimary },
  headerMeta: { fontFamily: Fonts.body, fontSize: 10, color: c.textMuted, textTransform: 'uppercase', letterSpacing: 0.8 },
  headerStat: { fontFamily: Fonts.bodySemi, fontSize: 14, color: c.brandPrimary, marginTop: 2 },
  // Chart
  chartArea: { flexDirection: 'row', alignItems: 'flex-end', height: 140, gap: 8, paddingTop: 6 },
  barCol: { flex: 1, alignItems: 'center', height: '100%' },
  barTrack: { flex: 1, width: '100%', justifyContent: 'flex-end', maxWidth: 36, alignSelf: 'center' },
  bar: { width: '100%', backgroundColor: c.brandPrimary, borderTopLeftRadius: 4, borderTopRightRadius: 4, minHeight: 4 },
  barValue: { fontFamily: Fonts.bodyMed, fontSize: 10, color: c.textSecondary, marginBottom: 4, minHeight: 14 },
  barLabel: { fontFamily: Fonts.bodyMed, fontSize: 11, color: c.textMuted, marginTop: 6 },
  caption: { fontFamily: Fonts.body, fontSize: 11, color: c.textMuted, marginTop: Spacing.md, lineHeight: 15 },
  // Anomaly strip
  stripArea: { flexDirection: 'row', alignItems: 'flex-end', height: 130, gap: 6 },
  stripCol: { flex: 1, alignItems: 'center', height: '100%' },
  stripTrack: { flex: 1, width: '100%', justifyContent: 'flex-end', maxWidth: 26, alignSelf: 'center' },
  stripStack: { width: '100%', borderRadius: 3, overflow: 'hidden', flexDirection: 'column' },
  captionRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', marginTop: Spacing.md, gap: 4 },
  dot: { width: 7, height: 7, borderRadius: 4, marginRight: 4 },
  legendInline: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  legendText: { fontFamily: Fonts.body, fontSize: 10, color: c.textSecondary },
  // Lifetime cap
  lifetimeCard: {},
  lifetimeHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: Spacing.md },
  statusPill: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 100, backgroundColor: 'rgba(14, 77, 82, 0.06)' },
  statusPillText: { fontFamily: Fonts.bodySemi, fontSize: 10, color: c.brandPrimary, letterSpacing: 0.3 },
  lifetimeNumbers: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: Spacing.md },
  lifetimeBig: { fontFamily: Fonts.heading, fontSize: 28, color: c.brandPrimary, letterSpacing: -0.5 },
  lifetimeSub: { fontFamily: Fonts.body, fontSize: 12, color: c.textSecondary, marginTop: 2 },
  lifetimePct: { fontFamily: Fonts.headingMed, fontSize: 18, color: '#2A3B32' },
  lifetimeTrack: { height: 8, backgroundColor: 'rgba(42, 59, 50, 0.08)', borderRadius: 4, overflow: 'hidden' },
  lifetimeFill: { height: '100%', backgroundColor: '#2A3B32', borderRadius: 4 },
  // Things to know
  countPill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 100, backgroundColor: 'rgba(14, 77, 82, 0.06)' },
  countPillText: { fontFamily: Fonts.bodySemi, fontSize: 10, color: c.brandPrimary, letterSpacing: 0.3 },
  nothingCard: { flexDirection: 'row', gap: 12, padding: Spacing.md, borderRadius: Radius.md, backgroundColor: 'rgba(139, 155, 130, 0.08)' },
  nothingTitle: { fontFamily: Fonts.bodySemi, fontSize: 13, color: c.brandPrimary },
  nothingBody: { fontFamily: Fonts.body, fontSize: 12, color: c.textSecondary, marginTop: 2 },
  anomalyRow: { flexDirection: 'row', gap: 10, padding: Spacing.md, borderRadius: Radius.md, marginBottom: 8, borderLeftWidth: 3 },
  anomalyHeadline: { fontFamily: Fonts.bodySemi, fontSize: 14, color: c.brandPrimary },
  anomalyDetail: { fontFamily: Fonts.body, fontSize: 12, color: c.textSecondary, marginTop: 4, lineHeight: 17 },
  anomalyFooter: { flexDirection: 'row', alignItems: 'center', gap: 2, marginTop: 8 },
  viewLink: { fontFamily: Fonts.bodySemi, fontSize: 11, color: c.brandPrimary, textDecorationLine: 'underline' },
  disclaimer: { fontFamily: Fonts.body, fontSize: 10, color: c.textMuted, fontStyle: 'italic', marginTop: Spacing.md, textAlign: 'center' },
  // Sheet
  sheetBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  sheetCard: { backgroundColor: c.cardBg, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: Spacing.lg, paddingBottom: 36 },
  sheetHandle: { width: 36, height: 4, borderRadius: 2, backgroundColor: c.border, alignSelf: 'center', marginBottom: Spacing.md },
  sheetTitle: { fontFamily: Fonts.heading, fontSize: 22, color: c.brandPrimary, marginBottom: Spacing.md },
  sheetRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 10 },
  sheetLabel: { fontFamily: Fonts.body, fontSize: 14, color: c.textSecondary },
  sheetValue: { fontFamily: Fonts.bodySemi, fontSize: 16, color: c.brandPrimary },
  sheetDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.borderSubtle, marginTop: 8 },
  sheetCta: { marginTop: Spacing.lg, backgroundColor: c.brandPrimary, borderRadius: Radius.md, paddingVertical: 14, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 6 },
  sheetCtaText: { fontFamily: Fonts.bodySemi, fontSize: 14, color: c.cream },
}); }
