// Schema-upgrade banner — shown when schema is missing or version is behind.
import React from 'react';
import { Linking, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useScenario } from '../context/ScenarioContext';
import { Colors, Fonts, Spacing, Type } from '../lib/theme';

export function SchemaBanner() {
  const { schema, majorMismatch } = useScenario();
  const insets = useSafeAreaInsets();
  // Only show the banner on a hard major-version mismatch. The historic
  // "Couldn't reach Wayly / Retry" warning has been retired — the schema
  // endpoint may legitimately 404 on production builds that haven't shipped
  // the scenario engine yet, and surfacing that to every user looked alarming
  // when nothing is actually wrong with their connection.
  if (!majorMismatch) return null;
  const isMajor = majorMismatch;
  return (
    <View
      style={[
        styles.bar,
        isMajor ? styles.barCritical : styles.barWarning,
        // Push the banner below the status bar / notch so the text isn't cut
        // off and the Retry button doesn't sit on the very top edge. On web
        // the SafeArea inset is usually 0 so we floor at 16px so the icon
        // doesn't bump into the viewport edge.
        { paddingTop: Math.max(insets.top, 16) + 4 },
      ]}
      testID="schema-upgrade-banner"
    >
      <Ionicons name="warning" size={16} color={isMajor ? '#7A2210' : '#5C3D11'} style={{ marginTop: 2 }} />
      <View style={{ flex: 1 }}>
        <Text style={[styles.title, isMajor && { color: '#7A2210' }]}>{isMajor ? 'Update required' : 'Couldn’t reach Wayly'}</Text>
        <Text style={styles.body}>
          {isMajor
            ? `Wayly's scenario engine has moved to a newer major version (schema ${schema?.schema_version}). Please update the app to keep using these screens.`
            : 'We’ll try again automatically. Some screens may be limited until we reconnect.'}
        </Text>
      </View>
      {isMajor ? (
        <TouchableOpacity onPress={() => Linking.openURL('https://wayly.com.au/download').catch(() => {})} hitSlop={6} style={styles.ctaWrap}>
          <Text style={styles.cta}>Update</Text>
        </TouchableOpacity>
      ) : (
        <TouchableOpacity onPress={refreshSchema} hitSlop={6} style={styles.ctaWrap}>
          <Text style={styles.cta}>Retry</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}
const styles = StyleSheet.create({
  bar: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, paddingHorizontal: Spacing.md, paddingVertical: 10, borderBottomWidth: 1 },
  barWarning: { backgroundColor: '#FAEFD4', borderBottomColor: '#E8D9B3' },
  barCritical: { backgroundColor: '#FDE8E2', borderBottomColor: '#A5512B' },
  title: { ...Type.bodySemi, color: '#5C3D11' },
  body: { ...Type.caption, color: '#5C3D11', marginTop: 2, lineHeight: 17 },
  ctaWrap: { alignSelf: 'center', paddingHorizontal: 4, paddingVertical: 6, minHeight: 44, justifyContent: 'center' },
  cta: { color: Colors.brandPrimary, fontFamily: Fonts.bodySemi, fontWeight: '700' },
});
