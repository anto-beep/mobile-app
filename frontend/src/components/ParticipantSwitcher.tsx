// ParticipantSwitcher — the pill + bottom-sheet UI described in section 3 of
// MOBILE_AGENT_DASHBOARD_PROMPT.md.
//
// Pill: coloured 3px left inset (swatch from color_index), small circle with
// the first initial, first name truncated, classification chip ("L4"),
// chevron-down. Tap opens a Modal sliding from the bottom listing every
// active participant. Each row is tappable; selecting one persists the new
// active id and broadcasts via the ParticipantsContext (which bumps
// `participantSig` so screens refetch). Footer: "+ Add a participant" — hidden
// when participants_active >= participants_max.
import React, { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useParticipants } from '../context/ParticipantsContext';
import { Colors, Spacing, Radius, Fonts, Type } from '../lib/theme';
import { swatchForIndex, initialOf, shortFirstName } from '../lib/format';

export function ParticipantSwitcher() {
  const { participants, active, summary, setActive } = useParticipants();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  if (!active) return null;
  const swatch = swatchForIndex(active.color_index);
  const canAddMore =
    summary == null || summary.participants_active < summary.participants_max;
  const collapsed = participants.length <= 1;

  const pill = (
    <View testID="participant-switcher-trigger" style={[styles.pill, { borderLeftColor: swatch }]}>
      <View style={[styles.swatch, { backgroundColor: swatch }]}>
        <Text style={styles.initial}>{initialOf(active.first_name)}</Text>
      </View>
      <Text numberOfLines={1} style={styles.name}>{shortFirstName(active.first_name)}</Text>
      <View style={styles.classChip}>
        <Text style={styles.classText}>L{active.classification}</Text>
      </View>
      {!collapsed && <Ionicons name="chevron-down" size={14} color={Colors.textInverse} />}
    </View>
  );

  if (collapsed) return pill;

  return (
    <>
      <TouchableOpacity activeOpacity={0.8} onPress={() => setOpen(true)} accessibilityRole="button" accessibilityLabel="Switch participant">
        {pill}
      </TouchableOpacity>

      <Modal visible={open} animationType="slide" transparent onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)}>
          <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()} testID="participant-switcher-menu">
            <View style={styles.handle} />
            <View style={styles.sheetHead}>
              <Text style={styles.sheetTitle}>Whose data are you viewing?</Text>
              <TouchableOpacity onPress={() => setOpen(false)} hitSlop={10}>
                <Ionicons name="close" size={22} color={Colors.textPrimary} />
              </TouchableOpacity>
            </View>
            <ScrollView style={styles.list} bounces={false}>
              {participants.map((p) => {
                const sw = swatchForIndex(p.color_index);
                const isActive = p.id === active.id;
                const pending = p.status === 'PENDING_REMOVAL';
                return (
                  <TouchableOpacity
                    key={p.id}
                    testID={`participant-option-${p.id}`}
                    activeOpacity={0.7}
                    onPress={async () => { await setActive(p.id); setOpen(false); }}
                    style={[
                      styles.row,
                      { borderLeftColor: sw },
                      isActive && styles.rowActive,
                    ]}
                  >
                    <View style={[styles.swatchLg, { backgroundColor: sw }]}>
                      <Text style={styles.initialLg}>{initialOf(p.first_name)}</Text>
                    </View>
                    <View style={styles.rowText}>
                      <View style={styles.rowTopLine}>
                        <Text style={styles.rowName}>{`${p.first_name}${p.last_name ? ' ' + p.last_name : ''}`.trim()}</Text>
                        {p.is_primary && <View style={styles.primaryPill}><Text style={styles.primaryPillText}>Primary</Text></View>}
                      </View>
                      <Text style={styles.rowSub}>L{p.classification} · {p.provider_name}</Text>
                      {pending && (
                        <View style={styles.warnRow}>
                          <Ionicons name="alert-circle" size={12} color={Colors.warning} />
                          <Text style={styles.warnText}>Removal pending — back to active in 30 days</Text>
                        </View>
                      )}
                    </View>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
            {canAddMore && (
              <TouchableOpacity
                style={styles.addBtn}
                onPress={() => { setOpen(false); router.push('/settings/plan' as any); }}
              >
                <Ionicons name="add" size={18} color={Colors.brandPrimary} />
                <Text style={styles.addText}>Add a participant</Text>
              </TouchableOpacity>
            )}
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingLeft: 6,
    paddingRight: 10,
    paddingVertical: 4,
    backgroundColor: 'rgba(255,255,255,0.10)',
    borderRadius: 9999,
    borderLeftWidth: 3,
    minHeight: 32,
    maxWidth: 200,
  },
  swatch: {
    width: 22, height: 22, borderRadius: 11,
    alignItems: 'center', justifyContent: 'center',
  },
  initial: { color: '#fff', fontFamily: Fonts.bodySemi, fontSize: 11, fontWeight: '700' },
  name: { color: Colors.textInverse, fontFamily: Fonts.bodyMed, fontSize: 14, maxWidth: 90 },
  classChip: {
    paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6,
    backgroundColor: 'rgba(255,255,255,0.18)',
  },
  classText: { color: Colors.textInverse, fontFamily: Fonts.mono, fontSize: 10, fontWeight: '700' },

  backdrop: { flex: 1, backgroundColor: 'rgba(14,30,32,0.55)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: Colors.cardBg, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingBottom: 30, maxHeight: '85%' },
  handle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 999, backgroundColor: '#D3C9BB', marginTop: 10 },
  sheetHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md },
  sheetTitle: { ...Type.h3, color: Colors.textPrimary },
  list: { paddingHorizontal: Spacing.md },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingHorizontal: 12, paddingVertical: 12, borderLeftWidth: 3, borderRadius: Radius.md, marginBottom: 6 },
  rowActive: { backgroundColor: 'rgba(14,77,82,0.07)' },
  swatchLg: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  initialLg: { color: '#fff', fontFamily: Fonts.bodySemi, fontSize: 15, fontWeight: '700' },
  rowText: { flex: 1 },
  rowTopLine: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  rowName: { ...Type.bodySemi, color: Colors.textPrimary },
  rowSub: { ...Type.caption, color: Colors.textSecondary, marginTop: 2 },
  primaryPill: { backgroundColor: '#F9E5C4', borderRadius: 9999, paddingHorizontal: 8, paddingVertical: 2 },
  primaryPillText: { color: '#5C3D11', fontFamily: Fonts.bodySemi, fontSize: 10, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  warnRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 },
  warnText: { color: Colors.warning, fontFamily: Fonts.body, fontSize: 12 },

  addBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 10, marginHorizontal: Spacing.lg, paddingVertical: 14, borderRadius: 9999, borderWidth: 1.5, borderColor: Colors.brandPrimary },
  addText: { color: Colors.brandPrimary, fontFamily: Fonts.bodySemi, fontWeight: '700', fontSize: 14 },
});
