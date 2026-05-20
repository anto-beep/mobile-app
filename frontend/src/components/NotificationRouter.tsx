// NotificationRouter
// ----------------------------------------------------------------------------
// Wires native push notification taps to in-app routes.
//
// 1. Registers the device's Expo push token with the backend (idempotent).
// 2. On a tap (foreground OR cold-start) reads `data.type` / `data.deeplink`
//    out of the notification payload and `router.push`-es to the right screen.
// 3. Caches the last-handled response.id so we never route twice for the same
//    notification (cold-start + foreground listener can both fire).
//
// Backend contract (server.py · _push_to_user / NotificationItem):
//   data: {
//     type: "statement_ready" | "anomaly_alert" | "visit_reminder"
//         | "family_message" | "wellbeing" | "adviser_invite_linked"
//         | "billing" | "system",
//     deeplink?: string,           // server-controlled override
//     statement_id?: string,
//     visit_id?: string,
//     client_id?: string,
//     notification_id?: string,
//   }
import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { useRouter } from 'expo-router';
import { useAuth } from '../context/AuthContext';
import { registerForPushNotifications } from '../lib/push';

type NotifData = {
  type?: string;
  deeplink?: string;
  statement_id?: string;
  visit_id?: string;
  client_id?: string;
  notification_id?: string;
};

function resolveRoute(data: NotifData): string | null {
  if (!data || typeof data !== 'object') return null;
  // 1) Server-controlled explicit deeplink wins.
  if (data.deeplink && typeof data.deeplink === 'string' && data.deeplink.startsWith('/')) {
    return data.deeplink;
  }
  // 2) Fallback to type-based routing.
  switch (data.type) {
    case 'statement_ready':
    case 'anomaly_alert':
      return data.statement_id ? `/statements/${data.statement_id}` : '/(tabs)/today';
    case 'visit_reminder':
      return '/visits';
    case 'family_message':
      return '/(tabs)/family';
    case 'wellbeing':
      return '/(tabs)/notifications';
    case 'adviser_invite_linked':
      return data.client_id ? `/adviser/clients/${data.client_id}` : '/adviser';
    case 'billing':
      return '/settings/plan';
    case 'system':
      return '/(tabs)/notifications';
    default:
      return '/(tabs)/notifications';
  }
}

export function NotificationRouter() {
  const { user } = useAuth();
  const router = useRouter();
  const handledRef = useRef<Set<string>>(new Set());

  // (1) Register the push token whenever a user signs in (no-op on web / Expo Go simulators).
  useEffect(() => {
    if (!user) return;
    registerForPushNotifications().catch(() => {
      // swallow — push is best-effort; we shouldn't block the app on it.
    });
  }, [user?.id]);

  // (2) Wire response listener + cold-start handler. Native only — expo-notifications
  // is a no-op on web so guard early to avoid noisy warnings in dev.
  useEffect(() => {
    if (Platform.OS === 'web') return;

    let mounted = true;

    const handleResponse = (response: Notifications.NotificationResponse) => {
      if (!mounted) return;
      try {
        const id = response?.notification?.request?.identifier;
        if (id && handledRef.current.has(id)) return;
        if (id) handledRef.current.add(id);
        const data = (response?.notification?.request?.content?.data || {}) as NotifData;
        const route = resolveRoute(data);
        if (route) router.push(route as any);
      } catch {
        // ignore malformed payloads
      }
    };

    // Cold-start: app launched FROM a tapped notification.
    Notifications.getLastNotificationResponseAsync()
      .then((resp) => {
        if (resp) handleResponse(resp);
      })
      .catch(() => {});

    // Foreground/background: tap on a notification while the app is alive.
    const sub = Notifications.addNotificationResponseReceivedListener(handleResponse);

    return () => {
      mounted = false;
      sub.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}

export default NotificationRouter;
