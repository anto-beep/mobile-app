// LogScenarioSheet — mirrors ScenarioCapture.jsx on web. Type picker grouped
// by category, dynamic payload fields, posts to the events endpoint, shows
// transition outcome inline.
import React, { useMemo, useState } from 'react';
import { Alert, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useScenario } from '../context/ScenarioContext';
import { Colors, Fonts, Radius, Spacing, Type } from '../lib/theme';
import { toast } from './Toast';
import { ContactCard, BoundaryChip } from './Timeline';

type Props = {
  visible: boolean;
  participantId: string;
  participantName?: string;
  onClose: () => void;
  onLogged?: (result: any) => void;
  /** When true, fill the screen instead of rendering as a bottom sheet. */
  fullScreen?: boolean;
  /** When true, render inline (no Modal wrapper). Used by /log-scenario route
   *  so that the BackHeader/WaylyHeader stays visible above the form. */
  inline?: boolean;
  /** Exposes the "dirty" flag so the parent can show its own cancel-confirm. */
  onDirtyChange?: (dirty: boolean) => void;
};

/** Imperative-style ref interface so the parent route can drive close-flow
 *  decisions (cancel-confirm dialog when the user has unsaved edits). */
export type LogScenarioHandle = {
  attemptClose: () => void;
  isDirty: () => boolean;
};

// ─────────────────────────────────────────────────────────────────────────
// Client-side categorization
//
// Production `GET /api/scenario/schema` currently returns `category: null` for
// every event type, so if we simply pass that through the UI lumps all 60+
// events into a single "OTHER" section. Mirror the web app grouping by
// mapping each event `key` to a human category. Kept next to the component so
// it lives with the rest of the scenario UI copy and is easy to tweak.
// ─────────────────────────────────────────────────────────────────────────
const CATEGORY_ORDER = [
  'assessment',
  'care_pathway',
  'living',
  'safeguarding',
  'financial',
  'supporters',
  'provider',
  'statements',
  'at_hm',
  'policy',
  'identity',
  'other',
] as const;

const CATEGORY_LABELS: Record<string, string> = {
  assessment: 'Assessment & Classification',
  care_pathway: 'Care Pathways & Health',
  living: 'Living Situation',
  safeguarding: 'Safeguarding & Capacity',
  financial: 'Financial & Means',
  supporters: 'Supporters & Legal',
  provider: 'Provider & Services',
  statements: 'Statements & Budget',
  at_hm: 'Assistive Technology & Home Modifications',
  policy: 'Policy & Indexation',
  identity: 'Identity, Consent & Referrals',
  other: 'Other',
};

const KEY_TO_CATEGORY: Record<string, string> = {
  // Assessment & Classification
  assessment_completed: 'assessment',
  assessment_appealed: 'assessment',
  classification_changed: 'assessment',
  reassessment_requested: 'assessment',
  reassessment_completed: 'assessment',
  interim_funding_started: 'assessment',
  // Care pathway
  restorative_pathway_started: 'care_pathway',
  restorative_pathway_ended: 'care_pathway',
  eol_pathway_started: 'care_pathway',
  eol_pathway_extended: 'care_pathway',
  hospitalised: 'care_pathway',
  discharged_from_hospital: 'care_pathway',
  entered_respite: 'care_pathway',
  left_respite: 'care_pathway',
  deceased: 'care_pathway',
  // Living
  moved_to_residential: 'living',
  moved_overseas_temporarily: 'living',
  returned_from_overseas: 'living',
  moved_to_remote_area: 'living',
  moved_to_mps_area: 'living',
  natural_disaster_affecting_home: 'living',
  missing_person: 'living',
  // Safeguarding
  capacity_concern_raised: 'safeguarding',
  safeguarding_concern_raised: 'safeguarding',
  elder_abuse_disclosed: 'safeguarding',
  financial_abuse_disclosed: 'safeguarding',
  scam_or_fraud_disclosed: 'safeguarding',
  // Financial
  services_australia_letter_received: 'financial',
  means_not_disclosed: 'financial',
  pension_status_changed: 'financial',
  hardship_granted: 'financial',
  lifetime_cap_reached: 'financial',
  time_limited_cap_reached: 'financial',
  cshc_acquired: 'financial',
  cshc_lost: 'financial',
  // Supporters
  registered_supporter_added: 'supporters',
  epoa_registered: 'supporters',
  guardian_appointed: 'supporters',
  public_trustee_appointed: 'supporters',
  caregiver_added: 'supporters',
  caregiver_removed: 'supporters',
  // Provider
  provider_changed: 'provider',
  provider_cease_notified: 'provider',
  provider_deregistered: 'provider',
  service_paused: 'provider',
  service_resumed: 'provider',
  branch_transfer_notified: 'provider',
  switching_provider_started: 'provider',
  // Statements & Budget
  statement_received: 'statements',
  care_management_over_cap: 'statements',
  wrong_stream_billing: 'statements',
  backdated_adjustment: 'statements',
  quarter_end_underspend_risk: 'statements',
  budget_exhaustion_projected: 'statements',
  supplement_granted: 'statements',
  // AT-HM
  at_hm_approved: 'at_hm',
  at_hm_purchased: 'at_hm',
  at_hm_expiring: 'at_hm',
  // Policy
  policy_personal_care_free_2026: 'policy',
  policy_price_caps_deferred_2026: 'policy',
  policy_eol_round2_2027: 'policy',
  policy_chsp_transition: 'policy',
  indexation_classification: 'policy',
  indexation_cap: 'policy',
  // Identity, consent, referrals
  identity_change: 'identity',
  consent_withdrawn: 'identity',
  referral_code_issued: 'identity',
  referral_code_expired: 'identity',
};

function deriveCategory(key: string): string | null {
  return KEY_TO_CATEGORY[key] || null;
}

export function LogScenarioSheet({ visible, participantId, participantName, onClose, onLogged, fullScreen, inline, onDirtyChange }: Props) {
  const { schema, logEvent } = useScenario();
  const [eventKey, setEventKey] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [payload, setPayload] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [query, setQuery] = useState('');

  const types = schema?.events?.types || [];
  const grouped = useMemo(() => {
    // Filter by search first.
    const q = query.trim().toLowerCase();
    const filtered = q
      ? types.filter((t) => t.label.toLowerCase().includes(q) || t.key.toLowerCase().includes(q))
      : types;
    const m: Record<string, typeof types> = {};
    for (const t of filtered) {
      // Prefer server-provided category; otherwise fall back to a client-side
      // mapping so the UI doesn't dump everything under "OTHER" (production
      // currently returns `category: null` for every event type).
      const k = (t.category || deriveCategory(t.key) || 'other').toString();
      (m[k] = m[k] || []).push(t);
    }
    // Preserve the display order defined in CATEGORY_ORDER; unknown categories
    // are appended alphabetically at the end.
    const ordered: Array<[string, typeof types]> = [];
    for (const cat of CATEGORY_ORDER) if (m[cat]) ordered.push([cat, m[cat]]);
    for (const cat of Object.keys(m).sort()) if (!CATEGORY_ORDER.includes(cat)) ordered.push([cat, m[cat]]);
    return ordered;
  }, [types, query]);
  const selected = types.find((t) => t.key === eventKey);

  function reset() { setEventKey(null); setNote(''); setPayload({}); setResult(null); setDate(new Date().toISOString().slice(0, 10)); }

  // Dirty tracking — has the user typed anything that would be lost on close?
  const initialDate = React.useRef(date).current;
  const dirty = !!eventKey || !!note.trim() || Object.values(payload).some((v) => !!v && v.trim().length > 0) || date !== initialDate;
  React.useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);

  function requestClose() {
    if (!dirty) { reset(); onClose(); return; }
    Alert.alert(
      'Discard this entry?',
      "You have started capturing a scenario. If you close now your draft will be cleared.",
      [
        { text: 'Keep editing', style: 'cancel' },
        { text: 'Discard', style: 'destructive', onPress: () => { reset(); onClose(); } },
      ],
    );
  }

  async function submit() {
    if (!eventKey) { Alert.alert('Pick an event type first'); return; }
    setBusy(true);
    try {
      const body: any = { event_type: eventKey, effective_date: date, note: note.trim() || undefined };
      const keys = (selected?.payload_keys || []) as any[];
      if (keys.length > 0) {
        const p: Record<string, any> = {};
        for (const k of keys) {
          const key = typeof k === 'string' ? k : k.key;
          if (payload[key]) p[key] = payload[key];
        }
        if (Object.keys(p).length > 0) body.payload = p;
      }
      const r = await logEvent(participantId, body);
      setResult(r);
      const ts = r?.event?.proposed?.transition_status;
      if (ts === 'blocked') {
        toast.warning('Transition blocked, the engine kept the participant in their current state.', 5500);
      } else if (ts === 'applied') {
        toast.success('Event logged');
      } else {
        toast.success('Event captured');
      }
      onLogged?.(r);
    } catch (e: any) {
      Alert.alert('Could not log event', e?.response?.data?.detail || e?.message || 'Try again');
    } finally { setBusy(false); }
  }

  const content = (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={20} style={(fullScreen || inline) ? { flex: 1 } : undefined}>
      {!fullScreen && !inline && <View style={styles.handle} />}
      {!inline && (
        <View style={styles.head}>
          <Text style={[Type.h3 as any, { color: Colors.textPrimary }]}>Log a scenario</Text>
          <TouchableOpacity onPress={requestClose} hitSlop={10}><Ionicons name="close" size={22} color={Colors.textPrimary} /></TouchableOpacity>
        </View>
      )}
      {!!participantName && <Text style={styles.sub}>For {participantName}</Text>}
      {grouped.length === 0 && !eventKey ? (
        <View style={styles.emptySchema}>
          <Ionicons name="cloud-offline-outline" size={28} color={Colors.textMuted} />
          <Text style={styles.emptyTitle}>Scenario library unavailable</Text>
          <Text style={styles.emptyBody}>We couldn&apos;t load the list of scenarios from the server. Please pull to refresh, or try again in a moment.</Text>
        </View>
      ) : (
      <ScrollView style={styles.scroll} contentContainerStyle={{ paddingBottom: 24 }} keyboardShouldPersistTaps="handled">
        {!eventKey ? (
          <View style={{ gap: 12 }}>
            <Text style={styles.lbl}>Event type</Text>
            <View style={styles.searchWrap}>
              <Ionicons name="search-outline" size={16} color={Colors.textMuted} />
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder="Search scenarios"
                placeholderTextColor={Colors.textMuted}
                style={styles.searchInput}
                testID="scenario-search"
                autoCorrect={false}
              />
              {!!query && (
                <TouchableOpacity onPress={() => setQuery('')} hitSlop={8} testID="scenario-search-clear">
                  <Ionicons name="close-circle" size={16} color={Colors.textMuted} />
                </TouchableOpacity>
              )}
            </View>
            {grouped.length === 0 ? (
              <Text style={styles.noResults}>No scenarios match &ldquo;{query}&rdquo;.</Text>
            ) : grouped.map(([cat, items]) => (
              <View key={cat} style={{ gap: 6 }}>
                <Text style={styles.cat}>{(CATEGORY_LABELS[cat] || cat).toUpperCase()}</Text>
                <View style={styles.chipWrap}>
                  {items.map((t) => (
                    <TouchableOpacity key={t.key} testID={`event-type-${t.key}`} onPress={() => setEventKey(t.key)} style={styles.chip}>
                      <Text style={styles.chipText}>{t.label}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            ))}
          </View>
        ) : (
          <View style={{ gap: 12 }}>
            <TouchableOpacity onPress={() => setEventKey(null)} style={styles.backRow} hitSlop={6}>
              <Ionicons name="arrow-back" size={16} color={Colors.brandPrimary} />
              <Text style={styles.backText}>Change event type</Text>
            </TouchableOpacity>
            <Text style={[Type.h3 as any, { color: Colors.textPrimary }]}>{selected?.label}</Text>
            <Text style={styles.lbl}>Effective date</Text>
            <TextInput value={date} onChangeText={setDate} placeholder="YYYY-MM-DD" placeholderTextColor={Colors.textMuted} style={styles.input} testID="effective-date" />
            {(selected?.payload_keys || []).map((k: any) => {
              const key = typeof k === 'string' ? k : k.key;
              const label = typeof k === 'string' ? key.replace(/_/g, ' ') : (k.label || key);
              return (
                <View key={key} style={{ gap: 4 }}>
                  <Text style={styles.lbl}>{label}</Text>
                  <TextInput
                    value={payload[key] || ''}
                    onChangeText={(v) => setPayload((p) => ({ ...p, [key]: v }))}
                    placeholder={label}
                    placeholderTextColor={Colors.textMuted}
                    style={styles.input}
                    testID={`payload-${key}`}
                  />
                </View>
              );
            })}
            <Text style={styles.lbl}>Note (optional)</Text>
            <TextInput value={note} onChangeText={setNote} placeholder="Anything else to capture?" placeholderTextColor={Colors.textMuted} style={[styles.input, { minHeight: 70 }]} multiline testID="event-note" />
            <TouchableOpacity onPress={submit} disabled={busy} style={[styles.submit, busy && { opacity: 0.6 }]} testID="submit-event">
              <Text style={styles.submitText}>{busy ? 'Logging…' : 'Log event'}</Text>
            </TouchableOpacity>
            {!!result?.event && (
              <View style={styles.resultBox} testID="event-result">
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                  <Text style={styles.resultLbl}>Status:</Text>
                  <Text style={styles.resultVal}>{result.event.proposed?.transition_status || '—'}</Text>
                  <BoundaryChip boundary={result.event.advice_boundary || 'SAFE_TO_EXPLAIN'} />
                </View>
                {!!result.event.proposed?.lifecycle_transition && (
                  <Text style={styles.resultMeta}>Transition: {result.event.proposed.lifecycle_transition}</Text>
                )}
                {!!result.event.advice_boundary && result.event.advice_boundary !== 'SAFE_TO_EXPLAIN' && Array.isArray(result.event.route_out_contacts) && result.event.route_out_contacts.length > 0 && (
                  <ContactCard boundary={result.event.advice_boundary} contactKeys={result.event.route_out_contacts} />
                )}
              </View>
            )}
          </View>
        )}
        <View style={{ height: 40 }} />
      </ScrollView>
      )}
    </KeyboardAvoidingView>
  );

  if (inline) {
    // Render inline (e.g. inside a route page that already shows BackHeader).
    return <View style={styles.inlineWrap}>{content}</View>;
  }

  return (
    <Modal visible={visible} transparent={!fullScreen} animationType={fullScreen ? 'fade' : 'slide'} onRequestClose={requestClose}>
      <Pressable style={fullScreen ? styles.fullBg : styles.backdrop} onPress={fullScreen ? undefined : requestClose}>
        <Pressable style={fullScreen ? styles.fullSheet : styles.sheet} onPress={(e) => e.stopPropagation()}>
          {content}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(14,30,32,0.55)', justifyContent: 'flex-end' },
  fullBg: { flex: 1, backgroundColor: Colors.bg },
  inlineWrap: { flex: 1, backgroundColor: Colors.bg, paddingHorizontal: Spacing.lg, paddingTop: 4 },
  sheet: { backgroundColor: Colors.cardBg, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: Spacing.lg, paddingBottom: 20, maxHeight: '92%' },
  fullSheet: { flex: 1, backgroundColor: Colors.bg, padding: Spacing.lg, paddingTop: Spacing.md },
  emptySchema: { alignItems: 'center', gap: 8, paddingVertical: 40, paddingHorizontal: 12 },
  emptyTitle: { fontFamily: Fonts.bodySemi, fontSize: 15, color: Colors.brandPrimary, marginTop: 4 },
  emptyBody: { fontFamily: Fonts.body, fontSize: 12, color: Colors.textSecondary, textAlign: 'center', lineHeight: 18 },
  handle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 999, backgroundColor: '#D3C9BB' },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 10 },
  sub: { ...Type.caption, color: Colors.textSecondary, marginTop: 2 },
  scroll: { marginTop: 10 },
  lbl: { ...Type.caption, color: Colors.textSecondary, fontFamily: Fonts.bodySemi, textTransform: 'uppercase', letterSpacing: 0.6 },
  cat: { ...Type.caption, color: Colors.textMuted, fontFamily: Fonts.bodySemi, marginTop: 4 },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { backgroundColor: 'rgba(14,77,82,0.07)', borderRadius: 9999, paddingHorizontal: 12, paddingVertical: 8 },
  chipText: { color: Colors.brandPrimary, fontFamily: Fonts.bodySemi, fontSize: 13 },
  searchWrap: { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderColor: Colors.border, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: Colors.cardBg },
  searchInput: { flex: 1, fontFamily: Fonts.body, color: Colors.textPrimary, fontSize: 14, paddingVertical: 2 },
  noResults: { fontFamily: Fonts.body, fontSize: 13, color: Colors.textSecondary, paddingVertical: 12, textAlign: 'center' },
  input: { borderWidth: 1, borderColor: Colors.border, borderRadius: 10, padding: 12, fontFamily: Fonts.body, color: Colors.textPrimary },
  backRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  backText: { color: Colors.brandPrimary, fontFamily: Fonts.bodySemi, fontWeight: '700' },
  submit: { backgroundColor: Colors.brandPrimary, padding: 14, borderRadius: 9999, alignItems: 'center', marginTop: 4 },
  submitText: { color: '#fff', fontFamily: Fonts.bodySemi, fontWeight: '700' },
  resultBox: { backgroundColor: 'rgba(14,77,82,0.05)', borderRadius: 12, padding: 12, gap: 6, marginTop: 4 },
  resultLbl: { fontFamily: Fonts.bodySemi, color: Colors.textPrimary, fontSize: 13 },
  resultVal: { color: Colors.brandPrimary, fontFamily: Fonts.bodySemi, fontWeight: '700' },
  resultMeta: { ...Type.caption, color: Colors.textSecondary },
});
