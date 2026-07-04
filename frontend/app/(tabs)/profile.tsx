import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Modal,
  Pressable,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { Ionicons } from '@expo/vector-icons';
import { api, extractErrorMessage } from '../../src/lib/api';
import { Fonts, Radius, Spacing } from '../../src/lib/theme';
import type { ColorPalette } from '../../src/lib/theme';
import { useColors } from '../../src/hooks/useColors';
import { useThemedStyles } from '../../src/hooks/useThemedStyles';
import { useAuth } from '../../src/context/AuthContext';

const CLASSIFICATION_OPTIONS = [1, 2, 3, 4, 5, 6, 7, 8];
const SETTINGS_BASE = process.env.EXPO_PUBLIC_BACKEND_URL;

export default function Profile() {
  const c = useColors();
  const styles = useThemedStyles(makeStyles);
  const { user, logout, refresh } = useAuth();
  const router = useRouter();
  const [household, setHousehold] = useState<any>(null);
  const [editing, setEditing] = useState(false);
  const [participantName, setParticipantName] = useState('');
  const [classification, setClassification] = useState(4);
  const [providerName, setProviderName] = useState('Your provider');
  const [saving, setSaving] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);

  const load = async () => {
    try {
      const { data } = await api.get('/household');
      setHousehold(data);
      if (data) {
        setParticipantName(data.participant_name || '');
        setClassification(data.classification || 4);
        setProviderName(data.provider_name || 'Your provider');
        setEditing(false);
      } else {
        setEditing(true);
      }
    } catch {
      setEditing(true);
    }
  };

  useFocusEffect(
    useCallback(() => {
      load();
    }, [])
  );

  const save = async () => {
    if (!participantName.trim()) {
      Alert.alert('Add a name', "We need your parent's first name to set up your dashboard.");
      return;
    }
    setSaving(true);
    try {
      await api.post('/household', {
        participant_name: participantName.trim(),
        classification,
        provider_name: providerName.trim() || 'Your provider',
        is_grandfathered: false,
      });
      await refresh();
      await load();
      Alert.alert('Saved', 'Your dashboard is ready.');
    } catch (e) {
      Alert.alert('Could not save', extractErrorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const onLogout = async () => {
    await logout();
    router.replace('/(auth)/login');
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <Text style={styles.overline}>You</Text>
          <Text style={styles.h1}>{user?.name || 'Your profile'}</Text>
          <Text style={styles.email}>{user?.email}</Text>

          {/* Household */}
          <View style={styles.card}>
            <Text style={styles.cardOverline}>Household</Text>
            {household && !editing ? (
              <>
                <Text style={styles.cardTitle}>{household.participant_name}</Text>
                <Text style={styles.cardMeta}>Level {household.classification} · {household.provider_name}</Text>
                <TouchableOpacity testID="profile-edit-household" style={styles.edit} onPress={() => setEditing(true)}>
                  <Ionicons name="pencil-outline" size={14} color={c.brandPrimary} />
                  <Text style={styles.editText}>Edit</Text>
                </TouchableOpacity>
              </>
            ) : (
              <>
                <Text style={styles.label}>Parent's first name</Text>
                <TextInput testID="profile-participant-input" value={participantName} onChangeText={setParticipantName} placeholder="Margaret" placeholderTextColor={c.textMuted} style={styles.input} />

                <Text style={[styles.label, { marginTop: Spacing.md }]}>Classification level</Text>
                <View style={styles.classRow}>
                  {CLASSIFICATION_OPTIONS.map((c) => (
                    <TouchableOpacity key={c} testID={`profile-class-${c}`} onPress={() => setClassification(c)} style={[styles.classChip, classification === c && styles.classChipActive]}>
                      <Text style={[styles.classChipText, classification === c && styles.classChipTextActive]}>{c}</Text>
                    </TouchableOpacity>
                  ))}
                </View>

                <Text style={[styles.label, { marginTop: Spacing.md }]}>Provider</Text>
                <TextInput testID="profile-provider-input" value={providerName} onChangeText={setProviderName} placeholder="HomeCare Plus" placeholderTextColor={c.textMuted} style={styles.input} />

                <TouchableOpacity testID="profile-save-household" onPress={save} disabled={saving} style={[styles.saveBtn, saving && { opacity: 0.6 }]}>
                  <Text style={styles.saveBtnText}>{saving ? 'Saving…' : household ? 'Save changes' : 'Set up dashboard'}</Text>
                </TouchableOpacity>
                {household && (
                  <TouchableOpacity onPress={() => setEditing(false)} style={{ marginTop: Spacing.sm }}>
                    <Text style={styles.cancelText}>Cancel</Text>
                  </TouchableOpacity>
                )}
              </>
            )}
          </View>

          {/* Quick links */}
          <Text style={styles.sectionLabel}>Helpful tools</Text>

          <TouchableOpacity style={styles.linkRow} onPress={() => router.push('/participant' as any)} testID="profile-participant-view">
            <View style={[styles.linkIcon, { backgroundColor: 'rgba(183, 121, 31, 0.15)' }]}>
              <Ionicons name="heart-outline" size={20} color={c.brandSecondary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.linkTitle}>Participant view</Text>
              <Text style={styles.linkSub}>Wellbeing check-in for your parent</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={c.textMuted} />
          </TouchableOpacity>

          <TouchableOpacity style={styles.linkRow} onPress={() => router.push('/tools' as any)} testID="profile-ai-tools">
            <View style={[styles.linkIcon, { backgroundColor: 'rgba(14, 77, 82, 0.08)' }]}>
              <Ionicons name="construct-outline" size={20} color={c.brandPrimary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.linkTitle}>AI tools</Text>
              <Text style={styles.linkSub}>Budget calc · Price checker · Classification check · Reassessment letter</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={c.textMuted} />
          </TouchableOpacity>

          <TouchableOpacity style={styles.linkRow} onPress={() => router.push('/(tabs)/notifications' as any)} testID="profile-notifications">
            <View style={[styles.linkIcon, { backgroundColor: 'rgba(192, 57, 43, 0.1)' }]}>
              <Ionicons name="notifications-outline" size={20} color={c.severityAlert} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.linkTitle}>Notifications</Text>
              <Text style={styles.linkSub}>Recent alerts and updates</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={c.textMuted} />
          </TouchableOpacity>

          <TouchableOpacity style={styles.linkRow} onPress={() => setShareOpen(true)} testID="profile-share-dashboard">
            <View style={[styles.linkIcon, { backgroundColor: 'rgba(139, 155, 130, 0.15)' }]}>
              <Ionicons name="share-outline" size={20} color={c.severityInfo} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.linkTitle}>Share dashboard</Text>
              <Text style={styles.linkSub}>Email a snapshot to family</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={c.textMuted} />
          </TouchableOpacity>

          <Text style={styles.sectionLabel}>Account</Text>

          <TouchableOpacity style={styles.linkRow} onPress={() => router.push('/settings' as any)} testID="profile-settings-web">
            <View style={[styles.linkIcon, { backgroundColor: 'rgba(14, 77, 82, 0.08)' }]}>
              <Ionicons name="settings-outline" size={20} color={c.brandPrimary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.linkTitle}>Settings</Text>
              <Text style={styles.linkSub}>Profile, members, security, notifications, usage</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={c.textMuted} />
          </TouchableOpacity>

          <TouchableOpacity style={styles.linkRow} onPress={() => router.push('/settings/plan' as any)} testID="profile-billing-web">
            <View style={[styles.linkIcon, { backgroundColor: 'rgba(183, 121, 31, 0.15)' }]}>
              <Ionicons name="card-outline" size={20} color={c.brandSecondary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.linkTitle}>Plan and Billing</Text>
              <Text style={styles.linkSub}>{(user?.plan || 'free').toUpperCase()} plan · upgrade or cancel</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={c.textMuted} />
          </TouchableOpacity>

          <TouchableOpacity onPress={onLogout} style={styles.logout} testID="profile-logout">
            <Ionicons name="log-out-outline" size={18} color={c.severityAlert} />
            <Text style={styles.logoutText}>Sign Out</Text>
          </TouchableOpacity>

          <Text style={styles.footer}>Wayly · Mobile companion to your web account</Text>
        </ScrollView>
      </KeyboardAvoidingView>

      <ShareModal visible={shareOpen} onClose={() => setShareOpen(false)} />
    </SafeAreaView>
  );
}

function ShareModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const c = useColors();
  const styles = useThemedStyles(makeStyles);
  const [emails, setEmails] = useState('');
  const [note, setNote] = useState('');
  const [sending, setSending] = useState(false);

  const reset = () => { setEmails(''); setNote(''); };

  const send = async () => {
    const list = emails.split(/[,\s]+/).filter((e) => e.includes('@'));
    if (list.length === 0) {
      Alert.alert('Add at least one email', 'Separate multiple addresses with commas.');
      return;
    }
    setSending(true);
    try {
      const { data } = await api.post('/dashboard/share', { extra_emails: list, note });
      Alert.alert('Sent', `Snapshot sent to ${(data.sent_to || list).length} address${(data.sent_to || list).length > 1 ? 'es' : ''}.`);
      reset();
      onClose();
    } catch (e) {
      Alert.alert("Could not send", extractErrorMessage(e));
    } finally {
      setSending(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={() => !sending && onClose()} />
      <View style={styles.sheet} testID="share-sheet">
        <View style={styles.handle} />
        <Text style={styles.modalTitle}>Share dashboard</Text>
        <Text style={styles.modalSub}>We will email a snapshot of this quarter to whoever should know.</Text>

        <Text style={styles.label}>Email addresses</Text>
        <TextInput
          style={[styles.input, { minHeight: 60, textAlignVertical: 'top' }]}
          value={emails}
          onChangeText={setEmails}
          placeholder="brother@example.com, sister@example.com"
          placeholderTextColor={c.textMuted}
          autoCapitalize="none"
          keyboardType="email-address"
          multiline
          testID="share-emails-input"
        />

        <Text style={[styles.label, { marginTop: Spacing.md }]}>Personal note (optional)</Text>
        <TextInput
          style={[styles.input, { minHeight: 80, textAlignVertical: 'top' }]}
          value={note}
          onChangeText={setNote}
          placeholder="Mum's tracking well this quarter, thought you'd want a look."
          placeholderTextColor={c.textMuted}
          multiline
          testID="share-note-input"
        />

        <TouchableOpacity onPress={send} disabled={sending} style={[styles.saveBtn, sending && { opacity: 0.6 }]} testID="share-send">
          {sending ? <ActivityIndicator color={c.cream} /> : <Text style={styles.saveBtnText}>Send snapshot</Text>}
        </TouchableOpacity>
        <TouchableOpacity onPress={onClose} style={{ marginTop: Spacing.sm, alignItems: 'center', padding: 10 }}>
          <Text style={styles.cancelText}>Cancel</Text>
        </TouchableOpacity>
      </View>
    </Modal>
  );
}

function makeStyles(c: ColorPalette) { return StyleSheet.create({
  safe: { flex: 1, backgroundColor: c.background },
  scroll: { padding: Spacing.lg, paddingBottom: 80 },
  overline: { fontFamily: Fonts.bodyMed, fontSize: 11, letterSpacing: 1.5, textTransform: 'uppercase', color: c.textMuted, marginBottom: 4 },
  h1: { fontFamily: Fonts.heading, fontSize: 26, color: c.brandPrimary, letterSpacing: -0.5 },
  email: { fontFamily: Fonts.body, fontSize: 14, color: c.textSecondary, marginTop: 4, marginBottom: Spacing.lg },
  card: { backgroundColor: c.cardBg, borderRadius: Radius.lg, padding: Spacing.md + 4, borderWidth: 1, borderColor: c.borderSubtle, marginBottom: Spacing.lg },
  cardOverline: { fontFamily: Fonts.bodyMed, fontSize: 10, letterSpacing: 1, textTransform: 'uppercase', color: c.textMuted, marginBottom: 6 },
  cardTitle: { fontFamily: Fonts.headingMed, fontSize: 22, color: c.brandPrimary },
  cardMeta: { fontFamily: Fonts.body, fontSize: 14, color: c.textSecondary, marginTop: 4 },
  edit: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: Spacing.md },
  editText: { fontFamily: Fonts.bodySemi, fontSize: 13, color: c.brandPrimary, textDecorationLine: 'underline' },
  label: { fontFamily: Fonts.bodyMed, fontSize: 13, color: c.textSecondary, marginBottom: 6 },
  input: { fontFamily: Fonts.body, fontSize: 16, color: c.textPrimary, backgroundColor: c.background, borderRadius: Radius.md, paddingHorizontal: Spacing.md, paddingVertical: 12, borderWidth: 1, borderColor: c.border },
  classRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  classChip: { minWidth: 44, paddingHorizontal: 14, paddingVertical: 10, borderRadius: Radius.md, borderWidth: 1, borderColor: c.border, backgroundColor: c.background, alignItems: 'center' },
  classChipActive: { backgroundColor: c.brandPrimary, borderColor: c.brandPrimary },
  classChipText: { fontFamily: Fonts.bodySemi, fontSize: 14, color: c.brandPrimary },
  classChipTextActive: { color: c.cream },
  saveBtn: { marginTop: Spacing.md, backgroundColor: c.brandPrimary, borderRadius: Radius.md, paddingVertical: 14, alignItems: 'center', minHeight: 50, justifyContent: 'center' },
  saveBtnText: { fontFamily: Fonts.bodySemi, fontSize: 15, color: c.cream },
  cancelText: { fontFamily: Fonts.bodyMed, fontSize: 13, color: c.textSecondary, textAlign: 'center' },
  sectionLabel: { fontFamily: Fonts.bodyMed, fontSize: 11, letterSpacing: 1.5, textTransform: 'uppercase', color: c.textMuted, marginTop: Spacing.md, marginBottom: Spacing.sm },
  linkRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, padding: Spacing.md, backgroundColor: c.cardBg, borderRadius: Radius.md, marginBottom: 8, borderWidth: 1, borderColor: c.borderSubtle },
  linkIcon: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  linkTitle: { fontFamily: Fonts.bodySemi, fontSize: 15, color: c.brandPrimary },
  linkSub: { fontFamily: Fonts.body, fontSize: 12, color: c.textSecondary, marginTop: 2 },
  logout: { flexDirection: 'row', alignItems: 'center', gap: 8, justifyContent: 'center', paddingVertical: 14, backgroundColor: c.cardBg, borderRadius: Radius.md, borderWidth: 1, borderColor: c.borderSubtle, marginTop: Spacing.md, marginBottom: Spacing.lg },
  logoutText: { fontFamily: Fonts.bodySemi, fontSize: 14, color: c.severityAlert },
  footer: { fontFamily: Fonts.body, fontSize: 11, color: c.textMuted, textAlign: 'center' },

  backdrop: { flex: 1, backgroundColor: 'rgba(14, 77, 82, 0.5)' },
  sheet: { backgroundColor: c.cardBg, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: Spacing.lg, paddingBottom: Spacing.xl },
  handle: { width: 40, height: 4, backgroundColor: c.border, borderRadius: 2, alignSelf: 'center', marginBottom: Spacing.md },
  modalTitle: { fontFamily: Fonts.heading, fontSize: 22, color: c.brandPrimary, letterSpacing: -0.3 },
  modalSub: { fontFamily: Fonts.body, fontSize: 13, color: c.textSecondary, marginTop: 4, marginBottom: Spacing.md },
}); }
