// Boundary guard wrapper for Ask Wayly chat.
//
// Drop-in component: `<BoundaryAskWayly placeholder="Ask Wayly…">`.
// On submit, runs POST /scenario/boundary-probe FIRST. If the response
// boundary is not SAFE_TO_EXPLAIN, renders the contact card and never
// calls the LLM.
import React, { useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useScenario } from '../context/ScenarioContext';
import { Colors, Fonts, Radius, Spacing, Type } from '../lib/theme';
import { ContactCard } from './Timeline';

type OnSafeProps = (question: string) => Promise<void> | void;

export function BoundaryAskWayly({ onSafeAsk, placeholder = 'Ask Wayly…', busy: outerBusy }: { onSafeAsk: OnSafeProps; placeholder?: string; busy?: boolean }) {
  const { boundaryProbe, schema } = useScenario();
  const [q, setQ] = useState('');
  const [probing, setProbing] = useState(false);
  const [result, setResult] = useState<{ boundary: string; contacts?: string[] } | null>(null);

  async function submit() {
    const text = q.trim();
    if (!text) return;
    setProbing(true);
    setResult(null);
    try {
      const r = await boundaryProbe(text);
      if (r.boundary !== 'SAFE_TO_EXPLAIN') {
        // HARD STOP: do not call /chat.
        setResult({ boundary: r.boundary, contacts: r.contacts || [] });
        return;
      }
      await onSafeAsk(text);
      setQ('');
    } finally { setProbing(false); }
  }

  return (
    <View style={styles.wrap} testID="ask-wayly-input">
      {result && result.boundary !== 'SAFE_TO_EXPLAIN' && (
        <View style={styles.guardBox} testID="boundary-guard-card">
          <View style={styles.guardLead}>
            <Ionicons name={result.boundary === 'ESCALATE' ? 'warning' : 'information-circle'} size={16} color={result.boundary === 'ESCALATE' ? '#7A2210' : '#0E4D52'} />
            <Text style={[styles.guardTitle, result.boundary === 'ESCALATE' && { color: '#7A2210' }]}>
              {result.boundary === 'ESCALATE' ? 'This needs a real person, fast.' : 'A specialist can answer this best.'}
            </Text>
          </View>
          <Text style={styles.guardBody}>
            Wayly does not give legal or financial advice. Use the contact below, they are free and trained on this exact question.
          </Text>
          {!!schema && <ContactCard boundary={result.boundary as any} contactKeys={result.contacts || []} />}
          <TouchableOpacity onPress={() => setResult(null)} style={styles.dismiss}><Text style={styles.dismissText}>Ask a different question</Text></TouchableOpacity>
        </View>
      )}
      <View style={styles.row}>
        <TextInput
          value={q}
          onChangeText={setQ}
          placeholder={placeholder}
          placeholderTextColor={Colors.textMuted}
          style={styles.input}
          multiline
          editable={!probing && !outerBusy}
          testID="ask-wayly-text"
          accessibilityLabel="Ask Wayly question input"
        />
        <TouchableOpacity onPress={submit} disabled={probing || outerBusy || !q.trim()} style={[styles.send, (probing || outerBusy || !q.trim()) && { opacity: 0.5 }]} testID="ask-wayly-send">
          {probing ? <ActivityIndicator size="small" color="#fff" /> : <Ionicons name="send" size={16} color="#fff" />}
        </TouchableOpacity>
      </View>
      <Text style={styles.legal}>Wayly checks every question and routes legal/financial topics to the right specialist before answering.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 8 },
  row: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  input: { flex: 1, borderWidth: 1, borderColor: Colors.border, borderRadius: 14, padding: 12, fontFamily: Fonts.body, color: Colors.textPrimary, minHeight: 48, maxHeight: 140, backgroundColor: Colors.cardBg },
  send: { width: 44, height: 44, borderRadius: 22, backgroundColor: Colors.brandPrimary, alignItems: 'center', justifyContent: 'center' },
  legal: { ...Type.caption, color: Colors.textMuted, fontSize: 11 },
  guardBox: { borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.border, padding: 12, backgroundColor: 'rgba(14,77,82,0.04)', gap: 8 },
  guardLead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  guardTitle: { ...Type.bodySemi, color: Colors.textPrimary },
  guardBody: { ...Type.body, color: Colors.textSecondary, lineHeight: 22 },
  dismiss: { alignSelf: 'flex-start' },
  dismissText: { color: Colors.brandPrimary, fontFamily: Fonts.bodySemi, fontWeight: '700' },
});
