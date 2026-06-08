// Reports index + on-demand summary PDF generator.
import React, { useState } from 'react';
import { Alert, Linking, TouchableOpacity, View, StyleSheet, Text, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { EmptyState, ListCard, ScreenShell } from '../src/components/Screen';
import { useApi } from '../src/lib/useApi';
import { api } from '../src/lib/api';
import { Colors, Fonts, Spacing, Type } from '../src/lib/theme';
import { toast } from '../src/components/Toast';
import { useAuth } from '../src/context/AuthContext';

async function downloadPdf(period: string, token: string) {
  const base = process.env.EXPO_PUBLIC_BACKEND_URL;
  const url = `${base}/api/reports/summary.pdf?period=${encodeURIComponent(period)}`;
  if (Platform.OS === 'web') {
    window.open(url + `&t=${Date.now()}`, '_blank');
    return;
  }
  const dest = (FileSystem.cacheDirectory || '') + `wayly-summary-${period}.pdf`;
  const res = await FileSystem.downloadAsync(url, dest, { headers: { Authorization: `Bearer ${token}` } });
  if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
  if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(res.uri, { mimeType: 'application/pdf' });
}

export default function Reports() {
  const { data, loading, refreshing, refresh } = useApi<{ items: any[] }>('/reports');
  const items = data?.items || [];
  const [busy, setBusy] = useState<string | null>(null);
  const { user } = useAuth();

  const periods = ['this-month', 'last-month', 'this-quarter', 'this-year'];
  const labels: Record<string, string> = { 'this-month': 'This month', 'last-month': 'Last month', 'this-quarter': 'This quarter', 'this-year': 'This year' };

  async function gen(period: string) {
    setBusy(period);
    try {
      const { getAccessToken } = await import('../src/lib/tokens');
      const tk = await getAccessToken();
      if (!tk) throw new Error('Not signed in');
      await downloadPdf(period, tk);
      toast.success('Report ready');
    } catch (e: any) {
      Alert.alert('Could not generate report', e?.message || 'Try again later');
    } finally { setBusy(null); }
  }

  return (
    <ScreenShell title="Reports" subtitle="On‑demand summary PDFs" loading={loading} onRefresh={refresh} refreshing={refreshing}>
      <View style={styles.grid}>
        {periods.map((p) => (
          <TouchableOpacity key={p} testID={`report-${p}`} style={styles.tile} onPress={() => gen(p)} disabled={!!busy}>
            <View style={styles.tileTop}>
              <Ionicons name={busy === p ? 'hourglass-outline' : 'download-outline'} size={18} color={Colors.brandPrimary} />
              <Text style={styles.tileLabel}>{labels[p]}</Text>
            </View>
            <Text style={styles.tileSub}>Download PDF</Text>
          </TouchableOpacity>
        ))}
      </View>
      {items.length === 0 ? (
        <EmptyState icon="bar-chart-outline" title="No saved reports yet" body="Reports you generate above will be cached here for fast download next time." />
      ) : items.map((r) => (
        <ListCard key={r.id} title={r.title || 'Report'} subtitle={r.period} />
      ))}
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, paddingHorizontal: Spacing.md, marginBottom: Spacing.md },
  tile: { flexGrow: 1, flexBasis: '47%', backgroundColor: Colors.cardBg, borderRadius: 14, padding: Spacing.md, borderWidth: 1, borderColor: Colors.border, gap: 4 },
  tileTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  tileLabel: { ...Type.bodySemi, color: Colors.textPrimary },
  tileSub: { ...Type.caption, color: Colors.textSecondary },
});
