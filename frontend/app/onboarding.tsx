// First-run wizard — creates the initial participant + household. Runs only
// for users without an `account_id` (new signups; existing users migrated).
import React, { useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { api } from '../src/lib/api';
import { useAuth } from '../src/context/AuthContext';
import { useParticipants } from '../src/context/ParticipantsContext';
import { Fonts, Radius, Spacing, Type } from '../src/lib/theme';
import type { ColorPalette } from '../src/lib/theme';
import { useColors } from '../src/hooks/useColors';
import { useThemedStyles } from '../src/hooks/useThemedStyles';
import { toast } from '../src/components/Toast';

export default function Onboarding() {
  const c = useColors();
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const { user, refresh } = useAuth();
  const { refetch } = useParticipants();
  const [step, setStep] = useState(0);
  const [first, setFirst] = useState('');
  const [last, setLast] = useState('');
  const [provider, setProvider] = useState('');
  const [classification, setClassification] = useState(4);
  const [busy, setBusy] = useState(false);

  async function finish() {
    if (!first.trim()) { Alert.alert('First name required'); setStep(0); return; }
    setBusy(true);
    try {
      // Ensure household exists (server idempotently creates one if missing).
      try {
        await api.post('/household', {
          participant_name: `${first.trim()} ${last.trim()}`.trim(),
          classification,
          provider_name: provider.trim() || 'Your provider',
        });
      } catch {/* legacy endpoint may return conflict; ignore and create participant */}
      await api.post('/participants', {
        first_name: first.trim(),
        last_name: last.trim(),
        provider_name: provider.trim() || 'Your provider',
        classification,
      });
      await Promise.all([refresh(), refetch()]);
      toast.success('Welcome to Wayly');
      router.replace('/(tabs)/today' as any);
    } catch (e: any) {
      Alert.alert('Could not finish setup', e?.response?.data?.detail || e?.message);
    } finally { setBusy(false); }
  }

  const steps = [
    { title: 'Welcome to Wayly', body: `Hi ${user?.name?.split(' ')[0] || 'there'}, we will set up the person you are caring for so the dashboard shows the right data.`, icon: 'sparkles-outline' as const },
    { title: 'Their name', body: 'We use the first name throughout the app.', icon: 'person-outline' as const },
    { title: 'Their classification', body: 'Support at Home Level 1‑8. You can change this later from Participants.', icon: 'pricetag-outline' as const },
    { title: 'Provider', body: 'Who delivers their funded services?', icon: 'business-outline' as const },
  ];
  const s = steps[step];

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView contentContainerStyle={{ padding: Spacing.lg, paddingBottom: 60 }}>
        <View style={styles.stepper}>
          {steps.map((_, i) => (
            <View key={i} style={[styles.dot, i <= step && styles.dotActive]} />
          ))}
        </View>

        <View style={styles.iconWrap}><Ionicons name={s.icon} size={32} color={c.brandPrimary} /></View>
        <Text style={[Type.h1 as any, { color: c.textPrimary }]}>{s.title}</Text>
        <Text style={styles.body}>{s.body}</Text>

        {step === 1 && (
          <View style={{ gap: 10, marginTop: Spacing.lg }}>
            <TextInput value={first} onChangeText={setFirst} placeholder="First name" placeholderTextColor={c.textMuted} style={styles.input} autoFocus />
            <TextInput value={last} onChangeText={setLast} placeholder="Last name (optional)" placeholderTextColor={c.textMuted} style={styles.input} />
          </View>
        )}
        {step === 2 && (
          <View style={styles.pillRow}>
            {[1,2,3,4,5,6,7,8].map((n) => (
              <TouchableOpacity key={n} onPress={() => setClassification(n)} style={[styles.pill, classification === n && styles.pillActive]}>
                <Text style={[styles.pillText, classification === n && styles.pillTextActive]}>L{n}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}
        {step === 3 && (
          <View style={{ marginTop: Spacing.lg }}>
            <TextInput value={provider} onChangeText={setProvider} placeholder="e.g. HomeCare Plus" placeholderTextColor={c.textMuted} style={styles.input} autoFocus />
          </View>
        )}

        <View style={styles.actionRow}>
          {step > 0 && (
            <TouchableOpacity style={[styles.btn, styles.btnGhost]} onPress={() => setStep((s) => s - 1)}>
              <Text style={styles.btnGhostText}>Back</Text>
            </TouchableOpacity>
          )}
          {step < steps.length - 1 ? (
            <TouchableOpacity
              style={[styles.btn, styles.btnSolid]}
              onPress={() => {
                if (step === 1 && !first.trim()) { Alert.alert('First name required'); return; }
                setStep((s) => s + 1);
              }}
              testID="onboarding-next"
            >
              <Text style={styles.btnSolidText}>Continue</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity style={[styles.btn, styles.btnSolid, busy && { opacity: 0.6 }]} onPress={finish} disabled={busy} testID="onboarding-finish">
              <Text style={styles.btnSolidText}>{busy ? 'Setting up…' : 'Finish setup'}</Text>
            </TouchableOpacity>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function makeStyles(c: ColorPalette) { return StyleSheet.create({
  safe: { flex: 1, backgroundColor: c.bg },
  stepper: { flexDirection: 'row', justifyContent: 'center', gap: 6, marginBottom: Spacing.xl },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: c.border },
  dotActive: { backgroundColor: c.brandPrimary },
  iconWrap: { width: 64, height: 64, borderRadius: 32, backgroundColor: 'rgba(14,77,82,0.08)', alignItems: 'center', justifyContent: 'center', marginBottom: Spacing.md },
  body: { ...Type.body, color: c.textSecondary, marginTop: 8, lineHeight: 24 },
  input: { borderWidth: 1, borderColor: c.border, borderRadius: 10, padding: 14, fontFamily: Fonts.body, color: c.textPrimary, fontSize: 16 },
  pillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: Spacing.lg },
  pill: { paddingVertical: 10, paddingHorizontal: 16, borderRadius: 9999, borderWidth: 1.5, borderColor: c.border, backgroundColor: c.cardBg },
  pillActive: { borderColor: c.brandPrimary, backgroundColor: 'rgba(14,77,82,0.08)' },
  pillText: { color: c.textSecondary, fontFamily: Fonts.bodySemi, fontWeight: '700' },
  pillTextActive: { color: c.brandPrimary },
  actionRow: { flexDirection: 'row', gap: 10, marginTop: Spacing.xl },
  btn: { flex: 1, paddingVertical: 14, borderRadius: 9999, alignItems: 'center' },
  btnGhost: { borderWidth: 1.5, borderColor: c.border },
  btnGhostText: { color: c.textPrimary, fontFamily: Fonts.bodySemi, fontWeight: '700' },
  btnSolid: { backgroundColor: c.brandPrimary },
  btnSolidText: { color: '#fff', fontFamily: Fonts.bodySemi, fontWeight: '700' },
}); }
