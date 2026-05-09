// AI Tools index — picker for native tool screens
import React from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Fonts, Radius, Spacing } from '../../src/lib/theme';

const TOOLS = [
  {
    key: 'budget-calc',
    title: 'Budget calculator',
    sub: 'Work out the quarterly + annual budget for any classification',
    icon: 'calculator-outline',
    color: '#1F3A5F',
  },
  {
    key: 'price-checker',
    title: 'Provider price checker',
    sub: "Is this rate fair? We'll compare it to the network median + 1 Jul cap",
    icon: 'pricetag-outline',
    color: '#3A5A40',
  },
  {
    key: 'classification-check',
    title: 'Classification self-check',
    sub: '12-question quick check — likely Support at Home level',
    icon: 'help-circle-outline',
    color: '#8B9B82',
  },
  {
    key: 'reassessment-letter',
    title: 'Reassessment letter',
    sub: "Draft a polite request to My Aged Care if your parent's needs have changed",
    icon: 'mail-outline',
    color: '#A05545',
  },
];

export default function ToolsIndex() {
  const router = useRouter();
  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView contentContainerStyle={styles.scroll} testID="tools-scroll">
        <TouchableOpacity onPress={() => router.back()} style={styles.back}>
          <Ionicons name="chevron-back" size={20} color={Colors.brandPrimary} />
          <Text style={styles.backText}>Back</Text>
        </TouchableOpacity>
        <Text style={styles.overline}>Helpful tools</Text>
        <Text style={styles.h1}>AI tools</Text>
        <Text style={styles.sub}>Quick answers when you need them.</Text>

        {TOOLS.map((t) => (
          <TouchableOpacity
            key={t.key}
            style={styles.card}
            onPress={() => router.push(`/tools/${t.key}` as any)}
            testID={`tool-${t.key}`}
          >
            <View style={[styles.iconWrap, { backgroundColor: `${t.color}15` }]}>
              <Ionicons name={t.icon as any} size={22} color={t.color} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.cardTitle}>{t.title}</Text>
              <Text style={styles.cardSub}>{t.sub}</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={Colors.textMuted} />
          </TouchableOpacity>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.lg, paddingBottom: Spacing.xl },
  back: { flexDirection: 'row', alignItems: 'center', marginBottom: Spacing.md },
  backText: { fontFamily: Fonts.bodyMed, fontSize: 14, color: Colors.brandPrimary },
  overline: { fontFamily: Fonts.bodyMed, fontSize: 11, letterSpacing: 1.5, textTransform: 'uppercase', color: Colors.textMuted },
  h1: { fontFamily: Fonts.heading, fontSize: 26, color: Colors.brandPrimary, letterSpacing: -0.5 },
  sub: { fontFamily: Fonts.body, fontSize: 14, color: Colors.textSecondary, marginTop: 6, marginBottom: Spacing.lg },
  card: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    backgroundColor: Colors.cardBg, borderRadius: Radius.md, padding: Spacing.md + 2,
    marginBottom: Spacing.sm, borderWidth: 1, borderColor: Colors.borderSubtle,
  },
  iconWrap: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  cardTitle: { fontFamily: Fonts.bodySemi, fontSize: 15, color: Colors.brandPrimary },
  cardSub: { fontFamily: Fonts.body, fontSize: 12, color: Colors.textSecondary, marginTop: 4, lineHeight: 17 },
});
