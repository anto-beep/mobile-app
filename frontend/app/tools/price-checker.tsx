// Provider price checker
import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, TextInput, TouchableOpacity, Alert, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { api, extractErrorMessage } from '../../src/lib/api';
import { useAuth } from '../../src/context/AuthContext';
import { Colors, Fonts, Radius, Spacing, formatAUD2 } from '../../src/lib/theme';
import { AIAccuracyBanner, ToolGate, hasPaidAccess } from '../../src/components/AITools';

const FALLBACK_SERVICES = ['Personal care', 'Domestic assistance', 'Nursing', 'Physiotherapy', 'Cleaning', 'Transport'];

const VERDICT_COLORS: Record<string, string> = {
  fair: Colors.success,
  high: Colors.severityAlert,
  low: Colors.textMuted,
};

export default function PriceChecker() {
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
          <TouchableOpacity onPress={() => router.back()} style={styles.back}><Ionicons name="chevron-back" size={20} color={Colors.brandPrimary} /><Text style={styles.backText}>Back</Text></TouchableOpacity>
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

  const verdictColor = result ? VERDICT_COLORS[result.verdict] || Colors.brandPrimary : Colors.brandPrimary;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <TouchableOpacity onPress={() => router.back()} style={styles.back}><Ionicons name="chevron-back" size={20} color={Colors.brandPrimary} /><Text style={styles.backText}>Back</Text></TouchableOpacity>
          <Text style={styles.overline}>Price checker</Text>
          <Text style={styles.h1}>Is this rate fair?</Text>
          <Text style={styles.sub}>We'll compare against the network median and the 1 July 2026 cap.</Text>
          <AIAccuracyBanner tool="provider-price-checker" />

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
          <TextInput style={styles.input} keyboardType="numeric" value={rate} onChangeText={setRate} placeholder="65.00" placeholderTextColor={Colors.textMuted} testID="price-rate-input" />

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
                <View style={styles.stat}>
                  <Text style={styles.statLabel}>Cap (1 Jul)</Text>
                  <Text style={styles.statValue}>{formatAUD2(result.cap)}</Text>
                </View>
              </View>
              {result.suggested_action && (
                <View style={styles.action}>
                  <Ionicons name="arrow-forward" size={14} color={Colors.brandPrimary} />
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

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.lg, paddingBottom: 60 },
  back: { flexDirection: 'row', alignItems: 'center', marginBottom: Spacing.md },
  backText: { fontFamily: Fonts.bodyMed, fontSize: 14, color: Colors.brandPrimary },
  overline: { fontFamily: Fonts.bodyMed, fontSize: 11, letterSpacing: 1.5, textTransform: 'uppercase', color: Colors.textMuted },
  h1: { fontFamily: Fonts.heading, fontSize: 26, color: Colors.brandPrimary, letterSpacing: -0.5 },
  sub: { fontFamily: Fonts.body, fontSize: 14, color: Colors.textSecondary, marginTop: 6, marginBottom: Spacing.lg },
  label: { fontFamily: Fonts.bodyMed, fontSize: 13, color: Colors.textSecondary, marginTop: Spacing.md, marginBottom: 8 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 100, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.cardBg },
  chipActive: { backgroundColor: Colors.brandPrimary, borderColor: Colors.brandPrimary },
  chipText: { fontFamily: Fonts.bodyMed, fontSize: 13, color: Colors.brandPrimary },
  chipTextActive: { color: Colors.cream },
  input: { fontFamily: Fonts.body, fontSize: 16, color: Colors.textPrimary, backgroundColor: Colors.cardBg, borderRadius: Radius.md, paddingHorizontal: Spacing.md, paddingVertical: 12, borderWidth: 1, borderColor: Colors.border },
  btn: { marginTop: Spacing.lg, backgroundColor: Colors.brandPrimary, borderRadius: Radius.md, paddingVertical: 14, alignItems: 'center' },
  btnText: { fontFamily: Fonts.bodySemi, fontSize: 15, color: Colors.cream },
  result: { marginTop: Spacing.lg, backgroundColor: Colors.cardBg, borderRadius: Radius.lg, padding: Spacing.lg, borderWidth: 1, borderColor: Colors.borderSubtle },
  verdict: { fontFamily: Fonts.heading, fontSize: 18, marginBottom: 8 },
  assessment: { fontFamily: Fonts.body, fontSize: 14, color: Colors.textPrimary, lineHeight: 20, marginBottom: Spacing.md },
  statRow: { flexDirection: 'row', gap: Spacing.sm, marginBottom: Spacing.md },
  stat: { flex: 1, padding: Spacing.sm, backgroundColor: Colors.background, borderRadius: Radius.sm },
  statLabel: { fontFamily: Fonts.bodyMed, fontSize: 10, letterSpacing: 0.5, textTransform: 'uppercase', color: Colors.textMuted },
  statValue: { fontFamily: Fonts.bodySemi, fontSize: 14, color: Colors.brandPrimary, marginTop: 2 },
  action: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, paddingTop: Spacing.sm, borderTopWidth: 1, borderTopColor: Colors.borderSubtle },
  actionText: { fontFamily: Fonts.bodyMed, fontSize: 13, color: Colors.brandPrimary, flex: 1, fontStyle: 'italic' },
});
