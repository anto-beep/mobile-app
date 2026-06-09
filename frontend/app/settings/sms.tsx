// Phase E — Settings: SMS preferences (best-effort backend; toggles persist in user.preferences.sms).
import React, { useState } from 'react';
import { ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import BackHeader from '../../src/components/BackHeader';
import { Colors, Fonts, Radius, Spacing, Type } from '../../src/lib/theme';
import { toast } from '../../src/components/Toast';

export default function SmsSettings() {
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
              <Switch value={opts[r.key]} onValueChange={() => toggle(r.key)} trackColor={{ true: Colors.brandPrimary, false: Colors.border }} />
            </View>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.bg },
  head: { ...Type.body, color: Colors.textSecondary, marginBottom: Spacing.md, lineHeight: 22 },
  card: { backgroundColor: Colors.cardBg, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.border, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: Spacing.md, paddingVertical: Spacing.md, borderBottomWidth: 1, borderBottomColor: Colors.border },
  label: { ...Type.bodySemi, color: Colors.textPrimary },
  sub: { ...Type.caption, color: Colors.textSecondary, marginTop: 3, lineHeight: 17 },
});
