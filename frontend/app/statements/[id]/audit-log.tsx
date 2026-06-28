// Per-statement audit-log timeline (vertical).
// Web parity: /app/frontend/src/pages/statements/StatementAuditLog.jsx
import React, { useCallback, useEffect, useState } from 'react';
import { formatDateTime } from '../../../src/lib/formatDate';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams } from 'expo-router';
import { api, extractErrorMessage } from '../../../src/lib/api';
import BackHeader from '../../../src/components/BackHeader';
import { toast } from '../../../src/components/Toast';
import { Fonts, Radius, Spacing } from '../../../src/lib/theme';
import type { ColorPalette } from '../../../src/lib/theme';
import { useColors } from '../../../src/hooks/useColors';
import { useThemedStyles } from '../../../src/hooks/useThemedStyles';

type AuditEvent = {
  id: string;
  statement_id: string;
  version_id?: string;
  event_type: string;
  event_at: string;
  actor_user_id?: string | null;
  actor_kind?: 'user' | 'system' | 'retention_job' | string;
  prior_state?: string | null;
  new_state?: string | null;
  metadata?: Record<string, any> | null;
};

const EVENT_META: Record<string, { icon: keyof typeof Ionicons.glyphMap; label: string; tint: string }> = {
  uploaded:               { icon: 'cloud-upload-outline',   label: 'Uploaded',                     tint: '#0E4D52' },
  accepted_as_active:     { icon: 'checkmark-circle',       label: 'Accepted as active',           tint: '#3F8E5C' },
  superseded:             { icon: 'archive-outline',        label: 'Superseded by new version',    tint: '#C8932B' },
  archived:               { icon: 'archive-outline',        label: 'Archived',                     tint: '#C8932B' },
  deleted_soft:           { icon: 'archive-outline',        label: 'Soft-deleted (archived)',      tint: '#C8932B' },
  restored:               { icon: 'refresh-outline',        label: 'Restored to active',           tint: '#0E4D52' },
  deleted_hard:           { icon: 'trash-outline',          label: 'Permanently deleted',          tint: '#A54030' },
  duplicate_rejected:     { icon: 'alert-circle-outline',   label: 'Duplicate upload rejected',    tint: '#A54030' },
  manual_review_passed:   { icon: 'checkmark-circle-outline', label: 'Manual review passed',       tint: '#3F8E5C' },
  manual_review_failed:   { icon: 'close-circle-outline',   label: 'Manual review failed',         tint: '#A54030' },
};

function actorLabel(kind?: string) {
  if (kind === 'user') return 'By you';
  if (kind === 'retention_job') return 'By the retention sweep';
  if (kind === 'system') return 'By the system';
  return 'By the system';
}

export default function StatementAuditLog() {
  const c = useColors();
  const styles = useThemedStyles(makeStyles);
  const { id } = useLocalSearchParams<{ id: string }>();
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const { data } = await api.get(`/statements/${id}/audit-log`);
      setEvents(data?.events || []);
    } catch (e: any) {
      const status = e?.response?.status;
      if (status !== 404 && status !== 403) {
        toast.error(extractErrorMessage(e, "Couldn't load audit log."));
      }
      setEvents([]);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <BackHeader title="Audit log" />
      <ScrollView
        contentContainerStyle={styles.scroll}
        testID="statement-audit-log-page"
      >
        <Text style={styles.intro}>
          Every state change on this statement, in order. We keep this for at least seven years so you can show provable history if you ever need to.
        </Text>
        {loading ? (
          <View style={styles.fill}><ActivityIndicator color={c.brandPrimary} /></View>
        ) : events.length === 0 ? (
          <View style={styles.empty} testID="audit-log-empty">
            <Ionicons name="time-outline" size={28} color={c.textMuted} />
            <Text style={styles.emptyTitle}>No events yet</Text>
            <Text style={styles.emptyBody}>State changes for this statement will appear here as they happen.</Text>
          </View>
        ) : (
          <View testID="audit-log-timeline">
            {events.map((e, i) => {
              const meta = EVENT_META[e.event_type] || { icon: 'ellipse-outline', label: e.event_type, tint: c.textSecondary };
              const isLast = i === events.length - 1;
              const reason = e.metadata?.reason as string | undefined;
              const filename = e.metadata?.filename as string | undefined;
              return (
                <View key={e.id} style={styles.rowWrap} testID={`audit-event-${e.event_type}`}>
                  <View style={styles.lineCol}>
                    <View style={[styles.dot, { backgroundColor: meta.tint + '1F', borderColor: meta.tint }]}>
                      <Ionicons name={meta.icon} size={14} color={meta.tint} />
                    </View>
                    {!isLast && <View style={[styles.line, { backgroundColor: c.borderSubtle }]} />}
                  </View>
                  <View style={styles.body}>
                    <Text style={styles.label}>{meta.label}</Text>
                    <Text style={styles.when}>
                      {formatDateTime(e.event_at)}  ·  {actorLabel(e.actor_kind)}
                    </Text>
                    {!!(e.prior_state || e.new_state) && (
                      <Text style={styles.transition}>
                        {e.prior_state ? e.prior_state : '—'} → {e.new_state ? e.new_state : '—'}
                      </Text>
                    )}
                    {!!reason && <Text style={styles.meta}>“{reason}”</Text>}
                    {!!filename && <Text style={styles.meta}>{filename}</Text>}
                  </View>
                </View>
              );
            })}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function makeStyles(c: ColorPalette) { return StyleSheet.create({
  safe: { flex: 1, backgroundColor: c.background },
  scroll: { padding: Spacing.md, paddingBottom: 60 },
  intro: { fontFamily: Fonts.body, fontSize: 13, color: c.textSecondary, lineHeight: 19, marginBottom: Spacing.md },
  fill: { paddingVertical: Spacing.xl, alignItems: 'center' },
  empty: { padding: Spacing.lg, alignItems: 'center', gap: 6 },
  emptyTitle: { fontFamily: Fonts.bodySemi, fontSize: 15, color: c.textPrimary, marginTop: 4 },
  emptyBody: { fontFamily: Fonts.body, fontSize: 12, color: c.textSecondary, textAlign: 'center', lineHeight: 18 },

  rowWrap: { flexDirection: 'row', gap: 12 },
  lineCol: { alignItems: 'center', width: 28 },
  dot: { width: 28, height: 28, borderRadius: 14, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  line: { flex: 1, width: 2, marginVertical: 4 },
  body: { flex: 1, paddingBottom: Spacing.md, gap: 2 },
  label: { fontFamily: Fonts.bodySemi, fontSize: 14, color: c.textPrimary },
  when: { fontFamily: Fonts.body, fontSize: 12, color: c.textSecondary },
  transition: { fontFamily: Fonts.body, fontSize: 12, color: c.textMuted, marginTop: 2 },
  meta: { fontFamily: Fonts.body, fontSize: 12, color: c.textSecondary, marginTop: 2 },
}); }
