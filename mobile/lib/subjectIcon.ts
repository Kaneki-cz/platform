/** Subject has no icon field of its own (just id/name/order_index), so the
 * icon is picked from the subject's own name — a keyword match against both
 * the Arabic and English spellings admins actually use, with a plain book
 * as the fallback for anything else (a new language, "Earth Science",
 * whatever an admin names their next subject). Shared by every screen that
 * shows a subject icon (the admin "Manage Content" list, the student
 * "Courses" tab, and any chapter-cover placeholder that wants to show its
 * parent subject's icon) so they can never drift out of sync with each
 * other again. */
export function subjectIcon(name: string): string {
  const n = name.toLowerCase();
  const has = (...keywords: string[]) => keywords.some((k) => n.includes(k));
  if (has('physic', 'فيزياء', 'فيزيا')) return '⚛️';
  if (has('chem', 'كيمياء', 'كيميا')) return '🧪';
  if (has('bio', 'أحياء', 'احياء')) return '🧬';
  if (has('math', 'رياضيات')) return '📐';
  if (has('arabic', 'لغة عربية', 'عربي')) return '📖';
  if (has('english', 'انجليز', 'إنجليز')) return '🔤';
  if (has('geology', 'جيولوجيا')) return '🌋';
  if (has('geography', 'جغرافيا')) return '🗺️';
  if (has('history', 'تاريخ')) return '🏛️';
  return '📚';
}
