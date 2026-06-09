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
        headerShown: false, // every screen has its own BackHeader
      }}
    >
      <Stack.Screen name="index" />
      <Stack.Screen name="profile" />
      <Stack.Screen name="plan" />
      <Stack.Screen name="members" />
      <Stack.Screen name="security" />
      <Stack.Screen name="notifications" />
      <Stack.Screen name="sms" />
      <Stack.Screen name="digest" />
      <Stack.Screen name="appearance" />
      <Stack.Screen name="usage" />
      <Stack.Screen name="reports" />
      <Stack.Screen name="danger" />
    </Stack>
  );
}
