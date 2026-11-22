/* PDF itinerary export from a saved template.

   The uploaded PDF stays the printable document: its pages, branding and terms
   are written through unchanged. pdf.js reads the printed labels and their
   positions, and pdf-lib covers only the old value with the current itinerary
   value. If the file has no recognisable labels, the original pages are still
   kept and a compact values page is appended so the export is usable. */

import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { ITINERARY_PDF_MIME_TYPE } from './itineraryTemplateData';
import { findTemplateField, templateFieldValue, TEMPLATE_FIELD_LABELS } from './itineraryTemplateFields';

GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

const escapeRegExp = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const looksLikePdfValue = (text) => {
  const value = String(text ?? '').trim();
  if (!value || value.length > 80) return false;
  if (findTemplateField(value)) return false;
  if (/[.!?,;:]$/.test(value)) return false;
  if (/^[-•*]/.test(value)) return false;
  if (/^(POR FAVOR|POR FAVOUR|KOBO |PREZADO|DEAR |THANK |MUITO |HELLO |SIR\/MADAM)/i.test(value)) return false;
  return true;
};

const itemWidth = (item) => Number(item.width) || String(item.text || '').length * (Number(item.height) || 10) * 0.5;

const readLines = async (page) => {
  const content = await page.getTextContent();
  const byHeight = new Map();
  content.items.forEach((item) => {
    const text = String(item.str ?? '').trim();
    if (!text) return;
    const y = Number(item.transform?.[5]) || 0;
    const key = Math.round(y / 3);
    if (!byHeight.has(key)) byHeight.set(key, []);
    byHeight.get(key).push({
      text,
      x: Number(item.transform?.[4]) || 0,
      y,
      width: itemWidth({ ...item, text }),
      height: Number(item.height) || 10
    });
  });
  return Array.from(byHeight.entries())
    .sort(([a], [b]) => b - a)
    .map(([, items]) => {
      const sorted = items.sort((a, b) => a.x - b.x);
      return { items: sorted, text: sorted.map((item) => item.text).join(' ') };
    });
};

const labelItemOf = (line, label) => {
  const startsWithLabel = new RegExp(`^\\s*${escapeRegExp(label)}\\b`, 'i');
  return line.items.find((item) => startsWithLabel.test(item.text));
};

const lineBounds = (items) => ({
  x: Math.min(...items.map((item) => item.x)),
  y: Math.max(...items.map((item) => item.y)),
  end: Math.max(...items.map((item) => item.x + item.width)),
  size: Math.max(...items.map((item) => item.height))
});

const coverAndWrite = (page, font, bounds, value) => {
  const text = templateFieldValueSafe(font, value);
  const size = Math.min(Math.max(bounds.size || 10, 7), 14);
  if (bounds.end > bounds.x) {
    page.drawRectangle({
      x: Math.max(0, bounds.x - 1),
      y: Math.max(0, bounds.y - 2),
      width: Math.max(1, bounds.end - bounds.x + 2),
      height: size + 4,
      color: rgb(1, 1, 1),
      borderWidth: 0
    });
  }
  page.drawText(text, { x: Math.max(0, bounds.x), y: bounds.y, size, font, color: rgb(0, 0, 0) });
};

/* Helvetica covers the Latin text these templates use. Anything outside its
   WinAnsi encoding degrades to '?' rather than failing the whole export. */
const templateFieldValueSafe = (font, value) => {
  const text = String(value ?? '');
  try {
    font.encodeText(text);
    return text;
  } catch {
    return text.replace(/[^\x20-\x7E]/g, '?');
  }
};

const appendValuesPage = (pdfDoc, font, data) => {
  const page = pdfDoc.addPage([595.28, 841.89]);
  const rows = TEMPLATE_FIELD_LABELS
    .map(({ key, label }) => ({ label, value: templateFieldValue(data, key) }))
    .filter((row) => row.value)
    .concat([
      { label: 'Pricing', value: templateFieldValue(data, 'pricing_summary') },
      { label: 'Company', value: templateFieldValue(data, 'company_name') }
    ].filter((row) => row.value));

  let y = 800;
  page.drawText('Itinerary details', { x: 48, y, size: 16, font, color: rgb(0.05, 0.29, 0.31) });
  y -= 30;
  rows.forEach((row) => {
    if (y < 60) return;
    page.drawText(`${row.label}:`, { x: 48, y, size: 10, font, color: rgb(0.2, 0.2, 0.2) });
    page.drawText(templateFieldValueSafe(font, row.value), { x: 200, y, size: 10, font, color: rgb(0, 0, 0) });
    y -= 18;
  });
};

export const renderItineraryPdfBytes = async ({ arrayBuffer, data = {} } = {}) => {
  if (!arrayBuffer) throw new Error('The saved PDF template could not be read.');

  let source;
  let linesByPage = [];
  try {
    source = await getDocument({ data: new Uint8Array(arrayBuffer), workerSrc: pdfWorkerUrl }).promise;
    for (let index = 0; index < source.numPages; index += 1) {
      const page = await source.getPage(index + 1);
      linesByPage.push(await readLines(page));
    }
  } catch (error) {
    throw new Error(error?.message ? `The saved PDF template could not be read: ${error.message}` : 'The saved PDF template could not be read.');
  } finally {
    await source?.destroy();
  }

  let pdfDoc;
  try {
    pdfDoc = await PDFDocument.load(arrayBuffer);
  } catch {
    throw new Error('The saved template is not a valid PDF document.');
  }

  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  let replacements = 0;

  linesByPage.forEach((lines, pageIndex) => {
    const page = pdfDoc.getPage(pageIndex);
    lines.forEach((line, lineIndex) => {
      const field = findTemplateField(line.text);
      if (!field) return;
      const value = templateFieldValue(data, field.key);
      const labelItem = labelItemOf(line, field.label);

      if (field.value || labelItem) {
        const items = labelItem ? line.items.filter((item) => item.x >= labelItem.x) : line.items;
        const bounds = lineBounds(items.length ? items : line.items);
        if (labelItem && !field.value) {
          bounds.x = labelItem.x + itemWidth(labelItem) + 2;
          bounds.end = Math.max(bounds.end, bounds.x + 80);
        } else if (labelItem) {
          const labelWidth = Math.min(itemWidth(labelItem), font.widthOfTextAtSize(field.labelText, bounds.size || 10) + 2);
          bounds.x = labelItem.x + labelWidth;
        }
        coverAndWrite(page, font, bounds, value);
      } else {
        const next = lines[lineIndex + 1];
        if (!next || !looksLikePdfValue(next.text)) return;
        coverAndWrite(page, font, lineBounds(next.items), value);
      }
      replacements += 1;
    });
  });

  if (!replacements) appendValuesPage(pdfDoc, font, data);
  return pdfDoc.save();
};

export const itineraryPdfBlob = (bytes) => new Blob([bytes], { type: ITINERARY_PDF_MIME_TYPE });

export const itineraryPdfFileName = (reference) => `${String(reference || 'itinerary').replace(/[^\w-]+/g, '_')}.pdf`;
