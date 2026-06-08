import React from 'react';
import { EmptyState, ListCard, ScreenShell } from '../src/components/Screen';
import { useApi } from '../src/lib/useApi';
import { formatAUDate } from '../src/lib/format';

export default function Amendments() {
  const { data, loading, refreshing, refresh } = useApi<{ items: any[] }>('/amendments');
  const items = data?.items || [];
  return (
    <ScreenShell title="Amendments" subtitle="Statement disputes lodged with providers" loading={loading} onRefresh={refresh} refreshing={refreshing}>
      {items.length === 0 ? (
        <EmptyState
          icon="create-outline"
          title="No amendments in flight"
          body="Raise an amendment from any decoded statement when a charge looks wrong. We'll generate the email to the provider and track the response."
        />
      ) : items.map((a) => (
        <ListCard key={a.id} title={a.subject || a.kind} subtitle={`${a.status} · raised ${formatAUDate(a.created_at)}`} />
      ))}
    </ScreenShell>
  );
}
