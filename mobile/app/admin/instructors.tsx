import { useEffect } from 'react';
import { useRouter } from 'expo-router';

/**
 * Deprecated 2026-09 — instructor assignment used to be subject-wide
 * (assignInstructor/unassignInstructor against SubjectInstructor) and lived
 * on its own screen reached from the admin home screen's "Manage
 * Instructors" button. That's gone: an instructor's edit access is now
 * scoped to specific chapters via a teacher card they're linked to (see
 * backend/app/models/teacher.py's user_id) — linking/unlinking an account
 * now happens right on that teacher's card in app/admin/subject/[id].tsx
 * (tap a teacher card to edit it, then use the "Instructor account"
 * section there).
 *
 * This file is kept only so an old bookmark/deep link to /admin/instructors
 * doesn't hit a broken screen — it just bounces straight back to the admin
 * home screen instead.
 */
export default function DeprecatedInstructorsScreen() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/admin');
  }, [router]);
  return null;
}
