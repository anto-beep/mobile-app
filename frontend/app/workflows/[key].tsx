// Workflow wizard — renders one workflow's steps end-to-end.
// Each step may carry an `event_type` + payload_fields; on Continue we POST
// through /scenario/participants/{id}/events. The Death workflow surfaces
// the route_out_contacts block prominently in the ESCALATE style.
import React, { useEffect, useMemo, useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import BackHeader from '../../src/components/BackHeader';
import { useScenario } from '../../src/context/ScenarioContext';
import { useParticipants } from '../../src/context/ParticipantsContext';
import { ContactCard } from '../../src/components/Timeline';
import { Fonts, Radius, Spacing, Type } from '../../src/lib/theme';
import type { ColorPalette } from '../../src/lib/theme';
import { useColors } from '../../src/hooks/useColors';
import { useThemedStyles } from '../../src/hooks/useThemedStyles';
import { toast } from '../../src/components/Toast';
import { EmptyState } from '../../src/components/Screen';

export default function WorkflowRunner() {
  const c = useColors();
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const { key } = useLocalSearchParams<{ key: string }>();
  const { active } = useParticipants();
  const { getWorkflow, logEvent } = useScenario();
  const wf = getWorkflow(String(key || ''));
  const [step, setStep] = useState(0);
  const [payload, setPayload] = useState<Record<string, string>>({});
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [busy, setBusy] = useState(false);
  const isEscalate = wf?.advice_boundary === 'ESCALATE';

  useEffect(() => { setStep(0); setPayload({}); }, [key]);

  if (!wf) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <BackHeader title="Workflow" />
        <EmptyState icon="compass-outline" title="Workflow not found" body="This workflow isn't in the current catalogue." cta={{ label: 'All workflows', onPress: () => router.replace('/workflows' as any) }} />
      </SafeAreaView>
    );
  }
  if (!active) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <BackHeader title={wf.label} />
        <EmptyState icon="people-outline" title="Pick a participant" body="Choose the participant this workflow applies to." cta={{ label: 'Participants', onPress: () => router.push('/participants' as any) }} />
      </SafeAreaView>
    );
  }

  const steps = wf.steps || [];
  const current = steps[step] || null;
  const total = steps.length;
  const last = step >= total - 1;

  async function advance() {
    if (!current) { router.replace('/timeline' as any); return; }
    setBusy(true);
    try {
      if (current.event_type) {
        const fields = current.payload_fields || [];
        const p: Record<string, any> = {};
        for (const f of fields) {
          if (f.required && !payload[f.key]) { Alert.alert(`${f.label} is required`); setBusy(false); return; }
          if (payload[f.key]) p[f.key] = payload[f.key];
        }
        await logEvent(active.id, {
          event_type: current.event_type, effective_date: date,
          payload: Object.keys(p).length ? p : undefined,
        });
        toast.success(`Step ${step + 1} captured`);
      }
      if (last) {
        router.replace('/timeline' as any);
        return;
      }
      setStep((n) => n + 1);
      setPayload({});
    } catch (e: any) {
      Alert.alert('Could not record step', e?.response?.data?.detail || e?.message);
    } finally { setBusy(false); }
  }

  const contactKeys = wf.route_out_contacts || [];

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <BackHeader title={wf.label} />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ padding: Spacing.md, paddingBottom: 100, gap: 12 }} keyboardShouldPersistTaps="handled">
          {/* Progress dots */}
          <View style={styles.dots} testID={`workflow-${wf.key}-progress`}>
            {steps.map((_, i) => (
              <View key={i} style={[styles.dot, i <= step && (isEscalate ? { backgroundColor: '#A5512B' } : { backgroundColor: c.brandPrimary })]} />
            ))}
          </View>
          <Text style={[Type.h2 as any, isEscalate && { color: '#7A2210' }]}>{current?.title || `Step ${step + 1}`}</Text>
          {step === 0 && !!wf.intro && <Text style={styles.intro}>{wf.intro}</Text>}
          {!!current?.body && <Text style={styles.body}>{current.body}</Text>}

          {isEscalate && contactKeys.length > 0 && (
            <ContactCard boundary="ESCALATE" contactKeys={contactKeys} followUp={wf.follow_up} />
          )}

          {current?.event_type && (
            <View style={{ gap: 10, marginTop: 6 }}>
              <Text style={styles.lbl}>Effective date</Text>
              <TextInput value={date} onChangeText={setDate} placeholder="YYYY-MM-DD" placeholderTextColor={c.textMuted} style={styles.input} />
              {(current.payload_fields || []).map((f) => (
                <View key={f.key} style={{ gap: 4 }}>
                  <Text style={styles.lbl}>{f.label}{f.required ? ' *' : ''}</Text>
                  <TextInput
                    value={payload[f.key] || ''}
                    onChangeText={(v) => setPayload((p) => ({ ...p, [f.key]: v }))}
                    placeholder={f.placeholder || f.label}
                    placeholderTextColor={c.textMuted}
                    style={styles.input}
                    keyboardType={f.type === 'number' ? 'number-pad' : 'default'}
                    testID={`wf-field-${f.key}`}
                  />
                </View>
              ))}
            </View>
          )}

          <TouchableOpacity
            onPress={advance}
            disabled={busy}
            style={[styles.cta, isEscalate && styles.ctaEscalate, busy && { opacity: 0.6 }]}
            testID={`workflow-${wf.key}-continue`}
          >
            <Text style={styles.ctaText}>{busy ? 'Saving…' : (current?.cta || (last ? 'Finish' : 'Continue'))}</Text>
            {!last && <Ionicons name="arrow-forward" size={16} color="#fff" />}
          </TouchableOpacity>
          {step > 0 && (
            <TouchableOpacity onPress={() => setStep((n) => Math.max(0, n - 1))} style={styles.back}>
              <Text style={styles.backText}>Back</Text>
            </TouchableOpacity>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
function makeStyles(c: ColorPalette) { return StyleSheet.create({
  safe: { flex: 1, backgroundColor: c.bg },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: 6, marginVertical: 6 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: c.border },
  intro: { ...Type.body, color: c.textSecondary, lineHeight: 23 },
  body: { ...Type.body, color: c.textPrimary, lineHeight: 23 },
  lbl: { ...Type.caption, color: c.textSecondary, fontFamily: Fonts.bodySemi, textTransform: 'uppercase', letterSpacing: 0.6 },
  input: { borderWidth: 1, borderColor: c.border, borderRadius: 10, padding: 12, fontFamily: Fonts.body, color: c.textPrimary },
  cta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 14, borderRadius: 9999, backgroundColor: c.brandPrimary, marginTop: 8 },
  ctaEscalate: { backgroundColor: '#A5512B' },
  ctaText: { color: '#fff', fontFamily: Fonts.bodySemi, fontWeight: '700', fontSize: 15 },
  back: { alignItems: 'center', paddingVertical: 10 },
  backText: { color: c.textSecondary, fontFamily: Fonts.bodySemi, fontWeight: '700' },
}); }
