// Usage stats
import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { api } from '../../src/lib/api';
import { Fonts, Radius, Spacing } from '../../src/lib/theme';
import type { ColorPalette } from '../../src/lib/theme';
import { useColors } from '../../src/hooks/useColors';
import { useThemedStyles } from '../../src/hooks/useThemedStyles';
import BackHeader from '../../src/components/BackHeader';

const num = (v: any, fallback = 0): number => {
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
};

export default function Usage() {
  const c = useColors();
  const styles = useThemedStyles(makeStyles);
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const { data } = await api.get('/usage');
        setData(data || {});
      } catch {
        setData({});
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <BackHeader title="Your Wayly use" />
        <View style={styles.loadingFill}><ActivityIndicator color={c.brandPrimary} /></View>
      </SafeAreaView>
    );
  }

  const stats = [
    { label: 'Statements decoded', value: num(data?.statements_decoded || data?.statements_count), icon: 'document-text-outline' as const, color: c.brandPrimary },
    { label: 'AI tools used this month', value: num(data?.tools_used_this_month || data?.tool_calls_month), icon: 'construct-outline' as const, color: c.brandSecondary },
    { label: 'Chat messages', value: num(data?.chat_messages || data?.help_chat_count), icon: 'chatbubbles-outline' as const, color: c.streams.Independence },
    { label: 'Anomalies caught', value: num(data?.anomalies_count || data?.anomalies_total), icon: 'alert-circle-outline' as const, color: c.severityAlert },
  ];

  const items = stats.filter((s) => s.value > 0);

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <BackHeader title="Your Wayly use" />
      <ScrollView contentContainerStyle={styles.scroll} testID="usage-scroll">
        <Text style={styles.sectionLabel}>Activity</Text>

        {items.length === 0 ? (
          <View style={styles.empty}>
            <Ionicons name="stats-chart-outline" size={36} color={c.textMuted} />
            <Text style={styles.emptyTitle}>No activity yet</Text>
            <Text style={styles.emptyBody}>Once you decode a statement or use a tool, you&apos;ll see your stats here.</Text>
          </View>
        ) : (
          <View style={styles.grid}>
            {items.map((s) => (
              <View key={s.label} style={styles.statCard} testID={`usage-${s.label.replace(/\s/g, '-').toLowerCase()}`}>
                <View style={[styles.iconWrap, { backgroundColor: `${s.color}15` }]}>
                  <Ionicons name={s.icon} size={20} color={s.color} />
                </View>
                <Text style={styles.value}>{s.value}</Text>
                <Text style={styles.label}>{s.label}</Text>
              </View>
            ))}
          </View>
        )}

        {data?.plan && (
          <View style={styles.planBadge}>
            <Text style={styles.planBadgeText}>On the <Text style={styles.bold}>{String(data.plan).toUpperCase()}</Text> plan</Text>
          </View>
        )}

        <Text style={styles.footnote}>
          Wayly logs every action so you can see your activity. We never use it to train AI models.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

function makeStyles(c: ColorPalette) { return StyleSheet.create({
  safe: { flex: 1, backgroundColor: c.background },
  loadingFill: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scroll: { padding: Spacing.lg, paddingBottom: 60 },
  sectionLabel: { fontFamily: Fonts.bodyMed, fontSize: 11, letterSpacing: 1.5, textTransform: 'uppercase', color: c.textMuted, marginBottom: Spacing.md },
  empty: { padding: Spacing.xl, alignItems: 'center', gap: 8, backgroundColor: c.cardBg, borderRadius: Radius.lg, borderWidth: 1, borderColor: c.borderSubtle },
  emptyTitle: { fontFamily: Fonts.headingMed, fontSize: 17, color: c.brandPrimary, marginTop: 8 },
  emptyBody: { fontFamily: Fonts.body, fontSize: 13, color: c.textSecondary, textAlign: 'center' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.md },
  statCard: { width: '47%', flexGrow: 1, backgroundColor: c.cardBg, borderRadius: Radius.lg, padding: Spacing.md + 4, borderWidth: 1, borderColor: c.borderSubtle, gap: 8 },
  iconWrap: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  value: { fontFamily: Fonts.heading, fontSize: 30, color: c.brandPrimary, letterSpacing: -0.5 },
  label: { fontFamily: Fonts.bodyMed, fontSize: 12, color: c.textSecondary },
  planBadge: { marginTop: Spacing.lg, padding: Spacing.md, backgroundColor: 'rgba(14, 77, 82, 0.04)', borderRadius: Radius.md, alignItems: 'center' },
  planBadgeText: { fontFamily: Fonts.body, fontSize: 14, color: c.textSecondary },
  bold: { fontFamily: Fonts.bodySemi, color: c.brandSecondary, letterSpacing: 0.5 },
  footnote: { fontFamily: Fonts.body, fontSize: 11, color: c.textMuted, textAlign: 'center', marginTop: Spacing.lg, lineHeight: 16 },
}); }
