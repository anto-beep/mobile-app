// Switch Provider — mobile parity with /app/provider-switch on the web app.
//
// Web structure mirrored here:
//   • Eyebrow "SWITCH PROVIDER" + hero "Switch Provider"
//   • Subheading: "A guided path to changing providers…"
//   • 5 step-cards in a 2-column grid; tap to jump
//   • Selected step renders its own content panel
//   • Step 4 ("Giving Notice") shows a generated draft letter with
//     Copy / .txt / PDF actions
//   • Step 5 ("Handover and First Two Weeks") shows a 4-item checklist
//
// Form state (current provider, target provider, reason, etc.) persists
// across step navigation. On Step 4 we POST to /provider-switch/start so
// the lifecycle status changes server-side; the "in-progress" state then
// shows a small summary card at the top.
import React, { useCallback, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity, Alert,
  ActivityIndicator, RefreshControl, Platform, Share,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
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

const STEPS = [
  { n: 1, label: 'Why You Might Switch' },
  { n: 2, label: 'Before You Decide' },
  { n: 3, label: 'Comparing Providers' },
  { n: 4, label: 'Giving Notice' },
  { n: 5, label: 'Handover' },
] as const;

type Tri = 'yes' | 'not_yet' | 'na' | null;
const TRI_LABELS: { key: Exclude<Tri, null>; label: string }[] = [
  { key: 'yes', label: 'Yes' },
  { key: 'not_yet', label: 'Not Yet' },
  { key: 'na', label: 'Not Applicable' },
];

const COMPARING_FACTORS = [
  { title: 'Services offered',                       body: 'Make sure the new provider offers everything the participant currently uses, plus anything you have been told they need next.' },
  { title: 'Per-service prices',                     body: "Compare hourly rates and any package or admin fees. Wayly's Provider Price Checker can help." },
  { title: 'Availability and worker continuity',     body: 'Ask how many regular workers the participant would see and what they do when a regular worker is sick or on leave.' },
  { title: 'Communication style',                    body: 'Will they call you when something changes? How do they handle complaints? What is their response time on questions?' },
  { title: 'Hidden fees',                            body: 'There are no exit fees under Support at Home. Ask the new provider to list every fee, including admin and travel, in writing.' },
];

const HANDOVER_CHECKLIST = [
  'Care plan and goals shared with new provider',
  'First visit confirmed, with the regular worker if possible',
  'Diary set up to capture how the first two weeks go',
  'Feedback session booked with the new provider for week 3',
];

function buildLetter(opts: { currentProvider: string; reason: string; lastDay: string }): string {
  const cp = opts.currentProvider.trim() || '[Current provider]';
  const r = opts.reason.trim() || '[reason]';
  const ld = opts.lastDay ? formatDate(opts.lastDay) : '[last service date]';
  const today = formatDate(new Date()) || '';
  return [
    today,
    '',
    cp,
    '[Provider address]',
    '',
    'Notice of Provider Change Under Support at Home',
    '',
    `Dear ${cp},`,
    '',
    'I am writing on behalf of the participant to let you know that we have decided to move to a different Support at Home provider.',
    '',
    `In short, our reason is: ${r}.`,
    '',
    `Please treat this letter as formal notice. We would like the last day of service with you to be ${ld}.`,
    '',
    'In line with the Support at Home program rules, please:',
    '  1. Confirm in writing the last day you will deliver services.',
    '  2. Confirm the balance of unspent budget that will carry across.',
    '  3. Share a copy of the most recent care plan and any clinical notes with the new provider on request.',
    '  4. Confirm there are no exit fees, transfer fees, or final invoices to settle outside published service rates.',
    '',
    'Thank you for the services you have provided to date. We would like the handover to be as smooth as possible for the participant.',
    '',
    'Kind regards,',
    '',
    '[Your name]',
    '[Your relationship to the participant]',
    '[Your contact details]',
  ].join('\n');
}

export default function ProviderSwitch() {
  const c = useColors();
  const styles = useThemedStyles(makeStyles);
  const { data, loading, refreshing, refresh } = useApi<Status>('/provider-switch/status');

  const [step, setStep] = useState<1 | 2 | 3 | 4 | 5>(1);

  // Persisted form state.
  const [currentProvider, setCurrentProvider] = useState('');
  const [targetProvider, setTargetProvider] = useState('');
  const [reason, setReason] = useState('');
  const [check1, setCheck1] = useState<Tri>(null);
  const [check2, setCheck2] = useState<Tri>(null);
  const [check3, setCheck3] = useState<Tri>(null);
  const [check4, setCheck4] = useState<Tri>(null);
  const [lastDay, setLastDay] = useState<string>('');
  const [handover, setHandover] = useState<boolean[]>(() => HANDOVER_CHECKLIST.map(() => false));
  const [busy, setBusy] = useState(false);

  // Bootstrap: pre-fill from server status if available.
  React.useEffect(() => {
    if (!data) return;
    if (!currentProvider && data.current_provider) setCurrentProvider(data.current_provider);
    if (!targetProvider && data.new_provider) setTargetProvider(data.new_provider);
    if (!reason && data.reason) setReason(data.reason);
    if (!lastDay && data.target_date) setLastDay(data.target_date);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  const inProgress = !!data?.in_progress;
  const m = STATUS_PILL[(data?.status || 'DRAFT').toUpperCase()] || STATUS_PILL.DRAFT;

  const letter = useMemo(() => buildLetter({ currentProvider, reason, lastDay }), [currentProvider, reason, lastDay]);

  const goStep = useCallback((n: number) => { setStep(Math.max(1, Math.min(5, n)) as 1 | 2 | 3 | 4 | 5); }, []);

  const continueLabel = useMemo(() => {
    if (step === 1) return 'I Have Read This — Continue';
    if (step === 2) return 'Compare Providers';
    if (step === 3) return 'Draft the Notice';
    if (step === 4) return 'Start the Handover';
    return 'Mark Switch Complete';
  }, [step]);

  const onCopy = useCallback(async () => {
    try { await Clipboard.setStringAsync(letter); toast.success('Letter copied to clipboard.'); }
    catch { toast.error("Couldn't copy. Try Share instead."); }
  }, [letter]);

  const onDownloadText = useCallback(async () => {
    try {
      const ts = new Date().toISOString().slice(0, 10).replace(/-/g, '');
      const name = `wayly-provider-notice-${ts}.txt`;
      if (Platform.OS === 'web') {
        // Pure web fallback — anchor + Blob download.
        // @ts-ignore
        const blob = new Blob([letter], { type: 'text/plain' });
        // @ts-ignore
        const url = URL.createObjectURL(blob);
        // @ts-ignore
        const a = document.createElement('a');
        // @ts-ignore
        a.href = url; a.download = name; a.click();
        // @ts-ignore
        setTimeout(() => URL.revokeObjectURL(url), 1500);
        toast.success('Notice letter downloaded.');
        return;
      }
      const dir = (FileSystem as any).cacheDirectory || (FileSystem as any).documentDirectory;
      const uri = `${dir}${name}`;
      // @ts-ignore — both styles supported across SDKs
      if ((FileSystem as any).writeAsStringAsync) {
        await (FileSystem as any).writeAsStringAsync(uri, letter, { encoding: 'utf8' });
      } else if ((FileSystem as any).File) {
        const f = new (FileSystem as any).File(uri);
        await f.write(letter);
      }
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, { mimeType: 'text/plain', dialogTitle: 'Save or send notice letter' });
      } else {
        await Share.share({ message: letter, title: 'Provider switch notice' });
      }
    } catch (e: any) {
      toast.error(e?.message || "Couldn't share the letter.");
    }
  }, [letter]);

  const onSharePdf = useCallback(async () => {
    // Native PDF rendering needs expo-print which isn't installed. Web has
    // window.print(); on native we fall back to sharing the text. Calls out
    // the lightweight tradeoff clearly so users aren't confused.
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      try {
        const w = window.open('', '_blank');
        if (!w) { toast.warning('Allow pop-ups to print to PDF.'); return; }
        w.document.write(`<pre style="font-family: ui-serif, Georgia, serif; white-space:pre-wrap; padding:24px; line-height:1.5">${letter.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</pre>`);
        w.document.close();
        w.focus();
        w.print();
      } catch {
        toast.warning("Couldn't open the print dialog.");
      }
      return;
    }
    toast.info('Use the share menu and pick "Print" or "Save as PDF".', 4000);
    await onDownloadText();
  }, [letter, onDownloadText]);

  const startSwitch = useCallback(async () => {
    if (!targetProvider.trim()) { toast.warning('Add a target provider on Step 1 or 3 first.'); setStep(3); return; }
    setBusy(true);
    try {
      await api.post('/provider-switch/start', {
        new_provider: targetProvider.trim(),
        reason: reason.trim() || undefined,
        target_date: lastDay || undefined,
      });
      await refresh();
      toast.success('Switch tracking started. Wayly will watch the handover for you.');
      setStep(5);
    } catch (e) { toast.error(extractErrorMessage(e, "Couldn't start the switch")); }
    finally { setBusy(false); }
  }, [targetProvider, reason, lastDay, refresh]);

  const completeSwitch = useCallback(async () => {
    // Backend doesn't expose a "complete" endpoint yet — cancel acts as a
    // close-out for the lifecycle. Confirm before doing anything.
    Alert.alert(
      'Mark switch complete?',
      "We'll close the tracked switch and you can start a new one any time.",
      [
        { text: 'Not yet', style: 'cancel' },
        { text: 'Mark complete', onPress: async () => {
          try {
            await api.post('/provider-switch/cancel');
            await refresh();
            toast.success('Switch marked complete.');
          } catch (e) { toast.error(extractErrorMessage(e, "Couldn't update status.")); }
        } },
      ],
    );
  }, [refresh]);

  const cancelInProgress = useCallback(async () => {
    Alert.alert('Cancel switch?', 'You can start another one later.', [
      { text: 'Keep going', style: 'cancel' },
      { text: 'Cancel switch', style: 'destructive', onPress: async () => {
        try { await api.post('/provider-switch/cancel'); await refresh(); toast.success('Switch cancelled.'); }
        catch (e) { toast.error(extractErrorMessage(e, "Couldn't cancel.")); }
      } },
    ]);
  }, [refresh]);

  const onContinue = useCallback(() => {
    if (step < 4) { goStep(step + 1); return; }
    if (step === 4) { startSwitch(); return; }
    if (step === 5) { completeSwitch(); return; }
  }, [step, goStep, startSwitch, completeSwitch]);

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <BackHeader title="Switch provider" />
      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={c.brandPrimary} />}
      >
        <Text style={styles.eyebrow}>SWITCH PROVIDER</Text>
        <Text style={styles.hero}>Switch Provider</Text>
        <Text style={styles.subhero}>A guided path to changing providers, with Wayly tracking the handover so nothing falls through the cracks.</Text>

        {inProgress && (
          <View style={styles.progressBanner}>
            <View style={styles.progRow}>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={styles.lbl}>SWITCH IN PROGRESS</Text>
                <Text style={styles.body}>{data?.current_provider || '—'} → {data?.new_provider || '—'}</Text>
              </View>
              <View style={[styles.pill, { backgroundColor: `${m.tint}1F` }]}>
                <Text style={[styles.pillText, { color: m.tint }]}>{m.label}</Text>
              </View>
            </View>
            <TouchableOpacity onPress={cancelInProgress} hitSlop={6} testID="provider-switch-cancel">
              <Text style={styles.bannerCancel}>Cancel this switch</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* 5-card step picker */}
        <View style={styles.stepGrid}>
          {STEPS.map((s) => {
            const active = step === s.n;
            return (
              <TouchableOpacity
                key={s.n}
                onPress={() => goStep(s.n)}
                style={[styles.stepCard, active && styles.stepCardActive]}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                testID={`step-card-${s.n}`}
              >
                <Text style={[styles.stepEyebrow, active && styles.stepEyebrowActive]}>STEP {s.n}</Text>
                <Text style={[styles.stepLabel, active && styles.stepLabelActive]}>{s.label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {loading && !data ? (
          <View style={{ paddingVertical: 24, alignItems: 'center' }}>
            <ActivityIndicator color={c.brandPrimary} />
          </View>
        ) : (
          <View style={styles.panel}>
            {step === 1 && (
              <>
                <Text style={styles.panelTitle}>Why You Might Switch Providers</Text>
                <Text style={styles.para}>Most caregivers consider switching providers for one of a few reasons. Your provider is consistently late or unreliable. Their published prices keep going up. The worker mix is unstable, and your parent keeps meeting new faces. Communication is poor. Or the services on offer no longer fit the participant&apos;s needs.</Text>
                <Text style={styles.para}>You do not need to justify the switch to anyone. Under Support at Home, you can change providers at any time. You cannot be charged a fee for leaving. Your budget moves with the participant, not with the provider.</Text>
                <Text style={styles.para}>Wayly does not recommend specific providers. We will help you understand what to ask, what to compare, and how to make the handover as clean as possible.</Text>

                <Field label="Current Provider">
                  <TextInput
                    style={styles.input}
                    value={currentProvider}
                    onChangeText={setCurrentProvider}
                    placeholder="e.g. BlueBerry Care"
                    placeholderTextColor={c.textMuted}
                    testID="current-provider"
                  />
                </Field>
                <Field label="Target Provider (Optional)">
                  <TextInput
                    style={styles.input}
                    value={targetProvider}
                    onChangeText={setTargetProvider}
                    placeholder="e.g. SilverCare Plus"
                    placeholderTextColor={c.textMuted}
                    testID="target-provider"
                  />
                </Field>
                <Field label="In a Sentence, Why Are You Considering Switching?">
                  <TextInput
                    style={[styles.input, { minHeight: 80, textAlignVertical: 'top' }]}
                    value={reason}
                    onChangeText={setReason}
                    multiline
                    placeholder="e.g. Worker schedule keeps changing without notice."
                    placeholderTextColor={c.textMuted}
                    testID="reason"
                  />
                </Field>
              </>
            )}

            {step === 2 && (
              <>
                <Text style={styles.panelTitle}>Before You Decide</Text>
                <Text style={styles.para}>Before you make the move, walk through these four checks. You do not have to answer &ldquo;yes&rdquo; to all of them. They just help make sure switching is the right call.</Text>

                <TriCheck
                  styles={styles}
                  c={c}
                  testID="decide-1"
                  title="Have you raised your concerns with your current provider?"
                  body="Often providers will make changes if you tell them what's not working. It is worth at least one direct conversation, ideally in writing."
                  value={check1}
                  onChange={setCheck1}
                />
                <TriCheck
                  styles={styles}
                  c={c}
                  testID="decide-2"
                  title="Have you written down the specific incidents that worry you?"
                  body="Dates, what happened, who was involved. This helps you compare providers later and gives the new provider a clearer picture of what to fix."
                  value={check2}
                  onChange={setCheck2}
                />
                <TriCheck
                  styles={styles}
                  c={c}
                  testID="decide-3"
                  title="Do you know how much of your budget is unspent?"
                  body="Unspent funds carry with the participant when you switch. Wayly's Budget Calculator shows the current balance."
                  value={check3}
                  onChange={setCheck3}
                />
                <TriCheck
                  styles={styles}
                  c={c}
                  testID="decide-4"
                  title="Is the participant okay with workers changing?"
                  body="A new provider almost always means new faces. For some participants this is fine, for others it is a real disruption."
                  value={check4}
                  onChange={setCheck4}
                />
              </>
            )}

            {step === 3 && (
              <>
                <Text style={styles.panelTitle}>Comparing Providers</Text>
                <Text style={styles.para}>If you already know which provider you are moving to, write them down. Either way, walk through the five things that matter most when comparing providers under Support at Home.</Text>

                <Field label="Target Provider">
                  <TextInput
                    style={styles.input}
                    value={targetProvider}
                    onChangeText={setTargetProvider}
                    placeholder="e.g. SilverCare Plus"
                    placeholderTextColor={c.textMuted}
                    testID="target-provider-2"
                  />
                </Field>

                {COMPARING_FACTORS.map((f) => (
                  <View key={f.title} style={styles.factor}>
                    <Text style={styles.factorTitle}>{f.title}</Text>
                    <Text style={styles.factorBody}>{f.body}</Text>
                  </View>
                ))}
              </>
            )}

            {step === 4 && (
              <>
                <Text style={styles.panelTitle}>Giving Notice</Text>
                <Text style={styles.para}>When you are ready, send written notice to your current provider. Under Support at Home there is no required notice period, but most providers ask for 14 days so they can wind down services properly. Below is a draft letter you can copy, adjust, and send.</Text>

                <Field label="Last Day of Service With Current Provider">
                  {Platform.OS === 'web' ? (
                    React.createElement('input', {
                      type: 'date',
                      value: lastDay || '',
                      onChange: (e: any) => setLastDay(e?.target?.value || ''),
                      'data-testid': 'last-day',
                      style: { fontFamily: 'inherit', fontSize: 14, color: c.textPrimary, background: c.background, borderRadius: 8, padding: '12px 14px', border: `1px solid ${c.borderSubtle}`, outline: 'none', width: '100%', boxSizing: 'border-box', minHeight: 46 },
                    })
                  ) : (
                    <TextInput
                      style={styles.input}
                      value={lastDay}
                      onChangeText={setLastDay}
                      placeholder="YYYY-MM-DD"
                      placeholderTextColor={c.textMuted}
                      testID="last-day"
                      autoCapitalize="none"
                    />
                  )}
                  {!!lastDay && <Text style={styles.hint}>Reads as: {formatDate(lastDay)}</Text>}
                </Field>

                <Field label="Reason (One Short Sentence)">
                  <TextInput
                    style={styles.input}
                    value={reason}
                    onChangeText={setReason}
                    placeholder="e.g. Looking for more consistent workers."
                    placeholderTextColor={c.textMuted}
                    testID="reason-step4"
                  />
                </Field>

                <View style={styles.letterCard}>
                  <View style={styles.letterHead}>
                    <View style={styles.letterTitleRow}>
                      <Ionicons name="document-text-outline" size={16} color={c.brandPrimary} />
                      <Text style={styles.letterTitle}>Draft Notice Letter</Text>
                    </View>
                    <View style={styles.letterActions}>
                      <TouchableOpacity onPress={onCopy} style={styles.letterBtn} testID="letter-copy">
                        <Ionicons name="copy-outline" size={14} color={c.brandPrimary} />
                        <Text style={styles.letterBtnText}>Copy</Text>
                      </TouchableOpacity>
                      <TouchableOpacity onPress={onDownloadText} style={styles.letterBtn} testID="letter-txt">
                        <Ionicons name="download-outline" size={14} color={c.brandPrimary} />
                        <Text style={styles.letterBtnText}>.txt</Text>
                      </TouchableOpacity>
                      <TouchableOpacity onPress={onSharePdf} style={styles.letterBtn} testID="letter-pdf">
                        <Ionicons name="document-outline" size={14} color={c.brandPrimary} />
                        <Text style={styles.letterBtnText}>PDF</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                  <Text style={styles.letterBody} selectable>{letter}</Text>
                </View>

                <Text style={styles.tipFootnote}>The letter is a starting point. Adjust the wording, add anything specific to your situation, and replace the bracketed parts before sending.</Text>
              </>
            )}

            {step === 5 && (
              <>
                <Text style={styles.panelTitle}>Handover and First Two Weeks</Text>
                <Text style={styles.para}>The first two weeks with a new provider matter the most. New workers are still learning the participant&apos;s routine and preferences. Set yourself up to spot problems early and give the new provider clear feedback.</Text>

                {HANDOVER_CHECKLIST.map((item, idx) => {
                  const done = handover[idx];
                  return (
                    <TouchableOpacity
                      key={item}
                      onPress={() => setHandover((h) => h.map((v, i) => (i === idx ? !v : v)))}
                      style={styles.checkRow}
                      testID={`handover-${idx + 1}`}
                    >
                      <Ionicons
                        name={done ? 'checkmark-circle' : 'ellipse-outline'}
                        size={20}
                        color={done ? c.brandPrimary : c.textMuted}
                      />
                      <Text style={[styles.checkText, done && styles.checkTextDone]}>{item}</Text>
                    </TouchableOpacity>
                  );
                })}
              </>
            )}
          </View>
        )}

        {/* Nav row */}
        <View style={styles.navRow}>
          {step > 1 ? (
            <TouchableOpacity onPress={() => goStep(step - 1)} style={styles.navBack} testID="wizard-back">
              <Ionicons name="arrow-back" size={14} color={c.brandPrimary} />
              <Text style={styles.navBackText}>Back</Text>
            </TouchableOpacity>
          ) : (
            <View style={{ flex: 0 }} />
          )}
          <TouchableOpacity
            onPress={onContinue}
            disabled={busy}
            style={[styles.cta, busy && { opacity: 0.6 }]}
            testID="wizard-next"
          >
            {busy ? <ActivityIndicator color="#FFFFFF" /> : (
              <>
                <Text style={styles.ctaText}>{continueLabel}</Text>
                {step < 5 && <Ionicons name="arrow-forward" size={14} color="#FFFFFF" />}
                {step === 4 && <Ionicons name="flag" size={14} color="#FFFFFF" />}
                {step === 5 && <Ionicons name="checkmark" size={14} color="#FFFFFF" />}
              </>
            )}
          </TouchableOpacity>
        </View>

        <View style={{ height: 32 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Sub-components

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.fieldWrap}>
      <Text style={styles.fieldLabel}>{label}</Text>
      {children}
    </View>
  );
}

function TriCheck({ styles, c, title, body, value, onChange, testID }: {
  styles: ReturnType<typeof makeStyles>;
  c: ColorPalette;
  title: string;
  body: string;
  value: Tri;
  onChange: (v: Tri) => void;
  testID?: string;
}) {
  return (
    <View style={styles.triBlock}>
      <Text style={styles.triTitle}>{title}</Text>
      <Text style={styles.triBody}>{body}</Text>
      <View style={styles.triRow}>
        {TRI_LABELS.map((opt) => {
          const active = value === opt.key;
          return (
            <TouchableOpacity
              key={opt.key}
              onPress={() => onChange(active ? null : opt.key)}
              style={[styles.triChip, active && styles.triChipActive]}
              testID={`${testID}-${opt.key}`}
            >
              <Text style={[styles.triChipText, active && styles.triChipTextActive]}>{opt.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

// ──────────────────────────────────────────────────────────────────────────

function makeStyles(c: ColorPalette) { return StyleSheet.create({
  safe: { flex: 1, backgroundColor: c.background },
  scroll: { padding: Spacing.md, paddingBottom: 40 },
  eyebrow: { fontFamily: Fonts.bodySemi, fontSize: 11, color: c.textMuted, letterSpacing: 1.4, marginTop: 4 },
  hero: { fontFamily: Fonts.heading, fontSize: 28, color: c.brandPrimary, letterSpacing: -0.4, marginTop: 4 },
  subhero: { fontFamily: Fonts.body, fontSize: 14, color: c.textSecondary, lineHeight: 21, marginTop: 6, marginBottom: Spacing.lg },
  // In-progress banner.
  progressBanner: { backgroundColor: c.cardBg, borderRadius: Radius.lg, borderWidth: 1, borderColor: c.borderSubtle, padding: Spacing.md, marginBottom: Spacing.md, gap: 6 },
  progRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  bannerCancel: { fontFamily: Fonts.bodyMed, fontSize: 12, color: c.severityAlert, marginTop: 4, textAlign: 'right' },
  // Step grid.
  stepGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: Spacing.md },
  stepCard: {
    flexBasis: '48%', flexGrow: 1,
    backgroundColor: c.cardBg,
    borderRadius: Radius.md,
    borderWidth: 1, borderColor: c.borderSubtle,
    padding: Spacing.md,
    minHeight: 70,
    justifyContent: 'center',
    gap: 2,
  },
  stepCardActive: { backgroundColor: c.brandPrimary, borderColor: c.brandPrimary },
  stepEyebrow: { fontFamily: Fonts.bodySemi, fontSize: 10, letterSpacing: 1.2, color: c.textMuted },
  stepEyebrowActive: { color: 'rgba(255,255,255,0.7)' },
  stepLabel: { fontFamily: Fonts.heading, fontSize: 15, color: c.brandPrimary, marginTop: 2, lineHeight: 19 },
  stepLabelActive: { color: '#FFFFFF' },
  // Panel.
  panel: { backgroundColor: c.cardBg, borderRadius: Radius.lg, borderWidth: 1, borderColor: c.borderSubtle, padding: Spacing.md, gap: 10 },
  panelTitle: { fontFamily: Fonts.heading, fontSize: 20, color: c.brandPrimary, marginBottom: 4 },
  para: { fontFamily: Fonts.body, fontSize: 14, color: c.textPrimary, lineHeight: 22 },
  // Generic field.
  fieldWrap: { gap: 6, marginTop: Spacing.sm },
  fieldLabel: { fontFamily: Fonts.bodyMed, fontSize: 12, color: c.textSecondary, letterSpacing: 0.4 },
  input: { fontFamily: Fonts.body, fontSize: 14, color: c.textPrimary, backgroundColor: c.background, borderRadius: Radius.md, paddingHorizontal: Spacing.md, paddingVertical: 12, borderWidth: 1, borderColor: c.borderSubtle, minHeight: 46 },
  hint: { fontFamily: Fonts.body, fontSize: 12, color: c.textMuted, marginTop: 4 },
  // Tri-state question.
  triBlock: { borderRadius: Radius.md, borderWidth: 1, borderColor: c.borderSubtle, padding: Spacing.md, gap: 6, backgroundColor: c.surfaceTint, marginTop: 6 },
  triTitle: { fontFamily: Fonts.bodySemi, fontSize: 14, color: c.textPrimary, lineHeight: 20 },
  triBody: { fontFamily: Fonts.body, fontSize: 13, color: c.textSecondary, lineHeight: 19 },
  triRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
  triChip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 9999, backgroundColor: c.cardBg, borderWidth: 1, borderColor: c.borderSubtle },
  triChipActive: { backgroundColor: c.brandPrimary, borderColor: c.brandPrimary },
  triChipText: { fontFamily: Fonts.bodySemi, fontSize: 12, color: c.brandPrimary },
  triChipTextActive: { color: '#FFFFFF' },
  // Compare factor.
  factor: { gap: 4, marginTop: Spacing.sm, paddingTop: Spacing.sm, borderTopWidth: 1, borderTopColor: c.borderSubtle },
  factorTitle: { fontFamily: Fonts.bodySemi, fontSize: 15, color: c.textPrimary },
  factorBody: { fontFamily: Fonts.body, fontSize: 13, color: c.textSecondary, lineHeight: 20 },
  // Letter card.
  letterCard: { borderRadius: Radius.md, borderWidth: 1, borderColor: c.borderSubtle, overflow: 'hidden', marginTop: Spacing.sm },
  letterHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: c.surfaceTint, paddingHorizontal: Spacing.md, paddingVertical: 10, gap: 8, flexWrap: 'wrap' },
  letterTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  letterTitle: { fontFamily: Fonts.bodySemi, fontSize: 13, color: c.brandPrimary },
  letterActions: { flexDirection: 'row', gap: 6 },
  letterBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 6, borderRadius: 9999, backgroundColor: c.cardBg, borderWidth: 1, borderColor: c.borderSubtle },
  letterBtnText: { fontFamily: Fonts.bodySemi, fontSize: 11, color: c.brandPrimary },
  letterBody: { fontFamily: Fonts.body, fontSize: 13, color: c.textPrimary, lineHeight: 20, padding: Spacing.md, backgroundColor: c.cardBg },
  tipFootnote: { fontFamily: Fonts.body, fontSize: 12, color: c.textSecondary, lineHeight: 18, marginTop: Spacing.sm },
  // Handover.
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, borderTopWidth: 1, borderTopColor: c.borderSubtle, marginTop: 4 },
  checkText: { fontFamily: Fonts.body, fontSize: 14, color: c.textPrimary, flex: 1 },
  checkTextDone: { color: c.textMuted, textDecorationLine: 'line-through' },
  // Misc.
  lbl: { fontFamily: Fonts.bodyMed, fontSize: 11, letterSpacing: 0.6, color: c.textSecondary, textTransform: 'uppercase' },
  body: { fontFamily: Fonts.body, fontSize: 13, color: c.textPrimary, marginTop: 2, lineHeight: 19 },
  pill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 },
  pillText: { fontFamily: Fonts.bodySemi, fontSize: 10, letterSpacing: 0.4 },
  // Nav row.
  navRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginTop: Spacing.md },
  navBack: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 10, paddingHorizontal: 8 },
  navBackText: { fontFamily: Fonts.bodySemi, fontSize: 13, color: c.brandPrimary },
  cta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: c.brandPrimary, paddingHorizontal: 18, paddingVertical: 12, borderRadius: 999, minHeight: 44, flexShrink: 1 },
  ctaText: { fontFamily: Fonts.bodySemi, fontSize: 13, color: '#FFFFFF' },
}); }
