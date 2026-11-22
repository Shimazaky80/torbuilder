import PizZip from 'pizzip';
import { StandardFonts } from 'pdf-lib';
import {
  DOCUMENT_TEMPLATE_MAX_BYTES,
  DOCUMENT_TEMPLATE_TYPES,
  documentTemplateFileError,
  documentTemplateFileSizeLabel,
  documentTemplateRowPayload,
  documentTemplateStoragePath,
  documentTemplateTypeLabel,
  isDocumentTemplateTableMissing,
  normalizeDocumentTemplate,
  normalizeDocumentTemplateType,
  safeTemplateFileName
} from '../src/lib/documentTemplates.js';
import { renderItineraryDocxBytes } from '../src/lib/itineraryDocxMerge.js';
import { replaceInlineItineraryTokensInXml, replaceKnownItineraryFieldsInXml } from '../src/lib/itineraryDocxFields.js';
import { buildItinerarySectionXml, readDocxTypography } from '../src/lib/itineraryDocxSections.js';
import { pdfTypographyOf, wrapStyledParts } from '../src/lib/itineraryPdfMerge.js';
import { translateTemplateText } from '../src/lib/i18n/documentTemplateTranslations.js';
import {
  findTemplateField,
  templateFieldValue
} from '../src/lib/itineraryTemplateFields.js';
import {
  ITINERARY_DOCX_PLACEHOLDER_GROUPS,
  ITINERARY_PDF_MIME_TYPE,
  TORBUILDER_DEFAULT_TEMPLATE_ID,
  buildItineraryTemplateData,
  isItineraryDocxTemplate,
  isItineraryPdfTemplate,
  isMergeableItineraryTemplate,
  itineraryTemplateExportFormat,
  resolveItineraryTemplateChoice
} from '../src/lib/itineraryTemplateData.js';

let failures = 0;
const stable = (value) => {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  }
  return value;
};
const check = (label, actual, expected) => {
  const ok = JSON.stringify(stable(actual)) === JSON.stringify(stable(expected));
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}: got ${JSON.stringify(stable(actual))}, expected ${JSON.stringify(stable(expected))}`);
};
const countOccurrences = (value, token) => String(value).split(token).length - 1;

console.log('\n--- Running Document Templates Verification Tests ---\n');

check('the four document types are offered', DOCUMENT_TEMPLATE_TYPES.map((entry) => entry.id), ['itinerary', 'voucher', 'invoice', 'travel_document']);
check('type labels read as spoken', DOCUMENT_TEMPLATE_TYPES.map((entry) => entry.label), ['Itinerary', 'Voucher', 'Invoice', 'Travel document']);
check('an unknown type falls back to itinerary', normalizeDocumentTemplateType('Passport'), 'itinerary');
check('an unknown type still has a readable label', documentTemplateTypeLabel('Passport'), 'Document');

check('a PDF is accepted', documentTemplateFileError({ name: 'Brand.pdf', size: 1024 }), null);
check('a Word document is accepted', documentTemplateFileError({ name: 'Brand.docx', size: 1024 }), null);
check('an old Word document is accepted', documentTemplateFileError({ name: 'Brand.doc', size: 1024 }), null);
check('a spreadsheet is not a document template', documentTemplateFileError({ name: 'Brand.xlsx', size: 1024 }), 'Only PDF and Word documents (.pdf, .doc, .docx) can be used as templates.');
check('no file is rejected', documentTemplateFileError(null), 'Choose a template document.');
check('an empty file is rejected', documentTemplateFileError({ name: 'Brand.pdf', size: 0 }), 'That file is empty. Choose a complete template document.');
check('a file over the limit is rejected', documentTemplateFileError({ name: 'Brand.pdf', size: DOCUMENT_TEMPLATE_MAX_BYTES + 1 }), 'Template documents must be 30 MB or smaller.');
check('the limit is inclusive', documentTemplateFileError({ name: 'Brand.pdf', size: DOCUMENT_TEMPLATE_MAX_BYTES }), null);

check('a name keeps its extension', safeTemplateFileName('Company Itinerary.docx'), 'Company_Itinerary.docx');
check('a Windows path cannot leave the tenant folder', safeTemplateFileName('C:\\secret\\Brand.pdf'), 'Brand.pdf');
check('a Unix traversal cannot leave the tenant folder', safeTemplateFileName('../../Brand.pdf'), 'Brand.pdf');
check('punctuation is collapsed into the file name', safeTemplateFileName('Brand & Co (2026).pdf'), 'Brand_Co_2026.pdf');
check('a nameless upload still gets a usable file name', safeTemplateFileName(''), 'template');
check('a long name cannot overflow the storage path', safeTemplateFileName(`${'x'.repeat(200)}.pdf`).length, 120);

check('the storage path starts with the company folder', documentTemplateStoragePath({ companyId: 'tenant-1', fileName: 'Brand.pdf', stamp: 123 }), 'tenant-1/document-templates/123_Brand.pdf');
check('a bad tenant fails closed', (() => {
  try { documentTemplateStoragePath({ companyId: '', fileName: 'Brand.pdf' }); return 'no error'; }
  catch (error) { return error.message; }
})(), 'Your tenant workspace could not be resolved. Please sign in again.');

const upload = { url: 'https://example.test/brand.pdf', path: 'tenant-1/document-templates/123_Brand.pdf', fileName: 'Brand.pdf', fileSize: 2048, mimeType: 'application/pdf' };
const payload = documentTemplateRowPayload({
  companyId: 'tenant-1',
  form: { name: '  Branded itinerary  ', documentType: 'itinerary', isDefault: true, isActive: false },
  upload,
  updatedAt: '2026-11-22T00:00:00.000Z'
});
check('a row payload carries the tenant and file', payload.company_id, 'tenant-1');
check('a row payload trims the template name', payload.name, 'Branded itinerary');
check('a row payload stores the storage path as well as the URL', [payload.file_url, payload.file_path], [upload.url, upload.path]);
check('a default template is forced active in the payload', [payload.is_default, payload.is_active], [true, true]);

const inactive = documentTemplateRowPayload({ companyId: 'tenant-1', form: { name: 'Old', documentType: 'passport' }, updatedAt: '2026-11-22T00:00:00.000Z' });
check('an unstated active flag stays active', inactive.is_active, true);
check('an unstated default stays off', inactive.is_default, false);
check('an unknown document type cannot reach the database', inactive.document_type, 'itinerary');

check('a stored row is normalised for the card', normalizeDocumentTemplate({
  id: '1', name: 'Voucher', document_type: 'voucher', is_default: 1, is_active: 0
}), {
  id: '1', name: 'Voucher', document_type: 'voucher', file_url: '', file_path: '', file_name: '',
  is_default: false, is_active: true
});
check('a genuine default is kept', normalizeDocumentTemplate({ id: '2', is_default: true, is_active: true }).is_default, true);

check('a missing table is recognised by code', isDocumentTemplateTableMissing({ code: '42P01', message: 'relation does not exist' }), true);
check('a missing PostgREST table is recognised', isDocumentTemplateTableMissing({ code: 'PGRST205', message: 'not in schema cache' }), true);
check('an unrelated error is not hidden', isDocumentTemplateTableMissing({ code: '42501', message: 'permission denied' }), false);

check('small files read in bytes', documentTemplateFileSizeLabel(512), '512 B');
check('kilobytes round to whole numbers', documentTemplateFileSizeLabel(2048), '2 KB');
check('megabytes keep one decimal', documentTemplateFileSizeLabel(2.5 * 1024 * 1024), '2.5 MB');

/* --- Itinerary merge contract ------------------------------------------------ */

const mergeData = buildItineraryTemplateData({
  reference: 'IT-100',
  itinerary_name: 'Cape Town escape',
  client_name: 'Acme Travel',
  operator_ref: 'Att Jose / Ref 42',
  programme: 'FIT',
  status: 'Quotation',
  travel_dates: '11 – 23 Ene 2027',
  travellers_count: '2 travellers',
  travellers: [
    { name: 'Ada Lovelace', notes: 'VIP' },
    { name: 'Grace Hopper', notes: '' }
  ],
  section_labels: {
    subtotal: 'Subtotal (Excl. VAT)',
    tax: 'VAT',
    total_due: 'TOTAL DUE (ZAR INCL. VAT)'
  },
  inclusion_rows: [{ text: 'Return flights' }, { text: 'Daily breakfast' }],
  exclusion_rows: [{ text: 'Drinks' }],
  day_sections: [
    {
      day: 1,
      heading: 'Day 1 - Cape Town',
      date: '2026-12-01',
      route: 'Arrival in Cape Town',
      end: 'Overnight: Cape Town',
      overnight_label: 'Overnight:',
      overnight: 'Silverbirch @ Birchwood (Standard Room) - B&B',
      notes: 'Private transfer',
      services: 'Game drive\nDinner',
      items: [
        { kind: 'service', text: 'Game drive' },
        { kind: 'overnight', label: 'Overnight:', text: 'Silverbirch @ Birchwood (Standard Room) - B&B' },
        { kind: 'service', text: 'Dinner' }
      ]
    }
  ],
  day_rows: [
    { day: 'Day 1', date: '2026-12-01', description: 'Safari', total_incl: 'R 1,000' },
    { day: 'Day 2', date: '2026-12-02', description: 'City tour', total_incl: 'R 750' }
  ],
  pricing_rows: [
    { currency: 'ZAR', day: 'Day 1', date: '2026-12-01', description: 'Safari', total_incl: 'R 1,000' }
  ],
  pricing_totals: [{ currency: 'ZAR', subtotal_excl: 'R 1,500', tax: 'R 250', total_due: 'R 1,750' }]
});
check('an unknown merge value becomes an empty string', mergeData.terms, '');
check('merge rows are normalised to text', mergeData.day_rows[0], { day: 'Day 1', date: '2026-12-01', description: 'Safari', total_incl: 'R 1,000' });
check('traveller names are available as one line', mergeData.traveller_names, 'Ada Lovelace\nGrace Hopper');
check('PASSENGERS prints the names on one line', mergeData.traveller_names_inline, 'Ada Lovelace, Grace Hopper');
check('inclusions are available as one line as well as a loop', mergeData.inclusions, 'Return flights\nDaily breakfast');
check('pricing summary is derived from the currency totals', mergeData.pricing_summary, 'ZAR R 1,750');
check('the currency follows the first priced group', mergeData.currency_code, 'ZAR');
check('operator reference and programme are part of the merge data', [mergeData.operator_ref, mergeData.programme], ['Att Jose / Ref 42', 'FIT']);

const appendedSections = buildItinerarySectionXml(mergeData, {});
check('missing day-by-day, text and pricing sections are generated', [
  appendedSections.includes('Safari'),
  appendedSections.includes('Return flights'),
  appendedSections.includes('Drinks'),
  appendedSections.includes('R 1,000')
], [true, true, true, true]);
check('sections already rendered by placeholders are not duplicated', buildItinerarySectionXml(mergeData, {
  sourceXml: '{{#day_sections}}{{heading}}{{/day_sections}}{{#inclusion_rows}}{{text}}{{/inclusion_rows}}{{#exclusion_rows}}{{text}}{{/exclusion_rows}}{{#pricing_rows}}{{day}}{{/pricing_rows}}'
}), '');
check('price breakdown precedes inclusions and exclusions', [
  appendedSections.indexOf('Pricing Breakdown') < appendedSections.indexOf('Inclusions'),
  appendedSections.indexOf('Inclusions') < appendedSections.indexOf('Exclusions')
], [true, true]);
check('overnight hotel is printed in bold after its label', appendedSections.includes('<w:b/><w:sz w:val="20"/></w:rPr><w:t xml:space="preserve">Silverbirch @ Birchwood (Standard Room) - B&amp;B'), true);
check('nested day items survive the template data contract', mergeData.day_sections[0].items.map((item) => item.kind), ['service', 'overnight', 'service']);
check('day items keep the exact drop order', [
  appendedSections.indexOf('Game drive') < appendedSections.indexOf('Silverbirch @ Birchwood'),
  appendedSections.indexOf('Silverbirch @ Birchwood') < appendedSections.indexOf('Dinner')
], [true, true]);
check('an accommodation is always a bold overnight line, even without an end-of-day', [
  (() => {
    const xml = buildItinerarySectionXml({
      ...mergeData,
      day_sections: [{
        ...mergeData.day_sections[0],
        end: '',
        overnight_label: '',
        overnight: '',
        services: '',
        items: [{ kind: 'overnight', text: 'Late Arrival Lodge' }]
      }]
    }, {});
    return xml.includes('<w:b/><w:sz w:val="20"/></w:rPr><w:t xml:space="preserve">Late Arrival Lodge') && !xml.includes('• Late Arrival Lodge');
  })()
], [true]);
check('price breakdown totals are bold and prices are right aligned', [
  appendedSections.includes('<w:b/><w:sz w:val="17"/></w:rPr><w:t xml:space="preserve">TOTAL DUE (ZAR INCL. VAT)'),
  appendedSections.includes('<w:jc w:val="right"/>')
], [true, true]);
check('the currency stays on the pricing breakdown heading line', [
  appendedSections.includes('Pricing Breakdown - ZAR'),
  appendedSections.includes('<w:t xml:space="preserve">ZAR</w:t>')
], [true, false]);
check('pricing totals still print after the heading change', [
  appendedSections.includes('TOTAL DUE (ZAR INCL. VAT)'),
  appendedSections.includes('R 1,750')
], [true, true]);

const twoDayData = {
  ...mergeData,
  day_sections: [
    mergeData.day_sections[0],
    { ...mergeData.day_sections[0], day: 2, heading: 'Day 2 - Cape Town', services: 'City tour', overnight: '' }
  ]
};
const spacedSections = buildItinerarySectionXml(twoDayData, {});
check('a paragraph space separates each day section', countOccurrences(
  spacedSections,
  '<w:p><w:pPr><w:spacing w:before="160" w:after="160"/></w:pPr></w:p>'
), 1);

const overnightOnlySections = buildItinerarySectionXml({
  ...mergeData,
  day_sections: [{
    ...mergeData.day_sections[0],
    services: 'Dinner',
    overnight: 'The Commodore Hotel (Standard Room)',
    items: [
      { kind: 'service', text: 'Dinner' },
      { kind: 'overnight', label: 'Overnight:', text: 'The Commodore Hotel (Standard Room)' }
    ]
  }]
}, {});
check('the overnight hotel is not repeated as a bullet', [
  countOccurrences(overnightOnlySections, 'The Commodore Hotel (Standard Room)'),
  overnightOnlySections.includes('• The Commodore Hotel')
], [1, false]);

/* --- Template typography inheritance ---------------------------------------- */

const styledZip = new PizZip();
styledZip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>');
styledZip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
styledZip.file('word/document.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>KOBO SOUTH AFRICA - POLÍTICA DE CANCELAMENTO</w:t></w:r></w:p><w:sectPr/></w:body></w:document>');
styledZip.file('word/styles.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:type="paragraph" w:styleId="Header"><w:name w:val="header"/><w:rPr><w:rFonts w:ascii="Courier New" w:hAnsi="Courier New"/><w:sz w:val="28"/></w:rPr></w:style></w:styles>');
check('the DOCX header style supplies the font family and size', readDocxTypography(styledZip), { font: 'Courier New', size: 28 });

const styledBytes = renderItineraryDocxBytes({
  arrayBuffer: styledZip.generate({ type: 'arraybuffer' }),
  data: mergeData
});
const styledXml = new PizZip(styledBytes).file('word/document.xml').asText();
check('generated DOCX runs inherit the template header typography', [
  styledXml.includes('<w:rFonts w:ascii="Courier New"'),
  styledXml.includes('<w:sz w:val="28"/><w:szCs w:val="28"/>'),
  styledXml.includes('Pricing Breakdown - ZAR')
], [true, true, true]);
check('uploaded wording survives typography inheritance', styledXml.includes('POLÍTICA DE CANCELAMENTO'), true);

/* A letterhead can carry the same mark in its body and its Word header. Only
   the body image and the footer mark are meant to survive into print. */
const logoZip = new PizZip();
logoZip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/><Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/></Types>');
logoZip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
logoZip.file('word/_rels/document.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdH" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/><Relationship Id="rIdF" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/></Relationships>');
logoZip.file('word/document.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office"><w:body><w:p><w:r><w:t>Branded letterhead</w:t></w:r><w:r><w:pict><v:imagedata r:id="rIdLogo" o:title="body"/></w:pict></w:r></w:p><w:sectPr><w:headerReference w:type="default" r:id="rIdH"/><w:footerReference w:type="default" r:id="rIdF"/></w:sectPr></w:body></w:document>');
logoZip.file('word/header1.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office"><w:p><w:r><w:pict><v:imagedata r:id="rIdHLogo" o:title="header"/></w:pict></w:r></w:p></w:hdr>');
logoZip.file('word/footer1.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office"><w:p><w:r><w:pict><v:imagedata r:id="rIdFLogo" o:title="footer"/></w:pict></w:r></w:p></w:ftr>');
const logoBytes = renderItineraryDocxBytes({
  arrayBuffer: logoZip.generate({ type: 'arraybuffer' }),
  data: mergeData
});
const logoOutput = new PizZip(logoBytes);
check('the body and footer logos survive the template merge', [
  logoOutput.file('word/document.xml').asText().includes('o:title="body"'),
  logoOutput.file('word/footer1.xml').asText().includes('o:title="footer"')
], [true, true]);
check('the duplicate header logo is removed from printed output', logoOutput.file('word/header1.xml').asText().includes('o:title="header"'), false);
check('a monospace PDF header maps to Courier', pdfTypographyOf('Courier New', 12), {
  regular: StandardFonts.Courier,
  bold: StandardFonts.CourierBold,
  size: 12
});
check('a serif PDF header maps to Times', pdfTypographyOf('Georgia', 11), {
  regular: StandardFonts.TimesRoman,
  bold: StandardFonts.TimesRomanBold,
  size: 11
});
const measuringFont = { encodeText: () => {}, widthOfTextAtSize: (text, size) => String(text).length * size * 0.5 };
const wrappedOvernight = wrapStyledParts([
  { text: 'Overnight: ' },
  { text: 'Very Long Safari Lodge With Several Words', bold: true }
], measuringFont, measuringFont, 10, 100);
check('long overnight lines wrap without losing the bold hotel', [
  wrappedOvernight.length > 1,
  wrappedOvernight.every((line) => line.some((part) => part.bold)),
  wrappedOvernight[0].some((part) => part.text.includes('Overnight'))
], [true, true, true]);

/* --- Printed-label field matching ------------------------------------------- */

check('the longest known label wins', findTemplateField('OPERATOR REF: Att Jose')?.key, 'operator_ref');
check('PASSENGERS maps to traveller names rather than a count', findTemplateField('PASSENGERS:')?.key, 'traveller_names_inline');
check('a label without a printed value is recognised', findTemplateField('DATE OF TRAVEL:')?.key, 'travel_dates');
check('an ordinary sentence is not a field', findTemplateField('Prezado/a,'), null);
check('field values are stringified, not dropped', templateFieldValue({ status: 0 }, 'status'), '0');
check('a single-brace signature token maps to the tour designer', findTemplateField('{Tour Designer}')?.key, 'consultant_name');

const tokenXml = '<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Signed: {Tour Designer} / {{reference}}</w:t></w:r></w:p><w:sectPr/></w:body></w:document>';
const tokenFill = replaceInlineItineraryTokensInXml(tokenXml, { consultant_name: 'Ada Lovelace', reference: 'IT-100' });
check('single-brace tokens are filled inline', tokenFill.xml.includes('Signed: Ada Lovelace / {{reference}}'), true);
check('double-brace placeholders are left for docxtemplater', tokenFill.xml.includes('{{reference}}'), true);

const scalarGroups = ITINERARY_DOCX_PLACEHOLDER_GROUPS.slice(0, 4);
check('every advertised scalar placeholder has a data key', scalarGroups
  .flatMap((group) => group.placeholders)
  .map((name) => name.replace(/[{}]/g, ''))
  .filter((key) => !(key in mergeData)), []);

check('a docx file is Word-mergeable', isItineraryDocxTemplate({ file_name: 'Brand.docx' }), true);
check('a Word MIME type is Word-mergeable', isItineraryDocxTemplate({ mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }), true);
check('a PDF file is not Word-mergeable', isItineraryDocxTemplate({ file_name: 'Brand.pdf' }), false);
check('a legacy doc file is not Word-mergeable', isItineraryDocxTemplate({ file_name: 'Brand.doc' }), false);

const itineraryDocx = { document_type: 'itinerary', file_name: 'Brand.docx' };
const itineraryPdf = { document_type: 'itinerary', file_name: 'Brand.pdf' };
check('a PDF file is PDF-mergeable', isItineraryPdfTemplate(itineraryPdf), true);
check('a PDF MIME type is PDF-mergeable', isItineraryPdfTemplate({ mime_type: ITINERARY_PDF_MIME_TYPE }), true);
check('a docx file is not PDF-mergeable', isItineraryPdfTemplate(itineraryDocx), false);
check('a Word template selects the Word export', itineraryTemplateExportFormat(itineraryDocx), 'word');
check('a PDF template selects the PDF export', itineraryTemplateExportFormat(itineraryPdf), 'pdf');
check('a legacy doc selects no export', itineraryTemplateExportFormat({ ...itineraryDocx, file_name: 'Brand.doc' }), '');

check('an itinerary docx is mergeable', isMergeableItineraryTemplate(itineraryDocx), true);
check('an itinerary PDF is mergeable', isMergeableItineraryTemplate(itineraryPdf), true);
check('a travel-document docx is not an itinerary template', isMergeableItineraryTemplate({ ...itineraryDocx, document_type: 'travel_document' }), false);
check('an itinerary doc is reference-only', isMergeableItineraryTemplate({ ...itineraryDocx, file_name: 'Brand.doc' }), false);

const savedTemplates = [
  { id: 'one', ...itineraryDocx, is_default: false },
  { id: 'two', ...itineraryDocx, is_default: true }
];
check('the saved default is chosen when nothing was picked', resolveItineraryTemplateChoice({ templates: savedTemplates }), 'two');
check('the original document stays a sticky choice', resolveItineraryTemplateChoice({ templates: savedTemplates, storedChoice: TORBUILDER_DEFAULT_TEMPLATE_ID }), TORBUILDER_DEFAULT_TEMPLATE_ID);
check('a live stored choice is honoured', resolveItineraryTemplateChoice({ templates: savedTemplates, storedChoice: 'one' }), 'one');
check('a deleted stored choice falls back to the default', resolveItineraryTemplateChoice({ templates: savedTemplates, storedChoice: 'gone' }), 'two');
check('no templates means the original document', resolveItineraryTemplateChoice({ templates: [] }), TORBUILDER_DEFAULT_TEMPLATE_ID);
check('a travel-document doc cannot take over the itinerary export', resolveItineraryTemplateChoice({
  templates: [{ id: 'kobo', document_type: 'travel_document', file_name: 'Template.doc', is_default: true }],
  storedChoice: 'kobo'
}), TORBUILDER_DEFAULT_TEMPLATE_ID);
check('a PDF default can take over the PDF export', resolveItineraryTemplateChoice({
  templates: [{ id: 'printed', ...itineraryPdf, is_default: true }]
}), 'printed');

const fixtureZip = new PizZip();
fixtureZip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
fixtureZip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
fixtureZip.file('word/document.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>{{reference}} - {{client_name}}</w:t></w:r></w:p><w:p><w:r><w:t>{{#day_rows}}{{day}}:{{description}};{{/day_rows}}</w:t></w:r></w:p><w:p><w:r><w:t>{{#inclusion_rows}}{{text}} / {{/inclusion_rows}}</w:t></w:r></w:p><w:sectPr/></w:body></w:document>');
const renderedBytes = renderItineraryDocxBytes({
  arrayBuffer: fixtureZip.generate({ type: 'arraybuffer' }),
  data: mergeData
});
const renderedXml = new PizZip(renderedBytes).file('word/document.xml').asText();
check('the merge replaces single placeholders', renderedXml.includes('IT-100 - Acme Travel'), true);
check('the merge repeats row placeholders', renderedXml.includes('Day 1:Safari;Day 2:City tour;'), true);
check('the merge repeats text-list placeholders', renderedXml.includes('Return flights / Daily breakfast /'), true);
check('the result is still a Word package', Boolean(new PizZip(renderedBytes).file('word/document.xml')), true);

/* --- Printed labels in a real .docx ----------------------------------------- */

const labelledData = {
  ...mergeData,
  status: 'Confirmed',
  operator_ref: 'NEW REF',
  programme: 'Leisure',
  travel_dates: '01 – 05 Feb 2027',
  travellers_count: '4 travellers'
};
const labelledXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>
  <w:p><w:r><w:t>STATUS:</w:t></w:r></w:p>
  <w:p><w:r><w:t>Cotización</w:t></w:r></w:p>
  <w:p><w:r><w:t>OPERATOR REF:  </w:t></w:r></w:p>
  <w:p><w:r><w:t>Att Jose</w:t></w:r></w:p>
  <w:p><w:r><w:t>KOBO REFERENCE:</w:t></w:r></w:p>
  <w:p><w:r><w:t>TB</w:t></w:r></w:p>
  <w:p><w:r><w:t>PROGRAMME:</w:t></w:r></w:p>
  <w:p><w:r><w:t>FIT</w:t></w:r></w:p>
  <w:p><w:r><w:t>DATE OF TRAVEL:  11 – 23 Ene 2027</w:t></w:r></w:p>
  <w:p><w:r><w:t>PASSENGERS:</w:t></w:r></w:p>
  <w:p><w:r><w:t>2x DBL</w:t></w:r></w:p>
  <w:p><w:r><w:t>4px</w:t></w:r></w:p>
  <w:p><w:r><w:t>Prezado/a,</w:t></w:r></w:p>
  <w:p><w:r><w:t>KOBO SOUTH AFRICA – POLÍTICA DE CANCELAMENTO:</w:t></w:r></w:p>
  <w:sectPr/></w:body></w:document>`;
const labelledFill = replaceKnownItineraryFieldsInXml(labelledXml, labelledData);
check('printed labels are filled with current values', [
  labelledFill.xml.includes('<w:t>Confirmed</w:t>'),
  labelledFill.xml.includes('<w:t>NEW REF</w:t>'),
  labelledFill.xml.includes('<w:t>IT-100</w:t>'),
  labelledFill.xml.includes('<w:t>Leisure</w:t>'),
  labelledFill.xml.includes('DATE OF TRAVEL: 01 – 05 Feb 2027'),
  labelledFill.xml.includes('<w:t>Ada Lovelace, Grace Hopper</w:t>')
], [true, true, true, true, true, true]);
check('an extra value line is cleared', labelledFill.xml.includes('<w:t>4px</w:t>'), false);
check('the letter and policy wording survive', [
  labelledFill.xml.includes('Prezado/a,'),
  labelledFill.xml.includes('POLÍTICA DE CANCELAMENTO')
], [true, true]);

const labelledZip = new PizZip();
labelledZip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
labelledZip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
labelledZip.file('word/document.xml', labelledXml);
const labelledBytes = renderItineraryDocxBytes({
  arrayBuffer: labelledZip.generate({ type: 'arraybuffer' }),
  data: labelledData
});
const labelledRenderedXml = new PizZip(labelledBytes).file('word/document.xml').asText();
check('the Word merge keeps the uploaded labels', labelledRenderedXml.includes('OPERATOR REF:'), true);
check('the Word merge replaces the printed value', labelledRenderedXml.includes('NEW REF'), true);
check('the Word merge keeps the uploaded policy', labelledRenderedXml.includes('POLÍTICA DE CANCELAMENTO'), true);
check('the Word merge adds the itinerary sections the template lacks', [
  labelledRenderedXml.includes('Day 1'),
  labelledRenderedXml.includes('Safari'),
  labelledRenderedXml.includes('Return flights'),
  labelledRenderedXml.includes('Drinks')
], [true, true, true, true]);

/* --- Whole-document translation --------------------------------------------- */

check('a known template sentence is translated', translateTemplateText('PLEASE NOTE: {{reference}}', 'pt-BR'), 'OBSERVAÇÃO: {{reference}}');
check('a single-brace token survives translation', translateTemplateText('Sincerely, {Tour Designer}', 'pt-BR'), 'Atenciosamente, {Tour Designer}');
check('a tenant phrase override is honoured', translateTemplateText('Book with Acme', 'pt-BR', {
  'Book with Acme': 'Reserve com a Acme'
}), 'Reserve com a Acme');
check('English exports are left as authored', translateTemplateText('PLEASE NOTE: {{reference}}', 'en'), 'PLEASE NOTE: {{reference}}');
check('generated-section fallback labels follow the export language', [
  translateTemplateText('Itinerary details', 'pt-BR'),
  translateTemplateText('Subtotal (excl. tax)', 'pt-BR'),
  translateTemplateText('Total (incl. tax)', 'pt-BR')
], ['Detalhes do itinerário', 'Subtotal (sem imposto)', 'Total (com imposto)']);

const translationData = {
  ...mergeData,
  lang: 'pt-BR',
  operator_ref: 'NEW REF',
  travel_dates: '11 – 23 Jan 2027',
  traveller_names_inline: 'Ada Lovelace, Grace Hopper',
  consultant_name: 'Ada Lovelace'
};
const translationZip = new PizZip();
translationZip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/><Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/></Types>');
translationZip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
translationZip.file('word/_rels/document.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdH" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/><Relationship Id="rIdF" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/></Relationships>');
translationZip.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>
  <w:p><w:r><w:t>{{reference}} - {{client_name}}</w:t></w:r></w:p>
  <w:p><w:r><w:t>OPERATOR REF:</w:t></w:r></w:p>
  <w:p><w:r><w:t>Att Jose</w:t></w:r></w:p>
  <w:p><w:r><w:t>DATE OF TRAVEL: 11 – 23 Jan 2027</w:t></w:r></w:p>
  <w:p><w:r><w:t>PASSENGERS:</w:t></w:r></w:p>
  <w:p><w:r><w:t>2 x DBL</w:t></w:r></w:p>
  <w:p><w:r><w:t>Dear</w:t></w:r><w:r><w:t> Sir/</w:t></w:r><w:r><w:t>Madam</w:t></w:r></w:p>
  <w:p><w:r><w:t>Thank you very much for your request, and I am pleased to send you the following</w:t></w:r></w:p>
  <w:p><w:r><w:t>PLEASE NOTE</w:t></w:r></w:p>
  <w:p><w:r><w:t>KOBO SOUTH AFRICA – CANCELLATION POLICY</w:t></w:r></w:p>
  <w:p><w:r><w:t>Between 40 and 35 days before the start of services: 25% of the total cost of services will be charged.</w:t></w:r></w:p>
  <w:p><w:r><w:t>Sincerely</w:t></w:r></w:p>
  <w:p><w:r><w:t>{Tour Designer}</w:t></w:r></w:p>
  <w:tbl><w:tr><w:tc><w:p><w:r><w:t>Pricing Breakdown</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
  <w:sectPr><w:headerReference w:type="default" r:id="rIdH"/><w:footerReference w:type="default" r:id="rIdF"/></w:sectPr>
</w:body></w:document>`);
translationZip.file('word/header1.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:r><w:t>CANCELLATION POLICY</w:t></w:r></w:p></w:hdr>');
translationZip.file('word/footer1.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:r><w:t>Thank you very much for your request, and I am pleased to send you the following</w:t></w:r></w:p></w:ftr>');

const translatedBytes = renderItineraryDocxBytes({
  arrayBuffer: translationZip.generate({ type: 'arraybuffer' }),
  data: translationData,
  lang: 'pt-BR'
});
const translatedOutput = new PizZip(translatedBytes);
const translatedXml = translatedOutput.file('word/document.xml').asText();
const translatedHeader = translatedOutput.file('word/header1.xml').asText();
const translatedFooter = translatedOutput.file('word/footer1.xml').asText();
const translatedAll = `${translatedXml}${translatedHeader}${translatedFooter}`;

check('all English template prose is translated to Portuguese', [
  'Dear', 'Thank you very much', 'PLEASE NOTE', 'CANCELLATION POLICY', 'Sincerely'
].map((phrase) => translatedAll.includes(phrase)), [false, false, false, false, false]);
check('the translated wording reads in Portuguese throughout', [
  translatedXml.includes('Prezado'),
  translatedXml.includes('Muito obrigado'),
  translatedXml.includes('OBSERVAÇÃO'),
  translatedXml.includes('POLÍTICA DE CANCELAMENTO'),
  translatedXml.includes('Entre 40 e 35 dias'),
  translatedXml.includes('Atenciosamente'),
  translatedHeader.includes('POLÍTICA DE CANCELAMENTO'),
  translatedFooter.includes('Muito obrigado')
], [true, true, true, true, true, true, true, true]);
check('translated labels still fill their values', [
  translatedXml.includes('REF DO OPERADOR:'),
  translatedXml.indexOf('REF DO OPERADOR:') < translatedXml.indexOf('NEW REF'),
  translatedXml.includes('DATA DE VIAGEM: 11 – 23 Jan 2027'),
  translatedXml.includes('PASSAGEIROS:'),
  translatedXml.indexOf('PASSAGEIROS:') < translatedXml.indexOf('Ada Lovelace, Grace Hopper'),
  translatedXml.includes('Ada Lovelace')
], [true, true, true, true, true, true]);
check('placeholders, tables and values survive translation', [
  translatedXml.includes('IT-100 - Acme Travel'),
  translatedXml.includes('<w:tbl>'),
  translatedXml.includes('Preços Detalhados')
], [true, true, true]);

const englishBytes = renderItineraryDocxBytes({
  arrayBuffer: translationZip.generate({ type: 'arraybuffer' }),
  data: { ...translationData, lang: 'en' },
  lang: 'en'
});
const englishOutput = new PizZip(englishBytes);
check('an English export keeps the template wording as authored', [
  englishOutput.file('word/document.xml').asText().includes('Dear'),
  englishOutput.file('word/document.xml').asText().includes('PLEASE NOTE'),
  englishOutput.file('word/header1.xml').asText().includes('CANCELLATION POLICY')
], [true, true, true]);

if (failures) {
  console.error(`\n${failures} document template checks failed.`);
  process.exit(1);
}
console.log('\nAll document template checks passed.');
