// Chat — Help bot grounded in user dashboard context (calls /api/chat)
import React, { useEffect, useRef, useState } from 'react';
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
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { api, extractErrorMessage } from '../../src/lib/api';
import { Colors, Fonts, Radius, Spacing } from '../../src/lib/theme';

type Turn = { id?: string; role: 'user' | 'assistant'; content: string };

const STARTER_PROMPTS = [
  "What does my latest statement actually mean?",
  "Are we on track this quarter?",
  "How do contributions work again?",
  "What's a clinical visit cost typically?",
];

export default function Chat() {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<ScrollView>(null);
  const sessionIdRef = useRef<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const { data } = await api.get<Turn[]>('/chat/history');
        setTurns(data || []);
      } catch {
        setTurns([]);
      } finally {
        setLoading(false);
        setTimeout(() => scrollRef.current?.scrollToEnd({ animated: false }), 80);
      }
    })();
  }, []);

  const send = async (text?: string) => {
    const message = (text ?? draft).trim();
    if (!message || sending) return;
    setDraft('');
    setSending(true);
    setTurns((prev) => [...prev, { role: 'user', content: message }]);
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 50);
    try {
      const { data } = await api.post('/chat', {
        message,
        session_id: sessionIdRef.current,
      });
      sessionIdRef.current = data.session_id || sessionIdRef.current;
      setTurns((prev) => [...prev, { role: 'assistant', content: data.reply }]);
    } catch (e) {
      setTurns((prev) => [
        ...prev,
        { role: 'assistant', content: extractErrorMessage(e, 'I couldn\'t reach my brain — try again?') },
      ]);
    } finally {
      setSending(false);
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 80);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.overline}>Help</Text>
        <Text style={styles.h1}>Ask Wayly</Text>
        <Text style={styles.sub}>I know about your statements, your budget, and the Support at Home rules.</Text>
      </View>

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1 }}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
      >
        <ScrollView
          ref={scrollRef}
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          testID="chat-scroll-view"
        >
          {loading ? (
            <View style={styles.loadingFill}>
              <ActivityIndicator color={Colors.brandPrimary} />
            </View>
          ) : (
            <>
              {turns.length === 0 && (
                <View testID="chat-starter-prompts">
                  <Text style={styles.starterTitle}>Start with…</Text>
                  {STARTER_PROMPTS.map((p) => (
                    <TouchableOpacity
                      key={p}
                      style={styles.starter}
                      onPress={() => send(p)}
                      testID={`chat-starter-${p.slice(0, 8)}`}
                    >
                      <Text style={styles.starterText}>{p}</Text>
                      <Ionicons name="arrow-forward" size={14} color={Colors.brandPrimary} />
                    </TouchableOpacity>
                  ))}
                </View>
              )}
              {turns.map((t, i) => (
                <View
                  key={i}
                  style={[styles.bubbleRow, t.role === 'user' ? styles.bubbleRowRight : styles.bubbleRowLeft]}
                  testID={`chat-bubble-${t.role}-${i}`}
                >
                  <View
                    style={[
                      styles.bubble,
                      t.role === 'user' ? styles.bubbleUser : styles.bubbleAssistant,
                    ]}
                  >
                    <Text style={t.role === 'user' ? styles.bubbleTextUser : styles.bubbleTextAsst}>
                      {t.content}
                    </Text>
                  </View>
                </View>
              ))}
              {sending && (
                <View style={[styles.bubbleRow, styles.bubbleRowLeft]}>
                  <View style={[styles.bubble, styles.bubbleAssistant]}>
                    <ActivityIndicator color={Colors.brandPrimary} size="small" />
                  </View>
                </View>
              )}
            </>
          )}
        </ScrollView>

        <View style={styles.composer}>
          <TextInput
            style={styles.input}
            placeholder="Ask a question…"
            placeholderTextColor={Colors.textMuted}
            value={draft}
            onChangeText={setDraft}
            multiline
            testID="chat-input"
          />
          <TouchableOpacity
            onPress={() => send()}
            disabled={!draft.trim() || sending}
            style={[styles.sendBtn, (!draft.trim() || sending) && { opacity: 0.4 }]}
            testID="chat-send-button"
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
  scroll: { padding: Spacing.lg, paddingBottom: Spacing.lg, gap: Spacing.sm },
  loadingFill: { padding: Spacing.xl, alignItems: 'center' },
  starterTitle: { fontFamily: Fonts.bodyMed, fontSize: 12, color: Colors.textMuted, textTransform: 'uppercase', letterSpacing: 1, marginBottom: Spacing.sm },
  starter: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: Colors.cardBg, padding: Spacing.md, borderRadius: Radius.md,
    marginBottom: 8, borderWidth: 1, borderColor: Colors.borderSubtle,
  },
  starterText: { fontFamily: Fonts.bodyMed, fontSize: 14, color: Colors.brandPrimary, flex: 1, marginRight: 8 },
  bubbleRow: { flexDirection: 'row', marginVertical: 4 },
  bubbleRowLeft: { justifyContent: 'flex-start' },
  bubbleRowRight: { justifyContent: 'flex-end' },
  bubble: { maxWidth: '82%', paddingHorizontal: 14, paddingVertical: 10, borderRadius: 18 },
  bubbleUser: { backgroundColor: Colors.brandPrimary, borderBottomRightRadius: 4 },
  bubbleAssistant: { backgroundColor: Colors.cardBg, borderBottomLeftRadius: 4, borderWidth: 1, borderColor: Colors.borderSubtle },
  bubbleTextUser: { fontFamily: Fonts.body, fontSize: 14, color: Colors.cream, lineHeight: 20 },
  bubbleTextAsst: { fontFamily: Fonts.body, fontSize: 14, color: Colors.textPrimary, lineHeight: 20 },
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
