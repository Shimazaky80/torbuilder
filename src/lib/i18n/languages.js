/* The languages a tenant can export documents in.

   English is not a translation target: it is the language the operator types
   content in, and the fallback every other language leans on when a line has no
   version yet. `source` marks it so, and the app never offers it as a box to
   fill. A code is a BCP 47 tag because that is what Intl takes for money and
   dates - and a document must read `R 1.234,56` in Portuguese, not the South
   African English figures it was built with. */

export const SOURCE_LANGUAGE = 'en';

export const LANGUAGES = [
  { code: 'en', label: 'English', locale: 'en-ZA', source: true },
  { code: 'pt-BR', label: 'Português (BR)', locale: 'pt-BR' },
  { code: 'fr', label: 'Français', locale: 'fr-FR' },
  { code: 'de', label: 'Deutsch', locale: 'de-DE' },
  { code: 'es', label: 'Español', locale: 'es-ES' }
];

export const isKnownLanguage = (code) => LANGUAGES.some((entry) => entry.code === code);

export const languageOf = (code) => LANGUAGES.find((entry) => entry.code === code) || LANGUAGES[0];

export const localeOf = (code) => languageOf(code).locale;

/* A tenant with nothing but English must not see a language control anywhere -
   not in Settings, not on an item, not at export. The stored list always leads
   with English whatever the operator typed, so a half-filled array can never
   drop the source language and leave a document with no fallback. */
export const enabledLanguageCodes = (stored) => {
  const list = Array.isArray(stored) ? stored.map((code) => String(code || '').trim()).filter(isKnownLanguage) : [];
  return [SOURCE_LANGUAGE, ...list.filter((code) => code !== SOURCE_LANGUAGE)];
};

export const isTranslatedDocument = (code) => (
  Boolean(code) && code !== SOURCE_LANGUAGE && isKnownLanguage(code)
);

/* The picker the export dialog and Settings show: every language the tenant has
   switched on, in the order the registry lists them. */
export const languageChoices = (codes) => {
  const enabled = enabledLanguageCodes(codes);
  return LANGUAGES.filter((entry) => enabled.includes(entry.code))
    .map((entry) => ({ value: entry.code, label: entry.code === SOURCE_LANGUAGE ? `${entry.label} (source)` : entry.label }));
};
