// In-app Plan & Billing — current plan, trial, upgrade (Stripe in-app sheet), cancel, downgrade
import React, { useCallback, useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity, ActivityIndicator, Alert, Linking as RNLinking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';
import { Ionicons } from '@expo/vector-icons';
import { api, extractErrorMessage } from '../../src/lib/api';
import { useAuth } from '../../src/context/AuthContext';
import { Colors, Fonts, Radius, Spacing } from '../../src/lib/theme';

const PLANS = [
  { key: 'free', name: 'Free', price: '$0', period: '', tagline: 'Get a feel for Wayly', features: ['1 free statement decode every 24 hours', 'Read-only dashboard preview'] },
  { key: 'solo', name: 'Solo', price: '$19', period: '/month', tagline: 'You + your parent', features: ['Unlimited statement decoding', 'All 8 AI tools', 'Caregiver dashboard', 'Email support'], highlight: true },
  { key: 'family', name: 'Family', price: '$39', period: '/month', tagline: 'Up to 5 family members', features: ['Everything in Solo', 'Up to 5 family members', 'Family thread', 'Sunday digest', 'Share dashboard'] },
];

type Subscription = {
  plan?: string;
  subscription_status?: string;
  trial_ends_at?: string | null;
  next_billing_date?: string | null;
  cancel_at_period_end?: boolean;
};

const formatDate = (iso?: string | null) => {
  if (!iso) return null;
  try {
    return new Date(iso).toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric' });
  } catch { return null; }
};

const isPaid = (plan?: string) => ['solo', 'family', 'advisor', 'advisor_pro'].includes((plan || '').toLowerCase());

export default function Plan() {
  const router = useRouter();
  const { user, refresh } = useAuth();
  const [sub, setSub] = useState<Subscription | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [trialEligible, setTrialEligible] = useState<boolean>(false);

  const load = async () => {
    try {
      const [s, t] = await Promise.all([
        api.get<Subscription>('/billing/subscription').catch(() => ({ data: { plan: user?.plan || 'free' } })),
        api.get('/billing/trial-eligibility').catch(() => ({ data: { eligible: false } })),
      ]);
      setSub((s as any).data || { plan: user?.plan || 'free' });
      setTrialEligible(!!(t as any).data?.eligible);
    } finally {
      setLoading(false);
    }
  };

  useFocusEffect(useCallback(() => { load(); }, []));

  const startCheckout = async (planKey: string) => {
    setBusy(planKey);
    try {
      const origin = Linking.createURL('/').replace(/\/$/, '');
      const { data } = await api.post('/billing/checkout', { plan: planKey, origin_url: origin });
      const url = data.url || data.checkout_url;
      if (!url) throw new Error('No checkout URL returned');

      // Open Stripe inside the app (in-app browser sheet)
      const result = await WebBrowser.openAuthSessionAsync(url, origin);
      // Best-effort: poll status if we know the session_id
      if (data.session_id) {
        for (let i = 0; i < 10; i++) {
          await new Promise((r) => setTimeout(r, 2000));
          try {
            const st = await api.get(`/billing/status/${data.session_id}`);
            if (st.data?.payment_status === 'paid' || st.data?.status === 'complete' || st.data?.status === 'paid') {
              break;
            }
          } catch { break; }
        }
      }
      await refresh();
      await load();
      Alert.alert('Welcome to ' + planKey.charAt(0).toUpperCase() + planKey.slice(1), 'Thanks for upgrading. Your new plan is active.');
    } catch (e: any) {
      Alert.alert("Couldn't start checkout", extractErrorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const startTrial = async () => {
    setBusy('trial');
    try {
      await api.post('/billing/start-trial');
      await refresh();
      await load();
      Alert.alert('Trial started', 'You have full access to Wayly for the next 7 days.');
    } catch (e) {
      Alert.alert("Couldn't start the trial", extractErrorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const cancel = async () => {
    Alert.alert(
      'Cancel auto-renewal?',
      "Your plan stays active until the end of the current billing period — you just won't be charged again.",
      [
        { text: 'Keep my plan', style: 'cancel' },
        {
          text: 'Yes, cancel',
          style: 'destructive',
          onPress: async () => {
            setBusy('cancel');
            try {
              await api.post('/billing/cancel');
              await refresh();
              await load();
              Alert.alert('Cancelled', 'Auto-renewal has been turned off.');
            } catch (e) {
              Alert.alert("Couldn't cancel", extractErrorMessage(e));
            } finally {
              setBusy(null);
            }
          },
        },
      ]
    );
  };

  const downgradeToFree = async () => {
    Alert.alert(
      'Downgrade to Free?',
      "You'll lose access to AI tools and the full caregiver dashboard at the end of your billing period.",
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Downgrade',
          style: 'destructive',
          onPress: async () => {
            setBusy('downgrade');
            try {
              await api.post('/billing/downgrade-to-free');
              await refresh();
              await load();
              Alert.alert('Downgraded', "You're now on the Free plan.");
            } catch (e) {
              Alert.alert("Couldn't downgrade", extractErrorMessage(e));
            } finally {
              setBusy(null);
            }
          },
        },
      ]
    );
  };

  const upgrade = async (planKey: string) => {
    setBusy(planKey);
    try {
      await api.post('/billing/upgrade', { plan: planKey });
      await refresh();
      await load();
      Alert.alert('Plan changed', `You're now on the ${planKey} plan.`);
    } catch (e: any) {
      // 402 means need new card — fall back to checkout
      const status = e?.response?.status;
      if (status === 402 || status === 400) {
        await startCheckout(planKey);
      } else {
        Alert.alert("Couldn't change plan", extractErrorMessage(e));
      }
    } finally {
      setBusy(null);
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.safe} edges={['bottom']}>
        <View style={styles.loadingFill}><ActivityIndicator color={Colors.brandPrimary} size="large" /></View>
      </SafeAreaView>
    );
  }

  const currentPlan = (sub?.plan || user?.plan || 'free').toLowerCase();
  const trialing = sub?.subscription_status === 'trialing';
  const cancelAtPeriodEnd = !!sub?.cancel_at_period_end;
  const trialEnd = formatDate(sub?.trial_ends_at);
  const nextBilling = formatDate(sub?.next_billing_date);

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.scroll} testID="settings-plan-scroll">
        {/* Current plan */}
        <View style={styles.currentCard} testID="plan-current-card">
          <Text style={styles.currentOverline}>Currently on</Text>
          <Text style={styles.currentPlan}>{currentPlan.toUpperCase()}</Text>
          {trialing && trialEnd && (
            <View style={styles.banner}>
              <Ionicons name="time-outline" size={14} color={Colors.brandSecondary} />
              <Text style={styles.bannerText}>Trial ends {trialEnd}</Text>
            </View>
          )}
          {!trialing && nextBilling && isPaid(currentPlan) && !cancelAtPeriodEnd && (
            <Text style={styles.currentMeta}>Renews {nextBilling}</Text>
          )}
          {cancelAtPeriodEnd && nextBilling && (
            <Text style={[styles.currentMeta, { color: Colors.severityAlert }]}>
              Cancels {nextBilling} — won't renew
            </Text>
          )}

          {currentPlan === 'free' && trialEligible && (
            <TouchableOpacity
              onPress={startTrial}
              disabled={busy === 'trial'}
              style={[styles.btn, { marginTop: Spacing.md }, busy === 'trial' && { opacity: 0.6 }]}
              testID="plan-start-trial"
            >
              <Text style={styles.btnText}>{busy === 'trial' ? 'Starting trial…' : 'Start 7-day free trial'}</Text>
            </TouchableOpacity>
          )}

          {isPaid(currentPlan) && !cancelAtPeriodEnd && (
            <TouchableOpacity onPress={cancel} disabled={busy === 'cancel'} style={[styles.outlineBtn, { marginTop: Spacing.md }]} testID="plan-cancel">
              <Text style={styles.outlineBtnText}>{busy === 'cancel' ? 'Cancelling…' : 'Cancel auto-renewal'}</Text>
            </TouchableOpacity>
          )}

          {isPaid(currentPlan) && (
            <TouchableOpacity onPress={downgradeToFree} disabled={busy === 'downgrade'} style={[styles.linkBtn, { marginTop: Spacing.sm }]} testID="plan-downgrade">
              <Text style={styles.linkBtnText}>Downgrade to Free</Text>
            </TouchableOpacity>
          )}
        </View>

        <Text style={styles.sectionLabel}>{currentPlan === 'free' ? 'Choose a plan' : 'Switch plan'}</Text>

        {PLANS.map((p) => {
          const isCurrent = p.key === currentPlan;
          return (
            <View
              key={p.key}
              style={[styles.planCard, p.highlight && styles.planCardHighlight, isCurrent && styles.planCardCurrent]}
              testID={`plan-card-${p.key}`}
            >
              {p.highlight && !isCurrent && (
                <View style={styles.popularBadge}>
                  <Text style={styles.popularBadgeText}>Most popular</Text>
                </View>
              )}
              <View style={styles.planHead}>
                <View>
                  <Text style={styles.planName}>{p.name}</Text>
                  <Text style={styles.planTag}>{p.tagline}</Text>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={styles.planPrice}>{p.price}</Text>
                  {!!p.period && <Text style={styles.planPeriod}>{p.period}</Text>}
                </View>
              </View>
              {p.features.map((f, i) => (
                <View key={i} style={styles.featureRow}>
                  <Ionicons name="checkmark-circle" size={14} color={Colors.streams.Clinical} />
                  <Text style={styles.featureText}>{f}</Text>
                </View>
              ))}

              {isCurrent ? (
                <View style={[styles.btn, styles.btnDisabled, { marginTop: Spacing.md }]}>
                  <Ionicons name="checkmark" size={16} color={Colors.brandPrimary} />
                  <Text style={[styles.btnText, { color: Colors.brandPrimary, marginLeft: 6 }]}>Current plan</Text>
                </View>
              ) : p.key === 'free' ? (
                isPaid(currentPlan) ? null : (
                  <View style={{ height: Spacing.sm }} />
                )
              ) : (
                <TouchableOpacity
                  style={[styles.btn, { marginTop: Spacing.md }, busy === p.key && { opacity: 0.6 }]}
                  onPress={() => isPaid(currentPlan) ? upgrade(p.key) : startCheckout(p.key)}
                  disabled={!!busy}
                  testID={`plan-select-${p.key}`}
                >
                  <Text style={styles.btnText}>
                    {busy === p.key ? 'Working…' : isPaid(currentPlan) ? `Switch to ${p.name}` : `Choose ${p.name}`}
                  </Text>
                </TouchableOpacity>
              )}
            </View>
          );
        })}

        <View style={styles.note}>
          <Ionicons name="lock-closed-outline" size={14} color={Colors.textMuted} />
          <Text style={styles.noteText}>
            Payments are processed securely by Stripe. Pricing in AUD, includes GST. Cancel anytime.
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  loadingFill: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scroll: { padding: Spacing.lg, paddingBottom: 60 },
  currentCard: {
    backgroundColor: Colors.cardBg, borderRadius: Radius.lg, padding: Spacing.lg,
    borderWidth: 1, borderColor: Colors.borderSubtle, marginBottom: Spacing.lg,
  },
  currentOverline: { fontFamily: Fonts.bodyMed, fontSize: 11, letterSpacing: 1.5, textTransform: 'uppercase', color: Colors.textMuted, marginBottom: 4 },
  currentPlan: { fontFamily: Fonts.heading, fontSize: 32, color: Colors.brandPrimary, letterSpacing: 1 },
  currentMeta: { fontFamily: Fonts.body, fontSize: 13, color: Colors.textSecondary, marginTop: 6 },
  banner: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8, alignSelf: 'flex-start', backgroundColor: 'rgba(212, 162, 78, 0.12)', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 100 },
  bannerText: { fontFamily: Fonts.bodySemi, fontSize: 12, color: Colors.brandSecondary },
  sectionLabel: { fontFamily: Fonts.bodyMed, fontSize: 11, letterSpacing: 1.5, textTransform: 'uppercase', color: Colors.textMuted, marginBottom: Spacing.sm },
  planCard: {
    backgroundColor: Colors.cardBg, borderRadius: Radius.lg, padding: Spacing.lg,
    borderWidth: 1, borderColor: Colors.borderSubtle, marginBottom: Spacing.md,
  },
  planCardHighlight: { borderColor: Colors.brandSecondary, borderWidth: 2 },
  planCardCurrent: { backgroundColor: 'rgba(31, 58, 95, 0.04)', borderColor: Colors.brandPrimary },
  popularBadge: {
    position: 'absolute', top: -12, right: 16, backgroundColor: Colors.brandSecondary,
    paddingHorizontal: 12, paddingVertical: 4, borderRadius: 100,
  },
  popularBadgeText: { fontFamily: Fonts.bodySemi, fontSize: 10, color: Colors.cream, letterSpacing: 1, textTransform: 'uppercase' },
  planHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: Spacing.md },
  planName: { fontFamily: Fonts.heading, fontSize: 22, color: Colors.brandPrimary, letterSpacing: -0.3 },
  planTag: { fontFamily: Fonts.body, fontSize: 12, color: Colors.textSecondary, marginTop: 2 },
  planPrice: { fontFamily: Fonts.heading, fontSize: 26, color: Colors.brandPrimary, letterSpacing: -0.5 },
  planPeriod: { fontFamily: Fonts.body, fontSize: 11, color: Colors.textMuted },
  featureRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  featureText: { fontFamily: Fonts.body, fontSize: 13, color: Colors.textSecondary, flex: 1 },
  btn: { backgroundColor: Colors.brandPrimary, borderRadius: Radius.md, paddingVertical: 14, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', minHeight: 50 },
  btnDisabled: { backgroundColor: Colors.background, borderWidth: 1, borderColor: Colors.brandPrimary },
  btnText: { fontFamily: Fonts.bodySemi, fontSize: 15, color: Colors.cream },
  outlineBtn: { borderWidth: 1, borderColor: Colors.severityAlert, borderRadius: Radius.md, paddingVertical: 12, alignItems: 'center' },
  outlineBtnText: { fontFamily: Fonts.bodySemi, fontSize: 14, color: Colors.severityAlert },
  linkBtn: { paddingVertical: 8, alignItems: 'center' },
  linkBtnText: { fontFamily: Fonts.bodyMed, fontSize: 13, color: Colors.textSecondary, textDecorationLine: 'underline' },
  note: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, padding: Spacing.md, marginTop: Spacing.sm },
  noteText: { fontFamily: Fonts.body, fontSize: 11, color: Colors.textMuted, flex: 1, lineHeight: 16 },
});
