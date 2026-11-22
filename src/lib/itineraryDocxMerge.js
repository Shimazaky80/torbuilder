/* DOCX merge engine. The uploaded file is opened as a WordprocessingML package,
   printed labels such as "DATE OF TRAVEL:" are filled in place, the explicit
   {{placeholders}} are rendered from the itinerary map, and the result is handed
   back as real .docx bytes. Nothing here touches the built-in document generator:
   that stays available as the export fallback. */

import PizZip from 'pizzip';
import Docxtemplater from 'docxtemplater';
import { ITINERARY_DOCX_MIME_TYPE } from './itineraryTemplateData';
import { replaceKnownItineraryFieldsInDocxZip } from './itineraryDocxFields';

export const ITINERARY_DOCX_MIME = ITINERARY_DOCX_MIME_TYPE;

const renderErrors = (error) => {
  const errors = error?.properties?.errors;
  if (!Array.isArray(errors) || !errors.length) return '';
  return errors.map((item) => item?.message || String(item)).filter(Boolean).join('; ');
};

export const renderItineraryDocxBytes = ({ arrayBuffer, data = {} } = {}) => {
  if (!arrayBuffer) throw new Error('The saved template could not be read.');

  let zip;
  try {
    zip = new PizZip(arrayBuffer);
  } catch {
    throw new Error('The saved template is not a valid Word document.');
  }

  /* Printed labels are filled before docxtemplater runs, so a document with no
     {{...}} placeholders still receives current values while every other word,
     table and policy stays exactly as uploaded. */
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

  return doc.getZip().generate({ type: 'uint8array', compression: 'DEFLATE' });
};

export const itineraryDocxBlob = (bytes) => new Blob([bytes], { type: ITINERARY_DOCX_MIME_TYPE });

export const itineraryDocxFileName = (reference) => `${String(reference || 'itinerary').replace(/[^\w-]+/g, '_')}.docx`;
