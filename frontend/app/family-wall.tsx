// Family Wall — Phase C composer parity with the web app.
//
// Top of screen: rich composer
//   • text input (multi-line)
//   • Add photo (camera roll via expo-image-picker)
//   • Voice note (record → transcribe via /api/transcribe → text fills,
//     audio clip travels with the post so listeners can re-play it)
//   • Post button → POST /api/family/wall with text + image_b64 + audio_b64
//
// Below: scrollable feed of posts (newest first). Each post shows
// author/time, the text, an inline photo (if any) and a play button for
// audio (if any).
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  Image,
  ActivityIndicator,
  RefreshControl,
  Platform,
  Linking,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { AudioModule, useAudioRecorder, useAudioPlayer, RecordingPresets } from 'expo-audio';
import { api, extractErrorMessage } from '../src/lib/api';
import { useAuth } from '../src/context/AuthContext';
import { useParticipants } from '../src/context/ParticipantsContext';
import { toast } from '../src/components/Toast';
import BackHeader from '../src/components/BackHeader';
import { formatAUDate } from '../src/lib/format';
import { Colors, Fonts, Radius, Spacing } from '../src/lib/theme';

type WallPost = {
  id: string;
  participant_id: string;
  author_id: string;
  kind: 'note' | 'photo' | 'voice' | string;
  text?: string;
  image_b64?: string | null;
  audio_b64?: string | null;
  audio_duration_ms?: number | null;
  image_mime?: string | null;
  audio_mime?: string | null;
  created_at: string;
};

function fmtMs(ms?: number | null): string {
  if (!ms || ms <= 0) return '0:00';
  const total = Math.round(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

// Read a file URI to base64 — used to upload picked photos.
async function fileToBase64(uri: string): Promise<string | null> {
  try {
    if (uri.startsWith('data:')) return uri.split(',', 2)[1] || null;
    const b64 = await FileSystem.readAsStringAsync(uri, { encoding: 'base64' as any });
    return b64;
  } catch {
    return null;
  }
}

export default function FamilyWall() {
  const { user } = useAuth();
  const { active, participantSig } = useParticipants();

  // Composer state
  const [text, setText] = useState('');
  const [imageB64, setImageB64] = useState<string | null>(null);
  const [imageMime, setImageMime] = useState<string | null>(null);
  const [audioB64, setAudioB64] = useState<string | null>(null);
  const [audioMime, setAudioMime] = useState<string | null>(null);
  const [audioDurationMs, setAudioDurationMs] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [transcribing, setTranscribing] = useState(false);

  // Recording — expo-audio
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const [recording, setRecording] = useState(false);
  const [recElapsed, setRecElapsed] = useState(0);
  const recTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Feed
  const [posts, setPosts] = useState<WallPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const { data } = await api.get<{ items: WallPost[] }>('/family/wall');
      setPosts(data?.items || []);
    } catch (e) {
      toast.error(extractErrorMessage(e, "Couldn't load family wall."));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [participantSig, active?.id]);

  // ── Photo picker ──────────────────────────────────────────────────
  const onAddPhoto = useCallback(async () => {
    try {
      const { status, canAskAgain } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        if (canAskAgain) {
          toast.info('Allow photo access to attach a picture.');
        } else {
          Alert.alert(
            'Photo access needed',
            'Wayly needs photo access to attach pictures to the family wall.',
            [{ text: 'Cancel', style: 'cancel' }, { text: 'Open settings', onPress: () => Linking.openSettings() }],
          );
        }
        return;
      }
      const res = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        quality: 0.7,
        base64: true,
      });
      if (res.canceled || !res.assets || res.assets.length === 0) return;
      const a = res.assets[0];
      let b64 = a.base64 || null;
      if (!b64 && a.uri) b64 = await fileToBase64(a.uri);
      if (!b64) {
        toast.error("Couldn't read that photo.");
        return;
      }
      setImageB64(b64);
      setImageMime(a.mimeType || 'image/jpeg');
    } catch (e) {
      toast.error(extractErrorMessage(e, "Couldn't pick a photo."));
    }
  }, []);

  const onRemovePhoto = useCallback(() => {
    setImageB64(null);
    setImageMime(null);
  }, []);

  // ── Voice recorder + transcription ─────────────────────────────────
  const startRecording = useCallback(async () => {
    try {
      const perm = await AudioModule.requestRecordingPermissionsAsync();
      if (!perm.granted) {
        if (perm.canAskAgain) {
          toast.info('Allow microphone access to record a voice note.');
        } else {
          Alert.alert(
            'Microphone access needed',
            'Wayly needs microphone access to record voice notes for the family wall.',
            [{ text: 'Cancel', style: 'cancel' }, { text: 'Open settings', onPress: () => Linking.openSettings() }],
          );
        }
        return;
      }
      await recorder.prepareToRecordAsync();
      await recorder.record();
      setRecording(true);
      setRecElapsed(0);
      const startedAt = Date.now();
      recTimerRef.current = setInterval(() => {
        setRecElapsed(Date.now() - startedAt);
      }, 250);
    } catch (e) {
      toast.error(extractErrorMessage(e, "Couldn't start recording."));
    }
  }, [recorder]);

  const stopRecording = useCallback(async () => {
    try {
      if (recTimerRef.current) {
        clearInterval(recTimerRef.current);
        recTimerRef.current = null;
      }
      await recorder.stop();
      setRecording(false);
      const uri = recorder.uri;
      if (!uri) {
        toast.error('No audio captured.');
        return;
      }
      const b64 = await fileToBase64(uri);
      if (!b64) {
        toast.error("Couldn't read recording.");
        return;
      }
      const ext = (uri.split('.').pop() || 'm4a').toLowerCase();
      const mime = ext === 'wav' ? 'audio/wav'
        : ext === 'webm' ? 'audio/webm'
        : ext === 'mp3' ? 'audio/mpeg'
        : 'audio/m4a';
      setAudioB64(b64);
      setAudioMime(mime);
      setAudioDurationMs(recElapsed);

      // Transcribe → fill the text box.
      setTranscribing(true);
      try {
        const fd = new FormData();
        if (Platform.OS === 'web') {
          const blob = await (await fetch(uri)).blob();
          fd.append('file', blob, `clip.${ext}`);
        } else {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          fd.append('file', { uri, name: `clip.${ext}`, type: mime } as any);
        }
        const resp = await api.post<{ text: string }>('/transcribe', fd, {
          headers: { 'Content-Type': 'multipart/form-data' },
          timeout: 60000,
        });
        const transcribed = (resp.data?.text || '').trim();
        if (transcribed) {
          setText((t) => (t.trim() ? `${t.trim()}\n${transcribed}` : transcribed));
          toast.success('Transcribed.');
        } else {
          toast.info('No speech detected.');
        }
      } catch (e) {
        toast.error(extractErrorMessage(e, 'Transcription unavailable. Audio clip is still attached.'));
      } finally {
        setTranscribing(false);
      }
    } catch (e) {
      setRecording(false);
      toast.error(extractErrorMessage(e, "Couldn't stop recording."));
    }
  }, [recorder, recElapsed]);

  const onRemoveAudio = useCallback(() => {
    setAudioB64(null);
    setAudioMime(null);
    setAudioDurationMs(null);
  }, []);

  // ── Submit ─────────────────────────────────────────────────────────
  const onPost = useCallback(async () => {
    const trimmed = text.trim();
    if (!trimmed && !imageB64 && !audioB64) {
      toast.warning('Write a note, attach a photo, or record a voice note first.');
      return;
    }
    setSubmitting(true);
    try {
      await api.post('/family/wall', {
        text: trimmed,
        image_b64: imageB64,
        image_mime: imageMime,
        audio_b64: audioB64,
        audio_mime: audioMime,
        audio_duration_ms: audioDurationMs,
        kind: imageB64 ? 'photo' : audioB64 ? 'voice' : 'note',
      });
      setText(''); setImageB64(null); setImageMime(null);
      setAudioB64(null); setAudioMime(null); setAudioDurationMs(null);
      await load();
      toast.success('Posted to family wall.');
    } catch (e) {
      toast.error(extractErrorMessage(e, "Couldn't post. Try again."));
    } finally {
      setSubmitting(false);
    }
  }, [text, imageB64, imageMime, audioB64, audioMime, audioDurationMs, load]);

  const onRefresh = useCallback(async () => { setRefreshing(true); await load(); }, [load]);

  // ── Render ─────────────────────────────────────────────────────────
  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <BackHeader title="Family wall" />
      <KeyboardAwareScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        bottomOffset={24}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.brandPrimary} />}
      >
        <View style={styles.heroRow}>
          <Ionicons name="people-circle-outline" size={22} color={Colors.brandPrimary} />
          <Text style={styles.hero}>Family wall</Text>
        </View>
        <Text style={styles.subhero}>
          Share a quick note, photo or voice memo with everyone caring for {active?.first_name || 'this participant'}.
        </Text>

        {/* Composer */}
        <View style={styles.composer}>
          <TextInput
            value={text}
            onChangeText={setText}
            multiline
            placeholder={`What's happening with ${active?.first_name || 'them'}?`}
            placeholderTextColor={Colors.textMuted}
            style={styles.input}
            editable={!submitting}
            testID="wall-input"
          />

          {imageB64 ? (
            <View style={styles.attachWrap}>
              <Image
                source={{ uri: `data:${imageMime || 'image/jpeg'};base64,${imageB64}` }}
                style={styles.attachThumb}
                resizeMode="cover"
              />
              <TouchableOpacity style={styles.attachRemove} onPress={onRemovePhoto} testID="wall-remove-photo">
                <Ionicons name="close" size={14} color="#fff" />
              </TouchableOpacity>
            </View>
          ) : null}

          {audioB64 ? (
            <View style={styles.audioPreview}>
              <Ionicons name="musical-notes-outline" size={16} color={Colors.brandPrimary} />
              <Text style={styles.audioPreviewText}>Voice note · {fmtMs(audioDurationMs)}</Text>
              <TouchableOpacity onPress={onRemoveAudio} style={styles.audioRemove} testID="wall-remove-audio">
                <Ionicons name="close" size={14} color={Colors.severityAlert} />
              </TouchableOpacity>
            </View>
          ) : null}

          <View style={styles.toolRow}>
            <TouchableOpacity
              style={styles.toolBtn}
              onPress={onAddPhoto}
              disabled={submitting}
              testID="wall-add-photo"
              accessibilityRole="button"
              accessibilityLabel="Attach a photo"
            >
              <Ionicons name="image-outline" size={18} color={Colors.brandPrimary} />
              <Text style={styles.toolBtnText}>Photo</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.toolBtn, recording && styles.toolBtnRec]}
              onPress={recording ? stopRecording : startRecording}
              disabled={submitting || transcribing}
              testID="wall-voice-toggle"
              accessibilityRole="button"
              accessibilityLabel={recording ? 'Stop recording' : 'Record a voice note'}
            >
              {recording ? (
                <>
                  <View style={styles.recDot} />
                  <Text style={[styles.toolBtnText, styles.toolBtnTextRec]}>{fmtMs(recElapsed)} · Stop</Text>
                </>
              ) : transcribing ? (
                <>
                  <ActivityIndicator size="small" color={Colors.brandPrimary} />
                  <Text style={styles.toolBtnText}>Transcribing…</Text>
                </>
              ) : (
                <>
                  <Ionicons name="mic-outline" size={18} color={Colors.brandPrimary} />
                  <Text style={styles.toolBtnText}>Dictate</Text>
                </>
              )}
            </TouchableOpacity>

            <View style={{ flex: 1 }} />

            <TouchableOpacity
              style={[styles.postBtn, (submitting || (!text.trim() && !imageB64 && !audioB64)) && { opacity: 0.55 }]}
              onPress={onPost}
              disabled={submitting || (!text.trim() && !imageB64 && !audioB64)}
              testID="wall-post"
              accessibilityRole="button"
            >
              {submitting ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <>
                  <Ionicons name="send-outline" size={14} color="#FFFFFF" />
                  <Text style={styles.postBtnText}>Post</Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        </View>

        <Text style={styles.sectionH}>Recent activity</Text>
        {loading ? (
          <ActivityIndicator color={Colors.brandPrimary} style={{ paddingVertical: 32 }} />
        ) : posts.length === 0 ? (
          <View style={styles.emptyCard}>
            <Ionicons name="people-circle-outline" size={28} color={Colors.textMuted} />
            <Text style={styles.emptyTitle}>Quiet here — for now</Text>
            <Text style={styles.emptyBody}>
              Anything you post above will appear here for everyone in {active?.first_name || 'this participant'}&apos;s family circle.
            </Text>
          </View>
        ) : posts.map((p) => <PostCard key={p.id} post={p} self={user?.id === p.author_id} />)}

        <View style={{ height: 32 }} />
      </KeyboardAwareScrollView>
    </SafeAreaView>
  );
}

// ──────────────────────────────────────────────────────────────────────
function PostCard({ post, self }: { post: WallPost; self: boolean }) {
  // useAudioPlayer must be called unconditionally — pass an empty source if no audio.
  const player = useAudioPlayer(
    post.audio_b64
      ? { uri: `data:${post.audio_mime || 'audio/m4a'};base64,${post.audio_b64}` }
      : null,
  );
  const [playing, setPlaying] = useState(false);

  const togglePlay = useCallback(() => {
    if (!post.audio_b64) return;
    try {
      if (playing) {
        player.pause();
        setPlaying(false);
      } else {
        player.seekTo(0);
        player.play();
        setPlaying(true);
        const dur = post.audio_duration_ms || 0;
        if (dur > 0) {
          setTimeout(() => setPlaying(false), dur + 350);
        }
      }
    } catch {
      setPlaying(false);
    }
  }, [player, playing, post.audio_b64, post.audio_duration_ms]);

  const when = (() => {
    try {
      return new Date(post.created_at).toLocaleString('en-AU', {
        day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit',
      });
    } catch { return formatAUDate(post.created_at); }
  })();

  return (
    <View style={styles.postCard} testID={`wall-post-${post.id}`}>
      <View style={styles.postHead}>
        <View style={[styles.avatar, self && styles.avatarSelf]}>
          <Text style={styles.avatarText}>{(self ? 'You' : 'F').slice(0, 1).toUpperCase()}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.postAuthor}>{self ? 'You' : 'Family'}</Text>
          <Text style={styles.postMeta}>{when}</Text>
        </View>
      </View>
      {!!post.text && <Text style={styles.postBody}>{post.text}</Text>}
      {!!post.image_b64 && (
        <Image
          source={{ uri: `data:${post.image_mime || 'image/jpeg'};base64,${post.image_b64}` }}
          style={styles.postImage}
          resizeMode="cover"
          accessibilityLabel="Photo attached to family wall post"
        />
      )}
      {!!post.audio_b64 && (
        <TouchableOpacity style={styles.postAudio} onPress={togglePlay} testID={`wall-play-${post.id}`}>
          <Ionicons name={playing ? 'pause' : 'play'} size={16} color={Colors.brandPrimary} />
          <Text style={styles.postAudioText}>Voice note · {fmtMs(post.audio_duration_ms)}</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.md, paddingBottom: 40 },
  heroRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 6 },
  hero: { fontFamily: Fonts.heading, fontSize: 24, color: Colors.brandPrimary, letterSpacing: -0.3 },
  subhero: { fontFamily: Fonts.body, fontSize: 13, color: Colors.textSecondary, lineHeight: 19, marginBottom: Spacing.lg },

  composer: {
    backgroundColor: Colors.cardBg,
    borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.borderSubtle,
    padding: Spacing.md, marginBottom: Spacing.lg,
  },
  input: {
    minHeight: 80, textAlignVertical: 'top',
    fontFamily: Fonts.body, fontSize: 14, color: Colors.textPrimary,
    backgroundColor: '#FFFFFF', borderRadius: Radius.sm,
    borderWidth: 1, borderColor: Colors.borderSubtle,
    padding: 10,
  },
  attachWrap: { marginTop: Spacing.sm, alignSelf: 'flex-start' },
  attachThumb: { width: 96, height: 96, borderRadius: Radius.md, backgroundColor: Colors.background },
  attachRemove: {
    position: 'absolute', top: -6, right: -6,
    width: 22, height: 22, borderRadius: 11,
    backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center',
  },
  audioPreview: {
    marginTop: Spacing.sm, flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 10, paddingVertical: 8,
    backgroundColor: 'rgba(14, 77, 82, 0.08)', borderRadius: Radius.md,
  },
  audioPreviewText: { fontFamily: Fonts.bodyMed, fontSize: 12, color: Colors.brandPrimary, flex: 1 },
  audioRemove: { padding: 4 },

  toolRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: Spacing.md },
  toolBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 10, paddingVertical: 8,
    backgroundColor: Colors.background, borderRadius: 999,
    borderWidth: 1, borderColor: Colors.borderSubtle,
    minHeight: 36,
  },
  toolBtnRec: { backgroundColor: 'rgba(192, 57, 43, 0.10)', borderColor: 'rgba(192, 57, 43, 0.35)' },
  toolBtnText: { fontFamily: Fonts.bodyMed, fontSize: 12, color: Colors.brandPrimary },
  toolBtnTextRec: { color: '#C0392B' },
  recDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#C0392B' },

  postBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: Colors.brandPrimary, paddingHorizontal: 14, paddingVertical: 9,
    borderRadius: Radius.md, minHeight: 36,
  },
  postBtnText: { fontFamily: Fonts.bodySemi, fontSize: 13, color: '#FFFFFF' },

  sectionH: { fontFamily: Fonts.heading, fontSize: 18, color: Colors.brandPrimary, marginBottom: Spacing.sm },
  emptyCard: {
    padding: Spacing.lg, alignItems: 'center', gap: 8,
    backgroundColor: Colors.cardBg, borderRadius: Radius.md,
    borderWidth: 1, borderColor: Colors.borderSubtle,
  },
  emptyTitle: { fontFamily: Fonts.bodySemi, fontSize: 15, color: Colors.brandPrimary, marginTop: 4 },
  emptyBody: { fontFamily: Fonts.body, fontSize: 12, color: Colors.textSecondary, textAlign: 'center', lineHeight: 18 },

  postCard: {
    backgroundColor: Colors.cardBg, borderRadius: Radius.md,
    borderWidth: 1, borderColor: Colors.borderSubtle,
    padding: Spacing.md, marginBottom: Spacing.sm,
  },
  postHead: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 },
  avatar: {
    width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(14, 77, 82, 0.12)',
  },
  avatarSelf: { backgroundColor: 'rgba(165, 81, 43, 0.18)' },
  avatarText: { fontFamily: Fonts.bodySemi, fontSize: 13, color: Colors.brandPrimary },
  postAuthor: { fontFamily: Fonts.bodySemi, fontSize: 13, color: Colors.brandPrimary },
  postMeta: { fontFamily: Fonts.body, fontSize: 11, color: Colors.textSecondary, marginTop: 1 },
  postBody: { fontFamily: Fonts.body, fontSize: 14, color: Colors.textPrimary, lineHeight: 20 },
  postImage: { width: '100%', aspectRatio: 4 / 3, borderRadius: Radius.md, marginTop: 8, backgroundColor: Colors.background },
  postAudio: {
    flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10,
    backgroundColor: 'rgba(14, 77, 82, 0.08)',
    paddingHorizontal: 12, paddingVertical: 10, borderRadius: Radius.md,
  },
  postAudioText: { fontFamily: Fonts.bodyMed, fontSize: 13, color: Colors.brandPrimary, flex: 1 },
});
