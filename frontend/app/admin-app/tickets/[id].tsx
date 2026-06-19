// Ticket detail — thread, reply (with macro picker + internal note toggle), change status/priority/assign
import React, { useCallback, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, TextInput, TouchableOpacity, ActivityIndicator, KeyboardAvoidingView, Platform, Modal, Pressable, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { adminApi, useAdminAuth } from '../../../src/context/AdminAuthContext';
import { Fonts, Radius, Spacing } from '../../../src/lib/theme';
import type { ColorPalette } from '../../../src/lib/theme';
import { useColors } from '../../../src/hooks/useColors';
import { useThemedStyles } from '../../../src/hooks/useThemedStyles';
import { toast } from '../../../src/components/Toast';

type Msg = { id: string; from: 'user' | 'admin'; body: string; created_at: string; internal?: boolean; admin_email?: string };
type Ticket = {
  id: string; subject: string; status: string; priority: string;
  user_email?: string; user_name?: string; user_id?: string;
  assigned_admin_id?: string | null; created_at: string; updated_at: string;
  messages: Msg[];
};
type Macro = { id: string; title: string; body: string };

const STATUSES = ['open', 'in_progress', 'waiting_on_user', 'resolved'];
const PRIORITIES = ['P1', 'P2', 'P3'];

export default function TicketDetail() {
  const c = useColors();
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { admin } = useAdminAuth();
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [loading, setLoading] = useState(true);
  const [reply, setReply] = useState('');
  const [internal, setInternal] = useState(false);
  const [sending, setSending] = useState(false);
  const [showMacros, setShowMacros] = useState(false);
  const [macros, setMacros] = useState<Macro[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const { data } = await adminApi.get<Ticket>(`/admin/tickets/${id}`);
      setTicket(data);
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || 'Could not load ticket');
    } finally { setLoading(false); }
  }, [id]);

  const loadMacros = useCallback(async () => {
    try {
      const { data } = await adminApi.get<Macro[]>('/admin/macros');
      setMacros(data || []);
    } catch {}
  }, []);

  useFocusEffect(useCallback(() => { load(); loadMacros(); }, [load, loadMacros]));

  if (loading) {
    return <SafeAreaView style={styles.safe}><View style={styles.fill}><ActivityIndicator color={c.brandPrimary} /></View></SafeAreaView>;
  }
  if (!ticket) {
    return <SafeAreaView style={styles.safe}><View style={styles.fill}><Text style={styles.empty}>Ticket not found.</Text></View></SafeAreaView>;
  }

  const onSend = async () => {
    if (!reply.trim()) return;
    setSending(true);
    try {
      const { data } = await adminApi.post<Msg>(`/admin/tickets/${ticket.id}/messages`, { body: reply.trim(), internal });
      setTicket((t) => t ? { ...t, messages: [...t.messages, data] } : t);
      setReply('');
      setInternal(false);
      toast.success(internal ? 'Internal note added' : 'Reply sent', 2500);
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || 'Could not send');
    } finally { setSending(false); }
  };

  const updateField = async (field: 'status' | 'priority' | 'assigned_admin_id', value: any) => {
    setBusy(field + value);
    try {
      const { data } = await adminApi.put<Ticket>(`/admin/tickets/${ticket.id}`, { [field]: value });
      setTicket(data);
      toast.success('Ticket updated', 2000);
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || 'Could not update');
    } finally { setBusy(null); }
  };

  const callOrText = () => {
    if (!ticket.user_email) return;
    Alert.alert(ticket.user_name || ticket.user_email, undefined, [
      { text: 'Email', onPress: () => { import('react-native').then(({ Linking }) => Linking.openURL(`mailto:${ticket.user_email}`)); } },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={20}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} hitSlop={12} testID="ticket-back">
            <Ionicons name="chevron-back" size={20} color={c.brandPrimary} />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={styles.subjectMeta}>Ticket · {ticket.priority}</Text>
            <Text style={styles.subject} numberOfLines={2}>{ticket.subject}</Text>
          </View>
          <TouchableOpacity onPress={callOrText} hitSlop={12} testID="ticket-contact">
            <Ionicons name="mail-outline" size={20} color={c.brandPrimary} />
          </TouchableOpacity>
        </View>

        {/* Status/Priority chips */}
        <View style={styles.chipsRow}>
          <Text style={styles.chipsLabel}>Status</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
            {STATUSES.map((s) => {
              const active = ticket.status === s;
              return (
                <TouchableOpacity key={s} style={[styles.chip, active && styles.chipActive]} onPress={() => updateField('status', s)} disabled={!!busy} testID={`status-${s}`}>
                  {busy === `status${s}` ? <ActivityIndicator size="small" color={active ? c.cream : c.brandPrimary} /> : (
                    <Text style={[styles.chipText, active && styles.chipTextActive]}>{s.replace('_', ' ')}</Text>
                  )}
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>
        <View style={styles.chipsRow}>
          <Text style={styles.chipsLabel}>Priority</Text>
          <View style={{ flexDirection: 'row', gap: 6 }}>
            {PRIORITIES.map((p) => {
              const active = ticket.priority === p;
              return (
                <TouchableOpacity key={p} style={[styles.chip, active && (p === 'P1' ? styles.chipDanger : styles.chipActive)]} onPress={() => updateField('priority', p)} disabled={!!busy} testID={`priority-${p}`}>
                  {busy === `priority${p}` ? <ActivityIndicator size="small" color={active ? c.cream : c.brandPrimary} /> : (
                    <Text style={[styles.chipText, active && styles.chipTextActive]}>{p}</Text>
                  )}
                </TouchableOpacity>
              );
            })}
          </View>
          <View style={{ flex: 1 }} />
          {ticket.assigned_admin_id !== admin?.id ? (
            <TouchableOpacity onPress={() => updateField('assigned_admin_id', admin?.id)} style={styles.assignBtn} disabled={!!busy} testID="assign-me">
              {busy?.startsWith('assigned') ? <ActivityIndicator size="small" color={c.brandPrimary} /> : (
                <><Ionicons name="person-add-outline" size={12} color={c.brandPrimary} /><Text style={styles.assignText}>Assign to me</Text></>
              )}
            </TouchableOpacity>
          ) : (
            <View style={styles.assignBtn}><Ionicons name="person" size={12} color={c.brandSecondary} /><Text style={[styles.assignText, { color: c.brandSecondary }]}>Assigned to you</Text></View>
          )}
        </View>

        {/* User info */}
        <View style={styles.userCard}>
          <View style={styles.userIcon}><Ionicons name="person-outline" size={16} color={c.brandPrimary} /></View>
          <View style={{ flex: 1 }}>
            <Text style={styles.userName}>{ticket.user_name || ticket.user_email}</Text>
            {ticket.user_name ? <Text style={styles.userEmail}>{ticket.user_email}</Text> : null}
          </View>
        </View>

        {/* Messages */}
        <ScrollView contentContainerStyle={styles.thread} testID="ticket-thread">
          {ticket.messages.map((m) => (
            <View key={m.id} style={[styles.bubble, m.from === 'admin' ? styles.bubbleMe : styles.bubbleThem, m.internal ? styles.bubbleInternal : null]}>
              {m.internal ? <Text style={styles.internalLabel}>INTERNAL NOTE</Text> : null}
              <Text style={[styles.bubbleText, m.from === 'admin' && !m.internal && { color: c.cream }]}>{m.body}</Text>
              <Text style={[styles.bubbleMeta, m.from === 'admin' && !m.internal && { color: 'rgba(250, 247, 242, 0.65)' }]}>
                {m.from === 'admin' ? (m.admin_email || 'admin') : (ticket.user_name || 'user')} · {new Date(m.created_at).toLocaleString('en-AU')}
              </Text>
            </View>
          ))}
        </ScrollView>

        {/* Reply composer */}
        <View style={styles.composer}>
          {internal ? <Text style={styles.internalBadge}>Writing an internal note (user can’t see this)</Text> : null}
          <View style={styles.composerRow}>
            <TextInput
              value={reply}
              onChangeText={setReply}
              placeholder={internal ? 'Internal note…' : 'Reply to the customer…'}
              placeholderTextColor={c.textMuted}
              style={styles.composerInput}
              multiline
              testID="reply-input"
            />
          </View>
          <View style={styles.composerActions}>
            <TouchableOpacity onPress={() => setShowMacros(true)} style={styles.actionBtn} testID="open-macros">
              <Ionicons name="bookmark-outline" size={14} color={c.brandPrimary} />
              <Text style={styles.actionText}>Macros</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setInternal((i) => !i)} style={[styles.actionBtn, internal && styles.actionBtnActive]} testID="toggle-internal">
              <Ionicons name={internal ? 'eye-off-outline' : 'eye-outline'} size={14} color={internal ? c.brandSecondary : c.brandPrimary} />
              <Text style={[styles.actionText, internal && { color: c.brandSecondary }]}>{internal ? 'Internal' : 'Public'}</Text>
            </TouchableOpacity>
            <View style={{ flex: 1 }} />
            <TouchableOpacity style={[styles.sendBtn, (!reply.trim() || sending) && { opacity: 0.5 }]} onPress={onSend} disabled={!reply.trim() || sending} testID="send-reply">
              {sending ? <ActivityIndicator color={c.cream} size="small" /> : <><Ionicons name="send" size={14} color={c.cream} /><Text style={styles.sendText}>Send</Text></>}
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>

      {/* Macros picker */}
      <Modal visible={showMacros} animationType="slide" transparent onRequestClose={() => setShowMacros(false)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setShowMacros(false)} />
        <SafeAreaView edges={['bottom']} style={styles.macrosSheet}>
          <View style={styles.macrosHandle} />
          <Text style={styles.macrosTitle}>Insert a macro</Text>
          <ScrollView contentContainerStyle={{ gap: 8, paddingBottom: 20 }}>
            {macros.map((m) => (
              <TouchableOpacity key={m.id} style={styles.macroRow} onPress={() => { setReply((r) => r ? `${r}\n${m.body}` : m.body); setShowMacros(false); }} testID={`macro-${m.id}`}>
                <Text style={styles.macroTitle}>{m.title}</Text>
                <Text style={styles.macroBody} numberOfLines={3}>{m.body}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

function makeStyles(c: ColorPalette) { return StyleSheet.create({
  safe: { flex: 1, backgroundColor: c.background },
  fill: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  empty: { fontFamily: Fonts.body, fontSize: 14, color: c.textMuted },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: Spacing.md, borderBottomWidth: 1, borderBottomColor: c.borderSubtle },
  subjectMeta: { fontFamily: Fonts.bodyMed, fontSize: 11, letterSpacing: 0.5, textTransform: 'uppercase', color: c.textMuted },
  subject: { fontFamily: Fonts.heading, fontSize: 18, color: c.brandPrimary, marginTop: 2, letterSpacing: -0.3 },
  chipsRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: Spacing.md, paddingVertical: 6 },
  chipsLabel: { fontFamily: Fonts.bodyMed, fontSize: 11, letterSpacing: 0.5, textTransform: 'uppercase', color: c.textMuted, marginRight: 4 },
  chip: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 100, borderWidth: 1, borderColor: c.border, backgroundColor: c.cardBg, minHeight: 30, alignItems: 'center', justifyContent: 'center', minWidth: 50 },
  chipActive: { backgroundColor: c.brandPrimary, borderColor: c.brandPrimary },
  chipDanger: { backgroundColor: c.danger, borderColor: c.danger },
  chipText: { fontFamily: Fonts.bodyMed, fontSize: 12, color: c.brandPrimary, textTransform: 'capitalize' },
  chipTextActive: { color: c.cream },
  assignBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 100, backgroundColor: 'rgba(14, 77, 82, 0.06)' },
  assignText: { fontFamily: Fonts.bodyMed, fontSize: 11, color: c.brandPrimary },
  userCard: { flexDirection: 'row', alignItems: 'center', gap: 10, marginHorizontal: Spacing.md, marginTop: Spacing.sm, padding: Spacing.sm, backgroundColor: 'rgba(14, 77, 82, 0.04)', borderRadius: Radius.sm },
  userIcon: { width: 30, height: 30, borderRadius: 15, backgroundColor: c.cardBg, alignItems: 'center', justifyContent: 'center' },
  userName: { fontFamily: Fonts.bodySemi, fontSize: 13, color: c.brandPrimary },
  userEmail: { fontFamily: Fonts.body, fontSize: 11, color: c.textSecondary },
  thread: { padding: Spacing.md, gap: 10, flexGrow: 1 },
  bubble: { padding: 12, borderRadius: Radius.md, maxWidth: '85%' },
  bubbleThem: { backgroundColor: c.cardBg, borderWidth: 1, borderColor: c.borderSubtle, alignSelf: 'flex-start' },
  bubbleMe: { backgroundColor: c.brandPrimary, alignSelf: 'flex-end' },
  bubbleInternal: { backgroundColor: 'rgba(183, 121, 31, 0.15)', borderLeftWidth: 3, borderLeftColor: c.brandSecondary, alignSelf: 'flex-end' },
  internalLabel: { fontFamily: Fonts.bodySemi, fontSize: 9, letterSpacing: 0.8, color: c.brandSecondary, marginBottom: 4 },
  bubbleText: { fontFamily: Fonts.body, fontSize: 13, color: c.brandPrimary, lineHeight: 19 },
  bubbleMeta: { fontFamily: Fonts.body, fontSize: 10, color: c.textMuted, marginTop: 4 },
  composer: { padding: Spacing.md, borderTopWidth: 1, borderTopColor: c.borderSubtle, backgroundColor: c.cardBg, gap: 6 },
  internalBadge: { fontFamily: Fonts.bodyMed, fontSize: 11, color: c.brandSecondary, marginBottom: 4 },
  composerRow: { backgroundColor: c.background, borderRadius: Radius.sm, borderWidth: 1, borderColor: c.border, paddingHorizontal: 10 },
  composerInput: { fontFamily: Fonts.body, fontSize: 14, color: c.textPrimary, paddingVertical: 10, minHeight: 44, maxHeight: 140 },
  composerActions: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  actionBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 6, borderRadius: 100, backgroundColor: 'rgba(14, 77, 82, 0.06)' },
  actionBtnActive: { backgroundColor: 'rgba(183, 121, 31, 0.15)' },
  actionText: { fontFamily: Fonts.bodyMed, fontSize: 11, color: c.brandPrimary },
  sendBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 14, paddingVertical: 8, borderRadius: Radius.sm, backgroundColor: c.brandPrimary, minHeight: 36 },
  sendText: { fontFamily: Fonts.bodySemi, fontSize: 12, color: c.cream },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(14, 77, 82, 0.5)' },
  macrosSheet: { backgroundColor: c.background, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: Spacing.lg, paddingTop: Spacing.md, maxHeight: '60%' },
  macrosHandle: { width: 40, height: 4, backgroundColor: 'rgba(14,77,82,0.18)', borderRadius: 2, alignSelf: 'center', marginBottom: Spacing.sm },
  macrosTitle: { fontFamily: Fonts.heading, fontSize: 20, color: c.brandPrimary, letterSpacing: -0.3, marginBottom: Spacing.sm },
  macroRow: { padding: Spacing.md, backgroundColor: c.cardBg, borderRadius: Radius.md, borderWidth: 1, borderColor: c.borderSubtle, gap: 4 },
  macroTitle: { fontFamily: Fonts.bodySemi, fontSize: 14, color: c.brandPrimary },
  macroBody: { fontFamily: Fonts.body, fontSize: 12, color: c.textSecondary, lineHeight: 17 },
}); }
