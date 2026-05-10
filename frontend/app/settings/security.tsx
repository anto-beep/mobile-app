// Security — password reset, account deletion
import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, ActivityIndicator, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { api, extractErrorMessage } from '../../src/lib/api';
import { useAuth } from '../../src/context/AuthContext';
import { Colors, Fonts, Radius, Spacing } from '../../src/lib/theme';

export default function Security() {
  const { user, logout } = useAuth();
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);

  const sendReset = async () => {
    if (!user?.email) return;
    setBusy('reset');
    try {
      await api.post('/auth/forgot', { email: user.email });
      Alert.alert('Check your inbox', `We've sent a password reset link to ${user.email}.`);
    } catch (e) {
      Alert.alert("Couldn't send the link", extractErrorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const deleteAccount = () => {
    Alert.alert(
      'Delete account?',
      "This permanently deletes your Wayly account, household, statements, and family thread. This can't be undone.",
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete forever',
          style: 'destructive',
          onPress: async () => {
            setBusy('delete');
            try {
              await api.delete('/auth/account');
              await logout();
              router.replace('/(auth)/login');
            } catch (e) {
              Alert.alert("Couldn't delete", extractErrorMessage(e));
              setBusy(null);
            }
          },
        },
      ]
    );
  };

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.scroll} testID="security-scroll">
        <View style={styles.card}>
          <View style={styles.cardHead}>
            <View style={[styles.iconWrap, { backgroundColor: 'rgba(31, 58, 95, 0.08)' }]}>
              <Ionicons name="key-outline" size={20} color={Colors.brandPrimary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.cardTitle}>Reset your password</Text>
              <Text style={styles.cardSub}>We'll email a link to {user?.email || 'you'}.</Text>
            </View>
          </View>
          <TouchableOpacity onPress={sendReset} disabled={busy === 'reset'} style={[styles.btn, busy === 'reset' && { opacity: 0.6 }]} testID="security-send-reset">
            {busy === 'reset' ? <ActivityIndicator color={Colors.cream} /> : <Text style={styles.btnText}>Send reset link</Text>}
          </TouchableOpacity>
        </View>

        <View style={[styles.card, styles.dangerCard]}>
          <View style={styles.cardHead}>
            <View style={[styles.iconWrap, { backgroundColor: 'rgba(160, 85, 69, 0.1)' }]}>
              <Ionicons name="trash-outline" size={20} color={Colors.severityAlert} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.cardTitle}>Delete account</Text>
              <Text style={styles.cardSub}>Permanently removes your account and all your data.</Text>
            </View>
          </View>
          <TouchableOpacity onPress={deleteAccount} disabled={busy === 'delete'} style={[styles.dangerBtn, busy === 'delete' && { opacity: 0.6 }]} testID="security-delete-account">
            <Text style={styles.dangerBtnText}>{busy === 'delete' ? 'Deleting…' : 'Delete account'}</Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.footnote}>
          Wayly stores your data in encrypted form on Australian servers. We never sell your information. See our privacy policy in the web account for full details.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.lg, paddingBottom: 60 },
  card: { backgroundColor: Colors.cardBg, borderRadius: Radius.lg, padding: Spacing.lg, borderWidth: 1, borderColor: Colors.borderSubtle, marginBottom: Spacing.md },
  dangerCard: { borderColor: 'rgba(160, 85, 69, 0.3)', backgroundColor: 'rgba(160, 85, 69, 0.04)' },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, marginBottom: Spacing.md },
  iconWrap: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  cardTitle: { fontFamily: Fonts.bodySemi, fontSize: 16, color: Colors.brandPrimary },
  cardSub: { fontFamily: Fonts.body, fontSize: 13, color: Colors.textSecondary, marginTop: 2 },
  btn: { backgroundColor: Colors.brandPrimary, borderRadius: Radius.md, paddingVertical: 12, alignItems: 'center', minHeight: 46, justifyContent: 'center' },
  btnText: { fontFamily: Fonts.bodySemi, fontSize: 14, color: Colors.cream },
  dangerBtn: { backgroundColor: Colors.severityAlert, borderRadius: Radius.md, paddingVertical: 12, alignItems: 'center' },
  dangerBtnText: { fontFamily: Fonts.bodySemi, fontSize: 14, color: Colors.cream },
  footnote: { fontFamily: Fonts.body, fontSize: 11, color: Colors.textMuted, textAlign: 'center', marginTop: Spacing.lg, lineHeight: 16 },
});
