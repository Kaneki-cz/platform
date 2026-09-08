import { Tabs } from 'expo-router';
import React from 'react';
import { Image } from 'react-native';

import { AppTabBar } from '@/components/AppTabBar';
import { useLanguage } from '@/context/LanguageContext';
import { colors } from '@/constants/theme';

// Custom gradient line-art icon set (cyan -> indigo/violet, matching the
// app's cosmic theme — see constants/theme.ts) replacing the old plain
// emoji tab icons. Dimmed rather than re-tinted when inactive, since a
// tintColor swap would flatten each icon's gradient to a single flat
// color and lose the whole point of the new set.
const ICONS = {
  home: require('@/assets/icons/tab-home.png'),
  courses: require('@/assets/icons/tab-courses.png'),
  omega: require('@/assets/icons/tab-omega.png'),
  profile: require('@/assets/icons/tab-profile.png'),
};

function TabIcon({ source, focused }: { source: number; focused: boolean }) {
  return (
    <Image
      source={source}
      style={{ width: 26, height: 26, opacity: focused ? 1 : 0.45 }}
      resizeMode="contain"
    />
  );
}

// "Omega" is this app's AI Assistant brand name/wordmark (see the tab's own
// logo above) — kept as-is in both languages rather than translated, the
// same way a product name normally would be.
const TITLES = {
  ar: { home: 'الرئيسية', courses: 'الكورسات', assistant: 'Omega', profile: 'حسابي' },
  en: { home: 'Home', courses: 'Courses', assistant: 'Omega', profile: 'Profile' },
};

export default function TabsLayout() {
  const { language } = useLanguage();
  const t = TITLES[language];

  return (
    <Tabs
      // AppTabBar (a floating pill-shaped bar with a gradient-tinted active
      // capsule — see that file's own comment) fully replaces the default
      // flat rectangular tab bar; tabBarStyle/tabBar*TintColor options don't
      // apply to it and are omitted rather than left dead here.
      tabBar={(props) => <AppTabBar {...props} />}
      screenOptions={{
        headerStyle: { backgroundColor: colors.surface },
        headerTintColor: colors.text,
        headerTitleStyle: { color: colors.text },
        headerShadowVisible: false,
      }}>
      <Tabs.Screen
        name="index"
        options={{ title: t.home, tabBarIcon: ({ focused }) => <TabIcon source={ICONS.home} focused={focused} /> }}
      />
      <Tabs.Screen
        name="courses"
        options={{
          title: t.courses,
          tabBarIcon: ({ focused }) => <TabIcon source={ICONS.courses} focused={focused} />,
        }}
        listeners={({ navigation }) => ({
          tabPress: () => {
            // Without this, the Courses tab reopens wherever you last
            // drilled into (a nested Stack keeps its own history per tab),
            // which reads as "stuck on one chapter forever" after a few
            // sessions — jump back to the Subjects list every time the tab
            // is tapped, same as most apps' "tap active tab to go to top".
            navigation.navigate('courses', { screen: 'index' });
          },
        })}
      />
      <Tabs.Screen
        name="assistant"
        options={{ title: t.assistant, tabBarIcon: ({ focused }) => <TabIcon source={ICONS.omega} focused={focused} /> }}
      />
      <Tabs.Screen
        name="profile"
        options={{ title: t.profile, tabBarIcon: ({ focused }) => <TabIcon source={ICONS.profile} focused={focused} /> }}
      />
    </Tabs>
  );
}
