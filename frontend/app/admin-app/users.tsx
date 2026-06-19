// Admin user lookup — search + long-press email/call/sms shortcuts
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, TextInput, TouchableOpacity, ActivityIndicator, Alert, Linking } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { adminApi } from '../../src/context/AdminAuthContext';
import { Fonts, Radius, Spacing } from '../../src/lib/theme';
import type { ColorPalette } from '../../src/lib/theme';
import { useColors } from '../../src/hooks/useColors';
import { useThemedStyles } from '../../src/hooks/useThemedStyles';
import { toast } from '../../src/components/Toast';

type UserRow = { id: string; email: string; name?: string; plan?: string; subscription_status?: string; is_admin?: boolean; suspended?: boolean };
type Ticket = { id: string; subject: string; priority: string; status: string };

export default function AdminUserSearch() {
  const c = useColors();
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const [q, setQ] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const [users, setUsers] = useState<UserRow[]>([]);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<any>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setDebouncedQ(q.trim()), 300);
    return () => debounceRef.current && clearTimeout(debounceRef.current);
  }, [q]);

  const search = useCallback(async () => {
    if (!debouncedQ) { setUsers([]); setTickets([]); return; }
    setLoading(true);
    try {
      const { data } = await adminApi.get('/admin/search', { params: { q: debouncedQ } });
      setUsers(data.users || []);
      setTickets(data.tickets || []);
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || 'Search failed');
    } finally { setLoading(false); }
  }, [debouncedQ]);

  useEffect(() => { search(); }, [search]);

  const longPress = (u: UserRow) => {
    const options = [
      { text: 'Email', onPress: () => Linking.openURL(`mailto:${u.email}`).catch(() => {}) },
      { text: 'Copy email', onPress: async () => { try { const Clipboard = require('expo-clipboard'); await Clipboard.setStringAsync(u.email); toast.success('Email copied'); } catch {} } },
      { text: 'Open profile', onPress: () => router.push(`/admin-app/users/${u.id}` as any) },
      { text: 'Cancel', style: 'cancel' as const },
    ];
    Alert.alert(u.name || u.email, u.email, options);
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.back} testID="search-back">
          <Ionicons name="chevron-back" size={20} color={c.brandPrimary} />
          <Text style={styles.backText}>Inbox</Text>
        </TouchableOpacity>
        <Text style={styles.h1}>Search</Text>
        <View style={styles.searchWrap}>
          <Ionicons name="search-outline" size={16} color={c.textMuted} />
          <TextInput
            value={q} onChangeText={setQ}
            placeholder="Email, name, ticket subject…"
            placeholderTextColor={c.textMuted}
            style={styles.searchInput}
            autoCapitalize="none"
            autoCorrect={false}
            autoFocus
            testID="admin-search"
          />
          {q ? (
            <TouchableOpacity onPress={() => setQ('')} hitSlop={10}>
              <Ionicons name="close-circle" size={16} color={c.textMuted} />
            </TouchableOpacity>
          ) : null}
        </View>
      </View>

      {loading ? (
        <View style={styles.fill}><ActivityIndicator color={c.brandPrimary} /></View>
      ) : !debouncedQ ? (
        <View style={styles.hintBox}>
          <Ionicons name="search" size={28} color={c.textMuted} />
          <Text style={styles.hintTitle}>Find anyone in seconds</Text>
          <Text style={styles.hintBody}>Type an email, a name, or a ticket subject. Tap & hold a user to email or copy their address quickly.</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.list} testID="search-results">
          {users.length === 0 && tickets.length === 0 ? (
            <Text style={styles.empty}>Nothing matched “{debouncedQ}”.</Text>
          ) : null}

          {users.length > 0 ? (
            <>
              <Text style={styles.sectionLabel}>Users ({users.length})</Text>
              {users.map((u) => (
                <TouchableOpacity
                  key={u.id}
                  style={styles.row}
                  onPress={() => router.push(`/admin-app/users/${u.id}` as any)}
                  onLongPress={() => longPress(u)}
                  delayLongPress={350}
                  testID={`user-${u.id}`}
                >
                  <View style={[styles.dot, { backgroundColor: u.suspended ? c.danger : c.brandSecondary }]} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.name} numberOfLines={1}>{u.name || u.email}</Text>
                    <Text style={styles.meta} numberOfLines={1}>
                      {u.email}
                      {u.plan ? `  ·  ${u.plan}` : ''}
                      {u.subscription_status && u.subscription_status !== 'none' ? `  ·  ${u.subscription_status}` : ''}
                    </Text>
                  </View>
                  {u.is_admin ? <View style={styles.adminPill}><Text style={styles.adminPillText}>ADMIN</Text></View> : null}
                  <Ionicons name="chevron-forward" size={14} color={c.textMuted} />
                </TouchableOpacity>
              ))}
            </>
          ) : null}

          {tickets.length > 0 ? (
            <>
              <Text style={styles.sectionLabel}>Tickets ({tickets.length})</Text>
              {tickets.map((t) => (
                <TouchableOpacity
                  key={t.id}
                  style={styles.row}
                  onPress={() => router.push(`/admin-app/tickets/${t.id}` as any)}
                  testID={`ticket-${t.id}`}
                >
                  <View style={[styles.dot, { backgroundColor: t.priority === 'P1' ? c.danger : t.priority === 'P2' ? c.brandSecondary : c.textMuted }]} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.name} numberOfLines={2}>{t.subject}</Text>
                    <Text style={styles.meta}>{t.priority} · {t.status.replace('_', ' ')}</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={14} color={c.textMuted} />
                </TouchableOpacity>
              ))}
            </>
          ) : null}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function makeStyles(c: ColorPalette) { return StyleSheet.create({
  safe: { flex: 1, backgroundColor: c.background },
  fill: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: { paddingHorizontal: Spacing.lg, paddingTop: Spacing.sm, paddingBottom: Spacing.sm, borderBottomWidth: 1, borderBottomColor: c.borderSubtle, gap: 8 },
  back: { flexDirection: 'row', alignItems: 'center' },
  backText: { fontFamily: Fonts.bodyMed, fontSize: 14, color: c.brandPrimary },
  h1: { fontFamily: Fonts.heading, fontSize: 24, color: c.brandPrimary, letterSpacing: -0.3 },
  searchWrap: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: c.cardBg, borderRadius: Radius.md, paddingHorizontal: Spacing.sm, borderWidth: 1, borderColor: c.border, minHeight: 44 },
  searchInput: { flex: 1, fontFamily: Fonts.body, fontSize: 14, color: c.textPrimary, paddingVertical: 10 },
  hintBox: { padding: Spacing.xl, alignItems: 'center', gap: 8, marginTop: Spacing.xl },
  hintTitle: { fontFamily: Fonts.bodySemi, fontSize: 16, color: c.brandPrimary, marginTop: 4 },
  hintBody: { fontFamily: Fonts.body, fontSize: 13, color: c.textSecondary, textAlign: 'center', lineHeight: 19, maxWidth: 280 },
  list: { padding: Spacing.lg, paddingBottom: Spacing.xl, gap: 8 },
  sectionLabel: { fontFamily: Fonts.bodyMed, fontSize: 11, letterSpacing: 1.2, textTransform: 'uppercase', color: c.textMuted, marginBottom: 4, marginTop: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: Spacing.md, backgroundColor: c.cardBg, borderRadius: Radius.md, borderWidth: 1, borderColor: c.borderSubtle, minHeight: 56 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  name: { fontFamily: Fonts.bodySemi, fontSize: 14, color: c.brandPrimary },
  meta: { fontFamily: Fonts.body, fontSize: 12, color: c.textSecondary, marginTop: 2 },
  adminPill: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 100, backgroundColor: c.brandSecondary },
  adminPillText: { fontFamily: Fonts.bodySemi, fontSize: 9, color: c.brandPrimary, letterSpacing: 0.5 },
  empty: { fontFamily: Fonts.body, fontSize: 14, color: c.textMuted, textAlign: 'center', padding: Spacing.xl },
}); }
