// ToolInfoSheet — Modal that surfaces the same "About this tool" content
// families see on the web /ai-tools/{slug} pages, so the mobile experience
// carries the full context (What This Tool Does, How It Works, What You'll
// Need / Get, Common Questions, and the standard disclaimer).
//
// Rendered from a compact "About this tool" pill added to ToolShell so the
// tool screens themselves stay focused on their inputs.
import React, { useState } from 'react';
import {
  Modal, Pressable, ScrollView, StyleSheet, Text, TouchableOpacity, View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { getToolCopy } from '../lib/toolCopy';
import { Fonts, Spacing } from '../lib/theme';
import type { ColorPalette } from '../lib/theme';
import { useColors } from '../hooks/useColors';
import { useThemedStyles } from '../hooks/useThemedStyles';

type Props = { toolKey: string };

export function AboutThisToolButton({ toolKey }: Props) {
  const c = useColors();
  const styles = useThemedStyles(makeStyles);
  const copy = getToolCopy(toolKey);
  const [open, setOpen] = useState(false);
  if (!copy) return null;

  return (
    <>
      <TouchableOpacity
        onPress={() => setOpen(true)}
        style={styles.aboutPill}
        activeOpacity={0.75}
        testID={`about-tool-${toolKey}`}
        accessibilityRole="button"
        accessibilityLabel={`About ${copy.title}`}
      >
        <Ionicons name="information-circle-outline" size={14} color={c.brandPrimary} />
        <Text style={styles.aboutPillText}>About this tool</Text>
      </TouchableOpacity>
      <ToolInfoSheet toolKey={toolKey} visible={open} onClose={() => setOpen(false)} />
    </>
  );
}

export function ToolInfoSheet({ toolKey, visible, onClose }: Props & { visible: boolean; onClose: () => void }) {
  const c = useColors();
  const styles = useThemedStyles(makeStyles);
  const copy = getToolCopy(toolKey);
  if (!copy) return null;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} presentationStyle="pageSheet">
      <View style={styles.safe}>
        <View style={styles.head}>
          <View style={{ flex: 1 }}>
            <Text style={styles.overline}>About</Text>
            <Text style={styles.h1}>{copy.title}</Text>
          </View>
          <TouchableOpacity onPress={onClose} hitSlop={10} testID="tool-info-close">
            <Ionicons name="close" size={26} color={c.textPrimary} />
          </TouchableOpacity>
        </View>
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <Text style={styles.subtitle}>{copy.subtitle}</Text>

          <View style={styles.availabilityCard}>
            <Ionicons name="pricetag-outline" size={14} color={c.brandPrimary} />
            <Text style={styles.availabilityText}>{copy.availability}</Text>
          </View>

          {/* What This Tool Does */}
          <SectionTitle>What This Tool Does</SectionTitle>
          {copy.what.map((p, i) => (
            <Text key={i} style={styles.paragraph}>{p}</Text>
          ))}

          {/* How It Works */}
          <SectionTitle>How It Works</SectionTitle>
          {copy.howItWorks.map((step, i) => (
            <View key={i} style={styles.stepRow}>
              <View style={styles.stepBadge}>
                <Text style={styles.stepBadgeText}>{i + 1}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.stepTitle}>{step.title}</Text>
                <Text style={styles.stepBody}>{step.body}</Text>
              </View>
            </View>
          ))}

          {/* Disclaimer */}
          <View style={styles.disclaimer}>
            <Ionicons name="alert-circle-outline" size={14} color={c.severityWarning} style={{ marginTop: 2 }} />
            <Text style={styles.disclaimerText}>{copy.disclaimer}</Text>
          </View>

          {/* What You'll Need */}
          <SectionTitle>What You&apos;ll Need</SectionTitle>
          {copy.needList.map((item, i) => (
            <View key={i} style={styles.bulletRow}>
              <View style={styles.bulletDot} />
              <Text style={styles.bulletText}>{item}</Text>
            </View>
          ))}

          {/* What You'll Get */}
          <SectionTitle>What You&apos;ll Get</SectionTitle>
          {copy.getList.map((item, i) => (
            <View key={i} style={styles.bulletRow}>
              <View style={styles.bulletDot} />
              <Text style={styles.bulletText}>{item}</Text>
            </View>
          ))}

          {/* Common Questions */}
          <SectionTitle>Common Questions</SectionTitle>
          {copy.faqs.map((faq, i) => (
            <View key={i} style={styles.faqRow}>
              <Text style={styles.faqQ}>{faq.q}</Text>
              <Text style={styles.faqA}>{faq.a}</Text>
            </View>
          ))}
        </ScrollView>
      </View>
    </Modal>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  const styles = useThemedStyles(makeStyles);
  return <Text style={styles.sectionTitle}>{children}</Text>;
}

function makeStyles(c: ColorPalette) { return StyleSheet.create({
  safe: { flex: 1, backgroundColor: c.background },
  head: {
    flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between',
    paddingHorizontal: Spacing.lg, paddingTop: Spacing.md, paddingBottom: Spacing.sm,
    gap: 12, borderBottomWidth: 1, borderBottomColor: c.borderSubtle,
  },
  overline: { fontFamily: Fonts.bodyMed, fontSize: 11, letterSpacing: 1.4, textTransform: 'uppercase', color: c.textMuted },
  h1: { fontFamily: Fonts.heading, fontSize: 24, color: c.brandPrimary, letterSpacing: -0.3, lineHeight: 30, marginTop: 2 },
  scroll: { padding: Spacing.lg, paddingBottom: 120, gap: 4 },
  subtitle: { fontFamily: Fonts.body, fontSize: 14.5, color: c.textSecondary, lineHeight: 22, marginBottom: 6 },
  availabilityCard: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingVertical: 10, paddingHorizontal: 12, borderRadius: 12,
    backgroundColor: c.surfaceTint, borderWidth: 1, borderColor: c.borderSubtle,
    marginVertical: 10,
  },
  availabilityText: { flex: 1, fontFamily: Fonts.bodySemi, fontSize: 13, color: c.brandPrimary },

  sectionTitle: {
    fontFamily: Fonts.heading, fontSize: 18, color: c.brandPrimary,
    letterSpacing: -0.2, marginTop: 18, marginBottom: 6,
  },
  paragraph: { fontFamily: Fonts.body, fontSize: 14, color: c.textSecondary, lineHeight: 22, marginBottom: 10 },

  stepRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginBottom: 12 },
  stepBadge: {
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: c.brandPrimary,
    alignItems: 'center', justifyContent: 'center',
  },
  stepBadgeText: { color: c.textInverse, fontFamily: Fonts.bodySemi, fontSize: 13 },
  stepTitle: { fontFamily: Fonts.bodySemi, fontSize: 14, color: c.textPrimary },
  stepBody: { fontFamily: Fonts.body, fontSize: 13.5, color: c.textSecondary, lineHeight: 20, marginTop: 2 },

  disclaimer: {
    flexDirection: 'row', gap: 8,
    padding: 12, borderRadius: 12,
    backgroundColor: 'rgba(183, 121, 31, 0.08)',
    borderWidth: 1, borderColor: 'rgba(183, 121, 31, 0.22)',
    marginTop: 12, marginBottom: 6,
  },
  disclaimerText: { flex: 1, fontFamily: Fonts.body, fontSize: 12.5, color: c.textSecondary, lineHeight: 18 },

  bulletRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 8 },
  bulletDot: { width: 5, height: 5, borderRadius: 5, backgroundColor: c.brandPrimary, marginTop: 8 },
  bulletText: { flex: 1, fontFamily: Fonts.body, fontSize: 13.5, color: c.textSecondary, lineHeight: 20 },

  faqRow: { paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: c.borderSubtle },
  faqQ: { fontFamily: Fonts.bodySemi, fontSize: 14, color: c.textPrimary, marginBottom: 4 },
  faqA: { fontFamily: Fonts.body, fontSize: 13.5, color: c.textSecondary, lineHeight: 20 },

  aboutPill: {
    flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start',
    paddingHorizontal: 12, paddingVertical: 7, borderRadius: 9999,
    borderWidth: 1, borderColor: c.borderSubtle, backgroundColor: c.cardBg,
  },
  aboutPillText: { fontFamily: Fonts.bodySemi, fontSize: 12, color: c.brandPrimary, letterSpacing: 0.2 },
}); }
