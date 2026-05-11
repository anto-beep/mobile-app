// Admin section — Stack inside the Admin tab, guarded by RequireAdmin
import { Stack } from 'expo-router';
import { RequireAdmin } from '../../../src/components/RequireAdmin';
import { Colors } from '../../../src/lib/theme';

export default function AdminLayout() {
  return (
    <RequireAdmin>
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: Colors.background },
        }}
      />
    </RequireAdmin>
  );
}
