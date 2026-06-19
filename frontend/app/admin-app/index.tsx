// Milestone 2 — Admin Inbox / Triage home
// Replaces the M1 placeholder. Aggregates open P1 tickets, failed payments, data requests,
// health alerts, and maintenance banner. Pull-to-refresh.
import React, { useCallback, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, RefreshControl, TouchableOpacity, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { adminApi, useAdminAuth, AdminRole } from '../../src/context/AdminAuthContext';
import { Fonts, Radius, Spacing, formatAUD } from '../../src/lib/theme';
import type { ColorPalette } from '../../src/lib/theme';
import { useColors } from '../../src/hooks/useColors';
import { useThemedStyles } from '../../src/hooks/useThemedStyles';
import { toast } from '../../src/components/Toast';

const ROLE_LABEL: Record<AdminRole, string> = {
  super_admin: 'Super admin',
  operations_admin: 'Operations',
  support_admin: 'Support',
  content_admin: 'Content',
};

type Ticket = { id: string; subject: string; status: string; priority: string; user_email?: string; user_name?: string; created_at?: string; last_message_preview?: string; message_count?: number };
type DataReq = { id: string; user_email: string; user_name?: string; type: string; status: string; submitted_at: string; due_at: string };
type Service = { name: string; status: 'healthy' | 'down' | string };

export default function AdminInbox() {
  const c = useColors();
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const { admin, logout, touch } = useAdminAuth();
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [p1Count, setP1Count] = useState(0);
  const [opened7d, setOpened7d] = useState(0);
  const [p1Tickets, setP1Tickets] = useState<Ticket[]>([]);
  const [failedPayments, setFailedPayments] = useState<any[]>([]);
  const [dataRequests, setDataRequests] = useState<DataReq[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [llmErrors, setLlmErrors] = useState(0);
  const [maintenance, setMaintenance] = useState<{ enabled: boolean; message?: string }>({ enabled: false });

  const load = useCallback(async () => {
    try {
      const [reports, tickets, fp, dr, health, m] = await Promise.all([
        adminApi.get('/admin/ticket-reports'),
        adminApi.get('/admin/tickets', { params: { status: 'open', priority: 'P1', page_size: 20 } }),
        adminApi.get('/admin/failed-payments', { params: { days: 1 } }),
        adminApi.get('/admin/data-requests', { params: { status: 'received' } }),
        adminApi.get('/admin/system-health'),
        adminApi.get('/admin/maintenance'),
      ]);
      setP1Count(reports.data.open_p1 || 0);
      setOpened7d(reports.data.opened_7d || 0);
      setP1Tickets(tickets.data.items || []);
      setFailedPayments(fp.data.items || []);
      setDataRequests(dr.data.items || []);
      setServices(health.data.services || []);
      setLlmErrors(health.data.llm_errors_24h || 0);
      setMaintenance(m.data || { enabled: false });
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || 'Could not load inbox');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const downServices = services.filter((s) => s.status && s.status !== 'healthy');

  if (!admin) return null;
  if (loading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}><View style={styles.fill}><ActivityIndicator color={c.brandPrimary} size="large" /></View></SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']} onTouchStart={touch}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={c.brandPrimary} />}
        testID="admin-inbox-scroll"
      >
        <View style={styles.headerRow}>
          <View>
            <Text style={styles.overline}>{ROLE_LABEL[admin.admin_role] || admin.admin_role}</Text>
            <Text style={styles.h1}>Inbox</Text>
          </View>
          <TouchableOpacity onPress={() => router.push('/admin-app/users' as any)} style={styles.avatar} testID="admin-users-quick">
            <Ionicons name="search" size={20} color={c.brandPrimary} />
          </TouchableOpacity>
        </View>

        {/* Maintenance banner */}
        {maintenance.enabled ? (
          <View style={[styles.banner, styles.bannerDanger]}>
            <Ionicons name="warning" size={18} color={c.danger} />
            <View style={{ flex: 1 }}>
              <Text style={styles.bannerTitle}>Maintenance mode is ON</Text>
              <Text style={styles.bannerBody}>{maintenance.message || 'Wayly is hidden from the public right now.'}</Text>
            </View>
          </View>
        ) : null}

        {/* Health alerts banner */}
        {(downServices.length > 0 || llmErrors > 10) ? (
          <View style={[styles.banner, styles.bannerWarn]}>
            <Ionicons name="pulse" size={18} color={c.brandSecondary} />
            <View style={{ flex: 1 }}>
              <Text style={styles.bannerTitle}>System alert</Text>
              <Text style={styles.bannerBody}>
                {downServices.length > 0 ? `${downServices.map((s) => s.name).join(', ')} unhealthy. ` : ''}
                {llmErrors > 10 ? `LLM errors in last 24h: ${llmErrors}` : ''}
              </Text>
            </View>
          </View>
        ) : null}

        {/* Quick stats row */}
        <View style={styles.statsRow}>
          <View style={styles.statBox}>
            <Text style={styles.statValue}>{p1Count}</Text>
            <Text style={styles.statLabel}>Open P1</Text>
          </View>
          <View style={styles.statBox}>
            <Text style={styles.statValue}>{opened7d}</Text>
            <Text style={styles.statLabel}>Opened 7d</Text>
          </View>
          <View style={styles.statBox}>
            <Text style={styles.statValue}>{dataRequests.length}</Text>
            <Text style={styles.statLabel}>Privacy</Text>
          </View>
        </View>

        {/* P1 tickets */}
        <Text style={styles.sectionLabel}>Open P1 tickets</Text>
        <View style={styles.card}>
          {p1Tickets.length === 0 ? (
            <View style={styles.emptyRow}>
              <Ionicons name="checkmark-circle" size={16} color={c.success} />
              <Text style={styles.emptyText}>No open P1 tickets — nice.</Text>
            </View>
          ) : p1Tickets.map((t) => (
            <TouchableOpacity key={t.id} style={styles.row} onPress={() => router.push(`/admin-app/tickets/${t.id}` as any)} testID={`ticket-${t.id}`}>
              <View style={[styles.dot, { backgroundColor: c.danger }]} />
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle} numberOfLines={1}>{t.subject}</Text>
                <Text style={styles.rowMeta} numberOfLines={1}>{t.user_name || t.user_email}{t.last_message_preview ? ` · ${t.last_message_preview}` : ''}</Text>
              </View>
              <Ionicons name="chevron-forward" size={14} color={c.textMuted} />
            </TouchableOpacity>
          ))}
        </View>

        {/* Failed payments */}
        <Text style={styles.sectionLabel}>Failed payments (24h)</Text>
        <View style={styles.card}>
          {failedPayments.length === 0 ? (
            <View style={styles.emptyRow}>
              <Ionicons name="checkmark-circle" size={16} color={c.success} />
              <Text style={styles.emptyText}>No failed payments in the last 24 hours.</Text>
            </View>
          ) : failedPayments.map((p, i) => (
            <View key={p.id || i} style={styles.row}>
              <View style={[styles.dot, { backgroundColor: c.brandSecondary }]} />
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle}>{p.user_email}</Text>
                <Text style={styles.rowMeta}>{formatAUD(p.amount || 0)} · {p.plan?.toUpperCase() || '—'}</Text>
              </View>
            </View>
          ))}
        </View>

        {/* Privacy requests */}
        <Text style={styles.sectionLabel}>Privacy data requests</Text>
        <View style={styles.card}>
          {dataRequests.length === 0 ? (
            <View style={styles.emptyRow}>
              <Ionicons name="checkmark-circle" size={16} color={c.success} />
              <Text style={styles.emptyText}>No open data requests.</Text>
            </View>
          ) : dataRequests.map((r) => {
            const due = new Date(r.due_at);
            const daysLeft = Math.max(0, Math.floor((due.getTime() - Date.now()) / 86400000));
            return (
              <View key={r.id} style={styles.row}>
                <View style={[styles.dot, { backgroundColor: c.brandSecondary }]} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowTitle}>{r.user_name || r.user_email} · {r.type}</Text>
                  <Text style={styles.rowMeta}>{daysLeft} day{daysLeft === 1 ? '' : 's'} left (Privacy Act)</Text>
                </View>
                <View style={[styles.pill, { backgroundColor: 'rgba(183, 121, 31, 0.15)' }]}><Text style={[styles.pillText, { color: c.brandSecondary }]}>{r.status}</Text></View>
              </View>
            );
          })}
        </View>

        {/* System health */}
        <View style={styles.sectionRow}>
          <Text style={styles.sectionLabel}>System health</Text>
          <TouchableOpacity onPress={() => router.push('/admin-app/health' as any)} style={styles.linkBtn} testID="open-health">
            <Text style={styles.linkText}>Details</Text>
            <Ionicons name="chevron-forward" size={12} color={c.brandPrimary} />
          </TouchableOpacity>
        </View>
        <View style={styles.healthGrid}>
          {services.map((s) => {
            const ok = s.status === 'healthy';
            return (
              <TouchableOpacity
                key={s.name}
                onPress={() => router.push('/admin-app/health' as any)}
                style={[styles.healthCell, !ok && { borderColor: c.danger }]}
                testID={`health-card-${s.name.toLowerCase()}`}
              >
                <Ionicons name={ok ? 'checkmark-circle' : 'alert-circle'} size={16} color={ok ? c.success : c.danger} />
                <Text style={styles.healthName}>{s.name}</Text>
                <Text style={[styles.healthStatus, { color: ok ? c.success : c.danger }]}>{s.status}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Maintenance CTA (super_admin only — gated card visible to all so they know it exists) */}
        <TouchableOpacity
          style={[styles.maintRow, admin.admin_role !== 'super_admin' && { opacity: 0.55 }]}
          onPress={() => {
            if (admin.admin_role !== 'super_admin') {
              toast.warning('Maintenance toggle is super_admin only.');
              return;
            }
            router.push('/admin-app/maintenance' as any);
          }}
          testID="open-maintenance-cta"
        >
          <View style={[styles.maintIcon, maintenance.enabled && { backgroundColor: 'rgba(192, 57, 43, 0.15)' }]}>
            <Ionicons name={maintenance.enabled ? 'warning' : 'build'} size={16} color={maintenance.enabled ? c.danger : c.brandPrimary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.maintTitle}>{maintenance.enabled ? 'Wayly is offline — maintenance ON' : 'Maintenance mode'}</Text>
            <Text style={styles.maintMeta}>
              {admin.admin_role === 'super_admin' ? 'Tap to toggle (biometric required)' : 'super_admin only'}
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={14} color={c.textMuted} />
        </TouchableOpacity>

        {/* Sign out */}
        <TouchableOpacity
          style={styles.logoutBtn}
          onPress={async () => { await logout(); router.replace('/admin-auth/login' as any); }}
          testID="admin-logout"
        >
          <Ionicons name="log-out-outline" size={16} color={c.brandPrimary} />
          <Text style={styles.logoutText}>Sign out</Text>
        </TouchableOpacity>

        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

function makeStyles(c: ColorPalette) { return StyleSheet.create({
  safe: { flex: 1, backgroundColor: c.background },
  fill: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scroll: { padding: Spacing.lg, paddingBottom: Spacing.xl, gap: 4 },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: Spacing.md },
  overline: { fontFamily: Fonts.bodyMed, fontSize: 11, letterSpacing: 1.5, textTransform: 'uppercase', color: c.textMuted },
  h1: { fontFamily: Fonts.heading, fontSize: 30, color: c.brandPrimary, letterSpacing: -0.5 },
  avatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: c.cardBg, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: c.border },
  banner: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: Spacing.md, borderRadius: Radius.md, marginBottom: Spacing.sm, borderLeftWidth: 3 },
  bannerDanger: { backgroundColor: 'rgba(192, 57, 43, 0.1)', borderLeftColor: c.danger },
  bannerWarn: { backgroundColor: 'rgba(183, 121, 31, 0.1)', borderLeftColor: c.brandSecondary },
  bannerTitle: { fontFamily: Fonts.bodySemi, fontSize: 13, color: c.brandPrimary },
  bannerBody: { fontFamily: Fonts.body, fontSize: 12, color: c.textSecondary, marginTop: 2, lineHeight: 16 },
  statsRow: { flexDirection: 'row', gap: 8, marginBottom: Spacing.md, marginTop: Spacing.sm },
  statBox: { flex: 1, backgroundColor: c.cardBg, borderRadius: Radius.md, padding: Spacing.sm, borderWidth: 1, borderColor: c.borderSubtle, alignItems: 'center' },
  statValue: { fontFamily: Fonts.heading, fontSize: 24, color: c.brandPrimary, letterSpacing: -0.5 },
  statLabel: { fontFamily: Fonts.bodyMed, fontSize: 10, letterSpacing: 0.5, textTransform: 'uppercase', color: c.textMuted, marginTop: 2 },
  sectionLabel: { fontFamily: Fonts.bodyMed, fontSize: 11, letterSpacing: 1.2, textTransform: 'uppercase', color: c.textMuted, marginBottom: 6, marginTop: Spacing.md },
  card: { backgroundColor: c.cardBg, borderRadius: Radius.md, borderWidth: 1, borderColor: c.borderSubtle, paddingHorizontal: Spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.borderSubtle },
  dot: { width: 8, height: 8, borderRadius: 4 },
  rowTitle: { fontFamily: Fonts.bodySemi, fontSize: 13, color: c.brandPrimary },
  rowMeta: { fontFamily: Fonts.body, fontSize: 11, color: c.textSecondary, marginTop: 2 },
  pill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 100 },
  pillText: { fontFamily: Fonts.bodySemi, fontSize: 10, letterSpacing: 0.3, textTransform: 'uppercase' },
  emptyRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 16, paddingHorizontal: Spacing.sm },
  emptyText: { fontFamily: Fonts.body, fontSize: 12, color: c.textSecondary },
  healthGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  healthCell: { flexBasis: '47%', flexGrow: 1, padding: 12, backgroundColor: c.cardBg, borderRadius: Radius.sm, borderWidth: 1, borderColor: c.borderSubtle, gap: 4 },
  healthName: { fontFamily: Fonts.bodySemi, fontSize: 13, color: c.brandPrimary, marginTop: 2 },
  healthStatus: { fontFamily: Fonts.bodyMed, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 },
  sectionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6, marginTop: Spacing.md },
  linkBtn: { flexDirection: 'row', alignItems: 'center', gap: 2, paddingVertical: 4, paddingHorizontal: 4, minHeight: 28 },
  linkText: { fontFamily: Fonts.bodyMed, fontSize: 11, color: c.brandPrimary, textTransform: 'uppercase', letterSpacing: 0.5 },
  maintRow: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: Spacing.md, marginTop: Spacing.md, borderRadius: Radius.md, backgroundColor: c.cardBg, borderWidth: 1, borderColor: c.borderSubtle },
  maintIcon: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(14, 77, 82, 0.08)' },
  maintTitle: { fontFamily: Fonts.bodySemi, fontSize: 13, color: c.brandPrimary },
  maintMeta: { fontFamily: Fonts.body, fontSize: 11, color: c.textSecondary, marginTop: 2 },
  logoutBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 14, borderRadius: Radius.md, backgroundColor: c.cardBg, borderWidth: 1, borderColor: c.border, marginTop: Spacing.lg },
  logoutText: { fontFamily: Fonts.bodySemi, fontSize: 14, color: c.brandPrimary },
}); }
