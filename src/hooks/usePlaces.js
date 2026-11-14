import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

const PAGE_SIZE = 1000;
const EMPTY_PLACES = [];
const byHubThenName = (rows) => [...rows].sort((a, b) =>
  (Number(b.isHub) - Number(a.isHub))
  || a.place.localeCompare(b.place, 'en')
  || (a.province || '').localeCompare(b.province || '', 'en')
  || (a.id || '').localeCompare(b.id || ''));

export const usePlaces = (country = 'South Africa') => {
  const selectedCountry = typeof country === 'string' ? country.trim() : '';
  const [resolved, setResolved] = useState({ country: null, places: EMPTY_PLACES, error: null });

  useEffect(() => {
    if (!selectedCountry) return;
    let cancelled = false;

    const fromTable = async () => {
      const rows = [];
      for (let offset = 0; !cancelled; offset += PAGE_SIZE) {
        const { data, error } = await supabase
          .from('app_places')
          .select('id, country, place, province, alt_name, is_hub')
          .eq('country', selectedCountry)
          .eq('is_active', true)
          .order('id', { ascending: true })
          .range(offset, offset + PAGE_SIZE - 1);
        if (cancelled) return [];
        if (error) throw error;
        rows.push(...(data || []));
        if ((data || []).length < PAGE_SIZE) break;
      }
      return rows.map((row) => ({
        id: row.id,
        country: row.country,
        place: row.place,
        province: row.province,
        altName: row.alt_name || '',
        isHub: !!row.is_hub
      }));
    };

    const fromBundle = async () => {
      if (selectedCountry !== 'South Africa' || cancelled) return [];
      const { default: rows } = await import('../../supabase/data/south_africa_places.json');
      return (rows || [])
        .filter((row) => row.province)
        .map((row) => ({
          id: null,
          country: selectedCountry,
          place: row.place,
          province: row.province,
          altName: row.alt_name || '',
          isHub: !!row.hub
        }));
    };

    (async () => {
      let rows = [];
      let loadError = null;
      try {
        rows = await fromTable();
      } catch (error) {
        loadError = error;
        if (!cancelled) console.error('Failed to load places from app_places:', error.message);
      }
      if (cancelled) return;
      if (!rows.length) {
        try {
          rows = await fromBundle();
        } catch (error) {
          loadError ||= error;
          if (!cancelled) console.error('Bundled place list is unavailable too:', error.message);
        }
      }
      if (!cancelled) {
        /* The fallback list is a working answer, not a failure: only report the
           table error when no places came back at all. */
        setResolved({ country: selectedCountry, places: byHubThenName(rows), error: rows.length ? null : loadError });
      }
    })();

    return () => { cancelled = true; };
  }, [selectedCountry]);

  if (!selectedCountry) return { places: EMPTY_PLACES, loading: false, error: null };
  if (resolved.country !== selectedCountry) return { places: EMPTY_PLACES, loading: true, error: null };
  return { places: resolved.places, loading: false, error: resolved.error };
};
