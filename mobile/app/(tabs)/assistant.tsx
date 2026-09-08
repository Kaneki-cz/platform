import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { LinearGradient } from 'expo-linear-gradient';
import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import {
  ApiError,
  askPhysicsAssistant,
  getAiUsage,
  getChatHistory,
  getSavedAssistantSessionId,
  setSavedAssistantSessionId,
} from '@/lib/api';
import { MathText } from '@/components/MathText';
import { VisualizationRenderer } from '@/components/visualizations/VisualizationRenderer';
import { useLanguage, type Language } from '@/context/LanguageContext';
import { colors, gradientBrand, radius, spacing } from '@/constants/theme';
import type { AskResponse, UsageInfo, VisualizationPayload } from '@/lib/types';

// expo-clipboard ships its own native module (ExpoClipboard) that has to be
// compiled into the app binary — a plain `import` throws immediately at
// module-load time on a build that predates adding this dependency
// (confirmed: it took down the whole screen, not just the copy button,
// until this became a guarded require). Loading it this way means the copy
// button quietly degrades (see onCopy below) on an older build instead of
// crashing everything; once the dev-client APK is rebuilt with the new
// dependency baked in, this starts resolving to the real module with no
// further code changes needed.
let ClipboardModule: typeof import('expo-clipboard') | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  ClipboardModule = require('expo-clipboard');
} catch {
  ClipboardModule = null;
}

interface DisplayMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  visualization?: VisualizationPayload | null;
  // Local URI of a photo the student attached to this message (user
  // messages only) — never re-sent, just shown in the bubble.
  imageUri?: string;
  // Set on an assistant message that represents a failed request (network/
  // server error — NOT a "you're out of questions" limit message, since
  // retrying that one can't help). Carries what's needed to resend the
  // exact same request from the Retry button without the student having
  // to retype anything.
  isError?: boolean;
  retryText?: string;
  retryImageBase64?: string;
  retryImageUri?: string;
}

interface AttachedImage {
  uri: string;
  base64: string;
}

// All of this screen's own chrome — buttons, placeholders, alerts, error
// text — translated up front rather than left in English. This is
// SEPARATE from the AI's actual answers, which already follow whatever
// language the student asks their question in (see MathText's RTL
// handling); this only covers the fixed UI text around the conversation,
// and the student can switch it anytime with the language button in the
// top bar (saved via SecureStore so the choice survives app restarts).
const STRINGS: Record<
  Language,
  {
    welcome: string;
    newChat: string;
    send: string;
    thinking: string;
    copy: string;
    copied: string;
    copyUnavailable: string;
    retry: string;
    placeholderNormal: string;
    placeholderAtLimit: string;
    usageLoading: string;
    usageUnlimited: string;
    usageAtLimit: string;
    usageLeftToday: (remaining: number, total: number) => string;
    limitReachedError: string;
    genericError: string;
    imageOnlyQuestion: string;
    cameraPermTitle: string;
    cameraPermMsg: string;
    photoPermTitle: string;
    photoPermMsg: string;
    attachFailReadTitle: string;
    attachFailReadMsg: string;
    attachFailPickTitle: string;
    attachFailPickMsg: string;
    attachSheetTitle: string;
    attachSheetMsg: string;
    attachCamera: string;
    attachGallery: string;
    attachCancel: string;
  }
> = {
  ar: {
    welcome:
      'أهلاً! أنا مساعدك في الفيزياء. اسألني عن أي حاجة في الفيزياء — مفهوم عايز تفهمه، مسألة عايز تحلها، أو ابعتلي صورة المسألة.',
    newChat: 'محادثة جديدة',
    send: 'إرسال',
    thinking: 'بيفكر...',
    copy: 'نسخ',
    copied: 'اتنسخ',
    copyUnavailable: 'الميزة دي هتشتغل بعد ما نحدّث نسخة التطبيق.',
    retry: 'إعادة المحاولة',
    placeholderNormal: 'اسأل سؤال في الفيزياء...',
    placeholderAtLimit: 'خلصت أسئلتك بتاعت النهاردة',
    usageLoading: 'بيحمّل…',
    usageUnlimited: 'أسئلة مفتوحة من غير حد',
    usageAtLimit: 'خلصت أسئلة النهاردة — هترجع الساعة 12 بالليل',
    usageLeftToday: (remaining, total) => `${remaining} من ${total} سؤال فاضل النهاردة`,
    limitReachedError: 'وصلت لحد أسئلة النهاردة. هيترجع تاني الساعة 12 بالليل — أشوفك بكرة!',
    genericError: 'معلش، معرفتش أوصل لمساعد الفيزياء دلوقتي.',
    imageOnlyQuestion: 'من فضلك حل المسألة الموجودة في الصورة دي.',
    cameraPermTitle: 'محتاجين إذن الكاميرا',
    cameraPermMsg: 'اسمح بالوصول للكاميرا عشان تصوّر المسألة.',
    photoPermTitle: 'محتاجين إذن الصور',
    photoPermMsg: 'اسمح بالوصول لمعرض الصور عشان ترفق صورة.',
    attachFailReadTitle: 'معرفناش نرفق الصورة',
    attachFailReadMsg: 'الصورة دي معرفناش نقرأها. جرب صورة تانية.',
    attachFailPickTitle: 'معرفناش نرفق الصورة',
    attachFailPickMsg: 'حصلت مشكلة أثناء اختيار الصورة. حاول تاني.',
    attachSheetTitle: 'إرفاق صورة',
    attachSheetMsg: 'المسألة فين؟',
    attachCamera: 'الكاميرا',
    attachGallery: 'المعرض',
    attachCancel: 'إلغاء',
  },
  en: {
    welcome:
      "Hi! I'm your Physics Assistant. Ask me anything about physics — a concept you want explained, a problem you need solved, or attach a photo of one.",
    newChat: 'New chat',
    send: 'Send',
    thinking: 'Thinking...',
    copy: 'Copy',
    copied: 'Copied',
    copyUnavailable: 'This feature will work after the next app update.',
    retry: 'Retry',
    placeholderNormal: 'Ask a physics question...',
    placeholderAtLimit: "You're out of questions for today",
    usageLoading: 'Loading…',
    usageUnlimited: 'Unlimited questions',
    usageAtLimit: 'Out of questions — resets at midnight',
    usageLeftToday: (remaining, total) => `${remaining}/${total} left today`,
    limitReachedError: "You've reached today's question limit. It resets at midnight — see you tomorrow!",
    genericError: "Sorry, I couldn't reach the physics assistant. Please try again.",
    imageOnlyQuestion: 'Please solve the problem shown in this photo.',
    cameraPermTitle: 'Camera permission needed',
    cameraPermMsg: 'Allow camera access to take a photo of a problem.',
    photoPermTitle: 'Photo permission needed',
    photoPermMsg: 'Allow photo library access to attach a picture.',
    attachFailReadTitle: 'Could not attach photo',
    attachFailReadMsg: 'That image could not be read. Please try another one.',
    attachFailPickTitle: 'Could not attach photo',
    attachFailPickMsg: 'Something went wrong picking that image. Please try again.',
    attachSheetTitle: 'Attach a photo',
    attachSheetMsg: 'Where is the problem?',
    attachCamera: 'Camera',
    attachGallery: 'Gallery',
    attachCancel: 'Cancel',
  },
};

// The app talks ONLY to our backend's /api/v1/ai/ask — never directly to
// Qwen. See the plan's "Important Security Rule".
export default function AssistantScreen() {
  // Shared with every other student-facing screen (see
  // context/LanguageContext.tsx) — switching it here or on the Profile tab
  // updates both immediately, since they read from the same value.
  const { language, toggleLanguage } = useLanguage();
  const t = STRINGS[language];

  const [messages, setMessages] = useState<DisplayMessage[]>(() => [
    { id: 'welcome', role: 'assistant', content: STRINGS.ar.welcome },
  ]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [usage, setUsage] = useState<UsageInfo | null>(null);
  const [attachedImage, setAttachedImage] = useState<AttachedImage | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const sessionId = useRef<string | undefined>(undefined);
  const listRef = useRef<FlatList>(null);

  // Resume the last conversation (if any) instead of always starting from
  // scratch — a saved session id survives app restarts (see lib/api.ts),
  // while the messages themselves live server-side and are fetched here.
  // Also loads today's remaining-question count up front so it's visible
  // before the student sends anything. The UI language itself comes from
  // the shared context (see useLanguage() above), not loaded here.
  useEffect(() => {
    getAiUsage()
      .then(setUsage)
      .catch(() => {});

    (async () => {
      const savedId = await getSavedAssistantSessionId().catch(() => null);
      if (!savedId) return;
      try {
        const history = await getChatHistory(savedId);
        if (!history.length) return;
        sessionId.current = savedId;
        setMessages(
          history.map((m, idx) => ({
            id: `${savedId}-${idx}`,
            role: m.role,
            content: m.content,
            visualization: m.visualization,
          })),
        );
      } catch {
        // Saved session no longer exists (or isn't ours) — forget it and
        // keep showing the fresh-start welcome message.
        await setSavedAssistantSessionId(null);
      }
    })();
  }, []);

  // Reacts to the language changing from ANY source — this screen's own
  // toggle below, or the Profile tab's language switch — since both just
  // update the one shared value in context/LanguageContext.tsx. Only swaps
  // the welcome message's own text; never touches real conversation
  // history, which stays exactly as it was said.
  useEffect(() => {
    setMessages((prev) =>
      prev.length === 1 && prev[0].id === 'welcome' ? [{ id: 'welcome', role: 'assistant', content: t.welcome }] : prev,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [language]);

  const onNewChat = async () => {
    sessionId.current = undefined;
    setAttachedImage(null);
    setMessages([{ id: 'welcome', role: 'assistant', content: t.welcome }]);
    await setSavedAssistantSessionId(null);
  };

  const pickImageFrom = async (source: 'camera' | 'gallery') => {
    try {
      if (source === 'camera') {
        const permission = await ImagePicker.requestCameraPermissionsAsync();
        if (!permission.granted) {
          Alert.alert(t.cameraPermTitle, t.cameraPermMsg);
          return;
        }
      } else {
        const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!permission.granted) {
          Alert.alert(t.photoPermTitle, t.photoPermMsg);
          return;
        }
      }

      // quality 0.4: keeps the base64 payload reasonable over a mobile
      // connection without a separate image-resizing step.
      const result =
        source === 'camera'
          ? await ImagePicker.launchCameraAsync({ quality: 0.4, base64: true })
          : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.4, base64: true });

      if (result.canceled || !result.assets?.length) return;
      const asset = result.assets[0];
      if (!asset.base64) {
        Alert.alert(t.attachFailReadTitle, t.attachFailReadMsg);
        return;
      }
      setAttachedImage({ uri: asset.uri, base64: asset.base64 });
    } catch {
      Alert.alert(t.attachFailPickTitle, t.attachFailPickMsg);
    }
  };

  const onPickImage = () => {
    Alert.alert(t.attachSheetTitle, t.attachSheetMsg, [
      { text: t.attachCamera, onPress: () => pickImageFrom('camera') },
      { text: t.attachGallery, onPress: () => pickImageFrom('gallery') },
      { text: t.attachCancel, style: 'cancel' },
    ]);
  };

  // Shared by a fresh send and a Retry tap — everything past "we have a
  // question (and/or image) to ask" is identical either way. Appends
  // whatever the backend gives back (a real answer, or a fresh error
  // bubble with its own retry data) rather than mutating anything the
  // caller already put in the list.
  const runAsk = async (question: string, image: AttachedImage | null) => {
    setSending(true);
    try {
      const res: AskResponse = await askPhysicsAssistant(
        question || (image ? t.imageOnlyQuestion : ''),
        sessionId.current,
        image?.base64,
      );
      sessionId.current = res.session_id;
      await setSavedAssistantSessionId(res.session_id);
      setUsage({
        used_today: res.daily_limit !== null && res.remaining_today !== null ? res.daily_limit - res.remaining_today : 0,
        daily_limit: res.daily_limit,
        remaining_today: res.remaining_today,
        bonus_questions_today: res.bonus_questions_today,
      });
      setMessages((prev) => [
        ...prev,
        { id: res.session_id + Date.now(), role: 'assistant', content: res.answer, visualization: res.visualization },
      ]);
    } catch (e) {
      const limitHit = e instanceof ApiError && e.status === 429;
      setMessages((prev) => [
        ...prev,
        {
          id: `${Date.now()}-err`,
          role: 'assistant',
          content: limitHit ? t.limitReachedError : t.genericError,
          // Retrying a limit-hit error can't help (it'll just 429 again) —
          // only offer Retry for a real network/server failure.
          isError: !limitHit,
          retryText: limitHit ? undefined : question,
          retryImageBase64: limitHit ? undefined : image?.base64,
          retryImageUri: limitHit ? undefined : image?.uri,
        },
      ]);
      if (limitHit) setUsage((prev) => (prev ? { ...prev, remaining_today: 0 } : prev));
    } finally {
      setSending(false);
      setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 100);
    }
  };

  const send = async () => {
    const question = input.trim();
    if ((!question && !attachedImage) || sending) return;

    const imageToSend = attachedImage;
    setInput('');
    setAttachedImage(null);
    setMessages((prev) => [
      ...prev,
      { id: `${Date.now()}-user`, role: 'user', content: question, imageUri: imageToSend?.uri },
    ]);
    await runAsk(question, imageToSend);
  };

  const retry = async (item: DisplayMessage) => {
    if (sending) return;
    // The student's original question bubble is still sitting above this
    // one — just drop the error and re-attempt, rather than adding a
    // second copy of the question.
    setMessages((prev) => prev.filter((m) => m.id !== item.id));
    const image = item.retryImageBase64 ? { base64: item.retryImageBase64, uri: item.retryImageUri ?? '' } : null;
    await runAsk(item.retryText ?? '', image);
  };

  const onCopy = async (item: DisplayMessage) => {
    if (!ClipboardModule) {
      Alert.alert(t.copy, t.copyUnavailable);
      return;
    }
    try {
      await ClipboardModule.setStringAsync(item.content);
      setCopiedId(item.id);
      setTimeout(() => setCopiedId((c) => (c === item.id ? null : c)), 1500);
    } catch {
      // Copy is a nice-to-have — a failure here isn't worth alarming the
      // student over.
    }
  };

  const atLimit = usage !== null && usage.remaining_today !== null && usage.remaining_today <= 0;
  const hasBonus = (usage?.bonus_questions_today ?? 0) > 0;

  // Icon + label pair for the usage badge — one glance tells you which of
  // the four states you're in (still loading, unlimited/Pro, out for today,
  // or "X left", with a distinct gift icon when a bonus grant is boosting
  // today's count) without reading the number closely.
  const usageIconName: keyof typeof Ionicons.glyphMap = !usage
    ? 'hourglass-outline'
    : usage.remaining_today === null
      ? 'infinite'
      : atLimit
        ? 'time-outline'
        : hasBonus
          ? 'gift'
          : 'flash';
  const usageText = !usage
    ? t.usageLoading
    : usage.remaining_today === null
      ? t.usageUnlimited
      : atLimit
        ? t.usageAtLimit
        : t.usageLeftToday(usage.remaining_today, usage.daily_limit ?? 0);

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={90}
    >
      <View style={styles.topBar}>
        <View style={[styles.usageBadge, atLimit && styles.usageBadgeAtLimit]}>
          <Ionicons
            name={usageIconName}
            size={14}
            color={atLimit ? colors.danger : colors.primary}
            style={styles.usageIcon}
          />
          <Text style={[styles.usageText, atLimit && styles.usageTextAtLimit]} numberOfLines={1}>
            {usageText}
          </Text>
        </View>
        <View style={styles.topBarActions}>
          <Pressable style={styles.newChatButton} onPress={onNewChat} hitSlop={8}>
            <Ionicons name="add-circle" size={16} color={colors.primary} style={styles.newChatIcon} />
            <Text style={styles.newChatText}>{t.newChat}</Text>
          </Pressable>
          <Pressable style={styles.langButton} onPress={toggleLanguage} hitSlop={8}>
            <Text style={styles.langButtonText}>{language === 'ar' ? 'EN' : 'ع'}</Text>
          </Pressable>
        </View>
      </View>

      <FlatList
        ref={listRef}
        data={messages}
        keyExtractor={(m) => m.id}
        contentContainerStyle={{ padding: 16 }}
        renderItem={({ item }) => {
          const isUser = item.role === 'user';
          // MathText handles plain text, **bold**, and $...$ math alike —
          // route every assistant message through it (the AI sometimes adds
          // markdown/emphasis even in answers with no equations at all).
          // (A WebView + real KaTeX version was tried again in this app's
          // history and, again, never rendered anything visible on the test
          // device even once the obvious causes were ruled out — see
          // MathWebView.tsx's comments — so it's parked rather than shipped
          // with an artificial delay on every message.)
          // 2026 redesign pass: the student's own bubble gets the app's
          // signature gradient fill instead of a flat cyan block — assistant
          // bubbles are untouched. LinearGradient takes a style prop exactly
          // like View, so swapping the wrapping element per-branch is enough;
          // nothing about the message content or actions below changes.
          const BubbleWrap = isUser ? LinearGradient : View;
          const bubbleGradientProps = isUser
            ? { colors: gradientBrand, start: { x: 0, y: 0 }, end: { x: 1, y: 1 } }
            : {};
          return (
            <BubbleWrap
              style={[styles.bubble, isUser ? styles.userBubble : styles.assistantBubble]}
              {...bubbleGradientProps}
            >
              {isUser ? (
                <>
                  {item.imageUri ? <Image source={{ uri: item.imageUri }} style={styles.messageImage} /> : null}
                  {item.content ? <Text style={styles.userText}>{item.content}</Text> : null}
                </>
              ) : (
                <>
                  <MathText text={item.content} color={colors.text} fontSize={15} />
                  <View style={styles.bubbleActions}>
                    {item.isError ? (
                      <Pressable style={styles.bubbleActionButton} onPress={() => retry(item)} hitSlop={8}>
                        <Ionicons name="refresh" size={13} color={colors.textMuted} />
                        <Text style={styles.bubbleActionText}>{t.retry}</Text>
                      </Pressable>
                    ) : item.id !== 'welcome' ? (
                      <Pressable style={styles.bubbleActionButton} onPress={() => onCopy(item)} hitSlop={8}>
                        <Ionicons
                          name={copiedId === item.id ? 'checkmark' : 'copy-outline'}
                          size={13}
                          color={colors.textMuted}
                        />
                        <Text style={styles.bubbleActionText}>{copiedId === item.id ? t.copied : t.copy}</Text>
                      </Pressable>
                    ) : null}
                  </View>
                </>
              )}
              {item.visualization ? <VisualizationRenderer visualization={item.visualization} /> : null}
            </BubbleWrap>
          );
        }}
        ListFooterComponent={
          sending ? (
            <View style={[styles.bubble, styles.assistantBubble, styles.typingBubble]}>
              <ActivityIndicator size="small" color={colors.accent} />
              <Text style={styles.typingText}>{t.thinking}</Text>
            </View>
          ) : null
        }
      />

      {attachedImage ? (
        <View style={styles.attachedRow}>
          <Image source={{ uri: attachedImage.uri }} style={styles.attachedThumb} />
          <Pressable style={styles.removeAttachedButton} onPress={() => setAttachedImage(null)} hitSlop={8}>
            <Ionicons name="close" size={14} color={colors.textMuted} />
          </Pressable>
        </View>
      ) : null}

      <View style={styles.inputRow}>
        <Pressable style={styles.attachButton} onPress={onPickImage} disabled={sending}>
          <Ionicons name="scan-outline" size={20} color={colors.textMuted} />
        </Pressable>
        <TextInput
          style={styles.input}
          placeholder={atLimit ? t.placeholderAtLimit : t.placeholderNormal}
          placeholderTextColor="#9ca3af"
          value={input}
          onChangeText={setInput}
          onSubmitEditing={send}
          multiline
        />
        <Pressable
          style={[styles.sendButton, sending && styles.sendButtonDisabled]}
          onPress={send}
          disabled={sending}
          accessibilityLabel={t.send}
        >
          <Ionicons name="arrow-up" size={22} color={colors.onPrimary} />
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xs,
  },
  usageBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.pill,
    paddingVertical: 6,
    paddingHorizontal: 12,
    flexShrink: 1,
  },
  usageBadgeAtLimit: { backgroundColor: colors.dangerSurface, borderColor: colors.danger },
  usageIcon: { marginRight: 1 },
  usageText: { color: colors.textMuted, fontSize: 12, fontWeight: '600', flexShrink: 1 },
  usageTextAtLimit: { color: colors.danger },
  topBarActions: { flexDirection: 'row', alignItems: 'center' },
  langButton: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.pill,
    paddingVertical: 6,
    paddingHorizontal: 10,
    marginLeft: spacing.sm,
  },
  langButtonText: { color: colors.primary, fontSize: 12, fontWeight: '700' },
  newChatButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.pill,
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  newChatIcon: { marginRight: 1 },
  newChatText: { color: colors.primary, fontSize: 13, fontWeight: '600' },
  bubble: { borderRadius: radius.lg, padding: spacing.md, marginBottom: spacing.sm, maxWidth: '90%' },
  userBubble: { alignSelf: 'flex-end' },
  assistantBubble: {
    backgroundColor: colors.surface,
    alignSelf: 'flex-start',
    borderLeftWidth: 3,
    borderLeftColor: colors.accent,
  },
  userText: { color: colors.onPrimary, fontSize: 15 },
  assistantText: { color: colors.text, fontSize: 15 },
  messageImage: { width: 180, height: 180, borderRadius: radius.md, marginBottom: spacing.xs },
  bubbleActions: { flexDirection: 'row', marginTop: spacing.xs },
  bubbleActionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
  },
  bubbleActionText: { color: colors.textMuted, fontSize: 12, fontWeight: '600' },
  typingBubble: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  typingText: { color: colors.textMuted, fontSize: 14 },
  attachedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
  },
  attachedThumb: { width: 56, height: 56, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border },
  removeAttachedButton: {
    marginLeft: spacing.sm,
    width: 24,
    height: 24,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    padding: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  attachButton: {
    width: 42,
    height: 42,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.sm,
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.pill,
    paddingHorizontal: 16,
    paddingVertical: 10,
    marginRight: spacing.sm,
    maxHeight: 100,
    color: colors.text,
    backgroundColor: colors.surfaceAlt,
  },
  sendButton: {
    width: 44,
    height: 44,
    borderRadius: radius.pill,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendButtonDisabled: { opacity: 0.5 },
});
