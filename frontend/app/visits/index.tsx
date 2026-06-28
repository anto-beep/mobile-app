// Visits / Calendar — Feature 4 (iter30). List + add/edit + delete.
// Sectioned into Today / Upcoming / Past so the daily-use case is one glance.
import React, { useCallback, useMemo, useState } from 'react';
import { formatDate } from '../../src/lib/formatDate';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Modal,
  Pressable,
  TextInput,
  RefreshControl,
  Platform,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { api, extractErrorMessage } from '../../src/lib/api';
import { Colors, Fonts, Radius, Spacing } from '../../src/lib/theme';
import type { ColorPalette } from '../../src/lib/theme';
import { useColors } from '../../src/hooks/useColors';
import { useThemedStyles } from '../../src/hooks/useThemedStyles';
import { toast } from '../../src/components/Toast';
import BackHeader from '../../src/components/BackHeader';
import { useParticipants } from '../../src/context/ParticipantsContext';

type Visit = {
  id: string;
  title: string;
  starts_at: string;
  duration_minutes: number;
  location?: string;
  provider?: string;
  kind: 'appointment' | 'home_visit' | 'telehealth' | 'assessment' | 'other';
  notes?: string;
};

const KINDS: { value: Visit['kind']; label: string; icon: keyof typeof Ionicons.glyphMap; tone: string }[] = [
  { value: 'appointment', label: 'Appointment', icon: 'calendar-outline', tone: Colors.brandPrimary },
  { value: 'home_visit', label: 'Home visit', icon: 'home-outline', tone: Colors.severityInfo },
  { value: 'telehealth', label: 'Telehealth', icon: 'videocam-outline', tone: Colors.brandSecondary },
  { value: 'assessment', label: 'Assessment', icon: 'clipboard-outline', tone: Colors.streams.Clinical },
  { value: 'other', label: 'Other', icon: 'ellipsis-horizontal-outline', tone: Colors.textMuted },
];

const KIND_MAP = Object.fromEntries(KINDS.map((k) => [k.value, k])) as Record<Visit['kind'], (typeof KINDS)[number]>;

function startOfDay(d: Date) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
function endOfDay(d: Date) { const x = new Date(d); x.setHours(23, 59, 59, 999); return x; }
function fmtTime(iso: string) { try { return new Date(iso).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' }); } catch { return ''; } }
function fmtDateLabel(iso: string) { try { return formatDate(iso); } catch { return ''; } }
function fmtDuration(mins: number) {
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60); const m = mins % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

// `<input type="datetime-local">` expects local-time `YYYY-MM-DDTHH:MM`, not UTC.
// Convert a stored UTC ISO → local for display, and local → UTC ISO on input.
function toLocalInput(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  } catch { return ''; }
}
function fromLocalInput(local: string): string {
  if (!local) return new Date().toISOString();
  const d = new Date(local);
  return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

export default function Visits() {
  const c = useColors();
  const styles = useThemedStyles(makeStyles);
  const { participantSig, active } = useParticipants();
  const [visits, setVisits] = useState<Visit[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  // Edit modal
  const [modal, setModal] = useState<null | (Partial<Visit> & { _editing?: boolean })>(null);
  const [saving, setSaving] = useState(false);
  // Native date/time picker visibility (Android shows one at a time; iOS we render inline conditionally).
  const [pickerMode, setPickerMode] = useState<null | 'date' | 'time'>(null);

  const load = useCallback(async () => {
    try {
      const { data } = await api.get<Visit[]>('/visits');
      setVisits(data || []);
    } catch (e) {
      toast.error(extractErrorMessage(e, "Couldn't load visits"));
    } finally {
      setLoading(false); setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [load, participantSig, active?.id]));

  // Refetch on participant switch while screen is mounted.
  React.useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [participantSig, active?.id]);

  const sections = useMemo(() => {
    const today = new Date();
    const t0 = startOfDay(today).getTime();
    const t1 = endOfDay(today).getTime();
    const t: Visit[] = [];
    const up: Visit[] = [];
    const past: Visit[] = [];
    for (const v of visits) {
      const at = new Date(v.starts_at).getTime();
      if (at >= t0 && at <= t1) t.push(v);
      else if (at > t1) up.push(v);
      else past.push(v);
    }
    t.sort((a, b) => +new Date(a.starts_at) - +new Date(b.starts_at));
    up.sort((a, b) => +new Date(a.starts_at) - +new Date(b.starts_at));
    past.sort((a, b) => +new Date(b.starts_at) - +new Date(a.starts_at));
    return { today: t, upcoming: up, past };
  }, [visits]);

  const openCreate = () => {
    const d = new Date();
    d.setHours(d.getHours() + 1, 0, 0, 0);
    setModal({ title: '', starts_at: d.toISOString(), duration_minutes: 60, kind: 'appointment', location: '', provider: '', notes: '' });
  };

  const openEdit = (v: Visit) => setModal({ ...v, _editing: true });

  const submit = useCallback(async () => {
    if (!modal) return;
    if (!modal.title || !modal.title.trim()) { toast.warning('Add a title.'); return; }
    if (!modal.starts_at) { toast.warning('Pick a date and time.'); return; }
    setSaving(true);
    try {
      const payload = {
        title: modal.title.trim(),
        starts_at: modal.starts_at,
        duration_minutes: Number(modal.duration_minutes) || 60,
        location: (modal.location || '').trim(),
        provider: (modal.provider || '').trim(),
        kind: modal.kind || 'appointment',
        notes: (modal.notes || '').trim(),
      };
      if (modal._editing && modal.id) {
        await api.patch(`/visits/${modal.id}`, payload);
        toast.success('Visit updated.');
      } else {
        await api.post('/visits', payload);
        toast.success('Visit added.');
      }
      setModal(null);
      await load();
    } catch (e) {
      toast.error(extractErrorMessage(e, "Couldn't save visit"));
    } finally { setSaving(false); }
  }, [modal, load]);

  const remove = useCallback((v: Visit) => {
    const doDelete = async () => {
      try {
        await api.delete(`/visits/${v.id}`);
        toast.success('Removed.');
        setVisits((vs) => vs.filter((x) => x.id !== v.id));
        setModal(null);
      } catch (e) {
        toast.error(extractErrorMessage(e, "Couldn't remove"));
      }
    };
    if (Platform.OS === 'web') {
      // eslint-disable-next-line no-alert
      if (typeof window !== 'undefined' && window.confirm(`Remove "${v.title}"?`)) doDelete();
    } else {
      Alert.alert('Remove visit?', `"${v.title}" will be deleted.`, [
        { text: 'Cancel', style: 'cancel' }, { text: 'Delete', style: 'destructive', onPress: doDelete },
      ]);
    }
  }, []);

  const renderRow = (v: Visit) => {
    const k = KIND_MAP[v.kind] || KIND_MAP.other;
    return (
      <TouchableOpacity key={v.id} style={styles.row} onPress={() => openEdit(v)} testID={`visit-${v.id}`} activeOpacity={0.85}>
        <View style={[styles.kindIcon, { backgroundColor: `${k.tone}15` }]}>
          <Ionicons name={k.icon} size={16} color={k.tone} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.rowTitle} numberOfLines={1}>{v.title}</Text>
          <Text style={styles.rowMeta}>
            {fmtTime(v.starts_at)} · {fmtDuration(v.duration_minutes)}{v.location ? ` · ${v.location}` : ''}{v.provider ? ` · ${v.provider}` : ''}
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={14} color={c.textMuted} />
      </TouchableOpacity>
    );
  };

  const renderSection = (label: string, list: Visit[], dateBucketed = false) => {
    if (list.length === 0) return null;
    if (!dateBucketed) {
      return (
        <View key={label}>
          <Text style={styles.sectionLabel}>{label}</Text>
          {list.map(renderRow)}
        </View>
      );
    }
    // Group by date
    const byDate: Record<string, Visit[]> = {};
    for (const v of list) {
      const key = fmtDateLabel(v.starts_at);
      (byDate[key] = byDate[key] || []).push(v);
    }
    return (
      <View key={label}>
        <Text style={styles.sectionLabel}>{label}</Text>
        {Object.entries(byDate).map(([d, vs]) => (
          <View key={d}>
            <Text style={styles.dateLabel}>{d}</Text>
            {vs.map(renderRow)}
          </View>
        ))}
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <BackHeader title="Calendar" rightAccessory={(
        <TouchableOpacity onPress={openCreate} style={styles.addBtn} testID="visits-add">
          <Ionicons name="add" size={16} color={c.cream} />
          <Text style={styles.addBtnText}>Add visit</Text>
        </TouchableOpacity>
      )} />

      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={c.brandPrimary} />}
      >
        <Text style={styles.overline}>Visit calendar</Text>
        <Text style={styles.h1}>Upcoming appointments & home visits</Text>
        <Text style={styles.sub}>Track GP appointments, allied-health visits, ACAT reviews, and provider home visits in one place.</Text>

        {loading ? (
          <ActivityIndicator color={c.brandPrimary} style={{ paddingVertical: 40 }} />
        ) : visits.length === 0 ? (
          <View style={styles.emptyCard}>
            <Ionicons name="calendar-outline" size={28} color={c.textMuted} />
            <Text style={styles.emptyTitle}>No visits yet</Text>
            <Text style={styles.emptyBody}>Add your first appointment with the button above.</Text>
            <TouchableOpacity style={styles.emptyCta} onPress={openCreate} testID="visits-empty-add">
              <Ionicons name="add" size={14} color={c.cream} />
              <Text style={styles.emptyCtaText}>Add your first visit</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <>
            {renderSection('Today', sections.today)}
            {renderSection('Upcoming', sections.upcoming, true)}
            {renderSection('Past', sections.past, true)}
          </>
        )}

        <View style={{ height: 40 }} />
      </ScrollView>

      {/* Add / Edit modal */}
      <Modal visible={!!modal} animationType="slide" transparent onRequestClose={() => setModal(null)}>
        <Pressable style={styles.backdrop} onPress={() => !saving && setModal(null)} />
        <KeyboardAwareScrollView
          style={styles.sheet}
          contentContainerStyle={{ paddingBottom: 24 }}
          keyboardShouldPersistTaps="handled"
          bottomOffset={24}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.handle} />
          <Text style={styles.modalTitle}>{modal?._editing ? 'Edit visit' : 'New visit'}</Text>

            <Text style={styles.label}>Title</Text>
            <TextInput value={modal?.title || ''} onChangeText={(t) => setModal((m) => m && { ...m, title: t })} placeholder="GP follow-up · Physio · ACAT review" placeholderTextColor={c.textMuted} style={styles.input} testID="visit-title" />

            <Text style={styles.label}>When</Text>
            {Platform.OS === 'web' ? (
              // react-native-web's TextInput silently controls the `type`
              // attr, so a spread `type: 'datetime-local'` doesn't stick.
              // Render a raw <input> via createElement to get the native
              // browser picker.
              React.createElement('input', {
                type: 'datetime-local',
                value: modal?.starts_at ? toLocalInput(modal.starts_at) : '',
                onChange: (e: any) => setModal((m) => m && { ...m, starts_at: fromLocalInput(e?.target?.value || '') }),
                'data-testid': 'visit-starts-at',
                style: {
                  fontFamily: 'inherit', fontSize: 14, color: c.brandPrimary,
                  background: c.background,
                  borderRadius: 8, padding: '12px 14px',
                  border: `1px solid ${c.borderSubtle}`,
                  outline: 'none', width: '100%',
                  boxSizing: 'border-box', minHeight: 46,
                },
              })
            ) : (
              <View style={styles.dtRow}>
                <TouchableOpacity
                  onPress={() => setPickerMode('date')}
                  style={[styles.dtBtn, { flex: 3 }]}
                  testID="visit-pick-date"
                  activeOpacity={0.8}
                >
                  <Ionicons name="calendar-outline" size={14} color={c.brandPrimary} />
                  <Text style={styles.dtBtnText} numberOfLines={1}>
                    {modal?.starts_at ? fmtDateLabel(modal.starts_at) : 'Pick date'}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => setPickerMode('time')}
                  style={[styles.dtBtn, { flex: 2 }]}
                  testID="visit-pick-time"
                  activeOpacity={0.8}
                >
                  <Ionicons name="time-outline" size={14} color={c.brandPrimary} />
                  <Text style={styles.dtBtnText} numberOfLines={1}>
                    {modal?.starts_at ? fmtTime(modal.starts_at) : 'Pick time'}
                  </Text>
                </TouchableOpacity>
              </View>
            )}
            {Platform.OS !== 'web' && pickerMode && modal?.starts_at && (
              <DateTimePicker
                value={new Date(modal.starts_at)}
                mode={pickerMode}
                is24Hour={false}
                display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                onChange={(_event: DateTimePickerEvent, d?: Date) => {
                  // Android closes after pick; iOS stays open until tapped away.
                  if (Platform.OS === 'android') setPickerMode(null);
                  if (d && modal) {
                    const cur = new Date(modal.starts_at as string);
                    if (pickerMode === 'date') {
                      cur.setFullYear(d.getFullYear(), d.getMonth(), d.getDate());
                    } else {
                      cur.setHours(d.getHours(), d.getMinutes(), 0, 0);
                    }
                    setModal((m) => m && { ...m, starts_at: cur.toISOString() });
                  }
                }}
              />
            )}
            {Platform.OS === 'ios' && pickerMode && (
              <TouchableOpacity onPress={() => setPickerMode(null)} style={styles.dtDone}>
                <Text style={styles.dtDoneText}>Done</Text>
              </TouchableOpacity>
            )}

            <Text style={styles.label}>Duration (minutes)</Text>
            <TextInput value={String(modal?.duration_minutes ?? 60)} onChangeText={(t) => setModal((m) => m && { ...m, duration_minutes: parseInt(t || '0', 10) || 0 })} keyboardType="number-pad" style={styles.input} testID="visit-duration" />

            <Text style={styles.label}>Kind</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
              {KINDS.map((k) => (
                <TouchableOpacity key={k.value} onPress={() => setModal((m) => m && { ...m, kind: k.value })} style={[styles.chip, modal?.kind === k.value && styles.chipActive]}>
                  <Ionicons name={k.icon} size={12} color={modal?.kind === k.value ? c.cream : c.brandPrimary} />
                  <Text style={[styles.chipText, modal?.kind === k.value && styles.chipTextActive]}>{k.label}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            <Text style={styles.label}>Location (optional)</Text>
            <TextInput value={modal?.location || ''} onChangeText={(t) => setModal((m) => m && { ...m, location: t })} placeholder="Where will this happen?" placeholderTextColor={c.textMuted} style={styles.input} testID="visit-location" />

            <Text style={styles.label}>Provider (optional)</Text>
            <TextInput value={modal?.provider || ''} onChangeText={(t) => setModal((m) => m && { ...m, provider: t })} placeholder="Dr Lee · MyAged Co" placeholderTextColor={c.textMuted} style={styles.input} testID="visit-provider" />

            <Text style={styles.label}>Notes (optional)</Text>
            <TextInput value={modal?.notes || ''} onChangeText={(t) => setModal((m) => m && { ...m, notes: t })} placeholder="Anything to remember?" placeholderTextColor={c.textMuted} multiline numberOfLines={3} style={[styles.input, { minHeight: 70, textAlignVertical: 'top' }]} testID="visit-notes" />

            <TouchableOpacity onPress={submit} disabled={saving} style={[styles.cta, saving && { opacity: 0.6 }]} testID="visit-save">
              {saving ? <ActivityIndicator color={c.cream} /> : (
                <>
                  <Ionicons name="checkmark" size={14} color={c.cream} />
                  <Text style={styles.ctaText}>{modal?._editing ? 'Save changes' : 'Add visit'}</Text>
                </>
              )}
            </TouchableOpacity>

            {modal?._editing ? (
              <TouchableOpacity onPress={() => modal.id && remove(modal as Visit)} style={styles.deleteBtn} testID="visit-delete">
                <Ionicons name="trash-outline" size={14} color={c.danger} />
                <Text style={styles.deleteBtnText}>Remove visit</Text>
              </TouchableOpacity>
            ) : null}

            <TouchableOpacity onPress={() => !saving && setModal(null)} style={styles.cancel}>
              <Text style={styles.cancelText}>Cancel</Text>
            </TouchableOpacity>
        </KeyboardAwareScrollView>
      </Modal>
    </SafeAreaView>
  );
}

function makeStyles(c: ColorPalette) { return StyleSheet.create({
  safe: { flex: 1, backgroundColor: c.background },
  scroll: { padding: Spacing.lg, paddingTop: 4 },
  overline: { fontFamily: Fonts.bodyMed, fontSize: 11, letterSpacing: 1.5, textTransform: 'uppercase', color: c.textMuted },
  h1: { fontFamily: Fonts.heading, fontSize: 28, color: c.brandPrimary, letterSpacing: -0.5, marginTop: 2 },
  sub: { fontFamily: Fonts.body, fontSize: 13, color: c.textSecondary, marginTop: 6, lineHeight: 19 },
  addBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 6, paddingHorizontal: 12, borderRadius: 100, backgroundColor: c.brandPrimary, minHeight: 32 },
  addBtnText: { fontFamily: Fonts.bodySemi, fontSize: 12, color: c.cream },
  sectionLabel: { fontFamily: Fonts.bodyMed, fontSize: 11, letterSpacing: 1.2, textTransform: 'uppercase', color: c.textMuted, marginTop: Spacing.lg, marginBottom: 6 },
  dateLabel: { fontFamily: Fonts.bodySemi, fontSize: 12, color: c.brandPrimary, marginTop: 8, marginBottom: 6 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: c.cardBg, borderRadius: Radius.md, borderWidth: 1, borderColor: c.borderSubtle, padding: Spacing.md, marginBottom: 6 },
  kindIcon: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  rowTitle: { fontFamily: Fonts.bodySemi, fontSize: 14, color: c.brandPrimary },
  rowMeta: { fontFamily: Fonts.body, fontSize: 11, color: c.textSecondary, marginTop: 2 },
  emptyCard: { padding: Spacing.lg, alignItems: 'center', backgroundColor: c.cardBg, borderRadius: Radius.md, borderWidth: 1, borderColor: c.borderSubtle, gap: 8, marginTop: Spacing.md },
  emptyTitle: { fontFamily: Fonts.bodySemi, fontSize: 15, color: c.brandPrimary, marginTop: 4 },
  emptyBody: { fontFamily: Fonts.body, fontSize: 12, color: c.textSecondary, textAlign: 'center', lineHeight: 18 },
  emptyCta: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 10, paddingHorizontal: 16, borderRadius: 100, backgroundColor: c.brandPrimary, marginTop: Spacing.sm, minHeight: 40 },
  emptyCtaText: { fontFamily: Fonts.bodySemi, fontSize: 13, color: c.cream },
  // Modal
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.45)' },
  sheet: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: c.cardBg, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: Spacing.lg, paddingBottom: 36, maxHeight: '88%' },
  handle: { width: 36, height: 4, borderRadius: 2, backgroundColor: c.border, alignSelf: 'center', marginBottom: Spacing.md },
  modalTitle: { fontFamily: Fonts.heading, fontSize: 22, color: c.brandPrimary, marginBottom: Spacing.sm },
  label: { fontFamily: Fonts.bodyMed, fontSize: 12, color: c.brandPrimary, marginTop: 10, marginBottom: 4 },
  hint: { fontFamily: Fonts.body, fontSize: 10, color: c.textMuted, marginTop: 4 },
  input: { fontFamily: Fonts.body, fontSize: 14, color: c.brandPrimary, backgroundColor: c.background, borderRadius: Radius.md, paddingHorizontal: Spacing.md, paddingVertical: 12, borderWidth: 1, borderColor: c.borderSubtle },
  chipRow: { gap: 6, paddingVertical: 4 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 100, backgroundColor: c.background, borderWidth: 1, borderColor: c.borderSubtle, minHeight: 30 },
  chipActive: { backgroundColor: c.brandPrimary, borderColor: c.brandPrimary },
  chipText: { fontFamily: Fonts.bodyMed, fontSize: 12, color: c.brandPrimary },
  chipTextActive: { color: c.cream },
  cta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: Spacing.lg, backgroundColor: c.brandPrimary, borderRadius: Radius.md, paddingVertical: 14, minHeight: 50 },
  ctaText: { fontFamily: Fonts.bodySemi, fontSize: 14, color: c.cream },
  deleteBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, marginTop: 8, paddingVertical: 10, borderRadius: Radius.md, backgroundColor: 'rgba(192, 57, 43, 0.08)' },
  deleteBtnText: { fontFamily: Fonts.bodySemi, fontSize: 13, color: c.danger },
  cancel: { marginTop: 8, alignItems: 'center', paddingVertical: 10 },
  cancelText: { fontFamily: Fonts.bodyMed, fontSize: 13, color: c.textMuted },
  // Date/time picker
  dtRow: { flexDirection: 'row', gap: 8 },
  dtBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: c.background, borderRadius: Radius.md,
    borderWidth: 1, borderColor: c.borderSubtle,
    paddingHorizontal: Spacing.md, paddingVertical: 12, minHeight: 46,
  },
  dtBtnText: { fontFamily: Fonts.bodyMed, fontSize: 13, color: c.brandPrimary, flexShrink: 1 },
  dtDone: { alignSelf: 'flex-end', paddingHorizontal: 12, paddingVertical: 6, marginTop: 4 },
  dtDoneText: { fontFamily: Fonts.bodySemi, fontSize: 13, color: c.brandPrimary },
}); }
