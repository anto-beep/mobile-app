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
import { useAuth } from '../context/AuthContext';
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

  const plan = (subscription?.plan && subscription.plan !== 'FREE' ? subscription.plan : (user?.plan || 'free')).toUpperCase();

  return (
    <View style={[styles.bar, transparent && styles.transparent]}>
      {/* Brand mark — logo + "Wayly" wordmark (matches web app top-left). */}
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
});
