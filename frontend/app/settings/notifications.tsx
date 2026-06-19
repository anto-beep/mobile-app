// Notification preferences — toggles
import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Switch, ActivityIndicator, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { api, extractErrorMessage } from '../../src/lib/api';
import { Fonts, Radius, Spacing } from '../../src/lib/theme';
import type { ColorPalette } from '../../src/lib/theme';
import { useColors } from '../../src/hooks/useColors';
import { useThemedStyles } from '../../src/hooks/useThemedStyles';
import BackHeader from '../../src/components/BackHeader';

type Prefs = {
  push_alert?: boolean;
  push_warning?: boolean;
  email_anomaly?: boolean;
  email_digest?: boolean;
  email_family?: boolean;
  email_wellbeing?: boolean;
};

const DEFAULTS: Prefs = {
  push_alert: true,
  push_warning: true,
  email_anomaly: true,
  email_digest: true,
  email_family: true,
  email_wellbeing: true,
};

const ROWS: { key: keyof Prefs; label: string; sub: string; section: 'push' | 'email' }[] = [
  { key: 'push_alert', label: 'High-priority alerts', sub: 'New anomalies marked as alerts', section: 'push' },
  { key: 'push_warning', label: 'Warnings', sub: 'Things worth a look but not urgent', section: 'push' },
  { key: 'email_anomaly', label: 'Anomalies on a statement', sub: 'When we spot something off in a statement', section: 'email' },
  { key: 'email_digest', label: 'Sunday digest', sub: 'Weekly recap of what happened (Family plan)', section: 'email' },
  { key: 'email_family', label: 'Family thread updates', sub: 'When a family member posts a note', section: 'email' },
  { key: 'email_wellbeing', label: 'Wellbeing check-ins', sub: 'When your participant flags a hard day', section: 'email' },
];

export default function NotificationsPrefs() {
  const c = useColors();
  const styles = useThemedStyles(makeStyles);
  const [prefs, setPrefs] = useState<Prefs>(DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const { data } = await api.get<Prefs>('/notifications/prefs');
        setPrefs({ ...DEFAULTS, ...(data || {}) });
      } catch {
        setPrefs(DEFAULTS);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const toggle = async (key: keyof Prefs) => {
    const next = { ...prefs, [key]: !prefs[key] };
    setPrefs(next);
    setSaving(true);
    try {
      await api.put('/notifications/prefs', next);
    } catch (e) {
      // Revert on failure
      setPrefs((p) => ({ ...p, [key]: !next[key] }));
      Alert.alert("Couldn't save", extractErrorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <BackHeader title="Push & in-app" />
        <View style={styles.loadingFill}><ActivityIndicator color={c.brandPrimary} /></View>
      </SafeAreaView>
    );
  }

  const pushRows = ROWS.filter((r) => r.section === 'push');
  const emailRows = ROWS.filter((r) => r.section === 'email');

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <BackHeader title="Push & in-app" />
      <ScrollView contentContainerStyle={styles.scroll} testID="prefs-scroll">
        <Text style={styles.sectionLabel}>Push notifications</Text>
        <View style={styles.card}>
          {pushRows.map((r, i) => (
            <View key={r.key} style={[styles.row, i < pushRows.length - 1 && styles.rowDivider]} testID={`pref-${r.key}`}>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowLabel}>{r.label}</Text>
                <Text style={styles.rowSub}>{r.sub}</Text>
              </View>
              <Switch value={!!prefs[r.key]} onValueChange={() => toggle(r.key)} disabled={saving} />
            </View>
          ))}
        </View>

        <Text style={[styles.sectionLabel, { marginTop: Spacing.lg }]}>Email</Text>
        <View style={styles.card}>
          {emailRows.map((r, i) => (
            <View key={r.key} style={[styles.row, i < emailRows.length - 1 && styles.rowDivider]} testID={`pref-${r.key}`}>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowLabel}>{r.label}</Text>
                <Text style={styles.rowSub}>{r.sub}</Text>
              </View>
              <Switch value={!!prefs[r.key]} onValueChange={() => toggle(r.key)} disabled={saving} />
            </View>
          ))}
        </View>

        <View style={styles.note}>
          <Ionicons name="information-circle-outline" size={14} color={c.textMuted} />
          <Text style={styles.noteText}>
            Push notifications need a real device + permission. The first time you log in we'll ask if Wayly can send them.
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function makeStyles(c: ColorPalette) { return StyleSheet.create({
  safe: { flex: 1, backgroundColor: c.background },
  loadingFill: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scroll: { padding: Spacing.lg, paddingBottom: 60 },
  sectionLabel: { fontFamily: Fonts.bodyMed, fontSize: 11, letterSpacing: 1.5, textTransform: 'uppercase', color: c.textMuted, marginBottom: Spacing.sm },
  card: { backgroundColor: c.cardBg, borderRadius: Radius.lg, borderWidth: 1, borderColor: c.borderSubtle, paddingHorizontal: Spacing.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingVertical: Spacing.md },
  rowDivider: { borderBottomWidth: 1, borderBottomColor: c.borderSubtle },
  rowLabel: { fontFamily: Fonts.bodySemi, fontSize: 14, color: c.brandPrimary },
  rowSub: { fontFamily: Fonts.body, fontSize: 12, color: c.textSecondary, marginTop: 2 },
  note: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, padding: Spacing.md, marginTop: Spacing.sm },
  noteText: { fontFamily: Fonts.body, fontSize: 11, color: c.textMuted, flex: 1, lineHeight: 16 },
}); }
