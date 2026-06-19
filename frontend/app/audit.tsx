// Audit Log — Phase C parity with the web app.
//
// Renders a chronological timeline of every privacy-sensitive action: sign-
// ins, statement uploads, decoder runs, amendments, document uploads, visit
// edits and family-wall posts. Items are grouped by day (Today, Yesterday,
// Earlier this week, then per-date) and tagged with an icon + colour per
// kind so it's easy to scan at a glance.
import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ScrollView,
  RefreshControl,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useApi } from '../src/lib/useApi';
import BackHeader from '../src/components/BackHeader';
import { Fonts, Radius, Spacing } from '../src/lib/theme';
import type { ColorPalette } from '../src/lib/theme';
import { useColors } from '../src/hooks/useColors';
import { useThemedStyles } from '../src/hooks/useThemedStyles';

type AuditEvent = {
  id: string;
  action: string;
  detail?: string;
  kind?: string;
  user_email?: string;
  created_at: string;
};

type KindMeta = { icon: keyof typeof Ionicons.glyphMap; tint: string; label: string };
const KINDS: Record<string, KindMeta> = {
  statement: { icon: 'document-text-outline', tint: '#0E4D52', label: 'Statement' },
  decoder:   { icon: 'sparkles-outline',      tint: '#1F6F73', label: 'Decoder' },
  amendment: { icon: 'create-outline',        tint: '#A5512B', label: 'Amendment' },
  document:  { icon: 'folder-outline',        tint: '#5C3D11', label: 'Document' },
  visit:     { icon: 'calendar-outline',      tint: '#3A5F37', label: 'Visit' },
  wall:      { icon: 'people-circle-outline', tint: '#6B7C92', label: 'Family wall' },
  system:    { icon: 'shield-checkmark-outline', tint: '#6B7C92', label: 'System' },
};

function meta(kind?: string): KindMeta {
  return KINDS[kind || 'system'] || KINDS.system;
}

function startOfDay(d: Date) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
function fmtTime(iso: string) {
  try { return new Date(iso).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' }); }
  catch { return ''; }
}
function fmtDayBucket(iso: string): string {
  try {
    const t = new Date(iso);
    const now = new Date();
    const today = startOfDay(now).getTime();
    const yesterday = today - 86_400_000;
    const tDay = startOfDay(t).getTime();
    if (tDay === today) return 'Today';
    if (tDay === yesterday) return 'Yesterday';
    const sevenAgo = today - 7 * 86_400_000;
    if (tDay >= sevenAgo) return t.toLocaleDateString('en-AU', { weekday: 'long' });
    return t.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
  } catch { return 'Earlier'; }
}

export default function Audit() {
  const c = useColors();
  const styles = useThemedStyles(makeStyles);
  const { data, loading, refreshing, refresh } = useApi<{ items: AuditEvent[] }>('/audit');
  const items = data?.items || [];
  const [q, setQ] = useState('');

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return items;
    return items.filter((e) =>
      [e.action, e.detail, e.user_email, e.kind]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(needle))
    );
  }, [items, q]);

  const grouped = useMemo(() => {
    const groups = new Map<string, AuditEvent[]>();
    for (const e of filtered) {
      const k = fmtDayBucket(e.created_at);
      const arr = groups.get(k) || [];
      arr.push(e);
      groups.set(k, arr);
    }
    return Array.from(groups.entries());
  }, [filtered]);

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <BackHeader title="Audit log" />
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={c.brandPrimary} />}
      >
        <View style={styles.heroRow}>
          <Ionicons name="shield-checkmark-outline" size={22} color={c.brandPrimary} />
          <Text style={styles.hero}>Audit log</Text>
        </View>
        <Text style={styles.subhero}>
          Every privacy-sensitive action — sign-ins, statement uploads, decoder runs, amendments, document downloads and admin events.
        </Text>

        {/* Search */}
        <View style={styles.searchWrap}>
          <Ionicons name="search-outline" size={14} color={c.textMuted} />
          <TextInput
            value={q}
            onChangeText={setQ}
            placeholder="Filter by action, detail or email…"
            placeholderTextColor={c.textMuted}
            style={styles.searchInput}
            autoCorrect={false}
            autoCapitalize="none"
            testID="audit-search"
          />
          {q.length > 0 ? (
            <TouchableOpacity onPress={() => setQ('')} hitSlop={8}>
              <Ionicons name="close-circle" size={16} color={c.textMuted} />
            </TouchableOpacity>
          ) : null}
        </View>

        {loading ? (
          <ActivityIndicator color={c.brandPrimary} style={{ paddingVertical: 32 }} />
        ) : filtered.length === 0 ? (
          <View style={styles.emptyCard}>
            <Ionicons name="shield-checkmark-outline" size={28} color={c.textMuted} />
            <Text style={styles.emptyTitle}>{q ? 'No matches' : 'Clean slate'}</Text>
            <Text style={styles.emptyBody}>
              {q
                ? 'Try a different keyword.'
                : 'This log records every sign-in, decoder run, amendment and admin action. Anything you do here will appear in this timeline.'}
            </Text>
          </View>
        ) : (
          grouped.map(([bucket, evs]) => (
            <View key={bucket}>
              <Text style={styles.bucket}>{bucket}</Text>
              {evs.map((e) => {
                const m = meta(e.kind);
                return (
                  <View key={e.id} style={styles.row} testID={`audit-${e.id}`}>
                    <View style={[styles.iconWrap, { backgroundColor: `${m.tint}1A` }]}>
                      <Ionicons name={m.icon} size={16} color={m.tint} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.rowTitle} numberOfLines={1}>{e.action}</Text>
                      {!!e.detail && <Text style={styles.rowDetail} numberOfLines={2}>{e.detail}</Text>}
                      <Text style={styles.rowMeta}>
                        {fmtTime(e.created_at)}{e.user_email ? ` · ${e.user_email}` : ''}
                      </Text>
                    </View>
                    <View style={[styles.kindPill, { backgroundColor: `${m.tint}14` }]}>
                      <Text style={[styles.kindPillText, { color: m.tint }]}>{m.label}</Text>
                    </View>
                  </View>
                );
              })}
            </View>
          ))
        )}

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
  subhero: { fontFamily: Fonts.body, fontSize: 13, color: c.textSecondary, lineHeight: 19, marginBottom: Spacing.md },

  searchWrap: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: c.cardBg, borderRadius: Radius.md,
    borderWidth: 1, borderColor: c.borderSubtle,
    paddingHorizontal: 10, paddingVertical: 6, marginBottom: Spacing.lg,
  },
  searchInput: { flex: 1, fontFamily: Fonts.body, fontSize: 13, color: c.textPrimary, paddingVertical: 6 },

  bucket: { fontFamily: Fonts.bodyMed, fontSize: 11, letterSpacing: 1.2, textTransform: 'uppercase', color: c.textMuted, marginTop: Spacing.lg, marginBottom: 6 },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: c.cardBg, borderRadius: Radius.md,
    borderWidth: 1, borderColor: c.borderSubtle,
    padding: Spacing.md, marginBottom: 6,
  },
  iconWrap: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  rowTitle: { fontFamily: Fonts.bodySemi, fontSize: 14, color: c.brandPrimary },
  rowDetail: { fontFamily: Fonts.body, fontSize: 12, color: c.textPrimary, marginTop: 2 },
  rowMeta: { fontFamily: Fonts.body, fontSize: 11, color: c.textSecondary, marginTop: 3 },
  kindPill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 },
  kindPillText: { fontFamily: Fonts.bodySemi, fontSize: 10, letterSpacing: 0.4 },

  emptyCard: {
    padding: Spacing.lg, alignItems: 'center', gap: 8,
    backgroundColor: c.cardBg, borderRadius: Radius.md,
    borderWidth: 1, borderColor: c.borderSubtle, marginTop: Spacing.md,
  },
  emptyTitle: { fontFamily: Fonts.bodySemi, fontSize: 15, color: c.brandPrimary, marginTop: 4 },
  emptyBody: { fontFamily: Fonts.body, fontSize: 12, color: c.textSecondary, textAlign: 'center', lineHeight: 18 },
}); }
