import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { Platform } from 'react-native';
import { api } from './api';
import { Colors } from './theme';
import { mapWebPathToNative } from './scenarioSchema';

// Phase 3 hardening: cache the last token registered so the logout-time
// unregister call sends a precise device identifier (rather than fetching a
// new token after permissions were revoked, which fails).
let lastRegisteredToken: string | null = null;

/**
 * Resolve a push-notification payload into a router-friendly native path.
 *
 * Scenario-engine alerts arrive with `data` shaped like:
 *   { kind: "alert" | "event" | "state", participant_id, alert_id?, next_action_link? }
 * Other (legacy) notifications may carry a free-form `deeplink` string.
 *
 * Resolution order, per handoff §7:
 *   1. If `next_action_link` is present → run it through `mapWebPathToNative`.
 *   2. If `kind === "alert"` + `participant_id` → /participants/:id/timeline
 *   3. If `kind === "event"` + `participant_id` → /participants/:id/timeline
 *   4. Fallback to /alerts.
 */
export function resolvePushDestination(data: Record<string, any> | null | undefined): string {
  const d = data || {};
  if (typeof d.next_action_link === 'string') {
    const mapped = mapWebPathToNative(d.next_action_link);
    if (mapped) return mapped;
  }
  if (typeof d.deeplink === 'string' && d.deeplink.startsWith('/')) {
    return d.deeplink;
  }
  if (d.participant_id && (d.kind === 'alert' || d.kind === 'event' || d.kind === 'state')) {
    return `/participants/${d.participant_id}/timeline`;
  }
  if (d.kind === 'alert') return '/alerts';
  if (d.kind === 'event') return '/timeline';
  return '/alerts';
}

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

export async function registerForPushNotifications(): Promise<string | null> {
  // Skip on web (Expo Go web doesn't support native push)
  if (Platform.OS === 'web') return null;
  if (!Device.isDevice) {
    // Simulators don't get real tokens — skip silently
    return null;
  }

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'Wayly alerts',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: Colors.brandPrimary,
    });
  }

  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;

  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }

  if (finalStatus !== 'granted') return null;

  try {
    // expo-notifications will pull projectId from app.json automatically
    const tokenData = await Notifications.getExpoPushTokenAsync();
    const token = tokenData.data;

    // Send to backend (best-effort — non-blocking)
    try {
      await api.post('/notifications/register-push', {
        expo_push_token: token,
        platform: Platform.OS,
      });
      lastRegisteredToken = token;
    } catch {
      // ignore — backend may not have this endpoint configured yet
    }
    return token;
  } catch {
    return null;
  }
}

/**
 * Phase 3 hardening: invalidate the device's push token server-side on
 * logout. Best-effort + non-blocking — failure should never block the user
 * from signing out. We also clear the in-memory token cache so a subsequent
 * login on the same device re-registers cleanly.
 */
export async function unregisterPushNotifications(): Promise<void> {
  if (Platform.OS === 'web') return;
  const token = lastRegisteredToken;
  if (!token) return;
  try {
    await api.delete('/notifications/register-push', {
      data: { expo_push_token: token },
    });
  } catch {
    // ignore — token may already be invalidated server-side
  } finally {
    lastRegisteredToken = null;
  }
}
