import React, { useRef, useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
} from 'react-native';

import { MathText, toSubUnicode, toSupUnicode } from '@/components/MathText';
import { colors, fonts, radius, spacing } from '@/constants/theme';

/**
 * A TextInput with a two-tier toolbar above it for math/Latin symbols that
 * are painful — or, on an Arabic keyboard, close to impossible without
 * switching layouts several times — to type directly on a phone. Built for
 * the question-authoring forms (app/admin/exam/[id].tsx,
 * app/admin/lesson/[id].tsx) where whoever writes a question needs things
 * like "$v = v_0 + at$" or "R₁ + R₂ = 20 Ω" and previously had nothing but a
 * bare TextInput.
 *
 * Two rows, deliberately different in character so each reads at a glance:
 *  - Actions row: a handful of square "operation" cards (math mode,
 *    fraction, exponent, subscript) — none of these insert anything
 *    directly, they all open a popup below instead (see EXPONENT MODAL and
 *    the equation/fraction composer comments further down).
 *  - Symbols row: a horizontally-scrolling strip of plain insert chips
 *    (Greek letters, operators, comparisons, arrows), grouped with thin
 *    dividers so it doesn't read as one undifferentiated wall of buttons.
 *
 * EXPONENT MODAL — replaces what used to be six separate static buttons
 * (x², x³, xⁿ, x₀, x₁, x₂) that each inserted exactly one hardcoded
 * character. Those covered "x²" fine but nothing else (a question needing
 * "v₀" or "aⁿ⁺¹" had no button for it). Tapping "Exponent" or "Subscript"
 * instead opens two plain boxes — Base and Exponent/Subscript — matching
 * how the person actually thinks about it ("R" is the base, "1" is the
 * subscript), with a live preview of the exact glyphs that will land in the
 * field. Whatever's currently selected in the main input is offered as the
 * starting Base, since selecting "R" then tapping Subscript is the most
 * natural way to reach for this. Uses the exact same Unicode
 * superscript/subscript tables (and the same parenthetical fallback for a
 * character with no such glyph) that MathText.tsx renders with — so what's
 * inserted here is guaranteed to be exactly what a student later sees.
 */
type SymbolButton =
  | { label: string; kind: 'insert'; value: string }
  | { label: string; kind: 'wrap'; open: string; close: string };

const SYMBOL_GROUPS: SymbolButton[][] = [
  [
    { label: '√', kind: 'insert', value: '√' },
  ],
  [
    { label: 'π', kind: 'insert', value: 'π' },
    { label: 'θ', kind: 'insert', value: 'θ' },
    { label: 'α', kind: 'insert', value: 'α' },
    { label: 'β', kind: 'insert', value: 'β' },
    { label: 'Δ', kind: 'insert', value: 'Δ' },
    { label: 'Ω', kind: 'insert', value: 'Ω' },
    { label: 'μ', kind: 'insert', value: 'μ' },
  ],
  [
    { label: '×', kind: 'insert', value: '×' },
    { label: '÷', kind: 'insert', value: '÷' },
    { label: '±', kind: 'insert', value: '±' },
    { label: '°', kind: 'insert', value: '°' },
  ],
  [
    { label: '≤', kind: 'insert', value: '≤' },
    { label: '≥', kind: 'insert', value: '≥' },
    { label: '≈', kind: 'insert', value: '≈' },
    { label: '→', kind: 'insert', value: '→' },
  ],
];

// Which text field a symbol/exponent insert should land in — the main
// prompt/choice/explanation field, the equation composer's own field, or
// (new) whichever of the Fraction popup's own numerator/denominator boxes
// was last focused — see fracFocusedField below. Lets the exact same
// symbol chips and exponent modal serve all of these instead of
// duplicating the logic per field.
type InsertTarget = 'main' | 'eq' | 'fracNum' | 'fracDen';

/** Pure text-splice used by every insert/wrap button, parameterized over
 * which field (value/selection/setters) it's acting on — shared by the main
 * field's toolbar and the equation composer's own mini-toolbar below. */
function applyInsert(
  currentValue: string,
  currentSelection: { start: number; end: number },
  setValue: (v: string) => void,
  setSelection: (s: { start: number; end: number }) => void,
  btn: SymbolButton,
) {
  const start = Math.min(currentSelection.start, currentValue.length);
  const end = Math.min(Math.max(currentSelection.end, start), currentValue.length);
  const before = currentValue.slice(0, start);
  const selected = currentValue.slice(start, end);
  const after = currentValue.slice(end);

  let nextText: string;
  let nextCursor: number;
  if (btn.kind === 'insert') {
    nextText = before + btn.value + after;
    nextCursor = start + btn.value.length;
  } else if (selected) {
    // Real selection: wrap it, cursor lands right after the closing
    // marker — an "end of what was just inserted" position, which RN's
    // controlled `selection` prop places reliably.
    nextText = before + btn.open + selected + btn.close + after;
    nextCursor = start + btn.open.length + selected.length + btn.close.length;
  } else {
    // Nothing selected: insert ONLY the marker itself, not an empty
    // open+close pair — this used to insert "$$" / "****" in one shot
    // with the cursor meant to land BETWEEN the two halves, but a
    // mid-string cursor position is exactly what Android's TextInput
    // does not reliably honor via the controlled `selection` prop (it
    // was leaving the cursor at the very end instead, past both
    // markers, so anything typed next landed outside the $...$/**...**
    // span). Inserting one marker at a time sidesteps that entirely:
    // the cursor only ever needs to land right after what was just
    // inserted — an end position, same as every plain symbol button
    // above, which never had this problem. Tapping the same button
    // again after typing the content inserts the matching closing
    // marker the same way (works because open === close for both wrap
    // buttons actually in use here, $ and **) — the same toggle-on/
    // toggle-off feel as pressing Ctrl+B twice in a text editor.
    nextText = before + btn.open + after;
    nextCursor = start + btn.open.length;
  }

  setValue(nextText);
  setSelection({ start: nextCursor, end: nextCursor });
}

interface MathSymbolInputProps extends Omit<TextInputProps, 'onChangeText' | 'value'> {
  value: string;
  onChangeText: (text: string) => void;
}

export function MathSymbolInput({ value, onChangeText, style, ...rest }: MathSymbolInputProps) {
  const [selection, setSelection] = useState({ start: value.length, end: value.length });
  const inputRef = useRef<TextInput>(null);

  // Exponent/subscript popup state — null when closed. `base`/`raised` are
  // the two boxes' own live text; converted to real Unicode only at the
  // moment of confirming (and for the live preview below the boxes).
  // `target` says which field gets the result — the main input, or the
  // equation composer's own field when opened from inside that modal.
  const [expModal, setExpModal] = useState<{ mode: 'sup' | 'sub'; target: InsertTarget } | null>(null);
  const [modalBase, setModalBase] = useState('');
  const [modalRaised, setModalRaised] = useState('');

  // Equation composer — replaces the old behavior where tapping "$…$" wrapped
  // the current selection in raw "$...$" markers in place. Now it opens a
  // dedicated box (closer to Google Docs'/Canva's own equation editor):
  // type the equation on its own, see it rendered live exactly as it'll
  // look (same MathText the student's screen uses), then "Insert" splices
  // the finished "$...$" span into the main field at the cursor/selection.
  // Selecting an existing "$...$" span first and tapping the button reopens
  // it here pre-filled, so editing existing math also goes through this
  // instead of hand-editing raw markers.
  const [eqModalOpen, setEqModalOpen] = useState(false);
  const [eqText, setEqText] = useState('');
  const [eqSelection, setEqSelection] = useState({ start: 0, end: 0 });
  const [eqRange, setEqRange] = useState<{ start: number; end: number } | null>(null);
  const eqInputRef = useRef<TextInput>(null);

  // Fraction popup — same shape as the exponent/subscript popup above (two
  // plain boxes, live preview, same InsertTarget so it works both from the
  // main toolbar and from inside the equation composer. The inserted text
  // is raw "\frac{num}{den}" LaTeX — MathText.tsx's own splitFracSegments/
  // StackedFraction logic decides how it renders: a real stacked horizontal
  // bar whenever this exact \frac{}{} shows up in a $...$ span (whether it's
  // the only thing there or sits next to other text), or a safe inline
  // "num/den" (parens added via isSimpleToken) only when it ends up nested
  // inside another fraction or a square root — so a fraction from the main
  // toolbar is wrapped in its own "$...$" span (it isn't naturally math
  // markup), while one built inside the equation composer is left bare,
  // since that whole composer field gets wrapped in a single "$...$" itself
  // at its own confirm step.
  //
  // The numerator/denominator boxes can themselves take an exponent or
  // subscript — reusing the exact same exponent/subscript popup above via
  // two more InsertTargets ('fracNum'/'fracDen'). Since these two boxes are
  // usually a single short symbol rather than a field with a meaningful
  // cursor position, "Base" is seeded from the WHOLE current box content
  // (not a selection inside it) and the result replaces the box outright —
  // simpler than tracking a separate selection per box, and matches how
  // short these fields actually are in practice. fracFocusedField tracks
  // which of the two was last tapped, so the popup's own small
  // exponent/subscript buttons (below) know which box to act on.
  const [fracModal, setFracModal] = useState<{ target: InsertTarget } | null>(null);
  const [fracNum, setFracNum] = useState('');
  const [fracDen, setFracDen] = useState('');
  const [fracFocusedField, setFracFocusedField] = useState<'num' | 'den'>('num');

  const applyButton = (btn: SymbolButton) => {
    applyInsert(value, selection, onChangeText, setSelection, btn);
    // A button tap can blur the field on Android — pull focus back so the
    // next keystroke lands right where it should, cursor already moved.
    inputRef.current?.focus();
  };

  const applyEqButton = (btn: SymbolButton) => {
    applyInsert(eqText, eqSelection, setEqText, setEqSelection, btn);
    eqInputRef.current?.focus();
  };

  const openExpModal = (mode: 'sup' | 'sub', target: InsertTarget = 'main') => {
    if (target === 'fracNum' || target === 'fracDen') {
      // No cursor/selection to speak of in these two short boxes — the
      // whole current value becomes the starting Base, and confirming
      // appends the exponent/subscript to it (see confirmExpModal).
      setModalBase(target === 'fracNum' ? fracNum : fracDen);
      setModalRaised('');
      setExpModal({ mode, target });
      return;
    }
    const val = target === 'main' ? value : eqText;
    const sel = target === 'main' ? selection : eqSelection;
    const start = Math.min(sel.start, val.length);
    const end = Math.min(Math.max(sel.end, start), val.length);
    // Whatever's already selected becomes the starting Base — the common
    // case is selecting "R" (or "v") right before reaching for this.
    setModalBase(val.slice(start, end));
    setModalRaised('');
    setExpModal({ mode, target });
  };

  const closeExpModal = () => {
    setExpModal(null);
    setModalBase('');
    setModalRaised('');
  };

  const convertRaised = (mode: 'sup' | 'sub', raw: string): string => {
    if (!raw) return '';
    const uni = mode === 'sup' ? toSupUnicode(raw) : toSubUnicode(raw);
    if (uni !== null) return uni;
    // Same fallback MathText.tsx's own parser uses for a raised group
    // containing a letter with no Unicode sub/superscript glyph (b, c, d,
    // f, g, q, w, y, z) — a parenthetical at the same visual "level" via
    // the sub/superscript-style parens, rather than silently dropping it.
    return mode === 'sup' ? `⁽${raw}⁾` : `₍${raw}₎`;
  };

  const confirmExpModal = () => {
    if (!expModal) return;
    const target = expModal.target;
    const inserted = modalBase + convertRaised(expModal.mode, modalRaised);
    if (!inserted) {
      closeExpModal();
      return;
    }
    if (target === 'fracNum' || target === 'fracDen') {
      (target === 'fracNum' ? setFracNum : setFracDen)(inserted);
      closeExpModal();
      return;
    }
    const val = target === 'main' ? value : eqText;
    const sel = target === 'main' ? selection : eqSelection;
    const start = Math.min(sel.start, val.length);
    const end = Math.min(Math.max(sel.end, start), val.length);
    const before = val.slice(0, start);
    const after = val.slice(end);
    const nextText = before + inserted + after;
    const nextCursor = before.length + inserted.length;
    if (target === 'main') {
      onChangeText(nextText);
      setSelection({ start: nextCursor, end: nextCursor });
      inputRef.current?.focus();
    } else {
      setEqText(nextText);
      setEqSelection({ start: nextCursor, end: nextCursor });
      eqInputRef.current?.focus();
    }
    closeExpModal();
  };

  const previewText = expModal ? modalBase + convertRaised(expModal.mode, modalRaised) : '';

  const openEqModal = () => {
    const start = Math.min(selection.start, value.length);
    const end = Math.min(Math.max(selection.end, start), value.length);
    const selected = value.slice(start, end);
    // Re-opening on an already-selected "$...$" span edits it in place
    // instead of nesting a second pair of markers around it.
    const inner =
      selected.length >= 2 && selected.startsWith('$') && selected.endsWith('$') ? selected.slice(1, -1) : selected;
    setEqRange({ start, end });
    setEqText(inner);
    setEqSelection({ start: inner.length, end: inner.length });
    setEqModalOpen(true);
  };

  const closeEqModal = () => {
    setEqModalOpen(false);
    setEqText('');
    setEqRange(null);
  };

  const confirmEqModal = () => {
    if (!eqRange) return;
    const trimmed = eqText.trim();
    if (!trimmed) {
      closeEqModal();
      return;
    }
    const before = value.slice(0, eqRange.start);
    const after = value.slice(eqRange.end);
    const inserted = `$${trimmed}$`;
    const nextText = before + inserted + after;
    const nextCursor = before.length + inserted.length;
    onChangeText(nextText);
    setSelection({ start: nextCursor, end: nextCursor });
    closeEqModal();
    inputRef.current?.focus();
  };

  const fracReady = !!(fracNum.trim() && fracDen.trim());
  // Bare "\frac{a}{b}" — never pre-wrapped in "$...$" here, since the two
  // insertion sites below need it wrapped differently.
  const fracRaw = fracReady ? `\\frac{${fracNum.trim()}}{${fracDen.trim()}}` : '';
  const fracPreviewText = fracReady ? `$${fracRaw}$` : '';

  const openFracModal = (target: InsertTarget = 'main') => {
    const val = target === 'main' ? value : eqText;
    const sel = target === 'main' ? selection : eqSelection;
    const start = Math.min(sel.start, val.length);
    const end = Math.min(Math.max(sel.end, start), val.length);
    // Whatever's already selected becomes the starting numerator — the
    // common case is selecting "V" then reaching for Fraction to divide it
    // by something.
    setFracNum(val.slice(start, end));
    setFracDen('');
    setFracModal({ target });
  };

  const closeFracModal = () => {
    setFracModal(null);
    setFracNum('');
    setFracDen('');
  };

  const confirmFracModal = () => {
    if (!fracModal || !fracReady) {
      closeFracModal();
      return;
    }
    const target = fracModal.target;
    // Main-field insertion needs its own "$...$" wrapper (it's a standalone
    // math span dropped into plain prose); the equation composer's field is
    // already all-math and gets wrapped once as a whole at its own confirm
    // step, so a fraction built there stays bare.
    const inserted = target === 'main' ? `$${fracRaw}$` : fracRaw;
    const val = target === 'main' ? value : eqText;
    const sel = target === 'main' ? selection : eqSelection;
    const start = Math.min(sel.start, val.length);
    const end = Math.min(Math.max(sel.end, start), val.length);
    const before = val.slice(0, start);
    const after = val.slice(end);
    const nextText = before + inserted + after;
    const nextCursor = before.length + inserted.length;
    if (target === 'main') {
      onChangeText(nextText);
      setSelection({ start: nextCursor, end: nextCursor });
      inputRef.current?.focus();
    } else {
      setEqText(nextText);
      setEqSelection({ start: nextCursor, end: nextCursor });
      eqInputRef.current?.focus();
    }
    closeFracModal();
  };

  return (
    <View>
      {/* Actions: the four things that change how a whole chunk of text is
          treated, not a single inserted character — visually set apart from
          the plain symbol chips below with a tinted, bordered card each. */}
      <View style={styles.actionsRow}>
        <Pressable style={styles.actionButton} onPress={openEqModal}>
          <Text style={styles.actionButtonGlyph}>$…$</Text>
          <Text style={styles.actionButtonLabel}>رياضيات</Text>
        </Pressable>
        <Pressable style={styles.actionButton} onPress={() => openFracModal('main')}>
          <Text style={styles.actionButtonGlyph}>a⁄b</Text>
          <Text style={styles.actionButtonLabel}>كسر</Text>
        </Pressable>
        <Pressable style={styles.actionButton} onPress={() => openExpModal('sup')}>
          <Text style={styles.actionButtonGlyph}>aⁿ</Text>
          <Text style={styles.actionButtonLabel}>أُس</Text>
        </Pressable>
        <Pressable style={styles.actionButton} onPress={() => openExpModal('sub')}>
          <Text style={styles.actionButtonGlyph}>aₙ</Text>
          <Text style={styles.actionButtonLabel}>دليل سفلي</Text>
        </Pressable>
      </View>

      {/* Symbols: plain single-character inserts, grouped (Greek · operators
          · comparisons/arrows) with a thin divider between each cluster so
          the strip reads as sections, not one undifferentiated row. */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.toolbar}
        contentContainerStyle={styles.toolbarContent}
        keyboardShouldPersistTaps="always"
      >
        {SYMBOL_GROUPS.map((group, gi) => (
          <React.Fragment key={gi}>
            {gi > 0 ? <View style={styles.groupDivider} /> : null}
            <View style={styles.group}>
              {group.map((btn, i) => (
                <Pressable key={i} style={styles.symbolButton} onPress={() => applyButton(btn)}>
                  <Text style={styles.symbolButtonText}>{btn.label}</Text>
                </Pressable>
              ))}
            </View>
          </React.Fragment>
        ))}
      </ScrollView>

      <TextInput
        ref={inputRef}
        style={style}
        value={value}
        onChangeText={onChangeText}
        selection={selection}
        onSelectionChange={(e) => setSelection(e.nativeEvent.selection)}
        {...rest}
      />

      {/* Live preview — the closest a plain RN TextInput can get to a
          Docs/Canva-style "see it formatted as you type" experience: the
          box you type in can only ever show one uniform font (a real RN
          limitation, see MathText.tsx), so instead this mirrors the exact
          finished look — bold, math, the app's serif font and all — right
          underneath, updating on every keystroke since it just re-renders
          `value` through the same MathText the student's own screen uses. */}
      {value.trim() ? (
        <View style={styles.previewCard}>
          <Text style={styles.previewLabel}>👁 معاينة الشكل النهائي</Text>
          <MathText text={value} color={colors.text} fontSize={14} style={styles.previewText} />
        </View>
      ) : null}

      {/* Equation composer — see the comment on eqModalOpen above. */}
      <Modal visible={eqModalOpen} transparent animationType="fade" onRequestClose={closeEqModal}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>إدراج معادلة</Text>
            <Text style={styles.modalHint}>
              اكتب المعادلة هنا وشوف شكلها بيتغير فورًا تحت — لما تخلص دوس "إدراج" وهتتحط في مكان المؤشر.
            </Text>

            <TextInput
              ref={eqInputRef}
              style={styles.eqInput}
              value={eqText}
              onChangeText={setEqText}
              selection={eqSelection}
              onSelectionChange={(e) => setEqSelection(e.nativeEvent.selection)}
              placeholder="v = v0 + a*t"
              placeholderTextColor={colors.textFaint}
              autoFocus
              multiline
            />

            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={styles.eqToolbar}
              contentContainerStyle={styles.toolbarContent}
              keyboardShouldPersistTaps="always"
            >
              <View style={styles.group}>
                <Pressable style={styles.symbolButton} onPress={() => openFracModal('eq')}>
                  <Text style={styles.symbolButtonText}>a⁄b</Text>
                </Pressable>
                <Pressable style={styles.symbolButton} onPress={() => openExpModal('sup', 'eq')}>
                  <Text style={styles.symbolButtonText}>aⁿ</Text>
                </Pressable>
                <Pressable style={styles.symbolButton} onPress={() => openExpModal('sub', 'eq')}>
                  <Text style={styles.symbolButtonText}>aₙ</Text>
                </Pressable>
              </View>
              {SYMBOL_GROUPS.map((group, gi) => (
                <React.Fragment key={gi}>
                  <View style={styles.groupDivider} />
                  <View style={styles.group}>
                    {group.map((btn, i) => (
                      <Pressable key={i} style={styles.symbolButton} onPress={() => applyEqButton(btn)}>
                        <Text style={styles.symbolButtonText}>{btn.label}</Text>
                      </Pressable>
                    ))}
                  </View>
                </React.Fragment>
              ))}
            </ScrollView>

            <View style={styles.modalPreviewWrap}>
              <Text style={styles.modalPreviewLabel}>هيتحط:</Text>
              {eqText.trim() ? (
                <MathText text={`$${eqText.trim()}$`} color={colors.accent} fontSize={20} style={{ flex: 1 }} />
              ) : (
                <Text style={styles.modalPreviewText}>—</Text>
              )}
            </View>

            <View style={styles.modalActions}>
              <Pressable style={styles.modalCancelButton} onPress={closeEqModal}>
                <Text style={styles.modalCancelText}>إلغاء</Text>
              </Pressable>
              <Pressable
                style={[styles.modalConfirmButton, !eqText.trim() && styles.modalConfirmButtonDisabled]}
                onPress={confirmEqModal}
                disabled={!eqText.trim()}
              >
                <Text style={styles.modalConfirmText}>إدراج</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* Fraction popup — see the comment on fracModal above. */}
      <Modal visible={!!fracModal} transparent animationType="fade" onRequestClose={closeFracModal}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>إدراج كسر</Text>
            <Text style={styles.modalHint}>
              اكتب البسط في الخانة الأولى، والمقام في التانية — هتتحط شرطة كسر حقيقية في مكان المؤشر الحالي. تقدر
              كمان تدوس جوه أي خانة منهم وتستخدم زرار "أس" أو "دليل سفلي" تحت عشان تضيف أس أو دليل سفلي للي كاتبه.
            </Text>

            <View style={styles.modalFieldsRow}>
              <View style={styles.modalField}>
                <Text style={styles.modalFieldLabel}>البسط</Text>
                <TextInput
                  style={styles.modalInput}
                  value={fracNum}
                  onChangeText={setFracNum}
                  onFocus={() => setFracFocusedField('num')}
                  placeholder="V"
                  placeholderTextColor={colors.textFaint}
                  autoFocus={!fracNum}
                />
              </View>
              <Text style={styles.modalOperator}>/</Text>
              <View style={styles.modalField}>
                <Text style={styles.modalFieldLabel}>المقام</Text>
                <TextInput
                  style={styles.modalInput}
                  value={fracDen}
                  onChangeText={setFracDen}
                  onFocus={() => setFracFocusedField('den')}
                  placeholder="R"
                  placeholderTextColor={colors.textFaint}
                  autoFocus={!!fracNum}
                />
              </View>
            </View>

            <View style={styles.fracExpRow}>
              <Text style={styles.fracExpRowLabel}>
                {fracFocusedField === 'num' ? 'للبسط:' : 'للمقام:'}
              </Text>
              <Pressable
                style={styles.symbolButton}
                onPress={() => openExpModal('sup', fracFocusedField === 'num' ? 'fracNum' : 'fracDen')}
              >
                <Text style={styles.symbolButtonText}>aⁿ</Text>
              </Pressable>
              <Pressable
                style={styles.symbolButton}
                onPress={() => openExpModal('sub', fracFocusedField === 'num' ? 'fracNum' : 'fracDen')}
              >
                <Text style={styles.symbolButtonText}>aₙ</Text>
              </Pressable>
            </View>

            <View style={styles.modalPreviewWrap}>
              <Text style={styles.modalPreviewLabel}>هيتحط:</Text>
              {fracReady ? (
                <MathText text={fracPreviewText} color={colors.accent} fontSize={20} style={styles.modalPreviewText} />
              ) : (
                <Text style={styles.modalPreviewText}>—</Text>
              )}
            </View>

            <View style={styles.modalActions}>
              <Pressable style={styles.modalCancelButton} onPress={closeFracModal}>
                <Text style={styles.modalCancelText}>إلغاء</Text>
              </Pressable>
              <Pressable
                style={[styles.modalConfirmButton, !fracReady && styles.modalConfirmButtonDisabled]}
                onPress={confirmFracModal}
                disabled={!fracReady}
              >
                <Text style={styles.modalConfirmText}>إدراج</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={!!expModal} transparent animationType="fade" onRequestClose={closeExpModal}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>
              {expModal?.mode === 'sup' ? 'إدراج أُس' : 'إدراج دليل سفلي'}
            </Text>
            <Text style={styles.modalHint}>
              اكتب الأساس في الخانة الأولى، و{expModal?.mode === 'sup' ? 'الأُس' : 'الدليل'} في التانية —
              {expModal?.target === 'fracNum' || expModal?.target === 'fracDen'
                ? ' هيتحطوا في الخانة اللي فتحت منها الحوار ده.'
                : ' هيتحطوا في مكان المؤشر الحالي.'}
            </Text>

            <View style={styles.modalFieldsRow}>
              <View style={styles.modalField}>
                <Text style={styles.modalFieldLabel}>الأساس</Text>
                <TextInput
                  style={styles.modalInput}
                  value={modalBase}
                  onChangeText={setModalBase}
                  placeholder="R"
                  placeholderTextColor={colors.textFaint}
                  autoFocus={!modalBase}
                />
              </View>
              <Text style={styles.modalOperator}>{expModal?.mode === 'sup' ? '^' : '_'}</Text>
              <View style={styles.modalField}>
                <Text style={styles.modalFieldLabel}>{expModal?.mode === 'sup' ? 'الأُس' : 'الدليل'}</Text>
                <TextInput
                  style={styles.modalInput}
                  value={modalRaised}
                  onChangeText={setModalRaised}
                  placeholder={expModal?.mode === 'sup' ? 'n' : '1'}
                  placeholderTextColor={colors.textFaint}
                  autoFocus={!!modalBase}
                />
              </View>
            </View>

            <View style={styles.modalPreviewWrap}>
              <Text style={styles.modalPreviewLabel}>هيتحط:</Text>
              <Text style={styles.modalPreviewText} numberOfLines={1}>
                {previewText || '—'}
              </Text>
            </View>

            <View style={styles.modalActions}>
              <Pressable style={styles.modalCancelButton} onPress={closeExpModal}>
                <Text style={styles.modalCancelText}>إلغاء</Text>
              </Pressable>
              <Pressable
                style={[styles.modalConfirmButton, !previewText && styles.modalConfirmButtonDisabled]}
                onPress={confirmExpModal}
                disabled={!previewText}
              >
                <Text style={styles.modalConfirmText}>إدراج</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  actionsRow: { flexDirection: 'row', gap: spacing.xs, marginBottom: spacing.xs },
  actionButton: {
    flex: 1,
    paddingVertical: 6,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.primary + '40',
    backgroundColor: colors.primary + '14',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 1,
  },
  actionButtonGlyph: { color: colors.primary, fontSize: 15, fontFamily: fonts.semiBold },
  actionButtonLabel: { color: colors.primary, fontSize: 10, fontFamily: fonts.medium },

  toolbar: { marginBottom: spacing.xs },
  toolbarContent: { alignItems: 'center', paddingVertical: 2, paddingHorizontal: 2 },
  group: { flexDirection: 'row', gap: spacing.xs },
  groupDivider: { width: 1, height: 22, backgroundColor: colors.border, marginHorizontal: spacing.sm },
  symbolButton: {
    minWidth: 34,
    height: 32,
    paddingHorizontal: 8,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  symbolButtonText: { color: colors.text, fontSize: 15, fontFamily: fonts.semiBold },

  previewCard: {
    marginTop: spacing.xs,
    padding: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.border,
    backgroundColor: colors.surfaceAlt,
  },
  previewLabel: { color: colors.textFaint, fontSize: 10, fontFamily: fonts.medium, marginBottom: 4 },
  previewText: { marginTop: 0 },

  eqInput: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: 12,
    fontSize: 16,
    minHeight: 56,
    color: colors.text,
    backgroundColor: colors.surfaceAlt,
    textAlignVertical: 'top',
    textAlign: 'left',
    writingDirection: 'ltr',
  },
  eqToolbar: { marginTop: spacing.sm },

  modalOverlay: {
    flex: 1,
    backgroundColor: '#000000AA',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  modalCard: {
    width: '100%',
    maxWidth: 400,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
  },
  modalTitle: { color: colors.text, fontSize: 16, fontFamily: fonts.bold, marginBottom: 4 },
  modalHint: { color: colors.textFaint, fontSize: 12, lineHeight: 17, marginBottom: spacing.md },
  modalFieldsRow: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm },
  modalField: { flex: 1 },
  modalFieldLabel: { color: colors.textMuted, fontSize: 11, marginBottom: 4, fontFamily: fonts.medium },
  modalInput: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: 12,
    fontSize: 16,
    color: colors.text,
    backgroundColor: colors.surfaceAlt,
    textAlign: 'center',
  },
  modalOperator: { color: colors.textFaint, fontSize: 18, fontFamily: fonts.bold, marginBottom: 12 },
  // Row of "apply to whichever box is focused" buttons under the
  // numerator/denominator fields — see fracFocusedField's own comment.
  fracExpRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.sm },
  fracExpRowLabel: { color: colors.textMuted, fontSize: 12, fontFamily: fonts.medium },
  modalPreviewWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.md,
    padding: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceAlt,
  },
  modalPreviewLabel: { color: colors.textFaint, fontSize: 12, fontFamily: fonts.medium },
  modalPreviewText: { color: colors.accent, fontSize: 20, fontFamily: fonts.semiBold, flex: 1 },
  modalActions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg },
  modalCancelButton: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingVertical: 12,
    alignItems: 'center',
  },
  modalCancelText: { color: colors.textMuted, fontFamily: fonts.semiBold },
  modalConfirmButton: {
    flex: 1,
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    paddingVertical: 12,
    alignItems: 'center',
  },
  modalConfirmButtonDisabled: { opacity: 0.5 },
  modalConfirmText: { color: colors.onPrimary, fontFamily: fonts.bold },
});
