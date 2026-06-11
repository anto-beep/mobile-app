// LogScenarioSheet — mirrors ScenarioCapture.jsx on web. Type picker grouped
// by category, dynamic payload fields, posts to the events endpoint, shows
// transition outcome inline.
import React, { useMemo, useState } from 'react';
import { Alert, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useScenario } from '../context/ScenarioContext';
import { Colors, Fonts, Radius, Spacing, Type } from '../lib/theme';
import { toast } from './Toast';
import { ContactCard, BoundaryChip } from './Timeline';

type Props = {
  visible: boolean;
  participantId: string;
  participantName?: string;
  onClose: () => void;
  onLogged?: (result: any) => void;
};

export function LogScenarioSheet({ visible, participantId, participantName, onClose, onLogged }: Props) {
  const { schema, logEvent } = useScenario();
  const [eventKey, setEventKey] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [payload, setPayload] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<any>(null);

  const types = schema?.events?.types || [];
  const grouped = useMemo(() => {
    const m: Record<string, typeof types> = {};
    for (const t of types) {
      const k = (t.category || 'other').toString();
      (m[k] = m[k] || []).push(t);
    }
    return Object.entries(m).sort(([a], [b]) => a.localeCompare(b));
  }, [types]);
  const selected = types.find((t) => t.key === eventKey);

  function reset() { setEventKey(null); setNote(''); setPayload({}); setResult(null); setDate(new Date().toISOString().slice(0, 10)); }

  async function submit() {
    if (!eventKey) { Alert.alert('Pick an event type first'); return; }
    setBusy(true);
    try {
      const body: any = { event_type: eventKey, effective_date: date, note: note.trim() || undefined };
      const keys = (selected?.payload_keys || []) as any[];
      if (keys.length > 0) {
        const p: Record<string, any> = {};
        for (const k of keys) {
          const key = typeof k === 'string' ? k : k.key;
          if (payload[key]) p[key] = payload[key];
        }
        if (Object.keys(p).length > 0) body.payload = p;
      }
      const r = await logEvent(participantId, body);
      setResult(r);
      const ts = r?.event?.proposed?.transition_status;
      if (ts === 'blocked') {
        toast.warning('Transition blocked — the engine kept the participant in their current state.', 5500);
      } else if (ts === 'applied') {
        toast.success('Event logged');
      } else {
        toast.success('Event captured');
      }
      onLogged?.(r);
    } catch (e: any) {
      Alert.alert('Could not log event', e?.response?.data?.detail || e?.message || 'Try again');
    } finally { setBusy(false); }
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={20}>
            <View style={styles.handle} />
            <View style={styles.head}>
              <Text style={Type.h3 as any}>Log a scenario</Text>
              <TouchableOpacity onPress={() => { reset(); onClose(); }} hitSlop={10}><Ionicons name="close" size={22} color={Colors.textPrimary} /></TouchableOpacity>
            </View>
            {!!participantName && <Text style={styles.sub}>For {participantName}</Text>}
            <ScrollView style={styles.scroll} keyboardShouldPersistTaps="handled">
              {!eventKey ? (
                <View style={{ gap: 12 }}>
                  <Text style={styles.lbl}>Event type</Text>
                  {grouped.map(([cat, items]) => (
                    <View key={cat} style={{ gap: 6 }}>
                      <Text style={styles.cat}>{cat.toUpperCase()}</Text>
                      <View style={styles.chipWrap}>
                        {items.map((t) => (
                          <TouchableOpacity key={t.key} testID={`event-type-${t.key}`} onPress={() => setEventKey(t.key)} style={styles.chip}>
                            <Text style={styles.chipText}>{t.label}</Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                    </View>
                  ))}
                </View>
              ) : (
                <View style={{ gap: 12 }}>
                  <TouchableOpacity onPress={() => setEventKey(null)} style={styles.backRow} hitSlop={6}>
                    <Ionicons name="arrow-back" size={16} color={Colors.brandPrimary} />
                    <Text style={styles.backText}>Change event type</Text>
                  </TouchableOpacity>
                  <Text style={Type.h3 as any}>{selected?.label}</Text>
                  <Text style={styles.lbl}>Effective date</Text>
                  <TextInput value={date} onChangeText={setDate} placeholder="YYYY-MM-DD" placeholderTextColor={Colors.textMuted} style={styles.input} testID="effective-date" />
                  {(selected?.payload_keys || []).map((k: any) => {
                    const key = typeof k === 'string' ? k : k.key;
                    const label = typeof k === 'string' ? key.replace(/_/g, ' ') : (k.label || key);
                    return (
                      <View key={key} style={{ gap: 4 }}>
                        <Text style={styles.lbl}>{label}</Text>
                        <TextInput
                          value={payload[key] || ''}
                          onChangeText={(v) => setPayload((p) => ({ ...p, [key]: v }))}
                          placeholder={label}
                          placeholderTextColor={Colors.textMuted}
                          style={styles.input}
                          testID={`payload-${key}`}
                        />
                      </View>
                    );
                  })}
                  <Text style={styles.lbl}>Note (optional)</Text>
                  <TextInput value={note} onChangeText={setNote} placeholder="Anything else to capture?" placeholderTextColor={Colors.textMuted} style={[styles.input, { minHeight: 70 }]} multiline testID="event-note" />
                  <TouchableOpacity onPress={submit} disabled={busy} style={[styles.submit, busy && { opacity: 0.6 }]} testID="submit-event">
                    <Text style={styles.submitText}>{busy ? 'Logging…' : 'Log event'}</Text>
                  </TouchableOpacity>
                  {!!result?.event && (
                    <View style={styles.resultBox} testID="event-result">
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                        <Text style={styles.resultLbl}>Status:</Text>
                        <Text style={styles.resultVal}>{result.event.proposed?.transition_status || '—'}</Text>
                        <BoundaryChip boundary={result.event.advice_boundary || 'SAFE_TO_EXPLAIN'} />
                      </View>
                      {!!result.event.proposed?.lifecycle_transition && (
                        <Text style={styles.resultMeta}>Transition: {result.event.proposed.lifecycle_transition}</Text>
                      )}
                      {!!result.event.advice_boundary && result.event.advice_boundary !== 'SAFE_TO_EXPLAIN' && Array.isArray(result.event.route_out_contacts) && result.event.route_out_contacts.length > 0 && (
                        <ContactCard boundary={result.event.advice_boundary} contactKeys={result.event.route_out_contacts} />
                      )}
                    </View>
                  )}
                </View>
              )}
              <View style={{ height: 40 }} />
            </ScrollView>
          </KeyboardAvoidingView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(14,30,32,0.55)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: Colors.cardBg, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: Spacing.lg, paddingBottom: 20, maxHeight: '92%' },
  handle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 999, backgroundColor: '#D3C9BB' },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 10 },
  sub: { ...Type.caption, color: Colors.textSecondary, marginTop: 2 },
  scroll: { marginTop: 10 },
  lbl: { ...Type.caption, color: Colors.textSecondary, fontFamily: Fonts.bodySemi, textTransform: 'uppercase', letterSpacing: 0.6 },
  cat: { ...Type.caption, color: Colors.textMuted, fontFamily: Fonts.bodySemi, marginTop: 4 },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { backgroundColor: 'rgba(14,77,82,0.07)', borderRadius: 9999, paddingHorizontal: 12, paddingVertical: 8 },
  chipText: { color: Colors.brandPrimary, fontFamily: Fonts.bodySemi, fontSize: 13 },
  input: { borderWidth: 1, borderColor: Colors.border, borderRadius: 10, padding: 12, fontFamily: Fonts.body, color: Colors.textPrimary },
  backRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  backText: { color: Colors.brandPrimary, fontFamily: Fonts.bodySemi, fontWeight: '700' },
  submit: { backgroundColor: Colors.brandPrimary, padding: 14, borderRadius: 9999, alignItems: 'center', marginTop: 4 },
  submitText: { color: '#fff', fontFamily: Fonts.bodySemi, fontWeight: '700' },
  resultBox: { backgroundColor: 'rgba(14,77,82,0.05)', borderRadius: 12, padding: 12, gap: 6, marginTop: 4 },
  resultLbl: { fontFamily: Fonts.bodySemi, color: Colors.textPrimary, fontSize: 13 },
  resultVal: { color: Colors.brandPrimary, fontFamily: Fonts.bodySemi, fontWeight: '700' },
  resultMeta: { ...Type.caption, color: Colors.textSecondary },
});
