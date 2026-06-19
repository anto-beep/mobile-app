// Referrals — share Wayly with a link, track invites.
import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, RefreshControl, TouchableOpacity, Share, Platform, Clipboard as RNClipboard } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useApi } from '../src/lib/useApi';
import { useAuth } from '../src/context/AuthContext';
import BackHeader from '../src/components/BackHeader';
import { toast } from '../src/components/Toast';
import { formatAUDate } from '../src/lib/format';
import { Colors, Fonts, Radius, Spacing } from '../src/lib/theme';

type Referral = { id: string; email?: string; status?: 'INVITED' | 'JOINED' | 'CONVERTED' | string; created_at?: string };

const STATUS_META: Record<string, { tint: string; label: string }> = {
  INVITED:   { tint: '#6B7C92', label: 'Invited' },
  JOINED:    { tint: '#0E4D52', label: 'Joined' },
  CONVERTED: { tint: '#3A5F37', label: 'Upgraded · credit earned' },
};

export default function Referrals() {
  const { user } = useAuth();
  const { data, loading, refreshing, refresh } = useApi<{ items: Referral[] }>('/referrals');
  const items = data?.items || [];
  const [copied, setCopied] = useState(false);

  // Derive a personal referral link from the user id. Server can replace
  // this with a real signed code via /referrals/code later.
  const link = useMemo(() => {
    const code = (user?.id || '').slice(0, 8) || 'friend';
    return `https://wayly.com.au/?ref=${code}`;
  }, [user?.id]);

  const copy = async () => {
    let ok = false;
    try {
      if (Platform.OS === 'web' && typeof navigator !== 'undefined' && (navigator as any).clipboard?.writeText) {
        try {
          await (navigator as any).clipboard.writeText(link);
          ok = true;
        } catch { /* fall through to legacy/native paths */ }
      }
      if (!ok) {
        // RNClipboard works on web (renders to document.execCommand) and native.
        RNClipboard.setString(link);
        ok = true;
      }
      setCopied(true);
      toast.success('Link copied');
      setTimeout(() => setCopied(false), 2000);
    } catch { toast.error("Couldn't copy — long-press and copy manually."); }
  };

  const share = async () => {
    try {
      if (Platform.OS === 'web') { await copy(); return; }
      await Share.share({ message: `Join me on Wayly — it makes Support-at-Home spending obvious. ${link}` });
    } catch { /* user cancelled */ }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <BackHeader title="Referrals" />
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={Colors.brandPrimary} />}
      >
        <View style={styles.heroRow}>
          <Ionicons name="gift-outline" size={22} color={Colors.brandPrimary} />
          <Text style={styles.hero}>Refer a family</Text>
        </View>
        <Text style={styles.subhero}>Invite another family to Wayly. They get 30 free days; you get account credit when they upgrade.</Text>

        <View style={styles.linkCard}>
          <Text style={styles.lbl}>Your invite link</Text>
          <Text style={styles.link} numberOfLines={1} selectable>{link}</Text>
          <View style={styles.btnRow}>
            <TouchableOpacity style={[styles.btn, styles.btnGhost]} onPress={copy} testID="referral-copy">
              <Ionicons name={copied ? 'checkmark' : 'copy-outline'} size={14} color={Colors.brandPrimary} />
              <Text style={styles.btnGhostText}>{copied ? 'Copied' : 'Copy link'}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.btn} onPress={share} testID="referral-share">
              <Ionicons name="share-social-outline" size={14} color="#FFFFFF" />
              <Text style={styles.btnText}>Share</Text>
            </TouchableOpacity>
          </View>
        </View>

        <Text style={styles.sectionH}>Your invites</Text>
        {loading ? null : items.length === 0 ? (
          <View style={styles.emptyCard}>
            <Ionicons name="people-outline" size={28} color={Colors.textMuted} />
            <Text style={styles.emptyTitle}>No invites yet</Text>
            <Text style={styles.emptyBody}>Once someone signs up using your link, they&apos;ll appear here with their status.</Text>
          </View>
        ) : items.map((r) => {
          const m = STATUS_META[(r.status || 'INVITED').toUpperCase()] || STATUS_META.INVITED;
          return (
            <View key={r.id} style={styles.row} testID={`ref-${r.id}`}>
              <View style={[styles.bullet, { backgroundColor: `${m.tint}1A` }]}>
                <Ionicons name="person-outline" size={16} color={m.tint} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.email} numberOfLines={1}>{r.email || 'Pending email'}</Text>
                <Text style={styles.meta}>{r.created_at ? formatAUDate(r.created_at) : ''}</Text>
              </View>
              <View style={[styles.pill, { backgroundColor: `${m.tint}14` }]}>
                <Text style={[styles.pillText, { color: m.tint }]}>{m.label}</Text>
              </View>
            </View>
          );
        })}
        <View style={{ height: 32 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.md, paddingBottom: 40 },
  heroRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 6 },
  hero: { fontFamily: Fonts.heading, fontSize: 24, color: Colors.brandPrimary, letterSpacing: -0.3 },
  subhero: { fontFamily: Fonts.body, fontSize: 13, color: Colors.textSecondary, lineHeight: 19, marginBottom: Spacing.lg },
  linkCard: { backgroundColor: Colors.cardBg, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.borderSubtle, padding: Spacing.md, marginBottom: Spacing.lg, gap: 8 },
  lbl: { fontFamily: Fonts.bodyMed, fontSize: 11, letterSpacing: 0.6, color: Colors.textSecondary },
  link: { fontFamily: Fonts.body, fontSize: 13, color: Colors.brandPrimary, paddingVertical: 6, paddingHorizontal: 10, borderRadius: Radius.sm, backgroundColor: Colors.background, borderWidth: 1, borderColor: Colors.borderSubtle },
  btnRow: { flexDirection: 'row', gap: 8, marginTop: 4 },
  btn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 10, borderRadius: Radius.md, backgroundColor: Colors.brandPrimary, minHeight: 40 },
  btnText: { fontFamily: Fonts.bodySemi, fontSize: 13, color: '#FFFFFF' },
  btnGhost: { backgroundColor: Colors.background, borderWidth: 1, borderColor: Colors.borderSubtle },
  btnGhostText: { fontFamily: Fonts.bodySemi, fontSize: 13, color: Colors.brandPrimary },
  sectionH: { fontFamily: Fonts.heading, fontSize: 18, color: Colors.brandPrimary, marginBottom: Spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: Colors.cardBg, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.borderSubtle, padding: Spacing.md, marginBottom: 6 },
  bullet: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  email: { fontFamily: Fonts.bodySemi, fontSize: 14, color: Colors.brandPrimary },
  meta: { fontFamily: Fonts.body, fontSize: 11, color: Colors.textSecondary, marginTop: 2 },
  pill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 },
  pillText: { fontFamily: Fonts.bodySemi, fontSize: 10, letterSpacing: 0.4 },
  emptyCard: { padding: Spacing.lg, alignItems: 'center', gap: 8, backgroundColor: Colors.cardBg, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.borderSubtle },
  emptyTitle: { fontFamily: Fonts.bodySemi, fontSize: 15, color: Colors.brandPrimary, marginTop: 4 },
  emptyBody: { fontFamily: Fonts.body, fontSize: 12, color: Colors.textSecondary, textAlign: 'center', lineHeight: 18 },
});
