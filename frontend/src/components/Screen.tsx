// Shared screen primitives used by Phase C module scaffolds.
// Keeps each module file under 100 lines and visually consistent.
import React, { ReactNode } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Fonts, Radius, Spacing, Type } from '../lib/theme';
import { WaylyHeader } from './WaylyHeader';
import { TrialCountdownBanner } from './TrialCountdownBanner';
import BackHeader from './BackHeader';

type ShellProps = {
  title: string;
  subtitle?: string;
  children: ReactNode;
  loading?: boolean;
  onRefresh?: () => void | Promise<void>;
  refreshing?: boolean;
  hideHeader?: boolean;
  useBack?: boolean;  // Use BackHeader rather than the global WaylyHeader
};

export function ScreenShell({
  title, subtitle, children, loading, onRefresh, refreshing, hideHeader, useBack,
}: ShellProps) {
  // Loading: render skeleton list rather than a spinner.
  // We import lazily to keep the bundle small for screens that never load.
  // (LoadingBlock kept for callers that prefer the small spinner.)
  let body = children;
  if (loading) {
    const { ListSkeleton } = require('./Skeleton');
    body = <ListSkeleton rows={4} />;
  }
  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {!hideHeader && (useBack ? <BackHeader title={title} /> : <><WaylyHeader /><TrialCountdownBanner /></>)}
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={onRefresh ? (
          <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} tintColor={Colors.brandPrimary} />
        ) : undefined}
      >
        {!useBack && (
          <View style={styles.heading}>
            <Text style={[Type.h1 as any, { color: Colors.textPrimary }]}>{title}</Text>
            {!!subtitle && <Text style={styles.sub}>{subtitle}</Text>}
          </View>
        )}
        {body}
      </ScrollView>
    </SafeAreaView>
  );
}

export function LoadingBlock() {
  return (
    <View style={styles.loadingWrap}>
      <ActivityIndicator size="small" color={Colors.brandPrimary} />
      <Text style={styles.loadingText}>Loading…</Text>
    </View>
  );
}

export type EmptyStateProps = {
  icon?: keyof typeof Ionicons.glyphMap;
  title: string;
  body?: string;
  cta?: { label: string; onPress: () => void };
};

export function EmptyState({ icon = 'sparkles-outline', title, body, cta }: EmptyStateProps) {
  return (
    <View style={styles.empty} testID="empty-state">
      <View style={styles.emptyIcon}>
        <Ionicons name={icon} size={28} color={Colors.brandPrimary} />
      </View>
      <Text style={styles.emptyTitle}>{title}</Text>
      {!!body && <Text style={styles.emptyBody}>{body}</Text>}
      {cta && (
        <View style={styles.ctaWrap}>
          <Text onPress={cta.onPress} style={styles.cta} accessibilityRole="button">{cta.label}</Text>
        </View>
      )}
    </View>
  );
}

export function ListCard({ title, subtitle, right }: { title: string; subtitle?: string; right?: ReactNode }) {
  return (
    <View style={styles.card}>
      <View style={{ flex: 1 }}>
        <Text style={styles.cardTitle}>{title}</Text>
        {!!subtitle && <Text style={styles.cardSub}>{subtitle}</Text>}
      </View>
      {right}
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.bg },
  scroll: { paddingBottom: 60 },
  heading: { paddingHorizontal: Spacing.lg, paddingTop: Spacing.lg, paddingBottom: Spacing.md, gap: 6 },
  sub: { ...Type.body, color: Colors.textSecondary },
  loadingWrap: { alignItems: 'center', paddingVertical: 60, gap: 10 },
  loadingText: { ...Type.caption, color: Colors.textMuted },
  empty: { alignItems: 'center', paddingHorizontal: Spacing.lg, paddingVertical: 60, gap: 12 },
  emptyIcon: { width: 56, height: 56, borderRadius: 28, backgroundColor: 'rgba(14,77,82,0.08)', alignItems: 'center', justifyContent: 'center' },
  emptyTitle: { ...Type.h3, color: Colors.textPrimary, textAlign: 'center' },
  emptyBody: { ...Type.body, color: Colors.textSecondary, textAlign: 'center', maxWidth: 320, lineHeight: 22 },
  ctaWrap: { marginTop: 14 },
  cta: { color: Colors.brandPrimary, fontFamily: Fonts.bodySemi, fontSize: 14, fontWeight: '700', textDecorationLine: 'underline' },
  card: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: Colors.cardBg, borderRadius: Radius.lg, padding: Spacing.md, marginHorizontal: Spacing.md, marginBottom: 8, borderWidth: 1, borderColor: Colors.border },
  cardTitle: { ...Type.bodySemi, color: Colors.textPrimary },
  cardSub: { ...Type.caption, color: Colors.textSecondary, marginTop: 2 },
});
