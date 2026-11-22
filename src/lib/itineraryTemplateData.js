/* The contract between an uploaded itinerary template and the data TorBuilder
   puts into it. A template keeps its own layout, wording, branding and policies.
   Word templates may use the {{placeholders}} listed here, printed labels such
   as "DATE OF TRAVEL:", or single-brace tokens such as "{Tour Designer}". A
   Word template drives both the .docx and the PDF export: the same merged file
   is rendered for printing. Uploaded PDF templates stay the printable base and
   the same known labels are written onto their pages. Both formats also receive
   structured day-by-day, inclusions, exclusions and pricing sections when the
   uploaded file does not already contain them.

   The built-in document is never removed. `TORBUILDER_DEFAULT_TEMPLATE_ID` is a
   permanent export choice, so an operator who no longer wants a saved template
   can switch back without deleting it. */

export const ITINERARY_DOCX_MIME_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
export const ITINERARY_PDF_MIME_TYPE = 'application/pdf';
export const TORBUILDER_DEFAULT_TEMPLATE_ID = 'torbuilder-default';

export const ITINERARY_DOCX_PLACEHOLDER_GROUPS = [
  {
    title: 'Trip details',
    placeholders: [
      '{{reference}}',
      '{{itinerary_name}}',
      '{{client_name}}',
      '{{client_address}}',
      '{{operator_ref}}',
      '{{consultant_name}}',
      '{{programme}}',
      '{{travel_dates}}',
      '{{status}}',
      '{{travellers_count}}',
      '{{traveller_names}}',
      '{{traveller_names_inline}}',
      '{{generated_by}}'
    ]
  },
  {
    title: 'Company details',
    placeholders: ['{{company_name}}', '{{company_address}}', '{{company_contact}}']
  },
  {
    title: 'Pricing',
    placeholders: ['{{currency_code}}', '{{currency_symbol}}', '{{pricing_summary}}']
  },
  {
    title: 'Text blocks',
    placeholders: ['{{terms}}', '{{inclusions}}', '{{exclusions}}']
  },
  {
    title: 'Repeating blocks',
    placeholders: [
      '{{#travellers}}{{name}}{{notes}}{{/travellers}}',
      '{{#day_sections}}{{heading}}{{date}}{{route}}{{end}}{{notes}}{{services}}{{#items}}{{kind}}{{text}}{{/items}}{{/day_sections}}',
      '{{#day_rows}}{{day}}{{date}}{{description}}{{qty}}{{unit}}{{subtotal_excl}}{{tax}}{{total_incl}}{{/day_rows}}',
      '{{#pricing_rows}}{{currency}}{{day}}{{date}}{{description}}{{qty}}{{unit}}{{subtotal_excl}}{{tax}}{{total_incl}}{{/pricing_rows}}',
      '{{#pricing_totals}}{{currency}}{{subtotal_excl}}{{tax_label}}{{tax}}{{total_due}}{{/pricing_totals}}',
      '{{#optional_rows}}{{day}}{{date}}{{description}}{{qty}}{{unit}}{{subtotal_excl}}{{tax}}{{total_incl}}{{/optional_rows}}',
      '{{#inclusion_rows}}{{text}}{{/inclusion_rows}}',
      '{{#exclusion_rows}}{{text}}{{/exclusion_rows}}'
    ]
  },
  {
    title: 'Automatic sections',
    placeholders: [
      '{{section_labels.day_by_day}}',
      '{{section_labels.inclusions}}',
      '{{section_labels.exclusions}}',
      '{{section_labels.pricing}}'
    ]
  }
];

const asText = (value) => (value === null || value === undefined ? '' : String(value));

const asRow = (row) => Object.fromEntries(
  Object.entries(row && typeof row === 'object' ? row : {})
    /* Day sections carry their services in drop order as nested rows. Flattening
       that array to a string would lose the exact order the operator built. */
    .map(([key, value]) => [key, key === 'items' && Array.isArray(value) ? value.map(asRow) : asText(value)])
);

const asRows = (rows) => (Array.isArray(rows) ? rows.map(asRow) : []);

const joinRows = (rows, key, separator = '\n') => rows
  .map((row) => asText(row[key]))
  .filter(Boolean)
  .join(separator);

/* Unknown or missing values become empty strings rather than literal `{{...}}`
   text in the finished Word file. Everything is stringified here so a rendered
   row can never hand an object to the templater by accident. */
export const buildItineraryTemplateData = (source = {}) => {
  const travellers = asRows(source.travellers);
  const daySections = asRows(source.day_sections);
  const dayRows = asRows(source.day_rows);
  const pricingRows = asRows(source.pricing_rows);
  const pricingTotals = asRows(source.pricing_totals);
  const optionalRows = asRows(source.optional_rows);
  const inclusionRows = asRows(source.inclusion_rows);
  const exclusionRows = asRows(source.exclusion_rows);
  const sectionLabels = source.section_labels && typeof source.section_labels === 'object'
    ? Object.fromEntries(Object.entries(source.section_labels).map(([key, value]) => [key, asText(value)]))
    : {};
  const text = (key) => asText(source[key]);

  return {
    /* Carried through so the merge engines can translate the saved template's
       own English wording into the language chosen for this export. */
    lang: text('lang'),
    reference: text('reference'),
    itinerary_name: text('itinerary_name'),
    client_name: text('client_name'),
    client_address: text('client_address'),
    operator_ref: text('operator_ref'),
    consultant_name: text('consultant_name'),
    programme: text('programme'),
    travel_dates: text('travel_dates'),
    status: text('status'),
    travellers_count: text('travellers_count'),
    traveller_names: text('traveller_names') || joinRows(travellers, 'name'),
    /* Printed labels such as PASSENGERS sit on one line, so the name list used
       for those labels is comma separated while {{traveller_names}} stays a
       newline-separated block for template loops and multi-line fields. */
    traveller_names_inline: text('traveller_names_inline') || joinRows(travellers, 'name', ', '),
    generated_by: text('generated_by'),

    company_name: text('company_name'),
    company_address: text('company_address'),
    company_contact: text('company_contact'),

    currency_code: text('currency_code') || pricingTotals[0]?.currency || '',
    currency_symbol: text('currency_symbol') || '',
    pricing_summary: text('pricing_summary') || pricingTotals
      .map((row) => [row.currency, row.total_due].filter(Boolean).join(' '))
      .filter(Boolean)
      .join('\n'),

    terms: text('terms'),
    inclusions: text('inclusions') || joinRows(inclusionRows, 'text'),
    exclusions: text('exclusions') || joinRows(exclusionRows, 'text'),

    section_labels: sectionLabels,
    travellers,
    day_sections: daySections,
    day_rows: dayRows,
    pricing_rows: pricingRows,
    pricing_totals: pricingTotals,
    optional_rows: optionalRows,
    inclusion_rows: inclusionRows,
    exclusion_rows: exclusionRows
  };
};

/* A legacy .doc can still be kept as a reference document, but only a real
   .docx or PDF can be used by an export engine. */
export const isItineraryDocxTemplate = (template) => {
  const fileName = [template?.file_name, template?.file_path].filter(Boolean).join(' ');
  return /\.docx$/i.test(fileName) || /wordprocessingml/i.test(asText(template?.mime_type));
};

export const isItineraryPdfTemplate = (template) => {
  const fileName = [template?.file_name, template?.file_path].filter(Boolean).join(' ');
  return /\.pdf$/i.test(fileName) || /(^|\/)pdf$/i.test(asText(template?.mime_type));
};

/* Which export a saved template drives. A .docx fills Word exports and is also
   rendered into the PDF export; a PDF becomes the printable base for PDF exports.
   Excel always stays built-in. */
export const itineraryTemplateExportFormat = (template) => {
  if (template?.document_type !== 'itinerary') return '';
  if (isItineraryDocxTemplate(template)) return 'word';
  if (isItineraryPdfTemplate(template)) return 'pdf';
  return '';
};

/* A template saved under another document type, or as a legacy .doc, is still
   visible in Settings but cannot drive an itinerary export. Both checks are
   deliberate: the Export dialog can explain why it is disabled. */
export const isMergeableItineraryTemplate = (template) => !!itineraryTemplateExportFormat(template);

export const itineraryTemplateChoiceStorageKey = (companyId) => `torbuilder:itinerary-export-template:${asText(companyId)}`;

/* A stored choice wins while it still points at a live, mergeable template;
   otherwise the saved default is used, and the original document is the final
   fallback. A PDF default is now a valid choice for PDF exports. */
export const resolveItineraryTemplateChoice = ({ templates = [], storedChoice = '' } = {}) => {
  const saved = asText(storedChoice);
  if (saved === TORBUILDER_DEFAULT_TEMPLATE_ID) return TORBUILDER_DEFAULT_TEMPLATE_ID;
  const available = (Array.isArray(templates) ? templates : []).filter(isMergeableItineraryTemplate);
  if (saved && available.some((template) => asText(template.id) === saved)) return saved;
  const defaultTemplate = available.find((template) => template.is_default === true);
  return defaultTemplate ? asText(defaultTemplate.id) || TORBUILDER_DEFAULT_TEMPLATE_ID : TORBUILDER_DEFAULT_TEMPLATE_ID;
};
