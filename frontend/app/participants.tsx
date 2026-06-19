// Participants — list + add + remove (soft-delete with undo) + edit.
import React, { useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View, Modal, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import BackHeader from '../src/components/BackHeader';
import { useParticipants } from '../src/context/ParticipantsContext';
import { api } from '../src/lib/api';
import { Fonts, Radius, Spacing, Type } from '../src/lib/theme';
import type { ColorPalette } from '../src/lib/theme';
import { useColors } from '../src/hooks/useColors';
import { useThemedStyles } from '../src/hooks/useThemedStyles';
import { swatchForIndex, initialOf } from '../src/lib/format';
import { toast } from '../src/components/Toast';

export default function Participants() {
  const c = useColors();
  const styles = useThemedStyles(makeStyles);
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
        <View style={styles.heroWrap}>
          <View style={styles.heroRow}>
            <View style={{ flex: 1 }}>
              <View style={styles.titleRow}>
                <Text style={styles.h1}>Participants</Text>
                <View style={styles.countPill}>
                  <Text style={styles.countPillText}>{summary?.participants_active ?? participants.length} active</Text>
                </View>
              </View>
              <Text style={styles.subhero}>
                Anyone you&apos;re caring for who has their own Support at Home plan. Each gets their own statements, budget and care plan view.
              </Text>
            </View>
            {canAdd ? (
              <TouchableOpacity testID="add-participant" style={styles.addCta} onPress={() => setShowAdd(true)}>
                <Ionicons name="add" size={14} color="#FFFFFF" />
                <Text style={styles.addCtaText}>Add participant</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        </View>

        {participants.map((p) => {
          const sw = swatchForIndex(p.color_index);
          const pending = p.status === 'PENDING_REMOVAL';
          const fullName = `${p.first_name} ${p.last_name}`.trim();
          return (
            <View key={p.id} style={[styles.card, { borderLeftColor: sw }]} testID={`participant-${p.id}`}>
              <View style={styles.cardHead}>
                <View style={[styles.swatch, { backgroundColor: sw }]}>
                  <Text style={styles.initial}>{initialOf(p.first_name)}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.name} numberOfLines={1}>{fullName}</Text>
                  <Text style={styles.meta}>Classification {p.classification} · {p.provider_name}</Text>
                  <Text style={styles.coverage}>
                    Covered by <Text style={styles.coverageBold}>{summary?.base_plan === 'family' ? 'Family' : (summary?.base_plan ? summary.base_plan[0].toUpperCase() + summary.base_plan.slice(1) : 'your')} plan</Text>
                  </Text>
                </View>
                {p.is_primary && (
                  <View style={styles.primaryPill}>
                    <Ionicons name="star" size={10} color="#5C3D11" />
                    <Text style={styles.primaryText}>PRIMARY</Text>
                  </View>
                )}
              </View>

              <View style={styles.emailPill}>
                <Ionicons name="mail-outline" size={11} color={c.textSecondary} />
                <Text style={styles.emailText} numberOfLines={1}>{p.contact_email || '—'}</Text>
              </View>

              {pending && <Text style={styles.pending}>Removal scheduled — restorable for 30 days</Text>}

              <View style={styles.actions}>
                <TouchableOpacity
                  style={styles.actionBtn}
                  onPress={() => router.push(`/timeline?participant=${p.id}` as any)}
                  testID={`participant-timeline-${p.id}`}
                >
                  <Ionicons name="calendar-outline" size={14} color={c.brandPrimary} />
                  <Text style={styles.actionText}>Timeline</Text>
                </TouchableOpacity>
                <View style={styles.actionDivider} />
                {pending ? (
                  <TouchableOpacity
                    style={styles.actionBtn}
                    testID={`participant-restore-${p.id}`}
                    onPress={() => restore(p.id)}
                  >
                    <Ionicons name="refresh" size={14} color={c.brandPrimary} />
                    <Text style={styles.actionText}>Restore</Text>
                  </TouchableOpacity>
                ) : (
                  <TouchableOpacity
                    style={styles.actionBtn}
                    onPress={() => router.push(`/participants/${p.id}` as any)}
                    testID={`participant-edit-${p.id}`}
                  >
                    <Ionicons name="create-outline" size={14} color={c.brandPrimary} />
                    <Text style={styles.actionText}>Edit details</Text>
                  </TouchableOpacity>
                )}
                {!pending && (
                  <>
                    <View style={styles.actionDivider} />
                    <TouchableOpacity
                      style={styles.actionBtn}
                      testID={`participant-remove-${p.id}`}
                      onPress={() => remove(p.id, !!p.is_primary)}
                    >
                      <Ionicons name="trash-outline" size={14} color={c.severityAlert} />
                      <Text style={[styles.actionText, { color: c.severityAlert }]}>Remove</Text>
                    </TouchableOpacity>
                  </>
                )}
              </View>
            </View>
          );
        })}

        {!canAdd && (
          <View style={styles.limitCard}>
            <Text style={styles.limitText}>You&apos;ve hit the participant cap on your {summary?.base_plan || 'current'} plan.</Text>
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
          <TextInput value={first} onChangeText={setFirst} placeholder="First name" placeholderTextColor={c.textMuted} style={styles.input} />
          <TextInput value={last} onChangeText={setLast} placeholder="Last name (optional)" placeholderTextColor={c.textMuted} style={styles.input} />
          <TextInput value={provider} onChangeText={setProvider} placeholder="Provider name" placeholderTextColor={c.textMuted} style={styles.input} />
          <TextInput value={cls} onChangeText={setCls} placeholder="Classification (1‑8)" placeholderTextColor={c.textMuted} style={styles.input} keyboardType="number-pad" />
          <TouchableOpacity onPress={submit} disabled={busy} style={[styles.submit, busy && { opacity: 0.6 }]} testID="submit-participant">
            <Text style={styles.submitText}>{busy ? 'Adding…' : 'Add participant'}</Text>
          </TouchableOpacity>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function makeStyles(c: ColorPalette) { return StyleSheet.create({
  safe: { flex: 1, backgroundColor: c.bg },
  heroWrap: { paddingHorizontal: Spacing.lg, paddingTop: Spacing.md, paddingBottom: Spacing.sm },
  heroRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  h1: { fontFamily: Fonts.heading, fontSize: 26, color: c.brandPrimary, letterSpacing: -0.5, lineHeight: 32 },
  countPill: { backgroundColor: 'rgba(14, 77, 82, 0.10)', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999 },
  countPillText: { fontFamily: Fonts.bodySemi, fontSize: 11, color: c.brandPrimary, letterSpacing: 0.3 },
  subhero: { fontFamily: Fonts.body, fontSize: 13, color: c.textSecondary, marginTop: 6, lineHeight: 19 },
  addCta: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#A5512B', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, minHeight: 34 },
  addCtaText: { fontFamily: Fonts.bodySemi, fontSize: 12, color: '#FFFFFF' },

  card: { backgroundColor: c.cardBg, borderRadius: Radius.lg, padding: Spacing.md, marginHorizontal: Spacing.md, marginTop: 10, borderWidth: 1, borderColor: c.border, borderLeftWidth: 3 },
  cardHead: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  swatch: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  initial: { color: '#fff', fontFamily: Fonts.bodySemi, fontWeight: '700', fontSize: 16 },
  name: { ...Type.bodySemi, color: c.textPrimary, fontSize: 17 },
  meta: { ...Type.caption, color: c.textSecondary, marginTop: 2 },
  coverage: { fontFamily: Fonts.body, fontSize: 12, color: '#A5512B', marginTop: 4 },
  coverageBold: { fontFamily: Fonts.bodySemi, color: '#A5512B' },
  primaryPill: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: '#F9E5C4', borderRadius: 9999, paddingHorizontal: 8, paddingVertical: 3 },
  primaryText: { color: '#5C3D11', fontFamily: Fonts.bodySemi, fontSize: 10, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.4 },
  pending: { ...Type.caption, color: c.warning, marginTop: 6 },

  emailPill: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', backgroundColor: c.bg, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, marginTop: 10, borderWidth: 1, borderColor: c.borderSubtle },
  emailText: { fontFamily: Fonts.body, fontSize: 11, color: c.textSecondary },

  actions: { flexDirection: 'row', alignItems: 'center', borderTopWidth: 1, borderTopColor: c.borderSubtle, marginTop: 12, paddingTop: 10 },
  actionBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, paddingVertical: 6, minHeight: 36 },
  actionDivider: { width: 1, height: 18, backgroundColor: c.borderSubtle },
  actionText: { fontFamily: Fonts.bodyMed, fontSize: 12, color: c.brandPrimary },

  limitCard: { marginTop: 14, marginHorizontal: Spacing.md, padding: Spacing.md, borderRadius: 14, borderWidth: 1, borderColor: c.border, backgroundColor: '#FAF1E0', gap: 8 },
  limitText: { ...Type.body, color: c.textPrimary },
  limitCta: { color: c.brandPrimary, fontFamily: Fonts.bodySemi, fontWeight: '700', textDecorationLine: 'underline' },

  backdrop: { flex: 1, backgroundColor: 'rgba(14,30,32,0.55)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: c.cardBg, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: Spacing.lg, paddingBottom: 30, gap: 10 },
  handle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 999, backgroundColor: '#D3C9BB', marginBottom: 6 },
  sheetTitle: { ...Type.h3, color: c.textPrimary, marginBottom: 6 },
  input: { borderWidth: 1, borderColor: c.border, borderRadius: 10, padding: 12, fontFamily: Fonts.body, color: c.textPrimary },
  submit: { backgroundColor: c.brandPrimary, paddingVertical: 14, borderRadius: 9999, alignItems: 'center', marginTop: 4 },
  submitText: { color: '#fff', fontFamily: Fonts.bodySemi, fontWeight: '700' },
}); }
