// AI Tools index — 8 tools with plan badges
import React, { useRef } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { TabScrollBus } from '../../src/lib/tabScrollBus';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Fonts, Radius, Spacing } from '../../src/lib/theme';
import type { ColorPalette } from '../../src/lib/theme';
import { useColors } from '../../src/hooks/useColors';
import { useThemedStyles } from '../../src/hooks/useThemedStyles';
import { TrialCountdownBanner } from '../../src/components/AITools';

type Tool = {
  key: string;
  route?: string; // optional file slug if different from key
  title: string;
  sub: string;
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
  badge: { label: string; tone: 'sage' | 'navy' };
  trialNote?: string;
};

const TOOLS: Tool[] = [
  {
    key: 'statement-decoder',
    title: 'Statement Decoder',
    sub: 'Snap or upload a Support at Home statement, get a plain-English summary and anomaly check',
    icon: 'scan-outline',
    color: Colors.success,
    badge: { label: 'FREE · 1 use/day', tone: 'sage' },
  },
  {
    key: 'budget-calculator',
    route: 'budget-calc',
    title: 'Budget Calculator',
    sub: 'Quarterly + annual budget for any classification level',
    icon: 'calculator-outline',
    color: Colors.brandPrimary,
    badge: { label: 'Solo & Family', tone: 'navy' },
    trialNote: '7-day free trial',
  },
  {
    key: 'provider-price-checker',
    route: 'price-checker',
    title: 'Provider Price Checker',
    sub: "Is the rate fair? Compare to network median and 1 Jul 2026 cap",
    icon: 'pricetag-outline',
    color: Colors.brandPrimary,
    badge: { label: 'Solo & Family', tone: 'navy' },
    trialNote: '7-day free trial',
  },
  {
    key: 'classification-self-check',
    route: 'classification-check',
    title: 'Classification Self-Check',
    sub: 'Quick check to see if your classification level still fits',
    icon: 'help-circle-outline',
    color: Colors.brandPrimary,
    badge: { label: 'Solo & Family', tone: 'navy' },
    trialNote: '7-day free trial',
  },
  {
    key: 'reassessment-letter',
    title: 'Reassessment Letter Drafter',
    sub: "Polite letter to My Aged Care asking for a fresh look",
    icon: 'mail-outline',
    color: Colors.brandPrimary,
    badge: { label: 'Solo & Family', tone: 'navy' },
    trialNote: '7-day free trial',
  },
  {
    key: 'contribution-estimator',
    title: 'Contribution Estimator',
    sub: 'What you might pay each quarter based on your pension status',
    icon: 'wallet-outline',
    color: Colors.brandPrimary,
    badge: { label: 'Solo & Family', tone: 'navy' },
    trialNote: '7-day free trial',
  },
  {
    key: 'care-plan-reviewer',
    title: 'Care Plan Reviewer',
    sub: "Traffic-light review of your participant's care plan",
    icon: 'document-text-outline',
    color: Colors.brandPrimary,
    badge: { label: 'Solo & Family', tone: 'navy' },
    trialNote: '7-day free trial',
  },
  {
    key: 'aged-care-qa',
    title: 'Aged Care Q&A',
    sub: "Plain-English answers about Support at Home, grounded in the Aged Care Act 2024",
    icon: 'chatbubbles-outline',
    color: Colors.brandPrimary,
    badge: { label: 'Solo & Family', tone: 'navy' },
    trialNote: '7-day free trial',
  },
];

export default function ToolsIndex() {
  const c = useColors();
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const canGoBack = router.canGoBack();
  const scrollRef = useRef<ScrollView>(null);
  React.useEffect(() => {
    return TabScrollBus.subscribe('tools', () => {
      scrollRef.current?.scrollTo({ y: 0, animated: true });
    });
  }, []);
  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView ref={scrollRef} contentContainerStyle={styles.scroll} testID="tools-scroll">
        {canGoBack ? (
          <TouchableOpacity onPress={() => router.back()} style={styles.back}>
            <Ionicons name="chevron-back" size={20} color={c.brandPrimary} />
            <Text style={styles.backText}>Back</Text>
          </TouchableOpacity>
        ) : null}
        <Text style={styles.overline}>Helpful tools</Text>
        <Text style={styles.h1}>AI Tools</Text>
        <Text style={styles.sub}>Quick answers when you need them, all included with Solo and Family plans.</Text>

        <TrialCountdownBanner />

        {TOOLS.map((t) => (
          <TouchableOpacity
            key={t.key}
            style={styles.card}
            onPress={() => router.push(`/tools/${t.route || t.key}` as any)}
            testID={`tool-${t.key}`}
          >
            <View style={[styles.iconWrap, { backgroundColor: `${t.color}15` }]}>
              <Ionicons name={t.icon} size={22} color={t.color} />
            </View>
            <View style={{ flex: 1 }}>
              <View style={styles.titleRow}>
                <Text style={styles.cardTitle}>{t.title}</Text>
                <View style={[styles.badge, t.badge.tone === 'sage' ? styles.badgeSage : styles.badgeNavy]}>
                  <Text style={[styles.badgeText, t.badge.tone === 'sage' ? styles.badgeTextSage : styles.badgeTextNavy]}>
                    {t.badge.label}
                  </Text>
                </View>
              </View>
              <Text style={styles.cardSub}>{t.sub}</Text>
              {t.trialNote && <Text style={styles.trialNote}>{t.trialNote}</Text>}
            </View>
            <Ionicons name="chevron-forward" size={18} color={c.textMuted} />
          </TouchableOpacity>
        ))}

        {/* AI disclaimer, matches the yellow callout on the web app.
            Sits BELOW the tool list per user request. */}
        <View style={[styles.aiBanner, { marginTop: Spacing.md, marginBottom: 0 }]}>
          <View style={styles.aiBannerIcon}>
            <Ionicons name="information-circle" size={16} color="#8A6D14" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.aiBannerTitle}>AI assistance only, not financial, legal, or medical advice</Text>
            <Text style={styles.aiBannerBody}>
              The tools below use Wayly&apos;s AI to surface ideas, draft language, and explain rules. They are a starting point, not a substitute for a registered tax agent, lawyer, or clinician. Always verify anything that affects your money, plan, or care.
            </Text>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function makeStyles(c: ColorPalette) { return StyleSheet.create({
  safe: { flex: 1, backgroundColor: c.background },
  scroll: { padding: Spacing.lg, paddingBottom: Spacing.xl },
  back: { flexDirection: 'row', alignItems: 'center', marginBottom: Spacing.md },
  backText: { fontFamily: Fonts.bodyMed, fontSize: 14, color: c.brandPrimary },
  overline: { fontFamily: Fonts.bodyMed, fontSize: 11, letterSpacing: 1.5, textTransform: 'uppercase', color: c.textMuted },
  h1: { fontFamily: Fonts.heading, fontSize: 26, color: c.brandPrimary, letterSpacing: -0.5 },
  sub: { fontFamily: Fonts.body, fontSize: 14, color: c.textSecondary, marginTop: 6, marginBottom: Spacing.lg, lineHeight: 20 },
  aiBanner: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10,
    backgroundColor: '#FFF8E1', borderRadius: Radius.md,
    borderWidth: 1, borderColor: '#E8C770',
    padding: Spacing.md, marginBottom: Spacing.lg,
  },
  aiBannerIcon: { width: 24, height: 24, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  aiBannerTitle: { fontFamily: Fonts.bodySemi, fontSize: 13, color: '#6B5410', lineHeight: 18 },
  aiBannerBody: { fontFamily: Fonts.body, fontSize: 12, color: '#6B5410', lineHeight: 18, marginTop: 4 },
  card: {
    flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.md,
    backgroundColor: c.cardBg, borderRadius: Radius.md, padding: Spacing.md + 2,
    marginBottom: Spacing.sm, borderWidth: 1, borderColor: c.borderSubtle,
  },
  iconWrap: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' },
  cardTitle: { fontFamily: Fonts.bodySemi, fontSize: 15, color: c.brandPrimary, flex: 1 },
  cardSub: { fontFamily: Fonts.body, fontSize: 12, color: c.textSecondary, marginTop: 4, lineHeight: 17 },
  trialNote: { fontFamily: Fonts.bodyMed, fontSize: 11, color: c.brandSecondary, marginTop: 4 },
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 100 },
  badgeSage: { backgroundColor: 'rgba(27, 87, 51, 0.12)' },
  badgeNavy: { backgroundColor: 'rgba(14, 77, 82, 0.08)' },
  badgeText: { fontFamily: Fonts.bodySemi, fontSize: 9, letterSpacing: 0.5 },
  badgeTextSage: { color: c.success },
  badgeTextNavy: { color: c.brandPrimary },
}); }
