import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import SearchableSelect from '../components/SearchableSelect';
import { supabase } from '../lib/supabase';
import { useToast } from '../context/ToastContext';
import { useCurrencies } from '../hooks/useCurrencies';
import { useListRowLimit } from '../hooks/useListRowLimit';
import { postInvoice, postReceipt, postCreditNote, postCostOfSales, costOfSalesFromDayItems, COST_OF_SALES_STATUSES, diffAgainstBilledLines, decideReissue, lineKey, scaleInvoiceLines, num, CHART_OF_ACCOUNTS } from '../lib/financeJournal';
import { invoiceBalance, invoiceBalanceAfterRefund, settledStatus, netReceivedTotal, refundableOverpayment, creditAppliedTotal, creditedTotal, netBilled, canBill, sameCurrency, parseGuardRejection, guardMessage } from '../lib/settlement';
import { ReceiptsPanel, JournalPanel, TenantCostOfSalesPanel, AccountingPanel } from '../components/finance/FinanceTenantViews';
import {
  round2,
  fmtMoney,
  numOr,
  vatOfInclusive,
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
import { rateForTravel } from '../lib/priceValidity';
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
    FileSpreadsheet,
    Undo2
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
  const [allCreditNotes, setAllCreditNotes] = useState([]);
  const [tenancyRows, setTenancyRows] = useState([]);
  const [tenancyError, setTenancyError] = useState('');
  const [journalItineraries, setJournalItineraries] = useState([]);
  const [journalLoading, setJournalLoading] = useState(false);
  const [journalError, setJournalError] = useState('');
  const [costOfSalesItineraries, setCostOfSalesItineraries] = useState([]);
  const [tenancyLoading, setTenancyLoading] = useState(false);
  const costOfSalesRequestRef = useRef(0);
  const journalRequestRef = useRef(0);
  const [connections, setConnections] = useState([]);
  const [busyProvider, setBusyProvider] = useState(null);

  const [viewing, setViewing] = useState(null);
  const [viewLines, setViewLines] = useState([]);
  const [viewReceipts, setViewReceipts] = useState([]);
  const [viewCreditNotes, setViewCreditNotes] = useState([]);
  const [receiptPromptFor, setReceiptPromptFor] = useState(null);
  const [receiptForm, setReceiptForm] = useState({ payment_method: 'EFT', payment_reference: '', received_date: '' });
  const [issuingReceipt, setIssuingReceipt] = useState(false);
  const receiptSubmissionRef = useRef(false);
  const [refundPromptFor, setRefundPromptFor] = useState(null);
  const [refundForm, setRefundForm] = useState({ amount: '', reason: '', refunded_date: '', payment_method: 'EFT' });
  const [issuingRefund, setIssuingRefund] = useState(false);

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

  /* Pricing Protection, as the builder applies it when it prices the line.
     Invoice-side breakdowns must uplift a stale season by the same amount or
     the document disagrees with the itinerary it bills. */
  const priceProtectionPercent = Math.max(0, Number(billing?.price_protection_percent) || 0);

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

  /* -- Tenant-wide ledger, receipts, cost of sales and connections ---------- */
  const loadTenantFinance = useCallback(async (cid) => {
    const id = cid || companyId;
    if (!id) return;

    const [receiptsRes, creditsRes, connRes] = await Promise.all([
      supabase.from('invoice_receipts').select('*').eq('company_id', id).order('received_date', { ascending: false }),
      supabase.from('credit_notes').select('*').eq('company_id', id).order('issued_date', { ascending: false }),
      // Columns listed explicitly to keep `credentials` out of the browser. The
      // Accounting tab only ever renders status and last-sync metadata, and
      // `select('*')` here would hand OAuth material to the client the moment
      // anyone pasted a real token instead of a credential reference.
      supabase
        .from('accounting_connections')
        .select('id, company_id, provider, mode, status, last_sync_at, last_error, created_at, updated_at')
        .eq('company_id', id)
    ]);

    setAllReceipts(receiptsRes.data || []);
    setAllCreditNotes(creditsRes.data || []);
    setConnections(connRes.data || []);
  }, [companyId]);

  const loadJournalData = useCallback(async ({ status, reference } = {}) => {
    if (!companyId) return;
    const requestId = journalRequestRef.current + 1;
    journalRequestRef.current = requestId;
    setJournalLoading(true);
    setJournalError('');
    setJournalEntries([]);
    setJournalItineraries([]);

    try {
      if (!reference && !COST_OF_SALES_STATUSES.includes(status)) {
        throw new Error('Choose a booking status or enter an exact itinerary reference.');
      }
      let itineraryQuery = supabase
        .from('itineraries')
        .select('id, reference_number, status, client_id, clients(name)')
        .eq('company_id', companyId);
      itineraryQuery = reference
        ? itineraryQuery.eq('reference_number', reference.trim())
        : itineraryQuery.eq('status', status);
      const { data: itineraries, error: itineraryError } = await itineraryQuery;
      if (itineraryError) throw itineraryError;
      if (requestId !== journalRequestRef.current) return;
      const matchedItineraries = (itineraries || []).map((itinerary) => ({
        ...itinerary,
        client_name: itinerary.clients?.name || ''
      }));
      setJournalItineraries(matchedItineraries);
      const itineraryIds = matchedItineraries.map((itinerary) => itinerary.id);
      if (!itineraryIds.length) return;

      const { data: entries, error: entriesError } = await supabase
        .from('journal_entries')
        .select('*')
        .eq('company_id', companyId)
        .in('itinerary_id', itineraryIds)
        .order('entry_date', { ascending: false })
        .order('created_at', { ascending: false });
      if (entriesError) throw entriesError;
      if (requestId !== journalRequestRef.current) return;
      const matchedEntries = entries || [];
      if (!matchedEntries.length) return;
      const { data: lines, error: linesError } = await supabase
        .from('journal_lines')
        .select('*')
        .in('entry_id', matchedEntries.map((entry) => entry.id))
        .order('sort_order', { ascending: true });
      if (linesError) throw linesError;
      if (requestId !== journalRequestRef.current) return;
      setJournalEntries(matchedEntries.map((entry) => ({
        ...entry,
        lines: (lines || []).filter((line) => line.entry_id === entry.id)
      })));
    } catch (err) {
      if (requestId === journalRequestRef.current) {
        setJournalEntries([]);
        setJournalItineraries([]);
        setJournalError(err.message || 'Could not load journal entries');
      }
    } finally {
      if (requestId === journalRequestRef.current) setJournalLoading(false);
    }
  }, [companyId]);

  const loadCostOfSalesData = useCallback(async ({ status, reference } = {}) => {
    if (!companyId) return;
    const requestId = costOfSalesRequestRef.current + 1;
    costOfSalesRequestRef.current = requestId;
    setTenancyLoading(true);
    setTenancyError('');
    setTenancyRows([]);
    setCostOfSalesItineraries([]);

    try {
      if (!reference && !COST_OF_SALES_STATUSES.includes(status)) {
        throw new Error('Choose a valid itinerary status or enter an exact itinerary reference.');
      }
      let query = supabase
        .from('itineraries')
        .select('id, reference_number, status, client_id, clients(name)')
        .eq('company_id', companyId);
      query = reference
        ? query.eq('reference_number', reference.trim()).in('status', COST_OF_SALES_STATUSES)
        : query.eq('status', status);

      const { data: itineraries, error: itinerariesError } = await query;
      if (itinerariesError) throw itinerariesError;
      if (requestId !== costOfSalesRequestRef.current) return;
      const matchedItineraries = (itineraries || []).map((itinerary) => ({
        ...itinerary,
        client_name: itinerary.clients?.name || ''
      }));
      setCostOfSalesItineraries(matchedItineraries);
      const itineraryIds = matchedItineraries.map((itinerary) => itinerary.id);
      if (!itineraryIds.length) return;

      const { data: days, error: daysError } = await supabase
        .from('itinerary_days')
        .select('id, itinerary_id')
        .in('itinerary_id', itineraryIds);
      if (daysError) throw daysError;
      if (requestId !== costOfSalesRequestRef.current) return;
      const dayIds = (days || []).map((day) => day.id);
      if (!dayIds.length) return;

      const { data: items, error: itemsError } = await supabase
        .from('itinerary_day_items')
        .select('id, itinerary_day_id, item_name, description_override, category, supplier_name, currency_code, total_buy, total_sell, unit_cost, unit_price, item_price_per_person, pax, tax_rate, is_included')
        .in('itinerary_day_id', dayIds);
      if (itemsError) throw itemsError;
      if (requestId !== costOfSalesRequestRef.current) return;
      const itineraryOfDay = new Map((days || []).map((day) => [day.id, day.itinerary_id]));
      setTenancyRows(costOfSalesFromDayItems((items || [])
        .map((item) => ({ ...item, itinerary_id: itineraryOfDay.get(item.itinerary_day_id) }))
        .filter((item) => item.itinerary_id)));
    } catch (err) {
      if (requestId === costOfSalesRequestRef.current) {
        setTenancyRows([]);
        setCostOfSalesItineraries([]);
        setTenancyError(err.message || 'Could not load cost-of-sales data');
      }
    } finally {
      if (requestId === costOfSalesRequestRef.current) setTenancyLoading(false);
    }
  }, [companyId]);

  useEffect(() => {
    if (!companyId) return;
    let cancelled = false;
    (async () => {
      try {
        await loadTenantFinance(companyId);
      } catch (err) {
        if (!cancelled) showToast(err.message || 'Failed to load Finance data', 'error');
      }
    })();
    return () => { cancelled = true; };
  }, [companyId, activeTab, loadTenantFinance, showToast]);

  const handleFinanceTabChange = (tab) => {
    if (tab !== 'journal') {
      journalRequestRef.current += 1;
      setJournalEntries([]);
      setJournalItineraries([]);
      setJournalError('');
      setJournalLoading(false);
    }
    setActiveTab(tab);
  };

  /* Push the ledger out as a file the accounts team can import. Provider-
     specific dialects differ, so this emits the provider-agnostic journal plus
     a chart-of-accounts mapping they can map onto their own codes. */
  const pushLedgerFile = async (provider) => {
    if (!companyId) return;
    setBusyProvider(provider);
    try {
      const { data: entries, error: entriesError } = await supabase
        .from('journal_entries')
        .select('*')
        .eq('company_id', companyId)
        .order('entry_date', { ascending: false })
        .order('created_at', { ascending: false });
      if (entriesError) throw entriesError;
      const allEntries = entries || [];
      const { data: lines, error: linesError } = allEntries.length
        ? await supabase.from('journal_lines').select('*').in('entry_id', allEntries.map((entry) => entry.id)).order('sort_order', { ascending: true })
        : { data: [], error: null };
      if (linesError) throw linesError;
      const entriesWithLines = allEntries.map((entry) => ({
        ...entry,
        lines: (lines || []).filter((line) => line.entry_id === entry.id)
      }));
      const payload = {
        schema: 'torbuilder.ledger/v1',
        provider,
        generated_at: new Date().toISOString(),
        company_id: companyId,
        chart_of_accounts: CHART_OF_ACCOUNTS,
        entries: entriesWithLines.map((e) => ({
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
        records_count: entriesWithLines.length, message: 'Ledger exported by the user.'
      }]).then(() => {}).catch(() => {});
      showToast(`${entriesWithLines.length} journal entries exported for ${provider}`, 'success');
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
    try {
      /* Recheck the current status before recognising an expense: a stale
         Finance tab must not post a quotation as cost of sales. */
      const { data: itin, error: itinErr } = await supabase
        .from('itineraries')
        .select('id, reference_number, status')
        .eq('id', row.itinerary_id)
        .eq('company_id', companyId)
        .maybeSingle();
      if (itinErr) throw itinErr;
      if (!itin || !COST_OF_SALES_STATUSES.includes(itin.status)) {
        const status = itin?.status || 'not found';
        showToast(`Cost of sales can only be recognised on a confirmed, in-progress, or completed itinerary — ${itin?.reference_number || 'this itinerary'} is ${status}.`, 'warning');
        return;
      }
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

  /* -- Wizard: load qualified itineraries (provisional ? deposit, confirmed ? final) */
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

  /* Payments actually received, per currency, for this itinerary. Every invoice
     bills what it says it bills, so a paid invoice contributes its own total
     and nothing needs to be read out of its type. */
  /* What each currency on this booking has been billed, net of credit notes.
     This is the figure `outstanding` is measured against: it is what the client
     has been charged for, not what they happen to have paid, so a credit note
     properly opens up room to bill again. */
  const paidByCurrency = useMemo(() => {
    const map = new Map();
    const mine = invoices.filter((inv) => inv.itinerary_id === selectedItinerary?.id);
    for (const inv of mine) {
      const code = (inv.currency_code || '').toUpperCase();
      if (!map.has(code)) map.set(code, { paid: 0, billed: 0 });
      map.get(code).paid += Number(inv.total_incl) || 0;
    }
    for (const cn of allCreditNotes) {
      const owner = mine.find((i) => i.id === cn.invoice_id);
      if (!owner) continue;
      const code = (owner.currency_code || '').toUpperCase();
      if (map.has(code)) map.get(code).billed -= Number(cn.total_incl) || 0;
    }
    for (const rec of map.values()) {
      rec.billed = round2(rec.billed);
      /* Money received against the booking, from the receipts themselves. A
         part payment counts for what it was, not for the whole invoice. */
      rec.received = round2(
        allReceipts
          .filter((r) => {
            const owner = mine.find((i) => i.id === r.invoice_id);
            return owner && (owner.status || '') !== 'void';
          })
          .reduce((a, r) => a + (Number(r.amount) || 0), 0)
      );
    }
    return map;
  }, [invoices, allReceipts, allCreditNotes, selectedItinerary]);

  /* A currency can be invoiced whenever it still has an outstanding balance.
     Anything already received simply reduces what is left to bill. */
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
    const rec = paidByCurrency.get(code) || { billed: 0, received: 0, paid: 0 };
    /* Outstanding is what the trip costs less what has already been billed. A
       credit note reduces what was billed, so it opens the trip up to be
       invoiced again, and money received does not reduce it a second time —
       billing is about the trip's value, not the client's payment. */
    const netBilledAmount = round2(rec.billed);
    const received = round2(rec.received);
    const outstanding = round2(Math.max(0, agg.totalIncl - netBilledAmount));
    const hasPaidAnything = received > 0;
    const overpaid = round2(Math.max(0, received - netBilledAmount));
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
        /* Season-aware: a library item holds one row per season, and taking the
           first row for the currency priced the invoice's per-person and
           per-room breakdowns from whichever season came back first — the same
           winter-rate bug the room-allocation dialog had. Resolve against this
           itinerary's travel window instead. */
        const rate = rateForTravel({
          rates: arr,
          currencyCode: code,
          startDate: selectedItinerary?.travel_start_date,
          endDate: selectedItinerary?.travel_end_date,
          protectionPercent: priceProtectionPercent
        });
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
      /* "Settled" here means the trip has been billed in full, which is what
         `outstanding` now measures. Whether the money has arrived is a separate
         question, answered by `received`. */
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
      } else if (overpaid > 0.009) {
        blockReason = `${fmtMoney(overpaid, symOf(code))} more has been received than invoiced. This is a credit to the client, not an amount to bill.`;
      } else if (outstanding <= 0.009) {
        blockReason = 'Already invoiced in full';
      } else {
        issueType = 'invoice';
      }
      return {
        code,
        ...agg,
        perPersonBreakdown,
        expandedLines,
        netBilled: netBilledAmount,
        received,
        overpaid,
        outstanding,
        hasPaidAnything,
        issueType,
        invoiced: !issueType,
        blockReason,
        settledInvoice,
        settledDiff,
        reissue
      };
    });
  }, [selectedItinerary, invoices, paidByCurrency, itineraryRates, itineraryAgeRanges, billing, symOf, priceProtectionPercent]);

  const selectedGroup = useMemo(
    () => currencyGroups.find((g) => g.code === selectedCurrency) || null,
    [currencyGroups, selectedCurrency]
  );

  /* The deposit percentage is a commercial term, not an invoice type: it says
     what share of the trip is normally asked for up front, and it drives the
     cancellation notice's retained amount. Here it only pre-suggests the size
     of the first invoice — whatever gets issued is an ordinary invoice. */
  const depositPct = useMemo(() => {
    const fromClient = selectedItinerary?.clients?.deposit_percentage;
    if (fromClient !== null && fromClient !== undefined && fromClient !== '') return Number(fromClient);
    if (billing?.default_deposit_percentage !== null && billing?.default_deposit_percentage !== undefined) return Number(billing.default_deposit_percentage);
    return 30;
  }, [selectedItinerary, billing]);

  /* The amount still to ask for on the first invoice of this booking. Once
     anything has been received this is simply what the trip costs less what has
     come in, which is the same outstanding figure the guard checks. */
  const suggestedFirstInvoice = useMemo(() => {
    const group = currencyGroups.find((g) => g.code === selectedCurrency);
    if (!group || group.outstanding <= 0.009) return 0;
    if (group.paidTotal > 0) return round2(group.outstanding);
    return round2(group.totalIncl * (depositPct / 100));
  }, [currencyGroups, selectedCurrency, depositPct]);

  const availableBanks = useMemo(
    () => bankAccounts.filter((b) => b.is_active && (b.currency_code || '').toUpperCase() === (selectedCurrency || '').toUpperCase()),
    [bankAccounts, selectedCurrency]
  );

  const chosenBank = useMemo(
    () => availableBanks.find((b) => b.id === selectedBankId) || availableBanks.find((b) => b.is_default) || availableBanks[0] || null,
    [availableBanks, selectedBankId]
  );

  /* -- Over-billing guard ---------------------------------------------------
     The invoice list on screen is one page, so it cannot be trusted to say what
     a booking has already been billed. This re-reads the booking's whole
     financial history straight from the database, and the document is measured
     against that. Cheap, and it means the guard cannot be defeated by a
     long invoice list or a stale screen. */
  const fetchBookingBilled = useCallback(async (itineraryId, currency) => {
    if (!itineraryId) return { billed: 0, limit: 0 };
    const { data: invs, error: invErr } = await supabase
      .from('invoices')
      .select('id, total_incl, status, currency_code')
      .eq('company_id', companyId)
      .eq('itinerary_id', itineraryId);
    if (invErr) throw invErr;
    const mine = (invs || []).filter((i) => sameCurrency(i.currency_code, currency));
    const live = mine.filter((i) => (i.status || '') !== 'void');
    if (!live.length) return { billed: 0, limit: 0, invoices: mine };

    const ids = live.map((i) => i.id);
    const { data: cns, error: cnErr } = await supabase
      .from('credit_notes')
      .select('invoice_id, total_incl, status, currency_code, accounting_export')
      .eq('company_id', companyId)
      .in('invoice_id', ids);
    if (cnErr) throw cnErr;

    return {
      billed: netBilled(mine, cns || [], currency),
      invoices: mine,
      creditNotes: cns || []
    };
  }, [companyId]);

  const handleIssue = async () => {
    if (!selectedGroup) return;
    if (!selectedGroup.issueType) {
      showToast(selectedGroup.blockReason || `An invoice already exists for ${selectedGroup.code}`, 'warning');
      return;
    }
    setIssuing(true);
    try {
      /* A settled booking with a change bills ONLY what moved. Re-billing the
         unchanged part is the double-count the guard exists to prevent, so the
         movement becomes the whole document: header totals and line items alike.
         On an unsettled booking the invoice is for the part not yet received,
         which is what makes the two documents together cover the trip once. */
      const settledDelta = selectedGroup.reissue?.settled
        ? (selectedGroup.reissue.options.find((o) => o.kind === 'invoice')?.amount || 0)
        : 0;
      const isDelta = settledDelta > 0.009;
      /* Nothing has been charged yet, so this is the first request on the trip:
         bill the configured opening percentage rather than the whole thing. Once
         the trip has been charged, every later document bills what is actually
         outstanding. */
      const firstRequest = !isDelta && selectedGroup.received <= 0.009;
      const gross = isDelta
        ? settledDelta
        : round2(firstRequest ? suggestedFirstInvoice : selectedGroup.outstanding);

      /* The guard. An invoice may only bill the part of the trip that has not
         been billed yet. It runs against the booking's real history read fresh
         from the database, not whatever happens to be on screen, so a long
         invoice list or a stale tab cannot let a booking be billed twice.

         A settled change needs no special case: its movement is exactly what the
         new trip total has risen above what was already billed. */
      const history = await fetchBookingBilled(selectedItinerary?.id, selectedGroup.code);
      const guard = canBill(
        gross,
        selectedGroup.totalIncl,
        history.invoices || [],
        history.creditNotes || [],
        selectedGroup.code
      );
      if (!guard.ok) {
        showToast(
          guardMessage({ reason: guard.reason, limit: guard.limit, proposed: gross }, symOf(selectedGroup.code)),
          guard.reason === 'nothing' ? 'warning' : 'error'
        );
        return;
      }

      /* Apportion the group's net share onto what is being billed, so the
         document carries a believable tax figure rather than the whole trip's. */
      const groupTotal = round2(selectedGroup.totalIncl);
      const netRatio = groupTotal > 0 ? round2(selectedGroup.subtotalExcl) / groupTotal : 1;
      const net = round2(gross * netRatio);
      const balance = round2(gross);
      /* The first request on an untouched booking bills only part of the trip,
         so it goes out as a proforma: a request for money, not yet an invoice
         for the supply. Once the trip has been charged — in full, or as a later
         change — the document bills a real amount and is validated. Decided by
         the amount, because that is what it actually turns on. */
      const firstPartRequest = firstRequest
        && gross < round2(selectedGroup.totalIncl) - 0.009;

      const client = selectedItinerary.clients || {};
      const bankDetails = chosenBank ? {
        bank_name: chosenBank.bank_name,
        account_holder_name: chosenBank.account_holder_name,
        account_number: chosenBank.account_number,
        branch_code: chosenBank.branch_code,
        swift_code: chosenBank.swift_code
      } : {};

      const header = {
        client_id: selectedItinerary.client_id || null,
        /* One document type. An invoice bills what it bills and carries its own
           balance; whether it is the first request or a later movement is
           history, not a property of the document. */
        invoice_type: 'invoice',
        status: firstPartRequest ? 'proforma' : 'validated',
        currency_code: selectedGroup.code,
        /* Tax is apportioned onto what is being billed, with net as the
           balancing figure so the document's own totals add up exactly. */
        subtotal_excl: net,
        tax_total: round2(gross - net),
        total_incl: gross,
        tax_label: selectedGroup.taxEntries[0]?.label || 'Tax',
        tax_rate: selectedGroup.taxEntries[0]?.rate ?? 0,
        balance_due: balance,
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
      /* Issued through the server so the guard and the write share one
         transaction, and so the header and its lines cannot end up out of step
         with each other. */
      const billedLines = isDelta ? issueLines : scaleInvoiceLines(issueLines, gross);
      const { data: issued, error: invErr } = await supabase.rpc('issue_booking_invoice', {
        p_company_id: companyId,
        p_itinerary_id: selectedItinerary.id,
        p_currency: selectedGroup.code,
        p_trip_total: selectedGroup.totalIncl,
        p_invoice: { ...header, accounting_export: accounting },
        p_lines: billedLines
      });
      if (invErr) throw invErr;

      const { data: created, error: readErr } = await supabase
        .from('invoices')
        .select('*')
        .eq('id', issued.id)
        .single();
      if (readErr || !created) throw new Error(readErr?.message || 'Invoice was not created');
      const number = created.invoice_number;

      await fetchInvoices(companyId);
      setWizardOpen(false);
      /* A first part-request goes out as a proforma draft and posts nothing
         until it is validated; a document billing a settled amount is created
         validated and posts now. */
      if (created.status && created.status !== 'proforma') {
        await postInvoice(companyId, created);
      }
      showToast(`${number} issued`, 'success');
    } catch (err) {
      /* The database guard carries its reason in the exception detail, so a
         refusal reads in the same words whether it was caught before the insert
         or by the locked insert itself. */
      const rejection = parseGuardRejection(err);
      const msg = rejection
        ? guardMessage(rejection, symOf(selectedGroup.code))
        : /duplicate key|unique/i.test(err.message || '')
        ? `A ${selectedGroup.issueType} invoice already exists for ${selectedGroup.code}`
        : (err.message || 'Failed to issue invoice');
      showToast(msg, rejection?.reason === 'nothing' ? 'warning' : 'error');
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

  /* Derive the balance from cash receipts and applied wallet credit, never from
     the cached column, so stale net-only amounts cannot omit tax. */
  const balanceOf = useCallback(
    (inv) => invoiceBalance(inv, allReceipts),
    [allReceipts]
  );

  /* Settling an invoice by hand rather than by receipt, for money already banked
     outside the system. The status is derived so it cannot claim to be paid while
     a balance is genuinely still outstanding. */
  const markPaid = async (inv) => {
    try {
      const balance = balanceOf(inv);
      if (balance > 0.009) {
        showToast(
          `${inv.invoice_number} still has ${fmtMoney(balance, symOf(inv.currency_code))} outstanding. Record a receipt for it instead.`,
          'warning'
        );
        return;
      }
      const { error } = await supabase
        .from('invoices')
        .update({ status: 'paid', paid_at: new Date().toISOString(), balance_due: 0 })
        .eq('id', inv.id);
      if (error) throw error;
      await fetchInvoices(companyId);
      setViewing((v) => (v && v.id === inv.id ? { ...v, status: 'paid' } : v));
      showToast(`${inv.invoice_number} marked as paid`, 'success');
    } catch (err) {
      showToast(err.message || 'Failed to update invoice', 'error');
    }
  };

  /* A receipt defaults to clearing the invoice's balance, but any smaller amount
     is valid: the client may be paying it off in instalments. What remains is
     derived, not stored, so it stays right however many receipts arrive. */
  const openReceiptPrompt = (inv) => {
    const balance = balanceOf(inv);
    setReceiptPromptFor({ ...inv, derivedBalance: balance, submissionKey: crypto.randomUUID() });
    setReceiptForm({
      payment_method: 'EFT',
      payment_reference: inv.payment_reference || '',
      received_date: new Date().toISOString().slice(0, 10),
      amount: balance > 0 ? String(balance) : ''
    });
  };

  /* Hand money back to the client. Only money actually held against the invoice
     can be returned, so the form opens at that ceiling and cannot go above it.
     The reason is kept on the document because a refund is the kind of entry an
     auditor asks about. */
  const openRefundPrompt = (inv) => {
    const cap = refundableOverpayment(inv, allReceipts);
    setRefundPromptFor({ ...inv, refundCap: cap });
    setRefundForm({
      amount: cap > 0 ? String(cap) : '',
      reason: '',
      refunded_date: new Date().toISOString().slice(0, 10),
      payment_method: 'EFT'
    });
  };

  const submitRefund = async () => {
    const inv = refundPromptFor;
    if (!inv) return;
    setIssuingRefund(true);
    try {
      const amount = round2(num(refundForm.amount));
      const reason = (refundForm.reason || '').trim();
      if (!(amount > 0.009)) throw new Error('Enter the amount to refund');
      if (!reason) throw new Error('Give a reason for the refund');

      /* Guarded here for a clear message, enforced under a database lock:
         only excess cash can be returned without reopening the invoice. */
      if (amount > inv.refundCap + 0.009) {
        throw new Error(`Only ${fmtMoney(inv.refundCap, symOf(inv.currency_code))} is available to refund without reopening ${inv.invoice_number}`);
      }

      const { data, error } = await supabase.rpc('issue_invoice_refund', {
        p_company_id: companyId,
        p_invoice_id: inv.id,
        p_amount: amount,
        p_reason: reason
      });
      if (error) throw error;
      const done = Array.isArray(data) ? data[0] : data;
      if (!done) throw new Error('The refund was not recorded');

      /* The refund clears the excess cash liability without reopening a fully
         settled invoice. */
      await postReceipt(companyId, {
        id: done.id,
        direction: 'out',
        amount: done.amount,
        receipt_number: done.number,
        invoice_id: inv.id,
        invoice_number: done.invoice_number,
        currency_code: done.currency,
        bill_to_name: inv.bill_to_name || '',
        payment_method: refundForm.payment_method || 'REFUND',
        itinerary_id: inv.itinerary_id || null,
        client_id: inv.client_id || null
      });

      await fetchInvoices(companyId);
      await loadTenantFinance(companyId);
      await reloadViewing(inv.id);
      setRefundPromptFor(null);
      showToast(
        `Refund ${done.number} issued — ${fmtMoney(done.amount, symOf(inv.currency_code))} returned to the client`,
        'success'
      );
    } catch (err) {
      showToast(err.message || 'Failed to record refund', 'error');
    } finally {
      setIssuingRefund(false);
    }
  };

  /* What an invoice would still owe once a further cash receipt arrives.
     Credit notes fund the client's wallet; only cash and credit drawn from that
     wallet settle the invoice. */
  const balanceAfterReceipt = (inv, amount) => {
    const settled = netReceivedTotal(inv.id, allReceipts)
      + creditAppliedTotal(inv.id, allReceipts)
      + round2(amount);
    return round2(Math.max(0, round2(num(inv.total_incl)) - settled));
  };

  const submitReceipt = async () => {
    const inv = receiptPromptFor;
    if (!inv || receiptSubmissionRef.current) return;
    receiptSubmissionRef.current = true;
    setIssuingReceipt(true);
    try {
      /* The amount may be less than the balance: an invoice can be paid off in
         instalments, and the remainder is then still owed. */
      const amount = round2(Number(receiptForm.amount));
      if (!(amount > 0.009)) throw new Error('Enter the amount received');
      const currentBalance = balanceOf(inv);
      if (amount > currentBalance + 0.009) {
        setReceiptForm((current) => ({ ...current, amount: currentBalance > 0 ? currentBalance.toFixed(2) : '' }));
        throw new Error(`Only ${fmtMoney(currentBalance, symOf(inv.currency_code))} remains outstanding on ${inv.invoice_number}`);
      }

      const { data: number, error: numErr } = await supabase.rpc('get_next_receipt_reference', { p_company_id: companyId });
      if (numErr || !number) throw new Error(numErr?.message || 'Could not allocate receipt number');
      const balanceRemaining = balanceAfterReceipt(inv, amount);
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
        client_submission_key: inv.submissionKey,
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
        reference: row.payment_reference,
        idempotency_key: inv.submissionKey
      };

      const { data: created, error } = await supabase
        .from('invoice_receipts')
        .insert([{ ...row, accounting_export: accounting }])
        .select('*')
        .single();
      if (error) throw error;

      /* A part payment leaves the invoice live and still owing, so the status is
         derived from the documents rather than stamped paid. The invoice is only
         closed out once nothing is outstanding against it. */
      const nowSettled = balanceRemaining <= 0.009;
      const paidUpdate = {
        status: nowSettled ? 'paid' : 'validated',
        balance_due: balanceRemaining,
        payment_reference: row.payment_reference
      };
      if (nowSettled) paidUpdate.paid_at = new Date().toISOString();
      else paidUpdate.paid_at = null;
      const { error: paidErr } = await supabase
        .from('invoices')
        .update(paidUpdate)
        .eq('id', inv.id);
      if (paidErr) throw paidErr;

      /* A proforma request becomes a real document once money arrives, so its
         sale is recognised here. postInvoice is idempotent per invoice. */
      if (nowSettled && (inv.status === 'proforma' || inv.status === 'draft')) {
        await postInvoice(companyId, { ...inv, status: 'paid', total_incl: inv.total_incl });
      }
      /* A receipt row only links to its invoice, so the itinerary and client
         are carried across here — without them the journal cannot attribute
         the cash to the booking it settled. */
      await postReceipt(companyId, {
        ...row,
        id: created.id,
        accounting_export: accounting,
        itinerary_id: inv.itinerary_id || null,
        client_id: inv.client_id || null
      });

      await fetchInvoices(companyId);
      await loadTenantFinance(companyId);
      await reloadViewing(inv.id);
      setReceiptPromptFor(null);
      showToast(
        nowSettled
          ? `Receipt ${number} issued`
          : `Receipt ${number} issued. ${fmtMoney(balanceRemaining, symOf(inv.currency_code))} still outstanding on ${inv.invoice_number}`,
        'success'
      );
      if (created) setTimeout(() => printReceipt(created), 250);
    } catch (err) {
      if (err.code === '23505' && /submission_key/i.test(err.message || '')) {
        await fetchInvoices(companyId);
        await loadTenantFinance(companyId);
        await reloadViewing(inv.id);
        setReceiptPromptFor(null);
        showToast('This payment request was already recorded. The invoice balances have been refreshed.', 'warning');
      } else if ((err.code === '23514' || err.code === 'check_violation') && (err.details || err.detail)) {
        let detail = null;
        try {
          detail = JSON.parse(err.details || err.detail);
        } catch {
          detail = null;
        }
        if (detail?.reason === 'receipt_limit') {
          const allowed = Number(detail.allowed) || 0;
          setReceiptForm((current) => ({ ...current, amount: allowed > 0 ? allowed.toFixed(2) : '' }));
          setReceiptPromptFor((current) => current
            ? { ...current, derivedBalance: Math.min(current.derivedBalance, allowed) }
            : current);
          await fetchInvoices(companyId);
          await loadTenantFinance(companyId);
          showToast(`Only ${fmtMoney(allowed, symOf(inv.currency_code))} remains available across this invoice and itinerary. The amount has been updated.`, 'warning');
        } else {
          showToast(err.message || 'Payment exceeds the remaining itinerary balance', 'error');
        }
      } else {
        showToast(err.message || 'Failed to issue receipt', 'error');
      }
    } finally {
      receiptSubmissionRef.current = false;
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
  /* A credit note raised on its own, for less than the invoice, without voiding
     it — what a price decrease on a settled booking needs. */
  const [creditDraft, setCreditDraft] = useState(null);
  const [creditAmount, setCreditAmount] = useState('');
  const [creditReason, setCreditReason] = useState('');

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

  /* Raise a credit note for a chosen amount against an invoice, WITHOUT voiding
     it. Voiding is the special case where the credit covers everything
     outstanding, so the two share this path rather than duplicating the
     numbering, the tax split and the journal posting. */
  const raiseCreditNote = async (inv, totalIncl, reason, lines) => {
    const gross = round2(totalIncl);
    const why = reason.trim();
    if (!inv || gross <= 0 || !why) return;

    /* The ceiling is what is still owed, not what the invoice billed. Money
       already received cannot be credited back as though it had never arrived:
       that is a refund, and it needs its own document. */
    const owed = balanceOf(inv);
    if (gross > owed + 0.009) {
      const paid = netReceivedTotal(inv.id, allReceipts);
      showToast(
        paid > 0.009
          ? `Only ${fmtMoney(owed, symOf(inv.currency_code))} is still outstanding on ${inv.invoice_number}. The ${fmtMoney(paid, symOf(inv.currency_code))} already received has to be refunded, not credited.`
          : `That is more than the ${fmtMoney(owed, symOf(inv.currency_code))} still outstanding on ${inv.invoice_number}`,
        'error'
      );
      return;
    }
    /* Voiding the invoice is only correct when the credit clears everything.
       A part credit leaves a live invoice the client still owes, so voiding it
       would cancel a document that is still valid. */
    const voidsInvoice = gross >= owed - 0.009;

    try {
      const { data: cnNumber, error: cnErr } = await supabase.rpc('get_next_credit_note_reference', { p_company_id: companyId });
      if (cnErr || !cnNumber) throw new Error(cnErr?.message || 'Could not allocate credit note number');

      /* Net and tax in proportion to the amount credited, against the invoice's
         own total, with tax as the remainder so the three reconcile. */
      const total = round2(num(inv.total_incl));
      const ratio = total > 0 ? gross / total : 0;
      const cnRow = {
        company_id: companyId,
        invoice_id: inv.id,
        invoice_number: inv.invoice_number,
        invoice_type: inv.invoice_type,
        credit_note_number: cnNumber,
        status: 'issued',
        currency_code: inv.currency_code,
        /* Net and tax in proportion to the amount credited, with tax as the
           remainder so the three always reconcile. */
        subtotal_excl: round2((Number(inv.subtotal_excl) || 0) * ratio),
        tax_total: 0,
        total_incl: gross,
        tax_label: inv.tax_label,
        tax_rate: inv.tax_rate,
        reason: why,
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
      cnRow.tax_total = round2(gross - cnRow.subtotal_excl);

      const { data: createdCn, error: cnErr2 } = await supabase
        .from('credit_notes')
        .insert([{ ...cnRow, accounting_export: creditNotePayload(cnRow, lines || []) }])
        .select('*')
        .single();
      if (cnErr2) throw cnErr2;

      /* Record the credit against the invoice and bring the balance down with
         it. A part credit leaves the invoice live and owing the rest; a full one
         clears it and voids the document. */
      const alreadyCredited = creditedTotal(inv.id, allCreditNotes);
      const afterCredit = voidsInvoice ? 0 : balanceOf(inv);
      const invPatch = {
        credited_amount: round2(alreadyCredited + gross),
        balance_due: afterCredit
      };
      if (voidsInvoice) {
        invPatch.status = 'void';
        invPatch.void_reason = why;
        invPatch.credit_note_id = createdCn.id;
        invPatch.credit_note_number = createdCn.credit_note_number;
      } else {
        /* Still owed money, so it is a live invoice, not a paid one. */
        invPatch.status = settledStatus({ ...inv, status: 'validated' }, allReceipts);
      }
      const { error: invErr } = await supabase.from('invoices').update(invPatch).eq('id', inv.id);
      if (invErr) {
        /* A credit note with no credit against the invoice would be re-credited
           on the next attempt, so take it back out. */
        await supabase.from('credit_notes').delete().eq('id', createdCn.id);
        throw invErr;
      }

      await postCreditNote(companyId, createdCn);
      await fetchInvoices(companyId);
      await reloadViewing(inv.id);
      setCreditDraft(null);
      setCreditAmount('');
      setCreditReason('');
      showToast(
        voidsInvoice
          ? `${inv.invoice_number} voided and credited (${createdCn.credit_note_number})`
          : `${createdCn.credit_note_number} raised for ${fmtMoney(gross, symOf(inv.currency_code))}`,
        'success'
      );
    } catch (err) {
      showToast(err.message || 'Failed to raise credit note', 'error');
    }
  };

  const requestCreditNote = (inv, suggestedAmount) => {
    /* The ceiling is what is still owed, so the field never offers to credit
       money that has already been received. */
    const remaining = balanceOf(inv);
    const amount = suggestedAmount > 0 ? Math.min(suggestedAmount, remaining) : remaining;
    setCreditDraft({ inv, remaining });
    setCreditAmount(amount > 0 ? String(round2(amount)) : '');
    setCreditReason('');
  };

  const exportJson = (inv, lines) => {
    const payload = inv.accounting_export && Object.keys(inv.accounting_export).length
      ? inv.accounting_export
      : accountingPayload(inv, lines);
    downloadBlob(JSON.stringify(payload, null, 2), `${inv.invoice_number}.json`, 'application/json');
  };

  const exportExcel = (inv, lines) => {
    downloadBlob(invoiceExcelHtml({ ...inv, balance_due: balanceOf(inv) }, lines, symOf(inv.currency_code), branding), `${inv.invoice_number}.xls`, 'application/vnd.ms-excel');
    showToast('Invoice exported as Excel', 'success');
  };

  const printInvoice = (inv, lines) => {
    const w = openPrintWindow(invoiceDocHtml({ ...inv, balance_due: balanceOf(inv) }, lines, symOf(inv.currency_code), branding));
    if (!w) showToast('Please allow pop-ups to print the invoice', 'warning');
  };

  const exportInvoiceWord = (inv, lines) => {
    downloadBlob(invoiceDocHtml({ ...inv, balance_due: balanceOf(inv) }, lines, symOf(inv.currency_code), branding), `${inv.invoice_number}.doc`, 'application/msword');
    showToast('Invoice exported as Word', 'success');
  };

  const emitEmail = (inv, lines) => {
    const m = invoiceEmail({ ...inv, balance_due: balanceOf(inv) }, lines, branding);
    if (!m.to) { showToast('No client email on file', 'warning'); return; }
    window.open(mailTo(m.to, m.subject, m.body), '_blank');
  };

  const copyInvoice = (inv, lines) => {
    const m = invoiceEmail({ ...inv, balance_due: balanceOf(inv) }, lines, branding);
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

      {/* Finance tabs provide company-wide summaries, with journal and cost of
          sales detail loaded only after the user chooses a scope. */}
      <div className="builder-tabs" style={{ marginTop: '1.25rem' }}>
        {[
          ['invoices', 'Invoices'],
          ['receipts', 'Receipts'],
          ['journal', 'Journal'],
          ['cost-of-sales', 'Cost of Sales'],
          ['accounting', 'Accounting']
        ].map(([id, label]) => (
          <button key={id} type="button" className={`builder-tab ${activeTab === id ? 'active' : ''}`} onClick={() => handleFinanceTabChange(id)}>
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
          <SearchableSelect className="sidebar-select" style={{ ...fieldStyle, width: 'auto' }} value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
            <option value="all">All types</option>
            <option value="deposit">Deposit</option>
            <option value="final">Final</option>
          </SearchableSelect>
          <SearchableSelect className="sidebar-select" style={{ ...fieldStyle, width: 'auto' }} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="all">All statuses</option>
            <option value="proforma">Proforma</option>
            <option value="validated">Validated</option>
            <option value="paid">Paid</option>
            <option value="void">Void</option>
          </SearchableSelect>
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
          itineraries={journalItineraries}
          loading={journalLoading}
          error={journalError}
          onLoadStatus={(status) => loadJournalData({ status })}
          onSearchReference={(reference) => loadJournalData({ reference })}
          onExport={() => pushLedgerFile('general-ledger')}
        />
      )}

      {activeTab === 'cost-of-sales' && (
        <TenantCostOfSalesPanel
          rows={tenancyRows}
          itineraries={costOfSalesItineraries}
          error={tenancyError}
          loading={tenancyLoading}
          onLoadStatus={(status) => loadCostOfSalesData({ status })}
          onSearchReference={(reference) => loadCostOfSalesData({ reference })}
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
                {/* Only excess settled cash can be refunded here. A refund of
                    the excess leaves the invoice balance unchanged. */}
                {viewing.status !== 'void' && refundableOverpayment(viewing, allReceipts) > 0.009 && (
                  <button
                    type="button"
                    className="secondary-btn"
                    style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}
                    onClick={() => openRefundPrompt(viewing)}
                  >
                    <Undo2 size={15} /> Refund
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
                    <tr style={{ background: '#eff6ff' }}>
                      <td colSpan="6" style={{ textAlign: 'right', fontWeight: 900 }}>
                        AMOUNT DUE
                        {viewing.status === 'paid' ? ' (settled)' : ''}
                      </td>
                      <td style={{ textAlign: 'right', fontWeight: 900 }}>{fmtMoney(balanceOf(viewing), symOf(viewing.currency_code))}</td>
                    </tr>
                  </tbody>
                </table>

                <div style={{ marginTop: '0.85rem', display: 'flex', gap: '1.5rem', flexWrap: 'wrap' }}>
                  <div><div style={{ fontSize: '0.78rem', color: '#94a3b8', fontWeight: 700 }}>Invoice total</div><div style={{ fontWeight: 800 }}>{fmtMoney(viewing.total_incl, symOf(viewing.currency_code))}</div></div>
                  <div><div style={{ fontSize: '0.78rem', color: '#94a3b8', fontWeight: 700 }}>Amount due</div><div style={{ fontWeight: 800 }}>{fmtMoney(balanceOf(viewing), symOf(viewing.currency_code))}</div></div>
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
                  ) : <div style={{ fontSize: '0.9rem', color: '#94a3b8' }}>No bank account set for {viewing.currency_code}. Add one in Settings ? Bank Accounts.</div>}
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
              Recording payment for <b>{receiptPromptFor.invoice_number}</b>. Leave the amount short to pay it off in instalments; the remainder stays outstanding.
            </p>
            <div style={{ display: 'grid', gap: '0.85rem' }}>
              <div className="sidebar-field">
                <label>Date Received</label>
                <input className="sidebar-select" style={fieldStyle} type="date" value={receiptForm.received_date} onChange={(e) => setReceiptForm({ ...receiptForm, received_date: e.target.value })} />
              </div>
              <div className="sidebar-field">
                <label>Amount Received</label>
                <input
                  className="sidebar-select"
                  style={fieldStyle}
                  type="number"
                  min="0"
                  step="0.01"
                  max={receiptPromptFor.derivedBalance}
                  value={receiptForm.amount ?? ''}
                  onChange={(e) => setReceiptForm({ ...receiptForm, amount: e.target.value })}
                />
                <small style={{ color: '#64748b' }}>
                  Outstanding on this invoice: {fmtMoney(balanceOf(receiptPromptFor), symOf(receiptPromptFor.currency_code))}
                </small>
              </div>
              <div className="sidebar-field">
                <label>Payment Method</label>
                <SearchableSelect className="sidebar-select" style={fieldStyle} value={receiptForm.payment_method} onChange={(e) => setReceiptForm({ ...receiptForm, payment_method: e.target.value })}>
                  <option value="EFT">EFT / Bank transfer</option>
                  <option value="Card">Card</option>
                  <option value="Cash">Cash</option>
                  <option value="Online">Online</option>
                  <option value="Other">Other</option>
                </SearchableSelect>
              </div>
              <div className="sidebar-field">
                <label>Payment Reference</label>
                <input className="sidebar-select" style={fieldStyle} placeholder="Bank reference / transaction ID" value={receiptForm.payment_reference} onChange={(e) => setReceiptForm({ ...receiptForm, payment_reference: e.target.value })} />
              </div>
              <div style={{ background: '#f8fafc', borderRadius: '10px', padding: '0.75rem 1rem', fontSize: '0.9rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>Balance remaining after this receipt</span>
                  <b>{fmtMoney(balanceAfterReceipt(receiptPromptFor, Number(receiptForm.amount)), symOf(receiptPromptFor.currency_code))}</b>
                </div>
              </div>
            </div>
            <div className="form-actions">
              <button type="button" className="secondary-btn" onClick={() => setReceiptPromptFor(null)}>Cancel</button>
              <button type="button" className="primary-btn" style={{ flex: 1 }} disabled={issuingReceipt || !(Number(receiptForm.amount) > 0.009) || Number(receiptForm.amount) > balanceOf(receiptPromptFor) + 0.009} onClick={submitReceipt}>
                {issuingReceipt ? 'Issuing…' : 'Issue Receipt'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Refund: money leaving the business. Only money actually held against
          the invoice can go back, so the cap is shown rather than left to be
          discovered as a server error. */}
      {refundPromptFor && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ maxWidth: '520px' }}>
            <div className="modal-header">
              <h2>Refund {refundPromptFor.invoice_number}</h2>
              <button className="close-btn" onClick={() => setRefundPromptFor(null)}><X size={20} /></button>
            </div>
            <p style={{ color: '#64748b', fontSize: '0.9rem', marginTop: 0 }}>
              Return only the excess received above the tax-inclusive invoice total. Refunding this
              amount leaves the invoice fully settled.
            </p>
            <div style={{ display: 'grid', gap: '0.85rem' }}>
              <div className="sidebar-field">
                <label>Date</label>
                <input className="sidebar-select" style={fieldStyle} type="date" value={refundForm.refunded_date} onChange={(e) => setRefundForm({ ...refundForm, refunded_date: e.target.value })} />
              </div>
              <div className="sidebar-field">
                <label>Amount to Refund</label>
                <input
                  className="sidebar-select"
                  style={fieldStyle}
                  type="number"
                  min="0"
                  step="0.01"
                  max={refundPromptFor.refundCap}
                  value={refundForm.amount ?? ''}
                  onChange={(e) => setRefundForm({ ...refundForm, amount: e.target.value })}
                />
                <small style={{ color: '#64748b' }}>
                  Excess received above the total invoice value: {fmtMoney(refundPromptFor.refundCap, symOf(refundPromptFor.currency_code))}.
                </small>
              </div>
              <div className="sidebar-field">
                <label>Reason</label>
                <textarea
                  className="sidebar-select"
                  style={{ ...fieldStyle, minHeight: '70px' }}
                  placeholder="Why is this money being returned?"
                  value={refundForm.reason}
                  onChange={(e) => setRefundForm({ ...refundForm, reason: e.target.value })}
                />
              </div>
              <div className="sidebar-field">
                <label>Refund Method</label>
                <SearchableSelect className="sidebar-select" style={fieldStyle} value={refundForm.payment_method} onChange={(e) => setRefundForm({ ...refundForm, payment_method: e.target.value })}>
                  <option value="EFT">EFT / Bank transfer</option>
                  <option value="Card">Card</option>
                  <option value="Cash">Cash</option>
                  <option value="Other">Other</option>
                </SearchableSelect>
              </div>
              <div style={{ background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: '10px', padding: '0.75rem 1rem', fontSize: '0.9rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>Outstanding after this refund</span>
                  <b>{fmtMoney(invoiceBalanceAfterRefund(refundPromptFor, num(refundForm.amount) || 0, allReceipts), symOf(refundPromptFor.currency_code))}</b>
                </div>
              </div>
            </div>
            <div className="form-actions">
              <button type="button" className="secondary-btn" onClick={() => setRefundPromptFor(null)}>Cancel</button>
              <button
                type="button"
                className="primary-btn"
                style={{ flex: 1 }}
                disabled={issuingRefund || !(num(refundForm.amount) > 0.009) || !(refundForm.reason || '').trim()}
                onClick={submitRefund}
              >
                {issuingRefund ? 'Recording…' : 'Record Refund'}
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
                    : <>Invoice for <b>{selectedItinerary.reference_number}</b> in <b>{selectedGroup.code}</b>. Review the breakdown and confirm.</>}
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
                      <div key={`${o.kind}-${o.amount}`} style={{ marginTop: '0.6rem', display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
                        <span style={{ fontSize: '0.82rem', color: '#334155' }}>{o.label}</span>
                        {o.kind === 'invoice' ? (
                          <span style={{ fontSize: '0.72rem', color: '#92400e' }}>Use Select &rarr; confirm below to issue it.</span>
                        ) : (
                          <button
                            type="button"
                            className="secondary-btn"
                            style={{ padding: '0.25rem 0.55rem', fontSize: '0.75rem' }}
                            /* A decrease credits only the movement, so it opens the
                               credit note dialog rather than voiding the whole
                               settled invoice. amount 0 means cancel it outright. */
                            onClick={() => {
                              if (o.amount > 0) requestCreditNote(selectedGroup.settledInvoice, o.amount);
                              else requestVoidInvoice(selectedGroup.settledInvoice);
                            }}
                          >
                            {o.amount > 0 ? 'Raise credit note' : 'Void settled invoice'}
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
                    {selectedGroup.paidTotal > 0
                      ? (<><span>Already received</span><b style={{ color: '#047857' }}>{fmtMoney(selectedGroup.paidTotal, symOf(selectedGroup.code))}</b></>)
                      : (<><span>Trip value</span><b>{fmtMoney(selectedGroup.totalIncl, symOf(selectedGroup.code))}</b></>)}
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '0.35rem', fontWeight: 700 }}>
                    <span>{selectedGroup.paidTotal > 0 ? 'Outstanding' : 'Suggested first request'}</span>
                    <b>{fmtMoney(suggestedFirstInvoice, symOf(selectedGroup.code))}</b>
                  </div>
                </div>
                )}

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginTop: '1rem' }}>
                  <div className="sidebar-field">
                    <label>Bank Account ({selectedGroup.code})</label>
                    <SearchableSelect className="sidebar-select" style={fieldStyle} value={chosenBank?.id || ''} onChange={(e) => setSelectedBankId(e.target.value)}>
                      {availableBanks.length === 0 && <option value="">No {selectedGroup.code} account — add one in Settings</option>}
                      {availableBanks.map((b) => (
                        <option key={b.id} value={b.id}>{b.label || b.bank_name || b.currency_code}{b.is_default ? ' (default)' : ''}</option>
                      ))}
                    </SearchableSelect>
                  </div>
                  <div className="sidebar-field">
                    <label>Due Date</label>
                    <input className="sidebar-select" style={fieldStyle} type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
                  </div>
                </div>

                <p style={{ fontSize: '0.8rem', color: '#94a3b8', marginTop: '0.75rem', display: 'flex', gap: '0.35rem', alignItems: 'center' }}>
                  <FileText size={13} /> {suggestedFirstInvoice < selectedGroup.totalIncl - 0.009
                    ? 'This goes out as a proforma: a request for this part of the trip, not yet an invoice for the whole. It is numbered and locked once payment is confirmed and a receipt is issued.'
                    : 'Once validated, the invoice is numbered and locked. It cannot be edited — only voided.'}
                </p>

                <div className="form-actions" style={{ marginTop: '0.5rem' }}>
                  <button type="button" className="secondary-btn" onClick={() => setWizardStep(2)}>Back</button>
                  <button type="button" className="primary-btn" style={{ flex: 1, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '0.35rem' }} disabled={issuing} onClick={handleIssue}>
                    <Check size={16} /> {issuing ? 'Issuing…' : (selectedGroup.reissue?.settled ? 'Issue Change Invoice' : 'Issue Invoice')}
                  </button>
                </div>
              </div>
            )}
            </div>
          </div>
        </div>
      )}

      {creditDraft && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ maxWidth: '480px' }}>
            <div className="modal-header">
              <h2>Raise credit note</h2>
              <button className="close-btn" onClick={() => setCreditDraft(null)}><X size={20} /></button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.9rem' }}>
              <p style={{ margin: 0, color: '#475569', fontSize: '0.84rem', lineHeight: 1.5 }}>
                Against <b>{creditDraft.inv.invoice_number}</b>. {fmtMoney(creditDraft.remaining, symOf(creditDraft.inv.currency_code))} is still
                outstanding on it. Credit less than that and the invoice stays live with the reduced balance;
                credit the whole of it and the invoice is voided.
              </p>
              <div className="sidebar-field">
                <label>Amount to credit (incl tax) *</label>
                <input
                  className="sidebar-select"
                  type="number"
                  min="0"
                  step="0.01"
                  max={creditDraft.remaining}
                  style={fieldStyle}
                  value={creditAmount}
                  onChange={(e) => setCreditAmount(e.target.value)}
                  autoFocus
                />
              </div>
              <div className="sidebar-field">
                <label>Reason *</label>
                <textarea
                  className="sidebar-select"
                  style={{ ...fieldStyle, minHeight: '70px', resize: 'vertical', fontFamily: 'inherit' }}
                  value={creditReason}
                  onChange={(e) => setCreditReason(e.target.value)}
                  placeholder="e.g. Accommodation repriced down after supplier confirmation"
                />
              </div>
              <div className="form-actions" style={{ marginTop: 0 }}>
                <button type="button" className="secondary-btn" onClick={() => setCreditDraft(null)}>Cancel</button>
                <button
                  type="button"
                  className="primary-btn"
                  style={{ flex: 1 }}
                  disabled={!(Number(creditAmount) > 0) || !creditReason.trim()}
                  onClick={() => raiseCreditNote(creditDraft.inv, Number(creditAmount), creditReason, [])}
                >
                  Raise credit note
                </button>
              </div>
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
