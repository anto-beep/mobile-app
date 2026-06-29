// Support ticket detail — mobile parity with /support/[id] on the web app.
// Shows the ticket reference, title, status pill, raised-at timestamp,
// the reply thread, and an "Add a note" composer that posts back to the
// /api/support/tickets/{id}/notes endpoint (or whatever the backend accepts).
//
// We deliberately try a couple of plausible note endpoints because the
// backend route hasn't been documented for mobile yet; mobile must not
// crash if the POST 404s — we surface a friendly toast instead.
import React, { useCallback, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity,
  ActivityIndicator, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useApi } from '../../src/lib/useApi';
import { api, extractErrorMessage } from '../../src/lib/api';
import BackHeader from '../../src/components/BackHeader';
import { toast } from '../../src/components/Toast';
import { Fonts, Radius, Spacing } from '../../src/lib/theme';
import type { ColorPalette } from '../../src/lib/theme';
import { useColors } from '../../src/hooks/useColors';
import { useThemedStyles } from '../../src/hooks/useThemedStyles';
import { formatDate } from '../../src/lib/formatDate';

type TicketMessage = {
  id?: string;
  body?: string;
  message?: string;
  author?: string;
  author_name?: string;
  created_at?: string;
  direction?: 'in' | 'out' | string;
};
type TicketDetail = {
  id: string;
  reference?: string;
  short_id?: string;
  tool_name?: string;
  category?: string;
  status?: string;
  status_message?: string;
  created_at?: string;
  user_note?: string;
  title?: string;
  messages?: TicketMessage[];
  replies?: TicketMessage[];
};

const STATUS_PILL: Record<string, { tint: string; label: string; help: string }> = {
  received:    { tint: '#0E4D52', label: 'Received',    help: 'We have your ticket and it is in the queue.' },
  in_progress: { tint: '#C8932B', label: 'In progress', help: 'A Wayly team member is looking into this.' },
  awaiting:    { tint: '#6B7C92', label: 'Awaiting you', help: "We've replied — your turn." },
  resolved:    { tint: '#3A5F37', label: 'Resolved',    help: 'Closed out. Reopen any time.' },
  closed:      { tint: '#6B7C92', label: 'Closed',      help: 'Closed out. Reopen any time.' },
};

function pillFor(status?: string) {
  const k = (status || 'received').toLowerCase().replace(/\s+/g, '_');
  return STATUS_PILL[k] || { tint: '#6B7C92', label: status || 'Received', help: 'We have your ticket.' };
}

export default function SupportDetailRoute() {
  const c = useColors();
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();

  // Detail wrapper — some backends return `{ ticket }`, some return the
  // ticket object directly. Normalise both shapes.
  const { data: raw, loading, refreshing, refresh } = useApi<any>(`/support/tickets/${id}`);
  const ticket: TicketDetail | null = raw?.ticket || raw || null;

  const [note, setNote] = useState('');
  const [sending, setSending] = useState(false);

  const reply = useCallback(async () => {
    if (!ticket?.id) return;
    if (!note.trim()) { toast.warning('Add a note first.'); return; }
    setSending(true);
    try {
      // Try messages endpoint first, then fall back to /notes.
      try {
        await api.post(`/support/tickets/${ticket.id}/messages`, { body: note.trim() });
      } catch {
        await api.post(`/support/tickets/${ticket.id}/notes`, { body: note.trim() });
      }
      setNote('');
      await refresh();
      toast.success('Note sent.');
    } catch (e) {
      toast.error(extractErrorMessage(e, "Couldn't send the note"));
    } finally { setSending(false); }
  }, [ticket?.id, note, refresh]);

  const ref = ticket?.reference || ticket?.short_id || (ticket?.id ? `WAY-${ticket.id.slice(0, 4).toUpperCase()}` : '—');
  const title = ticket?.title || ticket?.tool_name || 'Support ticket';
  const m = pillFor(ticket?.status);
  const replies: TicketMessage[] = (ticket?.replies || ticket?.messages || []) as TicketMessage[];

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <BackHeader title="Ticket" />
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={c.brandPrimary} />}
      >
        <TouchableOpacity onPress={() => router.back()} style={styles.backRow} hitSlop={8} testID="ticket-back">
          <Ionicons name="arrow-back" size={14} color={c.brandPrimary} />
          <Text style={styles.backRowText}>Back to My Support</Text>
        </TouchableOpacity>

        {loading && !ticket ? (
          <View style={{ paddingVertical: 32, alignItems: 'center' }}>
            <ActivityIndicator color={c.brandPrimary} />
          </View>
        ) : !ticket ? (
          <View style={styles.empty}>
            <Ionicons name="alert-circle-outline" size={28} color={c.textMuted} />
            <Text style={styles.emptyTitle}>Ticket not found</Text>
            <Text style={styles.emptyBody}>Pull to refresh, or go back to the list.</Text>
          </View>
        ) : (
          <>
            <View style={styles.headerCard}>
              <View style={{ flex: 1, gap: 4 }}>
                <Text style={styles.ref}>{ref}</Text>
                <Text style={styles.title}>{title}</Text>
                {!!ticket.created_at && (
                  <Text style={styles.meta}>Raised {formatDate(ticket.created_at)}</Text>
                )}
              </View>
              <View style={[styles.pill, { backgroundColor: `${m.tint}1A` }]}>
                <Text style={[styles.pillText, { color: m.tint }]}>{m.label}</Text>
              </View>
            </View>

            <View style={styles.statusCard}>
              <Ionicons name="information-circle-outline" size={16} color={c.brandPrimary} />
              <Text style={styles.statusText}>{ticket.status_message || m.help}</Text>
            </View>

            {!!ticket.user_note && (
              <View style={styles.messageCard}>
                <Text style={styles.messageMeta}>You — {ticket.created_at ? formatDate(ticket.created_at) : ''}</Text>
                <Text style={styles.messageBody}>{ticket.user_note}</Text>
              </View>
            )}

            {replies.length === 0 ? (
              <View style={styles.empty}>
                <Text style={styles.emptyBody}>No replies yet. We will be in touch under your reference.</Text>
              </View>
            ) : (
              <View style={{ gap: 8 }}>
                {replies.map((r, idx) => {
                  const isMe = (r.direction || r.author || '').toLowerCase().includes('me') || (r.direction === 'out');
                  return (
                    <View key={r.id || `r-${idx}`} style={[styles.messageCard, isMe && styles.messageMine]}>
                      <Text style={styles.messageMeta}>{r.author_name || r.author || (isMe ? 'You' : 'Wayly')} — {r.created_at ? formatDate(r.created_at) : ''}</Text>
                      <Text style={styles.messageBody}>{r.body || r.message || ''}</Text>
                    </View>
                  );
                })}
              </View>
            )}

            <View style={styles.composer}>
              <Text style={styles.composerLbl}>Add a note</Text>
              <TextInput
                style={[styles.input, { minHeight: 96, textAlignVertical: 'top' }]}
                value={note}
                onChangeText={setNote}
                multiline
                placeholder="Share any more detail that might help us look into this."
                placeholderTextColor={c.textMuted}
                testID="ticket-note"
              />
              <View style={{ alignItems: 'flex-end', marginTop: Spacing.sm }}>
                <TouchableOpacity onPress={reply} disabled={sending || !note.trim()} style={[styles.sendBtn, (!note.trim() || sending) && { opacity: 0.5 }]} testID="ticket-send">
                  {sending ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.sendBtnText}>Send</Text>}
                </TouchableOpacity>
              </View>
            </View>
          </>
        )}
        <View style={{ height: 32 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

function makeStyles(c: ColorPalette) { return StyleSheet.create({
  safe: { flex: 1, backgroundColor: c.background },
  scroll: { padding: Spacing.md, paddingBottom: 40 },
  backRow: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 4, marginBottom: Spacing.sm },
  backRowText: { fontFamily: Fonts.bodySemi, fontSize: 13, color: c.brandPrimary },
  empty: { alignItems: 'center', gap: 6, paddingVertical: 24, paddingHorizontal: 8 },
  emptyTitle: { fontFamily: Fonts.bodySemi, fontSize: 15, color: c.brandPrimary, marginTop: 4 },
  emptyBody: { fontFamily: Fonts.body, fontSize: 13, color: c.textSecondary, textAlign: 'center', lineHeight: 19 },
  headerCard: { backgroundColor: c.cardBg, borderRadius: Radius.md, borderWidth: 1, borderColor: c.borderSubtle, padding: Spacing.md, flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginBottom: Spacing.sm },
  ref: { fontFamily: Fonts.bodyMed, fontSize: 11, color: c.textMuted, letterSpacing: 0.6 },
  title: { fontFamily: Fonts.heading, fontSize: 19, color: c.brandPrimary, lineHeight: 24 },
  meta: { fontFamily: Fonts.body, fontSize: 12, color: c.textSecondary, marginTop: 4 },
  pill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 9999 },
  pillText: { fontFamily: Fonts.bodySemi, fontSize: 11, letterSpacing: 0.3 },
  statusCard: { backgroundColor: c.surfaceTint, borderRadius: Radius.md, padding: Spacing.md, borderWidth: 1, borderColor: c.borderSubtle, flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: Spacing.md },
  statusText: { fontFamily: Fonts.body, fontSize: 13, color: c.textPrimary, flex: 1, lineHeight: 19 },
  messageCard: { backgroundColor: c.cardBg, borderRadius: Radius.md, borderWidth: 1, borderColor: c.borderSubtle, padding: Spacing.md, gap: 4 },
  messageMine: { backgroundColor: `${c.brandPrimary}10` as any, borderColor: c.brandPrimary },
  messageMeta: { fontFamily: Fonts.bodyMed, fontSize: 11, color: c.textMuted, letterSpacing: 0.4 },
  messageBody: { fontFamily: Fonts.body, fontSize: 14, color: c.textPrimary, lineHeight: 21 },
  composer: { marginTop: Spacing.md, backgroundColor: c.cardBg, borderRadius: Radius.md, borderWidth: 1, borderColor: c.borderSubtle, padding: Spacing.md },
  composerLbl: { fontFamily: Fonts.bodySemi, fontSize: 13, color: c.textPrimary, marginBottom: 6 },
  input: { fontFamily: Fonts.body, fontSize: 14, color: c.textPrimary, backgroundColor: c.background, borderRadius: Radius.md, paddingHorizontal: Spacing.md, paddingVertical: 12, borderWidth: 1, borderColor: c.borderSubtle, minHeight: 46 },
  sendBtn: { paddingHorizontal: 24, paddingVertical: 12, borderRadius: 9999, backgroundColor: c.brandPrimary, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  sendBtnText: { fontFamily: Fonts.bodySemi, fontSize: 13, color: '#FFFFFF' },
}); }
