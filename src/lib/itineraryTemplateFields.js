/* Known-field filling for saved itinerary templates.

   Some branded documents are not written with {{placeholders}}: they have a
   printed label followed by a value ("DATE OF TRAVEL:", then the dates). This
   module maps those visible labels to the existing itinerary template data so
   the uploaded layout, wording and policies stay exactly as supplied while the
   variable values come from the current itinerary. Explicit {{placeholders}}
   continue to work through docxtemplater after this pass. */

const FIELD_LABELS = [
  { key: 'operator_ref', labels: ['OPERATOR REF', 'OPERATOR REFERENCE', 'CLIENT REFERENCE', 'YOUR REFERENCE', 'OPERADOR REF', 'REFERENCIA DEL OPERADOR'] },
  { key: 'client_name', labels: ['TOUR OPERATOR', 'OPERATOR', 'CLIENT NAME', 'CLIENT', 'CUSTOMER', 'OPERADOR', 'CLIENTE'] },
  { key: 'reference', labels: ['KOBO REFERENCE', 'OUR REFERENCE', 'OUR REF', 'REFERENCE', 'REFERENCIA', 'REF'] },
  { key: 'travel_dates', labels: ['DATE OF TRAVEL', 'TRAVEL DATES', 'TRAVEL DATE', 'DATES OF TRAVEL', 'DATES', 'FECHA DE VIAJE', 'DATA DE VIAGEM'] },
  { key: 'travellers_count', labels: ['PASSENGERS', 'TRAVELLERS', 'TRAVELERS', 'PASSAGEIROS', 'VIAJEROS', 'PAX'] },
  { key: 'programme', labels: ['PROGRAMME', 'PROGRAMA', 'PROGRAM'] },
  { key: 'status', labels: ['STATUS', 'ESTADO', 'STATUT'] },
  { key: 'consultant_name', labels: ['TOUR DESIGNER', 'CONSULTANT', 'DESIGNER', 'ASESOR'] },
  { key: 'company_name', labels: ['COMPANY NAME', 'COMPANY', 'COMPANIA'] }
];

/* The first printed spelling of each field, used when a PDF has no labels and
   a compact values page has to be appended. */
export const TEMPLATE_FIELD_LABELS = FIELD_LABELS
  .map(({ key, labels }) => ({ key, label: labels[0] }));

/* Longest labels first so "OPERATOR REF" is never consumed by "OPERATOR". */
const MATCHERS = FIELD_LABELS
  .flatMap((field) => field.labels.map((label) => ({ key: field.key, label })))
  .sort((a, b) => b.label.length - a.label.length);

const escapeRegExp = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const templateFieldValue = (data, key) => {
  const value = data?.[key];
  return value === null || value === undefined ? '' : String(value);
};

/* Returns the field plus the label as printed and any value written after the
   label on the same line. A line containing only the label has an empty value. */
export const findTemplateField = (text) => {
  const source = String(text ?? '').trim();
  if (!source) return null;
  for (const matcher of MATCHERS) {
    const expression = new RegExp(`^\\s*${escapeRegExp(matcher.label)}\\s*:?\\s*([\\s\\S]*)$`, 'i');
    const found = source.match(expression);
    if (!found) continue;
    const labelText = source.slice(0, source.length - found[1].length).trimEnd();
    return { key: matcher.key, label: matcher.label, labelText, value: found[1].trim() };
  }
  return null;
};

export const isKnownTemplateLabel = (text) => !!findTemplateField(text);
