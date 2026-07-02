// Private Provider Ratings — mobile parity with the web app.
//
// Web layout (single row): Provider name | Stars | Would-recommend | + Save
// On 390px width we stack the controls vertically inside a single card,
// keeping all the same fields:
//   • Provider name input
//   • Stars row (label + 5 tappable stars)
//   • "Would recommend" checkbox
//   • Comment (what worked, what didn't) — multiline
//   • + Save (full-width primary button)
// Below the card: empty state OR list of past ratings (newest first).
import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
  Alert,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { Ionicons } from '@expo/vector-icons';
import { useApi } from '../src/lib/useApi';
import { api, extractErrorMessage } from '../src/lib/api';
import BackHeader from '../src/components/BackHeader';
import { toast } from '../src/components/Toast';
import { formatAUDate } from '../src/lib/format';
import { Fonts, Radius, Spacing } from '../src/lib/theme';
import type { ColorPalette } from '../src/lib/theme';
import { useColors } from '../src/hooks/useColors';
import { useThemedStyles } from '../src/hooks/useThemedStyles';

type Rating = {
  id: string;
  provider_name?: string;
  score: number;
  would_recommend?: boolean;
  comment?: string;
  created_at?: string;
};

const STAR_TINT = '#A5512B';

export default function Ratings() {
  const c = useColors();
  const styles = useThemedStyles(makeStyles);
  const { data, loading, refreshing, refresh } = useApi<{ items: Rating[] }>('/ratings');
  const items = data?.items || [];

  const [providerName, setProviderName] = useState('');
  const [score, setScore] = useState(0);
  const [wouldRecommend, setWouldRecommend] = useState(true);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = useCallback(async () => {
    if (!providerName.trim()) { toast.warning('Add a provider name.'); return; }
    if (!score) { toast.warning('Pick a 1-5 star rating.'); return; }
    setBusy(true);
    try {
      await api.post('/ratings', {
        provider_name: providerName.trim(),
        score,
        would_recommend: wouldRecommend,
        comment: comment.trim() || undefined,
      });
      setProviderName(''); setScore(0); setWouldRecommend(true); setComment('');
      await refresh();
      toast.success('Rating saved.');
    } catch (e) {
      toast.error(extractErrorMessage(e, "Could not save the rating."));
    } finally { setBusy(false); }
  }, [providerName, score, wouldRecommend, comment, refresh]);

  const remove = useCallback(async (r: Rating) => {
    const doDelete = async () => {
      try {
        await api.delete(`/ratings/${r.id}`);
        await refresh();
        toast.success('Rating removed.');
      } catch (e) {
        toast.error(extractErrorMessage(e, "Could not remove rating."));
      }
    };
    if (Platform.OS === 'web') {
      // eslint-disable-next-line no-alert
      if (typeof window !== 'undefined' && window.confirm(`Remove your ${r.score}-star rating for ${r.provider_name || 'this provider'}?`)) doDelete();
    } else {
      Alert.alert('Remove rating?', `Your ${r.score}-star rating for ${r.provider_name || 'this provider'}.`, [
        { text: 'Keep', style: 'cancel' },
        { text: 'Remove', style: 'destructive', onPress: doDelete },
      ]);
    }
  }, [refresh]);

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <BackHeader title="Provider ratings" />
      <KeyboardAwareScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        bottomOffset={24}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={c.brandPrimary} />}
      >
        <Text style={styles.overline}>Private provider ratings</Text>
        <Text style={styles.h1}>Your own honest opinions on providers</Text>
        <Text style={styles.sub}>
          These ratings are private to you, not shared with providers or other Wayly users. Use them as a memory aid when comparing or switching.
        </Text>

        {/* Composer */}
        <View style={styles.card}>
          <Text style={styles.lbl}>Provider name</Text>
          <TextInput
            style={styles.input}
            value={providerName}
            onChangeText={setProviderName}
            placeholder="e.g. SilverCare Plus"
            placeholderTextColor={c.textMuted}
            editable={!busy}
            testID="rating-provider"
          />

          <View style={styles.starsRow}>
            <Text style={styles.starsLabel}>Stars:</Text>
            <View style={styles.starsGroup}>
              {[1, 2, 3, 4, 5].map((n) => (
                <TouchableOpacity
                  key={n}
                  onPress={() => setScore(n)}
                  hitSlop={6}
                  accessibilityLabel={`${n} star${n === 1 ? '' : 's'}`}
                  testID={`rating-star-${n}`}
                >
                  <Ionicons
                    name={n <= score ? 'star' : 'star-outline'}
                    size={28}
                    color={n <= score ? STAR_TINT : STAR_TINT}
                  />
                </TouchableOpacity>
              ))}
            </View>
          </View>

          <TouchableOpacity
            style={styles.checkRow}
            onPress={() => setWouldRecommend((v) => !v)}
            activeOpacity={0.8}
            testID="rating-recommend"
            accessibilityRole="checkbox"
            accessibilityState={{ checked: wouldRecommend }}
          >
            <View style={[styles.checkbox, wouldRecommend && styles.checkboxChecked]}>
              {wouldRecommend ? <Ionicons name="checkmark" size={14} color="#FFFFFF" /> : null}
            </View>
            <Text style={styles.checkLabel}>Would recommend</Text>
          </TouchableOpacity>

          <TextInput
            style={[styles.input, styles.textArea]}
            value={comment}
            onChangeText={setComment}
            placeholder="Comment (what worked, what did not)"
            placeholderTextColor={c.textMuted}
            multiline
            editable={!busy}
            testID="rating-comment"
          />

          <TouchableOpacity
            style={[styles.cta, (busy || !providerName.trim() || !score) && { opacity: 0.6 }]}
            onPress={submit}
            disabled={busy || !providerName.trim() || !score}
            testID="rating-save"
          >
            {busy ? <ActivityIndicator color="#FFFFFF" /> : (<>
              <Ionicons name="add" size={14} color="#FFFFFF" />
              <Text style={styles.ctaText}>Save</Text>
            </>)}
          </TouchableOpacity>
        </View>

        {/* Past ratings */}
        {loading ? (
          <ActivityIndicator color={c.brandPrimary} style={{ paddingVertical: 32 }} />
        ) : items.length === 0 ? (
          <View style={styles.emptyCard}>
            <Ionicons name="star-outline" size={28} color={c.textMuted} />
            <Text style={styles.emptyTitle}>No ratings yet</Text>
            <Text style={styles.emptyBody}>Add your honest 1 to 5 star rating for each provider you have worked with.</Text>
          </View>
        ) : items.map((r) => (
          <View key={r.id} style={styles.row} testID={`rating-${r.id}`}>
            <View style={{ flex: 1 }}>
              <View style={styles.rowHeader}>
                <Text style={styles.provider} numberOfLines={1}>{r.provider_name || 'Unnamed provider'}</Text>
                <View style={styles.starsCompact}>
                  {[1, 2, 3, 4, 5].map((n) => (
                    <Ionicons key={n} name={n <= r.score ? 'star' : 'star-outline'} size={14} color={STAR_TINT} />
                  ))}
                </View>
              </View>
              {!!r.comment && <Text style={styles.commentText} numberOfLines={3}>{r.comment}</Text>}
              <View style={styles.metaRow}>
                {r.would_recommend ? (
                  <View style={styles.recommendPill}>
                    <Ionicons name="thumbs-up-outline" size={11} color="#3A5F37" />
                    <Text style={styles.recommendText}>Would recommend</Text>
                  </View>
                ) : (
                  <View style={[styles.recommendPill, styles.notRecommendPill]}>
                    <Ionicons name="thumbs-down-outline" size={11} color="#A54030" />
                    <Text style={[styles.recommendText, { color: '#A54030' }]}>Would not</Text>
                  </View>
                )}
                {!!r.created_at && <Text style={styles.metaDate}>{formatAUDate(r.created_at)}</Text>}
              </View>
            </View>
            <TouchableOpacity onPress={() => remove(r)} style={styles.deleteBtn} hitSlop={6} testID={`rating-delete-${r.id}`}>
              <Ionicons name="trash-outline" size={16} color={c.severityAlert} />
            </TouchableOpacity>
          </View>
        ))}

        <View style={{ height: 32 }} />
      </KeyboardAwareScrollView>
    </SafeAreaView>
  );
}

function makeStyles(c: ColorPalette) { return StyleSheet.create({
  safe: { flex: 1, backgroundColor: c.background },
  scroll: { padding: Spacing.md, paddingBottom: 40 },

  overline: { fontFamily: Fonts.bodyMed, fontSize: 11, letterSpacing: 1.5, textTransform: 'uppercase', color: c.textMuted },
  h1: { fontFamily: Fonts.heading, fontSize: 26, color: c.brandPrimary, letterSpacing: -0.4, marginTop: 4, lineHeight: 32 },
  sub: { fontFamily: Fonts.body, fontSize: 13, color: c.textSecondary, marginTop: 6, marginBottom: Spacing.lg, lineHeight: 19 },

  card: {
    backgroundColor: c.cardBg, borderRadius: Radius.lg,
    borderWidth: 1, borderColor: c.borderSubtle,
    padding: Spacing.md, marginBottom: Spacing.lg, gap: Spacing.sm,
  },
  lbl: { fontFamily: Fonts.bodyMed, fontSize: 11, letterSpacing: 0.6, color: c.textSecondary, textTransform: 'uppercase' },
  input: {
    fontFamily: Fonts.body, fontSize: 14, color: c.textPrimary,
    backgroundColor: '#FFFFFF', borderRadius: Radius.sm,
    borderWidth: 1, borderColor: c.borderSubtle,
    paddingHorizontal: 12, paddingVertical: 11, minHeight: 44,
  },
  textArea: { minHeight: 90, textAlignVertical: 'top', paddingTop: 12 },

  starsRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 4 },
  starsLabel: { fontFamily: Fonts.bodySemi, fontSize: 14, color: c.brandPrimary },
  starsGroup: { flexDirection: 'row', gap: 4 },

  checkRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6 },
  checkbox: {
    width: 20, height: 20, borderRadius: 4,
    borderWidth: 1.5, borderColor: c.borderSubtle,
    backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center',
  },
  checkboxChecked: { backgroundColor: '#4A6CF7', borderColor: '#4A6CF7' },
  checkLabel: { fontFamily: Fonts.bodyMed, fontSize: 14, color: c.brandPrimary },

  cta: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: c.brandPrimary, borderRadius: Radius.md,
    paddingVertical: 14, minHeight: 48, marginTop: 4,
  },
  ctaText: { fontFamily: Fonts.bodySemi, fontSize: 14, color: '#FFFFFF' },

  emptyCard: {
    padding: Spacing.lg, alignItems: 'center', gap: 8,
    backgroundColor: c.cardBg, borderRadius: Radius.md,
    borderWidth: 1, borderColor: c.borderSubtle,
  },
  emptyTitle: { fontFamily: Fonts.heading, fontSize: 20, color: c.brandPrimary, marginTop: 6, letterSpacing: -0.3 },
  emptyBody: { fontFamily: Fonts.body, fontSize: 13, color: c.textSecondary, textAlign: 'center', lineHeight: 19 },

  // Past rating row
  row: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10,
    backgroundColor: c.cardBg, borderRadius: Radius.md,
    borderWidth: 1, borderColor: c.borderSubtle,
    padding: Spacing.md, marginBottom: 8,
  },
  rowHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  provider: { fontFamily: Fonts.bodySemi, fontSize: 14, color: c.brandPrimary, flex: 1 },
  starsCompact: { flexDirection: 'row', gap: 2 },
  commentText: { fontFamily: Fonts.body, fontSize: 13, color: c.textPrimary, marginTop: 4, lineHeight: 19 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6 },
  recommendPill: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999,
    backgroundColor: 'rgba(58, 95, 55, 0.10)',
  },
  notRecommendPill: { backgroundColor: 'rgba(165, 64, 48, 0.10)' },
  recommendText: { fontFamily: Fonts.bodySemi, fontSize: 11, color: '#3A5F37' },
  metaDate: { fontFamily: Fonts.body, fontSize: 11, color: c.textSecondary },
  deleteBtn: { padding: 6 },
}); }
