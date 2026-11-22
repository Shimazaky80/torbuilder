/* PDF itinerary export from a saved template.

   The uploaded PDF stays the printable document: its pages, branding and terms
   are written through unchanged. pdf.js reads the printed labels and their
   positions, and pdf-lib covers only the old value with the current itinerary
   value. The same itinerary feed then adds structured day-by-day, inclusions,
   exclusions and pricing pages so the export is complete even when the uploaded
   PDF only holds a branded header. */

import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { ITINERARY_PDF_MIME_TYPE } from './itineraryTemplateData';
import { findTemplateField, templateFieldValue, TEMPLATE_FIELD_LABELS } from './itineraryTemplateFields';
import { translateTemplateText, templateTextOverridesFor } from './i18n/documentTemplateTranslations';

GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

const escapeRegExp = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const looksLikePdfValue = (text) => {
  const value = String(text ?? '').trim();
  if (!value || value.length > 80) return false;
  if (findTemplateField(value)) return false;
  if (/[.!?,;:]$/.test(value)) return false;
  if (/^[-•*]/.test(value)) return false;
  if (/^(POR FAVOR|POR FAVOUR|KOBO |PREZADO|DEAR |THANK |MUITO |HELLO |SIR\/|MADAM|CHER |SEHR |ESTIMADO|SENHOR|SENHORA|JE VOUS|MERCI |VIELEN |GRACIAS |MUCHAS |OBSERVAÇÃO|VEUILLEZ|HINWEIS|NOTA\b|CERTIFIQUE|ENSURE |POLÍTICA|POLITIQUE|STORNO|CANCELLATION|ENTRE |BETWEEN |MENOS |LESS |ESPERO |I TRUST|ATENCIOSAMENTE|SINCERELY|CORDIALEMENT|ATENTAMENTE|MIT FREUNDLICHEN)/i.test(value)) return false;
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
      height: Number(item.height) || 10,
      fontName: item.fontName || ''
    });
  });
  const lines = Array.from(byHeight.entries())
    .sort(([a], [b]) => b - a)
    .map(([, items]) => {
      const sorted = items.sort((a, b) => a.x - b.x);
      return { items: sorted, text: sorted.map((item) => item.text).join(' ') };
    });
  return { lines, styles: content.styles || {} };
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

/* A translated sentence is usually longer than the English one it replaces.
   Keep the original line's start and point size where possible, shrink only as
   far as is still legible, and then wrap. The white patch is limited to the
   line's own text bounds so borders, logos and artwork behind it survive. */
const redrawTranslatedPdfLine = (page, font, bounds, translated) => {
  const baseSize = Math.min(Math.max(bounds.size || 10, 7), 14);
  const maxWidth = Math.max(60, Math.min(bounds.end - bounds.x + 12, PAGE_SIZE[0] - PAGE_MARGIN * 2));
  let size = baseSize;
  let lines = wrapText(font, translated, size, maxWidth);
  while (lines.length > 1 && size > 7) {
    size -= 0.5;
    lines = wrapText(font, translated, size, maxWidth);
  }
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
  lines.forEach((line, index) => {
    page.drawText(templateFieldValueSafe(font, line), {
      x: Math.max(0, bounds.x),
      y: Math.max(0, bounds.y - index * (size + 3)),
      size,
      font,
      color: rgb(0, 0, 0)
    });
  });
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

const PAGE_SIZE = [595.28, 841.89];
const PAGE_MARGIN = 46;
const PAGE_TOP = 795;
const PAGE_BOTTOM = 52;
const TABLE_WIDTHS = [54, 66, 205, 34, 62, 90, 62, 86];

/* pdf-lib can only draw embedded fonts, so the template's header font family is
   mapped to the closest standard family and its point size is carried through
   to every appended page. */
export const pdfTypographyOf = (fontFamily = '', headerSize = 10) => {
  const family = String(fontFamily || '');
  const size = Math.min(Math.max(Number(headerSize) || 10, 7), 16);
  if (/courier|mono|consolas/i.test(family)) {
    return { regular: StandardFonts.Courier, bold: StandardFonts.CourierBold, size };
  }
  if (/times|serif|georgia|cambria|bookman/i.test(family)) {
    return { regular: StandardFonts.TimesRoman, bold: StandardFonts.TimesRomanBold, size };
  }
  return { regular: StandardFonts.Helvetica, bold: StandardFonts.HelveticaBold, size };
};

const wrapText = (font, value, size, maxWidth) => {
  const words = templateFieldValueSafe(font, value).split(/\s+/).filter(Boolean);
  if (!words.length) return [''];
  const lines = [];
  let line = '';
  words.forEach((word) => {
    const candidate = line ? `${line} ${word}` : word;
    if (line && font.widthOfTextAtSize(candidate, size) > maxWidth) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  });
  if (line) lines.push(line);
  return lines;
};

const clipText = (font, value, size, maxWidth) => {
  let text = templateFieldValueSafe(font, value);
  if (font.widthOfTextAtSize(text, size) <= maxWidth) return text;
  while (text.length > 1 && font.widthOfTextAtSize(`${text}...`, size) > maxWidth) text = text.slice(0, -1);
  return `${text}...`;
};

const NUMERIC_COLUMNS = new Set([3, 4, 5, 6, 7]);

/* Split a label/value line into wrapped pieces while keeping each piece's bold
   flag. The old "too long? print it all in the regular font" shortcut made the
   accommodation name look randomly unbolded on long overnight lines. */
export const wrapStyledParts = (parts = [], font, boldFont, size = 10, maxWidth = 500) => {
  const lines = [[]];
  let width = 0;
  const spaceWidth = font.widthOfTextAtSize(' ', size);
  parts.forEach((part) => {
    const bold = !!part?.bold;
    const activeFont = bold ? boldFont : font;
    templateFieldValueSafe(activeFont, part?.text)
      .split(/\s+/)
      .filter(Boolean)
      .forEach((word) => {
        const token = templateFieldValueSafe(activeFont, word);
        const tokenWidth = activeFont.widthOfTextAtSize(token, size);
        const current = lines[lines.length - 1];
        const needsSpace = current.length > 0;
        if (needsSpace && width + spaceWidth + tokenWidth > maxWidth) {
          lines.push([{ text: token, bold }]);
          width = tokenWidth;
          return;
        }
        if (needsSpace) {
          current.push({ text: ' ', bold: false });
          width += spaceWidth;
        }
        current.push({ text: token, bold });
        width += tokenWidth;
      });
  });
  return lines.filter((line) => line.length);
};

const createPageWriter = (pdfDoc, font, boldFont, typography = {}) => {
  let page = null;
  let y = PAGE_TOP;
  const baseSize = Math.min(Math.max(Number(typography.size) || 10, 7), 16);
  const rowGap = baseSize + 9;

  const newPage = () => {
    page = pdfDoc.addPage(PAGE_SIZE);
    y = PAGE_TOP;
  };
  const ensure = (height) => {
    if (!page || y - height < PAGE_BOTTOM) newPage();
  };

  const write = (value, {
    size = baseSize,
    color = rgb(0.1, 0.12, 0.15),
    gap = size + 4,
    bold = false
  } = {}) => {
    const activeFont = bold ? boldFont : font;
    const lines = wrapText(activeFont, value, size, PAGE_SIZE[0] - PAGE_MARGIN * 2);
    lines.forEach((line) => {
      ensure(gap);
      page.drawText(line, { x: PAGE_MARGIN, y, size, font: activeFont, color });
      y -= gap;
    });
  };

  /* Used where a printed label stays plain but the value after it is bold,
     such as "Overnight: Silverbirch @ Birchwood (Standard Room) - B&B". Long
     hotel names wrap instead of falling back to one plain-font line, so the
     accommodation value stays bold on every line. */
  const writeParts = (parts, { size = baseSize, gap = size + 4 } = {}) => {
    const lines = wrapStyledParts(parts, font, boldFont, size, PAGE_SIZE[0] - PAGE_MARGIN * 2);
    lines.forEach((lineParts) => {
      ensure(gap);
      let x = PAGE_MARGIN;
      lineParts.forEach((part) => {
        const activeFont = part.bold ? boldFont : font;
        page.drawText(part.text, { x, y, size, font: activeFont, color: rgb(0.1, 0.12, 0.15) });
        x += activeFont.widthOfTextAtSize(part.text, size);
      });
      y -= gap;
    });
  };

  const heading = (value) => {
    ensure(baseSize * 3);
    y -= 8;
    write(value, {
      size: baseSize,
      color: rgb(0.05, 0.29, 0.31),
      gap: baseSize + 8,
      bold: true
    });
    y -= 4;
  };

  const bullet = (value) => write(`• ${value}`, { gap: baseSize + 3 });

  /* A genuine blank line between days, matching the paragraph space added to
     the Word version of the same itinerary. */
  const space = (gap = baseSize + 6) => {
    ensure(gap);
    y -= gap;
  };

  const table = (headers, rows) => {
    if (!rows.length) return;
    const drawRow = (values, { header = false, bold = false } = {}) => {
      ensure(rowGap + 6);
      const activeFont = bold ? boldFont : font;
      let x = PAGE_MARGIN;
      values.forEach((value, index) => {
        const width = TABLE_WIDTHS[index] || 80;
        const text = clipText(activeFont, value, baseSize, width - 8);
        const textWidth = activeFont.widthOfTextAtSize(text, baseSize);
        const drawX = NUMERIC_COLUMNS.has(index)
          ? x + width - 4 - textWidth
          : x + 4;
        page.drawText(text, {
          x: drawX,
          y: y - baseSize - 2,
          size: baseSize,
          font: activeFont,
          color: header ? rgb(0.05, 0.29, 0.31) : rgb(0.15, 0.18, 0.22)
        });
        x += width;
      });
      page.drawLine({
        start: { x: PAGE_MARGIN, y: y - baseSize - 6 },
        end: { x: PAGE_MARGIN + TABLE_WIDTHS.reduce((sum, width) => sum + width, 0), y: y - baseSize - 6 },
        thickness: 0.5,
        color: rgb(0.76, 0.8, 0.84)
      });
      y -= rowGap;
    };
    drawRow(headers, { header: true });
    rows.forEach((row) => (Array.isArray(row)
      ? drawRow(row)
      : drawRow(row.values || [], { bold: !!row.bold })));
    y -= 8;
  };

  /* Totals need the full page width: labels such as TOTAL DUE (ZAR INCL. VAT)
     do not fit the narrow Day column, and the amount must sit on the right. */
  const total = (label, value) => {
    const labelText = templateFieldValueSafe(boldFont, label);
    const valueText = templateFieldValueSafe(boldFont, value);
    if (!labelText && !valueText) return;
    ensure(rowGap + 6);
    const color = rgb(0.15, 0.18, 0.22);
    page.drawText(labelText, {
      x: PAGE_MARGIN,
      y: y - baseSize - 2,
      size: baseSize,
      font: boldFont,
      color
    });
    page.drawText(valueText, {
      x: PAGE_SIZE[0] - PAGE_MARGIN - boldFont.widthOfTextAtSize(valueText, baseSize),
      y: y - baseSize - 2,
      size: baseSize,
      font: boldFont,
      color
    });
    page.drawLine({
      start: { x: PAGE_MARGIN, y: y - baseSize - 6 },
      end: { x: PAGE_SIZE[0] - PAGE_MARGIN, y: y - baseSize - 6 },
      thickness: 0.5,
      color: rgb(0.76, 0.8, 0.84)
    });
    y -= rowGap;
  };

  return { write, writeParts, heading, bullet, space, table, total };
};

const labelOf = (data, key, fallback) => {
  const value = data?.section_labels?.[key];
  if (value !== null && value !== undefined && String(value) !== '') return String(value);
  /* A direct caller that omits section_labels still gets the fallback in the
     chosen export language. */
  const lang = data?.lang || '';
  return translateTemplateText(fallback, lang, templateTextOverridesFor(data, lang));
};

const rowsOf = (rows) => (Array.isArray(rows) ? rows : []);

const writeDayOvernight = (writer, section, value, label) => {
  const hotel = String(value ?? '').trim();
  if (!hotel) return;
  const printedLabel = String(label ?? '').trim()
    || (String(section.end || '').match(/^[^:]+:/)?.[0] || 'Overnight:');
  writer.writeParts([
    { text: `${printedLabel} ` },
    { text: hotel, bold: true }
  ]);
};

const appendDetailsPages = (pdfDoc, font, boldFont, data = {}, typography = {}) => {
  const writer = createPageWriter(pdfDoc, font, boldFont, typography);
  const scalarRows = TEMPLATE_FIELD_LABELS
    .map(({ key, label }) => ({ label, value: templateFieldValue(data, key) }))
    .concat([{ label: 'Company', value: templateFieldValue(data, 'company_name') }])
    .filter((row) => row.value);

  writer.heading(labelOf(data, 'details', 'Itinerary details'));
  scalarRows.forEach((row) => writer.write(`${row.label}: ${row.value}`));

  const daySections = rowsOf(data.day_sections);
  if (daySections.length) {
    writer.heading(labelOf(data, 'day_by_day', 'Itinerary'));
    daySections.forEach((section, index) => {
      if (index) writer.space();
      writer.write([section.heading || section.day, section.date].filter(Boolean).join(' · '));
      const route = [section.route, section.overnight ? '' : section.end].filter(Boolean).join(' · ');
      if (route) writer.write(route);
      const items = rowsOf(section.items);
      if (!items.length && section.overnight) {
        writeDayOvernight(writer, section, section.overnight, section.overnight_label);
      }
      if (section.notes) writer.write(section.notes);
      if (items.length) {
        items.forEach((item) => {
          const text = templateFieldValue(item, 'text');
          if (!text) return;
          if (String(item.kind || '').toLowerCase() === 'overnight') {
            writeDayOvernight(writer, section, text, item.label);
          } else {
            writer.bullet(text);
          }
        });
      } else {
        String(section.services || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
          .forEach((service) => writer.bullet(service));
      }
    });
  }

  /* Price breakdown comes directly after the day-by-day, with inclusions and
     exclusions following it, matching the generated Word section order. */
  const pricingRows = rowsOf(data.pricing_rows);
  const pricingTotals = rowsOf(data.pricing_totals);
  if (pricingRows.length || pricingTotals.length || templateFieldValue(data, 'pricing_summary')) {
    const currency = templateFieldValue(data, 'currency_code')
      || templateFieldValue(pricingRows[0], 'currency');
    writer.heading([labelOf(data, 'pricing', 'Pricing Breakdown'), currency].filter(Boolean).join(' - '));
    const headers = [
      labelOf(data, 'day', 'Day'),
      labelOf(data, 'date', 'Date'),
      labelOf(data, 'description', 'Description'),
      labelOf(data, 'qty', 'Qty'),
      labelOf(data, 'unit', 'Unit'),
      labelOf(data, 'subtotal', 'Subtotal (excl. tax)'),
      labelOf(data, 'tax', 'Tax'),
      labelOf(data, 'total', 'Total (incl. tax)')
    ];
    const byCurrency = new Map();
    pricingRows.forEach((row) => {
      const currency = templateFieldValue(row, 'currency');
      if (!byCurrency.has(currency)) byCurrency.set(currency, []);
      byCurrency.get(currency).push([
        row.day, row.date, row.description, row.qty, row.unit,
        row.subtotal_excl, row.tax, row.total_incl
      ]);
    });
    if (!byCurrency.size) byCurrency.set('', []);

    byCurrency.forEach((rows, groupCurrency) => {
      const summaryRows = [];
      pricingTotals
        .filter((total) => !groupCurrency
          || !templateFieldValue(total, 'currency')
          || templateFieldValue(total, 'currency') === groupCurrency)
        .forEach((total) => {
          [
            [labelOf(data, 'subtotal', 'Subtotal (excl. tax)'), templateFieldValue(total, 'subtotal_excl')],
            [labelOf(data, 'tax', 'Tax'), templateFieldValue(total, 'tax')],
            [labelOf(data, 'total_due', 'Total due'), templateFieldValue(total, 'total_due')]
          ].forEach(([label, value]) => {
            if (value) summaryRows.push([label, value]);
          });
        });
      writer.table(headers, rows);
      summaryRows.forEach(([label, value]) => writer.total(label, value));
    });
    if (!pricingRows.length) writer.write(templateFieldValue(data, 'pricing_summary'));
  }

  const inclusionText = templateFieldValue(data, 'inclusions');
  const inclusionRows = rowsOf(data.inclusion_rows).map((row) => templateFieldValue(row, 'text')).filter(Boolean);
  if (inclusionRows.length || inclusionText) {
    writer.heading(labelOf(data, 'inclusions', 'Inclusions'));
    (inclusionRows.length ? inclusionRows : inclusionText.split(/\r?\n/).filter(Boolean)).forEach((line) => writer.bullet(line));
  }

  const exclusionText = templateFieldValue(data, 'exclusions');
  const exclusionRows = rowsOf(data.exclusion_rows).map((row) => templateFieldValue(row, 'text')).filter(Boolean);
  if (exclusionRows.length || exclusionText) {
    writer.heading(labelOf(data, 'exclusions', 'Exclusions'));
    (exclusionRows.length ? exclusionRows : exclusionText.split(/\r?\n/).filter(Boolean)).forEach((line) => writer.bullet(line));
  }
};

export const renderItineraryPdfBytes = async ({ arrayBuffer, data = {}, lang = data.lang || '' } = {}) => {
  if (!arrayBuffer) throw new Error('The saved PDF template could not be read.');

  let loadingTask;
  let source;
  let linesByPage = [];
  try {
    /* pdf.js can transfer its input buffer to a worker, so give it a copy and
       leave the original bytes intact for pdf-lib below. */
    const readerBytes = arrayBuffer instanceof Uint8Array
      ? arrayBuffer.slice()
      : new Uint8Array(arrayBuffer).slice();
    loadingTask = getDocument({ data: readerBytes, workerSrc: pdfWorkerUrl });
    source = await loadingTask.promise;
    for (let index = 0; index < source.numPages; index += 1) {
      const page = await source.getPage(index + 1);
      linesByPage.push(await readLines(page));
    }
  } catch (error) {
    throw new Error(error?.message ? `The saved PDF template could not be read: ${error.message}` : 'The saved PDF template could not be read.');
  } finally {
    /* pdf.js 6 exposes cleanup() on the loaded document; older builds expose
       destroy(). The loading task also has destroy(), which covers failures
       before the document resolves. */
    try {
      if (typeof source?.cleanup === 'function') await source.cleanup();
      else if (typeof source?.destroy === 'function') await source.destroy();
      else if (typeof loadingTask?.destroy === 'function') await loadingTask.destroy();
    } catch {
      /* Reading is complete; a worker cleanup failure must not block export. */
    }
  }

  let pdfDoc;
  try {
    pdfDoc = await PDFDocument.load(arrayBuffer);
  } catch {
    throw new Error('The saved template is not a valid PDF document.');
  }

  /* The top line of the first uploaded page is the header. pdf.js reports its
     font family through content.styles and its point size through item.height;
     pdf-lib needs those mapped to one of its embedded standard families before
     anything is drawn or appended. */
  const headerPage = linesByPage[0] || {};
  const headerItem = headerPage.lines?.[0]?.items?.[0] || {};
  const headerStyle = headerPage.styles?.[headerItem.fontName] || {};
  const typography = pdfTypographyOf(headerStyle.fontFamily || headerItem.fontName, headerItem.height);
  const font = await pdfDoc.embedFont(typography.regular);
  const boldFont = await pdfDoc.embedFont(typography.bold);

  const translationOverrides = templateTextOverridesFor(data, lang);
  const consumedLines = new Set();

  linesByPage.forEach(({ lines }, pageIndex) => {
    const page = pdfDoc.getPage(pageIndex);
    lines.forEach((line, lineIndex) => {
      const field = findTemplateField(line.text);
      if (!field) return;
      consumedLines.add(`${pageIndex}:${lineIndex}`);
      const value = templateFieldValue(data, field.key);
      const labelItem = labelItemOf(line, field.label);
      const labelText = translateTemplateText(field.labelText, lang, translationOverrides);

      /* The printed label belongs to the template, so it follows the export
         language. Its value comes from the itinerary and stays untouched. */
      if (labelItem && labelText !== field.labelText) {
        coverAndWrite(page, font, lineBounds([labelItem]), labelText);
      }

      if (field.value || labelItem) {
        const items = labelItem ? line.items.filter((item) => item.x >= labelItem.x) : line.items;
        const bounds = lineBounds(items.length ? items : line.items);
        if (labelItem && !field.value) {
          bounds.x = labelItem.x + itemWidth(labelItem) + 2;
          bounds.end = Math.max(bounds.end, bounds.x + 80);
        } else if (labelItem) {
          const labelWidth = Math.min(itemWidth(labelItem), font.widthOfTextAtSize(labelText, bounds.size || 10) + 2);
          bounds.x = labelItem.x + labelWidth;
        }
        coverAndWrite(page, font, bounds, value);
      } else {
        const next = lines[lineIndex + 1];
        if (!next || !looksLikePdfValue(next.text)) return;
        consumedLines.add(`${pageIndex}:${lineIndex + 1}`);
        coverAndWrite(page, font, lineBounds(next.items), value);
      }
    });
  });

  /* Static PDF prose cannot be rewritten through WordprocessingML, so the
     known lines are patched in place using their measured text bounds. Field
     labels and itinerary values were already handled above and are skipped. */
  linesByPage.forEach(({ lines }, pageIndex) => {
    const page = pdfDoc.getPage(pageIndex);
    lines.forEach((line, lineIndex) => {
      if (consumedLines.has(`${pageIndex}:${lineIndex}`) || findTemplateField(line.text)) return;
      const translated = translateTemplateText(line.text, lang, translationOverrides);
      if (translated === line.text) return;
      redrawTranslatedPdfLine(page, font, lineBounds(line.items), translated);
    });
  });

  appendDetailsPages(pdfDoc, font, boldFont, data, typography);
  return pdfDoc.save();
};

export const itineraryPdfBlob = (bytes) => new Blob([bytes], { type: ITINERARY_PDF_MIME_TYPE });

export const itineraryPdfFileName = (reference) => `${String(reference || 'itinerary').replace(/[^\w-]+/g, '_')}.pdf`;
