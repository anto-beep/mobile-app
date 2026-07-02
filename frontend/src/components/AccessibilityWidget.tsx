// Bottom-left floating accessibility pill — opens sheet with text size, contrast, dark mode, reduce motion, read aloud
import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Modal, Pressable, Switch, ScrollView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Fonts, Radius, Spacing } from '../lib/theme';
import { useAccessibility, TextScale, TEXT_SCALES, useA11yColors } from '../context/AccessibilityContext';

const SCALE_LABELS: { key: TextScale; label: string; size: number }[] = [
  { key: 'sm', label: 'A', size: 13 },
  { key: 'md', label: 'A', size: 16 },
  { key: 'lg', label: 'A', size: 19 },
  { key: 'xl', label: 'A', size: 22 },
];

export function AccessibilityWidget() {
  const a11y = useAccessibility();
  const themed = useA11yColors();
  const [open, setOpen] = useState(false);

  const sheetBg = themed?.cardBg || Colors.cardBg;
  const textColor = themed?.textPrimary || Colors.brandPrimary;
  const subColor = themed?.textSecondary || Colors.textSecondary;
  const borderColor = themed?.borderSubtle || Colors.borderSubtle;

  return (
    <>
      {/* Floating pill button, bottom-left */}
      <TouchableOpacity
        style={styles.pill}
        onPress={() => setOpen(true)}
        activeOpacity={0.85}
        accessibilityLabel="Accessibility settings"
        accessibilityRole="button"
        testID="a11y-pill"
      >
        <Ionicons name="accessibility" size={22} color={Colors.cream} />
      </TouchableOpacity>

      <Modal visible={open} animationType="slide" transparent onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)} />
        <SafeAreaView edges={['bottom']} style={[styles.sheetWrap, { backgroundColor: sheetBg }]}>
          <View style={styles.handle} />
          <View style={styles.headerRow}>
            <View style={styles.headerIcon}>
              <Ionicons name="accessibility" size={18} color={Colors.brandSecondary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.title, { color: textColor }]} testID="a11y-title">Accessibility</Text>
              <Text style={[styles.subtitle, { color: subColor }]}>Adjust how Wayly looks and sounds.</Text>
            </View>
            <TouchableOpacity onPress={() => setOpen(false)} hitSlop={10} testID="a11y-close">
              <Ionicons name="close" size={22} color={subColor} />
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
            {/* Text size */}
            <View style={[styles.section, { borderColor }]}>
              <Text style={[styles.sectionLabel, { color: subColor }]}>Text size</Text>
              <View style={styles.scaleRow}>
                {SCALE_LABELS.map((s) => {
                  const active = a11y.textScale === s.key;
                  return (
                    <TouchableOpacity
                      key={s.key}
                      style={[styles.scaleBtn, active && styles.scaleBtnActive]}
                      onPress={() => a11y.setTextScale(s.key)}
                      accessibilityLabel={`Text size ${s.key}`}
                      testID={`a11y-scale-${s.key}`}
                    >
                      <Text style={[styles.scaleLetter, { fontSize: s.size }, active && { color: Colors.cream }]}>
                        {s.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
              <Text style={[styles.hint, { color: subColor }]}>
                Current scale: {(TEXT_SCALES[a11y.textScale] * 100).toFixed(0)}%
              </Text>
            </View>

            {/* Toggles */}
            <View style={[styles.section, { borderColor }]}>
              <ToggleRow
                icon="contrast"
                label="High contrast"
                hint="Bolder borders and stronger text"
                value={a11y.highContrast}
                onChange={a11y.toggleHighContrast}
                textColor={textColor}
                subColor={subColor}
                testID="a11y-high-contrast"
              />
              <ToggleRow
                icon="moon"
                label="Dark mode"
                hint="Easier on the eyes at night"
                value={a11y.darkMode}
                onChange={a11y.toggleDarkMode}
                textColor={textColor}
                subColor={subColor}
                testID="a11y-dark-mode"
              />
              <ToggleRow
                icon="pause-circle-outline"
                label="Reduce motion"
                hint="Minimise animations and transitions"
                value={a11y.reduceMotion}
                onChange={a11y.toggleReduceMotion}
                textColor={textColor}
                subColor={subColor}
                testID="a11y-reduce-motion"
              />
              <ToggleRow
                icon="volume-high-outline"
                label="Read aloud"
                hint="Tap text on a page to hear it spoken"
                value={a11y.readAloud}
                onChange={a11y.toggleReadAloud}
                textColor={textColor}
                subColor={subColor}
                testID="a11y-read-aloud"
                last
              />
            </View>

            {/* Read aloud test */}
            {a11y.readAloud && (
              <TouchableOpacity
                style={styles.testBtn}
                onPress={() => a11y.speak("Hello, this is Wayly's read aloud feature. Tap any text on a screen to hear it spoken.")}
                testID="a11y-read-aloud-test"
              >
                <Ionicons name="play-circle" size={18} color={Colors.brandPrimary} />
                <Text style={styles.testBtnText}>Test read aloud</Text>
              </TouchableOpacity>
            )}

            <Text style={[styles.footer, { color: subColor }]}>
              These settings are saved on this device.
            </Text>
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </>
  );
}

function ToggleRow({
  icon, label, hint, value, onChange, textColor, subColor, last, testID,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  hint: string;
  value: boolean;
  onChange: () => void;
  textColor: string;
  subColor: string;
  last?: boolean;
  testID?: string;
}) {
  return (
    <View style={[styles.toggleRow, !last && styles.toggleRowBorder]}>
      <View style={styles.toggleIcon}>
        <Ionicons name={icon} size={18} color={Colors.brandSecondary} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.toggleLabel, { color: textColor }]}>{label}</Text>
        <Text style={[styles.toggleHint, { color: subColor }]}>{hint}</Text>
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{ false: 'rgba(122,138,140,0.45)', true: Colors.brandPrimary }}
        thumbColor="#FFFFFF"
        testID={testID}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    position: 'absolute',
    left: 16,
    bottom: Platform.OS === 'ios' ? 100 : 88,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: Colors.brandPrimary,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 6,
    elevation: 6,
    zIndex: 9999,
  },
  backdrop: { flex: 1, backgroundColor: 'rgba(14, 77, 82, 0.5)' },
  sheetWrap: {
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    paddingHorizontal: Spacing.lg, paddingTop: Spacing.md, paddingBottom: Spacing.sm,
    maxHeight: '85%',
  },
  handle: { width: 40, height: 4, backgroundColor: 'rgba(14,77,82,0.18)', borderRadius: 2, alignSelf: 'center', marginBottom: Spacing.md },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: Spacing.md },
  headerIcon: { width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(183, 121, 31, 0.15)', alignItems: 'center', justifyContent: 'center' },
  title: { fontFamily: Fonts.heading, fontSize: 22, color: Colors.brandPrimary, letterSpacing: -0.3 },
  subtitle: { fontFamily: Fonts.body, fontSize: 12, color: Colors.textSecondary, marginTop: 2 },
  body: { paddingBottom: Spacing.lg, gap: Spacing.md },
  section: { backgroundColor: 'transparent', borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.borderSubtle, padding: Spacing.md, gap: Spacing.sm },
  sectionLabel: { fontFamily: Fonts.bodyMed, fontSize: 11, letterSpacing: 1.2, textTransform: 'uppercase', color: Colors.textMuted, marginBottom: 4 },
  scaleRow: { flexDirection: 'row', gap: 8, marginTop: 4 },
  scaleBtn: { flex: 1, minHeight: 52, alignItems: 'center', justifyContent: 'center', borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.background },
  scaleBtnActive: { backgroundColor: Colors.brandPrimary, borderColor: Colors.brandPrimary },
  scaleLetter: { fontFamily: Fonts.bodySemi, color: Colors.brandPrimary },
  hint: { fontFamily: Fonts.body, fontSize: 11, color: Colors.textMuted, marginTop: 4 },
  toggleRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, gap: 12 },
  toggleRowBorder: { borderBottomWidth: 1, borderBottomColor: Colors.borderSubtle },
  toggleIcon: { width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(183, 121, 31, 0.12)', alignItems: 'center', justifyContent: 'center' },
  toggleLabel: { fontFamily: Fonts.bodySemi, fontSize: 14, color: Colors.brandPrimary },
  toggleHint: { fontFamily: Fonts.body, fontSize: 11, color: Colors.textSecondary, marginTop: 1 },
  testBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 12, borderRadius: Radius.md, backgroundColor: 'rgba(14, 77, 82, 0.06)' },
  testBtnText: { fontFamily: Fonts.bodySemi, fontSize: 14, color: Colors.brandPrimary },
  footer: { fontFamily: Fonts.body, fontSize: 11, color: Colors.textMuted, textAlign: 'center', marginTop: 8 },
});
