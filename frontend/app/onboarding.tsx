// First-run wizard — mobile mirror of the web /onboarding 4-step flow.
//   Step 1  The essentials       (name, DOB, pension, classification, provider, statement)
//   Step 2  Confirm authorisation (single checkbox with legal copy)
//   Step 3  Recommended details  (preferred name, MAC ref, suburb/state, HCP, relationship, phone)
//   Step 4  All done             (completeness % + Sharpen Wayly's accuracy grid)
// Fields land on POST /api/participants (see backend `ParticipantCreate`).
// Optional Step 3/4 fields are stored so `sharpen accuracy` cards can pre-fill in tools.
import React, { useMemo, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { api } from '../src/lib/api';
import { useAuth } from '../src/context/AuthContext';
import { useParticipants } from '../src/context/ParticipantsContext';
import { Fonts, Radius, Spacing } from '../src/lib/theme';
import type { ColorPalette } from '../src/lib/theme';
import { useColors } from '../src/hooks/useColors';
import { useThemedStyles } from '../src/hooks/useThemedStyles';
import { toast } from '../src/components/Toast';

/** Support at Home yearly indicative values shown in the classification picker
 * (mirrors web /onboarding — labels are illustrative caps, not entitlements). */
const CLASSIFICATIONS: Array<{ n: number; yr: string }> = [
  { n: 1, yr: '$10,731/yr' },
  { n: 2, yr: '$16,034/yr' },
  { n: 3, yr: '$21,966/yr' },
  { n: 4, yr: '$29,696/yr' },
  { n: 5, yr: '$39,697/yr' },
  { n: 6, yr: '$48,114/yr' },
  { n: 7, yr: '$58,148/yr' },
  { n: 8, yr: '$78,106/yr' },
];

const PENSION_OPTIONS = [
  { id: 'full', title: 'Full Age Pension', sub: 'Receives 100% of the Age Pension' },
  { id: 'part', title: 'Part Age Pension', sub: 'Receives a reduced Age Pension under means testing' },
  { id: 'cshc', title: 'Commonwealth Seniors Health Card (CSHC)', sub: 'Above pension threshold but holds CSHC' },
  { id: 'self', title: 'Self-funded retiree', sub: 'Not eligible for the Age Pension or CSHC' },
  { id: 'unsure', title: "I'm not sure", sub: 'Wayly will use a range, you can update later' },
] as const;

const STATEMENT_OPTIONS = [
  { id: 'email', label: 'Email' },
  { id: 'post', label: 'Post' },
  { id: 'portal', label: 'Provider portal' },
  { id: 'other', label: 'Other' },
] as const;

const AU_STATES = ['NSW', 'VIC', 'QLD', 'WA', 'SA', 'TAS', 'ACT', 'NT'] as const;

const RELATIONSHIPS = [
  'Son', 'Daughter', 'Spouse', 'Parent', 'Sibling', 'Other family', 'Friend', 'Carer',
] as const;

const HCP_OPTIONS = [
  { id: 'yes', label: 'Yes' },
  { id: 'no', label: 'No' },
  { id: 'unsure', label: 'Unsure' },
] as const;

const STEP_LABELS = ['Essentials', 'Authorisation', 'Recommended', 'All done'] as const;

/** Accept only digits and slashes, auto-insert "/" so users type "12122015". */
function maskDate(v: string): string {
  const digits = v.replace(/\D/g, '').slice(0, 8);
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
}

/** DD/MM/YYYY → YYYY-MM-DD (ISO) for backend `date_of_birth`. */
function isoFromDDMMYYYY(dob: string): string | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(dob.trim());
  if (!m) return null;
  const [_unused, dd, mm, yyyy] = m; void _unused;
  const d = new Date(`${yyyy}-${mm}-${dd}T00:00:00Z`);
  if (isNaN(d.getTime())) return null;
  return `${yyyy}-${mm}-${dd}`;
}

const AU_MOBILE_RE = /^(?:\+614\d{8}|04\d{8})$/;

export default function Onboarding() {
  const c = useColors();
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const { refresh } = useAuth();
  const { refetch } = useParticipants();

  // Step index (0-3). Completed steps show ✓ in the stepper.
  const [step, setStep] = useState<0 | 1 | 2 | 3>(0);
  const [busy, setBusy] = useState(false);

  // Step 1 — Essentials.
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [dob, setDob] = useState('');
  const [dobHelp, setDobHelp] = useState(false);
  const [pension, setPension] = useState<string | null>(null);
  const [pensionHelp, setPensionHelp] = useState(false);
  const [classification, setClassification] = useState<number>(0); // 0 = not chosen
  const [classHelp, setClassHelp] = useState(false);
  const [provider, setProvider] = useState('');
  const [statementDelivery, setStatementDelivery] = useState<string | null>(null);

  // Step 2 — Authorisation.
  const [authorised, setAuthorised] = useState(false);

  // Step 3 — Recommended (all optional).
  const [preferredName, setPreferredName] = useState('');
  const [macRef, setMacRef] = useState('');
  const [suburb, setSuburb] = useState('');
  const [stateCode, setStateCode] = useState<string | null>(null);
  const [hcpTransition, setHcpTransition] = useState<string | null>(null);
  const [relationship, setRelationship] = useState<string | null>(null);
  const [phone, setPhone] = useState('');

  const step1Valid =
    firstName.trim().length > 0 &&
    !!isoFromDDMMYYYY(dob) &&
    !!pension &&
    classification >= 1 && classification <= 8 &&
    provider.trim().length > 0 &&
    !!statementDelivery;

  // Completeness (12 fields tracked).
  const completeness = useMemo(() => {
    const filled = [
      firstName.trim(), lastName.trim(), dob, pension, classification > 0 ? '1' : '',
      provider.trim(), statementDelivery, authorised ? '1' : '',
      preferredName.trim(), macRef.trim(), suburb.trim(), stateCode,
      hcpTransition, relationship, phone.trim(),
    ].filter(Boolean).length;
    return Math.min(100, Math.round((filled / 15) * 100));
  }, [firstName, lastName, dob, pension, classification, provider, statementDelivery,
      authorised, preferredName, macRef, suburb, stateCode, hcpTransition, relationship, phone]);

  const completenessLabel = completeness >= 85 ? 'Good enough'
    : completeness >= 60 ? 'Getting there'
    : 'Add more details';

  function submitStep1() {
    if (!step1Valid) {
      if (!firstName.trim()) return Alert.alert('First name is required');
      if (!isoFromDDMMYYYY(dob)) return Alert.alert('Please enter DOB as DD/MM/YYYY');
      if (!pension) return Alert.alert('Please choose a pension status');
      if (classification < 1) return Alert.alert('Please choose a Support at Home classification');
      if (!provider.trim()) return Alert.alert('Please enter the registered provider');
      if (!statementDelivery) return Alert.alert('Please choose how you receive statements');
      return;
    }
    setStep(1);
  }

  function submitStep2() {
    if (!authorised) return Alert.alert('Please confirm your authorisation to continue');
    setStep(2);
  }

  function submitStep3() {
    if (phone.trim() && !AU_MOBILE_RE.test(phone.replace(/\s+/g, ''))) {
      return Alert.alert('Please enter a valid AU mobile (04XX XXX XXX) or leave blank');
    }
    persistAndAdvance();
  }

  function skipStep3() {
    persistAndAdvance();
  }

  async function persistAndAdvance() {
    setBusy(true);
    try {
      // Ensure household exists (server idempotently creates one if missing).
      try {
        await api.post('/household', {
          participant_name: `${firstName.trim()} ${lastName.trim()}`.trim(),
          classification,
          provider_name: provider.trim() || 'Your provider',
        });
      } catch { /* legacy endpoint may 409 — safe to ignore */ }

      await api.post('/participants', {
        first_name: firstName.trim(),
        last_name: lastName.trim(),
        date_of_birth: isoFromDDMMYYYY(dob),
        classification,
        provider_name: provider.trim(),
        pension_status: pension,
        statement_delivery: statementDelivery,
        preferred_name: preferredName.trim() || null,
        mac_reference: macRef.trim() || null,
        suburb: suburb.trim() || null,
        state: stateCode,
        hcp_transition: hcpTransition,
        caregiver_relationship: relationship,
        caregiver_phone: phone.replace(/\s+/g, '') || null,
        authorisation_confirmed: authorised,
      });
      await Promise.all([refresh(), refetch()]);
      setStep(3);
    } catch (e: any) {
      Alert.alert('Could not save', e?.response?.data?.detail || e?.message || 'Please try again.');
    } finally {
      setBusy(false);
    }
  }

  function finishToDashboard() {
    toast.success('Welcome to Wayly');
    router.replace('/(tabs)/today' as any);
  }

  const firstNameOrPronoun = firstName.trim() || 'the participant';

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={{ padding: Spacing.md, paddingBottom: 80 }}
          keyboardShouldPersistTaps="handled"
        >
          {/* Stepper */}
          <Stepper step={step} palette={c} />

          {/* Card wrapper */}
          <View style={styles.card}>
            {step === 0 && (
              <>
                <Text style={styles.h1}>The essentials</Text>
                <Text style={styles.p}>
                  Wayly needs a few core details about the participant so its calculators and AI tools return accurate figures.
                </Text>

                <View style={styles.rowFields}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.label}>First name</Text>
                    <TextInput
                      value={firstName} onChangeText={setFirstName} placeholder="Jane"
                      placeholderTextColor={c.textMuted} style={styles.input}
                      testID="onb-first-name" maxLength={80} autoComplete="given-name"
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.label}>Last name</Text>
                    <TextInput
                      value={lastName} onChangeText={setLastName} placeholder="Doe"
                      placeholderTextColor={c.textMuted} style={styles.input}
                      testID="onb-last-name" maxLength={80} autoComplete="family-name"
                    />
                  </View>
                </View>

                <Text style={styles.label}>Date of birth</Text>
                <View style={styles.dobRow}>
                  <TextInput
                    value={dob} onChangeText={(v) => setDob(maskDate(v))}
                    placeholder="dd/mm/yyyy" placeholderTextColor={c.textMuted}
                    style={[styles.input, { flex: 1, marginBottom: 0 }]}
                    keyboardType="number-pad" maxLength={10} testID="onb-dob"
                  />
                  <View style={styles.calBtn}><Ionicons name="calendar-outline" size={18} color={c.textMuted} /></View>
                </View>
                <WhyBtn open={dobHelp} onToggle={() => setDobHelp((v) => !v)} help="Age drives Age Pension eligibility. Wayly uses DOB to pre-fill contribution modelling and reassessment reminders." />

                <Text style={styles.groupLabel}>Pension status</Text>
                <View style={{ gap: 8 }}>
                  {PENSION_OPTIONS.map((opt) => (
                    <RadioCard
                      key={opt.id}
                      title={opt.title} sub={opt.sub}
                      selected={pension === opt.id}
                      onPress={() => setPension(opt.id)}
                      testID={`onb-pension-${opt.id}`}
                      palette={c}
                    />
                  ))}
                </View>
                <WhyBtn open={pensionHelp} onToggle={() => setPensionHelp((v) => !v)} help="Pension status changes the means-tested co-contribution rate. Wayly uses this to model out-of-pocket costs before Services Australia issues a determination." />

                <Text style={styles.groupLabel}>Support at Home classification (1, 8)</Text>
                <View style={styles.classGrid}>
                  {CLASSIFICATIONS.map((cl) => {
                    const active = classification === cl.n;
                    return (
                      <TouchableOpacity
                        key={cl.n} activeOpacity={0.85}
                        onPress={() => setClassification(cl.n)}
                        style={[styles.classCard, active && styles.classCardActive]}
                        testID={`onb-class-${cl.n}`}
                      >
                        <Text style={[styles.className, active && styles.classNameActive]}>Class {cl.n}</Text>
                        <Text style={[styles.classYr, active && styles.classYrActive]}>{cl.yr}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
                <WhyBtn open={classHelp} onToggle={() => setClassHelp((v) => !v)} help="Support at Home replaces Home Care Package levels. The classification determines the annual budget streams for Independence and Everyday Living support." />

                <Text style={styles.label}>Registered provider</Text>
                <TextInput
                  value={provider} onChangeText={setProvider} placeholder="e.g. BlueBerry Care"
                  placeholderTextColor={c.textMuted} style={styles.input} testID="onb-provider" maxLength={160}
                />

                <Text style={styles.label}>How do you receive their monthly statement?</Text>
                <View style={styles.pillWrap}>
                  {STATEMENT_OPTIONS.map((o) => (
                    <RadioPill
                      key={o.id} label={o.label}
                      selected={statementDelivery === o.id}
                      onPress={() => setStatementDelivery(o.id)}
                      testID={`onb-statement-${o.id}`}
                      palette={c}
                    />
                  ))}
                </View>

                <PrimaryBtn label="Continue" icon="arrow-forward" onPress={submitStep1} disabled={!step1Valid} testID="onb-continue-1" />
              </>
            )}

            {step === 1 && (
              <>
                <View style={styles.iconChip}><Ionicons name="shield-checkmark-outline" size={22} color={c.brandPrimary} /></View>
                <Text style={styles.h1}>Confirm authorisation</Text>
                <Text style={styles.p}>
                  You&apos;re about to enter and store personal and financial information about
                  <Text style={styles.pStrong}> {firstNameOrPronoun}</Text>.
                  Wayly needs you to confirm that you&apos;re authorised to manage their aged care information.
                </Text>

                <TouchableOpacity
                  onPress={() => setAuthorised((v) => !v)}
                  activeOpacity={0.85}
                  style={styles.authCard}
                  testID="onb-authorised-toggle"
                >
                  <View style={[styles.checkbox, authorised && styles.checkboxOn]}>
                    {authorised && <Ionicons name="checkmark" size={14} color="#fff" />}
                  </View>
                  <Text style={styles.authText}>
                    I confirm I am authorised to manage {firstNameOrPronoun}&apos;s aged care information. This includes having power of attorney, being a nominated representative with My Aged Care, or having explicit consent from the participant.
                  </Text>
                </TouchableOpacity>

                <View style={styles.footRow}>
                  <SecondaryBtn label="Back" icon="arrow-back" onPress={() => setStep(0)} testID="onb-back-2" />
                  <PrimaryBtn label="Save & continue" icon="arrow-forward" onPress={submitStep2} disabled={!authorised} testID="onb-save-2" />
                </View>
              </>
            )}

            {step === 2 && (
              <>
                <Text style={styles.h1}>Recommended details</Text>
                <Text style={styles.p}>
                  Optional but helpful, these sharpen Wayly&apos;s tool results and letter generation. You can skip and add them later.
                </Text>

                <View style={styles.rowFields}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.label}>Preferred name (optional)</Text>
                    <TextInput
                      value={preferredName} onChangeText={setPreferredName}
                      placeholder="e.g. Mum, Dad, Nan"
                      placeholderTextColor={c.textMuted} style={styles.input} testID="onb-preferred-name"
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.label}>My Aged Care ref / Client ID</Text>
                    <TextInput
                      value={macRef} onChangeText={setMacRef} placeholder="AC12345678"
                      placeholderTextColor={c.textMuted} style={styles.input} testID="onb-mac-ref"
                      autoCapitalize="characters"
                    />
                  </View>
                </View>

                <View style={styles.rowFields}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.label}>Suburb</Text>
                    <TextInput
                      value={suburb} onChangeText={setSuburb} placeholder="Suburb"
                      placeholderTextColor={c.textMuted} style={styles.input} testID="onb-suburb"
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.label}>State</Text>
                    <View style={styles.stateWrap}>
                      {AU_STATES.map((s) => (
                        <RadioPill
                          key={s} label={s}
                          selected={stateCode === s}
                          onPress={() => setStateCode(s)}
                          testID={`onb-state-${s}`}
                          palette={c}
                          small
                        />
                      ))}
                    </View>
                  </View>
                </View>

                <Text style={styles.label}>Did the participant transition from a Home Care Package?</Text>
                <View style={styles.pillWrap}>
                  {HCP_OPTIONS.map((o) => (
                    <RadioPill
                      key={o.id} label={o.label}
                      selected={hcpTransition === o.id}
                      onPress={() => setHcpTransition(o.id)}
                      testID={`onb-hcp-${o.id}`}
                      palette={c}
                    />
                  ))}
                </View>

                <Text style={styles.label}>Your relationship to the participant</Text>
                <View style={styles.pillWrap}>
                  {RELATIONSHIPS.map((r) => (
                    <RadioPill
                      key={r} label={r}
                      selected={relationship === r}
                      onPress={() => setRelationship(r)}
                      testID={`onb-rel-${r.toLowerCase().replace(/\s+/g, '-')}`}
                      palette={c}
                    />
                  ))}
                </View>

                <Text style={styles.label}>Your phone</Text>
                <TextInput
                  value={phone} onChangeText={setPhone} placeholder="04xx xxx xxx"
                  placeholderTextColor={c.textMuted} style={styles.input} testID="onb-phone"
                  keyboardType="phone-pad" autoComplete="tel"
                />

                <View style={styles.footRow}>
                  <SecondaryBtn label="Back" icon="arrow-back" onPress={() => setStep(1)} testID="onb-back-3" />
                  <View style={{ flexDirection: 'row', gap: 10, flex: 1, justifyContent: 'flex-end' }}>
                    <SecondaryBtn label="Skip for now" onPress={skipStep3} testID="onb-skip-3" />
                    <PrimaryBtn label="Continue" icon="arrow-forward" onPress={submitStep3} disabled={busy} loading={busy} testID="onb-save-3" />
                  </View>
                </View>
              </>
            )}

            {step === 3 && (
              <>
                <View style={styles.iconChip}><Ionicons name="sparkles" size={22} color={c.brandPrimary} /></View>
                <Text style={styles.h1}>All done</Text>
                <Text style={styles.p}>
                  Your participant profile has the essentials. You can sharpen Wayly&apos;s accuracy any time by filling the optional fields below.
                </Text>

                <View style={styles.completeBlock}>
                  <Text style={styles.completePct}>{completeness}%</Text>
                  <Text style={styles.completeCap}>Profile completeness, {completenessLabel}</Text>
                </View>

                <Text style={styles.sectionH}>Sharpen Wayly&apos;s accuracy</Text>
                <Text style={styles.sectionSub}>Optional. Each card opens the relevant tool so you can fill the field in context.</Text>

                <View style={styles.sharpenGrid}>
                  <SharpenCard
                    icon="medkit-outline"
                    title="Add supplements"
                    body="Add your parent's supplements so Wayly's budget calculator includes them."
                    onPress={() => router.push('/participants' as any)}
                    testID="onb-sharpen-supplements"
                    palette={c}
                  />
                  <SharpenCard
                    icon="calculator-outline"
                    title="Add exact contribution rates"
                    body="Paste the Independence + Everyday Living percentages from the Services Australia letter for precise contribution figures."
                    onPress={() => router.push('/participants' as any)}
                    testID="onb-sharpen-rates"
                    palette={c}
                  />
                  <SharpenCard
                    icon="mail-outline"
                    title="Add full residential address"
                    body="Wayly auto-fills the address on My Aged Care letters and reassessment requests."
                    onPress={() => router.push('/participants' as any)}
                    testID="onb-sharpen-address"
                    palette={c}
                  />
                  <SharpenCard
                    icon="document-text-outline"
                    title="Add care manager details"
                    body="Wayly pre-fills the care manager's name + email on letters so you don't have to retype it every time."
                    onPress={() => router.push('/participants' as any)}
                    testID="onb-sharpen-manager"
                    palette={c}
                  />
                </View>

                <PrimaryBtn label="Go to dashboard" icon="checkmark" onPress={finishToDashboard} testID="onb-go-dashboard" full />
              </>
            )}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

/* ------------------------------- sub-components ------------------------------- */

function Stepper({ step, palette }: { step: number; palette: ColorPalette }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.stepper}>
      {STEP_LABELS.map((label, i) => {
        const done = i < step;
        const active = i === step;
        return (
          <React.Fragment key={label}>
            <View style={styles.stepNode}>
              <View style={[
                styles.stepDot,
                done && { backgroundColor: palette.severityInfo, borderColor: palette.severityInfo },
                active && { backgroundColor: palette.brandPrimary, borderColor: palette.brandPrimary },
              ]}>
                {done ? (
                  <Ionicons name="checkmark" size={12} color="#fff" />
                ) : (
                  <Text style={[styles.stepNum, active && { color: '#fff' }]}>{i + 1}</Text>
                )}
              </View>
              <Text style={[
                styles.stepLbl,
                (active || done) && { color: palette.textPrimary, fontFamily: Fonts.bodySemi },
              ]}>
                {label}
              </Text>
            </View>
            {i < STEP_LABELS.length - 1 && (
              <View style={[styles.stepLine, done && { backgroundColor: palette.severityInfo }]} />
            )}
          </React.Fragment>
        );
      })}
    </View>
  );
}

function RadioCard({
  title, sub, selected, onPress, testID, palette,
}: { title: string; sub: string; selected: boolean; onPress: () => void; testID?: string; palette: ColorPalette }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <TouchableOpacity activeOpacity={0.85} onPress={onPress} testID={testID}
      style={[styles.radioCard, selected && styles.radioCardOn]}>
      <View style={[styles.radioRing, selected && { borderColor: palette.brandPrimary }]}>
        {selected && <View style={styles.radioRingDot} />}
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.radioTitle}>{title}</Text>
        <Text style={styles.radioSub}>{sub}</Text>
      </View>
    </TouchableOpacity>
  );
}

function RadioPill({
  label, selected, onPress, testID, palette, small,
}: { label: string; selected: boolean; onPress: () => void; testID?: string; palette: ColorPalette; small?: boolean }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <Pressable onPress={onPress} testID={testID}
      style={[styles.pill, small && { paddingHorizontal: 10, paddingVertical: 6 }, selected && styles.pillOn]}>
      <Text style={[styles.pillText, selected && styles.pillTextOn, small && { fontSize: 12 }]}>{label}</Text>
    </Pressable>
  );
}

function WhyBtn({ open, onToggle, help }: { open: boolean; onToggle: () => void; help: string }) {
  const styles = useThemedStyles(makeStyles);
  const c = useColors();
  return (
    <View style={styles.whyWrap}>
      <TouchableOpacity onPress={onToggle} hitSlop={8} activeOpacity={0.7} style={styles.whyBtn}>
        <Ionicons name="help-circle-outline" size={14} color={c.textMuted} />
        <Text style={styles.whyText}>Why we ask</Text>
        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={12} color={c.textMuted} />
      </TouchableOpacity>
      {open && <Text style={styles.whyHelp}>{help}</Text>}
    </View>
  );
}

function PrimaryBtn({
  label, icon, onPress, disabled, loading, testID, full,
}: { label: string; icon?: keyof typeof Ionicons.glyphMap; onPress: () => void; disabled?: boolean; loading?: boolean; testID?: string; full?: boolean }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <TouchableOpacity onPress={onPress} disabled={disabled || loading}
      activeOpacity={0.85} testID={testID}
      style={[styles.primaryBtn, (disabled || loading) && { opacity: 0.55 }, full && { alignSelf: 'stretch' }]}>
      {icon === 'arrow-back' && <Ionicons name="arrow-back" size={16} color="#fff" style={{ marginRight: 6 }} />}
      <Text style={styles.primaryBtnText}>{loading ? 'Saving…' : label}</Text>
      {icon && icon !== 'arrow-back' && <Ionicons name={icon} size={16} color="#fff" style={{ marginLeft: 6 }} />}
    </TouchableOpacity>
  );
}

function SecondaryBtn({
  label, icon, onPress, testID,
}: { label: string; icon?: keyof typeof Ionicons.glyphMap; onPress: () => void; testID?: string }) {
  const styles = useThemedStyles(makeStyles);
  const c = useColors();
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.75} testID={testID} style={styles.secondaryBtn}>
      {icon === 'arrow-back' && <Ionicons name="arrow-back" size={14} color={c.textSecondary} style={{ marginRight: 4 }} />}
      <Text style={styles.secondaryBtnText}>{label}</Text>
    </TouchableOpacity>
  );
}

function SharpenCard({
  icon, title, body, onPress, testID, palette,
}: { icon: keyof typeof Ionicons.glyphMap; title: string; body: string; onPress: () => void; testID?: string; palette: ColorPalette }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.85} testID={testID} style={styles.sharpenCard}>
      <Ionicons name={icon} size={18} color={palette.brandPrimary} />
      <Text style={styles.sharpenTitle}>{title}</Text>
      <Text style={styles.sharpenBody}>{body}</Text>
      <View style={styles.sharpenLinkRow}>
        <Text style={styles.sharpenLink}>Open tool</Text>
        <Ionicons name="arrow-forward" size={12} color={palette.brandPrimary} />
      </View>
    </TouchableOpacity>
  );
}

/* --------------------------------- styles ---------------------------------- */

function makeStyles(c: ColorPalette) { return StyleSheet.create({
  safe: { flex: 1, backgroundColor: c.background },

  // Stepper
  stepper: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 2, marginBottom: 12, gap: 4 },
  stepNode: { alignItems: 'center', gap: 4 },
  stepDot: {
    width: 26, height: 26, borderRadius: 13,
    borderWidth: 1.5, borderColor: c.border,
    backgroundColor: c.cardBg, alignItems: 'center', justifyContent: 'center',
  },
  stepNum: { fontFamily: Fonts.bodySemi, fontSize: 12, color: c.textMuted },
  stepLbl: { fontFamily: Fonts.body, fontSize: 10.5, color: c.textMuted, textAlign: 'center' },
  stepLine: { flex: 1, height: 1.5, backgroundColor: c.border, marginBottom: 16 },

  // Card
  card: {
    backgroundColor: c.cardBg, borderRadius: Radius.lg, padding: Spacing.md, gap: 4,
    borderWidth: 1, borderColor: c.borderSubtle,
  },
  h1: { fontFamily: Fonts.heading, fontSize: 26, color: c.brandPrimary, letterSpacing: -0.4 },
  p: { fontFamily: Fonts.body, fontSize: 14, color: c.textSecondary, lineHeight: 21, marginTop: 4 },
  pStrong: { fontFamily: Fonts.bodySemi, color: c.textPrimary },

  iconChip: {
    width: 40, height: 40, borderRadius: 10,
    backgroundColor: c.surfaceTint, borderWidth: 1, borderColor: c.borderSubtle,
    alignItems: 'center', justifyContent: 'center', marginBottom: 8,
  },

  // Inputs / rows
  rowFields: { flexDirection: 'row', gap: 10, marginTop: 8 },
  label: { fontFamily: Fonts.bodySemi, fontSize: 13, color: c.textPrimary, marginTop: 14, marginBottom: 4 },
  groupLabel: { fontFamily: Fonts.bodySemi, fontSize: 14, color: c.textPrimary, marginTop: 18, marginBottom: 6 },
  input: {
    borderWidth: 1, borderColor: c.border, borderRadius: Radius.sm,
    paddingHorizontal: 12, paddingVertical: 12,
    fontFamily: Fonts.body, fontSize: 15, color: c.textPrimary, backgroundColor: c.cardBg, marginBottom: 4,
  },
  dobRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  calBtn: { padding: 10 },

  // Radio card
  radioCard: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10,
    padding: 12, borderRadius: Radius.md, borderWidth: 1, borderColor: c.border, backgroundColor: c.cardBg,
  },
  radioCardOn: { borderColor: c.brandPrimary, borderWidth: 2, backgroundColor: c.surfaceTint },
  radioRing: { width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: c.border, alignItems: 'center', justifyContent: 'center', marginTop: 2 },
  radioRingDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: c.brandPrimary },
  radioTitle: { fontFamily: Fonts.bodySemi, fontSize: 14.5, color: c.brandPrimary },
  radioSub: { fontFamily: Fonts.body, fontSize: 12.5, color: c.textSecondary, marginTop: 2, lineHeight: 18 },

  // Class grid (2 columns on mobile)
  classGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  classCard: {
    width: '48.5%', padding: 10, borderRadius: Radius.md, borderWidth: 1, borderColor: c.border,
    backgroundColor: c.cardBg, gap: 2,
  },
  classCardActive: { borderColor: c.brandPrimary, borderWidth: 2, backgroundColor: c.surfaceTint },
  className: { fontFamily: Fonts.heading, fontSize: 18, color: c.brandPrimary },
  classNameActive: { color: c.brandPrimary },
  classYr: { fontFamily: Fonts.body, fontSize: 13, color: c.textSecondary },
  classYrActive: { color: c.textPrimary },

  // Pills
  pillWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
  pill: {
    paddingHorizontal: 14, paddingVertical: 8,
    borderRadius: 9999, borderWidth: 1, borderColor: c.border, backgroundColor: c.cardBg,
  },
  pillOn: { borderColor: c.brandPrimary, backgroundColor: c.surfaceTint, borderWidth: 2 },
  pillText: { fontFamily: Fonts.bodySemi, fontSize: 13, color: c.textSecondary },
  pillTextOn: { color: c.brandPrimary },

  stateWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },

  // Why we ask
  whyWrap: { marginTop: 6 },
  whyBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start' },
  whyText: { fontFamily: Fonts.body, fontSize: 12, color: c.textMuted },
  whyHelp: { fontFamily: Fonts.body, fontSize: 12.5, color: c.textSecondary, lineHeight: 18, marginTop: 4, paddingLeft: 18 },

  // Auth checkbox
  authCard: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 12,
    padding: 14, borderRadius: Radius.md, borderWidth: 1, borderColor: c.border, backgroundColor: c.cardBg, marginTop: 16,
  },
  checkbox: {
    width: 22, height: 22, borderRadius: 5, borderWidth: 2, borderColor: c.border,
    alignItems: 'center', justifyContent: 'center', marginTop: 2, backgroundColor: c.cardBg,
  },
  checkboxOn: { backgroundColor: c.brandPrimary, borderColor: c.brandPrimary },
  authText: { flex: 1, fontFamily: Fonts.body, fontSize: 13.5, color: c.textPrimary, lineHeight: 20 },

  // Buttons
  primaryBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    backgroundColor: c.brandPrimary, paddingVertical: 13, paddingHorizontal: 18,
    borderRadius: 9999, marginTop: 20, alignSelf: 'flex-end',
  },
  primaryBtnText: { color: '#fff', fontFamily: Fonts.bodySemi, fontSize: 14.5, letterSpacing: 0.2 },
  secondaryBtn: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, paddingHorizontal: 6 },
  secondaryBtnText: { fontFamily: Fonts.bodySemi, fontSize: 14, color: c.textSecondary },
  footRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 16, gap: 10 },

  // Step 4 completeness
  completeBlock: { alignItems: 'center', paddingVertical: 20 },
  completePct: { fontFamily: Fonts.heading, fontSize: 56, color: c.brandPrimary, letterSpacing: -1 },
  completeCap: { fontFamily: Fonts.body, fontSize: 13, color: c.textSecondary, marginTop: 2 },

  sectionH: { fontFamily: Fonts.heading, fontSize: 20, color: c.brandPrimary, marginTop: 6 },
  sectionSub: { fontFamily: Fonts.body, fontSize: 13, color: c.textSecondary, marginTop: 4, lineHeight: 19 },

  sharpenGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 12 },
  sharpenCard: {
    width: '48.5%', padding: 12, borderRadius: Radius.md,
    backgroundColor: c.surfaceTint, borderWidth: 1, borderColor: c.borderSubtle, gap: 6,
  },
  sharpenTitle: { fontFamily: Fonts.heading, fontSize: 15, color: c.brandPrimary, marginTop: 4 },
  sharpenBody: { fontFamily: Fonts.body, fontSize: 12, color: c.textSecondary, lineHeight: 17 },
  sharpenLinkRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 },
  sharpenLink: { fontFamily: Fonts.bodySemi, fontSize: 12.5, color: c.brandPrimary },
}); }
