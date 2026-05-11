// Contribution Estimator
import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, TextInput, ActivityIndicator, Alert, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { api, extractErrorMessage } from '../../src/lib/api';
import { useAuth } from '../../src/context/AuthContext';
import { Colors, Fonts, Radius, Spacing, formatAUD } from '../../src/lib/theme';
import { AIAccuracyBanner, ToolGate, hasPaidAccess } from '../../src/components/AITools';

const PENSION_OPTIONS = [
  { key: 'full', label: 'Full pension' },
  { key: 'part', label: 'Part pension' },
  { key: 'self_funded', label: 'Self-funded' },
];

export default function ContributionEstimator() {
  const router = useRouter();
  const { user } = useAuth();
  const [pension, setPension] = useState('full');
  const [classification, setClassification] = useState(4);
  const [annualSpend, setAnnualSpend] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);

  if (!hasPaidAccess(user)) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScrollView contentContainerStyle={styles.scroll}>
          <TouchableOpacity onPress={() => router.back()} style={styles.back}><Ionicons name="chevron-back" size={20} color={Colors.brandPrimary} /><Text style={styles.backText}>Back</Text></TouchableOpacity>
          <Text style={styles.overline}>Contribution estimator</Text>
          <Text style={styles.h1}>What will I pay?</Text>
          <AIAccuracyBanner tool="contribution-estimator" />
          <ToolGate tool="contribution-estimator" variant={user ? 'free-plan' : 'unauth'} />
        </ScrollView>
      </SafeAreaView>
    );
  }

  const submit = async () => {
    setLoading(true);
    setResult(null);
    try {
      const { data } = await api.post('/public/contribution-estimator', {
        pension_status: pension,
        classification,
        annual_spend: parseFloat(annualSpend) || 0,
      });
      setResult(data);
    } catch (e) {
      Alert.alert("Couldn't estimate", extractErrorMessage(e));
    } finally { setLoading(false); }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <TouchableOpacity onPress={() => router.back()} style={styles.back}><Ionicons name="chevron-back" size={20} color={Colors.brandPrimary} /><Text style={styles.backText}>Back</Text></TouchableOpacity>
          <Text style={styles.overline}>Contribution estimator</Text>
          <Text style={styles.h1}>What will I pay?</Text>
          <Text style={styles.sub}>Estimate your participant contribution per quarter and year.</Text>
          <AIAccuracyBanner tool="contribution-estimator" />

          <Text style={styles.label}>Pension status</Text>
          <View style={styles.row}>
            {PENSION_OPTIONS.map((p) => (
              <TouchableOpacity key={p.key} style={[styles.chip, pension === p.key && styles.chipActive]} onPress={() => setPension(p.key)} testID={`contrib-pension-${p.key}`}>
                <Text style={[styles.chipText, pension === p.key && styles.chipTextActive]}>{p.label}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={styles.label}>Classification level</Text>
          <View style={styles.row}>
            {[1, 2, 3, 4, 5, 6, 7, 8].map((c) => (
              <TouchableOpacity key={c} style={[styles.chipSmall, classification === c && styles.chipActive]} onPress={() => setClassification(c)} testID={`contrib-class-${c}`}>
                <Text style={[styles.chipText, classification === c && styles.chipTextActive]}>{c}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={styles.label}>Planned annual spend ($)</Text>
          <TextInput style={styles.input} keyboardType="numeric" value={annualSpend} onChangeText={setAnnualSpend} placeholder="e.g. 24000" placeholderTextColor={Colors.textMuted} testID="contrib-spend" />

          <TouchableOpacity onPress={submit} disabled={loading} style={[styles.btn, loading && { opacity: 0.6 }]} testID="contrib-submit">
            {loading ? <ActivityIndicator color={Colors.cream} /> : <Text style={styles.btnText}>Estimate it</Text>}
          </TouchableOpacity>

          {result && (
            <View style={styles.result} testID="contrib-result">
              <Text style={styles.resultOverline}>Estimated contribution</Text>
              <Text style={styles.resultAmount}>{formatAUD(result.annual_contribution || 0)}/yr</Text>
              <Text style={styles.resultSub}>{formatAUD(result.quarterly_contribution || 0)}/quarter</Text>
              {Array.isArray(result.by_stream) && (
                <View style={{ marginTop: Spacing.md, gap: 6 }}>
                  {result.by_stream.map((s: any) => (
                    <View key={s.stream} style={styles.streamRow}>
                      <Text style={styles.streamName}>{s.stream}</Text>
                      <Text style={styles.streamAmt}>{formatAUD(s.contribution || 0)}/yr</Text>
                    </View>
                  ))}
                </View>
              )}
              {result.note && <Text style={styles.note}>{result.note}</Text>}
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
  sub: { fontFamily: Fonts.body, fontSize: 14, color: Colors.textSecondary, marginTop: 6, marginBottom: Spacing.md },
  label: { fontFamily: Fonts.bodyMed, fontSize: 13, color: Colors.textSecondary, marginTop: Spacing.md, marginBottom: 8 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.cardBg, alignItems: 'center' },
  chipSmall: { minWidth: 44, paddingHorizontal: 14, paddingVertical: 10, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.cardBg, alignItems: 'center' },
  chipActive: { backgroundColor: Colors.brandPrimary, borderColor: Colors.brandPrimary },
  chipText: { fontFamily: Fonts.bodySemi, fontSize: 13, color: Colors.brandPrimary },
  chipTextActive: { color: Colors.cream },
  input: { fontFamily: Fonts.body, fontSize: 16, color: Colors.textPrimary, backgroundColor: Colors.cardBg, borderRadius: Radius.md, paddingHorizontal: Spacing.md, paddingVertical: 12, borderWidth: 1, borderColor: Colors.border },
  btn: { marginTop: Spacing.lg, backgroundColor: Colors.brandPrimary, borderRadius: Radius.md, paddingVertical: 14, alignItems: 'center', minHeight: 50, justifyContent: 'center' },
  btnText: { fontFamily: Fonts.bodySemi, fontSize: 15, color: Colors.cream },
  result: { marginTop: Spacing.lg, backgroundColor: Colors.cardBg, borderRadius: Radius.lg, padding: Spacing.lg, borderWidth: 1, borderColor: Colors.borderSubtle },
  resultOverline: { fontFamily: Fonts.bodyMed, fontSize: 11, letterSpacing: 1.5, textTransform: 'uppercase', color: Colors.brandSecondary, marginBottom: 4 },
  resultAmount: { fontFamily: Fonts.heading, fontSize: 32, color: Colors.brandPrimary, letterSpacing: -1 },
  resultSub: { fontFamily: Fonts.body, fontSize: 13, color: Colors.textSecondary, marginTop: 4 },
  streamRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: Colors.borderSubtle },
  streamName: { fontFamily: Fonts.bodyMed, fontSize: 14, color: Colors.textSecondary },
  streamAmt: { fontFamily: Fonts.bodySemi, fontSize: 14, color: Colors.brandPrimary },
  note: { fontFamily: Fonts.body, fontSize: 12, color: Colors.textMuted, marginTop: Spacing.md, fontStyle: 'italic', lineHeight: 17 },
});
