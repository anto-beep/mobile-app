import { Stack } from 'expo-router';
import { Colors } from '../../src/lib/theme';

export default function AdviserLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: Colors.background },
        headerTintColor: Colors.brandPrimary,
        headerBackTitle: 'Back',
        contentStyle: { backgroundColor: Colors.background },
      }}
    >
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="clients/[cid]" options={{ title: 'Client snapshot' }} />
    </Stack>
  );
}
