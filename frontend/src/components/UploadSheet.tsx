// UploadSheet — shared bottom-sheet modal for camera/library/PDF + progress
import React, { useState } from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Pressable,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import {
  uploadFromCamera,
  uploadFromLibrary,
  uploadFromDocument,
  uploadPhrase,
  UploadProgressPhase,
} from '../lib/upload';
import { Colors, Fonts, Radius, Spacing } from '../lib/theme';

type Props = {
  visible: boolean;
  onClose: () => void;
};

export default function UploadSheet({ visible, onClose }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<UploadProgressPhase>('picking');

  const run = async (fn: typeof uploadFromCamera) => {
    setBusy(true);
    setPhase('picking');
    try {
      const statementId = await fn((p) => setPhase(p));
      // Close sheet and navigate
      onClose();
      setBusy(false);
      router.push(`/statements/${statementId}` as any);
    } catch (e: any) {
      setBusy(false);
      if (e?.message === 'cancelled') return;
      Alert.alert('Upload failed', e?.message || 'Please try again.');
    }
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={() => !busy && onClose()}
    >
      <Pressable style={styles.backdrop} onPress={() => !busy && onClose()} />
      <View style={styles.sheet} testID="upload-sheet">
        <View style={styles.handle} />

        {busy ? (
          <View style={styles.progressView} testID="upload-loading-view">
            <ActivityIndicator color={Colors.brandPrimary} size="large" />
            <Text style={styles.progressTitle}>Reading your statement…</Text>
            <Text style={styles.progressBody}>{uploadPhrase(phase)}</Text>
            <Text style={styles.progressHint}>This usually takes 30–90 seconds.</Text>
          </View>
        ) : (
          <>
            <Text style={styles.title}>Add a statement</Text>
            <Text style={styles.sub}>
              Snap a photo of the paper statement, or pick a PDF you've already saved.
            </Text>

            <TouchableOpacity
              testID="action-take-photo"
              style={styles.action}
              onPress={() => run(uploadFromCamera)}
            >
              <View style={styles.iconWrap}>
                <Ionicons name="camera-outline" size={22} color={Colors.brandPrimary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.actionTitle}>Take a photo</Text>
                <Text style={styles.actionSub}>Best for paper statements</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={Colors.textMuted} />
            </TouchableOpacity>

            <TouchableOpacity
              testID="action-pick-library"
              style={styles.action}
              onPress={() => run(uploadFromLibrary)}
            >
              <View style={styles.iconWrap}>
                <Ionicons name="image-outline" size={22} color={Colors.brandPrimary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.actionTitle}>Pick from library</Text>
                <Text style={styles.actionSub}>Use a photo you've already taken</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={Colors.textMuted} />
            </TouchableOpacity>

            <TouchableOpacity
              testID="action-upload-pdf"
              style={[styles.action, { marginBottom: Spacing.lg }]}
              onPress={() => run(uploadFromDocument)}
            >
              <View style={styles.iconWrap}>
                <Ionicons name="document-text-outline" size={22} color={Colors.brandPrimary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.actionTitle}>Upload a PDF</Text>
                <Text style={styles.actionSub}>If you've been emailed one</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={Colors.textMuted} />
            </TouchableOpacity>

            <TouchableOpacity onPress={onClose} testID="upload-sheet-cancel" style={styles.cancel}>
              <Text style={styles.cancelText}>Cancel</Text>
            </TouchableOpacity>
          </>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(31, 58, 95, 0.5)' },
  sheet: {
    backgroundColor: Colors.cardBg,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: Spacing.lg,
    paddingBottom: Spacing.xl,
  },
  handle: {
    width: 40, height: 4, backgroundColor: Colors.border, borderRadius: 2,
    alignSelf: 'center', marginBottom: Spacing.md,
  },
  title: { fontFamily: Fonts.heading, fontSize: 22, color: Colors.brandPrimary, letterSpacing: -0.3 },
  sub: { fontFamily: Fonts.body, fontSize: 14, color: Colors.textSecondary, marginTop: 6, marginBottom: Spacing.lg },
  action: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    paddingVertical: 14, paddingHorizontal: Spacing.md,
    backgroundColor: 'rgba(31, 58, 95, 0.03)',
    borderRadius: Radius.md, marginBottom: Spacing.sm,
  },
  iconWrap: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(212, 162, 78, 0.15)',
    alignItems: 'center', justifyContent: 'center',
  },
  actionTitle: { fontFamily: Fonts.bodySemi, fontSize: 16, color: Colors.brandPrimary },
  actionSub: { fontFamily: Fonts.body, fontSize: 12, color: Colors.textSecondary, marginTop: 2 },
  cancel: { alignItems: 'center', paddingVertical: 14 },
  cancelText: { fontFamily: Fonts.bodyMed, fontSize: 15, color: Colors.textSecondary },
  progressView: { alignItems: 'center', paddingVertical: Spacing.xl, gap: Spacing.md },
  progressTitle: { fontFamily: Fonts.heading, fontSize: 20, color: Colors.brandPrimary, marginTop: Spacing.sm },
  progressBody: { fontFamily: Fonts.body, fontSize: 15, color: Colors.textSecondary, textAlign: 'center', paddingHorizontal: Spacing.lg },
  progressHint: { fontFamily: Fonts.body, fontSize: 12, color: Colors.textMuted, marginTop: Spacing.sm },
});
