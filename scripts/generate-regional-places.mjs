#!/usr/bin/env node
// Offline GeoNames -> app_places seed. No dependencies, network or database access.
// Source: https://download.geonames.org/export/dump/readme.txt
// License: https://creativecommons.org/licenses/by/4.0/
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { stat, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const BASE_URL = 'https://download.geonames.org/export/dump/';
const LICENSE_URL = 'https://creativecommons.org/licenses/by/4.0/';
const DEFAULT_COUNTRIES = { ZM: 'Zambia', ZW: 'Zimbabwe', BW: 'Botswana', MZ: 'Mozambique', NA: 'Namibia' };
// Explicit allowlist: excludes PPLCH, PPLH, PPLQ, PPLW and PPLX (and unknown codes).
const ACTIVE_CODES = new Set([
  'PPL', 'PPLA', 'PPLA2', 'PPLA3', 'PPLA4', 'PPLA5', 'PPLC',
  'PPLF', 'PPLG', 'PPLL', 'PPLR', 'PPLS', 'STLMT',
]);
const HUB_CODES = new Set(['PPLC', 'PPLA', 'PPLG']);
const UNKNOWN_REGION = 'Region not recorded';
const MAX_ALIASES = 12;
const MAX_ALIAS_LENGTH = 120;
const MAX_ALT_LENGTH = 320;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/u;
const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const aliasKey = (name) => name.normalize('NFC').toLowerCase();

const HELP = `Generate regional place JSON and SQL from already-extracted GeoNames files.

Usage:
  node scripts/generate-regional-places.mjs --cities /path/cities500.txt \\
    --admin1 /path/admin1CodesASCII.txt --retrieved-at YYYY-MM-DD

Required:
  --cities PATH          Extracted cities500.txt (UTF-8, tab-delimited)
  --admin1 PATH          GeoNames admin1CodesASCII.txt
  --retrieved-at DATE    Actual download date or UTC ISO timestamp; never inferred

Optional:
  --country ISO=NAME     Repeat to select countries; replaces the five defaults
                        Example: --country ZM=Zambia --country MW=Malawi
                        ZA / South Africa is reserved for the curated SA seed
  --json PATH           Default: supabase/data/regional_places.json
  --sql PATH            Default: supabase/migrations/20261265_regional_places.sql
  --help                Show this help

Defaults: ZM=Zambia, ZW=Zimbabwe, BW=Botswana, MZ=Mozambique, NA=Namibia.
Default outputs are relative to this repository; custom output parents must exist.
Identical input bytes, date and mappings produce byte-identical outputs.
Input SHA-256 hashes are recorded because upstream dumps change over time.
Coverage: population >500 or administrative seats, not all tourism destinations.
Only active class-P settlement codes are included. Names are not renamed.
Hubs: national capitals, first-order administrative seats, seats of government.
Duplicate natural keys retain the lowest GeoNames ID and merge aliases/hub flags.
Aliases: ASCII name first, then Latin-script variants, then other scripts;
at most 12 aliases / 320 characters, with each alias at most 120 characters.
`;

function parseArgs(args) {
  const options = {
    json: resolve(ROOT, 'supabase/data/regional_places.json'),
    sql: resolve(ROOT, 'supabase/migrations/20261265_regional_places.sql'),
  };
  const mappings = new Map();
  const seen = new Set();
  for (let i = 0; i < args.length; i += 1) {
    const flag = args[i];
    if (!['--cities', '--admin1', '--retrieved-at', '--country', '--json', '--sql'].includes(flag)) {
      throw new Error(`Unknown option: ${flag}. Use --help.`);
    }
    const value = args[++i];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${flag}`);
    if (flag === '--country') {
      const match = /^([a-z]{2})=(.+)$/iu.exec(value);
      if (!match) throw new Error('Country must be an ISO=country mapping, e.g. ZM=Zambia');
      const iso = match[1].toUpperCase();
      const country = match[2].trim();
      if (!country || CONTROL_CHARACTERS.test(country)) throw new Error('Invalid country name');
      if (iso === 'ZA' || country.toLowerCase() === 'south africa') {
        throw new Error('South Africa is reserved for the existing curated seed');
      }
      if (mappings.has(iso)) throw new Error(`Duplicate country mapping: ${iso}`);
      if ([...mappings.values()].some((name) => aliasKey(name) === aliasKey(country))) {
        throw new Error(`Country names must be unique: ${country}`);
      }
      mappings.set(iso, country);
    } else {
      if (seen.has(flag)) throw new Error(`Duplicate option: ${flag}`);
      seen.add(flag);
      options[flag.slice(2)] = value;
    }
  }
  for (const key of ['cities', 'admin1', 'retrieved-at']) {
    if (!options[key]) throw new Error(`--${key} is required. Use --help.`);
  }
  const date = options['retrieved-at'];
  if (!/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z)?$/u.test(date)
    || !Number.isFinite(Date.parse(date))
    || new Date(date).toISOString().slice(0, 10) !== date.slice(0, 10)) {
    throw new Error('--retrieved-at must be a valid YYYY-MM-DD or UTC ISO timestamp');
  }
  options.retrievedAt = new Date(date).toISOString();
  options.countries = Object.fromEntries(
    (mappings.size ? [...mappings] : Object.entries(DEFAULT_COUNTRIES))
      .sort(([a], [b]) => compare(a, b)),
  );
  for (const key of ['cities', 'admin1', 'json', 'sql']) options[key] = resolve(options[key]);
  const paths = ['cities', 'admin1', 'json', 'sql'].map((key) => (
    process.platform === 'win32' ? options[key].toLowerCase() : options[key]
  ));
  if (new Set(paths).size !== paths.length) throw new Error('Input and output paths must all differ');
  return options;
}

async function readLines(path, visit) {
  const hash = createHash('sha256');
  const input = createReadStream(path);
  input.on('data', (chunk) => hash.update(chunk));
  const lines = createInterface({ input, crlfDelay: Infinity });
  let lineNumber = 0;
  try {
    for await (let line of lines) {
      lineNumber += 1;
      if (lineNumber === 1) line = line.replace(/^\uFEFF/u, '');
      if (line.length) visit(line, lineNumber);
    }
    return hash.digest('hex');
  } finally {
    lines.close();
    input.destroy();
  }
}

function addAlias(aliases, value, priority, place) {
  const name = value.trim();
  if (!name || name.length > MAX_ALIAS_LENGTH || CONTROL_CHARACTERS.test(name)
    || !/\p{L}/u.test(name) || /^(?:https?:\/\/|www\.)/iu.test(name)) return;
  const key = aliasKey(name);
  if (key === aliasKey(place)) return;
  const current = aliases.get(key);
  if (!current || priority < current.priority
    || (priority === current.priority && compare(name, current.name) < 0)) {
    aliases.set(key, { name, priority });
  }
}

function joinAliases(aliases) {
  const selected = [];
  let length = 0;
  for (const { name } of [...aliases.values()].sort((a, b) => (
    a.priority - b.priority || compare(a.name, b.name)
  ))) {
    const size = name.length + (selected.length ? 2 : 0);
    if (length + size > MAX_ALT_LENGTH) continue;
    selected.push(name);
    length += size;
    if (selected.length === MAX_ALIASES) break;
  }
  return selected.length ? selected.join('; ') : null;
}

// E literals escape both quotes and backslashes, without changing SQL settings.
function sqlText(value) {
  if (value === null) return 'NULL';
  if (CONTROL_CHARACTERS.test(value)) throw new Error('SQL text contains a control character');
  return `E'${value.replace(/\\/gu, '\\\\').replace(/'/gu, "''")}'`;
}

function renderSql(data) {
  const header = [
    '-- Regional app_places seed. Generated; do not hand-edit.',
    '-- Generator: scripts/generate-regional-places.mjs (see --help)',
    '-- Attribution: GeoNames (https://www.geonames.org/).',
    '-- License: Creative Commons Attribution 4.0 International (CC BY 4.0).',
    `-- ${LICENSE_URL}`,
    `-- Cities: ${data.source.cities500.url}`,
    `-- Regions: ${data.source.admin1CodesASCII.url}`,
    `-- Source notes: ${data.source.readme}`,
    `-- Retrieved: ${data.retrievedAt}`,
    '-- SHA-256 of extracted cities500.txt:',
    `-- ${data.source.cities500.sha256}`,
    '-- SHA-256 of admin1CodesASCII.txt:',
    `-- ${data.source.admin1CodesASCII.sha256}`,
    '-- Modified: filtered, grouped by admin1, deduplicated; aliases bounded.',
    '-- Coverage: population >500 or administrative seats, not all tourism sites.',
    '-- Only active settlement codes in feature class P; source names retained.',
    '-- Hubs: capitals, first-order administrative seats, seats of government.',
    '-- Missing admin1 names: Region not recorded. Lowest ID wins duplicates.',
    '-- Existing rows are never updated; the curated South Africa seed is separate.',
    '',
  ];
  for (const country of Object.values(data.countries)) {
    const places = data.places.filter((row) => row.country === country);
    header.push(
      `-- ${country}: ${places.length} places, ${places.filter((row) => row.hub).length} hubs`,
      'INSERT INTO public.app_places',
      '  (country, province, place, alt_name, is_hub, is_active)',
      'VALUES',
      places.map((row) => `  (${[
        sqlText(row.country), sqlText(row.province), sqlText(row.place),
        sqlText(row.alt_name), String(row.hub), 'true',
      ].join(', ')})`).join(',\n'),
      'ON CONFLICT (country, province, place) DO NOTHING;',
      '',
    );
  }
  return `${header.join('\n')}\n`;
}

async function generate(options) {
  for (const key of ['cities', 'admin1']) {
    if (!(await stat(options[key])).isFile()) throw new Error(`--${key} must be a file`);
  }
  for (const key of ['json', 'sql']) {
    if (!(await stat(dirname(options[key]))).isDirectory()) {
      throw new Error(`--${key} parent must be an existing directory`);
    }
  }
  const regions = new Map();
  const adminHash = await readLines(options.admin1, (line, number) => {
    const fields = line.split('\t');
    if (!Object.hasOwn(options.countries, fields[0].split('.')[0])) return;
    if (fields.length !== 4 || !fields[1] || CONTROL_CHARACTERS.test(fields[1])) {
      throw new Error(`Invalid admin1 row at line ${number}`);
    }
    if (regions.has(fields[0]) && regions.get(fields[0]) !== fields[1]) {
      throw new Error(`Conflicting admin1 names for ${fields[0]}`);
    }
    regions.set(fields[0], fields[1]);
  });
  const placesByKey = new Map();
  let duplicateRows = 0;
  let excludedRows = 0;
  const citiesHash = await readLines(options.cities, (line, number) => {
    const fields = line.split('\t');
    if (fields.length !== 19) throw new Error(`Expected 19 cities fields at line ${number}`);
    const iso = fields[8];
    if (!Object.hasOwn(options.countries, iso)) return;
    if (fields[6] !== 'P' || !ACTIVE_CODES.has(fields[7])) {
      excludedRows += 1;
      return;
    }
    const id = Number(fields[0]);
    const place = fields[1];
    if (!/^\d+$/u.test(fields[0]) || !Number.isSafeInteger(id) || id <= 0
      || !place.trim() || CONTROL_CHARACTERS.test(place)) {
      throw new Error(`Invalid place name or GeoNames ID at line ${number}`);
    }
    const country = options.countries[iso];
    const province = regions.get(`${iso}.${fields[10]}`) || UNKNOWN_REGION;
    const key = JSON.stringify([country, province, place]);
    let entry = placesByKey.get(key);
    if (!entry) {
      entry = { country, province, place, hub: false, geoname_id: id, aliases: new Map() };
      placesByKey.set(key, entry);
    } else {
      duplicateRows += 1;
      entry.geoname_id = Math.min(entry.geoname_id, id);
    }
    entry.hub ||= HUB_CODES.has(fields[7]);
    addAlias(entry.aliases, fields[2], 0, place);
    for (const alias of fields[3].split(',')) {
      // The compact dump has no language tags; retain source variants, Latin first.
      const latin = /^[\p{Script=Latin}\p{M}\p{N}\p{P}\p{Zs}]+$/u.test(alias);
      addAlias(entry.aliases, alias, latin ? 1 : 2, place);
    }
  });
  const places = [...placesByKey.values()].sort((a, b) => (
    compare(a.country, b.country) || compare(a.province, b.province) || compare(a.place, b.place)
  )).map((entry) => ({
    country: entry.country,
    province: entry.province,
    place: entry.place,
    alt_name: joinAliases(entry.aliases),
    hub: entry.hub,
    geoname_id: entry.geoname_id,
  }));
  const counts = Object.fromEntries(Object.values(options.countries).map((country) => {
    const rows = places.filter((row) => row.country === country);
    if (!rows.length) throw new Error(`No eligible settlements for ${country}; no outputs written`);
    return [country, {
      places: rows.length,
      hubs: rows.filter((row) => row.hub).length,
      missingRegion: rows.filter((row) => row.province === UNKNOWN_REGION).length,
    }];
  }));
  const data = {
    source: {
      name: 'GeoNames',
      url: 'https://www.geonames.org/',
      cities500: { url: `${BASE_URL}cities500.zip`, sha256: citiesHash, hashedFile: 'cities500.txt' },
      admin1CodesASCII: { url: `${BASE_URL}admin1CodesASCII.txt`, sha256: adminHash },
      readme: `${BASE_URL}readme.txt`,
      coverage: 'Population >500 or administrative seats down to PPLA4; not all tourism destinations.',
      modifications: 'Active class-P settlements only; source names retained; admin1 lookup; natural-key deduplication.',
      activeFeatureCodes: [...ACTIVE_CODES],
      hubFeatureCodes: [...HUB_CODES],
      missingRegion: UNKNOWN_REGION,
      deduplication: 'Exact country/province/place; lowest GeoNames ID; merged aliases and hub flags.',
      aliases: 'ASCII name, then Latin-script variants, then other scripts; max 12 names, 120 chars/name, 320 chars total.',
    },
    license: {
      name: 'Creative Commons Attribution 4.0 International (CC BY 4.0)',
      url: LICENSE_URL,
      attribution: 'Contains GeoNames data (https://www.geonames.org/), filtered and reformatted.',
    },
    retrievedAt: options.retrievedAt,
    countries: options.countries,
    places,
  };
  // Finish all parsing, validation and rendering before touching either output.
  const json = `${JSON.stringify(data, null, 2)}\n`;
  const sql = renderSql(data);
  await writeFile(options.json, json, 'utf8');
  await writeFile(options.sql, sql, 'utf8');
  console.log(JSON.stringify({ places: places.length, duplicateRows, excludedRows, countries: counts }, null, 2));
}

try {
  if (process.argv.slice(2).includes('--help')) {
    console.log(HELP);
  } else {
    await generate(parseArgs(process.argv.slice(2)));
  }
} catch (error) {
  console.error(`Regional places generation failed: ${error.message}`);
  process.exitCode = 1;
}
