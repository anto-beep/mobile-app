// Referrals — clinical referrals tracker (GP / allied health / specialist).
import React, { useState } from 'react';
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity,
  RefreshControl, ActivityIndicator, Alert, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { Ionicons } from '@expo/vector-icons';
import { useApi } from '../src/lib/useApi';
import { api, extractErrorMessage } from '../src/lib/api';
import BackHeader from '../src/components/BackHeader';
import { toast } from '../src/components/Toast';
import { formatAUDate } from '../src/lib/format';
import { Colors, Fonts, Radius, Spacing } from '../src/lib/theme';

type Referral = {
  id: string;
  referred_to?: string;
  referrer_type?: string;
  phone_email?: string;
  referred_at?: string;
  reason?: string;
  created_at?: string;
};

const TYPES = ['GP', 'specialist', 'allied health', 'support service', 'other'];

function todayISO(): string { return new Date().toISOString().slice(0, 10); }

export default function Referrals() {
  const { data, loading, refreshing, refresh } = useApi<{ items: Referral[] }>('/referrals');
  const items = data?.items || [];

  const [referredTo, setReferredTo] = useState('');
  const [referrerType, setReferrerType] = useState('specialist');
  const [phoneEmail, setPhoneEmail] = useState('');
  const [referredAt, setReferredAt] = useState(todayISO());
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [typeOpen, setTypeOpen] = useState(false);

  const submit = async () => {
    if (!referredTo.trim()) { toast.warning('Add who you were referred to.'); return; }
    setBusy(true);
    try {
      await api.post('/referrals', {
        referred_to: referredTo.trim(),
        referrer_type: referrerType,
        phone_email: phoneEmail.trim() || undefined,
        referred_at: referredAt || undefined,
        reason: reason.trim() || undefined,
      });
      setReferredTo(''); setPhoneEmail(''); setReason(''); setReferredAt(todayISO());
      await refresh();
      toast.success('Referral added.');
    } catch (e) { toast.error(extractErrorMessage(e, "Couldn't save referral.")); }
    finally { setBusy(false); }
  };

  const remove = (r: Referral) => {
    const doDelete = async () => {
      try { await api.delete(`/referrals/${r.id}`); await refresh(); toast.success('Removed.'); }
      catch (e) { toast.error(extractErrorMessage(e, "Couldn't remove.")); }
    };
    if (Platform.OS === 'web') {
      if (typeof window !== 'undefined' && window.confirm(`Remove referral to ${r.referred_to}?`)) doDelete();
    } else {
      Alert.alert('Remove referral?', r.referred_to || '', [
        { text: 'Keep', style: 'cancel' },
        { text: 'Remove', style: 'destructive', onPress: doDelete },
      ]);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <BackHeader title="Referrals" />
      <KeyboardAwareScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        bottomOffset={24}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={Colors.brandPrimary} />}
      >
        <Text style={styles.overline}>Referrals</Text>
        <Text style={styles.h1}>GP, allied health, and specialist referrals</Text>
        <Text style={styles.sub}>Keep track of who referred whom, when, and what came of it — invaluable when a new GP asks for history.</Text>

        <View style={styles.card}>
          <Text style={styles.lbl}>Referred to</Text>
          <TextInput style={styles.input} value={referredTo} onChangeText={setReferredTo} placeholder="e.g. Dr Lee" placeholderTextColor={Colors.textMuted} testID="ref-to" />

          <Text style={styles.lbl}>Type</Text>
          <TouchableOpacity style={styles.input} onPress={() => setTypeOpen((v) => !v)} testID="ref-type-toggle">
            <Text style={styles.typeText}>{referrerType}</Text>
            <Ionicons name={typeOpen ? 'chevron-up' : 'chevron-down'} size={14} color={Colors.brandPrimary} style={{ position: 'absolute', right: 12, top: 14 }} />
          </TouchableOpacity>
          {typeOpen && (
            <View style={styles.dropdown}>
              {TYPES.map((t) => (
                <TouchableOpacity key={t} onPress={() => { setReferrerType(t); setTypeOpen(false); }} style={[styles.dropOpt, referrerType === t && styles.dropOptActive]}>
                  <Text style={[styles.dropOptText, referrerType === t && { color: '#FFFFFF' }]}>{t}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}

          <Text style={styles.lbl}>Phone / email (optional)</Text>
          <TextInput style={styles.input} value={phoneEmail} onChangeText={setPhoneEmail} placeholder="03 9000 0000 / clinic@example.com" placeholderTextColor={Colors.textMuted} keyboardType="email-address" autoCapitalize="none" testID="ref-contact" />

          <Text style={styles.lbl}>Referred on</Text>
          {Platform.OS === 'web'
            ? React.createElement('input', {
                type: 'date', value: referredAt,
                onChange: (e: any) => setReferredAt(e?.target?.value || ''),
                'data-testid': 'ref-date',
                style: { fontFamily: 'inherit', fontSize: 14, color: Colors.brandPrimary, background: '#FFFFFF', borderRadius: 6, padding: '11px 12px', border: `1px solid ${Colors.borderSubtle}`, outline: 'none', width: '100%', boxSizing: 'border-box', minHeight: 44 },
              })
            : <TextInput style={styles.input} value={referredAt} onChangeText={setReferredAt} placeholder="YYYY-MM-DD" placeholderTextColor={Colors.textMuted} testID="ref-date" />
          }

          <Text style={styles.lbl}>Reason</Text>
          <TextInput style={[styles.input, { minHeight: 90, textAlignVertical: 'top', paddingTop: 12 }]} value={reason} onChangeText={setReason} multiline placeholder="What's the referral for?" placeholderTextColor={Colors.textMuted} testID="ref-reason" />

          <TouchableOpacity onPress={submit} disabled={busy || !referredTo.trim()} style={[styles.cta, (busy || !referredTo.trim()) && { opacity: 0.55 }]} testID="ref-add">
            {busy ? <ActivityIndicator color="#FFFFFF" /> : (<><Ionicons name="add" size={14} color="#FFFFFF" /><Text style={styles.ctaText}>Add</Text></>)}
          </TouchableOpacity>
        </View>

        {loading ? (
          <ActivityIndicator color={Colors.brandPrimary} style={{ paddingVertical: 32 }} />
        ) : items.length === 0 ? (
          <View style={styles.emptyCard}>
            <Ionicons name="share-social-outline" size={28} color={Colors.textMuted} />
            <Text style={styles.emptyTitle}>No referrals yet</Text>
            <Text style={styles.emptyBody}>Track every clinical and support-service referral so you don&apos;t lose visibility.</Text>
          </View>
        ) : items.map((r) => (
          <View key={r.id} style={styles.row} testID={`ref-${r.id}`}>
            <View style={styles.iconWrap}><Ionicons name="medical-outline" size={16} color={Colors.brandPrimary} /></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.refTitle} numberOfLines={1}>{r.referred_to || 'Unnamed referral'}</Text>
              <Text style={styles.refMeta}>{(r.referrer_type || '').toUpperCase()}{r.referred_at ? ` · ${formatAUDate(r.referred_at)}` : ''}</Text>
              {!!r.reason && <Text style={styles.refReason} numberOfLines={3}>{r.reason}</Text>}
              {!!r.phone_email && <Text style={styles.refContact}>{r.phone_email}</Text>}
            </View>
            <TouchableOpacity onPress={() => remove(r)} hitSlop={6} style={{ padding: 4 }} testID={`ref-del-${r.id}`}>
              <Ionicons name="trash-outline" size={16} color={Colors.severityAlert} />
            </TouchableOpacity>
          </View>
        ))}

        <View style={{ height: 32 }} />
      </KeyboardAwareScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.md, paddingBottom: 40 },
  overline: { fontFamily: Fonts.bodyMed, fontSize: 11, letterSpacing: 1.5, textTransform: 'uppercase', color: Colors.textMuted },
  h1: { fontFamily: Fonts.heading, fontSize: 24, color: Colors.brandPrimary, letterSpacing: -0.3, marginTop: 4, lineHeight: 30 },
  sub: { fontFamily: Fonts.body, fontSize: 13, color: Colors.textSecondary, marginTop: 6, marginBottom: Spacing.lg, lineHeight: 19 },
  card: { backgroundColor: Colors.cardBg, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.borderSubtle, padding: Spacing.md, marginBottom: Spacing.lg, gap: 8 },
  lbl: { fontFamily: Fonts.bodyMed, fontSize: 11, letterSpacing: 0.6, color: Colors.textSecondary, textTransform: 'uppercase', marginTop: 4 },
  input: { fontFamily: Fonts.body, fontSize: 14, color: Colors.textPrimary, backgroundColor: '#FFFFFF', borderRadius: 6, borderWidth: 1, borderColor: Colors.borderSubtle, paddingHorizontal: 12, paddingVertical: 11, minHeight: 44, justifyContent: 'center' },
  typeText: { fontFamily: Fonts.body, fontSize: 14, color: Colors.textPrimary, textTransform: 'capitalize' },
  dropdown: { backgroundColor: '#FFFFFF', borderRadius: 6, borderWidth: 1, borderColor: Colors.borderSubtle, marginTop: -4, overflow: 'hidden' },
  dropOpt: { paddingHorizontal: 12, paddingVertical: 10 },
  dropOptActive: { backgroundColor: Colors.brandPrimary },
  dropOptText: { fontFamily: Fonts.bodyMed, fontSize: 13, color: Colors.brandPrimary, textTransform: 'capitalize' },
  cta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: Colors.brandPrimary, borderRadius: Radius.md, paddingVertical: 13, minHeight: 46, marginTop: 8 },
  ctaText: { fontFamily: Fonts.bodySemi, fontSize: 14, color: '#FFFFFF' },
  emptyCard: { padding: Spacing.lg, alignItems: 'center', gap: 8, backgroundColor: Colors.cardBg, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.borderSubtle },
  emptyTitle: { fontFamily: Fonts.heading, fontSize: 20, color: Colors.brandPrimary, marginTop: 6 },
  emptyBody: { fontFamily: Fonts.body, fontSize: 13, color: Colors.textSecondary, textAlign: 'center', lineHeight: 19 },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, backgroundColor: Colors.cardBg, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.borderSubtle, padding: Spacing.md, marginBottom: 8 },
  iconWrap: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(14, 77, 82, 0.10)' },
  refTitle: { fontFamily: Fonts.bodySemi, fontSize: 14, color: Colors.brandPrimary },
  refMeta: { fontFamily: Fonts.bodyMed, fontSize: 11, letterSpacing: 0.6, color: Colors.textSecondary, marginTop: 2 },
  refReason: { fontFamily: Fonts.body, fontSize: 12, color: Colors.textPrimary, marginTop: 4, lineHeight: 18 },
  refContact: { fontFamily: Fonts.body, fontSize: 11, color: Colors.textMuted, marginTop: 4 },
});
