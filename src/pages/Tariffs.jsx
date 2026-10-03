import { useCallback, useEffect, useState } from 'react';
import SearchableSelect from '../components/SearchableSelect';
import { Download, ExternalLink, FileSpreadsheet, FileText, Plus, Send, Tag } from 'lucide-react';
import { getLoggedInUserName, supabase } from '../lib/supabase';
import { useToast } from '../context/ToastContext';

const DEFAULT_CATEGORIES = ['Accommodation', 'Transfers', 'Activities / Tours', 'Flights / Charter', 'Meals', 'Trains', 'Tickets', 'Extras', 'Car Rental'];
const money = (value, currency) => `${currency || ''} ${Number(value || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`.trim();
const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const isPartnerExcludedCategory = (category) => /^(guide|guide\s*\/\s*driver)$/i.test(String(category || '').trim());
const positiveRate = (...values) => {
  for (const value of values) {
    const number = Number(value);
    if (Number.isFinite(number) && number > 0) return number;
  }
  return 0;
};
const childRateLines = (rate, item, currency, { fastTrack = false } = {}) => {
  const childRates = fastTrack ? rate.fast_track_child_rates_breakdown : rate.child_rates_breakdown;
  const ranges = Array.isArray(item.child_age_ranges) ? item.child_age_ranges : [];
  const lines = ranges.map((range) => {
    const amount = positiveRate(childRates?.[range.id]);
    return amount ? `Child ${range.name || ''} (${range.ageFrom ?? '?'}-${range.ageTo ?? '?'}): ${money(amount, currency)}` : '';
  }).filter(Boolean);
  if (!lines.length) {
    const simpleChild = positiveRate(childRates?.child, rate.child_rate);
    if (simpleChild) lines.push(`Child: ${money(simpleChild, currency)}`);
  }
  return lines;
};
const rateBasisLabel = (rate, item) => {
  const basis = String(rate.rate_basis || item.pricing_model || 'per_person').toLowerCase();
  if (basis === 'per_vehicle') return 'Per Vehicle';
  if (basis === 'per_trip') return 'Per Trip';
  if (basis === 'per_room') return 'Per Room';
  if (basis === 'per_person_sharing') return 'Per Person Sharing';
  if (basis === 'tiered') return 'Per Person';
  return 'Per Person';
};
const accommodationPriceLines = (rate, item, currency) => {
  const maxCapacity = Math.max(1, Number(item.max_occupancy) || 1);
  const basis = String(rate.rate_basis || item.pricing_model || 'per_person_sharing').toLowerCase();
  const lines = [];
  if (basis === 'per_room') {
    const roomRate = positiveRate(rate.unit_price, rate.price_1_adult, rate.single_room_rate);
    if (roomRate) lines.push(`Per person (room rate ÷ max capacity ${maxCapacity}): ${money(roomRate / maxCapacity, currency)}`);
  } else {
    const single = positiveRate(rate.price_1_adult, rate.single_room_rate);
    const sharing = positiveRate(rate.price_2_adults, rate.double_twin_rate);
    if (single) lines.push(`Per person (single): ${money(single, currency)}`);
    if (sharing) lines.push(`Per person sharing: ${money(sharing, currency)}`);
  }
  const thirdAdult = positiveRate(rate.price_3_plus_adults);
  if (thirdAdult) lines.push(`3rd+ adult: ${money(thirdAdult, currency)}`);
  lines.push(...childRateLines(rate, item, currency));
  return lines;
};
const allowedRateKeys = new Set([
  'price_1_adult', 'price_2_adults', 'price_3_plus_adults', 'price_child_0_1', 'price_child_0_5',
  'price_child_1_5', 'price_child_2_11', 'price_child_6_11', 'price_child_12_17', 'price_child',
  'single_room_rate', 'double_twin_rate', 'triple_room_rate', 'unit_price', 'adult_rate', 'child_rate',
  'single_supplement', 'taxes_and_surcharges', 'fuel_surcharge', 'entrance_fee_per_person',
  'entrance_fee_per_vehicle', 'conservation_levy_adult', 'conservation_levy_child',
  'conservation_levy_per_adult', 'conservation_levy_per_child', 'rate', 'price',
  'fast_track_adult_rate', 'guide_rate', 'driver_rate', 'guide_transfer_rate',
  'guide_half_day_rate', 'guide_full_day_rate', 'guide_overland_rate', 'guide_dinner_rate'
]);
const rateMetadataKeys = ['id', 'currency', 'option_name', 'season_name', 'valid_from', 'valid_to', 'room_type', 'meal_plan', 'rate_basis', 'tiered_pricing', 'child_rates_breakdown', 'fast_track_child_rates_breakdown', 'child_age_ranges', 'notes', 'vehicle_group', 'vehicle_name', 'rate_code', 'kms_unlimited', 'kms_included', 'max_passengers', 'min_days', 'max_days'];

const applyMarkup = (value, percentage) => Math.round((Number(value || 0) * (1 + Number(percentage || 0) / 100) + Number.EPSILON) * 100) / 100;

function safeRateSnapshot(rate, markup) {
  const result = {};
  rateMetadataKeys.forEach((key) => {
    if (rate[key] !== undefined && rate[key] !== null) result[key] = rate[key];
  });
  Object.entries(rate).forEach(([key, value]) => {
    if (allowedRateKeys.has(key) && value !== '' && value !== null && Number.isFinite(Number(value))) {
      result[key] = applyMarkup(value, markup);
    }
  });
  for (const key of ['child_rates_breakdown', 'fast_track_child_rates_breakdown']) {
    if (rate[key] && typeof rate[key] === 'object' && !Array.isArray(rate[key])) {
      result[key] = Object.fromEntries(Object.entries(rate[key]).map(([name, value]) => [name, applyMarkup(value, markup)]));
    }
  }
  if (Array.isArray(rate.tiered_pricing)) {
    result.tiered_pricing = rate.tiered_pricing.map((tier) => ({
      min_pax: tier.min_pax,
      max_pax: tier.max_pax,
      rate: applyMarkup(tier.rate, markup)
    }));
  }
  return result;
}

function tariffDocument(tariff, rows, profile) {
  const header = [profile?.legal_name || profile?.name, profile?.billing_address, profile?.contact_email, profile?.contact_tel, profile?.contact_website].filter(Boolean);
  const logo = profile?.logo_data_url ? `<img src="${escapeHtml(profile.logo_data_url)}" alt="Company logo" style="display:block;max-width:180px;max-height:80px;object-fit:contain;margin-bottom:12px">` : '';
  const renderItem = (row) => {
    const item = row.item_snapshot || {};
    const isTransferOrActivity = /^(transfers|activities \/ tours)$/i.test(row.category || '');
    const currency = item.currency || 'ZAR';
    const listText = (value) => Array.isArray(value) ? value.filter(Boolean).join(', ') : String(value || '').trim();
    const details = [
      ['Inclusions', listText(item.inclusions || item.inclusions_text)],
      ['Exclusions', listText(item.exclusions || item.exclusions_text)],
      ['Terms and Conditions', listText(item.terms_and_conditions || item.terms_conditions || item.terms)]
    ].filter(([, value]) => value);
    const rateRows = (item.rates || []).map((rate) => {
      const period = [rate.valid_from, rate.valid_to].filter(Boolean).join(' - ') || 'All dates';
      if (isTransferOrActivity) {
        const basisValue = String(rate.rate_basis || item.pricing_model || 'per_person').toLowerCase();
        const flat = basisValue === 'per_vehicle' || basisValue === 'per_trip' || basisValue === 'flat';
        const basis = flat ? 'Per Vehicle' : 'Per Person';
        const baseRate = Number(flat
          ? rate.unit_price ?? rate.price_1_adult ?? rate.adult_rate ?? rate.rate ?? 0
          : rate.price_1_adult ?? rate.adult_rate ?? rate.unit_price ?? rate.rate ?? 0);
        const lines = [`${basis} rate: ${escapeHtml(money(baseRate, rate.currency || currency))}`];
        const entrancePerson = Number(rate.entrance_fee_per_person) || 0;
        const entranceVehicle = Number(rate.entrance_fee_per_vehicle) || 0;
        if (entrancePerson > 0) lines.push(`Park / entrance fee (per person): ${escapeHtml(money(entrancePerson, rate.currency || currency))}`);
        if (entranceVehicle > 0) lines.push(`Park / entrance fee (flat rate): ${escapeHtml(money(entranceVehicle, rate.currency || currency))}`);
        return `<tr><td>${escapeHtml(rate.season_name || rate.option_name || 'Rate')}</td><td>${escapeHtml(period)}</td><td>${basis}</td><td>${lines.join('<br>')}</td></tr>`;
      }
      let rateLines = [];
      let basisLabel = rateBasisLabel(rate, item);
      if (/^accommodation$/i.test(row.category || '')) {
        rateLines = accommodationPriceLines(rate, item, rate.currency || currency);
        basisLabel = String(rate.rate_basis || item.pricing_model || '').toLowerCase() === 'per_room'
          ? 'Per Person'
          : rateBasisLabel(rate, item);
      } else if (/^(meals|tickets)$/i.test(row.category || '')) {
        basisLabel = 'Per Person';
        const standard = positiveRate(rate.price_1_adult, rate.adult_rate, rate.unit_price);
        if (standard) rateLines.push(`${/^tickets$/i.test(row.category || '') ? 'Standard' : 'Adult'} per person: ${money(standard, rate.currency || currency)}`);
        if (/^tickets$/i.test(row.category || '') && positiveRate(rate.fast_track_adult_rate)) {
          rateLines.push(`Fast Track per person: ${money(rate.fast_track_adult_rate, rate.currency || currency)}`);
        }
        rateLines.push(...childRateLines(rate, item, rate.currency || currency));
        if (/^tickets$/i.test(row.category || '') && positiveRate(rate.fast_track_adult_rate)) {
          rateLines.push(...childRateLines(rate, item, rate.currency || currency, { fastTrack: true }).map((line) => line.replace(/^Child/, 'Fast Track child')));
        }
      } else if (/^car rental$/i.test(row.category || '')) {
        basisLabel = 'Per Vehicle';
        const price = positiveRate(rate.price);
        if (price) rateLines.push(`${escapeHtml(rate.vehicle_name || 'Vehicle')} (${rate.min_days || 1}+ days): ${money(price, rate.currency || currency)}`);
      } else {
        const price = positiveRate(rate.unit_price, rate.price_1_adult, rate.adult_rate, rate.rate);
        if (price) rateLines.push(`${basisLabel}: ${money(price, rate.currency || currency)}`);
      }
      const room = /^accommodation$/i.test(row.category || '') ? rate.room_type || '' : '';
      const mealPlan = /^accommodation$/i.test(row.category || '') ? rate.meal_plan || '' : '';
      const columns = [
        `<td>${escapeHtml(rate.season_name || rate.option_name || rate.vehicle_name || 'Rate')}</td>`,
        `<td>${escapeHtml(period)}</td>`,
        `<td>${escapeHtml(room || basisLabel)}</td>`
      ];
      if (/^accommodation$/i.test(row.category || '')) columns.push(`<td>${escapeHtml(mealPlan)}</td>`);
      columns.push(`<td>${rateLines.length ? rateLines.map(escapeHtml).join('<br>') : 'No rate details'}</td>`);
      return `<tr>${columns.join('')}</tr>`;
    }).join('');
    const ratesTable = isTransferOrActivity
      ? `<table><thead><tr><th>Season</th><th>Rate validity</th><th>Basis</th><th>Net Rates</th></tr></thead><tbody>${rateRows || '<tr><td colspan="4">No rate details</td></tr>'}</tbody></table>`
    : `<table><thead><tr><th>Season</th><th>Rate validity</th><th>${/^accommodation$/i.test(row.category || '') ? 'Room / basis' : 'Basis'}</th>${/^accommodation$/i.test(row.category || '') ? '<th>Meal plan</th>' : ''}<th>Net Rates</th></tr></thead><tbody>${rateRows || `<tr><td colspan="${/^accommodation$/i.test(row.category || '') ? '5' : '4'}">No rate details</td></tr>`}</tbody></table>`;
    const detailList = details.length ? `<dl>${details.map(([label, value]) => `<dt>${label}</dt><dd>${escapeHtml(value)}</dd>`).join('')}</dl>` : '';
    const capacity = Number(item.max_occupancy);
    const capacityLine = Number.isFinite(capacity) && capacity > 0
      ? `<p class="capacity">Maximum capacity: ${capacity} ${capacity === 1 ? 'person' : 'people'}</p>`
      : '';
    const itemIdentifier = item.identifier_code ? ` - ${escapeHtml(item.identifier_code)}` : '';
    const supplierPrefix = /^accommodation$/i.test(row.category || '') && item.supplier_name
      ? `${escapeHtml(item.supplier_name)} - `
      : '';
    return `<h3>${supplierPrefix}${escapeHtml(item.name)}${itemIdentifier} <small>${escapeHtml(row.category)}</small></h3>${capacityLine}${ratesTable}${detailList}`;
  };
  const destinationGroups = new Map();
  rows.forEach((row) => {
    const item = row.item_snapshot || {};
    const destination = String(item.destination_region || item.location || 'Destination not specified').trim() || 'Destination not specified';
    const key = destination.toLocaleLowerCase();
    if (!destinationGroups.has(key)) destinationGroups.set(key, { title: destination, rows: [] });
    destinationGroups.get(key).rows.push(row);
  });
  const body = [...destinationGroups.values()]
    .sort((a, b) => a.title.localeCompare(b.title))
    .map((group) => `<section class="destination-group"><h2>${escapeHtml(group.title)}</h2>${group.rows.map(renderItem).join('')}</section>`)
    .join('');
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(tariff.name)}</title><style>body{font:14px Arial,sans-serif;margin:36px;color:#17252a}h1{color:#0d7478;margin-bottom:4px}h2{margin:28px 0 12px;padding:8px 10px;background:#edf3f2;border-left:4px solid #0d7478;color:#0b5f62;font-size:20px}.destination-group{break-inside:avoid}h3{margin:20px 0 4px}small{font-weight:400;color:#55666a}.item-id{margin:4px 0;color:#52656a;font-size:12px}.item-id strong{color:#0d7478}.capacity{margin:6px 0;padding:7px 10px;background:#e8f3f0;border-left:3px solid #0d7478;color:#244b48;font-weight:700}table{border-collapse:collapse;width:100%;margin:8px 0 12px}th,td{border:1px solid #ccd6d8;padding:8px;text-align:left;vertical-align:top}th{background:#edf3f2}.brand{margin-bottom:24px}.valid{color:#52656a}dl{display:grid;grid-template-columns:150px 1fr;gap:4px 10px;margin:0 0 20px}dt{font-weight:bold}dd{margin:0}</style></head><body><div class="brand">${logo}${header.map((line) => `<div>${escapeHtml(line)}</div>`).join('')}</div><h1>${escapeHtml(tariff.name)}</h1><div class="valid">${escapeHtml(tariff.valid_from)} to ${escapeHtml(tariff.valid_to)}</div>${body}</body></html>`;
}

function downloadContent(content, filename, mime) {
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([content], { type: mime }));
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(link.href);
}

export const Tariffs = () => {
  const { showToast } = useToast();
  const [companyId, setCompanyId] = useState(null);
  const [companyProfile, setCompanyProfile] = useState(null);
  const [clients, setClients] = useState([]);
  const [categories, setCategories] = useState(DEFAULT_CATEGORIES);
  const [tariffs, setTariffs] = useState([]);
  const [quotations, setQuotations] = useState([]);
  const [viewingQuote, setViewingQuote] = useState(null);
  const [tab, setTab] = useState('tariffs');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [openForm, setOpenForm] = useState(false);
  const [form, setForm] = useState({ name: '', clientId: '', validFrom: '', validTo: '', allServices: true, categories: [] });
  const [inviteForm, setInviteForm] = useState({ clientId: '', email: '' });

  const loadWorkspace = useCallback(async () => {
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data: profile, error: profileError } = await supabase.from('profiles').select('company_id').eq('id', user.id).single();
      if (profileError) throw profileError;
      if (!profile?.company_id) throw new Error('Tenant company profile was not found');
      const cid = profile.company_id;
      setCompanyId(cid);
      const [companyRes, clientsRes, libraryCategoriesRes, tariffsRes, quotesRes] = await Promise.all([
        supabase.from('company_billing_settings').select('*').eq('company_id', cid).maybeSingle(),
        supabase.from('clients').select('id, name, email, client_type, markup_percentage, is_active').eq('company_id', cid).order('name'),
        supabase.from('library_items').select('category').eq('company_id', cid).eq('is_active', true),
        supabase.from('partner_tariffs').select('*, clients(name)').eq('company_id', cid).order('created_at', { ascending: false }),
        supabase.from('partner_quotations').select('*, clients(name), partner_tariffs(name)').eq('company_id', cid).order('created_at', { ascending: false })
      ]);
      if (clientsRes.error) throw clientsRes.error;
      const agencyClients = (clientsRes.data || []).filter((client) =>
        String(client.client_type || '').trim().toLowerCase() === 'travel agency'
      );
      setClients(agencyClients);
      const libraryCategories = [...new Set((libraryCategoriesRes.data || []).map((row) => String(row.category || '').trim()).filter((category) => category && !isPartnerExcludedCategory(category)))].sort();
      setCategories(libraryCategories.length ? libraryCategories : DEFAULT_CATEGORIES);
      if (companyRes.error) throw companyRes.error;
      for (const res of [tariffsRes, quotesRes]) if (res.error) throw res.error;
      setCompanyProfile(companyRes.data || null);
      setTariffs(tariffsRes.data || []);
      setQuotations(quotesRes.data || []);
    } catch (error) {
      showToast(error.message || 'Could not load tariffs', 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    const timer = window.setTimeout(() => { loadWorkspace(); }, 0);
    return () => window.clearTimeout(timer);
  }, [loadWorkspace]);

  const resetForm = () => {
    setForm({ name: '', clientId: '', validFrom: '', validTo: '', allServices: true, categories: [] });
    setOpenForm(false);
  };

  const createTariff = async (event) => {
    event.preventDefault();
    if (!companyId || !form.clientId || !form.validFrom || !form.validTo || (!form.allServices && !form.categories.length)) {
      showToast('Complete the partner, category, and validity fields', 'warning');
      return;
    }
    if (form.validTo < form.validFrom) {
      showToast('The end date must be on or after the start date', 'warning');
      return;
    }
    setSaving(true);
    let createdTariffId = null;
    try {
      const client = clients.find((row) => row.id === form.clientId);
      if (!client) throw new Error('Select an available travel agency from Clients');
      const { data: { user } } = await supabase.auth.getUser();
      const creatorName = await getLoggedInUserName();
      const chosenCategories = form.allServices ? categories : form.categories;
      const { data: tariff, error: tariffError } = await supabase.from('partner_tariffs').insert({
        company_id: companyId,
        client_id: client.id,
        name: form.name.trim() || `${client.name} tariff`,
        valid_from: form.validFrom,
        valid_to: form.validTo,
        all_services: form.allServices,
        categories: form.allServices ? [] : form.categories,
        partner_markup_snapshot: Number(client.markup_percentage) || 0,
        tenant_profile_snapshot: companyProfile || {},
        status: 'draft',
        created_by: user?.id,
        created_by_name: creatorName
      }).select().single();
      if (tariffError) throw tariffError;

      createdTariffId = tariff.id;
      let itemQuery = supabase.from('library_items')
        .select('*')
        .eq('company_id', companyId).eq('is_active', true);
      if (!form.allServices) itemQuery = itemQuery.in('category', chosenCategories);
      const { data: items, error: itemError } = await itemQuery.order('name');
      if (itemError) throw itemError;
      const partnerItems = (items || []).filter((item) => !isPartnerExcludedCategory(item.category));
      const itemIds = partnerItems.map((item) => item.id);
      const [{ data: rates, error: ratesError }, { data: suppliers, error: suppliersError }] = await Promise.all([
        itemIds.length ? supabase.from('item_rates').select('*').in('item_id', itemIds) : Promise.resolve({ data: [], error: null }),
        itemIds.length ? supabase.from('suppliers').select('id, name').in('id', [...new Set(partnerItems.map((item) => item.supplier_id).filter(Boolean))]) : Promise.resolve({ data: [], error: null })
      ]);
      if (ratesError) throw ratesError;
      if (suppliersError) throw suppliersError;
      let carRates = [];
      if (itemIds.length) {
        const { data, error } = await supabase.from('car_rental_rates').select('*').in('item_id', itemIds);
        if (error && !/does not exist|schema cache/i.test(error.message || '')) throw error;
        carRates = data || [];
      }
      const supplierNames = new Map((suppliers || []).map((supplier) => [supplier.id, supplier.name]));
      const companyName = companyProfile?.legal_name || '';
      const rateByItem = new Map();
      (rates || []).forEach((rate) => {
        if (!rateByItem.has(rate.item_id)) rateByItem.set(rate.item_id, []);
        rateByItem.get(rate.item_id).push(rate);
      });
      const snapshotRows = partnerItems.map((item) => {
        const supplierName = supplierNames.get(item.supplier_id) || '';
        const hideSupplier = /^(transfers|activities \/ tours)$/i.test(item.category) && supplierName.toLowerCase() !== companyName.toLowerCase();
        const itemRates = (rateByItem.get(item.id) || []).map((rate) => safeRateSnapshot(rate, client.markup_percentage));
        return {
          tariff_id: tariff.id,
          company_id: companyId,
          client_id: client.id,
          item_id: item.id,
          category: item.category,
          item_snapshot: {
            name: item.name,
            category: item.category,
            sub_category: item.sub_category,
            identifier_code: item.identifier_code || '',
            destination_region: item.destination_region || item.location || '',
            description: item.description,
            location: item.location,
            currency: item.currency || 'ZAR',
            pricing_model: item.pricing_model || 'per_person',
            max_occupancy: item.max_occupancy,
            child_age_ranges: item.child_age_ranges || [],
            meal_type: item.meal_type || '',
            menu_type: item.menu_type || '',
            ticket_type: item.ticket_type || '',
            transfer_type: item.transfer_type || '',
            train_cabin_name: item.train_cabin_name || '',
            flight_number: item.flight_number || '',
            airline_name: item.airline_name || '',
            inclusions: item.inclusions || item.inclusions_text || '',
            exclusions: item.exclusions || item.exclusions_text || '',
            terms_and_conditions: item.terms_and_conditions || item.terms_conditions || item.terms || '',
            supplier_name: hideSupplier ? '' : supplierName,
            rates: item.category === 'Car Rental'
              ? carRates.filter((rate) => rate.item_id === item.id).map((rate) => ({
                vehicle_group: rate.vehicle_group,
                vehicle_name: rate.vehicle_name,
                rate_code: rate.rate_code,
                kms_unlimited: rate.kms_unlimited,
                kms_included: rate.kms_included,
                rate_basis: rate.rate_basis,
                max_passengers: rate.max_passengers,
                min_days: rate.min_days,
                max_days: rate.max_days,
                price: applyMarkup(rate.price, client.markup_percentage),
                valid_from: rate.valid_from,
                valid_to: rate.valid_to,
                currency: rate.currency || item.currency || 'ZAR'
              }))
              : itemRates
          }
        };
      });
      if (snapshotRows.length) {
        const { error: snapshotError } = await supabase.from('partner_tariff_items').insert(snapshotRows);
        if (snapshotError) throw snapshotError;
      }
      const { error: activateError } = await supabase.from('partner_tariffs').update({ status: 'active' }).eq('id', tariff.id).eq('company_id', companyId);
      if (activateError) throw activateError;
      showToast(`Tariff published with ${snapshotRows.length} services`, 'success');
      resetForm();
      await loadWorkspace();
    } catch (error) {
      if (createdTariffId) await supabase.from('partner_tariffs').delete().eq('id', createdTariffId).eq('company_id', companyId);
      showToast(error.message || 'Could not create tariff', 'error');
    } finally {
      setSaving(false);
    }
  };

  const setTariffStatus = async (tariff, status) => {
    const { error } = await supabase.from('partner_tariffs').update({ status }).eq('id', tariff.id).eq('company_id', companyId);
    if (error) showToast(error.message || 'Could not update tariff', 'error');
    else await loadWorkspace();
  };

  const exportTariff = async (tariff, format) => {
    const { data: rows, error } = await supabase.from('partner_tariff_items').select('category,item_snapshot').eq('tariff_id', tariff.id).order('category');
    if (error) { showToast(error.message || 'Could not load tariff services', 'error'); return; }
    const html = tariffDocument(tariff, rows || [], companyProfile);
    const filename = (tariff.name || 'tariff').replace(/[^a-z0-9_-]+/gi, '-').toLowerCase();
    if (format === 'pdf') {
      const printWindow = window.open('', '_blank', 'width=900,height=700');
      if (!printWindow) { showToast('Allow pop-ups to export the tariff as PDF', 'warning'); return; }
      printWindow.document.write(html.replace('</body>', '<script>window.onload=()=>setTimeout(()=>window.print(),250)</script></body>'));
      printWindow.document.close();
    } else if (format === 'word') {
      downloadContent(html, `${filename}.doc`, 'application/msword');
    } else {
      downloadContent(html, `${filename}.xls`, 'application/vnd.ms-excel');
    }
  };

  const invitePartnerAdmin = async (event) => {
    event.preventDefault();
    const client = clients.find((row) => row.id === inviteForm.clientId);
    if (!client || !inviteForm.email.trim()) return;
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const { data: invitation, error } = await supabase.from('partner_portal_invitations').insert({
        company_id: companyId,
        client_id: client.id,
        email: inviteForm.email.trim().toLowerCase(),
        role: 'partner_admin',
        invited_by: user?.id
      }).select('invite_code').single();
      if (error) throw error;
      const inviteUrl = `${window.location.origin}/partner-register?invite=${invitation.invite_code}`;
      await navigator.clipboard?.writeText(inviteUrl);
      setInviteForm({ clientId: '', email: '' });
      showToast('Partner administrator invitation created; link copied', 'success');
    } catch (error) {
      showToast(error.message || 'Could not create invitation', 'error');
    }
  };

  const viewPartnerQuotation = async (quote) => {
    const itemIds = [...new Set((quote.quotation_data?.days || []).flatMap((day) => (day.services || []).map((service) => service.item_id).filter(Boolean)))];
    if (!itemIds.length) { setViewingQuote(quote); return; }
    const { data: items, error: itemError } = await supabase.from('library_items').select('id,supplier_id').eq('company_id', companyId).in('id', itemIds);
    if (itemError) { showToast(itemError.message || 'Could not load supplier details', 'error'); return; }
    const supplierIds = [...new Set((items || []).map((item) => item.supplier_id).filter(Boolean))];
    const { data: suppliers, error: supplierError } = supplierIds.length
      ? await supabase.from('suppliers').select('id,name').eq('company_id', companyId).in('id', supplierIds)
      : { data: [], error: null };
    if (supplierError) { showToast(supplierError.message || 'Could not load supplier details', 'error'); return; }
    const supplierByItem = new Map((items || []).map((item) => [item.id, (suppliers || []).find((supplier) => supplier.id === item.supplier_id)?.name || '']));
    const quotationData = {
      ...quote.quotation_data,
      days: (quote.quotation_data?.days || []).map((day) => ({
        ...day,
        services: (day.services || []).map((service) => ({
          ...service,
          supplier_name: supplierByItem.get(service.item_id) || service.supplier_name || ''
        }))
      }))
    };
    setViewingQuote({ ...quote, quotation_data: quotationData });
  };

  const formatDate = (value) => value ? new Date(`${value}T00:00:00`).toLocaleDateString() : '—';
  const actorName = (tariff) => tariff.created_by_name || tariff.created_by || 'Tenant user';

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h1 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', margin: 0 }}><Tag size={22} color="#0d7478" /> Tariffs</h1>
          <p style={{ color: '#64748b', margin: '0.35rem 0 0', fontSize: '0.9rem' }}>Partner price lists and partner-created quotations.</p>
        </div>
        <button className="primary-btn" style={{ width: 'auto', display: 'inline-flex', alignItems: 'center', gap: '0.45rem' }} onClick={() => setOpenForm(true)}><Plus size={17} /> New tariff</button>
      </div>

      <div className="tab-bar" style={{ margin: '1.25rem 0' }}>
        {[['tariffs', 'Tariffs'], ['quotations', 'Partner quotations'], ['access', 'Partner access']].map(([id, label]) => (
          <button type="button" key={id} className={`tab-btn ${tab === id ? 'active' : ''}`} onClick={() => setTab(id)}>{label}</button>
        ))}
      </div>

      {tab === 'tariffs' && <section className="admin-card">
        {loading ? <p>Loading tariffs...</p> : tariffs.length === 0 ? <p style={{ color: '#64748b' }}>No tariffs yet. Create a price list for a travel agency to begin.</p> : (
          <div style={{ overflowX: 'auto' }}><table className="admin-table"><thead><tr><th>Tariff</th><th>Partner</th><th>Validity</th><th>Status</th><th>Created by</th><th>Created</th><th>Exports</th></tr></thead><tbody>
            {tariffs.map((tariff) => <tr key={tariff.id}>
              <td><strong>{tariff.name}</strong><div style={{ color: '#64748b', fontSize: '0.78rem' }}>{tariff.all_services ? 'All services' : tariff.categories.join(', ')}</div></td>
              <td>{tariff.clients?.name || '—'}</td><td>{formatDate(tariff.valid_from)} – {formatDate(tariff.valid_to)}</td>
              <td><SearchableSelect className="sidebar-select" value={tariff.status} onChange={(event) => setTariffStatus(tariff, event.target.value)}><option value="draft">Draft</option><option value="active">Active</option><option value="expired">Expired</option><option value="archived">Archived</option></SearchableSelect></td>
              <td>{actorName(tariff)}</td><td>{new Date(tariff.created_at).toLocaleString()}</td>
              <td><div style={{ display: 'flex', gap: '0.35rem' }}>
                <button className="icon-btn outline" title="Download PDF" onClick={() => exportTariff(tariff, 'pdf')}><Download size={15} /> PDF</button>
                <button className="icon-btn outline" title="Download Word" onClick={() => exportTariff(tariff, 'word')}><FileText size={15} /> Word</button>
                <button className="icon-btn outline" title="Download Excel" onClick={() => exportTariff(tariff, 'excel')}><FileSpreadsheet size={15} /> Excel</button>
              </div></td>
            </tr>)}
          </tbody></table></div>
        )}
      </section>}

      {tab === 'quotations' && <section className="admin-card">
        {loading ? <p>Loading quotations...</p> : quotations.length === 0 ? <p style={{ color: '#64748b' }}>Partner quotations will appear here when submitted.</p> : (
          <div style={{ overflowX: 'auto' }}><table className="admin-table"><thead><tr><th>Quotation</th><th>Partner</th><th>Travel dates</th><th>Travellers</th><th>Tariff</th><th>Status</th><th>Created</th><th>Review</th></tr></thead><tbody>
            {quotations.map((quote) => <tr key={quote.id}>
              <td><button type="button" className="icon-btn outline" onClick={() => viewPartnerQuotation(quote)}><strong>{quote.reference_number || quote.title}</strong></button><div>{quote.title}</div></td><td>{quote.clients?.name || '—'}</td>
              <td>{formatDate(quote.travel_start_date)} – {formatDate(quote.travel_end_date)}</td><td>{Number(quote.num_adults) + Number(quote.num_children)} ({quote.num_adults} adult, {quote.num_children} child)</td><td>{quote.partner_tariffs?.name || '—'}</td>
              <td>{quote.status.replaceAll('_', ' ')}</td><td>{new Date(quote.created_at).toLocaleString()}</td>
              <td><SearchableSelect className="sidebar-select" value={quote.status} onChange={async (event) => {
                const { error } = await supabase.from('partner_quotations').update({ status: event.target.value }).eq('id', quote.id).eq('company_id', companyId);
                if (error) showToast(error.message || 'Could not update quotation', 'error'); else loadWorkspace();
              }}><option value="submitted">Submitted</option><option value="booking_requested">Booking requested</option><option value="reviewing">Reviewing</option><option value="accepted">Accepted</option><option value="declined">Declined</option></SearchableSelect></td>
            </tr>)}
          </tbody></table></div>
        )}
      </section>}

      {viewingQuote && <div className="modal-overlay" onClick={() => setViewingQuote(null)}><section className="modal-content" style={{ width: 'min(920px, 95vw)', maxHeight: '90vh', overflow: 'auto' }} onClick={(event) => event.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '1rem', marginBottom: '1rem' }}>
          <div><h2 style={{ margin: 0 }}>{viewingQuote.title}</h2><p style={{ margin: '.3rem 0 0', color: '#64748b' }}>{viewingQuote.reference_number} · {viewingQuote.clients?.name || 'Partner'} · {viewingQuote.status.replaceAll('_', ' ')}</p></div>
          <button type="button" className="icon-btn outline" onClick={() => setViewingQuote(null)}>Close</button>
        </div>
        <p><strong>Travel:</strong> {formatDate(viewingQuote.travel_start_date)} – {formatDate(viewingQuote.travel_end_date)} · <strong>Party:</strong> {viewingQuote.num_adults} adult(s), {viewingQuote.num_children} child(ren)</p>
        {Array.isArray(viewingQuote.travellers) && viewingQuote.travellers.length > 0 && <p><strong>Travellers:</strong> {viewingQuote.travellers.map((traveller) => `${traveller.name || ''} ${traveller.surname || ''} (${traveller.age || '—'})`.trim()).join(', ')}</p>}
        {(viewingQuote.quotation_data?.days || []).map((day, index) => <section key={`${day.date}-${index}`} style={{ marginTop: '1rem' }}>
          <h3 style={{ fontSize: '1rem', margin: '0 0 .5rem' }}>{formatDate(day.date)}</h3>
          <div style={{ overflowX: 'auto' }}><table className="admin-table"><thead><tr><th>Service</th><th>Category</th><th>Supplier</th><th>Unit price</th><th>Total</th></tr></thead><tbody>{(day.services || []).map((service, serviceIndex) => <tr key={`${service.item_id}-${serviceIndex}`}>
            <td>{service.name}</td><td>{service.category}</td><td>{service.supplier_name || '—'}</td><td>{service.currency} {Number(service.unit_sell_adult || 0).toFixed(2)}</td><td><strong>{service.currency} {Number(service.total_sell || 0).toFixed(2)}</strong></td>
          </tr>)}</tbody></table></div>
        </section>)}
        {Object.entries(viewingQuote.quotation_data?.totals || {}).map(([currency, total]) => <p key={currency} style={{ textAlign: 'right', fontSize: '1.05rem' }}><strong>Total {currency} {Number(total || 0).toFixed(2)}</strong></p>)}
        {viewingQuote.status === 'booking_requested' && <p style={{ padding: '.75rem', background: '#eaf5f2', color: '#125c56' }}>This partner has requested booking. Review the quoted services before accepting or declining.</p>}
      </section></div>}

      {tab === 'access' && <div style={{ display: 'grid', gap: '1.25rem' }}>
        <section className="admin-card">
          <h2 style={{ fontSize: '1.05rem', margin: '0 0 0.5rem', color: '#0d7478' }}>Partner Portal Access & Login</h2>
          <p style={{ color: '#64748b', margin: '0 0 1rem', fontSize: '0.88rem' }}>
            Registered travel agency partners log into the Partner Portal to view active tariffs, build client quotations, and request bookings.
          </p>
          <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem', padding: '0.85rem 1rem', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '6px' }}>
            <span style={{ fontWeight: 600, fontSize: '0.88rem', color: '#334155' }}>Partner Portal URL:</span>
            <code style={{ background: '#e2e8f0', padding: '0.3rem 0.6rem', borderRadius: '4px', fontSize: '0.88rem' }}>{window.location.origin}/partner</code>
            <a href="/partner" target="_blank" rel="noopener noreferrer" className="primary-btn" style={{ textDecoration: 'none', padding: '0.45rem 0.85rem', width: 'auto', display: 'inline-flex', alignItems: 'center', gap: '0.45rem', fontSize: '0.85rem' }}>
              <ExternalLink size={15} /> Open Partner Portal
            </a>
          </div>
        </section>

        <section className="admin-card">
          <h2 style={{ fontSize: '1.05rem', margin: '0 0 0.75rem' }}>Invite a partner administrator</h2>
          <p style={{ color: '#64748b', margin: '0 0 1rem', fontSize: '0.88rem' }}>The partner admin can invite additional users from their portal. The invitation link is copied after it is created.</p>
          <form onSubmit={invitePartnerAdmin} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: '0.75rem', maxWidth: '760px' }}>
            <SearchableSelect
              className="sidebar-select"
              required
              value={inviteForm.clientId}
              onChange={(event) => {
                const selectedId = event.target.value;
                const client = clients.find((c) => c.id === selectedId);
                setInviteForm({
                  clientId: selectedId,
                  email: client?.email || ''
                });
              }}
            >
              <option value="">{clients.length ? 'Choose travel agency' : 'No travel agencies found in Clients'}</option>
              {clients.map((client) => (
                <option key={client.id} value={client.id}>
                  {client.name}
                </option>
              ))}
            </SearchableSelect>
            <input className="sidebar-select" type="email" required placeholder="Partner admin email" value={inviteForm.email} onChange={(event) => setInviteForm((prev) => ({ ...prev, email: event.target.value }))} />
            <button className="primary-btn" style={{ width: 'auto', display: 'inline-flex', alignItems: 'center', gap: '0.45rem' }}><Send size={16} /> Create invitation</button>
          </form>
        </section>
      </div>}

      {openForm && <div className="modal-overlay" onClick={resetForm}><section className="modal-content" style={{ width: 'min(680px, 95vw)' }} onClick={(event) => event.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}><h2 style={{ margin: 0 }}>Create partner tariff</h2><button type="button" className="icon-btn outline" onClick={resetForm}>Close</button></div>
        <form onSubmit={createTariff} style={{ display: 'grid', gap: '0.85rem' }}>
          <label className="sidebar-field">Tariff name<input className="sidebar-select" value={form.name} onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))} placeholder="Optional, defaults to partner name" /></label>
          <label className="sidebar-field">Travel agency<SearchableSelect className="sidebar-select" required value={form.clientId} onChange={(event) => setForm((prev) => ({ ...prev, clientId: event.target.value }))}><option value="">{clients.length ? 'Choose one partner' : 'No travel agencies found in Clients'}</option>{clients.map((client) => <option key={client.id} value={client.id}>{client.name} ({Number(client.markup_percentage) || 0}% tenant partner markup)</option>)}</SearchableSelect></label>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '0.75rem' }}>
            <label className="sidebar-field">Valid from<input className="sidebar-select" type="date" required value={form.validFrom} onChange={(event) => setForm((prev) => ({ ...prev, validFrom: event.target.value }))} /></label>
            <label className="sidebar-field">Valid to<input className="sidebar-select" type="date" required value={form.validTo} onChange={(event) => setForm((prev) => ({ ...prev, validTo: event.target.value }))} /></label>
          </div>
          <fieldset style={{ border: '1px solid #dbe3e4', padding: '0.75rem', display: 'grid', gap: '0.65rem' }}>
            <legend style={{ padding: '0 0.35rem', fontWeight: 700, color: '#334155' }}>Services included</legend>
            <label style={{ display: 'flex', gap: '0.55rem', alignItems: 'center' }}>
              <input type="radio" name="tariff-service-scope" checked={form.allServices} onChange={() => setForm((prev) => ({ ...prev, allServices: true, categories: [] }))} />
              All Library Item categories
            </label>
            <label style={{ display: 'flex', gap: '0.55rem', alignItems: 'center' }}>
              <input type="radio" name="tariff-service-scope" checked={!form.allServices} onChange={() => setForm((prev) => ({ ...prev, allServices: false }))} />
              Select specific categories
            </label>
            {!form.allServices && <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: '0.45rem', maxHeight: '220px', overflow: 'auto', padding: '0.35rem', borderTop: '1px solid #e2e8f0' }}>
              {categories.map((category) => <label key={category} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}><input type="checkbox" checked={form.categories.includes(category)} onChange={(event) => setForm((prev) => ({ ...prev, categories: event.target.checked ? [...prev.categories, category] : prev.categories.filter((value) => value !== category) }))} />{category}</label>)}
              {categories.length === 0 && <span style={{ color: '#64748b' }}>No active Library Item categories are available.</span>}
            </div>}
          </fieldset>
          <p style={{ margin: 0, color: '#64748b', fontSize: '0.82rem' }}>Prices are snapshotted from active Library Items using the selected partner’s assigned markup. Supplier costs and contracts are not included in the partner snapshot.</p>
          <button className="primary-btn" disabled={saving}>{saving ? 'Creating tariff...' : 'Publish tariff'}</button>
        </form>
      </section></div>}
    </div>
  );
};
