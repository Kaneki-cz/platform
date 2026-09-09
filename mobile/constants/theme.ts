/**
 * Shared design tokens for the app — "Cyan / Orange" space-tech dark theme,
 * chosen after comparing several palette directions against real screens
 * (chat bubbles, cards, buttons). Near-black surfaces, a bright electric-cyan
 * primary, and a warm orange accent for contrast — echoes the Ω icon's dark,
 * cosmic feel. Existing screens are being migrated to this file
 * incrementally; new screens should import from here rather than adding new
 * one-off colors.
 *
 * 2026 redesign pass: added `violet`/`violetDark` — this was already sitting
 * in the tab icons' own gradient (cyan -> indigo/violet, see the icon PNGs)
 * but had no token and was never reused anywhere else in the app. It's now
 * the second stop in the app's signature gradient (colors.gradientBrand)
 * used across the floating tab bar's active pill, primary CTAs, the login
 * mark, the assistant's user bubble, and the admin dashboard's main actions —
 * see each screen's own comment for where it's used. `surface` was also
 * deepened slightly (was #0F1420) so cards separate more clearly from the
 * new glass/blur surfaces introduced alongside it.
 */

export const colors = {
  // Brand
  primary: '#22D3EE', // bright electric cyan — actions, links, primary buttons
  primaryDark: '#06B6D4', // pressed/active state, gradients
  // Cyan is a *light* color, so plain white text/icons on a solid primary
  // button wash out — use this dark navy instead anywhere text/icons sit on
  // top of colors.primary (button labels, the profile avatar initial, a
  // selected chip's label, a spinner over a primary button, etc).
  onPrimary: '#04212B',
  accent: '#F97316', // warm orange highlight — badges, in-progress indicators, small emphasis touches
  accentDark: '#C2410C',
  violet: '#6D5DF6', // the tail color of the Omega icon's own gradient — see file comment above
  violetDark: '#4C3FCB',

  // Feedback
  success: '#22C55E',
  danger: '#F87171',
  dangerSurface: '#2B1116',

  // Text
  text: '#F1F5F9',
  textMuted: '#8B95A8',
  textFaint: '#5B6472',

  // Surfaces — layered near-black, slightly blue-tinted grays so
  // cards/inputs read as distinct elevation levels rather than flat
  // silhouettes.
  background: '#05070C',
  surface: '#10182B',
  surfaceAlt: '#161D2E',
  border: '#232C42',
} as const;

/** The app's signature brand gradient — cyan into violet, matching the tab
 * icons. Pass straight to <LinearGradient colors={colors.gradientBrand} .../>
 * for any "primary" surface: CTAs, the active tab pill, the login mark, the
 * assistant's own chat bubble, etc. Angle-wise this reads best roughly
 * left-to-right / top-left-to-bottom-right (start {x:0,y:0}, end {x:1,y:1}). */
export const gradientBrand = ['#22D3EE', '#6D5DF6'] as const;

/** App-wide type family — Cairo (Google Fonts), loaded in app/_layout.tsx
 * via @expo-google-fonts/cairo before anything renders. Chosen over the
 * platform default (Roboto/San Francisco) specifically because it has full,
 * matching Arabic *and* Latin glyph sets drawn in the same geometric voice —
 * a lot of this app's own screens mix the two in one sentence (an Arabic
 * question with an inline English/Latin formula), and Cairo is designed for
 * exactly that so neither script looks like an afterthought next to the
 * other. app/_layout.tsx also best-effort sets these as the default
 * fontFamily for every <Text>/<TextInput> app-wide; MathText.tsx (all
 * question/answer prose) and a few hand-styled screens set it explicitly
 * too so the most-read surfaces pick it up even where that global default
 * doesn't apply. */
export const fonts = {
  regular: 'Cairo_400Regular',
  medium: 'Cairo_500Medium',
  semiBold: 'Cairo_600SemiBold',
  bold: 'Cairo_700Bold',
  // Any run of English letters/digits (a formula, a unit, a plain English
  // word sitting inside an Arabic sentence) renders in this instead of
  // Cairo — see MathText.tsx's splitLatinRuns. STIX Two Text (Google
  // Fonts) rather than the literal "Times New Roman" font file: it's a
  // real font file Expo can bundle and load identically on iOS *and*
  // Android (a literal "Times New Roman" name is only a real system font
  // on iOS — Android has no bundled equivalent and would silently fall
  // back to Roboto). STIX Two Text specifically was chosen over the
  // previous Tinos pick after the user asked for a clearer serif — it's
  // the serif face the STIX project designed for scientific/math
  // typesetting, so its capital "I" reads with unambiguous top/bottom
  // serif bars and its digits/variables read cleanly at small sizes,
  // which matters a lot for a physics app.
  serif: 'STIXTwoText_400Regular',
  serifBold: 'STIXTwoText_700Bold',
  // Real italic font files (loaded in app/_layout.tsx alongside the two
  // above) — used for a math variable/Greek letter (see MathText.tsx's
  // splitItalicRuns), which textbook convention sets in italic. These
  // replace an earlier version that faked italic with RN's own
  // `fontStyle: 'italic'` on the upright serifBold face: without a real
  // italic glyph design to switch to, Android synthesizes italic by
  // skewing the upright glyph's outline, which visibly mangled thick
  // vertical strokes — a capital "I" in particular came out looking like
  // a thin diagonal stroke, not a serif "I" at all, and noticeably
  // lighter than the rest of the bold equation around it. A real italic
  // font file has its own hand-designed bold-weight glyph shapes, so this
  // fixes both complaints (wrong shape, looks-less-bold) at once, with no
  // synthetic transform involved.
  serifItalic: 'STIXTwoText_400Regular_Italic',
  serifBoldItalic: 'STIXTwoText_700Bold_Italic',
} as const;

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  pill: 999,
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 28,
} as const;

/** Standard card shadow — subtle, consistent across the app. Deeper/more
 * opaque than a light-theme shadow would need, since a soft shadow barely
 * separates from an already-dark background otherwise. */
export const cardShadow = {
  shadowColor: '#000000',
  shadowOffset: { width: 0, height: 2 },
  shadowOpacity: 0.4,
  shadowRadius: 8,
  elevation: 4,
} as const;
