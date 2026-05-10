// Notification preferences — toggles
import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Switch, ActivityIndicator, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { api, extractErrorMessage } from '../../src/lib/api';
import { Colors, Fonts, Radius, Spacing } from '../../src/lib/theme';

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
      <SafeAreaView style={styles.safe}><View style={styles.loadingFill}><ActivityIndicator color={Colors.brandPrimary} /></View></SafeAreaView>
    );
  }

  const pushRows = ROWS.filter((r) => r.section === 'push');
  const emailRows = ROWS.filter((r) => r.section === 'email');

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
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
          <Ionicons name="information-circle-outline" size={14} color={Colors.textMuted} />
          <Text style={styles.noteText}>
            Push notifications need a real device + permission. The first time you log in we'll ask if Wayly can send them.
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  loadingFill: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scroll: { padding: Spacing.lg, paddingBottom: 60 },
  sectionLabel: { fontFamily: Fonts.bodyMed, fontSize: 11, letterSpacing: 1.5, textTransform: 'uppercase', color: Colors.textMuted, marginBottom: Spacing.sm },
  card: { backgroundColor: Colors.cardBg, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.borderSubtle, paddingHorizontal: Spacing.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingVertical: Spacing.md },
  rowDivider: { borderBottomWidth: 1, borderBottomColor: Colors.borderSubtle },
  rowLabel: { fontFamily: Fonts.bodySemi, fontSize: 14, color: Colors.brandPrimary },
  rowSub: { fontFamily: Fonts.body, fontSize: 12, color: Colors.textSecondary, marginTop: 2 },
  note: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, padding: Spacing.md, marginTop: Spacing.sm },
  noteText: { fontFamily: Fonts.body, fontSize: 11, color: Colors.textMuted, flex: 1, lineHeight: 16 },
});
