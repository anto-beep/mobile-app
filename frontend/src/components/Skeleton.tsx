// Skeleton placeholders for list/card loading states (Phase E polish).
// Uses a shimmering opacity loop on a neutral block. Mounts cheap; no native modules.
import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, View, ViewStyle } from 'react-native';
import { Colors, Radius, Spacing } from '../lib/theme';

type Props = { height?: number; width?: number | string; style?: ViewStyle; radius?: number };

export function SkeletonBlock({ height = 14, width = '100%', radius = 6, style }: Props) {
  const opacity = useRef(new Animated.Value(0.4)).current;
  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 1, duration: 700, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.4, duration: 700, useNativeDriver: true }),
      ])
    );
    anim.start();
    return () => anim.stop();
  }, [opacity]);
  return (
    <Animated.View
      style={[
        { height, width: width as any, borderRadius: radius, backgroundColor: '#E5DCCB', opacity },
        style,
      ]}
    />
  );
}

/** A multi-row list skeleton, used by Phase C screens when `loading`. */
export function ListSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <View style={{ paddingHorizontal: Spacing.md, marginTop: Spacing.sm, gap: 10 }}>
      {Array.from({ length: rows }).map((_, i) => (
        <View key={i} style={styles.card}>
          <SkeletonBlock height={14} width={'55%'} />
          <SkeletonBlock height={12} width={'80%'} style={{ marginTop: 8 }} />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: Colors.cardBg, borderWidth: 1, borderColor: Colors.border, borderRadius: Radius.lg, padding: Spacing.md },
});
