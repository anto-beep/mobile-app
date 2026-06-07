// Document Vault — list + upload + per-doc actions (rename, delete, decode-statement).
import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Modal,
  Pressable,
  TextInput,
  RefreshControl,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import { useFocusEffect, useRouter } from 'expo-router';
import { api, extractErrorMessage } from '../../src/lib/api';
import { Colors, Fonts, Radius, Spacing } from '../../src/lib/theme';
import { toast } from '../../src/components/Toast';
import BackHeader from '../../src/components/BackHeader';
import { useSensitiveScreen } from '../../src/lib/useSensitiveScreen';

type Doc = {
  id: string;
  filename: string;
  content_type: string;
  size_bytes: number;
  category: string;
  title: string;
  notes?: string;
  uploaded_at: string;
};

type VaultResponse = {
  documents: Doc[];
  scope: string;
  limits: { vault_used_bytes: number; vault_remaining_bytes: number; max_file_bytes: number; max_vault_bytes: number };
  categories: string[];
};

const CATEGORY_LABEL: Record<string, string> = {
  assessment: 'Assessment',
  statement: 'Statement',
  care_plan: 'Care plan',
  medical: 'Medical',
  financial: 'Financial',
  legal: 'Legal',
  other: 'Other',
};

const CATEGORY_ICON: Record<string, keyof typeof Ionicons.glyphMap> = {
  assessment: 'clipboard-outline',
  statement: 'receipt-outline',
  care_plan: 'heart-outline',
  medical: 'medkit-outline',
  financial: 'cash-outline',
  legal: 'shield-outline',
  other: 'document-outline',
};

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export default function Documents() {
  const router = useRouter();
  // Phase 6: Document Vault carries care plans, financial docs, medical
  // documents — block screenshot / screen recording.
  useSensitiveScreen();
  const [docs, setDocs] = useState<Doc[]>([]);
  const [vault, setVault] = useState<VaultResponse['limits'] | null>(null);
  const [categories, setCategories] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [picker, setPicker] = useState<{ name: string; uri: string; mime: string; size: number } | null>(null);
  const [pickerCategory, setPickerCategory] = useState('other');
  const [pickerTitle, setPickerTitle] = useState('');
  const [pickerNotes, setPickerNotes] = useState('');
  const [uploading, setUploading] = useState(false);
  const [filter, setFilter] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const { data } = await api.get<VaultResponse>('/documents');
      setDocs(data.documents || []);
      setVault(data.limits);
      setCategories(data.categories);
    } catch (e) {
      toast.error(extractErrorMessage(e, "Couldn't load vault"));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const pickFile = useCallback(async () => {
    try {
      const res = await DocumentPicker.getDocumentAsync({ multiple: false, copyToCacheDirectory: true });
      if (res.canceled) return;
      const asset = res.assets?.[0];
      if (!asset) return;
      setPicker({
        name: asset.name || 'upload',
        uri: asset.uri,
        mime: asset.mimeType || 'application/octet-stream',
        size: asset.size || 0,
      });
      setPickerTitle((asset.name || '').replace(/\.[^.]+$/, ''));
      setPickerCategory('other');
      setPickerNotes('');
    } catch (e) {
      toast.error(extractErrorMessage(e, "Couldn't open the file picker"));
    }
  }, []);

  const submitUpload = useCallback(async () => {
    if (!picker) return;
    setUploading(true);
    try {
      // Build multipart form
      const form = new FormData();
      if (Platform.OS === 'web') {
        const r = await fetch(picker.uri);
        const blob = await r.blob();
        form.append('file', blob as any, picker.name);
      } else {
        form.append('file', { uri: picker.uri, name: picker.name, type: picker.mime } as any);
      }
      form.append('category', pickerCategory);
      form.append('title', pickerTitle || picker.name);
      form.append('notes', pickerNotes);
      await api.post('/documents', form, { headers: { 'Content-Type': 'multipart/form-data' } });
      toast.success('Uploaded.');
      setPicker(null);
      await load();
    } catch (e: any) {
      toast.error(extractErrorMessage(e, "Couldn't upload"));
    } finally {
      setUploading(false);
    }
  }, [picker, pickerCategory, pickerTitle, pickerNotes, load]);

  const removeDoc = useCallback((d: Doc) => {
    const doDelete = async () => {
      try {
        await api.delete(`/documents/${d.id}`);
        toast.success('Deleted.');
        setDocs((xs) => xs.filter((x) => x.id !== d.id));
      } catch (e) {
        toast.error(extractErrorMessage(e, "Couldn't delete"));
      }
    };
    if (Platform.OS === 'web') {
      // eslint-disable-next-line no-alert
      if (typeof window !== 'undefined' && window.confirm(`Delete “${d.title}” permanently?`)) doDelete();
    } else {
      Alert.alert('Delete document?', `${d.title} will be permanently removed.`, [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: doDelete },
      ]);
    }
  }, []);

  const decodeStatement = useCallback(async (d: Doc) => {
    try {
      const { data } = await api.post(`/documents/${d.id}/send-to-decoder`);
      toast.success('Sent to decoder.');
      if (data?.job_id) {
        router.push(`/statements?upload_job=${data.job_id}` as any);
      }
    } catch (e) {
      toast.error(extractErrorMessage(e, "Couldn't decode this statement"));
    }
  }, [router]);

  const filteredDocs = filter ? docs.filter((d) => d.category === filter) : docs;

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <BackHeader title="Document vault" rightAccessory={(
        <TouchableOpacity onPress={pickFile} style={styles.uploadBtn} testID="docs-upload-btn">
          <Ionicons name="cloud-upload-outline" size={16} color={Colors.cream} />
          <Text style={styles.uploadBtnText}>Upload</Text>
        </TouchableOpacity>
      )} />
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={Colors.brandPrimary} />}
      >
        <Text style={styles.overline}>Household</Text>
        <Text style={styles.h1}>Your documents</Text>
        <Text style={styles.sub}>Securely store statements, care plans, assessments and more. Only members of your household can see these.</Text>

        {/* Vault meter */}
        {vault ? (
          <View style={styles.meterCard}>
            <View style={styles.meterRow}>
              <Text style={styles.meterLabel}>Vault used</Text>
              <Text style={styles.meterValue}>{fmtBytes(vault.vault_used_bytes)} <Text style={styles.meterMuted}>of {fmtBytes(vault.max_vault_bytes)}</Text></Text>
            </View>
            <View style={styles.meterTrack}>
              <View style={[styles.meterFill, { width: `${Math.min(100, (vault.vault_used_bytes / vault.max_vault_bytes) * 100)}%` }]} />
            </View>
            <Text style={styles.meterFootnote}>Up to {fmtBytes(vault.max_file_bytes)} per file.</Text>
          </View>
        ) : null}

        {/* Category chips */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
          <TouchableOpacity onPress={() => setFilter(null)} style={[styles.chip, !filter && styles.chipActive]}>
            <Text style={[styles.chipText, !filter && styles.chipTextActive]}>All ({docs.length})</Text>
          </TouchableOpacity>
          {categories.map((c) => {
            const cnt = docs.filter((d) => d.category === c).length;
            if (cnt === 0) return null;
            return (
              <TouchableOpacity key={c} onPress={() => setFilter(c)} style={[styles.chip, filter === c && styles.chipActive]}>
                <Ionicons name={CATEGORY_ICON[c] || 'document-outline'} size={12} color={filter === c ? Colors.cream : Colors.brandPrimary} />
                <Text style={[styles.chipText, filter === c && styles.chipTextActive]}>{CATEGORY_LABEL[c] || c} ({cnt})</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        {/* List */}
        {loading ? (
          <ActivityIndicator color={Colors.brandPrimary} style={{ paddingVertical: 40 }} />
        ) : filteredDocs.length === 0 ? (
          <View style={styles.emptyCard}>
            <Ionicons name="folder-open-outline" size={28} color={Colors.textMuted} />
            <Text style={styles.emptyTitle}>{filter ? `No ${CATEGORY_LABEL[filter] || filter} files yet` : 'Vault is empty'}</Text>
            <Text style={styles.emptyBody}>Tap Upload to add an aged-care assessment, statement, or any other PDF / image. Files stay private to your household.</Text>
            <TouchableOpacity style={styles.emptyCta} onPress={pickFile} testID="docs-empty-upload">
              <Ionicons name="add" size={14} color={Colors.cream} />
              <Text style={styles.emptyCtaText}>Upload your first file</Text>
            </TouchableOpacity>
          </View>
        ) : (
          filteredDocs.map((d) => (
            <View key={d.id} style={styles.docCard}>
              <View style={styles.docHead}>
                <View style={styles.docIcon}>
                  <Ionicons name={CATEGORY_ICON[d.category] || 'document-outline'} size={18} color={Colors.brandPrimary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.docTitle} numberOfLines={1}>{d.title || d.filename}</Text>
                  <Text style={styles.docMeta}>
                    {CATEGORY_LABEL[d.category] || d.category} · {fmtBytes(d.size_bytes)} · {new Date(d.uploaded_at).toLocaleDateString()}
                  </Text>
                  {d.notes ? <Text style={styles.docNotes} numberOfLines={2}>{d.notes}</Text> : null}
                </View>
              </View>
              <View style={styles.docActions}>
                {d.category === 'statement' ? (
                  <TouchableOpacity style={styles.miniBtn} onPress={() => decodeStatement(d)} testID={`doc-decode-${d.id}`}>
                    <Ionicons name="sparkles-outline" size={12} color={Colors.brandPrimary} />
                    <Text style={styles.miniBtnText}>Decode</Text>
                  </TouchableOpacity>
                ) : null}
                <TouchableOpacity style={[styles.miniBtn, styles.miniBtnGhost]} onPress={() => removeDoc(d)} testID={`doc-delete-${d.id}`}>
                  <Ionicons name="trash-outline" size={12} color={Colors.danger} />
                  <Text style={[styles.miniBtnText, { color: Colors.danger }]}>Delete</Text>
                </TouchableOpacity>
              </View>
            </View>
          ))
        )}

        <View style={{ height: 40 }} />
      </ScrollView>

      {/* Upload sheet modal */}
      <Modal visible={!!picker} animationType="slide" transparent onRequestClose={() => setPicker(null)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
          <Pressable style={styles.modalBackdrop} onPress={() => !uploading && setPicker(null)} />
          <View style={styles.modalCard}>
            <View style={styles.modalHandle} />
            <Text style={styles.modalTitle}>Upload to vault</Text>
            <Text style={styles.modalSub}>{picker?.name} · {fmtBytes(picker?.size || 0)}</Text>

            <Text style={styles.label}>Category</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
              {categories.map((c) => (
                <TouchableOpacity key={c} onPress={() => setPickerCategory(c)} style={[styles.chip, pickerCategory === c && styles.chipActive]}>
                  <Ionicons name={CATEGORY_ICON[c] || 'document-outline'} size={12} color={pickerCategory === c ? Colors.cream : Colors.brandPrimary} />
                  <Text style={[styles.chipText, pickerCategory === c && styles.chipTextActive]}>{CATEGORY_LABEL[c]}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            <Text style={styles.label}>Title</Text>
            <TextInput value={pickerTitle} onChangeText={setPickerTitle} placeholder="e.g. Margaret's April statement" placeholderTextColor={Colors.textMuted} style={styles.input} testID="docs-upload-title" />

            <Text style={styles.label}>Notes (optional)</Text>
            <TextInput value={pickerNotes} onChangeText={setPickerNotes} placeholder="Why is this important?" placeholderTextColor={Colors.textMuted} multiline numberOfLines={2} style={[styles.input, { minHeight: 60, textAlignVertical: 'top' }]} testID="docs-upload-notes" />

            <TouchableOpacity onPress={submitUpload} disabled={uploading} style={[styles.modalCta, uploading && { opacity: 0.6 }]} testID="docs-upload-submit">
              {uploading ? <ActivityIndicator color={Colors.cream} /> : (
                <>
                  <Ionicons name="cloud-upload" size={14} color={Colors.cream} />
                  <Text style={styles.modalCtaText}>Upload to vault</Text>
                </>
              )}
            </TouchableOpacity>
            <TouchableOpacity onPress={() => !uploading && setPicker(null)} style={styles.modalCancel}>
              <Text style={styles.modalCancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.lg, paddingTop: 4 },
  overline: { fontFamily: Fonts.bodyMed, fontSize: 11, letterSpacing: 1.5, textTransform: 'uppercase', color: Colors.textMuted },
  h1: { fontFamily: Fonts.heading, fontSize: 28, color: Colors.brandPrimary, letterSpacing: -0.5, marginTop: 2 },
  sub: { fontFamily: Fonts.body, fontSize: 13, color: Colors.textSecondary, marginTop: 6, lineHeight: 19 },
  uploadBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 6, paddingHorizontal: 12, borderRadius: 100, backgroundColor: Colors.brandPrimary, minHeight: 32 },
  uploadBtnText: { fontFamily: Fonts.bodySemi, fontSize: 12, color: Colors.cream },
  meterCard: { backgroundColor: Colors.cardBg, borderRadius: Radius.md, padding: Spacing.md, borderWidth: 1, borderColor: Colors.borderSubtle, marginTop: Spacing.md },
  meterRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 },
  meterLabel: { fontFamily: Fonts.bodyMed, fontSize: 12, color: Colors.brandPrimary },
  meterValue: { fontFamily: Fonts.bodySemi, fontSize: 13, color: Colors.brandPrimary },
  meterMuted: { fontFamily: Fonts.body, color: Colors.textMuted },
  meterTrack: { height: 6, borderRadius: 3, backgroundColor: 'rgba(14, 77, 82, 0.08)', overflow: 'hidden' },
  meterFill: { height: '100%', backgroundColor: Colors.brandPrimary },
  meterFootnote: { fontFamily: Fonts.body, fontSize: 11, color: Colors.textMuted, marginTop: 6 },
  chipRow: { gap: 6, paddingVertical: Spacing.md, paddingRight: Spacing.lg },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 100, backgroundColor: Colors.cardBg, borderWidth: 1, borderColor: Colors.borderSubtle, minHeight: 32 },
  chipActive: { backgroundColor: Colors.brandPrimary, borderColor: Colors.brandPrimary },
  chipText: { fontFamily: Fonts.bodyMed, fontSize: 12, color: Colors.brandPrimary },
  chipTextActive: { color: Colors.cream },
  emptyCard: { padding: Spacing.lg, alignItems: 'center', backgroundColor: Colors.cardBg, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.borderSubtle, gap: 8 },
  emptyTitle: { fontFamily: Fonts.bodySemi, fontSize: 15, color: Colors.brandPrimary, marginTop: 4 },
  emptyBody: { fontFamily: Fonts.body, fontSize: 12, color: Colors.textSecondary, textAlign: 'center', lineHeight: 18 },
  emptyCta: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 10, paddingHorizontal: 16, borderRadius: 100, backgroundColor: Colors.brandPrimary, marginTop: Spacing.sm, minHeight: 40 },
  emptyCtaText: { fontFamily: Fonts.bodySemi, fontSize: 13, color: Colors.cream },
  docCard: { backgroundColor: Colors.cardBg, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.borderSubtle, padding: Spacing.md, marginBottom: 8 },
  docHead: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  docIcon: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(14, 77, 82, 0.06)' },
  docTitle: { fontFamily: Fonts.bodySemi, fontSize: 14, color: Colors.brandPrimary },
  docMeta: { fontFamily: Fonts.body, fontSize: 11, color: Colors.textMuted, marginTop: 2, textTransform: 'uppercase', letterSpacing: 0.3 },
  docNotes: { fontFamily: Fonts.body, fontSize: 12, color: Colors.textSecondary, marginTop: 4 },
  docActions: { flexDirection: 'row', gap: 6, marginTop: 10 },
  miniBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 100, backgroundColor: 'rgba(14, 77, 82, 0.06)', minHeight: 28 },
  miniBtnGhost: { backgroundColor: 'rgba(192, 57, 43, 0.06)' },
  miniBtnText: { fontFamily: Fonts.bodySemi, fontSize: 11, color: Colors.brandPrimary },
  // Modal
  modalBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.45)' },
  modalCard: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: Colors.cardBg, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: Spacing.lg, paddingBottom: 36 },
  modalHandle: { width: 36, height: 4, borderRadius: 2, backgroundColor: Colors.border, alignSelf: 'center', marginBottom: Spacing.md },
  modalTitle: { fontFamily: Fonts.heading, fontSize: 22, color: Colors.brandPrimary },
  modalSub: { fontFamily: Fonts.body, fontSize: 12, color: Colors.textMuted, marginTop: 4, marginBottom: 8 },
  label: { fontFamily: Fonts.bodyMed, fontSize: 12, color: Colors.brandPrimary, marginTop: 10, marginBottom: 4 },
  input: { fontFamily: Fonts.body, fontSize: 14, color: Colors.brandPrimary, backgroundColor: Colors.background, borderRadius: Radius.md, paddingHorizontal: Spacing.md, paddingVertical: 12, borderWidth: 1, borderColor: Colors.borderSubtle },
  modalCta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: Spacing.lg, backgroundColor: Colors.brandPrimary, borderRadius: Radius.md, paddingVertical: 14, minHeight: 50 },
  modalCtaText: { fontFamily: Fonts.bodySemi, fontSize: 14, color: Colors.cream },
  modalCancel: { marginTop: 8, alignItems: 'center', paddingVertical: 10 },
  modalCancelText: { fontFamily: Fonts.bodyMed, fontSize: 13, color: Colors.textMuted },
});
