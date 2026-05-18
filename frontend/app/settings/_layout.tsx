import { Stack } from 'expo-router';
import { Colors, Fonts } from '../../src/lib/theme';

export default function SettingsLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: Colors.background },
        headerTintColor: Colors.brandPrimary,
        headerTitleStyle: { fontFamily: Fonts.headingMed, fontSize: 17 },
        headerBackTitle: 'Back',
        contentStyle: { backgroundColor: Colors.background },
      }}
    >
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="plan" options={{ title: 'Plan & Billing' }} />
      <Stack.Screen name="members" options={{ title: 'Family members' }} />
      <Stack.Screen name="security" options={{ title: 'Security' }} />
      <Stack.Screen name="notifications" options={{ title: 'Notifications' }} />
      <Stack.Screen name="usage" options={{ title: 'Your usage' }} />
    </Stack>
  );
}
