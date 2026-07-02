// Phase E — Settings: Weekly / monthly digest cadence.
import React, { useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import BackHeader from '../../src/components/BackHeader';
import { Fonts, Radius, Spacing, Type } from '../../src/lib/theme';
import type { ColorPalette } from '../../src/lib/theme';
import { useColors } from '../../src/hooks/useColors';
import { useThemedStyles } from '../../src/hooks/useThemedStyles';
import { toast } from '../../src/components/Toast';

type Cadence = 'weekly' | 'monthly' | 'off';
export default function DigestSettings() {
  const c = useColors();
  const styles = useThemedStyles(makeStyles);
  const [cadence, setCadence] = useState<Cadence>('weekly');
  const opts: Array<{ key: Cadence; title: string; sub: string }> = [
    { key: 'weekly', title: 'Weekly', sub: 'Sunday 7am AEST, 1‑glance of the week’s spend + anomalies.' },
    { key: 'monthly', title: 'Monthly', sub: 'First of the month, a fuller PDF of last month’s activity.' },
    { key: 'off', title: 'Off', sub: 'No digest. You can still pull reports on demand.' },
  ];
  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <BackHeader title="Digest" />
      <ScrollView contentContainerStyle={{ padding: Spacing.md, paddingBottom: 40, gap: 10 }}>
        {opts.map((o) => (
          <TouchableOpacity
            key={o.key}
            onPress={() => { setCadence(o.key); toast.success('Cadence updated'); }}
            style={[styles.card, cadence === o.key && styles.cardActive]}
            accessibilityRole="radio"
          >
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>{o.title}</Text>
              <Text style={styles.sub}>{o.sub}</Text>
            </View>
            <View style={[styles.radio, cadence === o.key && styles.radioActive]} />
          </TouchableOpacity>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}
function makeStyles(c: ColorPalette) { return StyleSheet.create({
  safe: { flex: 1, backgroundColor: c.bg },
  card: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: c.cardBg, borderRadius: Radius.lg, padding: Spacing.md, borderWidth: 1, borderColor: c.border },
  cardActive: { borderColor: c.brandPrimary, borderWidth: 2 },
  title: { ...Type.bodySemi, color: c.textPrimary },
  sub: { ...Type.caption, color: c.textSecondary, marginTop: 3, lineHeight: 17 },
  radio: { width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: c.border },
  radioActive: { borderColor: c.brandPrimary, backgroundColor: c.brandPrimary },
}); }
