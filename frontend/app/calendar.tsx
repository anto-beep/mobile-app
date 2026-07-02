// Calendar — mobile parity with /app/calendar on the web app.
//
// Web hero: "CALENDAR" → "Appointments and Home Visits"
// Subhero copy mirrors web verbatim.
//
// Layout:
//   • Header + Add Appointment CTA
//   • Toolbar: Today / Back / Next / Month label / Month-Agenda toggle
//   • Month grid (Mon-Sun) with event dots; tap day → expanded list +
//     "Add to this day" CTA
//   • Agenda view = chronological list of upcoming visits, grouped by day
//
// API (live Wayly backend):
//   GET    /api/visits             → Visit[]
//   POST   /api/visits             → Visit
//   PATCH  /api/visits/{id}        → Visit
//   DELETE /api/visits/{id}
import React, { useCallback, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity, Alert,
  ActivityIndicator, RefreshControl, Modal, Pressable, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { Ionicons } from '@expo/vector-icons';
import { useApi } from '../src/lib/useApi';
import { api, extractErrorMessage } from '../src/lib/api';
import { confirmDestructive } from '../src/lib/confirmDestructive';
import BackHeader from '../src/components/BackHeader';
import { toast } from '../src/components/Toast';
import { Fonts, Radius, Spacing } from '../src/lib/theme';
import type { ColorPalette } from '../src/lib/theme';
import { useColors } from '../src/hooks/useColors';
import { useThemedStyles } from '../src/hooks/useThemedStyles';
import { formatDate } from '../src/lib/formatDate';

type Visit = {
  id: string;
  title?: string;
  starts_at?: string;
  duration_minutes?: number;
  location?: string;
  provider?: string;
  notes?: string;
  kind?: string;
  status?: string;
};

const KIND_OPTIONS: { v: string; l: string; icon: keyof typeof import('@expo/vector-icons').Ionicons.glyphMap }[] = [
  { v: 'appointment', l: 'Appointment',   icon: 'calendar-outline' },
  { v: 'home_visit',  l: 'Home visit',    icon: 'home-outline' },
  { v: 'telehealth',  l: 'Telehealth',    icon: 'videocam-outline' },
  { v: 'assessment',  l: 'Assessment',    icon: 'clipboard-outline' },
  { v: 'other',       l: 'Other',         icon: 'ellipsis-horizontal-outline' },
];
const KIND_LABEL: Record<string, string> = Object.fromEntries(KIND_OPTIONS.map((k) => [k.v, k.l]));

const KIND_TINT: Record<string, string> = {
  appointment: '#0E4D52',
  home_visit:  '#3D8488',
  telehealth:  '#54775A',
  assessment:  '#C8932B',
  other:       '#6B7C92',
};

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const WEEKDAYS = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];

function startOfDay(d: Date) { const x = new Date(d); x.setHours(0,0,0,0); return x; }
function isSameDay(a: Date, b: Date) { return a.getFullYear()===b.getFullYear() && a.getMonth()===b.getMonth() && a.getDate()===b.getDate(); }
function isoDate(d: Date) { return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }

// Build a 6×7 month grid (Mon-Sun start) for the given month anchor.
function buildMonthGrid(anchor: Date): Date[][] {
  const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  // JS: 0=Sun..6=Sat → convert to Mon-start
  const dayOfWeek = (first.getDay() + 6) % 7;
  const start = new Date(first);
  start.setDate(first.getDate() - dayOfWeek);
  const rows: Date[][] = [];
  for (let w = 0; w < 6; w++) {
    const row: Date[] = [];
    for (let d = 0; d < 7; d++) {
      const cur = new Date(start);
      cur.setDate(start.getDate() + (w * 7 + d));
      row.push(cur);
    }
    rows.push(row);
  }
  return rows;
}

type ViewMode = 'month' | 'agenda';

export default function CalendarRoute() {
  const c = useColors();
  const styles = useThemedStyles(makeStyles);
  const { data, loading, refreshing, refresh } = useApi<Visit[] | { visits: Visit[] }>('/visits');
  const visits: Visit[] = useMemo(() => Array.isArray(data) ? data : ((data as any)?.visits || []), [data]);

  const [view, setView] = useState<ViewMode>('month');
  const [anchor, setAnchor] = useState<Date>(startOfDay(new Date()));
  const [selectedDay, setSelectedDay] = useState<Date | null>(startOfDay(new Date()));

  // Composer.
  const [composerOpen, setComposerOpen] = useState(false);
  const [editing, setEditing] = useState<Visit | null>(null);
  const [busy, setBusy] = useState(false);
  const [title, setTitle] = useState('');
  const [kind, setKind] = useState('appointment');
  const [provider, setProvider] = useState('');
  const [location, setLocation] = useState('');
  const [notes, setNotes] = useState('');
  const [date, setDate] = useState<string>(isoDate(new Date()));
  const [time, setTime] = useState<string>('10:00');
  const [duration, setDuration] = useState<string>('60');
  const [kindMenuOpen, setKindMenuOpen] = useState(false);

  // Grouped events by ISO date.
  const eventsByDay = useMemo(() => {
    const map: Record<string, Visit[]> = {};
    for (const v of visits) {
      if (!v.starts_at) continue;
      const d = new Date(v.starts_at);
      if (Number.isNaN(d.getTime())) continue;
      const k = isoDate(d);
      (map[k] = map[k] || []).push(v);
    }
    Object.values(map).forEach((list) => list.sort((a, b) => new Date(a.starts_at!).getTime() - new Date(b.starts_at!).getTime()));
    return map;
  }, [visits]);

  const monthGrid = useMemo(() => buildMonthGrid(anchor), [anchor]);

  // Agenda — next 60 days grouped by ISO date, oldest first.
  const agendaGroups = useMemo(() => {
    const cutoff = startOfDay(new Date()).getTime();
    const upcoming: Visit[] = visits
      .filter((v) => v.starts_at && new Date(v.starts_at).getTime() >= cutoff - 86_400_000)
      .sort((a, b) => new Date(a.starts_at!).getTime() - new Date(b.starts_at!).getTime());
    const map: Record<string, Visit[]> = {};
    for (const v of upcoming) {
      const k = isoDate(new Date(v.starts_at!));
      (map[k] = map[k] || []).push(v);
    }
    return Object.entries(map).map(([iso, list]) => ({ iso, list }));
  }, [visits]);

  // ─── Composer helpers ──────────────────────────────────────────────
  const openAddFor = useCallback((d?: Date) => {
    setEditing(null);
    setTitle(''); setKind('appointment'); setProvider(''); setLocation(''); setNotes('');
    setDuration('60');
    const target = d || selectedDay || new Date();
    setDate(isoDate(target));
    setTime('10:00');
    setComposerOpen(true);
  }, [selectedDay]);

  const openEdit = useCallback((v: Visit) => {
    setEditing(v);
    setTitle(v.title || '');
    setKind(v.kind || 'appointment');
    setProvider(v.provider || '');
    setLocation(v.location || '');
    setNotes(v.notes || '');
    setDuration(String(v.duration_minutes ?? 60));
    if (v.starts_at) {
      const d = new Date(v.starts_at);
      setDate(isoDate(d));
      setTime(`${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`);
    }
    setComposerOpen(true);
  }, []);

  const submit = useCallback(async () => {
    if (!title.trim()) { toast.warning('Add a title first.'); return; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) {
      toast.warning('Date and time must be set.'); return;
    }
    const startsAt = `${date}T${time}:00`;
    const dur = Math.max(5, Math.min(600, parseInt(duration, 10) || 60));
    setBusy(true);
    try {
      const body = {
        title: title.trim(),
        starts_at: startsAt,
        duration_minutes: dur,
        location: location.trim() || null,
        provider: provider.trim() || null,
        notes: notes.trim() || null,
        kind,
      };
      if (editing?.id) {
        await api.patch(`/visits/${editing.id}`, body);
        toast.success('Appointment updated.');
      } else {
        await api.post('/visits', body);
        toast.success('Appointment added.');
      }
      setComposerOpen(false);
      await refresh();
    } catch (e) {
      toast.error(extractErrorMessage(e, "Could not save the appointment"));
    } finally { setBusy(false); }
  }, [title, kind, provider, location, notes, date, time, duration, editing, refresh]);

  const remove = useCallback((v: Visit) => {
    confirmDestructive({
      title: 'Remove this appointment?',
      message: 'It will be archived and removed from the calendar.',
      confirmLabel: 'Remove',
      onConfirm: async () => {
        try { await api.delete(`/visits/${v.id}`); toast.success('Appointment removed.'); await refresh(); }
        catch (e) { toast.error(extractErrorMessage(e, "Could not remove.")); }
      },
    });
  }, [refresh]);

  // Helpers.
  const monthLabel = `${MONTHS[anchor.getMonth()]} ${anchor.getFullYear()}`;
  const today = startOfDay(new Date());
  const selectedISO = selectedDay ? isoDate(selectedDay) : '';
  const selectedEvents = eventsByDay[selectedISO] || [];

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <BackHeader title="Calendar" />
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={c.brandPrimary} />}
      >
        <Text style={styles.eyebrow}>CALENDAR</Text>
        <Text style={styles.hero}>Appointments and Home Visits</Text>
        <Text style={styles.subhero}>Every appointment, home visit, telehealth call and assessment in one place. Tap a day to add something new, or tap an event to view, edit or cancel it.</Text>

        <TouchableOpacity onPress={() => openAddFor()} style={styles.primaryCta} testID="add-appointment">
          <Ionicons name="add" size={16} color="#FFFFFF" />
          <Text style={styles.primaryCtaText}>Add Appointment</Text>
        </TouchableOpacity>

        <View style={styles.toolbar}>
          <View style={styles.toolbarLeft}>
            <TouchableOpacity onPress={() => { setAnchor(startOfDay(new Date())); setSelectedDay(startOfDay(new Date())); }} style={styles.toolBtn} testID="cal-today">
              <Text style={styles.toolBtnText}>Today</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setAnchor(new Date(anchor.getFullYear(), anchor.getMonth() - 1, 1))} style={styles.toolIconBtn} testID="cal-back">
              <Ionicons name="chevron-back" size={16} color={c.brandPrimary} />
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setAnchor(new Date(anchor.getFullYear(), anchor.getMonth() + 1, 1))} style={styles.toolIconBtn} testID="cal-next">
              <Ionicons name="chevron-forward" size={16} color={c.brandPrimary} />
            </TouchableOpacity>
            <Text style={styles.monthLbl}>{monthLabel}</Text>
          </View>
          <View style={styles.viewToggle}>
            {(['month', 'agenda'] as ViewMode[]).map((m) => {
              const active = view === m;
              return (
                <TouchableOpacity key={m} onPress={() => setView(m)} style={[styles.toggleBtn, active && styles.toggleBtnActive]} testID={`cal-view-${m}`}>
                  <Text style={[styles.toggleText, active && styles.toggleTextActive]}>{m === 'month' ? 'Month' : 'Agenda'}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {loading && visits.length === 0 ? (
          <View style={{ paddingVertical: 24, alignItems: 'center' }}><ActivityIndicator color={c.brandPrimary} /></View>
        ) : view === 'month' ? (
          <>
            <View style={styles.monthCard}>
              <View style={styles.weekHeader}>
                {WEEKDAYS.map((wd) => <Text key={wd} style={styles.weekHeaderText}>{wd}</Text>)}
              </View>
              {monthGrid.map((row, ri) => (
                <View key={ri} style={styles.weekRow}>
                  {row.map((d) => {
                    const sameMonth = d.getMonth() === anchor.getMonth();
                    const isToday = isSameDay(d, today);
                    const isSel = selectedDay && isSameDay(d, selectedDay);
                    const events = eventsByDay[isoDate(d)] || [];
                    return (
                      <TouchableOpacity
                        key={d.toISOString()}
                        onPress={() => setSelectedDay(d)}
                        style={[styles.cell, isSel && styles.cellSelected, !sameMonth && styles.cellMuted]}
                        testID={`cell-${isoDate(d)}`}
                      >
                        <Text style={[styles.cellDate, !sameMonth && styles.cellDateMuted, isToday && styles.cellDateToday]}>{d.getDate()}</Text>
                        <View style={styles.dotRow}>
                          {events.slice(0, 3).map((e) => (
                            <View key={e.id} style={[styles.dot, { backgroundColor: KIND_TINT[e.kind || 'other'] || '#0E4D52' }]} />
                          ))}
                          {events.length > 3 && <Text style={styles.dotMore}>+{events.length - 3}</Text>}
                        </View>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              ))}
            </View>

            {selectedDay && (
              <View style={styles.dayPanel}>
                <View style={styles.dayHeadRow}>
                  <Text style={styles.dayTitle}>{formatDate(selectedDay)}</Text>
                  <TouchableOpacity onPress={() => openAddFor(selectedDay)} style={styles.dayAdd} testID="day-add">
                    <Ionicons name="add" size={14} color={c.brandPrimary} />
                    <Text style={styles.dayAddText}>Add to this day</Text>
                  </TouchableOpacity>
                </View>
                {selectedEvents.length === 0 ? (
                  <Text style={styles.emptyDayText}>Nothing scheduled. Tap above to add an appointment.</Text>
                ) : (
                  <View style={{ gap: 8 }}>
                    {selectedEvents.map((e) => <EventCard key={e.id} event={e} styles={styles} c={c} onEdit={() => openEdit(e)} onRemove={() => remove(e)} />)}
                  </View>
                )}
              </View>
            )}
          </>
        ) : (
          // Agenda view.
          agendaGroups.length === 0 ? (
            <View style={styles.empty}>
              <Ionicons name="calendar-outline" size={28} color={c.textMuted} />
              <Text style={styles.emptyTitle}>Nothing upcoming</Text>
              <Text style={styles.emptyBody}>Tap &quot;Add Appointment&quot; to schedule your next visit.</Text>
            </View>
          ) : (
            <View style={{ gap: 12 }}>
              {agendaGroups.map((g) => (
                <View key={g.iso} style={{ gap: 6 }}>
                  <Text style={styles.agendaDate}>{formatDate(g.iso)}</Text>
                  {g.list.map((e) => <EventCard key={e.id} event={e} styles={styles} c={c} onEdit={() => openEdit(e)} onRemove={() => remove(e)} />)}
                </View>
              ))}
            </View>
          )
        )}

        <View style={{ height: 32 }} />
      </ScrollView>

      {/* ─── Composer ─────────────────────────────────────────────── */}
      <Modal visible={composerOpen} animationType="slide" transparent onRequestClose={() => !busy && setComposerOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => !busy && setComposerOpen(false)} />
        <KeyboardAwareScrollView
          style={styles.sheet}
          contentContainerStyle={{ paddingBottom: 32 }}
          keyboardShouldPersistTaps="handled"
          bottomOffset={24}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.handle} />
          <View style={styles.sheetHead}>
            <Text style={styles.sheetTitle}>{editing ? 'Edit Appointment' : 'Add Appointment'}</Text>
            <TouchableOpacity onPress={() => !busy && setComposerOpen(false)} hitSlop={10}>
              <Ionicons name="close" size={22} color={c.textPrimary} />
            </TouchableOpacity>
          </View>

          <Field label="Title">
            <TextInput style={styles.input} value={title} onChangeText={setTitle} placeholder="e.g. GP appointment" placeholderTextColor={c.textMuted} testID="visit-title" />
          </Field>

          <Field label="Type">
            <TouchableOpacity onPress={() => setKindMenuOpen((v) => !v)} style={styles.selectRow} testID="visit-kind-toggle">
              <Text style={styles.selectText}>{KIND_LABEL[kind] || kind}</Text>
              <Ionicons name={kindMenuOpen ? 'chevron-up' : 'chevron-down'} size={16} color={c.textMuted} />
            </TouchableOpacity>
            {kindMenuOpen && (
              <View style={styles.selectMenu}>
                {KIND_OPTIONS.map((opt) => (
                  <TouchableOpacity key={opt.v} onPress={() => { setKind(opt.v); setKindMenuOpen(false); }} style={styles.selectMenuRow}>
                    <Ionicons name={opt.icon} size={14} color={c.brandPrimary} />
                    <Text style={[styles.selectMenuText, { flex: 1 }]}>{opt.l}</Text>
                    {kind === opt.v && <Ionicons name="checkmark" size={16} color={c.brandPrimary} />}
                  </TouchableOpacity>
                ))}
              </View>
            )}
          </Field>

          <View style={styles.row2}>
            <View style={{ flex: 1 }}>
              <Field label="Date">
                <View testID="visit-date">
                  {Platform.OS === 'web' ? (
                    React.createElement('input', {
                      type: 'date',
                      value: date,
                      onChange: (e: any) => setDate(e?.target?.value || ''),
                      'data-testid': 'visit-date-input',
                      name: 'visit_date',
                      style: { fontFamily: 'inherit', fontSize: 14, color: c.textPrimary, background: c.background, borderRadius: 8, padding: '12px 14px', border: `1px solid ${c.borderSubtle}`, outline: 'none', width: '100%', boxSizing: 'border-box', minHeight: 46 },
                    })
                  ) : (
                    <TextInput style={styles.input} value={date} onChangeText={setDate} placeholder="YYYY-MM-DD" placeholderTextColor={c.textMuted} autoCapitalize="none" />
                  )}
                </View>
              </Field>
            </View>
            <View style={{ flex: 1 }}>
              <Field label="Time">
                <View testID="visit-time">
                  {Platform.OS === 'web' ? (
                    React.createElement('input', {
                      type: 'time',
                      value: time,
                      onChange: (e: any) => setTime(e?.target?.value || ''),
                      'data-testid': 'visit-time-input',
                      name: 'visit_time',
                      style: { fontFamily: 'inherit', fontSize: 14, color: c.textPrimary, background: c.background, borderRadius: 8, padding: '12px 14px', border: `1px solid ${c.borderSubtle}`, outline: 'none', width: '100%', boxSizing: 'border-box', minHeight: 46 },
                    })
                  ) : (
                    <TextInput style={styles.input} value={time} onChangeText={setTime} placeholder="HH:MM" placeholderTextColor={c.textMuted} autoCapitalize="none" />
                  )}
                </View>
              </Field>
            </View>
            <View style={{ flex: 1 }}>
              <Field label="Duration (min)">
                <TextInput style={styles.input} value={duration} onChangeText={setDuration} keyboardType="number-pad" placeholder="60" placeholderTextColor={c.textMuted} testID="visit-duration" />
              </Field>
            </View>
          </View>

          <Field label="Provider">
            <TextInput style={styles.input} value={provider} onChangeText={setProvider} placeholder="e.g. Dr Smith, BlueBerry Care" placeholderTextColor={c.textMuted} testID="visit-provider" />
          </Field>
          <Field label="Location">
            <TextInput style={styles.input} value={location} onChangeText={setLocation} placeholder="e.g. 123 King St, or Zoom" placeholderTextColor={c.textMuted} testID="visit-location" />
          </Field>
          <Field label="Notes">
            <TextInput style={[styles.input, { minHeight: 80, textAlignVertical: 'top' }]} value={notes} onChangeText={setNotes} multiline placeholder="Anything worth remembering, bring meds list, etc." placeholderTextColor={c.textMuted} testID="visit-notes" />
          </Field>

          <View style={styles.composerActions}>
            {editing?.id && (
              <TouchableOpacity onPress={() => { setComposerOpen(false); setTimeout(() => remove(editing), 200); }} style={styles.removeBtn} testID="visit-remove">
                <Ionicons name="trash-outline" size={14} color={c.severityAlert} />
                <Text style={styles.removeBtnText}>Remove</Text>
              </TouchableOpacity>
            )}
            <View style={{ flex: 1 }} />
            <TouchableOpacity onPress={() => !busy && setComposerOpen(false)} style={styles.cancelBtn}>
              <Text style={styles.cancelBtnText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={submit} disabled={busy} style={[styles.saveBtn, busy && { opacity: 0.5 }]} testID="visit-save">
              {busy ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.saveBtnText}>{editing ? 'Save' : 'Add'}</Text>}
            </TouchableOpacity>
          </View>
        </KeyboardAwareScrollView>
      </Modal>
    </SafeAreaView>
  );
}

// ──────────────────────────────────────────────────────────────────────────
function EventCard({ event, styles, c, onEdit, onRemove }: {
  event: Visit;
  styles: ReturnType<typeof makeStyles>;
  c: ColorPalette;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const start = event.starts_at ? new Date(event.starts_at) : null;
  const tint = KIND_TINT[event.kind || 'other'] || c.brandPrimary;
  const kindLabel = KIND_LABEL[event.kind || 'appointment'] || (event.kind || 'Appointment');
  const time = start ? `${String(start.getHours()).padStart(2,'0')}:${String(start.getMinutes()).padStart(2,'0')}` : '—';
  return (
    <TouchableOpacity onPress={onEdit} style={styles.eventCard} testID={`event-${event.id}`}>
      <View style={[styles.eventStripe, { backgroundColor: tint }]} />
      <View style={{ flex: 1, gap: 2 }}>
        <View style={styles.eventTopRow}>
          <Text style={styles.eventTitle} numberOfLines={1}>{event.title || 'Appointment'}</Text>
          <Text style={styles.eventTime}>{time}</Text>
        </View>
        <Text style={styles.eventMeta} numberOfLines={1}>
          {kindLabel}
          {event.provider ? ` · ${event.provider}` : ''}
          {event.location ? ` · ${event.location}` : ''}
        </Text>
        {!!event.notes && <Text style={styles.eventNotes} numberOfLines={2}>{event.notes}</Text>}
      </View>
      <TouchableOpacity onPress={onRemove} style={styles.eventRemove} hitSlop={6} testID={`event-remove-${event.id}`}>
        <Ionicons name="close" size={14} color={c.textMuted} />
      </TouchableOpacity>
    </TouchableOpacity>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={{ marginTop: Spacing.sm, gap: 4 }}>
      <Text style={styles.fieldLbl}>{label}</Text>
      {children}
    </View>
  );
}

function makeStyles(c: ColorPalette) { return StyleSheet.create({
  safe: { flex: 1, backgroundColor: c.background },
  scroll: { padding: Spacing.md, paddingBottom: 40 },
  eyebrow: { fontFamily: Fonts.bodySemi, fontSize: 11, color: c.textMuted, letterSpacing: 1.4 },
  hero: { fontFamily: Fonts.heading, fontSize: 26, color: c.brandPrimary, letterSpacing: -0.3, marginTop: 4 },
  subhero: { fontFamily: Fonts.body, fontSize: 13, color: c.textSecondary, lineHeight: 19, marginTop: 6, marginBottom: Spacing.md },
  primaryCta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: c.brandPrimary, paddingHorizontal: 16, paddingVertical: 12, borderRadius: 9999, minHeight: 44, marginBottom: Spacing.md, alignSelf: 'flex-start' },
  primaryCtaText: { fontFamily: Fonts.bodySemi, fontSize: 14, color: '#FFFFFF' },
  toolbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: Spacing.sm, flexWrap: 'wrap' },
  toolbarLeft: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  toolBtn: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 9999, backgroundColor: c.surfaceTint, borderWidth: 1, borderColor: c.borderSubtle },
  toolBtnText: { fontFamily: Fonts.bodySemi, fontSize: 12, color: c.brandPrimary },
  toolIconBtn: { padding: 8, borderRadius: 9999, backgroundColor: c.surfaceTint, borderWidth: 1, borderColor: c.borderSubtle },
  monthLbl: { fontFamily: Fonts.bodySemi, fontSize: 14, color: c.textPrimary, marginLeft: 6 },
  viewToggle: { flexDirection: 'row', backgroundColor: c.surfaceTint, borderRadius: 9999, padding: 2, borderWidth: 1, borderColor: c.borderSubtle },
  toggleBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 9999 },
  toggleBtnActive: { backgroundColor: c.brandPrimary },
  toggleText: { fontFamily: Fonts.bodySemi, fontSize: 12, color: c.brandPrimary },
  toggleTextActive: { color: '#FFFFFF' },
  // Month grid.
  monthCard: { backgroundColor: c.cardBg, borderRadius: Radius.md, borderWidth: 1, borderColor: c.borderSubtle, padding: 6, marginBottom: Spacing.md },
  weekHeader: { flexDirection: 'row', paddingHorizontal: 2, paddingBottom: 4 },
  weekHeaderText: { flex: 1, fontFamily: Fonts.bodySemi, fontSize: 10, color: c.textMuted, textAlign: 'center', letterSpacing: 0.4 },
  weekRow: { flexDirection: 'row' },
  cell: { flex: 1, aspectRatio: 1, padding: 4, borderRadius: 8, alignItems: 'center', justifyContent: 'space-between', margin: 1 },
  cellSelected: { backgroundColor: `${c.brandPrimary}1F` },
  cellMuted: { opacity: 0.4 },
  cellDate: { fontFamily: Fonts.body, fontSize: 12, color: c.textPrimary, alignSelf: 'flex-start' },
  cellDateMuted: { color: c.textMuted },
  cellDateToday: { color: c.brandPrimary, fontFamily: Fonts.bodySemi },
  dotRow: { flexDirection: 'row', gap: 2, alignItems: 'center', alignSelf: 'center', marginBottom: 2 },
  dot: { width: 5, height: 5, borderRadius: 3 },
  dotMore: { fontFamily: Fonts.bodyMed, fontSize: 9, color: c.textMuted, marginLeft: 1 },
  // Day panel.
  dayPanel: { backgroundColor: c.cardBg, borderRadius: Radius.md, borderWidth: 1, borderColor: c.borderSubtle, padding: Spacing.md, gap: Spacing.sm, marginBottom: Spacing.md },
  dayHeadRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  dayTitle: { fontFamily: Fonts.heading, fontSize: 17, color: c.brandPrimary },
  dayAdd: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 9999, borderWidth: 1, borderColor: c.brandPrimary, backgroundColor: c.cardBg },
  dayAddText: { fontFamily: Fonts.bodySemi, fontSize: 12, color: c.brandPrimary },
  emptyDayText: { fontFamily: Fonts.body, fontSize: 13, color: c.textSecondary, fontStyle: 'italic' },
  // Agenda.
  agendaDate: { fontFamily: Fonts.bodySemi, fontSize: 12, color: c.textMuted, letterSpacing: 0.5 },
  // Event card.
  eventCard: { flexDirection: 'row', alignItems: 'flex-start', backgroundColor: c.cardBg, borderRadius: Radius.md, borderWidth: 1, borderColor: c.borderSubtle, overflow: 'hidden' },
  eventStripe: { width: 4, alignSelf: 'stretch' },
  eventTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 6, paddingTop: 10, paddingRight: 10 },
  eventTitle: { fontFamily: Fonts.bodySemi, fontSize: 14, color: c.textPrimary, flex: 1 },
  eventTime: { fontFamily: Fonts.bodyMed, fontSize: 12, color: c.brandPrimary },
  eventMeta: { fontFamily: Fonts.body, fontSize: 12, color: c.textSecondary, paddingHorizontal: 10, paddingBottom: 2 },
  eventNotes: { fontFamily: Fonts.body, fontSize: 12, color: c.textMuted, paddingHorizontal: 10, paddingBottom: 10, lineHeight: 17, fontStyle: 'italic' },
  eventRemove: { padding: 8, alignSelf: 'flex-start' },
  // Empty state.
  empty: { alignItems: 'center', gap: 6, paddingVertical: 24, paddingHorizontal: 8 },
  emptyTitle: { fontFamily: Fonts.bodySemi, fontSize: 15, color: c.brandPrimary, marginTop: 4 },
  emptyBody: { fontFamily: Fonts.body, fontSize: 13, color: c.textSecondary, textAlign: 'center', lineHeight: 19 },
  // Composer.
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.45)' },
  sheet: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: c.cardBg, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: Spacing.lg, paddingBottom: 24, maxHeight: '92%' },
  handle: { width: 36, height: 4, borderRadius: 2, backgroundColor: c.border, alignSelf: 'center', marginBottom: Spacing.md },
  sheetHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: Spacing.sm },
  sheetTitle: { fontFamily: Fonts.heading, fontSize: 22, color: c.brandPrimary },
  row2: { flexDirection: 'row', gap: 8 },
  fieldLbl: { fontFamily: Fonts.bodyMed, fontSize: 12, color: c.textSecondary },
  input: { fontFamily: Fonts.body, fontSize: 14, color: c.textPrimary, backgroundColor: c.background, borderRadius: Radius.md, paddingHorizontal: Spacing.md, paddingVertical: 12, borderWidth: 1, borderColor: c.borderSubtle, minHeight: 46 },
  selectRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: Spacing.md, paddingVertical: 12, backgroundColor: c.background, borderRadius: Radius.md, borderWidth: 1, borderColor: c.borderSubtle, minHeight: 46 },
  selectText: { fontFamily: Fonts.body, fontSize: 14, color: c.textPrimary },
  selectMenu: { backgroundColor: c.background, borderWidth: 1, borderColor: c.borderSubtle, borderRadius: Radius.md, marginTop: 4, overflow: 'hidden' },
  selectMenuRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: Spacing.md, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: c.borderSubtle },
  selectMenuText: { fontFamily: Fonts.body, fontSize: 14, color: c.textPrimary },
  composerActions: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: Spacing.lg },
  removeBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 9999, borderWidth: 1, borderColor: c.severityAlert },
  removeBtnText: { fontFamily: Fonts.bodyMed, fontSize: 12, color: c.severityAlert },
  cancelBtn: { paddingHorizontal: 16, paddingVertical: 12, borderRadius: 9999, borderWidth: 1, borderColor: c.borderSubtle, backgroundColor: c.cardBg },
  cancelBtnText: { fontFamily: Fonts.bodyMed, fontSize: 13, color: c.textSecondary },
  saveBtn: { paddingHorizontal: 18, paddingVertical: 12, borderRadius: 9999, backgroundColor: c.brandPrimary, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  saveBtnText: { fontFamily: Fonts.bodySemi, fontSize: 13, color: '#FFFFFF' },
}); }
