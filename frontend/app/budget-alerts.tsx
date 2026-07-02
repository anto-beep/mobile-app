// Budget alerts — feed of over-budget lines AND a threshold-config UI that
// lets the user choose which streams to monitor and the dollar trip-wire.
// Thresholds persist to AsyncStorage today (the production backend doesn't
// yet expose a thresholds endpoint); on next backend deploy this can move to
// PATCH /api/budget/alert-prefs without any UI churn.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, RefreshControl, TouchableOpacity,
  TextInput, Switch, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useApi } from '../src/lib/useApi';
import BackHeader from '../src/components/BackHeader';
import { toast } from '../src/components/Toast';
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

// Streams we let users toggle. Mirrors the dashboard's stream filter.
const STREAMS = ['Clinical', 'Independence', 'Everyday Living'] as const;
type Stream = typeof STREAMS[number];

type Thresholds = {
  enabled: boolean;
  streams: Record<Stream, { on: boolean; cap: string }>;
};

const DEFAULTS: Thresholds = {
  enabled: true,
  streams: {
    Clinical: { on: true, cap: '2500' },
    Independence: { on: true, cap: '1800' },
    'Everyday Living': { on: false, cap: '1200' },
  },
};

const STORAGE_KEY = 'wayly:budget:thresholds';

export default function BudgetAlerts() {
  const c = useColors();
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const { data, loading, refreshing, refresh } = useApi<{ items: Alert[] }>('/budget/alerts');
  const items = data?.items || [];

  const [prefs, setPrefs] = useState<Thresholds>(DEFAULTS);
  const [editing, setEditing] = useState<Stream | null>(null);

  // ── Hydrate thresholds from AsyncStorage ──
  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed?.streams) {
            setPrefs({
              enabled: !!parsed.enabled,
              streams: { ...DEFAULTS.streams, ...parsed.streams },
            });
          }
        }
      } catch {}
    })();
  }, []);

  const savePrefs = useCallback(async (next: Thresholds) => {
    setPrefs(next);
    try { await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch {}
  }, []);

  const toggleAll = (v: boolean) => savePrefs({ ...prefs, enabled: v });
  const toggleStream = (s: Stream, v: boolean) =>
    savePrefs({ ...prefs, streams: { ...prefs.streams, [s]: { ...prefs.streams[s], on: v } } });
  const setCap = (s: Stream, cap: string) =>
    savePrefs({ ...prefs, streams: { ...prefs.streams, [s]: { ...prefs.streams[s], cap } } });

  const grouped = useMemo(() => {
    const order = ['CRITICAL', 'WARN', 'INFO'];
    const map = new Map<string, Alert[]>();
    for (const a of items) {
      const k = (a.severity || 'INFO').toUpperCase();
      (map.get(k) || map.set(k, []).get(k))!.push(a);
    }
    return order.map((k) => [k, map.get(k) || []] as const).filter(([, arr]) => arr.length > 0);
  }, [items]);

  const activeCount = useMemo(
    () => Object.values(prefs.streams).filter((s) => s.on).length,
    [prefs]
  );

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
          Tell Wayly which budget lines to watch. We re-check every statement upload and flag lines that look like they will run over.
        </Text>

        {/* ── Threshold-config card ─────────────────────────────────── */}
        <View style={styles.configCard}>
          <View style={styles.configHead}>
            <View style={{ flex: 1 }}>
              <Text style={styles.configTitle}>Your alert thresholds</Text>
              <Text style={styles.configSub}>
                {prefs.enabled
                  ? `${activeCount} of ${STREAMS.length} streams being watched`
                  : 'Paused, Wayly won\u2019t send budget alerts right now'}
              </Text>
            </View>
            <Switch
              value={prefs.enabled}
              onValueChange={toggleAll}
              trackColor={{ false: 'rgba(122,138,140,0.45)', true: c.brandPrimary }}
              thumbColor="#FFFFFF"
              testID="budget-alerts-master-toggle"
            />
          </View>

          {prefs.enabled && (
            <View style={styles.streamList}>
              {STREAMS.map((s) => {
                const sp = prefs.streams[s];
                const isEditing = editing === s;
                return (
                  <View key={s} style={styles.streamRow}>
                    <TouchableOpacity
                      onPress={() => toggleStream(s, !sp.on)}
                      style={[styles.streamPill, sp.on ? styles.streamPillOn : styles.streamPillOff]}
                      testID={`budget-alerts-stream-${s}`}
                    >
                      <Ionicons
                        name={sp.on ? 'checkmark-circle' : 'ellipse-outline'}
                        size={16}
                        color={sp.on ? c.brandPrimary : c.textMuted}
                      />
                      <Text style={[styles.streamLbl, sp.on ? styles.streamLblOn : styles.streamLblOff]}>{s}</Text>
                    </TouchableOpacity>
                    <View style={styles.capWrap}>
                      <Text style={styles.capPrefix}>$</Text>
                      {isEditing ? (
                        <TextInput
                          autoFocus
                          value={sp.cap}
                          onChangeText={(t) => setCap(s, t.replace(/[^0-9]/g, ''))}
                          onBlur={() => setEditing(null)}
                          onSubmitEditing={() => { setEditing(null); toast.success('Threshold saved'); }}
                          keyboardType="numeric"
                          style={styles.capInput}
                          testID={`budget-alerts-cap-${s}`}
                          placeholder="0"
                          placeholderTextColor={c.textMuted}
                        />
                      ) : (
                        <TouchableOpacity onPress={() => sp.on && setEditing(s)} disabled={!sp.on}>
                          <Text style={[styles.capValue, !sp.on && styles.capValueOff]}>
                            {sp.cap || '—'}
                          </Text>
                        </TouchableOpacity>
                      )}
                      <Text style={styles.capUnit}>/qtr</Text>
                    </View>
                  </View>
                );
              })}
            </View>
          )}
          <Text style={styles.configFoot}>
            <Ionicons name="lock-closed-outline" size={11} color={c.textMuted} /> Saved on this device.
          </Text>
        </View>

        {/* ── Live alert feed ──────────────────────────────────────── */}
        <Text style={styles.feedH}>Active alerts</Text>
        {loading ? null : items.length === 0 ? (
          <View style={styles.emptyCard}>
            <Ionicons name="shield-checkmark-outline" size={28} color={c.textMuted} />
            <Text style={styles.emptyTitle}>No alerts right now</Text>
            <Text style={styles.emptyBody}>If any category looks like it will over-run this quarter, we will surface it here.</Text>
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
  hero: { fontFamily: Fonts.heading, fontSize: 24, color: c.textPrimary, letterSpacing: -0.3 },
  subhero: { fontFamily: Fonts.body, fontSize: 13, color: c.textSecondary, lineHeight: 19, marginBottom: Spacing.lg },

  // Config card
  configCard: { backgroundColor: c.cardBg, borderRadius: Radius.lg, borderWidth: 1, borderColor: c.border, padding: Spacing.md, marginBottom: Spacing.lg },
  configHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  configTitle: { fontFamily: Fonts.heading, fontSize: 16, color: c.textPrimary },
  configSub: { fontFamily: Fonts.body, fontSize: 12, color: c.textSecondary, marginTop: 2 },
  streamList: { marginTop: Spacing.md, gap: 8 },
  streamRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  streamPill: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 999, borderWidth: 1 },
  streamPillOn: { backgroundColor: c.surfaceTint, borderColor: c.brandPrimary },
  streamPillOff: { backgroundColor: 'transparent', borderColor: c.borderSubtle },
  streamLbl: { fontFamily: Fonts.bodySemi, fontSize: 13 },
  streamLblOn: { color: c.textPrimary },
  streamLblOff: { color: c.textMuted },
  capWrap: { flexDirection: 'row', alignItems: 'baseline', gap: 2, minWidth: 86, justifyContent: 'flex-end' },
  capPrefix: { fontFamily: Fonts.body, fontSize: 12, color: c.textSecondary },
  capValue: { fontFamily: Fonts.bodySemi, fontSize: 16, color: c.textPrimary, minWidth: 40, textAlign: 'right' },
  capValueOff: { color: c.textMuted },
  capInput: { fontFamily: Fonts.bodySemi, fontSize: 16, color: c.textPrimary, minWidth: 50, textAlign: 'right', paddingVertical: 0 },
  capUnit: { fontFamily: Fonts.body, fontSize: 11, color: c.textMuted },
  configFoot: { marginTop: Spacing.md, fontFamily: Fonts.body, fontSize: 11, color: c.textMuted },

  // Feed
  feedH: { fontFamily: Fonts.heading, fontSize: 18, color: c.textPrimary, marginBottom: Spacing.sm, letterSpacing: -0.2 },
  sectionHead: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingLeft: 8, borderLeftWidth: 3, marginTop: Spacing.md, marginBottom: 6 },
  sectionH: { fontFamily: Fonts.bodySemi, fontSize: 11, letterSpacing: 1.2 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: c.cardBg, borderRadius: Radius.md, borderWidth: 1, borderColor: c.borderSubtle, padding: Spacing.md, marginBottom: 6 },
  bullet: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  title: { fontFamily: Fonts.bodySemi, fontSize: 14, color: c.textPrimary },
  note: { fontFamily: Fonts.body, fontSize: 12, color: c.textSecondary, marginTop: 2 },
  meta: { fontFamily: Fonts.body, fontSize: 11, color: c.textMuted, marginTop: 3 },
  emptyCard: { padding: Spacing.lg, alignItems: 'center', gap: 8, backgroundColor: c.cardBg, borderRadius: Radius.md, borderWidth: 1, borderColor: c.borderSubtle, marginTop: Spacing.sm },
  emptyTitle: { fontFamily: Fonts.bodySemi, fontSize: 15, color: c.textPrimary, marginTop: 4 },
  emptyBody: { fontFamily: Fonts.body, fontSize: 12, color: c.textSecondary, textAlign: 'center', lineHeight: 18 },
  cta: { marginTop: Spacing.sm, paddingHorizontal: 18, paddingVertical: 10, borderRadius: 999, backgroundColor: c.brandPrimary },
  ctaText: { fontFamily: Fonts.bodySemi, fontSize: 13, color: '#FFFFFF' },
}); }
