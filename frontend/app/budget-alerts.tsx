import React from 'react';
import { useRouter } from 'expo-router';
import { EmptyState, ListCard, ScreenShell } from '../src/components/Screen';
import { useApi } from '../src/lib/useApi';
import { formatAUD2 } from '../src/lib/theme';

export default function BudgetAlerts() {
  const router = useRouter();
  const { data, loading, refreshing, refresh } = useApi<{ items: any[] }>('/budget/alerts');
  const items = data?.items || [];
  return (
    <ScreenShell title="Budget alerts" subtitle="Lines that are running ahead of plan" loading={loading} onRefresh={refresh} refreshing={refreshing}>
      {items.length === 0 ? (
        <EmptyState
          icon="alert-circle-outline"
          title="No alerts right now"
          body="Wayly watches your budget every time a statement is uploaded. If a category looks like it'll over‑run, we'll flag it here."
          cta={{ label: 'View budget', onPress: () => router.push('/(tabs)/today' as any) }}
        />
      ) : items.map((a) => (
        <ListCard key={a.id} title={a.category || 'Alert'} subtitle={a.amount ? `Over by ${formatAUD2(a.amount)}` : a.note} />
      ))}
    </ScreenShell>
  );
}
