// LogScenarioSheet — mobile port of the web `/app/scenarios` page.
//
// Layout mirrors the web app one-to-one (see reference screenshots in the
// design brief):
//
//   1. Fraunces H1 "Log a Scenario" + Inter subtitle
//   2. Intro paragraph card (teal-tinted)
//   3. Current status card (uppercase overline + big value)
//   4. Guided Workflows section header + 3 workflow cards
//   5. Freeform log form (Category dropdown → What happened → Date → Note)
//   6. Recent events list (either "Nothing logged yet" or timeline cells)
//
// Category / event grouping is client-side because production returns
// `category: null` for every event type in /api/scenario/schema.
import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView,
  StyleSheet, Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useScenario } from '../context/ScenarioContext';
import { Colors, Fonts, Spacing, Type } from '../lib/theme';
import { toast } from './Toast';
import { TimelineCell } from './Timeline';
import { formatDate } from '../lib/formatDate';

type Props = {
  visible: boolean;
  participantId: string;
  participantName?: string;
  onClose: () => void;
  onLogged?: (result: any) => void;
  fullScreen?: boolean;
  /** When true, render inline (no Modal wrapper) so the outer BackHeader stays. */
  inline?: boolean;
  onDirtyChange?: (dirty: boolean) => void;
};

// ─────────────────────────────────────────────────────────────────────────
// Category grouping — matches web copy ("Residential & location", etc.)
// ─────────────────────────────────────────────────────────────────────────
const CATEGORY_ORDER = [
  'assessment', 'care_pathway', 'living', 'safeguarding', 'financial',
  'supporters', 'provider', 'statements', 'at_hm', 'policy', 'identity', 'other',
] as const;

const CATEGORY_LABELS: Record<string, string> = {
  assessment: 'Classification & assessment',
  care_pathway: 'Care pathway',
  living: 'Residential & location',
  safeguarding: 'Safeguarding',
  financial: 'Financial & means',
  supporters: 'Supporters & legal',
  provider: 'Provider & services',
  statements: 'Statements & budget',
  at_hm: 'AT & home modifications',
  policy: 'Policy & indexation',
  identity: 'Identity & consent',
  other: 'Other',
};

const KEY_TO_CATEGORY: Record<string, string> = {
  assessment_completed: 'assessment', assessment_appealed: 'assessment',
  classification_changed: 'assessment', reassessment_requested: 'assessment',
  reassessment_completed: 'assessment', interim_funding_started: 'assessment',
  restorative_pathway_started: 'care_pathway', restorative_pathway_ended: 'care_pathway',
  eol_pathway_started: 'care_pathway', eol_pathway_extended: 'care_pathway',
  hospitalised: 'care_pathway', discharged_from_hospital: 'care_pathway',
  entered_respite: 'care_pathway', left_respite: 'care_pathway', deceased: 'care_pathway',
  moved_to_residential: 'living', moved_overseas_temporarily: 'living',
  returned_from_overseas: 'living', moved_to_remote_area: 'living',
  moved_to_mps_area: 'living', natural_disaster_affecting_home: 'living',
  missing_person: 'living',
  capacity_concern_raised: 'safeguarding', safeguarding_concern_raised: 'safeguarding',
  elder_abuse_disclosed: 'safeguarding', financial_abuse_disclosed: 'safeguarding',
  scam_or_fraud_disclosed: 'safeguarding',
  services_australia_letter_received: 'financial', means_not_disclosed: 'financial',
  pension_status_changed: 'financial', hardship_granted: 'financial',
  lifetime_cap_reached: 'financial', time_limited_cap_reached: 'financial',
  cshc_acquired: 'financial', cshc_lost: 'financial',
  registered_supporter_added: 'supporters', epoa_registered: 'supporters',
  guardian_appointed: 'supporters', public_trustee_appointed: 'supporters',
  caregiver_added: 'supporters', caregiver_removed: 'supporters',
  provider_changed: 'provider', provider_cease_notified: 'provider',
  provider_deregistered: 'provider', service_paused: 'provider',
  service_resumed: 'provider', branch_transfer_notified: 'provider',
  switching_provider_started: 'provider',
  statement_received: 'statements', care_management_over_cap: 'statements',
  wrong_stream_billing: 'statements', backdated_adjustment: 'statements',
  quarter_end_underspend_risk: 'statements', budget_exhaustion_projected: 'statements',
  supplement_granted: 'statements',
  at_hm_approved: 'at_hm', at_hm_purchased: 'at_hm', at_hm_expiring: 'at_hm',
  policy_personal_care_free_2026: 'policy', policy_price_caps_deferred_2026: 'policy',
  policy_eol_round2_2027: 'policy', policy_chsp_transition: 'policy',
  indexation_classification: 'policy', indexation_cap: 'policy',
  identity_change: 'identity', consent_withdrawn: 'identity',
  referral_code_issued: 'identity', referral_code_expired: 'identity',
};

const WORKFLOW_KEYS = ['reassessment', 'hospitalisation', 'death'] as const;

// Short body previews for the workflow cards. Fall back to schema.intro if the
// backend ships tighter copy in the future.
const WORKFLOW_TEASERS: Record<string, string> = {
  reassessment: 'A reassessment can be requested when needs have changed since the last classification…',
  hospitalisation: 'When a participant is admitted to hospital, Support at Home services pause…',
  death: 'We are sorry. There is no rush, these steps can be done in your own time…',
};

// Convert an ISO YYYY-MM-DD to DD/MM/YYYY for display, without touching the
// underlying state string. Returns the raw value unchanged if it doesn't match.
function isoToDDMMYYYY(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  return `${m[3]}/${m[2]}/${m[1]}`;
}

// Accept DD/MM/YYYY typed by the user and convert back to ISO for the API.
function ddmmyyyyToIso(txt: string): string | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(txt.trim());
  if (!m) return null;
  const [, dd, mm, yyyy] = m;
  const d = new Date(Number(yyyy), Number(mm) - 1, Number(dd));
  if (Number.isNaN(d.getTime())) return null;
  return `${yyyy}-${mm}-${dd}`;
}

function todayISO(): string {
  const d = new Date();
  const pad = (n: number) => (n < 10 ? `0${n}` : String(n));
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * Bottom-sheet single-select. Kept in this file to avoid pulling in a new
 * dependency for a screen-specific dropdown.
 */
function SelectField({
  label, value, placeholder, options, onChange, testID,
}: {
  label: string;
  value: string;
  placeholder: string;
  options: Array<{ value: string; label: string }>;
  onChange: (v: string) => void;
  testID?: string;
}) {
  const [open, setOpen] = useState(false);
  const selected = options.find((o) => o.value === value);
  return (
    <View style={styles.fieldWrap}>
      <Text style={styles.fieldLbl}>{label}</Text>
      <TouchableOpacity
        onPress={() => setOpen(true)}
        style={styles.selectBtn}
        activeOpacity={0.75}
        testID={testID}
      >
        <Text style={selected ? styles.selectText : styles.selectPlaceholder}>
          {selected ? selected.label : placeholder}
        </Text>
        <Ionicons name="chevron-down" size={18} color={Colors.textMuted} />
      </TouchableOpacity>
      <Modal transparent visible={open} animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.pickerBackdrop} onPress={() => setOpen(false)}>
          <Pressable style={styles.pickerSheet} onPress={() => { /* eat */ }}>
            <View style={styles.pickerHead}>
              <Text style={styles.pickerTitle}>{label}</Text>
              <TouchableOpacity onPress={() => setOpen(false)} hitSlop={8}>
                <Ionicons name="close" size={22} color={Colors.textPrimary} />
              </TouchableOpacity>
            </View>
            <ScrollView style={{ maxHeight: 380 }}>
              {options.map((o) => (
                <TouchableOpacity
                  key={o.value}
                  onPress={() => { onChange(o.value); setOpen(false); }}
                  style={[styles.pickerRow, o.value === value && styles.pickerRowActive]}
                  testID={`${testID}-opt-${o.value}`}
                >
                  <Text style={[styles.pickerRowText, o.value === value && styles.pickerRowTextActive]}>{o.label}</Text>
                  {o.value === value && <Ionicons name="checkmark" size={16} color={Colors.brandPrimary} />}
                </TouchableOpacity>
              ))}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

export function LogScenarioSheet({
  visible, participantId, participantName, onClose, onLogged, inline, onDirtyChange,
}: Props) {
  const router = useRouter();
  const { schema, logEvent, getTimeline } = useScenario();
  const [category, setCategory] = useState<string>('');
  const [eventKey, setEventKey] = useState<string>('');
  const [dateIso, setDateIso] = useState(() => todayISO());
  const [dateText, setDateText] = useState(() => isoToDDMMYYYY(todayISO()));
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [recentItems, setRecentItems] = useState<any[]>([]);
  const [recentLoading, setRecentLoading] = useState(true);
  const [lifecycleState, setLifecycleState] = useState<string>('');

  const types = schema?.events?.types || [];
  const currentStatus = (lifecycleState || 'ACTIVE').toUpperCase();

  // Categories that actually have at least one event in this schema.
  const categoryOptions = useMemo(() => {
    const present = new Set<string>();
    for (const t of types) {
      present.add(t.category || KEY_TO_CATEGORY[t.key] || 'other');
    }
    return CATEGORY_ORDER.filter((k) => present.has(k))
      .map((k) => ({ value: k, label: CATEGORY_LABELS[k] }));
  }, [types]);

  // Events filtered by the chosen category.
  const eventOptions = useMemo(() => {
    if (!category) return [];
    return types
      .filter((t) => (t.category || KEY_TO_CATEGORY[t.key] || 'other') === category)
      .map((t) => ({ value: t.key, label: t.label }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [types, category]);

  const dirty = !!(category || eventKey || note.trim());
  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);

  useEffect(() => {
    // Reset the What-happened value when the category changes.
    if (eventKey) {
      const meta = types.find((t) => t.key === eventKey);
      if (meta) {
        const eventCategory = meta.category || KEY_TO_CATEGORY[meta.key] || 'other';
        if (eventCategory !== category) setEventKey('');
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [category]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setRecentLoading(true);
        const r = await getTimeline(participantId, 5);
        if (cancelled) return;
        setRecentItems(r?.items || []);
        setLifecycleState((r?.lifecycle_state || 'ACTIVE').toString());
      } catch (e: any) {
        if (!cancelled) setRecentItems([]);
        if (__DEV__) console.warn('[LogScenario] recent fetch failed:', e?.message || e);
      } finally { if (!cancelled) setRecentLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [participantId, getTimeline]);

  const onDateChange = (t: string) => {
    setDateText(t);
    const iso = ddmmyyyyToIso(t);
    if (iso) setDateIso(iso);
  };

  async function submit() {
    if (!eventKey) { Alert.alert('Pick an event', 'Please choose "What happened" before logging.'); return; }
    setBusy(true);
    try {
      const res = await logEvent(participantId, {
        event_type: eventKey,
        effective_date: dateIso,
        note: note.trim() || undefined,
      });
      toast.success('Event logged to the timeline');
      // Reset form so the next scenario capture starts clean.
      setCategory(''); setEventKey(''); setNote('');
      setDateIso(todayISO()); setDateText(isoToDDMMYYYY(todayISO()));
      // Refresh the recent-events strip.
      try {
        const r = await getTimeline(participantId, 5);
        setRecentItems(r?.items || []);
        setLifecycleState((r?.lifecycle_state || 'ACTIVE').toString());
      } catch { /* noop */ }
      onLogged?.(res);
    } catch (e: any) {
      Alert.alert('Could not log event', e?.response?.data?.detail || e?.message || 'Please try again.');
    } finally { setBusy(false); }
  }

  const content = (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={20}
      style={{ flex: 1 }}
    >
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: Spacing.md, paddingBottom: 120, gap: Spacing.lg }}
        keyboardShouldPersistTaps="handled"
      >
        {/* 1 · Page hero */}
        <View style={styles.heroBlock}>
          <Text style={styles.h1}>Log a Scenario</Text>
          <Text style={styles.subhero}>
            Walk through a real situation step by step, with Wayly explaining what to do and why.
          </Text>
        </View>

        {/* 2 · Intro card */}
        <View style={styles.introCard}>
          <Text style={styles.introBody}>
            Life happens, and sometimes the next step in Support at Home is not obvious. The guided
            workflows below take you through the most common situations a caregiver runs into. Each
            one explains what is happening, what you need to prepare, and what to expect next. You
            can pause and come back any time, switch to a different workflow, or cancel without
            losing your notes.
          </Text>
        </View>

        {/* 3 · Current status */}
        <View style={styles.statusCard}>
          <Text style={styles.overline}>Current status</Text>
          <Text style={styles.statusValue}>{currentStatus}</Text>
        </View>

        {/* 4 · Guided workflows */}
        <View style={{ gap: Spacing.sm }}>
          <View style={styles.sectionHeadRow}>
            <Ionicons name="help-buoy-outline" size={18} color={Colors.brandPrimary} />
            <Text style={styles.sectionTitle}>Guided Workflows</Text>
          </View>
          <Text style={styles.sectionSub}>
            Step-by-step prompts for the moments that matter. Each step captures the right event on the timeline.
          </Text>
          <View style={styles.wfGrid}>
            {WORKFLOW_KEYS.map((wfKey) => {
              const wf = schema?.workflows?.[wfKey];
              if (!wf) return null;
              return (
                <TouchableOpacity
                  key={wfKey}
                  style={styles.wfCard}
                  onPress={() => router.push({ pathname: '/workflows/[key]', params: { key: wfKey } } as any)}
                  activeOpacity={0.85}
                  testID={`workflow-card-${wfKey}`}
                >
                  <Ionicons name="help-buoy-outline" size={16} color={Colors.brandPrimary} />
                  <Text style={styles.wfTitle}>{wf.label}</Text>
                  <Text style={styles.wfBody} numberOfLines={4}>
                    {WORKFLOW_TEASERS[wfKey] || wf.intro}
                  </Text>
                  <View style={styles.wfStart}>
                    <Text style={styles.wfStartText}>Start</Text>
                    <Ionicons name="chevron-forward" size={13} color={Colors.brandPrimary} />
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {/* 5 · Freeform log-an-event form */}
        <View style={styles.formCard}>
          <SelectField
            label="Category"
            value={category}
            placeholder="Choose a category…"
            options={categoryOptions}
            onChange={setCategory}
            testID="scenario-category"
          />
          <SelectField
            label="What happened"
            value={eventKey}
            placeholder="Pick an event…"
            options={eventOptions}
            onChange={setEventKey}
            testID="scenario-what-happened"
          />
          <View style={styles.fieldWrap}>
            <Text style={styles.fieldLbl}>When did this happen?</Text>
            <View style={styles.dateFieldRow}>
              <TextInput
                value={dateText}
                onChangeText={onDateChange}
                placeholder="DD/MM/YYYY"
                placeholderTextColor={Colors.textMuted}
                style={styles.dateInput}
                keyboardType="number-pad"
                testID="scenario-date-input"
              />
              <Ionicons name="calendar-outline" size={18} color={Colors.textMuted} />
            </View>
          </View>
          <View style={styles.fieldWrap}>
            <Text style={styles.fieldLbl}>Note (optional)</Text>
            <TextInput
              value={note}
              onChangeText={setNote}
              placeholder="e.g. admitted to RPA Saturday morning, expected discharge midweek"
              placeholderTextColor={Colors.textMuted}
              style={styles.noteInput}
              multiline
              numberOfLines={3}
              testID="scenario-note-input"
            />
          </View>
          <TouchableOpacity
            style={[styles.primaryBtn, (!eventKey || busy) && styles.primaryBtnDisabled]}
            onPress={submit}
            disabled={!eventKey || busy}
            testID="scenario-log-event-btn"
            activeOpacity={0.85}
          >
            <Ionicons name="arrow-forward" size={15} color="#FFFFFF" />
            <Text style={styles.primaryBtnText}>{busy ? 'Logging…' : 'Log this event'}</Text>
          </TouchableOpacity>
        </View>

        {/* 6 · Recent events */}
        <View style={{ gap: Spacing.xs }}>
          <Text style={styles.recentTitle}>Recent events</Text>
          {recentLoading ? (
            <Text style={styles.recentEmpty}>Loading…</Text>
          ) : recentItems.length === 0 ? (
            <Text style={styles.recentEmpty}>Nothing logged yet.</Text>
          ) : (
            recentItems.map((it, idx) => (
              <TimelineCell key={`${it.type}-${idx}-${it.at}`} item={it} />
            ))
          )}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );

  if (inline) return content;

  return (
    <Modal
      visible={visible}
      onRequestClose={onClose}
      animationType="slide"
      presentationStyle={Platform.OS === 'ios' ? 'pageSheet' : undefined}
    >
      {content}
    </Modal>
  );
}

// Also export the display helper for tests / other screens if needed.
export { isoToDDMMYYYY, ddmmyyyyToIso, formatDate };

const styles = StyleSheet.create({
  heroBlock: { gap: 6 },
  h1: {
    fontFamily: Fonts.heading, fontSize: 30, color: Colors.brandPrimary,
    letterSpacing: -0.4, lineHeight: 36,
  },
  subhero: { fontFamily: Fonts.body, fontSize: 14, color: Colors.textSecondary, lineHeight: 20 },

  introCard: {
    padding: 16, borderRadius: 14,
    backgroundColor: Colors.cardBg, borderWidth: 1, borderColor: Colors.border,
  },
  introBody: { fontFamily: Fonts.body, fontSize: 13.5, color: Colors.textSecondary, lineHeight: 20 },

  statusCard: {
    padding: 16, borderRadius: 14, gap: 6,
    backgroundColor: Colors.cardBg, borderWidth: 1, borderColor: Colors.border,
  },
  overline: {
    fontFamily: Fonts.bodyMed, fontSize: 11, letterSpacing: 1.5,
    textTransform: 'uppercase', color: Colors.textMuted,
  },
  statusValue: {
    fontFamily: Fonts.bodySemi, fontSize: 18, color: Colors.textPrimary, letterSpacing: 0.3,
  },

  sectionHeadRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  sectionTitle: { fontFamily: Fonts.heading, fontSize: 20, color: Colors.brandPrimary, letterSpacing: -0.2 },
  sectionSub: { fontFamily: Fonts.body, fontSize: 13, color: Colors.textSecondary, lineHeight: 19 },

  wfGrid: { gap: 12, marginTop: 4 },
  wfCard: {
    padding: 16, borderRadius: 14, gap: 8,
    backgroundColor: Colors.cardBg, borderWidth: 1, borderColor: Colors.border,
  },
  wfTitle: { fontFamily: Fonts.heading, fontSize: 20, color: Colors.brandPrimary, letterSpacing: -0.2, lineHeight: 24 },
  wfBody: { fontFamily: Fonts.body, fontSize: 13, color: Colors.textSecondary, lineHeight: 19 },
  wfStart: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 },
  wfStartText: { fontFamily: Fonts.bodySemi, fontSize: 13, color: Colors.brandPrimary },

  formCard: {
    padding: 16, borderRadius: 14, gap: 14,
    backgroundColor: Colors.cardBg, borderWidth: 1, borderColor: Colors.border,
  },
  fieldWrap: { gap: 6 },
  fieldLbl: {
    fontFamily: Fonts.bodyMed, fontSize: 11, letterSpacing: 1.4,
    textTransform: 'uppercase', color: Colors.textMuted,
  },
  selectBtn: {
    borderWidth: 1, borderColor: Colors.border, borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 12,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: Colors.background,
  },
  selectText: { fontFamily: Fonts.body, color: Colors.textPrimary, fontSize: 14 },
  selectPlaceholder: { fontFamily: Fonts.body, color: Colors.textMuted, fontSize: 14 },
  dateFieldRow: {
    borderWidth: 1, borderColor: Colors.border, borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 8,
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: Colors.background,
  },
  dateInput: { flex: 1, fontFamily: Fonts.body, color: Colors.textPrimary, fontSize: 14, paddingVertical: 4 },
  noteInput: {
    borderWidth: 1, borderColor: Colors.border, borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 10,
    fontFamily: Fonts.body, color: Colors.textPrimary, fontSize: 14,
    minHeight: 72, textAlignVertical: 'top', backgroundColor: Colors.background,
  },
  primaryBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    paddingVertical: 12, paddingHorizontal: 20, borderRadius: 9999,
    backgroundColor: Colors.brandSecondary, alignSelf: 'flex-start',
  },
  primaryBtnDisabled: { opacity: 0.55 },
  primaryBtnText: { fontFamily: Fonts.bodySemi, color: '#FFFFFF', fontSize: 14, letterSpacing: 0.2 },

  recentTitle: {
    fontFamily: Fonts.heading, fontSize: 20, color: Colors.brandPrimary,
    letterSpacing: -0.2, marginTop: 4,
  },
  recentEmpty: { fontFamily: Fonts.body, fontSize: 13, color: Colors.textSecondary, marginTop: 4 },

  // Modal picker
  pickerBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  pickerSheet: {
    backgroundColor: Colors.cardBg, borderTopLeftRadius: 20, borderTopRightRadius: 20,
    padding: 16, gap: 6, maxHeight: '75%',
  },
  pickerHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingBottom: 8 },
  pickerTitle: { fontFamily: Fonts.bodySemi, fontSize: 15, color: Colors.textPrimary },
  pickerRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 12, paddingHorizontal: 8, borderRadius: 10,
  },
  pickerRowActive: { backgroundColor: 'rgba(14,77,82,0.06)' },
  pickerRowText: { fontFamily: Fonts.body, fontSize: 14, color: Colors.textPrimary, flex: 1 },
  pickerRowTextActive: { color: Colors.brandPrimary, fontFamily: Fonts.bodySemi },
});
