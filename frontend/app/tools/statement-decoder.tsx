// Statement Decoder (public, 1/day for free users) — snap / upload / paste
import React, { useEffect, useRef, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, TextInput, ActivityIndicator, Alert, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { Ionicons } from '@expo/vector-icons';
import { api, extractErrorMessage } from '../../src/lib/api';
import { useAuth } from '../../src/context/AuthContext';
import { Fonts, Radius, Spacing, formatAUD2 } from '../../src/lib/theme';
import type { ColorPalette } from '../../src/lib/theme';
import { useColors } from '../../src/hooks/useColors';
import { useThemedStyles } from '../../src/hooks/useThemedStyles';
import { AIAccuracyBanner, DecoderProgress, ToolGate, hasPaidAccess } from '../../src/components/AITools';
import { ToolSummary, ReportIssueButton, ReportThis } from '../../src/components/ToolShell';
import { useSensitiveScreen } from '../../src/lib/useSensitiveScreen';

type Tab = 'snap' | 'upload' | 'paste';

export default function StatementDecoder() {
  const c = useColors();
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const { user } = useAuth();
  const [tab, setTab] = useState<Tab>('snap');
  const [text, setText] = useState('');
  const [jobId, setJobId] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [result, setResult] = useState<any>(null);
  const [submitting, setSubmitting] = useState(false);
  const [limitedUntil, setLimitedUntil] = useState<string | null>(null);
  const tickRef = useRef<any>(null);

  // Phase 6 hardening: decoder shows OCR'd statement contents (dollar amounts,
  // line items, anomaly detail). Block screenshot / screen-record while open.
  useSensitiveScreen();

  useEffect(() => {
    if (!jobId) {
      if (tickRef.current) clearInterval(tickRef.current);
      return;
    }
    const start = Date.now();
    tickRef.current = setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 1000);
    return () => clearInterval(tickRef.current);
  }, [jobId]);

  const poll = async (id: string) => {
    // Poll up to 180s total (90 × 2s sleeps). Each individual GET uses a
    // short 8s timeout so a transient slow response doesn't kill the whole
    // decode — we just try again on the next tick. Job-not-found (404) and
    // axios ECONNABORTED both treated as "keep polling".
    for (let i = 0; i < 90; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      try {
        const { data } = await api.get(`/public/decode-job/${id}`, { timeout: 8000 });
        if (data?.status === 'done') {
          setResult(data.result || data);
          setJobId(null);
          return;
        }
        if (data?.status === 'error') throw new Error(data?.error || 'Decoding failed');
      } catch (e: any) {
        // Transient: 404 (job not yet registered), axios per-call timeout,
        // or any network blip → just keep polling until the overall 180s budget.
        if (e?.response?.status === 404) continue;
        if (e?.code === 'ECONNABORTED') continue;
        if (e?.message && /timeout/i.test(e.message)) continue;
        // Real backend "error" status was raised above — re-throw it.
        if (e?.message) throw e;
      }
    }
    throw new Error('Decoding is taking longer than expected. Please try again, your free quota was not used.');
  };

  const submit = async (file?: { uri: string; name: string; mime: string }) => {
    setSubmitting(true);
    setResult(null);
    setLimitedUntil(null);
    try {
      let res;
      if (file) {
        const form = new FormData();
        form.append('file', { uri: file.uri, name: file.name, type: file.mime } as any);
        res = await api.post('/public/decode-statement', form, { headers: { 'Content-Type': 'multipart/form-data' } });
      } else if (text.trim() === '__SAMPLE__') {
        // Dev/QA — exercises the full audit.anomalies + audit.informational_notes
        // render path without burning AI tokens. The backend `_sample` endpoint
        // returns a pre-baked job that includes both note kinds from the spec.
        res = await api.post('/public/decode-statement-text/_sample', {});
      } else {
        if (!text.trim()) { Alert.alert('Add some text', 'Paste the statement text first.'); setSubmitting(false); return; }
        res = await api.post('/public/decode-statement-text', { text });
      }
      const id = res.data?.job_id;
      if (!id) throw new Error('No job id returned');
      setJobId(id);
      await poll(id);
    } catch (e: any) {
      if (e?.response?.status === 429) {
        setLimitedUntil(e.response.data?.retry_at || e.response.data?.next_available || null);
      } else {
        Alert.alert("Could not decode", extractErrorMessage(e));
      }
    } finally {
      setSubmitting(false);
      setJobId(null);
    }
  };

  const snap = async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) { Alert.alert('Need camera access'); return; }
    const r = await ImagePicker.launchCameraAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.9 });
    if (r.canceled || !r.assets?.[0]) return;
    const compressed = await ImageManipulator.manipulateAsync(r.assets[0].uri, [{ resize: { width: 1800 } }], { compress: 0.85, format: ImageManipulator.SaveFormat.JPEG });
    submit({ uri: compressed.uri, name: `snap-${Date.now()}.jpg`, mime: 'image/jpeg' });
  };

  const pickFile = async () => {
    const r = await DocumentPicker.getDocumentAsync({ type: ['application/pdf', 'text/plain', 'text/csv', 'image/*'] });
    if (r.canceled || !r.assets?.[0]) return;
    const f = r.assets[0];
    submit({ uri: f.uri, name: f.name || 'document', mime: f.mimeType || 'application/octet-stream' });
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView contentContainerStyle={styles.scroll} testID="statement-decoder-scroll" keyboardShouldPersistTaps="handled">
        <TouchableOpacity onPress={() => router.back()} style={styles.back}><Ionicons name="chevron-back" size={20} color={c.brandPrimary} /><Text style={styles.backText}>Back</Text></TouchableOpacity>
        <Text style={styles.overline}>Statement Decoder</Text>
        <Text style={styles.h1}>What does this statement actually say?</Text>
        <Text style={styles.sub}>Snap a photo, upload a file, or paste text, we will read it and flag anything off.</Text>

        <AIAccuracyBanner tool="statement-decoder" />

        {limitedUntil ? (
          <ToolGate tool="statement-decoder" variant="sd-limit" retryAt={limitedUntil} />
        ) : null}

        {!limitedUntil && (
          <>
            {/* Tab picker */}
            <View style={styles.tabs}>
              {(['snap', 'upload', 'paste'] as Tab[]).map((t) => (
                <TouchableOpacity
                  key={t}
                  style={[styles.tab, tab === t && styles.tabActive]}
                  onPress={() => setTab(t)}
                  testID={`decoder-tab-${t}`}
                >
                  <Ionicons
                    name={t === 'snap' ? 'camera-outline' : t === 'upload' ? 'document-attach-outline' : 'create-outline'}
                    size={16}
                    color={tab === t ? c.cream : c.brandPrimary}
                  />
                  <Text style={[styles.tabText, tab === t && styles.tabTextActive]}>
                    {t === 'snap' ? 'Snap' : t === 'upload' ? 'Upload' : 'Paste text'}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {jobId ? (
              <DecoderProgress elapsedSec={elapsed} />
            ) : tab === 'paste' ? (
              <View style={styles.card}>
                <TextInput
                  value={text} onChangeText={setText}
                  placeholder="Paste the statement text here…"
                  placeholderTextColor={c.textMuted}
                  multiline numberOfLines={10}
                  style={[styles.input, { minHeight: 180, textAlignVertical: 'top' }]}
                  testID="decoder-paste-input"
                />
                <TouchableOpacity onPress={() => submit()} disabled={submitting} style={[styles.btn, submitting && { opacity: 0.6 }]} testID="decode-submit-btn">
                  {submitting ? <ActivityIndicator color={c.cream} /> : <Text style={styles.btnText}>Decode it</Text>}
                </TouchableOpacity>
              </View>
            ) : (
              <View style={styles.card}>
                <TouchableOpacity onPress={tab === 'snap' ? snap : pickFile} disabled={submitting} style={styles.bigBtn} testID={`decoder-${tab}-btn`}>
                  <Ionicons name={tab === 'snap' ? 'camera' : 'cloud-upload'} size={32} color={c.cream} />
                  <Text style={styles.bigBtnText}>{tab === 'snap' ? 'Take a photo' : 'Choose file'}</Text>
                  <Text style={styles.bigBtnSub}>
                    {tab === 'snap' ? 'Frame the statement; we handle the rest' : 'PDF, image, CSV, or text'}
                  </Text>
                </TouchableOpacity>
              </View>
            )}

            {result && (() => {
              // Source-of-truth resolution — production wayly.com.au returns
              // `audit.anomalies` + `audit.informational_notes`. Some legacy
              // builds still emit top-level keys. Accept both transparently.
              const audit = (result as any).audit || {};
              const anomalies: any[] = Array.isArray(audit.anomalies)
                ? audit.anomalies
                : Array.isArray((result as any).anomalies)
                ? (result as any).anomalies
                : [];
              const informationalNotes: any[] = Array.isArray(audit.informational_notes)
                ? audit.informational_notes
                : Array.isArray((result as any).informational_notes)
                ? (result as any).informational_notes
                : [];
              const lineItems: any[] = Array.isArray((result as any).line_items) ? (result as any).line_items : [];
              const summary: string | undefined = (result as any).summary;
              const periodLabel: string | undefined = (result as any).period_label;
              return (
                <View style={styles.results} testID="decoder-results">
                  <Text style={styles.resultsOverline}>Decoded successfully{periodLabel ? ` · ${periodLabel}` : ''}</Text>
                  <ToolSummary
                    toolName="Statement Decoder"
                    tone={anomalies.length > 0 ? 'alert' : 'success'}
                    headline={(String(summary || '').match(/^[^.]*\./) || [])[0] || 'Your statement has been decoded.'}
                    body={`We checked every line against Support at Home rules. ${anomalies.length > 0 ? `We found ${anomalies.length} thing${anomalies.length === 1 ? '' : 's'} worth checking with your provider.` : 'Nothing looked out of order.'}${summary ? ` ${summary}` : ''}`}
                  />

                  {anomalies.length > 0 && (
                    <>
                      <Text style={styles.sectionTitle}>Points To Check</Text>
                      {anomalies.map((a: any, i: number) => (
                        <View
                          key={a.id || i}
                          style={[
                            styles.anomaly,
                            a.severity === 'alert' && styles.anomalyAlert,
                            a.severity === 'warning' && styles.anomalyWarning,
                          ]}
                          testID={`decoder-anomaly-${i}`}
                        >
                          <View style={styles.anomalyHead}>
                            <View
                              style={[
                                styles.sevBadge,
                                a.severity === 'alert' && styles.sevBadgeAlert,
                                a.severity === 'warning' && styles.sevBadgeWarning,
                              ]}
                            >
                              <Text
                                style={[
                                  styles.sevBadgeText,
                                  a.severity === 'alert' && styles.sevBadgeTextAlert,
                                  a.severity === 'warning' && styles.sevBadgeTextWarning,
                                ]}
                              >
                                {(a.severity || 'info').toUpperCase()}
                              </Text>
                            </View>
                            <Text style={styles.anomalyTitle}>{a.title}</Text>
                          </View>
                          <Text style={styles.anomalyBody}>{a.detail || a.description}</Text>
                          {a.suggested_action ? (
                            <Text style={styles.anomalyAction}>→ {a.suggested_action}</Text>
                          ) : null}
                          <ReportThis tool="Statement Decoder" />
                        </View>
                      ))}
                    </>
                  )}

                  {/* Statement notes, informational only, no severity badges.
                      Carries entries with kind `at_hm_active_commitment` or
                      `previous_period_adjustment` per production spec. */}
                  {informationalNotes.length > 0 && (
                    <>
                      <Text style={styles.sectionTitle}>Statement notes</Text>
                      <Text style={styles.sectionSub}>
                        Context the decoder spotted, not alerts, just things worth knowing.
                      </Text>
                      {informationalNotes.map((n: any, i: number) => (
                        <View key={i} style={styles.note} testID={`decoder-note-${i}`}>
                          <View style={styles.noteHead}>
                            <Ionicons name="information-circle-outline" size={16} color={c.severityInfo} />
                            <Text style={styles.noteTitle}>{n.title || 'Statement note'}</Text>
                          </View>
                          {n.detail ? <Text style={styles.noteBody}>{n.detail}</Text> : null}
                          {n.suggested_action ? (
                            <Text style={styles.noteAction}>→ {n.suggested_action}</Text>
                          ) : null}
                        </View>
                      ))}
                    </>
                  )}

                  {lineItems.length > 0 && (
                    <>
                      <Text style={styles.sectionTitle}>Line items ({lineItems.length})</Text>
                      {lineItems.slice(0, 20).map((li: any, i: number) => (
                        <View key={i} style={styles.lineItem}>
                          <Text style={styles.lineService}>{li.service_name || li.service || 'Service'}</Text>
                          <Text style={styles.lineTotal}>{formatAUD2(li.total || 0)}</Text>
                        </View>
                      ))}
                    </>
                  )}
                  <Text style={styles.disclaimer}>Wayly provides information only, not clinical or financial advice.</Text>
                  <ReportIssueButton tool="Statement Decoder" />
                </View>
              );
            })()}

            {!hasPaidAccess(user) && result && (
              <View style={styles.upsell}>
                <Text style={styles.upsellTitle}>Decode unlimited statements</Text>
                <Text style={styles.upsellBody}>Start your 7-day free trial, no card required.</Text>
                <TouchableOpacity style={styles.upsellBtn} onPress={() => router.push('/settings/plan' as any)} testID="decoder-upsell-cta">
                  <Text style={styles.upsellBtnText}>See plans</Text>
                </TouchableOpacity>
              </View>
            )}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function makeStyles(c: ColorPalette) { return StyleSheet.create({
  safe: { flex: 1, backgroundColor: c.background },
  scroll: { padding: Spacing.lg, paddingBottom: 60 },
  back: { flexDirection: 'row', alignItems: 'center', marginBottom: Spacing.md },
  backText: { fontFamily: Fonts.bodyMed, fontSize: 14, color: c.brandPrimary },
  overline: { fontFamily: Fonts.bodyMed, fontSize: 11, letterSpacing: 1.5, textTransform: 'uppercase', color: c.textMuted },
  h1: { fontFamily: Fonts.heading, fontSize: 24, color: c.brandPrimary, letterSpacing: -0.5 },
  sub: { fontFamily: Fonts.body, fontSize: 14, color: c.textSecondary, marginTop: 6, marginBottom: Spacing.lg },
  tabs: { flexDirection: 'row', backgroundColor: c.cardBg, borderRadius: Radius.md, padding: 4, marginBottom: Spacing.md, borderWidth: 1, borderColor: c.borderSubtle },
  tab: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 10, borderRadius: Radius.sm },
  tabActive: { backgroundColor: c.brandPrimary },
  tabText: { fontFamily: Fonts.bodySemi, fontSize: 13, color: c.brandPrimary },
  tabTextActive: { color: c.cream },
  card: { backgroundColor: c.cardBg, borderRadius: Radius.lg, padding: Spacing.md + 4, borderWidth: 1, borderColor: c.borderSubtle },
  input: { fontFamily: Fonts.body, fontSize: 14, color: c.textPrimary, backgroundColor: c.background, borderRadius: Radius.md, padding: Spacing.md, borderWidth: 1, borderColor: c.border },
  btn: { marginTop: Spacing.md, backgroundColor: c.brandPrimary, borderRadius: Radius.md, paddingVertical: 14, alignItems: 'center', minHeight: 50, justifyContent: 'center' },
  btnText: { fontFamily: Fonts.bodySemi, fontSize: 15, color: c.cream },
  bigBtn: { backgroundColor: c.brandPrimary, borderRadius: Radius.md, paddingVertical: Spacing.xl, alignItems: 'center', gap: 8 },
  bigBtnText: { fontFamily: Fonts.heading, fontSize: 18, color: c.cream },
  bigBtnSub: { fontFamily: Fonts.body, fontSize: 12, color: 'rgba(250, 247, 242, 0.8)' },
  results: { marginTop: Spacing.lg },
  resultsOverline: { fontFamily: Fonts.bodyMed, fontSize: 11, letterSpacing: 1.5, textTransform: 'uppercase', color: c.streams.Clinical, marginBottom: Spacing.sm },
  summaryCard: { backgroundColor: 'rgba(183, 121, 31, 0.08)', borderRadius: Radius.md, padding: Spacing.md, marginBottom: Spacing.md, borderLeftWidth: 3, borderLeftColor: c.brandSecondary },
  summaryLabel: { fontFamily: Fonts.bodyMed, fontSize: 10, letterSpacing: 1, textTransform: 'uppercase', color: c.brandSecondary, marginBottom: 4 },
  summaryText: { fontFamily: Fonts.body, fontSize: 14, color: c.brandPrimary, lineHeight: 21 },
  sectionTitle: { fontFamily: Fonts.headingMed, fontSize: 16, color: c.brandPrimary, marginTop: Spacing.md, marginBottom: Spacing.sm },
  sectionSub: { fontFamily: Fonts.body, fontSize: 12, color: c.textSecondary, marginTop: -Spacing.sm, marginBottom: Spacing.sm, lineHeight: 17 },
  anomaly: { backgroundColor: c.cardBg, padding: Spacing.md, borderRadius: Radius.md, marginBottom: 8, borderLeftWidth: 3, borderLeftColor: c.severityInfo },
  anomalyAlert: { borderLeftColor: c.severityAlert, backgroundColor: 'rgba(192, 57, 43, 0.05)' },
  anomalyWarning: { borderLeftColor: c.severityWarning, backgroundColor: 'rgba(183, 121, 31, 0.05)' },
  anomalyHead: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  sevBadge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, backgroundColor: 'rgba(122, 155, 126, 0.18)' },
  sevBadgeAlert: { backgroundColor: 'rgba(192, 57, 43, 0.18)' },
  sevBadgeWarning: { backgroundColor: 'rgba(183, 121, 31, 0.22)' },
  sevBadgeText: { fontFamily: Fonts.bodySemi, fontSize: 9, letterSpacing: 0.8, color: c.severityInfo },
  sevBadgeTextAlert: { color: c.severityAlert },
  sevBadgeTextWarning: { color: c.severityWarning },
  anomalyTitle: { fontFamily: Fonts.bodySemi, fontSize: 14, color: c.brandPrimary, flex: 1 },
  anomalyBody: { fontFamily: Fonts.body, fontSize: 13, color: c.textSecondary, marginTop: 4, lineHeight: 18 },
  anomalyAction: { fontFamily: Fonts.bodyMed, fontSize: 12, color: c.brandSecondary, marginTop: 6 },
  note: {
    backgroundColor: 'rgba(122, 155, 126, 0.06)',
    borderRadius: Radius.md,
    padding: Spacing.md,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: 'rgba(122, 155, 126, 0.22)',
  },
  noteHead: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 },
  noteTitle: { fontFamily: Fonts.bodySemi, fontSize: 13, color: c.brandPrimary, flex: 1 },
  noteBody: { fontFamily: Fonts.body, fontSize: 12, color: c.textSecondary, lineHeight: 17 },
  noteAction: { fontFamily: Fonts.bodyMed, fontSize: 11, color: c.brandSecondary, marginTop: 4 },
  lineItem: { flexDirection: 'row', justifyContent: 'space-between', padding: Spacing.sm, backgroundColor: c.cardBg, borderRadius: Radius.sm, marginBottom: 4, borderWidth: 1, borderColor: c.borderSubtle },
  lineService: { fontFamily: Fonts.bodyMed, fontSize: 13, color: c.textPrimary, flex: 1 },
  lineTotal: { fontFamily: Fonts.monoSemi, fontVariant: ['tabular-nums' as const], fontSize: 13, color: c.brandPrimary },
  disclaimer: { fontFamily: Fonts.body, fontSize: 12, color: c.textMuted, marginTop: Spacing.md, fontStyle: 'italic', lineHeight: 17 },
  upsell: { marginTop: Spacing.lg, backgroundColor: c.brandPrimary, borderRadius: Radius.lg, padding: Spacing.lg, alignItems: 'center' },
  upsellTitle: { fontFamily: Fonts.heading, fontSize: 20, color: c.cream, textAlign: 'center', letterSpacing: -0.3 },
  upsellBody: { fontFamily: Fonts.body, fontSize: 14, color: 'rgba(250, 247, 242, 0.85)', marginTop: 6, marginBottom: Spacing.md, textAlign: 'center' },
  upsellBtn: { backgroundColor: c.brandSecondary, borderRadius: Radius.md, paddingVertical: 12, paddingHorizontal: Spacing.lg, alignSelf: 'stretch', alignItems: 'center' },
  // WCAG: text on the gold brandSecondary fill must be white (brand spec).
  upsellBtnText: { fontFamily: Fonts.bodySemi, fontSize: 14, color: '#FFFFFF' },
}); }
