// Signup — mobile mirror of /pages/Signup.jsx on the web.
// Follows the "Wayly Sign-Up, Auth & Onboarding" handover spec:
//   • Optional adviser-invite banner (deep link ?invite=<token>)
//   • Step 1 — Plan cards (Solo · Family · Adviser). Default Family.
//     `?plan=free` redirects (Free plan retired).
//   • Step 2 — 6 fields: first_name, last_name, email, mobile (AU regex),
//     password + PasswordStrength meter, role picker (caregiver default).
//   • Submit → POST /auth/signup → POST /billing/start-trial → route by plan/role.
import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator, StyleSheet, Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { Link, useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../src/context/AuthContext';
import { api, extractErrorMessage } from '../../src/lib/api';
import { toast } from '../../src/components/Toast';
import { Fonts, Radius, Spacing } from '../../src/lib/theme';
import type { ColorPalette } from '../../src/lib/theme';
import { useColors } from '../../src/hooks/useColors';
import { useThemedStyles } from '../../src/hooks/useThemedStyles';
import { AU_MOBILE_RE, PasswordStrength, evaluatePassword } from '../../src/components/PasswordStrength';

type PlanId = 'solo' | 'family' | 'adviser';

const PLANS: Array<{
  id: PlanId; title: string; price: string; period: string; badge?: string; bullets: string[];
}> = [
  {
    id: 'solo', title: 'Solo', price: '$19', period: 'per month',
    bullets: ['All 8 AI tools, unlimited', 'Statement Auto-Decode', 'Anomaly Watch + budget tracker', '1 caregiver seat'],
  },
  {
    id: 'family', title: 'Family', price: '$39', period: 'per month', badge: 'Most popular',
    bullets: ['Everything in Solo', 'Up to 5 family seats', 'Sunday digest emails', 'Adviser & GP role-based sharing'],
  },
  {
    id: 'adviser', title: 'Adviser', price: '$299', period: 'per month', badge: 'For advisors',
    bullets: ['Multi-client portal, up to 25 clients', 'Lifetime-cap tracker + forecasting', 'Review-pack export, priority support', '7-day free trial, no card needed'],
  },
];

export default function Signup() {
  const c = useColors();
  const styles = useThemedStyles(makeStyles);
  const { signup } = useAuth();
  const router = useRouter();
  const params = useLocalSearchParams<{ plan?: string; invite?: string }>();

  // Plan preselection via deep link (?plan=solo|family|adviser). ?plan=free is retired.
  const initialPlan: PlanId = useMemo(() => {
    const p = String(params.plan || '').toLowerCase();
    if (p === 'free') { router.replace('/(auth)/signup' as any); return 'family'; }
    if (p === 'solo' || p === 'family' || p === 'adviser') return p;
    return 'family';
  }, [params.plan, router]);

  const [plan, setPlan] = useState<PlanId>(initialPlan);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [mobile, setMobile] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [role, setRole] = useState<'caregiver' | 'participant'>('caregiver');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mobileError, setMobileError] = useState<string | null>(null);

  // Optional adviser-invite banner (deep link ?invite=<token>).
  const [invite, setInvite] = useState<any>(null);
  useEffect(() => {
    if (!params.invite) return;
    (async () => {
      try {
        const { data } = await api.get(`/public/adviser/invite/${params.invite}`);
        setInvite(data);
        if (data?.client_name) {
          const parts = String(data.client_name).split(/\s+/);
          if (parts[0]) setFirstName((prev) => prev || parts[0]);
          if (parts[1]) setLastName((prev) => prev || parts.slice(1).join(' '));
        }
        if (data?.client_email) setEmail((prev) => prev || data.client_email);
      } catch (e: any) {
        const detail = e?.response?.data?.detail;
        if (detail?.error === 'already_accepted') toast.info('This invitation has already been accepted, please sign in instead.', 5000);
        else if (detail?.error === 'invite_not_found') toast.warning('That invitation link is no longer valid. You can still sign up below.', 5000);
      }
    })();
  }, [params.invite]);

  const name = `${firstName.trim()} ${lastName.trim()}`.trim();
  const pw = evaluatePassword(password, { email, name });
  const mobileTrim = mobile.replace(/\s+/g, '');
  const canSubmit = !!firstName.trim() && !!lastName.trim() && !!email.trim() && AU_MOBILE_RE.test(mobileTrim) && pw.valid;

  async function onSubmit() {
    setError(null); setMobileError(null);
    if (!AU_MOBILE_RE.test(mobileTrim)) { setMobileError('Enter a valid Australian mobile (04XX XXX XXX)'); return; }
    if (!pw.valid) {
      if (pw.containsIdentity) toast.warning("Password shouldn't include your name or email");
      else toast.warning('Password needs 8+ chars with upper, lower, number, and symbol');
      return;
    }
    setSubmitting(true);
    try {
      await signup({
        email: email.trim(), password, first_name: firstName.trim(), last_name: lastName.trim(),
        name, mobile: mobileTrim, role, plan, invite: params.invite ? String(params.invite) : undefined,
      });
      // 7-day free trial for all plans (no card).
      try {
        await api.post('/billing/start-trial', { plan });
        toast.success(`Your free ${plan.charAt(0).toUpperCase() + plan.slice(1)} trial is active for 7 days, ${firstName.trim()}.`, 5000);
      } catch (err: any) {
        const detail = err?.response?.data?.detail;
        if (detail?.error === 'trial_used') {
          toast.info("You've used your free trial, redirecting to checkout.", 4000);
          try {
            const origin = process.env.EXPO_PUBLIC_APP_SCHEME || 'wayly';
            const { data } = await api.post('/billing/checkout', { plan, origin_url: `${origin}://billing/return` });
            // Open in the same web session; on native, will hand off to browser.
            if (data?.url) router.replace(data.url as any);
          } catch { /* noop */ }
        }
      }
      // Route by plan / role.
      if (plan === 'adviser') router.replace('/adviser' as any);
      else if (role === 'participant') router.replace('/participant' as any);
      else router.replace('/onboarding' as any);
    } catch (e: any) {
      setError(e?.message || 'Could not create your account');
    } finally { setSubmitting(false); }
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <KeyboardAwareScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" bottomOffset={24}>
        {/* Brand */}
        <View style={styles.brand}>
          <Text style={styles.brandText}>Wayly</Text>
        </View>

        {/* Adviser invite banner */}
        {invite && (
          <View style={styles.inviteCard}>
            <Text style={styles.inviteHead}>Adviser invitation</Text>
            <Text style={styles.inviteBody}>
              {invite.adviser_name} invited you to Wayly. Your account will link to
              {invite.adviser_first_name ? ` ${invite.adviser_first_name}'s` : ' the adviser\u2019s'}
              {' '}adviser dashboard so they can help you stay on top of your Support at Home statements
              and budget. You can revoke access any time from Settings.
            </Text>
            {!!invite.notes && <Text style={styles.inviteNotes}>&quot;{invite.notes}&quot;</Text>}
          </View>
        )}

        {/* Step 1 — Plan */}
        <Text style={styles.sectionH}>Step 1 · Pick a plan</Text>
        <View style={{ gap: 12 }}>
          {PLANS.map((p) => {
            const selected = plan === p.id;
            return (
              <TouchableOpacity
                key={p.id}
                onPress={() => setPlan(p.id)}
                activeOpacity={0.85}
                style={[styles.planCard, selected && styles.planCardSelected]}
                testID={`signup-plan-${p.id}`}
              >
                <View style={styles.planHead}>
                  <Text style={styles.planTitle}>{p.title}</Text>
                  {!!p.badge && <Text style={styles.planBadge}>{p.badge}</Text>}
                </View>
                <Text style={styles.planPrice}>{p.price} <Text style={styles.planPeriod}>{p.period}</Text></Text>
                <View style={{ gap: 4, marginTop: 6 }}>
                  {p.bullets.map((b, i) => (
                    <Text key={i} style={styles.planBullet}>· {b}</Text>
                  ))}
                </View>
                <View style={styles.planPick}>
                  <View style={[styles.radio, selected && styles.radioActive]}>
                    {selected && <View style={styles.radioDot} />}
                  </View>
                  <Text style={styles.pickText}>{selected ? 'Selected' : 'Tap to pick'}</Text>
                </View>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Step 2 — Details */}
        <Text style={[styles.sectionH, { marginTop: 24 }]}>Step 2 · Your details</Text>

        <View style={styles.rowFields}>
          <View style={{ flex: 1 }}>
            <Text style={styles.lbl}>First name</Text>
            <TextInput value={firstName} onChangeText={setFirstName} maxLength={80} placeholder="Jane" placeholderTextColor={c.textMuted} style={styles.input} testID="signup-first-name-input" autoComplete="given-name" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.lbl}>Last name</Text>
            <TextInput value={lastName} onChangeText={setLastName} maxLength={80} placeholder="Doe" placeholderTextColor={c.textMuted} style={styles.input} testID="signup-last-name-input" autoComplete="family-name" />
          </View>
        </View>

        <Text style={styles.lbl}>Email</Text>
        <TextInput value={email} onChangeText={setEmail} placeholder="you@example.com" placeholderTextColor={c.textMuted} style={styles.input} testID="signup-email-input" autoComplete="email" autoCapitalize="none" keyboardType="email-address" />

        <Text style={styles.lbl}>Mobile number</Text>
        <TextInput value={mobile} onChangeText={(t) => { setMobile(t); setMobileError(null); }} placeholder="04XXXXXXXX" placeholderTextColor={c.textMuted} style={styles.input} testID="signup-mobile-input" keyboardType="phone-pad" autoComplete="tel" />
        {mobileError ? <Text style={styles.err}>{mobileError}</Text> : (
          <Text style={styles.hint}>We use this to help you recover your account and for important security alerts. We will not send you marketing texts.</Text>
        )}

        <Text style={styles.lbl}>Password</Text>
        <View style={styles.pwWrap}>
          <TextInput value={password} onChangeText={setPassword} secureTextEntry={!showPw} placeholder="At least 8 characters" placeholderTextColor={c.textMuted} style={[styles.input, { flex: 1, marginBottom: 0 }]} testID="signup-password-input" autoComplete="new-password" />
          <TouchableOpacity onPress={() => setShowPw((v) => !v)} style={styles.eye} testID="signup-password-toggle" hitSlop={8}>
            <Ionicons name={showPw ? 'eye-off-outline' : 'eye-outline'} size={20} color={c.textMuted} />
          </TouchableOpacity>
        </View>
        <PasswordStrength password={password} email={email} name={name} />

        <Text style={styles.lbl}>Your role</Text>
        <View style={styles.roleRow}>
          <TouchableOpacity
            onPress={() => setRole('caregiver')}
            style={[styles.roleCard, role === 'caregiver' && styles.roleCardActive]}
            testID="signup-role-caregiver"
            activeOpacity={0.85}
          >
            <Ionicons name="people-outline" size={18} color={role === 'caregiver' ? c.textInverse : c.brandPrimary} />
            <Text style={[styles.roleTitle, role === 'caregiver' && styles.roleTitleActive]}>Caregiver</Text>
            <Text style={[styles.roleSub, role === 'caregiver' && styles.roleSubActive]}>I help someone</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => setRole('participant')}
            style={[styles.roleCard, role === 'participant' && styles.roleCardActive]}
            testID="signup-role-participant"
            activeOpacity={0.85}
          >
            <Ionicons name="person-outline" size={18} color={role === 'participant' ? c.textInverse : c.brandPrimary} />
            <Text style={[styles.roleTitle, role === 'participant' && styles.roleTitleActive]}>Participant</Text>
            <Text style={[styles.roleSub, role === 'participant' && styles.roleSubActive]}>I receive care</Text>
          </TouchableOpacity>
        </View>

        {/* Plan summary */}
        <View style={styles.planSummary} testID="signup-plan-summary">
          <Text style={styles.planSummaryText}>
            Selected plan: <Text style={styles.planSummaryBold}>{PLANS.find((p) => p.id === plan)?.title}</Text> · 7-day free trial · cancel any time
          </Text>
        </View>

        {!!error && <Text style={styles.err} testID="signup-error">{error}</Text>}

        <TouchableOpacity
          onPress={onSubmit}
          disabled={!canSubmit || submitting}
          style={[styles.submit, (!canSubmit || submitting) && { opacity: 0.55 }]}
          testID="signup-submit-button"
          activeOpacity={0.85}
        >
          {submitting ? <ActivityIndicator color="#fff" /> : (
            <Text style={styles.submitText}>Start 7-day free trial</Text>
          )}
        </TouchableOpacity>

        <View style={styles.footRow}>
          <Text style={styles.footText}>Already have one? </Text>
          <Link href="/(auth)/login" replace asChild>
            <TouchableOpacity testID="signup-switch-to-login">
              <Text style={styles.footLink}>Sign in</Text>
            </TouchableOpacity>
          </Link>
        </View>
      </KeyboardAwareScrollView>
    </SafeAreaView>
  );
}

function makeStyles(c: ColorPalette) { return StyleSheet.create({
  safe: { flex: 1, backgroundColor: c.background },
  scroll: { padding: Spacing.lg, paddingBottom: 60, gap: 6 },
  brand: { alignItems: 'center', paddingVertical: Spacing.md },
  brandText: { fontFamily: Fonts.heading, fontSize: 32, color: c.brandPrimary, letterSpacing: -0.6 },

  inviteCard: { padding: 14, borderRadius: Radius.md, backgroundColor: 'rgba(14,77,82,0.06)', borderWidth: 1, borderColor: 'rgba(14,77,82,0.16)', gap: 6, marginBottom: 8 },
  inviteHead: { fontFamily: Fonts.bodySemi, color: c.brandPrimary, fontSize: 13, letterSpacing: 0.3, textTransform: 'uppercase' },
  inviteBody: { fontFamily: Fonts.body, fontSize: 13, color: c.textSecondary, lineHeight: 19 },
  inviteNotes: { fontFamily: Fonts.body, fontSize: 12.5, color: c.textMuted, fontStyle: 'italic', marginTop: 4 },

  sectionH: { fontFamily: Fonts.heading, fontSize: 18, color: c.brandPrimary, marginTop: 10, marginBottom: 8, letterSpacing: -0.2 },

  planCard: { padding: 14, borderRadius: Radius.md, borderWidth: 1, borderColor: c.border, backgroundColor: c.cardBg, gap: 4 },
  planCardSelected: { borderColor: c.brandPrimary, borderWidth: 2, backgroundColor: 'rgba(14,77,82,0.05)' },
  planHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  planTitle: { fontFamily: Fonts.heading, fontSize: 20, color: c.brandPrimary, letterSpacing: -0.2 },
  planBadge: { fontFamily: Fonts.bodySemi, fontSize: 11, color: c.brandSecondary, backgroundColor: 'rgba(165,81,43,0.12)', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 9999, letterSpacing: 0.4, textTransform: 'uppercase' },
  planPrice: { fontFamily: Fonts.heading, fontSize: 22, color: c.textPrimary },
  planPeriod: { fontFamily: Fonts.body, fontSize: 13, color: c.textMuted },
  planBullet: { fontFamily: Fonts.body, fontSize: 13, color: c.textSecondary, lineHeight: 19 },
  planPick: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6 },
  radio: { width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: c.border, alignItems: 'center', justifyContent: 'center' },
  radioActive: { borderColor: c.brandPrimary },
  radioDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: c.brandPrimary },
  pickText: { fontFamily: Fonts.bodySemi, fontSize: 12, color: c.brandPrimary },

  lbl: { fontFamily: Fonts.bodySemi, fontSize: 13, color: c.textPrimary, marginTop: 10, marginBottom: 4 },
  input: { borderWidth: 1, borderColor: c.border, borderRadius: Radius.sm, paddingHorizontal: 12, paddingVertical: 12, fontFamily: Fonts.body, fontSize: 15, color: c.textPrimary, backgroundColor: c.cardBg, marginBottom: 4 },
  rowFields: { flexDirection: 'row', gap: 10 },
  hint: { fontFamily: Fonts.body, fontSize: 12, color: c.textMuted, marginBottom: 4, lineHeight: 17 },
  err: { fontFamily: Fonts.bodySemi, fontSize: 12.5, color: '#E07A5F', marginTop: 4 },

  pwWrap: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  eye: { padding: 6, marginBottom: 4 },

  roleRow: { flexDirection: 'row', gap: 10, marginTop: 4 },
  roleCard: { flex: 1, padding: 12, borderRadius: Radius.md, borderWidth: 1, borderColor: c.border, backgroundColor: c.cardBg, alignItems: 'flex-start', gap: 2 },
  roleCardActive: { backgroundColor: c.brandPrimary, borderColor: c.brandPrimary },
  roleTitle: { fontFamily: Fonts.bodySemi, fontSize: 14, color: c.textPrimary, marginTop: 4 },
  roleTitleActive: { color: c.textInverse },
  roleSub: { fontFamily: Fonts.body, fontSize: 12, color: c.textMuted },
  roleSubActive: { color: c.textInverse, opacity: 0.85 },

  planSummary: { marginTop: 16, padding: 10, borderRadius: 9999, backgroundColor: c.surfaceTint, borderWidth: 1, borderColor: c.borderSubtle },
  planSummaryText: { fontFamily: Fonts.body, fontSize: 12.5, color: c.textSecondary, textAlign: 'center' },
  planSummaryBold: { fontFamily: Fonts.bodySemi, color: c.brandPrimary },

  submit: { backgroundColor: c.brandPrimary, paddingVertical: 14, borderRadius: 9999, alignItems: 'center', marginTop: 16 },
  submitText: { color: c.textInverse, fontFamily: Fonts.bodySemi, fontSize: 15, letterSpacing: 0.3 },

  footRow: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', marginTop: 18 },
  footText: { fontFamily: Fonts.body, fontSize: 13, color: c.textSecondary },
  footLink: { fontFamily: Fonts.bodySemi, fontSize: 13, color: c.brandPrimary, textDecorationLine: 'underline' },
}); }
