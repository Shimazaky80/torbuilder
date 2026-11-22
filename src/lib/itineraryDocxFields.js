/* Printed-label filling for Word templates.

   A branded .docx is often written as "DATE OF TRAVEL:" in one paragraph and
   the dates in the next, with no {{placeholder}} at all. This module edits the
   WordprocessingML text nodes in place: the label, its styling, the rest of the
   wording and every table/border stay exactly as uploaded; only the value beside
   a known label is swapped for the current itinerary value. Explicit
   {{placeholders}} are left alone for docxtemplater to render afterwards. */

import { findTemplateField, templateFieldValue } from './itineraryTemplateFields';

const decodeXml = (value) => String(value ?? '')
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"')
  .replace(/&apos;/g, "'")
  .replace(/&#39;/g, "'")
  .replace(/&amp;/g, '&');

const encodeXml = (value) => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&apos;');

const TEXT_NODE = /<w:t\b([^>]*)>([\s\S]*?)<\/w:t>/g;

const paragraphText = (paragraph) => Array.from(paragraph.matchAll(TEXT_NODE))
  .map((match) => decodeXml(match[2]))
  .join('');

/* Keep the first run's attributes - and therefore its font/style - and empty
   any later runs that held the rest of the old value. */
const replaceParagraphText = (paragraph, nextText) => {
  let node = 0;
  const replaced = paragraph.replace(TEXT_NODE, (match, attributes) => {
    node += 1;
    return `<w:t${attributes}>${node === 1 ? encodeXml(nextText) : ''}</w:t>`;
  });
  if (node) return replaced;
  const run = `<w:r><w:t xml:space="preserve">${encodeXml(nextText)}</w:t></w:r>`;
  return replaced.replace(/<\/w:p>$/, `${run}</w:p>`);
};

/* A value line is short, unlabelled and not a sentence. This is what lets a
   second line such as "4px" under PASSENGERS be cleared while the following
   "Prezado/a," letter is left untouched. */
const looksLikeFieldValue = (text) => {
  const value = String(text ?? '').trim();
  if (!value || value.length > 80) return false;
  if (findTemplateField(value)) return false;
  if (/[.!?,;:]$/.test(value)) return false;
  if (/^[-•*]/.test(value)) return false;
  if (/^(POR FAVOR|POR FAVOUR|KOBO |PREZADO|DEAR |THANK |MUITO |HELLO |SIR\/MADAM)/i.test(value)) return false;
  return true;
};

const inlineLabelValue = (field) => field.labelText.endsWith(':')
  ? `${field.labelText} ${field.value || ''}`.trimEnd()
  : `${field.labelText}${field.value ? ` ${field.value}` : ''}`;

/* The capture keeps the paragraph chunks in `split`, so even indexes are the
   untouched XML between paragraphs and odd indexes are the paragraphs. */
const PARAGRAPH = /(<w:p\b[^>]*>[\s\S]*?<\/w:p>)/g;

export const replaceKnownItineraryFieldsInXml = (xml, data = {}) => {
  const records = String(xml ?? '').split(PARAGRAPH).map((chunk, index) => ({
    xml: chunk,
    isParagraph: index % 2 === 1,
    text: index % 2 === 1 ? paragraphText(chunk) : ''
  }));
  const consumed = new Set();
  let replacements = 0;

  for (let index = 0; index < records.length; index += 1) {
    if (consumed.has(index) || !records[index].isParagraph) continue;
    const field = findTemplateField(records[index].text);
    if (!field) continue;

    const nextValue = templateFieldValue(data, field.key);

    if (field.value) {
      records[index].xml = replaceParagraphText(records[index].xml, inlineLabelValue({ ...field, value: nextValue }));
      replacements += 1;
      continue;
    }

    let target = -1;
    for (let look = index + 1; look < records.length && look <= index + 3; look += 1) {
      const candidate = records[look];
      if (!candidate.isParagraph || consumed.has(look)) continue;
      if (!candidate.text.trim()) continue;
      if (!looksLikeFieldValue(candidate.text)) break;
      target = look;
      break;
    }

    if (target >= 0) {
      records[target].xml = replaceParagraphText(records[target].xml, nextValue);
      consumed.add(target);
      /* A value can occupy more than one short line ("2x DBL" / "4px"). Only
         clear those extra lines, never a letter, term or policy that follows. */
      for (let extra = target + 1; extra < records.length; extra += 1) {
        const candidate = records[extra];
        if (!candidate.isParagraph || consumed.has(extra) || !candidate.text.trim()) continue;
        if (!looksLikeFieldValue(candidate.text)) break;
        records[extra].xml = replaceParagraphText(records[extra].xml, '');
        consumed.add(extra);
      }
    } else {
      /* No printed value yet: add one styled like its label so the uploaded
         layout still decides how the field looks. */
      records[index].xml += replaceParagraphText(records[index].xml, nextValue);
    }
    replacements += 1;
  }

  return { xml: records.map((record) => record.xml).join(''), replacements };
};

export const replaceKnownItineraryFieldsInDocxZip = (zip, data = {}) => {
  let replacements = 0;
  const parts = zip.file(/word\/(document|header\d*|footer\d*)\.xml$/);
  parts.forEach((part) => {
    const result = replaceKnownItineraryFieldsInXml(part.asText(), data);
    if (result.replacements) {
      /* The regex lookup returns read-only file objects; writing by name is the
         supported PizZip way to update an existing part. */
      zip.file(part.name, result.xml);
      replacements += result.replacements;
    }
  });
  return replacements;
};
