// Admin payments list — status filter + CSV export
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { api, extractErrorMessage } from '../../../src/lib/api';
import { Colors, Fonts, Radius, Spacing, formatAUD } from '../../../src/lib/theme';
import { toast } from '../../../src/components/Toast';
import { downloadAndShareCsv } from '../../../src/lib/csvExport';

type Payment = {
  id?: string;
  session_id?: string;
  user_name?: string;
  user_email?: string;
  plan?: string;
  amount?: number;
  currency?: string;
  status?: string;
  payment_status?: string;
  created_at?: string;
};
type Page = { items: Payment[]; total: number; page: number; page_size: number };

const STATUSES = ['all', 'initiated', 'paid', 'failed', 'expired'] as const;

export default function AdminPayments() {
  const router = useRouter();
  const [status, setStatus] = useState<string>('all');
  const [items, setItems] = useState<Payment[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [exporting, setExporting] = useState(false);

  const load = useCallback(async (reset: boolean) => {
    const nextPage = reset ? 1 : page + 1;
    if (reset) setLoading(true); else setLoadingMore(true);
    try {
      const params: any = { page: nextPage, page_size: 25 };
      if (status !== 'all') params.status = status;
      const { data } = await api.get<Page>('/admin/payments', { params });
      setItems((prev) => reset ? (data.items || []) : [...prev, ...(data.items || [])]);
      setTotal(data.total || 0);
      setPage(data.page || nextPage);
    } catch (e) {
      toast.error(extractErrorMessage(e));
    } finally { setLoading(false); setLoadingMore(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, page]);

  useEffect(() => { setPage(1); load(true); /* eslint-disable-next-line */ }, [status]);

  const hasMore = useMemo(() => items.length < total, [items.length, total]);

  const exportCsv = async () => {
    setExporting(true);
    try {
      await downloadAndShareCsv('/admin/export/payments.csv', `wayly-payments-${new Date().toISOString().slice(0, 10)}.csv`);
    } finally { setExporting(false); }
  };

  const copySid = async (sid: string) => {
    try {
      await Clipboard.setStringAsync(sid);
      toast.success('Session ID copied', 2000);
    } catch {}
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.back}>
          <Ionicons name="chevron-back" size={20} color={Colors.brandPrimary} /><Text style={styles.backText}>Admin</Text>
        </TouchableOpacity>
        <Text style={styles.h1}>Payments <Text style={styles.h1Count}>({total})</Text></Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
          {STATUSES.map((s) => {
            const active = status === s;
            return (
              <TouchableOpacity key={s} style={[styles.chip, active && styles.chipActive]} onPress={() => setStatus(s)} testID={`status-chip-${s}`}>
                <Text style={[styles.chipText, active && styles.chipTextActive]}>{s}</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
        <TouchableOpacity style={styles.exportBtn} onPress={exportCsv} disabled={exporting} testID="payments-export">
          {exporting ? <ActivityIndicator size="small" color={Colors.brandPrimary} /> : <Ionicons name="share-outline" size={14} color={Colors.brandPrimary} />}
          <Text style={styles.exportText}>{exporting ? 'Preparing…' : 'Share CSV'}</Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={styles.fill}><ActivityIndicator color={Colors.brandPrimary} /></View>
      ) : (
        <ScrollView contentContainerStyle={styles.list} testID="admin-payments-list">
          {items.length === 0 ? (
            <Text style={styles.empty}>No payments match.</Text>
          ) : items.map((p, i) => {
            const s = (p.status || p.payment_status || 'unknown').toLowerCase();
            const tone = s === 'paid' || s === 'complete' ? { bg: 'rgba(58, 90, 64, 0.12)', fg: '#3A5A40' }
              : s === 'failed' || s === 'expired' ? { bg: 'rgba(160, 85, 69, 0.12)', fg: Colors.danger }
              : { bg: 'rgba(212, 162, 78, 0.15)', fg: Colors.brandSecondary };
            const sid = (p.session_id || p.id || '').toString();
            return (
              <View key={(p.id || p.session_id || i).toString()} style={styles.row}>
                <View style={{ flex: 1, gap: 4 }}>
                  <Text style={styles.name} numberOfLines={1}>{p.user_name || p.user_email || 'Unknown user'}</Text>
                  {p.user_email ? <Text style={styles.meta}>{p.user_email}</Text> : null}
                  <View style={styles.metaRow}>
                    <Text style={styles.planTag}>{(p.plan || '—').toUpperCase()}</Text>
                    <Text style={styles.amount}>{formatAUD(p.amount || 0)} {p.currency ? p.currency.toUpperCase() : 'AUD'}</Text>
                  </View>
                  <View style={styles.metaRow}>
                    {p.created_at ? <Text style={styles.timestamp}>{new Date(p.created_at).toLocaleString('en-AU')}</Text> : null}
                    {sid ? (
                      <TouchableOpacity onPress={() => copySid(sid)} style={styles.sidBtn} testID={`copy-sid-${i}`}>
                        <Ionicons name="copy-outline" size={11} color={Colors.textMuted} />
                        <Text style={styles.sid}>{sid.slice(0, 12)}…</Text>
                      </TouchableOpacity>
                    ) : null}
                  </View>
                </View>
                <View style={[styles.statusPill, { backgroundColor: tone.bg }]}><Text style={[styles.statusPillText, { color: tone.fg }]}>{s}</Text></View>
              </View>
            );
          })}
          {hasMore ? (
            <TouchableOpacity onPress={() => load(false)} disabled={loadingMore} style={styles.moreBtn} testID="payments-load-more">
              {loadingMore ? <ActivityIndicator size="small" color={Colors.brandPrimary} /> : <Text style={styles.moreText}>Load more</Text>}
            </TouchableOpacity>
          ) : null}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  fill: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: { paddingHorizontal: Spacing.lg, paddingTop: Spacing.sm, paddingBottom: Spacing.sm, borderBottomWidth: 1, borderBottomColor: Colors.borderSubtle, gap: 8 },
  back: { flexDirection: 'row', alignItems: 'center' },
  backText: { fontFamily: Fonts.bodyMed, fontSize: 14, color: Colors.brandPrimary },
  h1: { fontFamily: Fonts.heading, fontSize: 26, color: Colors.brandPrimary, letterSpacing: -0.3 },
  h1Count: { color: Colors.textMuted, fontSize: 20 },
  chipRow: { gap: 8, paddingVertical: 4 },
  chip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 100, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.cardBg },
  chipActive: { backgroundColor: Colors.brandPrimary, borderColor: Colors.brandPrimary },
  chipText: { fontFamily: Fonts.bodyMed, fontSize: 12, color: Colors.brandPrimary, textTransform: 'capitalize' },
  chipTextActive: { color: Colors.cream },
  exportBtn: { alignSelf: 'flex-end', flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 8, borderRadius: Radius.sm, backgroundColor: 'rgba(31, 58, 95, 0.06)' },
  exportText: { fontFamily: Fonts.bodySemi, fontSize: 12, color: Colors.brandPrimary },
  list: { padding: Spacing.lg, paddingBottom: Spacing.xl, gap: Spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, padding: Spacing.md, backgroundColor: Colors.cardBg, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.borderSubtle },
  name: { fontFamily: Fonts.bodySemi, fontSize: 14, color: Colors.brandPrimary },
  meta: { fontFamily: Fonts.body, fontSize: 12, color: Colors.textSecondary },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 2 },
  planTag: { fontFamily: Fonts.bodySemi, fontSize: 10, color: Colors.brandPrimary, letterSpacing: 0.5, backgroundColor: 'rgba(31, 58, 95, 0.06)', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 100 },
  amount: { fontFamily: Fonts.bodySemi, fontSize: 13, color: Colors.brandPrimary },
  timestamp: { fontFamily: Fonts.body, fontSize: 11, color: Colors.textMuted },
  sidBtn: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  sid: { fontFamily: Fonts.body, fontSize: 11, color: Colors.textMuted },
  statusPill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 100 },
  statusPillText: { fontFamily: Fonts.bodySemi, fontSize: 10, letterSpacing: 0.3, textTransform: 'uppercase' },
  moreBtn: { alignItems: 'center', paddingVertical: Spacing.md, marginTop: Spacing.sm, backgroundColor: Colors.cardBg, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.borderSubtle },
  moreText: { fontFamily: Fonts.bodySemi, fontSize: 13, color: Colors.brandPrimary },
  empty: { fontFamily: Fonts.body, fontSize: 14, color: Colors.textMuted, textAlign: 'center', padding: Spacing.xl },
});
