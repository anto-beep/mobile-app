// Phase E — Settings: Appearance (text size + reduced motion + theme).
import React from 'react';
import { ScrollView, StyleSheet, Switch, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import BackHeader from '../../src/components/BackHeader';
import { Colors, Fonts, Radius, Spacing, Type } from '../../src/lib/theme';
import { useAccessibility, TextScale } from '../../src/context/AccessibilityContext';
import { useTheme, type ThemeChoice } from '../../src/context/ThemeContext';

export default function AppearanceSettings() {
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
          <Text style={styles.label}>Theme</Text>
          <View style={styles.row}>
            {themes.map((t) => (
              <TouchableOpacity
                key={t.key}
                onPress={() => setChoice(t.key)}
                style={[styles.themePill, choice === t.key && styles.themePillActive]}
                testID={`theme-${t.key}`}
              >
                <Ionicons name={t.icon} size={14} color={choice === t.key ? '#FFFFFF' : Colors.brandPrimary} />
                <Text style={[styles.themePillText, choice === t.key && styles.themePillTextActive]}>{t.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <Text style={styles.sub}>
            Active: <Text style={styles.subBold}>{effective === 'dark' ? 'Dark' : 'Light'}</Text>
            {choice === 'system' ? ' (matching your phone)' : ''}. We use this to keep the system clock and battery icon visible — black on light backdrops, white on dark.
          </Text>
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
            <Switch value={reduceMotion} onValueChange={toggleReduceMotion} trackColor={{ true: Colors.brandPrimary, false: Colors.border }} />
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  card: { backgroundColor: Colors.cardBg, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.border, padding: Spacing.md, gap: 10 },
  label: { ...Type.caption, color: Colors.textMuted, fontFamily: Fonts.bodySemi, textTransform: 'uppercase', letterSpacing: 0.8 },
  label2: { ...Type.bodySemi, color: Colors.textPrimary },
  sub: { ...Type.caption, color: Colors.textSecondary, marginTop: 3, lineHeight: 17 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  pill: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: 9999, borderWidth: 1.5, borderColor: Colors.border, backgroundColor: Colors.cardBg },
  pillActive: { borderColor: Colors.brandPrimary, backgroundColor: 'rgba(14,77,82,0.08)' },
  pillText: { ...Type.body, color: Colors.textSecondary, fontFamily: Fonts.bodySemi, fontWeight: '700' },
  pillTextActive: { color: Colors.brandPrimary },
  toggleRow: { flexDirection: 'row', alignItems: 'center' },
  themePill: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 8, paddingHorizontal: 12, borderRadius: 9999, borderWidth: 1.5, borderColor: Colors.border, backgroundColor: Colors.cardBg, minHeight: 36 },
  themePillActive: { borderColor: Colors.brandPrimary, backgroundColor: Colors.brandPrimary },
  themePillText: { ...Type.body, color: Colors.brandPrimary, fontFamily: Fonts.bodySemi, fontSize: 13 },
  themePillTextActive: { color: '#FFFFFF' },
  subBold: { fontFamily: Fonts.bodySemi, color: Colors.brandPrimary },
});
