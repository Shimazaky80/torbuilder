/**
 * Schema audit: compares the live PostgREST schema cache against the migrations
 * in this folder, so a column that exists in a migration but not in the database
 * is found before a save fails with
 *
 *   Could not find the '<column>' column of '<table>' in the schema cache
 *
 * Reads SUPABASE_SERVICE_KEY (falls back to VITE_SUPABASE_ANON_KEY) from .env.
 * Read-only: it never writes to the database.
 *
 *   npm run audit:schema            report every gap
 *   npm run audit:schema -- library_items item_rates
 *                                  limit the report to those tables
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIGRATIONS = path.join(ROOT, 'supabase');
const FIELDS_FILE = path.join(ROOT, 'src', 'lib', 'libraryItemFields.js');

/* -- .env ------------------------------------------------------------------- */
const readEnv = () => {
  const env = {};
  if (!fs.existsSync(path.join(ROOT, '.env'))) return env;
  for (const line of fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) env[m[1]] = m[2];
  }
  return env;
};

/* -- migrations ------------------------------------------------------------- */
const walk = (dir, acc = []) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, acc);
    else if (entry.name.endsWith('.sql')) acc.push(full);
  }
  return acc;
};

/** Splits on top-level commas only: parenthesised groups and string literals stay whole. */
const splitTopLevel = (text) => {
  const parts = [];
  let depth = 0;
  let inString = false;
  let current = '';
  for (const ch of text) {
    if (ch === "'") inString = !inString;
    if (!inString) {
      if (ch === '(') depth++;
      if (ch === ')') depth--;
    }
    if (ch === ',' && depth === 0 && !inString) {
      parts.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim()) parts.push(current);
  return parts;
};

const COLUMN_START = /^(?:"([^"]+)"|([a-z_][a-z0-9_]*))\s+([\s\S]+)$/i;
const NOT_A_COLUMN = /^(CONSTRAINT|PRIMARY|UNIQUE|CHECK|FOREIGN|EXCLUDE|INDEX|LIKE)\b/i;

/** table -> Map(lowercase column -> definition) */
const migrationColumns = () => {
  const tables = new Map();
  const add = (table, column, definition) => {
    if (!tables.has(table)) tables.set(table, new Map());
    const key = column.toLowerCase();
    if (!tables.get(table).has(key)) tables.get(table).set(key, definition);
  };

  for (const file of walk(MIGRATIONS)) {
    const sql = fs
      .readFileSync(file, 'utf8')
      .replace(/--[^\n]*/g, ' ')
      .replace(/\/\*[\s\S]*?\*\//g, ' ');

    // CREATE TABLE [IF NOT EXISTS] <table> ( ... );
    const create = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?"?([a-z0-9_]+)"?\s*\(([\s\S]*?)\n\s*\);/gi;
    for (const m of sql.matchAll(create)) {
      for (const part of splitTopLevel(m[2])) {
        const line = part.trim().replace(/\s+/g, ' ');
        if (!line || NOT_A_COLUMN.test(line)) continue;
        const cm = line.match(COLUMN_START);
        if (cm) add(m[1], cm[1] || cm[2], line);
      }
    }

    // ALTER TABLE <table> ... ADD COLUMN ..., ADD COLUMN ...;
    const alter = /ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:public\.)?"?([a-z0-9_]+)"?\s+([\s\S]*?);/gi;
    for (const m of sql.matchAll(alter)) {
      for (const piece of m[2].split(/ADD\s+COLUMN/i).slice(1)) {
        const definition = splitTopLevel(piece)[0]?.trim().replace(/\s+/g, ' ').replace(/^IF\s+NOT\s+EXISTS\s+/i, '');
        const cm = definition?.match(COLUMN_START);
        if (cm) add(m[1], cm[1] || cm[2], definition);
      }
    }
  }
  return tables;
};

/** The columns src/lib/libraryItemFields.js asks PostgREST for. */
const declaredFields = () => {
  if (!fs.existsSync(FIELDS_FILE)) return [];
  const block = fs.readFileSync(FIELDS_FILE, 'utf8').match(/LIBRARY_ITEM_LIGHT_FIELDS\s*=\s*\[([\s\S]*?)\]/);
  if (!block) return [];
  return block[1]
    .split(',')
    .map((part) => part.trim().replace(/^'|'$/g, ''))
    .filter((part) => part && part !== '.join');
};

/* -- run -------------------------------------------------------------------- */
const env = readEnv();
const url = env.VITE_SUPABASE_URL;
const key = env.SUPABASE_SERVICE_KEY || env.VITE_SUPABASE_ANON_KEY;
if (!url || !key) {
  console.error('VITE_SUPABASE_URL and SUPABASE_SERVICE_KEY (or VITE_SUPABASE_ANON_KEY) are required in .env');
  process.exit(2);
}

const response = await fetch(`${url}/rest/v1/`, {
  headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: 'application/json' }
});
if (!response.ok) {
  console.error(`Could not read the schema cache: HTTP ${response.status} ${response.statusText}`);
  process.exit(2);
}
const spec = await response.json();
const live = new Map(
  Object.entries(spec.definitions || {}).map(([table, def]) => [
    table.toLowerCase(),
    new Set(Object.keys(def.properties || {}).map((c) => c.toLowerCase()))
  ])
);

const wanted = process.argv.slice(2).map((t) => t.toLowerCase());
const migrations = migrationColumns();
const gaps = [];

for (const [table, columns] of [...migrations.entries()].sort()) {
  if (wanted.length && !wanted.includes(table)) continue;
  const liveColumns = live.get(table);
  if (!liveColumns) {
    gaps.push({ table, column: '(table missing from the schema cache)', definition: '' });
    continue;
  }
  for (const [column, definition] of columns) {
    if (!liveColumns.has(column)) gaps.push({ table, column, definition });
  }
}

const fields = wanted.length === 0 || wanted.includes('library_items') ? declaredFields() : [];
const liveLibraryItems = live.get('library_items');
const fieldGaps = fields.filter((f) => liveLibraryItems && !liveLibraryItems.has(f.toLowerCase()));

if (!gaps.length && !fieldGaps.length) {
  console.log(`Schema is in sync: ${migrations.size} tables checked against the live schema cache.`);
  process.exit(0);
}

if (gaps.length) {
  console.log(`${gaps.length} column(s) defined in migrations but missing from the live schema:\n`);
  for (const { table, column, definition } of gaps) {
    console.log(`  ${table}.${column}${definition ? `  —  ${definition}` : ''}`);
  }
}
if (fieldGaps.length) {
  console.log(`\n${fieldGaps.length} column(s) requested by src/lib/libraryItemFields.js but missing live:`);
  console.log(`  ${fieldGaps.join(', ')}`);
}
console.log('\nAdd the missing columns (see supabase/migrations/) and run this again.');
process.exit(1);