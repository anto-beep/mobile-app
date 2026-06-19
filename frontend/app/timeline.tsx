// Timeline screen — active participant.
import React, { useEffect, useState, useCallback } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import BackHeader from '../src/components/BackHeader';
import { useScenario } from '../src/context/ScenarioContext';
import { useParticipants } from '../src/context/ParticipantsContext';
import { TimelineCell, StatusBadge } from '../src/components/Timeline';
import { LogScenarioSheet } from '../src/components/LogScenarioSheet';
import { EmptyState } from '../src/components/Screen';
import { ListSkeleton } from '../src/components/Skeleton';
import { Fonts, Spacing, Type } from '../src/lib/theme';
import type { ColorPalette } from '../src/lib/theme';
import { useColors } from '../src/hooks/useColors';
import { useThemedStyles } from '../src/hooks/useThemedStyles';

export default function Timeline() {
  const c = useColors();
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const { active, participantSig } = useParticipants();
  const { getTimeline } = useScenario();
  const [items, setItems] = useState<any[]>([]);
  const [lifecycle, setLifecycle] = useState<string | undefined>();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showCapture, setShowCapture] = useState(false);

  const load = useCallback(async (isRefresh = false) => {
    if (!active) { setLoading(false); return; }
    if (isRefresh) setRefreshing(true); else setLoading(true);
    try {
      const r = await getTimeline(active.id, 80);
      setItems(r?.items || []);
      setLifecycle(r?.lifecycle_state);
    } catch (e: any) {
      // Scenario engine may be unavailable — show an empty state instead of crashing.
      setItems([]);
      if (__DEV__) console.warn('[Timeline] fetch failed:', e?.message || e);
    } finally { setLoading(false); setRefreshing(false); }
  }, [active, getTimeline]);

  useEffect(() => { void load(false); }, [load, participantSig]);

  if (!active) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <BackHeader title="Timeline" />
        <EmptyState icon="people-outline" title="No participant selected" body="Add a participant to start building their timeline." cta={{ label: 'Go to Participants', onPress: () => router.push('/participants' as any) }} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <BackHeader title="Timeline" />
      <ScrollView refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={c.brandPrimary} />} contentContainerStyle={{ paddingBottom: 100 }}>
        <View style={styles.head}>
          <Text style={Type.h1 as any}>{active.first_name}</Text>
          {!!lifecycle && <StatusBadge state={lifecycle} />}
        </View>
        {loading ? <ListSkeleton rows={5} /> : items.length === 0 ? (
          <EmptyState icon="document-text-outline" title="Nothing logged yet" body={`${active.first_name}’s timeline will start filling as events are captured — hospital admissions, statement anomalies, status changes, alerts.`} cta={{ label: 'Log a scenario', onPress: () => setShowCapture(true) }} />
        ) : items.map((it, idx) => <TimelineCell key={`${it.type}-${idx}-${it.at}`} item={it} />)}
      </ScrollView>
      <TouchableOpacity testID="log-scenario-fab" onPress={() => setShowCapture(true)} style={styles.fab}>
        <Ionicons name="add" size={26} color="#fff" />
      </TouchableOpacity>
      <LogScenarioSheet visible={showCapture} participantId={active.id} participantName={active.first_name} onClose={() => setShowCapture(false)} onLogged={() => { setShowCapture(false); load(true); }} />
    </SafeAreaView>
  );
}

function makeStyles(c: ColorPalette) { return StyleSheet.create({
  safe: { flex: 1, backgroundColor: c.bg },
  head: { paddingHorizontal: Spacing.lg, paddingTop: Spacing.md, paddingBottom: Spacing.sm, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  fab: { position: 'absolute', right: 20, bottom: 24, width: 56, height: 56, borderRadius: 28, backgroundColor: c.brandPrimary, alignItems: 'center', justifyContent: 'center', elevation: 4 },
}); }
