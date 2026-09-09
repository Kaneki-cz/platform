import React from 'react';
import { Text, TextStyle, View } from 'react-native';

import { colors, fonts } from '@/constants/theme';

// A real textbook renders math in a serif face with variables/Greek
// letters in italic and numbers/operators upright — that convention alone
// is a big part of what makes typeset math read as "real" rather than
// plain sans-serif prose with some characters colored in. STIX Two Text
// (see constants/theme.ts's fonts.serifBold) is what actually gets loaded
// here — a real font file bundled by the app (so it's identical on iOS and
// Android), and one purpose-built for scientific/math typesetting.
const MATH_FONT = fonts.serifBold;
const LETTER_RE = /[A-Za-zΑ-Ωα-ω]/;
// Any run of plain Latin letters/digits — a unit, a brand/proper name, a
// number, an English word sitting inside an otherwise-Arabic sentence — so
// it renders in fonts.serif/serifBold (STIX Two Text) instead of the app's
// default Cairo, same as the user asked: "any English text, whether
// letters or numbers, in Times New Roman". Deliberately narrower than
// LETTER_RE above (no Greek here) — Greek symbols only ever show up inside
// $...$ math spans, which already get the serif treatment as a whole piece.
const LATIN_RE = /[A-Za-z0-9]/;

/**
 * Renders text that may contain inline LaTeX math delimited by single (or
 * double, for display-style) dollar signs, e.g.
 * "Solved for v: $v = v_0 + a t \approx 19.6$" — the backend's AI pipeline
 * (see backend/app/services/physics_solver.py and ai_service.py) formats
 * every equation/fraction/exponent this way.
 *
 * This renders natively (no WebView — see git history for why: a WebView +
 * KaTeX version never produced any visible output at all on this app's
 * Android test device, for reasons that weren't pinned down, even stripped
 * down to a hardcoded static test page with zero network or JS involved).
 *
 * EVERY message — with or without a \frac — renders as ONE native <Text>
 * tree with nested spans for bold/math/exponents. This matters a lot for
 * Arabic (or any RTL) answers: a single Text lets the OS's own bidi text
 * shaping engine decide word order, line wrapping and punctuation
 * placement, which is what real paragraphs need. An earlier version broke
 * out a stacked fraction (numerator over a line over denominator) as its
 * own small View widget, laid out in a manually-wrapped flex row alongside
 * the surrounding text/math — but React Native's flex-wrap + row-reverse
 * combination does not correctly implement bidi paragraph wrapping (it's
 * not what flexbox was designed for): once a paragraph containing a
 * fraction wrapped onto more than one line, whole chunks of it came out in
 * the wrong order relative to each other (confirmed by testing — this is
 * what was behind the "equations written reversed/wrong" bug reports).
 * Fractions are now written as plain inline text instead — "V/R", "20/10"
 * — cleaned up by expandFracAndSqrt() before the rest of the math pipeline
 * ever sees them, so they flow through the exact same single-Text-tree
 * path as everything else and can never end up reordered.
 *
 * Exponents and subscripts render as real Unicode superscript/subscript
 * characters (¹²³, ₐₑₓ, etc.) — an earlier version used a baseline-shifted
 * smaller-font span instead (the `<sup>`/`<sub>` trick), but a `top`
 * position offset on a nested Text span turned out not to render at all on
 * this app's Android build (T² came out as plain "T2", same baseline, just
 * smaller) — a real, confirmed native-Text limitation here, not a
 * hypothesis. Unicode digits/operators have full superscript *and*
 * subscript coverage, and Latin letters have full superscript coverage, so
 * this covers the overwhelming majority of real exponents (T², a³, x₁,
 * 10⁻³, v_max, …) with zero reliance on positioning. Only subscript words
 * containing b/c/d/f/g/q/w/y/z (Unicode has no subscript glyph for those
 * at all, e.g. "static") fall back to the word wrapped in Unicode
 * subscript-style parentheses (₍static₎) — still plain inline text, so
 * it's guaranteed to actually show up.
 *
 * Every math span renders in a serif face, accent-colored, with
 * variables/Greek letters italic and numbers/operators upright — the same
 * convention real typeset math uses — so it reads as a distinct,
 * deliberate result rather than blending into the surrounding prose.
 *
 * UPDATE: fractions now always render as a real stacked bar (numerator,
 * horizontal line, denominator), not just the old plain-text "a/b" degrade
 * — this was a deliberate choice after weighing the RTL-wrapping bug
 * above, made explicitly at the user's request after being warned about
 * that history. The trick that keeps it safe: a bare "\frac{a}{b}$" (the
 * *entire* content of its own $...$ span — see matchBareFraction) is never
 * inlined into the middle of a wrapping line at all. Instead, buildBlocks()
 * below splits the whole input into a top-to-bottom stack of blocks: each
 * run of ordinary prose/math (everything BETWEEN fraction spans) still
 * renders as one single native <Text> tree exactly as before — full native
 * bidi, zero risk — and each bare fraction gets its own StackedFraction
 * block sitting between them. Blocks simply stack vertically in source
 * order, which needs no bidi awareness at all (unlike the old flex-wrap
 * row, a plain top-to-bottom stack is direction-agnostic, so it can't
 * reorder anything relative to anything else). The one place this still
 * can't help: a fraction combined with other content INSIDE the same
 * $...$ span (e.g. "$I = \frac{V}{R}$", or a fraction that's part of a
 * bigger expression) isn't "bare" on its own, so it still safely degrades
 * to inline "V/R" text via expandFracAndSqrt — only a fraction that is the
 * whole of its own $...$ span gets the real bar.
 */
export function MathText({
  text,
  color = colors.text,
  fontSize = 15,
  style,
  bold = false,
  numberOfLines,
}: {
  text: string;
  color?: string;
  fontSize?: number;
  style?: TextStyle;
  /** Renders every plain-text run in fonts.bold instead of fonts.regular —
   * for a question prompt that needs to read as bold/heavy by default, not
   * just the odd **markdown-bolded** word. A run the model itself marked
   * **bold** stays bold either way; this only changes what the OTHERWISE
   * plain runs render as. */
  bold?: boolean;
  /** Passed straight through to the outer <Text> — lets a preview/list-row
   * usage (e.g. a question card showing its own prompt) truncate with an
   * ellipsis instead of pushing the layout, same as any other <Text>. */
  numberOfLines?: number;
}) {
  const blocks = buildBlocks(text);

  // Fast path — content with no bare fraction span at all (still the
  // overwhelming majority of questions/answers) renders exactly as before:
  // one single native <Text> tree, zero behavior change.
  if (blocks.length === 1 && blocks[0].type === 'prose') {
    return renderProseBlock(blocks[0].nodes, { color, fontSize, style, bold, numberOfLines });
  }
  // Content that's nothing but one bare fraction, with no other text at
  // all — the previous "standalone" case — renders the same as before too
  // (no extra wrapping View, the caller's style applies straight to it).
  if (blocks.length === 1 && blocks[0].type === 'fracBlock') {
    return <StackedFraction num={blocks[0].num} den={blocks[0].den} color={color} fontSize={fontSize} style={style} />;
  }

  // Mixed content (prose and one or more bare fractions together): stack
  // each block top-to-bottom — see the file-level doc comment above for
  // why this sidesteps the RTL flex-wrap bug entirely rather than risking
  // it again.
  return (
    <View style={style as any}>
      {blocks.map((block, i) =>
        block.type === 'fracBlock' ? (
          <StackedFraction key={i} num={block.num} den={block.den} color={color} fontSize={fontSize} />
        ) : (
          renderProseBlock(block.nodes, { color, fontSize, bold, numberOfLines, blockKey: i })
        ),
      )}
    </View>
  );
}

/** Renders one prose block — plain/bold text and any non-bare math spans —
 * as a single native <Text> tree, exactly the same shape MathText itself
 * used to always return. Its own text-direction is decided independently
 * from its own content, same as before; a paragraph split into several
 * blocks by fraction spans doesn't need to "agree" on direction with its
 * neighbors since blocks never share a line. */
function renderProseBlock(
  nodes: InlineNode[],
  opts: { color: string; fontSize: number; style?: TextStyle; bold: boolean; numberOfLines?: number; blockKey?: number },
) {
  const rtl = isRtlNodes(nodes);
  return (
    <Text
      key={opts.blockKey}
      numberOfLines={opts.numberOfLines}
      style={[
        {
          color: opts.color,
          fontFamily: opts.bold ? fonts.bold : fonts.regular,
          fontSize: opts.fontSize,
          lineHeight: opts.fontSize * 1.6,
          textAlign: rtl ? 'right' : 'left',
          writingDirection: rtl ? 'rtl' : 'ltr',
        },
        opts.style as any,
      ]}
    >
      {nodes.map((node, idx) => renderNode(node, idx, opts.color, opts.bold))}
    </Text>
  );
}

/** Same direction heuristic as isRtlText, applied to an already-built node
 * list instead of raw text — used per prose block since a block's own text
 * isn't kept around as a separate string once split into nodes. */
function isRtlNodes(nodes: InlineNode[]): boolean {
  const concatenated = nodes
    .map((n) => (n.type === 'text' ? n.value : n.type === 'math' ? n.pieces.map((p) => p.text).join('') : ''))
    .join('');
  return isRtlText(concatenated);
}

/** True only when `content` (the inside of one $...$ span) is nothing but
 * a single top-level \frac{...}{...}/\dfrac{...}{...} — no leading/trailing
 * characters, no nested content after the closing brace. Anything else
 * (a fraction combined with other math, extra characters) returns null,
 * keeping the safe plain-text "a/b" degrade for that case. */
function matchBareFraction(content: string): { num: string; den: string } | null {
  const s = content.trim();
  const m = /^\\d?frac\{/.exec(s);
  if (!m) return null;
  const openIdx = m[0].length - 1;
  const num = readBraceGroup(s, openIdx);
  if (s[num.end] !== '{') return null;
  const den = readBraceGroup(s, num.end);
  if (den.end !== s.length) return null;
  return { num: num.content, den: den.content };
}

/** A real stacked fraction — numerator, a horizontal bar, denominator —
 * built from plain <View>/<Text>. Reached whenever a $...$ span is nothing
 * but a bare \frac{}{} (see matchBareFraction/buildBlocks) — as its own
 * standalone content, or as one block among others in a longer field. */
function StackedFraction({
  num,
  den,
  color,
  fontSize,
  style,
}: {
  num: string;
  den: string;
  color: string;
  fontSize: number;
  style?: TextStyle;
}) {
  const barColor = colors.accent;
  const lineStyle = { color: barColor, fontFamily: MATH_FONT, fontSize, textAlign: 'center' as const };
  return (
    <View style={[{ alignItems: 'center', alignSelf: 'flex-start' }, style as any]}>
      <Text style={lineStyle}>{renderPieces(parseMathExpr(num))}</Text>
      <View
        style={{
          alignSelf: 'stretch',
          height: Math.max(1, Math.round(fontSize * 0.07)),
          backgroundColor: barColor,
          marginVertical: Math.round(fontSize * 0.12),
        }}
      />
      <Text style={lineStyle}>{renderPieces(parseMathExpr(den))}</Text>
    </View>
  );
}

/** Renders one top-level node — plain/bold prose, or a math run (serif,
 * accent-colored, variables/Greek in italic and numbers/operators upright —
 * see MATH_FONT above; exponents/subscripts are already real Unicode
 * characters baked into the piece text by parseMathExpr, and fractions are
 * already plain "num/den" text baked in by expandFracAndSqrt). */
function renderNode(node: InlineNode, idx: number, color: string, defaultBold = false) {
  if (node.type === 'break') return node.paragraph ? '\n\n' : '\n';
  if (node.type === 'text') {
    const bold = node.bold || defaultBold;
    return (
      <Text key={idx} style={{ color }}>
        {splitLatinRuns(node.value).map((r, j) => (
          <Text key={j} style={{ fontFamily: r.latin ? (bold ? fonts.serifBold : fonts.serif) : bold ? fonts.bold : fonts.regular }}>
            {r.text}
          </Text>
        ))}
      </Text>
    );
  }
  const isBlank = !node.pieces.some((p) => p.text.trim());
  return (
    <Text key={idx} style={isBlank ? { color } : { color: colors.accent, fontFamily: MATH_FONT }}>
      {LRI}
      {renderPieces(node.pieces)}
      {PDI}
    </Text>
  );
}

/** Splits a plain-prose run into alternating Latin-letter/digit and
 * everything-else (Arabic, punctuation, spaces, …) sub-runs, so an English
 * word or number sitting inside an Arabic sentence — "استخدم Newton
 * الثاني" — renders in fonts.serif/serifBold (STIX Two Text) while the surrounding
 * Arabic stays in Cairo. Same idea as splitItalicRuns below, just deciding
 * a font family instead of an italic flag, and only for plain text nodes —
 * a math span already renders as one uniform serif piece regardless. */
function splitLatinRuns(s: string): { text: string; latin: boolean }[] {
  const out: { text: string; latin: boolean }[] = [];
  let current = '';
  let currentLatin: boolean | null = null;
  for (const ch of s) {
    const isLatin = LATIN_RE.test(ch);
    if (currentLatin === null) {
      currentLatin = isLatin;
      current = ch;
    } else if (isLatin === currentLatin) {
      current += ch;
    } else {
      out.push({ text: current, latin: currentLatin });
      current = ch;
      currentLatin = isLatin;
    }
  }
  if (current) out.push({ text: current, latin: currentLatin ?? false });
  return out;
}

/** Splits a run of math text into alternating italic (letters — Latin or
 * Greek, the conventional style for variables) and upright (digits,
 * operators, punctuation) sub-runs. */
function splitItalicRuns(s: string): { text: string; italic: boolean }[] {
  const out: { text: string; italic: boolean }[] = [];
  let current = '';
  let currentItalic: boolean | null = null;
  for (const ch of s) {
    const isLetter = LETTER_RE.test(ch);
    if (currentItalic === null) {
      currentItalic = isLetter;
      current = ch;
    } else if (isLetter === currentItalic) {
      current += ch;
    } else {
      out.push({ text: current, italic: currentItalic });
      current = ch;
      currentItalic = isLetter;
    }
  }
  if (current) out.push({ text: current, italic: currentItalic ?? false });
  return out;
}

/** Renders a math expression's pieces as a flat list of sibling spans, one
 * per italic-letter/upright-everything-else sub-run. Exponents/subscripts
 * are already baked into each piece's text as real Unicode characters (or a
 * parenthetical fallback) by parseMathExpr — nothing extra to do here, which
 * is exactly the point: no position offsets, so nothing for Android's Text
 * renderer to silently drop. */
function renderPieces(pieces: MathPiece[]) {
  const nodes: React.ReactNode[] = [];
  pieces.forEach((p, i) => {
    splitItalicRuns(p.text).forEach((r, j) => {
      nodes.push(
        <Text key={`${i}-${j}`} style={{ fontStyle: r.italic ? 'italic' : 'normal' }}>
          {r.text}
        </Text>,
      );
    });
  });
  return nodes;
}

// ---------------------------------------------------------------------------
// RTL detection
// ---------------------------------------------------------------------------
// Hebrew, Arabic, Arabic Supplement, Arabic Extended-A, Hebrew & Arabic
// Presentation Forms A/B.
const RTL_CHAR_RE = /[֐-ࣿיִ-﷿ﹰ-﻿]/;
const STRONG_CHAR_RE = /[A-Za-z֐-ࣿיִ-﷿ﹰ-﻿]/;

/** A paragraph's overall direction is decided by its first "strong"
 * (directional) character — digits, punctuation and whitespace are neutral
 * and skipped, exactly like the real Unicode bidi algorithm does. This
 * correctly keeps an Arabic answer that happens to start with a number or an
 * English formula term reading right-to-left. */
function isRtlText(s: string): boolean {
  const m = s.match(STRONG_CHAR_RE);
  return !!m && RTL_CHAR_RE.test(m[0]);
}

// Unicode bidi isolate marks (LRI ... PDI). A physics formula is always
// Latin letters/digits/symbols, but it's rendered as its own nested <Text>
// span inside the surrounding paragraph — when that paragraph is Arabic
// (right-to-left), the bidi algorithm doesn't automatically know the whole
// span should be read left-to-right on its own, and ends up scrambling the
// order of the formula's own characters (e.g. "static" reading backwards).
// Wrapping the formula in an explicit left-to-right isolate fixes that — it
// tells the algorithm "resolve everything inside as one independent
// left-to-right unit", regardless of what direction it sits in.
const LRI = '⁦';
const PDI = '⁩';

// ---------------------------------------------------------------------------
// Building the top-to-bottom block list (prose blocks, bare-fraction blocks)
// ---------------------------------------------------------------------------
type MathPiece = { text: string };
type InlineNode =
  | { type: 'text'; value: string; bold?: boolean }
  | { type: 'math'; pieces: MathPiece[] }
  | { type: 'break'; paragraph: boolean };

type ContentBlock = { type: 'prose'; nodes: InlineNode[] } | { type: 'fracBlock'; num: string; den: string };

/** Splits the whole input into a stack of blocks: ordinary prose/math runs
 * (rendered as one native <Text> tree each, via renderProseBlock) broken
 * apart wherever a bare "$\frac{a}{b}$" span shows up (rendered as its own
 * StackedFraction block instead). See MathText's file-level doc comment
 * for why stacking blocks this way — rather than inlining the fraction
 * into the surrounding line — is what keeps this safe under RTL. */
function buildBlocks(fullText: string): ContentBlock[] {
  const blocks: ContentBlock[] = [];
  let currentNodes: InlineNode[] = [];
  const flushProse = () => {
    if (currentNodes.length) {
      blocks.push({ type: 'prose', nodes: currentNodes });
      currentNodes = [];
    }
  };
  for (const seg of splitMathSegments(fullText)) {
    if (seg.type === 'text') {
      // The model sometimes ignores "no markdown" instructions anyway —
      // handle **bold** here rather than showing literal asterisks.
      for (const b of splitBoldSegments(seg.content)) {
        pushRun(currentNodes, b.content, b.bold);
      }
    } else {
      const frac = matchBareFraction(seg.content);
      if (frac) {
        flushProse();
        blocks.push({ type: 'fracBlock', num: frac.num, den: frac.den });
      } else {
        currentNodes.push({ type: 'math', pieces: parseMathExpr(seg.content) });
      }
    }
  }
  flushProse();
  return blocks.length ? blocks : [{ type: 'prose', nodes: [] }];
}

function splitBoldSegments(text: string): { content: string; bold: boolean }[] {
  const segments: { content: string; bold: boolean }[] = [];
  const regex = /\*\*([^*]+)\*\*/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) segments.push({ content: text.slice(lastIndex, match.index), bold: false });
    segments.push({ content: match[1], bold: true });
    lastIndex = regex.lastIndex;
  }
  if (lastIndex < text.length) segments.push({ content: text.slice(lastIndex), bold: false });
  return segments.length ? segments : [{ content: text, bold: false }];
}

/** Splits only on newline(s), keeping every other run of text intact (rather
 * than breaking it into individual words) so native text shaping — crucial
 * for correct RTL/bidi word order and wrapping — handles the rest. */
function pushRun(nodes: InlineNode[], content: string, bold = false) {
  const parts = content.split(/(\n+)/);
  for (const part of parts) {
    if (!part) continue;
    if (/^\n+$/.test(part)) {
      nodes.push({ type: 'break', paragraph: part.length > 1 });
    } else {
      nodes.push({ type: 'text', value: part, bold });
    }
  }
}

// ---------------------------------------------------------------------------
// Splitting plain text from $...$ / $$...$$ math spans
// ---------------------------------------------------------------------------
function splitMathSegments(text: string): { type: 'text' | 'math'; content: string }[] {
  const segments: { type: 'text' | 'math'; content: string }[] = [];
  const regex = /\$\$([\s\S]+?)\$\$|\$([^$\n]+?)\$/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ type: 'text', content: text.slice(lastIndex, match.index) });
    }
    segments.push({ type: 'math', content: match[1] ?? match[2] ?? '' });
    lastIndex = regex.lastIndex;
  }
  if (lastIndex < text.length) {
    segments.push({ type: 'text', content: text.slice(lastIndex) });
  }
  return segments.length ? segments : [{ type: 'text', content: text }];
}

// ---------------------------------------------------------------------------
// LaTeX -> plain-text + real sup/sub pieces
// ---------------------------------------------------------------------------
// Unicode superscript/subscript characters — real, individually-addressable
// codepoints, so using them needs no positioning trick at all: they're just
// text. Superscript covers every digit, +-=(), and every Latin letter except
// q (Unicode has no superscript q). Subscript covers every digit, +-=(),
// and most Latin letters, but NOT b, c, d, f, g, q, w, y, z — Unicode simply
// never defined those subscript glyphs.
// Exported so components/MathSymbolInput.tsx's exponent/subscript "two
// boxes" popup can convert whatever the admin types into the exact same
// Unicode glyphs (and the exact same parenthetical fallback) this file uses
// when actually rendering $...$ math — one source of truth, so what the
// admin sees inserted in the input is always what a student will later see
// rendered, with zero drift between the two.
export const SUPERSCRIPTS: Record<string, string> = {
  '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹',
  '+': '⁺', '-': '⁻', '=': '⁼', '(': '⁽', ')': '⁾', n: 'ⁿ', i: 'ⁱ',
  a: 'ᵃ', b: 'ᵇ', c: 'ᶜ', d: 'ᵈ', e: 'ᵉ', f: 'ᶠ', g: 'ᵍ', h: 'ʰ', j: 'ʲ', k: 'ᵏ', l: 'ˡ',
  m: 'ᵐ', o: 'ᵒ', p: 'ᵖ', r: 'ʳ', s: 'ˢ', t: 'ᵗ', u: 'ᵘ', v: 'ᵛ', w: 'ʷ', x: 'ˣ', y: 'ʸ', z: 'ᶻ',
};
export const SUBSCRIPTS: Record<string, string> = {
  '0': '₀', '1': '₁', '2': '₂', '3': '₃', '4': '₄', '5': '₅', '6': '₆', '7': '₇', '8': '₈', '9': '₉',
  '+': '₊', '-': '₋', '=': '₌', '(': '₍', ')': '₎',
  a: 'ₐ', e: 'ₑ', h: 'ₕ', i: 'ᵢ', j: 'ⱼ', k: 'ₖ', l: 'ₗ', m: 'ₘ', n: 'ₙ', o: 'ₒ', p: 'ₚ',
  r: 'ᵣ', s: 'ₛ', t: 'ₜ', u: 'ᵤ', v: 'ᵥ', x: 'ₓ',
};

/** Converts every character to its Unicode superscript/subscript form, or
 * returns null if even one character has no such glyph — the caller falls
 * back to a parenthetical instead of a half-converted, half-plain result. */
export function toSupUnicode(s: string): string | null {
  let out = '';
  for (const ch of s) {
    const mapped = SUPERSCRIPTS[ch];
    if (!mapped) return null;
    out += mapped;
  }
  return out;
}
export function toSubUnicode(s: string): string | null {
  let out = '';
  for (const ch of s) {
    const mapped = SUBSCRIPTS[ch];
    if (!mapped) return null;
    out += mapped;
  }
  return out;
}

// Longest/most-specific patterns first so e.g. \varphi matches before \phi.
const SYMBOL_MAP: [RegExp, string][] = [
  [/\\varphi/g, 'φ'], [/\\phi/g, 'φ'],
  [/\\varepsilon/g, 'ε'], [/\\epsilon/g, 'ε'],
  [/\\vartheta/g, 'ϑ'], [/\\theta/g, 'θ'],
  [/\\alpha/g, 'α'], [/\\beta/g, 'β'], [/\\gamma/g, 'γ'], [/\\delta/g, 'δ'],
  [/\\zeta/g, 'ζ'], [/\\eta/g, 'η'], [/\\iota/g, 'ι'], [/\\kappa/g, 'κ'],
  [/\\lambda/g, 'λ'], [/\\mu/g, 'μ'], [/\\nu/g, 'ν'], [/\\xi/g, 'ξ'],
  [/\\pi/g, 'π'], [/\\rho/g, 'ρ'], [/\\sigma/g, 'σ'], [/\\tau/g, 'τ'],
  [/\\upsilon/g, 'υ'], [/\\chi/g, 'χ'], [/\\psi/g, 'ψ'], [/\\omega/g, 'ω'],
  [/\\Gamma/g, 'Γ'], [/\\Delta/g, 'Δ'], [/\\Theta/g, 'Θ'], [/\\Lambda/g, 'Λ'],
  [/\\Xi/g, 'Ξ'], [/\\Pi/g, 'Π'], [/\\Sigma/g, 'Σ'], [/\\Upsilon/g, 'Υ'],
  [/\\Phi/g, 'Φ'], [/\\Psi/g, 'Ψ'], [/\\Omega/g, 'Ω'],
  [/\\times/g, '×'], [/\\cdot/g, '·'], [/\\div/g, '÷'],
  [/\\pm/g, '±'], [/\\mp/g, '∓'],
  [/\\approx/g, '≈'], [/\\neq/g, '≠'], [/\\ne\b/g, '≠'],
  [/\\leq/g, '≤'], [/\\le\b/g, '≤'], [/\\geq/g, '≥'], [/\\ge\b/g, '≥'],
  [/\\Rightarrow/g, '⇒'], [/\\Leftrightarrow/g, '⇔'],
  [/\\rightarrow/g, '→'], [/\\to\b/g, '→'], [/\\leftarrow/g, '←'],
  [/\\infty/g, '∞'], [/\\circ/g, '°'], [/\\degree/g, '°'],
  [/\\cdots/g, '⋯'], [/\\ldots/g, '…'], [/\\dots/g, '…'],
  [/\\sum/g, 'Σ'], [/\\int/g, '∫'], [/\\oint/g, '∮'],
  [/\\partial/g, '∂'], [/\\nabla/g, '∇'], [/\\propto/g, '∝'],
  [/\\perp/g, '⊥'], [/\\parallel/g, '∥'], [/\\angle/g, '∠'],
  [/\\sim/g, '∼'], [/\\equiv/g, '≡'],
  [/\\therefore/g, '∴'], [/\\because/g, '∵'],
  [/\\text\{([^{}]*)\}/g, '$1'], [/\\mathrm\{([^{}]*)\}/g, '$1'], [/\\mathbf\{([^{}]*)\}/g, '$1'],
  [/\\,/g, ' '], [/\\;/g, ' '], [/\\:/g, ' '], [/\\!/g, ''], [/\\quad/g, '  '], [/\\qquad/g, '    '],
  [/\\left/g, ''], [/\\right/g, ''],
];

/** Finds the `{...}` group starting at `s[openIdx] === '{'`, respecting nesting. */
function readBraceGroup(s: string, openIdx: number): { content: string; end: number } {
  let depth = 0;
  for (let i = openIdx; i < s.length; i++) {
    if (s[i] === '{') depth++;
    else if (s[i] === '}') {
      depth--;
      if (depth === 0) return { content: s.slice(openIdx + 1, i), end: i + 1 };
    }
  }
  return { content: s.slice(openIdx + 1), end: s.length };
}

/** A single symbol, optionally with one exponent/subscript group attached
 * (e.g. "V", "v_0", "T^2") reads fine bare in running text and doesn't need
 * grouping parentheses around it inside a fraction. Anything more complex
 * (an actual sum, a product of several symbols, …) does. Exported so
 * MathSymbolInput's own fraction composer can decide parens the exact same
 * way this file's \frac{}{} expansion does. */
export function isSimpleToken(s: string): boolean {
  return /^[A-Za-zΑ-Ωα-ω0-9]+(?:[_^](?:\{[^{}]*\}|[A-Za-z0-9]))?$/.test(s.trim());
}

/** Recursively expands \frac{a}{b}/\dfrac{a}{b} and \sqrt{x} into plain
 * text — "$I = \frac{V}{R}$" becomes "I = V/R", "$\frac{20}{10}$" becomes
 * "(20)/(10)" — grouping parens are added only when the numerator/
 * denominator isn't a single simple symbol, so simple variable fractions
 * read cleanly. This runs BEFORE the rest of the math pipeline sees the
 * text, so every fraction — top-level or nested — ends up as plain text
 * flowing through the same single native <Text> tree as everything else;
 * see the file-level doc comment for why that matters. */
function expandFracAndSqrt(s: string): string {
  let out = '';
  let i = 0;
  while (i < s.length) {
    const rest = s.slice(i);
    const fracMatch = /^\\d?frac\{/.exec(rest);
    const sqrtMatch = /^\\sqrt\{/.exec(rest);
    if (fracMatch) {
      const openIdx = i + fracMatch[0].length - 1;
      const num = readBraceGroup(s, openIdx);
      if (s[num.end] === '{') {
        const den = readBraceGroup(s, num.end);
        const numExp = expandFracAndSqrt(num.content);
        const denExp = expandFracAndSqrt(den.content);
        const numStr = isSimpleToken(numExp) ? numExp : `(${numExp})`;
        const denStr = isSimpleToken(denExp) ? denExp : `(${denExp})`;
        out += `${numStr}/${denStr}`;
        i = den.end;
        continue;
      }
    }
    if (sqrtMatch) {
      const openIdx = i + sqrtMatch[0].length - 1;
      const inner = readBraceGroup(s, openIdx);
      out += `√(${expandFracAndSqrt(inner.content)})`;
      i = inner.end;
      continue;
    }
    out += s[i];
    i++;
  }
  return out;
}

function applySymbols(s: string): string {
  let out = s;
  for (const [re, rep] of SYMBOL_MAP) out = out.replace(re, rep);
  return out;
}

/** Final per-piece cleanup: strips any remaining LaTeX commands/braces we
 * didn't recognize (rather than showing raw backslashes to the student) and
 * collapses runs of spaces/tabs — but doesn't trim the piece's own edges,
 * since that would crowd it against a neighboring piece (e.g. the space
 * right before a subscript). */
function cleanupMathPiece(s: string): string {
  s = applySymbols(s);
  s = s.replace(/\\[a-zA-Z]+/g, '');
  s = s.replace(/[{}]/g, '');
  s = s.replace(/[ \t]+/g, ' ');
  return s;
}

/** Converts one LaTeX math expression (without the surrounding $...$) into a
 * list of plain-text pieces, with \frac/\sqrt already expanded to plain text
 * and exponents/subscripts already baked in as real Unicode characters (or a
 * parenthetical fallback when a letter has no Unicode sub/superscript glyph)
 * — e.g. "v_0^2" becomes [{text:"v"}, {text:"₀"}, {text:"²"}], and
 * "F_{static}" becomes [{text:"F"}, {text:"₍static₎"}] since Unicode has no
 * subscript "c". Always returns at least one piece, even for LaTeX it
 * doesn't fully understand — it never throws and never drops non-empty
 * input. */
function parseMathExpr(expr: string): MathPiece[] {
  let s = expandFracAndSqrt(expr.trim());
  // Handle the very common "45^\circ" (45 degrees) before the generic
  // superscript split below, since \circ isn't a single alnum char and
  // isn't meant to be raised — it's a normal-size degree symbol.
  s = s.replace(/\^\s*\{?\s*\\circ\s*\}?/g, '°');

  const pieces: MathPiece[] = [];
  const pushPlain = (t: string) => {
    const cleaned = cleanupMathPiece(t);
    if (cleaned) pieces.push({ text: cleaned });
  };

  const regex = /\^\{([^{}]*)\}|\^([A-Za-z0-9])|_\{([^{}]*)\}|_([A-Za-z0-9])/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(s)) !== null) {
    if (match.index > lastIndex) pushPlain(s.slice(lastIndex, match.index));
    const [, supBrace, supChar, subBrace, subChar] = match;
    const raised = supBrace ?? supChar;
    if (raised !== undefined) {
      const cleaned = cleanupMathPiece(raised);
      if (cleaned) {
        const uni = toSupUnicode(cleaned);
        pieces.push({ text: uni !== null ? uni : `⁽${cleaned}⁾` });
      }
    } else {
      const lowered = subBrace ?? subChar ?? '';
      const cleaned = cleanupMathPiece(lowered);
      if (cleaned) {
        const uni = toSubUnicode(cleaned);
        pieces.push({ text: uni !== null ? uni : `₍${cleaned}₎` });
      }
    }
    lastIndex = regex.lastIndex;
  }
  pushPlain(s.slice(lastIndex));

  return pieces.length ? pieces : [{ text: expr }];
}
