// Admin user profile — suspend/reinstate, extend trial, add note, send password reset
import React, { useCallback, useState } from 'react';
import { formatDate, formatDateTime } from '../../../src/lib/formatDate';
import { View, Text, ScrollView, StyleSheet, ActivityIndicator, TouchableOpacity, Alert, Linking, TextInput, Modal, Pressable, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { adminApi, useAdminAuth } from '../../../src/context/AdminAuthContext';
import { Fonts, Radius, Spacing } from '../../../src/lib/theme';
import type { ColorPalette } from '../../../src/lib/theme';
import { useColors } from '../../../src/hooks/useColors';
import { useThemedStyles } from '../../../src/hooks/useThemedStyles';
import { toast } from '../../../src/components/Toast';

type Profile = {
  user: any;
  household?: any;
  notes?: any[];
};

export default function AdminUserProfile() {
  const c = useColors();
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { admin } = useAdminAuth();
  const [p, setP] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [noteText, setNoteText] = useState('');
  const [showExtend, setShowExtend] = useState(false);
  const [extendDays, setExtendDays] = useState('14');

  const load = useCallback(async () => {
    try {
      const { data } = await adminApi.get<Profile>(`/admin/users/${id}/profile`);
      setP(data);
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || 'Could not load profile');
    } finally { setLoading(false); }
  }, [id]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  if (loading) {
    return <SafeAreaView style={styles.safe}><View style={styles.fill}><ActivityIndicator color={c.brandPrimary} /></View></SafeAreaView>;
  }
  if (!p?.user) {
    return <SafeAreaView style={styles.safe}><View style={styles.fill}><Text style={styles.empty}>User not found.</Text></View></SafeAreaView>;
  }

  const u = p.user;
  const canManage = admin?.admin_role === 'super_admin' || admin?.admin_role === 'operations_admin';
  const isSelf = u.id === admin?.id;

  const toggleSuspend = () => {
    const willSuspend = !u.suspended;
    Alert.alert(willSuspend ? 'Suspend user?' : 'Reinstate user?', willSuspend ? `${u.email} won't be able to sign in.` : `${u.email} regains access.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: willSuspend ? 'Suspend' : 'Reinstate', style: willSuspend ? 'destructive' : 'default', onPress: async () => {
        setBusy('suspend');
        try {
          await adminApi.post(`/admin/users/${u.id}/suspend`, { suspended: willSuspend });
          await load();
          toast.success(willSuspend ? 'User suspended' : 'User reinstated', 2500);
        } catch (e: any) {
          toast.error(e?.response?.data?.detail || 'Could not update');
        } finally { setBusy(null); }
      } },
    ]);
  };

  const extendTrial = async () => {
    const days = parseInt(extendDays, 10);
    if (!Number.isFinite(days) || days < 1 || days > 90) {
      Alert.alert('Invalid', 'Days must be between 1 and 90.');
      return;
    }
    setShowExtend(false);
    setBusy('extend');
    try {
      await adminApi.post(`/admin/users/${u.id}/extend-trial`, { days });
      await load();
      toast.success(`Trial extended by ${days} days`, 3000);
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || 'Could not extend');
    } finally { setBusy(null); }
  };

  const sendReset = () => {
    Alert.alert('Send password reset?', `${u.email} will receive a reset link.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Send', onPress: async () => {
        setBusy('reset');
        try {
          await adminApi.post(`/admin/users/${u.id}/reset-password`);
          toast.success('Reset link sent', 2500);
        } catch (e: any) {
          toast.error(e?.response?.data?.detail || 'Could not send');
        } finally { setBusy(null); }
      } },
    ]);
  };

  const saveNote = async () => {
    if (!noteText.trim()) return;
    setBusy('note');
    try {
      await adminApi.post(`/admin/users/${u.id}/notes`, { body: noteText.trim() });
      setNoteText('');
      await load();
      toast.success('Note added', 2000);
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || 'Could not save note');
    } finally { setBusy(null); }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.scroll} testID="admin-user-profile">
          <TouchableOpacity onPress={() => router.back()} style={styles.back} testID="profile-back">
            <Ionicons name="chevron-back" size={20} color={c.brandPrimary} />
            <Text style={styles.backText}>Back</Text>
          </TouchableOpacity>

          {/* Header */}
          <View style={styles.headerCard}>
            <View style={styles.headerTop}>
              <View style={{ flex: 1 }}>
                <Text style={styles.name}>{u.name || u.email.split('@')[0]}</Text>
                <Text style={styles.email}>{u.email}</Text>
              </View>
              {u.is_admin ? <View style={styles.adminPill}><Text style={styles.adminPillText}>ADMIN</Text></View> : null}
              {u.suspended ? <View style={styles.suspendedPill}><Text style={styles.suspendedPillText}>SUSPENDED</Text></View> : null}
            </View>
            <View style={styles.quickActions}>
              <TouchableOpacity onPress={() => Linking.openURL(`mailto:${u.email}`).catch(() => {})} style={styles.quickAction}>
                <Ionicons name="mail" size={14} color={c.brandPrimary} />
                <Text style={styles.quickActionText}>Email</Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Stat grid */}
          <View style={styles.statGrid}>
            <Stat label="Plan" value={(u.plan || 'free')} />
            <Stat label="Role" value={u.role || '—'} />
            <Stat label="Joined" value={u.created_at ? formatDate(u.created_at) : '—'} />
            <Stat label="Subscription" value={u.subscription_status || 'none'} />
            {u.trial_ends_at ? <Stat label="Trial ends" value={formatDate(u.trial_ends_at)} fullWidth /> : null}
          </View>

          {/* Actions */}
          {canManage && !isSelf ? (
            <>
              <Text style={styles.sectionLabel}>Actions</Text>
              <View style={styles.actionsCard}>
                <ActionRow icon="mail-outline" label="Send password reset" hint={u.email} loading={busy === 'reset'} onPress={sendReset} testID="action-reset" />
                <ActionRow icon="time-outline" label="Extend trial" hint={u.trial_ends_at ? `Current end: ${formatDate(u.trial_ends_at)}` : 'Not on trial'} loading={busy === 'extend'} onPress={() => setShowExtend(true)} testID="action-extend" />
                <ActionRow icon={u.suspended ? 'play-circle-outline' : 'pause-circle-outline'} label={u.suspended ? 'Reinstate user' : 'Suspend user'} hint={u.suspended ? 'They’ll regain access' : 'Locks sign-in for this account'} loading={busy === 'suspend'} onPress={toggleSuspend} tone={u.suspended ? undefined : 'warning'} last testID="action-suspend" />
              </View>
            </>
          ) : null}

          {/* Household */}
          {p.household ? (
            <>
              <Text style={styles.sectionLabel}>Household</Text>
              <View style={styles.card}>
                <KvRow k="Participant" v={p.household.participant_name || '—'} />
                <KvRow k="Classification" v={p.household.classification ? `Level ${p.household.classification}` : '—'} />
                <KvRow k="Provider" v={p.household.provider_name || '—'} last />
              </View>
            </>
          ) : null}

          {/* Notes */}
          <Text style={styles.sectionLabel}>Internal notes</Text>
          <View style={styles.card}>
            {(p.notes || []).length === 0 ? (
              <Text style={styles.emptyInline}>No internal notes yet.</Text>
            ) : (p.notes || []).map((n: any) => (
              <View key={n.id} style={styles.noteItem}>
                <Text style={styles.noteBody}>{n.body}</Text>
                <Text style={styles.noteMeta}>{n.admin_email} · {formatDateTime(n.created_at)}</Text>
              </View>
            ))}
          </View>
          <View style={styles.noteComposer}>
            <TextInput
              value={noteText} onChangeText={setNoteText}
              placeholder="Add an internal note (not visible to the user)…"
              placeholderTextColor={c.textMuted}
              style={styles.noteInput}
              multiline
              testID="note-input"
            />
            <TouchableOpacity style={[styles.noteSendBtn, (!noteText.trim() || busy === 'note') && { opacity: 0.5 }]} onPress={saveNote} disabled={!noteText.trim() || busy === 'note'} testID="note-send">
              {busy === 'note' ? <ActivityIndicator color={c.cream} size="small" /> : <Ionicons name="send" size={14} color={c.cream} />}
            </TouchableOpacity>
          </View>

          <View style={{ height: 40 }} />
        </ScrollView>
      </KeyboardAvoidingView>

      {/* Extend trial modal */}
      <Modal visible={showExtend} transparent animationType="fade" onRequestClose={() => setShowExtend(false)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setShowExtend(false)} />
        <View style={styles.modalCard}>
          <Text style={styles.modalTitle}>Extend trial</Text>
          <Text style={styles.modalBody}>How many days from today should the trial end?</Text>
          <View style={{ flexDirection: 'row', gap: 8, marginVertical: 8 }}>
            {['7', '14', '30'].map((d) => (
              <TouchableOpacity key={d} style={[styles.daysChip, extendDays === d && styles.daysChipActive]} onPress={() => setExtendDays(d)}>
                <Text style={[styles.daysChipText, extendDays === d && styles.daysChipTextActive]}>{d} days</Text>
              </TouchableOpacity>
            ))}
          </View>
          <TextInput value={extendDays} onChangeText={setExtendDays} keyboardType="number-pad" style={styles.modalInput} />
          <TouchableOpacity style={styles.modalBtn} onPress={extendTrial} testID="extend-confirm">
            <Text style={styles.modalBtnText}>Extend trial</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setShowExtend(false)} style={{ paddingVertical: 10, alignItems: 'center' }}>
            <Text style={styles.cancelLink}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function Stat({ label, value, fullWidth }: { label: string; value: string; fullWidth?: boolean }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={[styles.statCell, fullWidth && { flexBasis: '100%' }]}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue} numberOfLines={1}>{value}</Text>
    </View>
  );
}

function ActionRow({ icon, label, hint, onPress, loading, tone, last, testID }: { icon: any; label: string; hint?: string; onPress: () => void; loading?: boolean; tone?: 'warning' | 'danger'; last?: boolean; testID?: string }) {
  const c = useColors();
  const styles = useThemedStyles(makeStyles);
  const color = tone === 'danger' ? c.danger : tone === 'warning' ? c.severityAlert : c.brandPrimary;
  const iconBg = tone === 'danger' ? 'rgba(192, 57, 43, 0.12)' : tone === 'warning' ? 'rgba(183, 121, 31, 0.15)' : 'rgba(14, 77, 82, 0.08)';
  return (
    <TouchableOpacity style={[styles.actionRow, !last && styles.actionRowBorder]} onPress={onPress} disabled={loading} testID={testID}>
      <View style={[styles.actionIcon, { backgroundColor: iconBg }]}><Ionicons name={icon} size={16} color={color} /></View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.actionLabel, { color }]}>{label}</Text>
        {hint ? <Text style={styles.actionHint}>{hint}</Text> : null}
      </View>
      {loading ? <ActivityIndicator color={c.brandPrimary} size="small" /> : <Ionicons name="chevron-forward" size={14} color={c.textMuted} />}
    </TouchableOpacity>
  );
}

function KvRow({ k, v, last }: { k: string; v: string; last?: boolean }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={[styles.kvRow, !last && styles.kvRowBorder]}>
      <Text style={styles.kvKey}>{k}</Text>
      <Text style={styles.kvVal}>{v}</Text>
    </View>
  );
}

function makeStyles(c: ColorPalette) { return StyleSheet.create({
  safe: { flex: 1, backgroundColor: c.background },
  fill: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scroll: { padding: Spacing.lg, paddingBottom: Spacing.xl, gap: 4 },
  back: { flexDirection: 'row', alignItems: 'center', marginBottom: Spacing.md },
  backText: { fontFamily: Fonts.bodyMed, fontSize: 14, color: c.brandPrimary },
  headerCard: { backgroundColor: c.cardBg, borderRadius: Radius.lg, padding: Spacing.md, borderWidth: 1, borderColor: c.borderSubtle, marginBottom: Spacing.md, gap: Spacing.sm },
  headerTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  name: { fontFamily: Fonts.heading, fontSize: 22, color: c.brandPrimary, letterSpacing: -0.3 },
  email: { fontFamily: Fonts.body, fontSize: 13, color: c.textSecondary, marginTop: 2 },
  adminPill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 100, backgroundColor: c.brandSecondary },
  adminPillText: { fontFamily: Fonts.bodySemi, fontSize: 10, color: c.brandPrimary, letterSpacing: 0.5 },
  suspendedPill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 100, backgroundColor: c.danger },
  suspendedPillText: { fontFamily: Fonts.bodySemi, fontSize: 10, color: c.cream, letterSpacing: 0.5 },
  quickActions: { flexDirection: 'row', gap: 6 },
  quickAction: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 100, backgroundColor: 'rgba(14, 77, 82, 0.08)' },
  quickActionText: { fontFamily: Fonts.bodyMed, fontSize: 12, color: c.brandPrimary },
  statGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: Spacing.md },
  statCell: { flexBasis: '48%', flexGrow: 1, backgroundColor: c.cardBg, borderRadius: Radius.md, padding: 12, borderWidth: 1, borderColor: c.borderSubtle },
  statLabel: { fontFamily: Fonts.bodyMed, fontSize: 10, letterSpacing: 0.5, textTransform: 'uppercase', color: c.textMuted },
  statValue: { fontFamily: Fonts.bodySemi, fontSize: 15, color: c.brandPrimary, marginTop: 4, textTransform: 'capitalize' },
  sectionLabel: { fontFamily: Fonts.bodyMed, fontSize: 11, letterSpacing: 1.2, textTransform: 'uppercase', color: c.textMuted, marginTop: Spacing.md, marginBottom: 6 },
  actionsCard: { backgroundColor: c.cardBg, borderRadius: Radius.lg, borderWidth: 1, borderColor: c.borderSubtle, paddingHorizontal: Spacing.md },
  actionRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 },
  actionRowBorder: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.borderSubtle },
  actionIcon: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  actionLabel: { fontFamily: Fonts.bodySemi, fontSize: 14 },
  actionHint: { fontFamily: Fonts.body, fontSize: 11, color: c.textMuted, marginTop: 2 },
  card: { backgroundColor: c.cardBg, borderRadius: Radius.lg, padding: Spacing.sm, borderWidth: 1, borderColor: c.borderSubtle },
  kvRow: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: Spacing.sm, paddingVertical: 10 },
  kvRowBorder: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.borderSubtle },
  kvKey: { fontFamily: Fonts.bodyMed, fontSize: 12, color: c.textSecondary },
  kvVal: { fontFamily: Fonts.bodySemi, fontSize: 13, color: c.brandPrimary },
  noteItem: { padding: Spacing.sm, gap: 4, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.borderSubtle },
  noteBody: { fontFamily: Fonts.body, fontSize: 13, color: c.brandPrimary, lineHeight: 18 },
  noteMeta: { fontFamily: Fonts.body, fontSize: 11, color: c.textMuted },
  noteComposer: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, marginTop: Spacing.sm },
  noteInput: { flex: 1, backgroundColor: c.cardBg, borderRadius: Radius.md, borderWidth: 1, borderColor: c.border, padding: 12, fontFamily: Fonts.body, fontSize: 13, color: c.textPrimary, minHeight: 44, maxHeight: 120 },
  noteSendBtn: { width: 44, height: 44, borderRadius: Radius.md, backgroundColor: c.brandPrimary, alignItems: 'center', justifyContent: 'center' },
  empty: { fontFamily: Fonts.body, fontSize: 14, color: c.textMuted },
  emptyInline: { fontFamily: Fonts.body, fontSize: 13, color: c.textMuted, textAlign: 'center', padding: Spacing.md },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(14, 77, 82, 0.6)' },
  modalCard: { position: 'absolute', left: 24, right: 24, top: '28%', backgroundColor: c.cardBg, borderRadius: Radius.lg, padding: Spacing.lg, gap: 8 },
  modalTitle: { fontFamily: Fonts.heading, fontSize: 20, color: c.brandPrimary, textAlign: 'center', letterSpacing: -0.3 },
  modalBody: { fontFamily: Fonts.body, fontSize: 13, color: c.textSecondary, textAlign: 'center', lineHeight: 19 },
  daysChip: { flex: 1, paddingVertical: 10, borderRadius: Radius.md, borderWidth: 1, borderColor: c.border, backgroundColor: c.background, alignItems: 'center' },
  daysChipActive: { backgroundColor: c.brandPrimary, borderColor: c.brandPrimary },
  daysChipText: { fontFamily: Fonts.bodySemi, fontSize: 12, color: c.brandPrimary },
  daysChipTextActive: { color: c.cream },
  modalInput: { backgroundColor: c.background, borderRadius: Radius.md, borderWidth: 1, borderColor: c.border, padding: 12, fontFamily: Fonts.body, fontSize: 15, color: c.textPrimary, textAlign: 'center' },
  modalBtn: { marginTop: 8, backgroundColor: c.brandPrimary, borderRadius: Radius.md, paddingVertical: 14, alignItems: 'center' },
  modalBtnText: { fontFamily: Fonts.bodySemi, fontSize: 15, color: c.cream },
  cancelLink: { fontFamily: Fonts.bodyMed, fontSize: 13, color: c.brandPrimary },
}); }
