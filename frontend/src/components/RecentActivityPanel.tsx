// Dashboard Recent Activity panel — §6.1 + DoD bullet #4.
import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { TimelineCell } from './Timeline';
import { useScenario } from '../context/ScenarioContext';
import { useParticipants } from '../context/ParticipantsContext';
import { Fonts, Spacing, Type } from '../lib/theme';
import type { ColorPalette } from '../lib/theme';
import { useColors } from '../hooks/useColors';
import { useThemedStyles } from '../hooks/useThemedStyles';

export function RecentActivityPanel() {
  const c = useColors();
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const { active, participantSig } = useParticipants();
  const { getTimeline, schema } = useScenario();
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!active || !schema) { setLoading(false); return; }
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const r = await getTimeline(active.id, 5);
        if (!cancelled) setItems(r?.items || []);
      } catch (e: any) {
        // Scenario engine may be unavailable on preview backends or during
        // transient outages — degrade silently so the dashboard still renders.
        if (!cancelled) setItems([]);
        if (__DEV__) console.warn('[RecentActivity] timeline fetch failed:', e?.message || e);
      } finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [active?.id, participantSig, schema, getTimeline]);

  if (!active) return null;

  return (
    <View style={styles.wrap} testID="dashboard-recent-activity">
      <View style={styles.head}>
        <Text style={styles.title}>Recent Activity</Text>
        <TouchableOpacity onPress={() => router.push('/timeline' as any)} testID="recent-activity-see-all" hitSlop={6}>
          <Text style={styles.link}>Open timeline</Text>
        </TouchableOpacity>
      </View>
      {loading ? (
        <Text style={styles.empty}>Loading…</Text>
      ) : items.length === 0 ? (
        <View style={styles.emptyCard}>
          <Ionicons name="sparkles-outline" size={20} color={c.brandPrimary} />
          <Text style={styles.emptyTitle}>Nothing here yet</Text>
          <Text style={styles.emptyBody}>Events, status changes and alerts for {active.first_name} will appear here as they happen.</Text>
          <TouchableOpacity onPress={() => router.push('/log-scenario' as any)} testID="recent-activity-log-event">
            <Text style={styles.link}>Log A Scenario</Text>
          </TouchableOpacity>
        </View>
      ) : (
        items.map((it, idx) => <TimelineCell key={`${it.type}-${idx}-${it.at}`} item={it} />)
      )}
    </View>
  );
}

function makeStyles(c: ColorPalette) { return StyleSheet.create({
  wrap: { marginTop: Spacing.md },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: Spacing.md, marginBottom: 6 },
  // Section header matches the web dashboard card overlines: uppercase
  // Inter 11/600, letter-spacing 2, muted.
  title: { fontFamily: Fonts.bodySemi, fontSize: 11, letterSpacing: 2, textTransform: 'uppercase', color: c.textMuted },
  link: { color: c.brandPrimary, fontFamily: Fonts.bodySemi, fontSize: 13 },
  empty: { ...Type.caption, color: c.textMuted, paddingHorizontal: Spacing.md },
  emptyCard: { marginHorizontal: Spacing.md, padding: Spacing.md, backgroundColor: c.cardBg, borderWidth: 1, borderColor: c.border, borderRadius: 14, gap: 6, alignItems: 'flex-start' },
  emptyTitle: { ...Type.bodySemi, color: c.textPrimary },
  emptyBody: { ...Type.body, color: c.textSecondary, lineHeight: 21 },
}); }
