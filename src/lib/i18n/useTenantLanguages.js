import { useEffect, useState } from 'react';
import { supabase } from '../supabase';
import { enabledLanguageCodes, SOURCE_LANGUAGE } from './index';

/* Which languages this tenant can write and export content in, read once per
   session from company_billing_settings and shared by every page.

   The answer is always at least ['en'], and a settings row that cannot be read
   - the migration not applied yet, no company, offline - answers ['en'] too.
   English-only is the safe state: it is what the app did before any of this
   existed, and every language control in the UI hides itself there. */

let cached = null;

const fetchTenantLanguages = async () => {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return [SOURCE_LANGUAGE];
    const { data: profile } = await supabase
      .from('profiles')
      .select('company_id')
      .eq('id', user.id)
      .maybeSingle();
    if (!profile?.company_id) return [SOURCE_LANGUAGE];
    const { data } = await supabase
      .from('company_billing_settings')
      .select('document_languages')
      .eq('company_id', profile.company_id)
      .maybeSingle();
    return enabledLanguageCodes(data?.document_languages);
  } catch {
    return [SOURCE_LANGUAGE];
  }
};

/* Settings calls this after it saves a new language list, so the tabs appear on
   the library and builder screens without a page reload. */
export const refreshTenantLanguages = async () => {
  cached = await fetchTenantLanguages();
  return cached;
};

export const useTenantLanguages = () => {
  const [codes, setCodes] = useState(() => cached || [SOURCE_LANGUAGE]);
  useEffect(() => {
    if (cached) return undefined;
    let mounted = true;
    fetchTenantLanguages().then((next) => {
      cached = next;
      if (mounted) setCodes(next);
    });
    return () => {
      mounted = false;
    };
  }, []);
  return codes;
};
