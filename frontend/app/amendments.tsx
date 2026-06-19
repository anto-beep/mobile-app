// Care-Plan Changes (Amendments) — mirror of /app/amendments on the web app.
// Lists amendments raised against providers + a "+ New amendment" composer
// that pre-fills from query params when launched from a statement line item
// (?statement_id=&line_item=&amount=&service=&provider=).
import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  TextInput,
  ScrollView,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { EmptyState, ListCard, ScreenShell } from '../src/components/Screen';
import { useApi } from '../src/lib/useApi';
import { api } from '../src/lib/api';
import { toast } from '../src/components/Toast';
import { formatAUDate } from '../src/lib/format';
import { Colors, Fonts, Radius, Spacing } from '../src/lib/theme';

const KIND_OPTIONS = [
  { value: 'wrong_amount', label: 'Wrong amount' },
  { value: 'service_not_delivered', label: 'Service not delivered' },
  { value: 'wrong_date', label: 'Wrong date' },
  { value: 'duplicate_charge', label: 'Duplicate charge' },
  { value: 'wrong_service', label: 'Wrong service / support item' },
  { value: 'other', label: 'Other' },
];

const STATUS_META: Record<string, { bg: string; fg: string; label: string }> = {
  DRAFT:     { bg: '#E8F0F0', fg: '#0E4D52', label: 'Draft' },
  OPEN:      { bg: '#FAEFD4', fg: '#5C3D11', label: 'Open' },
  IN_REVIEW: { bg: '#E8F0F0', fg: '#0E4D52', label: 'In review' },
  RESOLVED:  { bg: '#E5F0E2', fg: '#3A5F37', label: 'Resolved' },
  REJECTED:  { bg: '#FDE8E2', fg: '#A54030', label: 'Rejected' },
};

const fmtMoney = (v: any) => {
  const n = typeof v === 'number' ? v : parseFloat(v);
  if (!Number.isFinite(n)) return '';
  return `$${n.toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

export default function Amendments() {
  const params = useLocalSearchParams<{
    statement_id?: string;
    line_item?: string;
    amount?: string;
    service?: string;
    provider?: string;
    new?: string;
  }>();
  const { data, loading, refreshing, refresh } = useApi<{ items: any[] }>('/amendments');
  const items = data?.items || [];
  const [composerOpen, setComposerOpen] = useState(false);

  // Auto-open the composer if we landed here from a statement deep-link.
  useEffect(() => {
    if (params.statement_id || params.new === '1') setComposerOpen(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.statement_id, params.new]);

  const sorted = useMemo(
    () => [...items].sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || ''))),
    [items]
  );

  return (
    <ScreenShell
      useBack
      title="Care-Plan Changes"
      subtitle="Statement disputes raised with providers"
      loading={loading}
      onRefresh={refresh}
      refreshing={refreshing}
    >
      {sorted.length === 0 ? (
        <EmptyState
          icon="create-outline"
          title="No amendments in flight"
          body="Raise an amendment from any decoded statement when a charge looks wrong. We'll generate the email to the provider and track the response."
        />
      ) : (
        sorted.map((a) => {
          const status = STATUS_META[String(a.status || 'OPEN').toUpperCase()] || STATUS_META.OPEN;
          return (
            <View key={a.id} style={styles.card} testID={`amendment-card-${a.id}`}>
              <View style={styles.cardRow}>
                <Text style={styles.cardTitle} numberOfLines={2}>
                  {a.subject || a.kind || 'Amendment'}
                </Text>
                <View style={[styles.statusPill, { backgroundColor: status.bg }]}>
                  <Text style={[styles.statusPillText, { color: status.fg }]}>{status.label}</Text>
                </View>
              </View>
              {a.provider && <Text style={styles.cardMeta}>{a.provider}</Text>}
              {(a.original_amount || a.expected_amount) && (
                <Text style={styles.cardMeta}>
                  {a.original_amount ? `Charged ${fmtMoney(a.original_amount)}` : ''}
                  {a.original_amount && a.expected_amount ? ' · ' : ''}
                  {a.expected_amount ? `Expected ${fmtMoney(a.expected_amount)}` : ''}
                </Text>
              )}
              {a.description && (
                <Text style={styles.cardBody} numberOfLines={3}>{a.description}</Text>
              )}
              <Text style={styles.cardFooter}>Raised {formatAUDate(a.created_at)}</Text>
            </View>
          );
        })
      )}

      {/* Floating "+" — opens the composer */}
      <TouchableOpacity
        style={styles.fab}
        onPress={() => setComposerOpen(true)}
        testID="amendments-new-btn"
        accessibilityRole="button"
        accessibilityLabel="Raise a new amendment"
      >
        <Ionicons name="add" size={28} color="#FFFFFF" />
      </TouchableOpacity>

      <ComposerModal
        visible={composerOpen}
        onClose={() => setComposerOpen(false)}
        onCreated={() => { setComposerOpen(false); refresh(); }}
        prefill={{
          statement_id: params.statement_id ? String(params.statement_id) : undefined,
          line_item: params.line_item ? String(params.line_item) : undefined,
          amount: params.amount ? String(params.amount) : undefined,
          service: params.service ? String(params.service) : undefined,
          provider: params.provider ? String(params.provider) : undefined,
        }}
      />
    </ScreenShell>
  );
}

// ── Composer modal ────────────────────────────────────────────────────────
function ComposerModal({
  visible,
  onClose,
  onCreated,
  prefill,
}: {
  visible: boolean;
  onClose: () => void;
  onCreated: () => void;
  prefill: { statement_id?: string; line_item?: string; amount?: string; service?: string; provider?: string };
}) {
  const [kind, setKind] = useState<string>('wrong_amount');
  const [subject, setSubject] = useState('');
  const [provider, setProvider] = useState('');
  const [originalAmount, setOriginalAmount] = useState('');
  const [expectedAmount, setExpectedAmount] = useState('');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Re-prefill whenever the composer opens with new params.
  useEffect(() => {
    if (!visible) return;
    setKind('wrong_amount');
    setSubject(prefill.service ? `${prefill.service} — review` : '');
    setProvider(prefill.provider || '');
    setOriginalAmount(prefill.amount || '');
    setExpectedAmount('');
    setDescription(
      prefill.line_item
        ? `Reviewing line item "${prefill.line_item}" on statement ${prefill.statement_id || ''}. `
        : ''
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, prefill.statement_id, prefill.line_item, prefill.amount, prefill.service, prefill.provider]);

  const submit = async () => {
    if (!subject.trim()) {
      toast.error('Add a short subject for the amendment.');
      return;
    }
    setSubmitting(true);
    try {
      await api.post('/amendments', {
        kind,
        subject: subject.trim(),
        provider: provider.trim() || undefined,
        original_amount: originalAmount ? parseFloat(originalAmount) : undefined,
        expected_amount: expectedAmount ? parseFloat(expectedAmount) : undefined,
        description: description.trim() || undefined,
        statement_id: prefill.statement_id,
        line_item: prefill.line_item,
        status: 'OPEN',
      });
      toast.success('Amendment raised. We\u2019ll track the provider response.');
      onCreated();
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || e?.message || 'Could not raise amendment.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={styles.modalHeader}>
        <TouchableOpacity onPress={onClose} testID="amendment-composer-close" hitSlop={10}>
          <Text style={styles.modalCancel}>Cancel</Text>
        </TouchableOpacity>
        <Text style={styles.modalTitle}>New amendment</Text>
        <TouchableOpacity onPress={submit} disabled={submitting} testID="amendment-composer-submit" hitSlop={10}>
          {submitting ? <ActivityIndicator color={Colors.brandPrimary} /> : <Text style={styles.modalSubmit}>Raise</Text>}
        </TouchableOpacity>
      </View>
      <KeyboardAwareScrollView
        contentContainerStyle={styles.modalBody}
        keyboardShouldPersistTaps="handled"
        bottomOffset={24}
      >
        <Text style={styles.lbl}>Reason</Text>
        <View style={styles.kindGrid}>
          {KIND_OPTIONS.map((k) => (
            <TouchableOpacity
              key={k.value}
              style={[styles.kindPill, kind === k.value && styles.kindPillActive]}
              onPress={() => setKind(k.value)}
              testID={`amendment-kind-${k.value}`}
            >
              <Text style={[styles.kindPillText, kind === k.value && styles.kindPillTextActive]}>{k.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={styles.lbl}>Subject</Text>
        <TextInput
          style={styles.input}
          value={subject}
          onChangeText={setSubject}
          placeholder="e.g. Wrong rate on community access"
          placeholderTextColor={Colors.textMuted}
          testID="amendment-subject"
        />

        <Text style={styles.lbl}>Provider (optional)</Text>
        <TextInput
          style={styles.input}
          value={provider}
          onChangeText={setProvider}
          placeholder="Provider name"
          placeholderTextColor={Colors.textMuted}
          testID="amendment-provider"
        />

        <View style={styles.row2}>
          <View style={{ flex: 1 }}>
            <Text style={styles.lbl}>Charged</Text>
            <TextInput
              style={styles.input}
              value={originalAmount}
              onChangeText={setOriginalAmount}
              placeholder="0.00"
              keyboardType={Platform.OS === 'ios' ? 'decimal-pad' : 'numeric'}
              placeholderTextColor={Colors.textMuted}
              testID="amendment-original-amount"
            />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.lbl}>Expected</Text>
            <TextInput
              style={styles.input}
              value={expectedAmount}
              onChangeText={setExpectedAmount}
              placeholder="0.00"
              keyboardType={Platform.OS === 'ios' ? 'decimal-pad' : 'numeric'}
              placeholderTextColor={Colors.textMuted}
              testID="amendment-expected-amount"
            />
          </View>
        </View>

        <Text style={styles.lbl}>What happened?</Text>
        <TextInput
          style={[styles.input, styles.textarea]}
          value={description}
          onChangeText={setDescription}
          multiline
          numberOfLines={5}
          placeholder="Describe the issue so the provider can find and fix it. Include dates and any reference numbers."
          placeholderTextColor={Colors.textMuted}
          testID="amendment-description"
        />

        {prefill.statement_id && (
          <View style={styles.contextPill}>
            <Ionicons name="link-outline" size={13} color={Colors.brandPrimary} />
            <Text style={styles.contextPillText}>Linked to statement {String(prefill.statement_id).slice(0, 8)}…</Text>
          </View>
        )}
      </KeyboardAwareScrollView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.cardBg,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.borderSubtle,
    padding: Spacing.md,
    marginBottom: Spacing.sm,
  },
  cardRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 },
  cardTitle: { flex: 1, fontFamily: Fonts.bodySemi, fontSize: 15, color: Colors.brandPrimary, lineHeight: 20 },
  cardMeta: { fontFamily: Fonts.body, fontSize: 12, color: Colors.textSecondary, marginTop: 4 },
  cardBody: { fontFamily: Fonts.body, fontSize: 13, color: Colors.textPrimary, marginTop: 6, lineHeight: 18 },
  cardFooter: { fontFamily: Fonts.body, fontSize: 11, color: Colors.textMuted, marginTop: 8 },
  statusPill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 },
  statusPillText: { fontFamily: Fonts.bodySemi, fontSize: 11, letterSpacing: 0.2 },

  fab: {
    position: 'absolute',
    right: Spacing.lg, bottom: Spacing.lg,
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: Colors.brandPrimary,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.2, shadowRadius: 8, elevation: 5,
  },

  modalHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm,
    borderBottomWidth: 1, borderBottomColor: Colors.borderSubtle,
    backgroundColor: Colors.background, minHeight: 52,
  },
  modalTitle: { fontFamily: Fonts.bodySemi, fontSize: 16, color: Colors.brandPrimary },
  modalCancel: { fontFamily: Fonts.body, fontSize: 15, color: Colors.textMuted, minWidth: 60 },
  modalSubmit: { fontFamily: Fonts.bodySemi, fontSize: 15, color: Colors.brandPrimary, minWidth: 60, textAlign: 'right' },
  modalBody: { padding: Spacing.md, paddingBottom: 60, backgroundColor: Colors.background },
  lbl: { fontFamily: Fonts.bodySemi, fontSize: 12, color: Colors.textSecondary, marginTop: Spacing.md, marginBottom: 6, letterSpacing: 0.3 },
  input: {
    backgroundColor: Colors.cardBg, borderRadius: Radius.md,
    borderWidth: 1, borderColor: Colors.borderSubtle,
    paddingHorizontal: 12, paddingVertical: 11, fontSize: 15, color: Colors.textPrimary,
    fontFamily: Fonts.body, minHeight: 44,
  },
  textarea: { minHeight: 100, paddingTop: 11, textAlignVertical: 'top' },
  row2: { flexDirection: 'row', gap: 10 },
  kindGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  kindPill: {
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999,
    backgroundColor: Colors.cardBg, borderWidth: 1, borderColor: Colors.borderSubtle,
  },
  kindPillActive: { backgroundColor: Colors.brandPrimary, borderColor: Colors.brandPrimary },
  kindPillText: { fontFamily: Fonts.bodyMed, fontSize: 12, color: Colors.textSecondary },
  kindPillTextActive: { color: '#FFFFFF', fontFamily: Fonts.bodySemi },
  contextPill: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    marginTop: Spacing.md, paddingHorizontal: 10, paddingVertical: 8,
    backgroundColor: 'rgba(14, 77, 82, 0.06)', borderRadius: Radius.md,
    alignSelf: 'flex-start',
  },
  contextPillText: { fontFamily: Fonts.body, fontSize: 12, color: Colors.brandPrimary },
});
