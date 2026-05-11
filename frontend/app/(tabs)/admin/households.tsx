// Admin households list
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, TextInput, TouchableOpacity, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { api, extractErrorMessage } from '../../../src/lib/api';
import { Colors, Fonts, Radius, Spacing } from '../../../src/lib/theme';
import { toast } from '../../../src/components/Toast';

type Household = {
  id: string;
  participant_name?: string;
  classification?: number | string;
  provider_name?: string;
  member_count?: number;
  statement_count?: number;
};
type Page = { items: Household[]; total: number; page: number; page_size: number };

export default function AdminHouseholds() {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const [items, setItems] = useState<Household[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
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
      const { data } = await api.get<Page>('/admin/households', { params });
      setItems((prev) => reset ? (data.items || []) : [...prev, ...(data.items || [])]);
      setTotal(data.total || 0);
      setPage(data.page || nextPage);
    } catch (e) {
      toast.error(extractErrorMessage(e));
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedQ, page]);

  useEffect(() => { setPage(1); load(true); /* eslint-disable-next-line */ }, [debouncedQ]);

  const hasMore = useMemo(() => items.length < total, [items.length, total]);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.back}>
          <Ionicons name="chevron-back" size={20} color={Colors.brandPrimary} /><Text style={styles.backText}>Admin</Text>
        </TouchableOpacity>
        <Text style={styles.h1}>Households <Text style={styles.h1Count}>({total})</Text></Text>
        <View style={styles.searchWrap}>
          <Ionicons name="search-outline" size={16} color={Colors.textMuted} />
          <TextInput value={q} onChangeText={setQ} placeholder="Search by participant or provider" placeholderTextColor={Colors.textMuted} style={styles.searchInput} autoCapitalize="none" testID="households-search" />
        </View>
      </View>

      {loading ? (
        <View style={styles.fill}><ActivityIndicator color={Colors.brandPrimary} /></View>
      ) : (
        <ScrollView contentContainerStyle={styles.list} testID="admin-households-list">
          {items.length === 0 ? (
            <Text style={styles.empty}>No households yet.</Text>
          ) : items.map((h) => (
            <View key={h.id} style={styles.row} testID={`household-row-${h.id}`}>
              <View style={[styles.icon, { backgroundColor: 'rgba(31, 58, 95, 0.08)' }]}>
                <Ionicons name="home-outline" size={18} color={Colors.brandPrimary} />
              </View>
              <View style={{ flex: 1, gap: 4 }}>
                <Text style={styles.name}>{h.participant_name || 'Unnamed'}</Text>
                <Text style={styles.meta}>
                  {h.classification ? `L${h.classification}` : '—'} · {h.provider_name || 'no provider'}
                </Text>
                <View style={styles.metaRow}>
                  <Text style={styles.metaPill}>{h.member_count ?? 0} {(h.member_count === 1) ? 'member' : 'members'}</Text>
                  <Text style={styles.metaPill}>{h.statement_count ?? 0} statements</Text>
                </View>
              </View>
            </View>
          ))}
          {hasMore ? (
            <TouchableOpacity onPress={() => load(false)} disabled={loadingMore} style={styles.moreBtn} testID="households-load-more">
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
  list: { padding: Spacing.lg, paddingBottom: Spacing.xl, gap: Spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, padding: Spacing.md, backgroundColor: Colors.cardBg, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.borderSubtle },
  icon: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  name: { fontFamily: Fonts.bodySemi, fontSize: 14, color: Colors.brandPrimary },
  meta: { fontFamily: Fonts.body, fontSize: 12, color: Colors.textSecondary },
  metaRow: { flexDirection: 'row', gap: 6, marginTop: 2 },
  metaPill: { fontFamily: Fonts.bodyMed, fontSize: 10, color: Colors.brandPrimary, backgroundColor: 'rgba(31, 58, 95, 0.05)', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 100 },
  moreBtn: { alignItems: 'center', paddingVertical: Spacing.md, marginTop: Spacing.sm, backgroundColor: Colors.cardBg, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.borderSubtle },
  moreText: { fontFamily: Fonts.bodySemi, fontSize: 13, color: Colors.brandPrimary },
  empty: { fontFamily: Fonts.body, fontSize: 14, color: Colors.textMuted, textAlign: 'center', padding: Spacing.xl },
});
