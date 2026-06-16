import React from 'react';
import { EmptyState, ListCard, ScreenShell } from '../src/components/Screen';
import { useApi } from '../src/lib/useApi';
import { formatAUDate } from '../src/lib/format';

export default function AtHm() {
  const { data, loading, refreshing, refresh } = useApi<{ items: any[] }>('/at-hm');
  const items = data?.items || [];
  return (
    <ScreenShell useBack title="AT & home mods" subtitle="Assistive tech and home modifications tracker" loading={loading} onRefresh={refresh} refreshing={refreshing}>
      {items.length === 0 ? (
        <EmptyState
          icon="construct-outline"
          title="No items yet"
          body="Track wheelchair fittings, bathroom rails, grip‑seats, kitchen mods — anything that needs a quote, approval or install date."
        />
      ) : items.map((i) => (
        <ListCard key={i.id} title={i.title || 'Item'} subtitle={`${i.status || 'OPEN'}${i.installed_at ? ` · installed ${formatAUDate(i.installed_at)}` : ''}`} />
      ))}
    </ScreenShell>
  );
}
