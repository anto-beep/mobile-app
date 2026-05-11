// Care Plan Reviewer
import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, TextInput, ActivityIndicator, Alert, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { api, extractErrorMessage } from '../../src/lib/api';
import { useAuth } from '../../src/context/AuthContext';
import { Colors, Fonts, Radius, Spacing } from '../../src/lib/theme';
import { AIAccuracyBanner, ToolGate, hasPaidAccess } from '../../src/components/AITools';

const LIGHT_COLORS = { green: '#3A5A40', amber: '#D4A24E', red: '#A05545' };

export default function CarePlanReviewer() {
  const router = useRouter();
  const { user } = useAuth();
  const [plan, setPlan] = useState('');
  const [concerns, setConcerns] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);

  if (!hasPaidAccess(user)) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScrollView contentContainerStyle={styles.scroll}>
          <TouchableOpacity onPress={() => router.back()} style={styles.back}><Ionicons name="chevron-back" size={20} color={Colors.brandPrimary} /><Text style={styles.backText}>Back</Text></TouchableOpacity>
          <Text style={styles.overline}>Care Plan Reviewer</Text>
          <Text style={styles.h1}>Traffic-light your care plan</Text>
          <AIAccuracyBanner tool="care-plan-reviewer" />
          <ToolGate tool="care-plan-reviewer" variant={user ? 'free-plan' : 'unauth'} />
        </ScrollView>
      </SafeAreaView>
    );
  }

  const review = async () => {
    if (plan.trim().length < 50) { Alert.alert('Paste your care plan', "We need at least a short paragraph to review."); return; }
    setLoading(true);
    setResult(null);
    try {
      const { data } = await api.post('/public/care-plan-review', {
        care_plan_text: plan,
        concerns: concerns || null,
      });
      setResult(data);
    } catch (e) {
      Alert.alert("Couldn't review", extractErrorMessage(e));
    } finally { setLoading(false); }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <TouchableOpacity onPress={() => router.back()} style={styles.back}><Ionicons name="chevron-back" size={20} color={Colors.brandPrimary} /><Text style={styles.backText}>Back</Text></TouchableOpacity>
          <Text style={styles.overline}>Care Plan Reviewer</Text>
          <Text style={styles.h1}>Traffic-light your care plan</Text>
          <Text style={styles.sub}>Paste your care plan text. We'll mark each line green / amber / red.</Text>
          <AIAccuracyBanner tool="care-plan-reviewer" />

          <Text style={styles.label}>Care plan text</Text>
          <TextInput
            style={[styles.input, { minHeight: 160, textAlignVertical: 'top' }]}
            value={plan} onChangeText={setPlan}
            placeholder="Paste your participant's care plan here…"
            placeholderTextColor={Colors.textMuted}
            multiline testID="careplan-text"
          />

          <Text style={styles.label}>Specific concerns (optional)</Text>
          <TextInput
            style={[styles.input, { minHeight: 70, textAlignVertical: 'top' }]}
            value={concerns} onChangeText={setConcerns}
            placeholder="e.g. Mum's mobility has worsened — is this plan keeping up?"
            placeholderTextColor={Colors.textMuted}
            multiline testID="careplan-concerns"
          />

          <TouchableOpacity onPress={review} disabled={loading} style={[styles.btn, loading && { opacity: 0.6 }]} testID="careplan-review">
            {loading ? <ActivityIndicator color={Colors.cream} /> : <Text style={styles.btnText}>Review the plan</Text>}
          </TouchableOpacity>

          {result && (
            <View style={styles.result} testID="careplan-result">
              <Text style={styles.resultOverline}>Review</Text>
              {result.overall && (
                <View style={[styles.overall, { backgroundColor: `${LIGHT_COLORS[result.overall_light as keyof typeof LIGHT_COLORS] || Colors.severityInfo}15` }]}>
                  <View style={[styles.lightDot, { backgroundColor: LIGHT_COLORS[result.overall_light as keyof typeof LIGHT_COLORS] || Colors.severityInfo }]} />
                  <Text style={styles.overallText}>{result.overall}</Text>
                </View>
              )}
              {Array.isArray(result.items) && result.items.map((it: any, i: number) => (
                <View key={i} style={styles.itemRow}>
                  <View style={[styles.lightDot, { backgroundColor: LIGHT_COLORS[it.light as keyof typeof LIGHT_COLORS] || Colors.severityInfo }]} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.itemTitle}>{it.title || it.service}</Text>
                    {it.note && <Text style={styles.itemNote}>{it.note}</Text>}
                  </View>
                </View>
              ))}
              {Array.isArray(result.questions_for_care_manager) && result.questions_for_care_manager.length > 0 && (
                <>
                  <Text style={styles.qHead}>Ask your care manager</Text>
                  {result.questions_for_care_manager.map((q: string, i: number) => (
                    <View key={i} style={styles.qRow}>
                      <Ionicons name="help-circle-outline" size={14} color={Colors.brandSecondary} />
                      <Text style={styles.qText}>{q}</Text>
                    </View>
                  ))}
                </>
              )}
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
  h1: { fontFamily: Fonts.heading, fontSize: 24, color: Colors.brandPrimary, letterSpacing: -0.5 },
  sub: { fontFamily: Fonts.body, fontSize: 14, color: Colors.textSecondary, marginTop: 6, marginBottom: Spacing.md },
  label: { fontFamily: Fonts.bodyMed, fontSize: 13, color: Colors.textSecondary, marginTop: Spacing.md, marginBottom: 6 },
  input: { fontFamily: Fonts.body, fontSize: 14, color: Colors.textPrimary, backgroundColor: Colors.cardBg, borderRadius: Radius.md, padding: Spacing.md, borderWidth: 1, borderColor: Colors.border },
  btn: { marginTop: Spacing.lg, backgroundColor: Colors.brandPrimary, borderRadius: Radius.md, paddingVertical: 14, alignItems: 'center', minHeight: 50, justifyContent: 'center' },
  btnText: { fontFamily: Fonts.bodySemi, fontSize: 15, color: Colors.cream },
  result: { marginTop: Spacing.lg, backgroundColor: Colors.cardBg, borderRadius: Radius.lg, padding: Spacing.lg, borderWidth: 1, borderColor: Colors.borderSubtle },
  resultOverline: { fontFamily: Fonts.bodyMed, fontSize: 11, letterSpacing: 1.5, textTransform: 'uppercase', color: Colors.brandSecondary, marginBottom: Spacing.sm },
  overall: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: Spacing.md, borderRadius: Radius.md, marginBottom: Spacing.md },
  overallText: { fontFamily: Fonts.bodyMed, fontSize: 14, color: Colors.brandPrimary, flex: 1, lineHeight: 19 },
  itemRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: Colors.borderSubtle },
  lightDot: { width: 10, height: 10, borderRadius: 5, marginTop: 4 },
  itemTitle: { fontFamily: Fonts.bodySemi, fontSize: 14, color: Colors.brandPrimary },
  itemNote: { fontFamily: Fonts.body, fontSize: 12, color: Colors.textSecondary, marginTop: 2, lineHeight: 17 },
  qHead: { fontFamily: Fonts.headingMed, fontSize: 14, color: Colors.brandPrimary, marginTop: Spacing.md, marginBottom: 6 },
  qRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, marginBottom: 4 },
  qText: { fontFamily: Fonts.body, fontSize: 13, color: Colors.textPrimary, flex: 1, lineHeight: 18 },
});
