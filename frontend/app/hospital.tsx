// Hospital handover — ED-ready one-pager editor.
// Captures summary, meds, allergies, emergency contact — saves via
// upsert at POST /api/hospital/handover so the data is one tap to recall.
import React, { useCallback, useEffect, useState } from 'react';
import { formatDateTime } from '../src/lib/formatDate';
import {
  View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity,
  ActivityIndicator, RefreshControl, Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useApi } from '../src/lib/useApi';
import { api, extractErrorMessage } from '../src/lib/api';
import BackHeader from '../src/components/BackHeader';
import { toast } from '../src/components/Toast';
import { Fonts, Radius, Spacing } from '../src/lib/theme';
import type { ColorPalette } from '../src/lib/theme';
import { useColors } from '../src/hooks/useColors';
import { useThemedStyles } from '../src/hooks/useThemedStyles';
import { getActiveParticipantId } from '../src/lib/activeParticipant';

type Med = { name?: string; dose?: string };
type Contact = { name?: string; phone?: string; relationship?: string };
type Handover = {
  participant_id?: string;
  summary?: string;
  medications?: Med[];
  allergies?: string[];
  emergency_contact?: Contact | null;
  last_updated?: string | null;
};

// ── Stays tracker ─────────────────────────────────────────────────────
// Per-device record of hospital stays for the active participant.  Stored
// in AsyncStorage today; a future backend deploy can move this to a
// `/hospital/stays` endpoint without UI changes.
type Stay = {
  id: string;
  hospital?: string;
  admitted: string;          // ISO date
  discharged?: string | null;
  reason?: string;
  notes?: string;
};

const STAYS_KEY = (pid: string) => `wayly:hospital:stays:${pid}`;

export default function Hospital() {
  const c = useColors();
  const styles = useThemedStyles(makeStyles);
  const { data, loading, refreshing, refresh } = useApi<Handover>('/hospital/handover');

  const [summary, setSummary] = useState('');
  const [meds, setMeds] = useState<Med[]>([]);
  const [allergies, setAllergies] = useState<string>('');
  const [contact, setContact] = useState<Contact>({});
  const [saving, setSaving] = useState(false);

  // Stays state ─────
  const [stays, setStays] = useState<Stay[]>([]);
  const [stayModal, setStayModal] = useState(false);
  const [draft, setDraft] = useState<Stay>({ id: '', admitted: '' });

  const pid = getActiveParticipantId() || 'none';

  // Load stays whenever participant changes.
  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(STAYS_KEY(pid));
        setStays(raw ? JSON.parse(raw) : []);
      } catch { setStays([]); }
    })();
  }, [pid]);

  const persistStays = useCallback(async (next: Stay[]) => {
    setStays(next);
    try { await AsyncStorage.setItem(STAYS_KEY(pid), JSON.stringify(next)); } catch {}
  }, [pid]);

  const newStay = () => {
    setDraft({
      id: `s_${Date.now().toString(36)}`,
      hospital: '',
      admitted: new Date().toISOString().slice(0, 10),
      discharged: null,
      reason: '',
      notes: '',
    });
    setStayModal(true);
  };

  const saveStay = () => {
    if (!draft.admitted) { toast.error('Add an admission date.'); return; }
    const exists = stays.some((s) => s.id === draft.id);
    const next = exists
      ? stays.map((s) => s.id === draft.id ? draft : s)
      : [draft, ...stays];
    persistStays(next);
    setStayModal(false);
    toast.success('Stay logged.');
  };

  const editStay = (s: Stay) => { setDraft({ ...s }); setStayModal(true); };
  const removeStay = (id: string) => persistStays(stays.filter((s) => s.id !== id));
  const dischargeNow = (id: string) => persistStays(
    stays.map((s) => s.id === id ? { ...s, discharged: new Date().toISOString().slice(0, 10) } : s)
  );

  useEffect(() => {
    if (!data) return;
    setSummary(data.summary || '');
    setMeds((data.medications && data.medications.length > 0) ? data.medications : [{ name: '', dose: '' }]);
    setAllergies((data.allergies || []).join(', '));
    setContact(data.emergency_contact || {});
  }, [data?.participant_id, data?.last_updated]); // eslint-disable-line react-hooks/exhaustive-deps

  const setMed = (i: number, patch: Partial<Med>) =>
    setMeds((rows) => rows.map((r, idx) => idx === i ? { ...r, ...patch } : r));
  const addMed = () => setMeds((rows) => [...rows, { name: '', dose: '' }]);
  const rmMed = (i: number) => setMeds((rows) => rows.length === 1 ? rows : rows.filter((_, idx) => idx !== i));

  const save = async () => {
    setSaving(true);
    try {
      const payload: Handover = {
        summary: summary.trim() || undefined,
        medications: meds.filter((m) => (m.name || '').trim()),
        allergies: allergies.split(',').map((s) => s.trim()).filter(Boolean),
        emergency_contact: contact.name?.trim() || contact.phone?.trim() ? contact : null,
      };
      await api.post('/hospital/handover', payload);
      toast.success('Handover saved.');
      await refresh();
    } catch (e) { toast.error(extractErrorMessage(e, "Could not save handover")); }
    finally { setSaving(false); }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <BackHeader title="Hospital Liaison" />
      <KeyboardAwareScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        bottomOffset={24}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={c.brandPrimary} />}
      >
        <View style={styles.heroRow}>
          <Ionicons name="pulse-outline" size={22} color={c.brandPrimary} />
          <Text style={styles.hero}>Hospital Liaison</Text>
        </View>
        <Text style={styles.subhero}>What an ED triage nurse needs in 30 seconds. We will save it so you can pull it up on the way to hospital.</Text>

        {loading && !data ? <ActivityIndicator color={c.brandPrimary} /> : (
          <>
            <View style={styles.card}>
              <Text style={styles.cardH}>Summary</Text>
              <TextInput
                style={[styles.input, { minHeight: 96, textAlignVertical: 'top' }]}
                multiline
                value={summary}
                onChangeText={setSummary}
                placeholder="e.g. 78yo, lives independently, mild cognitive impairment, mobility limited after May fall."
                placeholderTextColor={c.textMuted}
                testID="hospital-summary"
              />
            </View>

            <View style={styles.card}>
              <Text style={styles.cardH}>Medications</Text>
              {meds.map((m, i) => (
                <View key={i} style={styles.medRow}>
                  <TextInput style={[styles.input, { flex: 2 }]} value={m.name || ''} onChangeText={(t) => setMed(i, { name: t })} placeholder="Medication name" placeholderTextColor={c.textMuted} testID={`med-name-${i}`} />
                  <TextInput style={[styles.input, { flex: 1 }]} value={m.dose || ''} onChangeText={(t) => setMed(i, { dose: t })} placeholder="Dose" placeholderTextColor={c.textMuted} testID={`med-dose-${i}`} />
                  {meds.length > 1 && (
                    <TouchableOpacity onPress={() => rmMed(i)} style={styles.iconBtn}>
                      <Ionicons name="trash-outline" size={16} color={c.severityAlert} />
                    </TouchableOpacity>
                  )}
                </View>
              ))}
              <TouchableOpacity onPress={addMed} style={styles.addLine}>
                <Ionicons name="add" size={14} color={c.brandPrimary} />
                <Text style={styles.addLineText}>Add medication</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.card}>
              <Text style={styles.cardH}>Allergies</Text>
              <TextInput
                style={styles.input}
                value={allergies}
                onChangeText={setAllergies}
                placeholder="Penicillin, latex, peanuts… (comma-separated)"
                placeholderTextColor={c.textMuted}
                testID="hospital-allergies"
              />
            </View>

            <View style={styles.card}>
              <Text style={styles.cardH}>Emergency contact</Text>
              <TextInput style={styles.input} value={contact.name || ''} onChangeText={(t) => setContact((c) => ({ ...c, name: t }))} placeholder="Name" placeholderTextColor={c.textMuted} testID="hospital-contact-name" />
              <TextInput style={[styles.input, { marginTop: 8 }]} value={contact.phone || ''} onChangeText={(t) => setContact((c) => ({ ...c, phone: t }))} placeholder="Phone" placeholderTextColor={c.textMuted} keyboardType="phone-pad" testID="hospital-contact-phone" />
              <TextInput style={[styles.input, { marginTop: 8 }]} value={contact.relationship || ''} onChangeText={(t) => setContact((c) => ({ ...c, relationship: t }))} placeholder="Relationship (daughter, son, neighbour…)" placeholderTextColor={c.textMuted} testID="hospital-contact-rel" />
            </View>

            <TouchableOpacity style={[styles.cta, saving && { opacity: 0.6 }]} onPress={save} disabled={saving} testID="hospital-save">
              {saving ? <ActivityIndicator color="#FFFFFF" /> : (<>
                <Ionicons name="checkmark" size={14} color="#FFFFFF" />
                <Text style={styles.ctaText}>Save handover</Text>
              </>)}
            </TouchableOpacity>
            {data?.last_updated && (
              <Text style={styles.lastSaved}>Last saved {formatDateTime(data.last_updated)}</Text>
            )}
          </>
        )}

        {/* ── Stays tracker ───────────────────────────────────────── */}
        <View style={styles.staysHead}>
          <Text style={styles.staysH}>Recent stays</Text>
          <TouchableOpacity onPress={newStay} style={styles.staysAdd} testID="hospital-add-stay">
            <Ionicons name="add" size={16} color={c.brandPrimary} />
            <Text style={styles.staysAddLbl}>Log a stay</Text>
          </TouchableOpacity>
        </View>
        {stays.length === 0 ? (
          <View style={styles.staysEmpty}>
            <Ionicons name="bed-outline" size={22} color={c.textMuted} />
            <Text style={styles.staysEmptyLbl}>No hospital stays logged yet.</Text>
            <Text style={styles.staysEmptySub}>Tap “Log a stay” to add an admission so the family has a clean timeline.</Text>
          </View>
        ) : (
          stays.map((s) => {
            const active = !s.discharged;
            return (
              <View key={s.id} style={styles.stayCard} testID={`stay-${s.id}`}>
                <View style={styles.stayRowHead}>
                  <View style={[styles.stayBadge, active ? styles.stayBadgeActive : styles.stayBadgeDone]}>
                    <Text style={[styles.stayBadgeLbl, active ? styles.stayBadgeLblActive : styles.stayBadgeLblDone]}>
                      {active ? 'IN HOSPITAL' : 'DISCHARGED'}
                    </Text>
                  </View>
                  <Text style={styles.stayHospital} numberOfLines={1}>{s.hospital || 'Hospital'}</Text>
                </View>
                <Text style={styles.stayDates}>
                  Admitted {s.admitted}{s.discharged ? `  →  Discharged ${s.discharged}` : ''}
                </Text>
                {!!s.reason && <Text style={styles.stayReason}>{s.reason}</Text>}
                {!!s.notes && <Text style={styles.stayNotes} numberOfLines={3}>{s.notes}</Text>}
                <View style={styles.stayActions}>
                  {active && (
                    <TouchableOpacity onPress={() => dischargeNow(s.id)} style={styles.stayActionBtn}>
                      <Ionicons name="checkmark-circle-outline" size={14} color={c.brandPrimary} />
                      <Text style={styles.stayActionLbl}>Mark discharged</Text>
                    </TouchableOpacity>
                  )}
                  <TouchableOpacity onPress={() => editStay(s)} style={styles.stayActionBtn}>
                    <Ionicons name="create-outline" size={14} color={c.brandPrimary} />
                    <Text style={styles.stayActionLbl}>Edit</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => removeStay(s.id)} style={styles.stayActionBtn}>
                    <Ionicons name="trash-outline" size={14} color={c.severityAlert} />
                    <Text style={[styles.stayActionLbl, { color: c.severityAlert }]}>Remove</Text>
                  </TouchableOpacity>
                </View>
              </View>
            );
          })
        )}

        <View style={{ height: 40 }} />
      </KeyboardAwareScrollView>

      {/* ── Stay editor modal ──────────────────────────────────────── */}
      <Modal visible={stayModal} animationType="slide" transparent>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <View style={styles.modalHead}>
              <Text style={styles.modalTitle}>{stays.some(s => s.id === draft.id) ? 'Edit stay' : 'Log a hospital stay'}</Text>
              <TouchableOpacity onPress={() => setStayModal(false)} testID="stay-modal-close">
                <Ionicons name="close" size={22} color={c.textPrimary} />
              </TouchableOpacity>
            </View>
            <TextInput
              style={styles.input}
              value={draft.hospital || ''}
              onChangeText={(t) => setDraft((d) => ({ ...d, hospital: t }))}
              placeholder="Hospital (e.g. Royal Melbourne)"
              placeholderTextColor={c.textMuted}
              testID="stay-hospital"
            />
            <TextInput
              style={[styles.input, { marginTop: 8 }]}
              value={draft.admitted}
              onChangeText={(t) => setDraft((d) => ({ ...d, admitted: t }))}
              placeholder="Admitted (YYYY-MM-DD)"
              placeholderTextColor={c.textMuted}
              testID="stay-admitted"
            />
            <TextInput
              style={[styles.input, { marginTop: 8 }]}
              value={draft.discharged || ''}
              onChangeText={(t) => setDraft((d) => ({ ...d, discharged: t || null }))}
              placeholder="Discharged (YYYY-MM-DD or blank if still in)"
              placeholderTextColor={c.textMuted}
              testID="stay-discharged"
            />
            <TextInput
              style={[styles.input, { marginTop: 8 }]}
              value={draft.reason || ''}
              onChangeText={(t) => setDraft((d) => ({ ...d, reason: t }))}
              placeholder="Reason for admission"
              placeholderTextColor={c.textMuted}
              testID="stay-reason"
            />
            <TextInput
              style={[styles.input, { marginTop: 8, minHeight: 76, textAlignVertical: 'top' }]}
              multiline
              value={draft.notes || ''}
              onChangeText={(t) => setDraft((d) => ({ ...d, notes: t }))}
              placeholder="Notes for the family / care team"
              placeholderTextColor={c.textMuted}
              testID="stay-notes"
            />
            <TouchableOpacity style={styles.cta} onPress={saveStay} testID="stay-save">
              <Ionicons name="checkmark" size={14} color="#FFFFFF" />
              <Text style={styles.ctaText}>Save stay</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
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
  cardH: { fontFamily: Fonts.heading, fontSize: 16, color: c.brandPrimary, marginBottom: Spacing.sm },
  input: { fontFamily: Fonts.body, fontSize: 14, color: c.textPrimary, backgroundColor: '#FFFFFF', borderRadius: Radius.sm, paddingHorizontal: 10, paddingVertical: 10, borderWidth: 1, borderColor: c.borderSubtle, minHeight: 42 },
  medRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 },
  iconBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  addLine: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4, alignSelf: 'flex-start', paddingVertical: 6 },
  addLineText: { fontFamily: Fonts.bodyMed, fontSize: 13, color: c.brandPrimary },
  cta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: c.brandPrimary, borderRadius: Radius.md, paddingVertical: 14, minHeight: 50, marginTop: Spacing.sm },
  ctaText: { fontFamily: Fonts.bodySemi, fontSize: 14, color: '#FFFFFF' },
  lastSaved: { fontFamily: Fonts.body, fontSize: 11, color: c.textMuted, textAlign: 'center', marginTop: 8 },

  // Stays tracker
  staysHead: { flexDirection: 'row', alignItems: 'center', marginTop: Spacing.lg, marginBottom: Spacing.sm },
  staysH: { flex: 1, fontFamily: Fonts.heading, fontSize: 18, color: c.textPrimary, letterSpacing: -0.2 },
  staysAdd: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: c.surfaceTint, borderRadius: 999, borderWidth: 1, borderColor: c.borderSubtle },
  staysAddLbl: { fontFamily: Fonts.bodySemi, fontSize: 12, color: c.brandPrimary },
  staysEmpty: { padding: Spacing.lg, alignItems: 'center', gap: 6, backgroundColor: c.cardBg, borderRadius: Radius.md, borderWidth: 1, borderColor: c.borderSubtle },
  staysEmptyLbl: { fontFamily: Fonts.bodySemi, fontSize: 14, color: c.textPrimary, marginTop: 4 },
  staysEmptySub: { fontFamily: Fonts.body, fontSize: 12, color: c.textSecondary, textAlign: 'center', lineHeight: 18 },
  stayCard: { backgroundColor: c.cardBg, borderRadius: Radius.lg, borderWidth: 1, borderColor: c.borderSubtle, padding: Spacing.md, marginBottom: Spacing.sm, gap: 4 },
  stayRowHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  stayBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 },
  stayBadgeActive: { backgroundColor: 'rgba(192,57,43,0.15)' },
  stayBadgeDone: { backgroundColor: c.surfaceTint },
  stayBadgeLbl: { fontFamily: Fonts.bodySemi, fontSize: 9, letterSpacing: 1 },
  stayBadgeLblActive: { color: '#C0392B' },
  stayBadgeLblDone: { color: c.brandPrimary },
  stayHospital: { flex: 1, fontFamily: Fonts.bodySemi, fontSize: 14, color: c.textPrimary },
  stayDates: { fontFamily: Fonts.body, fontSize: 12, color: c.textSecondary, marginTop: 2 },
  stayReason: { fontFamily: Fonts.body, fontSize: 13, color: c.textPrimary, marginTop: 4 },
  stayNotes: { fontFamily: Fonts.body, fontSize: 12, color: c.textSecondary, marginTop: 4, lineHeight: 17 },
  stayActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 8 },
  stayActionBtn: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  stayActionLbl: { fontFamily: Fonts.bodySemi, fontSize: 12, color: c.brandPrimary },

  // Stay modal
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
  modalCard: { backgroundColor: c.background, padding: Spacing.lg, borderTopLeftRadius: 16, borderTopRightRadius: 16, gap: 0 },
  modalHead: { flexDirection: 'row', alignItems: 'center', marginBottom: Spacing.md },
  modalTitle: { flex: 1, fontFamily: Fonts.heading, fontSize: 18, color: c.textPrimary },
}); }
