import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables');
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

/* Fold a company's legal form and punctuation away so "Test Company (Pty) Ltd"
   and "Test Company" compare equal. A profile whose name is the agency's own is
   not a person, and a client document must not print the agency as its designer. */
const companyNameKey = (value) => String(value || '')
  .toLowerCase()
  .replace(/\(pty\)|\bpty\b|\bltd\b|\blimited\b|\binc\b|\bllc\b|\bcc\b|\bcompany\b|\bco\b/g, ' ')
  .replace(/[^a-z0-9]+/g, ' ')
  .trim();

export async function getLoggedInUserName() {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return '';
    const metadataName = String(user.user_metadata?.full_name || user.user_metadata?.name || '').trim();
    const { data: profile } = await supabase
      .from('profiles')
      .select('first_name, last_name, company_id')
      .eq('id', user.id)
      .maybeSingle();
    if (profile) {
      const fullName = [profile.first_name, profile.last_name].filter(Boolean).join(' ').trim();
      if (fullName) {
        /* Some tenants register the profile under the company name. The name the
           account was created with is the person who signs the document. */
        let companyName = '';
        if (profile.company_id) {
          const { data: company } = await supabase
            .from('companies')
            .select('name')
            .eq('id', profile.company_id)
            .maybeSingle();
          companyName = company?.name || '';
        }
        const profileKey = companyNameKey(fullName);
        const sameAsCompany = !!profileKey && profileKey === companyNameKey(companyName);
        if (!sameAsCompany) return fullName;
        if (metadataName) return metadataName;
        return fullName;
      }
    }
    if (metadataName) return metadataName;
    if (user.email) return user.email.split('@')[0];
    return 'User';
  } catch {
    return '';
  }
}

