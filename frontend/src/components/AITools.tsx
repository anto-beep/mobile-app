// Shared AI tool components — banners, gates, progress, badges
import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Modal, Pressable, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Colors, Fonts, Radius, Spacing } from '../lib/theme';
import { useAuth } from '../context/AuthContext';

const PAID_PLANS = ['solo', 'family', 'advisor', 'advisor_pro'];

export const trialActive = (u: any) => {
  if (!u?.subscription_status || u.subscription_status !== 'trialing') return false;
  if (!u.trial_ends_at) return false;
  return new Date(u.trial_ends_at) > new Date();
};

export const hasPaidAccess = (u: any) =>
  !!u && (PAID_PLANS.includes((u.plan || '').toLowerCase()) || trialActive(u));

// True only when the user is eligible to start a *new* 7-day trial — i.e. they
// haven't used one yet AND aren't currently on a paid plan. Unauthenticated
// visitors (u == null) are also eligible (they sign up first).
export const canStartTrial = (u: any) => {
  if (!u) return true;
  if (u.trial_used) return false;
  if (hasPaidAccess(u)) return false;
  return true;
};

const TOOL_DISCLAIMERS: Record<string, string> = {
  'statement-decoder': "Wayly's AI reads your statement and flags possible issues. It may misread figures or miss anomalies — always check against the original statement and your provider before disputing anything.",
  'budget-calculator': "These figures use the published Support at Home budget tables. They're a guide — the official quarterly amount on your statement is the source of truth.",
  'provider-price-checker': "Rate comparisons use Wayly's network median and the 1 July 2026 published caps. Some providers legitimately charge more for specialised services. Always read your service agreement.",
  'classification-self-check': "This is informational only. Only My Aged Care's Independent Assessment Tool (IAT) determines your actual classification.",
  'reassessment-letter': "AI drafts can get details wrong. Review carefully, check the date, and add your address before sending.",
  'contribution-estimator': "Contribution rates are based on the published Support at Home schedule. Your actual contribution depends on Services Australia's means assessment.",
  'care-plan-reviewer': "Wayly reviews care plan text for completeness and balance — it doesn't replace your care manager's clinical judgement.",
  'aged-care-qa': "I'm a general Q&A assistant — I can't see your account, statements or budget. I won't recommend specific providers or make clinical decisions. Always confirm details with your provider, My Aged Care on 1800 200 422, or the Aged Care Quality & Safety Commission on 1800 951 822.",
};

export function AIAccuracyBanner({ tool }: { tool: keyof typeof TOOL_DISCLAIMERS | string }) {
  const copy = TOOL_DISCLAIMERS[tool] || "Wayly's AI helps you understand your aged-care information — it can be wrong. Always verify against official sources before making decisions.";
  return (
    <View style={styles.banner} testID="ai-accuracy-banner">
      <Ionicons name="alert-circle" size={16} color={Colors.brandSecondary} />
      <Text style={styles.bannerText}>
        <Text style={styles.bannerBold}>AI may be incorrect.</Text> {copy}
      </Text>
    </View>
  );
}

type ToolGateProps = {
  tool: string;
  variant?: 'unauth' | 'free-plan' | 'sd-limit';
  retryAt?: string | null;
};

export function ToolGate({ tool, variant = 'unauth', retryAt }: ToolGateProps) {
  const router = useRouter();
  const { user } = useAuth();
  const [now, setNow] = useState(Date.now());
  const trialEligible = canStartTrial(user);
  const trialLabel = 'Start free 7-day trial';

  useEffect(() => {
    if (variant !== 'sd-limit' || !retryAt) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [variant, retryAt]);

  if (variant === 'sd-limit') {
    const target = retryAt ? new Date(retryAt).getTime() : 0;
    const ms = Math.max(0, target - now);
    const hours = Math.floor(ms / 3600000);
    const mins = Math.floor((ms % 3600000) / 60000);
    return (
      <View style={[styles.gate, styles.gateLimit]} testID="tool-gate-sd-limit">
        <Ionicons name="time-outline" size={28} color={Colors.brandSecondary} />
        <Text style={styles.gateTitle}>You&apos;ve used your free decode today</Text>
        <Text style={styles.gateBody}>
          Next free decode in <Text style={styles.bold}>{hours}h {mins}m</Text>.
          {trialEligible ? ' Start a 7-day trial to decode unlimited statements right now.' : ' Pick a plan to decode unlimited statements right now.'}
        </Text>
        <TouchableOpacity
          style={styles.goldBtn}
          onPress={() => router.push('/settings/plan' as any)}
          testID="tool-gate-upgrade-btn"
        >
          <Text style={styles.goldBtnText}>{trialEligible ? trialLabel : 'See plans'}</Text>
        </TouchableOpacity>
        {!user && (
          <TouchableOpacity onPress={() => router.push('/(auth)/login' as any)} testID="tool-gate-signin-link">
            <Text style={styles.linkText}>Already have an account? Sign in</Text>
          </TouchableOpacity>
        )}
      </View>
    );
  }

  if (variant === 'free-plan') {
    return (
      <View style={styles.gate} testID="tool-gate-free-plan">
        <View style={[styles.iconBlob, { backgroundColor: 'rgba(183, 121, 31, 0.15)' }]}>
          <Ionicons name="lock-closed-outline" size={22} color={Colors.brandSecondary} />
        </View>
        <Text style={styles.gateTitle}>Paid plan needed</Text>
        <Text style={styles.gateBody}>
          {trialEligible
            ? 'This tool is for Solo and Family plans. Try Wayly free for 7 days — no card required.'
            : 'This tool is for Solo and Family plans. Pick a plan to unlock it.'}
        </Text>
        <TouchableOpacity
          style={styles.goldBtn}
          onPress={() => router.push('/settings/plan' as any)}
          testID="tool-gate-upgrade-btn"
        >
          <Text style={styles.goldBtnText}>{trialEligible ? trialLabel : 'See plans'}</Text>
        </TouchableOpacity>
        {trialEligible && (
          <TouchableOpacity
            style={styles.outlineBtn}
            onPress={() => router.push('/settings/plan' as any)}
            testID="tool-gate-see-plans"
          >
            <Text style={styles.outlineBtnText}>See plans</Text>
          </TouchableOpacity>
        )}
      </View>
    );
  }

  // unauth — visitor has no account, so trial is always available (canStartTrial(null)===true)
  return (
    <View style={styles.gate} testID="tool-gate-unauth">
      <View style={[styles.iconBlob, { backgroundColor: 'rgba(14, 77, 82, 0.08)' }]}>
        <Ionicons name="key-outline" size={22} color={Colors.brandPrimary} />
      </View>
      <Text style={styles.gateTitle}>Sign in to use this tool</Text>
      <Text style={styles.gateBody}>This tool is included with Solo and Family plans. Start your 7-day free trial to try it now.</Text>
      <TouchableOpacity
        style={styles.goldBtn}
        onPress={() => router.push('/(auth)/signup' as any)}
        testID="tool-gate-upgrade-btn"
      >
        <Text style={styles.goldBtnText}>{trialLabel}</Text>
      </TouchableOpacity>
      <TouchableOpacity onPress={() => router.push('/(auth)/login' as any)} testID="tool-gate-signin-link">
        <Text style={styles.linkText}>Already have an account? Sign in</Text>
      </TouchableOpacity>
      <View style={styles.divider} />
      <Text style={styles.escapeHatch}>
        Just need to decode one statement?{' '}
        <Text style={styles.linkInline} onPress={() => router.push('/tools/statement-decoder' as any)}>
          Try the free Statement Decoder
        </Text>
      </Text>
    </View>
  );
}

export function TrialCountdownBanner() {
  const { user } = useAuth();
  const router = useRouter();
  if (!user || !trialActive(user)) return null;
  const end = new Date(user.trial_ends_at!);
  const days = Math.max(0, Math.ceil((end.getTime() - Date.now()) / 86400000));
  return (
    <TouchableOpacity
      style={styles.trialBanner}
      onPress={() => router.push('/settings/plan' as any)}
      testID="trial-countdown-banner"
    >
      <Ionicons name="time-outline" size={14} color={Colors.brandSecondary} />
      <Text style={styles.trialText}>
        <Text style={styles.bold}>{days} day{days === 1 ? '' : 's'}</Text> left in your free trial
      </Text>
      <Text style={styles.trialCta}>Pick a plan ›</Text>
    </TouchableOpacity>
  );
}

const DECODER_STEPS = [
  { key: 'header', label: 'Reading the header' },
  { key: 'clinical', label: 'Clinical services' },
  { key: 'independence', label: 'Independence services' },
  { key: 'everyday', label: 'Everyday living' },
  { key: 'adjustments', label: 'Adjustments & credits' },
  { key: 'provider_notes', label: 'Provider notes' },
  { key: 'audit', label: 'Cross-checking totals' },
];

export function DecoderProgress({ elapsedSec, currentPhase }: { elapsedSec: number; currentPhase?: string }) {
  // Progress steps unlock based on elapsed seconds — each step ~6–9s
  const stepIndex = Math.min(DECODER_STEPS.length, Math.floor(elapsedSec / 7));
  return (
    <View style={styles.progressCard} testID="decoder-progress">
      <View style={styles.progressHead}>
        <ActivityIndicator color={Colors.brandPrimary} />
        <Text style={styles.progressTitle}>Decoding your statement…</Text>
        <Text style={styles.progressElapsed}>{elapsedSec}s</Text>
      </View>
      {DECODER_STEPS.map((s, i) => {
        const done = i < stepIndex;
        const active = i === stepIndex;
        return (
          <View key={s.key} style={styles.stepRow} testID={`decoder-step-${s.key}`}>
            <View style={[styles.stepDot, done && styles.stepDotDone, active && styles.stepDotActive]}>
              {done && <Ionicons name="checkmark" size={10} color={Colors.cream} />}
              {active && <View style={styles.stepDotPulse} />}
            </View>
            <Text style={[styles.stepLabel, done && styles.stepLabelDone, !done && !active && styles.stepLabelPending]}>
              {s.label}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

export function PayMethodBadges() {
  const methods = [
    { name: 'Card', icon: 'card-outline' as const },
    { name: 'Apple Pay', icon: 'logo-apple' as const },
    { name: 'Google Pay', icon: 'logo-google' as const },
    { name: 'PayPal', icon: 'logo-paypal' as const },
  ];
  return (
    <View style={styles.payRow} testID="pay-method-badges">
      <Text style={styles.payLabel}>Pay with</Text>
      {methods.map((m) => (
        <View key={m.name} style={styles.payPill} testID={`pay-method-${m.name.replace(/\s/g, '').toLowerCase()}`}>
          <Ionicons name={m.icon} size={11} color={Colors.textSecondary} />
          <Text style={styles.payPillText}>{m.name}</Text>
        </View>
      ))}
    </View>
  );
}

export function UpgradeGate({ visible, onClose, reason }: { visible: boolean; onClose: () => void; reason?: string }) {
  const router = useRouter();
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={styles.sheet} testID="upgrade-gate-modal">
        <View style={styles.handle} />
        <View style={[styles.iconBlob, { backgroundColor: 'rgba(183, 121, 31, 0.15)', alignSelf: 'center' }]}>
          <Ionicons name="sparkles-outline" size={26} color={Colors.brandSecondary} />
        </View>
        <Text style={[styles.gateTitle, { textAlign: 'center', marginTop: Spacing.md }]}>Upgrade to keep going</Text>
        <Text style={[styles.gateBody, { textAlign: 'center' }]}>{reason || 'This action is on Solo and Family plans. Start your 7-day free trial — no card required.'}</Text>
        <TouchableOpacity
          style={styles.goldBtn}
          onPress={() => { onClose(); router.push('/settings/plan' as any); }}
          testID="upgrade-gate-cta"
        >
          <Text style={styles.goldBtnText}>See plans</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={onClose} style={{ paddingVertical: 10, alignItems: 'center' }}>
          <Text style={styles.linkText}>Not now</Text>
        </TouchableOpacity>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    backgroundColor: 'rgba(183, 121, 31, 0.1)', padding: Spacing.md,
    borderRadius: Radius.md, borderLeftWidth: 3, borderLeftColor: Colors.brandSecondary,
    marginBottom: Spacing.md,
  },
  bannerText: { fontFamily: Fonts.body, fontSize: 12, color: Colors.textPrimary, flex: 1, lineHeight: 17 },
  bannerBold: { fontFamily: Fonts.bodySemi, color: Colors.brandSecondary },

  gate: {
    backgroundColor: Colors.cardBg, borderRadius: Radius.lg, padding: Spacing.lg,
    borderWidth: 1, borderColor: Colors.borderSubtle, alignItems: 'center', gap: 8,
    marginBottom: Spacing.md,
  },
  gateLimit: { backgroundColor: 'rgba(183, 121, 31, 0.05)', borderColor: 'rgba(183, 121, 31, 0.3)' },
  iconBlob: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  gateTitle: { fontFamily: Fonts.heading, fontSize: 20, color: Colors.brandPrimary, letterSpacing: -0.3, marginTop: 6 },
  gateBody: { fontFamily: Fonts.body, fontSize: 13, color: Colors.textSecondary, lineHeight: 19, textAlign: 'center' },
  bold: { fontFamily: Fonts.bodySemi, color: Colors.brandPrimary },
  goldBtn: {
    marginTop: Spacing.md, backgroundColor: Colors.brandSecondary, borderRadius: Radius.md,
    paddingVertical: 14, paddingHorizontal: Spacing.lg, alignSelf: 'stretch', alignItems: 'center',
  },
  goldBtnText: { fontFamily: Fonts.bodySemi, fontSize: 15, color: '#FFFFFF', letterSpacing: 0.2 },
  outlineBtn: {
    marginTop: 6, borderWidth: 1, borderColor: Colors.brandPrimary, borderRadius: Radius.md,
    paddingVertical: 12, paddingHorizontal: Spacing.lg, alignSelf: 'stretch', alignItems: 'center',
  },
  outlineBtnText: { fontFamily: Fonts.bodySemi, fontSize: 14, color: Colors.brandPrimary },
  linkText: { fontFamily: Fonts.bodyMed, fontSize: 13, color: Colors.brandPrimary, textDecorationLine: 'underline', marginTop: 6 },
  linkInline: { fontFamily: Fonts.bodySemi, color: Colors.brandPrimary, textDecorationLine: 'underline' },
  divider: { height: 1, backgroundColor: Colors.borderSubtle, alignSelf: 'stretch', marginVertical: Spacing.md },
  escapeHatch: { fontFamily: Fonts.body, fontSize: 12, color: Colors.textSecondary, textAlign: 'center' },

  trialBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: 'rgba(183, 121, 31, 0.1)', padding: 10, borderRadius: Radius.md,
    marginBottom: Spacing.md, borderWidth: 1, borderColor: 'rgba(183, 121, 31, 0.3)',
  },
  trialText: { fontFamily: Fonts.body, fontSize: 12, color: Colors.brandPrimary, flex: 1 },
  trialCta: { fontFamily: Fonts.bodySemi, fontSize: 12, color: Colors.brandSecondary, letterSpacing: 0.3 },

  progressCard: {
    backgroundColor: Colors.cardBg, borderRadius: Radius.lg, padding: Spacing.lg,
    borderWidth: 1, borderColor: Colors.borderSubtle,
  },
  progressHead: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: Spacing.md },
  progressTitle: { fontFamily: Fonts.headingMed, fontSize: 17, color: Colors.brandPrimary, flex: 1 },
  progressElapsed: { fontFamily: Fonts.bodyMed, fontSize: 12, color: Colors.textMuted },
  stepRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 6 },
  stepDot: { width: 18, height: 18, borderRadius: 9, backgroundColor: Colors.background, borderWidth: 1, borderColor: Colors.border, alignItems: 'center', justifyContent: 'center' },
  stepDotDone: { backgroundColor: Colors.streams.Clinical, borderColor: Colors.streams.Clinical },
  stepDotActive: { borderColor: Colors.brandSecondary, borderWidth: 2 },
  stepDotPulse: { width: 6, height: 6, borderRadius: 3, backgroundColor: Colors.brandSecondary },
  stepLabel: { fontFamily: Fonts.body, fontSize: 14, color: Colors.textPrimary },
  stepLabelDone: { color: Colors.textSecondary, fontFamily: Fonts.bodyMed },
  stepLabelPending: { color: Colors.textMuted },

  payRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6, marginTop: 6 },
  payLabel: { fontFamily: Fonts.bodyMed, fontSize: 10, color: Colors.textMuted, letterSpacing: 1, textTransform: 'uppercase', marginRight: 4 },
  payPill: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 100, backgroundColor: Colors.background, borderWidth: 1, borderColor: Colors.borderSubtle },
  payPillText: { fontFamily: Fonts.bodyMed, fontSize: 10, color: Colors.textSecondary, letterSpacing: 0.3 },

  backdrop: { flex: 1, backgroundColor: 'rgba(14, 77, 82, 0.5)' },
  sheet: { backgroundColor: Colors.cardBg, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: Spacing.lg, paddingBottom: Spacing.xl },
  handle: { width: 40, height: 4, backgroundColor: Colors.border, borderRadius: 2, alignSelf: 'center', marginBottom: Spacing.md },
});
