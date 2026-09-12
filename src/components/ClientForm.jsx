import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { useToast } from '../context/ToastContext';
import { Users, X } from 'lucide-react';
import CountrySelect from './CountrySelect';

export const ClientForm = ({ onCancel, onCreated, title = 'Add New Client' }) => {
  const [countries, setCountries] = useState([]);
  const { showToast } = useToast();

  const [form, setForm] = useState({
    name: '',
    email: '',
    phone: '',
    clientType: 'Direct',
    country: '',
    markupPercentage: '',
    address: '',
    notes: ''
  });

  const fetchCountries = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('app_countries')
        .select('name')
        .eq('is_active', true)
        .order('name', { ascending: true });

      if (error) throw error;
      setCountries((data || []).map(c => c.name));
    } catch (err) {
      console.error('Failed to load countries:', err.message);
      setCountries(['South Africa', 'Tanzania', 'Kenya', 'Namibia', 'Botswana', 'United States', 'United Kingdom', 'France', 'Germany', 'Netherlands']);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await fetchCountries();
      if (cancelled) return;
    })();
    return () => { cancelled = true; };
  }, [fetchCountries]);

  const handleSubmit = async (e) => {
    e.preventDefault();

    const name = form.name.trim();
    if (!name) {
      showToast('Client name is required', 'warning');
      return;
    }

    const email = form.email.trim();
    if (!email) {
      showToast('Email is required', 'warning');
      return;
    }

    const markup = form.markupPercentage === '' ? 0 : parseFloat(form.markupPercentage);
    if (Number.isNaN(markup) || markup < 0) {
      showToast('Markup percentage must be a valid number', 'warning');
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

      const payload = {
        company_id: profile.company_id,
        name,
        email,
        phone: form.phone.trim(),
        client_type: form.clientType,
        country: form.country,
        markup_percentage: markup,
        address: form.address.trim(),
        notes: form.notes.trim()
      };

      const { data: newClient, error } = await supabase
        .from('clients')
        .insert([payload])
        .select()
        .single();

      if (error) throw error;
      showToast(`Client "${name}" added successfully!`, 'success');
      onCreated(newClient);
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  return (
    <div style={{
      background: '#f8fafc',
      borderRadius: '12px',
      border: '1px solid #e2e8f0',
      padding: '1.5rem'
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #e2e8f0', paddingBottom: '1rem', marginBottom: '1.25rem' }}>
        <h4 style={{ fontSize: '1rem', fontWeight: 700, color: '#1e293b', margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <Users size={18} color="#0d7478" /> {title}
        </h4>
        <button
          type="button"
          onClick={onCancel}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#64748b', display: 'flex', alignItems: 'center', gap: '0.25rem', fontSize: '0.8rem', fontWeight: 600 }}
        >
          <X size={16} /> Close
        </button>
      </div>

      <form onSubmit={handleSubmit}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
          <div>
            <label style={{ fontSize: '0.8rem', fontWeight: 600, color: '#475569', display: 'block', marginBottom: '0.25rem' }}>
              Name *
            </label>
            <input
              type="text"
              className="pricing-select"
              placeholder="Client or company name"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </div>
          <div>
            <label style={{ fontSize: '0.8rem', fontWeight: 600, color: '#475569', display: 'block', marginBottom: '0.25rem' }}>
              Email *
            </label>
            <input
              type="email"
              className="pricing-select"
              placeholder="email@example.com"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
          </div>
          <div>
            <label style={{ fontSize: '0.8rem', fontWeight: 600, color: '#475569', display: 'block', marginBottom: '0.25rem' }}>
              Phone
            </label>
            <input
              type="tel"
              className="pricing-select"
              placeholder="+1 234 567 8900"
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
            />
          </div>
          <div>
            <label style={{ fontSize: '0.8rem', fontWeight: 600, color: '#475569', display: 'block', marginBottom: '0.25rem' }}>
              Client Type
            </label>
            <select
              className="pricing-select"
              value={form.clientType}
              onChange={(e) => setForm({ ...form, clientType: e.target.value })}
            >
              <option value="Direct">Direct</option>
              <option value="Travel Agency">Travel Agency</option>
            </select>
          </div>
          <div>
            <label style={{ fontSize: '0.8rem', fontWeight: 600, color: '#475569', display: 'block', marginBottom: '0.25rem' }}>
              Country
            </label>
            <CountrySelect
              value={form.country}
              onChange={(val) => setForm({ ...form, country: val })}
              countries={countries}
              placeholder="e.g., USA, UK, France"
            />
          </div>
          <div>
            <label style={{ fontSize: '0.8rem', fontWeight: 600, color: '#475569', display: 'block', marginBottom: '0.25rem' }}>
              Markup Percentage (%) *
            </label>
            <input
              type="number"
              min="0"
              step="0.01"
              className="pricing-select"
              placeholder="e.g., 15"
              value={form.markupPercentage}
              onChange={(e) => setForm({ ...form, markupPercentage: e.target.value })}
            />
          </div>
        </div>

        <div style={{ marginTop: '1rem' }}>
          <label style={{ fontSize: '0.8rem', fontWeight: 600, color: '#475569', display: 'block', marginBottom: '0.25rem' }}>
            Address
          </label>
          <input
            type="text"
            className="pricing-select"
            placeholder="Full Address"
            value={form.address}
            onChange={(e) => setForm({ ...form, address: e.target.value })}
          />
        </div>

        <div style={{ marginTop: '1rem' }}>
          <label style={{ fontSize: '0.8rem', fontWeight: 600, color: '#475569', display: 'block', marginBottom: '0.25rem' }}>
            Notes
          </label>
          <textarea
            className="pricing-select"
            rows={3}
            placeholder="Additional notes about this client"
            value={form.notes}
            style={{ resize: 'vertical', minHeight: '70px', fontFamily: 'inherit' }}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
          />
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '1.25rem' }}>
          <button
            type="button"
            className="secondary-btn"
            style={{ flex: '0 0 auto', padding: '0.5rem 1.25rem', fontSize: '0.85rem' }}
            onClick={onCancel}
          >
            Cancel
          </button>
          <button type="submit" className="primary-btn" style={{ background: '#0d7478', width: 'auto', padding: '0.5rem 1.25rem', fontSize: '0.85rem' }}>
            Create Client
          </button>
        </div>
      </form>
    </div>
  );
}

export default ClientForm;