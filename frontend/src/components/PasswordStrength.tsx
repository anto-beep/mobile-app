// PasswordStrength — mobile mirror of the web `<PasswordStrength />` widget.
// Identical rules and identical evaluatePassword() output so the mobile signup
// / reset-password / MFA-verify screens enforce exactly what the backend does.
//
// Rules (all five must pass AND password must NOT contain the user's name
// or the local-part of their email):
//   1) 8+ characters
//   2) An uppercase letter (A-Z)
//   3) A lowercase letter (a-z)
//   4) A number (0-9)
//   5) A symbol from  !@#$%^&*()_+-=[]{}|;':",.<>?/
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Fonts } from '../lib/theme';
import type { ColorPalette } from '../lib/theme';
import { useColors } from '../hooks/useColors';
import { useThemedStyles } from '../hooks/useThemedStyles';

const SYMBOLS = "!@#$%^&*()_+-=[]{}|;':\",.<>?/";

export type PasswordEvaluation = {
  rules: {
    length: boolean;
    upper: boolean;
    lower: boolean;
    number: boolean;
    symbol: boolean;
  };
  score: number;              // 0–4
  label: 'Weak' | 'Fair' | 'Good' | 'Strong' | '';
  containsIdentity: boolean;  // true when password contains name or email local-part
  valid: boolean;             // all 5 rules pass AND no identity leak
};

/** Web-parity evaluator. Mirrors `evaluatePassword()` in PasswordStrength.jsx. */
export function evaluatePassword(
  password: string,
  ctx: { email?: string; name?: string } = {},
): PasswordEvaluation {
  const p = password || '';
  const rules = {
    length: p.length >= 8,
    upper: /[A-Z]/.test(p),
    lower: /[a-z]/.test(p),
    number: /[0-9]/.test(p),
    symbol: new RegExp(`[${SYMBOLS.replace(/[-\\\]]/g, '\\$&')}]`).test(p),
  };
  const passed = Object.values(rules).filter(Boolean).length;
  // Score maps to 4 strength segments (Weak / Fair / Good / Strong).
  const score = Math.min(4, Math.max(0, passed - 1));
  const labels: PasswordEvaluation['label'][] = ['', 'Weak', 'Fair', 'Good', 'Strong'];
  const label = labels[Math.min(passed, 4)];
  // Identity check — case-insensitive substring against name parts and email local.
  const lowerPw = p.toLowerCase();
  const chunks: string[] = [];
  if (ctx.name) chunks.push(...ctx.name.toLowerCase().split(/\s+/).filter((s) => s.length >= 3));
  if (ctx.email) {
    const local = ctx.email.split('@')[0]?.toLowerCase();
    if (local && local.length >= 3) chunks.push(local);
  }
  const containsIdentity = p.length > 0 && chunks.some((c) => lowerPw.includes(c));
  const valid = passed === 5 && !containsIdentity;
  return { rules, score, label, containsIdentity, valid };
}

type Props = {
  password: string;
  email?: string;
  name?: string;
  showRules?: boolean;
};

/** Renders the 4-segment strength bar + rule checklist. */
export function PasswordStrength({ password, email, name, showRules = true }: Props) {
  const c = useColors();
  const styles = useThemedStyles(makeStyles);
  const ev = evaluatePassword(password, { email, name });
  const barColors = ['#E07A5F', '#E07A5F', '#D99E42', '#2BC4D6', '#3DB8A8'];

  if (!password) return null;

  return (
    <View style={styles.wrap}>
      <View style={styles.barRow}>
        {[0, 1, 2, 3].map((i) => (
          <View
            key={i}
            style={[
              styles.barSeg,
              { backgroundColor: i < ev.score ? barColors[ev.score] : c.borderSubtle },
            ]}
          />
        ))}
        {!!ev.label && <Text style={[styles.label, { color: barColors[ev.score] }]}>{ev.label}</Text>}
      </View>
      {ev.containsIdentity && (
        <Text style={styles.identityWarn}>Don&apos;t include your name/email</Text>
      )}
      {showRules && (
        <View style={styles.rules}>
          {([
            ['length', '8+ characters'],
            ['upper', 'An uppercase letter'],
            ['lower', 'A lowercase letter'],
            ['number', 'A number'],
            ['symbol', "A symbol (!@#$%^&*…)"],
          ] as const).map(([key, txt]) => (
            <Text
              key={key}
              style={[styles.ruleItem, { color: ev.rules[key] ? c.severityInfo : c.textMuted }]}
            >
              {ev.rules[key] ? '✓' : '•'} {txt}
            </Text>
          ))}
        </View>
      )}
    </View>
  );
}

function makeStyles(c: ColorPalette) { return StyleSheet.create({
  wrap: { gap: 6, marginTop: 6 },
  barRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  barSeg: { flex: 1, height: 6, borderRadius: 3 },
  label: { fontFamily: Fonts.bodySemi, fontSize: 11, marginLeft: 4, minWidth: 42 },
  identityWarn: { fontFamily: Fonts.bodySemi, fontSize: 12, color: '#E07A5F' },
  rules: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 2 },
  ruleItem: { fontFamily: Fonts.body, fontSize: 12 },
}); }

// Reusable AU mobile regex (verbatim from web).
export const AU_MOBILE_RE = /^(\+614\d{8}|04\d{8})$/;
