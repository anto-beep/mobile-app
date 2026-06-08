import React from 'react';
import { EmptyState, ListCard, ScreenShell } from '../src/components/Screen';
import { useApi } from '../src/lib/useApi';

export default function Referrals() {
  const { data, loading, refreshing, refresh } = useApi<{ items: any[] }>('/referrals');
  const items = data?.items || [];
  return (
    <ScreenShell title="Referrals" subtitle="Wayly credit for inviting other families" loading={loading} onRefresh={refresh} refreshing={refreshing}>
      {items.length === 0 ? (
        <EmptyState
          icon="gift-outline"
          title="Share Wayly"
          body="Invite another family. They get 30 free days; you get account credit when they upgrade. Your link will appear here once enabled for your account."
        />
      ) : items.map((r) => (
        <ListCard key={r.id} title={r.email || 'Referral'} subtitle={r.status} />
      ))}
    </ScreenShell>
  );
}
