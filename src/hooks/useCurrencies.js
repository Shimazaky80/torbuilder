import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';

/**
 * Hook that fetches all active currencies from app_currencies table.
 * Returns: { currencies, loading }
 * currencies is an array of { code, symbol, name, country, country_code }
 */
export const useCurrencies = () => {
  const [currencies, setCurrencies] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchCurrencies = async () => {
      try {
        const { data, error } = await supabase
          .from('app_currencies')
          .select('code, symbol, name, country, country_code')
          .eq('is_active', true)
          .order('code', { ascending: true });

        if (error) throw error;
        setCurrencies(data || []);
      } catch (err) {
        console.error('Failed to load currencies:', err.message);
        // Fallback to common currencies if DB fails
        setCurrencies([
          { code: 'USD', symbol: '$',  name: 'US Dollar',          country: 'United States', country_code: 'US' },
          { code: 'EUR', symbol: '€',  name: 'Euro',               country: 'Eurozone',      country_code: 'EU' },
          { code: 'GBP', symbol: '£',  name: 'British Pound',      country: 'United Kingdom',country_code: 'GB' },
          { code: 'ZAR', symbol: 'R',  name: 'South African Rand', country: 'South Africa',  country_code: 'ZA' },
          { code: 'KES', symbol: 'KSh','name': 'Kenyan Shilling',  country: 'Kenya',         country_code: 'KE' },
          { code: 'TZS', symbol: 'Sh', name: 'Tanzanian Shilling', country: 'Tanzania',      country_code: 'TZ' },
        ]);
      } finally {
        setLoading(false);
      }
    };

    fetchCurrencies();
  }, []);

  return { currencies, loading };
};
