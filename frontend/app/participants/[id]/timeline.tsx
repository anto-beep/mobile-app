// Per-participant Timeline screen — pinned to :id (parity with web /app/participants/:id/timeline).
import React, { useEffect, useState, useCallback } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import BackHeader from '../../../src/components/BackHeader';
import { useScenario } from '../../../src/context/ScenarioContext';
import { TimelineCell, StatusBadge } from '../../../src/components/Timeline';
import { EmptyState } from '../../../src/components/Screen';
import { ListSkeleton } from '../../../src/components/Skeleton';
import { Colors, Spacing, Type } from '../../../src/lib/theme';

export default function ParticipantTimeline() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { getTimeline } = useScenario();
  const [items, setItems] = useState<any[]>([]);
  const [firstName, setFirst] = useState<string | undefined>();
  const [lifecycle, setLifecycle] = useState<string | undefined>();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (isRefresh = false) => {
    if (!id) return;
    if (isRefresh) setRefreshing(true); else setLoading(true);
    try {
      const r = await getTimeline(String(id), 80);
      setItems(r?.items || []); setFirst(r?.first_name); setLifecycle(r?.lifecycle_state);
    } finally { setLoading(false); setRefreshing(false); }
  }, [id, getTimeline]);
  useEffect(() => { void load(false); }, [load]);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <BackHeader title="Timeline" />
      <ScrollView refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={Colors.brandPrimary} />} contentContainerStyle={{ paddingBottom: 60 }}>
        <View style={styles.head}>
          <Text style={Type.h1 as any}>{firstName || 'Participant'}</Text>
          {!!lifecycle && <StatusBadge state={lifecycle} />}
        </View>
        {loading ? <ListSkeleton rows={5} /> : items.length === 0 ? (
          <EmptyState icon="time-outline" title="Empty timeline" body="No events, status changes or alerts have been logged for this participant yet." />
        ) : items.map((it, idx) => <TimelineCell key={`${it.type}-${idx}-${it.at}`} item={it} />)}
      </ScrollView>
    </SafeAreaView>
  );
}
const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.bg },
  head: { paddingHorizontal: Spacing.lg, paddingTop: Spacing.md, paddingBottom: Spacing.sm, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
});
