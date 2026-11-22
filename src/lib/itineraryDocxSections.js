/* Structured sections for uploaded Word itinerary templates.

   A branded template is allowed to stay as sparse as the operator uploaded it:
   if it has no {{day_sections}}, {{pricing_rows}} or {{inclusion_rows}} loops,
   the values still have to reach the client. This module writes ordinary
   WordprocessingML paragraphs and tables into the merged document after
   docxtemplater has run, so the template keeps its own wording, branding and
   policies and TorBuilder adds only the missing itinerary content. */

const escapeXml = (value) => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&apos;');

import { templateTextOverridesFor, translateTemplateText } from './i18n/documentTemplateTranslations';

const textOf = (value) => (value === null || value === undefined ? '' : String(value));

const linesOf = (value) => textOf(value)
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter(Boolean);

/* The builder supplies localized section labels. A direct caller that omits them
   still gets the fallback in the chosen export language, rather than an English
   heading inside an otherwise translated document. */
const labelOf = (data, key, fallback) => {
  const supplied = textOf(data?.section_labels?.[key]);
  if (supplied) return supplied;
  const lang = data?.lang || '';
  return translateTemplateText(fallback, lang, templateTextOverridesFor(data, lang));
};

/* The template's header style is the typography contract for anything TorBuilder
   adds. Word stores it in styles.xml (sometimes pointing at theme1.xml), so the
   generated runs are rewritten to use the same font family and point size. */
const attributeOf = (tag, name) => textOf(tag.match(new RegExp(`w:${name}="([^"]+)"`, 'i'))?.[1]);

const themeFontOf = (themeXml, themeName) => {
  if (!themeXml || !themeName) return '';
  const group = /major/i.test(themeName) ? 'majorFont' : 'minorFont';
  const block = textOf(themeXml.match(new RegExp(`<a:${group}\\b[\\s\\S]*?<\\/a:${group}>`, 'i'))?.[0]);
  return textOf(block.match(/<a:latin\b[^>]*typeface="([^"]+)"/i)?.[1]);
};

const typographyFromRunProperties = (runProperties, themeXml) => {
  const fonts = textOf(runProperties?.match(/<w:rFonts\b[^>]*>/i)?.[0]);
  const font = attributeOf(fonts, 'ascii')
    || attributeOf(fonts, 'hAnsi')
    || themeFontOf(themeXml, attributeOf(fonts, 'asciiTheme') || attributeOf(fonts, 'hAnsiTheme'));
  const size = Number(textOf(runProperties).match(/<w:sz\b[^>]*w:val="(\d+)"/i)?.[1]) || 0;
  return { font, size };
};

export const readDocxTypography = (zip) => {
  const stylesXml = textOf(zip?.file?.('word/styles.xml')?.asText?.());
  const themeXml = textOf(zip?.file?.('word/theme/theme1.xml')?.asText?.());
  if (!stylesXml) return { font: '', size: 0 };

  const styleBlocks = stylesXml.match(/<w:style\b[\s\S]*?<\/w:style>/gi) || [];
  const headerStyle = styleBlocks.find((block) => /w:styleId="header"/i.test(block)
    || /<w:name\b[^>]*w:val="header"/i.test(block)) || '';
  const normalStyle = styleBlocks.find((block) => /w:styleId="normal"/i.test(block)
    || /<w:name\b[^>]*w:val="normal"/i.test(block)) || '';
  const defaults = textOf(stylesXml.match(/<w:docDefaults\b[\s\S]*?<\/w:docDefaults>/i)?.[0]);
  const headerXml = Object.keys(zip?.files || {})
    .filter((name) => /^word\/header\d+\.xml$/i.test(name))
    .map((name) => textOf(zip.file(name)?.asText?.()))
    .join('');

  const headerRpr = textOf(headerStyle.match(/<w:rPr\b[\s\S]*?<\/w:rPr>/i)?.[0]);
  const normalRpr = textOf(normalStyle.match(/<w:rPr\b[\s\S]*?<\/w:rPr>/i)?.[0]);
  const defaultRpr = textOf(defaults.match(/<w:rPrDefault\b[\s\S]*?<\/w:rPrDefault>/i)?.[0]);
  const headerParagraphRpr = textOf(headerXml.match(/<w:rPr\b[\s\S]*?<\/w:rPr>/i)?.[0]);

  const header = typographyFromRunProperties(headerRpr, themeXml);
  const normal = typographyFromRunProperties(normalRpr, themeXml);
  const docDefault = typographyFromRunProperties(defaultRpr, themeXml);
  const headerRun = typographyFromRunProperties(headerParagraphRpr, themeXml);

  return {
    font: header.font || headerRun.font || normal.font || docDefault.font || '',
    size: header.size || headerRun.size || normal.size || docDefault.size || 0
  };
};

const applyTemplateTypography = (xml, typography = {}) => {
  const font = textOf(typography.font);
  const size = Number(typography.size) || 0;
  if (!font && !size) return xml;

  const fontTags = font
    ? `<w:rFonts w:ascii="${escapeXml(font)}" w:hAnsi="${escapeXml(font)}" w:eastAsia="${escapeXml(font)}" w:cs="${escapeXml(font)}"/>`
    : '';
  const sizeTags = size ? `<w:sz w:val="${size}"/><w:szCs w:val="${size}"/>` : '';

  return xml.replace(/<w:rPr>([\s\S]*?)<\/w:rPr>/g, (_, properties) => {
    let next = properties;
    if (fontTags) next = `${fontTags}${next.replace(/<w:rFonts\b[^>]*>/gi, '')}`;
    if (sizeTags) next = `${next.replace(/<w:sz\b[^>]*>/gi, '').replace(/<w:szCs\b[^>]*>/gi, '')}${sizeTags}`;
    return `<w:rPr>${next}</w:rPr>`;
  });
};

const NUMERIC_COLUMNS = new Set([3, 4, 5, 6, 7]);

/* A real empty paragraph between days reads as a paragraph space in Word and
   in the PDF printed from the Word template. */
const DAY_GAP = '<w:p><w:pPr><w:spacing w:before="160" w:after="160"/></w:pPr></w:p>';

const paragraphProperties = ({ align = '', heading = false } = {}) => {
  const spacing = heading
    ? '<w:spacing w:before="180" w:after="80"/>'
    : '<w:spacing w:before="80" w:after="40"/>';
  const justification = align ? `<w:jc w:val="${align}"/>` : '';
  const headingRun = heading ? '<w:rPr><w:b/><w:sz w:val="24"/></w:rPr>' : '';
  return `<w:pPr>${spacing}${justification}${headingRun}</w:pPr>`;
};

const run = (value, { bold = false, size = 10 } = {}) => {
  const props = `<w:rPr>${bold ? '<w:b/>' : ''}<w:sz w:val="${size * 2}"/></w:rPr>`;
  return `<w:r>${props}<w:t xml:space="preserve">${escapeXml(value)}</w:t></w:r>`;
};

const paragraph = (text, {
  bold = false,
  size = 10,
  bullet = false,
  align = '',
  heading = false
} = {}) => linesOf(text).map((line) => {
  const value = bullet ? `• ${line}` : line;
  return `<w:p>${paragraphProperties({ align, heading })}${run(value, { bold, size: heading ? 12 : size })}</w:p>`;
}).join('');

/* A day's overnight hotel sits after the printed label in bold. Word needs
   separate runs for that, so this builds the two pieces into one paragraph. */
const richParagraph = (parts, { align = '', size = 10 } = {}) => {
  const runs = parts
    .map((part) => ({ text: textOf(part?.text), bold: !!part?.bold }))
    .filter((part) => part.text)
    .map((part) => run(part.text, { bold: part.bold, size }))
    .join('');
  return runs ? `<w:p>${paragraphProperties({ align })}${runs}</w:p>` : '';
};

const BORDERS = ['top', 'left', 'bottom', 'right', 'insideH', 'insideV']
  .map((edge) => `<w:${edge} w:val="single" w:sz="4" w:space="0" w:color="B8C4CE"/>`)
  .join('');

const TABLE_WIDTHS = [900, 900, 2600, 600, 900, 1100, 800, 1560];

const cell = (value, width, { header = false, bold = false, align = '' } = {}) => {
  const fill = header ? '<w:shd w:val="clear" w:color="auto" w:fill="E6F5F3"/>' : '';
  return `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/>${fill}</w:tcPr>${paragraph(textOf(value), {
    bold: header || bold,
    size: 8.5,
    align
  })}</w:tc>`;
};

const tableRow = (values, { header = false, bold = false } = {}) => `<w:tr>${values
  .map((value, index) => cell(value, TABLE_WIDTHS[index] || 1000, {
    header,
    bold,
    align: NUMERIC_COLUMNS.has(index) ? 'right' : ''
  }))
  .join('')}</w:tr>`;

const table = (headers, rows) => {
  if (!rows.length) return '';
  const grid = TABLE_WIDTHS.map((width) => `<w:gridCol w:w="${width}"/>`).join('');
  return `<w:tbl><w:tblPr><w:tblW w:w="9360" w:type="dxa"/><w:tblBorders>${BORDERS}</w:tblBorders></w:tblPr><w:tblGrid>${grid}</w:tblGrid>`
    + tableRow(headers, { header: true })
    + rows.map((row) => (Array.isArray(row)
      ? tableRow(row)
      : tableRow(row.values || [], { bold: !!row.bold }))).join('')
    + '</w:tbl>';
};

/* Subtotal, tax and total due use a wide two-column row so long labels such as
   TOTAL DUE (ZAR INCL. VAT) are not squeezed into the narrow Day column. */
const totalsTable = (rows) => {
  if (!rows.length) return '';
  const widths = [7560, 1800];
  const grid = widths.map((width) => `<w:gridCol w:w="${width}"/>`).join('');
  return `<w:tbl><w:tblPr><w:tblW w:w="9360" w:type="dxa"/><w:tblBorders>${BORDERS}</w:tblBorders></w:tblPr><w:tblGrid>${grid}</w:tblGrid>`
    + rows.map(([label, value]) => `<w:tr>${cell(label, widths[0], { bold: true })}${cell(value, widths[1], {
      bold: true,
      align: 'right'
    })}</w:tr>`).join('')
    + '</w:tbl>';
};

const hasPlaceholder = (sourceXml, name) => new RegExp(`\\{\\{\\s*#?\\s*${name}\\b`, 'i').test(textOf(sourceXml));
const hasAnyPlaceholder = (sourceXml, names) => names.some((name) => hasPlaceholder(sourceXml, name));

const overnightLineOf = (section, { text = section.overnight, label = section.overnight_label } = {}) => {
  const hotel = textOf(text);
  if (!hotel) return '';
  const printedLabel = textOf(label)
    || (textOf(section.end).match(/^[^:]+:/)?.[0] || 'Overnight:');
  return richParagraph([
    { text: `${printedLabel.trim()} ` },
    { text: hotel, bold: true }
  ]);
};

/* The builder hands over day services as ordered `items` rows. Each item keeps
   its own kind, so an accommodation can stay exactly where it was dropped while
   still printing as a bold Overnight line instead of a plain bullet. */
const dayItemBlocks = (section) => (Array.isArray(section.items) ? section.items : [])
  .map((item) => {
    const text = textOf(item?.text);
    if (!text) return '';
    if (textOf(item?.kind).toLowerCase() === 'overnight') {
      return overnightLineOf(section, { text, label: item.label });
    }
    return paragraph(text, { bullet: true });
  })
  .join('');

const daySectionBlocks = (data, sourceXml) => {
  if (hasPlaceholder(sourceXml, 'day_sections')) return '';
  const sections = Array.isArray(data?.day_sections) ? data.day_sections : [];
  if (!sections.length) return '';

  return paragraph(labelOf(data, 'day_by_day', 'Itinerary'), { bold: true, heading: true })
    + sections.map((section) => {
      const detail = [section.date, section.route, section.overnight ? '' : section.end]
        .filter(Boolean).join(' · ');
      const itemBlocks = dayItemBlocks(section);
      const serviceBlocks = itemBlocks || linesOf(section.services)
        .map((service) => paragraph(service, { bullet: true })).join('');
      return paragraph(section.heading || section.day, { bold: true })
        + paragraph(detail)
        + (itemBlocks ? '' : overnightLineOf(section))
        + paragraph(section.notes)
        + serviceBlocks;
    }).join(DAY_GAP);
};

const textBlock = (rows, text, sourceXml, rowNames, scalarNames, title) => {
  if (hasAnyPlaceholder(sourceXml, [...rowNames, ...scalarNames])) return '';
  const items = (Array.isArray(rows) ? rows : [])
    .map((row) => textOf(row?.text))
    .filter(Boolean);
  if (!items.length && !textOf(text).trim()) return '';
  return paragraph(title, { bold: true, heading: true })
    + (items.length ? items.map((item) => paragraph(item, { bullet: true })).join('') : paragraph(text));
};

const pricingBlocks = (data, sourceXml) => {
  if (hasAnyPlaceholder(sourceXml, ['pricing_rows', 'pricing_totals', 'pricing_summary', 'day_rows'])) return '';
  const rows = Array.isArray(data?.pricing_rows) ? data.pricing_rows : [];
  const totals = Array.isArray(data?.pricing_totals) ? data.pricing_totals : [];
  if (!rows.length && !totals.length && !textOf(data?.pricing_summary).trim()) return '';

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
  rows.forEach((row) => {
    const currency = textOf(row?.currency);
    if (!byCurrency.has(currency)) byCurrency.set(currency, []);
    byCurrency.get(currency).push(row);
  });
  if (!byCurrency.size) byCurrency.set('', []);

  const currency = textOf(data?.currency_code) || textOf(rows[0]?.currency);
  const pricingTitle = [labelOf(data, 'pricing', 'Pricing Breakdown'), currency].filter(Boolean).join(' - ');
  let blocks = paragraph(pricingTitle, { bold: true, heading: true });
  byCurrency.forEach((currencyRows, groupCurrency) => {
    const bodyRows = currencyRows.map((row) => [
      row.day, row.date, row.description, row.qty, row.unit,
      row.subtotal_excl, row.tax, row.total_incl
    ]);

    const summaryRows = [];
    totals.filter((total) => !groupCurrency || !textOf(total?.currency) || textOf(total.currency) === groupCurrency)
      .forEach((total) => {
        [
          [labelOf(data, 'subtotal', 'Subtotal (excl. tax)'), total.subtotal_excl],
          [labelOf(data, 'tax', 'Tax'), total.tax],
          [labelOf(data, 'total_due', 'Total due'), total.total_due]
        ].forEach(([label, value]) => {
          if (textOf(value).trim()) summaryRows.push([label, value]);
        });
      });

    blocks += bodyRows.length ? table(headers, bodyRows) : paragraph(data?.pricing_summary);
    blocks += totalsTable(summaryRows);
  });
  return blocks;
};

export const buildItinerarySectionXml = (data = {}, { sourceXml = '', typography = {} } = {}) => {
  const dayByDay = daySectionBlocks(data, sourceXml);
  const pricing = pricingBlocks(data, sourceXml);
  const inclusions = textBlock(
    data?.inclusion_rows,
    data?.inclusions,
    sourceXml,
    ['inclusion_rows'],
    ['inclusions'],
    labelOf(data, 'inclusions', 'Inclusions')
  );
  const exclusions = textBlock(
    data?.exclusion_rows,
    data?.exclusions,
    sourceXml,
    ['exclusion_rows'],
    ['exclusions'],
    labelOf(data, 'exclusions', 'Exclusions')
  );
  return applyTemplateTypography(
    [dayByDay, pricing, inclusions, exclusions].filter(Boolean).join(''),
    typography
  );
};

export const appendItinerarySectionsToDocxZip = (zip, data = {}, { sourceXml = '', typography = {} } = {}) => {
  const insertion = buildItinerarySectionXml(data, { sourceXml, typography });
  if (!insertion) return 0;

  const part = zip.file('word/document.xml');
  if (!part) return 0;
  const xml = part.asText();
  const sectionIndex = xml.lastIndexOf('<w:sectPr');
  const bodyIndex = xml.lastIndexOf('</w:body>');
  let nextXml;
  if (sectionIndex >= 0) {
    nextXml = `${xml.slice(0, sectionIndex)}${insertion}${xml.slice(sectionIndex)}`;
  } else if (bodyIndex >= 0) {
    nextXml = `${xml.slice(0, bodyIndex)}${insertion}${xml.slice(bodyIndex)}`;
  } else {
    return 0;
  }

  zip.file('word/document.xml', nextXml);
  return 1;
};
