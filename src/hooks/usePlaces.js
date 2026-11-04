import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

/* The town list behind a hire's pick-up and return.

   app_places is global shared-read, so every tenant has the same South African
   towns from their first login with nothing to upload. Until that migration is
   applied the hook falls back to the JSON the migration seeds from - imported
   only when the table answers nothing, so the 33k of town names stays out of the
   main bundle. One source of truth, so the seed and the offline list cannot drift.

   Hubs - the airports and cities a hire actually starts or ends at - come first,
   then alphabetical, because the field is searched rather than scanned. */

const byHubThenName = (rows) => [...rows].sort((a, b) =>
  (Number(b.isHub) - Number(a.isHub)) || a.place.localeCompare(b.place, 'en'));

export const usePlaces = (country = 'South Africa') => {
  const [places, setPlaces] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    const fromTable = async () => {
      const { data, error } = await supabase
        .from('app_places')
        .select('place, province, alt_name, is_hub')
        .eq('country', country)
        .eq('is_active', true);
      if (error) throw error;
      if (!data?.length) throw new Error(`No places are visible for ${country}`);
      return data.map((row) => ({
        place: row.place,
        province: row.province,
        altName: row.alt_name || '',
        isHub: !!row.is_hub
      }));
    };

    const fromBundle = async () => {
      if (country !== 'South Africa') return [];
      const { default: rows } = await import('../../supabase/data/south_africa_places.json');
      return (rows || [])
        .filter((row) => row.province)
        .map((row) => ({
          place: row.place,
          province: row.province,
          altName: row.alt_name || '',
          isHub: !!row.hub
        }));
    };

    (async () => {
      let rows = [];
      try {
        rows = await fromTable();
      } catch (error) {
        console.error('Failed to load places from app_places:', error.message);
        try {
          rows = await fromBundle();
        } catch (bundleError) {
          console.error('Bundled place list is unavailable too:', bundleError.message);
        }
      }
      if (!cancelled) {
        setPlaces(byHubThenName(rows));
        setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [country]);

  return { places, loading };
};
