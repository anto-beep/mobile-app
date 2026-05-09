import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Fonts } from '../../src/lib/theme';

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: Colors.brandPrimary,
        tabBarInactiveTintColor: Colors.textMuted,
        tabBarStyle: {
          backgroundColor: Colors.cardBg,
          borderTopColor: Colors.border,
          borderTopWidth: 1,
          paddingTop: 6,
          height: 84,
        },
        tabBarLabelStyle: {
          fontFamily: Fonts.bodyMed,
          fontSize: 11,
          marginBottom: 4,
        },
      }}
    >
      <Tabs.Screen
        name="today"
        options={{
          title: 'Today',
          tabBarIcon: ({ color, size }) => <Ionicons name="sunny-outline" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="statements"
        options={{
          title: 'Statements',
          tabBarIcon: ({ color, size }) => <Ionicons name="document-text-outline" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="notifications"
        options={{
          title: 'Alerts',
          tabBarIcon: ({ color, size }) => <Ionicons name="notifications-outline" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          tabBarIcon: ({ color, size }) => <Ionicons name="person-circle-outline" size={size} color={color} />,
        }}
      />
    </Tabs>
  );
}
