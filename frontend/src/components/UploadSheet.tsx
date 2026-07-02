// UploadSheet — shared bottom-sheet modal for camera/library/PDF/paste-text + progress
import React, { useState } from 'react';
import {
  Modal,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Pressable,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import {
  uploadFromCamera,
  uploadFromLibrary,
  uploadFromDocument,
  uploadFromText,
  uploadPhrase,
  UploadProgressPhase,
} from '../lib/upload';
import { Fonts, Radius, Spacing } from '../lib/theme';
import type { ColorPalette } from '../lib/theme';
import { useColors } from '../hooks/useColors';
import { useThemedStyles } from '../hooks/useThemedStyles';
import { DupExactModal, DupLogicalSameModal, DupLogicalDiffModal } from './StatementLifecycleModals';

type Props = {
  visible: boolean;
  onClose: () => void;
};

type Mode = 'menu' | 'paste';

export default function UploadSheet({ visible, onClose }: Props) {
  const c = useColors();
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<UploadProgressPhase>('picking');
  const [mode, setMode] = useState<Mode>('menu');
  const [pasted, setPasted] = useState('');

  const reset = () => {
    setMode('menu');
    setPasted('');
    setBusy(false);
  };

  const handleClose = () => {
    if (busy) return;
    reset();
    onClose();
  };

  const [dupExact, setDupExact] = useState<any | null>(null);
  const [dupLogicalSame, setDupLogicalSame] = useState<{ existingId: string } | null>(null);
  const [dupLogicalDiff, setDupLogicalDiff] = useState<{ newId: string } | null>(null);

  const run = async (fn: typeof uploadFromCamera) => {
    setBusy(true);
    setPhase('picking');
    try {
      const result = await fn((p) => setPhase(p));
      // Logical SAME content — file differs but parsed payload is identical.
      // Stash the existing-statement pointer and surface Modal 2a; navigation
      // happens when the user taps "View existing statement".
      if (result.duplicateKind === 'DUPLICATE_LOGICAL_SAME_CONTENT' && result.existingStatementId) {
        setBusy(false);
        setDupLogicalSame({ existingId: result.existingStatementId });
        return;
      }
      // Logical DIFFERENT content — a revision was saved as a new active
      // version. Surface Modal 2b before navigating.
      if (result.duplicateKind === 'DUPLICATE_LOGICAL_DIFFERENT_CONTENT') {
        setBusy(false);
        setDupLogicalDiff({ newId: result.statementId });
        return;
      }
      handleClose();
      router.push(`/statements/${result.statementId}` as any);
    } catch (e: any) {
      setBusy(false);
      if (e?.message === 'cancelled') return;
      // Byte-identical duplicate — surface Modal 1.
      if (e?.code === 'DUPLICATE_EXACT') {
        setDupExact(e.existing || {});
        return;
      }
      Alert.alert('Upload failed', e?.message || 'Please try again.');
    }
  };

  const submitPaste = async () => {
    if (busy) return;
    const trimmed = pasted.trim();
    if (trimmed.length < 10) {
      Alert.alert('Paste a bit more', 'We need at least a few lines of the statement to read it.');
      return;
    }
    setBusy(true);
    setPhase('uploading');
    try {
      const result = await uploadFromText(trimmed, (p) => setPhase(p));
      if (result.duplicateKind === 'DUPLICATE_LOGICAL_SAME_CONTENT' && result.existingStatementId) {
        setBusy(false);
        setDupLogicalSame({ existingId: result.existingStatementId });
        return;
      }
      if (result.duplicateKind === 'DUPLICATE_LOGICAL_DIFFERENT_CONTENT') {
        setBusy(false);
        setDupLogicalDiff({ newId: result.statementId });
        return;
      }
      handleClose();
      router.push(`/statements/${result.statementId}` as any);
    } catch (e: any) {
      setBusy(false);
      if (e?.code === 'DUPLICATE_EXACT') {
        setDupExact(e.existing || {});
        return;
      }
      Alert.alert("Could not decode", e?.message || 'Please try again.');
    }
  };

  const closeAllDupModals = () => { setDupExact(null); setDupLogicalSame(null); setDupLogicalDiff(null); };

  const onDupExactView = () => {
    const id = dupExact?.existing_statement_id;
    closeAllDupModals();
    handleClose();
    if (id) router.push(`/statements/${id}` as any);
  };
  const onDupLogicalSameView = () => {
    const id = dupLogicalSame?.existingId;
    closeAllDupModals();
    handleClose();
    if (id) router.push(`/statements/${id}` as any);
  };
  const onDupLogicalDiffViewNew = () => {
    const id = dupLogicalDiff?.newId;
    closeAllDupModals();
    handleClose();
    if (id) router.push(`/statements/${id}` as any);
  };
  const onDupLogicalDiffViewAudit = () => {
    const id = dupLogicalDiff?.newId;
    closeAllDupModals();
    handleClose();
    if (id) router.push({ pathname: '/statements/[id]/audit-log' as any, params: { id } });
  };

  return (
    <>
    <Modal visible={visible} animationType="slide" transparent onRequestClose={handleClose}>
      <Pressable style={styles.backdrop} onPress={handleClose} />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.kavWrap}
        pointerEvents="box-none"
      >
        <View style={styles.sheet} testID="upload-sheet">
          <View style={styles.handle} />

          {busy ? (
            <View style={styles.progressView} testID="upload-loading-view">
              <ActivityIndicator color={c.brandPrimary} size="large" />
              <Text style={styles.progressTitle}>
                {mode === 'paste' ? 'Reading your text…' : 'Reading your statement…'}
              </Text>
              <Text style={styles.progressBody}>{uploadPhrase(phase)}</Text>
              <Text style={styles.progressHint}>
                {mode === 'paste' ? 'Usually 10 to 30 seconds.' : 'This usually takes 30 to 90 seconds.'}
              </Text>
            </View>
          ) : mode === 'paste' ? (
            <>
              <View style={styles.pasteHeader}>
                <TouchableOpacity
                  onPress={() => setMode('menu')}
                  style={styles.backBtn}
                  testID="paste-back"
                  hitSlop={8}
                >
                  <Ionicons name="chevron-back" size={20} color={c.brandPrimary} />
                </TouchableOpacity>
                <View style={{ flex: 1 }}>
                  <Text style={styles.title}>Paste your statement</Text>
                  <Text style={styles.sub}>Copy the statement text from email or your provider's portal and paste it below.</Text>
                </View>
              </View>

              <ScrollView
                keyboardShouldPersistTaps="handled"
                style={styles.pasteScroll}
                contentContainerStyle={{ paddingBottom: Spacing.md }}
              >
                <TextInput
                  style={styles.pasteInput}
                  multiline
                  value={pasted}
                  onChangeText={setPasted}
                  placeholder={"e.g. HomeCare Plus, Statement May 2026\nPersonal care 14/05 $240.50\nDomestic 18/05 $84.00\nTotal: $504.50"}
                  placeholderTextColor={c.textMuted}
                  textAlignVertical="top"
                  testID="paste-input"
                />
                <Text style={styles.helperText}>{pasted.trim().length} characters · minimum 10</Text>
              </ScrollView>

              <TouchableOpacity
                style={[styles.primaryCta, pasted.trim().length < 10 && { opacity: 0.45 }]}
                onPress={submitPaste}
                disabled={pasted.trim().length < 10}
                testID="paste-submit"
              >
                <Ionicons name="sparkles-outline" size={16} color={c.cream} />
                <Text style={styles.primaryCtaText}>Decode this statement</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={handleClose} testID="paste-cancel" style={styles.cancel}>
                <Text style={styles.cancelText}>Cancel</Text>
              </TouchableOpacity>
            </>
          ) : (
            <>
              <Text style={styles.title}>Drop In A Statement</Text>
              <Text style={styles.sub}>
                Snap a photo of the paper statement, pick a PDF you have saved, or paste the text directly.
              </Text>

              <TouchableOpacity testID="action-take-photo" style={styles.action} onPress={() => run(uploadFromCamera)}>
                <View style={styles.iconWrap}>
                  <Ionicons name="camera-outline" size={22} color={c.brandPrimary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.actionTitle}>Take a photo</Text>
                  <Text style={styles.actionSub}>Best for paper statements</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={c.textMuted} />
              </TouchableOpacity>

              <TouchableOpacity testID="action-pick-library" style={styles.action} onPress={() => run(uploadFromLibrary)}>
                <View style={styles.iconWrap}>
                  <Ionicons name="image-outline" size={22} color={c.brandPrimary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.actionTitle}>Pick from library</Text>
                  <Text style={styles.actionSub}>Use a photo you have already taken</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={c.textMuted} />
              </TouchableOpacity>

              <TouchableOpacity testID="action-upload-pdf" style={styles.action} onPress={() => run(uploadFromDocument)}>
                <View style={styles.iconWrap}>
                  <Ionicons name="document-text-outline" size={22} color={c.brandPrimary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.actionTitle}>Upload a PDF</Text>
                  <Text style={styles.actionSub}>If you have been emailed one</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={c.textMuted} />
              </TouchableOpacity>

              <TouchableOpacity
                testID="action-paste-text"
                style={[styles.action, { marginBottom: Spacing.lg }]}
                onPress={() => setMode('paste')}
              >
                <View style={styles.iconWrap}>
                  <Ionicons name="clipboard-outline" size={22} color={c.brandPrimary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.actionTitle}>Paste text</Text>
                  <Text style={styles.actionSub}>Copy text from email or your provider's portal</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={c.textMuted} />
              </TouchableOpacity>

              <TouchableOpacity onPress={handleClose} testID="upload-sheet-cancel" style={styles.cancel}>
                <Text style={styles.cancelText}>Cancel</Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
    <DupExactModal
      visible={!!dupExact}
      onClose={closeAllDupModals}
      existing={dupExact || undefined}
      onViewExisting={onDupExactView}
    />
    <DupLogicalSameModal
      visible={!!dupLogicalSame}
      onClose={closeAllDupModals}
      existingId={dupLogicalSame?.existingId}
      onViewExisting={onDupLogicalSameView}
    />
    <DupLogicalDiffModal
      visible={!!dupLogicalDiff}
      onClose={closeAllDupModals}
      newId={dupLogicalDiff?.newId}
      onViewNew={onDupLogicalDiffViewNew}
      onViewAudit={onDupLogicalDiffViewAudit}
    />
    </>
  );
}

function makeStyles(c: ColorPalette) { return StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(14, 77, 82, 0.5)' },
  kavWrap: { flex: 1, justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: c.cardBg,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: Spacing.lg,
    paddingBottom: Spacing.xl,
    maxHeight: '92%',
  },
  handle: {
    width: 40, height: 4, backgroundColor: c.border, borderRadius: 2,
    alignSelf: 'center', marginBottom: Spacing.md,
  },
  title: { fontFamily: Fonts.heading, fontSize: 22, color: c.brandPrimary, letterSpacing: -0.3 },
  sub: { fontFamily: Fonts.body, fontSize: 14, color: c.textSecondary, marginTop: 6, marginBottom: Spacing.lg, lineHeight: 20 },
  action: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    paddingVertical: 14, paddingHorizontal: Spacing.md,
    backgroundColor: 'rgba(14, 77, 82, 0.03)',
    borderRadius: Radius.md, marginBottom: Spacing.sm,
  },
  iconWrap: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(183, 121, 31, 0.15)',
    alignItems: 'center', justifyContent: 'center',
  },
  actionTitle: { fontFamily: Fonts.bodySemi, fontSize: 16, color: c.brandPrimary },
  actionSub: { fontFamily: Fonts.body, fontSize: 12, color: c.textSecondary, marginTop: 2 },
  cancel: { alignItems: 'center', paddingVertical: 14 },
  cancelText: { fontFamily: Fonts.bodyMed, fontSize: 15, color: c.textSecondary },
  progressView: { alignItems: 'center', paddingVertical: Spacing.xl, gap: Spacing.md },
  progressTitle: { fontFamily: Fonts.heading, fontSize: 20, color: c.brandPrimary, marginTop: Spacing.sm },
  progressBody: { fontFamily: Fonts.body, fontSize: 15, color: c.textSecondary, textAlign: 'center', paddingHorizontal: Spacing.lg },
  progressHint: { fontFamily: Fonts.body, fontSize: 12, color: c.textMuted, marginTop: Spacing.sm },

  // Paste-mode styles
  pasteHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm, marginBottom: Spacing.md },
  backBtn: {
    width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(14, 77, 82, 0.06)', marginTop: 2,
  },
  pasteScroll: { maxHeight: 280 },
  pasteInput: {
    backgroundColor: 'rgba(14, 77, 82, 0.03)',
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: c.borderSubtle,
    minHeight: 180,
    padding: Spacing.md,
    fontFamily: Fonts.body,
    fontSize: 13,
    color: c.brandPrimary,
    lineHeight: 19,
  },
  helperText: { fontFamily: Fonts.body, fontSize: 11, color: c.textMuted, marginTop: 6 },
  primaryCta: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: c.brandPrimary, borderRadius: Radius.md, paddingVertical: 14, marginTop: Spacing.md,
    minHeight: 48,
  },
  primaryCtaText: { fontFamily: Fonts.bodySemi, fontSize: 15, color: c.cream },
}); }
