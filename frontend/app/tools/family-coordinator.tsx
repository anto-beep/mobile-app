// Family Coordinator — multi-turn chat
import React, { useRef, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, TextInput, ActivityIndicator, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { api, extractErrorMessage } from '../../src/lib/api';
import { useAuth } from '../../src/context/AuthContext';
import { Colors, Fonts, Radius, Spacing } from '../../src/lib/theme';
import { AIAccuracyBanner, ToolGate, hasPaidAccess } from '../../src/components/AITools';

type Turn = { role: 'user' | 'assistant'; content: string };

const STARTERS = [
  "What's the difference between Clinical and Independence services?",
  "How do I read a Support at Home statement?",
  "Can I change providers if I'm unhappy?",
  "What is the lifetime cap?",
];

export default function FamilyCoordinator() {
  const router = useRouter();
  const { user } = useAuth();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const sessionId = useRef<string | null>(null);
  const scrollRef = useRef<ScrollView>(null);

  if (!hasPaidAccess(user)) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScrollView contentContainerStyle={styles.scroll}>
          <TouchableOpacity onPress={() => router.back()} style={styles.back}><Ionicons name="chevron-back" size={20} color={Colors.brandPrimary} /><Text style={styles.backText}>Back</Text></TouchableOpacity>
          <Text style={styles.overline}>Family Coordinator</Text>
          <Text style={styles.h1}>Ask anything</Text>
          <AIAccuracyBanner tool="family-coordinator" />
          <ToolGate tool="family-coordinator" variant={user ? 'free-plan' : 'unauth'} />
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
      const { data } = await api.post('/public/family-coordinator-chat', {
        message,
        session_id: sessionId.current,
        history: turns.slice(-6),
      });
      sessionId.current = data.session_id || sessionId.current;
      setTurns((p) => [...p, { role: 'assistant', content: data.reply || data.message || '...' }]);
    } catch (e) {
      setTurns((p) => [...p, { role: 'assistant', content: extractErrorMessage(e, "I couldn't reach my brain — try again?") }]);
    } finally {
      setSending(false);
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 80);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.back}><Ionicons name="chevron-back" size={20} color={Colors.brandPrimary} /><Text style={styles.backText}>Back</Text></TouchableOpacity>
        <Text style={styles.overline}>Family Coordinator</Text>
        <Text style={styles.h1}>The friendliest niece in Australia</Text>
        <AIAccuracyBanner tool="family-coordinator" />
      </View>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }} keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}>
        <ScrollView ref={scrollRef} contentContainerStyle={styles.chatScroll} keyboardShouldPersistTaps="handled" testID="fc-scroll">
          {turns.length === 0 && (
            <View>
              <Text style={styles.starterTitle}>Start with…</Text>
              {STARTERS.map((p) => (
                <TouchableOpacity key={p} style={styles.starter} onPress={() => send(p)} testID={`fc-starter-${p.slice(0, 10)}`}>
                  <Text style={styles.starterText}>{p}</Text>
                  <Ionicons name="arrow-forward" size={14} color={Colors.brandPrimary} />
                </TouchableOpacity>
              ))}
            </View>
          )}
          {turns.map((t, i) => (
            <View key={i} style={[styles.row, t.role === 'user' ? styles.rowRight : styles.rowLeft]} testID={`fc-bubble-${t.role}-${i}`}>
              <View style={[styles.bubble, t.role === 'user' ? styles.bubbleUser : styles.bubbleAsst]}>
                <Text style={t.role === 'user' ? styles.bubbleTextUser : styles.bubbleTextAsst}>{t.content}</Text>
              </View>
            </View>
          ))}
          {sending && (
            <View style={[styles.row, styles.rowLeft]}>
              <View style={[styles.bubble, styles.bubbleAsst]}><ActivityIndicator color={Colors.brandPrimary} size="small" /></View>
            </View>
          )}
        </ScrollView>
        <View style={styles.composer}>
          <TextInput style={styles.input} value={draft} onChangeText={setDraft} placeholder="Ask anything about aged care…" placeholderTextColor={Colors.textMuted} multiline testID="fc-input" />
          <TouchableOpacity onPress={() => send()} disabled={!draft.trim() || sending} style={[styles.sendBtn, (!draft.trim() || sending) && { opacity: 0.4 }]} testID="fc-send">
            <Ionicons name="arrow-up" size={20} color={Colors.cream} />
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  header: { paddingHorizontal: Spacing.lg, paddingTop: Spacing.md, paddingBottom: Spacing.sm, borderBottomWidth: 1, borderBottomColor: Colors.borderSubtle },
  back: { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
  backText: { fontFamily: Fonts.bodyMed, fontSize: 14, color: Colors.brandPrimary },
  overline: { fontFamily: Fonts.bodyMed, fontSize: 11, letterSpacing: 1.5, textTransform: 'uppercase', color: Colors.textMuted },
  h1: { fontFamily: Fonts.heading, fontSize: 20, color: Colors.brandPrimary, letterSpacing: -0.3, marginTop: 2, marginBottom: Spacing.sm },
  scroll: { padding: Spacing.lg },
  chatScroll: { padding: Spacing.lg, gap: 6 },
  starterTitle: { fontFamily: Fonts.bodyMed, fontSize: 11, color: Colors.textMuted, letterSpacing: 1, textTransform: 'uppercase', marginBottom: Spacing.sm },
  starter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: Colors.cardBg, padding: Spacing.md, borderRadius: Radius.md, marginBottom: 8, borderWidth: 1, borderColor: Colors.borderSubtle, gap: 8 },
  starterText: { fontFamily: Fonts.bodyMed, fontSize: 14, color: Colors.brandPrimary, flex: 1 },
  row: { flexDirection: 'row', marginVertical: 4 },
  rowLeft: { justifyContent: 'flex-start' },
  rowRight: { justifyContent: 'flex-end' },
  bubble: { maxWidth: '82%', paddingHorizontal: 14, paddingVertical: 10, borderRadius: 18 },
  bubbleUser: { backgroundColor: Colors.brandPrimary, borderBottomRightRadius: 4 },
  bubbleAsst: { backgroundColor: Colors.cardBg, borderBottomLeftRadius: 4, borderWidth: 1, borderColor: Colors.borderSubtle },
  bubbleTextUser: { fontFamily: Fonts.body, fontSize: 14, color: Colors.cream, lineHeight: 20 },
  bubbleTextAsst: { fontFamily: Fonts.body, fontSize: 14, color: Colors.textPrimary, lineHeight: 20 },
  composer: { flexDirection: 'row', alignItems: 'flex-end', padding: Spacing.md, gap: 8, backgroundColor: Colors.cardBg, borderTopWidth: 1, borderTopColor: Colors.borderSubtle },
  input: { flex: 1, fontFamily: Fonts.body, fontSize: 15, color: Colors.textPrimary, backgroundColor: Colors.background, borderRadius: 22, paddingHorizontal: 16, paddingVertical: 10, maxHeight: 120, minHeight: 44, borderWidth: 1, borderColor: Colors.border },
  sendBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: Colors.brandPrimary, alignItems: 'center', justifyContent: 'center' },
});
