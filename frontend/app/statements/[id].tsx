import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { api } from '../../src/lib/api';
import { Colors, Fonts, formatAUD2, Radius, Spacing } from '../../src/lib/theme';
import BackHeader from '../../src/components/BackHeader';
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
  const [stmt, setStmt] = useState<Stmt | null>(null);
  const [loading, setLoading] = useState(true);

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
  subline: { fontFamily: Fonts.body, fontSize: 13, color: Colors.textSecondary, marginTop: 6, marginBottom: Spacing.lg },
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
