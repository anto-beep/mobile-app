import React from 'react';
import { EmptyState, ListCard, ScreenShell } from '../src/components/Screen';
import { useApi } from '../src/lib/useApi';

export default function Hospital() {
  const { data, loading, refreshing, refresh } = useApi<any>('/hospital/handover');
  const empty = !data || (!data.summary && !(data.medications || []).length);
  return (
    <ScreenShell title="Hospital handover" subtitle="What an ED triage nurse needs in 30 seconds" loading={loading} onRefresh={refresh} refreshing={refreshing}>
      {empty ? (
        <EmptyState
          icon="medkit-outline"
          title="Build the handover sheet"
          body="Capture medications, allergies, emergency contacts and a 1‑paragraph summary. Generate a one‑page PDF you can hand to any clinician."
        />
      ) : (
        <>
          {!!data.summary && <ListCard title="Summary" subtitle={data.summary} />}
          {(data.medications || []).map((m: any, i: number) => (
            <ListCard key={`m-${i}`} title={m.name || 'Medication'} subtitle={m.dose} />
          ))}
        </>
      )}
    </ScreenShell>
  );
}
