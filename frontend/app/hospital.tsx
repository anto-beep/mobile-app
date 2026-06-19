// Hospital handover — ED-ready one-pager editor.
// Captures summary, meds, allergies, emergency contact — saves via
// upsert at POST /api/hospital/handover so the data is one tap to recall.
import React, { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity,
  ActivityIndicator, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { Ionicons } from '@expo/vector-icons';
import { useApi } from '../src/lib/useApi';
import { api, extractErrorMessage } from '../src/lib/api';
import BackHeader from '../src/components/BackHeader';
import { toast } from '../src/components/Toast';
import { Colors, Fonts, Radius, Spacing } from '../src/lib/theme';

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

export default function Hospital() {
  const { data, loading, refreshing, refresh } = useApi<Handover>('/hospital/handover');

  const [summary, setSummary] = useState('');
  const [meds, setMeds] = useState<Med[]>([]);
  const [allergies, setAllergies] = useState<string>('');
  const [contact, setContact] = useState<Contact>({});
  const [saving, setSaving] = useState(false);

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
    } catch (e) { toast.error(extractErrorMessage(e, "Couldn't save handover")); }
    finally { setSaving(false); }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <BackHeader title="Hospital handover" />
      <KeyboardAwareScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        bottomOffset={24}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={Colors.brandPrimary} />}
      >
        <View style={styles.heroRow}>
          <Ionicons name="medkit-outline" size={22} color={Colors.brandPrimary} />
          <Text style={styles.hero}>Hospital handover</Text>
        </View>
        <Text style={styles.subhero}>What an ED triage nurse needs in 30 seconds. We&apos;ll save it so you can pull it up on the way to hospital.</Text>

        {loading && !data ? <ActivityIndicator color={Colors.brandPrimary} /> : (
          <>
            <View style={styles.card}>
              <Text style={styles.cardH}>Summary</Text>
              <TextInput
                style={[styles.input, { minHeight: 96, textAlignVertical: 'top' }]}
                multiline
                value={summary}
                onChangeText={setSummary}
                placeholder="e.g. 78yo, lives independently, mild cognitive impairment, mobility limited after May fall."
                placeholderTextColor={Colors.textMuted}
                testID="hospital-summary"
              />
            </View>

            <View style={styles.card}>
              <Text style={styles.cardH}>Medications</Text>
              {meds.map((m, i) => (
                <View key={i} style={styles.medRow}>
                  <TextInput style={[styles.input, { flex: 2 }]} value={m.name || ''} onChangeText={(t) => setMed(i, { name: t })} placeholder="Medication name" placeholderTextColor={Colors.textMuted} testID={`med-name-${i}`} />
                  <TextInput style={[styles.input, { flex: 1 }]} value={m.dose || ''} onChangeText={(t) => setMed(i, { dose: t })} placeholder="Dose" placeholderTextColor={Colors.textMuted} testID={`med-dose-${i}`} />
                  {meds.length > 1 && (
                    <TouchableOpacity onPress={() => rmMed(i)} style={styles.iconBtn}>
                      <Ionicons name="trash-outline" size={16} color={Colors.severityAlert} />
                    </TouchableOpacity>
                  )}
                </View>
              ))}
              <TouchableOpacity onPress={addMed} style={styles.addLine}>
                <Ionicons name="add" size={14} color={Colors.brandPrimary} />
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
                placeholderTextColor={Colors.textMuted}
                testID="hospital-allergies"
              />
            </View>

            <View style={styles.card}>
              <Text style={styles.cardH}>Emergency contact</Text>
              <TextInput style={styles.input} value={contact.name || ''} onChangeText={(t) => setContact((c) => ({ ...c, name: t }))} placeholder="Name" placeholderTextColor={Colors.textMuted} testID="hospital-contact-name" />
              <TextInput style={[styles.input, { marginTop: 8 }]} value={contact.phone || ''} onChangeText={(t) => setContact((c) => ({ ...c, phone: t }))} placeholder="Phone" placeholderTextColor={Colors.textMuted} keyboardType="phone-pad" testID="hospital-contact-phone" />
              <TextInput style={[styles.input, { marginTop: 8 }]} value={contact.relationship || ''} onChangeText={(t) => setContact((c) => ({ ...c, relationship: t }))} placeholder="Relationship (daughter, son, neighbour…)" placeholderTextColor={Colors.textMuted} testID="hospital-contact-rel" />
            </View>

            <TouchableOpacity style={[styles.cta, saving && { opacity: 0.6 }]} onPress={save} disabled={saving} testID="hospital-save">
              {saving ? <ActivityIndicator color="#FFFFFF" /> : (<>
                <Ionicons name="checkmark" size={14} color="#FFFFFF" />
                <Text style={styles.ctaText}>Save handover</Text>
              </>)}
            </TouchableOpacity>
            {data?.last_updated && (
              <Text style={styles.lastSaved}>Last saved {new Date(data.last_updated).toLocaleString('en-AU')}</Text>
            )}
          </>
        )}
        <View style={{ height: 40 }} />
      </KeyboardAwareScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.md, paddingBottom: 40 },
  heroRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 6 },
  hero: { fontFamily: Fonts.heading, fontSize: 24, color: Colors.brandPrimary, letterSpacing: -0.3 },
  subhero: { fontFamily: Fonts.body, fontSize: 13, color: Colors.textSecondary, lineHeight: 19, marginBottom: Spacing.lg },
  card: { backgroundColor: Colors.cardBg, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.borderSubtle, padding: Spacing.md, marginBottom: Spacing.md },
  cardH: { fontFamily: Fonts.heading, fontSize: 16, color: Colors.brandPrimary, marginBottom: Spacing.sm },
  input: { fontFamily: Fonts.body, fontSize: 14, color: Colors.textPrimary, backgroundColor: '#FFFFFF', borderRadius: Radius.sm, paddingHorizontal: 10, paddingVertical: 10, borderWidth: 1, borderColor: Colors.borderSubtle, minHeight: 42 },
  medRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 },
  iconBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  addLine: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4, alignSelf: 'flex-start', paddingVertical: 6 },
  addLineText: { fontFamily: Fonts.bodyMed, fontSize: 13, color: Colors.brandPrimary },
  cta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: Colors.brandPrimary, borderRadius: Radius.md, paddingVertical: 14, minHeight: 50, marginTop: Spacing.sm },
  ctaText: { fontFamily: Fonts.bodySemi, fontSize: 14, color: '#FFFFFF' },
  lastSaved: { fontFamily: Fonts.body, fontSize: 11, color: Colors.textMuted, textAlign: 'center', marginTop: 8 },
});
