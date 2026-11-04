/* The i18n entry points the document generators use.

   Two rules run through everything here.

   1. English is the source, never a translation. A label asked for in a
      language no dictionary carries falls back to English; a label no dictionary
      carries at all prints its own key, so a missing translation shows up in a
      proof print instead of silently shipping English words inside a Portuguese
      document.
   2. An English document must come out byte-identical to the one the builder
      prints today. So every formatter here takes the *base* style from the call
      site - the locale, the decimal places, the symbol placement the document
      already uses - and only replaces it when the language is a translation.
      That is why the formatters below read as `style, lang` rather than just
      `lang`: the style belongs to the document, the language to the reader. */

import { DOCUMENT_LABELS, statusLabelKey } from './documentLabels.js';
import {
  isTranslatedDocument,
  localeOf,
  SOURCE_LANGUAGE
} from './languages.js';

export {
  enabledLanguageCodes,
  isKnownLanguage,
  isTranslatedDocument,
  languageChoices,
  languageOf,
  LANGUAGES,
  localeOf,
  SOURCE_LANGUAGE
} from './languages.js';
export { DOCUMENT_LABELS, DOCUMENT_LABEL_KEYS, statusLabelKey } from './documentLabels.js';

const pluralValue = (count) => {
  const n = Number(count);
  return Number.isFinite(n) ? n : 0;
};

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/* Intl.PluralRules answers the category the language itself uses - which is why
   this cannot be `n === 1 ? 'one' : 'other'`: French counts 0 as "one", German
   and Spanish do not. A locale the runtime does not know falls back to the
   English two-form split rather than throwing inside a document build. */
const pluralCategory = (locale, count) => {
  try {
    return new Intl.PluralRules(locale).select(pluralValue(count));
  } catch {
    return pluralValue(count) === 1 ? 'one' : 'other';
  }
};

/* Only placeholders the caller passes are substituted, so a forgotten variable
   stays visible as `{price}` in the proof rather than vanishing. */
const interpolate = (template, vars) => {
  if (!vars) return template;
  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (match, name) => (
    Object.prototype.hasOwnProperty.call(vars, name) && vars[name] !== undefined && vars[name] !== null
      ? String(vars[name])
      : match
  ));
};

const entryOf = (lang, key) => {
  const dictionary = DOCUMENT_LABELS[lang === SOURCE_LANGUAGE ? SOURCE_LANGUAGE : String(lang || '')];
  const inLanguage = dictionary ? dictionary[key] : undefined;
  if (inLanguage !== undefined) return inLanguage;
  return DOCUMENT_LABELS[SOURCE_LANGUAGE][key];
};

export const t = (lang, key, vars) => {
  const entry = entryOf(lang, key);
  if (entry === undefined) return key;
  if (typeof entry === 'string') return interpolate(entry, vars);
  const category = pluralCategory(localeOf(lang), vars ? vars.count ?? vars.n : 1);
  const form = entry[category] ?? entry.other ?? entry.one;
  if (typeof form !== 'string') return key;
  return interpolate(form, vars);
};

/* A bound label function, so a generator thread one `L('doc.day', { n })`
   through a whole document instead of passing the language to every call. */
export const labelFor = (lang) => (key, vars) => t(lang, key, vars);

export const statusLabel = (lang, status) => t(lang, statusLabelKey(status));

/* Operator prose. Content is typed in English into the item's own column and
   translated into `text_i18n` per language, so an untranslated line reads in
   English rather than leaving a hole in a client document. Supabase hands a
   JSONB column back as an object, but a row built by a script or an older save
   path can carry the JSON text, so both are accepted. */
const parsedI18n = (row) => {
  const raw = row?.text_i18n ?? row?.textI18n;
  if (!raw) return null;
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
  return typeof raw === 'object' && !Array.isArray(raw) ? raw : null;
};

const filled = (value) => (typeof value === 'string' && value.trim() ? value : '');

/* A language's own set of fields, or null when it has none - a hand-edited row
   can hold anything under a language key, and a document must not crash on it. */
const languageBlock = (row, lang) => {
  const block = parsedI18n(row)?.[String(lang)];
  return block && typeof block === 'object' && !Array.isArray(block) ? block : null;
};

export const localizedText = (row, field, lang) => {
  const source = filled(row?.[field]);
  if (!isTranslatedDocument(lang)) return source;
  return filled(languageBlock(row, lang)?.[field]) || source;
};

/* The editor shows what has actually been typed, not what a document would fall
   back to: a Portuguese box holding the English text would read as translated
   and stop the operator from filling it in. */
export const translationOf = (row, field, lang) => filled(languageBlock(row, lang)?.[field]);

/* The whole block, as an editor needs it: the editors hold the translation object
   in row state and send it back untouched except for the field being typed, so a
   column that came from an older save path as JSON text has to read here too. */
export const translationsOf = (row) => parsedI18n(row);

/* The write half of a save payload: the block, or no key at all. A tenant with
   nothing but English - or a workspace whose migration has not landed, where the
   column would reject the whole row - writes exactly the payload it wrote before
   any of this existed. */
export const textI18nPayload = (canStore, translations) => (
  canStore ? { text_i18n: translations || {} } : {}
);

/* The write half of the same shape: a translated value goes into
   `text_i18n[lang][field]`, English never does (it owns the plain column), and
   clearing a translation removes its key instead of storing an empty string -
   an empty string would win over the English fallback on the next read. */
export const setLocalizedText = (row, field, lang, value) => {
  const current = parsedI18n(row) || {};
  const next = { ...current };
  if (!isTranslatedDocument(lang)) return next;
  const key = String(lang);
  const byField = { ...(languageBlock(row, lang) || {}) };
  const text = typeof value === 'string' ? value : '';
  if (text.trim()) byField[field] = text;
  else delete byField[field];
  if (Object.keys(byField).length) next[key] = byField;
  else delete next[key];
  return next;
};

/* Money. `style` is what this document already does for an English reader; a
   translated document keeps the same symbol and placement but gets that
   language's digit grouping, because `R 1.234,56` is what a Brazilian buyer
   reads and `R 1,234.56` is what they don't. */
const moneyStyle = (style) => ({
  locale: 'en-ZA',
  min: 2,
  max: 2,
  prefix: '',
  suffix: '',
  ...style
});

export const formatMoney = (value, lang, style) => {
  const s = moneyStyle(style);
  const locale = isTranslatedDocument(lang) ? localeOf(lang) : s.locale;
  const digits = { minimumFractionDigits: s.min, maximumFractionDigits: s.max };
  const n = round2(value);
  return `${s.prefix}${(Number.isFinite(n) ? n : 0).toLocaleString(locale, digits)}${s.suffix}`;
};

/* Dates. Same rule: the base locale is the one the document already renders
   with, so an English date is untouched; a translated one gets the month and
   weekday names of its language while keeping the field set. */
const dateLocale = (lang, baseLocale) => (isTranslatedDocument(lang) ? localeOf(lang) : baseLocale || 'en-GB');

const utcDay = (iso) => {
  const s = String(iso || '').slice(0, 10);
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const [y, mo, d] = m.slice(1).map(Number);
  if (!y || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return new Date(Date.UTC(y, mo - 1, d));
};

export const formatDate = (iso, lang, { options, baseLocale = 'en-GB' } = {}) => {
  const day = utcDay(iso);
  if (!day) return '';
  return day.toLocaleDateString(dateLocale(lang, baseLocale), { ...options, timeZone: 'UTC' });
};

export const formatMonth = (month, lang, { withYear = true, baseLocale = 'en-GB' } = {}) => {
  const s = String(month || '').slice(0, 7);
  const m = s.match(/^(\d{4})-(\d{2})$/);
  if (!m) return '';
  const year = Number(m[1]);
  const monthNumber = Number(m[2]);
  if (!year || monthNumber < 1 || monthNumber > 12) return '';
  const date = new Date(Date.UTC(year, monthNumber - 1, 1));
  return date.toLocaleDateString(dateLocale(lang, baseLocale), {
    month: 'long',
    ...(withYear ? { year: 'numeric' } : {}),
    timeZone: 'UTC'
  });
};

/* "November 2026", "November – December 2026", "November 2026 – January 2027" -
   the month-window reading of travel timing, in the reader's language. It takes
   the timing object rather than the row so the date maths stays in
   travelTiming.js and this only chooses words. */
export const monthRangeText = (fromMonth, toMonth, lang, options) => {
  const from = String(fromMonth || '').slice(0, 7);
  const to = String(toMonth || '').slice(0, 7);
  if (!from) return '';
  if (!to || to === from) return formatMonth(from, lang, options);
  const sameYear = from.slice(0, 4) === to.slice(0, 4);
  return `${formatMonth(from, lang, { ...options, withYear: !sameYear })} – ${formatMonth(to, lang, options)}`;
};

export const travelTimingText = (timing, lang) => {
  if (!timing) return '';
  const L = labelFor(lang);
  if (timing.precision !== 'month') {
    if (!timing.start) return L('doc.datesNotSet');
    const short = (iso) => formatDate(iso, lang, {
      options: { day: '2-digit', month: 'short', year: 'numeric' }
    });
    return `${short(timing.start)} → ${short(timing.end || timing.start)}`;
  }
  /* A month window says how long the tour runs as well as when it can start,
     because the day rows carry no dates to count. */
  const monthLabel = monthRangeText(timing.monthFrom, timing.monthTo, lang);
  const daysSuffix = timing.durationDays > 0
    ? ` · ${L('doc.days', { n: timing.durationDays, count: timing.durationDays })}`
    : '';
  return `${monthLabel || L('doc.monthNotSet')} ${L('doc.datesToBeConfirmed')}${daysSuffix}`;
};
