// Phase E — Settings: Profile
import React, { useEffect, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import BackHeader from '../../src/components/BackHeader';
import { Colors, Fonts, Radius, Spacing, Type } from '../../src/lib/theme';
import { useAuth } from '../../src/context/AuthContext';
import { api } from '../../src/lib/api';
import { toast } from '../../src/components/Toast';
import { formatAUDate } from '../../src/lib/format';

export default function ProfileSettings() {
  const { user, refresh } = useAuth();
  const [name, setName] = useState(user?.name || '');
  const [busy, setBusy] = useState(false);

  useEffect(() => { setName(user?.name || ''); }, [user?.name]);

  async function save() {
    if (!name.trim()) { Alert.alert('Name is required'); return; }
    setBusy(true);
    try {
      await api.patch('/auth/me', { name: name.trim() });
      await refresh();
      toast.success('Profile updated');
    } catch (e: any) { Alert.alert('Could not save', e?.response?.data?.detail || e?.message); }
    finally { setBusy(false); }
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <BackHeader title="Profile" />
      <ScrollView contentContainerStyle={{ padding: Spacing.md, paddingBottom: 40, gap: Spacing.md }}>
        <View style={styles.card}>
          <Text style={styles.label}>Name</Text>
          <TextInput value={name} onChangeText={setName} placeholder="Your name" placeholderTextColor={Colors.textMuted} style={styles.input} />
          <Text style={styles.label}>Email</Text>
          <Text style={styles.value}>{user?.email}</Text>
          <Text style={styles.label}>Member since</Text>
          <Text style={styles.value}>{formatAUDate(user?.created_at)}</Text>
          <Text style={styles.label}>Plan</Text>
          <Text style={styles.value}>{(user?.plan || 'free').toUpperCase()}</Text>
          <TouchableOpacity style={[styles.btn, busy && { opacity: 0.6 }]} onPress={save} disabled={busy}>
            <Text style={styles.btnText}>{busy ? 'Saving…' : 'Save changes'}</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.bg },
  card: { backgroundColor: Colors.cardBg, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.border, padding: Spacing.md, gap: 6 },
  label: { ...Type.caption, color: Colors.textMuted, fontFamily: Fonts.bodySemi, marginTop: Spacing.sm, textTransform: 'uppercase', letterSpacing: 0.8 },
  value: { ...Type.body, color: Colors.textPrimary, fontFamily: Fonts.bodyMed },
  input: { borderWidth: 1, borderColor: Colors.border, borderRadius: 10, padding: 12, fontFamily: Fonts.body, color: Colors.textPrimary, fontSize: 16 },
  btn: { backgroundColor: Colors.brandPrimary, marginTop: Spacing.md, paddingVertical: 14, borderRadius: 9999, alignItems: 'center' },
  btnText: { color: '#fff', fontFamily: Fonts.bodySemi, fontWeight: '700' },
});
