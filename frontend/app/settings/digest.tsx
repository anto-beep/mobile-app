// Phase E — Settings: Weekly / monthly digest cadence.
import React, { useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import BackHeader from '../../src/components/BackHeader';
import { Colors, Fonts, Radius, Spacing, Type } from '../../src/lib/theme';
import { toast } from '../../src/components/Toast';

type Cadence = 'weekly' | 'monthly' | 'off';
export default function DigestSettings() {
  const [c, setC] = useState<Cadence>('weekly');
  const opts: Array<{ key: Cadence; title: string; sub: string }> = [
    { key: 'weekly', title: 'Weekly', sub: 'Sunday 7am AEST — 1‑glance of the week’s spend + anomalies.' },
    { key: 'monthly', title: 'Monthly', sub: 'First of the month — a fuller PDF of last month’s activity.' },
    { key: 'off', title: 'Off', sub: 'No digest. You can still pull reports on demand.' },
  ];
  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <BackHeader title="Digest" />
      <ScrollView contentContainerStyle={{ padding: Spacing.md, paddingBottom: 40, gap: 10 }}>
        {opts.map((o) => (
          <TouchableOpacity
            key={o.key}
            onPress={() => { setC(o.key); toast.success('Cadence updated'); }}
            style={[styles.card, c === o.key && styles.cardActive]}
            accessibilityRole="radio"
          >
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>{o.title}</Text>
              <Text style={styles.sub}>{o.sub}</Text>
            </View>
            <View style={[styles.radio, c === o.key && styles.radioActive]} />
          </TouchableOpacity>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}
const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.bg },
  card: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: Colors.cardBg, borderRadius: Radius.lg, padding: Spacing.md, borderWidth: 1, borderColor: Colors.border },
  cardActive: { borderColor: Colors.brandPrimary, borderWidth: 2 },
  title: { ...Type.bodySemi, color: Colors.textPrimary },
  sub: { ...Type.caption, color: Colors.textSecondary, marginTop: 3, lineHeight: 17 },
  radio: { width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: Colors.border },
  radioActive: { borderColor: Colors.brandPrimary, backgroundColor: Colors.brandPrimary },
});
