// NumberMono — UI-2 §4.3.
// EVERY number a tool or dashboard renders (currency, percentages, ranges,
// years-to-cap) goes through this component: IBM Plex Mono + tabular figures.
// Never Fraunces, never Inter, no exceptions.
import React from 'react';
import { Text, TextProps, TextStyle } from 'react-native';
import { Fonts } from '../lib/theme';

type Weight = 'regular' | 'medium' | 'semibold';

const FAMILY: Record<Weight, string> = {
  regular: Fonts.mono,
  medium: Fonts.monoMed,
  semibold: Fonts.monoSemi,
};

export interface NumberMonoProps extends TextProps {
  weight?: Weight;
  size?: number;
  color?: string;
}

export function NumberMono({ weight = 'regular', size, color, style, children, ...rest }: NumberMonoProps) {
  const base: TextStyle = {
    fontFamily: FAMILY[weight],
    fontVariant: ['tabular-nums'],
    ...(size != null ? { fontSize: size, lineHeight: Math.round(size * 1.35) } : null),
    ...(color ? { color } : null),
  };
  return (
    <Text {...rest} style={[base, style]}>
      {children}
    </Text>
  );
}

/** Style fragment for cases where a component styles its own <Text>. */
export const numberMonoStyle = (weight: Weight = 'regular'): TextStyle => ({
  fontFamily: FAMILY[weight],
  fontVariant: ['tabular-nums'],
});
