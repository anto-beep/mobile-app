import React from 'react';
import { EmptyState, ListCard, ScreenShell } from '../src/components/Screen';
import { useApi } from '../src/lib/useApi';

export default function ProviderSwitch() {
  const { data, loading, refreshing, refresh } = useApi<any>('/provider-switch/status');
  return (
    <ScreenShell title="Switch provider" subtitle="Move services to a new aged‑care provider" loading={loading} onRefresh={refresh} refreshing={refreshing}>
      {!data?.in_progress ? (
        <EmptyState
          icon="swap-horizontal-outline"
          title={`Currently with ${data?.current_provider || 'your provider'}`}
          body="Start a switch when you're ready. Wayly will guide you through the notice period, file the paperwork, and track unbilled hours."
        />
      ) : <ListCard title={`Switching to ${data.new_provider || 'new provider'}`} subtitle={`Status: ${data.status}`} />}
    </ScreenShell>
  );
}
