// ScenarioContext — schema + boundary-probe + event capture surface.
//
// Mounted under AuthProvider in app/_layout.tsx. Children get:
//   • schema           : the cached schema payload (null until first fetch resolves)
//   • schemaError      : string|null — surface a top-of-app banner if non-null
//   • majorMismatch    : boolean — hard upgrade required
//   • boundaryProbe(q) : Promise<{boundary, topic, contacts}>
//   • logEvent(pid, payload) : Promise<{event, alerts_emitted}>
//   • getTimeline(pid, limit?) / getAlerts(pid) / getEvents(pid)
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import { fetchSchema, isMajorMismatch, isVersionAtLeast, MIN_SCHEMA_VERSION, SchemaPayload, EventType, Workflow } from '../lib/scenarioSchema';

export type TimelineItem = {
  at: string;
  type: 'event' | 'state' | 'alert';
  data: any;
};

export type TimelineResponse = {
  first_name?: string;
  lifecycle_state?: string;
  items: TimelineItem[];
};

type Ctx = {
  schema: SchemaPayload | null;
  schemaError: string | null;
  schemaLoading: boolean;
  majorMismatch: boolean;
  minorBehind: boolean;
  refreshSchema: () => Promise<void>;
  boundaryProbe: (query: string) => Promise<{ boundary: 'SAFE_TO_EXPLAIN' | 'ROUTE_OUT' | 'ESCALATE'; topic?: string; contacts?: string[] }>;
  logEvent: (participantId: string, body: {
    event_type: string;
    effective_date?: string;
    trigger_source?: string;
    note?: string;
    payload?: Record<string, any>;
  }) => Promise<any>;
  getTimeline: (participantId: string, limit?: number) => Promise<TimelineResponse>;
  getAlerts: (participantId: string) => Promise<any[]>;
  getEvents: (participantId: string, limit?: number) => Promise<any[]>;
  // Convenience lookups against the schema
  getEventType: (key: string) => EventType | undefined;
  getContacts: (keys: string[]) => Array<{ key: string } & SchemaPayload['boundaries']['contacts'][string]>;
  getWorkflow: (key: string) => Workflow | undefined;
};

const ScenarioCtx = createContext<Ctx | null>(null);

export function ScenarioProvider({ children }: { children: React.ReactNode }) {
  const [schema, setSchema] = useState<SchemaPayload | null>(null);
  const [schemaError, setSchemaError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [majorMismatch, setMajor] = useState(false);
  const [minorBehind, setMinor] = useState(false);

  const refreshSchema = useCallback(async () => {
    setLoading(true);
    const r = await fetchSchema(true);
    if (r.schema) {
      setSchema(r.schema);
      setMajor(isMajorMismatch(r.schema.schema_version));
      setMinor(!isVersionAtLeast(r.schema.schema_version, MIN_SCHEMA_VERSION));
      setSchemaError(null);
    } else {
      setSchemaError(r.error || 'Could not load Wayly scenario engine');
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    (async () => {
      const r = await fetchSchema(false);
      if (r.schema) {
        setSchema(r.schema);
        setMajor(isMajorMismatch(r.schema.schema_version));
        setMinor(!isVersionAtLeast(r.schema.schema_version, MIN_SCHEMA_VERSION));
      } else {
        setSchemaError(r.error || 'Could not load scenario engine schema');
      }
      setLoading(false);
      // Network-refresh in the background to pick up label/blurb tweaks.
      if (r.from_cache) {
        try {
          const fresh = await fetchSchema(true);
          if (fresh.schema && fresh.schema.schema_version !== r.schema?.schema_version) {
            setSchema(fresh.schema);
          }
        } catch { /* keep cache */ }
      }
    })();
  }, []);

  const boundaryProbe = useCallback(async (query: string) => {
    try {
      const { data } = await api.post('/scenario/boundary-probe', { query });
      return data;
    } catch (e) {
      // Defensive: if the probe call fails, route-out by default. Never
      // let a transport error bypass the guardrail.
      return { boundary: 'ROUTE_OUT' as const, topic: 'probe_failed', contacts: ['my_aged_care'] };
    }
  }, []);

  const logEvent: Ctx['logEvent'] = useCallback(async (pid, body) => {
    const payload = {
      ...body,
      trigger_source: body.trigger_source || 'caregiver',
      source: { kind: 'mobile' },
    };
    const { data } = await api.post(`/scenario/participants/${pid}/events`, payload);
    return data;
  }, []);

  const getTimeline: Ctx['getTimeline'] = useCallback(async (pid, limit = 80) => {
    const { data } = await api.get(`/scenario/participants/${pid}/timeline`, { params: { limit } });
    return data;
  }, []);

  const getAlerts: Ctx['getAlerts'] = useCallback(async (pid) => {
    const { data } = await api.get(`/scenario/participants/${pid}/alerts`);
    return Array.isArray(data) ? data : (data?.items || []);
  }, []);

  const getEvents: Ctx['getEvents'] = useCallback(async (pid, limit = 50) => {
    const { data } = await api.get(`/scenario/participants/${pid}/events`, { params: { limit } });
    return Array.isArray(data) ? data : (data?.items || []);
  }, []);

  const getEventType: Ctx['getEventType'] = useCallback((key: string) => {
    if (!schema) return undefined;
    return schema.events.types.find((e) => e.key === key);
  }, [schema]);

  const getContacts: Ctx['getContacts'] = useCallback((keys: string[]) => {
    if (!schema) return [];
    const dir = schema.boundaries.contacts;
    return keys.map((k) => dir[k] ? { key: k, ...dir[k] } : null).filter(Boolean) as any;
  }, [schema]);

  const getWorkflow: Ctx['getWorkflow'] = useCallback((key: string) => {
    if (!schema) return undefined;
    return schema.workflows[key];
  }, [schema]);

  const value: Ctx = useMemo(() => ({
    schema, schemaError, schemaLoading: loading, majorMismatch, minorBehind, refreshSchema,
    boundaryProbe, logEvent, getTimeline, getAlerts, getEvents,
    getEventType, getContacts, getWorkflow,
  }), [schema, schemaError, loading, majorMismatch, minorBehind, refreshSchema, boundaryProbe, logEvent, getTimeline, getAlerts, getEvents, getEventType, getContacts, getWorkflow]);

  return <ScenarioCtx.Provider value={value}>{children}</ScenarioCtx.Provider>;
}

export function useScenario(): Ctx {
  const ctx = useContext(ScenarioCtx);
  if (!ctx) throw new Error('useScenario must be used inside ScenarioProvider');
  return ctx;
}
