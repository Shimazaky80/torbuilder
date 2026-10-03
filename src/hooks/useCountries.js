import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

const COMMON_COUNTRIES = [
  'Botswana', 'France', 'Germany', 'Kenya', 'Namibia', 'Netherlands',
  'South Africa', 'Tanzania', 'United Kingdom', 'United States'
];

export const useCountries = () => {
  const [countries, setCountries] = useState([]);

  useEffect(() => {
    let cancelled = false;

    const loadCountries = async () => {
      const { data, error } = await supabase
        .from('app_countries')
        .select('name')
        .eq('is_active', true)
        .order('name', { ascending: true });

      if (error) throw error;
      const names = (data || []).map((row) => row.name).filter(Boolean);
      if (!names.length) throw new Error('No active countries are visible to this session');
      if (!cancelled) setCountries(names);
    };

    loadCountries().catch((error) => {
      console.error('Failed to load countries:', error.message);
      if (!cancelled) setCountries(COMMON_COUNTRIES);
    });

    return () => { cancelled = true; };
  }, []);

  return countries;
};
