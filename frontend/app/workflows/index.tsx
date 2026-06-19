// Workflow wizards index — lists the 3 guided workflows from /scenario/workflows.
import React from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import BackHeader from '../../src/components/BackHeader';
import { useScenario } from '../../src/context/ScenarioContext';
import { Fonts, Radius, Spacing, Type } from '../../src/lib/theme';
import type { ColorPalette } from '../../src/lib/theme';
import { useColors } from '../../src/hooks/useColors';
import { useThemedStyles } from '../../src/hooks/useThemedStyles';
import { EmptyState } from '../../src/components/Screen';

const ICON_FOR: Record<string, keyof typeof Ionicons.glyphMap> = {
  reassessment: 'reload-circle-outline',
  hospitalisation: 'medkit-outline',
  death: 'flower-outline',
};

export default function WorkflowsIndex() {
  const c = useColors();
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const { schema } = useScenario();
  const wfs = Object.values(schema?.workflows || {});
  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <BackHeader title="Guided workflows" />
      <ScrollView contentContainerStyle={{ padding: Spacing.md, paddingBottom: 40, gap: 12 }}>
        <Text style={styles.lead}>Step-by-step flows for the big moments in a participant’s journey. Each step captures the right event on the timeline.</Text>
        {wfs.length === 0 ? (
          <EmptyState icon="compass-outline" title="Workflows unavailable" body="The scenario engine catalogue couldn’t be loaded — pull down to refresh on the main screen." />
        ) : wfs.map((w) => {
          const isEscalate = w.advice_boundary === 'ESCALATE';
          return (
            <TouchableOpacity
              key={w.key}
              testID={`workflow-link-${w.key}`}
              onPress={() => router.push(`/workflows/${w.key}` as any)}
              style={[styles.card, isEscalate && styles.cardEscalate]}
            >
              <View style={[styles.iconWrap, isEscalate && { backgroundColor: '#FDE8E2' }]}>
                <Ionicons name={ICON_FOR[w.key] || 'flag-outline'} size={22} color={isEscalate ? '#A5512B' : c.brandPrimary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.title, isEscalate && { color: '#7A2210' }]}>{w.label}</Text>
                <Text style={styles.body} numberOfLines={3}>{w.intro}</Text>
                {isEscalate && (
                  <View style={styles.escPill}><Text style={styles.escPillText}>Sensitive — escalation flow</Text></View>
                )}
              </View>
              <Ionicons name="chevron-forward" size={18} color={c.textMuted} />
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </SafeAreaView>
  );
}
function makeStyles(c: ColorPalette) { return StyleSheet.create({
  safe: { flex: 1, backgroundColor: c.bg },
  lead: { ...Type.body, color: c.textSecondary, lineHeight: 22 },
  card: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, backgroundColor: c.cardBg, borderWidth: 1, borderColor: c.border, borderRadius: Radius.lg, padding: Spacing.md },
  cardEscalate: { borderColor: '#A5512B', borderWidth: 2, backgroundColor: '#FDF3EF' },
  iconWrap: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(14,77,82,0.08)', alignItems: 'center', justifyContent: 'center' },
  title: { ...Type.h3, color: c.textPrimary },
  body: { ...Type.body, color: c.textSecondary, marginTop: 4, lineHeight: 21 },
  escPill: { alignSelf: 'flex-start', marginTop: 8, backgroundColor: '#FBE5E0', borderRadius: 9999, paddingHorizontal: 8, paddingVertical: 3 },
  escPillText: { color: '#7A2210', fontFamily: Fonts.bodySemi, fontWeight: '700', fontSize: 11, letterSpacing: 0.4 },
}); }
