import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, Backpack } from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useToast } from '../context/ToastContext';

const dateLabel = (iso) => iso ? new Date(`${iso}T00:00:00`).toLocaleDateString('en-ZA', { day: '2-digit', month: 'short', year: 'numeric' }) : '';

export const PackageView = () => {
  const { packageId } = useParams();
  const navigate = useNavigate();
  const { showToast } = useToast();
  const [pkg, setPkg] = useState(null);
  const [days, setDays] = useState([]);
  const [periods, setPeriods] = useState([]);
  const [paxOptions, setPaxOptions] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [packageResult, periodsResult, paxResult, daysResult] = await Promise.all([
        supabase.from('packages').select('*').eq('id', packageId).single(),
        supabase.from('package_validity_periods').select('*').eq('package_id', packageId).order('valid_from'),
        supabase.from('package_pax_options').select('*').eq('package_id', packageId).order('adults'),
        supabase.from('package_days').select('*').eq('package_id', packageId).order('day_number')
      ]);
      if (packageResult.error) throw packageResult.error;
      if (periodsResult.error) throw periodsResult.error;
      if (paxResult.error) throw paxResult.error;
      if (daysResult.error) throw daysResult.error;
      const packageDays = daysResult.data || [];
      const dayIds = packageDays.map((day) => day.id);
      const itemsResult = dayIds.length
        ? await supabase.from('package_day_items').select('*').in('package_day_id', dayIds).order('sort_order')
        : { data: [], error: null };
      if (itemsResult.error) throw itemsResult.error;
      const itemsByDay = new Map();
      (itemsResult.data || []).forEach((item) => itemsByDay.set(item.package_day_id, [...(itemsByDay.get(item.package_day_id) || []), item]));
      setPkg(packageResult.data);
      setPeriods(periodsResult.data || []);
      setPaxOptions(paxResult.data || []);
      setDays(packageDays.map((day) => ({ ...day, services: itemsByDay.get(day.id) || [] })));
    } catch (error) {
      showToast(`Could not load package: ${error.message}`, 'error');
    } finally {
      setLoading(false);
    }
  }, [packageId, showToast]);

  useEffect(() => { load(); }, [load]);

  const currencies = [...new Set(days.flatMap((day) => day.services)
    .filter((service) => service.is_included !== false)
    .map((service) => service.currency_code || 'ZAR'))];

  return <div className="super-admin-page package-view-page">
    <header className="page-header">
      <div className="header-title"><Backpack className="header-icon" /><div><h1>{pkg?.name || 'Package'}</h1><p>Read-only package details</p></div></div>
      <button className="secondary-btn" onClick={() => navigate('/packages')}><ArrowLeft size={16} /> Packages</button>
    </header>
    {loading ? <div className="admin-table-container package-view-loading">Loading package...</div> : !pkg ? <div className="admin-table-container package-view-loading">Package not found.</div> : <>
      <section className="package-view-summary">
        {pkg.cover_image_url && <img className="package-view-cover" src={pkg.cover_image_url} alt={`${pkg.name} cover`} />}
        <div className="package-view-facts">
          {pkg.description && <p>{pkg.description}</p>}
          <div><strong>Validity</strong><span>{periods.length ? periods.map((period) => `${dateLabel(period.valid_from)} – ${dateLabel(period.valid_to)}`).join('; ') : 'Not set'}</span></div>
          <div><strong>Passenger options</strong><span>{paxOptions.length ? paxOptions.map((option) => `${option.adults}A${option.children ? ` + ${option.children}C` : ''}`).join(', ') : 'Not set'}</span></div>
          <div><strong>Library availability</strong><span>{pkg.is_available_in_library ? 'Available for itinerary quotes' : 'Private package'}</span></div>
          <div><strong>Currencies</strong><span>{currencies.length ? currencies.join(', ') : 'Not set'}</span></div>
        </div>
        {(pkg.gallery_image_urls || []).length > 0 && <div className="package-view-gallery">{pkg.gallery_image_urls.map((url, index) => <img key={`${url}-${index}`} src={url} alt={`${pkg.name} gallery ${index + 1}`} />)}</div>}
      </section>
      {days.map((day, index) => <section className="package-view-day" key={day.id}>
        <header><h2>Day {index + 1}</h2>{day.notes && <p>{day.notes}</p>}</header>
        {day.services.length ? <div className="package-view-services">
          {day.services.map((service) => <div className="package-view-service" key={service.id}>
            <div><strong>{service.item_name}</strong><span>{service.category || 'Service'}{service.supplier_name ? ` · ${service.supplier_name}` : ''}{service.is_included === false ? ' · Optional' : ''}</span>{service.notes && <small>{service.notes}</small>}</div>
            <span>{service.currency_code} {Number(service.unit_price || 0).toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
          </div>)}
        </div> : <p className="package-view-empty">No services added to this day.</p>}
      </section>)}
      {(pkg.inclusions || pkg.exclusions) && <section className="package-view-day">
        <header><h2>Inclusions &amp; exclusions</h2></header>
        {pkg.inclusions && <><h3>Inclusions</h3><p>{pkg.inclusions}</p></>}
        {pkg.exclusions && <><h3>Exclusions</h3><p>{pkg.exclusions}</p></>}
      </section>}
      {pkg.terms_and_conditions && <section className="package-view-day">
        <header><h2>Terms &amp; conditions</h2></header><p>{pkg.terms_and_conditions}</p>
      </section>}
      {!days.length && <div className="package-view-day package-view-empty">No itinerary days have been added to this package.</div>}
    </>}
  </div>;
};
