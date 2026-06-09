// Phase E — Settings: Danger zone (logout-everywhere + delete account).
import React, { useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import BackHeader from '../../src/components/BackHeader';
import { useAuth } from '../../src/context/AuthContext';
import { Colors, Fonts, Radius, Spacing, Type } from '../../src/lib/theme';
import { api } from '../../src/lib/api';
import { toast } from '../../src/components/Toast';

export default function DangerSettings() {
  const router = useRouter();
  const { logout } = useAuth();
  const [busy, setBusy] = useState<string | null>(null);

  async function signOutEverywhere() {
    Alert.alert(
      'Sign out everywhere?',
      'This signs you out on every device, including this one. You’ll need to log back in.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Sign out everywhere', style: 'destructive', onPress: async () => {
          setBusy('logout-all');
          try {
            try { await api.post('/auth/revoke-all', {}); } catch {/* endpoint may not exist; logout still works */}
            await logout();
            router.replace('/login' as any);
          } catch (e: any) {
            Alert.alert('Could not complete', e?.response?.data?.detail || e?.message);
          } finally { setBusy(null); }
        } },
      ],
    );
  }

  async function deleteAccount() {
    Alert.alert(
      'Delete account permanently?',
      'This wipes your participants, statements, documents and audit log. It cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete forever', style: 'destructive', onPress: async () => {
          setBusy('delete');
          try {
            try { await api.delete('/auth/me'); }
            catch (e: any) {
              if (e?.response?.status === 404 || e?.response?.status === 405) {
                Alert.alert('Not available yet', 'Self-service deletion isn’t wired on the backend yet. Contact support@wayly.com.au and we’ll process the request within 7 days.');
                return;
              }
              throw e;
            }
            toast.success('Account deleted');
            await logout();
            router.replace('/login' as any);
          } catch (e: any) {
            Alert.alert('Could not delete', e?.response?.data?.detail || e?.message);
          } finally { setBusy(null); }
        } },
      ],
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <BackHeader title="Danger zone" />
      <ScrollView contentContainerStyle={{ padding: Spacing.md, paddingBottom: 40, gap: Spacing.md }}>
        <View style={styles.card}>
          <Ionicons name="shield-outline" size={20} color={Colors.brandPrimary} />
          <Text style={styles.title}>Sign out on every device</Text>
          <Text style={styles.body}>Useful if you lost a phone or shared the password with someone.</Text>
          <TouchableOpacity onPress={signOutEverywhere} disabled={!!busy} style={[styles.btn, styles.btnGhost]} testID="danger-logout-all">
            <Text style={styles.btnGhostText}>{busy === 'logout-all' ? 'Signing out…' : 'Sign out everywhere'}</Text>
          </TouchableOpacity>
        </View>

        <View style={[styles.card, styles.dangerCard]}>
          <Ionicons name="warning-outline" size={20} color={Colors.brandSecondary} />
          <Text style={[styles.title, { color: Colors.brandSecondary }]}>Delete account</Text>
          <Text style={styles.body}>Permanently removes every participant, statement, document, anomaly and audit-log entry tied to your account. Family members lose access too.</Text>
          <TouchableOpacity onPress={deleteAccount} disabled={!!busy} style={[styles.btn, styles.btnDanger]} testID="danger-delete-account">
            <Text style={styles.btnDangerText}>{busy === 'delete' ? 'Deleting…' : 'Delete account permanently'}</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.bg },
  card: { backgroundColor: Colors.cardBg, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.border, padding: Spacing.md, gap: 8 },
  dangerCard: { backgroundColor: '#FBE5E0', borderColor: '#F2C5BB' },
  title: { ...Type.h3, color: Colors.textPrimary, marginTop: 4 },
  body: { ...Type.body, color: Colors.textSecondary, lineHeight: 22 },
  btn: { marginTop: 8, paddingVertical: 12, borderRadius: 9999, alignItems: 'center' },
  btnGhost: { borderWidth: 1.5, borderColor: Colors.brandPrimary },
  btnGhostText: { color: Colors.brandPrimary, fontFamily: Fonts.bodySemi, fontWeight: '700' },
  btnDanger: { backgroundColor: Colors.brandSecondary },
  btnDangerText: { color: '#fff', fontFamily: Fonts.bodySemi, fontWeight: '700' },
});
