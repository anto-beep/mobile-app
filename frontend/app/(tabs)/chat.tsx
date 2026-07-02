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
  AppState,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { api, extractErrorMessage } from '../../src/lib/api';
import { useScenario } from '../../src/context/ScenarioContext';
import { Fonts, Radius, Spacing } from '../../src/lib/theme';
import type { ColorPalette } from '../../src/lib/theme';
import { useColors } from '../../src/hooks/useColors';
import { useThemedStyles } from '../../src/hooks/useThemedStyles';

type Turn = { id?: string; role: 'user' | 'assistant'; content: string };

const STARTER_PROMPTS = [
  "What does my latest statement actually mean?",
  "Are we on track this quarter?",
  "How do contributions work again?",
  "What's a clinical visit cost typically?",
];

// 5 minutes inactivity counts as a "new session" for the resume prompt.
const SESSION_GAP_MS = 5 * 60 * 1000;
const LAST_ACTIVE_KEY = 'wayly:chat:last_active';
const RESUME_DISMISSED_KEY = 'wayly:chat:resume_dismissed_at';

export default function Chat() {
  const c = useColors();
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const scenario = useScenario();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [showResume, setShowResume] = useState(false);
  const scrollRef = useRef<ScrollView>(null);
  const sessionIdRef = useRef<string | null>(null);
  const lastActiveRef = useRef<number>(Date.now());

  // Mark last-active timestamp every time the user touches the chat.
  const touch = async () => {
    const now = Date.now();
    lastActiveRef.current = now;
    try { await AsyncStorage.setItem(LAST_ACTIVE_KEY, String(now)); } catch {}
  };

  useEffect(() => {
    (async () => {
      let prior: Turn[] = [];
      try {
        const { data } = await api.get<Turn[]>('/chat/history');
        prior = data || [];
      } catch {
        prior = [];
      }
      setTurns(prior);

      // Decide whether to show the resume prompt.
      // Show it if: (a) we have prior turns AND (b) the user has been away long enough.
      if (prior.length > 0) {
        try {
          const lastStr = await AsyncStorage.getItem(LAST_ACTIVE_KEY);
          const dismissedStr = await AsyncStorage.getItem(RESUME_DISMISSED_KEY);
          const last = lastStr ? parseInt(lastStr, 10) : 0;
          const dismissed = dismissedStr ? parseInt(dismissedStr, 10) : 0;
          const now = Date.now();
          const beenAway = !last || (now - last) > SESSION_GAP_MS;
          // Only show the prompt if user hasn't dismissed it within this session window
          const alreadyDecided = dismissed > last;
          if (beenAway && !alreadyDecided) {
            setShowResume(true);
          }
        } catch {
          // No storage access — default to showing the prompt if there's history
          setShowResume(true);
        }
      }

      setLoading(false);
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: false }), 80);
    })();
  }, []);

  // Track app background → mark session boundary.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'background' || state === 'inactive') {
        AsyncStorage.setItem(LAST_ACTIVE_KEY, String(Date.now())).catch(() => {});
      }
    });
    return () => sub.remove();
  }, []);

  const continueChat = async () => {
    setShowResume(false);
    await AsyncStorage.setItem(RESUME_DISMISSED_KEY, String(Date.now())).catch(() => {});
    await touch();
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: false }), 80);
  };

  const startFresh = async () => {
    const doClear = async () => {
      try {
        await api.delete('/chat/history').catch(() => {});
      } catch {}
      sessionIdRef.current = null;
      setTurns([]);
      setShowResume(false);
      await AsyncStorage.setItem(RESUME_DISMISSED_KEY, String(Date.now())).catch(() => {});
      await touch();
    };
    if (Platform.OS === 'web') {
      // eslint-disable-next-line no-alert
      if (typeof window !== 'undefined' && window.confirm("Start a fresh chat? Your previous messages will be cleared.")) {
        await doClear();
      }
    } else {
      Alert.alert(
        'Start a fresh chat?',
        'Your previous messages will be cleared.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Start fresh', style: 'destructive', onPress: doClear },
        ]
      );
    }
  };

  const send = async (text?: string) => {
    const message = (text ?? draft).trim();
    if (!message || sending) return;
    setDraft('');
    setSending(true);
    setShowResume(false); // first new message implicitly = "continue"
    setTurns((prev) => [...prev, { role: 'user', content: message }]);
    await touch();
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 50);
    try {
      // PHASE 5 GUARDRAIL: pre-flight the question through the boundary
      // classifier BEFORE invoking the LLM. If the engine returns ROUTE_OUT
      // or ESCALATE we render the deterministic contact-card response in
      // the chat thread and never call /chat. See handoff §5.7.
      const probe = await scenario.boundaryProbe(message);
      if (probe.boundary !== 'SAFE_TO_EXPLAIN') {
        const contacts = scenario.getContacts(probe.contacts || []);
        const lead = probe.boundary === 'ESCALATE'
          ? "This one needs a real person, fast. Wayly does not give legal or financial advice, so I'll point you straight to who can help:"
          : "A specialist can answer this best, Wayly does not give legal or financial advice. Here's where to start:";
        const lines = contacts.map((c) => `\u2022 ${c.label} \u2014 ${c.phone}${c.hours ? ` (${c.hours})` : ''}`).join('\n');
        const safeLines = lines || '\u2022 Visit https://wayly.com.au/contacts for the up-to-date list of who to call.';
        setTurns((prev) => [...prev, { role: 'assistant', content: `${lead}\n\n${safeLines}` }]);
        return;  // hard-stop \u2014 never call /chat for non-SAFE queries.
      }
      const { data } = await api.post('/chat', {
        message,
        session_id: sessionIdRef.current,
      });
      sessionIdRef.current = data.session_id || sessionIdRef.current;
      setTurns((prev) => [...prev, { role: 'assistant', content: data.reply }]);
    } catch (e) {
      setTurns((prev) => [
        ...prev,
        { role: 'assistant', content: extractErrorMessage(e, 'I couldn\'t reach my brain, try again?') },
      ]);
    } finally {
      setSending(false);
      await touch();
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 80);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.tealBar}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.backPill}
          hitSlop={12}
          testID="chat-back-btn"
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Ionicons name="chevron-back" size={18} color="#FFFFFF" />
          <Text style={styles.backPillText}>Back</Text>
        </TouchableOpacity>
        <View style={styles.tealTitleWrap}>
          <Text style={styles.tealTitle}>Ask Wayly</Text>
        </View>
        {turns.length > 0 ? (
          <TouchableOpacity onPress={startFresh} style={styles.newPill} testID="chat-new-btn" accessibilityRole="button" accessibilityLabel="Start new chat">
            <Ionicons name="add" size={14} color="#FFFFFF" />
            <Text style={styles.newPillText}>New</Text>
          </TouchableOpacity>
        ) : <View style={{ width: 60 }} />}
      </View>
      <View style={styles.subHeader}>
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
              <ActivityIndicator color={c.brandPrimary} />
            </View>
          ) : (
            <>
              {showResume && turns.length > 0 ? (
                <View style={styles.resumeCard} testID="chat-resume-card">
                  <View style={styles.resumeIcon}>
                    <Ionicons name="chatbubbles" size={18} color={c.brandPrimary} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.resumeTitle}>Welcome back</Text>
                    <Text style={styles.resumeBody}>You have {turns.length} message{turns.length === 1 ? '' : 's'} from last time. Pick up where you left off, or start a fresh chat.</Text>
                    <View style={styles.resumeRow}>
                      <TouchableOpacity onPress={continueChat} style={[styles.resumeBtn, styles.resumeBtnPrimary]} testID="chat-resume-continue">
                        <Text style={styles.resumeBtnTextPrimary}>Continue</Text>
                      </TouchableOpacity>
                      <TouchableOpacity onPress={startFresh} style={[styles.resumeBtn, styles.resumeBtnGhost]} testID="chat-resume-fresh">
                        <Text style={styles.resumeBtnTextGhost}>Start fresh</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                </View>
              ) : null}
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
                      <Ionicons name="arrow-forward" size={14} color={c.brandPrimary} />
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
                    <ActivityIndicator color={c.brandPrimary} size="small" />
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
            placeholderTextColor={c.textMuted}
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
            <Ionicons name="arrow-up" size={20} color={c.cream} />
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function makeStyles(c: ColorPalette) { return StyleSheet.create({
  safe: { flex: 1, backgroundColor: c.background },
  // New teal banner header
  tealBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: c.brandPrimary,
    paddingHorizontal: Spacing.md, paddingVertical: 10,
    minHeight: 52, gap: 8,
  },
  backPill: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 10, paddingVertical: 7,
    borderRadius: 9999,
    backgroundColor: 'rgba(255,255,255,0.16)',
    minHeight: 34,
  },
  backPillText: { color: '#FFFFFF', fontFamily: Fonts.bodySemi, fontSize: 13 },
  tealTitleWrap: { flex: 1, alignItems: 'center' },
  tealTitle: { color: '#FFFFFF', fontFamily: Fonts.heading, fontSize: 18, letterSpacing: -0.2 },
  newPill: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 10, paddingVertical: 7,
    borderRadius: 9999,
    backgroundColor: 'rgba(255,255,255,0.16)',
    minHeight: 34,
  },
  newPillText: { color: '#FFFFFF', fontFamily: Fonts.bodySemi, fontSize: 12 },
  subHeader: {
    paddingHorizontal: Spacing.lg, paddingVertical: 10,
    backgroundColor: c.cardBg, borderBottomWidth: 1, borderBottomColor: c.borderSubtle,
  },
  header: { flexDirection: 'row', alignItems: 'flex-start', paddingHorizontal: Spacing.lg, paddingTop: Spacing.md, paddingBottom: Spacing.md, borderBottomWidth: 1, borderBottomColor: c.borderSubtle, gap: 12 },
  backBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: c.background, borderWidth: 1, borderColor: c.borderSubtle, marginTop: 2 },
  newBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 100, backgroundColor: c.background, borderWidth: 1, borderColor: c.border, minHeight: 36 },
  newBtnText: { fontFamily: Fonts.bodySemi, fontSize: 12, color: c.brandPrimary },
  resumeCard: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, padding: Spacing.md, marginBottom: Spacing.md, borderRadius: Radius.md, backgroundColor: 'rgba(183, 121, 31, 0.08)', borderWidth: 1, borderColor: 'rgba(183, 121, 31, 0.35)' },
  resumeIcon: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(14, 77, 82, 0.08)' },
  resumeTitle: { fontFamily: Fonts.bodySemi, fontSize: 14, color: c.brandPrimary },
  resumeBody: { fontFamily: Fonts.body, fontSize: 12, color: c.textSecondary, marginTop: 2, lineHeight: 17 },
  resumeRow: { flexDirection: 'row', gap: 8, marginTop: 10 },
  resumeBtn: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 100, minHeight: 36, alignItems: 'center', justifyContent: 'center' },
  resumeBtnPrimary: { backgroundColor: c.brandPrimary },
  resumeBtnGhost: { backgroundColor: 'transparent', borderWidth: 1, borderColor: c.border },
  resumeBtnTextPrimary: { fontFamily: Fonts.bodySemi, fontSize: 13, color: c.cream },
  resumeBtnTextGhost: { fontFamily: Fonts.bodySemi, fontSize: 13, color: c.brandPrimary },
  overline: { fontFamily: Fonts.bodyMed, fontSize: 11, letterSpacing: 1.5, textTransform: 'uppercase', color: c.textMuted },
  h1: { fontFamily: Fonts.heading, fontSize: 22, color: c.brandPrimary, letterSpacing: -0.5, marginTop: 2 },
  sub: { fontFamily: Fonts.body, fontSize: 12, color: c.textSecondary, marginTop: 4 },
  scroll: { padding: Spacing.lg, paddingBottom: Spacing.lg, gap: Spacing.sm },
  loadingFill: { padding: Spacing.xl, alignItems: 'center' },
  starterTitle: { fontFamily: Fonts.bodyMed, fontSize: 12, color: c.textMuted, textTransform: 'uppercase', letterSpacing: 1, marginBottom: Spacing.sm },
  starter: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: c.cardBg, padding: Spacing.md, borderRadius: Radius.md,
    marginBottom: 8, borderWidth: 1, borderColor: c.borderSubtle,
  },
  starterText: { fontFamily: Fonts.bodyMed, fontSize: 14, color: c.brandPrimary, flex: 1, marginRight: 8 },
  bubbleRow: { flexDirection: 'row', marginVertical: 4 },
  bubbleRowLeft: { justifyContent: 'flex-start' },
  bubbleRowRight: { justifyContent: 'flex-end' },
  bubble: { maxWidth: '82%', paddingHorizontal: 14, paddingVertical: 10, borderRadius: 18 },
  bubbleUser: { backgroundColor: c.brandPrimary, borderBottomRightRadius: 4 },
  bubbleAssistant: { backgroundColor: c.cardBg, borderBottomLeftRadius: 4, borderWidth: 1, borderColor: c.borderSubtle },
  bubbleTextUser: { fontFamily: Fonts.body, fontSize: 14, color: c.cream, lineHeight: 20 },
  bubbleTextAsst: { fontFamily: Fonts.body, fontSize: 14, color: c.textPrimary, lineHeight: 20 },
  composer: {
    flexDirection: 'row', alignItems: 'flex-end', padding: Spacing.md, gap: 8,
    backgroundColor: c.cardBg, borderTopWidth: 1, borderTopColor: c.borderSubtle,
  },
  input: {
    flex: 1, fontFamily: Fonts.body, fontSize: 15, color: c.textPrimary,
    backgroundColor: c.background, borderRadius: 22, paddingHorizontal: 16, paddingVertical: 10,
    maxHeight: 120, minHeight: 44, borderWidth: 1, borderColor: c.border,
  },
  sendBtn: {
    width: 44, height: 44, borderRadius: 22, backgroundColor: c.brandPrimary,
    alignItems: 'center', justifyContent: 'center',
  },
}); }
