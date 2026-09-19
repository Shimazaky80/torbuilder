import { useEffect, useState } from 'react';
import { supabase } from './supabase';

/* Tenant-wide amount entry rules, controlled from Settings -> Billing & Invoicing.
   - allowDecimals : whether money fields accept cents (step 0.01) or whole
                     units only (step 1). Never affects counts (pax, capacity).
   - inputRounding : up / down / none  — how typed money values are snapped on blur.
   - outputRounding: up / down / none  — how calculated amounts (sell prices,
                     line totals) are rounded. */

export const AMOUNT_DEFAULTS = {
  allowDecimals: true,
  inputRounding: 'none',
  outputRounding: 'none'
};

export const ROUNDING_MODES = [
  { value: 'none', label: 'No rounding' },
  { value: 'up', label: 'Round up' },
  { value: 'down', label: 'Round down' }
];

const asMode = (v) => (v === 'up' || v === 'down' ? v : 'none');

let cached = null;

const fetchAmountSettings = async () => {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { ...AMOUNT_DEFAULTS };
    const { data: profile } = await supabase
      .from('profiles')
      .select('company_id')
      .eq('id', user.id)
      .maybeSingle();
    if (!profile?.company_id) return { ...AMOUNT_DEFAULTS };
    const { data } = await supabase
      .from('company_billing_settings')
      .select('allow_decimal_amounts, input_rounding_mode, output_rounding_mode')
      .eq('company_id', profile.company_id)
      .maybeSingle();
    if (!data) return { ...AMOUNT_DEFAULTS };
    return {
      allowDecimals: data.allow_decimal_amounts !== false,
      inputRounding: asMode(data.input_rounding_mode),
      outputRounding: asMode(data.output_rounding_mode)
    };
  } catch {
    return { ...AMOUNT_DEFAULTS };
  }
};

export const useAmountSettings = () => {
  const [settings, setSettings] = useState(() => cached || { ...AMOUNT_DEFAULTS, loading: true });
  useEffect(() => {
    if (cached) return;
    let mounted = true;
    (async () => {
      const s = await fetchAmountSettings();
      cached = s;
      if (mounted) setSettings(s);
    })();
    return () => {
      mounted = false;
    };
  }, []);
  return settings;
};

/* step attribute for money inputs: 0.01 accepts cents, 1 whole numbers only. */
export const stepForAmounts = (allowDecimals) => (allowDecimals ? '0.01' : '1');

/* Round a numeric value to a whole unit per the configured mode. */
export const roundAmount = (value, mode) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return round2(value);
  if (mode === 'up') return Math.ceil(n);
  if (mode === 'down') return Math.floor(n);
  return round2(n);
};

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/* Round an input string value (what onChange/onBlur gives you) per the mode,
   preserving '' and partial states so typing is never disrupted on change. */
export const applyInputRounding = (value, mode) => {
  if (mode === 'none') return value;
  if (value === '' || value === null || value === undefined) return value;
  const n = Number(value);
  if (!Number.isFinite(n)) return value;
  return String(mode === 'up' ? Math.ceil(n) : Math.floor(n));
};