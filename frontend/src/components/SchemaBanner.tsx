// Schema-upgrade banner — shown when schema is missing or version is behind.
import React from 'react';
import { Linking, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useScenario } from '../context/ScenarioContext';
import { Colors, Fonts, Spacing, Type } from '../lib/theme';

export function SchemaBanner() {
  const { schema, schemaError, majorMismatch, refreshSchema } = useScenario();
  if (!majorMismatch && !schemaError) return null;
  const isMajor = majorMismatch;
  return (
    <View style={[styles.bar, isMajor ? styles.barCritical : styles.barWarning]} testID="schema-upgrade-banner">
      <Ionicons name="warning" size={16} color={isMajor ? '#7A2210' : '#5C3D11'} />
      <View style={{ flex: 1 }}>
        <Text style={[styles.title, isMajor && { color: '#7A2210' }]}>{isMajor ? 'Update required' : 'Couldn’t reach Wayly'}</Text>
        <Text style={styles.body}>
          {isMajor
            ? `Wayly's scenario engine has moved to a newer major version (schema ${schema?.schema_version}). Please update the app to keep using these screens.`
            : 'We’ll try again automatically. Some screens may be limited until we reconnect.'}
        </Text>
      </View>
      {isMajor ? (
        <TouchableOpacity onPress={() => Linking.openURL('https://wayly.com.au/download').catch(() => {})} hitSlop={6}>
          <Text style={styles.cta}>Update</Text>
        </TouchableOpacity>
      ) : (
        <TouchableOpacity onPress={refreshSchema} hitSlop={6}>
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
  cta: { color: Colors.brandPrimary, fontFamily: Fonts.bodySemi, fontWeight: '700' },
});
