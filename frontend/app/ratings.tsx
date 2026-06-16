import React, { useState } from 'react';
import { Alert, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { EmptyState, ListCard, ScreenShell } from '../src/components/Screen';
import { useApi } from '../src/lib/useApi';
import { api } from '../src/lib/api';
import { Colors, Fonts, Spacing, Type } from '../src/lib/theme';
import { Ionicons } from '@expo/vector-icons';
import { toast } from '../src/components/Toast';
import { formatAUDate } from '../src/lib/format';

export default function Ratings() {
  const { data, loading, refreshing, refresh } = useApi<{ items: any[] }>('/ratings');
  const items = data?.items || [];
  const [score, setScore] = useState(0);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!score) { Alert.alert('Pick a score', '1‑5 stars please'); return; }
    setBusy(true);
    try {
      await api.post('/ratings', { score, comment });
      setScore(0); setComment('');
      toast.success('Rating submitted');
      refresh();
    } catch (e: any) { Alert.alert('Could not submit', e?.message || 'Try again'); }
    finally { setBusy(false); }
  }

  return (
    <ScreenShell useBack title="Provider ratings" subtitle="How is your provider performing?" loading={loading} onRefresh={refresh} refreshing={refreshing}>
      <View style={styles.card}>
        <Text style={styles.title}>Add a rating</Text>
        <View style={styles.stars}>
          {[1,2,3,4,5].map((n) => (
            <TouchableOpacity key={n} onPress={() => setScore(n)} hitSlop={6}>
              <Ionicons name={n <= score ? 'star' : 'star-outline'} size={28} color={n <= score ? '#C8932B' : Colors.textMuted} />
            </TouchableOpacity>
          ))}
        </View>
        <TextInput
          style={styles.input}
          placeholder="Optional comment"
          placeholderTextColor={Colors.textMuted}
          value={comment}
          onChangeText={setComment}
          multiline
        />
        <TouchableOpacity style={[styles.btn, busy && { opacity: 0.6 }]} onPress={submit} disabled={busy} testID="submit-rating">
          <Text style={styles.btnText}>{busy ? 'Saving…' : 'Submit rating'}</Text>
        </TouchableOpacity>
      </View>
      {items.length === 0 ? (
        <EmptyState icon="star-outline" title="No ratings yet" body="Quarterly ratings help spot performance trends and back you up if you ever switch providers." />
      ) : items.map((r) => (
        <ListCard key={r.id} title={'★'.repeat(r.score)} subtitle={`${r.comment || '—'} · ${formatAUDate(r.created_at)}`} />
      ))}
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: Colors.cardBg, borderWidth: 1, borderColor: Colors.border, borderRadius: 14, padding: Spacing.md, marginHorizontal: Spacing.md, marginBottom: Spacing.md, gap: Spacing.sm },
  title: { ...Type.bodySemi, color: Colors.textPrimary },
  stars: { flexDirection: 'row', gap: 6 },
  input: { borderWidth: 1, borderColor: Colors.border, borderRadius: 10, padding: 12, fontFamily: Fonts.body, color: Colors.textPrimary, minHeight: 60 },
  btn: { backgroundColor: Colors.brandPrimary, paddingVertical: 12, borderRadius: 9999, alignItems: 'center' },
  btnText: { color: '#fff', fontFamily: Fonts.bodySemi, fontWeight: '700' },
});
