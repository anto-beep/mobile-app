// Adviser — client snapshot detail screen.
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, ActivityIndicator, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { api, extractErrorMessage } from '../../../src/lib/api';
import { Colors, Fonts, formatAUD, Radius, Spacing } from '../../../src/lib/theme';
import { toast } from '../../../src/components/Toast';

type Snapshot = {
  client: { client_name: string; client_email: string; status: string; notes?: string };
  household: { participant_name?: string; classification?: number; provider_name?: string };
  metrics: { statements_total: number; anomalies_total: number };
  recent_statements: { id: string; period_label?: string; uploaded_at?: string; gross?: number; anomaly_count?: number }[];
  flagged_sample: { statement_id: string; severity?: string; headline?: string; detail?: string }[];
  members_count: number;
};

export default function ClientSnapshot() {
  const { cid } = useLocalSearchParams<{ cid?: string }>();
  const router = useRouter();
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [notLinked, setNotLinked] = useState<null | { client_name: string; client_email: string }>(null);

  const load = useCallback(async () => {
    if (!cid) return;
    setLoading(true);
    try {
      const { data } = await api.get<Snapshot>(`/adviser/clients/${cid}/snapshot`);
      setSnap(data);
      setNotLinked(null);
    } catch (e: any) {
      const detail = e?.response?.data?.detail;
      if (detail && typeof detail === 'object' && detail.error === 'client_not_linked') {
        setNotLinked({ client_name: detail?.client?.client_name || '', client_email: detail?.client?.client_email || '' });
      } else {
        toast.error(extractErrorMessage(e, "Couldn't load snapshot"));
      }
    } finally { setLoading(false); }
  }, [cid]);

  useEffect(() => { load(); }, [load]);

  if (loading) {
    return (
      <View style={[styles.safe, { justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator color={Colors.brandPrimary} />
      </View>
    );
  }

  if (notLinked) {
    return (
      <ScrollView contentContainerStyle={[styles.scroll, { flexGrow: 1, justifyContent: 'center' }]}>
        <View style={styles.pendingCard}>
          <View style={styles.pendingIcon}><Ionicons name="mail-unread" size={26} color={Colors.brandSecondary} /></View>
          <Text style={styles.h1}>Invite pending</Text>
          <Text style={styles.sub}>
            <Text style={{ fontFamily: Fonts.bodySemi }}>{notLinked.client_name}</Text> hasn’t accepted yet. Once they sign up, this page will show their household, statements and anomalies.
          </Text>
          <Text style={styles.subMuted}>{notLinked.client_email}</Text>
          <TouchableOpacity style={styles.cta} onPress={() => router.back()}>
            <Ionicons name="chevron-back" size={14} color={Colors.cream} />
            <Text style={styles.ctaText}>Back to roster</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    );
  }

  if (!snap) return null;
  const h = snap.household || {};

  return (
    <ScrollView contentContainerStyle={styles.scroll}>
      {/* Header */}
      <Text style={styles.overline}>Snapshot</Text>
      <Text style={styles.h1}>{snap.client.client_name}</Text>
      <Text style={styles.subMuted}>{snap.client.client_email}</Text>
      {snap.client.notes ? <Text style={styles.notes}>“{snap.client.notes}”</Text> : null}

      {/* Household */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Household</Text>
        <View style={styles.row}><Text style={styles.k}>Participant</Text><Text style={styles.v}>{h.participant_name || '—'}</Text></View>
        <View style={styles.row}><Text style={styles.k}>Classification</Text><Text style={styles.v}>{h.classification ? `Level ${h.classification}` : '—'}</Text></View>
        <View style={styles.row}><Text style={styles.k}>Provider</Text><Text style={styles.v}>{h.provider_name || '—'}</Text></View>
        <View style={styles.row}><Text style={styles.k}>Members</Text><Text style={styles.v}>{snap.members_count}</Text></View>
      </View>

      {/* Metrics */}
      <View style={styles.tileRow}>
        <View style={styles.tile}><Text style={styles.tileVal}>{snap.metrics.statements_total}</Text><Text style={styles.tileLabel}>Statements</Text></View>
        <View style={styles.tile}><Text style={[styles.tileVal, { color: Colors.severityAlert }]}>{snap.metrics.anomalies_total}</Text><Text style={styles.tileLabel}>Anomalies</Text></View>
      </View>

      {/* Recent statements */}
      <Text style={styles.sectionLabel}>Recent statements</Text>
      {snap.recent_statements.length === 0 ? (
        <View style={styles.emptyMini}><Text style={styles.emptyMiniText}>No statements uploaded yet.</Text></View>
      ) : snap.recent_statements.map((s) => (
        <View key={s.id} style={styles.stmtRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.stmtTitle}>{s.period_label || (s.uploaded_at ? new Date(s.uploaded_at).toLocaleDateString() : 'Statement')}</Text>
            <Text style={styles.stmtSub}>Gross {formatAUD(s.gross || 0)} · {s.anomaly_count ?? 0} anomalies</Text>
          </View>
          <Ionicons name="chevron-forward" size={14} color={Colors.textMuted} />
        </View>
      ))}

      {/* Flagged */}
      {snap.flagged_sample.length > 0 ? (
        <>
          <Text style={styles.sectionLabel}>Flagged items</Text>
          {snap.flagged_sample.map((f, i) => (
            <View key={i} style={[styles.anomalyRow, { borderLeftColor: Colors.severityWarning }]}>
              <Ionicons name="warning-outline" size={16} color={Colors.severityWarning} style={{ marginTop: 2 }} />
              <View style={{ flex: 1 }}>
                <Text style={styles.anomalyHeadline}>{f.headline || 'Heads up'}</Text>
                {f.detail ? <Text style={styles.anomalyDetail} numberOfLines={3}>{f.detail}</Text> : null}
              </View>
            </View>
          ))}
        </>
      ) : null}

      <Text style={styles.disclaimer}>Read-only view. AI may be incorrect — verify before acting.</Text>
      <View style={{ height: 30 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.lg, backgroundColor: Colors.background },
  overline: { fontFamily: Fonts.bodyMed, fontSize: 11, letterSpacing: 1.5, textTransform: 'uppercase', color: Colors.textMuted },
  h1: { fontFamily: Fonts.heading, fontSize: 26, color: Colors.brandPrimary, letterSpacing: -0.5, marginTop: 2 },
  sub: { fontFamily: Fonts.body, fontSize: 14, color: Colors.textSecondary, marginTop: 6, lineHeight: 20, textAlign: 'center' },
  subMuted: { fontFamily: Fonts.body, fontSize: 12, color: Colors.textMuted, marginTop: 2 },
  notes: { fontFamily: Fonts.body, fontSize: 12, color: Colors.textSecondary, marginTop: 6, fontStyle: 'italic' },
  card: { backgroundColor: Colors.cardBg, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.borderSubtle, padding: Spacing.md, marginTop: Spacing.lg },
  cardTitle: { fontFamily: Fonts.bodySemi, fontSize: 14, color: Colors.brandPrimary, marginBottom: 8 },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: Colors.borderSubtle },
  k: { fontFamily: Fonts.body, fontSize: 13, color: Colors.textSecondary },
  v: { fontFamily: Fonts.bodySemi, fontSize: 13, color: Colors.brandPrimary },
  tileRow: { flexDirection: 'row', gap: 8, marginTop: Spacing.md },
  tile: { flex: 1, backgroundColor: Colors.cardBg, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.borderSubtle, padding: Spacing.md },
  tileVal: { fontFamily: Fonts.heading, fontSize: 24, color: Colors.brandPrimary },
  tileLabel: { fontFamily: Fonts.bodyMed, fontSize: 10, color: Colors.textMuted, marginTop: 4, textTransform: 'uppercase', letterSpacing: 0.5 },
  sectionLabel: { fontFamily: Fonts.bodyMed, fontSize: 11, letterSpacing: 1.2, textTransform: 'uppercase', color: Colors.textMuted, marginTop: Spacing.lg, marginBottom: 6 },
  stmtRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.cardBg, borderRadius: Radius.sm, borderWidth: 1, borderColor: Colors.borderSubtle, padding: Spacing.md, marginBottom: 6 },
  stmtTitle: { fontFamily: Fonts.bodySemi, fontSize: 13, color: Colors.brandPrimary },
  stmtSub: { fontFamily: Fonts.body, fontSize: 11, color: Colors.textSecondary, marginTop: 2 },
  anomalyRow: { flexDirection: 'row', gap: 8, padding: Spacing.md, borderRadius: Radius.sm, marginBottom: 6, borderLeftWidth: 3, backgroundColor: 'rgba(212, 162, 78, 0.05)' },
  anomalyHeadline: { fontFamily: Fonts.bodySemi, fontSize: 13, color: Colors.brandPrimary },
  anomalyDetail: { fontFamily: Fonts.body, fontSize: 12, color: Colors.textSecondary, marginTop: 4, lineHeight: 17 },
  emptyMini: { padding: Spacing.md, backgroundColor: Colors.cardBg, borderRadius: Radius.sm, borderWidth: 1, borderColor: Colors.borderSubtle, alignItems: 'center' },
  emptyMiniText: { fontFamily: Fonts.body, fontSize: 12, color: Colors.textMuted },
  disclaimer: { fontFamily: Fonts.body, fontSize: 10, color: Colors.textMuted, fontStyle: 'italic', marginTop: Spacing.lg, textAlign: 'center' },
  pendingCard: { backgroundColor: Colors.cardBg, borderRadius: Radius.lg, padding: Spacing.lg + 4, borderWidth: 1, borderColor: 'rgba(212, 162, 78, 0.35)', alignItems: 'center' },
  pendingIcon: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(212, 162, 78, 0.15)', marginBottom: Spacing.md },
  cta: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 12, paddingHorizontal: Spacing.lg, borderRadius: 100, backgroundColor: Colors.brandPrimary, minHeight: 44, marginTop: Spacing.lg },
  ctaText: { fontFamily: Fonts.bodySemi, fontSize: 14, color: Colors.cream },
});
