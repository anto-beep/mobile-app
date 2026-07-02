// Care Plan Reviewer — iter 48 parity. Renders the six canonical checks as
// coloured pill rows (pass=sage, flag=terracotta, unknown=amber).
import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, TextInput, ActivityIndicator, Alert, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { api, extractErrorMessage } from '../../src/lib/api';
import { useAuth } from '../../src/context/AuthContext';
import { Colors, Fonts, Radius, Spacing } from '../../src/lib/theme';
import type { ColorPalette } from '../../src/lib/theme';
import { useColors } from '../../src/hooks/useColors';
import { useThemedStyles } from '../../src/hooks/useThemedStyles';
import { AIAccuracyBanner, ToolGate, hasPaidAccess } from '../../src/components/AITools';
import { ToolSummary, ReportIssueButton } from '../../src/components/ToolShell';

const CANONICAL_CHECKS = [
  { key: 'budget_fit',          label: 'Budget fit'           },
  { key: 'care_management_cap', label: 'Care management cap'  },
  { key: 'service_list',        label: 'Service list'         },
  { key: 'stream_alignment',    label: 'Stream alignment'     },
  { key: 'review_date',         label: 'Review date'          },
  { key: 'goals_alignment',     label: 'Goals alignment'      },
];

const PILL: Record<string, { fg: string; bg: string }> = {
  pass:    { fg: Colors.success,        bg: 'rgba(27, 87, 51, 0.10)' },
  flag:    { fg: Colors.severityAlert,  bg: 'rgba(192, 57, 43, 0.10)' },
  unknown: { fg: Colors.brandSecondary, bg: 'rgba(183, 121, 31, 0.10)' },
};

export default function CarePlanReviewer() {
  const c = useColors();
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const { user } = useAuth();
  const [plan, setPlan] = useState('');
  const [concerns, setConcerns] = useState('');
  const [classification, setClassification] = useState<number | null>(null);
  const [budget, setBudget] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);

  if (!hasPaidAccess(user)) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScrollView contentContainerStyle={styles.scroll}>
          <TouchableOpacity onPress={() => router.back()} style={styles.back}><Ionicons name="chevron-back" size={20} color={c.brandPrimary} /><Text style={styles.backText}>Back</Text></TouchableOpacity>
          <Text style={styles.overline}>Care Plan Reviewer</Text>
          <Text style={styles.h1}>Six-Check Care-Plan Review</Text>
          <AIAccuracyBanner tool="care-plan-reviewer" />
          <ToolGate tool="care-plan-reviewer" variant={user ? 'free-plan' : 'unauth'} />
        </ScrollView>
      </SafeAreaView>
    );
  }

  const review = async () => {
    if (plan.trim().length < 50) { Alert.alert('Paste your care plan', 'We need at least a short paragraph to review.'); return; }
    setLoading(true);
    setResult(null);
    try {
      const body: any = { text: plan, concerns: concerns || null };
      if (classification != null) body.classification = classification;
      if (budget) body.quarterly_budget = parseFloat(budget);
      const { data } = await api.post('/public/care-plan-review', body);
      setResult(data);
    } catch (e) {
      Alert.alert("Could not review", extractErrorMessage(e));
    } finally { setLoading(false); }
  };

  // Backend returns checks in canonical order, but we still defensively map by key.
  const checksByKey: Record<string, any> = {};
  (result?.checks || []).forEach((c: any) => { checksByKey[c.check] = c; });
  const flagCount = (result?.checks || []).filter((x: any) => x.status === 'flag').length;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <TouchableOpacity onPress={() => router.back()} style={styles.back}><Ionicons name="chevron-back" size={20} color={c.brandPrimary} /><Text style={styles.backText}>Back</Text></TouchableOpacity>
          <Text style={styles.overline}>Care Plan Reviewer</Text>
          <Text style={styles.h1}>Six-Check Care-Plan Review</Text>
          <Text style={styles.sub}>Paste the participant's care plan. We check budget fit, CM cap, services, stream alignment, review date and goals.</Text>
          <AIAccuracyBanner tool="care-plan-reviewer" />

          <Text style={styles.label}>Classification (optional)</Text>
          <View style={styles.row}>
            <TouchableOpacity style={[styles.chip, classification == null && styles.chipActive]} onPress={() => setClassification(null)}>
              <Text style={[styles.chipText, classification == null && styles.chipTextActive]}>Not set</Text>
            </TouchableOpacity>
            {[1, 2, 3, 4, 5, 6, 7, 8].map((c) => (
              <TouchableOpacity key={c} style={[styles.chip, classification === c && styles.chipActive]} onPress={() => setClassification(c)} testID={`cp-classification-${c}`}>
                <Text style={[styles.chipText, classification === c && styles.chipTextActive]}>{c}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={styles.label}>Quarterly budget (optional)</Text>
          <TextInput style={styles.input} keyboardType="numeric" value={budget} onChangeText={setBudget} placeholder="e.g. 7424" placeholderTextColor={c.textMuted} testID="cp-quarterly-budget" />

          <Text style={styles.label}>Care plan text</Text>
          <TextInput style={[styles.input, { minHeight: 160, textAlignVertical: 'top' }]} value={plan} onChangeText={setPlan} placeholder="Paste the participant's care plan here…" placeholderTextColor={c.textMuted} multiline testID="careplan-text" />

          <Text style={styles.label}>Specific concerns (optional)</Text>
          <TextInput style={[styles.input, { minHeight: 70, textAlignVertical: 'top' }]} value={concerns} onChangeText={setConcerns} placeholder="e.g. Mobility has worsened, is this plan keeping up?" placeholderTextColor={c.textMuted} multiline testID="careplan-concerns" />

          <TouchableOpacity onPress={review} disabled={loading} style={[styles.btn, loading && { opacity: 0.6 }]} testID="careplan-review">
            {loading ? <ActivityIndicator color={c.cream} /> : <Text style={styles.btnText}>Review the plan</Text>}
          </TouchableOpacity>

          {result && (
            <View style={styles.result} testID="careplan-result">
              <ToolSummary
                toolName="Care Plan Reviewer"
                tone={flagCount > 0 ? 'alert' : 'success'}
                headline={flagCount > 0
                  ? `Your care plan has ${flagCount} thing${flagCount === 1 ? '' : 's'} worth checking with your provider.`
                  : 'Your care plan looks fine on the six structured checks.'}
                body={result.summary || 'Wayly checked your care plan against six Support at Home rules: budget fit, care management cap, service-list compliance, stream alignment, review-date currency, and goals alignment.'}
              />
              <View testID="cp-checks" style={styles.checkList}>
                {CANONICAL_CHECKS.map((c) => {
                  const r = checksByKey[c.key] || { status: 'unknown', note: 'Not assessed.' };
                  const pill = PILL[r.status] || PILL.unknown;
                  return (
                    <View key={c.key} style={[styles.checkRow, { borderColor: pill.fg }]} testID={`cp-check-${c.key}`}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.checkLabel}>{c.label}</Text>
                        {r.note ? <Text style={styles.checkNote}>{r.note}</Text> : null}
                      </View>
                      <View style={[styles.statusPill, { backgroundColor: pill.bg }]}>
                        <Text style={[styles.statusText, { color: pill.fg }]}>{(r.status || 'unknown').toUpperCase()}</Text>
                      </View>
                    </View>
                  );
                })}
              </View>
              {Array.isArray(result.questions_to_raise) && result.questions_to_raise.length > 0 && (
                <>
                  <Text style={styles.qHead}>Ask your care manager</Text>
                  {result.questions_to_raise.map((q: string, i: number) => (
                    <View key={i} style={styles.qRow}>
                      <Ionicons name="help-circle-outline" size={14} color={c.brandSecondary} />
                      <Text style={styles.qText}>{q}</Text>
                    </View>
                  ))}
                </>
              )}
              <ReportIssueButton tool="Care Plan Reviewer" />
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
  h1: { fontFamily: Fonts.heading, fontSize: 22, color: c.brandPrimary, letterSpacing: -0.5 },
  sub: { fontFamily: Fonts.body, fontSize: 14, color: c.textSecondary, marginTop: 6, marginBottom: Spacing.md, lineHeight: 19 },
  label: { fontFamily: Fonts.bodyMed, fontSize: 13, color: c.textSecondary, marginTop: Spacing.md, marginBottom: 6 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { minWidth: 40, paddingHorizontal: 12, paddingVertical: 8, borderRadius: Radius.md, borderWidth: 1, borderColor: c.border, backgroundColor: c.cardBg, alignItems: 'center' },
  chipActive: { backgroundColor: c.brandPrimary, borderColor: c.brandPrimary },
  chipText: { fontFamily: Fonts.bodySemi, fontSize: 13, color: c.brandPrimary },
  chipTextActive: { color: c.cream },
  input: { fontFamily: Fonts.body, fontSize: 14, color: c.textPrimary, backgroundColor: c.cardBg, borderRadius: Radius.md, padding: Spacing.md, borderWidth: 1, borderColor: c.border },
  btn: { marginTop: Spacing.lg, backgroundColor: c.brandPrimary, borderRadius: Radius.md, paddingVertical: 14, alignItems: 'center', minHeight: 50, justifyContent: 'center' },
  btnText: { fontFamily: Fonts.bodySemi, fontSize: 15, color: c.cream },
  result: { marginTop: Spacing.lg, backgroundColor: c.cardBg, borderRadius: Radius.lg, padding: Spacing.lg, borderWidth: 1, borderColor: c.borderSubtle },
  summary: { fontFamily: Fonts.body, fontSize: 13, color: c.textPrimary, lineHeight: 19, marginBottom: Spacing.md },
  checkList: { gap: 8 },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 10, borderRadius: Radius.md, borderLeftWidth: 3 },
  checkLabel: { fontFamily: Fonts.bodySemi, fontSize: 14, color: c.brandPrimary },
  checkNote: { fontFamily: Fonts.body, fontSize: 12, color: c.textSecondary, marginTop: 2, lineHeight: 16 },
  statusPill: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 100 },
  statusText: { fontFamily: Fonts.bodySemi, fontSize: 9, letterSpacing: 0.6 },
  qHead: { fontFamily: Fonts.headingMed, fontSize: 14, color: c.brandPrimary, marginTop: Spacing.md, marginBottom: 6 },
  qRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, marginBottom: 4 },
  qText: { fontFamily: Fonts.body, fontSize: 13, color: c.textPrimary, flex: 1, lineHeight: 18 },
}); }
