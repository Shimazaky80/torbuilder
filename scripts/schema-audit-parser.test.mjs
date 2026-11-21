import assert from 'node:assert/strict';
import { declaredFields } from './schema-audit-parser.mjs';

const source = `
export const LIBRARY_ITEM_BASE_FIELDS = [
  'id',
  /* The comment has commas, a fake field 'comment_only', and a closing bracket ]. */
  'company_id',
].join(',');

export const LIBRARY_ITEM_LIGHT_FIELDS = [
  /* A leading comment must not become a requested column. */
  'surcharge_type', // inline comment, 'also_not_a_field',
  LIBRARY_ITEM_BASE_FIELDS,
  'stay_pay_promotions',
].join(',');
`;

assert.deepEqual(declaredFields(source), [
  'surcharge_type',
  'id',
  'company_id',
  'stay_pay_promotions'
]);
assert.deepEqual(declaredFields('export const LIBRARY_ITEM_LIGHT_FIELDS = [];'), []);

console.log('Schema audit field parser tests passed.');
