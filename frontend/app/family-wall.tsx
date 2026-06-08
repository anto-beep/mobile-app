import React from 'react';
import { useRouter } from 'expo-router';
import { EmptyState, ScreenShell } from '../src/components/Screen';
import { useApi } from '../src/lib/useApi';
import { ListCard } from '../src/components/Screen';

export default function FamilyWall() {
  const router = useRouter();
  const { data, loading, refreshing, refresh } = useApi<{ items: any[] }>('/family/wall');
  const items = data?.items || [];
  return (
    <ScreenShell title="Family wall" subtitle="Recent activity across this participant's circle" loading={loading} onRefresh={refresh} refreshing={refreshing}>
      {items.length === 0 ? (
        <EmptyState
          icon="people-circle-outline"
          title="Quiet here — for now"
          body="Anything posted in this family circle will show up here — visits logged, statements decoded, amendments raised, anomalies flagged."
          cta={{ label: 'View Today', onPress: () => router.push('/(tabs)/today' as any) }}
        />
      ) : items.map((e) => (
        <ListCard key={e.id} title={e.text || e.kind} subtitle={e.kind} />
      ))}
    </ScreenShell>
  );
}
