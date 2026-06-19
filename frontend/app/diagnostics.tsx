// Diagnostics screen — a single tap shows which backend the app is talking to,
// whether the scenario engine is reachable, schema version, contact-count, and
// the rate-limit posture of /api/auth/login. Reach via More → bottom or
// /diagnostics deep link.
//
// Why: when the team flips the API origin or schema version, the first
// "is it working?" question is "is mobile actually hitting the right host?"
// This screen answers that in 2 seconds without dev tools.
import React, { useEffect, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Application from 'expo-application';
import { Ionicons } from '@expo/vector-icons';
import BackHeader from '../src/components/BackHeader';
import { Fonts, Radius, Spacing, Type } from '../src/lib/theme';
import type { ColorPalette } from '../src/lib/theme';
import { useColors } from '../src/hooks/useColors';
import { useThemedStyles } from '../src/hooks/useThemedStyles';
import { useScenario } from '../src/context/ScenarioContext';
import { useAuth } from '../src/context/AuthContext';
import { api } from '../src/lib/api';
import { MIN_SCHEMA_VERSION } from '../src/lib/scenarioSchema';

const BACKEND = process.env.EXPO_PUBLIC_BACKEND_URL || '(unset)';

type Probe = { label: string; status: 'ok' | 'fail' | 'busy' | 'idle'; detail?: string };

export default function Diagnostics() {
  const c = useColors();
  const styles = useThemedStyles(makeStyles);
  const { schema, schemaError, majorMismatch, refreshSchema } = useScenario();
  const { user } = useAuth();
  const [probes, setProbes] = useState<Probe[]>([
    { label: 'GET /scenario/schema', status: 'idle' },
    { label: 'GET /account', status: 'idle' },
    { label: 'POST /scenario/boundary-probe', status: 'idle' },
  ]);

  async function runProbes() {
    setProbes((p) => p.map((x) => ({ ...x, status: 'busy' })));
    const next: Probe[] = [];

    // 1. schema (public)
    try {
      const r = await fetch(`${BACKEND}/api/scenario/schema`, { method: 'GET' });
      next.push({ label: 'GET /scenario/schema', status: r.ok ? 'ok' : 'fail', detail: `HTTP ${r.status}` });
    } catch (e: any) {
      next.push({ label: 'GET /scenario/schema', status: 'fail', detail: e?.message || 'network error' });
    }
    // 2. /account (auth)
    try {
      const { data, status } = await api.get('/account');
      const parts = (data?.participants ?? data?.account?.participants ?? []).length;
      next.push({ label: 'GET /account', status: 'ok', detail: `${status} · ${parts} participant(s)` });
    } catch (e: any) {
      const s = e?.response?.status;
      next.push({ label: 'GET /account', status: 'fail', detail: s ? `HTTP ${s}` : (e?.message || 'failed') });
    }
    // 3. boundary-probe (auth, harmless query)
    try {
      const { data, status } = await api.post('/scenario/boundary-probe', { query: 'How do I read this statement?' });
      next.push({ label: 'POST /scenario/boundary-probe', status: 'ok', detail: `${status} · ${data?.boundary || 'no-boundary'}` });
    } catch (e: any) {
      const s = e?.response?.status;
      next.push({ label: 'POST /scenario/boundary-probe', status: 'fail', detail: s ? `HTTP ${s}` : (e?.message || 'failed') });
    }
    setProbes(next);
  }

  useEffect(() => { void runProbes(); }, [user?.id]);

  const versionRow = schema
    ? `${schema.schema_version}  (min ${MIN_SCHEMA_VERSION})`
    : (schemaError ? `error · ${schemaError}` : 'loading…');
  const contactCount = schema ? Object.keys(schema.boundaries.contacts).length : 0;
  const workflowCount = schema ? Object.keys(schema.workflows).length : 0;
  const eventCount = schema ? schema.events.types.length : 0;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <BackHeader title="Diagnostics" />
      <ScrollView contentContainerStyle={{ padding: Spacing.md, paddingBottom: 60, gap: Spacing.md }}>
        <Block title="App">
          <Row k="Build" v={`${Application.applicationName || 'Wayly'} · v${Application.nativeApplicationVersion || '0.0.0'}`} />
          <Row k="Backend" v={BACKEND} mono />
          <Row k="Signed in as" v={user?.email || '(anonymous)'} />
        </Block>
        <Block title="Scenario engine">
          <Row k="schema_version" v={versionRow} mono />
          <Row k="Event types" v={String(eventCount)} />
          <Row k="Workflows" v={String(workflowCount)} />
          <Row k="Contacts" v={String(contactCount)} />
          {majorMismatch && <Text style={styles.warn}>Major version ahead — update required.</Text>}
        </Block>
        <Block title="Live probes">
          {probes.map((p) => (
            <View key={p.label} style={styles.probeRow}>
              <Ionicons
                name={p.status === 'ok' ? 'checkmark-circle' : p.status === 'fail' ? 'close-circle' : 'time-outline'}
                size={16}
                color={p.status === 'ok' ? '#0E4D52' : p.status === 'fail' ? '#A5512B' : c.textMuted}
              />
              <Text style={styles.probeLabel}>{p.label}</Text>
              <Text style={styles.probeDetail}>{p.detail || ''}</Text>
            </View>
          ))}
          <TouchableOpacity style={styles.btn} onPress={runProbes} testID="diagnostics-rerun">
            <Ionicons name="refresh" size={14} color="#fff" />
            <Text style={styles.btnText}>Re-run probes</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.btn, styles.btnGhost]} onPress={async () => { await refreshSchema(); Alert.alert('Schema refreshed', `Version ${schema?.schema_version || '?'}`); }} testID="diagnostics-refresh-schema">
            <Text style={styles.btnGhostText}>Refresh schema</Text>
          </TouchableOpacity>
        </Block>
      </ScrollView>
    </SafeAreaView>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.card}>
      <Text style={styles.title}>{title}</Text>
      <View style={styles.body}>{children}</View>
    </View>
  );
}

function Row({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <View style={styles.row}>
      <Text style={styles.k}>{k}</Text>
      <Text style={[styles.v, mono && { fontFamily: Fonts.mono }]} numberOfLines={2}>{v}</Text>
    </View>
  );
}

function makeStyles(c: ColorPalette) { return StyleSheet.create({
  safe: { flex: 1, backgroundColor: c.bg },
  card: { backgroundColor: c.cardBg, borderWidth: 1, borderColor: c.border, borderRadius: Radius.lg, padding: Spacing.md },
  title: { ...Type.bodySemi, color: c.textPrimary, marginBottom: 8 },
  body: { gap: 6 },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  k: { ...Type.caption, color: c.textMuted, fontFamily: Fonts.bodySemi },
  v: { ...Type.caption, color: c.textPrimary, fontFamily: Fonts.bodyMed, flexShrink: 1, textAlign: 'right' },
  probeRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  probeLabel: { ...Type.caption, color: c.textPrimary, fontFamily: Fonts.bodyMed, flex: 1 },
  probeDetail: { ...Type.caption, color: c.textSecondary },
  btn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: c.brandPrimary, paddingVertical: 10, borderRadius: 9999, marginTop: 6 },
  btnText: { color: '#fff', fontFamily: Fonts.bodySemi, fontWeight: '700' },
  btnGhost: { backgroundColor: 'transparent', borderWidth: 1.5, borderColor: c.brandPrimary },
  btnGhostText: { color: c.brandPrimary, fontFamily: Fonts.bodySemi, fontWeight: '700' },
  warn: { ...Type.caption, color: '#A5512B', fontFamily: Fonts.bodySemi, marginTop: 4 },
}); }
