import { Stack } from 'expo-router';

import { colors } from '@/constants/theme';

export default function AdminLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.surface },
        headerTintColor: colors.text,
        headerTitleStyle: { color: colors.text },
        headerShadowVisible: false,
        contentStyle: { backgroundColor: colors.background },
      }}>
      <Stack.Screen name="index" options={{ title: 'Manage Content' }} />
      <Stack.Screen name="create-subject" options={{ title: 'New Subject', presentation: 'modal' }} />
      <Stack.Screen name="instructors" options={{ title: 'Instructors' }} />
      <Stack.Screen name="users" options={{ title: 'AI Question Limits' }} />
      <Stack.Screen name="video-views" options={{ title: 'Video View Limits' }} />
      <Stack.Screen name="subject/[id]" options={{ title: 'Chapters' }} />
      <Stack.Screen name="course/[id]/index" options={{ title: 'Lectures' }} />
      <Stack.Screen name="course/[id]/exams" options={{ title: 'Exams' }} />
      <Stack.Screen name="lesson/[id]" options={{ title: 'Quiz Questions' }} />
      <Stack.Screen name="exam/[id]" options={{ title: 'Exam Questions' }} />
    </Stack>
  );
}
