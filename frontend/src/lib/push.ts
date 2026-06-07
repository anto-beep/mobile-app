import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { Platform } from 'react-native';
import { api } from './api';
import { Colors } from './theme';

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
    } catch {
      // ignore — backend may not have this endpoint configured yet
    }
    return token;
  } catch {
    return null;
  }
}
