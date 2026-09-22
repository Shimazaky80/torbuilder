import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';

/* Tenant preference for how many rows each list menu module displays by
   default (max rows fetched/rendered). Defaults to 2 to keep list modules
   fast; raising it above 2 shows a load-time warning in Settings. The
   Settings and Dashboard pages ignore this and render everything. */
export const useListRowLimit = () => {
  const [limit, setLimit] = useState(2);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      let next = 2;
      try {
        const { data: { user } } = await supabase.auth.getUser();
        const profile = user
          ? await supabase.from('profiles').select('company_id').eq('id', user.id).single()
          : { data: null };
        const cid = profile?.data?.company_id || null;
        if (cid) {
          const { data } = await supabase
            .from('company_billing_settings')
            .select('list_row_limit')
            .eq('company_id', cid)
            .maybeSingle();
          const n = Number(data?.list_row_limit);
          if (Number.isFinite(n) && n > 0) next = Math.round(n);
        }
      } catch {
        next = 2;
      }
      if (cancelled) return;
      setLimit(next);
      setReady(true);
    })();
    return () => { cancelled = true; };
  }, []);

  return { limit, ready };
};