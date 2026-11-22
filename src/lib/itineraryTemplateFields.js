/* Known-field filling for saved itinerary templates.

   Some branded documents are not written with {{placeholders}}: they have a
   printed label followed by a value ("DATE OF TRAVEL:", then the dates) or a
   single-brace signature ("{Tour Designer}"). This module maps those visible
   tokens to the existing itinerary template data so
   the uploaded layout, wording and policies stay exactly as supplied while the
   variable values come from the current itinerary. Explicit {{placeholders}}
   continue to work through docxtemplater after this pass. */

const FIELD_LABELS = [
  { key: 'operator_ref', labels: ['OPERATOR REF', 'OPERATOR REFERENCE', 'CLIENT REFERENCE', 'YOUR REFERENCE', 'OPERADOR REF', 'REFERENCIA DEL OPERADOR', 'REF DO OPERADOR', 'REFERÊNCIA DO OPERADOR', 'REFERÊNCIA DO CLIENTE', 'SUA REFERÊNCIA', 'RÉF. OPÉRATEUR', 'RÉFÉRENCE DE L’OPÉRATEUR', 'RÉFÉRENCE CLIENT', 'VOTRE RÉFÉRENCE', 'REF. DEL OPERADOR', 'REFERENCIA DEL OPERADOR', 'REFERENCIA DEL CLIENTE', 'SU REFERENCIA'] },
  { key: 'client_name', labels: ['TOUR OPERATOR', 'OPERATOR', 'CLIENT NAME', 'CLIENT', 'CUSTOMER', 'OPERADOR', 'CLIENTE', 'NOME DO CLIENTE', 'OPÉRATEUR', 'NOM DU CLIENT', 'VERANSTALTER', 'KUNDENNAME', 'KUNDE', 'NOMBRE DEL CLIENTE'] },
  { key: 'reference', labels: ['KOBO REFERENCE', 'OUR REFERENCE', 'OUR REF', 'REFERENCE', 'REFERENCIA', 'REF', 'REFERÊNCIA KOBO', 'REFERÊNCIA', 'NOSSA REFERÊNCIA', 'NOSSO REF', 'RÉFÉRENCE KOBO', 'RÉFÉRENCE', 'NOTRE RÉFÉRENCE', 'NOTRE RÉF.', 'RÉF.', 'KOBO-REFERENZ', 'REFERENZ', 'UNSERE REFERENZ', 'UNSER REF.', 'REFERENCIA KOBO', 'NUESTRA REFERENCIA', 'NUESTRA REF.'] },
  { key: 'travel_dates', labels: ['DATE OF TRAVEL', 'TRAVEL DATES', 'TRAVEL DATE', 'DATES OF TRAVEL', 'DATES', 'FECHA DE VIAJE', 'DATA DE VIAGEM', 'DATAS DE VIAGEM', 'DATES DE VOYAGE', 'DATE DE VOYAGE', 'REISEDATUM', 'REISEDATEN', 'DATEN', 'FECHAS DE VIAJE', 'FECHAS'] },
  { key: 'travellers_count', labels: ['PAX', 'PAX COUNT', 'NUMBER OF PASSENGERS', 'QUANTIDADE DE PAX', 'NÚMERO DE PASSAGEIROS', 'NOMBRE DE PAX', 'NOMBRE DE PASSAGERS', 'PAX-ANZAHL', 'ANZAHL DER REISENDEN', 'NÚMERO DE PAX', 'NÚMERO DE PASAJEROS'] },
  { key: 'traveller_names_inline', labels: ['PASSENGERS', 'TRAVELLERS', 'TRAVELERS', 'PASSAGEIROS', 'VIAJEROS', 'PASSENGER NAMES', 'TRAVELLER NAMES', 'VIAJANTES', 'NOMES DOS PASSAGEIROS', 'NOMES DOS VIAJANTES', 'PASSAGERS', 'VOYAGEURS', 'NOMS DES PASSAGERS', 'NOMS DES VOYAGEURS', 'REISENDE', 'NAMEN DER REISENDEN', 'PASAJEROS', 'NOMBRES DE LOS PASAJEROS', 'NOMBRES DE LOS VIAJEROS'] },
  { key: 'programme', labels: ['PROGRAMME', 'PROGRAMA', 'PROGRAM', 'PROGRAMM'] },
  { key: 'status', labels: ['STATUS', 'ESTADO', 'STATUT'] },
  { key: 'consultant_name', labels: ['TOUR DESIGNER', 'CONSULTANT', 'DESIGNER', 'ASESOR', 'DESIGNER DA VIAGEM', 'CONSULTOR', 'CONCEPTEUR DU VOYAGE', 'CONSEILLER', 'CONCEPTEUR', 'REISEBERATER', 'BERATER', 'GESTALTER', 'DISEÑADOR DE VIAJES'] },
  { key: 'company_name', labels: ['COMPANY NAME', 'COMPANY', 'COMPANIA', 'NOME DA EMPRESA', 'EMPRESA', 'NOM DE L’ENTREPRISE', 'ENTREPRISE', 'FIRMENNAME', 'FIRMA', 'NOMBRE DE LA EMPRESA'] }
];

/* Some branded files write a single-brace signature such as "{Tour Designer}"
   rather than a printed label or a {{double-brace}} placeholder. Those tokens
   use the same data contract, with a few natural aliases. */
const TOKEN_ALIASES = {
  tour_designer: 'consultant_name',
  tourdesigner: 'consultant_name',
  consultant: 'consultant_name',
  designer: 'consultant_name',
  reference_number: 'reference',
  our_reference: 'reference',
  itinerary_name: 'itinerary_name',
  client: 'client_name',
  travel_date: 'travel_dates',
  date_of_travel: 'travel_dates',
  passengers: 'traveller_names_inline',
  travellers: 'traveller_names_inline',
  travelers: 'traveller_names_inline',
  passenger_names: 'traveller_names_inline',
  traveller_names: 'traveller_names_inline',
  pax: 'travellers_count',
  operator_reference: 'operator_ref',
  company: 'company_name',
  pricing: 'pricing_summary',
  inclusions: 'inclusions',
  exclusions: 'exclusions',
  terms: 'terms'
};

const tokenKey = (value) => String(value ?? '')
  .trim()
  .replace(/:$/, '')
  .toLowerCase()
  .replace(/[_-]+/g, ' ')
  .replace(/[^a-z0-9 ]/g, '')
  .replace(/\s+/g, ' ')
  .trim()
  .replace(/\s/g, '');

const TOKEN_KEY_MAP = new Map();
FIELD_LABELS.forEach(({ key, labels }) => {
  [key, ...labels].forEach((name) => {
    const normalized = tokenKey(name);
    if (normalized && !TOKEN_KEY_MAP.has(normalized)) TOKEN_KEY_MAP.set(normalized, key);
  });
});
Object.entries(TOKEN_ALIASES).forEach(([name, key]) => {
  const normalized = tokenKey(name);
  if (normalized && !TOKEN_KEY_MAP.has(normalized)) TOKEN_KEY_MAP.set(normalized, key);
});

export const templateTokenKey = (token) => TOKEN_KEY_MAP.get(tokenKey(token)) || '';

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

  const token = source.match(/^\{([^{}]{1,80})\}:?$/);
  if (token) {
    const key = templateTokenKey(token[1]);
    if (key) return { key, label: token[1], labelText: source, value: '', isToken: true };
  }

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
