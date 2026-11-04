/* PostgREST rejects a whole select when any one of the columns it asks for is
   missing, so reading or writing a column before its migration lands fails the
   save of every row in the table - not just the new feature's rows. Each column
   is therefore probed once per session and every caller keeps to the columns it
   knows exist until the probe answers.

   One cache for the whole app, because two modules probing the same column
   separately would disagree mid-session about whether it is there. */
import { supabase } from './supabase';

const probes = new Map();

export const columnExists = (table, column) => {
  const key = `${table}.${column}`;
  if (!probes.has(key)) {
    probes.set(key, supabase
      .from(table)
      .select(column)
      .limit(1)
      .then(({ error }) => !error)
      .catch(() => false));
  }
  return probes.get(key);
};
