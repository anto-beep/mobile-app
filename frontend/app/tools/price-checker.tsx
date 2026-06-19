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

  useEffect(() => {
    api.get('/public/price-check/services').then((r) => {
      const list = (r.data || []).map((s: any) => s.name);
      if (list.length) setServices(list);
    }).catch(() => {});
  }, []);

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
      Alert.alert('Add the rate', "We'll need the per-hour or per-unit price the provider's charging.");
      return;
    }
    setLoading(true);
    setResult(null);
    try {
      const { data } = await api.post('/public/price-check', { service, rate: r });
      setResult(data);
    } catch (e) {
      Alert.alert("Couldn't check", extractErrorMessage(e));
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
          <Text style={styles.sub}>We'll compare against the network median. National price caps were deferred indefinitely in May 2026 — providers price competitively below this median.</Text>
          <AIAccuracyBanner tool="provider-price-checker" />
          <View style={styles.capsNote} testID="pc-caps-note">
            <Ionicons name="information-circle-outline" size={14} color={c.brandSecondary} />
            <Text style={styles.capsNoteText}>National price caps were deferred indefinitely in May 2026 — the verdict below is median-only.</Text>
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

          <Text style={styles.label}>Rate ($/hr or $/unit)</Text>
          <TextInput style={styles.input} keyboardType="numeric" value={rate} onChangeText={setRate} placeholder="65.00" placeholderTextColor={c.textMuted} testID="price-rate-input" />

          <TouchableOpacity onPress={check} disabled={loading} style={[styles.btn, loading && { opacity: 0.6 }]} testID="price-check-button">
            <Text style={styles.btnText}>{loading ? 'Checking…' : 'Check it'}</Text>
          </TouchableOpacity>

          {result && (
            <View style={[styles.result, { borderLeftColor: verdictColor, borderLeftWidth: 4 }]} testID="price-result">
              <Text style={[styles.verdict, { color: verdictColor }]}>{result.verdict_label}</Text>
              <Text style={styles.assessment}>{result.assessment}</Text>
              <View style={styles.statRow}>
                <View style={styles.stat}>
                  <Text style={styles.statLabel}>You're charged</Text>
                  <Text style={styles.statValue}>{formatAUD2(result.charged)}</Text>
                </View>
                <View style={styles.stat}>
                  <Text style={styles.statLabel}>Network median</Text>
                  <Text style={styles.statValue}>{formatAUD2(result.median)}</Text>
                </View>
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
  verdict: { fontFamily: Fonts.heading, fontSize: 18, marginBottom: 8 },
  assessment: { fontFamily: Fonts.body, fontSize: 14, color: c.textPrimary, lineHeight: 20, marginBottom: Spacing.md },
  statRow: { flexDirection: 'row', gap: Spacing.sm, marginBottom: Spacing.md },
  stat: { flex: 1, padding: Spacing.sm, backgroundColor: c.background, borderRadius: Radius.sm },
  statLabel: { fontFamily: Fonts.bodyMed, fontSize: 10, letterSpacing: 0.5, textTransform: 'uppercase', color: c.textMuted },
  statValue: { fontFamily: Fonts.bodySemi, fontSize: 14, color: c.brandPrimary, marginTop: 2 },
  action: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, paddingTop: Spacing.sm, borderTopWidth: 1, borderTopColor: c.borderSubtle },
  actionText: { fontFamily: Fonts.bodyMed, fontSize: 13, color: c.brandPrimary, flex: 1, fontStyle: 'italic' },
  capsNote: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, padding: 10, backgroundColor: 'rgba(183, 121, 31, 0.08)', borderRadius: Radius.md, borderLeftWidth: 3, borderLeftColor: c.brandSecondary, marginTop: Spacing.sm, marginBottom: Spacing.sm },
  capsNoteText: { flex: 1, fontFamily: Fonts.body, fontSize: 11, color: c.textPrimary, lineHeight: 15 },
}); }
