/* Multi-language documents.

   Two things this has to hold. The first is that a translated document is
   complete - every language carries every key, every plural form, and every
   placeholder the English one does, so a proof print never shows `{price}`.
   The second is that English is untouched: it is the source, the fallback for
   any line nobody translated, and the figure and date formats the documents
   were built with. A tenant with nothing but English gets no language control
   and the same document it always got. */
import {
  DOCUMENT_LABELS,
  DOCUMENT_LABEL_KEYS,
  SOURCE_LANGUAGE,
  enabledLanguageCodes,
  formatMoney,
  formatDate,
  isKnownLanguage,
  isTranslatedDocument,
  labelFor,
  languageChoices,
  localeOf,
  localizedText,
  monthRangeText,
  setLocalizedText,
  statusLabel,
  t,
  textI18nPayload,
  translationOf,
  translationsOf,
  travelTimingText
} from '../src/lib/i18n/index.js';
import { withStarGrade } from '../src/lib/starGrading.js';

let failures = 0;
const check = (label, actual, expected) => {
  const ok = Object.is(actual, expected);
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}: got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
};
const checkJson = (label, actual, expected) => check(label, JSON.stringify(actual), JSON.stringify(expected));

const LANGUAGES = Object.keys(DOCUMENT_LABELS);

/* - The dictionaries ---------------------------------------------------------------------------- */

check('the registry leads with English', LANGUAGES[0], SOURCE_LANGUAGE);
check('the registry carries the four agreed translations', LANGUAGES.slice(1).join(','), 'pt-BR,fr,de,es');

for (const lang of LANGUAGES) {
  const keys = Object.keys(DOCUMENT_LABELS[lang]);
  checkJson(`${lang}: every English key is present`, DOCUMENT_LABEL_KEYS.filter((k) => keys.indexOf(k) < 0), []);
  checkJson(`${lang}: no key English does not have`, keys.filter((k) => DOCUMENT_LABEL_KEYS.indexOf(k) < 0), []);
}

const placeholdersOf = (entry) => {
  const texts = typeof entry === 'string' ? [entry] : Object.values(entry);
  const names = new Set();
  for (const text of texts) {
    for (const match of String(text).matchAll(/\{([a-zA-Z0-9_]+)\}/g)) names.add(match[1]);
  }
  return [...names].sort().join(',');
};

for (const key of DOCUMENT_LABEL_KEYS) {
  for (const lang of LANGUAGES.slice(1)) {
    const english = DOCUMENT_LABELS[SOURCE_LANGUAGE][key];
    const other = DOCUMENT_LABELS[lang][key];
    if (typeof english === 'string') {
      check(`${lang}/${key}: a plural key stays a plural key`, typeof other, 'string');
    } else {
      check(`${lang}/${key}: counts the same plural forms`, typeof other, 'object');
    }
    check(`${lang}/${key}: takes the same placeholders`, placeholdersOf(other), placeholdersOf(english));
  }
}

/* The English column is the specification: each of these is a phrase a client
   document printed before any of this existed, pinned here so a later edit to
   the dictionary cannot silently rewrite the English export. */
check('the pricing header is the one the documents print', DOCUMENT_LABELS.en['doc.pricingBreakdown'], 'Pricing Breakdown');
check('the itinerary heading is unchanged', DOCUMENT_LABELS.en['doc.itinerary'], 'Itinerary');
check('the day heading is unchanged', DOCUMENT_LABELS.en['doc.day'], 'Day {n}');
check('the sharing row is unchanged', DOCUMENT_LABELS.en['doc.perPersonSharingNote'], 'Per person, sharing price:');
check('the ladder sentence is unchanged', DOCUMENT_LABELS.en['doc.contractLadder'], 'contract ladder: {bits}');

/* The per-person cost breakdown rows, whose figures are one traveller's money. */
check('the per-person supplement row says whose figure it is', t('en', 'doc.singleSupplementPerPerson'), 'Single supplement (per person)');
check('the per-person total row reads as a total', DOCUMENT_LABELS.en['doc.totalPerPerson'], 'TOTAL PER PERSON');
check('the child row names the children and each one price',
  t('en', 'doc.childRateAdjustment', { count: 2, each: 'R -460.00' }), 'Child price difference (2 at R -460.00)');
check('the child row reads in German',
  t('de', 'doc.childRateAdjustment', { count: 2, each: 'R -460.00' }), 'Kinderpreisdifferenz (2 zu je R -460.00)');
check('the per-person total row reads in French', t('fr', 'doc.totalPerPerson'), 'TOTAL PAR PERSONNE');

check('a translated label is not English', DOCUMENT_LABELS['pt-BR']['doc.pricingBreakdown'], 'Preços Detalhados');
check('a missing language falls back to English', t('xx', 'doc.itinerary'), 'Itinerary');
check('an unknown key prints its own name', t('fr', 'doc.not_a_real_key'), 'doc.not_a_real_key');
check('a forgotten placeholder stays visible', t('en', 'doc.day', {}), 'Day {n}');

/* - Plurals -------------------------------------------------------------------------------------- */

/* Intl.PluralRules answers these, which is the whole reason a plural key cannot
   be one string: French counts 0 with the "one" form, German does not. */
check('English counts one traveller', t('en', 'doc.travellers', { n: 1, count: 1 }), '1 traveller');
check('English counts two travellers', t('en', 'doc.travellers', { n: 2, count: 2 }), '2 travellers');
check('French puts zero in the singular', t('fr', 'doc.travellers', { n: 0, count: 0 }), '0 voyageur');
check('German puts zero in the plural', t('de', 'doc.travellers', { n: 0, count: 0 }), '0 Reisende');
check('one star reads as one star in Portuguese', t('pt-BR', 'doc.stars', { n: 1, count: 1 }), '1 estrela');
check('three stars read as plural in Portuguese', t('pt-BR', 'doc.stars', { n: 3, count: 3 }), '3 estrelas');
check('the waived single reads singular', t('en', 'doc.ladderWaived', { n: 1, count: 1 }), 'first 1 single room waived');
check('the waived singles read plural', t('en', 'doc.ladderWaived', { n: 3, count: 3 }), 'first 3 single rooms waived');
check('the waived singles read plural in Spanish', t('es', 'doc.ladderWaived', { n: 2, count: 2 }), 'los 2 primeros individuales sin suplemento');
check('the waived single reads singular in French', t('fr', 'doc.ladderWaived', { n: 1, count: 1 }), 'la 1re chambre individuelle offerte');

/* - Figures and dates ---------------------------------------------------------------------------- */

/* A document declares its own money style; only a translated language replaces
   it. The invariant is therefore not a spelling - ICU decides that - but that
   English answers with the very call the document made before any of this
   existed. Both builders' own formatters are reproduced here for that reason. */
const base = (value, locale, min, max) => value.toLocaleString(locale, { minimumFractionDigits: min, maximumFractionDigits: max });
const packageStyle = { locale: 'en-ZA', min: 2, max: 2, prefix: 'ZAR ' };
check('English money is the packages own call', formatMoney(1234.5, 'en', packageStyle), `ZAR ${base(1234.5, 'en-ZA', 2, 2)}`);
check('a null language is English', formatMoney(1234.5, null, packageStyle), formatMoney(1234.5, 'en', packageStyle));
check('Portuguese money uses its own grouping', formatMoney(1234.5, 'pt-BR', packageStyle), `ZAR ${base(1234.5, 'pt-BR', 2, 2)}`);
check('German money uses its own grouping', formatMoney(1234.5, 'de', packageStyle), `ZAR ${base(1234.5, 'de-DE', 2, 2)}`);
const itineraryStyle = { locale: 'en-US', min: 0, max: 2, prefix: 'R' };
check('the itinerary keeps its own symbol and decimals', formatMoney(1234.5, 'en', itineraryStyle), `R${base(1234.5, 'en-US', 0, 2)}`);
check('the itinerary in French keeps the symbol', formatMoney(1234.5, 'fr', itineraryStyle), `R${base(1234.5, 'fr-FR', 0, 2)}`);
check('a translated figure is not the English one', formatMoney(1234.5, 'pt-BR', itineraryStyle) !== formatMoney(1234.5, 'en', itineraryStyle), true);
check('no value prints as zero', formatMoney(undefined, 'en', packageStyle), `ZAR ${base(0, 'en-ZA', 2, 2)}`);

const dayFields = { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' };
const dayOptions = { options: dayFields, baseLocale: 'en-US' };
/* Same derivation as money: the guarantee is that English answers with the call
   the document already made, and that a translated document changes only the
   locale while keeping the field set. */
const dateIn = (locale) => new Date(Date.UTC(2026, 10, 2)).toLocaleDateString(locale, { ...dayFields, timeZone: 'UTC' });
check('an English date is untouched', formatDate('2026-11-02', 'en', dayOptions), dateIn('en-US'));
check('a date keeps its fields when translated', formatDate('2026-11-02', 'pt-BR', dayOptions), dateIn('pt-BR'));
check('the day of the month survives the translation', formatDate('2026-11-02', 'pt-BR', dayOptions).includes('2'), true);
check('an impossible date prints nothing', formatDate('not a date', 'pt-BR', dayOptions), '');
check('a month reads in the reader language', monthRangeText('2026-11', '2026-11', 'en'), 'November 2026');
check('a month range drops the first year', monthRangeText('2026-11', '2026-12', 'en'), 'November – December 2026');
check('a month range across years keeps both', monthRangeText('2026-11', '2027-01', 'en'), 'November 2026 – January 2027');
check('a month range speaks Portuguese', monthRangeText('2026-11', '2026-12', 'pt-BR'), 'novembro – dezembro de 2026');

checkJson('exact timing in English', travelTimingText({ precision: 'exact', start: '2026-11-02', end: '2026-11-09' }, 'en'), '02 Nov 2026 → 09 Nov 2026');
checkJson('month timing in English', travelTimingText({ precision: 'month', monthFrom: '2026-11', monthTo: '2026-12', durationDays: 5 }, 'en'), 'November – December 2026 (dates to be confirmed) · 5 days');
check('a month window without days', travelTimingText({ precision: 'month', monthFrom: '2026-11', monthTo: '2026-11' }, 'en'), 'November 2026 (dates to be confirmed)');
check('an unset date window says so in the language', travelTimingText({ precision: 'exact', start: '' }, 'fr'), 'Dates non définies');
check('a null timing says nothing', travelTimingText(null, 'fr'), '');

check('a stored status reads as the app reads it', statusLabel('en', 'pending_confirmation'), 'Quotation');
check('a provisional booking keeps its own word', statusLabel('en', 'provisional_booking'), 'Provisional Booking');
check('a status with no spelling is a quotation', statusLabel('en', 'whatever'), 'Quotation');
check('the same status in German', statusLabel('de', 'Confirmed Booking'), 'Bestätigte Buchung');

/* - Operator prose ------------------------------------------------------------------------------- */

const row = {
  description: 'Three nights on the Skeleton Coast.',
  name: 'Henties Lodge',
  text_i18n: { 'pt-BR': { description: 'Três noites na Skeleton Coast.' }, fr: {} }
};
check('English always reads its own column', localizedText(row, 'description', 'en'), 'Three nights on the Skeleton Coast.');
check('a translated line reads its own text', localizedText(row, 'description', 'pt-BR'), 'Três noites na Skeleton Coast.');
check('an untranslated line falls back to English', localizedText(row, 'description', 'fr'), 'Three nights on the Skeleton Coast.');
check('a field nobody translated falls back too', localizedText(row, 'notes', 'pt-BR'), '');
check('the editor never shows a fallback as a translation', translationOf(row, 'notes', 'pt-BR'), '');
check('the editor shows what was typed', translationOf(row, 'description', 'pt-BR'), 'Três noites na Skeleton Coast.');
check('whitespace is not a translation', localizedText({ description: ' ', text_i18n: { de: { description: '   ' } } }, 'description', 'de'), '');
check('a row with no block at all reads its column', localizedText({ description: 'Plain' }, 'description', 'es'), 'Plain');
check('a JSON text block reads like a real one', localizedText({ description: 'Plain', text_i18n: JSON.stringify({ es: { description: 'Sencillo' } }) }, 'description', 'es'), 'Sencillo');
check('a broken JSON block is ignored', localizedText({ description: 'Plain', text_i18n: '{not json' }, 'description', 'es'), 'Plain');
check('a non-object language block is ignored', localizedText({ description: 'Plain', text_i18n: { es: 'Sencillo' } }, 'description', 'es'), 'Plain');

checkJson('English is never written into the block', setLocalizedText(row, 'description', 'en', 'Rewritten'), row.text_i18n);
checkJson('a translated value lands under its language and field',
  setLocalizedText(row, 'description', 'de', 'Drei Nächte.'),
  { 'pt-BR': { description: 'Três noites na Skeleton Coast.' }, fr: {}, de: { description: 'Drei Nächte.' } });
checkJson('clearing a translation removes the key',
  setLocalizedText({ text_i18n: setLocalizedText(row, 'description', 'de', 'Drei Nächte.') }, 'description', 'de', '  '),
  { 'pt-BR': { description: 'Três noites na Skeleton Coast.' }, fr: {} });
checkJson('the whole block reads back', translationsOf(row), row.text_i18n);
check('a row with nothing to write has no block', translationsOf({ description: 'Plain' }), null);

checkJson('an English-only tenant writes no i18n column at all', textI18nPayload(false, { fr: { description: 'x' } }), {});
checkJson('a translated tenant writes the block', textI18nPayload(true, { fr: { description: 'x' } }), { text_i18n: { fr: { description: 'x' } } });
checkJson('a translated tenant with nothing typed writes an empty block', textI18nPayload(true, null), { text_i18n: {} });

/* - The language control ------------------------------------------------------------------------- */

/* The user's rule: English is the default and, when no other language is set,
   no document asks for one. Both builders gate their picker on
   `contentLanguages.length > 1`, so an enabled list of one is the whole guard. */
checkJson('nothing stored means English only', enabledLanguageCodes(null), [SOURCE_LANGUAGE]);
checkJson('an empty list means English only', enabledLanguageCodes([]), [SOURCE_LANGUAGE]);
checkJson('an unknown code is dropped', enabledLanguageCodes(['cy']), [SOURCE_LANGUAGE]);
checkJson('English never has to be listed', enabledLanguageCodes(['de', 'en']), ['en', 'de']);
checkJson('English leads whatever the order typed', enabledLanguageCodes(['de', 'pt-BR', 'fr']), ['en', 'de', 'pt-BR', 'fr']);
checkJson('the picker follows the registry order', languageChoices(['de', 'pt-BR', 'fr']).map((c) => c.value), ['en', 'pt-BR', 'fr', 'de']);
check('an English-only tenant gets one choice', languageChoices(['en']).length, 1);
check('and so the picker stays hidden', languageChoices(['en']).length > 1, false);
check('two languages and the picker appears', languageChoices(['en', 'fr']).length > 1, true);
check('the source language is marked as the source', languageChoices(['en', 'fr'])[0].label, 'English (source)');
check('a translation is offered by its own name', languageChoices(['en', 'pt-BR'])[1].label, 'Português (BR)');
check('English is the source, not a translation', isTranslatedDocument(SOURCE_LANGUAGE), false);
check('a translation is a translation', isTranslatedDocument('pt-BR'), true);
check('an unknown code is not a translation', isTranslatedDocument('cy'), false);
check('no code is English', isTranslatedDocument(null), false);
check('a code nobody knows still reads in English', isKnownLanguage('cy'), false);
check('the money locale comes from the registry', localeOf('pt-BR'), 'pt-BR');
check('an unknown language uses the source locale', localeOf('cy'), localeOf(SOURCE_LANGUAGE));

/* A document thread reads the language once and calls it through every label. */
const L = labelFor('pt-BR');
check('the bound label answers in its own language', L('doc.itinerary'), 'Itinerário');
check('and interpolates for it', L('doc.paxCell', { n: 6 }), '6 pax');
const enLabel = labelFor('en');
check('a bound English label is the plain phrase', enLabel('doc.travelSeasons'), 'Travel seasons');

/* - Words the builders hand to shared helpers ---------------------------------------------------- */

/* The grade beside a hotel name is composed in starGrading.js, which knows no
   language of its own: each builder passes the words its document language
   uses, and the English default keeps the phrase it always printed. */
check('an English document names the grade as before', withStarGrade('Boardwalk Hotel', 4), 'Boardwalk Hotel (4-star)');
check('a Portuguese document counts the stars its own way',
  withStarGrade('Boardwalk Hotel', 4, t('pt-BR', 'doc.stars', { n: 4, count: 4 })), 'Boardwalk Hotel (4 estrelas)');
check('an ungraded hotel adds nothing, in any language', withStarGrade('Riverside Lodge', null, ''), 'Riverside Lodge');

console.log(failures ? `\n${failures} i18n document assertion(s) failed.` : '\nAll i18n document assertions passed.');
process.exit(failures ? 1 : 0);
