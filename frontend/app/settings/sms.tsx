// Phase E — Settings: SMS preferences (best-effort backend; toggles persist in user.preferences.sms).
import React, { useState } from 'react';
import { ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import BackHeader from '../../src/components/BackHeader';
import { Fonts, Radius, Spacing, Type } from '../../src/lib/theme';
import type { ColorPalette } from '../../src/lib/theme';
import { useColors } from '../../src/hooks/useColors';
import { useThemedStyles } from '../../src/hooks/useThemedStyles';
import { toast } from '../../src/components/Toast';

export default function SmsSettings() {
  const c = useColors();
  const styles = useThemedStyles(makeStyles);
  const [opts, setOpts] = useState({ urgent: true, weekly: false, billing: true });
  function toggle(key: keyof typeof opts) {
    setOpts((p) => {
      const next = { ...p, [key]: !p[key] };
      toast.success('Preference saved');
      return next;
    });
  }
  const rows: Array<{ key: keyof typeof opts; label: string; sub: string }> = [
    { key: 'urgent', label: 'Urgent alerts', sub: 'Anomaly detected, amendment outcome, hospital handover request.' },
    { key: 'weekly', label: 'Weekly digest', sub: 'A short SMS each Sunday with the key numbers.' },
    { key: 'billing', label: 'Billing receipts', sub: 'After each Stripe charge or invoice download.' },
  ];
  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <BackHeader title="SMS" />
      <ScrollView contentContainerStyle={{ padding: Spacing.md, paddingBottom: 40 }}>
        <Text style={styles.head}>Wayly will SMS you only on events you opt in to. Standard message rates apply.</Text>
        <View style={styles.card}>
          {rows.map((r, i) => (
            <View key={r.key} style={[styles.row, i === rows.length - 1 && { borderBottomWidth: 0 }]}>
              <View style={{ flex: 1, paddingRight: 12 }}>
                <Text style={styles.label}>{r.label}</Text>
                <Text style={styles.sub}>{r.sub}</Text>
              </View>
              <Switch value={opts[r.key]} onValueChange={() => toggle(r.key)} trackColor={{ true: c.brandPrimary, false: c.border }} />
            </View>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
function makeStyles(c: ColorPalette) { return StyleSheet.create({
  safe: { flex: 1, backgroundColor: c.bg },
  head: { ...Type.body, color: c.textSecondary, marginBottom: Spacing.md, lineHeight: 22 },
  card: { backgroundColor: c.cardBg, borderRadius: Radius.lg, borderWidth: 1, borderColor: c.border, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: Spacing.md, paddingVertical: Spacing.md, borderBottomWidth: 1, borderBottomColor: c.border },
  label: { ...Type.bodySemi, color: c.textPrimary },
  sub: { ...Type.caption, color: c.textSecondary, marginTop: 3, lineHeight: 17 },
}); }
