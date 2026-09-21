import { useState, useEffect, useCallback } from 'react';
import { supabase, getLoggedInUserName } from '../lib/supabase';
import { useToast } from '../context/ToastContext';
import { UserPlus, Users, Calendar, User, StickyNote, Compass, UserCheck } from 'lucide-react';
import ClientForm from './ClientForm';

const emptyTraveller = () => ({
  name: '',
  surname: '',
  age: '',
  nationality: '',
  passportNumber: '',
  emergencyContact: '',
  dietaryRequirements: '',
  insurancePolicy: '',
  notes: ''
});

const childrenCount = (travellers = []) => {
  if (!Array.isArray(travellers)) return 0;
  return travellers.filter((t) => {
    const age = parseInt(t && t.age, 10);
    return !Number.isNaN(age) && age < 18;
  }).length;
};

export const ClientTourForm = ({ initial, submitLabel = 'Create Itinerary', submitIcon, onCancel, onSubmit }) => {
  const { showToast } = useToast();

  const initialTravellers = (Array.isArray(initial?.travellers) && initial.travellers.length > 0
    ? initial.travellers
    : [emptyTraveller(), emptyTraveller()])
    .map((t) => ({
      name: t?.name || '',
      surname: t?.surname || '',
      age: t?.age ?? '',
      nationality: t?.nationality || '',
      passportNumber: t?.passportNumber || '',
      emergencyContact: t?.emergencyContact || '',
      dietaryRequirements: t?.dietaryRequirements || '',
      insurancePolicy: t?.insurancePolicy || '',
      notes: t?.notes || ''
    }));

  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [clientMode, setClientMode] = useState('existing');
  const [pendingSubmit, setPendingSubmit] = useState(null);

  const [form, setForm] = useState({
    itineraryName: initial?.itineraryName || '',
    clientId: initial?.clientId || '',
    travelStart: initial?.travelStart || '',
    travelEnd: initial?.travelEnd || '',
    numTravellers: Math.max(1, initialTravellers.length),
    agencyRef: initial?.agencyRef || '',
    tourType: initial?.tourType || '',
    consultantName: initial?.consultantName || ''
  });

  const [travellers, setTravellers] = useState(initialTravellers);

  const selectedClient = clients.find((c) => c.id === form.clientId) || null;
  const isAgency = selectedClient?.client_type === 'Travel Agency';

  useEffect(() => {
    let active = true;
    (async () => {
      if (!form.consultantName) {
        const username = await getLoggedInUserName();
        if (active && username) {
          setForm((prev) => ({ ...prev, consultantName: prev.consultantName || username }));
        }
      }
    })();
    return () => { active = false; };
  }, []);

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

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await fetchClients();
      if (cancelled) return;
    })();
    return () => { cancelled = true; };
  }, [fetchClients]);

  const handleNumTravellersChange = (value) => {
    const count = Math.max(1, parseInt(value, 10) || 1);
    setForm((prev) => ({ ...prev, numTravellers: count }));
    setTravellers((prev) => {
      const next = [...prev];
      while (next.length < count) next.push(emptyTraveller());
      if (next.length > count) next.length = count;
      return next;
    });
  };

  const handleTravellerChange = (index, field, value) => {
    setTravellers((prev) => prev.map((t, i) => (i === index ? { ...t, [field]: value } : t)));
  };

  const handleSubmit = async (e) => {
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
    if (activeTravellers.some((t) => !t.name.trim() || !t.surname.trim())) {
      showToast('Please enter a name and surname for every traveller', 'warning');
      return;
    }

    const payload = {
      clientId: form.clientId,
      selectedClient,
      itineraryName: name,
      travelStart: form.travelStart,
      travelEnd: form.travelEnd,
      travellers: activeTravellers,
      numAdults: activeTravellers.length - childrenCount(activeTravellers),
      numChildren: childrenCount(activeTravellers),
      agencyRef: isAgency ? form.agencyRef.trim() : null,
      tourType: form.tourType,
      consultantName: form.consultantName.trim()
    };

    const originalTravellers = Array.isArray(initial?.travellers) ? initial.travellers : [];
    const travellersChanged = JSON.stringify(originalTravellers.map((t) => ({
      name: t?.name || '',
      surname: t?.surname || '',
      age: t?.age ?? '',
      nationality: t?.nationality || '',
      passportNumber: t?.passportNumber || '',
      emergencyContact: t?.emergencyContact || '',
      dietaryRequirements: t?.dietaryRequirements || '',
      insurancePolicy: t?.insurancePolicy || '',
      notes: t?.notes || ''
    }))) !== JSON.stringify(activeTravellers);

    if (initial?.clientId && travellersChanged && form.clientId === initial.clientId) {
      setPendingSubmit(payload);
      return;
    }

    await onSubmit(payload);
  };

  return (
    <>
    <form onSubmit={handleSubmit}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1.75rem' }}>

        {/* ─── Itinerary Header Info ─── */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '1rem' }}>
          <div>
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
          <div>
            <label style={{ fontSize: '0.8rem', fontWeight: 600, color: '#475569', display: 'block', marginBottom: '0.35rem' }}>
              Tour Type
            </label>
            <select
              className="pricing-select"
              value={form.tourType}
              onChange={(e) => setForm({ ...form, tourType: e.target.value })}
            >
              <option value="">Select tour type...</option>
              <option value="FIT">FIT</option>
              <option value="Series Departure">Series Departure</option>
            </select>
          </div>
          <div>
            <label style={{ fontSize: '0.8rem', fontWeight: 600, color: '#475569', display: 'block', marginBottom: '0.35rem' }}>
              Consultant / Tour Designer
            </label>
            <input
              type="text"
              className="pricing-select"
              placeholder="Logged-in user name"
              value={form.consultantName}
              onChange={(e) => setForm({ ...form, consultantName: e.target.value })}
            />
          </div>
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
                  {clients.map((c) => (
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
                setForm((prev) => ({ ...prev, clientId: client.id }));
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
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.85rem',
                  background: '#fff',
                  border: '1px solid #e2e8f0',
                  borderRadius: '10px',
                  padding: '0.75rem'
                }}
              >
                <div style={{ display: 'grid', gridTemplateColumns: '2.5rem 1fr 1fr 5.5rem', gap: '0.75rem', alignItems: 'center' }}>
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
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '0.6rem', marginTop: '0.4rem' }}>
                  <div>
                    <label style={{ fontSize: '0.7rem', fontWeight: 600, color: '#64748b', display: 'block', marginBottom: '0.15rem' }}>
                      Nationality
                    </label>
                    <input
                      type="text"
                      className="pricing-select"
                      placeholder="e.g. British"
                      style={{ padding: '0.5rem 0.65rem', fontSize: '0.8rem' }}
                      value={t.nationality}
                      onChange={(e) => handleTravellerChange(idx, 'nationality', e.target.value)}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: '0.7rem', fontWeight: 600, color: '#64748b', display: 'block', marginBottom: '0.15rem' }}>
                      Passport number
                    </label>
                    <input
                      type="text"
                      className="pricing-select"
                      placeholder="e.g. 531908714"
                      style={{ padding: '0.5rem 0.65rem', fontSize: '0.8rem' }}
                      value={t.passportNumber}
                      onChange={(e) => handleTravellerChange(idx, 'passportNumber', e.target.value)}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: '0.7rem', fontWeight: 600, color: '#64748b', display: 'block', marginBottom: '0.15rem' }}>
                      Emergency contact
                    </label>
                    <input
                      type="text"
                      className="pricing-select"
                      placeholder="Number for emergencies"
                      style={{ padding: '0.5rem 0.65rem', fontSize: '0.8rem' }}
                      value={t.emergencyContact}
                      onChange={(e) => handleTravellerChange(idx, 'emergencyContact', e.target.value)}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: '0.7rem', fontWeight: 600, color: '#64748b', display: 'block', marginBottom: '0.15rem' }}>
                      Dietary requirements
                    </label>
                    <input
                      type="text"
                      className="pricing-select"
                      placeholder="e.g. Vegetarian, nut allergy"
                      style={{ padding: '0.5rem 0.65rem', fontSize: '0.8rem' }}
                      value={t.dietaryRequirements}
                      onChange={(e) => handleTravellerChange(idx, 'dietaryRequirements', e.target.value)}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: '0.7rem', fontWeight: 600, color: '#64748b', display: 'block', marginBottom: '0.15rem' }}>
                      Insurance policy no.
                    </label>
                    <input
                      type="text"
                      className="pricing-select"
                      placeholder="e.g. POL-88213"
                      style={{ padding: '0.5rem 0.65rem', fontSize: '0.8rem' }}
                      value={t.insurancePolicy}
                      onChange={(e) => handleTravellerChange(idx, 'insurancePolicy', e.target.value)}
                    />
                  </div>
                </div>
                <div>
                  <label style={{ fontSize: '0.7rem', fontWeight: 600, color: '#64748b', display: 'block' }}>
                    Notes
                  </label>
                  <textarea
                    className="pricing-select"
                    rows="2"
                    placeholder="Important info that must be known — special occasions, celebrations, anniversaries, accessibility needs, anything the team must remember."
                    style={{ padding: '0.5rem 0.65rem', fontSize: '0.8rem', resize: 'vertical', width: '100%' }}
                    value={t.notes}
                    onChange={(e) => handleTravellerChange(idx, 'notes', e.target.value)}
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
            onClick={onCancel}
          >
            Cancel
          </button>
          <button type="submit" className="primary-btn" style={{ background: '#0d7478', width: 'auto', padding: '0.625rem 1.5rem', display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}>
            {submitIcon || null} {submitLabel}
          </button>
        </div>

      </div>
    </form>
    {pendingSubmit && (
      <div
        role="dialog"
        aria-modal="true"
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 1200,
          background: 'rgba(15, 23, 42, 0.45)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '1rem'
        }}
      >
        <div style={{ width: '100%', maxWidth: '500px', background: '#fff', borderRadius: '14px', padding: '1.5rem', boxShadow: '0 20px 50px rgba(15, 23, 42, 0.25)' }}>
          <h3 style={{ margin: '0 0 0.5rem', color: '#0f172a' }}>Traveller details updated</h3>
          <p style={{ margin: '0 0 1.25rem', color: '#475569', lineHeight: 1.5 }}>
            Should these travellers remain assigned to <strong>{selectedClient?.name || 'the current client'}</strong>, or should they be assigned to a different client?
          </p>
          <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
            <button type="button" className="secondary-btn" onClick={() => {
              setForm((prev) => ({ ...prev, clientId: '' }));
              setClientMode('existing');
              setPendingSubmit(null);
            }}>
              Choose a different client
            </button>
            <button type="button" className="primary-btn" onClick={() => {
              const payload = pendingSubmit;
              setPendingSubmit(null);
              onSubmit(payload);
            }}>
              Keep current client
            </button>
          </div>
        </div>
      </div>
    )}
    </>
  );
};

export default ClientTourForm;