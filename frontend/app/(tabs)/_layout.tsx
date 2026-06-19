import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Fonts, getColors } from '../../src/lib/theme';
import { useTheme } from '../../src/context/ThemeContext';
import { TabScrollBus } from '../../src/lib/tabScrollBus';

export default function TabsLayout() {
  const { effective } = useTheme();
  const c = getColors(effective);
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: c.brandPrimary,
        tabBarInactiveTintColor: c.textMuted,
        tabBarStyle: {
          backgroundColor: c.cardBg,
          borderTopColor: c.border,
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
