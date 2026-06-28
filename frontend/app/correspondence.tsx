// Correspondence — letters/emails from the provider, grouped by month.
import React, { useMemo } from 'react';
import { formatDate } from '../src/lib/formatDate';
import { View, Text, StyleSheet, ScrollView, RefreshControl, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useApi } from '../src/lib/useApi';
import BackHeader from '../src/components/BackHeader';
import { formatAUDate } from '../src/lib/format';
import { Fonts, Radius, Spacing } from '../src/lib/theme';
import type { ColorPalette } from '../src/lib/theme';
import { useColors } from '../src/hooks/useColors';
import { useThemedStyles } from '../src/hooks/useThemedStyles';

type Letter = {
  id: string;
  subject?: string;
  sender?: string;
  preview?: string;
  kind?: 'email' | 'letter' | 'reply' | string;
  created_at?: string;
};

const KIND_ICON: Record<string, keyof typeof Ionicons.glyphMap> = {
  email: 'mail-outline',
  letter: 'document-text-outline',
  reply: 'arrow-undo-outline',
};

function monthLabel(iso?: string): string {
  if (!iso) return 'Earlier';
  try { return formatDate(iso); }
  catch { return 'Earlier'; }
}

export default function Correspondence() {
  const c = useColors();
  const styles = useThemedStyles(makeStyles);
  const { data, loading, refreshing, refresh } = useApi<{ items: Letter[] }>('/correspondence');
  const items = data?.items || [];

  const grouped = useMemo(() => {
    const map = new Map<string, Letter[]>();
    for (const it of items) {
      const key = monthLabel(it.created_at);
      (map.get(key) || map.set(key, []).get(key))!.push(it);
    }
    return Array.from(map.entries());
  }, [items]);

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <BackHeader title="Correspondence" />
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={c.brandPrimary} />}
      >
        <View style={styles.heroRow}>
          <Ionicons name="mail-outline" size={22} color={c.brandPrimary} />
          <Text style={styles.hero}>Correspondence</Text>
        </View>
        <Text style={styles.subhero}>Letters, emails and outcomes from your provider — kept in one place so the whole family can read them.</Text>

        {loading ? null : items.length === 0 ? (
          <View style={styles.emptyCard}>
            <Ionicons name="mail-outline" size={28} color={c.textMuted} />
            <Text style={styles.emptyTitle}>No letters yet</Text>
            <Text style={styles.emptyBody}>Forwarded emails from your provider and auto-responses to amendments will land here.</Text>
          </View>
        ) : grouped.map(([m, rows]) => (
          <View key={m}>
            <Text style={styles.bucket}>{m.toUpperCase()}</Text>
            {rows.map((c) => (
              <TouchableOpacity key={c.id} style={styles.row} activeOpacity={0.85} testID={`corr-${c.id}`}>
                <View style={styles.iconWrap}>
                  <Ionicons name={KIND_ICON[c.kind || 'letter'] || 'document-text-outline'} size={16} color={c.brandPrimary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.subject} numberOfLines={1}>{c.subject || 'Letter'}</Text>
                  {!!c.preview && <Text style={styles.preview} numberOfLines={2}>{c.preview}</Text>}
                  <Text style={styles.meta}>
                    {c.sender ? `${c.sender} · ` : ''}{c.created_at ? formatAUDate(c.created_at) : ''}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={14} color={c.textMuted} />
              </TouchableOpacity>
            ))}
          </View>
        ))}
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
  bucket: { fontFamily: Fonts.bodyMed, fontSize: 11, letterSpacing: 1.2, color: c.textMuted, marginTop: Spacing.lg, marginBottom: 6 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: c.cardBg, borderRadius: Radius.md, borderWidth: 1, borderColor: c.borderSubtle, padding: Spacing.md, marginBottom: 6 },
  iconWrap: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(14, 77, 82, 0.10)' },
  subject: { fontFamily: Fonts.bodySemi, fontSize: 14, color: c.brandPrimary },
  preview: { fontFamily: Fonts.body, fontSize: 12, color: c.textPrimary, marginTop: 2 },
  meta: { fontFamily: Fonts.body, fontSize: 11, color: c.textSecondary, marginTop: 3 },
  emptyCard: { padding: Spacing.lg, alignItems: 'center', gap: 8, backgroundColor: c.cardBg, borderRadius: Radius.md, borderWidth: 1, borderColor: c.borderSubtle, marginTop: Spacing.md },
  emptyTitle: { fontFamily: Fonts.bodySemi, fontSize: 15, color: c.brandPrimary, marginTop: 4 },
  emptyBody: { fontFamily: Fonts.body, fontSize: 12, color: c.textSecondary, textAlign: 'center', lineHeight: 18 },
}); }
