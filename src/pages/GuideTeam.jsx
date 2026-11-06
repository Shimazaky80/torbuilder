import { useState, useEffect, useCallback, useRef } from 'react';
import SearchableSelect from '../components/SearchableSelect';
import { supabase } from '../lib/supabase';
import { useToast } from '../context/ToastContext';
import { useListRowLimit } from '../hooks/useListRowLimit';
import { fetchDestinationCatalog } from '../lib/destinationFilter';
import { guideMemberName, guideUpliftPercent } from '../lib/guideRoster';
import ConfirmDialog from '../components/ConfirmDialog';
import { useConfirm } from '../hooks/useConfirm';
import { scopeCompanyId } from '../lib/tenantScope';
import {
  UserCog,
  Search,
  Plus,
  Edit3,
  Trash2,
  X,
  Mail,
  Phone,
  MapPin,
  Building2,
  Percent,
  Archive,
  RotateCcw,
  IdCard
} from 'lucide-react';

/* The guide team is a DIRECTORY, not a price list. A guide's money still lives
   on the destination's Guide library item, where one contract figure serves a
   hundred guides; what is typed here is who the person is and the one number
   that says they cost more than the standard. */

const emptyForm = {
  firstName: '',
  lastName: '',
  dateOfBirth: '',
  nationalId: '',
  passportNumber: '',
  taxNumber: '',
  licenceNumber: '',
  email: '',
  phone: '',
  city: '',
  destinationArea: '',
  supplierId: '',
  upliftPercent: '',
  isActive: true,
  notes: ''
};

const formOf = (member) => ({
  firstName: member.first_name || '',
  lastName: member.last_name || '',
  dateOfBirth: member.date_of_birth || '',
  nationalId: member.national_id || '',
  passportNumber: member.passport_number || '',
  taxNumber: member.tax_number || '',
  licenceNumber: member.licence_number || '',
  email: member.email || '',
  phone: member.phone || '',
  city: member.city || '',
  destinationArea: member.destination_area || '',
  supplierId: member.supplier_id || '',
  upliftPercent: Number(member.rate_uplift_percent) > 0 ? String(member.rate_uplift_percent) : '',
  isActive: member.is_active !== false,
  notes: member.notes || ''
});

/* A NUMERIC(8,4) column can hand back "10.0000"; the operator typed 10. */
const percentLabel = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return '0';
  return String(Math.round(parsed * 100) / 100);
};

const Field = ({ label, children }) => (
  <div>
    <label style={{ fontSize: '0.8rem', fontWeight: 600, color: '#475569', display: 'block', marginBottom: '0.25rem' }}>
      {label}
    </label>
    {children}
  </div>
);

const SectionTitle = ({ children }) => (
  <h3 style={{ fontSize: '0.75rem', fontWeight: 800, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.06em', margin: '1.5rem 0 0.75rem', borderBottom: '1px solid #e2e8f0', paddingBottom: '0.35rem' }}>
    {children}
  </h3>
);

export const GuideTeam = () => {
  const [guides, setGuides] = useState([]);
  const [confirmDialog, confirm] = useConfirm();
  const [loading, setLoading] = useState(true);
  const [fetching, setFetching] = useState(false);
  const [totalGuides, setTotalGuides] = useState(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('All');
  const [showForm, setShowForm] = useState(false);
  const [editingGuide, setEditingGuide] = useState(null);
  const [suppliers, setSuppliers] = useState([]);
  const [destinations, setDestinations] = useState([]);
  const [rosterMissing, setRosterMissing] = useState(false);
  const searchTimeoutRef = useRef(null);
  const { limit: pageSize } = useListRowLimit();
  const { showToast } = useToast();

  const [form, setForm] = useState(emptyForm);

  const companyIdRef = useRef(null);

  const resolveCompany = useCallback(async () => {
    if (companyIdRef.current) return companyIdRef.current;
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;
    const { data: profile } = await supabase
      .from('profiles')
      .select('company_id')
      .eq('id', user.id)
      .maybeSingle();
    companyIdRef.current = scopeCompanyId(profile?.company_id) || null;
    return companyIdRef.current;
  }, []);

  const fetchGuides = useCallback(async ({ offset = 0, append = false } = {}) => {
    setFetching(true);
    try {
      const companyId = await resolveCompany();
      if (!companyId) {
        setGuides([]);
        setTotalGuides(0);
        setLoading(false);
        setFetching(false);
        return;
      }

      const esc = (t) => t.replace(/[\\%_]/g, (m) => '\\' + m);
      const term = (search || '').replace(/[,()]/g, ' ').trim();
      let query = supabase
        .from('guide_members')
        .select('*', { count: 'exact' })
        .eq('company_id', companyId);

      if (term) {
        const t = esc(term);
        query = query.or(`first_name.ilike.%${t}%,last_name.ilike.%${t}%,email.ilike.%${t}%,phone.ilike.%${t}%,national_id.ilike.%${t}%,licence_number.ilike.%${t}%,city.ilike.%${t}%,destination_area.ilike.%${t}%`);
      }

      const { data, count, error } = await query
        .order('first_name')
        .order('last_name')
        .range(offset, offset + pageSize - 1);

      if (error) throw error;
      setRosterMissing(false);
      setGuides((prev) => {
        if (!append) return data || [];
        const merged = new Map([...prev.map((g) => [g.id, g]), ...(data || []).map((g) => [g.id, g])]);
        return Array.from(merged.values());
      });
      setTotalGuides(count ?? (data || []).length);
    } catch (err) {
      /* A workspace that has not applied the guide_members migration yet cannot
         select the table at all. That is not an error to shout about — the page
         says what is missing and everything else keeps working. */
      if (/guide_members/.test(String(err.message))) {
        setRosterMissing(true);
      } else {
        showToast(err.message, 'error');
      }
      setGuides([]);
      setTotalGuides(0);
    } finally {
      setLoading(false);
      setFetching(false);
    }
  }, [search, pageSize, resolveCompany, showToast]);

  useEffect(() => {
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    searchTimeoutRef.current = setTimeout(() => fetchGuides(), 350);
    return () => {
      if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    };
  }, [search, fetchGuides]);

  useEffect(() => {
    const loadSupporting = async () => {
      const companyId = await resolveCompany();
      if (!companyId) return;
      const [{ data }, catalog] = await Promise.all([
        supabase.from('suppliers').select('id, name').eq('company_id', companyId).order('name'),
        fetchDestinationCatalog(companyId)
      ]);
      setSuppliers(data || []);
      setDestinations(catalog.destinations || []);
    };
    loadSupporting().catch(() => {});
  }, [resolveCompany]);

  const supplierName = (id) => suppliers.find((s) => s.id === id)?.name || '';

  const openAdd = () => {
    setEditingGuide(null);
    setForm(emptyForm);
    setShowForm(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const openEdit = (guide) => {
    setEditingGuide(guide);
    setForm(formOf(guide));
    setShowForm(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const closeForm = () => {
    setShowForm(false);
    setEditingGuide(null);
    setForm(emptyForm);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const firstName = form.firstName.trim();
    const lastName = form.lastName.trim();
    if (!firstName && !lastName) {
      showToast('A guide needs at least a first name or a surname', 'warning');
      return;
    }
    const uplift = form.upliftPercent === '' ? 0 : parseFloat(form.upliftPercent);
    if (!Number.isFinite(uplift) || uplift < 0) {
      showToast('Uplift must be a positive percentage (blank means the standard rate)', 'warning');
      return;
    }
    const email = form.email.trim();
    if (email && !/^\S+@\S+\.\S+$/.test(email)) {
      showToast('That email address does not look right', 'warning');
      return;
    }

    try {
      const companyId = await resolveCompany();
      if (!companyId) {
        showToast('No active company found for your user profile', 'error');
        return;
      }

      const payload = {
        company_id: companyId,
        first_name: firstName,
        last_name: lastName || null,
        date_of_birth: form.dateOfBirth || null,
        national_id: form.nationalId.trim() || null,
        passport_number: form.passportNumber.trim() || null,
        tax_number: form.taxNumber.trim() || null,
        licence_number: form.licenceNumber.trim() || null,
        email: email || null,
        phone: form.phone.trim() || null,
        city: form.city.trim() || null,
        destination_area: form.destinationArea.trim() || null,
        supplier_id: form.supplierId || null,
        rate_uplift_percent: uplift,
        is_active: form.isActive,
        notes: form.notes.trim() || null
      };

      if (editingGuide) {
        const { error } = await supabase.from('guide_members').update(payload).eq('id', editingGuide.id);
        if (error) throw error;
        showToast(`${firstName || lastName} updated`, 'success');
      } else {
        const { error } = await supabase.from('guide_members').insert([payload]);
        if (error) throw error;
        showToast(`${firstName || lastName} added to the guide team`, 'success');
      }
      closeForm();
      fetchGuides();
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  const toggleActive = async (guide) => {
    const retiring = guide.is_active !== false;
    try {
      const { error } = await supabase
        .from('guide_members')
        .update({ is_active: !retiring })
        .eq('id', guide.id);
      if (error) throw error;
      setGuides((prev) => prev.map((g) => (g.id === guide.id ? { ...g, is_active: !retiring } : g)));
      showToast(retiring
        ? `${guideMemberName(guide)} retired — past itineraries still name them`
        : `${guideMemberName(guide)} is bookable again`, 'success');
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  const handleDelete = async (guide) => {
    const ok = await confirm({
      title: 'Delete this guide?',
      message: `"${guideMemberName(guide)}" will be permanently removed from the directory.`,
      detail: 'Retire them instead to keep them out of the picker while existing lines still name them. Deleting does not change any figure already invoiced — each line keeps the identity snapshot it was priced with.',
      confirmLabel: 'Delete guide',
      destructive: true
    });
    if (!ok) return;
    try {
      const { error } = await supabase.from('guide_members').delete().eq('id', guide.id);
      if (error) throw error;
      setGuides((prev) => prev.filter((g) => g.id !== guide.id));
      setTotalGuides((prev) => (prev == null ? prev : Math.max(0, prev - 1)));
      showToast('Guide deleted', 'success');
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  const visibleGuides = guides.filter((g) => (
    statusFilter === 'All'
      || (statusFilter === 'Active' && g.is_active !== false)
      || (statusFilter === 'Retired' && g.is_active === false)
  ));

  const activeCount = guides.filter((g) => g.is_active !== false).length;
  const premiumCount = guides.filter((g) => guideUpliftPercent(g) > 0).length;

  const filterTabs = [
    { id: 'All', label: 'All' },
    { id: 'Active', label: 'Bookable' },
    { id: 'Retired', label: 'Retired' }
  ];

  return (
    <div className="super-admin-page" style={{ paddingBottom: '4rem' }}>
      <header className="page-header" style={{ marginBottom: '1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: '1rem' }}>
        <div className="header-title">
          <UserCog className="header-icon" />
          <div>
            <h1>Guide Team</h1>
            <p>The people who guide — their details for accounts and tax, and what each costs above the destination rate</p>
          </div>
        </div>
        <button
          className="primary-btn"
          style={{ width: 'auto', padding: '0.625rem 1.25rem', background: '#0d7478', display: 'flex', alignItems: 'center', gap: '0.4rem' }}
          onClick={openAdd}
        >
          <Plus size={18} /> Add Guide
        </button>
      </header>

      <div style={{ background: '#f0fdfa', border: '1px solid #99f6e4', borderRadius: '12px', padding: '0.9rem 1.1rem', marginBottom: '1.5rem', fontSize: '0.85rem', color: '#134e4a', maxWidth: '70rem' }}>
        <strong>Guide prices stay on the Guide item.</strong> One destination rate covers every guide and you enter it once; a guide listed here only carries the percentage they cost <em>above</em> that rate. A premium guide is a cost line — it never changes what the clients are sold for, and it never touches a guide&apos;s lunch or bed.
      </div>

      {!rosterMissing && guides.length > 0 && (
        <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', marginBottom: '1.5rem' }}>
          <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '0.9rem 1.25rem', boxShadow: '0 2px 4px rgba(0,0,0,0.04)' }}>
            <span style={{ fontSize: '0.72rem', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Guides</span>
            <div style={{ fontSize: '1.4rem', fontWeight: 800, color: '#1e293b' }}>{totalGuides ?? guides.length}</div>
          </div>
          <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '0.9rem 1.25rem', boxShadow: '0 2px 4px rgba(0,0,0,0.04)' }}>
            <span style={{ fontSize: '0.72rem', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Bookable</span>
            <div style={{ fontSize: '1.4rem', fontWeight: 800, color: '#0d7478' }}>{activeCount}</div>
          </div>
          <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '0.9rem 1.25rem', boxShadow: '0 2px 4px rgba(0,0,0,0.04)' }}>
            <span style={{ fontSize: '0.72rem', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Paid above standard</span>
            <div style={{ fontSize: '1.4rem', fontWeight: 800, color: '#b45309' }}>{premiumCount}</div>
          </div>
        </div>
      )}

      {showForm && !rosterMissing && (
        <div style={{ background: '#fff', borderRadius: '16px', padding: '2rem', border: '1px solid #cbd5e1', boxShadow: '0 10px 25px -5px rgba(0,0,0,0.05)', marginBottom: '2.5rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #e2e8f0', paddingBottom: '1rem', marginBottom: '1.5rem' }}>
            <h2 style={{ fontSize: '1.25rem', fontWeight: 700, color: '#1e293b', margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <UserCog size={22} color="#0d7478" /> {editingGuide ? `Edit Guide: ${guideMemberName(editingGuide)}` : 'Add a Guide'}
            </h2>
            <button onClick={closeForm} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#64748b' }} title="Close form">
              <X size={24} />
            </button>
          </div>

          <form onSubmit={handleSubmit}>
            <SectionTitle>Who they are</SectionTitle>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
              <Field label="First name">
                <input type="text" className="pricing-select" placeholder="John" value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} />
              </Field>
              <Field label="Surname">
                <input type="text" className="pricing-select" placeholder="Michael" value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} />
              </Field>
              <Field label="Date of birth">
                <input type="date" className="pricing-select" value={form.dateOfBirth} onChange={(e) => setForm({ ...form, dateOfBirth: e.target.value })} />
              </Field>
              <Field label="Email">
                <input type="email" className="pricing-select" placeholder="guide@example.com" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
              </Field>
              <Field label="Phone">
                <input type="tel" className="pricing-select" placeholder="+27 82 555 0100" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
              </Field>
            </div>

            <SectionTitle>What accounts and tax need</SectionTitle>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
              <Field label="National ID number">
                <input type="text" className="pricing-select" placeholder="8001015800087" value={form.nationalId} onChange={(e) => setForm({ ...form, nationalId: e.target.value })} />
              </Field>
              <Field label="Passport number">
                <input type="text" className="pricing-select" placeholder="Foreign guides only" value={form.passportNumber} onChange={(e) => setForm({ ...form, passportNumber: e.target.value })} />
              </Field>
              <Field label="Tax number">
                <input type="text" className="pricing-select" placeholder="Tax reference" value={form.taxNumber} onChange={(e) => setForm({ ...form, taxNumber: e.target.value })} />
              </Field>
              <Field label="Guide licence / registration number">
                <input type="text" className="pricing-select" placeholder="Guide Council registration" value={form.licenceNumber} onChange={(e) => setForm({ ...form, licenceNumber: e.target.value })} />
              </Field>
            </div>

            <SectionTitle>Where they work and what they cost</SectionTitle>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
              <Field label="Destination">
                <input
                  type="text"
                  className="pricing-select"
                  list="guide-destination-options"
                  placeholder="e.g. Kruger (Mpumalanga)"
                  value={form.destinationArea}
                  onChange={(e) => setForm({ ...form, destinationArea: e.target.value })}
                />
                <datalist id="guide-destination-options">
                  {destinations.map((name) => <option key={name} value={name} />)}
                </datalist>
              </Field>
              <Field label="City / town">
                <input type="text" className="pricing-select" placeholder="Where they live" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />
              </Field>
              <Field label="Paid through (optional)">
                <SearchableSelect className="pricing-select" value={form.supplierId} onChange={(e) => setForm({ ...form, supplierId: e.target.value })}>
                  <option value="">Directly — freelance guide</option>
                  {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </SearchableSelect>
              </Field>
              <Field label="Uplift above the destination rate (%)">
                <input type="number" min="0" step="0.01" className="pricing-select" placeholder="Blank or 0 = the standard rate" value={form.upliftPercent} onChange={(e) => setForm({ ...form, upliftPercent: e.target.value })} />
              </Field>
              <div style={{ gridColumn: '1 / -1' }}>
                <Field label="Notes">
                  <textarea className="pricing-select" rows="2" placeholder="Languages, specialisms, anything worth remembering" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} style={{ width: '100%', resize: 'vertical' }} />
                </Field>
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginTop: '1.25rem' }}>
              <input id="guide-is-active" type="checkbox" checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} />
              <label htmlFor="guide-is-active" style={{ fontSize: '0.85rem', fontWeight: 600, color: '#475569', cursor: 'pointer' }}>
                Bookable — offer this guide when assigning a line
              </label>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '1.5rem' }}>
              <button type="button" className="secondary-btn" style={{ width: 'auto', padding: '0.625rem 1.5rem' }} onClick={closeForm}>Cancel</button>
              <button type="submit" className="primary-btn" style={{ background: '#0d7478', width: 'auto', padding: '0.625rem 1.5rem' }}>
                {editingGuide ? 'Save changes' : 'Add guide'}
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="admin-table-container">
        <div className="table-header-actions">
          <div className="search-box" style={{ flex: 1, width: 'auto', maxWidth: '520px' }}>
            <Search size={18} color="#94a3b8" />
            <input
              type="text"
              placeholder="Search by name, ID number, licence, destination…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            {filterTabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setStatusFilter(tab.id)}
                style={{
                  padding: '0.5rem 1rem',
                  borderRadius: '8px',
                  border: '1px solid ' + (statusFilter === tab.id ? '#0d7478' : '#e2e8f0'),
                  background: statusFilter === tab.id ? '#0d7478' : '#fff',
                  color: statusFilter === tab.id ? '#fff' : '#475569',
                  fontSize: '0.8rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                  whiteSpace: 'nowrap'
                }}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        <table className="admin-table">
          <thead>
            <tr>
              <th>Guide</th>
              <th>Destination</th>
              <th>Paid through</th>
              <th>Uplift</th>
              <th>For the tax man</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {rosterMissing ? (
              <tr>
                <td colSpan="7" className="text-center" style={{ padding: '3rem', color: '#64748b' }}>
                  <UserCog size={48} style={{ marginBottom: '1rem', opacity: 0.4 }} />
                  <h3 style={{ fontSize: '1.15rem', fontWeight: 700, color: '#1e293b', marginBottom: '0.4rem' }}>The guide directory is not on this workspace yet</h3>
                  <p style={{ maxWidth: '460px', margin: '0 auto', fontSize: '0.85rem' }}>
                    Applying migrations <code>20261246</code> and <code>20261247</code> creates it. Guide pricing works exactly as it does today until then.
                  </p>
                </td>
              </tr>
            ) : loading || fetching ? (
              <tr><td colSpan="7" className="text-center" style={{ padding: '3rem' }}>Loading guides...</td></tr>
            ) : guides.length === 0 && search.trim() === '' ? (
              <tr>
                <td colSpan="7" className="text-center" style={{ padding: '3rem', color: '#64748b' }}>
                  <UserCog size={48} style={{ marginBottom: '1rem', opacity: 0.4 }} />
                  <h3 style={{ fontSize: '1.15rem', fontWeight: 700, color: '#1e293b', marginBottom: '0.4rem' }}>No guides yet</h3>
                  <p style={{ maxWidth: '420px', margin: '0 auto 1.25rem' }}>
                    Add the guides you actually use. Their names then appear when you drop a guide on a day, and the fee carries who was paid.
                  </p>
                  <button className="primary-btn" style={{ width: 'auto', padding: '0.625rem 1.5rem', background: '#0d7478' }} onClick={openAdd}>
                    <Plus size={18} /> Add your first guide
                  </button>
                </td>
              </tr>
            ) : visibleGuides.length === 0 ? (
              <tr>
                <td colSpan="7" className="text-center" style={{ padding: '3rem', color: '#64748b' }}>
                  <Search size={48} style={{ marginBottom: '1rem', opacity: 0.4 }} />
                  <h3>No guides match</h3>
                  <p>Try a different search or filter.</p>
                </td>
              </tr>
            ) : visibleGuides.map((guide) => {
              const uplift = guideUpliftPercent(guide);
              const retired = guide.is_active === false;
              return (
                <tr key={guide.id} style={retired ? { opacity: 0.6 } : undefined}>
                  <td>
                    <div className="company-cell">
                      <div>
                        <span className="company-name">{guideMemberName(guide) || '—'}</span>
                        <span className="company-id" style={{ display: 'flex', flexDirection: 'column', gap: '0.15rem' }}>
                          {guide.email && <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}><Mail size={12} /> {guide.email}</span>}
                          {guide.phone && <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}><Phone size={12} /> {guide.phone}</span>}
                          {!guide.email && !guide.phone && <span>No contact details</span>}
                        </span>
                      </div>
                    </div>
                  </td>
                  <td style={{ maxWidth: '200px' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem', fontSize: '0.85rem', color: '#475569' }}>
                      {guide.destination_area
                        ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}><MapPin size={13} color="#0d7478" /> {guide.destination_area}</span>
                        : <span style={{ color: '#94a3b8' }}>Any destination</span>}
                      {guide.city && <span style={{ color: '#94a3b8', fontSize: '0.78rem' }}>{guide.city}</span>}
                    </div>
                  </td>
                  <td>
                    {guide.supplier_id && supplierName(guide.supplier_id)
                      ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.85rem', color: '#475569' }}><Building2 size={13} color="#863bff" /> {supplierName(guide.supplier_id)}</span>
                      : <span style={{ fontSize: '0.85rem', color: '#64748b' }}>Direct (freelance)</span>}
                  </td>
                  <td>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.85rem', fontWeight: 700, color: uplift > 0 ? '#b45309' : '#94a3b8' }}>
                      <Percent size={12} /> {uplift > 0 ? `+${percentLabel(guide.rate_uplift_percent)}%` : 'Standard'}
                    </span>
                  </td>
                  <td style={{ maxWidth: '240px' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem', fontSize: '0.78rem', color: '#64748b' }}>
                      {guide.national_id && <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}><IdCard size={12} /> {guide.national_id}</span>}
                      {guide.passport_number && <span>Passport {guide.passport_number}</span>}
                      {guide.tax_number && <span>Tax {guide.tax_number}</span>}
                      {guide.licence_number && <span>Licence {guide.licence_number}</span>}
                      {!guide.national_id && !guide.passport_number && !guide.tax_number && !guide.licence_number
                        && <span style={{ color: '#94a3b8', fontStyle: 'italic' }}>No ID details recorded</span>}
                    </div>
                  </td>
                  <td>
                    <span className="status-badge" style={retired
                      ? { background: '#f1f5f9', color: '#475569', border: '1px solid #cbd5e1' }
                      : { background: '#f0fdfa', color: '#0f766e', border: '1px solid #99f6e4' }}>
                      {retired ? 'Retired' : 'Bookable'}
                    </span>
                  </td>
                  <td>
                    <div className="action-buttons">
                      <button className="action-btn" onClick={() => openEdit(guide)} title="Edit guide">
                        <Edit3 size={16} />
                      </button>
                      <button
                        className="action-btn"
                        onClick={() => toggleActive(guide)}
                        title={retired ? 'Make bookable again' : 'Retire — keep the name on past lines'}
                      >
                        {retired ? <RotateCcw size={16} /> : <Archive size={16} />}
                      </button>
                      <button className="action-btn delete" onClick={() => handleDelete(guide)} title="Delete guide">
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {!rosterMissing && guides.length > 0 && totalGuides != null && totalGuides > guides.length && (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '1rem' }}>
            <button className="secondary-btn" style={{ padding: '0.6rem 1.5rem' }} onClick={() => fetchGuides({ offset: guides.length, append: true })} disabled={fetching}>
              {fetching ? 'Loading...' : `Load more (${guides.length} of ${totalGuides} guides)`}
            </button>
          </div>
        )}
      </div>

      {confirmDialog && <ConfirmDialog {...confirmDialog} />}
    </div>
  );
};

export default GuideTeam;
