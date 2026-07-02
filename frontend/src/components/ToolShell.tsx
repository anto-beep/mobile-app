// ToolShell — UI-2 Phase 4/5 parity with the web build.
//
// ToolSummary: every AI tool result opens with a plain-English summary block
// BEFORE any tables, numbers or breakdown.
// ReportIssueButton: "Something Not Right? Report An Issue" at the bottom of
// every tool result. ReportThis: inline affordance next to each anomaly row.
import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Fonts, Radius, Spacing } from '../lib/theme';
import type { ColorPalette } from '../lib/theme';
import { useColors } from '../hooks/useColors';
import { useThemedStyles } from '../hooks/useThemedStyles';

export type SummaryTone = 'neutral' | 'alert' | 'success';

const GOLD = '#C9A227';

export function ToolSummary({ toolName, headline, body, tone = 'neutral', testId }: {
  toolName: string;
  headline: string;
  body: string;
  tone?: SummaryTone;
  testId?: string;
}) {
  const c = useColors();
  const styles = useThemedStyles(makeStyles);
  const toneStyle =
    tone === 'alert'
      ? { backgroundColor: `${c.brandSecondary}14`, borderColor: `${c.brandSecondary}4D` }
      : tone === 'success'
        ? { backgroundColor: `${c.success}1A`, borderColor: `${c.success}4D` }
        : { backgroundColor: c.cardBg, borderColor: c.border };
  return (
    <View style={[styles.card, toneStyle]} testID={testId || 'tool-summary'}>
      <View style={styles.overlineRow}>
        <Ionicons name="sparkles" size={13} color={GOLD} />
        <Text style={styles.overline}>{toolName} Summary</Text>
      </View>
      <Text style={styles.headline}>{headline}</Text>
      <Text style={styles.body}>{body}</Text>
    </View>
  );
}

/** Deep-links into the support-defect flow with the tool preset. */
export function ReportIssueButton({ tool, resultId }: { tool: string; resultId?: string | null }) {
  const c = useColors();
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const go = () => {
    const rid = resultId ? `&result_id=${encodeURIComponent(resultId)}` : '';
    router.push(`/support?open=1&category=ai_tool&tool=${encodeURIComponent(tool)}${rid}` as any);
  };
  return (
    <TouchableOpacity onPress={go} style={styles.reportBtn} testID="report-issue-button" accessibilityRole="button">
      <Ionicons name="flag-outline" size={15} color={c.brandSecondary} />
      <Text style={styles.reportText}>Something Not Right? Report An Issue</Text>
    </TouchableOpacity>
  );
}

/** Inline affordance for anomaly rows. */
export function ReportThis({ tool, resultId }: { tool: string; resultId?: string | null }) {
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const go = () => {
    const rid = resultId ? `&result_id=${encodeURIComponent(resultId)}` : '';
    router.push(`/support?open=1&category=ai_tool&tool=${encodeURIComponent(tool)}${rid}` as any);
  };
  return (
    <TouchableOpacity onPress={go} style={styles.reportThis} testID="report-this" hitSlop={8}>
      <Text style={styles.reportThisText}>Report This</Text>
    </TouchableOpacity>
  );
}

function makeStyles(c: ColorPalette) { return StyleSheet.create({
  card: { borderRadius: 16, borderWidth: 1, padding: 20, marginBottom: Spacing.md },
  overlineRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 },
  overline: { fontFamily: Fonts.bodySemi, fontSize: 11, letterSpacing: 2, textTransform: 'uppercase', color: c.textMuted },
  headline: { fontFamily: Fonts.heading, fontSize: 20, lineHeight: 26, color: c.textPrimary },
  body: { fontFamily: Fonts.body, fontSize: 14, lineHeight: 21, color: c.textSecondary, marginTop: 8 },
  reportBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: Spacing.md, paddingVertical: 12, borderRadius: Radius.md, borderWidth: 1, borderColor: `${c.brandSecondary}4D`, backgroundColor: `${c.brandSecondary}0F`, minHeight: 44 },
  reportText: { fontFamily: Fonts.bodySemi, fontSize: 13, color: c.brandSecondary },
  reportThis: { alignSelf: 'flex-start', paddingVertical: 4 },
  reportThisText: { fontFamily: Fonts.bodySemi, fontSize: 12, color: c.brandSecondary, textDecorationLine: 'underline' },
}); }
