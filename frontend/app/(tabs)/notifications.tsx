import React, { useCallback, useState } from 'react';
import { formatDateTime } from '../../src/lib/formatDate';
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
import { Colors, Fonts, Radius, Spacing } from '../../src/lib/theme';
import type { ColorPalette } from '../../src/lib/theme';
import { useColors } from '../../src/hooks/useColors';
import { useThemedStyles } from '../../src/hooks/useThemedStyles';
import BackHeader from '../../src/components/BackHeader';

type NotifItem = {
  id: string;
  title: string;
  body: string;
  severity: 'info' | 'warning' | 'alert';
  related_statement_id?: string | null;
  type?: string | null;
  deeplink?: string | null;
  read: boolean;
  created_at: string;
};

const SEVERITY_COLOR: Record<string, string> = {
  alert: Colors.severityAlert,
  warning: Colors.severityWarning,
  info: Colors.severityInfo,
};

export default function Notifications() {
  const c = useColors();
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const [items, setItems] = useState<NotifItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = async () => {
    try {
      const { data } = await api.get('/notifications');
      setItems(data?.items || []);
      // Don't mark-all-as-read on load. We want each tap to reduce the
      // unread count and only mark that single notification as read.
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useFocusEffect(
    useCallback(() => {
      load();
    }, [])
  );

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <BackHeader title="Notifications" />
      <ScrollView
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
        testID="notifications-list"
      >
        <Text style={styles.overline}>Things to know</Text>
        <Text style={styles.h1}>Recent alerts</Text>

        {/* QA: fire a sample push that exercises NotificationRouter end-to-end. */}
        <View style={styles.testRow} testID="notifications-test-row">
          <TouchableOpacity
            style={styles.testChip}
            onPress={async () => {
              try {
                const { data } = await api.post('/notifications/test', { type: 'statement_ready' });
                await load();
                if (data?.deeplink) router.push(data.deeplink as any);
              } catch {}
            }}
            testID="notif-test-statement"
          >
            <Ionicons name="document-text-outline" size={12} color={c.brandPrimary} />
            <Text style={styles.testChipText}>Test: statement</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.testChip}
            onPress={async () => {
              try {
                const { data } = await api.post('/notifications/test', { type: 'visit_reminder' });
                await load();
                if (data?.deeplink) router.push(data.deeplink as any);
              } catch {}
            }}
            testID="notif-test-visit"
          >
            <Ionicons name="calendar-outline" size={12} color={c.brandPrimary} />
            <Text style={styles.testChipText}>Test: visit</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.testChip}
            onPress={async () => {
              try {
                const { data } = await api.post('/notifications/test', { type: 'family_message' });
                await load();
                if (data?.deeplink) router.push(data.deeplink as any);
              } catch {}
            }}
            testID="notif-test-family"
          >
            <Ionicons name="people-outline" size={12} color={c.brandPrimary} />
            <Text style={styles.testChipText}>Test: family</Text>
          </TouchableOpacity>
        </View>

        {loading ? (
          <View style={styles.loadingFill}>
            <ActivityIndicator size="large" color={c.brandPrimary} />
          </View>
        ) : items.length === 0 ? (
          <View style={styles.empty} testID="notifications-empty">
            <Ionicons name="checkmark-circle-outline" size={40} color={c.severityInfo} />
            <Text style={styles.emptyTitle}>All caught up</Text>
            <Text style={styles.emptyBody}>
              Nothing unusual at the moment. We'll send you a notification if anything needs a look.
            </Text>
          </View>
        ) : (
          items.map((n) => (
            <TouchableOpacity
              key={n.id}
              style={[
                styles.card,
                {
                  borderLeftColor: SEVERITY_COLOR[n.severity] || c.severityInfo,
                  borderLeftWidth: 4,
                },
              ]}
              onPress={() => {
                // Mark this single notification read (decrements unread badge)
                if (!n.read) {
                  setItems((prev) => prev.map((x) => (x.id === n.id ? { ...x, read: true } : x)));
                  api.post('/notifications/read', { ids: [n.id] }).catch(() => {});
                }
                // Priority: server-issued deeplink → related_statement_id fallback → type-based fallback
                const dl = (n.deeplink || '').trim();
                if (dl && dl.startsWith('/')) {
                  router.push(dl as any);
                  return;
                }
                if (n.related_statement_id) {
                  router.push(`/statements/${n.related_statement_id}` as any);
                  return;
                }
                switch (n.type) {
                  case 'visit_reminder':
                    router.push('/visits' as any);
                    return;
                  case 'family_message':
                    router.push('/(tabs)/family' as any);
                    return;
                  case 'adviser_invite_linked':
                    router.push('/adviser' as any);
                    return;
                  case 'billing':
                    router.push('/settings/plan' as any);
                    return;
                  default:
                    return;
                }
              }}
              testID={`notification-item-${n.id}`}
            >
              <View style={styles.cardHead}>
                <Ionicons
                  name={
                    n.severity === 'alert'
                      ? 'alert-circle'
                      : n.severity === 'warning'
                      ? 'warning'
                      : 'information-circle'
                  }
                  size={18}
                  color={SEVERITY_COLOR[n.severity]}
                />
                <Text style={styles.cardTitle}>{n.title}</Text>
              </View>
              <Text style={styles.cardBody}>{n.body}</Text>
              <Text style={styles.cardTime}>
                {formatDateTime(n.created_at)}
              </Text>
            </TouchableOpacity>
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function makeStyles(c: ColorPalette) { return StyleSheet.create({
  safe: { flex: 1, backgroundColor: c.background },
  scroll: { padding: Spacing.lg, paddingBottom: 60 },
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
  emptyTitle: { fontFamily: Fonts.headingMed, fontSize: 18, color: c.brandPrimary, marginTop: 4 },
  emptyBody: { fontFamily: Fonts.body, fontSize: 14, color: c.textSecondary, textAlign: 'center', lineHeight: 20 },
  card: {
    backgroundColor: c.cardBg, borderRadius: Radius.md, padding: Spacing.md,
    marginBottom: Spacing.sm, borderWidth: 1, borderColor: c.borderSubtle,
  },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  cardTitle: { fontFamily: Fonts.bodySemi, fontSize: 15, color: c.brandPrimary, flex: 1 },
  cardBody: { fontFamily: Fonts.body, fontSize: 13, color: c.textSecondary, marginTop: 6, lineHeight: 19 },
  cardTime: { fontFamily: Fonts.bodyMed, fontSize: 11, color: c.textMuted, marginTop: 8 },
  testRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: Spacing.md },
  testChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingVertical: 6, paddingHorizontal: 10, borderRadius: 100,
    backgroundColor: c.cardBg, borderWidth: 1, borderColor: c.borderSubtle,
    minHeight: 30,
  },
  testChipText: { fontFamily: Fonts.bodyMed, fontSize: 11, color: c.brandPrimary },
}); }
