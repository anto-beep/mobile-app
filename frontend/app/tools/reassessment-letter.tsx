// Reassessment letter drafter (uses Claude via /api/public/reassessment-letter)
import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, TextInput, TouchableOpacity, Alert, ActivityIndicator, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { api, extractErrorMessage } from '../../src/lib/api';
import { useAuth } from '../../src/context/AuthContext';
import { Colors, Fonts, Radius, Spacing } from '../../src/lib/theme';
import { AIAccuracyBanner, ToolGate, hasPaidAccess } from '../../src/components/AITools';

export default function ReassessmentLetter() {
  const router = useRouter();
  const [participant, setParticipant] = useState('');
  const [classification, setClassification] = useState(4);
  const [changes, setChanges] = useState('');
  const [events, setEvents] = useState('');
  const [sender, setSender] = useState('');
  const [loading, setLoading] = useState(false);
  const [letter, setLetter] = useState<string | null>(null);

  const generate = async () => {
    if (!participant.trim() || !sender.trim() || changes.trim().length < 10) {
      Alert.alert(
        'Add a few details',
        "We need the participant's name, your name, and a brief summary of the changes (10+ characters).",
      );
      return;
    }
    setLoading(true);
    setLetter(null);
    try {
      const { data } = await api.post('/public/reassessment-letter', {
        participant_name: participant.trim(),
        current_classification: classification,
        changes_summary: changes.trim(),
        recent_events: events.trim() || null,
        sender_name: sender.trim(),
        relationship: 'family caregiver',
      });
      setLetter(data.letter || '');
    } catch (e) {
      Alert.alert("Couldn't draft the letter", extractErrorMessage(e));
    } finally {
      setLoading(false);
    }
  };

  const copy = async () => {
    if (!letter) return;
    try {
      await Clipboard.setStringAsync(letter);
      Alert.alert('Copied', 'The letter is on your clipboard.');
    } catch {
      Alert.alert("Couldn't copy", 'Try selecting the text manually.');
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <TouchableOpacity onPress={() => router.back()} style={styles.back}><Ionicons name="chevron-back" size={20} color={Colors.brandPrimary} /><Text style={styles.backText}>Back</Text></TouchableOpacity>
          <Text style={styles.overline}>Reassessment letter</Text>
          <Text style={styles.h1}>Draft a letter to MAC</Text>
          <Text style={styles.sub}>If your parent's needs have changed, ask My Aged Care for a fresh look.</Text>
          <AIAccuracyBanner tool="reassessment-letter" />

          <Text style={styles.label}>Participant's name</Text>
          <TextInput style={styles.input} value={participant} onChangeText={setParticipant} placeholder="Margaret" placeholderTextColor={Colors.textMuted} testID="reassess-participant" />

          <Text style={styles.label}>Current classification</Text>
          <View style={styles.row}>
            {[1, 2, 3, 4, 5, 6, 7, 8].map((c) => (
              <TouchableOpacity
                key={c}
                style={[styles.chip, classification === c && styles.chipActive]}
                onPress={() => setClassification(c)}
              >
                <Text style={[styles.chipText, classification === c && styles.chipTextActive]}>{c}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={styles.label}>What's changed?</Text>
          <TextInput
            style={[styles.input, { minHeight: 100, textAlignVertical: 'top' }]}
            value={changes}
            onChangeText={setChanges}
            placeholder="e.g. New mobility issues since fall in March, increased confusion in evenings, can no longer prepare meals safely…"
            placeholderTextColor={Colors.textMuted}
            multiline
            testID="reassess-changes"
          />

          <Text style={styles.label}>Recent events (optional)</Text>
          <TextInput
            style={[styles.input, { minHeight: 80, textAlignVertical: 'top' }]}
            value={events}
            onChangeText={setEvents}
            placeholder="e.g. Hospital admission in February"
            placeholderTextColor={Colors.textMuted}
            multiline
            testID="reassess-events"
          />

          <Text style={styles.label}>Your name</Text>
          <TextInput style={styles.input} value={sender} onChangeText={setSender} placeholder="Cathy Williams" placeholderTextColor={Colors.textMuted} testID="reassess-sender" />

          <TouchableOpacity onPress={generate} disabled={loading} style={[styles.btn, loading && { opacity: 0.6 }]} testID="reassess-generate">
            {loading ? <ActivityIndicator color={Colors.cream} /> : <Text style={styles.btnText}>Draft the letter</Text>}
          </TouchableOpacity>

          {letter && (
            <View style={styles.result} testID="reassess-result">
              <View style={styles.resultHead}>
                <Text style={styles.resultTitle}>Your draft</Text>
                <TouchableOpacity onPress={copy} style={styles.copyBtn} testID="reassess-copy">
                  <Ionicons name="copy-outline" size={14} color={Colors.brandPrimary} />
                  <Text style={styles.copyText}>Copy</Text>
                </TouchableOpacity>
              </View>
              <Text style={styles.letterText} selectable>{letter}</Text>
              <Text style={styles.caveat}>Review before sending. Add the date, your address, and the recipient's address at the top.</Text>
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.lg, paddingBottom: 60 },
  back: { flexDirection: 'row', alignItems: 'center', marginBottom: Spacing.md },
  backText: { fontFamily: Fonts.bodyMed, fontSize: 14, color: Colors.brandPrimary },
  overline: { fontFamily: Fonts.bodyMed, fontSize: 11, letterSpacing: 1.5, textTransform: 'uppercase', color: Colors.textMuted },
  h1: { fontFamily: Fonts.heading, fontSize: 26, color: Colors.brandPrimary, letterSpacing: -0.5 },
  sub: { fontFamily: Fonts.body, fontSize: 14, color: Colors.textSecondary, marginTop: 6, marginBottom: Spacing.lg },
  label: { fontFamily: Fonts.bodyMed, fontSize: 13, color: Colors.textSecondary, marginTop: Spacing.md, marginBottom: 6 },
  input: { fontFamily: Fonts.body, fontSize: 15, color: Colors.textPrimary, backgroundColor: Colors.cardBg, borderRadius: Radius.md, paddingHorizontal: Spacing.md, paddingVertical: 12, borderWidth: 1, borderColor: Colors.border },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { minWidth: 44, paddingHorizontal: 14, paddingVertical: 10, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.cardBg, alignItems: 'center' },
  chipActive: { backgroundColor: Colors.brandPrimary, borderColor: Colors.brandPrimary },
  chipText: { fontFamily: Fonts.bodySemi, fontSize: 14, color: Colors.brandPrimary },
  chipTextActive: { color: Colors.cream },
  btn: { marginTop: Spacing.lg, backgroundColor: Colors.brandPrimary, borderRadius: Radius.md, paddingVertical: 14, alignItems: 'center', minHeight: 50, justifyContent: 'center' },
  btnText: { fontFamily: Fonts.bodySemi, fontSize: 15, color: Colors.cream },
  result: { marginTop: Spacing.lg, backgroundColor: Colors.cardBg, borderRadius: Radius.lg, padding: Spacing.lg, borderWidth: 1, borderColor: Colors.borderSubtle },
  resultHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: Spacing.md },
  resultTitle: { fontFamily: Fonts.headingMed, fontSize: 16, color: Colors.brandPrimary },
  copyBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: Radius.sm, backgroundColor: 'rgba(14, 77, 82, 0.06)' },
  copyText: { fontFamily: Fonts.bodySemi, fontSize: 12, color: Colors.brandPrimary },
  letterText: { fontFamily: Fonts.body, fontSize: 14, color: Colors.textPrimary, lineHeight: 22 },
  caveat: { fontFamily: Fonts.body, fontSize: 12, color: Colors.textMuted, marginTop: Spacing.md, fontStyle: 'italic' },
});
