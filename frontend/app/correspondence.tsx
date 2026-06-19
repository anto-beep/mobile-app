// Correspondence — letters/emails from the provider, grouped by month.
import React, { useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, RefreshControl, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useApi } from '../src/lib/useApi';
import BackHeader from '../src/components/BackHeader';
import { formatAUDate } from '../src/lib/format';
import { Colors, Fonts, Radius, Spacing } from '../src/lib/theme';

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
  try { return new Date(iso).toLocaleDateString('en-AU', { month: 'long', year: 'numeric' }); }
  catch { return 'Earlier'; }
}

export default function Correspondence() {
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
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={Colors.brandPrimary} />}
      >
        <View style={styles.heroRow}>
          <Ionicons name="mail-outline" size={22} color={Colors.brandPrimary} />
          <Text style={styles.hero}>Correspondence</Text>
        </View>
        <Text style={styles.subhero}>Letters, emails and outcomes from your provider — kept in one place so the whole family can read them.</Text>

        {loading ? null : items.length === 0 ? (
          <View style={styles.emptyCard}>
            <Ionicons name="mail-outline" size={28} color={Colors.textMuted} />
            <Text style={styles.emptyTitle}>No letters yet</Text>
            <Text style={styles.emptyBody}>Forwarded emails from your provider and auto-responses to amendments will land here.</Text>
          </View>
        ) : grouped.map(([m, rows]) => (
          <View key={m}>
            <Text style={styles.bucket}>{m.toUpperCase()}</Text>
            {rows.map((c) => (
              <TouchableOpacity key={c.id} style={styles.row} activeOpacity={0.85} testID={`corr-${c.id}`}>
                <View style={styles.iconWrap}>
                  <Ionicons name={KIND_ICON[c.kind || 'letter'] || 'document-text-outline'} size={16} color={Colors.brandPrimary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.subject} numberOfLines={1}>{c.subject || 'Letter'}</Text>
                  {!!c.preview && <Text style={styles.preview} numberOfLines={2}>{c.preview}</Text>}
                  <Text style={styles.meta}>
                    {c.sender ? `${c.sender} · ` : ''}{c.created_at ? formatAUDate(c.created_at) : ''}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={14} color={Colors.textMuted} />
              </TouchableOpacity>
            ))}
          </View>
        ))}
        <View style={{ height: 32 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.md, paddingBottom: 40 },
  heroRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 6 },
  hero: { fontFamily: Fonts.heading, fontSize: 24, color: Colors.brandPrimary, letterSpacing: -0.3 },
  subhero: { fontFamily: Fonts.body, fontSize: 13, color: Colors.textSecondary, lineHeight: 19, marginBottom: Spacing.lg },
  bucket: { fontFamily: Fonts.bodyMed, fontSize: 11, letterSpacing: 1.2, color: Colors.textMuted, marginTop: Spacing.lg, marginBottom: 6 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: Colors.cardBg, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.borderSubtle, padding: Spacing.md, marginBottom: 6 },
  iconWrap: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(14, 77, 82, 0.10)' },
  subject: { fontFamily: Fonts.bodySemi, fontSize: 14, color: Colors.brandPrimary },
  preview: { fontFamily: Fonts.body, fontSize: 12, color: Colors.textPrimary, marginTop: 2 },
  meta: { fontFamily: Fonts.body, fontSize: 11, color: Colors.textSecondary, marginTop: 3 },
  emptyCard: { padding: Spacing.lg, alignItems: 'center', gap: 8, backgroundColor: Colors.cardBg, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.borderSubtle, marginTop: Spacing.md },
  emptyTitle: { fontFamily: Fonts.bodySemi, fontSize: 15, color: Colors.brandPrimary, marginTop: 4 },
  emptyBody: { fontFamily: Fonts.body, fontSize: 12, color: Colors.textSecondary, textAlign: 'center', lineHeight: 18 },
});
