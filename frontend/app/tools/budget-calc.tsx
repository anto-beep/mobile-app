// Budget Calculator — iter 48 parity.
// Reads `quarterly_gross`, `care_management_quarterly`, `quarterly_usable` (the
// legacy `quarterly_total` was removed). Surfaces transitional HCP routing,
// the per-stream split, and the new supplement picker / results table.
import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, TextInput, TouchableOpacity, ActivityIndicator, Switch, Alert, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { api, extractErrorMessage } from '../../src/lib/api';
import { useAuth } from '../../src/context/AuthContext';
import { Colors, Fonts, Radius, Spacing, formatAUD } from '../../src/lib/theme';
import { AIAccuracyBanner, ToolGate, hasPaidAccess } from '../../src/components/AITools';

type Supplement = 'oxygen' | 'enteral_bolus' | 'enteral_non_bolus' | 'veterans' | 'dementia_cognition' | 'eachd_top_up';
const SUPPLEMENT_OPTIONS: { key: Supplement; label: string; hint: string }[] = [
  { key: 'oxygen',              label: 'Oxygen',                  hint: 'Daily supplement for participants needing oxygen therapy' },
  { key: 'enteral_bolus',       label: 'Enteral (bolus)',         hint: 'Tube feeding — bolus method' },
  { key: 'enteral_non_bolus',   label: 'Enteral (non-bolus)',     hint: 'Tube feeding — continuous / pump' },
  { key: 'veterans',            label: 'Veterans',                hint: '+11.5% on individual rate (DVA Gold/White)' },
  { key: 'dementia_cognition',  label: 'Dementia / cognition',    hint: 'Grandfathered participants only' },
  { key: 'eachd_top_up',        label: 'EACHD top-up',            hint: 'Grandfathered EACHD package only' },
];

export default function BudgetCalc() {
  const router = useRouter();
  const { user } = useAuth();
  const [classification, setClassification] = useState(4);
  const [grandfathered, setGrandfathered] = useState(false);
  const [transitional, setTransitional] = useState<number | null>(null);
  const [balance, setBalance] = useState('');
  const [annualBurn, setAnnualBurn] = useState('');
  const [supps, setSupps] = useState<Supplement[]>([]);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);

  if (!hasPaidAccess(user)) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScrollView contentContainerStyle={styles.scroll}>
          <TouchableOpacity onPress={() => router.back()} style={styles.back}><Ionicons name="chevron-back" size={20} color={Colors.brandPrimary} /><Text style={styles.backText}>Back</Text></TouchableOpacity>
          <Text style={styles.overline}>Budget calculator</Text>
          <Text style={styles.h1}>What's the budget?</Text>
          <AIAccuracyBanner tool="budget-calculator" />
          <ToolGate tool="budget-calculator" variant={user ? 'free-plan' : 'unauth'} />
        </ScrollView>
      </SafeAreaView>
    );
  }

  const toggleSupp = (k: Supplement) =>
    setSupps((prev) => (prev.includes(k) ? prev.filter((x) => x !== k) : [...prev, k]));

  const calc = async () => {
    setLoading(true);
    setResult(null);
    try {
      const body: any = {
        classification,
        is_grandfathered: grandfathered,
        current_lifetime_balance: parseFloat(balance) || 0,
        expected_annual_burn: annualBurn ? parseFloat(annualBurn) : null,
      };
      if (transitional != null) body.transitional_classification = transitional;
      if (supps.length > 0) body.applicable_supplements = supps;
      const { data } = await api.post('/public/budget-calc', body);
      setResult(data);
    } catch (e) {
      Alert.alert("Couldn't calculate", extractErrorMessage(e));
    } finally { setLoading(false); }
  };

  const streamsSource = result?.streams_source || (result?.streams_source_is_statement ? 'statement' : 'indicative');
  const isStatementSource = streamsSource === 'statement' || streamsSource === 'from_statement';

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <TouchableOpacity onPress={() => router.back()} style={styles.back}><Ionicons name="chevron-back" size={20} color={Colors.brandPrimary} /><Text style={styles.backText}>Back</Text></TouchableOpacity>
          <Text style={styles.overline}>Budget calculator</Text>
          <Text style={styles.h1}>What's the budget?</Text>
          <Text style={styles.sub}>Per quarter and per year, for any classification level — with optional supplements.</Text>
          <AIAccuracyBanner tool="budget-calculator" />

          <Text style={styles.label}>Classification level</Text>
          <View style={styles.row}>
            {[1, 2, 3, 4, 5, 6, 7, 8].map((c) => (
              <TouchableOpacity key={c} style={[styles.chip, classification === c && styles.chipActive]} onPress={() => setClassification(c)} testID={`budget-class-${c}`}>
                <Text style={[styles.chipText, classification === c && styles.chipTextActive]}>{c}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <View style={styles.switchRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.label}>Grandfathered (pre-1 July 2025)</Text>
              <Text style={styles.hint}>L1–L4 use transitional figures when this is on.</Text>
            </View>
            <Switch value={grandfathered} onValueChange={setGrandfathered} testID="budget-grandfathered" />
          </View>

          <Text style={styles.label}>Force transitional classification (optional)</Text>
          <View style={styles.row}>
            <TouchableOpacity style={[styles.chipSmall, transitional == null && styles.chipActive]} onPress={() => setTransitional(null)}>
              <Text style={[styles.chipText, transitional == null && styles.chipTextActive]}>None</Text>
            </TouchableOpacity>
            {[1, 2, 3, 4].map((c) => (
              <TouchableOpacity key={c} style={[styles.chipSmall, transitional === c && styles.chipActive]} onPress={() => setTransitional(c)} testID={`budget-transitional-${c}`}>
                <Text style={[styles.chipText, transitional === c && styles.chipTextActive]}>L{c}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={styles.label}>Current lifetime balance ($)</Text>
          <TextInput style={styles.input} keyboardType="numeric" value={balance} onChangeText={setBalance} placeholder="0" placeholderTextColor={Colors.textMuted} testID="budget-balance" />

          <Text style={styles.label}>Expected annual burn ($, optional)</Text>
          <TextInput style={styles.input} keyboardType="numeric" value={annualBurn} onChangeText={setAnnualBurn} placeholder="e.g. 24000" placeholderTextColor={Colors.textMuted} testID="budget-burn" />

          <Text style={styles.label}>Applicable supplements (optional)</Text>
          <View testID="bc-supplements" style={styles.suppGrid}>
            {SUPPLEMENT_OPTIONS.map((s) => {
              const on = supps.includes(s.key);
              return (
                <TouchableOpacity key={s.key} testID={`bc-supplement-${s.key}`} onPress={() => toggleSupp(s.key)} style={[styles.suppCheck, on && styles.suppCheckOn]}>
                  <View style={[styles.suppBox, on && styles.suppBoxOn]}>{on ? <Ionicons name="checkmark" size={12} color={Colors.cream} /> : null}</View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.suppLabel, on && styles.suppLabelOn]}>{s.label}</Text>
                    <Text style={styles.suppHint}>{s.hint}</Text>
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>

          <TouchableOpacity onPress={calc} disabled={loading} style={[styles.btn, loading && { opacity: 0.6 }]} testID="budget-calc-button">
            <Text style={styles.btnText}>{loading ? 'Calculating…' : 'Show me the budget'}</Text>
          </TouchableOpacity>

          {result && (
            <View style={styles.result} testID="budget-result">
              <Text style={styles.resultOverline}>{result.classification_label}{result.is_transitional_hcp ? ' · Transitional HCP' : ''}</Text>
              <Text style={styles.resultAmount}>{formatAUD(result.annual_total)}/yr</Text>
              <View style={styles.divider} />
              <View style={styles.threeCard}>
                <View style={styles.kpiCard} testID="bc-quarterly-gross">
                  <Text style={styles.kpiLabel}>Gross / quarter</Text>
                  <Text style={styles.kpiValue}>{formatAUD(result.quarterly_gross)}</Text>
                  <Text style={styles.kpiHint}>As printed on the statement</Text>
                </View>
                <View style={styles.kpiCard} testID="bc-care-management">
                  <Text style={styles.kpiLabel}>Care management</Text>
                  <Text style={styles.kpiValue}>{formatAUD(result.care_management_quarterly)}</Text>
                  <Text style={styles.kpiHint}>The 10% CM slice</Text>
                </View>
                <View style={[styles.kpiCard, styles.kpiCardHighlight]} testID="bc-quarterly-usable">
                  <Text style={[styles.kpiLabel, { color: Colors.brandPrimary }]}>Usable / quarter</Text>
                  <Text style={[styles.kpiValue, { color: Colors.brandPrimary }]}>{formatAUD(result.quarterly_usable)}</Text>
                  <Text style={[styles.kpiHint, { color: Colors.brandPrimary }]}>What you can spend on services</Text>
                </View>
              </View>
              <View style={styles.divider} />
              {Array.isArray(result.streams) && result.streams.length > 0 && (
                <View testID="bc-streams">
                  <View style={styles.streamHead}>
                    <Text style={styles.sectionTitle}>Per-stream allocation</Text>
                    <View style={[styles.sourcePill, isStatementSource ? styles.sourceSage : styles.sourceAmber]} testID="bc-streams-source">
                      <Text style={[styles.sourcePillText, { color: isStatementSource ? Colors.success : Colors.brandSecondary }]}>
                        {isStatementSource ? 'From your latest statement' : 'Indicative split'}
                      </Text>
                    </View>
                  </View>
                  {result.streams.map((s: any) => (
                    <View key={s.stream} style={styles.streamRow}>
                      <Text style={styles.streamName}>{s.stream}</Text>
                      <Text style={styles.streamAmt}>{formatAUD(s.allocated)}</Text>
                    </View>
                  ))}
                  {result.streams_note ? <Text style={styles.streamsNote} testID="bc-streams-note">{result.streams_note}</Text> : null}
                </View>
              )}
              {Array.isArray(result.applied_supplements) && result.applied_supplements.length > 0 && (
                <View testID="bc-supplements-result" style={{ marginTop: Spacing.md }}>
                  <Text style={styles.sectionTitle}>Supplements applied</Text>
                  {result.applied_supplements.map((sup: any) => {
                    const meta = SUPPLEMENT_OPTIONS.find((m) => m.key === sup.name);
                    return (
                      <View key={sup.name} style={styles.streamRow}>
                        <Text style={styles.streamName}>{meta?.label || sup.name}</Text>
                        <Text style={styles.streamAmt}>{formatAUD(sup.annual_aud)}/yr</Text>
                      </View>
                    );
                  })}
                  <View style={[styles.streamRow, { borderTopWidth: 1, borderTopColor: Colors.borderSubtle, paddingTop: 8 }]}>
                    <Text style={[styles.streamName, { fontFamily: Fonts.bodySemi }]}>Total supplements / yr</Text>
                    <Text style={[styles.streamAmt, { color: Colors.brandPrimary }]} testID="bc-supplements-total">{formatAUD(result.annual_supplements_total || 0)}</Text>
                  </View>
                </View>
              )}
              {Array.isArray(result.supplement_warnings) && result.supplement_warnings.length > 0 && (
                <View testID="bc-supplement-warnings" style={styles.warnBox}>
                  {result.supplement_warnings.map((w: any, i: number) => (
                    <Text key={i} style={styles.warnText}>• {w.message || w}</Text>
                  ))}
                </View>
              )}
              <View style={styles.divider} />
              <Text style={styles.resultLine}>Lifetime cap: <Text style={styles.bold}>{formatAUD(result.lifetime_cap)}</Text></Text>
              <Text style={styles.resultLine}>Currently used: {formatAUD(result.lifetime_contributions || 0)} ({(result.lifetime_pct || 0).toFixed(1)}%)</Text>
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
  scroll: { padding: Spacing.lg, paddingBottom: 80 },
  back: { flexDirection: 'row', alignItems: 'center', marginBottom: Spacing.md },
  backText: { fontFamily: Fonts.bodyMed, fontSize: 14, color: Colors.brandPrimary },
  overline: { fontFamily: Fonts.bodyMed, fontSize: 11, letterSpacing: 1.5, textTransform: 'uppercase', color: Colors.textMuted },
  h1: { fontFamily: Fonts.heading, fontSize: 26, color: Colors.brandPrimary, letterSpacing: -0.5 },
  sub: { fontFamily: Fonts.body, fontSize: 14, color: Colors.textSecondary, marginTop: 6, marginBottom: Spacing.lg },
  label: { fontFamily: Fonts.bodyMed, fontSize: 13, color: Colors.textSecondary, marginTop: Spacing.md, marginBottom: 6 },
  hint: { fontFamily: Fonts.body, fontSize: 11, color: Colors.textMuted, marginTop: 2 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { minWidth: 44, paddingHorizontal: 14, paddingVertical: 10, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.cardBg, alignItems: 'center' },
  chipSmall: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.cardBg, alignItems: 'center' },
  chipActive: { backgroundColor: Colors.brandPrimary, borderColor: Colors.brandPrimary },
  chipText: { fontFamily: Fonts.bodySemi, fontSize: 14, color: Colors.brandPrimary },
  chipTextActive: { color: Colors.cream },
  switchRow: { flexDirection: 'row', alignItems: 'center', marginTop: Spacing.md, gap: Spacing.md },
  input: { fontFamily: Fonts.body, fontSize: 16, color: Colors.textPrimary, backgroundColor: Colors.cardBg, borderRadius: Radius.md, paddingHorizontal: Spacing.md, paddingVertical: 12, borderWidth: 1, borderColor: Colors.border },
  suppGrid: { gap: 6 },
  suppCheck: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, padding: 10, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.borderSubtle, backgroundColor: Colors.cardBg },
  suppCheckOn: { borderColor: Colors.brandPrimary, backgroundColor: 'rgba(14, 77, 82, 0.05)' },
  suppBox: { width: 20, height: 20, borderRadius: 4, borderWidth: 1.5, borderColor: Colors.border, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  suppBoxOn: { backgroundColor: Colors.brandPrimary, borderColor: Colors.brandPrimary },
  suppLabel: { fontFamily: Fonts.bodySemi, fontSize: 13, color: Colors.textPrimary },
  suppLabelOn: { color: Colors.brandPrimary },
  suppHint: { fontFamily: Fonts.body, fontSize: 11, color: Colors.textMuted, marginTop: 1, lineHeight: 14 },
  btn: { marginTop: Spacing.lg, backgroundColor: Colors.brandPrimary, borderRadius: Radius.md, paddingVertical: 14, alignItems: 'center' },
  btnText: { fontFamily: Fonts.bodySemi, fontSize: 15, color: Colors.cream },
  result: { marginTop: Spacing.lg, backgroundColor: Colors.cardBg, borderRadius: Radius.lg, padding: Spacing.lg, borderWidth: 1, borderColor: Colors.borderSubtle },
  resultOverline: { fontFamily: Fonts.bodyMed, fontSize: 11, letterSpacing: 1.5, textTransform: 'uppercase', color: Colors.brandSecondary, marginBottom: 4 },
  resultAmount: { fontFamily: Fonts.heading, fontSize: 32, color: Colors.brandPrimary, letterSpacing: -1 },
  divider: { height: 1, backgroundColor: Colors.borderSubtle, marginVertical: Spacing.md },
  threeCard: { flexDirection: 'row', gap: 8 },
  kpiCard: { flex: 1, padding: 10, borderRadius: Radius.md, backgroundColor: Colors.background, borderWidth: 1, borderColor: Colors.borderSubtle },
  kpiCardHighlight: { borderColor: Colors.brandPrimary, backgroundColor: 'rgba(14, 77, 82, 0.06)' },
  kpiLabel: { fontFamily: Fonts.bodyMed, fontSize: 10, color: Colors.textMuted, letterSpacing: 0.5, textTransform: 'uppercase' },
  kpiValue: { fontFamily: Fonts.heading, fontSize: 17, color: Colors.textPrimary, marginTop: 2 },
  kpiHint: { fontFamily: Fonts.body, fontSize: 10, color: Colors.textMuted, marginTop: 2, lineHeight: 13 },
  streamHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6, flexWrap: 'wrap', gap: 6 },
  sectionTitle: { fontFamily: Fonts.bodySemi, fontSize: 13, color: Colors.brandPrimary, letterSpacing: 0.2 },
  sourcePill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 100 },
  sourceSage: { backgroundColor: 'rgba(27, 87, 51, 0.12)' },
  sourceAmber: { backgroundColor: 'rgba(183, 121, 31, 0.15)' },
  sourcePillText: { fontFamily: Fonts.bodySemi, fontSize: 10, letterSpacing: 0.4 },
  streamsNote: { fontFamily: Fonts.body, fontSize: 11, color: Colors.textMuted, marginTop: 6, fontStyle: 'italic', lineHeight: 15 },
  streamRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },
  streamName: { fontFamily: Fonts.bodyMed, fontSize: 14, color: Colors.textSecondary },
  streamAmt: { fontFamily: Fonts.bodySemi, fontSize: 14, color: Colors.brandPrimary },
  warnBox: { marginTop: Spacing.md, padding: 10, backgroundColor: 'rgba(183, 121, 31, 0.08)', borderRadius: Radius.md, borderLeftWidth: 3, borderLeftColor: Colors.brandSecondary },
  warnText: { fontFamily: Fonts.body, fontSize: 12, color: Colors.textPrimary, lineHeight: 17 },
  resultLine: { fontFamily: Fonts.body, fontSize: 14, color: Colors.textSecondary, marginTop: 4, lineHeight: 20 },
  bold: { fontFamily: Fonts.bodySemi, color: Colors.brandPrimary },
});
