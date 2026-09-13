import type { ImageSourcePropType } from 'react-native';

/** Plain white line-art icons on a transparent background, meant to be
 * recolored per use-site via <Image style={{ tintColor }}> — React Native
 * treats every opaque pixel of a local image as "paint this in tintColor"
 * and ignores the source color, so ONE asset per icon covers every hue it
 * needs to appear in (a KPI tile's accent, a chapter badge's color, a
 * warning tint, etc) instead of a baked-color PNG per combination. Each was
 * rasterized from a hand-drawn SVG by /tmp/gen_dashboard_icons.py,
 * specifically so this ships as a pure asset/JS change via `eas update` —
 * same reasoning as lib/subjectIcon.ts's Direction-B badges: no
 * react-native-svg dependency, no forced `eas build`. */
export const icons = {
  layers: require('../assets/dashboard-icons/layers.png') as ImageSourcePropType,
  playCircle: require('../assets/dashboard-icons/play-circle.png') as ImageSourcePropType,
  barChart: require('../assets/dashboard-icons/bar-chart.png') as ImageSourcePropType,
  shieldCheck: require('../assets/dashboard-icons/shield-check.png') as ImageSourcePropType,
  bolt: require('../assets/dashboard-icons/bolt.png') as ImageSourcePropType,
  magnet: require('../assets/dashboard-icons/magnet.png') as ImageSourcePropType,
  coil: require('../assets/dashboard-icons/coil.png') as ImageSourcePropType,
  circuit: require('../assets/dashboard-icons/circuit.png') as ImageSourcePropType,
  genericChapter: require('../assets/dashboard-icons/generic-chapter.png') as ImageSourcePropType,
  eye: require('../assets/dashboard-icons/eye.png') as ImageSourcePropType,
  warningTriangle: require('../assets/dashboard-icons/warning-triangle.png') as ImageSourcePropType,
};

/** Picks a chapter-topic icon from its title — same keyword-matching spirit
 * as lib/subjectIcon.ts, just answering "which physics topic is this
 * chapter about" instead of "which subject". Order matters: a few titles
 * match more than one keyword set (e.g. "الحث الكهرومغناطيسي" contains
 * both "حث" and, via "كهرومغناطيسي", "مغناطيس"), so the more specific/
 * intended category is checked first. Falls back to a plain document icon
 * for anything that matches none of these (a chapter titled just "Chapter
 * 5", a non-electricity topic, etc). */
export function chapterTopicIcon(title: string): ImageSourcePropType {
  const t = title.toLowerCase();
  const has = (...keywords: string[]) => keywords.some((k) => t.includes(k));
  if (has('دائرة', 'دوائر', 'متقدم')) return icons.circuit;
  if (has('حث', 'ملف', 'مكثف', 'مواسع')) return icons.coil;
  if (has('مجال', 'مغناطيس')) return icons.magnet;
  if (has('تيار')) return icons.bolt;
  return icons.genericChapter;
}
