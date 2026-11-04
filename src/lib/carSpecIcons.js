/* The six car-hire facts, the six glyphs that name them, and one grid that both
   the screen and the printed documents render.

   The icons are the lucide geometry copied out as data rather than imported as
   React components, because a travel document here is an HTML string sent to a
   print window: a React component cannot live in it. Storing the paths once means
   the grid the operator edits, the grid in the drop dialog and the grid on the
   voucher are the same drawing, which is the whole point of asking for it in
   every document.

   Two glyph substitutions worth knowing about: lucide has no car-door (DoorOpen
   is the nearest) and no seatbelt, so Passengers is the head-and-shoulders figure
   (UserRound) without the belt. */

export const CAR_SPEC_ORDER = ['gear', 'luggage', 'doors', 'passengers', 'aircon', 'fuel'];

const ICON_NODES = {
  gear: [
    ['path', { d: 'M11 10.27 7 3.34' }],
    ['path', { d: 'm11 13.73-4 6.93' }],
    ['path', { d: 'M12 22v-2' }],
    ['path', { d: 'M12 2v2' }],
    ['path', { d: 'M14 12h8' }],
    ['path', { d: 'm17 20.66-1-1.73' }],
    ['path', { d: 'm17 3.34-1 1.73' }],
    ['path', { d: 'M2 12h2' }],
    ['path', { d: 'm20.66 17-1.73-1' }],
    ['path', { d: 'm20.66 7-1.73 1' }],
    ['path', { d: 'm3.34 17 1.73-1' }],
    ['path', { d: 'm3.34 7 1.73 1' }],
    ['circle', { cx: '12', cy: '12', r: '2' }],
    ['circle', { cx: '12', cy: '12', r: '8' }]
  ],
  luggage: [
    ['path', { d: 'M6 20a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2' }],
    ['path', { d: 'M8 18V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v14' }],
    ['path', { d: 'M10 20h4' }],
    ['circle', { cx: '16', cy: '20', r: '2' }],
    ['circle', { cx: '8', cy: '20', r: '2' }]
  ],
  doors: [
    ['path', { d: 'M11 20H2' }],
    ['path', { d: 'M11 4.562v16.157a1 1 0 0 0 1.242.97L19 20V5.562a2 2 0 0 0-1.515-1.94l-4-1A2 2 0 0 0 11 4.561z' }],
    ['path', { d: 'M11 4H8a2 2 0 0 0-2 2v14' }],
    ['path', { d: 'M14 12h.01' }],
    ['path', { d: 'M22 20h-3' }]
  ],
  passengers: [
    ['circle', { cx: '12', cy: '8', r: '5' }],
    ['path', { d: 'M20 21a8 8 0 0 0-16 0' }]
  ],
  aircon: [
    ['path', { d: 'm10 20-1.25-2.5L6 18' }],
    ['path', { d: 'M10 4 8.75 6.5 6 6' }],
    ['path', { d: 'm14 20 1.25-2.5L18 18' }],
    ['path', { d: 'm14 4 1.25 2.5L18 6' }],
    ['path', { d: 'm17 21-3-6h-4' }],
    ['path', { d: 'm17 3-3 6 1.5 3' }],
    ['path', { d: 'M2 12h6.5L10 9' }],
    ['path', { d: 'm20 10-1.5 2 1.5 2' }],
    ['path', { d: 'M22 12h-6.5L14 15' }],
    ['path', { d: 'm4 10 1.5 2L4 14' }],
    ['path', { d: 'm7 21 3-6-1.5-3' }],
    ['path', { d: 'm7 3 3 6h4' }]
  ],
  fuel: [
    ['path', { d: 'M14 13h2a2 2 0 0 1 2 2v2a2 2 0 0 0 4 0v-6.998a2 2 0 0 0-.59-1.42L18 5' }],
    ['path', { d: 'M14 21V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v16' }],
    ['path', { d: 'M2 21h13' }],
    ['path', { d: 'M3 9h11' }]
  ],
  electric: [
    ['path', { d: 'M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z' }]
  ],
  tick: [['path', { d: 'M20 6 9 17l-5-5' }]],
  cross: [['path', { d: 'M18 6 6 18' }], ['path', { d: 'm6 6 12 12' }]]
};

export const carSpecIconNodes = (name) => ICON_NODES[name] || [];

const attributeText = (attrs) =>
  Object.entries(attrs)
    .map(([key, value]) => `${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}="${String(value)}"`)
    .join(' ');

/* One glyph as markup. `currentColor` keeps it honest: a document that prints in
   black stays black, and the cyan editor stays cyan. */
export const carSpecIconSvg = (name, { size = 18, color = 'currentColor', strokeWidth = 2 } = {}) => {
  const shapes = carSpecIconNodes(name)
    .map(([tag, attrs]) => `<${tag} ${attributeText(attrs)} />`)
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle">${shapes}</svg>`;
};

const letter = (value, pairs) => {
  const found = pairs.find(([stored]) => String(value || '').toLowerCase().startsWith(stored));
  return found ? found[1] : '';
};

/* The column the id is stored under. Fuel is the one that differs: the grid reads
   the trade letter "F"/"E", the contract and the line both keep the word in a
   field called fuelType, so the mapping lives here rather than in three copies of
   the lookup. */
const SPEC_FIELDS = {
  gear: 'gear',
  luggage: 'luggage',
  doors: 'doors',
  passengers: 'passengers',
  aircon: 'aircon',
  fuel: 'fuelType'
};

/* The option, shown as the single letter the hire trade writes: M or A for gear,
   F or E for power. Aircon is a tick or a cross, never a word, so the grid reads
   the same whichever language the client's documents are in. */
export const carSpecValue = (spec, id) => {
  const value = spec?.[SPEC_FIELDS[id] || id];
  if (id === 'gear') return letter(value, [['manual', 'M'], ['automatic', 'A']]) || '';
  if (id === 'fuel') return letter(value, [['fuel', 'F'], ['electric', 'E']]) || '';
  if (id === 'aircon') return value === false || value === 'false' ? 'cross' : 'tick';
  if (value === null || value === undefined || value === '') return '';
  return String(value);
};

export const CAR_SPEC_TITLES = {
  gear: 'Gearbox',
  luggage: 'Luggage capacity',
  doors: 'Doors',
  passengers: 'Passengers',
  aircon: 'Air conditioning',
  fuel: 'Fuel or electric'
};

/* The whole grid as HTML for a print window: two rows, six columns, the icons on
   the first row and the answers on the second. Nothing else — the operator asked
   for exactly this shape in every document.

   `width:auto` is the whole point of the last two rules. A travel document styles
   its own tables to fill the page, because the pricing grid is meant to; a vehicle
   description is not a table of money and must not be stretched to match. The
   minimum column width is the library editor's, so the grid the operator built the
   car on and the grid the client reads are the same size. */
export const carSpecGridHtml = (spec, { color = '#0e7490', size = 20 } = {}) => {
  const cell = (inner) => `<td style="padding:5px 9px;text-align:center;border:1px solid #cbd5e1;background:#f0fdff;min-width:52px">${inner}</td>`;
  const iconRow = CAR_SPEC_ORDER
    .map((id) => {
      const shown = carSpecValue(spec, id);
      const icon = id === 'fuel' && shown === 'E' ? 'electric' : id;
      return cell(carSpecIconSvg(icon, { size, color }));
    })
    .join('');
  const valueRow = CAR_SPEC_ORDER
    .map((id) => {
      const shown = carSpecValue(spec, id);
      const glyph = shown === 'tick' || shown === 'cross'
        ? carSpecIconSvg(shown, { size: size - 4, color })
        : `<span style="font-size:0.95rem;font-weight:800;color:${color}">${shown || '&ndash;'}</span>`;
      return cell(glyph);
    })
    .join('');
  return `<table style="border-collapse:collapse;margin:6px 0;width:auto;table-layout:auto"><tr>${iconRow}</tr><tr>${valueRow}</tr></table>`;
};

/* The same six facts for the documents that are plain text — an emailed voucher
   body, a guide's daily brief. A print window can draw a gear; a mailto body is
   one string of characters, so the answers are written out instead. Aircon keeps
   the word rather than the tick, because the tick is a drawing. */
export const carSpecText = (spec) => {
  const bits = CAR_SPEC_ORDER
    .map((id) => {
      const shown = carSpecValue(spec, id);
      if (!shown) return '';
      const word = shown === 'tick' ? 'Yes' : shown === 'cross' ? 'No' : shown;
      return `${CAR_SPEC_TITLES[id]}: ${word}`;
    })
    .filter(Boolean);
  return bits.length ? `Vehicle specs — ${bits.join(' · ')}` : '';
};
