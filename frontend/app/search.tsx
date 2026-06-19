// Global search — hits /api/search (multi-source).
import React, { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import BackHeader from '../src/components/BackHeader';
import { api } from '../src/lib/api';
import { Fonts, Radius, Spacing, Type } from '../src/lib/theme';
import type { ColorPalette } from '../src/lib/theme';
import { useColors } from '../src/hooks/useColors';
import { useThemedStyles } from '../src/hooks/useThemedStyles';
import { EmptyState, LoadingBlock } from '../src/components/Screen';

export default function Search() {
  const c = useColors();
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [groups, setGroups] = useState<any[]>([]);

  useEffect(() => {
    if (!q.trim()) { setGroups([]); return; }
    const t = setTimeout(async () => {
      setBusy(true);
      try {
        const { data } = await api.get('/search', { params: { q: q.trim() } });
        setGroups(data?.groups || []);
      } finally { setBusy(false); }
    }, 280);
    return () => clearTimeout(t);
  }, [q]);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <BackHeader title="Search" />
      <View style={styles.box}>
        <Ionicons name="search" size={18} color={c.textMuted} />
        <TextInput
          testID="global-search-input"
          value={q}
          onChangeText={setQ}
          placeholder="Search statements, documents, visits…"
          placeholderTextColor={c.textMuted}
          style={styles.input}
          autoFocus
        />
      </View>
      <ScrollView contentContainerStyle={{ paddingBottom: 60 }}>
        {busy && <LoadingBlock />}
        {!busy && q.trim() && groups.length === 0 && (
          <EmptyState icon="search-outline" title={`No results for “${q}”`} body="Try a different word, a provider name, a month or a dollar amount." />
        )}
        {!busy && !q.trim() && (
          <EmptyState icon="sparkles-outline" title="Search across everything" body="Statements, documents, visits, notes — all from one box." />
        )}
        {groups.map((g) => (
          <View key={g.kind} style={{ marginTop: 14 }}>
            <Text style={styles.groupLabel}>{g.label}</Text>
            {g.items.map((it: any) => (
              <TouchableOpacity
                key={it.id}
                onPress={() => router.push(it.deeplink as any)}
                style={styles.row}
                testID={`search-result-${g.kind}-${it.id}`}
              >
                <Text style={styles.rowTitle}>{it.title}</Text>
                {!!it.subtitle && <Text style={styles.rowSub}>{it.subtitle}</Text>}
              </TouchableOpacity>
            ))}
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

function makeStyles(c: ColorPalette) { return StyleSheet.create({
  safe: { flex: 1, backgroundColor: c.bg },
  box: { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: Spacing.md, marginTop: 6, marginBottom: 4, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 9999, backgroundColor: c.cardBg, borderWidth: 1, borderColor: c.border },
  input: { flex: 1, fontFamily: Fonts.body, color: c.textPrimary, fontSize: 16, paddingVertical: 0 },
  groupLabel: { ...Type.caption, color: c.textMuted, fontFamily: Fonts.bodySemi, paddingHorizontal: Spacing.lg, paddingBottom: 4, textTransform: 'uppercase', letterSpacing: 0.8 },
  row: { backgroundColor: c.cardBg, marginHorizontal: Spacing.md, marginBottom: 6, padding: Spacing.md, borderRadius: Radius.md, borderWidth: 1, borderColor: c.border },
  rowTitle: { ...Type.bodySemi, color: c.textPrimary },
  rowSub: { ...Type.caption, color: c.textSecondary, marginTop: 2 },
}); }
