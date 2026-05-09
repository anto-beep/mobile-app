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
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { api, extractErrorMessage } from '../../src/lib/api';
import { Colors, Fonts, Radius, Spacing } from '../../src/lib/theme';
import { useAuth } from '../../src/context/AuthContext';

const CLASSIFICATION_OPTIONS = [1, 2, 3, 4, 5, 6, 7, 8];

export default function Profile() {
  const { user, logout, refresh } = useAuth();
  const router = useRouter();
  const [household, setHousehold] = useState<any>(null);
  const [editing, setEditing] = useState(false);
  const [participantName, setParticipantName] = useState('');
  const [classification, setClassification] = useState(4);
  const [providerName, setProviderName] = useState('Your provider');
  const [saving, setSaving] = useState(false);

  const load = async () => {
    try {
      const { data } = await api.get('/household');
      setHousehold(data);
      if (data) {
        setParticipantName(data.participant_name || '');
        setClassification(data.classification || 4);
        setProviderName(data.provider_name || 'Your provider');
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
      setEditing(false);
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
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1 }}
      >
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <Text style={styles.overline}>Account</Text>
          <Text style={styles.h1}>{user?.name || 'Your profile'}</Text>
          <Text style={styles.email}>{user?.email}</Text>

          <View style={styles.card}>
            <Text style={styles.cardOverline}>Household</Text>
            {household && !editing ? (
              <>
                <Text style={styles.cardTitle}>{household.participant_name}</Text>
                <Text style={styles.cardMeta}>
                  Level {household.classification} · {household.provider_name}
                </Text>
                <TouchableOpacity
                  testID="profile-edit-household"
                  style={styles.edit}
                  onPress={() => setEditing(true)}
                >
                  <Ionicons name="pencil-outline" size={14} color={Colors.brandPrimary} />
                  <Text style={styles.editText}>Edit</Text>
                </TouchableOpacity>
              </>
            ) : (
              <>
                <Text style={styles.label}>Parent's first name</Text>
                <TextInput
                  testID="profile-participant-input"
                  value={participantName}
                  onChangeText={setParticipantName}
                  placeholder="Margaret"
                  placeholderTextColor={Colors.textMuted}
                  style={styles.input}
                />

                <Text style={[styles.label, { marginTop: Spacing.md }]}>
                  Classification level
                </Text>
                <View style={styles.classRow}>
                  {CLASSIFICATION_OPTIONS.map((c) => (
                    <TouchableOpacity
                      key={c}
                      testID={`profile-class-${c}`}
                      onPress={() => setClassification(c)}
                      style={[
                        styles.classChip,
                        classification === c && styles.classChipActive,
                      ]}
                    >
                      <Text
                        style={[
                          styles.classChipText,
                          classification === c && styles.classChipTextActive,
                        ]}
                      >
                        {c}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <Text style={styles.hint}>
                  This sets the budget. Don't worry — you can change it later.
                </Text>

                <Text style={[styles.label, { marginTop: Spacing.md }]}>Provider</Text>
                <TextInput
                  testID="profile-provider-input"
                  value={providerName}
                  onChangeText={setProviderName}
                  placeholder="HomeCare Plus"
                  placeholderTextColor={Colors.textMuted}
                  style={styles.input}
                />

                <TouchableOpacity
                  testID="profile-save-household"
                  onPress={save}
                  disabled={saving}
                  style={[styles.saveBtn, saving && { opacity: 0.6 }]}
                >
                  <Text style={styles.saveBtnText}>
                    {saving ? 'Saving…' : household ? 'Save changes' : 'Set up dashboard'}
                  </Text>
                </TouchableOpacity>
                {household && (
                  <TouchableOpacity onPress={() => setEditing(false)} style={{ marginTop: Spacing.sm }}>
                    <Text style={styles.cancelText}>Cancel</Text>
                  </TouchableOpacity>
                )}
              </>
            )}
          </View>

          <TouchableOpacity onPress={onLogout} style={styles.logout} testID="profile-logout">
            <Ionicons name="log-out-outline" size={18} color={Colors.severityAlert} />
            <Text style={styles.logoutText}>Sign out</Text>
          </TouchableOpacity>

          <Text style={styles.footer}>Wayly · Phase 1 mobile preview</Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.lg, paddingBottom: 80 },
  overline: {
    fontFamily: Fonts.bodyMed, fontSize: 11, letterSpacing: 1.5, textTransform: 'uppercase',
    color: Colors.textMuted, marginBottom: 4,
  },
  h1: { fontFamily: Fonts.heading, fontSize: 26, color: Colors.brandPrimary, letterSpacing: -0.5 },
  email: { fontFamily: Fonts.body, fontSize: 14, color: Colors.textSecondary, marginTop: 4, marginBottom: Spacing.lg },
  card: {
    backgroundColor: Colors.cardBg, borderRadius: Radius.lg, padding: Spacing.md + 4,
    borderWidth: 1, borderColor: Colors.borderSubtle, marginBottom: Spacing.lg,
  },
  cardOverline: {
    fontFamily: Fonts.bodyMed, fontSize: 10, letterSpacing: 1, textTransform: 'uppercase',
    color: Colors.textMuted, marginBottom: 6,
  },
  cardTitle: { fontFamily: Fonts.headingMed, fontSize: 22, color: Colors.brandPrimary },
  cardMeta: { fontFamily: Fonts.body, fontSize: 14, color: Colors.textSecondary, marginTop: 4 },
  edit: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: Spacing.md },
  editText: { fontFamily: Fonts.bodySemi, fontSize: 13, color: Colors.brandPrimary, textDecorationLine: 'underline' },
  label: { fontFamily: Fonts.bodyMed, fontSize: 13, color: Colors.textSecondary, marginBottom: 6 },
  input: {
    fontFamily: Fonts.body, fontSize: 16, color: Colors.textPrimary, backgroundColor: Colors.inputBg,
    borderRadius: Radius.md, paddingHorizontal: Spacing.md, paddingVertical: 12,
    borderWidth: 1, borderColor: Colors.border,
  },
  classRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  classChip: {
    minWidth: 44, paddingHorizontal: 14, paddingVertical: 10,
    borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.border,
    backgroundColor: Colors.inputBg, alignItems: 'center',
  },
  classChipActive: { backgroundColor: Colors.brandPrimary, borderColor: Colors.brandPrimary },
  classChipText: { fontFamily: Fonts.bodySemi, fontSize: 14, color: Colors.brandPrimary },
  classChipTextActive: { color: Colors.cream },
  hint: { fontFamily: Fonts.body, fontSize: 12, color: Colors.textMuted, marginTop: 6 },
  saveBtn: {
    marginTop: Spacing.md, backgroundColor: Colors.brandPrimary, borderRadius: Radius.md,
    paddingVertical: 14, alignItems: 'center', minHeight: 50,
  },
  saveBtnText: { fontFamily: Fonts.bodySemi, fontSize: 15, color: Colors.cream },
  cancelText: {
    fontFamily: Fonts.bodyMed, fontSize: 13, color: Colors.textSecondary,
    textAlign: 'center',
  },
  logout: {
    flexDirection: 'row', alignItems: 'center', gap: 8, justifyContent: 'center',
    paddingVertical: 14, backgroundColor: Colors.cardBg, borderRadius: Radius.md,
    borderWidth: 1, borderColor: Colors.borderSubtle, marginBottom: Spacing.lg,
  },
  logoutText: { fontFamily: Fonts.bodySemi, fontSize: 14, color: Colors.severityAlert },
  footer: {
    fontFamily: Fonts.body, fontSize: 11, color: Colors.textMuted, textAlign: 'center',
  },
});
