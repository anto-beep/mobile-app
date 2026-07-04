// Classification self-check (12 questions)
import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { api, extractErrorMessage } from '../../src/lib/api';
import { useAuth } from '../../src/context/AuthContext';
import { Fonts, Radius, Spacing, formatAUD } from '../../src/lib/theme';
import type { ColorPalette } from '../../src/lib/theme';
import { useColors } from '../../src/hooks/useColors';
import { useThemedStyles } from '../../src/hooks/useThemedStyles';
import { ToolGate, hasPaidAccess } from '../../src/components/AITools';
import { ToolSummary, ReportIssueButton } from '../../src/components/ToolShell';

import { AboutThisToolButton } from '../../src/components/ToolInfoSheet';
const QUESTIONS = [
  'Mobility, moving around the home',
  'Climbing stairs or steps',
  'Showering or bathing',
  'Dressing & grooming',
  'Toileting',
  'Eating / preparing food',
  'Memory & decision-making',
  'Mood & social engagement',
  'Managing medications',
  'Managing money & paperwork',
  'Light cleaning / laundry',
  'Going out into the community',
];

const SCALE: { value: number; label: string }[] = [
  { value: 0, label: 'No issue' },
  { value: 1, label: 'Slight' },
  { value: 2, label: 'Some' },
  { value: 3, label: 'Lots' },
  { value: 4, label: 'Total' },
];

export default function ClassificationCheck() {
  const c = useColors();
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const { user } = useAuth();
  const [answers, setAnswers] = useState<number[]>(Array(12).fill(0));
  const [currentClass, setCurrentClass] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);

  if (!hasPaidAccess(user)) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScrollView contentContainerStyle={styles.scroll}>
          <TouchableOpacity onPress={() => router.back()} style={styles.back}><Ionicons name="chevron-back" size={20} color={c.brandPrimary} /><Text style={styles.backText}>Back</Text></TouchableOpacity>
          <Text style={styles.overline}>Classification Self-Check</Text>
        <View style={{ marginTop: 6, marginBottom: 4 }}><AboutThisToolButton toolKey="classification-check" /></View>
          <ToolGate tool="classification-self-check" variant={user ? 'free-plan' : 'unauth'} />
        </ScrollView>
      </SafeAreaView>
    );
  }

  const setAnswer = (i: number, v: number) => {
    setAnswers((prev) => prev.map((a, idx) => (idx === i ? v : a)));
  };

  const submit = async () => {
    setLoading(true);
    setResult(null);
    try {
      const { data } = await api.post('/public/classification-check', {
        answers,
        current_classification: currentClass,
      });
      setResult(data);
    } catch (e) {
      Alert.alert("Could not check", extractErrorMessage(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <TouchableOpacity onPress={() => router.back()} style={styles.back}><Ionicons name="chevron-back" size={20} color={c.brandPrimary} /><Text style={styles.backText}>Back</Text></TouchableOpacity>
        <Text style={styles.overline}>Classification Self-Check</Text>
        <Text style={styles.sub}>Twelve questions, two minutes, gives a likely Support at Home level.</Text>
        <View style={styles.note}>
          <Ionicons name="information-circle-outline" size={16} color={c.severityInfo} />
          <Text style={styles.noteText}>Informational only. The actual classification is set by My Aged Care's IAT.</Text>
        </View>

        {QUESTIONS.map((q, i) => (
          <View key={i} style={styles.qBlock} testID={`class-q-${i}`}>
            <Text style={styles.qText}>{i + 1}. {q}</Text>
            <View style={styles.scale}>
              {SCALE.map((s) => (
                <TouchableOpacity
                  key={s.value}
                  style={[styles.dot, answers[i] === s.value && styles.dotActive]}
                  onPress={() => setAnswer(i, s.value)}
                  testID={`class-q-${i}-${s.value}`}
                >
                  <Text style={[styles.dotText, answers[i] === s.value && styles.dotTextActive]}>{s.value}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <View style={styles.scaleLabels}>
              <Text style={styles.scaleLabel}>No issue</Text>
              <Text style={styles.scaleLabel}>Total</Text>
            </View>
          </View>
        ))}

        <Text style={styles.label}>Current classification (if known)</Text>
        <View style={styles.row}>
          {[null, 1, 2, 3, 4, 5, 6, 7, 8].map((c) => (
            <TouchableOpacity
              key={c ?? 'unknown'}
              style={[styles.chip, currentClass === c && styles.chipActive]}
              onPress={() => setCurrentClass(c)}
            >
              <Text style={[styles.chipText, currentClass === c && styles.chipTextActive]}>
                {c === null ? '—' : c}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <TouchableOpacity onPress={submit} disabled={loading} style={[styles.btn, loading && { opacity: 0.6 }]} testID="class-submit">
          <Text style={styles.btnText}>{loading ? 'Working it out…' : 'Show me'}</Text>
        </TouchableOpacity>

        {result && (
          <View style={styles.result} testID="class-result">
            <ToolSummary
              toolName="Classification Self-Check"
              tone={result.suggest_reassessment ? 'alert' : 'neutral'}
              headline={`Your answers point to ${result.likely_label}.`}
              body={`Based on 12 questions about daily living, mobility, cognition and support, Wayly estimates ${result.likely_label}. That maps to an annual budget between ${formatAUD(result.annual_range[0])} and ${formatAUD(result.annual_range[1])}. This is a self-check to help you prepare, not an official assessment.`}
            />
            <Text style={styles.resultOverline}>Likely classification</Text>
            <Text style={styles.resultAmount}>{result.likely_label}</Text>
            <Text style={styles.resultSub}>
              Annual budget range: {formatAUD(result.annual_range[0])} to {formatAUD(result.annual_range[1])}
            </Text>
            <View style={styles.divider} />
            <Text style={styles.resultLine}>Score: <Text style={styles.bold}>{result.score} of {result.score_max}</Text></Text>
            {result.suggest_reassessment && (
              <View style={styles.suggest}>
                <Ionicons name="alert-circle-outline" size={16} color={c.severityWarning} />
                <Text style={styles.suggestText}>
                  Worth requesting a reassessment, your current level looks out of step with these answers.
                </Text>
              </View>
            )}
            <Text style={styles.caveat}>{result.caveat}</Text>
            <ReportIssueButton tool="Classification Self-Check" />
          </View>
        )}
      </ScrollView>
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
  sub: { fontFamily: Fonts.body, fontSize: 14, color: c.textSecondary, marginTop: 6 },
  note: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, marginVertical: Spacing.md, padding: Spacing.sm, backgroundColor: 'rgba(139, 155, 130, 0.1)', borderRadius: Radius.sm },
  noteText: { fontFamily: Fonts.body, fontSize: 12, color: c.textSecondary, flex: 1, lineHeight: 17 },
  qBlock: { backgroundColor: c.cardBg, padding: Spacing.md, borderRadius: Radius.md, marginBottom: Spacing.sm, borderWidth: 1, borderColor: c.borderSubtle },
  qText: { fontFamily: Fonts.bodySemi, fontSize: 14, color: c.brandPrimary, marginBottom: Spacing.sm },
  scale: { flexDirection: 'row', justifyContent: 'space-between', gap: 6 },
  dot: { width: 44, height: 44, borderRadius: 22, borderWidth: 1, borderColor: c.border, alignItems: 'center', justifyContent: 'center', flex: 1 },
  dotActive: { backgroundColor: c.brandPrimary, borderColor: c.brandPrimary },
  dotText: { fontFamily: Fonts.bodySemi, fontSize: 14, color: c.brandPrimary },
  dotTextActive: { color: c.cream },
  scaleLabels: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 },
  scaleLabel: { fontFamily: Fonts.body, fontSize: 10, color: c.textMuted },
  label: { fontFamily: Fonts.bodyMed, fontSize: 13, color: c.textSecondary, marginTop: Spacing.lg, marginBottom: 8 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { minWidth: 44, paddingHorizontal: 14, paddingVertical: 10, borderRadius: Radius.md, borderWidth: 1, borderColor: c.border, backgroundColor: c.cardBg, alignItems: 'center' },
  chipActive: { backgroundColor: c.brandPrimary, borderColor: c.brandPrimary },
  chipText: { fontFamily: Fonts.bodySemi, fontSize: 14, color: c.brandPrimary },
  chipTextActive: { color: c.cream },
  btn: { marginTop: Spacing.lg, backgroundColor: c.brandPrimary, borderRadius: Radius.md, paddingVertical: 14, alignItems: 'center' },
  btnText: { fontFamily: Fonts.bodySemi, fontSize: 15, color: c.cream },
  result: { marginTop: Spacing.lg, backgroundColor: c.cardBg, borderRadius: Radius.lg, padding: Spacing.lg, borderWidth: 1, borderColor: c.borderSubtle },
  resultOverline: { fontFamily: Fonts.bodyMed, fontSize: 11, letterSpacing: 1.5, textTransform: 'uppercase', color: c.brandSecondary, marginBottom: 4 },
  resultAmount: { fontFamily: Fonts.heading, fontSize: 28, color: c.brandPrimary, letterSpacing: -0.5 },
  resultSub: { fontFamily: Fonts.mono, fontVariant: ['tabular-nums' as const], fontSize: 13, color: c.textSecondary, marginTop: 4 },
  divider: { height: 1, backgroundColor: c.borderSubtle, marginVertical: Spacing.md },
  resultLine: { fontFamily: Fonts.body, fontSize: 14, color: c.textSecondary, lineHeight: 20 },
  bold: { fontFamily: Fonts.bodySemi, color: c.brandPrimary },
  suggest: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, padding: Spacing.sm, backgroundColor: 'rgba(183, 121, 31, 0.1)', borderRadius: Radius.sm, marginTop: Spacing.sm },
  suggestText: { fontFamily: Fonts.bodyMed, fontSize: 13, color: c.brandPrimary, flex: 1, lineHeight: 18 },
  caveat: { fontFamily: Fonts.body, fontSize: 11, color: c.textMuted, marginTop: Spacing.sm, fontStyle: 'italic', lineHeight: 16 },
}); }
