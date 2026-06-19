// Admin · System Health detail (Milestone 3)
// Lists all services with response time, p95, error rate, uptime.
// Tap a service to drill into its latency series + recent errors.
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, RefreshControl, TouchableOpacity, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { adminApi, useAdminAuth } from '../../src/context/AdminAuthContext';
import { Colors, Fonts, Radius, Spacing } from '../../src/lib/theme';
import type { ColorPalette } from '../../src/lib/theme';
import { useColors } from '../../src/hooks/useColors';
import { useThemedStyles } from '../../src/hooks/useThemedStyles';
import { toast } from '../../src/components/Toast';

type Service = {
  name: string;
  status: 'healthy' | 'degraded' | 'down' | string;
  response_ms?: number;
  p95_ms?: number;
  error_rate_24h?: number;
  checked_at?: string;
};

type ServiceDetail = Service & {
  uptime_30d_pct?: number;
  latency_series?: { t: string; ms: number }[];
  recent_errors?: { at: string; code: string; message: string }[];
  docs_url?: string;
};

function statusTone(status: string) {
  if (status === 'healthy') return { fg: Colors.success, bg: 'rgba(27, 87, 51, 0.12)', icon: 'checkmark-circle' as const };
  if (status === 'degraded') return { fg: Colors.brandSecondary, bg: 'rgba(183, 121, 31, 0.15)', icon: 'alert-circle' as const };
  return { fg: Colors.danger, bg: 'rgba(192, 57, 43, 0.12)', icon: 'close-circle' as const };
}

export default function AdminHealth() {
  const c = useColors();
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const { admin, touch } = useAdminAuth();
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [services, setServices] = useState<Service[]>([]);
  const [llmErrors, setLlmErrors] = useState(0);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [detailLoading, setDetailLoading] = useState<string | null>(null);
  const [details, setDetails] = useState<Record<string, ServiceDetail>>({});

  const load = useCallback(async () => {
    try {
      const { data } = await adminApi.get('/admin/system-health');
      setServices(data.services || []);
      setLlmErrors(data.llm_errors_24h || 0);
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || 'Could not load system health');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const loadDetail = useCallback(async (name: string) => {
    if (details[name]) return;
    setDetailLoading(name);
    try {
      const { data } = await adminApi.get(`/admin/system-health/${name.toLowerCase()}`);
      setDetails((prev) => ({ ...prev, [name]: data }));
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || `Could not load ${name} details`);
    } finally {
      setDetailLoading(null);
    }
  }, [details]);

  const onToggle = (name: string) => {
    if (expanded === name) { setExpanded(null); return; }
    setExpanded(name);
    loadDetail(name);
  };

  if (!admin) return null;

  return (
    <SafeAreaView style={styles.safe} edges={['top']} onTouchStart={touch}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} testID="health-back">
          <Ionicons name="chevron-back" size={22} color={c.brandPrimary} />
          <Text style={styles.backText}>Inbox</Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); setDetails({}); load(); }} tintColor={c.brandPrimary} />}
      >
        <Text style={styles.overline}>System</Text>
        <Text style={styles.h1}>Health</Text>
        <Text style={styles.sub}>Live status of the services Wayly depends on. Tap a card to expand.</Text>

        {loading ? (
          <View style={styles.loader}><ActivityIndicator color={c.brandPrimary} /></View>
        ) : (
          <View style={{ gap: 10, marginTop: Spacing.md }}>
            {services.map((s) => {
              const tone = statusTone(s.status);
              const isOpen = expanded === s.name;
              const detail = details[s.name];
              return (
                <TouchableOpacity
                  key={s.name}
                  activeOpacity={0.85}
                  onPress={() => onToggle(s.name)}
                  style={[styles.card, isOpen && { borderColor: c.brandPrimary }]}
                  testID={`health-${s.name.toLowerCase()}`}
                >
                  <View style={styles.cardHead}>
                    <View style={[styles.statusDot, { backgroundColor: tone.fg }]} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.serviceName}>{s.name}</Text>
                      <View style={styles.metaRow}>
                        <Text style={styles.meta}>{s.response_ms ?? '–'} ms now</Text>
                        <Text style={styles.metaDot}>·</Text>
                        <Text style={styles.meta}>p95 {s.p95_ms ?? '–'} ms</Text>
                        <Text style={styles.metaDot}>·</Text>
                        <Text style={styles.meta}>err {(s.error_rate_24h ?? 0) * 100 < 0.01 ? '<0.01' : ((s.error_rate_24h ?? 0) * 100).toFixed(2)}%</Text>
                      </View>
                    </View>
                    <View style={[styles.pill, { backgroundColor: tone.bg }]}>
                      <Ionicons name={tone.icon} size={12} color={tone.fg} />
                      <Text style={[styles.pillText, { color: tone.fg }]}>{s.status}</Text>
                    </View>
                  </View>

                  {isOpen ? (
                    <View style={styles.expand}>
                      {detailLoading === s.name && !detail ? (
                        <ActivityIndicator color={c.brandPrimary} />
                      ) : detail ? (
                        <>
                          <View style={styles.kpiRow}>
                            <View style={styles.kpi}><Text style={styles.kpiValue}>{detail.uptime_30d_pct?.toFixed(2)}%</Text><Text style={styles.kpiLabel}>30d uptime</Text></View>
                            <View style={styles.kpi}><Text style={styles.kpiValue}>{detail.p95_ms} ms</Text><Text style={styles.kpiLabel}>p95 latency</Text></View>
                            <View style={styles.kpi}><Text style={styles.kpiValue}>{detail.recent_errors?.length ?? 0}</Text><Text style={styles.kpiLabel}>recent errors</Text></View>
                          </View>

                          {detail.latency_series?.length ? (
                            <View style={styles.sparkWrap}>
                              <Text style={styles.sectionLabel}>Latency, last 24h (ms)</Text>
                              <View style={styles.spark}>
                                {(() => {
                                  const series = detail.latency_series!;
                                  const max = Math.max(...series.map((p) => p.ms));
                                  const min = Math.min(...series.map((p) => p.ms));
                                  return series.map((p, i) => {
                                    const h = max === min ? 12 : 6 + ((p.ms - min) / (max - min)) * 36;
                                    return <View key={i} style={[styles.sparkBar, { height: h }]} />;
                                  });
                                })()}
                              </View>
                              <View style={styles.sparkAxis}>
                                <Text style={styles.sparkAxisText}>24h ago</Text>
                                <Text style={styles.sparkAxisText}>now</Text>
                              </View>
                            </View>
                          ) : null}

                          {detail.recent_errors && detail.recent_errors.length > 0 ? (
                            <View>
                              <Text style={styles.sectionLabel}>Recent errors</Text>
                              {detail.recent_errors.map((e, i) => (
                                <View key={i} style={styles.errRow}>
                                  <View style={[styles.dot, { backgroundColor: c.danger }]} />
                                  <View style={{ flex: 1 }}>
                                    <Text style={styles.errCode}>{e.code}</Text>
                                    <Text style={styles.errMessage}>{e.message}</Text>
                                  </View>
                                  <Text style={styles.errTime}>{new Date(e.at).toLocaleTimeString()}</Text>
                                </View>
                              ))}
                            </View>
                          ) : (
                            <View style={styles.allClear}>
                              <Ionicons name="shield-checkmark" size={14} color={c.success} />
                              <Text style={styles.allClearText}>No errors logged in the last 24h.</Text>
                            </View>
                          )}
                        </>
                      ) : null}
                    </View>
                  ) : null}
                </TouchableOpacity>
              );
            })}
          </View>
        )}

        <View style={styles.llmRow}>
          <Ionicons name="sparkles" size={14} color={c.brandSecondary} />
          <Text style={styles.llmText}>LLM errors in last 24h: <Text style={styles.llmCount}>{llmErrors}</Text></Text>
        </View>

        {admin.admin_role === 'super_admin' ? (
          <TouchableOpacity style={styles.cta} onPress={() => router.push('/admin-app/maintenance' as any)} testID="open-maintenance">
            <Ionicons name="build" size={16} color={c.brandPrimary} />
            <Text style={styles.ctaText}>Open maintenance mode</Text>
            <Ionicons name="chevron-forward" size={14} color={c.brandPrimary} />
          </TouchableOpacity>
        ) : (
          <View style={[styles.cta, { opacity: 0.5 }]}>
            <Ionicons name="lock-closed" size={14} color={c.textMuted} />
            <Text style={[styles.ctaText, { color: c.textMuted }]}>Maintenance toggle is super_admin only</Text>
          </View>
        )}

        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

function makeStyles(c: ColorPalette) { return StyleSheet.create({
  safe: { flex: 1, backgroundColor: c.background },
  header: { paddingHorizontal: Spacing.lg, paddingVertical: 8, flexDirection: 'row', alignItems: 'center' },
  backBtn: { flexDirection: 'row', alignItems: 'center', minHeight: 44, paddingRight: 12 },
  backText: { fontFamily: Fonts.bodyMed, fontSize: 15, color: c.brandPrimary, marginLeft: 2 },
  scroll: { padding: Spacing.lg, paddingTop: 4 },
  overline: { fontFamily: Fonts.bodyMed, fontSize: 11, letterSpacing: 1.5, textTransform: 'uppercase', color: c.textMuted },
  h1: { fontFamily: Fonts.heading, fontSize: 30, color: c.brandPrimary, letterSpacing: -0.5 },
  sub: { fontFamily: Fonts.body, fontSize: 13, color: c.textSecondary, marginTop: 4 },
  loader: { paddingVertical: 40, alignItems: 'center' },
  card: { backgroundColor: c.cardBg, borderRadius: Radius.md, borderWidth: 1, borderColor: c.borderSubtle, padding: Spacing.md },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  statusDot: { width: 10, height: 10, borderRadius: 5 },
  serviceName: { fontFamily: Fonts.bodySemi, fontSize: 15, color: c.brandPrimary },
  metaRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', marginTop: 3 },
  meta: { fontFamily: Fonts.body, fontSize: 11, color: c.textSecondary },
  metaDot: { fontFamily: Fonts.body, fontSize: 11, color: c.textMuted, marginHorizontal: 5 },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 100 },
  pillText: { fontFamily: Fonts.bodySemi, fontSize: 10, letterSpacing: 0.5, textTransform: 'uppercase' },
  expand: { marginTop: Spacing.md, paddingTop: Spacing.md, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.borderSubtle, gap: 14 },
  kpiRow: { flexDirection: 'row', gap: 8 },
  kpi: { flex: 1, backgroundColor: c.background, borderRadius: Radius.sm, padding: 10, borderWidth: 1, borderColor: c.borderSubtle, alignItems: 'center' },
  kpiValue: { fontFamily: Fonts.heading, fontSize: 18, color: c.brandPrimary },
  kpiLabel: { fontFamily: Fonts.body, fontSize: 10, color: c.textMuted, marginTop: 2, textAlign: 'center' },
  sparkWrap: { gap: 6 },
  spark: { flexDirection: 'row', alignItems: 'flex-end', height: 50, gap: 3 },
  sparkBar: { flex: 1, backgroundColor: c.brandPrimary, borderRadius: 2, opacity: 0.85 },
  sparkAxis: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 2 },
  sparkAxisText: { fontFamily: Fonts.body, fontSize: 9, color: c.textMuted },
  sectionLabel: { fontFamily: Fonts.bodyMed, fontSize: 10, letterSpacing: 1, textTransform: 'uppercase', color: c.textMuted, marginBottom: 6 },
  errRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.borderSubtle },
  dot: { width: 7, height: 7, borderRadius: 4 },
  errCode: { fontFamily: Fonts.bodySemi, fontSize: 12, color: c.brandPrimary },
  errMessage: { fontFamily: Fonts.body, fontSize: 11, color: c.textSecondary, marginTop: 2 },
  errTime: { fontFamily: Fonts.body, fontSize: 10, color: c.textMuted },
  allClear: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 4 },
  allClearText: { fontFamily: Fonts.body, fontSize: 12, color: c.success },
  llmRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: Spacing.lg, padding: Spacing.md, borderRadius: Radius.md, backgroundColor: 'rgba(183, 121, 31, 0.08)', borderWidth: 1, borderColor: 'rgba(183, 121, 31, 0.3)' },
  llmText: { fontFamily: Fonts.body, fontSize: 12, color: c.textSecondary },
  llmCount: { fontFamily: Fonts.bodySemi, color: c.brandPrimary },
  cta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 14, marginTop: Spacing.lg, borderRadius: Radius.md, backgroundColor: c.cardBg, borderWidth: 1, borderColor: c.border },
  ctaText: { fontFamily: Fonts.bodySemi, fontSize: 14, color: c.brandPrimary },
}); }
