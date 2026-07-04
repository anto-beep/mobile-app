// Reassessment letter drafter — iter 48 parity. Three letter types, RCP-only
// hospital + discharge fields, and URL-query deep-link support so the
// dashboard pathway tile can launch the screen pre-filled for RCP.
import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, TextInput, TouchableOpacity, Alert, ActivityIndicator, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { api, extractErrorMessage } from '../../src/lib/api';
import { Fonts, Radius, Spacing } from '../../src/lib/theme';
import type { ColorPalette } from '../../src/lib/theme';
import { useColors } from '../../src/hooks/useColors';
import { useThemedStyles } from '../../src/hooks/useThemedStyles';
import { AIAccuracyBanner } from '../../src/components/AITools';
import { ToolSummary, ReportIssueButton } from '../../src/components/ToolShell';

import { AboutThisToolButton } from '../../src/components/ToolInfoSheet';
type LetterType = 'classification_reassessment' | 'rcp_assessment' | 'care_plan_amendment';
const LETTER_TYPES: { key: LetterType; label: string; sub: string }[] = [
  { key: 'classification_reassessment', label: 'Classification reassessment', sub: 'Ask My Aged Care to reassess the classification level' },
  { key: 'rcp_assessment',              label: 'Restorative Care Pathway',    sub: 'Request RCP after a hospital admission or mobility decline' },
  { key: 'care_plan_amendment',         label: 'Care plan amendment',         sub: 'Ask your provider to update the current care plan' },
];

export default function ReassessmentLetter() {
  const c = useColors();
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const params = useLocalSearchParams<{ letter_type?: string }>();
  const initialType: LetterType = ['rcp_assessment', 'care_plan_amendment', 'classification_reassessment'].includes(String(params.letter_type)) ? (params.letter_type as LetterType) : 'classification_reassessment';
  const [letterType, setLetterType] = useState<LetterType>(initialType);
  const [participant, setParticipant] = useState('');
  const [classification, setClassification] = useState(4);
  const [changes, setChanges] = useState('');
  const [events, setEvents] = useState('');
  const [sender, setSender] = useState('');
  const [hospital, setHospital] = useState('');
  const [discharge, setDischarge] = useState('');
  const [loading, setLoading] = useState(false);
  const [letter, setLetter] = useState<string | null>(null);
  const [returnedType, setReturnedType] = useState<string | null>(null);

  useEffect(() => {
    if (params.letter_type && initialType !== letterType) setLetterType(initialType);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.letter_type]);

  const generate = async () => {
    if (!participant.trim() || !sender.trim() || changes.trim().length < 10) {
      Alert.alert('Add a few details', "We need the participant's name, your name, and a brief summary of the changes (10+ characters).");
      return;
    }
    setLoading(true);
    setLetter(null);
    setReturnedType(null);
    try {
      const body: any = {
        letter_type: letterType,
        participant_name: participant.trim(),
        current_classification: classification,
        changes_summary: changes.trim(),
        recent_events: events.trim() || null,
        sender_name: sender.trim(),
        relationship: 'family caregiver',
      };
      // Mirror the web 'submit' handler: only include hospital / discharge fields
      // when the letter type is rcp_assessment.
      if (letterType === 'rcp_assessment') {
        if (hospital.trim()) body.hospital_name = hospital.trim();
        if (discharge.trim()) body.discharge_date = discharge.trim();
      }
      const { data } = await api.post('/public/reassessment-letter', body);
      setLetter(data.letter || '');
      setReturnedType(data.letter_type || null);
    } catch (e) {
      Alert.alert("Could not draft the letter", extractErrorMessage(e));
    } finally { setLoading(false); }
  };

  const copy = async () => {
    if (!letter) return;
    try { await Clipboard.setStringAsync(letter); Alert.alert('Copied', 'The letter is on your clipboard.'); }
    catch { Alert.alert("Could not copy", 'Try selecting the text manually.'); }
  };

  const meta = LETTER_TYPES.find((l) => l.key === (returnedType || letterType)) || LETTER_TYPES[0];

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <TouchableOpacity onPress={() => router.back()} style={styles.back}><Ionicons name="chevron-back" size={20} color={c.brandPrimary} /><Text style={styles.backText}>Back</Text></TouchableOpacity>
          <Text style={styles.overline}>Reassessment Letter Drafter</Text>
        <View style={{ marginTop: 6, marginBottom: 4 }}><AboutThisToolButton toolKey="reassessment-letter" /></View>
          <Text style={styles.h1}>Draft an Aged-Care Letter</Text>
          <Text style={styles.sub}>If needs have changed, write to My Aged Care or your provider with the right framing.</Text>
          <AIAccuracyBanner tool="reassessment-letter" />

          <Text style={styles.label}>Letter type</Text>
          <View style={styles.typeGrid}>
            {LETTER_TYPES.map((t) => {
              const on = letterType === t.key;
              return (
                <TouchableOpacity key={t.key} style={[styles.typeCard, on && styles.typeCardOn]} onPress={() => setLetterType(t.key)} testID={`rl-type-${t.key}`}>
                  <Text style={[styles.typeLabel, on && styles.typeLabelOn]}>{t.label}</Text>
                  <Text style={styles.typeSub}>{t.sub}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <Text style={styles.label}>Participant's name</Text>
          <TextInput style={styles.input} value={participant} onChangeText={setParticipant} placeholder="e.g. Margaret" placeholderTextColor={c.textMuted} testID="reassess-participant" />

          <Text style={styles.label}>Current classification</Text>
          <View style={styles.row}>
            {[1, 2, 3, 4, 5, 6, 7, 8].map((c) => (
              <TouchableOpacity key={c} style={[styles.chip, classification === c && styles.chipActive]} onPress={() => setClassification(c)}>
                <Text style={[styles.chipText, classification === c && styles.chipTextActive]}>{c}</Text>
              </TouchableOpacity>
            ))}
          </View>

          {letterType === 'rcp_assessment' && (
            <View testID="rl-rcp-fields">
              <Text style={styles.label}>Hospital name</Text>
              <TextInput style={styles.input} value={hospital} onChangeText={setHospital} placeholder="e.g. Royal Melbourne Hospital" placeholderTextColor={c.textMuted} testID="rl-hospital" />
              <Text style={styles.label}>Discharge date</Text>
              <TextInput style={styles.input} value={discharge} onChangeText={setDischarge} placeholder="YYYY-MM-DD" placeholderTextColor={c.textMuted} testID="rl-discharge" />
            </View>
          )}

          <Text style={styles.label}>What Has Changed?</Text>
          <TextInput style={[styles.input, { minHeight: 100, textAlignVertical: 'top' }]} value={changes} onChangeText={setChanges} placeholder="e.g. New mobility issues since fall in March; increased confusion in the evenings; can no longer prepare meals safely…" placeholderTextColor={c.textMuted} multiline testID="reassess-changes" />

          <Text style={styles.label}>Recent events (optional)</Text>
          <TextInput style={[styles.input, { minHeight: 80, textAlignVertical: 'top' }]} value={events} onChangeText={setEvents} placeholder="e.g. Hospital admission in February" placeholderTextColor={c.textMuted} multiline testID="reassess-events" />

          <Text style={styles.label}>Your name</Text>
          <TextInput style={styles.input} value={sender} onChangeText={setSender} placeholder="Your full name" placeholderTextColor={c.textMuted} testID="reassess-sender" />

          <TouchableOpacity onPress={generate} disabled={loading} style={[styles.btn, loading && { opacity: 0.6 }]} testID="reassess-generate">
            {loading ? <ActivityIndicator color={c.cream} /> : <Text style={styles.btnText}>Draft the letter</Text>}
          </TouchableOpacity>

          {letter && (
            <View style={styles.result} testID="reassess-result">
              <ToolSummary
                toolName="Reassessment Letter Drafter"
                tone="success"
                headline="Your reassessment letter is ready to review."
                body="Wayly drafted a short, factual letter to My Aged Care asking for a reassessment. Read it end to end, edit anything that does not sound like you, and send it from your own email. Include the participant's My Aged Care reference number if you have it."
              />
              <View style={styles.resultHead}>
                <Text style={styles.resultTitle}>{meta.label}</Text>
                <TouchableOpacity onPress={copy} style={styles.copyBtn} testID="reassess-copy">
                  <Ionicons name="copy-outline" size={14} color={c.brandPrimary} />
                  <Text style={styles.copyText}>Copy</Text>
                </TouchableOpacity>
              </View>
              <Text style={styles.letterText} selectable>{letter}</Text>
              <Text style={styles.caveat}>Review before sending. Add the date, your address, and the recipient's address at the top.</Text>
              <ReportIssueButton tool="Reassessment Letter Drafter" />
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function makeStyles(c: ColorPalette) { return StyleSheet.create({
  safe: { flex: 1, backgroundColor: c.background },
  scroll: { padding: Spacing.lg, paddingBottom: 60 },
  back: { flexDirection: 'row', alignItems: 'center', marginBottom: Spacing.md },
  backText: { fontFamily: Fonts.bodyMed, fontSize: 14, color: c.brandPrimary },
  overline: { fontFamily: Fonts.bodyMed, fontSize: 11, letterSpacing: 1.5, textTransform: 'uppercase', color: c.textMuted },
  h1: { fontFamily: Fonts.heading, fontSize: 26, color: c.brandPrimary, letterSpacing: -0.5 },
  sub: { fontFamily: Fonts.body, fontSize: 14, color: c.textSecondary, marginTop: 6, marginBottom: Spacing.lg },
  label: { fontFamily: Fonts.bodyMed, fontSize: 13, color: c.textSecondary, marginTop: Spacing.md, marginBottom: 6 },
  input: { fontFamily: Fonts.body, fontSize: 15, color: c.textPrimary, backgroundColor: c.cardBg, borderRadius: Radius.md, paddingHorizontal: Spacing.md, paddingVertical: 12, borderWidth: 1, borderColor: c.border },
  typeGrid: { gap: 6 },
  typeCard: { padding: 10, borderRadius: Radius.md, borderWidth: 1, borderColor: c.borderSubtle, backgroundColor: c.cardBg },
  typeCardOn: { borderColor: c.brandPrimary, backgroundColor: 'rgba(14, 77, 82, 0.06)' },
  typeLabel: { fontFamily: Fonts.bodySemi, fontSize: 14, color: c.textPrimary },
  typeLabelOn: { color: c.brandPrimary },
  typeSub: { fontFamily: Fonts.body, fontSize: 11, color: c.textMuted, marginTop: 2, lineHeight: 15 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { minWidth: 44, paddingHorizontal: 14, paddingVertical: 10, borderRadius: Radius.md, borderWidth: 1, borderColor: c.border, backgroundColor: c.cardBg, alignItems: 'center' },
  chipActive: { backgroundColor: c.brandPrimary, borderColor: c.brandPrimary },
  chipText: { fontFamily: Fonts.bodySemi, fontSize: 14, color: c.brandPrimary },
  chipTextActive: { color: c.cream },
  btn: { marginTop: Spacing.lg, backgroundColor: c.brandPrimary, borderRadius: Radius.md, paddingVertical: 14, alignItems: 'center', minHeight: 50, justifyContent: 'center' },
  btnText: { fontFamily: Fonts.bodySemi, fontSize: 15, color: c.cream },
  result: { marginTop: Spacing.lg, backgroundColor: c.cardBg, borderRadius: Radius.lg, padding: Spacing.lg, borderWidth: 1, borderColor: c.borderSubtle },
  resultHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: Spacing.md },
  resultTitle: { fontFamily: Fonts.headingMed, fontSize: 16, color: c.brandPrimary, flex: 1 },
  copyBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: Radius.sm, backgroundColor: 'rgba(14, 77, 82, 0.06)' },
  copyText: { fontFamily: Fonts.bodySemi, fontSize: 12, color: c.brandPrimary },
  letterText: { fontFamily: Fonts.body, fontSize: 14, color: c.textPrimary, lineHeight: 22 },
  caveat: { fontFamily: Fonts.body, fontSize: 12, color: c.textMuted, marginTop: Spacing.md, fontStyle: 'italic' },
}); }
