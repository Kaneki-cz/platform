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

import { toSubUnicode, toSupUnicode } from '@/components/MathText';
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
 *  - Actions row: a handful of square "operation" cards (math mode, bold,
 *    exponent, subscript) — exponent/subscript don't insert anything
 *    directly, they open the popup below instead (see EXPONENT MODAL).
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

const MATH_WRAP: SymbolButton = { label: '$…$', kind: 'wrap', open: '$', close: '$' };
const BOLD_WRAP: SymbolButton = { label: 'B', kind: 'wrap', open: '**', close: '**' };

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
  const [expModal, setExpModal] = useState<{ mode: 'sup' | 'sub' } | null>(null);
  const [modalBase, setModalBase] = useState('');
  const [modalRaised, setModalRaised] = useState('');

  const applyButton = (btn: SymbolButton) => {
    const start = Math.min(selection.start, value.length);
    const end = Math.min(Math.max(selection.end, start), value.length);
    const before = value.slice(0, start);
    const selected = value.slice(start, end);
    const after = value.slice(end);

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

    onChangeText(nextText);
    setSelection({ start: nextCursor, end: nextCursor });
    // A button tap can blur the field on Android — pull focus back so the
    // next keystroke lands right where it should, cursor already moved.
    inputRef.current?.focus();
  };

  const openExpModal = (mode: 'sup' | 'sub') => {
    const start = Math.min(selection.start, value.length);
    const end = Math.min(Math.max(selection.end, start), value.length);
    // Whatever's already selected becomes the starting Base — the common
    // case is selecting "R" (or "v") right before reaching for this.
    setModalBase(value.slice(start, end));
    setModalRaised('');
    setExpModal({ mode });
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
    const start = Math.min(selection.start, value.length);
    const end = Math.min(Math.max(selection.end, start), value.length);
    const before = value.slice(0, start);
    const after = value.slice(end);
    const inserted = modalBase + convertRaised(expModal.mode, modalRaised);
    if (!inserted) {
      closeExpModal();
      return;
    }
    const nextText = before + inserted + after;
    const nextCursor = before.length + inserted.length;
    onChangeText(nextText);
    setSelection({ start: nextCursor, end: nextCursor });
    closeExpModal();
    inputRef.current?.focus();
  };

  const previewText = expModal ? modalBase + convertRaised(expModal.mode, modalRaised) : '';

  return (
    <View>
      {/* Actions: the four things that change how a whole chunk of text is
          treated, not a single inserted character — visually set apart from
          the plain symbol chips below with a tinted, bordered card each. */}
      <View style={styles.actionsRow}>
        <Pressable style={styles.actionButton} onPress={() => applyButton(MATH_WRAP)}>
          <Text style={styles.actionButtonGlyph}>$…$</Text>
          <Text style={styles.actionButtonLabel}>رياضيات</Text>
        </Pressable>
        <Pressable style={styles.actionButton} onPress={() => applyButton(BOLD_WRAP)}>
          <Text style={[styles.actionButtonGlyph, { fontFamily: fonts.bold }]}>B</Text>
          <Text style={styles.actionButtonLabel}>غامق</Text>
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

      <Modal visible={!!expModal} transparent animationType="fade" onRequestClose={closeExpModal}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>
              {expModal?.mode === 'sup' ? 'إدراج أُس' : 'إدراج دليل سفلي'}
            </Text>
            <Text style={styles.modalHint}>
              اكتب الأساس في الخانة الأولى، و{expModal?.mode === 'sup' ? 'الأُس' : 'الدليل'} في التانية —
              هيتحطوا في مكان المؤشر الحالي.
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
