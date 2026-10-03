import { useState, useEffect, useCallback, useRef } from 'react';
import SearchableSelect from '../components/SearchableSelect';
import { useNavigate } from 'react-router-dom';
import { supabase, getLoggedInUserName } from '../lib/supabase';
import { useToast } from '../context/ToastContext';
import { useListRowLimit } from '../hooks/useListRowLimit';
import { Map, Building2, User, Calendar, Plus, Copy, Edit3, Search } from 'lucide-react';
import ClientTourForm from '../components/ClientTourForm';

const STATUS_MODS = {
  quotation: 'quotation',
  provisional: 'provisional',
  confirmed: 'confirmed',
  in_progress: 'in_progress',
  cancelled: 'cancelled',
  completed: 'completed'
};

const STATUS_LABELS = {
  quotation: 'Quotation',
  provisional: 'Provisional Booking',
  confirmed: 'Confirmed Booking',
  in_progress: 'In Progress',
  cancelled: 'Cancelled',
  completed: 'Completed'
};

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

  const [itineraries, setItineraries] = useState([]);
  const [loadingItineraries, setLoadingItineraries] = useState(true);
  const [fetchingMore, setFetchingMore] = useState(false);
  const [totalItineraries, setTotalItineraries] = useState(null);
  const searchTimeoutRef = useRef(null);

  const [showInlineForm, setShowInlineForm] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  const { limit: pageSize } = useListRowLimit();

  const fetchItineraries = useCallback(async ({ offset = 0, append = false } = {}) => {
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
        setTotalItineraries(0);
        setLoadingItineraries(false);
        return;
      }

      setLoadingItineraries(true);
      if (append) setFetchingMore(true);

      let itineraryQuery = supabase
        .from('itineraries')
        .select('*, clients(name, client_type, markup_percentage, deposit_percentage, email, country)', { count: 'exact' })
        .eq('company_id', profile.company_id);

      const q = searchQuery.trim();
      if (q) {
        const esc = (t) => t.replace(/[\\%_]/g, (m) => '\\' + m);
        const term = q.replace(/[,()]/g, ' ').trim();
        const t = esc(term);
        itineraryQuery = itineraryQuery.or(`itinerary_name.ilike.%${t}%,reference_number.ilike.%${t}%,destination_region.ilike.%${t}%,destination_country.ilike.%${t}%,destination_province.ilike.%${t}%`);
      }

      const { data, count, error } = await itineraryQuery
        .order('created_at', { ascending: false })
        .range(offset, offset + pageSize - 1);

      if (error) throw error;
      setItineraries((prev) => {
        if (!append) return data || [];
        const merged = new Map([...prev.map(i => [i.id, i]), ...(data || []).map(i => [i.id, i])]);
        return Array.from(merged.values());
      });
      setTotalItineraries(count ?? (data || []).length);
    } catch (err) {
      console.error('Failed to load itineraries:', err.message);
      setItineraries([]);
    } finally {
      setLoadingItineraries(false);
      setFetchingMore(false);
    }
  }, [searchQuery, pageSize]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await fetchItineraries();
      if (cancelled) return;
    })();
    return () => { cancelled = true; };
  }, [fetchItineraries]);

  useEffect(() => {
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    searchTimeoutRef.current = setTimeout(() => fetchItineraries(), 350);
    return () => {
      if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    };
  }, [searchQuery, fetchItineraries]);

  const filteredItineraries = itineraries.filter((it) => {
    if (statusFilter && it.status !== statusFilter) return false;
    return true;
  });

  const handleCreateItinerary = async (payload) => {
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

      const defaultConsultant = await getLoggedInUserName();
      const consultantName = payload.consultantName || defaultConsultant || null;

      const { data: newItinerary, error } = await supabase
        .from('itineraries')
        .insert([{
          company_id: profile.company_id,
          client_id: payload.clientId,
          reference_number: referenceNumber,
          itinerary_name: payload.itineraryName,
          travel_start_date: payload.travelStart,
          travel_end_date: payload.travelEnd,
          travellers: payload.travellers,
          num_adults: payload.numAdults,
          num_children: payload.numChildren,
          agency_reference: payload.agencyRef,
          itinerary_tour_type: payload.tourType || null,
          consultant_name: consultantName,
          status: 'quotation'
        }])
        .select()
        .single();

      if (error) throw error;

      showToast(`Itinerary "${payload.itineraryName}" created!`, 'success');
      fetchItineraries();
      setShowInlineForm(false);

      navigate('/itineraries/builder', {
        state: {
          itineraryId: newItinerary.id,
          referenceNumber,
          itineraryName: payload.itineraryName,
          client: payload.selectedClient,
          travelStart: payload.travelStart,
          travelEnd: payload.travelEnd,
          travellers: payload.travellers,
          numAdults: payload.numAdults,
          numChildren: payload.numChildren,
          agencyRef: payload.agencyRef,
          tourType: payload.tourType || '',
          consultantName: consultantName || ''
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
        agencyRef: itinerary.agency_reference || null,
        tourType: itinerary.itinerary_tour_type || '',
        consultantName: itinerary.consultant_name || ''
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

      const defaultConsultant = await getLoggedInUserName();
      const consultantName = itinerary.consultant_name || defaultConsultant || null;

      const { data: copy, error } = await supabase
        .from('itineraries')
        .insert([{
          company_id: profile.company_id,
          // A copied itinerary is a new client assignment. The builder must
          // require an explicit client selection instead of silently reusing
          // the source itinerary's client.
          client_id: null,
          reference_number: referenceNumber,
          itinerary_name: `${itinerary.itinerary_name} (Copy)`,
          travel_start_date: itinerary.travel_start_date,
          travel_end_date: itinerary.travel_end_date,
          travellers: trav,
          num_adults: trav.length - childrenCount(trav),
          num_children: childrenCount(trav),
          agency_reference: itinerary.agency_reference || null,
          itinerary_tour_type: itinerary.itinerary_tour_type || null,
          consultant_name: consultantName,
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
          client: null,
          travelStart: copy.travel_start_date,
          travelEnd: copy.travel_end_date,
          travellers: trav,
          numAdults: trav.length - childrenCount(trav),
          numChildren: childrenCount(trav),
          agencyRef: copy.agency_reference || null,
          tourType: copy.itinerary_tour_type || '',
          consultantName: consultantName || ''
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
          <Plus size={18} /> {showInlineForm ? 'Close Form' : 'New Itinerary'}
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

        <ClientTourForm
          submitLabel="Create Itinerary"
          submitIcon={<Plus size={18} />}
          onCancel={() => setShowInlineForm(false)}
          onSubmit={handleCreateItinerary}
        />
      </div>
      )}

      {/* RECENT ITINERARIES TABLE */}
      <div className="admin-table-container">
        <div className="table-header-actions">
          <h2 style={{ fontSize: '1.1rem', fontWeight: 700, color: '#1e293b', margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Map size={20} color="#0d7478" /> Recent Itineraries
          </h2>
          <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flex: 1, justifyContent: 'flex-end' }}>
            <div className="search-box" style={{ flex: 1, width: 'auto', maxWidth: '380px' }}>
              <Search size={16} />
              <input
                type="text"
                placeholder="Search itineraries by client, reference or name..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
            <SearchableSelect
              className="pricing-select"
              style={{ width: 'auto', minWidth: '150px', padding: '0.55rem 0.75rem', borderRadius: '10px', border: '1px solid #e2e8f0', fontSize: '0.85rem', color: '#334155', background: '#f8fafc' }}
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              <option value="">All statuses</option>
              <option value="quotation">Quotation</option>
              <option value="provisional">Provisional Booking</option>
              <option value="confirmed">Confirmed Booking</option>
              <option value="in_progress">In Progress</option>
              <option value="cancelled">Cancelled</option>
              <option value="completed">Completed</option>
            </SearchableSelect>
          </div>
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
                  <h3 style={{ fontSize: '1.15rem', fontWeight: 700, color: '#1e293b', marginBottom: '0.4rem' }}>
                    {searchQuery.trim() ? 'No itineraries match' : 'No itineraries yet'}
                  </h3>
                  <p>
                    {searchQuery.trim()
                      ? 'Try a different search term or clear the search box.'
                      : 'Create your first itinerary to start building tailored tours.'}
                  </p>
                </td>
              </tr>
            ) : filteredItineraries.length === 0 ? (
              <tr>
                <td colSpan="8" className="text-center" style={{ padding: '3rem', color: '#64748b' }}>
                  <Map size={48} style={{ marginBottom: '1rem', opacity: 0.4 }} />
                  <h3 style={{ fontSize: '1.15rem', fontWeight: 700, color: '#1e293b', marginBottom: '0.4rem' }}>No itineraries match</h3>
                  <p>Try adjusting your search or filter.</p>
                </td>
              </tr>
            ) : filteredItineraries.map((it) => {
              const isCompleted = it.status === 'completed';
              return (
              <tr key={it.id} onClick={() => handleEdit(it)} style={{ cursor: 'pointer' }} title={isCompleted ? 'Open itinerary (read-only)' : 'Open itinerary'}>
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
                  <div style={{ marginTop: '0.25rem' }}>
                    <span className={`status-badge ${STATUS_MODS[it.status] || ''}`}>{STATUS_LABELS[it.status] || it.status || 'Quotation'}</span>
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
                      onClick={(e) => { e.stopPropagation(); if (!isCompleted) handleEdit(it); }}
                      disabled={isCompleted}
                      title={isCompleted ? 'Completed itineraries cannot be edited' : 'Edit Itinerary'}
                    >
                      <Edit3 size={16} />
                    </button>
                    <button
                      className="action-btn"
                      onClick={(e) => { e.stopPropagation(); handleCopy(it); }}
                      title="Copy Itinerary"
                    >
                      <Copy size={16} />
                    </button>
                  </div>
                </td>
              </tr>
            );
            })}
          </tbody>
        </table>
        {!loadingItineraries && !fetchingMore && totalItineraries != null && totalItineraries > itineraries.length && (
          <div style={{ display: 'flex', justifyContent: 'center', marginTop: '1.25rem' }}>
            <button
              type="button"
              className="secondary-btn"
              onClick={() => fetchItineraries({ offset: itineraries.length, append: true })}
            >
              Load more ({itineraries.length} of {totalItineraries} itineraries shown)
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default Itineraries;
