// Admin statements list — search + CSV export, tap row to view existing statement detail
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, TextInput, TouchableOpacity, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { api, extractErrorMessage } from '../../../src/lib/api';
import { Colors, Fonts, Radius, Spacing, formatAUD } from '../../../src/lib/theme';
import { toast } from '../../../src/components/Toast';
import { downloadAndShareCsv } from '../../../src/lib/csvExport';

type Statement = {
  id: string;
  participant_name?: string;
  period_label?: string;
  period?: string;
  gross_amount?: number;
  anomalies_count?: number;
  uploaded_at?: string;
};
type Page = { items: Statement[]; total: number; page: number; page_size: number };

export default function AdminStatements() {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const [items, setItems] = useState<Statement[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [exporting, setExporting] = useState(false);
  const debounceRef = useRef<any>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setDebouncedQ(q.trim()), 300);
  }, [q]);

  const load = useCallback(async (reset: boolean) => {
    const nextPage = reset ? 1 : page + 1;
    if (reset) setLoading(true); else setLoadingMore(true);
    try {
      const params: any = { page: nextPage, page_size: 25 };
      if (debouncedQ) params.q = debouncedQ;
      const { data } = await api.get<Page>('/admin/statements', { params });
      setItems((prev) => reset ? (data.items || []) : [...prev, ...(data.items || [])]);
      setTotal(data.total || 0);
      setPage(data.page || nextPage);
    } catch (e) {
      toast.error(extractErrorMessage(e));
    } finally { setLoading(false); setLoadingMore(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedQ, page]);

  useEffect(() => { setPage(1); load(true); /* eslint-disable-next-line */ }, [debouncedQ]);

  const hasMore = useMemo(() => items.length < total, [items.length, total]);

  const exportCsv = async () => {
    setExporting(true);
    try {
      await downloadAndShareCsv('/admin/export/statements.csv', `wayly-statements-${new Date().toISOString().slice(0, 10)}.csv`);
    } finally { setExporting(false); }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.back}>
          <Ionicons name="chevron-back" size={20} color={Colors.brandPrimary} /><Text style={styles.backText}>Admin</Text>
        </TouchableOpacity>
        <Text style={styles.h1}>Statements <Text style={styles.h1Count}>({total})</Text></Text>
        <View style={styles.searchWrap}>
          <Ionicons name="search-outline" size={16} color={Colors.textMuted} />
          <TextInput value={q} onChangeText={setQ} placeholder="Search by participant or period" placeholderTextColor={Colors.textMuted} style={styles.searchInput} autoCapitalize="none" testID="statements-search" />
        </View>
        <TouchableOpacity style={styles.exportBtn} onPress={exportCsv} disabled={exporting} testID="statements-export">
          {exporting ? <ActivityIndicator size="small" color={Colors.brandPrimary} /> : <Ionicons name="share-outline" size={14} color={Colors.brandPrimary} />}
          <Text style={styles.exportText}>{exporting ? 'Preparing…' : 'Share CSV'}</Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={styles.fill}><ActivityIndicator color={Colors.brandPrimary} /></View>
      ) : (
        <ScrollView contentContainerStyle={styles.list} testID="admin-statements-list">
          {items.length === 0 ? (
            <Text style={styles.empty}>No statements found.</Text>
          ) : items.map((s) => (
            <TouchableOpacity
              key={s.id}
              style={styles.row}
              onPress={() => router.push(`/statements/${s.id}` as any)}
              testID={`statement-row-${s.id}`}
            >
              <View style={{ flex: 1, gap: 4 }}>
                <Text style={styles.name}>{s.participant_name || 'Unnamed'}</Text>
                <Text style={styles.meta}>{s.period_label || s.period || 'Statement'}</Text>
                <View style={styles.metaRow}>
                  <Text style={styles.metaPill}>{s.anomalies_count ?? 0} {s.anomalies_count === 1 ? 'anomaly' : 'anomalies'}</Text>
                  {s.uploaded_at ? <Text style={styles.timestamp}>{new Date(s.uploaded_at).toLocaleDateString('en-AU')}</Text> : null}
                </View>
              </View>
              {s.gross_amount != null ? <Text style={styles.amount}>{formatAUD(s.gross_amount)}</Text> : null}
              <Ionicons name="chevron-forward" size={16} color={Colors.textMuted} />
            </TouchableOpacity>
          ))}
          {hasMore ? (
            <TouchableOpacity onPress={() => load(false)} disabled={loadingMore} style={styles.moreBtn} testID="statements-load-more">
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
  searchWrap: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: Colors.cardBg, borderRadius: Radius.md, paddingHorizontal: Spacing.sm, borderWidth: 1, borderColor: Colors.border, minHeight: 44 },
  searchInput: { flex: 1, fontFamily: Fonts.body, fontSize: 14, color: Colors.textPrimary, paddingVertical: 10 },
  exportBtn: { alignSelf: 'flex-end', flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 8, borderRadius: Radius.sm, backgroundColor: 'rgba(31, 58, 95, 0.06)' },
  exportText: { fontFamily: Fonts.bodySemi, fontSize: 12, color: Colors.brandPrimary },
  list: { padding: Spacing.lg, paddingBottom: Spacing.xl, gap: Spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, padding: Spacing.md, backgroundColor: Colors.cardBg, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.borderSubtle },
  name: { fontFamily: Fonts.bodySemi, fontSize: 14, color: Colors.brandPrimary },
  meta: { fontFamily: Fonts.body, fontSize: 12, color: Colors.textSecondary },
  metaRow: { flexDirection: 'row', gap: 8, alignItems: 'center', marginTop: 2, flexWrap: 'wrap' },
  metaPill: { fontFamily: Fonts.bodyMed, fontSize: 10, color: Colors.brandPrimary, backgroundColor: 'rgba(31, 58, 95, 0.05)', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 100 },
  timestamp: { fontFamily: Fonts.body, fontSize: 11, color: Colors.textMuted },
  amount: { fontFamily: Fonts.bodySemi, fontSize: 13, color: Colors.brandPrimary },
  moreBtn: { alignItems: 'center', paddingVertical: Spacing.md, marginTop: Spacing.sm, backgroundColor: Colors.cardBg, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.borderSubtle },
  moreText: { fontFamily: Fonts.bodySemi, fontSize: 13, color: Colors.brandPrimary },
  empty: { fontFamily: Fonts.body, fontSize: 14, color: Colors.textMuted, textAlign: 'center', padding: Spacing.xl },
});
