import { LinearGradient } from 'expo-linear-gradient';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import { ResolvedImage } from '@/components/ResolvedImage';
import { getSubject, listTeachers } from '@/lib/api';
import { useLanguage } from '@/context/LanguageContext';
import { cardShadow, colors, radius, spacing } from '@/constants/theme';
import { GRADE_LEVELS, type Course, type GradeLevel, type SubjectDetail, type Teacher } from '@/lib/types';

// Shared brand-gradient stops (cyan -> violet, see constants/theme.ts) reused
// for the teacher avatar "story ring" and the course-card number badge below —
// 2026 redesign pass.
const ACCENT_GRADIENT = [colors.primary, colors.violet] as const;
// Bottom-of-cover scrim on course posters — matches colors.background (#05070C)
// faded to transparent, so cover art fades into a dark footer that the title
// badge sits on top of instead of a hard line.
const SCRIM_GRADIENT = ['transparent', 'rgba(5, 7, 12, 0.92)'] as const;

const STRINGS = {
  ar: {
    empty: 'مفيش فصول هنا لسه — تابعنا قريب.',
    chooseTeacher: 'اختر المدرس',
    chooseGrade: 'اختر الصف الدراسي',
    changeTeacher: 'تغيير المدرس',
    changeGrade: 'تغيير الصف',
    noChaptersForGrade: 'مفيش فصول لهذا الصف لسه.',
  },
  en: {
    empty: 'No chapters here yet — check back soon.',
    chooseTeacher: 'Choose a teacher',
    chooseGrade: 'Choose your grade',
    changeTeacher: 'Change teacher',
    changeGrade: 'Change grade',
    noChaptersForGrade: 'No chapters for this grade yet.',
  },
};

export default function SubjectCoursesScreen() {
  const { subjectId } = useLocalSearchParams<{ subjectId: string }>();
  const router = useRouter();
  const { language } = useLanguage();
  const t = STRINGS[language];
  const [subject, setSubject] = useState<SubjectDetail | null>(null);
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  // Tracks whether the teachers request has actually come back yet — separate
  // from `teachers` itself, whose initial `[]` is indistinguishable from "this
  // subject genuinely has no teacher cards". Without this, there was a window
  // on every load where `teachers` was still `[]` (request in flight) so
  // useTeacherFlow read as false and the screen rendered the flat, UNFILTERED
  // course list — briefly showing every teacher's chapters together — before
  // snapping to the correct teacher-picker view once the request resolved.
  // Gating on this instead closes that window.
  const [teachersLoaded, setTeachersLoaded] = useState(false);
  const [selectedTeacher, setSelectedTeacher] = useState<Teacher | null>(null);
  const [selectedGrade, setSelectedGrade] = useState<GradeLevel | null>(null);

  // useFocusEffect (not useEffect) so a chapter added/edited elsewhere shows
  // up here as soon as you navigate back, without a full app reload.
  useFocusEffect(
    useCallback(() => {
      if (!subjectId) return;
      setTeachersLoaded(false);
      getSubject(subjectId).then(setSubject).catch(() => {});
      listTeachers(subjectId)
        .then(setTeachers)
        .catch(() => setTeachers([]))
        .finally(() => setTeachersLoaded(true));
    }, [subjectId]),
  );

  // Reset the teacher/grade picks whenever the subject changes (e.g.
  // navigating Physics -> back -> Chemistry re-uses this same screen).
  const resetKey = subjectId;
  const [lastResetKey, setLastResetKey] = useState(resetKey);
  if (resetKey !== lastResetKey) {
    setLastResetKey(resetKey);
    setSelectedTeacher(null);
    setSelectedGrade(null);
  }

  const filteredCourses = useMemo(() => {
    if (!subject) return [];
    if (!selectedTeacher) return subject.courses;
    return subject.courses.filter((c) => c.teacher_id === selectedTeacher.id && c.grade_level === selectedGrade);
  }, [subject, selectedTeacher, selectedGrade]);

  if (!subject || !teachersLoaded) return null;

  // Subjects that haven't set up any teacher cards yet keep the original
  // flat chapter list — this is what makes the feature backward-compatible
  // with chapters created before it existed (see migrate_v6's nullable
  // teacher_id/grade_level columns).
  const useTeacherFlow = teachers.length > 0;

  return (
    <View style={styles.container}>
      <Text style={styles.title}>{subject.name}</Text>

      {useTeacherFlow && !selectedTeacher ? (
        <TeacherGrid teachers={teachers} onSelect={setSelectedTeacher} label={t.chooseTeacher} />
      ) : useTeacherFlow && !selectedGrade ? (
        <View style={{ flex: 1 }}>
          <Pressable onPress={() => setSelectedTeacher(null)} hitSlop={8}>
            <Text style={styles.backLink}>← {t.changeTeacher}</Text>
          </Pressable>
          <Text style={styles.stepLabel}>{t.chooseGrade}</Text>
          <View style={styles.gradeChips}>
            {GRADE_LEVELS.map((g) => (
              <Pressable
                key={g}
                style={({ pressed }) => [styles.gradeChip, pressed && styles.pressed]}
                onPress={() => setSelectedGrade(g)}
              >
                <Text style={styles.gradeChipText}>{g}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      ) : (
        <View style={{ flex: 1 }}>
          {useTeacherFlow ? (
            <Pressable onPress={() => setSelectedGrade(null)} hitSlop={8}>
              <Text style={styles.backLink}>← {t.changeGrade}</Text>
            </Pressable>
          ) : null}
          <CourseGrid
            courses={filteredCourses}
            emptyText={useTeacherFlow ? t.noChaptersForGrade : t.empty}
            onSelect={(course) => router.push(`/(tabs)/courses/${subjectId}/${course.id}`)}
          />
        </View>
      )}
    </View>
  );
}

function TeacherGrid({ teachers, onSelect, label }: { teachers: Teacher[]; onSelect: (t: Teacher) => void; label: string }) {
  return (
    <FlatList
      data={teachers}
      keyExtractor={(t) => t.id}
      numColumns={3}
      key="teachers-3col"
      contentContainerStyle={{ paddingTop: spacing.md }}
      ListHeaderComponent={<Text style={styles.stepLabel}>{label}</Text>}
      renderItem={({ item }) => (
        <Pressable style={({ pressed }) => [styles.teacherCard, pressed && styles.pressed]} onPress={() => onSelect(item)}>
          {/* Gradient "story ring" around the photo (2026 redesign pass) —
              approximates the mockup's conic-gradient ring using a linear
              gradient, since expo-linear-gradient only does linear fills. */}
          <LinearGradient colors={ACCENT_GRADIENT} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.avatarRing}>
            <View style={styles.avatarInner}>
              <ResolvedImage
                url={item.photo_url}
                style={styles.teacherPhoto}
                containerStyle={styles.teacherPhoto}
                fallback={
                  <View style={[styles.teacherPhoto, styles.photoPlaceholder]}>
                    <Text style={styles.photoPlaceholderText}>👤</Text>
                  </View>
                }
              />
            </View>
          </LinearGradient>
          <Text style={styles.teacherName} numberOfLines={2}>
            {item.name}
          </Text>
        </Pressable>
      )}
    />
  );
}

function CourseGrid({
  courses,
  emptyText,
  onSelect,
}: {
  courses: Course[];
  emptyText: string;
  onSelect: (c: Course) => void;
}) {
  // A single chapter shouldn't be squeezed into a half-width grid cell (the
  // poster cover would get cropped hard on the sides and read as "cut off")
  // — fall back to one full-width column when there's only one (or zero)
  // course to show. FlatList requires a `key` change (not just a numColumns
  // change) to actually re-layout when this switches — see RN's own
  // "Changing numColumns on the fly is not supported" warning.
  const columns = courses.length <= 1 ? 1 : 2;
  return (
    <FlatList
      data={courses}
      keyExtractor={(c) => c.id}
      numColumns={columns}
      key={`courses-${columns}col`}
      contentContainerStyle={{ paddingTop: spacing.md }}
      columnWrapperStyle={columns > 1 ? { gap: spacing.sm } : undefined}
      renderItem={({ item, index }) => (
        <Pressable style={({ pressed }) => [styles.courseCard, pressed && styles.pressed]} onPress={() => onSelect(item)}>
          {/* Poster-style cover (2026 redesign pass): cover art fills the
              card, a bottom scrim keeps the number badge legible over any
              image, and the badge replaces the old "{index+1}. " text
              prefix. Deliberately no progress indicator here — Course has no
              progress field at this list level (only per-lesson, via a
              separate call on the chapter screen), so faking one here would
              be a functionality change, not a design one. */}
          <View style={[styles.courseCoverWrap, columns === 1 && styles.courseCoverWrapWide]}>
            <ResolvedImage
              url={item.cover_image_url}
              style={styles.courseCover}
              containerStyle={styles.courseCover}
              // 'contain' (not the default 'cover') — a cover art image whose
              // aspect ratio doesn't exactly match this card's box (especially
              // the single-full-width "wide" card, see courseCoverWrapWide)
              // was getting its edges cropped off under 'cover'. This
              // letterboxes onto the surfaceAlt background behind it instead,
              // so the whole picture always stays visible.
              resizeMode="contain"
              fallback={
                <View style={[styles.courseCover, styles.photoPlaceholder]}>
                  <Text style={styles.photoPlaceholderText}>📘</Text>
                </View>
              }
            />
            <LinearGradient colors={SCRIM_GRADIENT} style={styles.courseScrim} pointerEvents="none" />
            <LinearGradient
              colors={ACCENT_GRADIENT}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.courseBadge}
            >
              <Text style={styles.courseBadgeText}>{index + 1}</Text>
            </LinearGradient>
          </View>
          <Text style={styles.courseTitle} numberOfLines={2}>
            {item.title}
          </Text>
          {item.description ? (
            <Text style={styles.courseDescription} numberOfLines={2}>
              {item.description}
            </Text>
          ) : null}
        </Pressable>
      )}
      ListEmptyComponent={<Text style={styles.empty}>{emptyText}</Text>}
    />
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, padding: spacing.xl },
  title: { fontSize: 22, fontWeight: '700', color: colors.text },
  stepLabel: { fontSize: 15, fontWeight: '600', color: colors.textMuted, marginBottom: spacing.sm, marginTop: spacing.sm },
  backLink: { color: colors.primary, fontWeight: '600', marginTop: spacing.md },
  pressed: { opacity: 0.85 },

  teacherCard: {
    flex: 1 / 3,
    alignItems: 'center',
    padding: spacing.sm,
    marginBottom: spacing.md,
  },
  avatarRing: {
    width: 76,
    height: 76,
    borderRadius: 38,
    padding: 3,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xs,
  },
  avatarInner: {
    width: 70,
    height: 70,
    borderRadius: 35,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  teacherPhoto: { width: 64, height: 64, borderRadius: 32, backgroundColor: colors.surfaceAlt },
  teacherName: { color: colors.text, fontSize: 13, fontWeight: '600', textAlign: 'center' },

  // 2-column pill grid (2026 redesign pass) — was a full-width vertical
  // stack. Grade labels are long real strings (e.g. "الصف الثاني الثانوي -
  // بكالوريا"), so chips get a generous minHeight and let text wrap to two
  // lines rather than truncating.
  gradeChips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm },
  gradeChip: {
    width: '48%',
    minHeight: 64,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    ...cardShadow,
  },
  gradeChipText: { color: colors.text, fontWeight: '600', textAlign: 'center', fontSize: 13 },

  courseCard: {
    flex: 1,
    padding: spacing.sm,
    marginBottom: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    ...cardShadow,
  },
  courseCoverWrap: {
    width: '100%',
    height: 140,
    borderRadius: radius.sm,
    overflow: 'hidden',
    marginBottom: spacing.xs,
    backgroundColor: colors.surfaceAlt,
  },
  // Taller poster when it's the only card on the row (see `columns` above) —
  // a full-width card at the normal 140px height reads as squat/stretched.
  courseCoverWrapWide: { height: 200 },
  courseCover: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  courseScrim: { position: 'absolute', left: 0, right: 0, bottom: 0, height: '55%' },
  courseBadge: {
    position: 'absolute',
    left: spacing.xs,
    bottom: spacing.xs,
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  courseBadgeText: { color: colors.onPrimary, fontSize: 12, fontWeight: '700' },
  photoPlaceholder: { alignItems: 'center', justifyContent: 'center' },
  photoPlaceholderText: { fontSize: 24 },
  courseTitle: { fontSize: 14, fontWeight: '600', color: colors.text },
  courseDescription: { color: colors.textMuted, fontSize: 12, marginTop: 2 },

  empty: { color: colors.textFaint, textAlign: 'center', marginTop: 40 },
});
