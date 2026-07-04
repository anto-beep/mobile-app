// Statement Lifecycle Modals — mobile parity with the web client's
// /app/frontend/src/components/statements/StatementLifecycleModals.jsx.
//
// Five modals + two banners drive the entire duplicate / archive /
// permanent-delete flow. The backend already owns every state machine,
// audit-log write and retention sweep — these UI surfaces only reflect /
// confirm what the server tells us.
//
// All copy below is verbatim from Appendix A of the web handoff. DO NOT
// re-word — the parity tests check this text.
import React, { useState, useEffect } from 'react';
import { formatDateTime } from '../../src/lib/formatDate';
import { Modal, View, Text, StyleSheet, TouchableOpacity, TextInput, Pressable, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Fonts, Radius, Spacing } from '../lib/theme';
import type { ColorPalette } from '../lib/theme';
import { useThemedStyles } from '../hooks/useThemedStyles';
import { useColors } from '../hooks/useColors';

type BaseProps = { visible: boolean; onClose: () => void };

// ── Shared layout pieces ─────────────────────────────────────────────────
function ModalShell({ visible, onClose, children, testID }: BaseProps & { children: React.ReactNode; testID?: string }) {
  const c = useColors();
  const styles = useThemedStyles(makeShellStyles);
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityRole="button" accessibilityLabel="Dismiss">
        <Pressable style={styles.card} onPress={() => {}} testID={testID}>
          <TouchableOpacity onPress={onClose} style={styles.closeBtn} hitSlop={10} accessibilityLabel="Close">
            <Ionicons name="close" size={20} color={c.textSecondary} />
          </TouchableOpacity>
          {children}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function ModalHeading({ icon, iconTint, title }: { icon: keyof typeof Ionicons.glyphMap; iconTint: string; title: string }) {
  const styles = useThemedStyles(makeShellStyles);
  return (
    <View style={styles.heading}>
      <View style={[styles.iconWrap, { backgroundColor: iconTint + '1F' }]}>
        <Ionicons name={icon} size={20} color={iconTint} />
      </View>
      <Text style={styles.title} accessibilityRole="header">{title}</Text>
    </View>
  );
}

function PrimaryBtn({ children, onPress, disabled, danger, testID }: { children: React.ReactNode; onPress: () => void; disabled?: boolean; danger?: boolean; testID?: string }) {
  const c = useColors();
  const styles = useThemedStyles(makeShellStyles);
  const bg = danger ? c.brandSecondary : c.brandPrimary;
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled}
      style={[styles.btn, { backgroundColor: bg }, disabled && { opacity: 0.4 }]}
      activeOpacity={0.85}
      testID={testID}
    >
      <Text style={styles.btnText}>{children}</Text>
    </TouchableOpacity>
  );
}

function SecondaryBtn({ children, onPress, testID }: { children: React.ReactNode; onPress: () => void; testID?: string }) {
  const c = useColors();
  const styles = useThemedStyles(makeShellStyles);
  return (
    <TouchableOpacity onPress={onPress} style={[styles.btn, styles.btnSecondary]} activeOpacity={0.85} testID={testID}>
      <Text style={[styles.btnText, { color: c.textPrimary }]}>{children}</Text>
    </TouchableOpacity>
  );
}

// ── 1. Modal — DupExact ───────────────────────────────────────────────
export function DupExactModal({
  visible, onClose, existing, onViewExisting,
}: BaseProps & {
  existing?: { existing_statement_id?: string; existing_filename?: string; existing_period_label?: string; existing_uploaded_at?: string };
  onViewExisting?: () => void;
}) {
  const styles = useThemedStyles(makeShellStyles);
  return (
    <ModalShell visible={visible} onClose={onClose} testID="dup-exact-modal">
      <ModalHeading icon="document-text-outline" iconTint="#0E4D52" title="You have uploaded this statement before" />
      <Text style={styles.body}>
        We compared the file you just dropped in against your history and found it is byte-for-byte identical to one we have already processed. We'd usually wave you through, but since nothing's changed, there is no new work to do.
      </Text>
      {existing?.existing_filename ? (
        <View style={styles.meta}>
          <Text style={styles.metaTitle}>Already in your history</Text>
          {!!existing.existing_filename && <Text style={styles.metaRow}>{existing.existing_filename}</Text>}
          {!!existing.existing_period_label && <Text style={styles.metaRow}>{existing.existing_period_label}</Text>}
          {!!existing.existing_uploaded_at && <Text style={styles.metaRow}>Uploaded {formatDateTime(existing.existing_uploaded_at)}</Text>}
        </View>
      ) : null}
      <View style={styles.actions}>
        <SecondaryBtn onPress={onClose} testID="dup-exact-cancel-btn">Cancel</SecondaryBtn>
        <PrimaryBtn onPress={onViewExisting || onClose} testID="dup-exact-view-existing-btn">View existing statement</PrimaryBtn>
      </View>
    </ModalShell>
  );
}

// ── 2a. Modal — DupLogicalSame ────────────────────────────────────────
export function DupLogicalSameModal({
  visible, onClose, existingId, onViewExisting,
}: BaseProps & { existingId?: string; onViewExisting?: () => void }) {
  const styles = useThemedStyles(makeShellStyles);
  return (
    <ModalShell visible={visible} onClose={onClose} testID="dup-logical-same-modal">
      <ModalHeading icon="copy-outline" iconTint="#0E4D52" title="Looks like the same statement, re-exported" />
      <Text style={styles.body}>
        The file is different on disk, but every line item, total and date is identical to a statement you have already uploaded. Most providers re-generate PDFs with a new timestamp, that's almost certainly what happened here.
      </Text>
      <View style={styles.actions}>
        <SecondaryBtn onPress={onClose}>Cancel</SecondaryBtn>
        <PrimaryBtn onPress={onViewExisting || onClose} testID="dup-logical-same-view-existing-btn">View existing statement</PrimaryBtn>
      </View>
    </ModalShell>
  );
}

// ── 2b. Modal — DupLogicalDiff ────────────────────────────────────────
export function DupLogicalDiffModal({
  visible, onClose, newId, onViewNew, onViewAudit,
}: BaseProps & { newId?: string; onViewNew?: () => void; onViewAudit?: () => void }) {
  const styles = useThemedStyles(makeShellStyles);
  return (
    <ModalShell visible={visible} onClose={onClose} testID="dup-logical-diff-modal">
      <ModalHeading icon="git-branch-outline" iconTint="#0E4D52" title="Looks like a revised statement, saved as a new version" />
      <Text style={styles.body}>
        The period matches a statement you already have, but the numbers do not. We have kept the old version in your audit trail and made this new one your active statement. Any reports or budget calculations now use the revised numbers.
      </Text>
      <View style={styles.actions}>
        <SecondaryBtn onPress={onViewAudit || onClose} testID="dup-logical-diff-view-audit-btn">View audit log</SecondaryBtn>
        <PrimaryBtn onPress={onViewNew || onClose} testID="dup-logical-diff-view-new-btn">View new statement</PrimaryBtn>
      </View>
    </ModalShell>
  );
}

// ── 3. Modal — ArchiveConfirm ─────────────────────────────────────────
export function ArchiveConfirmModal({
  visible, onClose, preview, onConfirm, submitting,
}: BaseProps & {
  preview?: {
    statement_id?: string;
    period_label?: string;
    statement_total_aud?: number;
    has_superseded_versions?: boolean;
    leaves_period_gap?: boolean;
    filename?: string;
  };
  onConfirm: () => void;
  submitting?: boolean;
}) {
  const styles = useThemedStyles(makeShellStyles);
  const gap = !!preview?.leaves_period_gap;
  const showRestoreHint = !!preview?.has_superseded_versions && !gap;
  return (
    <ModalShell visible={visible} onClose={onClose} testID="archive-confirm-modal">
      <ModalHeading icon="archive-outline" iconTint="#C8932B" title="Archive this statement?" />
      <Text style={styles.body}>
        Archiving hides this statement from your dashboard, reports, and AI assistant. You have <Text style={styles.bodyStrong}>30 days</Text> to restore it before it is permanently deleted.
      </Text>
      {preview?.period_label || preview?.filename ? (
        <View style={styles.meta}>
          {!!preview?.period_label && <Text style={styles.metaTitle}>{preview.period_label}</Text>}
          {!!preview?.filename && <Text style={styles.metaRow}>{preview.filename}</Text>}
          {typeof preview?.statement_total_aud === 'number' && (
            <Text style={styles.metaRow}>Total ${preview.statement_total_aud.toFixed(2)} AUD</Text>
          )}
        </View>
      ) : null}
      {gap && (
        <View style={[styles.callout, styles.calloutWarn]} testID="archive-gap-warning">
          <Ionicons name="warning-outline" size={16} color="#A54030" />
          <Text style={styles.calloutText}>
            This is the only active statement for this period. Archiving will leave a gap, your dashboard will show this period as <Text style={styles.bodyStrong}>missing</Text> until you upload another.
          </Text>
        </View>
      )}
      {showRestoreHint && (
        <View style={[styles.callout, styles.calloutInfo]} testID="archive-restore-prior-hint">
          <Ionicons name="information-circle-outline" size={16} color="#0E4D52" />
          <Text style={styles.calloutText}>
            An older version of this period is in your history. After archiving you can restore it from the archived statements page.
          </Text>
        </View>
      )}
      <View style={styles.actions}>
        <SecondaryBtn onPress={onClose} testID="archive-confirm-cancel">Cancel</SecondaryBtn>
        <PrimaryBtn onPress={onConfirm} disabled={submitting} danger testID="archive-confirm-submit">
          {submitting ? 'Archiving…' : 'Archive statement'}
        </PrimaryBtn>
      </View>
    </ModalShell>
  );
}

// ── 4. Modal — PermanentDelete ────────────────────────────────────────
export function PermanentDeleteModal({
  visible, onClose, periodLabel, hasOriginalFile, onDownloadOriginal, onConfirm, submitting,
}: BaseProps & {
  periodLabel: string;
  hasOriginalFile?: boolean;
  onDownloadOriginal?: () => void;
  onConfirm: () => void;
  submitting?: boolean;
}) {
  const c = useColors();
  const styles = useThemedStyles(makeShellStyles);
  const [typed, setTyped] = useState('');
  useEffect(() => { if (visible) setTyped(''); }, [visible]);
  const matches = typed.trim().toLowerCase() === (periodLabel || '').trim().toLowerCase();
  return (
    <ModalShell visible={visible} onClose={onClose} testID="permanent-delete-modal">
      <ModalHeading icon="trash-outline" iconTint="#A54030" title="Permanently Delete This Statement?" />
      <Text style={styles.body}>
        This <Text style={styles.bodyStrong}>cannot be undone</Text>. The file, every line item, and the parsed summary will be removed. We keep an audit-log entry showing that you deleted it, but nothing else.
      </Text>
      {hasOriginalFile && onDownloadOriginal ? (
        <TouchableOpacity onPress={onDownloadOriginal} style={styles.downloadOriginal} testID="permanent-delete-download-original" activeOpacity={0.8}>
          <Ionicons name="download-outline" size={16} color={c.brandPrimary} />
          <Text style={styles.downloadOriginalText}>Download the original file first</Text>
        </TouchableOpacity>
      ) : null}
      <Text style={styles.inputLabel}>
        To confirm, type the period label below: <Text style={styles.bodyStrong}>{periodLabel}</Text>
      </Text>
      <TextInput
        value={typed}
        onChangeText={setTyped}
        style={styles.input}
        placeholder={periodLabel}
        placeholderTextColor={c.textMuted}
        autoCorrect={false}
        autoCapitalize="none"
        testID="permanent-delete-confirm-input"
      />
      <View style={styles.actions}>
        <SecondaryBtn onPress={onClose} testID="permanent-delete-cancel">Cancel</SecondaryBtn>
        <PrimaryBtn onPress={onConfirm} disabled={!matches || submitting} danger testID="permanent-delete-submit">
          {submitting ? 'Deleting…' : 'Permanently Delete'}
        </PrimaryBtn>
      </View>
    </ModalShell>
  );
}

// ── Inline banners ────────────────────────────────────────────────────
export function NeedsReviewBanner({ confidence }: { confidence: number }) {
  const styles = useThemedStyles(makeBannerStyles);
  const pct = Math.round((confidence || 0) * 100);
  return (
    <View style={[styles.banner, styles.bannerWarn]} testID="needs-review-banner">
      <Ionicons name="alert-circle-outline" size={18} color="#A54030" />
      <Text style={styles.bannerText}>
        <Text style={styles.bannerStrong}>Low parsing confidence ({pct}%).</Text> Some line items may be wrong, double-check against the original PDF before relying on this for any decisions.
      </Text>
    </View>
  );
}

export function ArchivedBanner() {
  const styles = useThemedStyles(makeBannerStyles);
  return (
    <View style={[styles.banner, styles.bannerNeutral]} testID="statement-archived-banner">
      <Ionicons name="archive-outline" size={18} color="#0E4D52" />
      <Text style={styles.bannerText}>
        <Text style={styles.bannerStrong}>This statement is archived</Text> and hidden from your dashboard, reports, and AI assistant. Restore it within 30 days to bring it back.
      </Text>
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────
function makeShellStyles(c: ColorPalette) { return StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'center', alignItems: 'center', padding: Spacing.md },
  card: { width: '100%', maxWidth: 520, backgroundColor: c.background, borderRadius: Radius.lg, padding: Spacing.lg, gap: Spacing.md, borderWidth: 1, borderColor: c.border, ...Platform.select({
    ios: { shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 16, shadowOffset: { width: 0, height: 8 } },
    android: { elevation: 8 },
    default: {} as any,
  }) },
  closeBtn: { position: 'absolute', top: 10, right: 10, padding: 6, zIndex: 2 },
  heading: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingRight: 32 },
  iconWrap: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  title: { flex: 1, fontFamily: Fonts.heading, fontSize: 18, lineHeight: 24, color: c.textPrimary, letterSpacing: -0.2 },
  body: { fontFamily: Fonts.body, fontSize: 14, color: c.textPrimary, lineHeight: 21 },
  bodyStrong: { fontFamily: Fonts.bodySemi, fontWeight: '700', color: c.textPrimary },
  meta: { backgroundColor: c.cardBg, borderRadius: Radius.md, padding: Spacing.md, borderWidth: 1, borderColor: c.borderSubtle, gap: 2 },
  metaTitle: { fontFamily: Fonts.bodySemi, fontSize: 13, color: c.textPrimary },
  metaRow: { fontFamily: Fonts.body, fontSize: 12, color: c.textSecondary },
  callout: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, padding: Spacing.md, borderRadius: Radius.md, borderWidth: 1 },
  calloutWarn: { backgroundColor: 'rgba(192,57,43,0.08)', borderColor: 'rgba(192,57,43,0.30)' },
  calloutInfo: { backgroundColor: c.surfaceTint, borderColor: c.borderSubtle },
  calloutText: { flex: 1, fontFamily: Fonts.body, fontSize: 13, color: c.textPrimary, lineHeight: 19 },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: 2, flexWrap: 'wrap' },
  btn: { paddingHorizontal: 14, paddingVertical: 11, borderRadius: 999, minWidth: 110, alignItems: 'center' },
  btnSecondary: { backgroundColor: c.surfaceTint, borderWidth: 1, borderColor: c.borderSubtle },
  btnText: { fontFamily: Fonts.bodySemi, fontSize: 14, color: '#FFFFFF', fontWeight: '700' },
  downloadOriginal: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', backgroundColor: c.surfaceTint, paddingHorizontal: 10, paddingVertical: 8, borderRadius: 999, borderWidth: 1, borderColor: c.borderSubtle },
  downloadOriginalText: { fontFamily: Fonts.bodySemi, fontSize: 12, color: c.brandPrimary },
  inputLabel: { fontFamily: Fonts.body, fontSize: 13, color: c.textPrimary, lineHeight: 19 },
  input: { borderWidth: 1, borderColor: c.border, backgroundColor: c.inputBg, borderRadius: Radius.md, paddingHorizontal: 12, paddingVertical: 10, fontFamily: Fonts.body, fontSize: 14, color: c.textPrimary },
}); }

function makeBannerStyles(c: ColorPalette) { return StyleSheet.create({
  banner: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, padding: Spacing.md, borderRadius: Radius.md, borderWidth: 1, marginBottom: Spacing.md },
  bannerWarn: { backgroundColor: 'rgba(192,57,43,0.08)', borderColor: 'rgba(192,57,43,0.30)' },
  bannerNeutral: { backgroundColor: c.surfaceTint, borderColor: c.borderSubtle },
  bannerText: { flex: 1, fontFamily: Fonts.body, fontSize: 13, color: c.textPrimary, lineHeight: 19 },
  bannerStrong: { fontFamily: Fonts.bodySemi, fontWeight: '700', color: c.textPrimary },
}); }
