// Adviser portal — roster + summary + add-client invite.
import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Modal,
  Pressable,
  RefreshControl,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useFocusEffect } from 'expo-router';
import { api, extractErrorMessage } from '../../src/lib/api';
import { Colors, Fonts, Radius, Spacing } from '../../src/lib/theme';
import type { ColorPalette } from '../../src/lib/theme';
import { useColors } from '../../src/hooks/useColors';
import { useThemedStyles } from '../../src/hooks/useThemedStyles';
import { useAuth } from '../../src/context/AuthContext';
import { toast } from '../../src/components/Toast';
import BackHeader from '../../src/components/BackHeader';

type Summary = {
  plan: string;
  adviser_name: string;
  max_clients: number;
  clients_total: number;
  clients_active: number;
  clients_invited: number;
  seats_remaining: number;
};

type Client = {
  id: string;
  client_name: string;
  client_email: string;
  status: string;
  notes?: string;
  invited_at?: string | null;
  linked_at?: string | null;
  linked_household_id?: string | null;
};

function statusTone(s: string) {
  if (s === 'linked' || s === 'active') return { fg: Colors.success, bg: 'rgba(27, 87, 51, 0.1)', label: 'Linked' };
  if (s === 'invited') return { fg: Colors.brandSecondary, bg: 'rgba(183, 121, 31, 0.14)', label: 'Invited' };
  if (s === 'declined' || s === 'expired') return { fg: Colors.danger, bg: 'rgba(192, 57, 43, 0.1)', label: s };
  return { fg: Colors.textMuted, bg: Colors.background, label: s };
}

export default function AdviserHome() {
  const c = useColors();
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const { user } = useAuth();
  const [summary, setSummary] = useState<Summary | null>(null);
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [planErr, setPlanErr] = useState<null | { current_plan: string }>(null);
  // Add-client modal
  const [modalOpen, setModalOpen] = useState(false);
  const [nName, setNName] = useState('');
  const [nEmail, setNEmail] = useState('');
  const [nNotes, setNNotes] = useState('');
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    try {
      setPlanErr(null);
      const [s, c] = await Promise.all([
        api.get<Summary>('/adviser/summary'),
        api.get<Client[]>('/adviser/clients'),
      ]);
      setSummary(s.data);
      setClients(c.data || []);
    } catch (e: any) {
      const detail = e?.response?.data?.detail;
      if (detail && typeof detail === 'object' && detail.error === 'plan_required') {
        setPlanErr({ current_plan: detail.current_plan });
      } else {
        toast.error(extractErrorMessage(e, "Could not load adviser portal"));
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const submitNewClient = useCallback(async () => {
    const name = nName.trim();
    const email = nEmail.trim().toLowerCase();
    if (!name || !email || !email.includes('@')) {
      toast.warning('Enter a name and a valid email.');
      return;
    }
    setAdding(true);
    try {
      await api.post('/adviser/clients', { client_name: name, client_email: email, notes: nNotes.trim() });
      toast.success('Invite sent.');
      setNName(''); setNEmail(''); setNNotes('');
      setModalOpen(false);
      await load();
    } catch (e: any) {
      const detail = e?.response?.data?.detail;
      if (typeof detail === 'object' && detail?.error === 'client_cap_reached') {
        toast.error(`Roster full, ${detail.max} clients max on adviser plan.`);
      } else {
        toast.error(extractErrorMessage(e, "Could not add client"));
      }
    } finally {
      setAdding(false);
    }
  }, [nName, nEmail, nNotes, load]);

  const resendInvite = useCallback(async (cid: string) => {
    try {
      await api.post(`/adviser/clients/${cid}/resend-invite`);
      toast.success('Invite re-sent.');
      await load();
    } catch (e) {
      toast.error(extractErrorMessage(e, "Could not resend invite"));
    }
  }, [load]);

  const removeClient = useCallback((c: Client) => {
    const doDelete = async () => {
      try {
        await api.delete(`/adviser/clients/${c.id}`);
        toast.success('Removed.');
        setClients((cs) => cs.filter((x) => x.id !== c.id));
      } catch (e) {
        toast.error(extractErrorMessage(e, "Could not remove"));
      }
    };
    if (Platform.OS === 'web') {
      // eslint-disable-next-line no-alert
      if (typeof window !== 'undefined' && window.confirm(`Remove ${c.client_name} from your roster?`)) doDelete();
    } else {
      Alert.alert('Remove client?', `${c.client_name} will no longer appear in your roster.`, [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Remove', style: 'destructive', onPress: doDelete },
      ]);
    }
  }, []);

  if (planErr) {
    return (
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <BackHeader title="Adviser Portal" />
        <View style={styles.lockedWrap}>
          <View style={styles.lockedIcon}>
            <Ionicons name="briefcase-outline" size={32} color={c.brandPrimary} />
          </View>
          <Text style={styles.lockedH1}>Adviser plan required</Text>
          <Text style={styles.lockedBody}>
            The adviser portal is part of the Adviser plan. Your account is on “{planErr.current_plan}”. Upgrade to invite clients and review their statements securely.
          </Text>
          <TouchableOpacity style={styles.lockedCta} onPress={() => router.push('/settings/plan' as any)} testID="adviser-upgrade-cta">
            <Text style={styles.lockedCtaText}>See plans</Text>
            <Ionicons name="arrow-forward" size={14} color={c.cream} />
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <BackHeader title="Adviser Portal" />

      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={c.brandPrimary} />}
      >
        {/* Header */}
        <View style={styles.headerRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.overline}>Adviser</Text>
            <Text style={styles.h1}>{summary?.adviser_name || user?.name || 'Your roster'}</Text>
            <Text style={styles.sub}>{summary ? `${summary.seats_remaining} seat${summary.seats_remaining === 1 ? '' : 's'} remaining of ${summary.max_clients}` : 'Roster loading…'}</Text>
          </View>
          <TouchableOpacity onPress={() => setModalOpen(true)} disabled={!!summary && summary.seats_remaining <= 0} style={[styles.addBtn, (!summary || summary.seats_remaining <= 0) && { opacity: 0.5 }]} testID="adviser-add-client">
            <Ionicons name="add" size={18} color={c.cream} />
            <Text style={styles.addBtnText}>Add client</Text>
          </TouchableOpacity>
        </View>

        {/* Summary tiles */}
        {summary ? (
          <View style={styles.tileGrid}>
            <View style={styles.tile}><Text style={styles.tileValue}>{summary.clients_total}</Text><Text style={styles.tileLabel}>Total clients</Text></View>
            <View style={styles.tile}><Text style={[styles.tileValue, { color: c.success }]}>{summary.clients_active}</Text><Text style={styles.tileLabel}>Linked</Text></View>
            <View style={styles.tile}><Text style={[styles.tileValue, { color: c.brandSecondary }]}>{summary.clients_invited}</Text><Text style={styles.tileLabel}>Invited</Text></View>
            <View style={styles.tile}><Text style={styles.tileValue}>{summary.seats_remaining}</Text><Text style={styles.tileLabel}>Seats left</Text></View>
          </View>
        ) : null}

        {/* Roster */}
        <Text style={styles.sectionLabel}>Your clients</Text>
        {loading ? (
          <ActivityIndicator color={c.brandPrimary} style={{ paddingVertical: 40 }} />
        ) : clients.length === 0 ? (
          <View style={styles.emptyCard}>
            <Ionicons name="people-outline" size={28} color={c.textMuted} />
            <Text style={styles.emptyTitle}>No clients yet</Text>
            <Text style={styles.emptyBody}>Add your first client to send them a secure invite and start reviewing their statements together.</Text>
          </View>
        ) : (
          clients.map((c) => {
            const tone = statusTone(c.status);
            return (
              <View key={c.id} style={styles.clientCard}>
                <TouchableOpacity
                  style={styles.clientHead}
                  onPress={() => router.push(`/adviser/clients/${c.id}` as any)}
                  testID={`adviser-client-${c.id}`}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={styles.clientName}>{c.client_name}</Text>
                    <Text style={styles.clientEmail}>{c.client_email}</Text>
                    {c.notes ? <Text style={styles.clientNotes} numberOfLines={2}>{c.notes}</Text> : null}
                  </View>
                  <View style={[styles.statusPill, { backgroundColor: tone.bg }]}>
                    <Text style={[styles.statusPillText, { color: tone.fg }]}>{tone.label}</Text>
                  </View>
                </TouchableOpacity>
                <View style={styles.clientActions}>
                  {c.status === 'invited' ? (
                    <TouchableOpacity style={styles.miniBtn} onPress={() => resendInvite(c.id)} testID={`adviser-resend-${c.id}`}>
                      <Ionicons name="mail-outline" size={12} color={c.brandPrimary} />
                      <Text style={styles.miniBtnText}>Resend invite</Text>
                    </TouchableOpacity>
                  ) : null}
                  <TouchableOpacity style={styles.miniBtn} onPress={() => router.push(`/adviser/clients/${c.id}` as any)} testID={`adviser-view-${c.id}`}>
                    <Ionicons name="open-outline" size={12} color={c.brandPrimary} />
                    <Text style={styles.miniBtnText}>Open</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.miniBtn, styles.miniBtnGhost]} onPress={() => removeClient(c)} testID={`adviser-remove-${c.id}`}>
                    <Ionicons name="trash-outline" size={12} color={c.danger} />
                    <Text style={[styles.miniBtnText, { color: c.danger }]}>Remove</Text>
                  </TouchableOpacity>
                </View>
              </View>
            );
          })
        )}

        <Text style={styles.footnote}>Clients receive a branded invite email to sign up to Wayly with their household pre-linked to your roster.</Text>
        <View style={{ height: 40 }} />
      </ScrollView>

      {/* Add client modal */}
      <Modal visible={modalOpen} animationType="slide" transparent onRequestClose={() => setModalOpen(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.modalRoot}>
          <Pressable style={styles.modalBackdrop} onPress={() => setModalOpen(false)} />
          <View style={styles.modalCard}>
            <View style={styles.modalHandle} />
            <Text style={styles.modalTitle}>Invite a client</Text>
            <Text style={styles.modalSub}>We will send them a secure sign-up link. They’ll appear in your roster as “invited” until they accept.</Text>

            <Text style={styles.label}>Client name</Text>
            <TextInput value={nName} onChangeText={setNName} placeholder="Margaret Williams" placeholderTextColor={c.textMuted} style={styles.input} testID="adviser-new-name" />

            <Text style={styles.label}>Client email</Text>
            <TextInput value={nEmail} onChangeText={setNEmail} placeholder="margaret@example.com" placeholderTextColor={c.textMuted} keyboardType="email-address" autoCapitalize="none" autoCorrect={false} style={styles.input} testID="adviser-new-email" />

            <Text style={styles.label}>Notes (private to you)</Text>
            <TextInput value={nNotes} onChangeText={setNNotes} placeholder="e.g. Reviewing Q2 statements" placeholderTextColor={c.textMuted} multiline numberOfLines={3} style={[styles.input, { minHeight: 70, textAlignVertical: 'top' }]} testID="adviser-new-notes" />

            <TouchableOpacity onPress={submitNewClient} disabled={adding} style={[styles.modalCta, adding && { opacity: 0.6 }]} testID="adviser-new-submit">
              {adding ? <ActivityIndicator color={c.cream} /> : (
                <>
                  <Ionicons name="send-outline" size={14} color={c.cream} />
                  <Text style={styles.modalCtaText}>Send invite</Text>
                </>
              )}
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setModalOpen(false)} style={styles.modalCancel}>
              <Text style={styles.modalCancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

function makeStyles(c: ColorPalette) { return StyleSheet.create({
  safe: { flex: 1, backgroundColor: c.background },
  scroll: { padding: Spacing.lg, paddingTop: 4 },
  headerRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 12, marginBottom: Spacing.lg },
  overline: { fontFamily: Fonts.bodyMed, fontSize: 11, letterSpacing: 1.5, textTransform: 'uppercase', color: c.textMuted },
  h1: { fontFamily: Fonts.heading, fontSize: 28, color: c.brandPrimary, letterSpacing: -0.5, marginTop: 2 },
  sub: { fontFamily: Fonts.body, fontSize: 13, color: c.textSecondary, marginTop: 4 },
  addBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 10, paddingHorizontal: 14, borderRadius: 100, backgroundColor: c.brandPrimary, minHeight: 40 },
  addBtnText: { fontFamily: Fonts.bodySemi, fontSize: 13, color: c.cream },
  tileGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: Spacing.lg },
  tile: { flexBasis: '47%', flexGrow: 1, padding: 12, backgroundColor: c.cardBg, borderRadius: Radius.md, borderWidth: 1, borderColor: c.borderSubtle },
  tileValue: { fontFamily: Fonts.heading, fontSize: 22, color: c.brandPrimary },
  tileLabel: { fontFamily: Fonts.bodyMed, fontSize: 10, color: c.textMuted, marginTop: 4, textTransform: 'uppercase', letterSpacing: 0.5 },
  sectionLabel: { fontFamily: Fonts.bodyMed, fontSize: 11, letterSpacing: 1.2, textTransform: 'uppercase', color: c.textMuted, marginBottom: Spacing.sm },
  emptyCard: { padding: Spacing.lg, alignItems: 'center', backgroundColor: c.cardBg, borderRadius: Radius.md, borderWidth: 1, borderColor: c.borderSubtle, gap: 8 },
  emptyTitle: { fontFamily: Fonts.bodySemi, fontSize: 15, color: c.brandPrimary, marginTop: 4 },
  emptyBody: { fontFamily: Fonts.body, fontSize: 12, color: c.textSecondary, textAlign: 'center', lineHeight: 18 },
  clientCard: { backgroundColor: c.cardBg, borderRadius: Radius.md, borderWidth: 1, borderColor: c.borderSubtle, padding: Spacing.md, marginBottom: 8 },
  clientHead: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  clientName: { fontFamily: Fonts.bodySemi, fontSize: 15, color: c.brandPrimary },
  clientEmail: { fontFamily: Fonts.body, fontSize: 12, color: c.textSecondary, marginTop: 2 },
  clientNotes: { fontFamily: Fonts.body, fontSize: 11, color: c.textMuted, marginTop: 4, fontStyle: 'italic' },
  statusPill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 100 },
  statusPillText: { fontFamily: Fonts.bodySemi, fontSize: 10, letterSpacing: 0.4, textTransform: 'uppercase' },
  clientActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10 },
  miniBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 100, backgroundColor: 'rgba(14, 77, 82, 0.06)', minHeight: 28 },
  miniBtnGhost: { backgroundColor: 'rgba(192, 57, 43, 0.06)' },
  miniBtnText: { fontFamily: Fonts.bodySemi, fontSize: 11, color: c.brandPrimary },
  footnote: { fontFamily: Fonts.body, fontSize: 11, color: c.textMuted, marginTop: Spacing.lg, textAlign: 'center', lineHeight: 16 },
  // Locked state
  lockedWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: Spacing.lg },
  lockedIcon: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(14, 77, 82, 0.06)', marginBottom: Spacing.md },
  lockedH1: { fontFamily: Fonts.heading, fontSize: 24, color: c.brandPrimary, marginBottom: 8 },
  lockedBody: { fontFamily: Fonts.body, fontSize: 14, color: c.textSecondary, textAlign: 'center', lineHeight: 21, marginBottom: Spacing.lg },
  lockedCta: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 12, paddingHorizontal: Spacing.lg, borderRadius: 100, backgroundColor: c.brandPrimary, minHeight: 44 },
  lockedCtaText: { fontFamily: Fonts.bodySemi, fontSize: 14, color: c.cream },
  // Modal
  modalRoot: { flex: 1, justifyContent: 'flex-end' },
  modalBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.45)' },
  modalCard: { backgroundColor: c.cardBg, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: Spacing.lg, paddingBottom: 36 },
  modalHandle: { width: 36, height: 4, borderRadius: 2, backgroundColor: c.border, alignSelf: 'center', marginBottom: Spacing.md },
  modalTitle: { fontFamily: Fonts.heading, fontSize: 22, color: c.brandPrimary, letterSpacing: -0.3 },
  modalSub: { fontFamily: Fonts.body, fontSize: 13, color: c.textSecondary, marginTop: 4, marginBottom: Spacing.md, lineHeight: 19 },
  label: { fontFamily: Fonts.bodyMed, fontSize: 12, color: c.brandPrimary, marginTop: 10, marginBottom: 4 },
  input: { fontFamily: Fonts.body, fontSize: 14, color: c.brandPrimary, backgroundColor: c.background, borderRadius: Radius.md, paddingHorizontal: Spacing.md, paddingVertical: 12, borderWidth: 1, borderColor: c.borderSubtle },
  modalCta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: Spacing.lg, backgroundColor: c.brandPrimary, borderRadius: Radius.md, paddingVertical: 14, minHeight: 50 },
  modalCtaText: { fontFamily: Fonts.bodySemi, fontSize: 14, color: c.cream },
  modalCancel: { marginTop: 8, alignItems: 'center', paddingVertical: 10 },
  modalCancelText: { fontFamily: Fonts.bodyMed, fontSize: 13, color: c.textMuted },
}); }
