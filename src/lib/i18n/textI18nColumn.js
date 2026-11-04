/* The two columns 20261251 adds, probed rather than assumed, for the reason
   given in schemaColumnProbe.js: a save that writes text_i18n before the
   migration has been applied would fail on every line, not just the translated
   ones. Until the probe answers, translations exist only in the open document
   and the plain English columns keep working untouched. */
import { columnExists } from '../schemaColumnProbe';

export const textI18nColumn = (table) => columnExists(table, 'text_i18n');

/* The tenant's enabled-language list. Reading it is what decides whether a
   language control appears anywhere at all, so a miss here must mean "English
   only" and not an exception in the settings page. */
export const documentLanguagesColumn = () => columnExists('company_billing_settings', 'document_languages');
