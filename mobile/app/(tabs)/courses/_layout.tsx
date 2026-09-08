import { Stack } from 'expo-router';

import { colors } from '@/constants/theme';

export default function CoursesLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.surface },
        headerTintColor: colors.text,
        headerTitleStyle: { color: colors.text },
        headerShadowVisible: false,
        contentStyle: { backgroundColor: colors.background },
      }}>
      <Stack.Screen name="index" options={{ title: 'Subjects' }} />
      <Stack.Screen name="[subjectId]/index" options={{ title: 'Subject' }} />
      <Stack.Screen name="[subjectId]/[courseId]" options={{ title: 'Chapter' }} />
    </Stack>
  );
}
