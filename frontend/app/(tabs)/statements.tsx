import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { api } from '../../src/lib/api';
import { Fonts, formatAUD2, Radius, Spacing  } from '../../src/lib/theme';
import type { ColorPalette } from '../../src/lib/theme';
import { useColors } from '../../src/hooks/useColors';
import { useThemedStyles } from '../../src/hooks/useThemedStyles';
import UploadSheet from '../../src/components/UploadSheet';
import { useParticipants } from '../../src/context/ParticipantsContext';

type Statement = {
  id: string;
  filename: string;
  period_label?: string | null;
  uploaded_at: string;
  line_items: any[];
  summary?: string;
  anomalies: { id: string; severity: 'info' | 'warning' | 'alert' }[];
};

export default function StatementsList() {
  const router = useRouter();
  const { participantSig, active } = useParticipants();
  const c = useColors();
  const styles = useThemedStyles(makeStyles);
  const scrollRef = React.useRef<ScrollView>(null);
  React.useEffect(() => {
    const { TabScrollBus } = require('../../src/lib/tabScrollBus');
    return TabScrollBus.subscribe('statements', () => {
      scrollRef.current?.scrollTo({ y: 0, animated: true });
    });
  }, []);
  const [statements, setStatements] = useState<Statement[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);

  const load = async () => {
    try {
      const { data } = await api.get<Statement[]>('/statements');
      setStatements(data || []);
    } catch {
      // ignore — show empty state
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useFocusEffect(
    useCallback(() => {
      load();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [participantSig, active?.id])
  );

  // Refetch when active participant changes while this screen stays mounted.
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [participantSig, active?.id]);

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: c.background }]} edges={['top']}>
      <ScrollView
        ref={scrollRef}
        contentContainerStyle={styles.scroll}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              load();
            }}
            tintColor={c.brandPrimary}
          />
        }
        testID="statements-scroll-view"
      >
        <Text style={styles.overline}>All statements</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Text style={styles.h1}>Your statement history</Text>
          <TouchableOpacity
            onPress={() => router.push('/statements/archived' as any)}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, backgroundColor: c.surfaceTint, borderWidth: 1, borderColor: c.borderSubtle }}
            testID="statements-archived-link"
            accessibilityRole="link"
            accessibilityLabel="Archived statements"
          >
            <Ionicons name="archive-outline" size={12} color={c.brandPrimary} />
            <Text style={{ fontFamily: Fonts.bodySemi, fontSize: 12, color: c.brandPrimary }}>Archived</Text>
          </TouchableOpacity>
        </View>

        {loading ? (
          <View style={styles.loadingFill}>
            <ActivityIndicator size="large" color={c.brandPrimary} />
          </View>
        ) : statements.length === 0 ? (
          <View style={styles.empty} testID="statements-empty">
            <Ionicons name="document-text-outline" size={36} color={c.textMuted} />
            <Text style={styles.emptyTitle}>No statements yet</Text>
            <Text style={styles.emptyBody}>
              Tap the camera button below to add the first one. We'll do the reading.
            </Text>
          </View>
        ) : (
          statements.map((s) => {
            const total = (s.line_items || []).reduce((acc, li: any) => acc + (li.total || 0), 0);
            const alertCount = (s.anomalies || []).filter(
              (a) => a.severity === 'alert' || a.severity === 'warning'
            ).length;
            return (
              <TouchableOpacity
                key={s.id}
                style={styles.card}
                onPress={() => router.push(`/statements/${s.id}` as any)}
                testID={`statement-list-item-${s.id}`}
              >
                <View style={{ flex: 1 }}>
                  <Text style={styles.cardTitle} testID="statement-item-date">
                    {s.period_label || s.filename}
                  </Text>
                  <Text style={styles.cardMeta}>
                    {(s.line_items || []).length} line items · {formatAUD2(total)} total
                  </Text>
                  {alertCount > 0 && (
                    <View style={styles.alertChip}>
                      <Ionicons name="alert-circle" size={12} color={c.severityAlert} />
                      <Text style={styles.alertChipText}>
                        {alertCount} thing{alertCount > 1 ? 's' : ''} to know
                      </Text>
                    </View>
                  )}
                </View>
                <Ionicons name="chevron-forward" size={18} color={c.textMuted} />
              </TouchableOpacity>
            );
          })
        )}

        <View style={{ height: 100 }} />
      </ScrollView>

      <TouchableOpacity
        style={styles.fab}
        onPress={() => setUploadOpen(true)}
        testID="statements-upload-fab"
      >
        <Ionicons name="add" size={28} color={c.cream} />
      </TouchableOpacity>

      <UploadSheet visible={uploadOpen} onClose={() => setUploadOpen(false)} />
    </SafeAreaView>
  );
}

function makeStyles(c: ColorPalette) { return StyleSheet.create({
  safe: { flex: 1, backgroundColor: c.background },
  scroll: { padding: Spacing.lg, paddingBottom: 100 },
  overline: {
    fontFamily: Fonts.bodyMed, fontSize: 11, letterSpacing: 1.5, textTransform: 'uppercase',
    color: c.textMuted, marginBottom: 4,
  },
  h1: { fontFamily: Fonts.heading, fontSize: 26, color: c.brandPrimary, marginBottom: Spacing.lg, letterSpacing: -0.5 },
  loadingFill: { padding: Spacing.xl, alignItems: 'center' },
  empty: {
    backgroundColor: c.cardBg, borderRadius: Radius.lg, padding: Spacing.xl,
    alignItems: 'center', gap: Spacing.sm, borderWidth: 1, borderColor: c.borderSubtle,
  },
  emptyTitle: { fontFamily: Fonts.headingMed, fontSize: 18, color: c.brandPrimary, marginTop: 8 },
  emptyBody: { fontFamily: Fonts.body, fontSize: 14, color: c.textSecondary, textAlign: 'center', lineHeight: 20 },
  card: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    backgroundColor: c.cardBg, borderRadius: Radius.md,
    padding: Spacing.md + 2, marginBottom: Spacing.sm,
    borderWidth: 1, borderColor: c.borderSubtle,
  },
  cardTitle: { fontFamily: Fonts.bodySemi, fontSize: 16, color: c.brandPrimary },
  cardMeta: { fontFamily: Fonts.body, fontSize: 13, color: c.textSecondary, marginTop: 2 },
  alertChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start',
    backgroundColor: 'rgba(192, 57, 43, 0.1)', paddingHorizontal: 8, paddingVertical: 3,
    borderRadius: 100, marginTop: 6,
  },
  alertChipText: { fontFamily: Fonts.bodySemi, fontSize: 11, color: c.severityAlert },
  fab: {
    position: 'absolute', right: Spacing.lg, bottom: Spacing.lg, width: 60, height: 60, borderRadius: 30,
    backgroundColor: c.brandPrimary, alignItems: 'center', justifyContent: 'center',
    shadowColor: c.brandPrimary, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.25, shadowRadius: 12, elevation: 6,
  },
}); }
