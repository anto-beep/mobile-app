// Provider price checker
import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, TextInput, TouchableOpacity, Alert, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { api, extractErrorMessage } from '../../src/lib/api';
import { useAuth } from '../../src/context/AuthContext';
import { Colors, Fonts, Radius, Spacing, formatAUD2 } from '../../src/lib/theme';
import type { ColorPalette } from '../../src/lib/theme';
import { useColors } from '../../src/hooks/useColors';
import { useThemedStyles } from '../../src/hooks/useThemedStyles';
import { AIAccuracyBanner, ToolGate, hasPaidAccess } from '../../src/components/AITools';
import { ToolSummary, ReportIssueButton } from '../../src/components/ToolShell';

const FALLBACK_SERVICES = ['Personal care', 'Domestic assistance', 'Nursing', 'Physiotherapy', 'Cleaning', 'Transport'];

const VERDICT_COLORS: Record<string, string> = {
  fair: Colors.success,
  high: Colors.severityAlert,
  low: Colors.textMuted,
};

export default function PriceChecker() {
  const c = useColors();
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const { user } = useAuth();
  const [services, setServices] = useState<string[]>(FALLBACK_SERVICES);
  const [service, setService] = useState('Personal care');
  const [rate, setRate] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);
  // §10b — recent-line-items prefill pills.
  const [prefills, setPrefills] = useState<Array<{ service: string; unit_price: number; period_label?: string; raw_service?: string; statement_id?: string }>>([]);

  useEffect(() => {
    api.get('/public/price-check/services').then((r) => {
      const list = (r.data || []).map((s: any) => s.name);
      if (list.length) setServices(list);
    }).catch(() => {});
  }, []);

  // Prefill pills — only renders when the user has decoded statements with
  // mappable line items. 404 / 403 / empty → silently no pills.
  useEffect(() => {
    if (!hasPaidAccess(user)) return;
    api.get('/statements/recent-line-items')
      .then((r) => setPrefills((r.data?.items || []).slice(0, 12)))
      .catch(() => setPrefills([]));
  }, [user]);

  const applyPrefill = (p: { service: string; unit_price: number }) => {
    setService(p.service);
    setRate(String(p.unit_price));
    setResult(null);
  };

  if (!hasPaidAccess(user)) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScrollView contentContainerStyle={styles.scroll}>
          <TouchableOpacity onPress={() => router.back()} style={styles.back}><Ionicons name="chevron-back" size={20} color={c.brandPrimary} /><Text style={styles.backText}>Back</Text></TouchableOpacity>
          <Text style={styles.overline}>Price checker</Text>
          <Text style={styles.h1}>Is this rate fair?</Text>
          <AIAccuracyBanner tool="provider-price-checker" />
          <ToolGate tool="provider-price-checker" variant={user ? 'free-plan' : 'unauth'} />
        </ScrollView>
      </SafeAreaView>
    );
  }

  const check = async () => {
    const r = parseFloat(rate);
    if (!r || r <= 0) {
      Alert.alert('Add the rate', "We will need the per-hour or per-unit price the provider's charging.");
      return;
    }
    setLoading(true);
    setResult(null);
    try {
      const { data } = await api.post('/public/price-check', { service, rate: r });
      setResult(data);
    } catch (e) {
      Alert.alert("Could not check", extractErrorMessage(e));
    } finally {
      setLoading(false);
    }
  };

  const verdictColor = result ? VERDICT_COLORS[result.verdict] || c.brandPrimary : c.brandPrimary;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <TouchableOpacity onPress={() => router.back()} style={styles.back}><Ionicons name="chevron-back" size={20} color={c.brandPrimary} /><Text style={styles.backText}>Back</Text></TouchableOpacity>
          <Text style={styles.overline}>Price checker</Text>
          <Text style={styles.h1}>Is this rate fair?</Text>
          <Text style={styles.sub}>We compare your provider's rate against the official indicative range published by the Department of Health (October 2025), not a government cap. National price caps were deferred indefinitely in May 2026.</Text>
          <AIAccuracyBanner tool="provider-price-checker" />
          <View style={styles.capsNote} testID="pc-caps-note">
            <Ionicons name="information-circle-outline" size={14} color={c.brandSecondary} />
            <Text style={styles.capsNoteText}>
              Price caps deferred. The Australian Government announced in May 2026 that the planned 1 July 2026 national provider price caps under Support at Home are deferred indefinitely. Providers continue to set their own prices. This tool compares against the official indicative range published by the Department of Health (October 2025), not a government cap. If you believe you have been overcharged, the Aged Care Quality and Safety Commission can order refunds.
            </Text>
          </View>

          <Text style={styles.label}>Service</Text>
          <View style={styles.row}>
            {services.map((s) => (
              <TouchableOpacity
                key={s}
                style={[styles.chip, service === s && styles.chipActive]}
                onPress={() => setService(s)}
                testID={`price-service-${s.replace(/\s/g, '-')}`}
              >
                <Text style={[styles.chipText, service === s && styles.chipTextActive]}>{s}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={styles.label}>Rate ($/hr, $/trip or $/meal)</Text>
          <TextInput style={styles.input} keyboardType="numeric" value={rate} onChangeText={setRate} placeholder="65.00" placeholderTextColor={c.textMuted} testID="price-rate-input" />

          {prefills.length > 0 && (
            <View style={styles.prefillWrap} testID="price-prefill-row">
              <Text style={styles.prefillHead}>From your recent statements</Text>
              <Text style={styles.prefillSub}>Tap a line to copy its service and rate into the checker.</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.prefillRow}>
                {prefills.map((p, i) => (
                  <TouchableOpacity
                    key={`pf-${i}`}
                    onPress={() => applyPrefill(p)}
                    style={styles.prefillPill}
                    testID={`price-prefill-${i}`}
                  >
                    <Text style={styles.prefillPillService} numberOfLines={1}>{p.service}</Text>
                    <Text style={styles.prefillPillRate}>{formatAUD2(p.unit_price)}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>
          )}

          <TouchableOpacity onPress={check} disabled={loading} style={[styles.btn, loading && { opacity: 0.6 }]} testID="price-check-button">
            <Text style={styles.btnText}>{loading ? 'Checking…' : 'Check it'}</Text>
          </TouchableOpacity>

          {result && (
            <View style={[styles.result, { borderLeftColor: verdictColor, borderLeftWidth: 4 }]} testID="price-result">
              <ToolSummary
                toolName="Provider Price Checker"
                tone={result.verdict === 'high' ? 'alert' : result.verdict === 'low' ? 'success' : 'neutral'}
                headline={`Your provider's price is ${String(result.verdict_label || result.verdict || '').toLowerCase()}.`}
                body={`${result.assessment || ''} Wayly compared what you pay (${formatAUD2(result.charged)} per ${result.unit || 'unit'}) against the indicative median of ${formatAUD2(result.median)} for the same service on the same stream.`.trim()}
              />
              <View style={styles.verdictRow}>
                <Text style={[styles.verdict, { color: verdictColor }]}>{result.verdict_label}</Text>
                {!!result.stream && (
                  <View style={[styles.streamBadge, { backgroundColor: (c.streams[result.stream] || c.brandPrimary) + '20' }]}>
                    <Text style={[styles.streamBadgeText, { color: c.streams[result.stream] || c.brandPrimary }]}>{result.stream}</Text>
                  </View>
                )}
              </View>
              <Text style={styles.assessment}>{result.assessment}</Text>
              <View style={styles.statRow}>
                <View style={styles.stat}>
                  <Text style={styles.statLabel}>You are charged</Text>
                  <Text style={styles.statValue}>{formatAUD2(result.charged)}</Text>
                  {!!result.unit && <Text style={styles.statUnit}>per {result.unit}</Text>}
                </View>
                <View style={styles.stat}>
                  <Text style={styles.statLabel}>Indicative median</Text>
                  <Text style={styles.statValue}>{formatAUD2(result.median)}</Text>
                  {!!result.unit && <Text style={styles.statUnit}>per {result.unit}</Text>}
                </View>
                {(result.lower != null && result.upper != null) && (
                  <View style={styles.stat}>
                    <Text style={styles.statLabel}>Indicative range</Text>
                    <Text style={styles.statValue}>{formatAUD2(result.lower)} to {formatAUD2(result.upper)}</Text>
                    <Text style={styles.statUnit}>DoH Oct 2025</Text>
                  </View>
                )}
              </View>
              {result.caps_note ? (
                <View style={styles.capsNote} testID="pc-result-caps-note">
                  <Ionicons name="information-circle-outline" size={12} color={c.brandSecondary} />
                  <Text style={styles.capsNoteText}>{result.caps_note}</Text>
                </View>
              ) : null}
              {result.suggested_action && (
                <View style={styles.action}>
                  <Ionicons name="arrow-forward" size={14} color={c.brandPrimary} />
                  <Text style={styles.actionText}>{result.suggested_action}</Text>
                </View>
              )}
              <ReportIssueButton tool="Provider Price Checker" />
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
  label: { fontFamily: Fonts.bodyMed, fontSize: 13, color: c.textSecondary, marginTop: Spacing.md, marginBottom: 8 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 100, borderWidth: 1, borderColor: c.border, backgroundColor: c.cardBg },
  chipActive: { backgroundColor: c.brandPrimary, borderColor: c.brandPrimary },
  chipText: { fontFamily: Fonts.bodyMed, fontSize: 13, color: c.brandPrimary },
  chipTextActive: { color: c.cream },
  input: { fontFamily: Fonts.body, fontSize: 16, color: c.textPrimary, backgroundColor: c.cardBg, borderRadius: Radius.md, paddingHorizontal: Spacing.md, paddingVertical: 12, borderWidth: 1, borderColor: c.border },
  btn: { marginTop: Spacing.lg, backgroundColor: c.brandPrimary, borderRadius: Radius.md, paddingVertical: 14, alignItems: 'center' },
  btnText: { fontFamily: Fonts.bodySemi, fontSize: 15, color: c.cream },
  result: { marginTop: Spacing.lg, backgroundColor: c.cardBg, borderRadius: Radius.lg, padding: Spacing.lg, borderWidth: 1, borderColor: c.borderSubtle },
  verdictRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  verdict: { flex: 1, fontFamily: Fonts.heading, fontSize: 18 },
  streamBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 },
  streamBadgeText: { fontFamily: Fonts.bodySemi, fontSize: 10, letterSpacing: 0.6, textTransform: 'uppercase' },
  statUnit: { fontFamily: Fonts.body, fontSize: 10, color: c.textMuted, marginTop: 1 },
  // Prefill pills row
  prefillWrap: { marginTop: 12, marginBottom: 6 },
  prefillHead: { fontFamily: Fonts.bodySemi, fontSize: 13, color: c.textPrimary },
  prefillSub: { fontFamily: Fonts.body, fontSize: 11, color: c.textSecondary, marginTop: 2 },
  prefillRow: { gap: 8, paddingVertical: 8, paddingHorizontal: 1 },
  prefillPill: { backgroundColor: c.surfaceTint, borderWidth: 1, borderColor: c.borderSubtle, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8, gap: 2, minWidth: 120, maxWidth: 220 },
  prefillPillService: { fontFamily: Fonts.bodySemi, fontSize: 12, color: c.textPrimary },
  prefillPillRate: { fontFamily: Fonts.mono, fontVariant: ['tabular-nums' as const], fontSize: 11, color: c.brandPrimary },
  assessment: { fontFamily: Fonts.body, fontSize: 14, color: c.textPrimary, lineHeight: 20, marginBottom: Spacing.md },
  statRow: { flexDirection: 'row', gap: Spacing.sm, marginBottom: Spacing.md },
  stat: { flex: 1, padding: Spacing.sm, backgroundColor: c.background, borderRadius: Radius.sm },
  statLabel: { fontFamily: Fonts.bodyMed, fontSize: 10, letterSpacing: 0.5, textTransform: 'uppercase', color: c.textMuted },
  statValue: { fontFamily: Fonts.monoSemi, fontVariant: ['tabular-nums' as const], fontSize: 13, color: c.brandPrimary, marginTop: 2 },
  action: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, paddingTop: Spacing.sm, borderTopWidth: 1, borderTopColor: c.borderSubtle },
  actionText: { fontFamily: Fonts.bodyMed, fontSize: 13, color: c.brandPrimary, flex: 1, fontStyle: 'italic' },
  capsNote: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, padding: 10, backgroundColor: 'rgba(183, 121, 31, 0.08)', borderRadius: Radius.md, borderLeftWidth: 3, borderLeftColor: c.brandSecondary, marginTop: Spacing.sm, marginBottom: Spacing.sm },
  capsNoteText: { flex: 1, fontFamily: Fonts.body, fontSize: 11, color: c.textPrimary, lineHeight: 15 },
}); }
