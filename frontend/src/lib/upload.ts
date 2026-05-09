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

const FRIENDLY_PHRASES: Record<UploadProgressPhase, string> = {
  picking: 'Getting your photo ready…',
  uploading: 'Sending it to Wayly…',
  reading: 'Reading every line of the statement…',
  parsing: 'Checking for anomalies and writing your summary…',
  done: 'All done.',
  error: 'Something went wrong.',
};

async function postFile(uri: string, name: string, mime: string, onProgress: UploadProgress): Promise<string> {
  onProgress('uploading', FRIENDLY_PHRASES.uploading);

  // Build form-data
  const form = new FormData();
  // React Native FormData expects { uri, name, type } — typed as any to satisfy lib.dom
  form.append('file', {
    uri,
    name,
    type: mime,
  } as any);

  const { data } = await api.post('/statements/upload', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 90_000,
  });
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
    if (st?.status === 'done') {
      onProgress('done', FRIENDLY_PHRASES.done);
      return st.statement_id;
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

export async function uploadFromCamera(onProgress: UploadProgress): Promise<string> {
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

export async function uploadFromLibrary(onProgress: UploadProgress): Promise<string> {
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

export const uploadPhrase = (phase: UploadProgressPhase) => FRIENDLY_PHRASES[phase];
