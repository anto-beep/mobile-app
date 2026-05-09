import { Redirect } from 'expo-router';

// Root entry — redirect to either auth or tabs based on auth state (handled in _layout)
export default function Index() {
  return <Redirect href="/(tabs)/today" />;
}
