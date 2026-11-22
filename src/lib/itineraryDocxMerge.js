/* DOCX merge engine. The uploaded file is opened as a WordprocessingML package,
   printed labels and single-brace signature tokens such as "{Tour Designer}" are
   filled in place, the explicit {{placeholders}} are rendered from the itinerary
   map, and any missing day-by-day, inclusions, exclusions or pricing sections are
   appended as ordinary Word paragraphs/tables. The result is handed back as real
   .docx bytes. Nothing here touches the built-in document generator: that stays
   available as the export fallback. */

import PizZip from 'pizzip';
import Docxtemplater from 'docxtemplater';
import { ITINERARY_DOCX_MIME_TYPE } from './itineraryTemplateData';
import { replaceKnownItineraryFieldsInDocxZip } from './itineraryDocxFields';
import { appendItinerarySectionsToDocxZip, readDocxTypography } from './itineraryDocxSections';
import { translateDocxTemplatePartsInZip } from './i18n/documentTemplateTranslations';

export const ITINERARY_DOCX_MIME = ITINERARY_DOCX_MIME_TYPE;

const renderErrors = (error) => {
  const errors = error?.properties?.errors;
  if (!Array.isArray(errors) || !errors.length) return '';
  return errors.map((item) => item?.message || String(item)).filter(Boolean).join('; ');
};

/* Some letterheads carry the same branding twice: once in the body and once
   in the Word header. The body logo is the one the operator sees as the page
   letterhead, and the footer mark is separate. When the body already carries
   an image, drop image runs from headers only so printed output does not show
   the logo a second time. Header wording and every other part stay untouched. */
const removeDuplicateHeaderImages = (zip, sourceXml = '') => {
  if (!/<w:pict\b|<w:drawing\b/i.test(sourceXml)) return;
  zip.file(/^word\/header\d+\.xml$/i).forEach((part) => {
    const xml = part.asText();
    const next = xml
      .replace(/<w:pict\b[^>]*>[\s\S]*?<\/w:pict>/gi, '')
      .replace(/<w:drawing\b[^>]*>[\s\S]*?<\/w:drawing>/gi, '');
    if (next !== xml) zip.file(part.name, next);
  });
};

export const renderItineraryDocxBytes = ({ arrayBuffer, data = {}, lang = data.lang || '' } = {}) => {
  if (!arrayBuffer) throw new Error('The saved template could not be read.');

  let zip;
  try {
    zip = new PizZip(arrayBuffer);
  } catch {
    throw new Error('The saved template is not a valid Word document.');
  }

  /* Read the original placeholder contract before anything is rewritten. If the
     template already loops over day sections or pricing rows, those sections are
     not appended again after the render. */
  const sourceXml = zip.file('word/document.xml')?.asText() || '';
  const typography = readDocxTypography(zip);

  /* The saved template is authored in English. When this export is in another
     language, translate the template's own wording first so the whole document
     reads in one language. Placeholders and tokens are protected, and text runs
     stay in place, so tables, headers, footers and branding survive. */
  translateDocxTemplatePartsInZip(zip, lang, data);

  /* Printed labels and single-brace tokens are filled before docxtemplater runs,
     so a document with no {{...}} placeholders still receives current values
     while every other word, table and policy stays exactly as uploaded. */
  replaceKnownItineraryFieldsInDocxZip(zip, data);

  let doc;
  try {
    /* The published placeholder contract uses {{name}}, so the delimiters are
       set explicitly rather than relying on the library's single-brace default. */
    doc = new Docxtemplater(zip, {
      paragraphLoop: true,
      linebreaks: true,
      delimiters: { start: '{{', end: '}}' }
    });
  } catch (error) {
    const detail = renderErrors(error);
    throw new Error(detail
      ? `The saved template has invalid placeholders: ${detail}`
      : 'The saved template is not a supported Word document.');
  }

  try {
    doc.render(data);
  } catch (error) {
    const detail = renderErrors(error);
    throw new Error(detail
      ? `The template placeholder could not be rendered: ${detail}`
      : `The template could not be rendered: ${error?.message || 'unknown error'}`);
  }

  const renderedZip = doc.getZip();
  removeDuplicateHeaderImages(renderedZip, sourceXml);

  /* Injected sections are added after docxtemplater so their text can never be
     mistaken for another placeholder. The template decides what it already
     contains; TorBuilder only supplies what is missing. */
  appendItinerarySectionsToDocxZip(renderedZip, data, { sourceXml, typography });

  return renderedZip.generate({ type: 'uint8array', compression: 'DEFLATE' });
};

export const itineraryDocxBlob = (bytes) => new Blob([bytes], { type: ITINERARY_DOCX_MIME_TYPE });

export const itineraryDocxFileName = (reference) => `${String(reference || 'itinerary').replace(/[^\w-]+/g, '_')}.docx`;
