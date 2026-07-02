// Phase D \u2014 Plan & Billing.
// Billing tile-card + plan picker + checkout / cancel / trial flows.
// Web parity: matches the four-tile billing card with addon labels +
// participant slot meter + plan switcher. Family\u2192Solo guard enforced.
import React, { useEffect, useState } from 'react';
import { Alert, Linking, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { Ionicons } from '@expo/vector-icons';
import BackHeader from '../../src/components/BackHeader';
import { api } from '../../src/lib/api';
import { useAuth } from '../../src/context/AuthContext';
import { useParticipants } from '../../src/context/ParticipantsContext';
import { Fonts, Radius, Spacing, Type, formatAUD2 } from '../../src/lib/theme';
import type { ColorPalette } from '../../src/lib/theme';
import { useColors } from '../../src/hooks/useColors';
import { useThemedStyles } from '../../src/hooks/useThemedStyles';
import { daysUntil, formatAUWeekday, swatchForIndex, initialOf } from '../../src/lib/format';
import { toast } from '../../src/components/Toast';

type Plan = 'FREE' | 'SOLO' | 'FAMILY';

const PLAN_META: Record<Plan, { label: string; price: number; perks: string[] }> = {
  FREE:   { label: 'Free',   price: 0,  perks: ['1 participant', '1 statement / month', 'Basic decoder'] },
  SOLO:   { label: 'Solo',   price: 19, perks: ['1 participant', 'Unlimited statements', 'All AI tools', 'Document vault'] },
  FAMILY: { label: 'Family', price: 39, perks: ['2 participants included', '+$19/mo per extra', 'Family wall + adviser', 'Priority support'] },
};

export default function PlanSettings() {
  const c = useColors();
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const { user, refresh: refreshAuth } = useAuth();
  const { participants, summary, refetch } = useParticipants();
  const [sub, setSub] = useState<any>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function loadSub() {
    try { const { data } = await api.get('/billing/subscription'); setSub(data); }
    catch {}
  }
  useEffect(() => { void loadSub(); }, [user?.id, summary?.base_plan]);

  const currentPlan: Plan = (sub?.plan || user?.plan || 'FREE').toUpperCase();
  const trialDays = sub?.trial_ends_at ? daysUntil(sub.trial_ends_at) : null;
  const activeCount = summary?.participants_active ?? participants.length;
  const PLAN_RANK: Record<Plan, number> = { FREE: 0, SOLO: 1, FAMILY: 2 };
  const ctaLabelFor = (target: Plan) => {
    if (target === 'FREE') return 'Drop to Free';
    if (PLAN_RANK[target] > PLAN_RANK[currentPlan]) return 'Upgrade';
    return `Switch to ${PLAN_META[target].label}`;
  };

  async function startTrial(plan: Plan) {
    setBusy('trial');
    try {
      await api.post('/billing/start-trial', { plan });
      toast.success(`Trial started \u2014 ${plan}`);
      await Promise.all([loadSub(), refetch(), refreshAuth()]);
    } catch (e: any) { Alert.alert('Could not start trial', e?.response?.data?.detail || e?.message); }
    finally { setBusy(null); }
  }

  async function checkout(plan: Plan) {
    if (plan === 'SOLO' && activeCount > 1) {
      Alert.alert(
        'Solo allows 1 participant',
        `You currently have ${activeCount}. Remove the extras (or downgrade them) before switching to Solo.`,
      );
      return;
    }
    setBusy(plan);
    try {
      const origin = 'wayly://';
      const { data } = await api.post('/billing/checkout', { plan, origin_url: origin });
      if (data?.stub_mode) {
        toast.success(`Subscription active (STUB MODE \u2014 no Stripe key configured) \u2014 ${plan}`);
        await Promise.all([loadSub(), refetch(), refreshAuth()]);
        return;
      }
      if (!data?.url) throw new Error('No checkout URL returned');
      if (Platform.OS === 'web') {
        Linking.openURL(data.url);
      } else {
        await WebBrowser.openAuthSessionAsync(data.url, 'wayly://billing/success');
        await Promise.all([loadSub(), refetch(), refreshAuth()]);
      }
    } catch (e: any) { Alert.alert('Checkout failed', e?.response?.data?.detail || e?.message); }
    finally { setBusy(null); }
  }

  async function cancel() {
    Alert.alert('Cancel at period end?', 'You\u2019ll keep access until the end of your current billing period.', [
      { text: 'Keep my plan', style: 'cancel' },
      { text: 'Cancel', style: 'destructive', onPress: async () => {
        try { await api.post('/billing/cancel', {}); toast.success('Cancellation scheduled'); await loadSub(); }
        catch (e: any) { Alert.alert('Could not cancel', e?.response?.data?.detail || e?.message); }
      } },
    ]);
  }

  async function downgradeFree() {
    if (activeCount > 1) {
      Alert.alert('Remove extra participants first', `Free allows 1 participant. You currently have ${activeCount}.`);
      return;
    }
    Alert.alert('Drop to Free?', 'You\u2019ll lose AI tools and statement upload limits.', [
      { text: 'Keep my plan', style: 'cancel' },
      { text: 'Switch to Free', style: 'destructive', onPress: async () => {
        try { await api.post('/billing/downgrade-to-free', {}); toast.success('Switched to Free'); await Promise.all([loadSub(), refetch(), refreshAuth()]); }
        catch (e: any) { Alert.alert('Could not switch', e?.response?.data?.detail || e?.message); }
      } },
    ]);
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <BackHeader title="Plan & Billing" />
      <ScrollView contentContainerStyle={{ paddingBottom: 60 }}>
        {/* ─── Billing tile card ─── */}
        <View style={styles.tileCard} testID="billing-tile-card">
          <View style={styles.tileRow}>
            <Tile label="Plan" value={PLAN_META[currentPlan].label} icon="card-outline" />
            <Tile label="Monthly" value={summary ? formatAUD2(summary.monthly_total) : '\u2014'} icon="cash-outline" />
          </View>
          <View style={styles.tileRow}>
            <Tile label="Participants" value={summary ? `${summary.participants_active} / ${summary.participants_max}` : '\u2014'} icon="people-outline" />
            <Tile label="Add-ons" value={summary ? `${summary.addon_count} \u00d7 ${formatAUD2(summary.addon_price_monthly)}` : '\u2014'} icon="add-circle-outline" />
          </View>
          {trialDays != null && (
            <View style={styles.trialBar} testID="billing-trial-remaining">
              <Ionicons name="ribbon" size={16} color="#5C3D11" />
              <Text style={styles.trialText}>
                {trialDays > 0
                  ? `Trial \u00b7 ${trialDays} day${trialDays === 1 ? '' : 's'} left \u00b7 ends ${formatAUWeekday(sub?.trial_ends_at)}`
                  : `Trial ended \u00b7 ${formatAUWeekday(sub?.trial_ends_at)}`}
              </Text>
            </View>
          )}
          {!!sub?.cancel_at_period_end && (
            <View style={[styles.trialBar, { backgroundColor: '#FBE5E0', borderColor: '#F2C5BB' }]}>
              <Ionicons name="alert-circle" size={16} color="#A5512B" />
              <Text style={[styles.trialText, { color: '#5C3D11' }]}>
                Cancels {formatAUWeekday(sub.current_period_end)} \u2014 you keep access till then
              </Text>
            </View>
          )}
          {/* Active participants strip with add-on labels */}
          {participants.length > 0 && (
            <View style={styles.partRow}>
              {participants.slice(0, 6).map((p, idx) => (
                <View key={p.id} style={styles.partChip}>
                  <View style={[styles.partSw, { backgroundColor: swatchForIndex(p.color_index) }]}>
                    <Text style={styles.partInit}>{initialOf(p.first_name)}</Text>
                  </View>
                  <Text style={styles.partName} numberOfLines={1}>{p.first_name}</Text>
                  {summary && idx >= summary.participants_included && (
                    <View style={styles.addonTag}><Text style={styles.addonTagText}>+${summary.addon_price_monthly}/mo</Text></View>
                  )}
                </View>
              ))}
            </View>
          )}
        </View>

        {/* ─── Plan picker ─── */}
        <Text style={styles.sectionLabel}>Switch plan</Text>
        {(['FREE','SOLO','FAMILY'] as Plan[]).map((p) => {
          const meta = PLAN_META[p];
          const isCurrent = currentPlan === p;
          const canTrial = !isCurrent && p !== 'FREE' && !sub?.trial_used;
          return (
            <View key={p} style={[styles.planCard, isCurrent && styles.planCardActive]} testID={`plan-card-${p.toLowerCase()}`}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <Text style={styles.planTitle}>{meta.label}</Text>
                <Text style={styles.planPrice}>{p === 'FREE' ? 'Free' : `${formatAUD2(meta.price)}/mo`}</Text>
                {isCurrent && <View style={styles.curPill}><Text style={styles.curPillText}>CURRENT</Text></View>}
              </View>
              {meta.perks.map((perk) => (
                <View key={perk} style={styles.perkRow}>
                  <Ionicons name="checkmark" size={14} color={c.brandPrimary} />
                  <Text style={styles.perk}>{perk}</Text>
                </View>
              ))}
              {!isCurrent && (
                <View style={styles.btnRow}>
                  {canTrial && (
                    <TouchableOpacity onPress={() => startTrial(p)} disabled={!!busy} style={[styles.btn, styles.btnGhost]} testID={`plan-trial-${p.toLowerCase()}`}>
                      <Text style={styles.btnGhostText}>{busy === 'trial' ? 'Starting\u2026' : 'Start 7-day trial'}</Text>
                    </TouchableOpacity>
                  )}
                  <TouchableOpacity onPress={() => p === 'FREE' ? downgradeFree() : checkout(p)} disabled={!!busy} style={[styles.btn, styles.btnSolid]} testID={`plan-cta-${p.toLowerCase()}`}>
                    <Text style={styles.btnSolidText}>{busy === p ? 'Opening\u2026' : ctaLabelFor(p)}</Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>
          );
        })}

        {currentPlan !== 'FREE' && !sub?.cancel_at_period_end && (
          <TouchableOpacity onPress={cancel} style={styles.cancelRow} testID="billing-cancel">
            <Text style={styles.cancelText}>Cancel subscription</Text>
          </TouchableOpacity>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function Tile({ label, value, icon }: { label: string; value: string; icon: keyof typeof Ionicons.glyphMap }) {
  const c = useColors();
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.tile}>
      <Ionicons name={icon} size={16} color={c.brandPrimary} />
      <Text style={styles.tileLabel}>{label}</Text>
      <Text style={styles.tileValue} numberOfLines={1}>{value}</Text>
    </View>
  );
}

function makeStyles(c: ColorPalette) { return StyleSheet.create({
  safe: { flex: 1, backgroundColor: c.bg },
  tileCard: { backgroundColor: c.cardBg, borderRadius: 16, padding: Spacing.md, margin: Spacing.md, borderWidth: 1, borderColor: c.border, gap: 10 },
  tileRow: { flexDirection: 'row', gap: 10 },
  tile: { flex: 1, backgroundColor: '#F4ECE0', borderRadius: 12, padding: Spacing.sm, gap: 4 },
  tileLabel: { ...Type.caption, color: c.textSecondary, fontFamily: Fonts.bodyMed },
  tileValue: { ...Type.h3, color: c.textPrimary, fontFamily: Fonts.bodySemi, fontWeight: '700' },
  trialBar: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#FAEFD4', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, borderWidth: 1, borderColor: '#E8D9B3' },
  trialText: { ...Type.body, color: '#5C3D11', fontFamily: Fonts.bodySemi, flex: 1 },
  partRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 },
  partChip: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#F4ECE0', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 9999 },
  partSw: { width: 18, height: 18, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  partInit: { color: '#fff', fontFamily: Fonts.bodySemi, fontSize: 10, fontWeight: '700' },
  partName: { ...Type.caption, color: c.textPrimary, fontFamily: Fonts.bodyMed, maxWidth: 90 },
  addonTag: { backgroundColor: '#F9E5C4', borderRadius: 9999, paddingHorizontal: 6, paddingVertical: 1 },
  addonTagText: { color: '#5C3D11', fontFamily: Fonts.bodySemi, fontSize: 9, fontWeight: '700' },

  sectionLabel: { ...Type.caption, color: c.textMuted, fontFamily: Fonts.bodySemi, textTransform: 'uppercase', letterSpacing: 0.8, paddingHorizontal: Spacing.lg, paddingTop: 6, paddingBottom: 4 },
  planCard: { backgroundColor: c.cardBg, borderRadius: 14, padding: Spacing.md, marginHorizontal: Spacing.md, marginBottom: 10, borderWidth: 1, borderColor: c.border, gap: 6 },
  planCardActive: { borderColor: c.brandPrimary, borderWidth: 2 },
  planTitle: { ...Type.h3, color: c.textPrimary, fontFamily: Fonts.heading, fontSize: 20 },
  planPrice: { ...Type.body, color: c.textSecondary, fontFamily: Fonts.bodyMed, marginLeft: 4 },
  curPill: { marginLeft: 'auto', backgroundColor: c.brandPrimary, borderRadius: 9999, paddingHorizontal: 8, paddingVertical: 2 },
  curPillText: { color: '#fff', fontFamily: Fonts.bodySemi, fontSize: 10, fontWeight: '700', letterSpacing: 0.5 },
  perkRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 1 },
  perk: { ...Type.body, color: c.textSecondary },

  btnRow: { flexDirection: 'row', gap: 8, marginTop: 8 },
  btn: { flex: 1, paddingVertical: 12, borderRadius: 9999, alignItems: 'center' },
  btnGhost: { borderWidth: 1.5, borderColor: c.brandPrimary },
  btnGhostText: { color: c.brandPrimary, fontFamily: Fonts.bodySemi, fontWeight: '700' },
  btnSolid: { backgroundColor: c.brandPrimary },
  btnSolidText: { color: '#fff', fontFamily: Fonts.bodySemi, fontWeight: '700' },

  cancelRow: { alignItems: 'center', paddingVertical: 20 },
  cancelText: { color: c.brandSecondary, fontFamily: Fonts.bodySemi, fontWeight: '700', textDecorationLine: 'underline' },
}); }
