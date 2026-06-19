// Switch provider — lifecycle screen with a Start-switch composer.
import React, { useCallback, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity, Modal, Pressable,
  ActivityIndicator, RefreshControl, KeyboardAvoidingView, Platform, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useApi } from '../src/lib/useApi';
import { api, extractErrorMessage } from '../src/lib/api';
import BackHeader from '../src/components/BackHeader';
import { toast } from '../src/components/Toast';
import { Colors, Fonts, Radius, Spacing } from '../src/lib/theme';

type Status = {
  in_progress?: boolean;
  current_provider?: string;
  new_provider?: string;
  reason?: string;
  status?: string;
  target_date?: string | null;
  created_at?: string;
};

const STATUS_PILL: Record<string, { tint: string; label: string }> = {
  DRAFT:       { tint: '#6B7C92', label: 'Draft' },
  NOTICE_SENT: { tint: '#C8932B', label: 'Notice sent' },
  AWAITING:    { tint: '#0E4D52', label: 'Awaiting handover' },
  COMPLETE:    { tint: '#3A5F37', label: 'Complete' },
  CANCELLED:   { tint: '#A54030', label: 'Cancelled' },
};

export default function ProviderSwitch() {
  const { data, loading, refreshing, refresh } = useApi<Status>('/provider-switch/status');

  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [newProvider, setNewProvider] = useState('');
  const [reason, setReason] = useState('');
  const [targetDate, setTargetDate] = useState<string | undefined>(undefined);

  const start = useCallback(async () => {
    if (!newProvider.trim()) { toast.warning('Tell us the new provider name.'); return; }
    setBusy(true);
    try {
      await api.post('/provider-switch/start', {
        new_provider: newProvider.trim(),
        reason: reason.trim() || undefined,
        target_date: targetDate || undefined,
      });
      setOpen(false); setNewProvider(''); setReason(''); setTargetDate(undefined);
      await refresh();
      toast.success('Switch started. Wayly will guide you through the next steps.');
    } catch (e) { toast.error(extractErrorMessage(e, "Couldn't start the switch")); }
    finally { setBusy(false); }
  }, [newProvider, reason, targetDate, refresh]);

  const cancel = useCallback(async () => {
    const doCancel = async () => {
      try {
        await api.post('/provider-switch/cancel');
        await refresh();
        toast.success('Switch cancelled.');
      } catch (e) { toast.error(extractErrorMessage(e, "Couldn't cancel.")); }
    };
    if (Platform.OS === 'web') {
      // eslint-disable-next-line no-alert
      if (typeof window !== 'undefined' && window.confirm('Cancel this provider switch?')) doCancel();
    } else {
      Alert.alert('Cancel switch?', 'You can start another one later.', [
        { text: 'Keep going', style: 'cancel' },
        { text: 'Cancel switch', style: 'destructive', onPress: doCancel },
      ]);
    }
  }, [refresh]);

  const inProgress = !!data?.in_progress;
  const m = STATUS_PILL[(data?.status || 'DRAFT').toUpperCase()] || STATUS_PILL.DRAFT;

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <BackHeader title="Switch provider" />
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={Colors.brandPrimary} />}
      >
        <View style={styles.heroRow}>
          <Ionicons name="swap-horizontal-outline" size={22} color={Colors.brandPrimary} />
          <Text style={styles.hero}>Switch provider</Text>
        </View>
        <Text style={styles.subhero}>Move services to a new aged-care provider. Wayly handles the notice letter, tracks unbilled hours and watches the budget transfer.</Text>

        <View style={styles.card}>
          <Text style={styles.lbl}>Currently with</Text>
          <Text style={styles.bigVal}>{data?.current_provider || 'Your provider'}</Text>
        </View>

        {loading && !data ? <ActivityIndicator color={Colors.brandPrimary} /> : !inProgress ? (
          <>
            <View style={styles.emptyCard}>
              <Ionicons name="swap-horizontal-outline" size={28} color={Colors.textMuted} />
              <Text style={styles.emptyTitle}>No switch in progress</Text>
              <Text style={styles.emptyBody}>Start one when you&apos;re ready — most switches take 30 days notice. We&apos;ll guide you through every step.</Text>
              <TouchableOpacity style={styles.cta} onPress={() => setOpen(true)} testID="provider-switch-start">
                <Ionicons name="flag-outline" size={14} color="#FFFFFF" />
                <Text style={styles.ctaText}>Start a switch</Text>
              </TouchableOpacity>
            </View>
          </>
        ) : (
          <View style={styles.progressCard}>
            <View style={styles.progRow}>
              <Text style={styles.lbl}>Switching to</Text>
              <View style={[styles.pill, { backgroundColor: `${m.tint}14` }]}>
                <Text style={[styles.pillText, { color: m.tint }]}>{m.label}</Text>
              </View>
            </View>
            <Text style={styles.bigVal}>{data?.new_provider || '—'}</Text>
            {!!data?.reason && (
              <View style={{ marginTop: 8 }}>
                <Text style={styles.lbl}>Reason</Text>
                <Text style={styles.body}>{data.reason}</Text>
              </View>
            )}
            {!!data?.target_date && (
              <View style={{ marginTop: 8 }}>
                <Text style={styles.lbl}>Target date</Text>
                <Text style={styles.body}>{data.target_date}</Text>
              </View>
            )}
            <TouchableOpacity onPress={cancel} style={styles.cancelBtn} testID="provider-switch-cancel">
              <Ionicons name="close-circle-outline" size={14} color={Colors.severityAlert} />
              <Text style={styles.cancelText}>Cancel this switch</Text>
            </TouchableOpacity>
          </View>
        )}

        <View style={{ height: 32 }} />
      </ScrollView>

      <Modal visible={open} animationType="slide" transparent onRequestClose={() => setOpen(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
          <Pressable style={styles.backdrop} onPress={() => !busy && setOpen(false)} />
          <View style={styles.sheet}>
            <View style={styles.handle} />
            <Text style={styles.modalTitle}>Start a provider switch</Text>
            <Text style={styles.help}>We&apos;ll draft a formal notice letter once you tell us where you&apos;re moving.</Text>

            <Text style={styles.lbl}>New provider</Text>
            <TextInput style={styles.input} value={newProvider} onChangeText={setNewProvider} placeholder="e.g. SilverCare Plus" placeholderTextColor={Colors.textMuted} testID="provider-new" />

            <Text style={styles.lbl}>Reason (optional)</Text>
            <TextInput style={[styles.input, { minHeight: 80, textAlignVertical: 'top' }]} value={reason} onChangeText={setReason} multiline placeholder="Why are you moving? Service quality, billing, location, fit…" placeholderTextColor={Colors.textMuted} testID="provider-reason" />

            <Text style={styles.lbl}>Target switch date (optional)</Text>
            {Platform.OS === 'web' ? (
              React.createElement('input', {
                type: 'date',
                value: targetDate || '',
                onChange: (e: any) => setTargetDate(e?.target?.value || undefined),
                'data-testid': 'provider-target-date',
                style: { fontFamily: 'inherit', fontSize: 14, color: Colors.brandPrimary, background: Colors.background, borderRadius: 8, padding: '12px 14px', border: `1px solid ${Colors.borderSubtle}`, outline: 'none', width: '100%', boxSizing: 'border-box', minHeight: 46 },
              })
            ) : (
              <TextInput style={styles.input} value={targetDate || ''} onChangeText={setTargetDate} placeholder="YYYY-MM-DD" placeholderTextColor={Colors.textMuted} testID="provider-target-date" />
            )}

            <TouchableOpacity onPress={start} disabled={busy} style={[styles.cta, busy && { opacity: 0.6 }]} testID="provider-switch-save">
              {busy ? <ActivityIndicator color="#FFFFFF" /> : (<>
                <Ionicons name="checkmark" size={14} color="#FFFFFF" />
                <Text style={styles.ctaText}>Start the switch</Text>
              </>)}
            </TouchableOpacity>
            <TouchableOpacity onPress={() => !busy && setOpen(false)} style={styles.cancelLink}>
              <Text style={styles.cancelLinkText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.md, paddingBottom: 40 },
  heroRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 6 },
  hero: { fontFamily: Fonts.heading, fontSize: 24, color: Colors.brandPrimary, letterSpacing: -0.3 },
  subhero: { fontFamily: Fonts.body, fontSize: 13, color: Colors.textSecondary, lineHeight: 19, marginBottom: Spacing.lg },
  card: { backgroundColor: Colors.cardBg, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.borderSubtle, padding: Spacing.md, marginBottom: Spacing.md },
  progressCard: { backgroundColor: Colors.cardBg, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.borderSubtle, padding: Spacing.md, marginBottom: Spacing.md },
  progRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  lbl: { fontFamily: Fonts.bodyMed, fontSize: 11, letterSpacing: 0.6, color: Colors.textSecondary },
  bigVal: { fontFamily: Fonts.heading, fontSize: 20, color: Colors.brandPrimary, marginTop: 4 },
  body: { fontFamily: Fonts.body, fontSize: 13, color: Colors.textPrimary, marginTop: 2, lineHeight: 19 },
  pill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 },
  pillText: { fontFamily: Fonts.bodySemi, fontSize: 10, letterSpacing: 0.4 },
  emptyCard: { padding: Spacing.lg, alignItems: 'center', gap: 8, backgroundColor: Colors.cardBg, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.borderSubtle, marginBottom: Spacing.md },
  emptyTitle: { fontFamily: Fonts.bodySemi, fontSize: 15, color: Colors.brandPrimary, marginTop: 4 },
  emptyBody: { fontFamily: Fonts.body, fontSize: 12, color: Colors.textSecondary, textAlign: 'center', lineHeight: 18 },
  cta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: Colors.brandPrimary, paddingHorizontal: 18, paddingVertical: 12, borderRadius: 999, marginTop: Spacing.sm, minHeight: 44 },
  ctaText: { fontFamily: Fonts.bodySemi, fontSize: 13, color: '#FFFFFF' },
  cancelBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, marginTop: Spacing.md, paddingVertical: 8 },
  cancelText: { fontFamily: Fonts.bodyMed, fontSize: 13, color: Colors.severityAlert },
  // modal
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.45)' },
  sheet: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: Colors.cardBg, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: Spacing.lg, paddingBottom: 36, maxHeight: '90%' },
  handle: { width: 36, height: 4, borderRadius: 2, backgroundColor: Colors.border, alignSelf: 'center', marginBottom: Spacing.md },
  modalTitle: { fontFamily: Fonts.heading, fontSize: 22, color: Colors.brandPrimary, marginBottom: 4 },
  help: { fontFamily: Fonts.body, fontSize: 12, color: Colors.textSecondary, marginBottom: Spacing.sm, lineHeight: 18 },
  input: { fontFamily: Fonts.body, fontSize: 14, color: Colors.textPrimary, backgroundColor: Colors.background, borderRadius: Radius.md, paddingHorizontal: Spacing.md, paddingVertical: 12, borderWidth: 1, borderColor: Colors.borderSubtle, minHeight: 46 },
  cancelLink: { marginTop: 8, alignItems: 'center', paddingVertical: 10 },
  cancelLinkText: { fontFamily: Fonts.bodyMed, fontSize: 13, color: Colors.textMuted },
});
