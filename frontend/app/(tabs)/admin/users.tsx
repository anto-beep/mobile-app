// Admin users list — search + plan filter + paginated load more + CSV export
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, TextInput, TouchableOpacity, ActivityIndicator, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { api, extractErrorMessage } from '../../../src/lib/api';
import { Colors, Fonts, Radius, Spacing } from '../../../src/lib/theme';
import { toast } from '../../../src/components/Toast';
import { downloadAndShareCsv } from '../../../src/lib/csvExport';

type AdminUser = {
  id: string;
  email: string;
  name?: string;
  plan?: string;
  subscription_status?: string;
  created_at?: string;
  is_admin?: boolean;
};
type Page = { items: AdminUser[]; total: number; page: number; page_size: number };

const PLAN_FILTERS = ['all', 'free', 'solo', 'family', 'advisor'] as const;

export default function AdminUsers() {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const [plan, setPlan] = useState<string>('all');
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<AdminUser[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [exporting, setExporting] = useState(false);
  const debounceRef = useRef<any>(null);

  // Debounce search 300ms
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setDebouncedQ(q.trim()), 300);
    return () => debounceRef.current && clearTimeout(debounceRef.current);
  }, [q]);

  const load = useCallback(async (reset: boolean) => {
    const nextPage = reset ? 1 : page + 1;
    if (reset) setLoading(true); else setLoadingMore(true);
    try {
      const params: any = { page: nextPage, page_size: 25 };
      if (debouncedQ) params.q = debouncedQ;
      if (plan !== 'all') params.plan = plan;
      const { data } = await api.get<Page>('/admin/users', { params });
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
  }, [debouncedQ, plan, page]);

  // Reload on query/plan change
  useEffect(() => {
    setPage(1);
    load(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedQ, plan]);

  const hasMore = useMemo(() => items.length < total, [items.length, total]);

  const exportCsv = async () => {
    setExporting(true);
    try {
      await downloadAndShareCsv('/admin/export/users.csv', `wayly-users-${new Date().toISOString().slice(0, 10)}.csv`);
    } finally { setExporting(false); }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.back} testID="admin-users-back">
          <Ionicons name="chevron-back" size={20} color={Colors.brandPrimary} />
          <Text style={styles.backText}>Admin</Text>
        </TouchableOpacity>
        <Text style={styles.h1}>Users <Text style={styles.h1Count}>({total})</Text></Text>

        {/* Search */}
        <View style={styles.searchWrap}>
          <Ionicons name="search-outline" size={16} color={Colors.textMuted} />
          <TextInput
            value={q} onChangeText={setQ}
            placeholder="Search by email or name"
            placeholderTextColor={Colors.textMuted}
            style={styles.searchInput}
            autoCapitalize="none"
            autoCorrect={false}
            testID="admin-users-search"
          />
          {q ? (
            <TouchableOpacity onPress={() => setQ('')} hitSlop={10}>
              <Ionicons name="close-circle" size={16} color={Colors.textMuted} />
            </TouchableOpacity>
          ) : null}
        </View>

        {/* Plan chips */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
          {PLAN_FILTERS.map((p) => {
            const active = plan === p;
            return (
              <TouchableOpacity
                key={p}
                style={[styles.chip, active && styles.chipActive]}
                onPress={() => setPlan(p)}
                testID={`plan-chip-${p}`}
              >
                <Text style={[styles.chipText, active && styles.chipTextActive]}>{p}</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        <TouchableOpacity style={styles.exportBtn} onPress={exportCsv} disabled={exporting} testID="users-export">
          {exporting ? <ActivityIndicator size="small" color={Colors.brandPrimary} /> : <Ionicons name="share-outline" size={14} color={Colors.brandPrimary} />}
          <Text style={styles.exportText}>{exporting ? 'Preparing…' : 'Share CSV'}</Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={styles.fill}><ActivityIndicator color={Colors.brandPrimary} /></View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={false} onRefresh={() => load(true)} tintColor={Colors.brandPrimary} />}
          testID="admin-users-list"
        >
          {items.length === 0 ? (
            <Text style={styles.empty}>No users match those filters.</Text>
          ) : items.map((u) => (
            <TouchableOpacity
              key={u.id}
              style={styles.row}
              onPress={() => router.push(`/(tabs)/admin/users/${u.id}` as any)}
              testID={`user-row-${u.id}`}
            >
              <View style={{ flex: 1, gap: 4 }}>
                <View style={styles.rowTopLine}>
                  <Text style={styles.email} numberOfLines={1}>{u.email}</Text>
                  {u.is_admin ? <View style={styles.adminPill}><Text style={styles.adminPillText}>ADMIN</Text></View> : null}
                </View>
                {u.name ? <Text style={styles.name} numberOfLines={1}>{u.name}</Text> : null}
                <View style={styles.pillsRow}>
                  <Pill label={u.plan || 'free'} tone="navy" />
                  {u.subscription_status && u.subscription_status !== 'none' ? <Pill label={u.subscription_status} tone="sage" /> : null}
                  {u.created_at ? <Text style={styles.joined}>{`Joined ${formatRel(u.created_at)}`}</Text> : null}
                </View>
              </View>
              <Ionicons name="chevron-forward" size={16} color={Colors.textMuted} />
            </TouchableOpacity>
          ))}
          {hasMore ? (
            <TouchableOpacity onPress={() => load(false)} disabled={loadingMore} style={styles.moreBtn} testID="users-load-more">
              {loadingMore ? <ActivityIndicator size="small" color={Colors.brandPrimary} /> : <Text style={styles.moreText}>Load more ({total - items.length} remaining)</Text>}
            </TouchableOpacity>
          ) : items.length > 0 ? (
            <Text style={styles.endText}>All {total} users loaded.</Text>
          ) : null}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function Pill({ label, tone }: { label: string; tone: 'navy' | 'sage' | 'gold' }) {
  const bg = tone === 'sage' ? 'rgba(58, 90, 64, 0.12)' : tone === 'gold' ? 'rgba(212, 162, 78, 0.15)' : 'rgba(31, 58, 95, 0.08)';
  const fg = tone === 'sage' ? '#3A5A40' : tone === 'gold' ? Colors.brandSecondary : Colors.brandPrimary;
  return (
    <View style={[styles.pill, { backgroundColor: bg }]}><Text style={[styles.pillText, { color: fg }]}>{label}</Text></View>
  );
}

function formatRel(iso: string): string {
  try {
    const d = new Date(iso);
    const days = Math.floor((Date.now() - d.getTime()) / 86400000);
    if (days === 0) return 'today';
    if (days === 1) return 'yesterday';
    if (days < 7) return `${days}d ago`;
    if (days < 30) return `${Math.floor(days / 7)}w ago`;
    return d.toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric' });
  } catch { return iso; }
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
  chipRow: { gap: 8, paddingVertical: 4 },
  chip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 100, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.cardBg },
  chipActive: { backgroundColor: Colors.brandPrimary, borderColor: Colors.brandPrimary },
  chipText: { fontFamily: Fonts.bodyMed, fontSize: 12, color: Colors.brandPrimary, textTransform: 'capitalize' },
  chipTextActive: { color: Colors.cream },
  exportBtn: { alignSelf: 'flex-end', flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 8, borderRadius: Radius.sm, backgroundColor: 'rgba(31, 58, 95, 0.06)' },
  exportText: { fontFamily: Fonts.bodySemi, fontSize: 12, color: Colors.brandPrimary },
  list: { padding: Spacing.lg, paddingBottom: Spacing.xl, gap: Spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, padding: Spacing.md, backgroundColor: Colors.cardBg, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.borderSubtle },
  rowTopLine: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  email: { fontFamily: Fonts.bodySemi, fontSize: 14, color: Colors.brandPrimary, flex: 1 },
  name: { fontFamily: Fonts.body, fontSize: 12, color: Colors.textSecondary },
  pillsRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginTop: 2 },
  pill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 100 },
  pillText: { fontFamily: Fonts.bodySemi, fontSize: 10, letterSpacing: 0.3, textTransform: 'uppercase' },
  joined: { fontFamily: Fonts.body, fontSize: 11, color: Colors.textMuted },
  adminPill: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 100, backgroundColor: Colors.brandSecondary },
  adminPillText: { fontFamily: Fonts.bodySemi, fontSize: 9, color: Colors.brandPrimary, letterSpacing: 0.5 },
  moreBtn: { alignItems: 'center', paddingVertical: Spacing.md, marginTop: Spacing.sm, backgroundColor: Colors.cardBg, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.borderSubtle },
  moreText: { fontFamily: Fonts.bodySemi, fontSize: 13, color: Colors.brandPrimary },
  endText: { fontFamily: Fonts.body, fontSize: 12, color: Colors.textMuted, textAlign: 'center', paddingVertical: Spacing.md },
  empty: { fontFamily: Fonts.body, fontSize: 14, color: Colors.textMuted, textAlign: 'center', padding: Spacing.xl },
});
