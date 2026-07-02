// Aged Care Q&A — public chat (renamed from Family Coordinator in iter 48).
// API: POST /public/aged-care-chat. The assistant has NO household data — that boundary
// is surfaced in the subtext so users don't expect it to answer account questions.
import React, { useRef, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, TextInput, ActivityIndicator, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { api, extractErrorMessage } from '../../src/lib/api';
import { useAuth } from '../../src/context/AuthContext';
import { Fonts, Radius, Spacing } from '../../src/lib/theme';
import type { ColorPalette } from '../../src/lib/theme';
import { useColors } from '../../src/hooks/useColors';
import { useThemedStyles } from '../../src/hooks/useThemedStyles';
import { AIAccuracyBanner, ToolGate, hasPaidAccess } from '../../src/components/AITools';

type Turn = { role: 'user' | 'assistant'; content: string };

const STARTERS = [
  'What is the Support at Home program?',
  'How is a classification level decided?',
  'What is the lifetime cap?',
  'How can I dispute a charge with my provider?',
];

export default function AgedCareQA() {
  const c = useColors();
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const { user } = useAuth();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const sessionId = useRef<string | null>(null);
  const scrollRef = useRef<ScrollView>(null);

  if (!hasPaidAccess(user)) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']} testID="aged-care-qa">
        <ScrollView contentContainerStyle={styles.scroll}>
          <TouchableOpacity onPress={() => router.back()} style={styles.back}><Ionicons name="chevron-back" size={20} color={c.brandPrimary} /><Text style={styles.backText}>Back</Text></TouchableOpacity>
          <Text style={styles.overline}>Aged Care Q&amp;A</Text>
          <Text style={styles.h1}>Plain-English aged-care answers</Text>
          <Text style={styles.tagline}>Plain-English answers about the Support at Home program, grounded in the Aged Care Act 2024.</Text>
          <AIAccuracyBanner tool="aged-care-qa" />
          <ToolGate tool="aged-care-qa" variant={user ? 'free-plan' : 'unauth'} />
        </ScrollView>
      </SafeAreaView>
    );
  }

  const send = async (text?: string) => {
    const message = (text ?? draft).trim();
    if (!message || sending) return;
    setDraft('');
    setSending(true);
    setTurns((p) => [...p, { role: 'user', content: message }]);
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 50);
    try {
      const { data } = await api.post('/public/aged-care-chat', {
        message,
        session_id: sessionId.current,
        history: turns.slice(-6),
      });
      sessionId.current = data.session_id || sessionId.current;
      setTurns((p) => [...p, { role: 'assistant', content: data.reply || data.message || '...' }]);
    } catch (e) {
      setTurns((p) => [...p, { role: 'assistant', content: extractErrorMessage(e, "I could not reach my brain, try again?") }]);
    } finally {
      setSending(false);
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 80);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']} testID="aged-care-qa">
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.back}><Ionicons name="chevron-back" size={20} color={c.brandPrimary} /><Text style={styles.backText}>Back</Text></TouchableOpacity>
        <Text style={styles.overline}>Aged Care Q&amp;A</Text>
        <Text style={styles.h1}>Plain-English aged-care answers</Text>
        <Text style={styles.tagline}>Plain-English answers about the Support at Home program, grounded in the Aged Care Act 2024.</Text>
        <Text style={styles.boundary} testID="aged-care-qa-boundary">
          This is a general Q&amp;A assistant, it cannot see your account or statements. Signed-in members can ask the in-app assistant questions about their own household.
        </Text>
        <AIAccuracyBanner tool="aged-care-qa" />
      </View>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }} keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}>
        <ScrollView ref={scrollRef} contentContainerStyle={styles.chatScroll} keyboardShouldPersistTaps="handled" testID="aged-care-qa-scroll">
          {turns.length === 0 && (
            <View>
              <Text style={styles.starterTitle}>Start with…</Text>
              {STARTERS.map((p) => (
                <TouchableOpacity key={p} style={styles.starter} onPress={() => send(p)} testID={`aged-care-qa-starter-${p.slice(0, 10)}`}>
                  <Text style={styles.starterText}>{p}</Text>
                  <Ionicons name="arrow-forward" size={14} color={c.brandPrimary} />
                </TouchableOpacity>
              ))}
            </View>
          )}
          {turns.map((t, i) => (
            <View key={i} style={[styles.row, t.role === 'user' ? styles.rowRight : styles.rowLeft]} testID={`aged-care-qa-bubble-${t.role}-${i}`}>
              <View style={[styles.bubble, t.role === 'user' ? styles.bubbleUser : styles.bubbleAsst]}>
                <Text style={t.role === 'user' ? styles.bubbleTextUser : styles.bubbleTextAsst}>{t.content}</Text>
              </View>
            </View>
          ))}
          {sending && (
            <View style={[styles.row, styles.rowLeft]}>
              <View style={[styles.bubble, styles.bubbleAsst]}><ActivityIndicator color={c.brandPrimary} size="small" /></View>
            </View>
          )}
        </ScrollView>
        <View style={styles.composer}>
          <TextInput style={styles.input} value={draft} onChangeText={setDraft} placeholder="Ask anything about Support at Home…" placeholderTextColor={c.textMuted} multiline testID="aged-care-qa-input" />
          <TouchableOpacity onPress={() => send()} disabled={!draft.trim() || sending} style={[styles.sendBtn, (!draft.trim() || sending) && { opacity: 0.4 }]} testID="aged-care-qa-send">
            <Ionicons name="arrow-up" size={20} color={c.cream} />
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function makeStyles(c: ColorPalette) { return StyleSheet.create({
  safe: { flex: 1, backgroundColor: c.background },
  header: { paddingHorizontal: Spacing.lg, paddingTop: Spacing.md, paddingBottom: Spacing.sm, borderBottomWidth: 1, borderBottomColor: c.borderSubtle },
  back: { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
  backText: { fontFamily: Fonts.bodyMed, fontSize: 14, color: c.brandPrimary },
  overline: { fontFamily: Fonts.bodyMed, fontSize: 11, letterSpacing: 1.5, textTransform: 'uppercase', color: c.textMuted },
  h1: { fontFamily: Fonts.heading, fontSize: 20, color: c.brandPrimary, letterSpacing: -0.3, marginTop: 2 },
  tagline: { fontFamily: Fonts.body, fontSize: 13, color: c.textSecondary, marginTop: 4, lineHeight: 18 },
  boundary: { fontFamily: Fonts.body, fontSize: 11, color: c.textMuted, marginTop: Spacing.sm, marginBottom: Spacing.sm, lineHeight: 15, fontStyle: 'italic' },
  scroll: { padding: Spacing.lg },
  chatScroll: { padding: Spacing.lg, gap: 6 },
  starterTitle: { fontFamily: Fonts.bodyMed, fontSize: 11, color: c.textMuted, letterSpacing: 1, textTransform: 'uppercase', marginBottom: Spacing.sm },
  starter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: c.cardBg, padding: Spacing.md, borderRadius: Radius.md, marginBottom: 8, borderWidth: 1, borderColor: c.borderSubtle, gap: 8 },
  starterText: { fontFamily: Fonts.bodyMed, fontSize: 14, color: c.brandPrimary, flex: 1 },
  row: { flexDirection: 'row', marginVertical: 4 },
  rowLeft: { justifyContent: 'flex-start' },
  rowRight: { justifyContent: 'flex-end' },
  bubble: { maxWidth: '82%', paddingHorizontal: 14, paddingVertical: 10, borderRadius: 18 },
  bubbleUser: { backgroundColor: c.brandPrimary, borderBottomRightRadius: 4 },
  bubbleAsst: { backgroundColor: c.cardBg, borderBottomLeftRadius: 4, borderWidth: 1, borderColor: c.borderSubtle },
  bubbleTextUser: { fontFamily: Fonts.body, fontSize: 14, color: c.cream, lineHeight: 20 },
  bubbleTextAsst: { fontFamily: Fonts.body, fontSize: 14, color: c.textPrimary, lineHeight: 20 },
  composer: { flexDirection: 'row', alignItems: 'flex-end', padding: Spacing.md, gap: 8, backgroundColor: c.cardBg, borderTopWidth: 1, borderTopColor: c.borderSubtle },
  input: { flex: 1, fontFamily: Fonts.body, fontSize: 15, color: c.textPrimary, backgroundColor: c.background, borderRadius: 22, paddingHorizontal: 16, paddingVertical: 10, maxHeight: 120, minHeight: 44, borderWidth: 1, borderColor: c.border },
  sendBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: c.brandPrimary, alignItems: 'center', justifyContent: 'center' },
}); }
