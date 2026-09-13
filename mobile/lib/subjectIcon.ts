import type { ImageSourcePropType } from 'react-native';

/** Subject has no icon field of its own (just id/name/order_index), so the
 * icon is picked from the subject's own name — a keyword match against both
 * the Arabic and English spellings admins actually use, with a generic
 * "graduation cap" badge as the fallback for anything else (a new language,
 * "Earth Science", whatever an admin names their next subject). Shared by
 * every screen that shows a subject icon (the admin "Manage Content" list,
 * the student "Courses" tab, and any chapter-cover placeholder that wants to
 * show its parent subject's icon) so they can never drift out of sync with
 * each other again.
 *
 * 2026-09 redesign: these used to be plain emoji strings. They're now
 * pre-rendered "duotone badge" PNGs (radial-gradient circle background +
 * custom line-art icon, each baked in at export time by
 * /tmp/gen_subject_icons.py) — picked over live SVG rendering specifically
 * so this ships as a pure asset/JS change via `eas update`, without adding
 * react-native-svg as a new native dependency (which would force a full
 * `eas build` + reinstall). Each PNG already contains its own colored badge
 * background, so render it close to 1:1 — don't wrap it in another tinted
 * circle/gradient, that was the old emoji-era styling. */
export type SubjectIconKey =
  | 'physics'
  | 'chemistry'
  | 'biology'
  | 'math'
  | 'arabic'
  | 'english'
  | 'geography'
  | 'history'
  | 'geology'
  | 'generic';

function subjectIconKey(name: string): SubjectIconKey {
  const n = name.toLowerCase();
  const has = (...keywords: string[]) => keywords.some((k) => n.includes(k));
  if (has('physic', 'فيزياء', 'فيزيا')) return 'physics';
  if (has('chem', 'كيمياء', 'كيميا')) return 'chemistry';
  if (has('bio', 'أحياء', 'احياء')) return 'biology';
  if (has('math', 'رياضيات')) return 'math';
  if (has('arabic', 'لغة عربية', 'عربي')) return 'arabic';
  if (has('english', 'انجليز', 'إنجليز')) return 'english';
  if (has('geology', 'جيولوجيا')) return 'geology';
  if (has('geography', 'جغرافيا')) return 'geography';
  if (has('history', 'تاريخ')) return 'history';
  return 'generic';
}

// Metro's bundler resolves require() at build time and needs a literal
// string argument for each one — it can't follow a dynamically-built path
// like `require(`../assets/subject-icons/${key}.png`)`. So this has to be a
// flat map of literal require() calls, not a template computed from the key.
const ICONS: Record<SubjectIconKey, ImageSourcePropType> = {
  physics: require('../assets/subject-icons/physics.png'),
  chemistry: require('../assets/subject-icons/chemistry.png'),
  biology: require('../assets/subject-icons/biology.png'),
  math: require('../assets/subject-icons/math.png'),
  arabic: require('../assets/subject-icons/arabic.png'),
  english: require('../assets/subject-icons/english.png'),
  geography: require('../assets/subject-icons/geography.png'),
  history: require('../assets/subject-icons/history.png'),
  geology: require('../assets/subject-icons/geology.png'),
  generic: require('../assets/subject-icons/generic.png'),
};

/** The Direction-B "duotone badge" icon image for a subject, picked from its
 * name. Use as an <Image source={subjectIconSource(name)} /> — it's a square
 * image with a circular badge already baked into it (transparent corners),
 * so it can be dropped straight into a plain square/circle-shaped Image
 * without any extra background wrapper. */
export function subjectIconSource(name: string): ImageSourcePropType {
  return ICONS[subjectIconKey(name)];
}
