import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useToast } from '../context/ToastContext';
import { Map, Building2, User, Calendar, Plus, X, UserPlus, Users, StickyNote, Copy, Edit3 } from 'lucide-react';
import ClientForm from '../components/ClientForm';

const emptyTraveller = () => ({ name: '', surname: '', age: '' });

const childrenCount = (travellers = []) => {
  if (!Array.isArray(travellers)) return 0;
  return travellers.filter(t => {
    const age = parseInt(t && t.age, 10);
    return !Number.isNaN(age) && age < 18;
  }).length;
};

export const Itineraries = () => {
  const navigate = useNavigate();
  const { showToast } = useToast();

  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [itineraries, setItineraries] = useState([]);
  const [loadingItineraries, setLoadingItineraries] = useState(true);
  const [clientMode, setClientMode] = useState('existing'); // 'existing' | 'new'

  const [form, setForm] = useState({
    itineraryName: '',
    clientId: '',
    travelStart: '',
    travelEnd: '',
    numTravellers: 2,
    agencyRef: ''
  });

  const [travellers, setTravellers] = useState([emptyTraveller(), emptyTraveller()]);
  const [showInlineForm, setShowInlineForm] = useState(true);

  const selectedClient = clients.find(c => c.id === form.clientId) || null;
  const isAgency = selectedClient?.client_type === 'Travel Agency';

  const fetchClients = useCallback(async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setLoading(false);
        return;
      }

      const { data: profile } = await supabase
        .from('profiles')
        .select('*, company_id')
        .eq('id', user.id)
        .single();

      if (!profile?.company_id) {
        setClients([]);
        setLoading(false);
        return;
      }

      setLoading(true);

      const { data, error } = await supabase
        .from('clients')
        .select('*')
        .eq('company_id', profile.company_id)
        .order('name', { ascending: true });

      if (error) throw error;
      setClients(data || []);
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  const fetchItineraries = useCallback(async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setLoadingItineraries(false);
        return;
      }

      const { data: profile } = await supabase
        .from('profiles')
        .select('*, company_id')
        .eq('id', user.id)
        .single();

      if (!profile?.company_id) {
        setItineraries([]);
        setLoadingItineraries(false);
        return;
      }

      setLoadingItineraries(true);

      const { data, error } = await supabase
        .from('itineraries')
        .select('*, clients(name, client_type)')
        .eq('company_id', profile.company_id)
        .order('created_at', { ascending: false })
        .limit(50);

      if (error) throw error;
      setItineraries(data || []);
    } catch (err) {
      console.error('Failed to load itineraries:', err.message);
      setItineraries([]);
    } finally {
      setLoadingItineraries(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await fetchClients();
      await fetchItineraries();
      if (cancelled) return;
    })();
    return () => { cancelled = true; };
  }, [fetchClients, fetchItineraries]);

  const resetForm = () => {
    setForm({
      itineraryName: '',
      clientId: '',
      travelStart: '',
      travelEnd: '',
      numTravellers: 2,
      agencyRef: ''
    });
    setTravellers([emptyTraveller(), emptyTraveller()]);
    setClientMode('existing');
  };

  const handleNumTravellersChange = (value) => {
    const count = Math.max(1, parseInt(value, 10) || 1);
    setForm(prev => ({ ...prev, numTravellers: count }));
    setTravellers(prev => {
      const next = [...prev];
      while (next.length < count) next.push(emptyTraveller());
      if (next.length > count) next.length = count;
      return next;
    });
  };

  const handleTravellerChange = (index, field, value) => {
    setTravellers(prev => prev.map((t, i) => (i === index ? { ...t, [field]: value } : t)));
  };

  const handleCreate = async (e) => {
    e.preventDefault();

    const name = form.itineraryName.trim();
    if (!name) {
      showToast('Itinerary name is required', 'warning');
      return;
    }

    if (!form.clientId) {
      showToast(clientMode === 'new' ? 'Please add the new client to continue' : 'Please select a client', 'warning');
      return;
    }

    if (!form.travelStart || !form.travelEnd) {
      showToast('Travel date range is required', 'warning');
      return;
    }

    if (form.travelEnd < form.travelStart) {
      showToast('End date cannot be before the start date', 'warning');
      return;
    }

    const activeTravellers = travellers.slice(0, form.numTravellers);
    if (activeTravellers.some(t => !t.name.trim() || !t.surname.trim())) {
      showToast('Please enter a name and surname for every traveller', 'warning');
      return;
    }

    try {
      const { data: { user } } = await supabase.auth.getUser();
      const { data: profile } = await supabase
        .from('profiles')
        .select('company_id')
        .eq('id', user.id)
        .single();

      if (!profile?.company_id) {
        showToast('No active company found for your user profile', 'error');
        return;
      }

      const { data: referenceNumber, error: refError } = await supabase
        .rpc('get_next_itinerary_reference', { p_company_id: profile.company_id });

      if (!referenceNumber || refError) {
        showToast(refError?.message || 'Could not allocate itinerary reference number', 'error');
        return;
      }

      const { data: newItinerary, error } = await supabase
        .from('itineraries')
        .insert([{
          company_id: profile.company_id,
          client_id: form.clientId,
          reference_number: referenceNumber,
          itinerary_name: name,
          travel_start_date: form.travelStart,
          travel_end_date: form.travelEnd,
          travellers: activeTravellers,
          num_adults: activeTravellers.length - childrenCount(activeTravellers),
          num_children: childrenCount(activeTravellers),
          agency_reference: isAgency ? form.agencyRef.trim() : null,
          status: 'quotation'
        }])
        .select()
        .single();

      if (error) throw error;

      showToast(`Itinerary "${name}" created!`, 'success');
      fetchItineraries();
      setShowInlineForm(false);

      navigate('/itineraries/builder', {
        state: {
          itineraryId: newItinerary.id,
          referenceNumber,
          itineraryName: name,
          client: selectedClient,
          travelStart: form.travelStart,
          travelEnd: form.travelEnd,
          travellers: activeTravellers,
          numAdults: activeTravellers.length - childrenCount(activeTravellers),
          numChildren: childrenCount(activeTravellers),
          agencyRef: isAgency ? form.agencyRef.trim() : null
        }
      });
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  const handleEdit = (itinerary) => {
    const trav = Array.isArray(itinerary.travellers) ? itinerary.travellers : [];
    navigate('/itineraries/builder', {
      state: {
        itineraryId: itinerary.id,
        referenceNumber: itinerary.reference_number,
        itineraryName: itinerary.itinerary_name,
        client: itinerary.clients || null,
        travelStart: itinerary.travel_start_date,
        travelEnd: itinerary.travel_end_date,
        travellers: trav,
        numAdults: trav.length - childrenCount(trav),
        numChildren: childrenCount(trav),
        agencyRef: itinerary.agency_reference || null
      }
    });
  };

  const handleCopy = async (itinerary) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const { data: profile } = await supabase
        .from('profiles')
        .select('company_id')
        .eq('id', user.id)
        .single();

      if (!profile?.company_id) {
        showToast('No active company found for your user profile', 'error');
        return;
      }

      const trav = Array.isArray(itinerary.travellers) ? itinerary.travellers : [];

      const { data: referenceNumber, error: refError } = await supabase
        .rpc('get_next_itinerary_reference', { p_company_id: profile.company_id });

      if (!referenceNumber || refError) {
        showToast(refError?.message || 'Could not allocate itinerary reference number', 'error');
        return;
      }

      const { data: copy, error } = await supabase
        .from('itineraries')
        .insert([{
          company_id: profile.company_id,
          client_id: itinerary.client_id,
          reference_number: referenceNumber,
          itinerary_name: `${itinerary.itinerary_name} (Copy)`,
          travel_start_date: itinerary.travel_start_date,
          travel_end_date: itinerary.travel_end_date,
          travellers: trav,
          num_adults: trav.length - childrenCount(trav),
          num_children: childrenCount(trav),
          agency_reference: itinerary.agency_reference || null,
          status: 'quotation'
        }])
        .select()
        .single();

      if (error) throw error;
      showToast('Itinerary copied!', 'success');
      fetchItineraries();
      navigate('/itineraries/builder', {
        state: {
          itineraryId: copy.id,
          referenceNumber,
          itineraryName: copy.itinerary_name,
          client: itinerary.clients || null,
          travelStart: copy.travel_start_date,
          travelEnd: copy.travel_end_date,
          travellers: trav,
          numAdults: trav.length - childrenCount(trav),
          numChildren: childrenCount(trav),
          agencyRef: copy.agency_reference || null
        }
      });
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  const formatTravellerSummary = (itinerary) => {
    const trav = Array.isArray(itinerary.travellers) ? itinerary.travellers : [];
    return trav.length || '—';
  };

  const formatChildrenAges = (itinerary) => {
    const trav = Array.isArray(itinerary.travellers) ? itinerary.travellers : [];
    const children = trav.filter(t => {
      const age = parseInt(t && t.age, 10);
      return !Number.isNaN(age) && age < 18;
    });
    if (children.length === 0) return '—';
    return `${children.length} (${children.map(t => t.age).join(', ')})`;
  };

  const formatDestinations = (itinerary) => {
    const parts = [itinerary.destination_region, itinerary.destination_country, itinerary.destination_province].filter(Boolean);
    return parts.length > 0 ? parts.join(', ') : '—';
  };

  return (
    <div className="super-admin-page" style={{ paddingBottom: '4rem' }}>
      <header className="page-header" style={{ marginBottom: '1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: '1rem' }}>
        <div className="header-title">
          <Map className="header-icon" />
          <div>
            <h1>Itineraries</h1>
            <p>Client &amp; Tour — create a new itinerary and open the itinerary builder</p>
          </div>
        </div>
        <button
          className="primary-btn"
          style={{ width: 'auto', padding: '0.625rem 1.25rem', background: '#0d7478', display: 'flex', alignItems: 'center', gap: '0.4rem' }}
          onClick={() => setShowInlineForm(!showInlineForm)}
        >
          <Plus size={18} /> {showInlineForm ? 'Close Form' : 'Add Itinerary'}
        </button>
      </header>

      {showInlineForm && (
      <div id="itinerary-form" style={{
        background: '#fff',
        borderRadius: '16px',
        padding: '2rem',
        border: '1px solid #cbd5e1',
        boxShadow: '0 10px 25px -5px rgba(0,0,0,0.05)',
        marginBottom: '2.5rem',
        scrollMarginTop: '1rem'
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #e2e8f0', paddingBottom: '1rem', marginBottom: '1.5rem' }}>
          <h2 style={{ fontSize: '1.25rem', fontWeight: 700, color: '#1e293b', margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Map size={22} color="#0d7478" /> Client &amp; Tour
          </h2>
        </div>

        <form onSubmit={handleCreate}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.75rem' }}>

            {/* ─── Itinerary Name ─── */}
            <div style={{ maxWidth: '560px' }}>
              <label style={{ fontSize: '0.8rem', fontWeight: 600, color: '#475569', display: 'block', marginBottom: '0.35rem' }}>
                Itinerary Name *
              </label>
              <input
                type="text"
                className="pricing-select"
                placeholder="e.g. Beach Paradise Getaway"
                value={form.itineraryName}
                onChange={(e) => setForm({ ...form, itineraryName: e.target.value })}
              />
            </div>

            {/* ─── Client Selection / Creation ─── */}
            <div style={{
              background: '#f8fafc',
              padding: '1.5rem',
              borderRadius: '12px',
              border: '1px solid #e2e8f0'
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
                <h3 style={{ fontSize: '1.1rem', fontWeight: 700, color: '#0f172a', margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <Users size={20} color="#0d7478" /> Client
                </h3>

                {clientMode === 'new' ? (
                  <button
                    type="button"
                    onClick={() => setClientMode('existing')}
                    style={{ color: '#0d7478', background: 'none', border: 'none', fontWeight: 600, fontSize: '0.9rem', cursor: 'pointer' }}
                  >
                    Select Existing
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => setClientMode('new')}
                    style={{ color: '#0d7478', background: 'none', border: 'none', fontWeight: 600, fontSize: '0.9rem', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}
                  >
                    <UserPlus size={14} /> Add New Client
                  </button>
                )}
              </div>

              {clientMode === 'existing' && (
                <div style={{ maxWidth: '600px' }}>
                  <label style={{ fontSize: '0.85rem', fontWeight: 700, color: '#334155', display: 'block', marginBottom: '0.35rem' }}>
                    Select Client *
                  </label>
                  {loading ? (
                    <div style={{ fontSize: '0.85rem', color: '#64748b' }}>Loading clients...</div>
                  ) : (
                    <select
                      className="pricing-select"
                      value={form.clientId}
                      onChange={(e) => setForm({ ...form, clientId: e.target.value })}
                      style={{ margin: 0, fontWeight: 600 }}
                    >
                      <option value="">Select client...</option>
                      {clients.map(c => (
                        <option key={c.id} value={c.id}>
                          {c.name} ({c.client_type === 'Travel Agency' ? 'Travel Agency' : 'Direct'})
                        </option>
                      ))}
                    </select>
                  )}
                  {clients.length === 0 && !loading && (
                    <p style={{ fontSize: '0.8rem', color: '#64748b', marginTop: '0.5rem' }}>
                      No clients yet — click "Add New Client" above to create one inline.
                    </p>
                  )}
                </div>
              )}

              {clientMode === 'new' && (
                <ClientForm
                  onCancel={() => setClientMode('existing')}
                  onCreated={(client) => {
                    setForm(prev => ({ ...prev, clientId: client.id }));
                    setClientMode('existing');
                    fetchClients();
                  }}
                />
              )}
            </div>

            {/* ─── Travel Date Range ─── */}
            <div style={{
              background: '#f8fafc',
              padding: '1.5rem',
              borderRadius: '12px',
              border: '1px solid #e2e8f0'
            }}>
              <h3 style={{ fontSize: '1.1rem', fontWeight: 700, color: '#0f172a', margin: '0 0 1.25rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <Calendar size={20} color="#0d7478" /> Travel Dates
              </h3>
              <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
                <div style={{ flex: '1', minWidth: '220px' }}>
                  <label style={{ fontSize: '0.85rem', fontWeight: 700, color: '#334155', display: 'block', marginBottom: '0.35rem' }}>
                    From *
                  </label>
                  <input
                    type="date"
                    className="pricing-select"
                    value={form.travelStart}
                    onChange={(e) => setForm({ ...form, travelStart: e.target.value })}
                  />
                </div>
                <div style={{ flex: '1', minWidth: '220px' }}>
                  <label style={{ fontSize: '0.85rem', fontWeight: 700, color: '#334155', display: 'block', marginBottom: '0.35rem' }}>
                    To *
                  </label>
                  <input
                    type="date"
                    className="pricing-select"
                    min={form.travelStart || undefined}
                    value={form.travelEnd}
                    onChange={(e) => setForm({ ...form, travelEnd: e.target.value })}
                  />
                </div>
              </div>
            </div>

            {/* ─── Travellers ─── */}
            <div style={{
              background: '#f8fafc',
              padding: '1.5rem',
              borderRadius: '12px',
              border: '1px solid #e2e8f0'
            }}>
              <h3 style={{ fontSize: '1.1rem', fontWeight: 700, color: '#0f172a', margin: '0 0 1.25rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <User size={20} color="#0d7478" /> Travellers
              </h3>

              <div style={{ maxWidth: '300px', marginBottom: '1.25rem' }}>
                <label style={{ fontSize: '0.85rem', fontWeight: 700, color: '#334155', display: 'block', marginBottom: '0.35rem' }}>
                  Number of Travellers *
                </label>
                <input
                  type="number"
                  min="1"
                  max="50"
                  className="pricing-select"
                  value={form.numTravellers}
                  onChange={(e) => handleNumTravellersChange(e.target.value)}
                />
              </div>

              {/* Agency reference section — shown only for Travel Agency clients */}
              {isAgency && (
                <div style={{
                  background: '#eff6ff',
                  border: '1px solid #bfdbfe',
                  borderRadius: '10px',
                  padding: '1rem 1.25rem',
                  marginBottom: '1.25rem'
                }}>
                  <label style={{ fontSize: '0.85rem', fontWeight: 700, color: '#1e40af', display: 'block', marginBottom: '0.35rem' }}>
                    Reference Number / Name
                  </label>
                  <input
                    type="text"
                    className="pricing-select"
                    placeholder="e.g. Booking ref #A-8821"
                    value={form.agencyRef}
                    onChange={(e) => setForm({ ...form, agencyRef: e.target.value })}
                  />
                  <p style={{ fontSize: '0.75rem', color: '#3b82f6', marginTop: '0.35rem', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                    <StickyNote size={13} /> Reference given by the travel agency for this booking, if it exists.
                  </p>
                </div>
              )}

              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                {travellers.slice(0, form.numTravellers).map((t, idx) => (
                  <div
                    key={idx}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '2.5rem 1fr 1fr 5.5rem',
                      gap: '0.75rem',
                      alignItems: 'center',
                      background: '#fff',
                      border: '1px solid #e2e8f0',
                      borderRadius: '10px',
                      padding: '0.75rem'
                    }}
                  >
                    <div style={{ fontSize: '0.85rem', fontWeight: 700, color: '#94a3b8', textAlign: 'center' }}>
                      {idx + 1}
                    </div>
                    <div>
                      <label style={{ fontSize: '0.7rem', fontWeight: 600, color: '#64748b', display: 'block', marginBottom: '0.15rem' }}>
                        Name *
                      </label>
                      <input
                        type="text"
                        className="pricing-select"
                        placeholder="First name"
                        style={{ padding: '0.5rem 0.65rem', fontSize: '0.85rem' }}
                        value={t.name}
                        onChange={(e) => handleTravellerChange(idx, 'name', e.target.value)}
                      />
                    </div>
                    <div>
                      <label style={{ fontSize: '0.7rem', fontWeight: 600, color: '#64748b', display: 'block', marginBottom: '0.15rem' }}>
                        Surname *
                      </label>
                      <input
                        type="text"
                        className="pricing-select"
                        placeholder="Surname"
                        style={{ padding: '0.5rem 0.65rem', fontSize: '0.85rem' }}
                        value={t.surname}
                        onChange={(e) => handleTravellerChange(idx, 'surname', e.target.value)}
                      />
                    </div>
                    <div>
                      <label style={{ fontSize: '0.7rem', fontWeight: 600, color: '#64748b', display: 'block', marginBottom: '0.15rem' }}>
                        Age
                      </label>
                      <input
                        type="number"
                        min="0"
                        max="120"
                        className="pricing-select"
                        placeholder="e.g. 30"
                        style={{ padding: '0.5rem 0.65rem', fontSize: '0.85rem', textAlign: 'center' }}
                        value={t.age}
                        onChange={(e) => handleTravellerChange(idx, 'age', e.target.value)}
                      />
                    </div>
                  </div>
                ))}
              </div>

              <p style={{ fontSize: '0.78rem', color: '#64748b', marginTop: '0.75rem' }}>
                Ages help us identify children for correct child pricing — under 18 counts as a child.
              </p>
            </div>

            {/* ─── Actions ─── */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '1rem', marginTop: '0.5rem', paddingTop: '1.25rem', borderTop: '1px solid #e2e8f0' }}>
              <button
                type="button"
                className="secondary-btn"
                style={{ flex: '0 0 auto', padding: '0.625rem 1.5rem' }}
                onClick={resetForm}
              >
                Cancel
              </button>
              <button type="submit" className="primary-btn" style={{ background: '#0d7478', width: 'auto', padding: '0.625rem 1.5rem', display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}>
                <Plus size={18} /> Create Itinerary
              </button>
            </div>

          </div>
        </form>
      </div>
      )}

      {/* RECENT ITINERARIES TABLE */}
      <div className="admin-table-container">
        <div className="table-header-actions">
          <h2 style={{ fontSize: '1.1rem', fontWeight: 700, color: '#1e293b', margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Map size={20} color="#0d7478" /> Recent Itineraries
          </h2>
        </div>

        <table className="admin-table">
          <thead>
            <tr>
              <th>Client</th>
              <th>Reference</th>
              <th>Itinerary</th>
              <th>Travelers</th>
              <th>Children (Ages)</th>
              <th>Travel Dates</th>
              <th>Destinations</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loadingItineraries ? (
              <tr>
                <td colSpan="8" className="text-center" style={{ padding: '3rem' }}>Loading itineraries...</td>
              </tr>
            ) : itineraries.length === 0 ? (
              <tr>
                <td colSpan="8" className="text-center" style={{ padding: '3rem', color: '#64748b' }}>
                  <Map size={48} style={{ marginBottom: '1rem', opacity: 0.4 }} />
                  <h3 style={{ fontSize: '1.15rem', fontWeight: 700, color: '#1e293b', marginBottom: '0.4rem' }}>No itineraries yet</h3>
                  <p>Create your first itinerary to start building tailored tours.</p>
                </td>
              </tr>
            ) : itineraries.map((it) => (
              <tr key={it.id}>
                <td>
                  <div className="company-cell">
                    <span className="company-name">{it.clients?.name || 'Unknown client'}</span>
                    <span className="company-id" style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                      {it.clients?.client_type === 'Travel Agency' ? <Building2 size={12} /> : <User size={12} />}
                      {it.clients?.client_type === 'Travel Agency' ? 'Travel Agency' : 'Direct'}
                    </span>
                  </div>
                </td>
                <td>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.85rem', fontWeight: 700, color: '#0d7478', fontFamily: 'monospace' }}>
                    {it.reference_number || '—'}
                  </span>
                </td>
                <td>
                  <span style={{ fontWeight: 600, color: '#1e293b' }}>{it.itinerary_name}</span>
                  <div style={{ fontSize: '0.75rem', color: '#94a3b8', fontStyle: 'italic' }}>
                    {it.status}
                  </div>
                </td>
                <td style={{ fontSize: '0.9rem', fontWeight: 600 }}>{formatTravellerSummary(it)}</td>
                <td>
                  {formatChildrenAges(it) === '—' ? (
                    <span style={{ color: '#94a3b8', fontSize: '0.85rem' }}>—</span>
                  ) : (
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.85rem', fontWeight: 600, color: '#0f766e' }}>
                      <User size={12} /> {formatChildrenAges(it)}
                    </span>
                  )}
                </td>
                <td>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.85rem', color: '#475569' }}>
                    <Calendar size={13} /> {it.travel_start_date} → {it.travel_end_date}
                  </span>
                </td>
                <td style={{ maxWidth: '220px' }}>
                  <span style={{ fontSize: '0.85rem', color: '#64748b' }}>{formatDestinations(it)}</span>
                </td>
                <td>
                  <div className="action-buttons">
                    <button
                      className="action-btn"
                      onClick={() => handleEdit(it)}
                      title="Edit Itinerary"
                    >
                      <Edit3 size={16} />
                    </button>
                    <button
                      className="action-btn"
                      onClick={() => handleCopy(it)}
                      title="Copy Itinerary"
                    >
                      <Copy size={16} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default Itineraries;
