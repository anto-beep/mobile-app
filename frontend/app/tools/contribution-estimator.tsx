// Contribution Estimator — iter 48 parity. Four cohorts (full / part / cshc /
// self), optional Services-Australia rate inputs for part & cshc, and a
// branched result based on rate_basis (exact / user_supplied / band_range).
import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, TextInput, ActivityIndicator, Alert, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { api, extractErrorMessage } from '../../src/lib/api';
import { useAuth } from '../../src/context/AuthContext';
import { Fonts, Radius, Spacing, formatAUD } from '../../src/lib/theme';
import type { ColorPalette } from '../../src/lib/theme';
import { useColors } from '../../src/hooks/useColors';
import { useThemedStyles } from '../../src/hooks/useThemedStyles';
import { AIAccuracyBanner, ToolGate, hasPaidAccess } from '../../src/components/AITools';
import { ToolSummary, ReportIssueButton } from '../../src/components/ToolShell';

type Cohort = 'full' | 'part' | 'cshc' | 'self';
const COHORTS: { key: Cohort; label: string; ratesEditable: boolean }[] = [
  { key: 'full', label: 'Full pension',          ratesEditable: false },
  { key: 'part', label: 'Part pension',          ratesEditable: true  },
  { key: 'cshc', label: 'CSHC',                   ratesEditable: true  },
  { key: 'self', label: 'Self-funded',           ratesEditable: false },
];

export default function ContributionEstimator() {
  const c = useColors();
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const { user } = useAuth();
  const [cohort, setCohort] = useState<Cohort>('full');
  const [classification, setClassification] = useState(4);
  const [annualSpend, setAnnualSpend] = useState('');
  const [indepRate, setIndepRate] = useState('');
  const [edRate, setEdRate] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);

  const cohortMeta = COHORTS.find((c) => c.key === cohort)!;

  if (!hasPaidAccess(user)) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScrollView contentContainerStyle={styles.scroll}>
          <TouchableOpacity onPress={() => router.back()} style={styles.back}><Ionicons name="chevron-back" size={20} color={c.brandPrimary} /><Text style={styles.backText}>Back</Text></TouchableOpacity>
          <Text style={styles.overline}>Contribution estimator</Text>
          <Text style={styles.h1}>What Will I Pay?</Text>
          <AIAccuracyBanner tool="contribution-estimator" />
          <ToolGate tool="contribution-estimator" variant={user ? 'free-plan' : 'unauth'} />
        </ScrollView>
      </SafeAreaView>
    );
  }

  const submit = async () => {
    setLoading(true);
    setResult(null);
    setErr(null);
    try {
      const body: any = {
        pension_status: cohort,
        classification,
        annual_spend: parseFloat(annualSpend) || 0,
      };
      if (cohortMeta.ratesEditable) {
        if (indepRate) body.independence_rate_pct = parseFloat(indepRate);
        if (edRate) body.everyday_rate_pct = parseFloat(edRate);
      }
      const { data } = await api.post('/public/contribution-estimator', body);
      setResult(data);
    } catch (e: any) {
      setErr(extractErrorMessage(e, "Could not estimate"));
    } finally { setLoading(false); }
  };

  const isBand = result?.rate_basis === 'band_range';
  const verboseRate = (s: any) => {
    if (s.rate_pct != null) return `${s.rate_pct}%`;
    if (s.rate_pct_low != null) return `${s.rate_pct_low}-${s.rate_pct_high}%`;
    return '';
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <TouchableOpacity onPress={() => router.back()} style={styles.back}><Ionicons name="chevron-back" size={20} color={c.brandPrimary} /><Text style={styles.backText}>Back</Text></TouchableOpacity>
          <Text style={styles.overline}>Contribution estimator</Text>
          <Text style={styles.h1}>What Will I Pay?</Text>
          <Text style={styles.sub}>Quarter and annual contribution estimates by cohort.</Text>
          <AIAccuracyBanner tool="contribution-estimator" />

          <Text style={styles.label}>Pension status</Text>
          <View style={styles.row}>
            {COHORTS.map((p) => (
              <TouchableOpacity key={p.key} style={[styles.chip, cohort === p.key && styles.chipActive]} onPress={() => setCohort(p.key)} testID={`ce-pension-${p.key}`}>
                <Text style={[styles.chipText, cohort === p.key && styles.chipTextActive]}>{p.label}</Text>
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
          <TextInput style={styles.input} keyboardType="numeric" value={annualSpend} onChangeText={setAnnualSpend} placeholder="e.g. 24000" placeholderTextColor={c.textMuted} testID="contrib-spend" />

          {cohortMeta.ratesEditable && (
            <View testID="ce-rate-inputs">
              <Text style={styles.label}>Your contribution letter (optional)</Text>
              <Text style={styles.hint}>If Services Australia has sent your specific rates, enter them here for an exact figure.</Text>
              <View style={styles.rateRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.rateLabel}>Independence %</Text>
                  <TextInput style={styles.input} keyboardType="numeric" value={indepRate} onChangeText={setIndepRate} placeholder="e.g. 12" placeholderTextColor={c.textMuted} testID="ce-independence-rate" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.rateLabel}>Everyday %</Text>
                  <TextInput style={styles.input} keyboardType="numeric" value={edRate} onChangeText={setEdRate} placeholder="e.g. 20" placeholderTextColor={c.textMuted} testID="ce-everyday-rate" />
                </View>
              </View>
            </View>
          )}

          <TouchableOpacity onPress={submit} disabled={loading} style={[styles.btn, loading && { opacity: 0.6 }]} testID="contrib-submit">
            {loading ? <ActivityIndicator color={c.cream} /> : <Text style={styles.btnText}>Estimate it</Text>}
          </TouchableOpacity>

          {err && <Text style={styles.error} testID="ce-error">{err}</Text>}

          {result && (
            <View style={styles.result} testID="contrib-result">
              <ToolSummary
                toolName="Contribution Estimator"
                tone="neutral"
                headline={isBand
                  ? `Your quarterly contribution sits between ${formatAUD((result.annual_contribution_low || 0) / 4)} and ${formatAUD((result.annual_contribution_high || 0) / 4)}.`
                  : `Your estimated contribution is ${formatAUD(result.quarterly_contribution || 0)} per quarter.`}
                body={`Wayly worked this out from your pension status, means-tested income and daily fee. On Support at Home the government pays most of the cost; what is shown here is the co-payment that comes out of your budget.${result.caveat ? ` ${result.caveat}` : ''}`}
              />
              <Text style={styles.resultOverline}>Estimated contribution</Text>
              {isBand ? (
                <>
                  <Text style={styles.resultAmount} testID="ce-annual-range">
                    {formatAUD(result.annual_contribution_low || 0)} to {formatAUD(result.annual_contribution_high || 0)}/yr
                  </Text>
                  <View style={styles.caveat} testID="ce-caveat">
                    <Ionicons name="information-circle-outline" size={14} color={c.brandSecondary} />
                    <Text style={styles.caveatText}>{result.caveat || 'Your actual rate is set by Services Australia. Enter the rates from your contribution letter above for an exact figure.'}</Text>
                  </View>
                </>
              ) : (
                <>
                  <Text style={styles.resultAmount} testID="ce-annual">{formatAUD(result.annual_contribution || 0)}/yr</Text>
                  <Text style={styles.resultSub}>{formatAUD(result.quarterly_contribution || 0)}/quarter</Text>
                </>
              )}
              {Array.isArray(result.by_stream) && (
                <View style={{ marginTop: Spacing.md, gap: 6 }}>
                  {result.by_stream.map((s: any) => (
                    <View key={s.stream} style={styles.streamRow}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.streamName}>{s.stream}</Text>
                        {verboseRate(s) ? <Text style={styles.streamPct}>{verboseRate(s)}</Text> : null}
                      </View>
                      <Text style={styles.streamAmt}>
                        {s.contribution != null ? `${formatAUD(s.contribution)}/yr` : `${formatAUD(s.contribution_low || 0)} to ${formatAUD(s.contribution_high || 0)}/yr`}
                      </Text>
                    </View>
                  ))}
                </View>
              )}
              {result.note && <Text style={styles.note}>{result.note}</Text>}
              <ReportIssueButton tool="Contribution Estimator" />
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
  sub: { fontFamily: Fonts.body, fontSize: 14, color: c.textSecondary, marginTop: 6, marginBottom: Spacing.md },
  label: { fontFamily: Fonts.bodyMed, fontSize: 13, color: c.textSecondary, marginTop: Spacing.md, marginBottom: 8 },
  hint: { fontFamily: Fonts.body, fontSize: 11, color: c.textMuted, marginBottom: 6 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: Radius.md, borderWidth: 1, borderColor: c.border, backgroundColor: c.cardBg, alignItems: 'center' },
  chipSmall: { minWidth: 44, paddingHorizontal: 14, paddingVertical: 10, borderRadius: Radius.md, borderWidth: 1, borderColor: c.border, backgroundColor: c.cardBg, alignItems: 'center' },
  chipActive: { backgroundColor: c.brandPrimary, borderColor: c.brandPrimary },
  chipText: { fontFamily: Fonts.bodySemi, fontSize: 13, color: c.brandPrimary },
  chipTextActive: { color: c.cream },
  input: { fontFamily: Fonts.body, fontSize: 16, color: c.textPrimary, backgroundColor: c.cardBg, borderRadius: Radius.md, paddingHorizontal: Spacing.md, paddingVertical: 12, borderWidth: 1, borderColor: c.border },
  rateRow: { flexDirection: 'row', gap: 10, marginTop: 6 },
  rateLabel: { fontFamily: Fonts.bodyMed, fontSize: 11, color: c.textMuted, marginBottom: 4 },
  btn: { marginTop: Spacing.lg, backgroundColor: c.brandPrimary, borderRadius: Radius.md, paddingVertical: 14, alignItems: 'center', minHeight: 50, justifyContent: 'center' },
  btnText: { fontFamily: Fonts.bodySemi, fontSize: 15, color: c.cream },
  error: { marginTop: Spacing.md, padding: 10, backgroundColor: 'rgba(192, 57, 43, 0.08)', borderRadius: Radius.md, borderLeftWidth: 3, borderLeftColor: c.severityAlert, fontFamily: Fonts.body, fontSize: 12, color: c.severityAlert, lineHeight: 17 },
  result: { marginTop: Spacing.lg, backgroundColor: c.cardBg, borderRadius: Radius.lg, padding: Spacing.lg, borderWidth: 1, borderColor: c.borderSubtle },
  resultOverline: { fontFamily: Fonts.bodyMed, fontSize: 11, letterSpacing: 1.5, textTransform: 'uppercase', color: c.brandSecondary, marginBottom: 4 },
  resultAmount: { fontFamily: Fonts.monoSemi, fontVariant: ['tabular-nums' as const], fontSize: 24, color: c.brandPrimary },
  resultSub: { fontFamily: Fonts.mono, fontVariant: ['tabular-nums' as const], fontSize: 13, color: c.textSecondary, marginTop: 4 },
  caveat: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, padding: 10, marginTop: Spacing.sm, backgroundColor: 'rgba(183, 121, 31, 0.08)', borderRadius: Radius.md, borderLeftWidth: 3, borderLeftColor: c.brandSecondary },
  caveatText: { flex: 1, fontFamily: Fonts.body, fontSize: 12, color: c.textPrimary, lineHeight: 17 },
  streamRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: c.borderSubtle },
  streamName: { fontFamily: Fonts.bodyMed, fontSize: 14, color: c.textSecondary },
  streamPct: { fontFamily: Fonts.body, fontSize: 11, color: c.textMuted, marginTop: 1 },
  streamAmt: { fontFamily: Fonts.monoSemi, fontVariant: ['tabular-nums' as const], fontSize: 13, color: c.brandPrimary },
  note: { fontFamily: Fonts.body, fontSize: 12, color: c.textMuted, marginTop: Spacing.md, fontStyle: 'italic', lineHeight: 17 },
}); }
