// Dashboard Recent Activity panel — §6.1 + DoD bullet #4.
import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { TimelineCell } from './Timeline';
import { useScenario } from '../context/ScenarioContext';
import { useParticipants } from '../context/ParticipantsContext';
import { Colors, Fonts, Spacing, Type } from '../lib/theme';

export function RecentActivityPanel() {
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
        <Text style={Type.h3 as any}>Recent activity</Text>
        <TouchableOpacity onPress={() => router.push('/timeline' as any)} testID="recent-activity-see-all" hitSlop={6}>
          <Text style={styles.link}>Open timeline</Text>
        </TouchableOpacity>
      </View>
      {loading ? (
        <Text style={styles.empty}>Loading…</Text>
      ) : items.length === 0 ? (
        <View style={styles.emptyCard}>
          <Ionicons name="sparkles-outline" size={20} color={Colors.brandPrimary} />
          <Text style={styles.emptyTitle}>Nothing here yet</Text>
          <Text style={styles.emptyBody}>Events, status changes and alerts for {active.first_name} will appear here as they happen.</Text>
          <TouchableOpacity onPress={() => router.push('/log-scenario' as any)} testID="recent-activity-log-event">
            <Text style={styles.link}>Log a scenario</Text>
          </TouchableOpacity>
        </View>
      ) : (
        items.map((it, idx) => <TimelineCell key={`${it.type}-${idx}-${it.at}`} item={it} />)
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: Spacing.md },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: Spacing.md, marginBottom: 6 },
  link: { color: Colors.brandPrimary, fontFamily: Fonts.bodySemi, fontWeight: '700' },
  empty: { ...Type.caption, color: Colors.textMuted, paddingHorizontal: Spacing.md },
  emptyCard: { marginHorizontal: Spacing.md, padding: Spacing.md, backgroundColor: Colors.cardBg, borderWidth: 1, borderColor: Colors.border, borderRadius: 14, gap: 6, alignItems: 'flex-start' },
  emptyTitle: { ...Type.bodySemi, color: Colors.textPrimary },
  emptyBody: { ...Type.body, color: Colors.textSecondary, lineHeight: 21 },
});
