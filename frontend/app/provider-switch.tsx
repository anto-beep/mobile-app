// Switch provider — 5-step wizard that drives the lifecycle.
// Each step locks scope so caregivers don't feel rushed:
//   1. Reason            — why move? (chip picker + optional note)
//   2. New provider      — name and (optional) location
//   3. Target date       — when handover should land
//   4. Review notice     — the letter Wayly will draft
//   5. Confirm & start   — single CTA → POST /provider-switch/start
//
// In-progress switches keep the existing summary card so caregivers can
// cancel or just see status without re-entering the wizard.
import React, { useCallback, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity, Alert,
  ActivityIndicator, RefreshControl, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useApi } from '../src/lib/useApi';
import { api, extractErrorMessage } from '../src/lib/api';
import BackHeader from '../src/components/BackHeader';
import { toast } from '../src/components/Toast';
import { Fonts, Radius, Spacing } from '../src/lib/theme';
import type { ColorPalette } from '../src/lib/theme';
import { useColors } from '../src/hooks/useColors';
import { useThemedStyles } from '../src/hooks/useThemedStyles';
import { formatDate } from '../src/lib/formatDate';

type Status = {
  in_progress?: boolean;
  current_provider?: string;
  new_provider?: string;
  reason?: string;
  status?: string;
  target_date?: string | null;
  created_at?: string;
};

const STATUS_PILL: Record<string, { tint: string; label: string }> = {
  DRAFT:       { tint: '#6B7C92', label: 'Draft' },
  NOTICE_SENT: { tint: '#C8932B', label: 'Notice sent' },
  AWAITING:    { tint: '#0E4D52', label: 'Awaiting handover' },
  COMPLETE:    { tint: '#3A5F37', label: 'Complete' },
  CANCELLED:   { tint: '#A54030', label: 'Cancelled' },
};

const REASONS: { key: string; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { key: 'service_quality', label: 'Service quality',   icon: 'star-outline' },
  { key: 'billing',         label: 'Billing concerns',  icon: 'cash-outline' },
  { key: 'location',        label: 'Location change',   icon: 'location-outline' },
  { key: 'better_fit',      label: 'Better fit found',  icon: 'people-outline' },
  { key: 'communication',   label: 'Communication',     icon: 'chatbubbles-outline' },
  { key: 'other',           label: 'Other',             icon: 'ellipsis-horizontal-circle-outline' },
];

const TOTAL_STEPS = 5;

function isoToday(): string {
  return new Date().toISOString().slice(0, 10);
}
function isoPlusDays(d: number): string {
  const t = new Date();
  t.setDate(t.getDate() + d);
  return t.toISOString().slice(0, 10);
}

export default function ProviderSwitch() {
  const c = useColors();
  const styles = useThemedStyles(makeStyles);
  const { data, loading, refreshing, refresh } = useApi<Status>('/provider-switch/status');

  // Wizard state.
  const [step, setStep] = useState<number>(1);
  const [reasonKey, setReasonKey] = useState<string | null>(null);
  const [reasonNote, setReasonNote] = useState('');
  const [newProvider, setNewProvider] = useState('');
  const [newProviderLoc, setNewProviderLoc] = useState('');
  const [targetDate, setTargetDate] = useState<string>(isoPlusDays(30));
  const [busy, setBusy] = useState(false);

  const inProgress = !!data?.in_progress;

  // Form-dirty signal — used to confirm before discarding.
  const dirty = !!reasonKey || !!reasonNote.trim() || !!newProvider.trim() || !!newProviderLoc.trim() || targetDate !== isoPlusDays(30);

  const reasonLabel = useMemo(() => {
    const r = REASONS.find((x) => x.key === reasonKey)?.label || '';
    if (reasonNote.trim()) return r ? `${r} — ${reasonNote.trim()}` : reasonNote.trim();
    return r;
  }, [reasonKey, reasonNote]);

  const canAdvance = useMemo(() => {
    if (step === 1) return !!reasonKey;
    if (step === 2) return newProvider.trim().length > 1;
    if (step === 3) return /^\d{4}-\d{2}-\d{2}$/.test(targetDate);
    return true; // step 4 (review) + 5 (confirm)
  }, [step, reasonKey, newProvider, targetDate]);

  const resetWizard = useCallback(() => {
    setStep(1); setReasonKey(null); setReasonNote(''); setNewProvider(''); setNewProviderLoc(''); setTargetDate(isoPlusDays(30));
  }, []);

  const askDiscard = useCallback((onYes: () => void) => {
    if (!dirty) { onYes(); return; }
    Alert.alert(
      'Discard this switch?',
      "You've started a provider switch. If you cancel now your draft will be cleared.",
      [
        { text: 'Keep going', style: 'cancel' },
        { text: 'Discard', style: 'destructive', onPress: () => { resetWizard(); onYes(); } },
      ],
    );
  }, [dirty, resetWizard]);

  const submit = useCallback(async () => {
    setBusy(true);
    try {
      await api.post('/provider-switch/start', {
        new_provider: newProvider.trim(),
        new_provider_location: newProviderLoc.trim() || undefined,
        reason: reasonLabel || undefined,
        target_date: targetDate || undefined,
      });
      resetWizard();
      await refresh();
      toast.success('Switch started. Wayly will guide you through the next steps.');
    } catch (e) { toast.error(extractErrorMessage(e, "Couldn't start the switch")); }
    finally { setBusy(false); }
  }, [newProvider, newProviderLoc, reasonLabel, targetDate, resetWizard, refresh]);

  const cancel = useCallback(async () => {
    const doCancel = async () => {
      try {
        await api.post('/provider-switch/cancel');
        await refresh();
        toast.success('Switch cancelled.');
      } catch (e) { toast.error(extractErrorMessage(e, "Couldn't cancel.")); }
    };
    if (Platform.OS === 'web') {
      if (typeof window !== 'undefined' && window.confirm('Cancel this provider switch?')) doCancel();
    } else {
      Alert.alert('Cancel switch?', 'You can start another one later.', [
        { text: 'Keep going', style: 'cancel' },
        { text: 'Cancel switch', style: 'destructive', onPress: doCancel },
      ]);
    }
  }, [refresh]);

  const m = STATUS_PILL[(data?.status || 'DRAFT').toUpperCase()] || STATUS_PILL.DRAFT;

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <BackHeader
        title="Switch provider"
        onBack={() => {
          if (inProgress) { return; }
          if (step === 1 && !dirty) return; // BackHeader falls back to nav
          askDiscard(() => setStep(1));
        }}
      />
      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={c.brandPrimary} />}
      >
        <View style={styles.heroRow}>
          <Ionicons name="swap-horizontal-outline" size={22} color={c.brandPrimary} />
          <Text style={styles.hero}>Switch provider</Text>
        </View>
        <Text style={styles.subhero}>Move services to a new aged-care provider. Wayly handles the notice letter, tracks unbilled hours and watches the budget transfer.</Text>

        <View style={styles.card}>
          <Text style={styles.lbl}>Currently with</Text>
          <Text style={styles.bigVal}>{data?.current_provider || 'Your provider'}</Text>
        </View>

        {loading && !data ? (
          <View style={{ paddingVertical: 24, alignItems: 'center' }}>
            <ActivityIndicator color={c.brandPrimary} />
          </View>
        ) : inProgress ? (
          <View style={styles.progressCard}>
            <View style={styles.progRow}>
              <Text style={styles.lbl}>Switching to</Text>
              <View style={[styles.pill, { backgroundColor: `${m.tint}14` }]}>
                <Text style={[styles.pillText, { color: m.tint }]}>{m.label}</Text>
              </View>
            </View>
            <Text style={styles.bigVal}>{data?.new_provider || '—'}</Text>
            {!!data?.reason && (
              <View style={{ marginTop: 8 }}>
                <Text style={styles.lbl}>Reason</Text>
                <Text style={styles.body}>{data.reason}</Text>
              </View>
            )}
            {!!data?.target_date && (
              <View style={{ marginTop: 8 }}>
                <Text style={styles.lbl}>Target date</Text>
                <Text style={styles.body}>{formatDate(data.target_date)}</Text>
              </View>
            )}
            <TouchableOpacity onPress={cancel} style={styles.cancelBtn} testID="provider-switch-cancel">
              <Ionicons name="close-circle-outline" size={14} color={c.severityAlert} />
              <Text style={styles.cancelText}>Cancel this switch</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <>
            {/* ─── Stepper progress ──────────────────────────────────────── */}
            <View style={styles.stepperRow}>
              {Array.from({ length: TOTAL_STEPS }).map((_, i) => {
                const stepNum = i + 1;
                const reached = stepNum <= step;
                return (
                  <View key={stepNum} style={[styles.stepDot, reached && styles.stepDotActive]}>
                    <Text style={[styles.stepDotText, reached && styles.stepDotTextActive]}>{stepNum}</Text>
                  </View>
                );
              })}
            </View>
            <Text style={styles.stepLabel}>Step {step} of {TOTAL_STEPS}</Text>

            {/* ─── Step body ────────────────────────────────────────────── */}
            {step === 1 && (
              <View style={styles.stepCard}>
                <Text style={styles.stepTitle}>Why are you moving?</Text>
                <Text style={styles.stepHelp}>Pick the closest reason — you can add detail below.</Text>
                <View style={styles.chipWrap}>
                  {REASONS.map((r) => {
                    const active = reasonKey === r.key;
                    return (
                      <TouchableOpacity
                        key={r.key}
                        onPress={() => setReasonKey(r.key)}
                        style={[styles.chip, active && styles.chipActive]}
                        testID={`reason-${r.key}`}
                      >
                        <Ionicons name={r.icon} size={14} color={active ? '#FFFFFF' : c.brandPrimary} />
                        <Text style={[styles.chipText, active && styles.chipTextActive]}>{r.label}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
                <Text style={[styles.lbl, { marginTop: Spacing.md }]}>Extra detail (optional)</Text>
                <TextInput
                  style={[styles.input, { minHeight: 80, textAlignVertical: 'top' }]}
                  value={reasonNote}
                  onChangeText={setReasonNote}
                  multiline
                  placeholder="Anything specific worth recording?"
                  placeholderTextColor={c.textMuted}
                  testID="provider-reason-note"
                />
              </View>
            )}

            {step === 2 && (
              <View style={styles.stepCard}>
                <Text style={styles.stepTitle}>Which provider are you moving to?</Text>
                <Text style={styles.stepHelp}>If you haven&apos;t picked one yet, you can write &quot;Shortlisting&quot; — Wayly will pause the letter until you confirm.</Text>
                <Text style={styles.lbl}>Provider name</Text>
                <TextInput
                  style={styles.input}
                  value={newProvider}
                  onChangeText={setNewProvider}
                  placeholder="e.g. SilverCare Plus"
                  placeholderTextColor={c.textMuted}
                  testID="provider-new"
                />
                <Text style={[styles.lbl, { marginTop: Spacing.md }]}>Location / region (optional)</Text>
                <TextInput
                  style={styles.input}
                  value={newProviderLoc}
                  onChangeText={setNewProviderLoc}
                  placeholder="e.g. Inner West Sydney"
                  placeholderTextColor={c.textMuted}
                  testID="provider-new-location"
                />
              </View>
            )}

            {step === 3 && (
              <View style={styles.stepCard}>
                <Text style={styles.stepTitle}>When would you like the handover?</Text>
                <Text style={styles.stepHelp}>Most providers ask for 30 days&apos; notice. You can change this later.</Text>
                <View style={styles.chipWrap}>
                  {[
                    { label: '14 days', d: 14 },
                    { label: '30 days', d: 30 },
                    { label: '60 days', d: 60 },
                  ].map((opt) => {
                    const iso = isoPlusDays(opt.d);
                    const active = targetDate === iso;
                    return (
                      <TouchableOpacity
                        key={opt.d}
                        onPress={() => setTargetDate(iso)}
                        style={[styles.chip, active && styles.chipActive]}
                        testID={`date-preset-${opt.d}`}
                      >
                        <Text style={[styles.chipText, active && styles.chipTextActive]}>{opt.label}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
                <Text style={[styles.lbl, { marginTop: Spacing.md }]}>Target date (YYYY-MM-DD)</Text>
                {Platform.OS === 'web' ? (
                  React.createElement('input', {
                    type: 'date',
                    value: targetDate,
                    min: isoToday(),
                    onChange: (e: any) => setTargetDate(e?.target?.value || isoPlusDays(30)),
                    'data-testid': 'provider-target-date',
                    style: { fontFamily: 'inherit', fontSize: 14, color: c.textPrimary, background: c.background, borderRadius: 8, padding: '12px 14px', border: `1px solid ${c.borderSubtle}`, outline: 'none', width: '100%', boxSizing: 'border-box', minHeight: 46 },
                  })
                ) : (
                  <TextInput
                    style={styles.input}
                    value={targetDate}
                    onChangeText={setTargetDate}
                    placeholder="YYYY-MM-DD"
                    placeholderTextColor={c.textMuted}
                    testID="provider-target-date"
                    autoCapitalize="none"
                  />
                )}
                <Text style={styles.helpHint}>Reads as: {formatDate(targetDate) || '—'}</Text>
              </View>
            )}

            {step === 4 && (
              <View style={styles.stepCard}>
                <Text style={styles.stepTitle}>Review the notice draft</Text>
                <Text style={styles.stepHelp}>Wayly will turn the details below into a polite, professional notice letter you can review and send.</Text>
                <View style={styles.previewBox}>
                  <Text style={styles.previewLabel}>FROM</Text>
                  <Text style={styles.previewValue}>{data?.current_provider || 'Current provider'}</Text>
                  <View style={styles.previewSep} />
                  <Text style={styles.previewLabel}>TO</Text>
                  <Text style={styles.previewValue}>{newProvider.trim() || '—'}</Text>
                  {!!newProviderLoc.trim() && <Text style={styles.previewSub}>{newProviderLoc.trim()}</Text>}
                  <View style={styles.previewSep} />
                  <Text style={styles.previewLabel}>REASON</Text>
                  <Text style={styles.previewValue}>{reasonLabel || '—'}</Text>
                  <View style={styles.previewSep} />
                  <Text style={styles.previewLabel}>HANDOVER DATE</Text>
                  <Text style={styles.previewValue}>{formatDate(targetDate) || '—'}</Text>
                </View>
                <View style={styles.tip}>
                  <Ionicons name="information-circle-outline" size={14} color={c.brandPrimary} />
                  <Text style={styles.tipText}>You&apos;ll be able to download the letter as a PDF after starting the switch.</Text>
                </View>
              </View>
            )}

            {step === 5 && (
              <View style={styles.stepCard}>
                <Text style={styles.stepTitle}>Ready when you are.</Text>
                <Text style={styles.stepHelp}>We&apos;ll track unbilled hours, watch the budget transfer and flag any anomalies during the handover window.</Text>
                <View style={styles.bullet}><Ionicons name="checkmark-circle" size={16} color={c.brandPrimary} /><Text style={styles.bulletText}>Notice letter ready to draft</Text></View>
                <View style={styles.bullet}><Ionicons name="checkmark-circle" size={16} color={c.brandPrimary} /><Text style={styles.bulletText}>Statement watch enabled during handover</Text></View>
                <View style={styles.bullet}><Ionicons name="checkmark-circle" size={16} color={c.brandPrimary} /><Text style={styles.bulletText}>You can cancel any time before notice is sent</Text></View>
                <TouchableOpacity onPress={submit} disabled={busy} style={[styles.cta, busy && { opacity: 0.6 }]} testID="provider-switch-save">
                  {busy ? <ActivityIndicator color="#FFFFFF" /> : (
                    <>
                      <Ionicons name="flag" size={14} color="#FFFFFF" />
                      <Text style={styles.ctaText}>Start the switch</Text>
                    </>
                  )}
                </TouchableOpacity>
              </View>
            )}

            {/* ─── Nav row ──────────────────────────────────────────────── */}
            {step < TOTAL_STEPS && (
              <View style={styles.navRow}>
                {step > 1 ? (
                  <TouchableOpacity onPress={() => setStep((s) => Math.max(1, s - 1))} style={styles.navBack} testID="wizard-back">
                    <Ionicons name="arrow-back" size={14} color={c.brandPrimary} />
                    <Text style={styles.navBackText}>Back</Text>
                  </TouchableOpacity>
                ) : (
                  <View style={{ flex: 1 }} />
                )}
                <TouchableOpacity
                  onPress={() => setStep((s) => Math.min(TOTAL_STEPS, s + 1))}
                  disabled={!canAdvance}
                  style={[styles.cta, !canAdvance && { opacity: 0.4 }]}
                  testID="wizard-next"
                >
                  <Text style={styles.ctaText}>{step === 4 ? 'Looks good' : 'Continue'}</Text>
                  <Ionicons name="arrow-forward" size={14} color="#FFFFFF" />
                </TouchableOpacity>
              </View>
            )}

            {dirty && step === 1 && (
              <TouchableOpacity
                onPress={() => askDiscard(resetWizard)}
                style={styles.cancelLink}
                testID="wizard-discard"
              >
                <Text style={styles.cancelLinkText}>Discard draft</Text>
              </TouchableOpacity>
            )}
          </>
        )}

        <View style={{ height: 32 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

function makeStyles(c: ColorPalette) { return StyleSheet.create({
  safe: { flex: 1, backgroundColor: c.background },
  scroll: { padding: Spacing.md, paddingBottom: 40 },
  heroRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 6 },
  hero: { fontFamily: Fonts.heading, fontSize: 24, color: c.brandPrimary, letterSpacing: -0.3 },
  subhero: { fontFamily: Fonts.body, fontSize: 13, color: c.textSecondary, lineHeight: 19, marginBottom: Spacing.lg },
  card: { backgroundColor: c.cardBg, borderRadius: Radius.lg, borderWidth: 1, borderColor: c.borderSubtle, padding: Spacing.md, marginBottom: Spacing.md },
  progressCard: { backgroundColor: c.cardBg, borderRadius: Radius.lg, borderWidth: 1, borderColor: c.borderSubtle, padding: Spacing.md, marginBottom: Spacing.md },
  progRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  lbl: { fontFamily: Fonts.bodyMed, fontSize: 11, letterSpacing: 0.6, color: c.textSecondary, textTransform: 'uppercase' },
  bigVal: { fontFamily: Fonts.heading, fontSize: 20, color: c.brandPrimary, marginTop: 4 },
  body: { fontFamily: Fonts.body, fontSize: 13, color: c.textPrimary, marginTop: 2, lineHeight: 19 },
  pill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 },
  pillText: { fontFamily: Fonts.bodySemi, fontSize: 10, letterSpacing: 0.4 },
  cancelBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, marginTop: Spacing.md, paddingVertical: 8 },
  cancelText: { fontFamily: Fonts.bodyMed, fontSize: 13, color: c.severityAlert },
  // Stepper.
  stepperRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6, paddingHorizontal: 4 },
  stepDot: {
    width: 28, height: 28, borderRadius: 14,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: c.cardBg,
    borderWidth: 1.5, borderColor: c.borderSubtle,
  },
  stepDotActive: { backgroundColor: c.brandPrimary, borderColor: c.brandPrimary },
  stepDotText: { fontFamily: Fonts.bodySemi, fontSize: 12, color: c.textMuted },
  stepDotTextActive: { color: '#FFFFFF' },
  stepLabel: { fontFamily: Fonts.bodyMed, fontSize: 11, color: c.textSecondary, marginBottom: Spacing.md, letterSpacing: 0.4 },
  stepCard: { backgroundColor: c.cardBg, borderRadius: Radius.lg, borderWidth: 1, borderColor: c.borderSubtle, padding: Spacing.md, marginBottom: Spacing.md, gap: Spacing.sm },
  stepTitle: { fontFamily: Fonts.heading, fontSize: 18, color: c.brandPrimary, marginBottom: 2 },
  stepHelp: { fontFamily: Fonts.body, fontSize: 12, color: c.textSecondary, lineHeight: 18, marginBottom: Spacing.sm },
  helpHint: { fontFamily: Fonts.body, fontSize: 12, color: c.textMuted, marginTop: 6 },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 12, paddingVertical: 8,
    borderRadius: 9999,
    backgroundColor: c.surfaceTint,
    borderWidth: 1, borderColor: c.borderSubtle,
  },
  chipActive: { backgroundColor: c.brandPrimary, borderColor: c.brandPrimary },
  chipText: { fontFamily: Fonts.bodySemi, fontSize: 12, color: c.brandPrimary },
  chipTextActive: { color: '#FFFFFF' },
  input: { fontFamily: Fonts.body, fontSize: 14, color: c.textPrimary, backgroundColor: c.background, borderRadius: Radius.md, paddingHorizontal: Spacing.md, paddingVertical: 12, borderWidth: 1, borderColor: c.borderSubtle, minHeight: 46 },
  // Preview (step 4).
  previewBox: { backgroundColor: c.surfaceTint, borderRadius: Radius.md, padding: Spacing.md, borderWidth: 1, borderColor: c.borderSubtle },
  previewLabel: { fontFamily: Fonts.bodyMed, fontSize: 10, color: c.textMuted, letterSpacing: 0.8 },
  previewValue: { fontFamily: Fonts.bodySemi, fontSize: 15, color: c.textPrimary, marginTop: 2 },
  previewSub: { fontFamily: Fonts.body, fontSize: 12, color: c.textSecondary, marginTop: 1 },
  previewSep: { height: 1, backgroundColor: c.borderSubtle, marginVertical: 10 },
  tip: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, padding: 10, backgroundColor: c.surfaceTint, borderRadius: Radius.sm, marginTop: 8 },
  tipText: { fontFamily: Fonts.body, fontSize: 12, color: c.textSecondary, flex: 1, lineHeight: 17 },
  // Step 5.
  bullet: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 },
  bulletText: { fontFamily: Fonts.body, fontSize: 13, color: c.textPrimary, flex: 1 },
  // Wizard nav row.
  navRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  navBack: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 10, paddingHorizontal: 8 },
  navBackText: { fontFamily: Fonts.bodySemi, fontSize: 13, color: c.brandPrimary },
  cta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: c.brandPrimary, paddingHorizontal: 18, paddingVertical: 12, borderRadius: 999, minHeight: 44 },
  ctaText: { fontFamily: Fonts.bodySemi, fontSize: 13, color: '#FFFFFF' },
  cancelLink: { marginTop: 8, alignItems: 'center', paddingVertical: 10 },
  cancelLinkText: { fontFamily: Fonts.bodyMed, fontSize: 13, color: c.textMuted },
}); }
