// WaylyHeader — the teal app header shared across screens (Phase B).
//
// Shape (left → right):
//   logo (mark) → returns to /(tabs)/today on tap
//   participant switcher pill (active participant)
//   plan badge (FREE/SOLO/FAMILY) — links to /settings/plan
//   notification bell with unread badge
//
// We deliberately keep it compact (44px content height) so the existing
// screen layouts don't need restructuring. Pass `transparent` to drop the
// teal background for hero screens (e.g. Decoder result).
import React, { useEffect, useState } from 'react';
import { Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth, isTrialExpired } from '../context/AuthContext';
import { useParticipants } from '../context/ParticipantsContext';
import { api } from '../lib/api';
import { Colors, Fonts, Spacing } from '../lib/theme';
import { ParticipantSwitcher } from './ParticipantSwitcher';

type Props = { transparent?: boolean };

export function WaylyHeader({ transparent = false }: Props) {
  const router = useRouter();
  const { user, subscription } = useAuth();
  const { participantSig } = useParticipants();
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data } = await api.get('/notifications');
        const items = Array.isArray(data) ? data : (data?.items || []);
        const n = items.filter((x: any) => !x.read && !x.read_at).length;
        if (!cancelled) setUnread(n);
      } catch {
        if (!cancelled) setUnread(0);
      }
    })();
    return () => { cancelled = true; };
  }, [participantSig, user?.id]);

  const subActive = subscription?.status === 'active' || subscription?.status === 'trialing';
  const trialEnded = isTrialExpired(user);
  const plan = trialEnded
    ? 'FREE'
    : ((subActive && subscription?.plan && subscription.plan !== 'FREE') ? subscription.plan : (user?.plan || 'free')).toUpperCase();

  return (
    <>
      {trialEnded && <ReadOnlyBannerBar />}
    <View style={[styles.bar, transparent && styles.transparent]}>
      {/* Brand mark, logo + "Wayly" wordmark (matches web app top-left). */}
      <TouchableOpacity
        testID="brand-link"
        hitSlop={8}
        onPress={() => router.push('/(tabs)/today' as any)}
        accessibilityRole="link"
        style={styles.brandRow}
      >
        <Image
          source={require('../../assets/branding/wayly-mark.png')}
          style={styles.brandMark}
          resizeMode="contain"
          accessibilityIgnoresInvertColors
        />
        <Text style={styles.brand}>Wayly</Text>
      </TouchableOpacity>

      <View style={styles.spacer} />

      {/* Participant switcher */}
      <ParticipantSwitcher />

      {/* Plan badge */}
      <TouchableOpacity
        testID="layout-plan-badge"
        onPress={() => router.push('/settings/plan' as any)}
        style={styles.planBadge}
        accessibilityRole="link"
        accessibilityLabel={`${plan} plan`}
      >
        <Text style={styles.planText}>{plan}</Text>
      </TouchableOpacity>

      {/* Bell */}
      <TouchableOpacity
        testID="notif-bell"
        onPress={() => router.push('/(tabs)/notifications' as any)}
        hitSlop={8}
        accessibilityRole="link"
        accessibilityLabel={unread ? `${unread} unread notifications` : 'Notifications'}
        style={styles.bellWrap}
      >
        <Ionicons name="notifications-outline" size={20} color={Colors.textInverse} />
        {unread > 0 && (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{unread > 9 ? '9+' : String(unread)}</Text>
          </View>
        )}
      </TouchableOpacity>
    </View>
    </>
  );
}

/**
 * Persistent expired-trial banner — mirrors the web `<ReadOnlyBanner />`.
 * Rendered as part of WaylyHeader so every screen that mounts the header
 * automatically shows it. Copy is verbatim from the handover spec.
 */
function ReadOnlyBannerBar() {
  const router = useRouter();
  return (
    <TouchableOpacity
      onPress={() => router.push('/settings/plan' as any)}
      activeOpacity={0.9}
      style={styles.readOnlyBar}
      accessibilityRole="link"
      accessibilityLabel="Your trial has ended. Tap to subscribe."
      testID="read-only-banner"
    >
      <Ionicons name="lock-closed" size={14} color={Colors.textInverse} />
      <Text style={styles.readOnlyText} numberOfLines={2}>
        <Text style={styles.readOnlyBold}>Your trial has ended.</Text> Subscribe to add or change anything. You can still view your existing data.
      </Text>
      <View style={styles.readOnlyCta}>
        <Text style={styles.readOnlyCtaText}>Subscribe</Text>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.md,
    paddingVertical: 10,
    gap: 10,
    backgroundColor: Colors.brandPrimary,
  },
  transparent: { backgroundColor: 'transparent' },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  brandMark: { width: 22, height: 22, borderRadius: 4 },
  brand: {
    color: Colors.textInverse,
    fontFamily: Fonts.heading,
    fontSize: 20,
    fontWeight: '700',
    letterSpacing: -0.3,
  },
  spacer: { flex: 1 },
  planBadge: {
    backgroundColor: 'rgba(255,255,255,0.16)',
    borderRadius: 9999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  planText: {
    color: Colors.textInverse,
    fontFamily: Fonts.bodySemi,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.6,
  },
  bellWrap: {
    width: 32, height: 32, alignItems: 'center', justifyContent: 'center',
    borderRadius: 9999,
  },
  badge: {
    position: 'absolute', top: 2, right: 2,
    minWidth: 16, height: 16,
    paddingHorizontal: 4,
    borderRadius: 9999,
    backgroundColor: Colors.brandSecondary,
    alignItems: 'center', justifyContent: 'center',
  },
  badgeText: { color: '#fff', fontFamily: Fonts.bodySemi, fontSize: 10, fontWeight: '700' },

  // Read-only (expired-trial) global banner — clay 500 + white text (matches web).
  readOnlyBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: Spacing.md,
    paddingVertical: 10,
    backgroundColor: Colors.brandSecondary,
    borderBottomWidth: 1,
    borderBottomColor: '#7E3F22',
  },
  readOnlyText: { flex: 1, color: Colors.textInverse, fontFamily: Fonts.body, fontSize: 12.5, lineHeight: 17 },
  readOnlyBold: { fontFamily: Fonts.bodySemi, fontWeight: '700' },
  readOnlyCta: {
    backgroundColor: 'rgba(255,255,255,0.16)',
    borderRadius: 9999,
    paddingHorizontal: 12,
    paddingVertical: 5,
  },
  readOnlyCtaText: { color: Colors.textInverse, fontFamily: Fonts.bodySemi, fontSize: 11.5, fontWeight: '700', letterSpacing: 0.3 },
});
