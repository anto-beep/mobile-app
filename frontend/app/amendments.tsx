// Care Plan Amendments — mirror of /app/amendments on the web app.
// Layout: inline composer at top (For / Your name / Your role + N change cards
// with Service / Change type / Why this change?) → Generate letter →
// Past requests list below.
import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  ScrollView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { Ionicons } from '@expo/vector-icons';
import { api } from '../src/lib/api';
import { useApi } from '../src/lib/useApi';
import { useAuth } from '../src/context/AuthContext';
import { useParticipants } from '../src/context/ParticipantsContext';
import { toast } from '../src/components/Toast';
import BackHeader from '../src/components/BackHeader';
import { formatAUDate } from '../src/lib/format';
import { Fonts, Radius, Spacing } from '../src/lib/theme';
import type { ColorPalette } from '../src/lib/theme';
import { useColors } from '../src/hooks/useColors';
import { useThemedStyles } from '../src/hooks/useThemedStyles';

const CHANGE_TYPES = [
  'Increase frequency / hours',
  'Decrease frequency / hours',
  'Change service',
  'Add service',
  'Remove service',
  'Change provider',
  'Other',
];

const ROLE_OPTIONS = [
  'Primary Caregiver',
  'Support Caregiver',
  'Family Member',
  'Registered Supporter',
  'Guardian',
  'Attorney (Financial)',
  'Attorney (Medical)',
  'Advocate',
  'Other',
];

const STATUS_META: Record<string, { bg: string; fg: string; label: string }> = {
  DRAFT:     { bg: '#EDE9DC', fg: '#6B7C92', label: 'DRAFT' },
  OPEN:      { bg: '#FAEFD4', fg: '#5C3D11', label: 'OPEN' },
  SENT:      { bg: '#E8F0F0', fg: '#0E4D52', label: 'SENT' },
  IN_REVIEW: { bg: '#E8F0F0', fg: '#0E4D52', label: 'IN REVIEW' },
  RESOLVED:  { bg: '#E5F0E2', fg: '#3A5F37', label: 'RESOLVED' },
  REJECTED:  { bg: '#FDE8E2', fg: '#A54030', label: 'REJECTED' },
};

type ChangeRow = { service: string; change_type: string; why: string };

export default function Amendments() {
  const c = useColors();
  const styles = useThemedStyles(makeStyles);
  const { user } = useAuth();
  const { active, participants } = useParticipants();
  const { data, refresh } = useApi<{ items: any[] }>('/amendments');
  const items = data?.items || [];

  const [forId, setForId] = useState<string>('');
  const [yourName, setYourName] = useState('');
  const [yourRole, setYourRole] = useState('Primary Caregiver');
  const [rolePickerOpen, setRolePickerOpen] = useState(false);
  const [changes, setChanges] = useState<ChangeRow[]>([{ service: '', change_type: CHANGE_TYPES[0], why: '' }]);
  const [submitting, setSubmitting] = useState(false);
  const [forPickerOpen, setForPickerOpen] = useState(false);
  const [typePickerOpenIdx, setTypePickerOpenIdx] = useState<number | null>(null);

  // Prefill "For" with active participant + "Your name" with user's first name.
  useEffect(() => { if (active?.id) setForId(active.id); }, [active?.id]);
  useEffect(() => {
    if (!yourName && user?.name) setYourName(user.name.split(' ')[0] || user.name);
  }, [user?.name]); // eslint-disable-line react-hooks/exhaustive-deps

  const sorted = useMemo(
    () => [...items].sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || ''))),
    [items]
  );
  const forParticipant = (participants || []).find((p: any) => p.id === forId);
  const forLabel = forParticipant
    ? `${forParticipant.first_name || ''} ${forParticipant.last_name || ''}`.trim() || 'Select…'
    : 'Select…';

  const setChange = (idx: number, patch: Partial<ChangeRow>) =>
    setChanges((rows) => rows.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  const addChange = () => setChanges((rows) => [...rows, { service: '', change_type: CHANGE_TYPES[0], why: '' }]);
  const removeChange = (idx: number) => setChanges((rows) => rows.length === 1 ? rows : rows.filter((_, i) => i !== idx));

  const generate = async () => {
    const valid = changes.filter((c) => c.service.trim() || c.why.trim());
    if (valid.length === 0) {
      toast.error('Add at least one service or reason before generating the letter.');
      return;
    }
    if (!forId) {
      toast.error('Pick who this amendment is for.');
      return;
    }
    setSubmitting(true);
    try {
      const first = valid[0];
      await api.post('/amendments', {
        participant_id: forId,
        for_name: forLabel,
        your_name: yourName.trim() || undefined,
        your_role: yourRole.trim() || undefined,
        subject: first.service || first.change_type,
        kind: 'care_plan_change',
        service: first.service || undefined,
        change_type: first.change_type,
        description: valid.map((c, i) => `${i + 1}. ${c.service ? c.service + ', ' : ''}${c.change_type}\n${c.why}`).join('\n\n'),
        changes: valid,
        status: 'SENT',
      });
      toast.success('Letter generated and sent.');
      setChanges([{ service: '', change_type: CHANGE_TYPES[0], why: '' }]);
      refresh();
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || e?.message || 'Could not generate letter.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <BackHeader title="Care-Plan Changes" />
      <KeyboardAwareScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" bottomOffset={24}>
        {/* Hero */}
        <View style={styles.heroRow}>
          <Ionicons name="create-outline" size={22} color={c.brandPrimary} />
          <Text style={styles.hero}>Care-Plan Changes</Text>
        </View>
        <Text style={styles.subhero}>
          Build a clear, formal request to change the care plan, provider will receive the changes you actually need, in writing.
        </Text>

        {/* New change request */}
        <View style={styles.card}>
          <Text style={styles.cardH1}>New change request</Text>

          <View style={styles.row3}>
            <View style={{ flex: 1 }}>
              <Text style={styles.lbl}>For</Text>
              <TouchableOpacity style={styles.select} onPress={() => setForPickerOpen((v) => !v)} testID="amendment-for-select">
                <Text style={styles.selectText} numberOfLines={1}>{forLabel}</Text>
                <Ionicons name="chevron-down" size={16} color={c.textMuted} />
              </TouchableOpacity>
              {forPickerOpen && (
                <View style={styles.dropdown} testID="amendment-for-options">
                  {(participants || []).map((p: any) => (
                    <TouchableOpacity
                      key={p.id}
                      style={styles.dropdownItem}
                      onPress={() => { setForId(p.id); setForPickerOpen(false); }}
                    >
                      <Text style={styles.dropdownItemText}>{`${p.first_name || ''} ${p.last_name || ''}`.trim()}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.lbl}>Your name</Text>
              <TextInput style={styles.input} value={yourName} onChangeText={setYourName} placeholder="Cathy" placeholderTextColor={c.textMuted} testID="amendment-your-name" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.lbl}>Your Role</Text>
              <TouchableOpacity
                style={styles.select}
                onPress={() => setRolePickerOpen(!rolePickerOpen)}
                testID="amendment-your-role"
                activeOpacity={0.75}
              >
                <Text style={styles.selectText} numberOfLines={1}>{yourRole}</Text>
                <Ionicons name="chevron-down" size={16} color={c.textMuted} />
              </TouchableOpacity>
              {rolePickerOpen && (
                <View style={styles.dropdown} testID="amendment-role-options">
                  {ROLE_OPTIONS.map((r) => (
                    <TouchableOpacity
                      key={r}
                      style={styles.dropdownItem}
                      onPress={() => { setYourRole(r); setRolePickerOpen(false); }}
                    >
                      <Text style={styles.dropdownItemText}>{r}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}
            </View>
          </View>

          {/* Change rows */}
          {changes.map((c, idx) => (
            <View key={idx} style={styles.changeCard} testID={`amendment-change-${idx}`}>
              <View style={styles.row2}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.lbl}>Service</Text>
                  <TextInput
                    style={styles.input}
                    value={c.service}
                    onChangeText={(t) => setChange(idx, { service: t })}
                    placeholder="e.g. Domestic cleaning"
                    placeholderTextColor={c.textMuted}
                    testID={`amendment-service-${idx}`}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.lbl}>Change type</Text>
                  <TouchableOpacity
                    style={styles.select}
                    onPress={() => setTypePickerOpenIdx(typePickerOpenIdx === idx ? null : idx)}
                    testID={`amendment-change-type-${idx}`}
                  >
                    <Text style={styles.selectText} numberOfLines={1}>{c.change_type}</Text>
                    <Ionicons name="chevron-down" size={16} color={c.textMuted} />
                  </TouchableOpacity>
                  {typePickerOpenIdx === idx && (
                    <View style={styles.dropdown}>
                      {CHANGE_TYPES.map((t) => (
                        <TouchableOpacity
                          key={t}
                          style={styles.dropdownItem}
                          onPress={() => { setChange(idx, { change_type: t }); setTypePickerOpenIdx(null); }}
                        >
                          <Text style={styles.dropdownItemText}>{t}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  )}
                </View>
              </View>
              <View style={styles.whyHeader}>
                <Text style={styles.lbl}>Why this change?</Text>
                {/* Dictate button is a no-op placeholder on mobile for now,
                    web uses MediaRecorder + Whisper. Keep visible for parity. */}
                <TouchableOpacity style={styles.dictateBtn} onPress={() => toast.info('Dictation is coming to mobile soon. Type your reason for now.')} testID={`amendment-dictate-${idx}`}>
                  <Ionicons name="mic-outline" size={13} color={c.brandPrimary} />
                  <Text style={styles.dictateBtnText}>Dictate</Text>
                </TouchableOpacity>
              </View>
              <TextInput
                style={[styles.input, styles.textarea]}
                value={c.why}
                onChangeText={(t) => setChange(idx, { why: t })}
                multiline
                numberOfLines={4}
                placeholder="e.g. After her fall in May, she cannot manage the heavy cleaning safely on her own."
                placeholderTextColor={c.textMuted}
                testID={`amendment-why-${idx}`}
              />
              {changes.length > 1 && (
                <TouchableOpacity style={styles.removeChangeBtn} onPress={() => removeChange(idx)} testID={`amendment-remove-${idx}`}>
                  <Ionicons name="trash-outline" size={14} color={c.severityAlert} />
                  <Text style={styles.removeChangeText}>Remove change</Text>
                </TouchableOpacity>
              )}
            </View>
          ))}

          <TouchableOpacity style={styles.addChangeBtn} onPress={addChange} testID="amendment-add-change">
            <Ionicons name="add" size={16} color={c.brandPrimary} />
            <Text style={styles.addChangeText}>Add another change</Text>
          </TouchableOpacity>

          <View style={styles.cardDivider} />
          <TouchableOpacity
            style={[styles.generateBtn, submitting && { opacity: 0.6 }]}
            onPress={generate}
            disabled={submitting}
            testID="amendment-generate-letter"
            accessibilityRole="button"
          >
            {submitting ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.generateBtnText}>Generate letter</Text>}
          </TouchableOpacity>
        </View>

        {/* Past requests */}
        <Text style={styles.sectionH}>Past Requests</Text>
        {sorted.length === 0 ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyText}>No requests yet. Submit the form above and it will appear here.</Text>
          </View>
        ) : sorted.map((a) => {
          const st = STATUS_META[String(a.status || 'OPEN').toUpperCase()] || STATUS_META.OPEN;
          const dt = a.created_at ? new Date(a.created_at) : null;
          const dtTxt = dt ? `${dt.toLocaleDateString('en-AU')}, ${dt.toLocaleTimeString('en-AU')}` : formatAUDate(a.created_at);
          return (
            <View key={a.id} style={styles.pastCard} testID={`amendment-past-${a.id}`}>
              <View style={{ flex: 1 }}>
                <Text style={styles.pastTitle}>{a.subject || a.service || 'Amendment'}</Text>
                <Text style={styles.pastMeta}>{dtTxt}{a.provider ? ` · to ${a.provider}` : ''}</Text>
              </View>
              <View style={[styles.statusPill, { backgroundColor: st.bg }]}>
                <Text style={[styles.statusPillText, { color: st.fg }]}>{st.label}</Text>
              </View>
            </View>
          );
        })}
      </KeyboardAwareScrollView>
    </SafeAreaView>
  );
}

function makeStyles(c: ColorPalette) { return StyleSheet.create({
  safe: { flex: 1, backgroundColor: c.background },
  scroll: { padding: Spacing.md, paddingBottom: 40 },
  heroRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 6 },
  hero: { fontFamily: Fonts.heading, fontSize: 24, color: c.brandPrimary, letterSpacing: -0.3 },
  subhero: { fontFamily: Fonts.body, fontSize: 14, color: c.textSecondary, lineHeight: 21, marginBottom: Spacing.lg },

  card: {
    backgroundColor: c.cardBg, borderRadius: Radius.lg,
    borderWidth: 1, borderColor: c.borderSubtle,
    padding: Spacing.md, marginBottom: Spacing.lg,
  },
  cardH1: { fontFamily: Fonts.heading, fontSize: 18, color: c.brandPrimary, marginBottom: Spacing.md },

  row3: { flexDirection: 'row', gap: 8, marginBottom: Spacing.md },
  row2: { flexDirection: 'row', gap: 8 },
  lbl: { fontFamily: Fonts.bodyMed, fontSize: 11, color: c.textSecondary, marginBottom: 5, letterSpacing: 0.2 },
  input: {
    backgroundColor: '#FFFFFF', borderRadius: Radius.sm,
    borderWidth: 1, borderColor: c.borderSubtle,
    paddingHorizontal: 10, paddingVertical: 10, fontSize: 14, color: c.textPrimary,
    fontFamily: Fonts.body, minHeight: 40,
  },
  textarea: { minHeight: 88, paddingTop: 10, textAlignVertical: 'top' },
  select: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: '#FFFFFF', borderRadius: Radius.sm,
    borderWidth: 1, borderColor: c.borderSubtle,
    paddingHorizontal: 10, paddingVertical: 10, minHeight: 40,
  },
  selectText: { flex: 1, fontFamily: Fonts.body, fontSize: 14, color: c.textPrimary },
  dropdown: {
    marginTop: 4, backgroundColor: '#FFFFFF', borderRadius: Radius.sm,
    borderWidth: 1, borderColor: c.borderSubtle, overflow: 'hidden',
  },
  dropdownItem: { paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: c.borderSubtle },
  dropdownItemText: { fontFamily: Fonts.body, fontSize: 14, color: c.textPrimary },

  changeCard: {
    backgroundColor: 'rgba(165, 81, 43, 0.06)',
    borderRadius: Radius.md, padding: Spacing.sm + 2, marginBottom: Spacing.sm,
    borderWidth: 1, borderColor: 'rgba(165, 81, 43, 0.18)',
  },
  whyHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: Spacing.sm, marginBottom: 4 },
  dictateBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: '#FFFFFF', borderRadius: 999,
    borderWidth: 1, borderColor: c.borderSubtle,
    paddingHorizontal: 10, paddingVertical: 4,
  },
  dictateBtnText: { fontFamily: Fonts.bodyMed, fontSize: 11, color: c.brandPrimary },
  removeChangeBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 8, alignSelf: 'flex-start' },
  removeChangeText: { fontFamily: Fonts.bodyMed, fontSize: 12, color: c.severityAlert },

  addChangeBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', paddingVertical: 8 },
  addChangeText: { fontFamily: Fonts.bodyMed, fontSize: 14, color: c.brandPrimary },

  cardDivider: { height: 1, backgroundColor: c.borderSubtle, marginVertical: Spacing.md },
  generateBtn: {
    alignSelf: 'flex-end', backgroundColor: c.brandPrimary,
    paddingHorizontal: 18, paddingVertical: 11, borderRadius: Radius.md, minHeight: 42, minWidth: 130,
    alignItems: 'center', justifyContent: 'center',
  },
  generateBtnText: { fontFamily: Fonts.bodySemi, fontSize: 14, color: '#FFFFFF', letterSpacing: 0.2 },

  sectionH: { fontFamily: Fonts.heading, fontSize: 18, color: c.brandPrimary, marginBottom: Spacing.sm },
  emptyCard: { padding: Spacing.md, backgroundColor: c.cardBg, borderRadius: Radius.md, borderWidth: 1, borderColor: c.borderSubtle },
  emptyText: { fontFamily: Fonts.body, fontSize: 13, color: c.textMuted, textAlign: 'center' },
  pastCard: {
    backgroundColor: c.cardBg, borderRadius: Radius.md,
    borderWidth: 1, borderColor: c.borderSubtle,
    padding: Spacing.md, marginBottom: Spacing.sm,
    flexDirection: 'row', alignItems: 'center', gap: 10,
  },
  pastTitle: { fontFamily: Fonts.bodySemi, fontSize: 15, color: c.brandPrimary },
  pastMeta: { fontFamily: Fonts.body, fontSize: 12, color: c.textSecondary, marginTop: 3 },
  statusPill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 4 },
  statusPillText: { fontFamily: Fonts.bodySemi, fontSize: 10, letterSpacing: 0.6 },
}); }
