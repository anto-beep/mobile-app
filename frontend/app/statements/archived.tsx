// Archived statements — soft-deleted rows with a 30-day restore window
// before the retention sweep permanently deletes them.
//
// Web parity: /app/frontend/src/pages/statements/ArchivedStatements.jsx
import React, { useCallback, useEffect, useState } from 'react';
import { formatDate } from '../../src/lib/formatDate';
import { View, Text, StyleSheet, FlatList, RefreshControl, TouchableOpacity, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { api, extractErrorMessage } from '../../src/lib/api';
import BackHeader from '../../src/components/BackHeader';
import { toast } from '../../src/components/Toast';
import { PermanentDeleteModal } from '../../src/components/StatementLifecycleModals';
import { Fonts, Radius, Spacing } from '../../src/lib/theme';
import type { ColorPalette } from '../../src/lib/theme';
import { useColors } from '../../src/hooks/useColors';
import { useThemedStyles } from '../../src/hooks/useThemedStyles';

type ArchivedStmt = {
  id: string;
  filename: string;
  period_label?: string;
  uploaded_at?: string;
  archived_at?: string;
  participant_id?: string;
  file_size_bytes?: number;
  anomaly_dollar_impact_total?: number;
  restore_until?: string;
  days_left_to_restore?: number;
  has_original_file?: boolean;
};

function idem(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export default function ArchivedStatements() {
  const c = useColors();
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const [rows, setRows] = useState<ArchivedStmt[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [delTarget, setDelTarget] = useState<ArchivedStmt | null>(null);
  const [delSubmitting, setDelSubmitting] = useState(false);

  const load = useCallback(async () => {
    try {
      const { data } = await api.get('/statements/archived');
      const items: ArchivedStmt[] = Array.isArray(data) ? data : data?.items || [];
      setRows(items);
    } catch (e: any) {
      const status = e?.response?.status;
      if (status !== 404 && status !== 403) {
        toast.error(extractErrorMessage(e, "Could not load archived statements."));
      }
      setRows([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const restore = async (row: ArchivedStmt) => {
    setBusy(row.id);
    try {
      await api.post(`/statements/${row.id}/restore`, undefined, {
        headers: { 'Idempotency-Key': idem('restore') },
      });
      setRows((prev) => prev.filter((r) => r.id !== row.id));
      toast.success('Statement restored.');
    } catch (e: any) {
      const status = e?.response?.status;
      const detail = e?.response?.data?.detail;
      if (status === 409 && detail?.error === 'ACTIVE_VERSION_EXISTS') {
        toast.warning('Another version is currently active. Archive that one first.');
      } else if (status === 410) {
        toast.error('Restore window expired. You can permanently delete this statement.');
      } else {
        toast.error(extractErrorMessage(e, "Could not restore that statement."));
      }
    } finally {
      setBusy(null);
    }
  };

  const confirmPermanentDelete = async () => {
    if (!delTarget) return;
    setDelSubmitting(true);
    try {
      await api.delete(`/statements/${delTarget.id}/permanent`, {
        headers: { 'Idempotency-Key': idem('hard-delete') },
      });
      setRows((prev) => prev.filter((r) => r.id !== delTarget.id));
      toast.success('Statement permanently deleted.');
      setDelTarget(null);
    } catch (e: any) {
      toast.error(extractErrorMessage(e, "Could not permanently delete that statement."));
    } finally {
      setDelSubmitting(false);
    }
  };

  const renderItem = ({ item }: { item: ArchivedStmt }) => {
    const daysLeft = item.days_left_to_restore ?? 0;
    const expired = daysLeft <= 0;
    const soon = !expired && daysLeft <= 3;
    return (
      <View style={styles.row} testID={`archived-row-${item.id}`}>
        <View style={styles.rowHead}>
          <Ionicons name="document-text-outline" size={18} color={c.brandPrimary} />
          <View style={{ flex: 1 }}>
            <Text style={styles.rowTitle} numberOfLines={1}>
              {item.period_label || item.filename || 'Statement'}
            </Text>
            <Text style={styles.rowMeta} numberOfLines={1}>
              {item.filename ? `${item.filename} · ` : ''}
              {item.archived_at ? `archived ${formatDate(item.archived_at)}` : ''}
            </Text>
          </View>
          {expired ? (
            <Text style={[styles.pill, styles.pillExpired]}>EXPIRED</Text>
          ) : soon ? (
            <Text style={[styles.pill, styles.pillSoon]}>{daysLeft}d left</Text>
          ) : (
            <Text style={[styles.pill, styles.pillNeutral]}>{daysLeft}d left</Text>
          )}
        </View>
        <View style={styles.rowActions}>
          <TouchableOpacity
            onPress={() => restore(item)}
            disabled={expired || busy === item.id}
            style={[styles.actionBtn, (expired || busy === item.id) && { opacity: 0.45 }]}
            testID={`archived-restore-${item.id}`}
            accessibilityRole="button"
          >
            <Ionicons name="refresh-outline" size={14} color={c.brandPrimary} />
            <Text style={[styles.actionLbl, { color: c.brandPrimary }]}>
              {busy === item.id ? 'Restoring…' : 'Restore'}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => setDelTarget(item)}
            disabled={!expired || busy === item.id}
            style={[styles.actionBtn, (!expired || busy === item.id) && { opacity: 0.45 }]}
            testID={`archived-delete-${item.id}`}
            accessibilityRole="button"
          >
            <Ionicons name="trash-outline" size={14} color={c.brandSecondary} />
            <Text style={[styles.actionLbl, { color: c.brandSecondary }]}>Permanently Delete</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => router.push({ pathname: '/statements/[id]/audit-log' as any, params: { id: item.id } })}
            style={styles.actionBtn}
            accessibilityRole="button"
          >
            <Ionicons name="time-outline" size={14} color={c.textSecondary} />
            <Text style={[styles.actionLbl, { color: c.textSecondary }]}>Audit Log</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <BackHeader title="Archived Statements" />
      {loading ? (
        <View style={styles.fill}><ActivityIndicator color={c.brandPrimary} /></View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(r) => r.id}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => { setRefreshing(true); load(); }}
              tintColor={c.brandPrimary}
            />
          }
          testID="archived-statements-page"
          ListEmptyComponent={(
            <View style={styles.empty} testID="archived-empty-state">
              <Ionicons name="archive-outline" size={28} color={c.textMuted} />
              <Text style={styles.emptyTitle}>No archived statements</Text>
              <Text style={styles.emptyBody}>
                When you archive a statement it lands here for 30 days before being permanently deleted.
              </Text>
            </View>
          )}
        />
      )}
      <PermanentDeleteModal
        visible={!!delTarget}
        onClose={() => !delSubmitting && setDelTarget(null)}
        periodLabel={delTarget?.period_label || delTarget?.filename || ''}
        hasOriginalFile={!!delTarget?.has_original_file}
        onConfirm={confirmPermanentDelete}
        submitting={delSubmitting}
      />
    </SafeAreaView>
  );
}

function makeStyles(c: ColorPalette) { return StyleSheet.create({
  safe: { flex: 1, backgroundColor: c.background },
  fill: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  list: { padding: Spacing.md, gap: 10, paddingBottom: 60 },
  row: { backgroundColor: c.cardBg, borderRadius: Radius.lg, borderWidth: 1, borderColor: c.border, padding: Spacing.md, gap: 10 },
  rowHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  rowTitle: { fontFamily: Fonts.bodySemi, fontSize: 14, color: c.textPrimary },
  rowMeta: { fontFamily: Fonts.body, fontSize: 12, color: c.textSecondary, marginTop: 2 },
  pill: { fontFamily: Fonts.bodySemi, fontSize: 10, letterSpacing: 0.6, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, overflow: 'hidden' },
  pillNeutral: { color: c.brandPrimary, backgroundColor: c.surfaceTint },
  pillSoon: { color: '#A54030', backgroundColor: 'rgba(192,57,43,0.10)' },
  pillExpired: { color: '#A54030', backgroundColor: 'rgba(192,57,43,0.20)' },
  rowActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 14 },
  actionBtn: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  actionLbl: { fontFamily: Fonts.bodySemi, fontSize: 12 },
  empty: { padding: Spacing.lg, alignItems: 'center', gap: 6 },
  emptyTitle: { fontFamily: Fonts.bodySemi, fontSize: 15, color: c.textPrimary, marginTop: 4 },
  emptyBody: { fontFamily: Fonts.body, fontSize: 12, color: c.textSecondary, textAlign: 'center', lineHeight: 18 },
}); }
