// Settings → Summary report (PDF download)
// Reuses expo-file-system/legacy + expo-sharing (same flow as the adviser pack).
// On web we trigger a normal anchor download.
import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, ActivityIndicator, Platform, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import BackHeader from '../../src/components/BackHeader';
import { Ionicons } from '@expo/vector-icons';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { Colors, Fonts, Radius, Spacing } from '../../src/lib/theme';
import { TOKEN_KEY, extractErrorMessage } from '../../src/lib/api';
import { getToken } from '../../src/lib/tokenStorage';
import { toast } from '../../src/components/Toast';

const BASE = process.env.EXPO_PUBLIC_BACKEND_URL;
type Period = 'quarter' | 'all';

export default function Reports() {
  const [busy, setBusy] = useState<Period | null>(null);

  async function download(period: Period) {
    setBusy(period);
    try {
      const token = await getToken(TOKEN_KEY);
      if (!token) throw new Error('Please sign in again.');
      const url = `${BASE}/api/reports/summary.pdf?period=${period}`;
      const filename = `wayly-summary-${period}.pdf`;

      if (Platform.OS === 'web') {
        const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
        if (!res.ok) throw new Error(`Server returned ${res.status}`);
        const blob = await res.blob();
        const a = (globalThis as any).document.createElement('a');
        const objUrl = (globalThis as any).URL.createObjectURL(blob);
        a.href = objUrl;
        a.download = filename;
        a.click();
        setTimeout(() => (globalThis as any).URL.revokeObjectURL(objUrl), 4000);
        toast.success('Summary downloaded.');
        return;
      }

      const dest = `${FileSystem.cacheDirectory}${filename}`;
      const dl = await FileSystem.downloadAsync(url, dest, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (dl.status !== 200) throw new Error(`Server returned ${dl.status}`);
      const canShare = await Sharing.isAvailableAsync();
      if (canShare) {
        await Sharing.shareAsync(dl.uri, { mimeType: 'application/pdf', dialogTitle: 'Share summary', UTI: 'com.adobe.pdf' });
      } else {
        Alert.alert('Saved', `Saved to ${dl.uri}`);
      }
      toast.success('Summary downloaded.');
    } catch (e: any) {
      toast.error(extractErrorMessage(e) || 'Could not download. Try again.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <BackHeader title="Summary Reports" />
      <ScrollView contentContainerStyle={styles.scroll} testID="reports-scroll">
        <Text style={styles.overline}>SUMMARY REPORTS</Text>
        <Text style={styles.h1}>Your Wayly snapshot</Text>
        <Text style={styles.sub}>
          A Wayly-branded PDF you can share with family or your adviser. Includes spend, anomalies, lifetime cap usage and recent statements.
        </Text>

        <View style={styles.card}>
          <View style={styles.cardHead}>
            <View style={[styles.iconWrap, { backgroundColor: 'rgba(14, 77, 82, 0.08)' }]}>
              <Ionicons name="document-text-outline" size={22} color={Colors.brandPrimary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.cardTitle}>This quarter</Text>
              <Text style={styles.cardSub}>Statements uploaded during the current Australian financial quarter.</Text>
            </View>
          </View>
          <TouchableOpacity
            style={[styles.btn, busy === 'quarter' && { opacity: 0.6 }]}
            onPress={() => download('quarter')}
            disabled={!!busy}
            testID="reports-download-quarter"
          >
            {busy === 'quarter' ? (
              <ActivityIndicator color={Colors.cream} />
            ) : (
              <>
                <Ionicons name="download-outline" size={16} color={Colors.cream} />
                <Text style={styles.btnText}>Download quarter PDF</Text>
              </>
            )}
          </TouchableOpacity>
        </View>

        <View style={styles.card}>
          <View style={styles.cardHead}>
            <View style={[styles.iconWrap, { backgroundColor: 'rgba(122, 155, 126, 0.15)' }]}>
              <Ionicons name="albums-outline" size={22} color={Colors.severityInfo} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.cardTitle}>All-time</Text>
              <Text style={styles.cardSub}>Every statement on file, with lifetime cap usage.</Text>
            </View>
          </View>
          <TouchableOpacity
            style={[styles.btn, busy === 'all' && { opacity: 0.6 }]}
            onPress={() => download('all')}
            disabled={!!busy}
            testID="reports-download-all"
          >
            {busy === 'all' ? (
              <ActivityIndicator color={Colors.cream} />
            ) : (
              <>
                <Ionicons name="download-outline" size={16} color={Colors.cream} />
                <Text style={styles.btnText}>Download all-time PDF</Text>
              </>
            )}
          </TouchableOpacity>
        </View>

        <Text style={styles.footnote}>
          AI may be incorrect — verify before acting. This document is generated on demand and is not stored on Wayly servers.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.lg, paddingBottom: 60 },
  overline: { fontFamily: Fonts.bodySemi, fontSize: 11, color: Colors.textMuted, letterSpacing: 1.4 },
  h1: { fontFamily: Fonts.heading, fontSize: 26, color: Colors.brandPrimary, marginTop: 2, marginBottom: 4 },
  sub: { fontFamily: Fonts.body, fontSize: 13, color: Colors.textSecondary, marginBottom: Spacing.lg, lineHeight: 19 },
  card: {
    backgroundColor: Colors.cardBg, borderRadius: Radius.lg, padding: Spacing.lg,
    borderWidth: 1, borderColor: Colors.borderSubtle, marginBottom: Spacing.md,
  },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, marginBottom: Spacing.md },
  iconWrap: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  cardTitle: { fontFamily: Fonts.bodySemi, fontSize: 16, color: Colors.brandPrimary },
  cardSub: { fontFamily: Fonts.body, fontSize: 13, color: Colors.textSecondary, marginTop: 2 },
  btn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: Colors.brandPrimary, borderRadius: Radius.md, paddingVertical: 12, minHeight: 46,
  },
  btnText: { fontFamily: Fonts.bodySemi, fontSize: 14, color: Colors.cream },
  footnote: { fontFamily: Fonts.body, fontSize: 11, color: Colors.textMuted, textAlign: 'center', marginTop: Spacing.lg, lineHeight: 16 },
});
