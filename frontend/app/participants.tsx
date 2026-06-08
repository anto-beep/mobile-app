// Participants — list + add + remove (soft-delete with undo) + edit.
import React, { useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View, Modal, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import BackHeader from '../src/components/BackHeader';
import { useParticipants } from '../src/context/ParticipantsContext';
import { api } from '../src/lib/api';
import { Colors, Fonts, Radius, Spacing, Type } from '../src/lib/theme';
import { swatchForIndex, initialOf } from '../src/lib/format';
import { toast } from '../src/components/Toast';

export default function Participants() {
  const router = useRouter();
  const { participants, summary, refetch } = useParticipants();
  const [showAdd, setShowAdd] = useState(false);

  const canAdd = summary == null || summary.participants_active < summary.participants_max;
  const seatBadge = summary ? `${summary.participants_active} / ${summary.participants_max}` : '—';

  async function remove(id: string, isPrimary: boolean) {
    if (isPrimary && participants.length > 1) {
      Alert.alert('Choose a primary first', 'Promote another participant to primary, then remove this one.');
      return;
    }
    Alert.alert('Remove participant?', 'They’ll be restorable for 30 days.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: async () => {
        try { await api.delete(`/participants/${id}`); toast.success('Removal scheduled'); refetch(); }
        catch (e: any) { Alert.alert('Could not remove', e?.response?.data?.detail || e?.message); }
      } },
    ]);
  }

  async function restore(id: string) {
    try { await api.post(`/participants/${id}/undo-removal`, {}); toast.success('Restored'); refetch(); }
    catch (e: any) { Alert.alert('Could not restore', e?.response?.data?.detail || e?.message); }
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <BackHeader title="Participants" />
      <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
        <View style={styles.head}>
          <Text style={styles.headSub}>You’ve used <Text style={{ fontFamily: Fonts.bodySemi }}>{seatBadge}</Text> participant slots on your {summary?.base_plan || 'plan'} plan.</Text>
        </View>

        {participants.map((p) => {
          const sw = swatchForIndex(p.color_index);
          const pending = p.status === 'PENDING_REMOVAL';
          return (
            <View key={p.id} style={[styles.card, { borderLeftColor: sw }]}>
              <View style={[styles.swatch, { backgroundColor: sw }]}><Text style={styles.initial}>{initialOf(p.first_name)}</Text></View>
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Text style={styles.name}>{`${p.first_name} ${p.last_name}`.trim()}</Text>
                  {p.is_primary && <View style={styles.pill}><Text style={styles.pillText}>Primary</Text></View>}
                </View>
                <Text style={styles.meta}>L{p.classification} · {p.provider_name}</Text>
                {pending && <Text style={styles.pending}>Removal scheduled — restorable for 30 days</Text>}
              </View>
              {pending ? (
                <TouchableOpacity testID={`participant-restore-${p.id}`} onPress={() => restore(p.id)}><Ionicons name="refresh" size={20} color={Colors.brandPrimary} /></TouchableOpacity>
              ) : (
                <TouchableOpacity testID={`participant-remove-${p.id}`} onPress={() => remove(p.id, !!p.is_primary)} hitSlop={6}><Ionicons name="trash-outline" size={18} color={Colors.brandSecondary} /></TouchableOpacity>
              )}
            </View>
          );
        })}

        {canAdd ? (
          <TouchableOpacity testID="add-participant" style={styles.addBtn} onPress={() => setShowAdd(true)}>
            <Ionicons name="add" size={18} color={Colors.brandPrimary} />
            <Text style={styles.addText}>Add a participant</Text>
          </TouchableOpacity>
        ) : (
          <View style={[styles.limitCard]}>
            <Text style={styles.limitText}>You’ve hit the participant cap on your {summary?.base_plan || 'current'} plan.</Text>
            <TouchableOpacity onPress={() => router.push('/settings/plan' as any)}>
              <Text style={styles.limitCta}>Upgrade plan</Text>
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>

      <AddParticipantSheet open={showAdd} onClose={() => setShowAdd(false)} onCreated={() => { setShowAdd(false); refetch(); }} />
    </SafeAreaView>
  );
}

function AddParticipantSheet({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const [first, setFirst] = useState('');
  const [last, setLast] = useState('');
  const [provider, setProvider] = useState('Your provider');
  const [cls, setCls] = useState('4');
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!first.trim()) { Alert.alert('First name required'); return; }
    const c = parseInt(cls, 10);
    if (!Number.isFinite(c) || c < 1 || c > 8) { Alert.alert('Classification 1‑8 only'); return; }
    setBusy(true);
    try {
      await api.post('/participants', { first_name: first.trim(), last_name: last.trim(), provider_name: provider.trim(), classification: c });
      toast.success('Participant added');
      setFirst(''); setLast(''); setProvider('Your provider'); setCls('4');
      onCreated();
    } catch (e: any) {
      Alert.alert('Could not add', e?.response?.data?.detail || e?.message);
    } finally { setBusy(false); }
  }

  return (
    <Modal visible={open} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
          <View style={styles.handle} />
          <Text style={styles.sheetTitle}>Add a participant</Text>
          <TextInput value={first} onChangeText={setFirst} placeholder="First name" placeholderTextColor={Colors.textMuted} style={styles.input} />
          <TextInput value={last} onChangeText={setLast} placeholder="Last name (optional)" placeholderTextColor={Colors.textMuted} style={styles.input} />
          <TextInput value={provider} onChangeText={setProvider} placeholder="Provider name" placeholderTextColor={Colors.textMuted} style={styles.input} />
          <TextInput value={cls} onChangeText={setCls} placeholder="Classification (1‑8)" placeholderTextColor={Colors.textMuted} style={styles.input} keyboardType="number-pad" />
          <TouchableOpacity onPress={submit} disabled={busy} style={[styles.submit, busy && { opacity: 0.6 }]} testID="submit-participant">
            <Text style={styles.submitText}>{busy ? 'Adding…' : 'Add participant'}</Text>
          </TouchableOpacity>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.bg },
  head: { paddingHorizontal: Spacing.lg, paddingTop: Spacing.md, paddingBottom: 6 },
  headSub: { ...Type.body, color: Colors.textSecondary },
  card: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: Colors.cardBg, borderRadius: Radius.lg, padding: Spacing.md, marginHorizontal: Spacing.md, marginTop: 8, borderWidth: 1, borderColor: Colors.border, borderLeftWidth: 3 },
  swatch: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  initial: { color: '#fff', fontFamily: Fonts.bodySemi, fontWeight: '700', fontSize: 16 },
  name: { ...Type.bodySemi, color: Colors.textPrimary, fontSize: 16 },
  meta: { ...Type.caption, color: Colors.textSecondary, marginTop: 2 },
  pending: { ...Type.caption, color: Colors.warning, marginTop: 2 },
  pill: { backgroundColor: '#F9E5C4', borderRadius: 9999, paddingHorizontal: 8, paddingVertical: 2 },
  pillText: { color: '#5C3D11', fontFamily: Fonts.bodySemi, fontSize: 10, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.4 },
  addBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 14, marginHorizontal: Spacing.md, paddingVertical: 14, borderRadius: 9999, borderWidth: 1.5, borderColor: Colors.brandPrimary },
  addText: { color: Colors.brandPrimary, fontFamily: Fonts.bodySemi, fontWeight: '700' },
  limitCard: { marginTop: 14, marginHorizontal: Spacing.md, padding: Spacing.md, borderRadius: 14, borderWidth: 1, borderColor: Colors.border, backgroundColor: '#FAF1E0', gap: 8 },
  limitText: { ...Type.body, color: Colors.textPrimary },
  limitCta: { color: Colors.brandPrimary, fontFamily: Fonts.bodySemi, fontWeight: '700', textDecorationLine: 'underline' },

  backdrop: { flex: 1, backgroundColor: 'rgba(14,30,32,0.55)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: Colors.cardBg, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: Spacing.lg, paddingBottom: 30, gap: 10 },
  handle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 999, backgroundColor: '#D3C9BB', marginBottom: 6 },
  sheetTitle: { ...Type.h3, color: Colors.textPrimary, marginBottom: 6 },
  input: { borderWidth: 1, borderColor: Colors.border, borderRadius: 10, padding: 12, fontFamily: Fonts.body, color: Colors.textPrimary },
  submit: { backgroundColor: Colors.brandPrimary, paddingVertical: 14, borderRadius: 9999, alignItems: 'center', marginTop: 4 },
  submitText: { color: '#fff', fontFamily: Fonts.bodySemi, fontWeight: '700' },
});
