// Admin auth Stack
import { Stack } from 'expo-router';
import { Colors } from '../../src/lib/theme';

export default function AdminAuthLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: Colors.background },
      }}
    />
  );
}
