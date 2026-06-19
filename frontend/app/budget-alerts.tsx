// Budget alerts — richer feed grouped by severity, mirroring the web app.
import React, { useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, RefreshControl, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useApi } from '../src/lib/useApi';
import BackHeader from '../src/components/BackHeader';
import { formatAUDate } from '../src/lib/format';
import { formatAUD2, Fonts, Radius, Spacing } from '../src/lib/theme';
import type { ColorPalette } from '../src/lib/theme';
import { useColors } from '../src/hooks/useColors';
import { useThemedStyles } from '../src/hooks/useThemedStyles';

type Alert = {
  id: string;
  category?: string;
  stream?: string;
  amount?: number;
  note?: string;
  severity?: 'INFO' | 'WARN' | 'CRITICAL' | string;
  created_at?: string;
};

const SEV: Record<string, { tint: string; label: string; icon: keyof typeof Ionicons.glyphMap }> = {
  CRITICAL: { tint: '#A54030', label: 'Critical',  icon: 'warning' },
  WARN:     { tint: '#C8932B', label: 'Watch',     icon: 'alert-circle' },
  INFO:     { tint: '#0E4D52', label: 'Heads-up',  icon: 'information-circle' },
};

function sevMeta(s?: string) { return SEV[(s || 'INFO').toUpperCase()] || SEV.INFO; }

export default function BudgetAlerts() {
  const c = useColors();
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const { data, loading, refreshing, refresh } = useApi<{ items: Alert[] }>('/budget/alerts');
  const items = data?.items || [];

  const grouped = useMemo(() => {
    const order = ['CRITICAL', 'WARN', 'INFO'];
    const map = new Map<string, Alert[]>();
    for (const a of items) {
      const k = (a.severity || 'INFO').toUpperCase();
      (map.get(k) || map.set(k, []).get(k))!.push(a);
    }
    return order.map((k) => [k, map.get(k) || []] as const).filter(([, arr]) => arr.length > 0);
  }, [items]);

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <BackHeader title="Budget alerts" />
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={c.brandPrimary} />}
      >
        <View style={styles.heroRow}>
          <Ionicons name="alert-circle-outline" size={22} color={c.brandPrimary} />
          <Text style={styles.hero}>Budget alerts</Text>
        </View>
        <Text style={styles.subhero}>
          Lines that are running ahead of plan. Wayly re-checks every time a statement is uploaded.
        </Text>

        {loading ? null : items.length === 0 ? (
          <View style={styles.emptyCard}>
            <Ionicons name="shield-checkmark-outline" size={28} color={c.textMuted} />
            <Text style={styles.emptyTitle}>No alerts right now</Text>
            <Text style={styles.emptyBody}>If any category looks like it&apos;ll over-run this quarter, we&apos;ll surface it here.</Text>
            <TouchableOpacity style={styles.cta} onPress={() => router.push('/(tabs)/today' as any)}>
              <Text style={styles.ctaText}>View budget</Text>
            </TouchableOpacity>
          </View>
        ) : grouped.map(([sev, rows]) => {
          const m = sevMeta(sev);
          return (
            <View key={sev}>
              <View style={[styles.sectionHead, { borderLeftColor: m.tint }]}>
                <Ionicons name={m.icon} size={14} color={m.tint} />
                <Text style={[styles.sectionH, { color: m.tint }]}>{m.label.toUpperCase()} · {rows.length}</Text>
              </View>
              {rows.map((a) => (
                <View key={a.id} style={styles.row} testID={`alert-${a.id}`}>
                  <View style={[styles.bullet, { backgroundColor: `${m.tint}1A` }]}>
                    <Ionicons name="trending-up-outline" size={16} color={m.tint} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.title} numberOfLines={1}>{a.category || a.stream || 'Budget line'}</Text>
                    {!!a.note && <Text style={styles.note} numberOfLines={3}>{a.note}</Text>}
                    <Text style={styles.meta}>
                      {a.amount ? `Over by ${formatAUD2(a.amount)}` : ''}
                      {a.created_at ? ` · ${formatAUDate(a.created_at)}` : ''}
                    </Text>
                  </View>
                </View>
              ))}
            </View>
          );
        })}
        <View style={{ height: 32 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

function makeStyles(c: ColorPalette) { return StyleSheet.create({
  safe: { flex: 1, backgroundColor: c.background },
  scroll: { padding: Spacing.md, paddingBottom: 40 },
  heroRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 6 },
  hero: { fontFamily: Fonts.heading, fontSize: 24, color: c.brandPrimary, letterSpacing: -0.3 },
  subhero: { fontFamily: Fonts.body, fontSize: 13, color: c.textSecondary, lineHeight: 19, marginBottom: Spacing.lg },
  sectionHead: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingLeft: 8, borderLeftWidth: 3, marginTop: Spacing.lg, marginBottom: 6 },
  sectionH: { fontFamily: Fonts.bodySemi, fontSize: 11, letterSpacing: 1.2 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: c.cardBg, borderRadius: Radius.md, borderWidth: 1, borderColor: c.borderSubtle, padding: Spacing.md, marginBottom: 6 },
  bullet: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  title: { fontFamily: Fonts.bodySemi, fontSize: 14, color: c.brandPrimary },
  note: { fontFamily: Fonts.body, fontSize: 12, color: c.textPrimary, marginTop: 2 },
  meta: { fontFamily: Fonts.body, fontSize: 11, color: c.textSecondary, marginTop: 3 },
  emptyCard: { padding: Spacing.lg, alignItems: 'center', gap: 8, backgroundColor: c.cardBg, borderRadius: Radius.md, borderWidth: 1, borderColor: c.borderSubtle, marginTop: Spacing.md },
  emptyTitle: { fontFamily: Fonts.bodySemi, fontSize: 15, color: c.brandPrimary, marginTop: 4 },
  emptyBody: { fontFamily: Fonts.body, fontSize: 12, color: c.textSecondary, textAlign: 'center', lineHeight: 18 },
  cta: { marginTop: Spacing.sm, paddingHorizontal: 18, paddingVertical: 10, borderRadius: 999, backgroundColor: c.brandPrimary },
  ctaText: { fontFamily: Fonts.bodySemi, fontSize: 13, color: '#FFFFFF' },
}); }
