// Family — short-form caregiver/participant message thread
import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { api, extractErrorMessage } from '../../src/lib/api';
import { useAuth } from '../../src/context/AuthContext';
import { Colors, Fonts, Radius, Spacing } from '../../src/lib/theme';

type Message = {
  id: string;
  author_id: string;
  author_name: string;
  body: string;
  created_at: string;
  related_statement_id?: string | null;
};

const formatWhen = (iso: string): string => {
  try {
    const d = new Date(iso);
    return d.toLocaleString('en-AU', {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '';
  }
};

export default function FamilyThread() {
  const { user } = useAuth();
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    try {
      setError(null);
      const { data } = await api.get<Message[]>('/family-thread');
      setMessages(data || []);
    } catch (e) {
      setError(extractErrorMessage(e, "Couldn't load the family thread"));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useFocusEffect(
    useCallback(() => {
      load();
    }, [])
  );

  const send = async () => {
    if (!draft.trim() || sending) return;
    const body = draft.trim();
    setDraft('');
    setSending(true);
    try {
      const { data } = await api.post<Message>('/family-thread', { body });
      setMessages((prev) => [...prev, data]);
    } catch (e) {
      setError(extractErrorMessage(e, "Couldn't send"));
      setDraft(body);
    } finally {
      setSending(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.overline}>Family thread</Text>
        <Text style={styles.h1}>Keep everyone in the loop</Text>
        <Text style={styles.sub}>Quick notes between caregivers and your participant.</Text>
      </View>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1 }}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
      >
        <ScrollView
          contentContainerStyle={styles.scroll}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={Colors.brandPrimary} />
          }
          keyboardShouldPersistTaps="handled"
          testID="family-thread-scroll"
        >
          {loading ? (
            <View style={styles.loadingFill}><ActivityIndicator color={Colors.brandPrimary} /></View>
          ) : error && messages.length === 0 ? (
            <View style={styles.empty}>
              <Ionicons name="people-outline" size={36} color={Colors.textMuted} />
              <Text style={styles.emptyTitle}>{error}</Text>
              <Text style={styles.emptyBody}>You may need to set up your household first (Profile tab).</Text>
            </View>
          ) : messages.length === 0 ? (
            <View style={styles.empty} testID="family-thread-empty">
              <Ionicons name="chatbubble-ellipses-outline" size={36} color={Colors.textMuted} />
              <Text style={styles.emptyTitle}>Start the conversation</Text>
              <Text style={styles.emptyBody}>Drop a quick note for everyone caring for your participant.</Text>
            </View>
          ) : (
            messages.map((m) => {
              const mine = m.author_id === user?.id;
              return (
                <View
                  key={m.id}
                  style={[styles.row, mine ? styles.rowRight : styles.rowLeft]}
                  testID={`family-message-${m.id}`}
                >
                  <View style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleTheirs]}>
                    {!mine && <Text style={styles.author}>{m.author_name}</Text>}
                    <Text style={mine ? styles.bodyMine : styles.bodyTheirs}>{m.body}</Text>
                    <Text style={[styles.time, mine && { color: 'rgba(250, 247, 242, 0.7)' }]}>
                      {formatWhen(m.created_at)}
                    </Text>
                  </View>
                </View>
              );
            })
          )}
        </ScrollView>

        <View style={styles.composer}>
          <TextInput
            style={styles.input}
            placeholder="Write a quick note…"
            placeholderTextColor={Colors.textMuted}
            value={draft}
            onChangeText={setDraft}
            multiline
            testID="family-message-input"
          />
          <TouchableOpacity
            onPress={send}
            disabled={!draft.trim() || sending}
            style={[styles.sendBtn, (!draft.trim() || sending) && { opacity: 0.4 }]}
            testID="family-send-button"
          >
            <Ionicons name="arrow-up" size={20} color={Colors.cream} />
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  header: { paddingHorizontal: Spacing.lg, paddingTop: Spacing.md, paddingBottom: Spacing.md, borderBottomWidth: 1, borderBottomColor: Colors.borderSubtle },
  overline: { fontFamily: Fonts.bodyMed, fontSize: 11, letterSpacing: 1.5, textTransform: 'uppercase', color: Colors.textMuted },
  h1: { fontFamily: Fonts.heading, fontSize: 22, color: Colors.brandPrimary, letterSpacing: -0.5, marginTop: 2 },
  sub: { fontFamily: Fonts.body, fontSize: 12, color: Colors.textSecondary, marginTop: 4 },
  scroll: { padding: Spacing.lg, gap: Spacing.sm },
  loadingFill: { padding: Spacing.xl, alignItems: 'center' },
  empty: { padding: Spacing.xl, alignItems: 'center', gap: 8 },
  emptyTitle: { fontFamily: Fonts.headingMed, fontSize: 16, color: Colors.brandPrimary, marginTop: Spacing.sm },
  emptyBody: { fontFamily: Fonts.body, fontSize: 13, color: Colors.textSecondary, textAlign: 'center' },
  row: { flexDirection: 'row', marginVertical: 4 },
  rowLeft: { justifyContent: 'flex-start' },
  rowRight: { justifyContent: 'flex-end' },
  bubble: { maxWidth: '82%', paddingHorizontal: 14, paddingVertical: 10, borderRadius: 18 },
  bubbleMine: { backgroundColor: Colors.brandPrimary, borderBottomRightRadius: 4 },
  bubbleTheirs: { backgroundColor: Colors.cardBg, borderBottomLeftRadius: 4, borderWidth: 1, borderColor: Colors.borderSubtle },
  author: { fontFamily: Fonts.bodySemi, fontSize: 11, color: Colors.brandSecondary, marginBottom: 2, textTransform: 'uppercase', letterSpacing: 0.5 },
  bodyMine: { fontFamily: Fonts.body, fontSize: 14, color: Colors.cream, lineHeight: 20 },
  bodyTheirs: { fontFamily: Fonts.body, fontSize: 14, color: Colors.textPrimary, lineHeight: 20 },
  time: { fontFamily: Fonts.body, fontSize: 10, color: Colors.textMuted, marginTop: 4 },
  composer: {
    flexDirection: 'row', alignItems: 'flex-end', padding: Spacing.md, gap: 8,
    backgroundColor: Colors.cardBg, borderTopWidth: 1, borderTopColor: Colors.borderSubtle,
  },
  input: {
    flex: 1, fontFamily: Fonts.body, fontSize: 15, color: Colors.textPrimary,
    backgroundColor: Colors.background, borderRadius: 22, paddingHorizontal: 16, paddingVertical: 10,
    maxHeight: 120, minHeight: 44, borderWidth: 1, borderColor: Colors.border,
  },
  sendBtn: {
    width: 44, height: 44, borderRadius: 22, backgroundColor: Colors.brandPrimary,
    alignItems: 'center', justifyContent: 'center',
  },
});
