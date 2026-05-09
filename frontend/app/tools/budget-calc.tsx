// Budget calculator tool
import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, TextInput, TouchableOpacity, ActivityIndicator, Switch, Alert, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { api, extractErrorMessage } from '../../src/lib/api';
import { Colors, Fonts, Radius, Spacing, formatAUD } from '../../src/lib/theme';

export default function BudgetCalc() {
  const router = useRouter();
  const [classification, setClassification] = useState(4);
  const [grandfathered, setGrandfathered] = useState(false);
  const [balance, setBalance] = useState('');
  const [annualBurn, setAnnualBurn] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);

  const calc = async () => {
    setLoading(true);
    setResult(null);
    try {
      const { data } = await api.post('/public/budget-calc', {
        classification,
        is_grandfathered: grandfathered,
        current_lifetime_balance: parseFloat(balance) || 0,
        expected_annual_burn: annualBurn ? parseFloat(annualBurn) : null,
      });
      setResult(data);
    } catch (e) {
      Alert.alert('Couldn\'t calculate', extractErrorMessage(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <TouchableOpacity onPress={() => router.back()} style={styles.back}><Ionicons name="chevron-back" size={20} color={Colors.brandPrimary} /><Text style={styles.backText}>Back</Text></TouchableOpacity>
          <Text style={styles.overline}>Budget calculator</Text>
          <Text style={styles.h1}>What's the budget?</Text>
          <Text style={styles.sub}>For any classification level — works it out in seconds.</Text>

          <Text style={styles.label}>Classification level</Text>
          <View style={styles.row}>
            {[1, 2, 3, 4, 5, 6, 7, 8].map((c) => (
              <TouchableOpacity
                key={c}
                style={[styles.chip, classification === c && styles.chipActive]}
                onPress={() => setClassification(c)}
                testID={`budget-class-${c}`}
              >
                <Text style={[styles.chipText, classification === c && styles.chipTextActive]}>{c}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <View style={styles.switchRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.label}>Grandfathered (pre-1 July 2025)</Text>
              <Text style={styles.hint}>Lifetime cap is lower if so.</Text>
            </View>
            <Switch value={grandfathered} onValueChange={setGrandfathered} testID="budget-grandfathered" />
          </View>

          <Text style={styles.label}>Current lifetime balance ($)</Text>
          <TextInput style={styles.input} keyboardType="numeric" value={balance} onChangeText={setBalance} placeholder="0" placeholderTextColor={Colors.textMuted} testID="budget-balance" />

          <Text style={styles.label}>Expected annual burn ($, optional)</Text>
          <TextInput style={styles.input} keyboardType="numeric" value={annualBurn} onChangeText={setAnnualBurn} placeholder="e.g. 24000" placeholderTextColor={Colors.textMuted} testID="budget-burn" />

          <TouchableOpacity onPress={calc} disabled={loading} style={[styles.btn, loading && { opacity: 0.6 }]} testID="budget-calc-button">
            <Text style={styles.btnText}>{loading ? 'Calculating…' : 'Show me the budget'}</Text>
          </TouchableOpacity>

          {result && (
            <View style={styles.result} testID="budget-result">
              <Text style={styles.resultOverline}>{result.classification_label}</Text>
              <Text style={styles.resultAmount}>{formatAUD(result.annual_total)}/yr</Text>
              <Text style={styles.resultSub}>{formatAUD(result.quarterly_total)}/quarter · rollover cap {formatAUD(result.rollover_cap)}</Text>
              <View style={styles.divider} />
              {result.streams.map((s: any) => (
                <View key={s.stream} style={styles.streamRow}>
                  <Text style={styles.streamName}>{s.stream}</Text>
                  <Text style={styles.streamAmt}>{formatAUD(s.allocated)}</Text>
                </View>
              ))}
              <View style={styles.divider} />
              <Text style={styles.resultLine}>Lifetime cap: <Text style={styles.bold}>{formatAUD(result.lifetime_cap)}</Text></Text>
              <Text style={styles.resultLine}>Currently used: {formatAUD(result.lifetime_contributions)} ({result.lifetime_pct.toFixed(1)}%)</Text>
              {result.years_to_cap != null && (
                <Text style={styles.resultLine}>At your burn rate: ~<Text style={styles.bold}>{result.years_to_cap} years</Text> to the cap</Text>
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
  h1: { fontFamily: Fonts.heading, fontSize: 26, color: Colors.brandPrimary, letterSpacing: -0.5 },
  sub: { fontFamily: Fonts.body, fontSize: 14, color: Colors.textSecondary, marginTop: 6, marginBottom: Spacing.lg },
  label: { fontFamily: Fonts.bodyMed, fontSize: 13, color: Colors.textSecondary, marginTop: Spacing.md, marginBottom: 6 },
  hint: { fontFamily: Fonts.body, fontSize: 11, color: Colors.textMuted, marginTop: 2 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { minWidth: 44, paddingHorizontal: 14, paddingVertical: 10, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.cardBg, alignItems: 'center' },
  chipActive: { backgroundColor: Colors.brandPrimary, borderColor: Colors.brandPrimary },
  chipText: { fontFamily: Fonts.bodySemi, fontSize: 14, color: Colors.brandPrimary },
  chipTextActive: { color: Colors.cream },
  switchRow: { flexDirection: 'row', alignItems: 'center', marginTop: Spacing.md, gap: Spacing.md },
  input: { fontFamily: Fonts.body, fontSize: 16, color: Colors.textPrimary, backgroundColor: Colors.cardBg, borderRadius: Radius.md, paddingHorizontal: Spacing.md, paddingVertical: 12, borderWidth: 1, borderColor: Colors.border },
  btn: { marginTop: Spacing.lg, backgroundColor: Colors.brandPrimary, borderRadius: Radius.md, paddingVertical: 14, alignItems: 'center' },
  btnText: { fontFamily: Fonts.bodySemi, fontSize: 15, color: Colors.cream },
  result: { marginTop: Spacing.lg, backgroundColor: Colors.cardBg, borderRadius: Radius.lg, padding: Spacing.lg, borderWidth: 1, borderColor: Colors.borderSubtle },
  resultOverline: { fontFamily: Fonts.bodyMed, fontSize: 11, letterSpacing: 1.5, textTransform: 'uppercase', color: Colors.brandSecondary, marginBottom: 4 },
  resultAmount: { fontFamily: Fonts.heading, fontSize: 32, color: Colors.brandPrimary, letterSpacing: -1 },
  resultSub: { fontFamily: Fonts.body, fontSize: 13, color: Colors.textSecondary, marginTop: 4 },
  divider: { height: 1, backgroundColor: Colors.borderSubtle, marginVertical: Spacing.md },
  streamRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },
  streamName: { fontFamily: Fonts.bodyMed, fontSize: 14, color: Colors.textSecondary },
  streamAmt: { fontFamily: Fonts.bodySemi, fontSize: 14, color: Colors.brandPrimary },
  resultLine: { fontFamily: Fonts.body, fontSize: 14, color: Colors.textSecondary, marginTop: 4, lineHeight: 20 },
  bold: { fontFamily: Fonts.bodySemi, color: Colors.brandPrimary },
});
