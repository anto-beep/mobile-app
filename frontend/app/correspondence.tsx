import React from 'react';
import { EmptyState, ListCard, ScreenShell } from '../src/components/Screen';
import { useApi } from '../src/lib/useApi';
import { formatAUDate } from '../src/lib/format';

export default function Correspondence() {
  const { data, loading, refreshing, refresh } = useApi<{ items: any[] }>('/correspondence');
  const items = data?.items || [];
  return (
    <ScreenShell title="Correspondence" subtitle="Letters, emails and outcomes from providers" loading={loading} onRefresh={refresh} refreshing={refreshing}>
      {items.length === 0 ? (
        <EmptyState
          icon="mail-outline"
          title="No letters yet"
          body="Forwarded emails from your provider and auto‑responses to amendments will land here so the whole family can read them."
        />
      ) : items.map((c) => (
        <ListCard key={c.id} title={c.subject || 'Letter'} subtitle={formatAUDate(c.created_at)} />
      ))}
    </ScreenShell>
  );
}
