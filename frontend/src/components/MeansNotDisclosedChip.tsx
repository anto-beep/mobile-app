/**
 * MEANS_NOT_DISCLOSED chip on the participant switcher.
 *
 * Renders a small clay-coloured pill on top of the participant pill when
 * the active participant has the `means_not_disclosed` flag (sourced from
 * `flags.payload_keys`-shaped data on the participant record returned by
 * `/account`). The flag is itself surfaced server-side via the scenario
 * engine — mobile only reads + renders.
 *
 * Why a tiny dedicated module? So WaylyHeader stays under 130 lines and
 * the chip can be reused on the Participants screen later.
 */
import React from 'react';
import { StyleSheet, Text, View, ViewStyle } from 'react-native';
import { Fonts } from '../lib/theme';

export function MeansNotDisclosedChip({ active = false, style }: { active?: boolean; style?: ViewStyle }) {
  if (!active) return null;
  return (
    <View style={[styles.pill, style]} accessibilityLabel="Means not disclosed" testID="means-not-disclosed-chip">
      <Text style={styles.text}>MND</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: { backgroundColor: '#A5512B', borderRadius: 9999, paddingHorizontal: 5, paddingVertical: 1, minWidth: 24, alignItems: 'center' },
  text: { color: '#fff', fontFamily: Fonts.bodySemi, fontSize: 9, fontWeight: '700', letterSpacing: 0.5 },
});
