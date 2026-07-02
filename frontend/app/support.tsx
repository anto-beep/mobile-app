// Support — mobile parity with /support on the web app.
//
// Top-level view: list of tickets the user has raised. Tap a row to open
// the detail view (/support/[id]). Tap "Raise a New Ticket" to open a
// bottom-sheet form that POSTs to /api/support/tickets.
//
// API endpoints (live Wayly backend):
//   GET  /api/support/tickets        → { tickets: [...] }
//   POST /api/support/tickets        → { ticket: {...} }
//
// Status pills match the web ("Received", "In progress", "Resolved", etc.).
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity,
  ActivityIndicator, RefreshControl, Modal, Pressable,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { useLocalSearchParams, useRouter } from 'expo-router';
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

type Ticket = {
  id: string;
  reference?: string;
  short_id?: string;
  tool_name?: string;
  category?: string;
  status?: string;
  created_at?: string;
  user_note?: string;
  title?: string;
};

const TOOL_OPTIONS = [
  'General Support',
  'Statement Decoder',
  'Budget Calculator',
  'Provider Price Checker',
  'Classification Self-Check',
  'Reassessment Letter',
  'Contribution Estimator',
  'Care Plan Reviewer',
  'Aged Care Q&A',
  'Account or Billing',
  'Something Else',
] as const;

const CATEGORY_OPTIONS: { key: string; label: string }[] = [
  { key: 'figure_incorrect',       label: 'A figure looks wrong' },
  { key: 'rule_misapplied',        label: 'A rule was applied that does not fit my situation' },
  { key: 'situation_not_captured', label: 'My situation was not captured' },
  { key: 'misread',                label: 'The tool misread what I entered' },
  { key: 'other',                  label: 'Something else' },
];

const SOURCE_OPTIONS: { key: string; label: string }[] = [
  { key: '',                label: 'Optional, choose one' },
  { key: 'assessor',        label: 'My assessor' },
  { key: 'official_letter', label: 'A letter or statement I received' },
  { key: 'my_aged_care',    label: 'My Aged Care' },
  { key: 'aged_care_rules', label: 'My reading of the Aged Care Rules' },
  { key: 'own_reading',     label: 'My own understanding' },
  { key: 'other',           label: 'Something else' },
];

const STATUS_PILL: Record<string, { tint: string; label: string }> = {
  received:    { tint: '#0E4D52', label: 'Received' },
  in_progress: { tint: '#C8932B', label: 'In progress' },
  awaiting:    { tint: '#6B7C92', label: 'Awaiting you' },
  resolved:    { tint: '#3A5F37', label: 'Resolved' },
  closed:      { tint: '#6B7C92', label: 'Closed' },
};

function pillFor(status?: string) {
  const k = (status || 'received').toLowerCase().replace(/\s+/g, '_');
  return STATUS_PILL[k] || { tint: '#6B7C92', label: status || 'Received' };
}

export default function SupportRoute() {
  const c = useColors();
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const params = useLocalSearchParams<{ open?: string; tool?: string }>();
  const { data, loading, refreshing, refresh } = useApi<{ tickets: Ticket[] }>('/support/tickets');

  const [composerOpen, setComposerOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  // Composer state.
  const [tool, setTool] = useState<string>('General Support');
  const [category, setCategory] = useState<string>('');
  const [correctAnswer, setCorrectAnswer] = useState('');
  const [source, setSource] = useState<string>('');
  const [note, setNote] = useState('');

  const tickets = useMemo<Ticket[]>(() => Array.isArray(data?.tickets) ? data!.tickets : [], [data]);

  // Deep-link from tool results: /support?open=1&tool=Statement%20Decoder
  useEffect(() => {
    if (params.open === '1') {
      if (params.tool && TOOL_OPTIONS.includes(String(params.tool))) setTool(String(params.tool));
      setComposerOpen(true);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.open, params.tool]);

  const reset = useCallback(() => {
    setTool('General Support'); setCategory(''); setCorrectAnswer(''); setSource(''); setNote('');
  }, []);

  const canSend = !!category;

  const submit = useCallback(async () => {
    if (!canSend) { toast.warning('Tell us what went wrong first.'); return; }
    setBusy(true);
    try {
      const body = {
        tool_name: tool,
        tool_version: 'n/a',
        tool_input: {},
        tool_output: {},
        channel: 'manual',
        category,
        user_note: note.trim() || null,
        user_claimed_answer: correctAnswer.trim() || null,
        user_claimed_source: source || null,
        user_claimed_source_detail: null,
        consent_to_share_statement: false,
        consent_text_version: null,
        statement_id: null,
      };
      const { data: res } = await api.post('/support/tickets', body);
      const tid = res?.ticket?.id || res?.id;
      setComposerOpen(false);
      reset();
      await refresh();
      toast.success('Ticket sent. We will be in touch.');
      if (tid) router.push(`/support/${tid}` as any);
    } catch (e) {
      toast.error(extractErrorMessage(e, "Could not raise the ticket"));
    } finally { setBusy(false); }
  }, [tool, category, correctAnswer, source, note, canSend, refresh, reset, router]);

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <BackHeader title="Support" />
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={c.brandPrimary} />}
      >
        <Text style={styles.hero}>My Support</Text>
        <Text style={styles.subhero}>Track tickets you have raised and read what the Wayly team has come back with.</Text>

        <TouchableOpacity style={styles.primaryCta} onPress={() => setComposerOpen(true)} testID="support-new">
          <Ionicons name="add" size={16} color="#FFFFFF" />
          <Text style={styles.primaryCtaText}>Raise a New Ticket</Text>
        </TouchableOpacity>

        {loading && tickets.length === 0 ? (
          <View style={{ paddingVertical: 32, alignItems: 'center' }}>
            <ActivityIndicator color={c.brandPrimary} />
          </View>
        ) : tickets.length === 0 ? (
          <View style={styles.empty}>
            <Ionicons name="help-buoy-outline" size={28} color={c.textMuted} />
            <Text style={styles.emptyTitle}>No tickets yet</Text>
            <Text style={styles.emptyBody}>If something looks off in any Wayly tool, raise a ticket and we will get back to you.</Text>
          </View>
        ) : (
          <View style={{ gap: 10 }}>
            {tickets.map((t) => {
              const m = pillFor(t.status);
              const ref = t.reference || t.short_id || (t.id ? `WAY-${t.id.slice(0, 4).toUpperCase()}` : '—');
              const title = t.title || t.tool_name || 'Support ticket';
              return (
                <TouchableOpacity
                  key={t.id}
                  style={styles.ticketCard}
                  onPress={() => router.push(`/support/${t.id}` as any)}
                  testID={`ticket-${t.id}`}
                >
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={styles.ticketRef}>{ref}</Text>
                    <Text style={styles.ticketTitle} numberOfLines={1}>{title}</Text>
                    <Text style={styles.ticketMeta}>Raised {t.created_at ? formatDate(t.created_at) : '—'}</Text>
                  </View>
                  <View style={[styles.pill, { backgroundColor: `${m.tint}1A` }]}>
                    <Text style={[styles.pillText, { color: m.tint }]}>{m.label}</Text>
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>
        )}

        <View style={{ height: 24 }} />
      </ScrollView>

      {/* ─── New Ticket composer (bottom-sheet modal) ────────────────── */}
      <Modal visible={composerOpen} animationType="slide" transparent onRequestClose={() => !busy && setComposerOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => !busy && setComposerOpen(false)} />
        <KeyboardAwareScrollView
          style={styles.sheet}
          contentContainerStyle={{ paddingBottom: 24 }}
          keyboardShouldPersistTaps="handled"
          bottomOffset={24}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.handle} />
          <View style={styles.sheetHead}>
            <Text style={styles.sheetTitle}>Raise a New Ticket</Text>
            <TouchableOpacity onPress={() => !busy && setComposerOpen(false)} hitSlop={10} testID="composer-close">
              <Ionicons name="close" size={22} color={c.textPrimary} />
            </TouchableOpacity>
          </View>

          <Section label="What Is This About *">
            <ChipPicker options={TOOL_OPTIONS as unknown as string[]} value={tool} onChange={setTool} testIDPrefix="tool" styles={styles} />
          </Section>

          <Section label="What Went Wrong *">
            <View style={{ gap: 8 }}>
              {CATEGORY_OPTIONS.map((o) => {
                const active = category === o.key;
                return (
                  <TouchableOpacity
                    key={o.key}
                    onPress={() => setCategory(o.key)}
                    style={[styles.radioRow, active && styles.radioRowActive]}
                    testID={`category-${o.key}`}
                  >
                    <Ionicons name={active ? 'radio-button-on' : 'radio-button-off'} size={18} color={active ? c.brandPrimary : c.textMuted} />
                    <Text style={[styles.radioText, active && styles.radioTextActive]}>{o.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </Section>

          <Section label="What Do You Think the Correct Answer Is?">
            <TextInput
              style={[styles.input, { minHeight: 80, textAlignVertical: 'top' }]}
              value={correctAnswer}
              onChangeText={setCorrectAnswer}
              multiline
              placeholder="Optional"
              placeholderTextColor={c.textMuted}
              testID="composer-correct-answer"
            />
          </Section>

          <Section label="Where Are You Getting That From?">
            <ChipPicker
              options={SOURCE_OPTIONS.map((o) => o.label)}
              value={SOURCE_OPTIONS.find((o) => o.key === source)?.label || SOURCE_OPTIONS[0].label}
              onChange={(label) => {
                const found = SOURCE_OPTIONS.find((o) => o.label === label);
                setSource(found?.key || '');
              }}
              testIDPrefix="source"
              styles={styles}
            />
          </Section>

          <Section label="Anything Else You Want Us to Know?">
            <TextInput
              style={[styles.input, { minHeight: 80, textAlignVertical: 'top' }]}
              value={note}
              onChangeText={setNote}
              multiline
              placeholder="Optional"
              placeholderTextColor={c.textMuted}
              testID="composer-note"
            />
          </Section>

          <View style={styles.composerActions}>
            <TouchableOpacity onPress={() => !busy && setComposerOpen(false)} style={styles.cancelBtn}>
              <Text style={styles.cancelBtnText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={submit} disabled={busy || !canSend} style={[styles.sendBtn, (!canSend || busy) && { opacity: 0.5 }]} testID="composer-send">
              {busy ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.sendBtnText}>Send Ticket</Text>}
            </TouchableOpacity>
          </View>
        </KeyboardAwareScrollView>
      </Modal>
    </SafeAreaView>
  );
}

// ──────────────────────────────────────────────────────────────────────────
function Section({ label, children }: { label: string; children: React.ReactNode }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.section}>
      <Text style={styles.sectionLbl}>{label}</Text>
      {children}
    </View>
  );
}

function ChipPicker({ options, value, onChange, testIDPrefix, styles }: {
  options: string[];
  value: string;
  onChange: (v: string) => void;
  testIDPrefix: string;
  styles: ReturnType<typeof makeStyles>;
}) {
  return (
    <View style={styles.chipWrap}>
      {options.map((opt) => {
        const active = value === opt;
        return (
          <TouchableOpacity
            key={opt}
            onPress={() => onChange(opt)}
            style={[styles.chip, active && styles.chipActive]}
            testID={`${testIDPrefix}-${opt.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`}
          >
            <Text style={[styles.chipText, active && styles.chipTextActive]}>{opt}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

// ──────────────────────────────────────────────────────────────────────────
function makeStyles(c: ColorPalette) { return StyleSheet.create({
  safe: { flex: 1, backgroundColor: c.background },
  scroll: { padding: Spacing.md, paddingBottom: 40 },
  hero: { fontFamily: Fonts.heading, fontSize: 26, color: c.brandPrimary, letterSpacing: -0.3, marginTop: 4 },
  subhero: { fontFamily: Fonts.body, fontSize: 14, color: c.textSecondary, lineHeight: 21, marginTop: 4, marginBottom: Spacing.md },
  primaryCta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: c.brandPrimary, paddingHorizontal: 16, paddingVertical: 12, borderRadius: 9999, minHeight: 44, marginBottom: Spacing.md },
  primaryCtaText: { fontFamily: Fonts.bodySemi, fontSize: 14, color: '#FFFFFF' },
  ticketCard: { backgroundColor: c.cardBg, borderRadius: Radius.md, borderWidth: 1, borderColor: c.borderSubtle, padding: Spacing.md, flexDirection: 'row', alignItems: 'center', gap: 12 },
  ticketRef: { fontFamily: Fonts.bodyMed, fontSize: 11, color: c.textMuted, letterSpacing: 0.6 },
  ticketTitle: { fontFamily: Fonts.heading, fontSize: 16, color: c.brandPrimary, lineHeight: 21 },
  ticketMeta: { fontFamily: Fonts.body, fontSize: 12, color: c.textSecondary, marginTop: 2 },
  pill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 9999 },
  pillText: { fontFamily: Fonts.bodySemi, fontSize: 11, letterSpacing: 0.3 },
  empty: { alignItems: 'center', gap: 6, paddingVertical: 32, paddingHorizontal: 8 },
  emptyTitle: { fontFamily: Fonts.bodySemi, fontSize: 15, color: c.brandPrimary, marginTop: 4 },
  emptyBody: { fontFamily: Fonts.body, fontSize: 13, color: c.textSecondary, textAlign: 'center', lineHeight: 19 },
  // Composer.
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.45)' },
  sheet: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: c.cardBg, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: Spacing.lg, paddingBottom: 36, maxHeight: '92%' },
  handle: { width: 36, height: 4, borderRadius: 2, backgroundColor: c.border, alignSelf: 'center', marginBottom: Spacing.md },
  sheetHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: Spacing.sm },
  sheetTitle: { fontFamily: Fonts.heading, fontSize: 22, color: c.brandPrimary },
  section: { marginTop: Spacing.md, gap: 6 },
  sectionLbl: { fontFamily: Fonts.bodySemi, fontSize: 13, color: c.textPrimary },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 9999, backgroundColor: c.surfaceTint, borderWidth: 1, borderColor: c.borderSubtle },
  chipActive: { backgroundColor: c.brandPrimary, borderColor: c.brandPrimary },
  chipText: { fontFamily: Fonts.bodySemi, fontSize: 12, color: c.brandPrimary },
  chipTextActive: { color: '#FFFFFF' },
  radioRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, paddingHorizontal: 12, borderRadius: Radius.md, borderWidth: 1, borderColor: c.borderSubtle, backgroundColor: c.surfaceTint },
  radioRowActive: { borderColor: c.brandPrimary, backgroundColor: `${c.brandPrimary}10` as any },
  radioText: { fontFamily: Fonts.body, fontSize: 14, color: c.textPrimary, flex: 1 },
  radioTextActive: { color: c.brandPrimary, fontFamily: Fonts.bodySemi },
  input: { fontFamily: Fonts.body, fontSize: 14, color: c.textPrimary, backgroundColor: c.background, borderRadius: Radius.md, paddingHorizontal: Spacing.md, paddingVertical: 12, borderWidth: 1, borderColor: c.borderSubtle, minHeight: 46 },
  composerActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: Spacing.lg },
  cancelBtn: { paddingHorizontal: 16, paddingVertical: 12, borderRadius: 9999, borderWidth: 1, borderColor: c.borderSubtle, backgroundColor: c.cardBg },
  cancelBtnText: { fontFamily: Fonts.bodyMed, fontSize: 13, color: c.textSecondary },
  sendBtn: { paddingHorizontal: 16, paddingVertical: 12, borderRadius: 9999, backgroundColor: c.brandPrimary, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  sendBtnText: { fontFamily: Fonts.bodySemi, fontSize: 13, color: '#FFFFFF' },
}); }
