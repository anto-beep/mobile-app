import React, { useCallback, useState } from 'react';
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
import BackHeader from '../../src/components/BackHeader';

type NotifItem = {
  id: string;
  title: string;
  body: string;
  severity: 'info' | 'warning' | 'alert';
  related_statement_id?: string | null;
  read: boolean;
  created_at: string;
};

const SEVERITY_COLOR: Record<string, string> = {
  alert: Colors.severityAlert,
  warning: Colors.severityWarning,
  info: Colors.severityInfo,
};

export default function Notifications() {
  const router = useRouter();
  const [items, setItems] = useState<NotifItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = async () => {
    try {
      const { data } = await api.get('/notifications');
      setItems(data?.items || []);
      // Mark all as read silently
      const unreadIds = (data?.items || []).filter((i: NotifItem) => !i.read).map((i: NotifItem) => i.id);
      if (unreadIds.length > 0) {
        api.post('/notifications/read', { ids: unreadIds }).catch(() => {});
      }
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
            tintColor={Colors.brandPrimary}
          />
        }
        testID="notifications-list"
      >
        <Text style={styles.overline}>Things to know</Text>
        <Text style={styles.h1}>Recent alerts</Text>

        {loading ? (
          <View style={styles.loadingFill}>
            <ActivityIndicator size="large" color={Colors.brandPrimary} />
          </View>
        ) : items.length === 0 ? (
          <View style={styles.empty} testID="notifications-empty">
            <Ionicons name="checkmark-circle-outline" size={40} color={Colors.severityInfo} />
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
                  borderLeftColor: SEVERITY_COLOR[n.severity] || Colors.severityInfo,
                  borderLeftWidth: 4,
                },
              ]}
              onPress={() =>
                n.related_statement_id
                  ? router.push(`/statements/${n.related_statement_id}` as any)
                  : null
              }
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
                {new Date(n.created_at).toLocaleString('en-AU', {
                  day: '2-digit',
                  month: 'short',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </Text>
            </TouchableOpacity>
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.lg, paddingBottom: 60 },
  overline: {
    fontFamily: Fonts.bodyMed, fontSize: 11, letterSpacing: 1.5, textTransform: 'uppercase',
    color: Colors.textMuted, marginBottom: 4,
  },
  h1: { fontFamily: Fonts.heading, fontSize: 26, color: Colors.brandPrimary, marginBottom: Spacing.lg, letterSpacing: -0.5 },
  loadingFill: { padding: Spacing.xl, alignItems: 'center' },
  empty: {
    backgroundColor: Colors.cardBg, borderRadius: Radius.lg, padding: Spacing.xl,
    alignItems: 'center', gap: Spacing.sm, borderWidth: 1, borderColor: Colors.borderSubtle,
  },
  emptyTitle: { fontFamily: Fonts.headingMed, fontSize: 18, color: Colors.brandPrimary, marginTop: 4 },
  emptyBody: { fontFamily: Fonts.body, fontSize: 14, color: Colors.textSecondary, textAlign: 'center', lineHeight: 20 },
  card: {
    backgroundColor: Colors.cardBg, borderRadius: Radius.md, padding: Spacing.md,
    marginBottom: Spacing.sm, borderWidth: 1, borderColor: Colors.borderSubtle,
  },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  cardTitle: { fontFamily: Fonts.bodySemi, fontSize: 15, color: Colors.brandPrimary, flex: 1 },
  cardBody: { fontFamily: Fonts.body, fontSize: 13, color: Colors.textSecondary, marginTop: 6, lineHeight: 19 },
  cardTime: { fontFamily: Fonts.bodyMed, fontSize: 11, color: Colors.textMuted, marginTop: 8 },
});
