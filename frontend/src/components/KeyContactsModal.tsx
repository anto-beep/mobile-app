// KeyContactsModal — slide-up modal mirroring the web app's Key Contacts panel.
//
// Endpoints (live Wayly backend):
//   GET    /api/participants/{participantId}/contacts            → [Contact[]]
//   POST   /api/participants/{participantId}/contacts            → Contact
//   PATCH  /api/participants/{participantId}/contacts/{id}       → Contact
//   DELETE /api/participants/{participantId}/contacts/{id}
//
// Layout:
//   • Header: "Key Contacts" + close
//   • Subtitle "People to call or coordinate with for {participant}" + Add CTA
//   • Search input
//   • Contacts grouped by `contact_type` (CARE MANAGER, GP, ...)
//   • Each card collapses to avatar + name + role; expands to phone/email/address + Edit/Remove
//   • "Add Contact" opens an inline form (Full Name, Contact Type picker,
//     Role/Title, Organisation, Phone, Email, Address, Notes, Mark primary)
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity, Alert,
  ActivityIndicator, Modal, Pressable, Linking,
} from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { Ionicons } from '@expo/vector-icons';
import { api, extractErrorMessage } from '../lib/api';
import { confirmDestructive } from '../lib/confirmDestructive';
import { toast } from './Toast';
import { Fonts, Radius, Spacing } from '../lib/theme';
import type { ColorPalette } from '../lib/theme';
import { useColors } from '../hooks/useColors';
import { useThemedStyles } from '../hooks/useThemedStyles';
import { initialOf } from '../lib/format';

export type Contact = {
  id: string;
  name?: string;
  full_name?: string; // legacy alias used by some web responses
  kind?: string;
  contact_type?: string; // legacy alias
  role_or_title?: string;
  role?: string; // legacy alias
  organisation?: string;
  organization?: string;
  phone?: string;
  email?: string;
  address?: string;
  notes?: string;
  is_primary?: boolean;
};

const CONTACT_TYPES: { v: string; l: string }[] = [
  { v: 'emergency',            l: 'Emergency' },
  { v: 'gp',                   l: 'GP' },
  { v: 'specialist',           l: 'Specialist' },
  { v: 'care_manager',         l: 'Care Manager' },
  { v: 'provider_coordinator', l: 'Provider' },
  { v: 'allied_health',        l: 'Allied Health' },
  { v: 'pharmacist',           l: 'Pharmacist' },
  { v: 'family',               l: 'Family' },
  { v: 'friend',               l: 'Friend' },
  { v: 'neighbour',            l: 'Neighbour' },
  { v: 'advocate',             l: 'Advocate' },
  { v: 'other',                l: 'Other' },
];

const TYPE_LABEL: Record<string, string> = Object.fromEntries(CONTACT_TYPES.map((t) => [t.v, t.l]));

const GROUP_ORDER: string[] = ['emergency', 'care_manager', 'gp', 'specialist', 'allied_health', 'pharmacist', 'provider_coordinator', 'advocate', 'family', 'friend', 'neighbour', 'other'];

type FormState = {
  name: string;
  kind: string;
  role_or_title: string;
  organisation: string;
  phone: string;
  email: string;
  address: string;
  notes: string;
  is_primary: boolean;
};

const EMPTY_FORM: FormState = {
  name: '', kind: 'gp', role_or_title: '', organisation: '',
  phone: '', email: '', address: '', notes: '', is_primary: false,
};

type Props = {
  visible: boolean;
  onClose: () => void;
  participantId: string;
  participantName: string;
};

export function KeyContactsModal({ visible, onClose, participantId, participantName }: Props) {
  const c = useColors();
  const styles = useThemedStyles(makeStyles);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);

  // Add/Edit composer.
  const [composerOpen, setComposerOpen] = useState(false);
  const [editing, setEditing] = useState<Contact | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [busy, setBusy] = useState(false);
  const [typeMenuOpen, setTypeMenuOpen] = useState(false);

  const load = useCallback(async () => {
    if (!participantId) return;
    setLoading(true);
    try {
      const { data } = await api.get(`/participants/${participantId}/contacts`);
      // Prod returns { contacts: [] }; some legacy endpoints return [].
      const arr: Contact[] = Array.isArray(data) ? data : (data?.contacts || []);
      setContacts(arr);
    } catch (e) {
      // Soft-fail: empty list keeps the panel usable.
      setContacts([]);
    } finally { setLoading(false); }
  }, [participantId]);

  useEffect(() => {
    if (visible) load();
  }, [visible, load]);

  // Group by `kind` (the prod field) using GROUP_ORDER, then alphabetise within group.
  const grouped = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filter = (k: Contact) => {
      if (!q) return true;
      const hay = [k.name, k.full_name, k.role_or_title, k.role, k.organisation, k.organization, k.kind, k.contact_type, k.phone, k.email].filter(Boolean).join(' ').toLowerCase();
      return hay.includes(q);
    };
    const map: Record<string, Contact[]> = {};
    for (const k of contacts.filter(filter)) {
      const key = ((k.kind || k.contact_type) || 'other').toLowerCase();
      (map[key] = map[key] || []).push(k);
    }
    Object.values(map).forEach((list) => list.sort((a, b) => (a.name || a.full_name || '').localeCompare(b.name || b.full_name || '')));
    const ordered: { type: string; label: string; items: Contact[] }[] = [];
    for (const key of GROUP_ORDER) {
      if (map[key]?.length) ordered.push({ type: key, label: (TYPE_LABEL[key] || key).toUpperCase(), items: map[key] });
    }
    for (const key of Object.keys(map)) {
      if (!GROUP_ORDER.includes(key)) ordered.push({ type: key, label: (TYPE_LABEL[key] || key).toUpperCase(), items: map[key] });
    }
    return ordered;
  }, [contacts, query]);

  // ─── composer ─────────────────────────────────────────────────────────
  const openAdd = useCallback(() => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setComposerOpen(true);
  }, []);

  const openEdit = useCallback((k: Contact) => {
    setEditing(k);
    setForm({
      name: k.name || k.full_name || '',
      kind: k.kind || k.contact_type || 'other',
      role_or_title: k.role_or_title || k.role || '',
      organisation: k.organisation || k.organization || '',
      phone: k.phone || '',
      email: k.email || '',
      address: k.address || '',
      notes: k.notes || '',
      is_primary: !!k.is_primary,
    });
    setComposerOpen(true);
  }, []);

  const submit = useCallback(async () => {
    if (!form.name.trim()) { toast.warning('Add a name first.'); return; }
    setBusy(true);
    try {
      // Prod contract: name, kind, role_or_title (omit empty optionals so
      // server-side defaults stay clean and 422s don't reject blank strings).
      const body: any = {
        name: form.name.trim(),
        kind: form.kind,
        is_primary: form.is_primary,
      };
      if (form.role_or_title.trim()) body.role_or_title = form.role_or_title.trim();
      if (form.organisation.trim()) body.organisation = form.organisation.trim();
      if (form.phone.trim())        body.phone = form.phone.trim();
      if (form.email.trim())        body.email = form.email.trim();
      if (form.address.trim())      body.address = form.address.trim();
      if (form.notes.trim())        body.notes = form.notes.trim();
      if (editing?.id) {
        await api.patch(`/participants/${participantId}/contacts/${editing.id}`, body);
        toast.success('Contact updated.');
      } else {
        await api.post(`/participants/${participantId}/contacts`, body);
        toast.success('Contact added.');
      }
      setComposerOpen(false);
      await load();
    } catch (e) {
      toast.error(extractErrorMessage(e, "Could not save the contact"));
    } finally { setBusy(false); }
  }, [form, editing, participantId, load]);

  const remove = useCallback((k: Contact) => {
    confirmDestructive({
      title: 'Remove contact?',
      message: `Remove ${k.name || k.full_name || 'this contact'} from ${participantName}'s key contacts?`,
      confirmLabel: 'Remove',
      onConfirm: async () => {
        try {
          await api.delete(`/participants/${participantId}/contacts/${k.id}`);
          toast.success('Contact removed.');
          await load();
        } catch (e) { toast.error(extractErrorMessage(e, "Could not remove.")); }
      },
    });
  }, [participantId, participantName, load]);

  // ─── render ───────────────────────────────────────────────────────────
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={styles.sheet}>
        <View style={styles.handle} />
        <View style={styles.head}>
          <Text style={styles.title}>Key Contacts</Text>
          <TouchableOpacity onPress={onClose} hitSlop={10} testID="kc-close">
            <Ionicons name="close" size={22} color={c.textPrimary} />
          </TouchableOpacity>
        </View>

        <View style={styles.subRow}>
          <Text style={styles.sub} numberOfLines={2}>
            People to call or coordinate with for <Text style={{ fontFamily: Fonts.bodySemi, color: c.brandPrimary }}>{participantName}</Text>.
          </Text>
          <TouchableOpacity onPress={openAdd} style={styles.addBtn} testID="kc-add">
            <Ionicons name="add" size={14} color="#FFFFFF" />
            <Text style={styles.addBtnText}>Add Contact</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.searchRow}>
          <Ionicons name="search" size={14} color={c.textMuted} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder={`Search contacts for ${participantName}…`}
            placeholderTextColor={c.textMuted}
            style={styles.searchInput}
            testID="kc-search"
          />
        </View>

        {loading && contacts.length === 0 ? (
          <View style={{ paddingVertical: 24, alignItems: 'center' }}>
            <ActivityIndicator color={c.brandPrimary} />
          </View>
        ) : grouped.length === 0 ? (
          <View style={styles.empty}>
            <Ionicons name="people-outline" size={28} color={c.textMuted} />
            <Text style={styles.emptyTitle}>No contacts yet</Text>
            <Text style={styles.emptyBody}>Add the GP, care manager, family and anyone else you might need to reach in a hurry.</Text>
          </View>
        ) : (
          <ScrollView contentContainerStyle={{ paddingBottom: 24 }} keyboardShouldPersistTaps="handled">
            {grouped.map((g) => (
              <View key={g.type} style={{ gap: 8, marginTop: Spacing.sm }}>
                <Text style={styles.groupLbl}>{g.label}</Text>
                {g.items.map((k) => {
                  const open = expanded === k.id;
                  const name = k.name || k.full_name || 'Unnamed contact';
                  const sub = [k.role_or_title || k.role, k.organisation || k.organization].filter(Boolean).join(' · ') || TYPE_LABEL[k.kind || k.contact_type || ''] || '';
                  return (
                    <View key={k.id} style={styles.contactCard}>
                      <TouchableOpacity
                        onPress={() => setExpanded(open ? null : k.id)}
                        style={styles.contactHeader}
                        testID={`kc-row-${k.id}`}
                      >
                        <View style={styles.avatar}><Text style={styles.avatarText}>{initialOf(name)}</Text></View>
                        <View style={{ flex: 1, gap: 2 }}>
                          <Text style={styles.contactName}>{name}</Text>
                          {!!sub && <Text style={styles.contactSub}>{sub}</Text>}
                        </View>
                        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={18} color={c.textMuted} />
                      </TouchableOpacity>
                      {open && (
                        <View style={styles.contactBody}>
                          {!!k.phone && (
                            <TouchableOpacity onPress={() => Linking.openURL(`tel:${k.phone}`)} style={styles.detailRow}>
                              <Ionicons name="call-outline" size={14} color={c.brandPrimary} />
                              <Text style={styles.detailLink}>{k.phone}</Text>
                            </TouchableOpacity>
                          )}
                          {!!k.email && (
                            <TouchableOpacity onPress={() => Linking.openURL(`mailto:${k.email}`)} style={styles.detailRow}>
                              <Ionicons name="mail-outline" size={14} color={c.brandPrimary} />
                              <Text style={styles.detailLink}>{k.email}</Text>
                            </TouchableOpacity>
                          )}
                          {!!k.address && (
                            <View style={styles.detailRow}>
                              <Ionicons name="location-outline" size={14} color={c.brandPrimary} />
                              <Text style={styles.detailText}>{k.address}</Text>
                            </View>
                          )}
                          {!!k.notes && (
                            <Text style={styles.notes}>{k.notes}</Text>
                          )}
                          <View style={styles.actionRow}>
                            <TouchableOpacity onPress={() => openEdit(k)} style={styles.actionBtn} testID={`kc-edit-${k.id}`}>
                              <Ionicons name="create-outline" size={14} color={c.brandPrimary} />
                              <Text style={styles.actionBtnText}>Edit</Text>
                            </TouchableOpacity>
                            <TouchableOpacity onPress={() => remove(k)} style={[styles.actionBtn, { borderColor: c.severityAlert }]} testID={`kc-remove-${k.id}`}>
                              <Ionicons name="trash-outline" size={14} color={c.severityAlert} />
                              <Text style={[styles.actionBtnText, { color: c.severityAlert }]}>Remove</Text>
                            </TouchableOpacity>
                          </View>
                        </View>
                      )}
                    </View>
                  );
                })}
              </View>
            ))}
          </ScrollView>
        )}
      </View>

      {/* ─── Add/Edit Composer ───────────────────────────────────────── */}
      <Modal visible={composerOpen} animationType="slide" transparent onRequestClose={() => !busy && setComposerOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => !busy && setComposerOpen(false)} />
        <KeyboardAwareScrollView
          style={styles.sheet2}
          contentContainerStyle={{ paddingBottom: 24 }}
          keyboardShouldPersistTaps="handled"
          bottomOffset={24}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.handle} />
          <View style={styles.head}>
            <Text style={styles.title}>{editing ? 'Edit Contact' : 'Add Contact'}</Text>
            <TouchableOpacity onPress={() => !busy && setComposerOpen(false)} hitSlop={10}>
              <Ionicons name="close" size={22} color={c.textPrimary} />
            </TouchableOpacity>
          </View>

          <Field label="Full Name">
            <TextInput style={styles.input} value={form.name} onChangeText={(v) => setForm((s) => ({ ...s, name: v }))} placeholder="Their full name" placeholderTextColor={c.textMuted} testID="kc-name" />
          </Field>
          <Field label="Contact Type">
            <TouchableOpacity onPress={() => setTypeMenuOpen((v) => !v)} style={styles.selectRow} testID="kc-type-toggle">
              <Text style={styles.selectText}>{TYPE_LABEL[form.kind] || form.kind}</Text>
              <Ionicons name={typeMenuOpen ? 'chevron-up' : 'chevron-down'} size={16} color={c.textMuted} />
            </TouchableOpacity>
            {typeMenuOpen && (
              <View style={styles.selectMenu}>
                {CONTACT_TYPES.map((t) => (
                  <TouchableOpacity
                    key={t.v}
                    onPress={() => { setForm((s) => ({ ...s, kind: t.v })); setTypeMenuOpen(false); }}
                    style={styles.selectMenuRow}
                  >
                    <Text style={styles.selectMenuText}>{t.l}</Text>
                    {form.kind === t.v && <Ionicons name="checkmark" size={16} color={c.brandPrimary} />}
                  </TouchableOpacity>
                ))}
              </View>
            )}
          </Field>
          <View style={styles.row2}>
            <View style={{ flex: 1 }}>
              <Field label="Role or Title">
                <TextInput style={styles.input} value={form.role_or_title} onChangeText={(v) => setForm((s) => ({ ...s, role_or_title: v }))} placeholder="e.g. Cardiologist, Daughter" placeholderTextColor={c.textMuted} testID="kc-role" />
              </Field>
            </View>
            <View style={{ flex: 1 }}>
              <Field label="Organisation">
                <TextInput style={styles.input} value={form.organisation} onChangeText={(v) => setForm((s) => ({ ...s, organisation: v }))} placeholder="e.g. TechGlove" placeholderTextColor={c.textMuted} testID="kc-org" />
              </Field>
            </View>
          </View>
          <View style={styles.row2}>
            <View style={{ flex: 1 }}>
              <Field label="Phone">
                <TextInput style={styles.input} value={form.phone} onChangeText={(v) => setForm((s) => ({ ...s, phone: v }))} placeholder="04XX XXX XXX" placeholderTextColor={c.textMuted} keyboardType="phone-pad" testID="kc-phone" />
              </Field>
            </View>
            <View style={{ flex: 1 }}>
              <Field label="Email">
                <TextInput style={styles.input} value={form.email} onChangeText={(v) => setForm((s) => ({ ...s, email: v }))} placeholder="name@example.com" placeholderTextColor={c.textMuted} keyboardType="email-address" autoCapitalize="none" testID="kc-email" />
              </Field>
            </View>
          </View>
          <Field label="Address">
            <TextInput style={styles.input} value={form.address} onChangeText={(v) => setForm((s) => ({ ...s, address: v }))} placeholder="Street, Suburb, State" placeholderTextColor={c.textMuted} testID="kc-address" />
          </Field>
          <Field label="Notes">
            <TextInput style={[styles.input, { minHeight: 70, textAlignVertical: 'top' }]} value={form.notes} onChangeText={(v) => setForm((s) => ({ ...s, notes: v }))} multiline placeholder="Anything worth remembering, best time to call, languages, etc." placeholderTextColor={c.textMuted} testID="kc-notes" />
          </Field>

          <TouchableOpacity onPress={() => setForm((s) => ({ ...s, is_primary: !s.is_primary }))} style={styles.checkRow} testID="kc-primary-toggle">
            <Ionicons name={form.is_primary ? 'checkbox' : 'square-outline'} size={20} color={form.is_primary ? c.brandPrimary : c.textMuted} />
            <Text style={styles.checkText}>Mark as primary for this contact type</Text>
          </TouchableOpacity>

          <View style={styles.composerActions}>
            <TouchableOpacity onPress={() => !busy && setComposerOpen(false)} style={styles.cancelBtn}>
              <Text style={styles.cancelBtnText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={submit} disabled={busy} style={[styles.saveBtn, busy && { opacity: 0.5 }]} testID="kc-save">
              {busy ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.saveBtnText}>{editing ? 'Save Contact' : 'Save Contact'}</Text>}
            </TouchableOpacity>
          </View>
        </KeyboardAwareScrollView>
      </Modal>
    </Modal>
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
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.45)' },
  sheet: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: c.cardBg, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: Spacing.lg, paddingBottom: 24, maxHeight: '92%' },
  sheet2: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: c.cardBg, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: Spacing.lg, paddingBottom: 36, maxHeight: '92%' },
  handle: { width: 36, height: 4, borderRadius: 2, backgroundColor: c.border, alignSelf: 'center', marginBottom: Spacing.md },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: Spacing.sm },
  title: { fontFamily: Fonts.heading, fontSize: 22, color: c.brandPrimary },
  subRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: Spacing.sm },
  sub: { fontFamily: Fonts.body, fontSize: 13, color: c.textSecondary, lineHeight: 19, flex: 1 },
  addBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 9999, backgroundColor: c.brandPrimary },
  addBtnText: { fontFamily: Fonts.bodySemi, fontSize: 12, color: '#FFFFFF' },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 9999, backgroundColor: c.background, borderWidth: 1, borderColor: c.borderSubtle, marginBottom: Spacing.sm },
  searchInput: { flex: 1, fontFamily: Fonts.body, fontSize: 14, color: c.textPrimary, padding: 0 },
  empty: { alignItems: 'center', gap: 6, paddingVertical: 24, paddingHorizontal: 8 },
  emptyTitle: { fontFamily: Fonts.bodySemi, fontSize: 15, color: c.brandPrimary, marginTop: 4 },
  emptyBody: { fontFamily: Fonts.body, fontSize: 13, color: c.textSecondary, textAlign: 'center', lineHeight: 19 },
  groupLbl: { fontFamily: Fonts.bodySemi, fontSize: 11, color: c.textMuted, letterSpacing: 1.2 },
  contactCard: { backgroundColor: c.cardBg, borderRadius: Radius.md, borderWidth: 1, borderColor: c.borderSubtle, overflow: 'hidden' },
  contactHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: Spacing.md },
  avatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: c.surfaceTint, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: c.borderSubtle },
  avatarText: { fontFamily: Fonts.bodySemi, fontSize: 13, color: c.brandPrimary },
  contactName: { fontFamily: Fonts.bodySemi, fontSize: 15, color: c.textPrimary },
  contactSub: { fontFamily: Fonts.body, fontSize: 12, color: c.textSecondary },
  contactBody: { padding: Spacing.md, paddingTop: 0, gap: 6, borderTopWidth: 1, borderTopColor: c.borderSubtle, marginTop: 4 },
  detailRow: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 6 },
  detailLink: { fontFamily: Fonts.bodyMed, fontSize: 13, color: c.brandPrimary, flex: 1 },
  detailText: { fontFamily: Fonts.body, fontSize: 13, color: c.textPrimary, flex: 1 },
  notes: { fontFamily: Fonts.body, fontSize: 12, color: c.textSecondary, lineHeight: 18, fontStyle: 'italic' },
  actionRow: { flexDirection: 'row', gap: 8, marginTop: 6 },
  actionBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 9999, borderWidth: 1, borderColor: c.brandPrimary, backgroundColor: c.cardBg },
  actionBtnText: { fontFamily: Fonts.bodySemi, fontSize: 11, color: c.brandPrimary },
  // Composer.
  row2: { flexDirection: 'row', gap: 10 },
  fieldLbl: { fontFamily: Fonts.bodyMed, fontSize: 12, color: c.textSecondary },
  input: { fontFamily: Fonts.body, fontSize: 14, color: c.textPrimary, backgroundColor: c.background, borderRadius: Radius.md, paddingHorizontal: Spacing.md, paddingVertical: 12, borderWidth: 1, borderColor: c.borderSubtle, minHeight: 46 },
  selectRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: Spacing.md, paddingVertical: 12, backgroundColor: c.background, borderRadius: Radius.md, borderWidth: 1, borderColor: c.borderSubtle, minHeight: 46 },
  selectText: { fontFamily: Fonts.body, fontSize: 14, color: c.textPrimary },
  selectMenu: { backgroundColor: c.background, borderWidth: 1, borderColor: c.borderSubtle, borderRadius: Radius.md, marginTop: 4, overflow: 'hidden' },
  selectMenuRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: Spacing.md, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: c.borderSubtle },
  selectMenuText: { fontFamily: Fonts.body, fontSize: 14, color: c.textPrimary },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: Spacing.md },
  checkText: { fontFamily: Fonts.body, fontSize: 13, color: c.textPrimary },
  composerActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: Spacing.lg },
  cancelBtn: { paddingHorizontal: 16, paddingVertical: 12, borderRadius: 9999, borderWidth: 1, borderColor: c.borderSubtle, backgroundColor: c.cardBg },
  cancelBtnText: { fontFamily: Fonts.bodyMed, fontSize: 13, color: c.textSecondary },
  saveBtn: { paddingHorizontal: 16, paddingVertical: 12, borderRadius: 9999, backgroundColor: c.brandPrimary, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  saveBtnText: { fontFamily: Fonts.bodySemi, fontSize: 13, color: '#FFFFFF' },
}); }
