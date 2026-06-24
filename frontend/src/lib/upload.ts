// Upload helper — shared logic for camera / library / PDF picker → /api/statements/upload
// Returns the resulting statement_id (after polling the job) or throws.
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { Platform } from 'react-native';
import { api, extractErrorMessage } from './api';

export type UploadProgressPhase =
  | 'picking'
  | 'uploading'
  | 'reading'      // Extracting text via OCR
  | 'parsing'      // Structuring line items / writing summary
  | 'done'
  | 'error';

export type UploadProgress = (phase: UploadProgressPhase, message: string) => void;

/** Result of an upload — preserves backwards-compat with the original `string`
 *  return shape while also carrying the duplicate-detection signals the
 *  Phase 1–4 lifecycle UI needs. Callers that don't care can keep using
 *  `result.statementId`; the duplicate modals read the optional fields. */
export type UploadResult = {
  statementId: string;
  /** Set when the backend reports the parsed content was logically identical
   *  (same line items / totals / dates) to a prior statement, or when the
   *  upload triggered a versioning revision. */
  duplicateKind?: 'DUPLICATE_LOGICAL_SAME_CONTENT' | 'DUPLICATE_LOGICAL_DIFFERENT_CONTENT';
  /** Convenience pointer to the existing statement for the SAME_CONTENT case. */
  existingStatementId?: string;
  /** Convenience pointer to the prior (now-superseded) version for DIFFERENT_CONTENT. */
  supersedesVersionId?: string;
};

const FRIENDLY_PHRASES: Record<UploadProgressPhase, string> = {
  picking: 'Getting your photo ready…',
  uploading: 'Sending it to Wayly…',
  reading: 'Reading every line of the statement…',
  parsing: 'Checking for anomalies and writing your summary…',
  done: 'All done.',
  error: 'Something went wrong.',
};

async function postFile(uri: string, name: string, mime: string, onProgress: UploadProgress): Promise<UploadResult> {
  onProgress('uploading', FRIENDLY_PHRASES.uploading);

  // Build form-data
  const form = new FormData();
  // React Native FormData expects { uri, name, type } — typed as any to satisfy lib.dom
  form.append('file', {
    uri,
    name,
    type: mime,
  } as any);

  // Idempotency-Key — the backend replays the same response for 24 h if the
  // user accidentally double-taps Upload. Generated per attempt.
  const idempotencyKey = `upload-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

  let res;
  try {
    res = await api.post('/statements/upload', form, {
      headers: { 'Content-Type': 'multipart/form-data', 'Idempotency-Key': idempotencyKey },
      timeout: 90_000,
    });
  } catch (e: any) {
    // 409 — backend detected a byte-identical duplicate before parsing.
    if (e?.response?.status === 409) {
      const detail = e.response.data?.detail || e.response.data;
      if (detail?.error === 'DUPLICATE_EXACT') {
        const err: any = new Error(detail.message || 'Duplicate statement');
        err.code = 'DUPLICATE_EXACT';
        err.existing = detail;
        throw err;
      }
    }
    throw e;
  }
  const data = res?.data;
  const jobId = data?.job_id;
  if (!jobId) throw new Error('No job id returned');

  // Poll up to 5 minutes
  onProgress('reading', FRIENDLY_PHRASES.reading);
  for (let i = 0; i < 150; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    let st: any;
    try {
      const res = await api.get(`/statements/upload-job/${jobId}`);
      st = res.data;
    } catch {
      continue;
    }
    if (st?.phase === 'parsing' && i > 5) {
      onProgress('parsing', FRIENDLY_PHRASES.parsing);
    }
    // Logical duplicate (same content, different file). Status === 'duplicate'.
    if (st?.status === 'duplicate' && st?.duplicate_kind === 'DUPLICATE_LOGICAL_SAME_CONTENT') {
      onProgress('done', FRIENDLY_PHRASES.done);
      return {
        statementId: st.existing_statement_id,
        duplicateKind: 'DUPLICATE_LOGICAL_SAME_CONTENT',
        existingStatementId: st.existing_statement_id,
      };
    }
    if (st?.status === 'done') {
      onProgress('done', FRIENDLY_PHRASES.done);
      // Revised statement — auto-superseded a prior version.
      if (st?.duplicate_kind === 'DUPLICATE_LOGICAL_DIFFERENT_CONTENT') {
        return {
          statementId: st.statement_id,
          duplicateKind: 'DUPLICATE_LOGICAL_DIFFERENT_CONTENT',
          supersedesVersionId: st.supersedes_version_id,
        };
      }
      return { statementId: st.statement_id };
    }
    if (st?.status === 'error') {
      throw new Error(st.error || 'Decode failed');
    }
  }
  throw new Error('Decoding is taking longer than expected. Please try again.');
}

async function compressImage(uri: string): Promise<string> {
  try {
    const result = await ImageManipulator.manipulateAsync(
      uri,
      [{ resize: { width: 1800 } }],
      { compress: 0.85, format: ImageManipulator.SaveFormat.JPEG }
    );
    return result.uri;
  } catch {
    return uri;
  }
}

export async function uploadFromCamera(onProgress: UploadProgress): Promise<UploadResult> {
  onProgress('picking', FRIENDLY_PHRASES.picking);
  const perm = await ImagePicker.requestCameraPermissionsAsync();
  if (!perm.granted) throw new Error('Wayly needs camera access to scan the statement.');
  const res = await ImagePicker.launchCameraAsync({
    mediaTypes: ImagePicker.MediaTypeOptions.Images,
    quality: 0.9,
    allowsEditing: false,
  });
  if (res.canceled || !res.assets?.[0]) throw new Error('cancelled');
  const compressed = await compressImage(res.assets[0].uri);
  const name = `camera-${Date.now()}.jpg`;
  return postFile(compressed, name, 'image/jpeg', onProgress);
}

export async function uploadFromLibrary(onProgress: UploadProgress): Promise<UploadResult> {
  onProgress('picking', FRIENDLY_PHRASES.picking);
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) throw new Error('Wayly needs photo-library access.');
  const res = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ImagePicker.MediaTypeOptions.Images,
    quality: 0.9,
  });
  if (res.canceled || !res.assets?.[0]) throw new Error('cancelled');
  const compressed = await compressImage(res.assets[0].uri);
  const name = res.assets[0].fileName || `photo-${Date.now()}.jpg`;
  return postFile(compressed, name, 'image/jpeg', onProgress);
}

export async function uploadFromDocument(onProgress: UploadProgress): Promise<string> {
  onProgress('picking', FRIENDLY_PHRASES.picking);
  const res = await DocumentPicker.getDocumentAsync({
    type: ['application/pdf', 'text/plain', 'text/csv'],
    copyToCacheDirectory: true,
  });
  if (res.canceled || !res.assets?.[0]) throw new Error('cancelled');
  const file = res.assets[0];
  const mime = file.mimeType || 'application/pdf';
  return postFile(file.uri, file.name || 'document.pdf', mime, onProgress);
}

/** Submit a pasted statement (no file). Goes through the same job pipeline as
 *  /statements/upload so the resulting Statement appears in the user's history
 *  with summary, line items and anomalies. */
export async function uploadFromText(text: string, onProgress: UploadProgress): Promise<UploadResult> {
  const trimmed = (text || '').trim();
  if (trimmed.length < 10) throw new Error('Paste a bit more text — at least 10 characters.');
  onProgress('uploading', FRIENDLY_PHRASES.uploading);
  const { data } = await api.post('/statements/upload-text', { text: trimmed });
  const jobId = data?.job_id;
  if (!jobId) throw new Error('No job id returned');

  // Same poll pattern as postFile — text uploads skip the "reading" (OCR)
  // phase so we go straight into "parsing".
  onProgress('parsing', FRIENDLY_PHRASES.parsing);
  for (let i = 0; i < 150; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    let st: any;
    try {
      const res = await api.get(`/statements/upload-job/${jobId}`, { timeout: 8000 });
      st = res.data;
    } catch {
      continue;
    }
    if (st?.status === 'duplicate' && st?.duplicate_kind === 'DUPLICATE_LOGICAL_SAME_CONTENT') {
      onProgress('done', FRIENDLY_PHRASES.done);
      return {
        statementId: st.existing_statement_id,
        duplicateKind: 'DUPLICATE_LOGICAL_SAME_CONTENT',
        existingStatementId: st.existing_statement_id,
      };
    }
    if (st?.status === 'done') {
      onProgress('done', FRIENDLY_PHRASES.done);
      if (st?.duplicate_kind === 'DUPLICATE_LOGICAL_DIFFERENT_CONTENT') {
        return {
          statementId: st.statement_id,
          duplicateKind: 'DUPLICATE_LOGICAL_DIFFERENT_CONTENT',
          supersedesVersionId: st.supersedes_version_id,
        };
      }
      return { statementId: st.statement_id };
    }
    if (st?.status === 'error') {
      throw new Error(st.error || 'Decode failed');
    }
  }
  throw new Error('Decoding is taking longer than expected. Please try again.');
}

export const uploadPhrase = (phase: UploadProgressPhase) => FRIENDLY_PHRASES[phase];
