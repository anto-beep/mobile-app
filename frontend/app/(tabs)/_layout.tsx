import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Fonts } from '../../src/lib/theme';
import { TabScrollBus } from '../../src/lib/tabScrollBus';

// Phase B \u2014 5-tab bottom nav.
// Dashboard \u00b7 Family wall \u00b7 Statements \u00b7 Tools \u00b7 More
// All other historical screens (chat, family v1, profile, notifications)
// are still routable, just hidden from the tab bar.
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
        tabBarLabelStyle: { fontFamily: Fonts.bodyMed, fontSize: 11, marginBottom: 4 },
      }}
    >
      <Tabs.Screen
        name="today"
        listeners={{ tabPress: () => TabScrollBus.publish('today') }}
        options={{
          title: 'Dashboard',
          tabBarTestID: 'tabbar-dashboard',
          tabBarIcon: ({ color, size }) => <Ionicons name="grid-outline" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="family"
        listeners={{ tabPress: () => TabScrollBus.publish('family') }}
        options={{
          title: 'Family wall',
          tabBarTestID: 'tabbar-family-wall',
          tabBarIcon: ({ color, size }) => <Ionicons name="people-circle-outline" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="statements"
        listeners={{ tabPress: () => TabScrollBus.publish('statements') }}
        options={{
          title: 'Statements',
          tabBarTestID: 'tabbar-statements',
          tabBarIcon: ({ color, size }) => <Ionicons name="document-text-outline" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="tools"
        listeners={{ tabPress: () => TabScrollBus.publish('tools') }}
        options={{
          title: 'Tools',
          tabBarTestID: 'tabbar-tools',
          tabBarIcon: ({ color, size }) => <Ionicons name="sparkles-outline" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="more"
        listeners={{ tabPress: () => TabScrollBus.publish('more') }}
        options={{
          title: 'More',
          tabBarTestID: 'tabbar-more',
          tabBarIcon: ({ color, size }) => <Ionicons name="grid" size={size} color={color} />,
        }}
      />
      {/* Off-tabbar but still reachable via deep-links / drawer */}
      <Tabs.Screen name="chat" options={{ href: null }} />
      <Tabs.Screen name="profile" options={{ href: null }} />
      <Tabs.Screen name="notifications" options={{ href: null }} />
    </Tabs>
  );
}
