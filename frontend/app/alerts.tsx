// Alerts inbox screen — lists active alerts for the active participant.
// Replaces the (tabs)/notifications stub with a proper scenario-driven inbox.
import React, { useCallback, useEffect, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import BackHeader from '../src/components/BackHeader';
import { useScenario } from '../src/context/ScenarioContext';
import { useParticipants } from '../src/context/ParticipantsContext';
import { AlertCell } from '../src/components/Timeline';
import { EmptyState } from '../src/components/Screen';
import { ListSkeleton } from '../src/components/Skeleton';
import { Colors, Spacing, Type } from '../src/lib/theme';

export default function AlertsInbox() {
  const { active, participantSig } = useParticipants();
  const { getAlerts } = useScenario();
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (isRefresh = false) => {
    if (!active) { setLoading(false); return; }
    if (isRefresh) setRefreshing(true); else setLoading(true);
    try {
      const r = await getAlerts(active.id);
      setItems(r || []);
    } catch (e: any) {
      setItems([]);
      if (__DEV__) console.warn('[Alerts] fetch failed:', e?.message || e);
    } finally { setLoading(false); setRefreshing(false); }
  }, [active, getAlerts]);
  useEffect(() => { void load(false); }, [load, participantSig]);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <BackHeader title="Alerts" />
      <ScrollView refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={Colors.brandPrimary} />} contentContainerStyle={{ paddingBottom: 60 }}>
        <View style={styles.head}>
          <Text style={Type.h1 as any}>Active alerts</Text>
          {!!active && <Text style={styles.sub}>For {active.first_name}</Text>}
        </View>
        {loading ? <ListSkeleton rows={4} /> : items.length === 0 ? (
          <EmptyState icon="shield-checkmark-outline" title="All clear" body="No active alerts for this participant. We'll let you know if a deadline approaches or a statement anomaly turns up." />
        ) : items.map((a) => (
          <AlertCell key={a.id} item={{ at: a.created_at || a.updated_at || new Date().toISOString(), type: 'alert', data: a }} />
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}
const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.bg },
  head: { paddingHorizontal: Spacing.lg, paddingTop: Spacing.md, paddingBottom: Spacing.sm },
  sub: { ...Type.caption, color: Colors.textSecondary, marginTop: 2 },
});
