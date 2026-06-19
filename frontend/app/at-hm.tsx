// AT & Home mods — assistive tech / home modifications tracker with add composer.
import React, { useCallback, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity, Modal, Pressable,
  ActivityIndicator, RefreshControl, KeyboardAvoidingView, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { Ionicons } from '@expo/vector-icons';
import { useApi } from '../src/lib/useApi';
import { api, extractErrorMessage } from '../src/lib/api';
import BackHeader from '../src/components/BackHeader';
import { toast } from '../src/components/Toast';
import { formatAUDate } from '../src/lib/format';
import { Fonts, Radius, Spacing, formatAUD2 } from '../src/lib/theme';
import type { ColorPalette } from '../src/lib/theme';
import { useColors } from '../src/hooks/useColors';
import { useThemedStyles } from '../src/hooks/useThemedStyles';

type Item = {
  id: string;
  title?: string;
  category?: 'AT' | 'HOME_MOD' | string;
  status?: 'OPEN' | 'QUOTED' | 'APPROVED' | 'INSTALLED' | 'DENIED' | string;
  quote_amount?: number;
  installed_at?: string;
  notes?: string;
  created_at?: string;
};

const STATUS_META: Record<string, { tint: string; label: string }> = {
  OPEN:      { tint: '#6B7C92', label: 'Open' },
  QUOTED:    { tint: '#C8932B', label: 'Quoted' },
  APPROVED:  { tint: '#0E4D52', label: 'Approved' },
  INSTALLED: { tint: '#3A5F37', label: 'Installed' },
  DENIED:    { tint: '#A54030', label: 'Denied' },
};
const CATEGORIES = [
  { value: 'AT', label: 'Assistive tech', icon: 'accessibility-outline' as const },
  { value: 'HOME_MOD', label: 'Home mod', icon: 'home-outline' as const },
];
const STATUSES = ['OPEN', 'QUOTED', 'APPROVED', 'INSTALLED', 'DENIED'] as const;

export default function AtHm() {
  const c = useColors();
  const styles = useThemedStyles(makeStyles);
  const { data, loading, refreshing, refresh } = useApi<{ items: Item[] }>('/at-hm');
  const items = data?.items || [];

  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<Partial<Item>>({ category: 'AT', status: 'OPEN' });

  const save = useCallback(async () => {
    if (!form.title?.trim()) { toast.warning('Add a title.'); return; }
    setBusy(true);
    try {
      await api.post('/at-hm', {
        title: form.title.trim(),
        category: form.category || 'AT',
        status: form.status || 'OPEN',
        quote_amount: form.quote_amount ? Number(form.quote_amount) : undefined,
        notes: (form.notes || '').trim() || undefined,
      });
      setOpen(false);
      setForm({ category: 'AT', status: 'OPEN' });
      await refresh();
      toast.success('Item added.');
    } catch (e) { toast.error(extractErrorMessage(e, "Couldn't save item")); }
    finally { setBusy(false); }
  }, [form, refresh]);

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <BackHeader title="AT & home mods" rightAccessory={(
        <TouchableOpacity onPress={() => setOpen(true)} style={styles.addBtn} testID="at-hm-add">
          <Ionicons name="add" size={16} color="#FFFFFF" />
          <Text style={styles.addBtnText}>Add</Text>
        </TouchableOpacity>
      )} />
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={c.brandPrimary} />}
      >
        <View style={styles.heroRow}>
          <Ionicons name="construct-outline" size={22} color={c.brandPrimary} />
          <Text style={styles.hero}>AT & home mods</Text>
        </View>
        <Text style={styles.subhero}>Track wheelchair fittings, bathroom rails, kitchen mods — anything needing a quote, approval or install date.</Text>

        {loading ? <ActivityIndicator color={c.brandPrimary} style={{ paddingVertical: 32 }} /> :
          items.length === 0 ? (
            <View style={styles.emptyCard}>
              <Ionicons name="construct-outline" size={28} color={c.textMuted} />
              <Text style={styles.emptyTitle}>No items yet</Text>
              <Text style={styles.emptyBody}>Tap &ldquo;Add&rdquo; to log a wheelchair fitting, grab-rail, or any other modification you&apos;re tracking.</Text>
            </View>
          ) : items.map((it) => {
            const m = STATUS_META[(it.status || 'OPEN').toUpperCase()] || STATUS_META.OPEN;
            return (
              <View key={it.id} style={styles.row} testID={`at-hm-${it.id}`}>
                <View style={[styles.bullet, { backgroundColor: 'rgba(14,77,82,0.10)' }]}>
                  <Ionicons name={it.category === 'HOME_MOD' ? 'home-outline' : 'accessibility-outline'} size={16} color={c.brandPrimary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.title} numberOfLines={1}>{it.title || 'Item'}</Text>
                  {!!it.notes && <Text style={styles.note} numberOfLines={2}>{it.notes}</Text>}
                  <Text style={styles.meta}>
                    {it.quote_amount ? `${formatAUD2(it.quote_amount)} · ` : ''}
                    {it.installed_at ? `installed ${formatAUDate(it.installed_at)}` : (it.created_at ? formatAUDate(it.created_at) : '')}
                  </Text>
                </View>
                <View style={[styles.pill, { backgroundColor: `${m.tint}14` }]}>
                  <Text style={[styles.pillText, { color: m.tint }]}>{m.label}</Text>
                </View>
              </View>
            );
          })}
        <View style={{ height: 32 }} />
      </ScrollView>

      <Modal visible={open} animationType="slide" transparent onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => !busy && setOpen(false)} />
        <KeyboardAwareScrollView
          style={styles.sheet}
          contentContainerStyle={{ paddingBottom: 24 }}
          keyboardShouldPersistTaps="handled"
          bottomOffset={24}
          showsVerticalScrollIndicator={false}
        >
            <View style={styles.handle} />
            <Text style={styles.modalTitle}>Add item</Text>

            <Text style={styles.lbl}>Title</Text>
            <TextInput style={styles.input} value={form.title || ''} onChangeText={(t) => setForm((f) => ({ ...f, title: t }))} placeholder="e.g. Bathroom grab-rails" placeholderTextColor={c.textMuted} testID="at-hm-title" />

            <Text style={styles.lbl}>Category</Text>
            <View style={styles.chipRow}>
              {CATEGORIES.map((c) => (
                <TouchableOpacity key={c.value} style={[styles.chip, form.category === c.value && styles.chipActive]} onPress={() => setForm((f) => ({ ...f, category: c.value }))}>
                  <Ionicons name={c.icon} size={12} color={form.category === c.value ? '#FFFFFF' : c.brandPrimary} />
                  <Text style={[styles.chipText, form.category === c.value && styles.chipTextActive]}>{c.label}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={styles.lbl}>Status</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
              {STATUSES.map((s) => (
                <TouchableOpacity key={s} style={[styles.chip, form.status === s && styles.chipActive]} onPress={() => setForm((f) => ({ ...f, status: s }))}>
                  <Text style={[styles.chipText, form.status === s && styles.chipTextActive]}>{STATUS_META[s].label}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            <Text style={styles.lbl}>Quote amount (AUD, optional)</Text>
            <TextInput style={styles.input} value={form.quote_amount ? String(form.quote_amount) : ''} onChangeText={(t) => setForm((f) => ({ ...f, quote_amount: parseFloat(t) || undefined }))} placeholder="e.g. 450" placeholderTextColor={c.textMuted} keyboardType="decimal-pad" testID="at-hm-quote" />

            <Text style={styles.lbl}>Notes (optional)</Text>
            <TextInput style={[styles.input, { minHeight: 70, textAlignVertical: 'top' }]} value={form.notes || ''} onChangeText={(t) => setForm((f) => ({ ...f, notes: t }))} multiline placeholder="Anything to remember?" placeholderTextColor={c.textMuted} testID="at-hm-notes" />

            <TouchableOpacity onPress={save} disabled={busy} style={[styles.cta, busy && { opacity: 0.6 }]} testID="at-hm-save">
              {busy ? <ActivityIndicator color="#FFFFFF" /> : (<>
                <Ionicons name="checkmark" size={14} color="#FFFFFF" />
                <Text style={styles.ctaText}>Add item</Text>
              </>)}
            </TouchableOpacity>
            <TouchableOpacity onPress={() => !busy && setOpen(false)} style={styles.cancel}>
              <Text style={styles.cancelText}>Cancel</Text>
            </TouchableOpacity>
        </KeyboardAwareScrollView>
      </Modal>
    </SafeAreaView>
  );
}

function makeStyles(c: ColorPalette) { return StyleSheet.create({
  safe: { flex: 1, backgroundColor: c.background },
  scroll: { padding: Spacing.md, paddingBottom: 40 },
  heroRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 6 },
  hero: { fontFamily: Fonts.heading, fontSize: 24, color: c.brandPrimary, letterSpacing: -0.3 },
  subhero: { fontFamily: Fonts.body, fontSize: 13, color: c.textSecondary, lineHeight: 19, marginBottom: Spacing.lg },
  addBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, backgroundColor: c.brandPrimary, minHeight: 32 },
  addBtnText: { fontFamily: Fonts.bodySemi, fontSize: 12, color: '#FFFFFF' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: c.cardBg, borderRadius: Radius.md, borderWidth: 1, borderColor: c.borderSubtle, padding: Spacing.md, marginBottom: 6 },
  bullet: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  title: { fontFamily: Fonts.bodySemi, fontSize: 14, color: c.brandPrimary },
  note: { fontFamily: Fonts.body, fontSize: 12, color: c.textPrimary, marginTop: 2 },
  meta: { fontFamily: Fonts.body, fontSize: 11, color: c.textSecondary, marginTop: 3 },
  pill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 },
  pillText: { fontFamily: Fonts.bodySemi, fontSize: 10, letterSpacing: 0.4 },
  emptyCard: { padding: Spacing.lg, alignItems: 'center', gap: 8, backgroundColor: c.cardBg, borderRadius: Radius.md, borderWidth: 1, borderColor: c.borderSubtle },
  emptyTitle: { fontFamily: Fonts.bodySemi, fontSize: 15, color: c.brandPrimary, marginTop: 4 },
  emptyBody: { fontFamily: Fonts.body, fontSize: 12, color: c.textSecondary, textAlign: 'center', lineHeight: 18 },
  // modal
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.45)' },
  sheet: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: c.cardBg, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: Spacing.lg, paddingBottom: 36, maxHeight: '90%' },
  handle: { width: 36, height: 4, borderRadius: 2, backgroundColor: c.border, alignSelf: 'center', marginBottom: Spacing.md },
  modalTitle: { fontFamily: Fonts.heading, fontSize: 22, color: c.brandPrimary, marginBottom: Spacing.sm },
  lbl: { fontFamily: Fonts.bodyMed, fontSize: 12, color: c.brandPrimary, marginTop: 10, marginBottom: 4 },
  input: { fontFamily: Fonts.body, fontSize: 14, color: c.brandPrimary, backgroundColor: c.background, borderRadius: Radius.md, paddingHorizontal: Spacing.md, paddingVertical: 12, borderWidth: 1, borderColor: c.borderSubtle },
  chipRow: { gap: 6, paddingVertical: 4, flexDirection: 'row' },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, backgroundColor: c.background, borderWidth: 1, borderColor: c.borderSubtle, minHeight: 30 },
  chipActive: { backgroundColor: c.brandPrimary, borderColor: c.brandPrimary },
  chipText: { fontFamily: Fonts.bodyMed, fontSize: 12, color: c.brandPrimary },
  chipTextActive: { color: '#FFFFFF' },
  cta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: Spacing.lg, backgroundColor: c.brandPrimary, borderRadius: Radius.md, paddingVertical: 14, minHeight: 50 },
  ctaText: { fontFamily: Fonts.bodySemi, fontSize: 14, color: '#FFFFFF' },
  cancel: { marginTop: 8, alignItems: 'center', paddingVertical: 10 },
  cancelText: { fontFamily: Fonts.bodyMed, fontSize: 13, color: c.textMuted },
}); }
