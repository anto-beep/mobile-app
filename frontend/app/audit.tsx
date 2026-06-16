import React from 'react';
import { EmptyState, ListCard, ScreenShell } from '../src/components/Screen';
import { useApi } from '../src/lib/useApi';
import { formatAUDate } from '../src/lib/format';

export default function Audit() {
  const { data, loading, refreshing, refresh } = useApi<{ items: any[] }>('/audit');
  const items = data?.items || [];
  return (
    <ScreenShell useBack title="Audit log" subtitle="Every privacy‑sensitive action on this account" loading={loading} onRefresh={refresh} refreshing={refreshing}>
      {items.length === 0 ? (
        <EmptyState
          icon="shield-checkmark-outline"
          title="Clean slate"
          body="This log records every sign‑in, document download, decoder run and amendment. Admin actions (impersonation, exports) are also captured."
        />
      ) : items.map((e, i) => (
        <ListCard key={e.id || i} title={e.action || 'Event'} subtitle={`${e.user_email || e.user_id || ''} · ${formatAUDate(e.created_at)}`} />
      ))}
    </ScreenShell>
  );
}
