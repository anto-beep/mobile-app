// Workflow Runner — /workflows/[key]
//
// Mirrors the web app's Guided Workflow layout exactly:
//
//   ┌──────────────────────────────────────────────────────────┐
//   │  WORKFLOW                            [⇄ Switch Workflow]  │
//   │  Request a reassessment                            Close  │
//   │                                                          │
//   │  ● 1 — ○ 2 — ○ 3                                         │
//   │                                                          │
//   │  ┌───────────────────────────── tinted step card ─────┐  │
//   │  │  Step 1 · Log the reassessment request              │  │
//   │  │  Record the date you contacted My Aged Care …       │  │
//   │  │  <How was it lodged?>  [Choose…  ▾]                 │  │
//   │  │  <My Aged Care reference (optional)> [_______]      │  │
//   │  │                                                     │  │
//   │  │  Step 1 of 3                          [Log this →] │  │
//   │  └─────────────────────────────────────────────────────┘  │
//   └──────────────────────────────────────────────────────────┘
//
// All step copy, event_types and payload_fields come from
// GET /api/scenario/schema.workflows so we don't hard-code any wording here.
import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView,
  StyleSheet, Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { WaylyHeader } from '../../src/components/WaylyHeader';
import { useScenario } from '../../src/context/ScenarioContext';
import { useParticipants } from '../../src/context/ParticipantsContext';
import { ContactCard } from '../../src/components/Timeline';
import { Fonts, Spacing } from '../../src/lib/theme';
import type { ColorPalette } from '../../src/lib/theme';
import { useColors } from '../../src/hooks/useColors';
import { useThemedStyles } from '../../src/hooks/useThemedStyles';
import { toast } from '../../src/components/Toast';
import { EmptyState } from '../../src/components/Screen';

const WORKFLOW_KEYS = ['reassessment', 'hospitalisation', 'death'] as const;

function todayISO(): string {
  const d = new Date();
  const pad = (n: number) => (n < 10 ? `0${n}` : String(n));
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function isoToDDMMYYYY(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
}
function ddmmyyyyToIso(txt: string): string | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(txt.trim());
  if (!m) return null;
  const [, dd, mm, yyyy] = m;
  const d = new Date(Number(yyyy), Number(mm) - 1, Number(dd));
  return Number.isNaN(d.getTime()) ? null : `${yyyy}-${mm}-${dd}`;
}

// Bottom-sheet select — kept local to keep the workflow runner self-contained.
function InlineSelect({
  label, value, options, placeholder, onChange, testID,
}: {
  label: string;
  value: string;
  options: string[];
  placeholder: string;
  onChange: (v: string) => void;
  testID?: string;
}) {
  const styles = useThemedStyles(makeStyles);
  const [open, setOpen] = useState(false);
  const c = useColors();
  return (
    <View style={{ gap: 6 }}>
      <Text style={styles.fieldLbl}>{label}</Text>
      <TouchableOpacity onPress={() => setOpen(true)} style={styles.selectBtn} activeOpacity={0.75} testID={testID}>
        <Text style={value ? styles.selectText : styles.selectPlaceholder}>{value || placeholder}</Text>
        <Ionicons name="chevron-down" size={18} color={c.textMuted} />
      </TouchableOpacity>
      <Modal transparent visible={open} animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.pickerBackdrop} onPress={() => setOpen(false)}>
          <Pressable style={styles.pickerSheet} onPress={() => { /* eat */ }}>
            <View style={styles.pickerHead}>
              <Text style={styles.pickerTitle}>{label}</Text>
              <TouchableOpacity onPress={() => setOpen(false)} hitSlop={8}>
                <Ionicons name="close" size={22} color={c.textPrimary} />
              </TouchableOpacity>
            </View>
            <ScrollView style={{ maxHeight: 380 }}>
              {options.map((o) => (
                <TouchableOpacity
                  key={o}
                  onPress={() => { onChange(o); setOpen(false); }}
                  style={[styles.pickerRow, o === value && styles.pickerRowActive]}
                >
                  <Text style={[styles.pickerRowText, o === value && styles.pickerRowTextActive]}>{o}</Text>
                  {o === value && <Ionicons name="checkmark" size={16} color={c.brandPrimary} />}
                </TouchableOpacity>
              ))}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

export default function WorkflowRunner() {
  const c = useColors();
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const { key } = useLocalSearchParams<{ key: string }>();
  const { active } = useParticipants();
  const { schema, getWorkflow, logEvent } = useScenario();
  const wf = getWorkflow(String(key || ''));
  const [step, setStep] = useState(0);
  const [payload, setPayload] = useState<Record<string, string>>({});
  const [dateIso, setDateIso] = useState(() => todayISO());
  const [dateText, setDateText] = useState(() => isoToDDMMYYYY(todayISO()));
  const [busy, setBusy] = useState(false);
  const [switchOpen, setSwitchOpen] = useState(false);

  useEffect(() => { setStep(0); setPayload({}); }, [key]);

  const steps = wf?.steps || [];
  const current = steps[step] || null;
  const total = steps.length;
  const last = step >= total - 1;

  const otherWorkflows = useMemo(() => {
    return WORKFLOW_KEYS
      .filter((k) => k !== key && schema?.workflows?.[k])
      .map((k) => ({ key: k, label: schema!.workflows[k].label }));
  }, [schema, key]);

  if (!wf) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <WaylyHeader />
        <EmptyState
          icon="compass-outline"
          title="Workflow not found"
          body="This workflow is not in the current catalogue."
          cta={{ label: 'Back to scenarios', onPress: () => router.replace('/log-scenario' as any) }}
        />
      </SafeAreaView>
    );
  }
  if (!active) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <WaylyHeader />
        <EmptyState
          icon="people-outline"
          title="Pick a participant"
          body="Choose the participant this workflow applies to."
          cta={{ label: 'Participants', onPress: () => router.push('/participants' as any) }}
        />
      </SafeAreaView>
    );
  }

  const onDateChange = (t: string) => {
    setDateText(t);
    const iso = ddmmyyyyToIso(t);
    if (iso) setDateIso(iso);
  };

  async function advance() {
    if (!current) { router.replace('/log-scenario' as any); return; }
    setBusy(true);
    try {
      if (current.event_type) {
        const fields = current.payload_fields || [];
        const p: Record<string, any> = {};
        for (const f of fields) {
          const raw = payload[f.key];
          if (f.required && !raw) { Alert.alert(`${f.label} is required`); setBusy(false); return; }
          if (raw) p[f.key] = raw;
        }
        await logEvent(active!.id, {
          event_type: current.event_type,
          effective_date: dateIso,
          payload: Object.keys(p).length ? p : undefined,
        });
        toast.success(`Step ${step + 1} captured`);
      }
      if (last) {
        toast.success('Workflow complete');
        router.replace('/log-scenario' as any);
        return;
      }
      setStep((n) => n + 1);
      setPayload({});
    } catch (e: any) {
      Alert.alert('Could not record step', e?.response?.data?.detail || e?.message);
    } finally { setBusy(false); }
  }

  const contactKeys = wf.route_out_contacts || [];
  const isEscalate = wf.advice_boundary === 'ESCALATE';

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <WaylyHeader />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ padding: Spacing.md, paddingBottom: 100, gap: Spacing.md }} keyboardShouldPersistTaps="handled">
          {/* Top row: WORKFLOW label + title, Switch Workflow + Close */}
          <View style={styles.topRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.overline}>Workflow</Text>
              <Text style={styles.h1}>{wf.label}</Text>
            </View>
            <View style={styles.topActions}>
              {otherWorkflows.length > 0 && (
                <TouchableOpacity
                  style={styles.switchBtn}
                  onPress={() => setSwitchOpen(true)}
                  activeOpacity={0.75}
                  testID="workflow-switch-btn"
                >
                  <Ionicons name="swap-horizontal" size={14} color={c.brandPrimary} />
                  <Text style={styles.switchBtnText}>Switch Workflow</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity
                onPress={() => router.replace('/log-scenario' as any)}
                hitSlop={8}
                testID="workflow-close-btn"
              >
                <Text style={styles.closeText}>Close</Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Step chip nav */}
          <View style={styles.chipRow} testID={`workflow-${wf.key}-progress`}>
            {steps.map((_, i) => (
              <TouchableOpacity
                key={i}
                onPress={() => i <= step && setStep(i)}
                style={[styles.stepChip, i === step && styles.stepChipActive, i < step && styles.stepChipDone]}
                activeOpacity={0.75}
              >
                <Text style={[styles.stepChipText, (i === step || i < step) && styles.stepChipTextActive]}>{i + 1}</Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* Tinted step card */}
          <View style={styles.stepCard}>
            <Text style={styles.stepTitle}>{current?.title || `Step ${step + 1}`}</Text>
            {!!current?.body && <Text style={styles.stepBody}>{current.body}</Text>}
            {step === 0 && !!wf.intro && !current?.body && <Text style={styles.stepBody}>{wf.intro}</Text>}

            {isEscalate && contactKeys.length > 0 && (
              <ContactCard boundary="ESCALATE" contactKeys={contactKeys} followUp={wf.follow_up} />
            )}

            {current?.event_type && (
              <View style={{ gap: 12, marginTop: 6 }}>
                <View style={{ gap: 6 }}>
                  <Text style={styles.fieldLbl}>Date</Text>
                  <View style={styles.dateFieldRow}>
                    <TextInput
                      value={dateText}
                      onChangeText={onDateChange}
                      placeholder="DD/MM/YYYY"
                      placeholderTextColor={c.textMuted}
                      style={styles.dateInput}
                      keyboardType="number-pad"
                      testID={`wf-date-${wf.key}`}
                    />
                    <Ionicons name="calendar-outline" size={18} color={c.textMuted} />
                  </View>
                </View>
                {(current.payload_fields || []).map((f) => (
                  <View key={f.key} style={{ gap: 6 }}>
                    {f.type === 'select' ? (
                      <InlineSelect
                        label={f.label + (f.required ? '' : ' (optional)')}
                        value={payload[f.key] || ''}
                        options={f.options || []}
                        placeholder="Choose…"
                        onChange={(v) => setPayload((p) => ({ ...p, [f.key]: v }))}
                        testID={`wf-field-${f.key}`}
                      />
                    ) : (
                      <>
                        <Text style={styles.fieldLbl}>{f.label}{f.required ? '' : ' (optional)'}</Text>
                        <TextInput
                          value={payload[f.key] || ''}
                          onChangeText={(v) => setPayload((p) => ({ ...p, [f.key]: v }))}
                          placeholder={f.placeholder || ''}
                          placeholderTextColor={c.textMuted}
                          style={styles.textInput}
                          keyboardType={f.type === 'number' ? 'number-pad' : 'default'}
                          testID={`wf-field-${f.key}`}
                        />
                      </>
                    )}
                  </View>
                ))}
              </View>
            )}

            {/* Step footer */}
            <View style={styles.stepFooter}>
              <Text style={styles.stepCounter}>Step {step + 1} of {total}</Text>
              <TouchableOpacity
                onPress={advance}
                disabled={busy}
                style={[styles.primaryBtn, isEscalate && styles.primaryBtnEscalate, busy && { opacity: 0.6 }]}
                testID={`workflow-${wf.key}-continue`}
                activeOpacity={0.85}
              >
                <Text style={styles.primaryBtnText}>{busy ? 'Saving…' : (current?.cta || (last ? 'Finish' : 'Log this'))}</Text>
                {!last && <Ionicons name="arrow-forward" size={14} color="#FFFFFF" />}
              </TouchableOpacity>
            </View>
            {step > 0 && (
              <TouchableOpacity onPress={() => setStep((n) => Math.max(0, n - 1))} style={styles.backLink}>
                <Ionicons name="chevron-back" size={14} color={c.textSecondary} />
                <Text style={styles.backLinkText}>Back a step</Text>
              </TouchableOpacity>
            )}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>

      {/* Switch Workflow sheet */}
      <Modal transparent visible={switchOpen} animationType="fade" onRequestClose={() => setSwitchOpen(false)}>
        <Pressable style={styles.pickerBackdrop} onPress={() => setSwitchOpen(false)}>
          <Pressable style={styles.pickerSheet} onPress={() => { /* eat */ }}>
            <View style={styles.pickerHead}>
              <Text style={styles.pickerTitle}>Switch Workflow</Text>
              <TouchableOpacity onPress={() => setSwitchOpen(false)} hitSlop={8}>
                <Ionicons name="close" size={22} color={c.textPrimary} />
              </TouchableOpacity>
            </View>
            {otherWorkflows.map((w) => (
              <TouchableOpacity
                key={w.key}
                style={styles.pickerRow}
                onPress={() => { setSwitchOpen(false); router.replace({ pathname: '/workflows/[key]', params: { key: w.key } } as any); }}
              >
                <Text style={styles.pickerRowText}>{w.label}</Text>
                <Ionicons name="chevron-forward" size={16} color={c.textMuted} />
              </TouchableOpacity>
            ))}
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

function makeStyles(c: ColorPalette) { return StyleSheet.create({
  safe: { flex: 1, backgroundColor: c.background },

  topRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 },
  topActions: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  overline: { fontFamily: Fonts.bodyMed, fontSize: 11, letterSpacing: 1.4, textTransform: 'uppercase', color: c.textMuted },
  h1: { fontFamily: Fonts.heading, fontSize: 24, color: c.brandPrimary, letterSpacing: -0.3, lineHeight: 30, marginTop: 2 },

  switchBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 12, paddingVertical: 7, borderRadius: 9999,
    borderWidth: 1, borderColor: c.borderSubtle, backgroundColor: c.cardBg,
  },
  switchBtnText: { fontFamily: Fonts.bodySemi, fontSize: 12, color: c.brandPrimary },
  closeText: { fontFamily: Fonts.bodySemi, fontSize: 13, color: c.textSecondary, textDecorationLine: 'underline' },

  chipRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 4 },
  stepChip: {
    width: 26, height: 26, borderRadius: 13,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: c.surfaceTint, borderWidth: 1, borderColor: c.borderSubtle,
  },
  stepChipActive: { backgroundColor: c.brandPrimary, borderColor: c.brandPrimary },
  stepChipDone: { backgroundColor: c.brandPrimary, borderColor: c.brandPrimary, opacity: 0.7 },
  stepChipText: { fontFamily: Fonts.bodySemi, fontSize: 12, color: c.textSecondary },
  stepChipTextActive: { color: '#FFFFFF' },

  stepCard: {
    padding: 16, borderRadius: 14, gap: 10,
    backgroundColor: 'rgba(183, 121, 31, 0.06)',
    borderWidth: 1, borderColor: 'rgba(183, 121, 31, 0.16)',
  },
  stepTitle: { fontFamily: Fonts.heading, fontSize: 20, color: c.brandPrimary, letterSpacing: -0.2, lineHeight: 26 },
  stepBody: { fontFamily: Fonts.body, fontSize: 13.5, color: c.textSecondary, lineHeight: 20 },

  fieldLbl: { fontFamily: Fonts.body, fontSize: 13, color: c.textPrimary },
  textInput: {
    borderWidth: 1, borderColor: c.border, borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 10,
    fontFamily: Fonts.body, color: c.textPrimary, fontSize: 14, backgroundColor: '#FFFFFF',
  },
  selectBtn: {
    borderWidth: 1, borderColor: c.border, borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 12,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: '#FFFFFF',
  },
  selectText: { fontFamily: Fonts.body, color: c.textPrimary, fontSize: 14 },
  selectPlaceholder: { fontFamily: Fonts.body, color: c.textMuted, fontSize: 14 },
  dateFieldRow: {
    borderWidth: 1, borderColor: c.border, borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 8,
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFFFFF',
  },
  dateInput: { flex: 1, fontFamily: Fonts.body, color: c.textPrimary, fontSize: 14, paddingVertical: 4 },

  stepFooter: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 6,
  },
  stepCounter: { fontFamily: Fonts.body, fontSize: 13, color: c.textSecondary },
  primaryBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingVertical: 10, paddingHorizontal: 20, borderRadius: 9999,
    backgroundColor: c.brandPrimary,
  },
  primaryBtnEscalate: { backgroundColor: '#A5512B' },
  primaryBtnText: { color: '#FFFFFF', fontFamily: Fonts.bodySemi, fontSize: 14, letterSpacing: 0.2 },

  backLink: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', marginTop: 4 },
  backLinkText: { fontFamily: Fonts.bodySemi, fontSize: 12, color: c.textSecondary },

  pickerBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  pickerSheet: {
    backgroundColor: c.cardBg, borderTopLeftRadius: 20, borderTopRightRadius: 20,
    padding: 16, gap: 6, maxHeight: '75%',
  },
  pickerHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingBottom: 8 },
  pickerTitle: { fontFamily: Fonts.bodySemi, fontSize: 15, color: c.textPrimary },
  pickerRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 12, paddingHorizontal: 8, borderRadius: 10,
  },
  pickerRowActive: { backgroundColor: 'rgba(14,77,82,0.06)' },
  pickerRowText: { fontFamily: Fonts.body, fontSize: 14, color: c.textPrimary, flex: 1 },
  pickerRowTextActive: { color: c.brandPrimary, fontFamily: Fonts.bodySemi },
}); }
