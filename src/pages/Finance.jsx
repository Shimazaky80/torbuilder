import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { useToast } from '../context/ToastContext';
import { useCurrencies } from '../hooks/useCurrencies';
import { useListRowLimit } from '../hooks/useListRowLimit';
import { postInvoice, postReceipt, postCreditNote, postCostOfSales, costOfSalesFromDayItems, diffAgainstBilledLines, decideReissue, lineKey, CHART_OF_ACCOUNTS } from '../lib/financeJournal';
import { ReceiptsPanel, JournalPanel, TenantCostOfSalesPanel, AccountingPanel } from '../components/finance/FinanceTenantViews';
import {
  round2,
  fmtMoney,
  numOr,
  vatOfInclusive,
  effectiveBalance,
  TYPE_LABEL,
  STATUS_META,
  LOGO_WIDTHS,
  mailTo,
  clipboardCopy,
  downloadBlob,
  openPrintWindow,
  buildCurrencyLines,
  accountingPayload,
  invoiceEmail,
  receiptEmail,
  creditNotePayload,
  creditNoteEmail,
  invoiceDocHtml,
  receiptDocHtml,
  creditNoteDocHtml,
  invoiceExcelHtml,
  docLines,
  showSupplierIn,
  showMealPlanOn,
  abbrevMealPlan,
  isZar,
  taxWordOf,
  taxWordUpper,
  taxDisplayLabel
} from '../lib/invoiceDoc';
import { computePerPersonRows, breakdownSnapshot } from '../lib/perPersonPricing';
import { accommodationBreakdown } from '../lib/accommodationBreakdown';
import {
  Receipt,
  Plus,
  X,
  Check,
  Printer,
  Send,
  Copy,
  Ban,
  AlertTriangle,
  CheckCircle2,
  Download,
  Search,
  Landmark,
  FileText,
  RefreshCw,
  FileCheck2,
  FileSpreadsheet
} from 'lucide-react';

export const Finance = () => {
  const { showToast } = useToast();
  const { currencies } = useCurrencies();
  const [companyId, setCompanyId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [fetchingInvoices, setFetchingInvoices] = useState(false);
  const [invoices, setInvoices] = useState([]);
  const [totalInvoices, setTotalInvoices] = useState(null);
  const [billing, setBilling] = useState(null);
  const [bankAccounts, setBankAccounts] = useState([]);
  const [statusFilter, setStatusFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');
  const [search, setSearch] = useState('');
  const searchTimeoutRef = useRef(null);
  const { limit: pageSize } = useListRowLimit();

  /* Tenant-wide finance views. Loaded together so the tabs, the ledger totals
     and the cost-of-sales figures can never disagree with each other. */
  const [activeTab, setActiveTab] = useState('invoices');
  const [journalEntries, setJournalEntries] = useState([]);
  const [allReceipts, setAllReceipts] = useState([]);
  const [tenancyRows, setTenancyRows] = useState([]);
  const [tenancyItineraries, setTenancyItineraries] = useState([]);
  const [connections, setConnections] = useState([]);
  const [busyProvider, setBusyProvider] = useState(null);

  const [viewing, setViewing] = useState(null);
  const [viewLines, setViewLines] = useState([]);
  const [viewReceipts, setViewReceipts] = useState([]);
  const [viewCreditNotes, setViewCreditNotes] = useState([]);
  const [receiptPromptFor, setReceiptPromptFor] = useState(null);
  const [receiptForm, setReceiptForm] = useState({ payment_method: 'EFT', payment_reference: '', received_date: '' });
  const [issuingReceipt, setIssuingReceipt] = useState(false);

  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardStep, setWizardStep] = useState(1);
  const [itineraries, setItineraries] = useState([]);
  const [itinerariesLoading, setItinerariesLoading] = useState(false);
  const [selectedItinerary, setSelectedItinerary] = useState(null);
  const [selectedCurrency, setSelectedCurrency] = useState('');
  const [itineraryRates, setItineraryRates] = useState(new Map());
  const [itineraryAgeRanges, setItineraryAgeRanges] = useState(new Map());
  const [selectedBankId, setSelectedBankId] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [issuing, setIssuing] = useState(false);

  const symOf = useCallback((code) => {
    const c = currencies.find((x) => (x.code || '').toUpperCase() === (code || '').toUpperCase());
    return c?.symbol || code || '';
  }, [currencies]);

  const fetchCompanyId = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;
    const { data: profile } = await supabase.from('profiles').select('company_id').eq('id', user.id).single();
    return profile?.company_id || null;
  }, []);

  const fetchInvoices = useCallback(async (cid, { offset = 0, append = false } = {}) => {
    setFetchingInvoices(true);
    try {
      const esc = (t) => t.replace(/[\\%_]/g, (m) => '\\' + m);
      const term = (search || '').replace(/[,()]/g, ' ').trim();
      let invoiceQuery = supabase
        .from('invoices')
        .select('*, itineraries(reference_number, itinerary_name), clients(name)', { count: 'exact' })
        .eq('company_id', cid);

      if (term) {
        const t = esc(term);
        invoiceQuery = invoiceQuery.or(`invoice_number.ilike.%${t}%,bill_to_name.ilike.%${t}%`);
      }

      const { data, count, error } = await invoiceQuery
        .order('created_at', { ascending: false })
        .range(offset, offset + pageSize - 1);

      if (error) throw error;
      setInvoices((prev) => {
        if (!append) return data || [];
        const merged = new Map([...prev.map(v => [v.id, v]), ...(data || []).map(v => [v.id, v])]);
        return Array.from(merged.values());
      });
      setTotalInvoices(count ?? (data || []).length);
    } finally {
      setFetchingInvoices(false);
    }
  }, [search, pageSize]);

  const fetchBilling = useCallback(async (cid) => {
    const { data, error } = await supabase.from('company_billing_settings').select('*').eq('company_id', cid).maybeSingle();
    if (error) throw error;
    setBilling(data || null);
  }, []);

  const fetchBanks = useCallback(async (cid) => {
    const { data, error } = await supabase.from('company_bank_accounts').select('*').eq('company_id', cid).order('is_default', { ascending: false });
    if (error) throw error;
    setBankAccounts(data || []);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const cid = await fetchCompanyId();
        if (cancelled) return;
        setCompanyId(cid);
        if (cid) {
          await Promise.all([fetchInvoices(cid), fetchBilling(cid), fetchBanks(cid)]);
        }
      } catch (err) {
        if (!cancelled) showToast(err.message || 'Failed to load invoices', 'error');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchCompanyId, fetchBilling, fetchBanks, showToast]);

  useEffect(() => {
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    searchTimeoutRef.current = setTimeout(() => {
      if (companyId) fetchInvoices(companyId);
    }, 350);
    return () => {
      if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    };
  }, [search, companyId, fetchInvoices]);

  const filtered = useMemo(() => {
    return invoices.filter((inv) => {
      if (statusFilter !== 'all' && inv.status !== statusFilter) return false;
      if (typeFilter !== 'all' && inv.invoice_type !== typeFilter) return false;
      return true;
    });
  }, [invoices, statusFilter, typeFilter]);

  /* ── Tenant-wide ledger, receipts, cost of sales and connections ────────── */
  const loadTenantFinance = useCallback(async (cid) => {
    const id = cid || companyId;
    if (!id) return;

    const [entriesRes, receiptsRes, itinsRes, connRes] = await Promise.all([
      supabase.from('journal_entries').select('*').eq('company_id', id).order('entry_date', { ascending: false }).order('created_at', { ascending: false }),
      supabase.from('invoice_receipts').select('*').eq('company_id', id).order('received_date', { ascending: false }),
      supabase.from('itineraries').select('id, reference_number, reference, status, client_id, clients(name)').eq('company_id', id),
      // Columns listed explicitly to keep `credentials` out of the browser. The
      // Accounting tab only ever renders status and last-sync metadata, and
      // `select('*')` here would hand OAuth material to the client the moment
      // anyone pasted a real token instead of a credential reference.
      supabase
        .from('accounting_connections')
        .select('id, company_id, provider, mode, status, last_sync_at, last_error, created_at, updated_at')
        .eq('company_id', id)
    ]);

    const entries = entriesRes.data || [];
    if (entries.length) {
      const { data: lines } = await supabase
        .from('journal_lines')
        .select('*')
        .in('entry_id', entries.map((e) => e.id))
        .order('sort_order', { ascending: true });
      setJournalEntries(entries.map((e) => ({ ...e, lines: (lines || []).filter((l) => l.entry_id === e.id) })));
    } else {
      setJournalEntries([]);
    }
    setAllReceipts(receiptsRes.data || []);
    setConnections(connRes.data || []);

    const itins = (itinsRes.data || []).map((i) => ({ ...i, client_name: i.clients?.name || '' }));
    setTenancyItineraries(itins);

    /* Cost of sales is derived from the persisted day items rather than the
       live builder state, so it reflects what was actually saved. */
    const itinIds = itins.map((i) => i.id);
    if (itinIds.length) {
      const { data: days } = await supabase
        .from('itinerary_days')
        .select('id, itinerary_id')
        .in('itinerary_id', itinIds);
      const dayIds = (days || []).map((d) => d.id);
      if (dayIds.length) {
        const { data: items } = await supabase
          .from('itinerary_day_items')
          .select('itinerary_day_id, currency_code, total_buy, total_sell, tax_rate, is_included')
          .in('itinerary_day_id', dayIds);
        const itinOfDay = new Map((days || []).map((d) => [d.id, d.itinerary_id]));
        setTenancyRows(costOfSalesFromDayItems((items || []).map((it) => ({ ...it, itinerary_id: itinOfDay.get(it.itinerary_day_id) }))));
      } else {
        setTenancyRows([]);
      }
    } else {
      setTenancyRows([]);
    }
  }, [companyId]);

  useEffect(() => {
    if (!companyId) return;
    let cancelled = false;
    (async () => {
      await loadTenantFinance(companyId);
      if (cancelled) return;
    })();
    return () => { cancelled = true; };
  }, [companyId, activeTab, loadTenantFinance]);

  /* Push the ledger out as a file the accounts team can import. Provider-
     specific dialects differ, so this emits the provider-agnostic journal plus
     a chart-of-accounts mapping they can map onto their own codes. */
  const pushLedgerFile = async (provider) => {
    if (!companyId) return;
    setBusyProvider(provider);
    try {
      const payload = {
        schema: 'torbuilder.ledger/v1',
        provider,
        generated_at: new Date().toISOString(),
        company_id: companyId,
        chart_of_accounts: CHART_OF_ACCOUNTS,
        entries: journalEntries.map((e) => ({
          entry_date: e.entry_date,
          reference: e.reference,
          source_type: e.source_type,
          narration: e.narration,
          itinerary_id: e.itinerary_id,
          currency: e.currency_code,
          total_debit: e.total_debit,
          total_credit: e.total_credit,
          lines: (e.lines || []).map((l) => ({
            account_code: l.account_code,
            account_name: l.account_name,
            line_type: l.line_type,
            amount: l.amount,
            description: l.description
          }))
        }))
      };
      downloadBlob(JSON.stringify(payload, null, 2), `${provider}-ledger-${new Date().toISOString().slice(0, 10)}.json`, 'application/json');
      await supabase.from('accounting_sync_log').insert([{
        company_id: companyId, provider, direction: 'push', status: 'success',
        records_count: journalEntries.length, message: 'Ledger exported by the user.'
      }]).then(() => {}).catch(() => {});
      showToast(`${journalEntries.length} journal entries exported for ${provider}`, 'success');
    } catch (err) {
      showToast(err.message || 'Export failed', 'error');
    } finally {
      setBusyProvider(null);
    }
  };

  const syncNow = async (provider) => {
    if (!companyId) return;
    setBusyProvider(provider);
    try {
      /* Live sync needs a server-side OAuth integration to hold provider
         credentials. Recording the attempt keeps the audit trail honest rather
         than silently reporting a sync that never happened. */
      await supabase.from('accounting_sync_log').insert([{
        company_id: companyId, provider, direction: 'live', status: 'error', records_count: 0,
        message: 'Live sync requires a server-side OAuth integration, which is not configured yet. Use Push to export the ledger.'
      }]).then(() => {}).catch(() => {});
      showToast('Live sync needs a server-side integration — use Push to export the ledger instead.', 'warning');
    } finally {
      setBusyProvider(null);
    }
  };

  const setConnectionMode = async (provider, mode) => {
    if (!companyId) return;
    const { error } = await supabase.from('accounting_connections').upsert(
      { company_id: companyId, provider, mode, status: 'disconnected' },
      { onConflict: 'company_id,provider' }
    );
    if (error) { showToast(error.message || 'Could not save the connection', 'error'); return; }
    await loadTenantFinance(companyId);
  };

  const postCostOfSalesRow = async (row) => {
    if (!companyId) return;
    /* Guard the write, not just the button: recognising cost creates a real
       supplier liability, and an uncommitted quotation is not an obligation. */
    const itin = tenancyItineraries.find((i) => i.id === row.itinerary_id);
    if (itin && !['confirmed', 'in_progress', 'completed'].includes(itin.status)) {
      showToast(`Cost of sales can only be recognised on a committed booking — ${itin.reference_number || itin.reference || 'this itinerary'} is ${itin.status}.`, 'warning');
      return;
    }
    try {
      const res = await postCostOfSales(companyId, {
        itineraryId: row.itinerary_id,
        reference: 'COS',
        narration: 'Cost of sales recognised from contracted rates',
        currencyCode: row.code,
        cost: row.cost
      });
      showToast(res.created ? 'Cost of sales posted to the journal' : 'Already posted — no duplicate created', 'success');
      await loadTenantFinance(companyId);
    } catch (err) {
      showToast(err.message || 'Could not post cost of sales', 'error');
    }
  };

  /* ── Wizard: load qualified itineraries (provisional → deposit, confirmed → final) */
  const openWizard = async () => {
    setWizardOpen(true);
    setWizardStep(1);
    setSelectedItinerary(null);
    setSelectedCurrency('');
    setItineraryRates(new Map());
    setSelectedBankId('');
    setDueDate('');
    setItinerariesLoading(true);
    try {
      const { data, error } = await supabase
        .from('itineraries')
        .select('id, reference_number, itinerary_name, status, travel_start_date, travel_end_date, currency_code, updated_at, clients(name)')
        .eq('company_id', companyId)
        .in('status', ['provisional', 'confirmed'])
        .order('updated_at', { ascending: false });
      if (error) throw error;
      setItineraries(data || []);
    } catch (err) {
      showToast(err.message || 'Failed to load itineraries', 'error');
    } finally {
      setItinerariesLoading(false);
    }
  };

  const loadItinerary = async (id) => {
    try {
      const { data, error } = await supabase
        .from('itineraries')
        .select('*, clients(name, email, address, deposit_percentage, logo_data_url, contact_tel, contact_cell, contact_website), itinerary_days(day_number, day_date, itinerary_day_items(item_name, description_override, category, supplier_name, currency_code, pax, total_sell, tax_rate, tax_label, meal_plan, is_included, sort_order, item_id, room_allocations, markup_percentage))')
        .eq('id', id)
        .single();
      if (error) throw error;
      /* Contracted Library rates for the itinerary's accommodation items, used
         to derive the per-person breakdown (single / sharing / child classes)
         from the stored room allocations. */
      const ratesMap = new Map();
      const ids = [...new Set((data.itinerary_days || [])
        .flatMap((d) => (d.itinerary_day_items || []).map((it) => it.item_id))
        .filter(Boolean))];
      if (ids.length) {
        const { data: rates } = await supabase
          .from('item_rates')
          .select('*')
          .in('item_id', ids);
        (rates || []).forEach((r) => {
          const k = String(r.item_id);
          if (!ratesMap.has(k)) ratesMap.set(k, []);
          ratesMap.get(k).push(r);
        });
        const { data: libItems } = await supabase
          .from('library_items')
          .select('id, child_age_ranges')
          .in('id', ids);
        const ageMap = new Map();
        (libItems || []).forEach((li) => ageMap.set(String(li.id), li.child_age_ranges || []));
        setItineraryAgeRanges(ageMap);
      }
      setItineraryRates(ratesMap);
      setSelectedItinerary(data);
      setWizardStep(2);
    } catch (err) {
      showToast(err.message || 'Failed to load itinerary services', 'error');
    }
  };

  /* Payments actually received, per currency, for this itinerary. A deposit
     invoice only ever counts its deposit_amount (the full total_incl is not
     paid), and a paid final counts the balance it billed. */
  const paidByCurrency = useMemo(() => {
    const map = new Map();
    invoices.forEach((inv) => {
      if (inv.itinerary_id !== selectedItinerary?.id || inv.status !== 'paid') return;
      const code = (inv.currency_code || '').toUpperCase();
      if (!map.has(code)) map.set(code, { deposit: 0, final: 0 });
      const rec = map.get(code);
      if (inv.invoice_type === 'final') rec.final += round2(Number(inv.total_incl) - (Number(inv.credited_amount) || 0));
      else rec.deposit += Number(inv.deposit_amount) || Number(inv.total_incl) || 0;
    });
    return map;
  }, [invoices, selectedItinerary]);

  /* A currency can be invoiced whenever it still has an outstanding balance.
     Once the deposit is paid the next invoice is the final one (it credits the
     deposit); while nothing is paid yet it is the deposit request. */
  const currencyGroups = useMemo(() => {
    if (!selectedItinerary) return [];
    const paxCount = (Number(selectedItinerary.num_adults) || 0) + (Number(selectedItinerary.num_children) || 0) || 1;
    const codes = new Set();
    (selectedItinerary.itinerary_days || []).forEach((d) => {
      (d.itinerary_day_items || []).forEach((it) => {
        if (it.is_included === false) return;
        codes.add((it.currency_code || selectedItinerary.currency_code || 'ZAR').toUpperCase());
      });
    });
    return [...codes].sort().map((code) => {
      const agg = buildCurrencyLines(selectedItinerary, code, paxCount);
      const paid = paidByCurrency.get(code) || { deposit: 0, final: 0 };
      const paidTotal = round2(paid.deposit + paid.final);
      const outstanding = round2(agg.totalIncl - paidTotal);
      const hasPaidDeposit = paid.deposit > 0;
      const liveDeposit = invoices.some((inv) => inv.itinerary_id === selectedItinerary.id
        && (inv.currency_code || '').toUpperCase() === code && inv.invoice_type === 'deposit' && inv.status !== 'void' && inv.status !== 'paid');

      /* Per-person breakdown (Per person sharing / Single supplement / Per
         child) for this currency, from the itinerary's room allocations and
         contracted Library rates. Stored on the invoice as an immutable
         snapshot when issued. */
      const travellers = [];
      for (let i = 0; i < (Number(selectedItinerary.num_adults) || 0); i += 1) travellers.push({ age: 30 });
      for (let i = 0; i < (Number(selectedItinerary.num_children) || 0); i += 1) travellers.push({ age: 8 });
      const services = [];
      (selectedItinerary.itinerary_days || []).forEach((d) => {
        (d.itinerary_day_items || []).forEach((it) => {
          if (it.is_included === false) return;
          const ccy = (it.currency_code || selectedItinerary.currency_code || 'ZAR').toUpperCase();
          if (ccy !== code) return;
          const pax = Number(it.pax) || paxCount || 1;
          services.push({
            category: it.category || '',
            currencyCode: ccy,
            sellPP: (Number(it.total_sell) || 0) / pax,
            taxRate: it.tax_rate,
            itemId: it.item_id || null,
            roomAllocations: Array.isArray(it.room_allocations) ? it.room_allocations : [],
            markup: Number(it.markup_percentage) || 0
          });
        });
      });
      const rateBy = (itemId) => {
        if (!itemId) return null;
        const arr = itineraryRates.get(String(itemId)) || [];
        const rate = arr.find((r) => (r.currency || '').toUpperCase() === code) || arr[0] || null;
        return rate ? { ...rate, _ageRanges: itineraryAgeRanges.get(String(itemId)) || [] } : null;
      };
      const perPersonBreakdown = breakdownSnapshot(computePerPersonRows({ services, travellers, rateBy }));

      /* Expanded daily lines for this currency: used when the Presentation
         preference is "Service per day (detailed)" with accommodation lines
         split per occupied room. Non-accommodation services stay on their own
         lines exactly as billed; each night stop is instead decomposed into
         one line per occupied room (e.g. 2A / 1A / 2A, 1C) priced against the
         contracted Library rate and reconciled to the billed accommodation
         total. When the room-split setting is off this stays null so the
         standard itemisation is used unchanged. */
      let expandedLines = null;
      if (billing?.pricing_breakdown_mode === 'daily' && billing?.pricing_breakdown_accommodation === 'rooms') {
        expandedLines = [];
        const fallbackAdults = Number(selectedItinerary.num_adults) || 0;
        const fallbackChildren = Number(selectedItinerary.num_children) || 0;
        let sort = 0;
        (selectedItinerary.itinerary_days || [])
          .slice()
          .sort((a, b) => (a.day_number || 0) - (b.day_number || 0))
          .forEach((d) => {
            (d.itinerary_day_items || []).forEach((it) => {
              if (it.is_included === false) return;
              const ccy = (it.currency_code || selectedItinerary.currency_code || 'ZAR').toUpperCase();
              if (ccy !== code) return;
              const pax = Number(it.pax) || paxCount || 1;
              const taxRate = numOr(it.tax_rate, agg.taxEntries[0]?.rate ?? 0);
              const gross = round2(Number(it.total_sell) || 0);
              const vat = round2(vatOfInclusive(gross, taxRate));
              const net = round2(gross - vat);
              const label = taxDisplayLabel(code, it.tax_label || '', taxRate);
              const baseLine = {
                day_number: d.day_number || 1,
                service_date: d.day_date || null,
                /* Stable identity of the priced line. Carried into the invoice's
                   accounting_export so a later comparison against this itinerary
                   can tell a repriced service from a replaced one, rather than
                   matching on a description the user is free to edit. */
                item_id: it.item_id || null,
                item_name: it.description_override || it.item_name || 'Service',
                category: it.category || '',
                supplier_name: it.supplier_name || '',
                meal_plan: it.meal_plan || '',
                subtotal_excl: net,
                tax_amount: vat,
                line_total: gross,
                tax_label: label,
                tax_rate: taxRate,
                currency_code: ccy
              };
              if (!/accommodation/i.test(it.category || '')) {
                expandedLines.push({
                  ...baseLine,
                  quantity: pax,
                  unit_price: round2(gross / (pax || 1)),
                  sort_order: sort++
                });
                return;
              }
              const itemId = it.item_id || null;
              const baseRate = itemId ? rateBy(itemId) : null;
              const bd = accommodationBreakdown({
                mode: 'rooms',
                lineTotal: gross,
                rooms: Array.isArray(it.room_allocations) ? it.room_allocations : [],
                rate: baseRate,
                ageRanges: Array.isArray(baseRate?._ageRanges) ? baseRate._ageRanges : [],
                markup: Number(it.markup_percentage) || 0,
                taxRate,
                fallbackAdults,
                fallbackChildren
              });
              bd.rows.forEach((r) => {
                expandedLines.push({
                  ...baseLine,
                  quantity: r.qty,
                  qty_text: true,
                  qty_title: r.qtyTitle,
                  unit_price: r.unit,
                  subtotal_excl: r.subExcl,
                  tax_amount: r.tax,
                  line_total: r.lineTotal,
                  sort_order: sort++
                });
              });
            });
          });
      }

      /* An itinerary may carry several live invoices while the travellers are
         still travelling. Issuing stops only when there is no money still
         outstanding, or when the most recent invoice for this currency is an
         untouched deposit proforma (so we never stack a new one on top of a
         request that has not been paid yet).

         Once the booking is SETTLED, that is not enough on its own: the app
         used to stack a second invoice onto a trip already billed in full. The
         settled invoice's pricing snapshot is diffed against the itinerary as
         it now stands, and a further invoice is only offered when something
         genuinely moved or the client reopened the booking. */
      const settledInvoice = [...invoices]
        .filter((inv) => inv.itinerary_id === selectedItinerary.id
          && (inv.currency_code || '').toUpperCase() === code
          && inv.status !== 'void'
          && inv.accounting_export
          && Array.isArray(inv.accounting_export.lines)
          && inv.accounting_export.lines.length)
        .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))[0] || null;

      const settledDiff = settledInvoice
        ? diffAgainstBilledLines(settledInvoice.accounting_export.lines, agg.lines)
        : { changed: [], increase: 0, decrease: 0, unchanged: true };
      const reissue = decideReissue({
        outstanding,
        diff: settledDiff,
        itineraryStatus: selectedItinerary.status,
        currencyCode: code
      });

      let issueType = null;
      let blockReason = '';
      if (reissue.blocked) {
        blockReason = reissue.reason;
      } else if (reissue.settled) {
        /* Settled, but something changed: issue only the movement. */
        issueType = 'invoice';
      } else if (outstanding <= 0.009) {
        blockReason = 'Paid in full';
      } else if (liveDeposit) {
        blockReason = 'Deposit invoice issued';
      } else {
        issueType = 'deposit';
      }
      return {
        code,
        ...agg,
        perPersonBreakdown,
        expandedLines,
        paidTotal,
        outstanding,
        hasPaidDeposit,
        issueType,
        invoiced: !issueType,
        blockReason,
        settledInvoice,
        settledDiff,
        reissue
      };
    });
  }, [selectedItinerary, invoices, paidByCurrency, itineraryRates, itineraryAgeRanges, billing]);

  const selectedGroup = useMemo(
    () => currencyGroups.find((g) => g.code === selectedCurrency) || null,
    [currencyGroups, selectedCurrency]
  );

  const depositPct = useMemo(() => {
    const fromClient = selectedItinerary?.clients?.deposit_percentage;
    if (fromClient !== null && fromClient !== undefined && fromClient !== '') return Number(fromClient);
    if (billing?.default_deposit_percentage !== null && billing?.default_deposit_percentage !== undefined) return Number(billing.default_deposit_percentage);
    return 30;
  }, [selectedItinerary, billing]);

  const depositCreditPreview = useMemo(() => {
    if (!selectedItinerary || !selectedCurrency) return { amount: 0, number: '' };
    const rows = invoices.filter((inv) => inv.itinerary_id === selectedItinerary.id
      && (inv.currency_code || '').toUpperCase() === selectedCurrency.toUpperCase()
      && inv.invoice_type === 'deposit' && inv.status === 'paid');
    const amount = round2(rows.reduce((a, r) => a + (Number(r.deposit_amount) || Number(r.total_incl) || 0), 0));
    return { amount, number: rows[0]?.invoice_number || '' };
  }, [invoices, selectedItinerary, selectedCurrency]);

  const availableBanks = useMemo(
    () => bankAccounts.filter((b) => b.is_active && (b.currency_code || '').toUpperCase() === (selectedCurrency || '').toUpperCase()),
    [bankAccounts, selectedCurrency]
  );

  const chosenBank = useMemo(
    () => availableBanks.find((b) => b.id === selectedBankId) || availableBanks.find((b) => b.is_default) || availableBanks[0] || null,
    [availableBanks, selectedBankId]
  );

  const handleIssue = async () => {
    if (!selectedGroup) return;
    if (!selectedGroup.issueType) {
      showToast(selectedGroup.blockReason || `${TYPE_LABEL.deposit} already exists for ${selectedGroup.code}`, 'warning');
      return;
    }
    setIssuing(true);
    try {
      /* A settled booking with a change bills ONLY what moved. Re-billing the
         unchanged part is the double-count the guard exists to prevent, so the
         delta becomes the whole document: header totals and line items alike. */
      const settledDelta = selectedGroup.reissue?.settled
        ? (selectedGroup.reissue.options.find((o) => o.kind === 'invoice')?.amount || 0)
        : 0;
      const isDelta = settledDelta > 0.009;
      const gross = isDelta ? settledDelta : selectedGroup.totalIncl;
      /* Apportion the group's net share onto the movement, so a delta document
         carries a believable VAT figure rather than the whole trip's tax. */
      const groupTotal = round2(selectedGroup.totalIncl);
      const netRatio = groupTotal > 0 ? round2(selectedGroup.subtotalExcl) / groupTotal : 1;
      const deltaNet = isDelta ? round2(gross * netRatio) : round2(selectedGroup.subtotalExcl);
      const pct = depositPct;
      const isFinal = selectedGroup.issueType === 'final';

      let creditedAmount = 0;
      let creditedInvoiceId = null;
      let creditedInvoiceNumber = '';
      let depositAmount = 0;

      if (isFinal) {
        const { data: depositRows } = await supabase
          .from('invoices')
          .select('id, invoice_number, deposit_amount, total_incl, status')
          .eq('itinerary_id', selectedItinerary.id)
          .eq('currency_code', selectedGroup.code)
          .eq('invoice_type', 'deposit')
          .neq('status', 'void')
          .order('created_at', { ascending: false });
        const paid = (depositRows || []).filter((r) => r.status === 'paid');
        creditedAmount = round2(paid.reduce((a, r) => a + (Number(r.deposit_amount) || Number(r.total_incl) || 0), 0));
        if (paid[0]) {
          creditedInvoiceId = paid[0].id;
          creditedInvoiceNumber = paid[0].invoice_number;
        }
        depositAmount = creditedAmount;
      } else {
        depositAmount = round2(gross * (pct / 100));
      }
      const balance = round2(gross - creditedAmount);

      const { data: number, error: numErr } = await supabase.rpc('get_next_invoice_reference', { p_company_id: companyId });
      if (numErr || !number) throw new Error(numErr?.message || 'Could not allocate invoice number');

      const client = selectedItinerary.clients || {};
      const bankDetails = chosenBank ? {
        bank_name: chosenBank.bank_name,
        account_holder_name: chosenBank.account_holder_name,
        account_number: chosenBank.account_number,
        branch_code: chosenBank.branch_code,
        swift_code: chosenBank.swift_code
      } : {};

      const header = {
        company_id: companyId,
        itinerary_id: selectedItinerary.id,
        client_id: selectedItinerary.client_id || null,
        invoice_number: number,
        /* A delta is a neutral supplementary invoice, not a deposit request and
           not a fresh final. 'invoice' is the type the lifecycle migration
           already allows for exactly this. */
        invoice_type: isDelta ? 'invoice' : selectedGroup.issueType,
        status: isDelta ? 'validated' : (isFinal ? 'validated' : 'proforma'),
        currency_code: selectedGroup.code,
        /* On a delta the tax is apportioned off the movement, with net as the
           balancing figure so the document's own totals add up exactly. */
        subtotal_excl: deltaNet,
        tax_total: round2(gross - deltaNet),
        total_incl: gross,
        tax_label: selectedGroup.taxEntries[0]?.label || 'Tax',
        tax_rate: selectedGroup.taxEntries[0]?.rate ?? 0,
        deposit_percentage: pct,
        deposit_amount: depositAmount,
        balance_due: balance,
        credited_invoice_id: creditedInvoiceId,
        credited_invoice_number: creditedInvoiceNumber,
        credited_amount: creditedAmount,
        issued_date: new Date().toISOString().slice(0, 10),
        due_date: dueDate || null,
        bill_to_name: client.name || '',
        bill_to_email: client.email || '',
        bill_to_address: client.address || '',
        bill_to_tel: client.contact_tel || '',
        bill_to_cell: client.contact_cell || '',
        bill_to_website: client.contact_website || '',
        bill_to_logo_data_url: client.logo_data_url || '',
        supplier_name: billing?.legal_name || '',
        supplier_tax_number: billing?.tax_number || '',
        supplier_address: billing?.billing_address || '',
        bank_details: bankDetails,
        per_person_breakdown: selectedGroup.perPersonBreakdown || null,
        notes: null
      };

      /* A delta document itemises only what moved, so the printed invoice
         cannot be mistaken for a second charge for the whole trip. */
      const deltaKeys = new Set((selectedGroup.settledDiff?.changed || [])
        .filter((c) => c.grossDelta > 0)
        .map((c) => c.key));
      const issueLines = isDelta
        ? selectedGroup.lines.filter((l) => deltaKeys.has(lineKey(l)) || deltaKeys.size === 0)
        : selectedGroup.lines;

      const accounting = accountingPayload({ ...header, bank_details: bankDetails }, issueLines);
      const { data: created, error: invErr } = await supabase
        .from('invoices')
        .insert([{ ...header, accounting_export: accounting }])
        .select('*')
        .single();
      if (invErr) throw invErr;

      const lineRows = issueLines.map((l) => ({ ...l, invoice_id: created.id, company_id: companyId }));
      const { error: lineErr } = await supabase.from('invoice_line_items').insert(lineRows);
      if (lineErr) {
        await supabase.from('invoices').delete().eq('id', created.id);
        throw lineErr;
      }

      await fetchInvoices(companyId);
      setWizardOpen(false);
      /* A deposit is created as a proforma draft and posts nothing until it is
         validated; a final invoice is created validated and posts now. */
      if (created.status && created.status !== 'proforma') {
        await postInvoice(companyId, created);
      }
      showToast(`${TYPE_LABEL[selectedGroup.issueType]} ${number} issued`, 'success');
    } catch (err) {
      const msg = /duplicate key|unique/i.test(err.message || '')
        ? `A ${selectedGroup.issueType} invoice already exists for ${selectedGroup.code}`
        : (err.message || 'Failed to issue invoice');
      showToast(msg, 'error');
    } finally {
      setIssuing(false);
    }
  };

  /* Load stored line items; if the immutable snapshot is missing, rebuild the
     exact service lines from the persisted itinerary so they always display. */
  const loadInvoiceLines = useCallback(async (inv) => {
    const { data, error } = await supabase
      .from('invoice_line_items')
      .select('*')
      .eq('invoice_id', inv.id)
      .order('day_number', { ascending: true })
      .order('sort_order', { ascending: true });
    if (error) throw error;
    if (data && data.length) return data;
    if (!inv.itinerary_id) return [];
    const { data: itin, error: itinErr } = await supabase
      .from('itineraries')
      .select('*, itinerary_days(day_number, day_date, itinerary_day_items(item_name, description_override, category, supplier_name, currency_code, pax, total_sell, tax_rate, tax_label, meal_plan, is_included, sort_order))')
      .eq('id', inv.itinerary_id)
      .maybeSingle();
    if (itinErr || !itin) return [];
    const paxCount = (Number(itin.num_adults) || 0) + (Number(itin.num_children) || 0) || 1;
    const agg = buildCurrencyLines(itin, (inv.currency_code || '').toUpperCase(), paxCount);
    return agg.lines.map((l, i) => ({ ...l, id: `rebuilt-${i}`, invoice_id: inv.id }));
  }, []);

  const openView = async (inv) => {
    setViewing(inv);
    setViewLines([]);
    setViewReceipts([]);
    setViewCreditNotes([]);
    try {
      setViewLines(await loadInvoiceLines(inv));
    } catch (err) {
      showToast(err.message || 'Failed to load invoice lines', 'error');
    }
    try {
      const { data, error } = await supabase
        .from('invoice_receipts')
        .select('*')
        .eq('invoice_id', inv.id)
        .order('created_at', { ascending: false });
      if (error) throw error;
      setViewReceipts(data || []);
    } catch {
      setViewReceipts([]);
    }
    try {
      const { data, error } = await supabase
        .from('credit_notes')
        .select('*')
        .eq('invoice_id', inv.id)
        .order('created_at', { ascending: false });
      if (error) throw error;
      setViewCreditNotes(data || []);
    } catch {
      setViewCreditNotes([]);
    }
  };

  const reloadViewing = async (id) => {
    const { data } = await supabase.from('invoices').select('*').eq('id', id).maybeSingle();
    if (data) setViewing(data);
    const { data: receiptData } = await supabase
      .from('invoice_receipts')
      .select('*')
      .eq('invoice_id', id)
      .order('created_at', { ascending: false });
    setViewReceipts(receiptData || []);
    const { data: creditData } = await supabase
      .from('credit_notes')
      .select('*')
      .eq('invoice_id', id)
      .order('created_at', { ascending: false });
    setViewCreditNotes(creditData || []);
    return data;
  };

  const markPaid = async (inv) => {
    try {
      const { error } = await supabase
        .from('invoices')
        .update({ status: 'paid', paid_at: new Date().toISOString() })
        .eq('id', inv.id);
      if (error) throw error;
      await fetchInvoices(companyId);
      setViewing((v) => (v && v.id === inv.id ? { ...v, status: 'paid' } : v));
      showToast(`${inv.invoice_number} marked as paid`, 'success');
    } catch (err) {
      showToast(err.message || 'Failed to update invoice', 'error');
    }
  };

  const receiptDefaults = (inv) => {
    const amount = inv.invoice_type === 'deposit'
      ? round2(Number(inv.deposit_amount) || 0)
      : round2(Number(inv.balance_due) || 0);
    const balanceRemaining = inv.invoice_type === 'deposit'
      ? round2(Number(inv.balance_due) || 0)
      : 0;
    return { amount, balanceRemaining };
  };

  const openReceiptPrompt = (inv) => {
    setReceiptPromptFor(inv);
    setReceiptForm({
      payment_method: 'EFT',
      payment_reference: inv.payment_reference || '',
      received_date: new Date().toISOString().slice(0, 10)
    });
  };

  const submitReceipt = async () => {
    const inv = receiptPromptFor;
    if (!inv) return;
    setIssuingReceipt(true);
    try {
      const { data: number, error: numErr } = await supabase.rpc('get_next_receipt_reference', { p_company_id: companyId });
      if (numErr || !number) throw new Error(numErr?.message || 'Could not allocate receipt number');

      const { amount, balanceRemaining } = receiptDefaults(inv);
      const receivedDate = receiptForm.received_date || new Date().toISOString().slice(0, 10);
      const row = {
        company_id: companyId,
        invoice_id: inv.id,
        receipt_number: number,
        invoice_number: inv.invoice_number,
        invoice_type: inv.invoice_type,
        currency_code: inv.currency_code,
        amount,
        balance_remaining: balanceRemaining,
        received_date: receivedDate,
        payment_method: receiptForm.payment_method || '',
        payment_reference: receiptForm.payment_reference || '',
        bill_to_name: inv.bill_to_name || '',
        bill_to_email: inv.bill_to_email || '',
        bill_to_tel: inv.bill_to_tel || '',
        bill_to_cell: inv.bill_to_cell || '',
        bill_to_website: inv.bill_to_website || '',
        bill_to_address: inv.bill_to_address || '',
        supplier_name: inv.supplier_name || '',
        supplier_tax_number: inv.supplier_tax_number || '',
        supplier_address: inv.supplier_address || '',
        bank_details: inv.bank_details || {},
        notes: null
      };
      const accounting = {
        schema: 'torbuilder.receipt/v1',
        provider_agnostic: true,
        receipt_number: number,
        invoice_number: inv.invoice_number,
        invoice_type: inv.invoice_type,
        status: 'paid',
        date: receivedDate,
        currency: inv.currency_code,
        customer: { name: row.bill_to_name, email: row.bill_to_email },
        amount,
        balance_remaining: balanceRemaining,
        method: row.payment_method,
        reference: row.payment_reference
      };

      const { data: created, error } = await supabase
        .from('invoice_receipts')
        .insert([{ ...row, accounting_export: accounting }])
        .select('*')
        .single();
      if (error) throw error;

      const paidUpdate = { status: 'paid', paid_at: new Date().toISOString(), payment_reference: row.payment_reference };
      if (inv.invoice_type === 'final') paidUpdate.balance_due = 0;
      const { error: paidErr } = await supabase
        .from('invoices')
        .update(paidUpdate)
        .eq('id', inv.id);
      if (paidErr) throw paidErr;

      /* A proforma deposit becomes a real document on payment, so its sale is
         recognised here. postInvoice is idempotent per invoice. */
      if (inv.status === 'proforma' || inv.status === 'draft') {
        await postInvoice(companyId, { ...inv, status: 'paid' });
      }
      await postReceipt(companyId, { ...row, id: created.id, accounting_export: accounting });

      await fetchInvoices(companyId);
      await reloadViewing(inv.id);
      setReceiptPromptFor(null);
      showToast(`Receipt ${number} issued`, 'success');
      if (created) setTimeout(() => printReceipt(created), 250);
    } catch (err) {
      showToast(err.message || 'Failed to issue receipt', 'error');
    } finally {
      setIssuingReceipt(false);
    }
  };

  const exportReceiptJson = (r) => {
    const payload = r.accounting_export && Object.keys(r.accounting_export).length ? r.accounting_export : { schema: 'torbuilder.receipt/v1', ...r };
    downloadBlob(JSON.stringify(payload, null, 2), `${r.receipt_number}.json`, 'application/json');
  };

  const printReceipt = (r) => {
    const w = openPrintWindow(receiptDocHtml(r, symOf(r.currency_code), branding), 250);
    if (!w) showToast('Please allow pop-ups to print the receipt', 'warning');
  };

  const exportReceiptWord = (r) => {
    downloadBlob(receiptDocHtml(r, symOf(r.currency_code), branding), `${r.receipt_number}.doc`, 'application/msword');
    showToast('Receipt exported as Word', 'success');
  };

  const emitReceiptEmail = (r) => {
    const m = receiptEmail(r, branding);
    if (!m.to) { showToast('No client email on file', 'warning'); return; }
    window.open(mailTo(m.to, m.subject, m.body), '_blank');
  };

  const copyReceipt = (r) => {
    const m = receiptEmail(r, branding);
    void clipboardCopy(`${m.subject}\n\n${m.body}`);
    showToast('Receipt copied to clipboard', 'success');
  };

  const exportCreditNoteJson = (cn) => {
    const payload = cn.accounting_export && Object.keys(cn.accounting_export).length ? cn.accounting_export : creditNotePayload(cn, []);
    downloadBlob(JSON.stringify(payload, null, 2), `${cn.credit_note_number}.json`, 'application/json');
  };

  const printCreditNote = (cn) => {
    const w = openPrintWindow(creditNoteDocHtml(cn, symOf(cn.currency_code), branding), 250);
    if (!w) showToast('Please allow pop-ups to print the credit note', 'warning');
  };

  const exportCreditNoteWord = (cn) => {
    downloadBlob(creditNoteDocHtml(cn, symOf(cn.currency_code), branding), `${cn.credit_note_number}.doc`, 'application/msword');
    showToast('Credit note exported as Word', 'success');
  };

  const emitCreditNoteEmail = (cn) => {
    const m = creditNoteEmail(cn, branding);
    if (!m.to) { showToast('No client email on file', 'warning'); return; }
    window.open(mailTo(m.to, m.subject, m.body), '_blank');
  };

  const copyCreditNote = (cn) => {
    const m = creditNoteEmail(cn, branding);
    void clipboardCopy(`${m.subject}\n\n${m.body}`);
    showToast('Credit note copied to clipboard', 'success');
  };

  /* Voiding ALWAYS raises a matching credit note so the client account balances
     and the itinerary/currency slot is freed for a replacement invoice. */
  const [voidTarget, setVoidTarget] = useState(null);
  const [voidReason, setVoidReason] = useState('');

  const voidInvoice = async (inv, lines) => {
    const trimmed = voidReason.trim();
    if (!trimmed) return;
    try {
      const { data: existing } = await supabase
        .from('credit_notes')
        .select('*')
        .eq('invoice_id', inv.id)
        .maybeSingle();

      let note = existing;
      if (!note) {
        const { data: cnNumber, error: cnErr } = await supabase.rpc('get_next_credit_note_reference', { p_company_id: companyId });
        if (cnErr || !cnNumber) throw new Error(cnErr?.message || 'Could not allocate credit note number');

        const { error: voidErr } = await supabase
          .from('invoices')
          .update({ status: 'void', void_reason: trimmed })
          .eq('id', inv.id);
        if (voidErr) throw voidErr;

        const cnRow = {
          company_id: companyId,
          invoice_id: inv.id,
          invoice_number: inv.invoice_number,
          invoice_type: inv.invoice_type,
          credit_note_number: cnNumber,
          status: 'issued',
          currency_code: inv.currency_code,
          subtotal_excl: inv.subtotal_excl,
          tax_total: inv.tax_total,
          total_incl: inv.total_incl,
          tax_label: inv.tax_label,
          tax_rate: inv.tax_rate,
          reason: trimmed,
          issued_date: new Date().toISOString().slice(0, 10),
          bill_to_name: inv.bill_to_name,
          bill_to_email: inv.bill_to_email,
          bill_to_address: inv.bill_to_address,
          bill_to_tel: inv.bill_to_tel,
          bill_to_cell: inv.bill_to_cell,
          bill_to_website: inv.bill_to_website,
          supplier_name: inv.supplier_name,
          supplier_tax_number: inv.supplier_tax_number,
          supplier_address: inv.supplier_address
        };
        const { data: createdCn, error: cnInsertErr } = await supabase
          .from('credit_notes')
          .insert([{ ...cnRow, accounting_export: creditNotePayload(cnRow, lines || []) }])
          .select('*')
          .single();
        if (cnInsertErr) {
          // Never leave an invoice voided without its credit note.
          await supabase.from('invoices').update({ status: inv.status, void_reason: null }).eq('id', inv.id);
          throw cnInsertErr;
        }
        note = createdCn;
        await supabase
          .from('invoices')
          .update({ credit_note_id: createdCn.id, credit_note_number: createdCn.credit_note_number })
          .eq('id', inv.id);
        /* The credit note is the reversing document, so the ledger reverses
           with it. Idempotent per credit note. */
        await postCreditNote(companyId, createdCn);
      }

      await fetchInvoices(companyId);
      await reloadViewing(inv.id);
      showToast(`${inv.invoice_number} voided and credited (${note.credit_note_number})`, 'success');
      setVoidTarget(null);
      setVoidReason('');
    } catch (err) {
      showToast(err.message || 'Failed to void invoice', 'error');
    }
  };

  const requestVoidInvoice = (inv) => {
    setVoidTarget(inv);
    setVoidReason(inv.void_reason || '');
  };

  const exportJson = (inv, lines) => {
    const payload = inv.accounting_export && Object.keys(inv.accounting_export).length
      ? inv.accounting_export
      : accountingPayload(inv, lines);
    downloadBlob(JSON.stringify(payload, null, 2), `${inv.invoice_number}.json`, 'application/json');
  };

  const exportExcel = (inv, lines) => {
    downloadBlob(invoiceExcelHtml(inv, lines, symOf(inv.currency_code), branding), `${inv.invoice_number}.xls`, 'application/vnd.ms-excel');
    showToast('Invoice exported as Excel', 'success');
  };

  const printInvoice = (inv, lines) => {
    const w = openPrintWindow(invoiceDocHtml(inv, lines, symOf(inv.currency_code), branding));
    if (!w) showToast('Please allow pop-ups to print the invoice', 'warning');
  };

  const exportInvoiceWord = (inv, lines) => {
    downloadBlob(invoiceDocHtml(inv, lines, symOf(inv.currency_code), branding), `${inv.invoice_number}.doc`, 'application/msword');
    showToast('Invoice exported as Word', 'success');
  };

  const emitEmail = (inv, lines) => {
    const m = invoiceEmail(inv, lines, branding);
    if (!m.to) { showToast('No client email on file', 'warning'); return; }
    window.open(mailTo(m.to, m.subject, m.body), '_blank');
  };

  const copyInvoice = (inv, lines) => {
    const m = invoiceEmail(inv, lines, branding);
    void clipboardCopy(`${m.subject}\n\n${m.body}`);
    showToast('Invoice copied to clipboard', 'success');
  };

  const badge = (status) => {
    const meta = STATUS_META[status] || STATUS_META.validated;
    return (
      <span style={{ background: meta.bg, color: meta.color, padding: '0.25rem 0.6rem', borderRadius: '999px', fontSize: '0.75rem', fontWeight: 700 }}>
        {meta.label}
      </span>
    );
  };

  const fieldStyle = { width: '100%', padding: '0.6rem 0.75rem', fontSize: '0.9rem' };
  const branding = {
    logo: billing?.logo_data_url || '',
    logoSize: billing?.logo_size || 'md',
    showSupplierInDescription: billing?.show_supplier_in_description !== false,
    pricingBreakdownMode: billing?.pricing_breakdown_mode || 'daily',
    showMealPlanOnAccommodation: billing?.show_meal_plan_on_accommodation !== false,
    logoPosition: ['left', 'center', 'right'].includes(billing?.logo_position) ? billing.logo_position : 'left',
    billingAddressPosition: ['left', 'center', 'right'].includes(billing?.billing_address_position) ? billing.billing_address_position : 'left',
    clientLogoSize: ['sm', 'md', 'lg'].includes(billing?.client_logo_size) ? billing.client_logo_size : 'md',
    clientLogoPosition: ['left', 'center', 'right'].includes(billing?.client_logo_position) ? billing.client_logo_position : 'left',
    clientBillingAddressPosition: ['left', 'center', 'right'].includes(billing?.client_billing_address_position) ? billing.client_billing_address_position : 'left',
    companyContactEmail: billing?.contact_email || '',
    companyContactTel: billing?.contact_tel || '',
    companyContactCell: billing?.contact_cell || '',
    companyContactWebsite: billing?.contact_website || ''
  };

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h1 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '1.5rem', margin: 0 }}>
            <Receipt size={22} color="#0d7478" /> Finance
          </h1>
          <p style={{ color: '#64748b', margin: '0.35rem 0 0', fontSize: '0.9rem' }}>
            Issue one invoice per itinerary currency. Services are always taken from the itinerary and can never be edited here.
          </p>
        </div>
        <button type="button" className="primary-btn" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }} onClick={openWizard}>
          <Plus size={16} /> New Invoice
        </button>
      </div>

      {/* Tenant-wide tabs. The per-itinerary view of the same data lives on the
          itinerary's own Finance tab; these are the cross-itinerary rollups. */}
      <div className="builder-tabs" style={{ marginTop: '1.25rem' }}>
        {[
          ['invoices', 'Invoices'],
          ['receipts', 'Receipts'],
          ['journal', 'Journal'],
          ['cost-of-sales', 'Cost of Sales'],
          ['accounting', 'Accounting']
        ].map(([id, label]) => (
          <button key={id} type="button" className={`builder-tab ${activeTab === id ? 'active' : ''}`} onClick={() => setActiveTab(id)}>
            {label}
          </button>
        ))}
      </div>

      {activeTab === 'invoices' && (
      <div className="admin-card" style={{ marginTop: '1.5rem' }}>
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center', marginBottom: '1rem' }}>
          <div style={{ position: 'relative', flex: '1 1 240px' }}>
            <Search size={15} style={{ position: 'absolute', left: '0.6rem', top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }} />
            <input className="sidebar-select" style={{ width: '100%', padding: '0.55rem 0.75rem 0.55rem 2rem', fontSize: '0.9rem' }} placeholder="Search number, client or itinerary…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <select className="sidebar-select" style={{ ...fieldStyle, width: 'auto' }} value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
            <option value="all">All types</option>
            <option value="deposit">Deposit</option>
            <option value="final">Final</option>
          </select>
          <select className="sidebar-select" style={{ ...fieldStyle, width: 'auto' }} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="all">All statuses</option>
            <option value="proforma">Proforma</option>
            <option value="validated">Validated</option>
            <option value="paid">Paid</option>
            <option value="void">Void</option>
          </select>
          <button type="button" className="icon-btn outline" title="Refresh" onClick={() => companyId && fetchInvoices(companyId)}>
            <RefreshCw size={15} />
          </button>
        </div>

        {loading ? (
          <div style={{ padding: '2rem 0', textAlign: 'center', color: '#94a3b8' }}>Loading invoices…</div>
        ) : filtered.length === 0 ? (
          <div style={{ padding: '2rem 0', textAlign: 'center', color: '#94a3b8' }}>
            {search.trim() ? 'No invoices match your search.' : <>No invoices yet. Click <b>New Invoice</b> to issue one from a provisional or confirmed itinerary.</>}
          </div>
        ) : (
          <table className="admin-table">
            <thead>
              <tr>
                <th>Invoice #</th>
                <th>Type</th>
                <th>Itinerary</th>
                <th>Client</th>
                <th>Currency</th>
                <th style={{ textAlign: 'right' }}>Total (Incl Tax)</th>
                <th>Status</th>
                <th>Issued</th>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((inv) => (
                <tr key={inv.id}>
                  <td style={{ fontWeight: 700 }}>{inv.invoice_number}</td>
                  <td>{TYPE_LABEL[inv.invoice_type] || inv.invoice_type}</td>
                  <td>{inv.itineraries?.reference_number || '—'}<div style={{ fontSize: '0.78rem', color: '#94a3b8' }}>{inv.itineraries?.itinerary_name || ''}</div></td>
                  <td>{inv.bill_to_name || '—'}</td>
                  <td style={{ fontWeight: 700, color: '#0d7478' }}>{inv.currency_code}</td>
                  <td style={{ textAlign: 'right', fontWeight: 700 }}>{fmtMoney(inv.total_incl, inv.currency_code)}</td>
                  <td>{badge(inv.status)}</td>
                  <td>{inv.issued_date}</td>
                  <td style={{ textAlign: 'right' }}>
                    <button type="button" className="secondary-btn" style={{ padding: '0.3rem 0.6rem', fontSize: '0.75rem' }} onClick={() => openView(inv)}>Open</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {invoices.length > 0 && totalInvoices != null && totalInvoices > invoices.length && (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '1rem' }}>
            <button
              type="button"
              className="secondary-btn"
              style={{ padding: '0.6rem 1.5rem' }}
              disabled={fetchingInvoices}
              onClick={() => companyId && fetchInvoices(companyId, { offset: invoices.length, append: true })}
            >
              {fetchingInvoices ? 'Loading…' : `Load more (${invoices.length} of ${totalInvoices} invoices)`}
            </button>
          </div>
        )}
      </div>
      )}

      {activeTab === 'receipts' && (
        <ReceiptsPanel receipts={allReceipts} onViewReceipt={(r) => printReceipt(r)} />
      )}

      {activeTab === 'journal' && (
        <JournalPanel
          entries={journalEntries}
          itineraries={tenancyItineraries}
          onExport={() => pushLedgerFile('general-ledger')}
        />
      )}

      {activeTab === 'cost-of-sales' && (
        <TenantCostOfSalesPanel
          rows={tenancyRows}
          itineraries={tenancyItineraries}
          onPost={postCostOfSalesRow}
        />
      )}

      {activeTab === 'accounting' && (
        <AccountingPanel
          connections={connections}
          onSetMode={setConnectionMode}
          onPush={pushLedgerFile}
          onSync={syncNow}
          busyProvider={busyProvider}
        />
      )}

      {/* View invoice */}
      {viewing && (
        <div className="modal-overlay">
          <div className="modal-content tall" style={{ maxWidth: '880px', width: '94%' }}>
            <div className="modal-header">
              <h2 style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
                {viewing.status === 'proforma' ? 'Proforma — ' : ''}{TYPE_LABEL[viewing.invoice_type] || 'Invoice'} {viewing.invoice_number}
                {badge(viewing.status)}
              </h2>
              <button className="close-btn" onClick={() => setViewing(null)}><X size={20} /></button>
            </div>

            <div className="modal-body">
              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
                <button type="button" className="secondary-btn" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }} onClick={() => printInvoice(viewing, viewLines)}>
                  <Printer size={15} /> Print / PDF
                </button>
                <button type="button" className="secondary-btn" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }} onClick={() => exportInvoiceWord(viewing, viewLines)}>
                  <FileText size={15} /> Word
                </button>
                <button type="button" className="secondary-btn" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }} onClick={() => exportExcel(viewing, viewLines)}>
                  <FileSpreadsheet size={15} /> Excel
                </button>
                <button type="button" className="secondary-btn" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }} onClick={() => exportJson(viewing, viewLines)}>
                  <Download size={15} /> JSON
                </button>
                <button type="button" className="secondary-btn" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }} onClick={() => emitEmail(viewing, viewLines)}>
                  <Send size={15} /> Email
                </button>
                <button type="button" className="secondary-btn" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }} onClick={() => copyInvoice(viewing, viewLines)}>
                  <Copy size={15} /> Copy
                </button>
                {(viewing.status === 'proforma' || viewing.status === 'validated') && (
                  <button type="button" className="primary-btn" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }} onClick={() => markPaid(viewing)}>
                    <CheckCircle2 size={15} /> Confirm Payment Received
                  </button>
                )}
                {viewing.status === 'paid' && (
                  <button type="button" className="primary-btn" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }} onClick={() => openReceiptPrompt(viewing)}>
                    <FileCheck2 size={15} /> Issue Receipt
                  </button>
                )}
                {viewing.status !== 'void' && (
                  <button type="button" className="secondary-btn" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', color: '#b91c1c' }}                 onClick={() => requestVoidInvoice(viewing)}>
                    <Ban size={15} /> Void
                  </button>
                )}
              </div>

              {viewing.status === 'proforma' && (
                <div style={{ background: '#fffbeb', border: '1px solid #fde68a', color: '#92400e', borderRadius: '10px', padding: '0.7rem 1rem', marginBottom: '1rem', fontSize: '0.88rem', fontWeight: 600 }}>
                  This is a <b>proforma</b> deposit request. It secures the booking but is not yet a tax invoice — confirm payment received, then issue a receipt.
                </div>
              )}

              <div style={{ border: '1px solid #e2e8f0', borderRadius: '12px', padding: '1.1rem 1.25rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem' }}>
                  <div>
                    {billing?.logo_data_url && <img src={billing.logo_data_url} alt="Company logo" style={{ display: 'block', maxWidth: `${LOGO_WIDTHS[billing.logo_size] || LOGO_WIDTHS.md}px`, maxHeight: '72px', objectFit: 'contain', marginBottom: '6px' }} />}
                    <div style={{ fontWeight: 800, fontSize: '1.05rem' }}>{viewing.supplier_name || 'Your Company'}</div>
                    {viewing.supplier_tax_number && <div style={{ fontSize: '0.85rem', color: '#64748b' }}>{isZar(viewing.currency_code) ? 'VAT / Tax No:' : 'Tax No:'} {viewing.supplier_tax_number}</div>}
                    {viewing.supplier_address && <div style={{ fontSize: '0.85rem', color: '#64748b', whiteSpace: 'pre-line' }}>{viewing.supplier_address}</div>}
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div>{badge(viewing.status)}</div>
                    <div style={{ fontSize: '0.85rem', color: '#64748b', marginTop: '0.35rem' }}>Issued: {viewing.issued_date}</div>
                    {viewing.due_date && <div style={{ fontSize: '0.85rem', color: '#64748b' }}>Due: {viewing.due_date}</div>}
                    {viewing.paid_at && <div style={{ fontSize: '0.85rem', color: '#047857' }}>Paid: {String(viewing.paid_at).slice(0, 10)}</div>}
                  </div>
                </div>
                <div style={{ marginTop: '0.85rem', textAlign: branding.clientBillingAddressPosition === 'center' ? 'center' : (branding.clientBillingAddressPosition === 'right' ? 'right' : 'left') }}>
                  <div style={{ fontSize: '0.8rem', color: '#94a3b8', textTransform: 'uppercase', fontWeight: 700 }}>Bill To</div>
                  {viewing.bill_to_logo_data_url && <img src={viewing.bill_to_logo_data_url} alt="Client logo" style={{ display: 'block', maxWidth: `${LOGO_WIDTHS[branding.clientLogoSize] || LOGO_WIDTHS.md}px`, maxHeight: '64px', objectFit: 'contain', marginBottom: '6px', marginLeft: branding.clientLogoPosition === 'center' ? 'auto' : (branding.clientLogoPosition === 'right' ? 'auto' : '0'), marginRight: branding.clientLogoPosition === 'center' ? 'auto' : (branding.clientLogoPosition === 'right' ? '0' : 'auto') }} />}
                  <div style={{ fontWeight: 700 }}>{viewing.bill_to_name || '—'}</div>
                  {viewing.bill_to_email && <div style={{ fontSize: '0.85rem', color: '#64748b' }}>{viewing.bill_to_email}</div>}
                  {(viewing.bill_to_tel || viewing.bill_to_cell) && <div style={{ fontSize: '0.85rem', color: '#64748b' }}>Tel: {[viewing.bill_to_tel, viewing.bill_to_cell].filter(Boolean).join(' · ')}</div>}
                  {viewing.bill_to_website && <div style={{ fontSize: '0.85rem', color: '#64748b' }}>Website: {viewing.bill_to_website}</div>}
                  {viewing.bill_to_address && <div style={{ fontSize: '0.85rem', color: '#64748b', whiteSpace: 'pre-line' }}>{viewing.bill_to_address}</div>}
                </div>

                <table className="admin-table" style={{ marginTop: '1rem' }}>
                  <thead>
                    <tr>
                      <th>Day</th>
                      <th>Description</th>
                      <th style={{ textAlign: 'right' }}>Qty</th>
                      <th style={{ textAlign: 'right' }}>Unit</th>
                      <th style={{ textAlign: 'right' }}>Subtotal (Excl {taxWordOf(viewing.currency_code)})</th>
                      <th style={{ textAlign: 'right' }}>{taxWordUpper(viewing.currency_code)}</th>
                      <th style={{ textAlign: 'right' }}>Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {docLines(viewing, viewLines, branding).map((l, i) => (
                      <tr key={l.id || i}>
                        <td>{l.day_number}</td>
                        <td>{l.item_name}{showMealPlanOn(l, branding) ? <> - {abbrevMealPlan(l.meal_plan)}</> : null}{showSupplierIn(l, branding) ? <div style={{ fontSize: '0.78rem', color: '#94a3b8' }}>{l.supplier_name}</div> : null}</td>
                        <td style={{ textAlign: l.qty_text ? 'left' : 'right' }}>{l.quantity}</td>
                        <td style={{ textAlign: 'right' }}>{fmtMoney(l.unit_price, symOf(viewing.currency_code))}</td>
                        <td style={{ textAlign: 'right' }}>{fmtMoney(l.subtotal_excl, symOf(viewing.currency_code))}</td>
                        <td style={{ textAlign: 'right' }}>{fmtMoney(l.tax_amount, symOf(viewing.currency_code))}</td>
                        <td style={{ textAlign: 'right', fontWeight: 700 }}>{fmtMoney(l.line_total, symOf(viewing.currency_code))}</td>
                      </tr>
                    ))}
                    <tr style={{ background: '#f8fafc' }}>
                      <td colSpan="6" style={{ textAlign: 'right', fontWeight: 700 }}>Subtotal (Excl {taxWordOf(viewing.currency_code)})</td>
                      <td style={{ textAlign: 'right', fontWeight: 800 }}>{fmtMoney(viewing.subtotal_excl, symOf(viewing.currency_code))}</td>
                    </tr>
                    <tr style={{ background: '#f8fafc' }}>
                      <td colSpan="6" style={{ textAlign: 'right', fontWeight: 700 }}>{isZar(viewing.currency_code) ? `${viewing.tax_label} (${Number(viewing.tax_rate)}%)` : `${taxWordUpper(viewing.currency_code)} (${taxDisplayLabel(viewing.currency_code, viewing.tax_label, viewing.tax_rate)} ${Number(viewing.tax_rate)}%)`}</td>
                      <td style={{ textAlign: 'right', fontWeight: 800 }}>{fmtMoney(viewing.tax_total, symOf(viewing.currency_code))}</td>
                    </tr>
                    <tr style={{ background: '#f0fdfa' }}>
                      <td colSpan="6" style={{ textAlign: 'right', fontWeight: 900 }}>{viewing.currency_code} TOTAL DUE ({isZar(viewing.currency_code) ? `INCL TAX ${viewing.tax_label}` : 'INCL TAX'})</td>
                      <td style={{ textAlign: 'right', fontWeight: 900 }}>{fmtMoney(viewing.total_incl, symOf(viewing.currency_code))}</td>
                    </tr>
                    {viewing.invoice_type === 'final' && Number(viewing.credited_amount) > 0 && (
                      <tr style={{ background: '#ecfdf5' }}>
                        <td colSpan="6" style={{ textAlign: 'right', fontWeight: 700, color: '#047857' }}>
                          Less deposit received{viewing.credited_invoice_number ? ` (${viewing.credited_invoice_number})` : ''}
                        </td>
                        <td style={{ textAlign: 'right', fontWeight: 800, color: '#047857' }}>-{fmtMoney(viewing.credited_amount, symOf(viewing.currency_code))}</td>
                      </tr>
                    )}
                    <tr style={{ background: '#eff6ff' }}>
                      <td colSpan="6" style={{ textAlign: 'right', fontWeight: 900 }}>
                        {viewing.invoice_type === 'final' ? 'BALANCE TO BE PAID' : 'BALANCE REMAINING AFTER DEPOSIT'}
                        {viewing.invoice_type === 'final' && viewing.status === 'paid' ? ' (settled)' : ''}
                      </td>
                      <td style={{ textAlign: 'right', fontWeight: 900 }}>{fmtMoney(effectiveBalance(viewing), symOf(viewing.currency_code))}</td>
                    </tr>
                  </tbody>
                </table>

                <div style={{ marginTop: '0.85rem', display: 'flex', gap: '1.5rem', flexWrap: 'wrap' }}>
                  {viewing.invoice_type === 'deposit' ? (
                    <>
                      <div><div style={{ fontSize: '0.78rem', color: '#94a3b8', fontWeight: 700 }}>Deposit requested ({Number(viewing.deposit_percentage)}%)</div><div style={{ fontWeight: 800 }}>{fmtMoney(viewing.deposit_amount, symOf(viewing.currency_code))}</div></div>
                      <div><div style={{ fontSize: '0.78rem', color: '#94a3b8', fontWeight: 700 }}>Balance remaining after deposit</div><div style={{ fontWeight: 800 }}>{fmtMoney(viewing.balance_due, symOf(viewing.currency_code))}</div></div>
                    </>
                  ) : (
                    <>
                      <div><div style={{ fontSize: '0.78rem', color: '#94a3b8', fontWeight: 700 }}>Less deposit received{viewing.credited_invoice_number ? ` (${viewing.credited_invoice_number})` : ''}</div><div style={{ fontWeight: 800, color: '#047857' }}>{fmtMoney(viewing.credited_amount, symOf(viewing.currency_code))}</div></div>
                      <div><div style={{ fontSize: '0.78rem', color: '#94a3b8', fontWeight: 700 }}>Balance to be paid</div><div style={{ fontWeight: 800 }}>{fmtMoney(effectiveBalance(viewing), symOf(viewing.currency_code))}</div></div>
                    </>
                  )}
                </div>

                <div style={{ marginTop: '0.85rem' }}>
                  <div style={{ fontSize: '0.8rem', color: '#94a3b8', textTransform: 'uppercase', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                    <Landmark size={13} /> Banking Details
                  </div>
                  {Object.entries(viewing.bank_details || {}).filter(([, v]) => v).length ? (
                    <div style={{ fontSize: '0.9rem' }}>
                      {Object.entries(viewing.bank_details).filter(([, v]) => v).map(([k, v]) => (
                        <div key={k}><span style={{ color: '#64748b' }}>{k.replace(/_/g, ' ')}:</span> {v}</div>
                      ))}
                    </div>
                  ) : <div style={{ fontSize: '0.9rem', color: '#94a3b8' }}>No bank account set for {viewing.currency_code}. Add one in Settings → Bank Accounts.</div>}
                </div>

                {viewing.status === 'void' && (
                  <div style={{ marginTop: '0.85rem', color: '#b91c1c', fontWeight: 700 }}>
                    VOIDED{viewing.void_reason ? ` — ${viewing.void_reason}` : ''}
                  </div>
                )}
              </div>

              {viewReceipts.length > 0 && (
                <div style={{ marginTop: '1.25rem' }}>
                  <div style={{ fontSize: '0.8rem', color: '#94a3b8', textTransform: 'uppercase', fontWeight: 700, marginBottom: '0.5rem' }}>
                    Receipts issued
                  </div>
                  <table className="admin-table">
                    <thead>
                      <tr>
                        <th>Receipt #</th>
                        <th>Date</th>
                        <th style={{ textAlign: 'right' }}>Amount</th>
                        <th style={{ textAlign: 'right' }}>Balance</th>
                        <th style={{ textAlign: 'right' }}>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {viewReceipts.map((r) => (
                        <tr key={r.id}>
                          <td style={{ fontWeight: 700 }}>{r.receipt_number}</td>
                          <td>{r.received_date}</td>
                          <td style={{ textAlign: 'right', fontWeight: 700 }}>{fmtMoney(r.amount, symOf(r.currency_code))}</td>
                          <td style={{ textAlign: 'right' }}>{fmtMoney(r.balance_remaining, symOf(r.currency_code))}</td>
                          <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                            <button type="button" className="secondary-btn" style={{ padding: '0.25rem 0.5rem', fontSize: '0.72rem', marginRight: '0.3rem' }} onClick={() => printReceipt(r)}>Print</button>
                            <button type="button" className="secondary-btn" style={{ padding: '0.25rem 0.5rem', fontSize: '0.72rem', marginRight: '0.3rem' }} onClick={() => exportReceiptWord(r)}>Word</button>
                            <button type="button" className="secondary-btn" style={{ padding: '0.25rem 0.5rem', fontSize: '0.72rem', marginRight: '0.3rem' }} onClick={() => emitReceiptEmail(r)}>Email</button>
                            <button type="button" className="secondary-btn" style={{ padding: '0.25rem 0.5rem', fontSize: '0.72rem', marginRight: '0.3rem' }} onClick={() => copyReceipt(r)}>Copy</button>
                            <button type="button" className="secondary-btn" style={{ padding: '0.25rem 0.5rem', fontSize: '0.72rem' }} onClick={() => exportReceiptJson(r)}>JSON</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {viewCreditNotes.length > 0 && (
                <div style={{ marginTop: '1.25rem' }}>
                  <div style={{ fontSize: '0.8rem', color: '#94a3b8', textTransform: 'uppercase', fontWeight: 700, marginBottom: '0.5rem' }}>
                    Credit notes
                  </div>
                  <table className="admin-table">
                    <thead>
                      <tr>
                        <th>Credit Note #</th>
                        <th>Date</th>
                        <th>Reason</th>
                        <th style={{ textAlign: 'right' }}>Amount Credited</th>
                        <th style={{ textAlign: 'right' }}>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {viewCreditNotes.map((cn) => (
                        <tr key={cn.id}>
                          <td style={{ fontWeight: 700 }}>{cn.credit_note_number}</td>
                          <td>{cn.issued_date}</td>
                          <td style={{ color: '#64748b' }}>{cn.reason || '—'}</td>
                          <td style={{ textAlign: 'right', fontWeight: 700, color: '#047857' }}>{fmtMoney(cn.total_incl, symOf(cn.currency_code))}</td>
                          <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                            <button type="button" className="secondary-btn" style={{ padding: '0.25rem 0.5rem', fontSize: '0.72rem', marginRight: '0.3rem' }} onClick={() => printCreditNote(cn)}>Print</button>
                            <button type="button" className="secondary-btn" style={{ padding: '0.25rem 0.5rem', fontSize: '0.72rem', marginRight: '0.3rem' }} onClick={() => exportCreditNoteWord(cn)}>Word</button>
                            <button type="button" className="secondary-btn" style={{ padding: '0.25rem 0.5rem', fontSize: '0.72rem', marginRight: '0.3rem' }} onClick={() => emitCreditNoteEmail(cn)}>Email</button>
                            <button type="button" className="secondary-btn" style={{ padding: '0.25rem 0.5rem', fontSize: '0.72rem', marginRight: '0.3rem' }} onClick={() => copyCreditNote(cn)}>Copy</button>
                            <button type="button" className="secondary-btn" style={{ padding: '0.25rem 0.5rem', fontSize: '0.72rem' }} onClick={() => exportCreditNoteJson(cn)}>JSON</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p style={{ fontSize: '0.82rem', color: '#64748b', margin: '0.6rem 0 0' }}>
                    This voided invoice is fully reversed by the credit note{viewCreditNotes.length > 1 ? 's' : ''} above, so the client account nets to zero and a replacement invoice can be issued.
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Receipt prompt */}
      {receiptPromptFor && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ maxWidth: '480px', width: '94%' }}>
            <div className="modal-header">
              <h2>Issue Receipt</h2>
              <button className="close-btn" onClick={() => setReceiptPromptFor(null)}><X size={20} /></button>
            </div>
            <p style={{ color: '#64748b', fontSize: '0.9rem', marginTop: 0 }}>
              Recording payment for <b>{receiptPromptFor.invoice_number}</b>. A receipt number will be allocated and the invoice marked paid.
            </p>
            <div style={{ display: 'grid', gap: '0.85rem' }}>
              <div className="sidebar-field">
                <label>Date Received</label>
                <input className="sidebar-select" style={fieldStyle} type="date" value={receiptForm.received_date} onChange={(e) => setReceiptForm({ ...receiptForm, received_date: e.target.value })} />
              </div>
              <div className="sidebar-field">
                <label>Payment Method</label>
                <select className="sidebar-select" style={fieldStyle} value={receiptForm.payment_method} onChange={(e) => setReceiptForm({ ...receiptForm, payment_method: e.target.value })}>
                  <option value="EFT">EFT / Bank transfer</option>
                  <option value="Card">Card</option>
                  <option value="Cash">Cash</option>
                  <option value="Online">Online</option>
                  <option value="Other">Other</option>
                </select>
              </div>
              <div className="sidebar-field">
                <label>Payment Reference</label>
                <input className="sidebar-select" style={fieldStyle} placeholder="Bank reference / transaction ID" value={receiptForm.payment_reference} onChange={(e) => setReceiptForm({ ...receiptForm, payment_reference: e.target.value })} />
              </div>
              <div style={{ background: '#f8fafc', borderRadius: '10px', padding: '0.75rem 1rem', fontSize: '0.9rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>Amount received</span>
                  <b>{fmtMoney(receiptDefaults(receiptPromptFor).amount, symOf(receiptPromptFor.currency_code))}</b>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>Balance remaining</span>
                  <b>{fmtMoney(receiptDefaults(receiptPromptFor).balanceRemaining, symOf(receiptPromptFor.currency_code))}</b>
                </div>
              </div>
            </div>
            <div className="form-actions">
              <button type="button" className="secondary-btn" onClick={() => setReceiptPromptFor(null)}>Cancel</button>
              <button type="button" className="primary-btn" style={{ flex: 1 }} disabled={issuingReceipt} onClick={submitReceipt}>
                {issuingReceipt ? 'Issuing…' : 'Issue Receipt'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* New invoice wizard */}
      {wizardOpen && (
        <div className="modal-overlay">
          <div className="modal-content tall" style={{ maxWidth: '820px', width: '94%' }}>
            <div className="modal-header">
              <h2>New Invoice — Step {wizardStep} of 3</h2>
              <button className="close-btn" onClick={() => setWizardOpen(false)}><X size={20} /></button>
            </div>

            <div className="modal-body">
            {wizardStep === 1 && (
              <div>
            <p style={{ color: '#64748b', fontSize: '0.9rem' }}>
              Pick a provisional or confirmed itinerary to raise a proforma invoice for. Every invoice starts as a proforma; it becomes a numbered, locked invoice the moment payment is confirmed and a receipt is issued.
            </p>
                {itinerariesLoading ? (
                  <div style={{ padding: '2rem 0', textAlign: 'center', color: '#94a3b8' }}>Loading itineraries…</div>
                ) : itineraries.length === 0 ? (
                  <div style={{ padding: '2rem 0', textAlign: 'center', color: '#94a3b8' }}>No provisional or confirmed itineraries available.</div>
                ) : (
                  <table className="admin-table">
                    <thead>
                      <tr><th>Reference</th><th>Name</th><th>Client</th><th>Status</th><th style={{ textAlign: 'right' }}>Action</th></tr>
                    </thead>
                    <tbody>
                      {itineraries.map((it) => (
                        <tr key={it.id}>
                          <td style={{ fontWeight: 700 }}>{it.reference_number || '—'}</td>
                          <td>{it.itinerary_name}</td>
                          <td>{it.clients?.name || '—'}</td>
                          <td style={{ textTransform: 'capitalize' }}>{it.status.replace('_', ' ')}</td>
                          <td style={{ textAlign: 'right' }}>
                            <button type="button" className="secondary-btn" style={{ padding: '0.3rem 0.6rem', fontSize: '0.75rem' }} onClick={() => loadItinerary(it.id)}>Select</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )}

            {wizardStep === 2 && selectedItinerary && (
              <div>
                <p style={{ color: '#64748b', fontSize: '0.9rem' }}>
                  <b>{selectedItinerary.reference_number}</b> · {selectedItinerary.itinerary_name} · status <b style={{ textTransform: 'capitalize' }}>{selectedItinerary.status}</b>.
                  Pick the currency to invoice. Each currency is invoiced separately; once the deposit is paid the next invoice clears the remaining balance.
                </p>
                <table className="admin-table">
                  <thead>
                    <tr><th>Currency</th><th style={{ textAlign: 'right' }}>Subtotal (Excl {currencyGroups.some((gg) => !isZar(gg.code)) ? 'Tax' : 'VAT'})</th><th style={{ textAlign: 'right' }}>{currencyGroups.some((gg) => !isZar(gg.code)) ? 'TAX' : 'VAT'}</th><th style={{ textAlign: 'right' }}>Total (Incl Tax)</th><th style={{ textAlign: 'right' }}>Action</th></tr>
                  </thead>
                  <tbody>
                    {currencyGroups.map((g) => (
                      <tr key={g.code}>
                        <td style={{ fontWeight: 700, color: '#0d7478' }}>{g.code}</td>
                        <td style={{ textAlign: 'right' }}>{fmtMoney(g.subtotalExcl, g.code)}</td>
                        <td style={{ textAlign: 'right' }}>{fmtMoney(g.taxTotal, g.code)}</td>
                        <td style={{ textAlign: 'right', fontWeight: 700 }}>{fmtMoney(g.totalIncl, g.code)}</td>
                        <td style={{ textAlign: 'right' }}>
                          {g.invoiced ? (
                            <span style={{ fontSize: '0.78rem', color: '#94a3b8' }}>{g.blockReason || 'Already invoiced'}</span>
                          ) : (
                            <button type="button" className="secondary-btn" style={{ padding: '0.3rem 0.6rem', fontSize: '0.75rem' }} onClick={() => { setSelectedCurrency(g.code); setSelectedBankId(''); setWizardStep(3); }}>Select</button>
                          )}
                        </td>
                      </tr>
                    ))}
                    {currencyGroups.length === 0 && (
                      <tr><td colSpan="5" style={{ textAlign: 'center', color: '#94a3b8', padding: '1.5rem 0' }}>This itinerary has no billable services.</td></tr>
                    )}
                  </tbody>
                </table>
                <div style={{ marginTop: '1rem', display: 'flex', justifyContent: 'flex-start' }}>
                  <button type="button" className="secondary-btn" onClick={() => setWizardStep(1)}>Back</button>
                </div>
              </div>
            )}

            {wizardStep === 3 && selectedGroup && (
              <div>
                <p style={{ color: '#64748b', fontSize: '0.9rem' }}>
                  {selectedGroup.reissue?.settled
                    ? <>Change invoice for <b>{selectedItinerary.reference_number}</b> in <b>{selectedGroup.code}</b>. This booking is already settled, so only the movement below can be billed.</>
                    : <>{selectedGroup.issueType === 'deposit' ? 'Proforma Deposit Invoice' : TYPE_LABEL[selectedGroup.issueType]} for <b>{selectedItinerary.reference_number}</b> in <b>{selectedGroup.code}</b>. Review the breakdown and confirm.</>}
                </p>

                {selectedGroup.reissue?.settled && (
                  <div style={{ margin: '0.75rem 0', border: '1px solid #fcd34d', background: '#fffbeb', borderRadius: '10px', padding: '0.85rem 1rem' }}>
                    <div style={{ fontWeight: 800, fontSize: '0.85rem', color: '#92400e', marginBottom: '0.4rem' }}>
                      {selectedGroup.settledDiff.changed.length} priced service{selectedGroup.settledDiff.changed.length === 1 ? '' : 's'} changed since {selectedGroup.settledInvoice?.invoice_number}
                    </div>
                    <table style={{ width: '100%', fontSize: '0.8rem', borderCollapse: 'collapse' }}>
                      <tbody>
                        {selectedGroup.settledDiff.changed.map((c) => (
                          <tr key={c.key}>
                            <td style={{ padding: '0.15rem 0' }}>{c.description || 'Service'}</td>
                            <td style={{ color: '#64748b' }}>{c.status}</td>
                            <td style={{ textAlign: 'right' }}>
                              {c.status === 'added' ? '' : <span style={{ color: '#94a3b8' }}>{fmtMoney(c.before, selectedGroup.code)} &rarr; </span>}
                              <b style={{ color: c.grossDelta > 0 ? '#b45309' : '#047857' }}>
                                {c.grossDelta > 0 ? '+' : ''}{fmtMoney(c.grossDelta, selectedGroup.code)}
                              </b>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {selectedGroup.reissue.options.map((o) => (
                      <div key={o.kind} style={{ marginTop: '0.6rem', display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
                        <span style={{ fontSize: '0.82rem', color: '#334155' }}>{o.label}</span>
                        {o.kind === 'invoice' ? (
                          <span style={{ fontSize: '0.72rem', color: '#92400e' }}>Use Select &rarr; confirm below to issue it.</span>
                        ) : (
                          <button
                            type="button"
                            className="secondary-btn"
                            style={{ padding: '0.25rem 0.55rem', fontSize: '0.75rem' }}
                            onClick={() => setVoidTarget(selectedGroup.settledInvoice)}
                          >
                            Raise credit note
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {selectedGroup.reissue?.settled && (
                  <table className="admin-table">
                    <thead>
                      <tr><th>Service</th><th style={{ textAlign: 'right' }}>Movement</th></tr>
                    </thead>
                    <tbody>
                      {(selectedGroup.settledDiff.changed || [])
                        .filter((c) => c.grossDelta > 0)
                        .map((c) => (
                          <tr key={c.key}>
                            <td>{c.description || 'Service'}</td>
                            <td style={{ textAlign: 'right', fontWeight: 700, color: '#b45309' }}>{fmtMoney(c.grossDelta, selectedGroup.code)}</td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                )}

                {!selectedGroup.reissue?.settled && (
                <table className="admin-table">
                  <thead>
                    <tr><th>Day</th><th>Service</th><th style={{ textAlign: 'right' }}>Qty</th><th style={{ textAlign: 'right' }}>Total (Incl Tax)</th></tr>
                  </thead>
                  <tbody>
                    {docLines({ subtotal_excl: selectedGroup.subtotalExcl, tax_total: selectedGroup.taxTotal, total_incl: selectedGroup.totalIncl, currency_code: selectedGroup.code, per_person_breakdown: selectedGroup.perPersonBreakdown }, selectedGroup.lines, { ...branding, expandedLines: selectedGroup.expandedLines ?? undefined }).map((l, i) => (
                      <tr key={i}>
                        <td>{l.day_number}</td>
                        <td>{l.item_name}{showMealPlanOn(l, branding) ? <> - {abbrevMealPlan(l.meal_plan)}</> : null}{showSupplierIn(l, branding) ? <div style={{ fontSize: '0.78rem', color: '#94a3b8' }}>{l.supplier_name}</div> : null}</td>
                        <td style={{ textAlign: l.qty_text ? 'left' : 'right' }}>{l.quantity}</td>
                        <td style={{ textAlign: 'right' }}>{fmtMoney(l.line_total, selectedGroup.code)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                )}

                {!selectedGroup.reissue?.settled && (
                <div style={{ marginTop: '0.75rem', background: '#f8fafc', borderRadius: '10px', padding: '0.85rem 1rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Subtotal (Excl {taxWordOf(selectedGroup.code)})</span><b>{fmtMoney(selectedGroup.subtotalExcl, symOf(selectedGroup.code))}</b></div>
                  {selectedGroup.taxEntries.map((te) => (
                    <div key={te.label} style={{ display: 'flex', justifyContent: 'space-between' }}><span>{taxWordUpper(selectedGroup.code)} ({taxDisplayLabel(selectedGroup.code, te.label, te.rate)} {Number(te.rate)}%)</span><b>{fmtMoney(te.amount, symOf(selectedGroup.code))}</b></div>
                  ))}
                  <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid #e2e8f0', marginTop: '0.4rem', paddingTop: '0.4rem', fontWeight: 900 }}>
                    <span>{selectedGroup.code} TOTAL DUE ({isZar(selectedGroup.code) ? `INCL TAX ${selectedGroup.taxEntries[0]?.label || 'VAT'}` : 'INCL TAX'})</span>
                    <span>{fmtMoney(selectedGroup.totalIncl, symOf(selectedGroup.code))}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '0.4rem', color: '#64748b' }}>
                    {selectedGroup.issueType === 'deposit' ? (
                      <><span>Deposit requested ({depositPct}%)</span><b>{fmtMoney(round2(selectedGroup.totalIncl * depositPct / 100), symOf(selectedGroup.code))}</b></>
                    ) : (
                      <>
                        <span>Less deposit received{depositCreditPreview.number ? ` (${depositCreditPreview.number})` : ''}</span>
                        <b style={{ color: '#047857' }}>-{fmtMoney(depositCreditPreview.amount, symOf(selectedGroup.code))}</b>
                      </>
                    )}
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '0.35rem', fontWeight: 700 }}>
                    {selectedGroup.issueType === 'deposit' ? (
                      <><span>Balance remaining after deposit</span><b>{fmtMoney(round2(selectedGroup.totalIncl * (1 - depositPct / 100)), symOf(selectedGroup.code))}</b></>
                    ) : (
                      <><span>Balance to be paid</span><b>{fmtMoney(selectedGroup.outstanding, symOf(selectedGroup.code))}</b></>
                    )}
                  </div>
                </div>
                )}

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginTop: '1rem' }}>
                  <div className="sidebar-field">
                    <label>Bank Account ({selectedGroup.code})</label>
                    <select className="sidebar-select" style={fieldStyle} value={chosenBank?.id || ''} onChange={(e) => setSelectedBankId(e.target.value)}>
                      {availableBanks.length === 0 && <option value="">No {selectedGroup.code} account — add one in Settings</option>}
                      {availableBanks.map((b) => (
                        <option key={b.id} value={b.id}>{b.label || b.bank_name || b.currency_code}{b.is_default ? ' (default)' : ''}</option>
                      ))}
                    </select>
                  </div>
                  <div className="sidebar-field">
                    <label>Due Date</label>
                    <input className="sidebar-select" style={fieldStyle} type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
                  </div>
                </div>

                <p style={{ fontSize: '0.8rem', color: '#94a3b8', marginTop: '0.75rem', display: 'flex', gap: '0.35rem', alignItems: 'center' }}>
                  <FileText size={13} /> {selectedGroup.issueType === 'deposit'
                    ? 'This proforma is numbered and locked once payment is confirmed and a receipt is issued. Further money received on the same itinerary is captured automatically.'
                    : 'Once validated, the invoice is numbered and locked. It cannot be edited — only voided.'}
                </p>

                <div className="form-actions" style={{ marginTop: '0.5rem' }}>
                  <button type="button" className="secondary-btn" onClick={() => setWizardStep(2)}>Back</button>
                  <button type="button" className="primary-btn" style={{ flex: 1, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '0.35rem' }} disabled={issuing} onClick={handleIssue}>
                    <Check size={16} /> {issuing ? 'Issuing…' : (selectedGroup.reissue?.settled ? 'Issue Change Invoice' : (selectedGroup.issueType === 'deposit' ? 'Issue Proforma' : 'Validate Final Invoice'))}
                  </button>
                </div>
              </div>
            )}
            </div>
          </div>
        </div>
      )}

      {voidTarget && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ maxWidth: '480px' }}>
            <div className="modal-header">
              <h2>Void invoice {voidTarget.invoice_number}?</h2>
              <button className="close-btn" onClick={() => setVoidTarget(null)}><X size={20} /></button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.9rem' }}>
              <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'flex-start', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '10px', padding: '0.75rem 0.9rem' }}>
                <AlertTriangle size={16} color="#b91c1c" style={{ flexShrink: 0, marginTop: '2px' }} />
                <p style={{ margin: 0, color: '#7f1d1d', fontSize: '0.84rem', lineHeight: 1.5 }}>
                  A matching credit note will be raised automatically so the client account balances and the itinerary slot is freed for a replacement invoice.
                </p>
              </div>
              <div className="sidebar-field">
                <label>Reason *</label>
                <textarea
                  className="sidebar-select"
                  style={{ ...fieldStyle, minHeight: '90px', resize: 'vertical', fontFamily: 'inherit' }}
                  value={voidReason}
                  onChange={(e) => setVoidReason(e.target.value)}
                  placeholder="e.g. Duplicate invoice issued in error"
                  autoFocus
                />
              </div>
              <div className="form-actions" style={{ marginTop: 0 }}>
                <button type="button" className="secondary-btn" onClick={() => setVoidTarget(null)}>Cancel</button>
                <button
                  type="button"
                  className="primary-btn"
                  style={{ flex: 1, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '0.35rem', background: '#b91c1c', borderColor: '#b91c1c' }}
                  disabled={!voidReason.trim()}
                  onClick={() => voidInvoice(voidTarget, viewLines)}
                >
                  <Ban size={15} /> Void &amp; raise credit note
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Finance;
