// Phase E — Settings: Appearance (text size + reduced motion + theme).
import React from 'react';
import { ScrollView, StyleSheet, Switch, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import BackHeader from '../../src/components/BackHeader';
import { Fonts, Radius, Spacing, Type } from '../../src/lib/theme';
import type { ColorPalette } from '../../src/lib/theme';
import { useColors } from '../../src/hooks/useColors';
import { useThemedStyles } from '../../src/hooks/useThemedStyles';
import { useAccessibility, TextScale } from '../../src/context/AccessibilityContext';
import { useTheme, type ThemeChoice } from '../../src/context/ThemeContext';

export default function AppearanceSettings() {
  const c = useColors();
  const styles = useThemedStyles(makeStyles);
  const { textScale, setTextScale, reduceMotion, toggleReduceMotion } = useAccessibility();
  const { choice, effective, setChoice } = useTheme();
  const sizes: Array<{ key: TextScale; label: string }> = [
    { key: 'sm', label: 'Compact' },
    { key: 'md', label: 'Default' },
    { key: 'lg', label: 'Larger' },
    { key: 'xl', label: 'Largest' },
  ];
  const themes: Array<{ key: ThemeChoice; label: string; icon: keyof typeof Ionicons.glyphMap }> = [
    { key: 'system', label: 'System', icon: 'phone-portrait-outline' },
    { key: 'light',  label: 'Light',  icon: 'sunny-outline' },
    { key: 'dark',   label: 'Dark',   icon: 'moon-outline' },
  ];
  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <BackHeader title="Appearance" />
      <ScrollView contentContainerStyle={{ padding: Spacing.md, paddingBottom: 40, gap: Spacing.md }}>
        <View style={styles.card}>
          <Text style={styles.label}>Appearance</Text>
          <Text style={styles.sub}>Pick how Wayly should look. We will keep the system clock and battery readable, black on light, white on dark.</Text>

          {/* Live preview swatches, show what the current pick will look like */}
          <View style={styles.preview}>
            <View style={[styles.previewTile, effective === 'light' ? styles.previewLight : styles.previewDark]}>
              <Text style={[styles.previewLbl, { color: effective === 'light' ? '#0E4D52' : '#F0EBE0' }]}>Aa</Text>
              <View style={[styles.previewDot, { backgroundColor: effective === 'light' ? '#0E4D52' : '#5FA9AF' }]} />
            </View>
            <Text style={styles.previewMeta}>
              Active: <Text style={styles.subBold}>{effective === 'dark' ? 'Dark' : 'Light'}</Text>
              {choice === 'system' ? ' (matching your phone)' : ''}
            </Text>
          </View>

          <View style={styles.row}>
            {themes.map((t) => (
              <TouchableOpacity
                key={t.key}
                onPress={() => setChoice(t.key)}
                style={[styles.themePill, choice === t.key && styles.themePillActive]}
                testID={`theme-${t.key}`}
              >
                <Ionicons name={t.icon} size={14} color={choice === t.key ? '#FFFFFF' : c.brandPrimary} />
                <Text style={[styles.themePillText, choice === t.key && styles.themePillTextActive]}>{t.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.label}>Text size</Text>
          <View style={styles.row}>
            {sizes.map((s) => (
              <TouchableOpacity key={s.key} onPress={() => setTextScale(s.key)} style={[styles.pill, textScale === s.key && styles.pillActive]} testID={`text-size-${s.key}`}>
                <Text style={[styles.pillText, textScale === s.key && styles.pillTextActive]}>{s.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
        <View style={styles.card}>
          <View style={styles.toggleRow}>
            <View style={{ flex: 1, paddingRight: 12 }}>
              <Text style={styles.label2}>Reduce motion</Text>
              <Text style={styles.sub}>Soften transitions and disable subtle animations.</Text>
            </View>
            <Switch value={reduceMotion} onValueChange={toggleReduceMotion} trackColor={{ false: 'rgba(122,138,140,0.45)', true: c.brandPrimary }} thumbColor="#FFFFFF" />
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function makeStyles(c: ColorPalette) { return StyleSheet.create({
  safe: { flex: 1, backgroundColor: c.background },
  card: { backgroundColor: c.cardBg, borderRadius: Radius.lg, borderWidth: 1, borderColor: c.border, padding: Spacing.md, gap: 10 },
  label: { ...Type.caption, color: c.textMuted, fontFamily: Fonts.bodySemi, textTransform: 'uppercase', letterSpacing: 0.8 },
  label2: { ...Type.bodySemi, color: c.textPrimary },
  sub: { ...Type.caption, color: c.textSecondary, marginTop: 3, lineHeight: 17 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  pill: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: 9999, borderWidth: 1.5, borderColor: c.border, backgroundColor: c.cardBg },
  pillActive: { borderColor: c.brandPrimary, backgroundColor: 'rgba(14,77,82,0.08)' },
  pillText: { ...Type.body, color: c.textSecondary, fontFamily: Fonts.bodySemi, fontWeight: '700' },
  pillTextActive: { color: c.brandPrimary },
  toggleRow: { flexDirection: 'row', alignItems: 'center' },
  themePill: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 8, paddingHorizontal: 12, borderRadius: 9999, borderWidth: 1.5, borderColor: c.border, backgroundColor: c.cardBg, minHeight: 36 },
  themePillActive: { borderColor: c.brandPrimary, backgroundColor: c.brandPrimary },
  themePillText: { ...Type.body, color: c.brandPrimary, fontFamily: Fonts.bodySemi, fontSize: 13 },
  themePillTextActive: { color: '#FFFFFF' },
  subBold: { fontFamily: Fonts.bodySemi, color: c.brandPrimary },
  preview: { flexDirection: 'row', alignItems: 'center', gap: 10, marginVertical: 8 },
  previewTile: { width: 64, height: 44, borderRadius: 8, alignItems: 'center', justifyContent: 'center', borderWidth: 1, gap: 2 },
  previewLight: { backgroundColor: '#FBF8F3', borderColor: 'rgba(14,77,82,0.12)' },
  previewDark: { backgroundColor: '#1A1815', borderColor: 'rgba(240,235,224,0.14)' },
  previewLbl: { fontFamily: Fonts.heading, fontSize: 18 },
  previewDot: { width: 10, height: 3, borderRadius: 2 },
  previewMeta: { flex: 1, fontFamily: Fonts.body, fontSize: 12, color: c.textSecondary },
}); }
