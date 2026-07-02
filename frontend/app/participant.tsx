// Participant view — single big-tap wellbeing check-in
import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { api, extractErrorMessage } from '../src/lib/api';
import { Colors, Fonts, formatAUD, Radius, Spacing } from '../src/lib/theme';
import type { ColorPalette } from '../src/lib/theme';
import { useColors } from '../src/hooks/useColors';
import { useThemedStyles } from '../src/hooks/useThemedStyles';

type Today = {
  participant_name: string;
  today_label: string;
  appointment: { time: string; name: string; service: string; duration: string } | null;
  quarter_remaining: number;
  quarter_remaining_sentence: string;
  caregiver_name: string;
};

const MOOD_BTNS: { mood: 'good' | 'okay' | 'not_great'; label: string; sub: string; color: string; icon: any }[] = [
  { mood: 'good', label: 'Good', sub: 'Feeling well today', color: Colors.success, icon: 'happy-outline' },
  { mood: 'okay', label: 'Okay', sub: 'Just a normal day', color: Colors.brandSecondary, icon: 'remove-outline' },
  { mood: 'not_great', label: 'Not great', sub: "I'd like someone to check in", color: Colors.severityAlert, icon: 'sad-outline' },
];

export default function Participant() {
  const c = useColors();
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const [today, setToday] = useState<Today | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [submittedMood, setSubmittedMood] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const { data } = await api.get<Today>('/participant/today');
        setToday(data);
      } catch {
        // fall through
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const tap = async (mood: 'good' | 'okay' | 'not_great') => {
    setSubmitting(true);
    try {
      await api.post('/participant/wellbeing', {
        mood,
        notify_caregiver: mood === 'not_great',
      });
      setSubmittedMood(mood);
    } catch (e) {
      Alert.alert("Could not save", extractErrorMessage(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <TouchableOpacity onPress={() => router.back()} style={styles.back} testID="participant-back">
          <Ionicons name="chevron-back" size={20} color={c.brandPrimary} />
          <Text style={styles.backText}>Back</Text>
        </TouchableOpacity>

        <Text style={styles.overline}>Participant view</Text>
        <Text style={styles.h1} testID="participant-greeting">
          {today?.today_label || 'Today'}
        </Text>
        {today && (
          <Text style={styles.greeting}>
            Hello {today.participant_name}.
          </Text>
        )}

        {loading ? (
          <View style={styles.loadingFill}>
            <ActivityIndicator color={c.brandPrimary} />
          </View>
        ) : (
          <>
            {today?.appointment && (
              <View style={styles.appointmentCard} testID="participant-appointment">
                <Text style={styles.appointmentOverline}>Today at a glance</Text>
                <Text style={styles.appointmentTitle}>
                  {today.appointment.time}, {today.appointment.service}
                </Text>
                <Text style={styles.appointmentMeta}>
                  with {today.appointment.name} · {today.appointment.duration}
                </Text>
              </View>
            )}

            {today && (
              <View style={styles.budgetCard}>
                <Text style={styles.budgetOverline}>Quarter remaining</Text>
                <Text style={styles.budgetAmount}>{formatAUD(today.quarter_remaining)}</Text>
                <Text style={styles.budgetSentence}>{today.quarter_remaining_sentence}</Text>
              </View>
            )}

            <View style={styles.checkinSection}>
              <Text style={styles.sectionTitle}>How Are You Feeling Today?</Text>
              <Text style={styles.sectionSub}>
                One tap. {today?.caregiver_name || 'Your caregiver'} will see it.
              </Text>

              <View style={styles.moodGrid}>
                {MOOD_BTNS.map((m) => {
                  const isPicked = submittedMood === m.mood;
                  return (
                    <TouchableOpacity
                      key={m.mood}
                      style={[
                        styles.moodBtn,
                        { borderColor: isPicked ? m.color : c.borderSubtle },
                        isPicked && { backgroundColor: `${m.color}10` },
                      ]}
                      onPress={() => tap(m.mood)}
                      disabled={submitting}
                      testID={`wellbeing-${m.mood}`}
                    >
                      <Ionicons name={m.icon} size={36} color={m.color} />
                      <Text style={[styles.moodLabel, { color: m.color }]}>{m.label}</Text>
                      <Text style={styles.moodSub}>{m.sub}</Text>
                      {isPicked && (
                        <View style={styles.checkmark}>
                          <Ionicons name="checkmark-circle" size={20} color={m.color} />
                        </View>
                      )}
                    </TouchableOpacity>
                  );
                })}
              </View>

              {submittedMood && (
                <View style={styles.thanks} testID="wellbeing-thanks">
                  <Ionicons name="heart-outline" size={16} color={c.severityInfo} />
                  <Text style={styles.thanksText}>
                    Thanks for letting us know.
                    {submittedMood === 'not_great'
                      ? ` ${today?.caregiver_name || 'Your caregiver'} will see this and check in.`
                      : ''}
                  </Text>
                </View>
              )}
            </View>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function makeStyles(c: ColorPalette) { return StyleSheet.create({
  safe: { flex: 1, backgroundColor: c.background },
  scroll: { padding: Spacing.lg, paddingBottom: Spacing.xl },
  back: { flexDirection: 'row', alignItems: 'center', marginBottom: Spacing.md },
  backText: { fontFamily: Fonts.bodyMed, fontSize: 14, color: c.brandPrimary },
  overline: { fontFamily: Fonts.bodyMed, fontSize: 11, letterSpacing: 1.5, textTransform: 'uppercase', color: c.textMuted },
  h1: { fontFamily: Fonts.heading, fontSize: 26, color: c.brandPrimary, marginTop: 4, letterSpacing: -0.5 },
  greeting: { fontFamily: Fonts.body, fontSize: 18, color: c.textSecondary, marginTop: Spacing.sm, marginBottom: Spacing.lg },
  loadingFill: { padding: Spacing.xl, alignItems: 'center' },
  appointmentCard: {
    backgroundColor: 'rgba(183, 121, 31, 0.08)', borderRadius: Radius.lg,
    padding: Spacing.md + 4, marginBottom: Spacing.md, borderWidth: 1, borderColor: 'rgba(183, 121, 31, 0.3)',
  },
  appointmentOverline: { fontFamily: Fonts.bodyMed, fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', color: c.brandSecondary, marginBottom: 4 },
  appointmentTitle: { fontFamily: Fonts.headingMed, fontSize: 18, color: c.brandPrimary },
  appointmentMeta: { fontFamily: Fonts.body, fontSize: 13, color: c.textSecondary, marginTop: 4 },
  budgetCard: {
    backgroundColor: c.cardBg, borderRadius: Radius.lg, padding: Spacing.md + 4,
    marginBottom: Spacing.lg, borderWidth: 1, borderColor: c.borderSubtle,
  },
  budgetOverline: { fontFamily: Fonts.bodyMed, fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', color: c.textSecondary, marginBottom: 4 },
  budgetAmount: { fontFamily: Fonts.heading, fontSize: 32, color: c.brandPrimary, letterSpacing: -1 },
  budgetSentence: { fontFamily: Fonts.body, fontSize: 14, color: c.textSecondary, marginTop: 4, lineHeight: 20 },
  checkinSection: { marginTop: Spacing.md },
  sectionTitle: { fontFamily: Fonts.heading, fontSize: 22, color: c.brandPrimary, letterSpacing: -0.3 },
  sectionSub: { fontFamily: Fonts.body, fontSize: 13, color: c.textSecondary, marginTop: 4, marginBottom: Spacing.lg },
  moodGrid: { gap: Spacing.sm },
  moodBtn: {
    backgroundColor: c.cardBg, borderRadius: Radius.lg, padding: Spacing.lg,
    alignItems: 'center', gap: 8, borderWidth: 2, minHeight: 130, justifyContent: 'center',
    position: 'relative',
  },
  moodLabel: { fontFamily: Fonts.heading, fontSize: 22, letterSpacing: -0.3 },
  moodSub: { fontFamily: Fonts.body, fontSize: 13, color: c.textSecondary, textAlign: 'center' },
  checkmark: { position: 'absolute', top: 12, right: 12 },
  thanks: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: 'rgba(139, 155, 130, 0.1)', padding: Spacing.md, borderRadius: Radius.md,
    marginTop: Spacing.md,
  },
  thanksText: { fontFamily: Fonts.bodyMed, fontSize: 13, color: c.brandPrimary, flex: 1, lineHeight: 18 },
}); }
