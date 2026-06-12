// Push → deep-link bridge.
//
// When the user taps a Wayly push notification, expo-notifications fires
// `addNotificationResponseReceivedListener`. We extract the payload's
// `data` block, resolve it to a native route via `resolvePushDestination`,
// and ask the router to navigate. Also handles the cold-start case where
// the app was launched FROM a notification.
//
// Drop <PushDeepLinkListener /> high in the tree once (alongside
// DeepLinkHandler in app/_layout.tsx).
import { useEffect } from 'react';
import { useRouter } from 'expo-router';
import * as Notifications from 'expo-notifications';
import { resolvePushDestination } from '../lib/push';

export function PushDeepLinkListener() {
  const router = useRouter();

  useEffect(() => {
    let mounted = true;

    // Cold-start: did the app open from tapping a push?
    Notifications.getLastNotificationResponseAsync()
      .then((resp) => {
        if (!mounted || !resp) return;
        const data = (resp.notification.request.content.data || {}) as Record<string, any>;
        const dest = resolvePushDestination(data);
        if (dest) router.push(dest as any);
      })
      .catch(() => {});

    // Foreground / background taps.
    const sub = Notifications.addNotificationResponseReceivedListener((resp) => {
      const data = (resp.notification.request.content.data || {}) as Record<string, any>;
      const dest = resolvePushDestination(data);
      if (dest) router.push(dest as any);
    });

    return () => { mounted = false; sub.remove(); };
  }, [router]);

  return null;
}
