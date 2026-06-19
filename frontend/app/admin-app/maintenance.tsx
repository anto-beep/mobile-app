// Admin · Maintenance toggle (Milestone 3)
// super_admin only. Biometric (Face ID / Touch ID) confirmation required to flip state.
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, RefreshControl, TouchableOpacity, ActivityIndicator, TextInput, Switch, Alert, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { adminApi, useAdminAuth } from '../../src/context/AdminAuthContext';
import { Fonts, Radius, Spacing } from '../../src/lib/theme';
import type { ColorPalette } from '../../src/lib/theme';
import { useColors } from '../../src/hooks/useColors';
import { useThemedStyles } from '../../src/hooks/useThemedStyles';
import { toast } from '../../src/components/Toast';
import { confirmWithBiometric, biometryLabel } from '../../src/lib/biometric';

type HistoryItem = { id: string; at: string; enabled: boolean; message: string; actor_email: string; actor_role?: string };

export default function AdminMaintenance() {
  const c = useColors();
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const { admin, touch } = useAdminAuth();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [message, setMessage] = useState('');
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [updatedBy, setUpdatedBy] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  const isSuper = admin?.admin_role === 'super_admin';

  const load = useCallback(async () => {
    try {
      const [cur, hist] = await Promise.all([
        adminApi.get('/admin/maintenance'),
        adminApi.get('/admin/maintenance/history'),
      ]);
      setEnabled(!!cur.data.enabled);
      setMessage(cur.data.message || '');
      setUpdatedAt(cur.data.updated_at || null);
      setUpdatedBy(cur.data.updated_by || null);
      setHistory(hist.data.items || []);
      setDirty(false);
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || 'Could not load maintenance');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const performSave = useCallback(async (nextEnabled: boolean, nextMessage: string) => {
    setSaving(true);
    try {
      await adminApi.post('/admin/maintenance', { enabled: nextEnabled, message: nextMessage });
      toast.success(nextEnabled ? 'Maintenance mode ON' : 'Maintenance mode OFF');
      await load();
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || 'Could not save');
    } finally {
      setSaving(false);
    }
  }, [load]);

  const confirmAndSave = useCallback(async (nextEnabled: boolean) => {
    if (!isSuper) {
      toast.error('Only super_admin can toggle maintenance.');
      return;
    }
    const action = nextEnabled ? 'Enable maintenance mode' : 'Disable maintenance mode';
    const prompt = nextEnabled
      ? 'Confirm: take Wayly offline for the public'
      : 'Confirm: bring Wayly back online';
    const res = await confirmWithBiometric(prompt);
    if (!res.success) {
      if (res.reason === 'unavailable' || res.reason === 'no-enrolled') {
        // Fallback: native Alert confirm
        if (Platform.OS !== 'web') {
          Alert.alert(action, `${prompt}.\n\nBiometric isn't set up on this device. Tap Confirm to continue.`, [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Confirm', style: 'destructive', onPress: () => performSave(nextEnabled, message) },
          ]);
          return;
        }
      }
      if (res.reason !== 'cancelled' && res.reason !== 'web-confirm-declined') {
        toast.warning('Authentication failed. Try again.');
      }
      return;
    }
    performSave(nextEnabled, message);
  }, [isSuper, message, performSave]);

  const saveMessageOnly = useCallback(async () => {
    if (!isSuper) return;
    if (!dirty) return;
    const res = await confirmWithBiometric('Confirm: update maintenance message');
    if (!res.success) return;
    performSave(enabled, message);
  }, [isSuper, dirty, enabled, message, performSave]);

  if (!admin) return null;

  return (
    <SafeAreaView style={styles.safe} edges={['top']} onTouchStart={touch}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} testID="maint-back">
          <Ionicons name="chevron-back" size={22} color={c.brandPrimary} />
          <Text style={styles.backText}>Back</Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={c.brandPrimary} />}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.overline}>System</Text>
        <Text style={styles.h1}>Maintenance</Text>
        <Text style={styles.sub}>Hide Wayly from the public during planned downtime. Requires {biometryLabel()} confirmation.</Text>

        {!isSuper ? (
          <View style={styles.lockedCard}>
            <Ionicons name="lock-closed" size={18} color={c.danger} />
            <View style={{ flex: 1 }}>
              <Text style={styles.lockedTitle}>Super admin only</Text>
              <Text style={styles.lockedBody}>Your current role is {admin.admin_role.replace('_', ' ')}. Ask a super_admin to toggle maintenance.</Text>
            </View>
          </View>
        ) : null}

        {loading ? (
          <View style={styles.loader}><ActivityIndicator color={c.brandPrimary} /></View>
        ) : (
          <>
            <View style={[styles.statusCard, enabled ? styles.statusOn : styles.statusOff]}>
              <View style={{ flex: 1 }}>
                <Text style={styles.statusOverline}>Current status</Text>
                <Text style={styles.statusValue}>{enabled ? 'MAINTENANCE MODE ON' : 'LIVE'}</Text>
                {updatedAt ? (
                  <Text style={styles.statusMeta}>Last change · {new Date(updatedAt).toLocaleString()} · {updatedBy || '—'}</Text>
                ) : (
                  <Text style={styles.statusMeta}>Never toggled.</Text>
                )}
              </View>
              <Switch
                value={enabled}
                disabled={!isSuper || saving}
                onValueChange={(v) => confirmAndSave(v)}
                trackColor={{ false: c.borderSubtle, true: 'rgba(192, 57, 43, 0.7)' }}
                thumbColor={enabled ? c.danger : c.cardBg}
                testID="maintenance-switch"
              />
            </View>

            <Text style={styles.label}>Public message (optional)</Text>
            <TextInput
              value={message}
              onChangeText={(t) => { setMessage(t); setDirty(true); }}
              placeholder="We'll be back at 10pm AEST tonight."
              placeholderTextColor={c.textMuted}
              style={styles.input}
              multiline
              numberOfLines={3}
              editable={isSuper}
              maxLength={240}
              testID="maintenance-message"
            />
            <Text style={styles.help}>Shown on the public landing page and in-app banner when maintenance is on. Max 240 chars.</Text>

            {dirty ? (
              <TouchableOpacity style={styles.saveBtn} onPress={saveMessageOnly} disabled={saving} testID="save-message">
                {saving ? <ActivityIndicator color={c.cream} /> : (
                  <>
                    <Ionicons name="save-outline" size={16} color={c.cream} />
                    <Text style={styles.saveBtnText}>Save message</Text>
                  </>
                )}
              </TouchableOpacity>
            ) : null}

            <View style={styles.bioHint}>
              <Ionicons name="finger-print" size={14} color={c.brandSecondary} />
              <Text style={styles.bioHintText}>Each change is confirmed with {biometryLabel()} and logged below.</Text>
            </View>

            <Text style={styles.sectionLabel}>Recent changes</Text>
            <View style={styles.histCard}>
              {history.length === 0 ? (
                <View style={styles.emptyRow}>
                  <Ionicons name="time-outline" size={14} color={c.textMuted} />
                  <Text style={styles.emptyText}>No history yet.</Text>
                </View>
              ) : history.map((h) => (
                <View key={h.id} style={styles.histRow}>
                  <View style={[styles.histDot, { backgroundColor: h.enabled ? c.danger : c.success }]} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.histTitle}>{h.enabled ? 'Enabled' : 'Disabled'}{h.message ? ` — “${h.message}”` : ''}</Text>
                    <Text style={styles.histMeta}>{new Date(h.at).toLocaleString()} · {h.actor_email}</Text>
                  </View>
                </View>
              ))}
            </View>
          </>
        )}

        <View style={{ height: 60 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

function makeStyles(c: ColorPalette) { return StyleSheet.create({
  safe: { flex: 1, backgroundColor: c.background },
  header: { paddingHorizontal: Spacing.lg, paddingVertical: 8, flexDirection: 'row', alignItems: 'center' },
  backBtn: { flexDirection: 'row', alignItems: 'center', minHeight: 44, paddingRight: 12 },
  backText: { fontFamily: Fonts.bodyMed, fontSize: 15, color: c.brandPrimary, marginLeft: 2 },
  scroll: { padding: Spacing.lg, paddingTop: 4 },
  overline: { fontFamily: Fonts.bodyMed, fontSize: 11, letterSpacing: 1.5, textTransform: 'uppercase', color: c.textMuted },
  h1: { fontFamily: Fonts.heading, fontSize: 30, color: c.brandPrimary, letterSpacing: -0.5 },
  sub: { fontFamily: Fonts.body, fontSize: 13, color: c.textSecondary, marginTop: 4, lineHeight: 18 },
  loader: { paddingVertical: 40, alignItems: 'center' },
  lockedCard: { flexDirection: 'row', gap: 10, padding: Spacing.md, marginTop: Spacing.md, borderRadius: Radius.md, backgroundColor: 'rgba(192, 57, 43, 0.08)', borderWidth: 1, borderColor: 'rgba(192, 57, 43, 0.3)' },
  lockedTitle: { fontFamily: Fonts.bodySemi, fontSize: 13, color: c.brandPrimary },
  lockedBody: { fontFamily: Fonts.body, fontSize: 12, color: c.textSecondary, marginTop: 2 },
  statusCard: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: Spacing.md, marginTop: Spacing.md, borderRadius: Radius.md, borderWidth: 1 },
  statusOn: { backgroundColor: 'rgba(192, 57, 43, 0.08)', borderColor: 'rgba(192, 57, 43, 0.4)' },
  statusOff: { backgroundColor: c.cardBg, borderColor: c.borderSubtle },
  statusOverline: { fontFamily: Fonts.bodyMed, fontSize: 10, letterSpacing: 1.2, textTransform: 'uppercase', color: c.textMuted },
  statusValue: { fontFamily: Fonts.heading, fontSize: 18, color: c.brandPrimary, marginTop: 4 },
  statusMeta: { fontFamily: Fonts.body, fontSize: 11, color: c.textSecondary, marginTop: 4 },
  label: { fontFamily: Fonts.bodyMed, fontSize: 12, color: c.brandPrimary, marginTop: Spacing.md, marginBottom: 6 },
  input: { fontFamily: Fonts.body, fontSize: 14, color: c.brandPrimary, backgroundColor: c.cardBg, borderWidth: 1, borderColor: c.borderSubtle, borderRadius: Radius.md, padding: Spacing.md, minHeight: 90, textAlignVertical: 'top' },
  help: { fontFamily: Fonts.body, fontSize: 11, color: c.textMuted, marginTop: 6 },
  saveBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 12, marginTop: Spacing.md, borderRadius: Radius.md, backgroundColor: c.brandPrimary },
  saveBtnText: { fontFamily: Fonts.bodySemi, fontSize: 14, color: c.cream },
  bioHint: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: Spacing.md, padding: 10, borderRadius: Radius.md, backgroundColor: 'rgba(183, 121, 31, 0.1)' },
  bioHintText: { fontFamily: Fonts.body, fontSize: 11, color: c.textSecondary, flex: 1 },
  sectionLabel: { fontFamily: Fonts.bodyMed, fontSize: 11, letterSpacing: 1.2, textTransform: 'uppercase', color: c.textMuted, marginTop: Spacing.lg, marginBottom: 6 },
  histCard: { backgroundColor: c.cardBg, borderRadius: Radius.md, borderWidth: 1, borderColor: c.borderSubtle, paddingHorizontal: Spacing.sm },
  histRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.borderSubtle },
  histDot: { width: 8, height: 8, borderRadius: 4 },
  histTitle: { fontFamily: Fonts.bodySemi, fontSize: 13, color: c.brandPrimary },
  histMeta: { fontFamily: Fonts.body, fontSize: 11, color: c.textSecondary, marginTop: 2 },
  emptyRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 16, paddingHorizontal: Spacing.sm },
  emptyText: { fontFamily: Fonts.body, fontSize: 12, color: c.textSecondary },
}); }
