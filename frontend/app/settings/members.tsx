// Family members — list + invite (Family plan)
import React, { useCallback, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, TextInput, ActivityIndicator, Alert, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import BackHeader from '../../src/components/BackHeader';
import { useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { api, extractErrorMessage } from '../../src/lib/api';
import { useAuth } from '../../src/context/AuthContext';
import { Colors, Fonts, Radius, Spacing } from '../../src/lib/theme';

type Member = {
  user_id: string;
  email: string;
  name?: string;
  role?: string;
  status?: string;
  invited_at?: string;
};

const ROLES = [
  { key: 'caregiver', label: 'Caregiver' },
  { key: 'participant', label: 'Participant' },
  { key: 'viewer', label: 'Viewer (read-only)' },
];

export default function Members() {
  const { user } = useAuth();
  const router = useRouter();
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('caregiver');
  const [note, setNote] = useState('');
  const [inviting, setInviting] = useState(false);

  const isFamilyPlan = ['family', 'advisor', 'advisor_pro'].includes((user?.plan || '').toLowerCase());

  const load = async () => {
    try {
      const { data } = await api.get<Member[]>('/household/members');
      setMembers(Array.isArray(data) ? data : (data as any)?.members || []);
    } catch {
      setMembers([]);
    } finally {
      setLoading(false);
    }
  };

  useFocusEffect(useCallback(() => { load(); }, []));

  const invite = async () => {
    if (!email.includes('@')) { Alert.alert('Add an email', 'Enter a valid email address.'); return; }
    setInviting(true);
    try {
      await api.post('/household/invite', { email: email.trim().toLowerCase(), role, note });
      Alert.alert('Invitation sent', `We've emailed ${email} an invite link.`);
      setEmail(''); setNote('');
      load();
    } catch (e) {
      Alert.alert("Couldn't send invite", extractErrorMessage(e));
    } finally {
      setInviting(false);
    }
  };

  const remove = (memberId: string, name?: string) => {
    Alert.alert(
      'Remove member?',
      `${name || 'They'} will lose access to the dashboard.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            try {
              await api.delete(`/household/members/${memberId}`);
              load();
            } catch (e) { Alert.alert("Couldn't remove", extractErrorMessage(e)); }
          },
        },
      ]
    );
  };

  if (!isFamilyPlan) {
    return (
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <View style={styles.gateCard} testID="members-upgrade-gate">
          <Ionicons name="people-outline" size={32} color={Colors.brandSecondary} />
          <Text style={styles.gateTitle}>Family invites are on Family plan</Text>
          <Text style={styles.gateBody}>Upgrade to Family to invite up to 5 people to your dashboard — siblings, your participant, even an advisor.</Text>
          <TouchableOpacity onPress={() => router.push('/settings/plan' as any)} style={styles.gateBtn} testID="members-go-to-plan">
            <Text style={styles.gateBtnText}>See plans</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" testID="members-scroll">
          <Text style={styles.sectionLabel}>Members</Text>
          {loading ? <ActivityIndicator color={Colors.brandPrimary} /> : members.length === 0 ? (
            <Text style={styles.emptyText}>No-one else yet — invite your first family member below.</Text>
          ) : members.map((m) => (
            <View key={m.user_id || m.email} style={styles.memberCard} testID={`member-${m.user_id || m.email}`}>
              <View style={styles.avatar}><Text style={styles.avatarText}>{(m.name || m.email).charAt(0).toUpperCase()}</Text></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.memberName}>{m.name || m.email}</Text>
                <Text style={styles.memberMeta}>
                  {m.role || 'caregiver'}{m.status === 'pending' ? ' · invited' : ''}
                </Text>
              </View>
              {m.user_id && m.user_id !== user?.id && (
                <TouchableOpacity onPress={() => remove(m.user_id, m.name)} testID={`member-remove-${m.user_id}`}>
                  <Ionicons name="close-circle-outline" size={22} color={Colors.severityAlert} />
                </TouchableOpacity>
              )}
            </View>
          ))}

          <Text style={[styles.sectionLabel, { marginTop: Spacing.lg }]}>Invite someone</Text>
          <View style={styles.inviteCard}>
            <Text style={styles.label}>Email address</Text>
            <TextInput
              value={email} onChangeText={setEmail}
              autoCapitalize="none" keyboardType="email-address"
              placeholder="sister@example.com" placeholderTextColor={Colors.textMuted}
              style={styles.input} testID="members-invite-email"
            />
            <Text style={[styles.label, { marginTop: Spacing.md }]}>Role</Text>
            <View style={styles.row}>
              {ROLES.map((r) => (
                <TouchableOpacity
                  key={r.key}
                  style={[styles.chip, role === r.key && styles.chipActive]}
                  onPress={() => setRole(r.key)}
                  testID={`members-role-${r.key}`}
                >
                  <Text style={[styles.chipText, role === r.key && styles.chipTextActive]}>{r.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <Text style={[styles.label, { marginTop: Spacing.md }]}>Personal note (optional)</Text>
            <TextInput
              value={note} onChangeText={setNote}
              placeholder="Hey — added you to Mum's Wayly so you can keep an eye too."
              placeholderTextColor={Colors.textMuted}
              style={[styles.input, { minHeight: 70, textAlignVertical: 'top' }]}
              multiline testID="members-invite-note"
            />
            <TouchableOpacity onPress={invite} disabled={inviting || !email.includes('@')} style={[styles.btn, (!email.includes('@') || inviting) && { opacity: 0.5 }]} testID="members-invite-send">
              <Text style={styles.btnText}>{inviting ? 'Sending…' : 'Send invitation'}</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.lg, paddingBottom: 60 },
  sectionLabel: { fontFamily: Fonts.bodyMed, fontSize: 11, letterSpacing: 1.5, textTransform: 'uppercase', color: Colors.textMuted, marginBottom: Spacing.sm },
  emptyText: { fontFamily: Fonts.body, fontSize: 13, color: Colors.textSecondary, textAlign: 'center', padding: Spacing.lg },
  memberCard: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, padding: Spacing.md, backgroundColor: Colors.cardBg, borderRadius: Radius.md, marginBottom: 8, borderWidth: 1, borderColor: Colors.borderSubtle },
  avatar: { width: 38, height: 38, borderRadius: 19, backgroundColor: Colors.brandPrimary, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontFamily: Fonts.bodySemi, fontSize: 15, color: Colors.cream },
  memberName: { fontFamily: Fonts.bodySemi, fontSize: 15, color: Colors.brandPrimary },
  memberMeta: { fontFamily: Fonts.body, fontSize: 12, color: Colors.textSecondary, marginTop: 2 },
  inviteCard: { backgroundColor: Colors.cardBg, borderRadius: Radius.lg, padding: Spacing.md + 4, borderWidth: 1, borderColor: Colors.borderSubtle },
  label: { fontFamily: Fonts.bodyMed, fontSize: 13, color: Colors.textSecondary, marginBottom: 6 },
  input: { fontFamily: Fonts.body, fontSize: 15, color: Colors.textPrimary, backgroundColor: Colors.background, borderRadius: Radius.md, paddingHorizontal: Spacing.md, paddingVertical: 12, borderWidth: 1, borderColor: Colors.border },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 100, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.background },
  chipActive: { backgroundColor: Colors.brandPrimary, borderColor: Colors.brandPrimary },
  chipText: { fontFamily: Fonts.bodyMed, fontSize: 13, color: Colors.brandPrimary },
  chipTextActive: { color: Colors.cream },
  btn: { marginTop: Spacing.md, backgroundColor: Colors.brandPrimary, borderRadius: Radius.md, paddingVertical: 14, alignItems: 'center', minHeight: 50, justifyContent: 'center' },
  btnText: { fontFamily: Fonts.bodySemi, fontSize: 15, color: Colors.cream },
  gateCard: { margin: Spacing.lg, padding: Spacing.lg, backgroundColor: Colors.cardBg, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.borderSubtle, alignItems: 'center', gap: 8 },
  gateTitle: { fontFamily: Fonts.heading, fontSize: 20, color: Colors.brandPrimary, marginTop: Spacing.sm, textAlign: 'center', letterSpacing: -0.3 },
  gateBody: { fontFamily: Fonts.body, fontSize: 14, color: Colors.textSecondary, textAlign: 'center', lineHeight: 20 },
  gateBtn: { marginTop: Spacing.md, backgroundColor: Colors.brandPrimary, borderRadius: Radius.md, paddingVertical: 12, paddingHorizontal: 24 },
  gateBtnText: { fontFamily: Fonts.bodySemi, fontSize: 14, color: Colors.cream },
});
