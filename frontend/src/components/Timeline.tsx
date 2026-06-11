// Timeline cells + Contact card + Status badge — §6 of handoff.
import React from 'react';
import { Linking, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Colors, Fonts, Radius, Spacing, Type } from '../lib/theme';
import { useScenario } from '../context/ScenarioContext';
import { lifecyclePalette, mapWebPathToNative, severityPalette } from '../lib/scenarioSchema';
import { formatAUDate } from '../lib/format';

function humanise(s: string | null | undefined) {
  if (!s) return '—';
  return s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export function StatusBadge({ state, small }: { state?: string | null; small?: boolean }) {
  if (!state) return null;
  const p = lifecyclePalette(state);
  return (
    <View testID={`lifecycle-badge-${state}`} style={[styles.badge, { backgroundColor: p.bg }, small && styles.badgeSm]}>
      <Text style={[styles.badgeText, { color: p.fg }, small && styles.badgeTextSm]}>{humanise(state)}</Text>
    </View>
  );
}

export function SeverityChip({ severity }: { severity: string }) {
  const p = severityPalette(severity);
  return (
    <View style={[styles.sevChip, { backgroundColor: p.bg, borderColor: p.border }]} testID={`severity-${severity}`}>
      <Text style={[styles.sevChipText, { color: p.fg }]}>{severity.toUpperCase()}</Text>
    </View>
  );
}

export function BoundaryChip({ boundary }: { boundary: string }) {
  if (!boundary || boundary === 'SAFE_TO_EXPLAIN') return null;
  const isEscalate = boundary === 'ESCALATE';
  return (
    <View style={[styles.boundChip, isEscalate ? styles.boundChipEscalate : styles.boundChipRouteOut]} testID={`boundary-${boundary}`}>
      <Ionicons name={isEscalate ? 'warning' : 'information-circle'} size={12} color={isEscalate ? '#7A2210' : '#0E4D52'} />
      <Text style={[styles.boundChipText, { color: isEscalate ? '#7A2210' : '#0E4D52' }]}>{boundary.replace('_', ' ')}</Text>
    </View>
  );
}

export type ContactCardProps = {
  boundary?: 'ROUTE_OUT' | 'ESCALATE';
  contactKeys: string[];
  followUp?: string;
};

export function ContactCard({ boundary = 'ROUTE_OUT', contactKeys, followUp }: ContactCardProps) {
  const { getContacts } = useScenario();
  const contacts = getContacts(contactKeys);
  if (contacts.length === 0) return null;
  const isEscalate = boundary === 'ESCALATE';
  return (
    <View style={[styles.contactCard, isEscalate ? styles.contactCardEscalate : styles.contactCardRouteOut]} testID="contact-card">
      <Text style={[styles.contactLead, { color: isEscalate ? '#7A2210' : '#0E4D52' }]}>
        {isEscalate ? 'Please contact straight away' : 'Where to start'}
      </Text>
      {contacts.map((c) => (
        <View key={c.key} style={styles.contactRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.contactLabel}>{c.label}</Text>
            {!!c.hours && <Text style={styles.contactMeta}>{c.hours}</Text>}
            {!!c.blurb && <Text style={styles.contactBlurb}>{c.blurb}</Text>}
          </View>
          <TouchableOpacity
            testID={`contact-call-${c.key}`}
            onPress={() => Linking.openURL(c.tel_link)}
            style={[styles.callBtn, isEscalate && styles.callBtnEscalate]}
            accessibilityRole="button"
            accessibilityLabel={`Call ${c.label} on ${c.phone}`}
          >
            <Ionicons name="call" size={14} color="#fff" />
            <Text style={styles.callBtnText}>{c.phone}</Text>
          </TouchableOpacity>
        </View>
      ))}
      {!!followUp && <Text style={styles.followUp}>{followUp}</Text>}
    </View>
  );
}

function CellShell({ children, accent }: { children: React.ReactNode; accent?: string }) {
  return (
    <View style={[styles.cell, accent ? { borderLeftColor: accent, borderLeftWidth: 3 } : null]}>
      {children}
    </View>
  );
}

export function EventCell({ item }: { item: { at: string; data: any } }) {
  const { getEventType } = useScenario();
  const data = item.data || {};
  const meta = getEventType(data.event_type);
  const label = meta?.label || humanise(data.event_type);
  const transitionStatus: string | undefined = data?.proposed?.transition_status;
  const blocked = transitionStatus === 'blocked';
  const boundary: string = data?.advice_boundary || 'SAFE_TO_EXPLAIN';
  return (
    <CellShell accent={severityPalette(blocked ? 'medium' : 'low').border}>
      <View style={styles.cellHead}>
        <Ionicons name="flag-outline" size={14} color={Colors.brandPrimary} />
        <Text style={styles.cellKind}>Event</Text>
        <BoundaryChip boundary={boundary} />
        {blocked && (
          <View style={styles.blockedPill} testID="transition-blocked-toast">
            <Text style={styles.blockedText}>Blocked</Text>
          </View>
        )}
        <Text style={styles.cellAt}>{formatAUDate(item.at)}</Text>
      </View>
      <Text style={styles.cellTitle}>{label}</Text>
      {!!data.note && <Text style={styles.cellBody}>{data.note}</Text>}
      {!!data?.payload && Object.keys(data.payload).length > 0 && (
        <View style={styles.payloadBlock}>
          {Object.entries(data.payload).slice(0, 3).map(([k, v]) => (
            <Text key={k} style={styles.payloadLine}><Text style={styles.payloadKey}>{humanise(k)}: </Text>{String(v)}</Text>
          ))}
        </View>
      )}
      {boundary !== 'SAFE_TO_EXPLAIN' && Array.isArray(data?.route_out_contacts) && data.route_out_contacts.length > 0 && (
        <ContactCard boundary={boundary as any} contactKeys={data.route_out_contacts} />
      )}
    </CellShell>
  );
}

export function StateCell({ item }: { item: { at: string; data: any } }) {
  const data = item.data || {};
  return (
    <CellShell accent={Colors.brandPrimary}>
      <View style={styles.cellHead}>
        <Ionicons name="swap-horizontal" size={14} color={Colors.brandPrimary} />
        <Text style={styles.cellKind}>Status changed</Text>
        <Text style={styles.cellAt}>{formatAUDate(item.at)}</Text>
      </View>
      <Text style={styles.cellTitle}>{humanise(data.kind || 'state_change')}</Text>
      <View style={styles.stateRow}>
        <StatusBadge state={data.from_value} small />
        <Ionicons name="arrow-forward" size={14} color={Colors.textMuted} />
        <StatusBadge state={data.to_value} small />
      </View>
    </CellShell>
  );
}

export function AlertCell({ item }: { item: { at: string; data: any } }) {
  const router = useRouter();
  const data = item.data || {};
  const sev = data.severity || 'medium';
  const boundary: string = data.advice_boundary || 'SAFE_TO_EXPLAIN';
  const palette = severityPalette(sev);
  const cta = data.next_action_text || 'Open';
  const dest = mapWebPathToNative(data.next_action_link);
  return (
    <CellShell accent={palette.border}>
      <View style={styles.cellHead}>
        <SeverityChip severity={sev} />
        <BoundaryChip boundary={boundary} />
        <Text style={styles.cellAt}>{formatAUDate(item.at)}</Text>
      </View>
      <Text style={styles.cellTitle}>{data.title || humanise(data.alert_type)}</Text>
      {!!data.body && <Text style={styles.cellBody}>{data.body}</Text>}
      {boundary !== 'SAFE_TO_EXPLAIN' && Array.isArray(data?.route_out_contacts) && data.route_out_contacts.length > 0 && (
        <ContactCard boundary={boundary as any} contactKeys={data.route_out_contacts} />
      )}
      {!!dest && (
        <TouchableOpacity testID={`alert-cta-${data.id || 'x'}`} onPress={() => router.push(dest as any)} style={styles.alertCta}>
          <Text style={styles.alertCtaText}>{cta}</Text>
          <Ionicons name="chevron-forward" size={14} color={Colors.brandPrimary} />
        </TouchableOpacity>
      )}
    </CellShell>
  );
}

export function TimelineCell({ item }: { item: { at: string; type: 'event' | 'state' | 'alert'; data: any } }) {
  if (item.type === 'event') return <EventCell item={item} />;
  if (item.type === 'state') return <StateCell item={item} />;
  return <AlertCell item={item} />;
}

const styles = StyleSheet.create({
  badge: { borderRadius: 9999, paddingHorizontal: 10, paddingVertical: 4, alignSelf: 'flex-start' },
  badgeSm: { paddingHorizontal: 8, paddingVertical: 2 },
  badgeText: { fontFamily: Fonts.bodySemi, fontSize: 12, fontWeight: '700', letterSpacing: 0.3 },
  badgeTextSm: { fontSize: 10 },
  sevChip: { borderRadius: 9999, paddingHorizontal: 8, paddingVertical: 2, borderWidth: 1 },
  sevChipText: { fontFamily: Fonts.bodySemi, fontSize: 10, fontWeight: '700', letterSpacing: 0.6 },
  boundChip: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 9999, paddingHorizontal: 6, paddingVertical: 2 },
  boundChipRouteOut: { backgroundColor: 'rgba(14,77,82,0.08)' },
  boundChipEscalate: { backgroundColor: '#FBE5E0' },
  boundChipText: { fontFamily: Fonts.bodySemi, fontSize: 10, fontWeight: '700', letterSpacing: 0.4, textTransform: 'uppercase' },
  cell: { backgroundColor: Colors.cardBg, borderWidth: 1, borderColor: Colors.border, borderRadius: Radius.lg, padding: Spacing.md, marginHorizontal: Spacing.md, marginBottom: 8 },
  cellHead: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  cellKind: { ...Type.caption, color: Colors.textMuted, fontFamily: Fonts.bodySemi, textTransform: 'uppercase', letterSpacing: 0.6 },
  cellAt: { ...Type.caption, color: Colors.textMuted, marginLeft: 'auto' },
  cellTitle: { ...Type.bodySemi, color: Colors.textPrimary, marginTop: 4 },
  cellBody: { ...Type.body, color: Colors.textSecondary, marginTop: 2, lineHeight: 21 },
  payloadBlock: { marginTop: 6, paddingTop: 6, borderTopWidth: 1, borderTopColor: Colors.border, gap: 2 },
  payloadLine: { ...Type.caption, color: Colors.textSecondary },
  payloadKey: { fontFamily: Fonts.bodySemi },
  stateRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6 },
  blockedPill: { backgroundColor: '#FAEFD4', borderRadius: 9999, paddingHorizontal: 8, paddingVertical: 2 },
  blockedText: { color: '#5C3D11', fontFamily: Fonts.bodySemi, fontSize: 10, fontWeight: '700' },
  alertCta: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 8, alignSelf: 'flex-start' },
  alertCtaText: { color: Colors.brandPrimary, fontFamily: Fonts.bodySemi, fontWeight: '700' },
  contactCard: { marginTop: 10, padding: 10, borderRadius: Radius.md, borderWidth: 1, gap: 8 },
  contactCardRouteOut: { borderColor: Colors.brandPrimary, backgroundColor: 'rgba(14,77,82,0.05)' },
  contactCardEscalate: { borderColor: '#A5512B', borderWidth: 2, backgroundColor: '#FDF3EF' },
  contactLead: { fontFamily: Fonts.bodySemi, fontWeight: '700', letterSpacing: 0.4, textTransform: 'uppercase', fontSize: 11 },
  contactRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  contactLabel: { ...Type.bodySemi, color: Colors.textPrimary },
  contactMeta: { ...Type.caption, color: Colors.textSecondary, marginTop: 2 },
  contactBlurb: { ...Type.caption, color: Colors.textSecondary, marginTop: 4, lineHeight: 17 },
  callBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: Colors.brandPrimary, paddingHorizontal: 10, paddingVertical: 8, borderRadius: 9999 },
  callBtnEscalate: { backgroundColor: '#A5512B' },
  callBtnText: { color: '#fff', fontFamily: Fonts.bodySemi, fontWeight: '700', fontSize: 12 },
  followUp: { ...Type.caption, color: Colors.textSecondary, marginTop: 6, lineHeight: 17 },
});
