import React, { createContext, useContext, useEffect, useState } from 'react';

import { getSavedLanguage, setSavedLanguage } from '@/lib/api';

export type Language = 'ar' | 'en';

interface LanguageContextValue {
  language: Language;
  setLanguage: (language: Language) => void;
  toggleLanguage: () => void;
}

// Defaults to Arabic (this app's primary audience) until the saved
// preference (if any) loads from SecureStore, a moment after first mount.
const LanguageContext = createContext<LanguageContextValue>({
  language: 'ar',
  setLanguage: () => {},
  toggleLanguage: () => {},
});

/**
 * App-wide UI language (Arabic/English) for the student-facing screens —
 * login/register, home, courses, lessons, profile, and the AI Assistant's
 * own chrome. This is entirely separate from the AI Assistant's answers,
 * which already follow whatever language the student's question was asked
 * in regardless of this setting. The admin screens are not covered by this
 * toggle and stay English.
 *
 * Wraps the whole app (see app/_layout.tsx) so any screen can call
 * useLanguage() and get the current choice plus a way to change it — the
 * choice is persisted via SecureStore (lib/api.ts) so it survives app
 * restarts, and switching it anywhere (e.g. the Assistant tab's own toggle)
 * updates every other screen immediately since they all read from this one
 * shared value.
 */
export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [language, setLanguageState] = useState<Language>('ar');

  useEffect(() => {
    getSavedLanguage()
      .then((saved) => {
        if (saved) setLanguageState(saved);
      })
      .catch(() => {});
  }, []);

  const setLanguage = (next: Language) => {
    setLanguageState(next);
    setSavedLanguage(next).catch(() => {});
  };

  const toggleLanguage = () => setLanguage(language === 'ar' ? 'en' : 'ar');

  return (
    <LanguageContext.Provider value={{ language, setLanguage, toggleLanguage }}>{children}</LanguageContext.Provider>
  );
}

export function useLanguage(): LanguageContextValue {
  return useContext(LanguageContext);
}
