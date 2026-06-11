// Scenario Engine schema fetcher + cache (Phase A foundation).
//
// Contract per MOBILE_AGENT_SCENARIO_ENGINE_HANDOFF.md §3:
//   • GET /scenario/schema is PUBLIC (no auth)
//   • schema_version pinned at MIN_VERSION; major-bump = refuse to render
//   • Minor bump = additive; render unknown enums verbatim
//   • Cache for 1 hour by default; HEAD/conditional refresh on launch
//
// Storage: AsyncStorage key `wayly:scenario_schema_v1`
//   { fetched_at: epoch_ms, payload: SchemaPayload }
//
// This module is intentionally framework-free (no React) so it can be
// imported by both ScenarioContext.tsx AND non-React utilities.
import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';

const CACHE_KEY = 'wayly:scenario_schema_v1';
const CACHE_MAX_AGE_MS = 60 * 60 * 1_000;
export const MIN_SCHEMA_VERSION = '1.0.0';
export const MAX_MAJOR = 1;

const BASE = process.env.EXPO_PUBLIC_BACKEND_URL || '';

export type Contact = {
  label: string;
  phone: string;
  tel_link: string;
  hours?: string;
  blurb?: string;
};

export type EventType = {
  key: string;
  label: string;
  category: string | null;
  affects: string[];
  transition: string | null;
  flag_changes: any[];
  payload_keys: any[];
};

export type AlertTypeMeta = {
  severity: 'info' | 'low' | 'medium' | 'high' | 'critical';
  axis: string;
};

export type WorkflowStep = {
  key?: string;
  title?: string;
  body?: string;
  cta?: string;
  event_type?: string | null;
  payload_fields?: Array<{ key: string; label: string; type: 'text' | 'number' | 'date' | 'select'; options?: string[]; placeholder?: string; required?: boolean }>;
};

export type Workflow = {
  key: string;
  label: string;
  intro: string;
  advice_boundary: 'SAFE_TO_EXPLAIN' | 'ROUTE_OUT' | 'ESCALATE';
  route_out_contacts?: string[];
  follow_up?: string;
  steps: WorkflowStep[];
};

export type SchemaPayload = {
  schema_version: string;
  section_revisions: Record<string, string>;
  lifecycle: {
    states: string[];
    initial_states: string[];
    terminal_states: string[];
    allowed_transitions: Record<string, string[]>;
  };
  flags: {
    groups: Record<string, string[]>;
    all_flags: string[];
    payload_keys: Record<string, string[]>;
    mutual_exclusion: string[][];
    restricted_flags: string[];
  };
  events: {
    trigger_sources: string[];
    types: EventType[];
  };
  alerts: {
    severities: string[];
    axes: string[];
    types: Record<string, AlertTypeMeta>;
  };
  boundaries: {
    levels: string[];
    contacts: Record<string, Contact>;
    event_advice_boundary: Record<string, { level: string; contact_keys: string[] }>;
    alert_advice_boundary: Record<string, { level: string; contact_keys: string[] }>;
  };
  workflows: Record<string, Workflow>;
};

export type CacheEnvelope = { fetched_at: number; payload: SchemaPayload };

async function readCache(): Promise<CacheEnvelope | null> {
  try {
    const raw = await AsyncStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as CacheEnvelope;
  } catch {
    return null;
  }
}

async function writeCache(payload: SchemaPayload): Promise<void> {
  try {
    await AsyncStorage.setItem(
      CACHE_KEY,
      JSON.stringify({ fetched_at: Date.now(), payload } as CacheEnvelope),
    );
  } catch { /* best-effort */ }
}

export function isVersionAtLeast(v: string, min: string): boolean {
  const a = v.split('.').map((n) => parseInt(n, 10));
  const b = min.split('.').map((n) => parseInt(n, 10));
  for (let i = 0; i < 3; i += 1) {
    if ((a[i] || 0) > (b[i] || 0)) return true;
    if ((a[i] || 0) < (b[i] || 0)) return false;
  }
  return true;
}

export function isMajorMismatch(v: string): boolean {
  const major = parseInt(v.split('.')[0] || '0', 10);
  return major > MAX_MAJOR;
}

export async function fetchSchema(forceNetwork = false): Promise<{ schema: SchemaPayload | null; from_cache: boolean; error?: string }> {
  // 1) Try cache first if not forcing a refresh
  if (!forceNetwork) {
    const cached = await readCache();
    if (cached && Date.now() - cached.fetched_at < CACHE_MAX_AGE_MS) {
      return { schema: cached.payload, from_cache: true };
    }
  }
  // 2) Hit the network
  try {
    const { data } = await axios.get<SchemaPayload>(`${BASE}/api/scenario/schema`, { timeout: 15_000 });
    if (!data?.schema_version) return { schema: null, from_cache: false, error: 'Malformed schema response' };
    await writeCache(data);
    return { schema: data, from_cache: false };
  } catch (e: any) {
    // 3) Network failed: serve any cached copy if we have one (even if stale)
    const cached = await readCache();
    if (cached) {
      return { schema: cached.payload, from_cache: true, error: e?.message };
    }
    return { schema: null, from_cache: false, error: e?.message || 'Schema fetch failed' };
  }
}

// Severity → colour palette per §6.2 of handoff doc.
export function severityPalette(severity: string | null | undefined): { fg: string; bg: string; border: string } {
  switch ((severity || '').toLowerCase()) {
    case 'critical': return { fg: '#7A2210', bg: '#FDE8E2', border: '#A5512B' };
    case 'high':     return { fg: '#5C3D11', bg: '#FAEFD4', border: '#E8A845' };
    case 'medium':   return { fg: '#5C3D11', bg: '#FFF7DC', border: '#D7B26B' };
    case 'low':
    case 'info':
    default:         return { fg: '#3F3A33', bg: '#EFEAE0', border: '#C8BFAE' };
  }
}

// Lifecycle state → colour per §6.4.
export function lifecyclePalette(state: string | null | undefined): { fg: string; bg: string } {
  const s = (state || '').toUpperCase();
  if (['ACTIVE', 'RESTORATIVE', 'INTERIM_FUNDED'].includes(s)) return { fg: '#0E4D52', bg: '#D4E8E6' };
  if (['HOSPITALISED', 'END_OF_LIFE'].includes(s)) return { fg: '#5C3D11', bg: '#FAEFD4' };
  if (['DECEASED', 'REMOVED'].includes(s)) return { fg: '#3F3A33', bg: '#E0D9C9' };
  return { fg: '#3F3A33', bg: '#EFEAE0' };
}

// Map web `next_action_link` paths → native router paths per §7.
export function mapWebPathToNative(webPath: string | null | undefined): string | null {
  if (!webPath) return null;
  const p = webPath.replace(/^https?:\/\/[^/]+/i, '');
  // /app/participants/{id}/timeline
  const partTl = p.match(/^\/app\/participants\/([^/]+)\/timeline$/);
  if (partTl) return `/participants/${partTl[1]}/timeline`;
  // /app/statements/{id}
  const stmt = p.match(/^\/app\/statements\/([^/]+)$/);
  if (stmt) return `/statements/${stmt[1]}`;
  const table: Record<string, string> = {
    '/app/budget-alerts': '/budget-alerts',
    '/app/statements': '/(tabs)/statements',
    '/app/scenarios': '/log-scenario',
    '/app/timeline': '/timeline',
    '/app/participants': '/participants',
  };
  return table[p] || null;
}
