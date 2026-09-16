import React, { createContext, useContext } from 'react';

export type Language = 'ar' | 'en';

interface LanguageContextValue {
  language: Language;
  setLanguage: (language: Language) => void;
  toggleLanguage: () => void;
}

// The app's UI language is now fixed to English everywhere — student-facing
// screens, admin screens, the Assistant tab's own chrome, all of it. This was
// an explicit product decision, not a bug: Arabic CONTENT typed by
// admins/teachers (course titles, lesson text, question prompts, chat
// messages...) is backend data and was never part of this toggle in the
// first place, so it's completely unaffected — only each screen's own UI
// strings (its STRINGS.ar/STRINGS.en table) are pinned to 'en' here.
// setLanguage/toggleLanguage are kept as harmless no-ops (rather than
// stripped out, which would mean touching every screen that destructures
// them) so nothing can silently flip the UI back to Arabic.
const FIXED_VALUE: LanguageContextValue = {
  language: 'en',
  setLanguage: () => {},
  toggleLanguage: () => {},
};

const LanguageContext = createContext<LanguageContextValue>(FIXED_VALUE);

/**
 * App-wide UI language provider — see the fixed-to-English note above.
 * Still wraps the whole app (app/_layout.tsx) and still exposes the same
 * useLanguage() shape every screen already calls, so no other file needs to
 * change; every consumer just always reads back 'en' now.
 */
export function LanguageProvider({ children }: { children: React.ReactNode }) {
  return <LanguageContext.Provider value={FIXED_VALUE}>{children}</LanguageContext.Provider>;
}

export function useLanguage(): LanguageContextValue {
  return useContext(LanguageContext);
}
