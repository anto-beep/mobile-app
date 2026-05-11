// Admin user detail — header, stat grid, admin actions, household, statements, payments, audit trail
import React, { useCallback, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, ActivityIndicator, TouchableOpacity, Alert, Modal, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { api, extractErrorMessage } from '../../../../src/lib/api';
import { useAuth } from '../../../../src/context/AuthContext';
import { Colors, Fonts, Radius, Spacing, formatAUD } from '../../../../src/lib/theme';
import { toast } from '../../../../src/components/Toast';

type Detail = {
  user: any;
  household?: any;
  statements?: any[];
  payments?: any[];
  audit_trail?: any[];
};

const PLAN_OPTIONS = ['free', 'solo', 'family'];

export default function AdminUserDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { user: me } = useAuth();
  const [d, setD] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [showDelete, setShowDelete] = useState(false);

  const load = useCallback(async () => {
    try {
      const { data } = await api.get<Detail>(`/admin/users/${id}`);
      setD(data);
    } catch (e) {
      toast.error(extractErrorMessage(e));
    } finally { setLoading(false); }
  }, [id]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  if (loading) {
    return <SafeAreaView style={styles.safe}><View style={styles.fill}><ActivityIndicator color={Colors.brandPrimary} /></View></SafeAreaView>;
  }
  if (!d?.user) {
    return <SafeAreaView style={styles.safe}><View style={styles.fill}><Text style={styles.empty}>User not found.</Text></View></SafeAreaView>;
  }

  const u = d.user;
  const isSelf = me?.id === u.id;

  const sendReset = async () => {
    setBusy('reset');
    try {
      await api.post(`/admin/users/${id}/reset-password`);
      toast.success(`Password reset email sent to ${u.email}`, 4000);
    } catch (e) {
      toast.error(extractErrorMessage(e));
    } finally { setBusy(null); }
  };

  const toggleAdmin = async () => {
    if (isSelf && u.is_admin) {
      Alert.alert("Can't demote yourself", 'You cannot remove your own admin access.');
      return;
    }
    setBusy('admin');
    try {
      await api.put(`/admin/users/${id}/admin`, { is_admin: !u.is_admin });
      await load();
      toast.success(u.is_admin ? 'Admin removed' : 'Admin granted', 3000);
    } catch (e) {
      toast.error(extractErrorMessage(e));
    } finally { setBusy(null); }
  };

  const setPlan = async (plan: string) => {
    if (plan === (u.plan || '').toLowerCase()) return;
    setBusy(`plan-${plan}`);
    try {
      await api.put(`/admin/users/${id}/plan`, { plan });
      await load();
      toast.success(`Plan changed to ${plan}`, 3000);
    } catch (e) {
      toast.error(extractErrorMessage(e));
    } finally { setBusy(null); }
  };

  const cancelSub = async () => {
    Alert.alert('Cancel subscription?', `${u.email} will keep access until the period ends.`, [
      { text: 'Keep', style: 'cancel' },
      { text: 'Cancel sub', style: 'destructive', onPress: async () => {
        setBusy('cancel');
        try {
          await api.post(`/admin/users/${id}/cancel-subscription`);
          await load();
          toast.success('Subscription cancelled', 3000);
        } catch (e) {
          toast.error(extractErrorMessage(e));
        } finally { setBusy(null); }
      } },
    ]);
  };

  const doDelete = async () => {
    setShowDelete(false);
    setBusy('delete');
    try {
      await api.delete(`/admin/users/${id}`);
      toast.success('User deleted', 3000);
      router.back();
    } catch (e) {
      toast.error(extractErrorMessage(e));
    } finally { setBusy(null); }
  };

  const currentPlan = (u.plan || 'free').toLowerCase();
  const subActive = ['active', 'trialing'].includes((u.subscription_status || '').toLowerCase());

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView contentContainerStyle={styles.scroll} testID="admin-user-detail">
        <TouchableOpacity onPress={() => router.back()} style={styles.back}>
          <Ionicons name="chevron-back" size={20} color={Colors.brandPrimary} /><Text style={styles.backText}>Users</Text>
        </TouchableOpacity>

        {/* Header */}
        <View style={styles.headerCard}>
          <View style={styles.headerTopRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.name}>{u.name || u.email.split('@')[0]}</Text>
              <Text style={styles.email}>{u.email}</Text>
            </View>
            {u.is_admin ? <View style={styles.adminPill}><Text style={styles.adminPillText}>ADMIN</Text></View> : null}
          </View>
        </View>

        {/* Stat grid */}
        <View style={styles.statGrid}>
          <Stat label="Plan" value={currentPlan} />
          <Stat label="Role" value={u.role || '—'} />
          <Stat label="Joined" value={u.created_at ? new Date(u.created_at).toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'} />
          <Stat label="Subscription" value={u.subscription_status || 'none'} />
          {u.trial_ends_at ? <Stat label="Trial ends" value={new Date(u.trial_ends_at).toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric' })} fullWidth /> : null}
        </View>

        {/* Admin actions */}
        <Text style={styles.sectionLabel}>Admin actions</Text>
        <View style={styles.actionsCard}>
          <ActionRow icon="mail-outline" label="Send password reset" hint={u.email} loading={busy === 'reset'} onPress={sendReset} testID="action-reset-pw" />
          <ActionRow icon="shield-checkmark-outline" label={u.is_admin ? 'Remove admin' : 'Make admin'} hint="Toggles is_admin flag" loading={busy === 'admin'} onPress={toggleAdmin} disabled={isSelf && u.is_admin} testID="action-toggle-admin" />

          <View style={styles.planRow}>
            <Text style={styles.planRowLabel}>Set plan</Text>
            <View style={styles.planSeg}>
              {PLAN_OPTIONS.map((p) => {
                const active = currentPlan === p;
                const isBusy = busy === `plan-${p}`;
                return (
                  <TouchableOpacity
                    key={p}
                    style={[styles.planSegBtn, active && styles.planSegBtnActive]}
                    onPress={() => setPlan(p)}
                    disabled={!!busy}
                    testID={`action-plan-${p}`}
                  >
                    {isBusy ? <ActivityIndicator size="small" color={active ? Colors.cream : Colors.brandPrimary} /> : (
                      <Text style={[styles.planSegText, active && styles.planSegTextActive]}>{p}</Text>
                    )}
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>

          {subActive ? (
            <ActionRow icon="close-circle-outline" label="Cancel subscription" hint={u.subscription_status} loading={busy === 'cancel'} onPress={cancelSub} tone="warning" testID="action-cancel-sub" />
          ) : null}
          <ActionRow icon="trash-outline" label={isSelf ? "Can't delete yourself" : 'Delete user'} hint={isSelf ? 'Disabled for own account' : 'Permanent. Cannot be undone.'} loading={busy === 'delete'} onPress={() => setShowDelete(true)} tone="danger" disabled={isSelf} last testID="action-delete" />
        </View>

        {/* Household */}
        {d.household ? (
          <>
            <Text style={styles.sectionLabel}>Household</Text>
            <View style={styles.card}>
              <KvRow k="Participant" v={d.household.participant_name || '—'} />
              <KvRow k="Classification" v={d.household.classification ? `Level ${d.household.classification}` : '—'} />
              <KvRow k="Provider" v={d.household.provider_name || '—'} last />
            </View>
          </>
        ) : null}

        {/* Statements */}
        <Text style={styles.sectionLabel}>Recent statements</Text>
        <View style={styles.card}>
          {(d.statements || []).length === 0 ? (
            <Text style={styles.emptyInline}>No statements yet.</Text>
          ) : (d.statements || []).slice(0, 10).map((s: any) => (
            <View key={s.id} style={styles.listItem}>
              <View style={{ flex: 1 }}>
                <Text style={styles.itemTitle}>{s.period_label || s.period || 'Statement'}</Text>
                <Text style={styles.itemMeta}>{s.uploaded_at ? new Date(s.uploaded_at).toLocaleDateString('en-AU') : ''} · {s.anomalies_count ?? 0} anomalies</Text>
              </View>
              {s.gross_amount != null ? <Text style={styles.itemValue}>{formatAUD(s.gross_amount)}</Text> : null}
            </View>
          ))}
        </View>

        {/* Payments */}
        <Text style={styles.sectionLabel}>Payments</Text>
        <View style={styles.card}>
          {(d.payments || []).length === 0 ? (
            <Text style={styles.emptyInline}>No payments yet.</Text>
          ) : (d.payments || []).map((p: any) => (
            <View key={p.id || p.session_id} style={styles.listItem}>
              <View style={{ flex: 1 }}>
                <Text style={styles.itemTitle}>{(p.plan || 'plan').toUpperCase()} · {formatAUD(p.amount || 0)}</Text>
                <Text style={styles.itemMeta}>{p.created_at ? new Date(p.created_at).toLocaleString('en-AU') : ''}</Text>
              </View>
              <StatusPill status={p.status || p.payment_status || 'paid'} />
            </View>
          ))}
        </View>

        {/* Audit trail */}
        <Text style={styles.sectionLabel}>Audit trail</Text>
        <View style={styles.card}>
          {(d.audit_trail || []).length === 0 ? (
            <Text style={styles.emptyInline}>No audit entries.</Text>
          ) : (d.audit_trail || []).slice(0, 30).map((e: any, i: number) => (
            <View key={e.id || i} style={styles.auditRow}>
              <View style={styles.auditDot} />
              <View style={{ flex: 1 }}>
                <Text style={styles.auditKind}>{e.event_type || e.kind || 'event'}</Text>
                <Text style={styles.auditMeta}>{e.created_at ? new Date(e.created_at).toLocaleString('en-AU') : ''}</Text>
                {e.detail ? <Text style={styles.auditDetail}>{typeof e.detail === 'string' ? e.detail : JSON.stringify(e.detail)}</Text> : null}
              </View>
            </View>
          ))}
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>

      {/* Delete confirm modal */}
      <Modal visible={showDelete} transparent animationType="fade" onRequestClose={() => setShowDelete(false)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setShowDelete(false)} />
        <View style={styles.modalCard}>
          <View style={[styles.actionIconWrap, { backgroundColor: 'rgba(160, 85, 69, 0.15)', alignSelf: 'center' }]}>
            <Ionicons name="warning" size={22} color={Colors.danger} />
          </View>
          <Text style={styles.modalTitle}>Delete user?</Text>
          <Text style={styles.modalBody}>This permanently removes {u.email}, their household membership, and audit trail. This cannot be undone.</Text>
          <TouchableOpacity style={styles.dangerBtn} onPress={doDelete} testID="delete-confirm">
            <Text style={styles.dangerBtnText}>Delete permanently</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setShowDelete(false)} style={{ paddingVertical: 10, alignItems: 'center' }}>
            <Text style={styles.cancelLink}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function Stat({ label, value, fullWidth }: { label: string; value: string; fullWidth?: boolean }) {
  return (
    <View style={[styles.statCell, fullWidth && { flexBasis: '100%' }]}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue} numberOfLines={1}>{value}</Text>
    </View>
  );
}

function ActionRow({ icon, label, hint, onPress, loading, disabled, tone, last, testID }: { icon: any; label: string; hint?: string; onPress: () => void; loading?: boolean; disabled?: boolean; tone?: 'warning' | 'danger'; last?: boolean; testID?: string }) {
  const labelColor = tone === 'danger' ? Colors.danger : tone === 'warning' ? Colors.severityAlert : Colors.brandPrimary;
  const iconBg = tone === 'danger' ? 'rgba(160, 85, 69, 0.12)' : tone === 'warning' ? 'rgba(212, 162, 78, 0.15)' : 'rgba(31, 58, 95, 0.08)';
  return (
    <TouchableOpacity
      style={[styles.actionRow, !last && styles.actionRowBorder, disabled && { opacity: 0.4 }]}
      onPress={onPress}
      disabled={disabled || loading}
      testID={testID}
    >
      <View style={[styles.actionIconWrap, { backgroundColor: iconBg }]}>
        <Ionicons name={icon} size={16} color={labelColor} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.actionLabel, { color: labelColor }]}>{label}</Text>
        {hint ? <Text style={styles.actionHint}>{hint}</Text> : null}
      </View>
      {loading ? <ActivityIndicator size="small" color={Colors.brandPrimary} /> : <Ionicons name="chevron-forward" size={14} color={Colors.textMuted} />}
    </TouchableOpacity>
  );
}

function KvRow({ k, v, last }: { k: string; v: string; last?: boolean }) {
  return (
    <View style={[styles.kvRow, !last && styles.kvRowBorder]}>
      <Text style={styles.kvKey}>{k}</Text>
      <Text style={styles.kvVal}>{v}</Text>
    </View>
  );
}

function StatusPill({ status }: { status: string }) {
  const s = (status || '').toLowerCase();
  const tone = s === 'paid' || s === 'complete' ? { bg: 'rgba(58, 90, 64, 0.12)', fg: '#3A5A40' }
    : s === 'failed' || s === 'expired' ? { bg: 'rgba(160, 85, 69, 0.12)', fg: Colors.danger }
    : { bg: 'rgba(212, 162, 78, 0.15)', fg: Colors.brandSecondary };
  return <View style={[styles.statusPill, { backgroundColor: tone.bg }]}><Text style={[styles.statusPillText, { color: tone.fg }]}>{s}</Text></View>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  fill: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scroll: { padding: Spacing.lg, paddingBottom: Spacing.xl },
  back: { flexDirection: 'row', alignItems: 'center', marginBottom: Spacing.md },
  backText: { fontFamily: Fonts.bodyMed, fontSize: 14, color: Colors.brandPrimary },
  headerCard: { backgroundColor: Colors.cardBg, borderRadius: Radius.lg, padding: Spacing.md, borderWidth: 1, borderColor: Colors.borderSubtle, marginBottom: Spacing.md },
  headerTopRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  name: { fontFamily: Fonts.heading, fontSize: 22, color: Colors.brandPrimary, letterSpacing: -0.3 },
  email: { fontFamily: Fonts.body, fontSize: 13, color: Colors.textSecondary, marginTop: 2 },
  adminPill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 100, backgroundColor: Colors.brandSecondary },
  adminPillText: { fontFamily: Fonts.bodySemi, fontSize: 10, color: Colors.brandPrimary, letterSpacing: 0.5 },
  statGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: Spacing.md },
  statCell: { flexBasis: '48%', flexGrow: 1, backgroundColor: Colors.cardBg, borderRadius: Radius.md, padding: 12, borderWidth: 1, borderColor: Colors.borderSubtle },
  statLabel: { fontFamily: Fonts.bodyMed, fontSize: 10, letterSpacing: 0.5, textTransform: 'uppercase', color: Colors.textMuted },
  statValue: { fontFamily: Fonts.bodySemi, fontSize: 15, color: Colors.brandPrimary, marginTop: 4, textTransform: 'capitalize' },
  sectionLabel: { fontFamily: Fonts.bodyMed, fontSize: 11, letterSpacing: 1.2, textTransform: 'uppercase', color: Colors.textMuted, marginTop: Spacing.md, marginBottom: 8 },
  actionsCard: { backgroundColor: Colors.cardBg, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.borderSubtle, paddingHorizontal: Spacing.md },
  actionRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 },
  actionRowBorder: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: Colors.borderSubtle },
  actionIconWrap: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  actionLabel: { fontFamily: Fonts.bodySemi, fontSize: 14 },
  actionHint: { fontFamily: Fonts.body, fontSize: 11, color: Colors.textMuted, marginTop: 2 },
  planRow: { paddingVertical: 12, gap: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: Colors.borderSubtle },
  planRowLabel: { fontFamily: Fonts.bodyMed, fontSize: 13, color: Colors.textSecondary },
  planSeg: { flexDirection: 'row', backgroundColor: Colors.background, borderRadius: Radius.md, padding: 4, gap: 4 },
  planSegBtn: { flex: 1, paddingVertical: 10, borderRadius: Radius.sm, alignItems: 'center', minHeight: 38 },
  planSegBtnActive: { backgroundColor: Colors.brandPrimary },
  planSegText: { fontFamily: Fonts.bodySemi, fontSize: 12, color: Colors.brandPrimary, textTransform: 'capitalize' },
  planSegTextActive: { color: Colors.cream },
  card: { backgroundColor: Colors.cardBg, borderRadius: Radius.lg, padding: Spacing.sm, borderWidth: 1, borderColor: Colors.borderSubtle },
  kvRow: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: Spacing.sm, paddingVertical: 10 },
  kvRowBorder: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: Colors.borderSubtle },
  kvKey: { fontFamily: Fonts.bodyMed, fontSize: 12, color: Colors.textSecondary },
  kvVal: { fontFamily: Fonts.bodySemi, fontSize: 13, color: Colors.brandPrimary },
  listItem: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: Spacing.sm, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: Colors.borderSubtle },
  itemTitle: { fontFamily: Fonts.bodySemi, fontSize: 13, color: Colors.brandPrimary },
  itemMeta: { fontFamily: Fonts.body, fontSize: 11, color: Colors.textMuted, marginTop: 2 },
  itemValue: { fontFamily: Fonts.bodySemi, fontSize: 13, color: Colors.brandPrimary },
  statusPill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 100 },
  statusPillText: { fontFamily: Fonts.bodySemi, fontSize: 10, letterSpacing: 0.3, textTransform: 'uppercase' },
  auditRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: Colors.borderSubtle, paddingHorizontal: Spacing.sm },
  auditDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: Colors.brandSecondary, marginTop: 6 },
  auditKind: { fontFamily: Fonts.bodySemi, fontSize: 13, color: Colors.brandPrimary, textTransform: 'capitalize' },
  auditMeta: { fontFamily: Fonts.body, fontSize: 11, color: Colors.textMuted, marginTop: 1 },
  auditDetail: { fontFamily: Fonts.body, fontSize: 11, color: Colors.textSecondary, marginTop: 2, fontStyle: 'italic' },
  empty: { fontFamily: Fonts.body, fontSize: 14, color: Colors.textMuted },
  emptyInline: { fontFamily: Fonts.body, fontSize: 13, color: Colors.textMuted, textAlign: 'center', padding: Spacing.md },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(31, 58, 95, 0.6)' },
  modalCard: { position: 'absolute', left: 24, right: 24, top: '30%', backgroundColor: Colors.cardBg, borderRadius: Radius.lg, padding: Spacing.lg, gap: Spacing.sm },
  modalTitle: { fontFamily: Fonts.heading, fontSize: 20, color: Colors.brandPrimary, textAlign: 'center', letterSpacing: -0.3 },
  modalBody: { fontFamily: Fonts.body, fontSize: 13, color: Colors.textSecondary, textAlign: 'center', lineHeight: 19 },
  dangerBtn: { marginTop: Spacing.sm, backgroundColor: Colors.danger, borderRadius: Radius.md, paddingVertical: 14, alignItems: 'center' },
  dangerBtnText: { fontFamily: Fonts.bodySemi, fontSize: 15, color: Colors.cream },
  cancelLink: { fontFamily: Fonts.bodyMed, fontSize: 13, color: Colors.brandPrimary },
});
