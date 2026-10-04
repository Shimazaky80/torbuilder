import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import SearchableSelect from '../components/SearchableSelect';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  Map as MapIcon,
  ArrowLeft,
  Search,
  Copy,
  Download,
  FileDown,
  Save,
  Send,
  MoreVertical,
  Trash2,
  Layers,
  Eraser,
  Plus,
  Check,
  X,
  Calendar,
  Package,
  User,
  Receipt,
  StickyNote,
  Route,
  FileText,
  FileSpreadsheet,
  Printer,
  Link2,
  GripVertical,
  CheckCircle2,
  Edit3,
  Pencil,
  ChevronDown,
  Mail,
  Plane,
  Ticket,
  Lock,
  Users,
  AlertTriangle
} from 'lucide-react';
import { supabase, getLoggedInUserName } from '../lib/supabase';
import { useToast } from '../context/ToastContext';
import { useCurrencies } from '../hooks/useCurrencies';
import ClientTourForm from '../components/ClientTourForm';
import { usePageGuard } from '../context/NavigationGuardContext';
import RoomAllocationModal from '../components/RoomAllocationModal';
import { validateAccommodationServiceInDay, validateDayAccommodation, beddedTravellerCount, allocatedTravellerCount, isAdultTraveller, buildRoomModalItem, joinAccommodationSplitGroup, accommodationRegionConflicts, accommodationRegionOf, canJoinExistingAccommodationDestination } from '../lib/roomAllocationHelper';
import { resolveSeasonForTravel, applyProtectionToRate, rateForTravel as resolveRateForTravel } from '../lib/priceValidity';
import { isSurchargeItem, surchargeTypeOf, surchargeBasisOf, isSurchargeChargeable, surchargeLinkId, surchargeRepeats, surchargeBuyTotal, surchargePricing, needsRepeatPrompt, SURCHARGE_TYPES, CHARGE_BASIS, UNIT_BASES } from '../lib/surchargeFees';
import { computePerPersonRows, breakdownSnapshot } from '../lib/perPersonPricing';
import { contractedServiceTotal, contractPaxRate, repriceServicesForPax, sidebarLibraryRate, supplierPaymentDocumentStatus } from '../lib/servicePricing';
import { accommodationBreakdown } from '../lib/accommodationBreakdown';
import { LIBRARY_ITEM_LIGHT_FIELDS, LIBRARY_ITEM_BASE_FIELDS } from '../lib/libraryItemFields';
import { postInvoice, postReceipt, scaleInvoiceLines } from '../lib/financeJournal';
import { voucherDetailLines } from '../lib/voucherDetails';
import { netBilled, canBill, billableRemaining, billableAtPercentage, parseGuardRejection, guardMessage, netReceivedTotal, settledTotal, refundableTotal, invoiceBalance, bookingReceivableRemaining, bookingOverpayment } from '../lib/settlement';
import { InvoiceFinanceRow, JournalEntryCard, CostOfSalesPanel } from '../components/finance/FinanceJournalViews';
import ConfirmDialog from '../components/ConfirmDialog';
import {
  buildLinesFromDays,
  accountingPayload,
  TYPE_LABEL,
  LOGO_WIDTHS,
  invoiceEmail,
  invoiceDocHtml,
  invoiceExcelHtml,
  receiptDocHtml,
  openPrintWindow,
  isZar,
  taxWordOf,
  taxWordUpper,
  taxAgencyOf,
taxDisplayLabel,
abbrevMealPlan
} from '../lib/invoiceDoc';
import {
  statementFor,
  statementCurrencies,
  statementDocHtml,
  statementEmail,
  statementCsv,
  statementExcelHtml
} from '../lib/statementOfAccount';

/* --- Pure helpers ----------------------------------------------------------- */

const toISODate = (iso) => (iso ? String(iso).slice(0, 10) : '');

const isAccommodationItem = (item) => /accommodation/i.test(item?.category || '');

const paxForService = (service, fallbackPax) => {
  if (/accommodation/i.test(service?.category || '')) {
    const allocated = allocatedTravellerCount(service.roomAllocations);
    if (allocated > 0) return allocated;
  }
  return Math.max(0, Number(fallbackPax) || 0);
};

const storedServicePricing = (row, fallbackPax, markup) => {
  const originalBuyPP = Number(row.unit_cost) || 0;
  const roomAllocations = Array.isArray(row.room_allocations) ? row.room_allocations : [];
  const allocatedPax = /accommodation/i.test(row.category || '')
    ? allocatedTravellerCount(roomAllocations)
    : 0;
  const savedPax = Number(row.pax) || Number(fallbackPax) || 0;
  const hasLegacyWholePartyPricing = allocatedPax > 0 && savedPax > allocatedPax;
  const savedTotalBuy = Number(row.total_buy);
  const savedTotalSell = Number(row.total_sell);
  const buyPP = hasLegacyWholePartyPricing && savedTotalBuy > 0
    ? round2(savedTotalBuy / allocatedPax)
    : originalBuyPP;
  const sellPP = hasLegacyWholePartyPricing && savedTotalSell > 0
    ? round2(savedTotalSell / allocatedPax)
    : round2(buyPP * (1 + markup / 100));
  return {
    buyPP,
    sellPP,
    pax: allocatedPax || savedPax
  };
};

const ymdOf = (iso) => {
  const [y, m, d] = toISODate(iso).split('-').map(Number);
  return [y || 0, m || 0, d || 0];
};

const addDaysToDate = (iso, n) => {
  const [y, m, d] = ymdOf(iso);
  if (!y || !m || !d) return toISODate(iso);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};

const daysInRange = (start, end) => {
  const s = toISODate(start);
  const e = toISODate(end);
  if (!s || !e) return 1;
  const [sy, sm, sd] = ymdOf(s);
  const [ey, em, ed] = ymdOf(e);
  if (!sy || !sm || !sd || !ey || !em || !ed) return 1;
  const diff = Date.UTC(ey, em - 1, ed) - Date.UTC(sy, sm - 1, sd);
  return Math.max(1, Math.round(diff / 86400000) + 1);
};

const formatDateLong = (iso) => {
  const s = toISODate(iso);
  if (!s) return '';
  const [y, m, d] = s.split('-').map(Number);
  if (!y || !m || !d) return s;
  return new Date(y, m - 1, d).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  });
};

/* Compact DD/MM/YYYY used in mailout bodies so drafts stay locale-agnostic. */

/* GM-local DD/MM/YYYY rendering used in outbound emails (keeps every draft
   free of regional ambiguity regardless of the operator's locale). */
const formatDateShort = (iso) => {
  const s = toISODate(iso);
  if (!s) return '';
  const [y, m, d] = s.split('-').map(Number);
  if (!y || !m || !d) return s;
  return `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}/${y}`;
};

const numOr = (v, fallback) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/* VAT split for a VAT-INCLUSIVE amount: the amount already includes tax, so the
   embedded VAT is amount × rate/(100+rate). Used for output VAT (on the sell
   price charged to the client) and input VAT (on the supplier buy price). The
   margin-only net VAT = output VAT - input VAT. */
const vatOfInclusive = (amount, rate) => {
  const r = Number(rate) || 0;
  if (!r) return 0;
  return round2((Number(amount) || 0) * r / (100 + r));
};

const fmtMoney = (n, sym = '') =>
  `${sym}${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

const rateForItem = (item, code) => {
  if (!item) return null;
  const rates = item.item_rates || [];
  if (!rates.length) return null;
  const codeU = (code || '').toUpperCase();
  const byCurr = rates.find((r) => (r.currency || '').toUpperCase() === codeU);
  return byCurr || rates[0];
};

/* Season-aware replacement for rateForItem(): the row that actually prices
   this itinerary, resolved from the travel window instead of taken as the
   first row for the currency. Shared with Finance so both quote the same
   season for the same night. Null only when there is no priced row at all. */
const rateForTravel = (item, code, window, protectionPercent = 0) =>
  resolveRateForTravel({
    rates: item?.item_rates || [],
    currencyCode: code,
    startDate: window?.start,
    endDate: window?.end,
    protectionPercent
  }) || rateForItem(item, code);

// Contract pricing model — drives whether a rate is charged per traveller or
// once (flat / per vehicle / per trip). A flat-rate item (e.g. a city tour
// charged per vehicle) must NOT be multiplied by pax: its per-person figure is
// the contract total divided by the travellers, so per-pax × pax == contract.
const FLAT_BASIS = new Set(['per_vehicle', 'per_trip', 'per_room', 'flat']);

const basisOfItem = (item, code) => {
  const rate = rateForItem(item, code);
  return rate?.rate_basis || item?.pricing_model || 'per_person';
};

const isFlatBasis = (basis) => FLAT_BASIS.has(basis);

const isFlatRoomRate = (rate) => String(rate?.rate_basis || '') === 'per_room';

const basisLabelOf = (basis) => {
  switch (basis) {
    case 'per_vehicle': return 'Flat rate';
    case 'per_trip': return 'Per trip';
    case 'per_room': return 'Per room';
    case 'per_person': return 'Per person';
    case 'per_person_sharing': return 'Per person sharing';
    case 'tiered': return 'Tiered';
    case 'flat': return 'Flat rate';
    default: return 'Per person';
  }
};

/* Date span shown in the per-person pricing breakdown. Starts on the first
   day the currency appears; ends on the last day — extended by one day (the
   checkout) when that last day contains an accommodation service, matching
   how a hotel stay on 12–13 Dec runs to a 14 Dec checkout. */
const ppDateRange = (grp) => {
  const used = (grp?.days || []).filter((r) => r.date && (r.services || []).length);
  if (!used.length) return '—';
  const first = used[0].date;
  const lastDay = used[used.length - 1];
  const staysOver = (lastDay.services || []).some((s) => /accommodation/i.test(s.category || ''));
  return `${first} - ${staysOver ? addDaysToDate(lastDay.date, 1) : lastDay.date}`;
};

/* Per-currency "per person" pricing breakdown used when the Presentation
   preference is "total per person". Delegates the pricing math to the shared
   perPersonPricing helper so itinerary exports and invoice documents always
   agree:
     - Per person sharing: the base an adult pays when sharing accommodation
       plus all non-accommodation services per person.
     - Single supplement: single-occupancy rooms re-priced from the single rate
       instead of the sharing rate (single - sharing) per night. Omitted when
       every traveller shares.
     - Per child: children sharing with adults charged at the child rate where
       one exists (including an explicit 0 = free child) — the sharing base
       plus the per-child child-rate difference. Omitted when no child travels.
       Children with no configured child rate pay the adult sharing figure. */
const computePerPerson = (days, code, travellers, libraryItems, defaults = {}) => {
  const services = [];
  (days || []).forEach((d) => {
    (d.services || []).forEach((sv) => {
      if ((sv.currencyCode || 'ZAR').toUpperCase() !== String(code).toUpperCase()) return;
      if (sv.isOptional) return;
      services.push({
        category: sv.category,
        currencyCode: sv.currencyCode,
        sellPP: Number(sv.sellPP) || 0,
        taxRate: numOr(sv.taxRate, defaults.defaultTaxRate),
        itemId: sv.itemId || null,
        roomAllocations: Array.isArray(sv.roomAllocations) ? sv.roomAllocations : [],
        markup: Number(sv.markup) || 0,
        /* The season this line was actually priced with, when it is in scope.
           A reloaded itinerary has no copy (the row is not persisted), so
           rateBy falls back to resolving the season from the travel window. */
        item_rates: Array.isArray(sv.item_rates) && sv.item_rates.length ? sv.item_rates : null
      });
    });
  });
  const rateBy = (itemId, svcRates) => {
    if (Array.isArray(svcRates) && svcRates.length) {
      const own = rateForTravel({ item_rates: svcRates }, code, defaults.travelWindow, defaults.protectionPercent);
      if (own) return { ...own, _ageRanges: (libraryItems.find((x) => String(x.id) === String(itemId))?.child_age_ranges) || [] };
    }
    if (!itemId) return null;
    const item = libraryItems.find((x) => String(x.id) === String(itemId));
    if (!item) return null;
    const rate = rateForTravel(item, code, defaults.travelWindow, defaults.protectionPercent);
    return rate ? { ...rate, _ageRanges: item.child_age_ranges || [] } : null;
  };
  const list = Array.isArray(travellers) ? travellers : [];
  const pax = Math.max(list.length, Number(defaults.paxCount) || 0, 1);
  const paxList = list.length ? list : Array.from({ length: pax }, () => ({ age: 30 }));
  return computePerPersonRows({ services, travellers: paxList, rateBy, defaultTaxRate: defaults.defaultTaxRate });
};

const visibleInCurrency = (item, code) => {
  const codeU = (code || '').toUpperCase();
  const hasRateCurr = (item.item_rates || []).some((r) => (r.currency || '').toUpperCase() === codeU);
  if (hasRateCurr) return true;
  const itemCurr = (item.currency || '').toUpperCase();
  if (itemCurr) return itemCurr === codeU;
  return codeU === 'ZAR';
};

const DEFAULT_CATEGORY_CHIPS = [
  'Accommodation', 'Transfers', 'Activities / Tours', 'Flights / Charter',
  'Meals', 'Guide', 'Trains', 'Tickets', 'Extras', 'Car Rental'
];

const csvEscape = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;

const htmlEscape = (v) =>
  String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const STATUS_OPTIONS = [
  { value: 'quotation', label: 'Quotation' },
  { value: 'provisional', label: 'Provisional Booking' },
  { value: 'confirmed', label: 'Confirmed Booking' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'completed', label: 'Completed' },
  { value: 'cancelled', label: 'Cancelled' }
];

const STATUS_MOD = {
  quotation: 'quotation',
  provisional: 'provisional',
  confirmed: 'confirmed',
  in_progress: 'in_progress',
  completed: 'completed',
  cancelled: 'cancelled'
};

/* Statuses reach the builder from three places: the route state, the saved
   itineraries row, and older builds that stored the lifecycle in Title Case or
   in a shortened form ('Quotation', 'Pending', 'Confirmed Booking'). Every
   stage gate below compares the value against the canonical lowercase keys, so
   an unrecognised value silently leaks a gated tab — a Quotation would show
   Finance. Normalise on read instead of trusting the stored string, and treat
   anything still unknown as Quotation, the stage that gates the most closed. */
const STATUS_ALIASES = {
  quote: 'quotation',
  quoted: 'quotation',
  quotation: 'quotation',
  draft: 'quotation',
  pending: 'pending_confirmation',
  pending_confirmation: 'pending_confirmation',
  awaiting_confirmation: 'pending_confirmation',
  provisional: 'provisional',
  provisional_booking: 'provisional',
  booked: 'provisional',
  confirmed: 'confirmed',
  confirmed_booking: 'confirmed',
  in_progress: 'in_progress',
  travelling: 'in_progress',
  traveling: 'in_progress',
  completed: 'completed',
  complete: 'completed',
  cancelled: 'cancelled',
  canceled: 'cancelled'
};

const normaliseStatus = (v) => {
  const key = String(v ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return STATUS_ALIASES[key] || 'quotation';
};

const statusLabelOf = (v) => STATUS_OPTIONS.find((s) => s.value === normaliseStatus(v))?.label || 'Quotation';

/* --- Email tooling (default tenant mail client via mailto) -----------------
   There is no SMTP backend in this build; the tenant's default email client
   handles sending. We compose fully prefilled mailto: drafts for every
   supplier / service so the user simply presses Send. Vouchers and service
   requests are strictly derived from persisted data — they cannot be edited. */

const mailTo = (email, subject, body) =>
  `mailto:${(email || '').trim()}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

/* --- Tenant company profile (Bill-from) for the travel documents -----------
   The company profile from Settings — name, billing address and the
   Tel / Email / Web contact lines — is stamped onto every supplier-facing
   travel document (vouchers, daily briefs, reconfirmation drafts) so the
   supplier always knows who is asking and how to reach the agency. */
const companyContactLines = (billing) => {
  const tel = String(billing?.contact_tel || '').trim();
  const cell = String(billing?.contact_cell || '').trim();
  const email = String(billing?.contact_email || '').trim();
  const web = String(billing?.contact_website || '').trim();
  return [
    (tel || cell) ? `Tel: ${[tel, cell].filter(Boolean).join(' · ')}` : '',
    email ? `Email: ${email}` : '',
    web ? `Web: ${web}` : ''
  ].filter(Boolean);
};

const companyNameOf = (billing) =>
  String(billing?.legal_name || billing?.name || '').trim();

/* Supplier records for the services on an itinerary, keyed by supplier id.
   Services carry their own supplier_id (persisted on itinerary_day_items), so
   the supplier's email/phone resolve for every service — including custom
   services that never came from a library item. Without this the provisional
   service requests and the confirmed reconfirmations fall back to
   "No email on file" even when the supplier has an email on file. */
const fetchSupplierMap = async (supplierIds) => {
  const ids = [...new Set((supplierIds || []).filter(Boolean))];
  if (!ids.length) return {};
  const { data } = await supabase
    .from('suppliers')
    .select('id, name, email, phone, website, contact_person, address, country, province_state, city, city_location')
    .in('id', ids);
  const map = {};
  (data || []).forEach((s) => { map[s.id] = s; });
  return map;
};

/* Attach the resolved supplier onto each service so servicesBySupplier() and
   the per-service email drafts can reach it without another lookup. */
const attachSuppliers = (builtDays, supMap) => {
  if (!supMap || !Object.keys(supMap).length) return builtDays;
  builtDays.forEach((d) => {
    (d.services || []).forEach((sv) => {
      const sup = supMap[sv.supplierId] || null;
      if (sup) sv.supplierObj = sup;
    });
  });
  return builtDays;
};

const companyAddressOf = (billing) =>
  String(billing?.billing_address || '').trim();

/* Name + address + contact, as plain lines for the text-only documents. */
const companyProfileLines = (billing) => [
  companyNameOf(billing),
  companyAddressOf(billing),
  ...companyContactLines(billing)
].filter(Boolean);

/* "Kind regards," followed by the full company profile — the sign-off block on
   every supplier email draft. */
const companySignOffLines = (billing) => [
  'Kind regards,',
  '',
  ...companyProfileLines(billing)
];

const emailOf = (sup) =>
  (sup && (sup.email || sup.contact_email || sup.email_address || '').trim()) || '';

/* ----------------------------------------------------------------------------
   Text decode guard. Library rows (names/notes) arrive from any era of the
   tenant DB and can carry mojibake from a legacy import (UTF-8 bytes read as
   Latin-1/CP1252, then re-stored). We only fix display, never the DB: replace
   the classic double-encoded sequences at render time. Pure + idempotent —
   returns its input unchanged when nothing needs decoding, so it is a no-op
   on already-clean strings. This forces every day-by-day label back to
   plain English/ASCII while leaving the persisted rows untouched.
   ---------------------------------------------------------------------------- */


/* Repair classic UTF-8-misread-as-Latin-1 mojibake in text that arrived via a
   legacy-codepage import (U+00C3 U+00A9 -> "é", U+00E2 U+20AC U+2122 -> "’",
   U+00F0 U+0178 U+0153 U+0178 U+00EF U+00B8 U+008F -> "???").
   Pure no-op on clean strings; used only to normalise on-screen day-by-day
   library labels + notes. Never touches the database. */
const MOJIBAKE_ALIASES = [
  // Undefined CP1252 slots (0x81/0x8D/0x8F/0x90/0x9D) that the legacy importer
  // surfaced as neighbouring printable glyphs, plus its lossy U+FFFD stand-ins.
  [/\u00c2\u00b6/g, '\u00b7'], [/\u00c2\u00ba/g, '\u00b7'], [/\u00c2\u00bf/g, '\u00b7'],
  [/\u00c2\u00b0\u2026/g, '\u00b7'],
  [/\u00c3\ufffd/g, '\u00c3'], [/\u00e2\u20ac\ufffd/g, '\u201d']
];

// CP1252 byte -> char, including the five undefined slots that the importer
// emitted as raw C1 controls instead of a replacement glyph.
const CP1252_CHARS = (() => {
  const t = [];
  for (let i = 0; i < 256; i++) t.push(String.fromCharCode(i));
  const over = {
    0x80: '\u20ac', 0x82: '\u201a', 0x83: '\u0192', 0x84: '\u201e', 0x85: '\u2026',
    0x86: '\u2020', 0x87: '\u2021', 0x88: '\u02c6', 0x89: '\u2030', 0x8a: '\u0160',
    0x8b: '\u2039', 0x8c: '\u0152', 0x8e: '\u017d', 0x91: '\u2018', 0x92: '\u2019',
    0x93: '\u201c', 0x94: '\u201d', 0x95: '\u2022', 0x96: '\u2013', 0x97: '\u2014',
    0x98: '\u02dc', 0x99: '\u2122', 0x9a: '\u0161', 0x9b: '\u203a', 0x9c: '\u0153',
    0x9e: '\u017e', 0x9f: '\u0178'
  };
  for (const [b, c] of Object.entries(over)) t[b] = c;
  return t;
})();

const CP1252_BYTES = (() => {
  const m = new Map();
  for (let i = 0; i < 256; i++) if (!m.has(CP1252_CHARS[i])) m.set(CP1252_CHARS[i], i);
  return m;
})();

const utf8Decoder = new TextDecoder('utf-8', { fatal: true });

// Round-trips a suspected mojibake run back through CP1252 -> UTF-8.
// Returns null unless the result is valid UTF-8 and actually different, so
// already-clean text is never touched.
const decodeCp1252Run = (s) => {
  if (!s) return null;
  const bytes = [];
  for (const ch of s) {
    const b = CP1252_BYTES.get(ch);
    if (b === undefined) return null;
    bytes.push(b);
  }
  try {
    const out = utf8Decoder.decode(Uint8Array.from(bytes));
    return out === s ? null : out;
  } catch {
    return null;
  }
};

// Longest decodable prefix, so a clean glyph sitting next to a corrupt run
// (e.g. "U+00C3 U+00A9 and £5") still gets repaired without swallowing the
// clean part.
const decodeCp1252RunPartial = (run) => {
  const whole = decodeCp1252Run(run);
  if (whole !== null) return whole;
  for (let len = run.length - 1; len >= 1; len--) {
    const head = decodeCp1252Run(run.slice(0, len));
    if (head !== null) return head + run.slice(len);
  }
  return run;
};

const repairText = (txt) => {
  if (!txt || typeof txt !== 'string') return txt || '';
  let out = String(txt);
  for (const [re, rep] of MOJIBAKE_ALIASES) out = out.replace(re, rep);
  // eslint-disable-next-line no-control-regex
  return out.replace(/[^\x00-\x7F]+/g, decodeCp1252RunPartial);
};

/* Merge raw library_items + item_rates + car_rental_rates + suppliers rows into
   the enriched shape the builder expects (uses only the rows that were fetched,
   so boot + sidebar search stay small and on-demand). */
const buildMergedItems = (items, ratesData, carRates, suppliersData) => {
  const rateMap = {};
  (ratesData || []).forEach((r) => {
    if (!rateMap[r.item_id]) rateMap[r.item_id] = [];
    rateMap[r.item_id].push(r);
  });
  const supMap = {};
  (suppliersData || []).forEach((s) => { supMap[s.id] = s; });
  return (items || []).map((it) => ({
    ...it,
    name: repairText(it.name),
    description: repairText(it.description),
    category: it.category === 'Guide / Driver' ? 'Guide' : it.category,
    item_rates: rateMap[it.id] || [],
    car_rental_rates: (carRates || []).filter((r) => r.item_id === it.id),
    supplier: supMap[it.supplier_id] || null
  }));
};

const serviceNotes = (sv, libraryItems) => {
  const li = (libraryItems || []).find((it) => it.id === sv.itemId);
  return sv.notes || sv.notesOverride || sv.descOverride || li?.description || '';
};

const timeRangeOf = (sv) => {
  const st = sv.startTime ? sv.startTime.slice(0, 5) : (sv.time ? String(sv.time).slice(0, 5) : '');
  const en = sv.endTime ? sv.endTime.slice(0, 5) : '';
  if (st && en) return `${st} – ${en}`;
  return st || en || '';
};

/* Optional per-service notes override persisted on the row. */
const svNote = (sv) => (sv.notes !== undefined && sv.notes !== null ? String(sv.notes) : '');
const svTime = (sv) => `${sv.startTime || ''}${sv.startTime && sv.endTime ? '?' : ''}${sv.endTime || ''}`;

/* --- Confirmation status codes (service request results) --------------------
   Recorded per service while provisional. Confirmed bookings always reflect OK
   (the final state), regardless of what was captured on the provisional tab. */
const CONFIRMATION_OPTIONS = [
  { value: 'RQ', label: 'RQ', title: 'On Request — requested but not yet confirmed; supplier to check availability' },
  { value: 'OK', label: 'OK', title: 'Confirmed — booked by the supplier' },
  { value: 'NA', label: 'NA', title: 'Not Available — unavailable for the requested dates or conditions' },
  { value: 'WL', label: 'WL', title: 'Waitlist — depends on cancellations or new availability' },
  { value: 'XX', label: 'XX', title: 'Cancelled — the service has been cancelled' }
];
const CONFIRMATION_META = {
  RQ: { color: '#b45309', bg: '#fffbeb', label: 'RQ · On Request' },
  OK: { color: '#15803d', bg: '#f0fdf4', label: 'OK · Confirmed' },
  NA: { color: '#dc2626', bg: '#fef2f2', label: 'NA · Not Available' },
  WL: { color: '#6d28d9', bg: '#f5f3ff', label: 'WL · Waitlist' },
  XX: { color: '#475569', bg: '#f1f5f9', label: 'XX · Cancelled' }
};

const servicesBySupplier = (days, libraryItems) => {
  const groups = {};
  const order = [];
  const supplierOf = (sv) => {
    /* supplierObj (resolved on load) wins; the library item is the fallback for
       services added in-session before a supplier fetch has run. */
    const li = (libraryItems || []).find((it) => it.id === sv.itemId);
    return sv.supplierObj || li?.supplier || sv.sup || null;
  };
  const groupKeyOf = (sv) => {
    const sup = supplierOf(sv);
    const supId = sup?.id || sv.supplierId || sv.supplier_id;
    if (supId) return `id:${supId}`;
    const name = sv.supplierName || sv.supplier_name || sup?.name || '';
    return name ? `name:${name.trim().toLowerCase()}` : 'unknown';
  };
  (days || []).forEach((day) => {
    (day.services || []).forEach((sv) => {
      const key = groupKeyOf(sv);
      if (!groups[key]) {
        const sup = supplierOf(sv);
        groups[key] = {
          key,
          sup,
          label: sup?.name || sv.supplierName || sv.supplier_name || 'Unknown supplier',
          email: emailOf(sup) || sv.supplierEmail || '',
          svcs: []
        };
        order.push(key);
      }
      groups[key].svcs.push({ sv, day });
    });
  });
  return order.map((k) => groups[k]);
};

/* Money for supplier-facing text, written the way an operator would say it
   out loud: "R960", "R480.50". Whole amounts stay whole so the arithmetic in a
   contract rate line stays readable. */
const contractMoney = (value, symbol) => {
  const amount = round2(Number(value) || 0);
  return `${symbol}${Number.isInteger(amount) ? amount.toFixed(0) : amount.toFixed(2)}`;
};

/* What we owe the supplier: the contracted (buy) rate held on the library item,
   never our marked-up selling price. The arithmetic is spelled out so the
   supplier can check it against their own contract — "R960 = R480 x2".
   Accommodation is contracted per room, so it quotes the room count instead
   of the head count. */
const contractRateLine = (sv, paxCount, currencySymbol) => {
  const pax = paxForService(sv, paxCount);
  const buyPP = Number(sv?.buyPP) || 0;
  const total = round2(buyPP * pax);
  const label = 'Estimated Contract Rate';
  if (total <= 0) return `${label}: ${contractMoney(0, currencySymbol)}`;

  const occupiedRooms = (Array.isArray(sv?.roomAllocations) ? sv.roomAllocations : [])
    .filter((rm) => (rm.allocatedTravellers || []).length > 0);

  if (/accommodation/i.test(sv?.category || '') && occupiedRooms.length) {
    const perRoom = round2(total / occupiedRooms.length);
    const roomWord = occupiedRooms.length === 1 ? 'Room' : 'Rooms';
    return `${label}: ${contractMoney(total, currencySymbol)} = ${occupiedRooms.length} ${roomWord} x ${contractMoney(perRoom, currencySymbol)}`;
  }

  if (pax > 1) {
    return `${label}: ${contractMoney(total, currencySymbol)} = ${contractMoney(buyPP, currencySymbol)} x ${pax}`;
  }

  return `${label}: ${contractMoney(total, currencySymbol)}`;
};

/* One combined mailto body for every service going to a single supplier. */
const supplierRequestEmail = (group, allDays, meta, currencySymbol, paxCount, billing) => {
  const adults = Number(meta.numAdults) || 0;
  const children = Number(meta.numChildren) || 0;
  const bodies = group.svcs.map(({ sv, day }) => {
    return [
      `Service: ${repairText(sv.name)}`,
      day.date ? `Date: ${formatDateLong(day.date)}` : '',
      timeRangeOf(sv) ? `Time: ${timeRangeOf(sv)}` : '',
      serviceNotes(sv) ? `Notes: ${serviceNotes(sv)}` : '',
      `Guests: ${adults || 0} Adult(s)${children ? ` / ${children} Child(ren)` : ''} (${paxCount} total)`,
      contractRateLine(sv, paxCount, currencySymbol)
    ].filter((l) => l !== '').join('\n');
  });
  const body = [
    `We would like to place a provisional request for the following services:`,
    '',
    bodies.join('\n\n---\n\n'),
    '',
    `Our reference: ${meta.referenceNumber || meta.reference || '—'}`,
    `Client: ${meta.client?.name || '—'}${meta.client?.nationality ? ` (${meta.client.nationality})` : ''}`,
    `Agency / Direct: ${meta.agencyRef || meta.agency_reference || '—'}`,
    '',
    `Thank you for your assistance.`,
    '',
    ...companySignOffLines(billing)
  ].join('\n');
  return {
    to: group.email,
    subject: `Provisional Service Request — ${meta.referenceNumber || meta.reference || ''}`,
    body
  };
};

/* Confirmed-stage reconfirmation — one mailto draft per supplier, carrying the
   per-category confirmation details (status OK + supplier confirmation data). */
const supplierConfirmationEmail = (group, allDays, meta, currencySymbol, paxCount, billing) => {
  const adults = Number(meta.numAdults) || 0;
  const children = Number(meta.numChildren) || 0;
  const bodies = group.svcs.map(({ sv, day }) => [
    `Service: ${repairText(sv.name)}`,
    day.date ? `Date: ${formatDateLong(day.date)}` : '',
    ...voucherDetailLines(sv).map((l) => `  ${l}`),
    `Guests: ${adults || 0} Adult(s)${children ? ` / ${children} Child(ren)` : ''} (${paxCount} total)`
  ].filter((l) => l !== '').join('\n'));
  const body = [
    `Reconfirming the following booked services for our client:`,
    '',
    bodies.join('\n\n---\n\n'),
    '',
    `Our reference: ${meta.referenceNumber || meta.reference || '—'}`,
    `Client: ${meta.client?.name || '—'}${meta.client?.nationality ? ` (${meta.client.nationality})` : ''}`,
    `Agency / Direct: ${meta.agencyRef || meta.agency_reference || '—'}`,
    `Travel dates: ${meta.travelStart} to ${meta.travelEnd}`,
    '',
    `Please advise immediately if any of the above changes.`,
    '',
    `Thank you for your cooperation,`,
    '',
    ...companySignOffLines(billing)
  ].join('\n');
  return {
    to: group.email,
    subject: `Service Confirmation — ${meta.referenceNumber || meta.reference || ''}`,
    body
  };
};

/* Per-item email line group shared by the single-service draft and the
   combined-per-supplier draft so both styles carry the exact same fields in
   the exact same order (Service ? Dates ? Time ? Guests ? Special Req).      */
const serviceItemLines = (sv, day, meta, currencySymbol, paxCount, libraryItems) => {
  const adults = Number(meta.numAdults) || 0;
  const children = Number(meta.numChildren) || 0;
  const dayShot = formatDateShort(day.date);
  const endDate = dayShot && formatDateShort(meta.travelEnd) && formatDateShort(meta.travelEnd) !== dayShot
    ? formatDateShort(meta.travelEnd)
    : dayShot;
  return [
    `Service: ${repairText(sv.name)}`,
    dayShot ? `Dates: Arrival ${dayShot}, Departure ${endDate}` : '',
    timeRangeOf(sv) ? `Time: ${timeRangeOf(sv)}` : '',
    `Number of Guests: ${adults || 0} Adult(s)${children ? ` / ${children} Child(ren)` : ''}`,
    serviceNotes(sv, libraryItems) ? `Special Requirements: ${serviceNotes(sv, libraryItems)}` : 'Special Requirements: None'
  ].filter((l) => l !== '').join('\n');
};

/* One mailto draft per item, sent straight to the item's supplier. */
const serviceItemEmail = (sv, day, meta, currencySymbol, paxCount, billing, libraryItems) => {
  const agencyLabel = meta.agencyRef || meta.agency_reference || meta.client?.name || 'Direct Client';
  const body = [
    `We would like to place a provisional request for the following service on behalf of our client:`,
    '',
    serviceItemLines(sv, day, meta, currencySymbol, paxCount, libraryItems),
    '',
    contractRateLine(sv, paxCount, currencySymbol),
    `Our Reference#: ${meta.referenceNumber || meta.reference || '—'}`,
    `Agency/Direct Client: ${agencyLabel}`,
    `Client Nationality: ${meta.client?.nationality || '—'}`,
    '',
    ...companySignOffLines(billing)
  ].join('\n');
  return {
    to: emailOf(sv.sup || sv.supplierObj) || sv.supplierEmail || '',
    subject: `Provisional Service Request — ${meta.referenceNumber || meta.reference || ''}`,
    body
  };
};

/* Filename-safe token for a group label — used when the user downloads a
   voucher as Word/PDF. Mirrors the CSV/GDocs naming already used elsewhere. */
const safeNameOf = (label) => {
  const s = String(label || '').replace(/[^\w-]+/g, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '');
  return s || 'voucher';
};

/* Display name for a traveller. Guards against a missing first name: a template
   literal would stringify it to the literal text "undefined", which is truthy
   and so would defeat a `|| 'Traveller'` fallback — and these names go out to
   suppliers on vouchers. */
const travellerName = (tr) => `${(tr?.name || '').trim()} ${(tr?.surname || '').trim()}`.trim() || 'Traveller';

/* Per-traveller detail lines (nationality, passport, emergency contact, dietary,
   insurance) so important client info travels into vouchers + documents. Notes are
   intentionally NOT inline here — they are compounded at the bottom of the voucher
   in a single Notes box, each labelled with the traveller it belongs to. */
const travellerDetailLines = (travellers) => {
  return (Array.isArray(travellers) ? travellers : []).map((tr) => {
    const who = travellerName(tr);
    const bits = [
      tr.nationality ? `Nationality: ${tr.nationality}` : '',
      tr.passportNumber ? `Passport: ${tr.passportNumber}` : '',
      tr.emergencyContact ? `Emergency contact: ${tr.emergencyContact}` : '',
      tr.dietaryRequirements ? `Dietary: ${tr.dietaryRequirements}` : '',
      tr.insurancePolicy ? `Insurance policy: ${tr.insurancePolicy}` : ''
    ].filter(Boolean).join('  ·  ');
    return bits ? `• ${who} — ${bits}` : '';
  }).filter(Boolean);
};

/* One line per traveller who has a note, labelled with their name. All available
   notes are stacked together in the voucher Notes box across every voucher. */
const travellerNoteLines = (travellers) => {
  return (Array.isArray(travellers) ? travellers : []).map((tr) => {
    const who = travellerName(tr);
    const note = (tr.notes || '').trim();
    return note ? `${who}: ${note}` : '';
  }).filter(Boolean);
};
const voucherFor = (group, allDays, meta, currencySymbol, paxCount, billing) => {
  const dateStr = (day) => (day.date ? formatDateLong(day.date) : '');
  const lines = group.svcs.map(({ sv, day }) => [
    `• ${repairText(sv.name)}`,
    dateStr(day) ? `  Date: ${dateStr(day)}` : '',
    ...voucherDetailLines(sv).map((l) => `  ${l}`)
  ].filter((l) => l !== '').join('\n'));
  return [
    /* A voucher is issued to the supplier, so it leads with the agency's own
       details and carries only the travellers, the supplier and the services —
       never the client's profile. */
    ...companyProfileLines(billing),
    ...(companyProfileLines(billing).length ? ['', '-'.repeat(34)] : []),
    `SERVICE VOUCHER`,
    `Supplier: ${group.label}`,
    `Itinerary: ${meta.itineraryName}`,
    `Reference: ${meta.referenceNumber || meta.reference || '—'}`,
    `Tour Designer: ${meta.consultantName || '—'}`,
    `Travellers: ${(meta.travellers || []).map((tr) => travellerName(tr)).filter(Boolean).join(', ') || '—'}`,
    ...travellerDetailLines(meta.travellers),
    `Guests: ${Number(meta.numAdults) || 0} Adult(s)${Number(meta.numChildren) ? ` / ${Number(meta.numChildren)} Child(ren)` : ''} (${paxCount} total)`,
    '',
    lines.join('\n\n'),
    ...(travellerNoteLines(meta.travellers).length
      ? ['', 'Notes:', ...travellerNoteLines(meta.travellers).map((l) => `• ${l}`)]
      : []),
    '',
    `Thank you for your cooperation.`,
    '',
    ...companySignOffLines(billing)
  ].join('\n');
};

/* Print-ready PDF (and Word) version of one supplier voucher. Reuses the exact
   read-only fields that voucherFor emits so the downloaded file is identical
   to what is shown and emailed — vouchers cannot be edited or diverge. */
const voucherDocHtml = (group, allDays, meta, currencySymbol, paxCount, opts) => {
  const {
    logo = '', logoSize = 'md',
    companyName = '', companyAddress = '',
    companyTel = '', companyCell = '', companyEmail = '', companyWebsite = ''
  } = opts || {};
  const esc = htmlEscape;
  const dateStr = (day) => (day.date ? formatDateLong(day.date) : '');
  const logoW = LOGO_WIDTHS[logoSize] || LOGO_WIDTHS.md;
  const entries = group.svcs.map(({ sv, day }) => {
    const rows = [
      ['Service', repairText(sv.name)],
      ['Date', dateStr(day)],
      ['Day', day.label ? `Day ${day.label}` : `Day ${day.dayNumber || ''}`],
      ...voucherDetailLines(sv).map((l) => {
        const idx = l.indexOf(':');
        return idx > 0 ? [l.slice(0, idx).trim(), l.slice(idx + 1).trim()] : ['', l];
      })
    ].filter(([k, v]) => v !== '');
    const box = rows.map(([k, v]) =>
      k ? `<tr><td class="k">${esc(k)}</td><td class="v">${esc(v)}</td></tr>` : `<tr><td colspan="2" class="v multi">${esc(v)}</td></tr>`
    ).join('');
    return `<div class="block">
      <table class="detail">
        <tr><td class="k">Status</td><td class="v ok">CONFIRMED — OK</td></tr>
        ${box}
      </table>
    </div>`;
  }).join('\n');
  const trav = (meta.travellers || []).map((tr) => travellerName(tr)).filter(Boolean).join(', ') || '—';
  const notes = travellerNoteLines(meta.travellers);
  /* Tenant company profile in the voucher header. A voucher is issued to the
     supplier, so it carries the agency's details (not the client's) plus the
     travellers, the supplier and the services. */
  const coTel = [companyTel, companyCell].map((v) => String(v || '').trim()).filter(Boolean).join(' · ');
  const coLine = (label, value) => (value
    ? `<div style="color:#0f766e;font-size:11px;">${esc(label)}: ${esc(value)}</div>`
    : '');
  const coBlock = [
    companyName ? `<div style="font-weight:700;color:#134e4a;">${esc(companyName)}</div>` : '',
    companyAddress ? `<div style="color:#475569;font-size:11px;">${esc(companyAddress).replace(/\n/g, '<br>')}</div>` : '',
    coLine('Tel', coTel),
    coLine('Email', companyEmail),
    coLine('Web', companyWebsite)
  ].join('');
  return `<!doctype html><html><head><meta charset="utf-8"><title>Voucher — ${esc(group.label)}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: 'Segoe UI', Arial, sans-serif; color: #1e293b; margin: 0; padding: 24px; font-size: 13px; }
  .doc { max-width: 820px; margin: 0 auto; border: 1px solid #cbd5e1; border-top: 6px solid #0d7478; border-radius: 10px; overflow: hidden; background: #fff; }
  .hd { background: #f0fdfa; padding: 18px 22px; border-bottom: 2px solid #99f6e4; display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; }
  .hd .lg { flex: 0 0 auto; }
  .hd .lg img { display: block; max-width: ${logoW}px; height: auto; margin-bottom: 8px; }
  .hd .tt h1 { font-size: 20px; margin: 0 0 2px; color: #0d7478; letter-spacing: 1px; }
  .hd .tt .sub { font-size: 11px; color: #0f766e; text-transform: uppercase; letter-spacing: 1.5px; }
  .meta { padding: 12px 22px; border-bottom: 1px solid #e2e8f0; background: #fbfdfd; font-size: 12px; }
  .meta table { width: 100%; border-collapse: collapse; }
  .meta td { padding: 5px 8px; }
  .meta td.h { color: #64748b; width: 130px; font-weight: 600; }
  .block { padding: 12px 22px; border-bottom: 1px dashed #cbd5e1; }
  .block:last-child { border-bottom: none; }
  table.detail { width: 100%; border-collapse: collapse; }
  table.detail td { padding: 5px 8px; border-bottom: 1px solid #f1f5f9; vertical-align: top; }
  table.detail td.k { color: #64748b; width: 170px; font-weight: 600; white-space: nowrap; }
  table.detail td.v { color: #1e293b; }
  table.detail td.multi { width: 100%; white-space: pre-wrap; }
  td.ok { color: #15803d; font-weight: 800; }
  .ft { padding: 12px 22px; font-size: 12px; color: #475569; background: #f8fafc; }
  @media print { body { padding: 0; } .doc { border: none; border-radius: 0; } }
</style></head><body>
  <div class="doc">
    <div class="hd">
      <div class="lg">${logo ? `<img src="${esc(logo)}" alt="Company logo">` : ''}${coBlock}</div>
      <div class="tt" style="text-align:right">
        <div class="sub">Supplier</div>
        <h1>Service Voucher</h1>
        <div style="color:#0f766e;font-size:12px;font-weight:700">${esc(group.label)}</div>
      </div>
    </div>
    <div class="meta">
      <table>
        <tr><td class="h">Itinerary</td><td>${esc(meta.itineraryName || '—')}</td><td class="h">Reference</td><td>${esc(meta.referenceNumber || meta.reference || '—')}</td></tr>
        <tr><td class="h">Guests</td><td>${Number(meta.numAdults) || 0} Adult(s)${Number(meta.numChildren) ? ` / ${Number(meta.numChildren)} Child(ren)` : ''} (${paxCount} total)</td><td class="h">Dates</td><td>${esc(formatDateLong(meta.travelStart))} ? ${esc(formatDateLong(meta.travelEnd))}</td></tr>
        <tr><td class="h">Tour Designer</td><td colspan="3">${esc(meta.consultantName || '—')}</td></tr>
        <tr><td class="h">Travellers</td><td colspan="3">${esc(trav)}</td></tr>
        ${travellerDetailLines(meta.travellers).map((d) => `<tr><td class="h">Traveller details</td><td colspan="3">${esc(d)}</td></tr>`).join('')}
        ${notes.map((n) => `<tr><td class="h">Note</td><td colspan="3">${esc(n)}</td></tr>`).join('')}
      </table>
    </div>
    ${entries}
    <div class="ft">This voucher is issued from the <strong>Confirmed Booking</strong> status and is read-only. It reflects the
      persisted itinerary exactly as recorded. Thank you for your cooperation.</div>
  </div>
</body></html>`;
};

/* Copy text to the clipboard with a legacy textarea fallback. */
const clipboardCopy = async (text) => {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } catch { /* noop */ }
    document.body.removeChild(ta);
  }
};

/* --- Stage-aware document drafts (all strict mailto) ---------------------
   Each lifecycle stage only unlocks the documents the CSV lifecycle defines:
     Quotation            ? quotation PDF/Word (Export menu)
     Provisional Booking  ? Deposit Invoice / Deposit Request
     Confirmed Booking    ? Final Invoice, Vouchers, Travel Documents
     In Progress          ? keeps confirmed docs, adds daily service briefs
     Completed            ? feedback form + expense reconciliation
     Cancelled            ? cancellation notice + refund statement (docs revoked) */

const DEPOSIT_PCT = 30;

const invoiceHeaderLines = (meta) => [
  `Itinerary: ${meta.itineraryName}`,
  `Reference: ${meta.referenceNumber || meta.reference || '—'}`,
  `Tour Designer: ${meta.consultantName || '—'}`,
  `Client: ${meta.client?.name || '—'}`,
  `Travellers: ${(meta.travellers || []).map((tr) => travellerName(tr)).filter(Boolean).join(', ') || '—'}`,
  ...travellerDetailLines(meta.travellers),
  `Dates: ${meta.travelStart} to ${meta.travelEnd}`
];

/* Daily service brief for one day — operational handover for guides/suppliers. */
const dailyBriefFor = (day, meta, paxCount, currencySymbol, billing) => {
  const lines = (day.services || []).map((sv) => {
    const line = contractedServiceTotal(sv, paxCount);
    return [
      `• ${repairText(sv.name)}`,
      timeRangeOf(sv) ? `  Time: ${timeRangeOf(sv)}` : '',
      `  Supplier: ${sv.supplierName || '—'}`,
      serviceNotes(sv) ? `  Notes: ${serviceNotes(sv)}` : '',
      `  Estimated value: ${currencySymbol}${line.toFixed(2)}`
    ].filter((l) => l !== '').join('\n');
  });
  const guests = (meta.travellers || []).map((tr) => travellerName(tr)).filter(Boolean).join(', ') || '—';
  const coTel = [billing?.contact_tel, billing?.contact_cell].map((v) => String(v || '').trim()).filter(Boolean).join(' · ');
  return [
    ...companyProfileLines(billing),
    ...(companyProfileLines(billing).length ? ['', '-'.repeat(34), ''] : []),
    `DAILY SERVICE BRIEF — Day ${day.dayNumber}`,
    day.date ? `Date: ${formatDateLong(day.date)}` : '',
    `Itinerary: ${meta.itineraryName} (${meta.referenceNumber || meta.reference || '—'})`,
    `Travellers: ${guests}`,
    ...travellerDetailLines(meta.travellers),
    /* Notes last so a guide reads the operational detail first, then the
       per-traveller notes (allergies, accessibility, celebrations). */
    ...(travellerNoteLines(meta.travellers).length
      ? ['', 'Notes:', ...travellerNoteLines(meta.travellers).map((l) => `• ${l}`)]
      : []),
    `Guests: ${Number(meta.numAdults) || 0} Adult(s)${Number(meta.numChildren) ? ` / ${Number(meta.numChildren)} Child(ren)` : ''} (${paxCount} total)`,
    '',
    ...lines,
    '',
    'Operational contact: ' + (coTel || companyNameOf(billing) || '—')
  ].join('\n');
};

/* ----------------------------------------------------------------------------
   Proof of payment for a single supplier service.

   Ticking "Paid" on the Operations tab is a claim; this is the document that
   backs it up. It quotes the CONTRACTED rate (never our marked-up selling
   price), shows the arithmetic behind it, and carries the supplier's invoice /
   POP reference plus the date the payment was confirmed — the three things an
   auditor or the supplier will ask for.
   ---------------------------------------------------------------------------- */
const proofOfPaymentHtml = (sv, day, meta, currencySymbol, paxCount, billing) => {
  const symbol = currencySymbol || 'R';
  const paymentStatus = supplierPaymentDocumentStatus(sv?.supplierPaid === true);
  const supplier = repairText(sv?.supplierName || sv?.supplier_name || 'Supplier');
  const servicePax = paxForService(sv, paxCount);
  const total = contractedServiceTotal(sv, paxCount);
  const rooms = (Array.isArray(sv?.roomAllocations) ? sv.roomAllocations : [])
    .filter((rm) => (rm.allocatedTravellers || []).length > 0);
  const beds = rooms.reduce((n, rm) => n + (rm.allocatedTravellers || []).length, 0);
  const paidAt = sv?.supplierPaidAt ? formatDateLong(String(sv.supplierPaidAt).slice(0, 10)) : '';
  const breakdown = /accommodation/i.test(sv?.category || '') && rooms.length
    ? `${rooms.length} room${rooms.length === 1 ? '' : 's'} \u00d7 ${contractMoney(round2(total / rooms.length), symbol)}`
    : servicePax > 1
      ? `${contractMoney(sv?.buyPP, symbol)} \u00d7 ${servicePax} pax`
      : `${servicePax} pax`;

  const header = [
    `<h1>${paymentStatus.heading}</h1>`,
    `<p class="muted"><b>Issued by:</b> ${htmlEscape(companyNameOf(billing) || '—')}</p>`,
    companyAddressOf(billing) ? `<p class="muted">${htmlEscape(companyAddressOf(billing))}</p>` : '',
    ...companyContactLines(billing).map((l) => `<p class="muted">${htmlEscape(l)}</p>`),
    `<p class="stamp ${sv?.supplierPaid === true ? 'stamp-paid' : 'stamp-unpaid'}">${paymentStatus.stamp}</p>`
  ].join('\n');

  return `<!doctype html><html><head><meta charset="utf-8"><title>${htmlEscape(paymentStatus.heading)} — ${htmlEscape(meta?.referenceNumber || '')}</title><style>
    body{font-family:Arial,Helvetica,sans-serif;margin:36px;color:#111}
    h1{margin:0 0 4px;color:#0d7478;font-size:22px}
    .muted{color:#555;font-size:12px;margin:2px 0}
    table{border-collapse:collapse;width:100%;margin-top:18px}
    th,td{border:1px solid #ccc;padding:8px 10px;font-size:13px;text-align:left;vertical-align:top}
    th{background:#eef2f7;width:34%}
    td.num{text-align:right;font-weight:700}
    .total{background:#f0fdfa;font-size:16px}
    .stamp{display:inline-block;margin-top:10px;border:2px solid;font-weight:800;
      letter-spacing:2px;padding:4px 14px;border-radius:4px;transform:rotate(-3deg)}
    .stamp-paid{border-color:#16a34a;color:#16a34a}
    .stamp-unpaid{border-color:#b45309;color:#b45309}
    .foot{margin-top:28px;font-size:11px;color:#666;border-top:1px solid #ddd;padding-top:10px}
    @media print{.noprint{display:none}}
  </style></head><body>
  ${header}
  <table>
    <tr><th>Itinerary</th><td>${htmlEscape(meta?.itineraryName || '—')}${meta?.referenceNumber ? ` (${htmlEscape(meta.referenceNumber)})` : ''}</td></tr>
    <tr><th>Client</th><td>${htmlEscape(meta?.client?.name || '—')}</td></tr>
    <tr><th>Tour dates</th><td>${htmlEscape(formatDateShort(meta?.travelStart) || '—')} &rarr; ${htmlEscape(formatDateShort(meta?.travelEnd) || '—')}</td></tr>
    <tr><th>Service</th><td>${htmlEscape(repairText(sv?.name || '—'))}</td></tr>
    <tr><th>Service date</th><td>Day ${day?.dayNumber ?? '—'}${day?.date ? ` — ${htmlEscape(formatDateLong(day.date))}` : ''}${sv?.time ? ` at ${htmlEscape(sv.time)}` : ''}</td></tr>
    <tr><th>Supplier</th><td>${htmlEscape(supplier)}</td></tr>
    <tr><th>Confirmation</th><td>${htmlEscape(sv?.confirmationNumber || '—')}${sv?.confirmationStatus ? ` (${htmlEscape(sv.confirmationStatus)})` : ''}</td></tr>
    <tr><th>Guests</th><td>${beds || paxCount} of ${paxCount} pax &mdash; ${htmlEscape(breakdown)}</td></tr>
    <tr><th>Supplier invoice / POP ref</th><td>${htmlEscape(sv?.supplierPaidRef || '—')}</td></tr>
    <tr><th>Payment confirmed</th><td>${htmlEscape(paidAt || '—')}</td></tr>
    <tr class="total"><th>${paymentStatus.amountLabel}</th><td class="num">${htmlEscape(contractMoney(total, symbol))}</td></tr>
  </table>
  <p class="foot">${htmlEscape(paymentStatus.footnote)} ${sv?.supplierPaid === true ? `Generated from the supplier payment confirmation recorded on the itinerary for ${htmlEscape(supplier)}.` : `Supplier: ${htmlEscape(supplier)}.`}</p>
  <p class="noprint" style="margin-top:18px"><button onclick="window.print()">Print / Save as PDF</button></p>
  </body></html>`;
};

/* Filename-safe POP name, e.g. POP-IT-2026-000007-GOLD-Restaurant. */
const popFileName = (sv, day, meta) => {
  const parts = [
    'POP',
    meta?.referenceNumber || meta?.itineraryName || 'itinerary',
    day?.dayNumber ? `Day${day.dayNumber}` : '',
    sv?.name || ''
  ];
  return safeNameOf(parts.filter(Boolean).join('-'));
};

/* Post-tour feedback form (completed stage). */
const feedbackRequestEmail = (meta) => {
  const body = [
    `We would love your feedback on your recent tour with us.`,
    '',
    `Itinerary: ${meta.itineraryName}`,
    `Reference: ${meta.referenceNumber || meta.reference || '—'}`,
    `Travel dates: ${meta.travelStart} to ${meta.travelEnd}`,
    '',
    `Please reply to this email with your thoughts on:`,
    '',
    `• Overall experience (1–10)`,
    `• Accommodation & meals`,
    `• Transfers, guides and activities`,
    `• Anything we could improve`,
    '',
    `Your feedback helps us tailor future trips. Thank you!`,
    '',
    `Kind regards,`
  ].join('\n');
  return {
    to: meta.client?.email || meta.client?.contact_email || '',
    subject: `Post-tour feedback — ${meta.itineraryName || meta.referenceNumber || ''}`,
    body
  };
};

/* Expense reconciliation statement (completed stage): income vs supplier cost. */
const reconciliationStatementFor = (meta, pricingGroups, fallbackIncome, fallbackCost, currencySymbol = 'R') => {
  const groups = (pricingGroups || []).length > 0 ? pricingGroups : [{
    code: 'ZAR',
    symbol: currencySymbol,
    totalSell: Number(fallbackIncome) || 0,
    totalBuy: Number(fallbackCost) || 0
  }];
  const sections = groups.map((grp) => {
    const net = round2((grp.totalSell || 0) - (grp.totalBuy || 0));
    return [
      `Currency: ${grp.code} (${grp.symbol})`,
      `Total invoiced to client (incl. tax): ${grp.symbol}${(grp.totalSell || 0).toFixed(2)}`,
      `Total supplier costs (buy): ${grp.symbol}${(grp.totalBuy || 0).toFixed(2)}`,
      `Net result: ${grp.symbol}${net.toFixed(2)}`
    ].join('\n');
  });
  const body = [
    'EXPENSE RECONCILIATION STATEMENT',
    '',
    ...invoiceHeaderLines(meta),
    '',
    sections.join('\n\n'),
    '',
    'Closing & reporting document — generated on completion.'
  ].join('\n');
  return {
    to: meta.client?.email || meta.client?.contact_email || '',
    subject: `Expense reconciliation — ${meta.referenceNumber || meta.reference || meta.itineraryName || ''}`,
    body
  };
};

/* Cancellation notice + refund statement (cancelled stage — docs revoked). */
const cancellationNoticeEmail = (meta, pricingGroups, depositPct = DEPOSIT_PCT, fallbackTotal = 0, fallbackVat = 0, currencySymbol = 'R') => {
  const groups = (pricingGroups || []).length > 0 ? pricingGroups : [{
    code: 'ZAR',
    symbol: currencySymbol,
    totalSell: Number(fallbackTotal) || 0,
    totalTax: Number(fallbackVat) || 0
  }];
  const sections = groups.map((grp) => {
    const total = grp.totalSell || 0;
    const vatAmt = grp.totalTax || 0;
    const subtotal = round2(total - vatAmt);
    const deposit = round2(total * ((Number(depositPct) || DEPOSIT_PCT) / 100));
    const refund = round2(total - deposit);
    return [
      `Currency: ${grp.code} (${grp.symbol})`,
      `Subtotal (Excl. ${taxWordOf(grp.code)}): ${grp.symbol}${subtotal.toFixed(2)}`,
      `${taxWordUpper(grp.code)}: ${grp.symbol}${vatAmt.toFixed(2)}`,
      `TOTAL DUE (INCL. ${taxWordUpper(grp.code)}): ${grp.symbol}${total.toFixed(2)}`,
      `Deposit retained (${Number(depositPct) || DEPOSIT_PCT}%): ${grp.symbol}${deposit.toFixed(2)}`,
      `Refund due to client: ${grp.symbol}${refund.toFixed(2)}`
    ].join('\n');
  });
  const body = [
    'CANCELLATION NOTICE',
    '',
    ...invoiceHeaderLines(meta),
    '',
    `This itinerary has been cancelled.`,
    `Cancellation date: ${new Date().toISOString().slice(0, 10)}`,
    '',
    `REFUND STATEMENT`,
    '',
    sections.join('\n\n'),
    '',
    'All previously issued vouchers, travel documents and invoices are now void.',
    '',
    'Thank you.'
  ].join('\n');
  return {
    to: meta.client?.email || meta.client?.contact_email || '',
    subject: `Cancellation & refund — ${meta.referenceNumber || meta.reference || meta.itineraryName || ''}`,
    body
  };
};



/* One collapsible Finance block. Finance packs four dense panels behind a
   single tab, so each one folds away behind a summary line that keeps its
   title and purpose readable without scrolling past everything else. The open
   state lives in the parent so a section stays open when the user visits
   another tab and comes back. */
const FinanceSection = ({ sectionId, title, summary, open, onToggle, children }) => {
  const headerId = `finance-${sectionId}-header`;
  const bodyId = `finance-${sectionId}-body`;
  return (
    <section className="builder-panel-card finance-section">
      <h3 className="finance-section-head">
        <button
          type="button"
          className="finance-section-toggle"
          id={headerId}
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={onToggle}
        >
          <span className="finance-section-labels">
            <span className="finance-section-title">{title}</span>
            {summary ? <span className="finance-section-summary">{summary}</span> : null}
          </span>
          <ChevronDown
            className={`finance-section-chevron ${open ? 'is-open' : ''}`}
            size={18}
            aria-hidden="true"
          />
        </button>
      </h3>
      <div id={bodyId} role="region" aria-labelledby={headerId} hidden={!open} className="finance-section-body">
        {children}
      </div>
    </section>
  );
};

/* --- Component -------------------------------------------------------------- */

export const ItineraryBuilder = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const data = location.state || null;
  const { showToast } = useToast();
  const { currencies } = useCurrencies();

  const [meta, setMetaRaw] = useState({
    itineraryId: data?.itineraryId || null,
    referenceNumber: data?.referenceNumber || null,
    itineraryName: data?.itineraryName || '',
    client: data?.client || null,
    travelStart: data?.travelStart || '',
    travelEnd: data?.travelEnd || '',
    travellers: data?.travellers || [],
    numAdults: data?.numAdults || 0,
    numChildren: data?.numChildren || 0,
    agencyRef: data?.agencyRef || null,
    status: normaliseStatus(data?.status),
    notes: '',
    tourType: data?.tourType || '',
    consultantName: data?.consultantName || ''
  });

  const [companyId, setCompanyId] = useState(null);
  const [libraryItems, setLibraryItems] = useState([]);
  const [taxRates, setTaxRates] = useState([]);
  const [companyDepositPct, setCompanyDepositPct] = useState(DEPOSIT_PCT);
  const [billing, setBilling] = useState(null);
  const [bankAccounts, setBankAccounts] = useState([]);
  const [itineraryInvoices, setItineraryInvoices] = useState([]);
  const [itineraryReceipts, setItineraryReceipts] = useState([]);
  const [itineraryCreditNotes, setItineraryCreditNotes] = useState([]);
  const [itineraryJournal, setItineraryJournal] = useState([]);
  const [openInvoiceId, setOpenInvoiceId] = useState(null);
  /* Which Finance panels are unfolded. The statement and the ledger open
     first because that is where a booking starts; the invoice and cost of
     sales stay folded until they are needed. */
  const [openFinance, setOpenFinance] = useState({
    statement: true,
    ledger: true,
    invoice: false,
    costOfSales: false
  });
  const toggleFinance = useCallback((sectionId) => {
    setOpenFinance((prev) => ({ ...prev, [sectionId]: !prev[sectionId] }));
  }, []);
  const [issuingInvoice, setIssuingInvoice] = useState(false);
  const financeSubmissionRef = useRef(false);
  const [invoiceIssuePrompt, setInvoiceIssuePrompt] = useState(null);
  const [overpaymentPrompt, setOverpaymentPrompt] = useState(null);
  const [overpaymentAmount, setOverpaymentAmount] = useState('');
  const [overpaymentReason, setOverpaymentReason] = useState('');
  /* Payment capture. A client can pay an invoice in instalments, so the amount
     is collected rather than assumed to be the full balance. */
  const [paymentPrompt, setPaymentPrompt] = useState(null);
  const [paymentForm, setPaymentForm] = useState({ amount: '', received_date: '', payment_method: 'EFT', payment_reference: '' });
  const [emailFormat, setEmailFormat] = useState('pdf');
  const [searchTerm, setSearchTerm] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [pickerItems, setPickerItems] = useState([]);
  const [pickerLoading, setPickerLoading] = useState(false);
  const [pickerPackages, setPickerPackages] = useState([]);
  const [pickerPackagesLoading, setPickerPackagesLoading] = useState(false);
  const [categoryChips, setCategoryChips] = useState([]);
  const pickerSearchRef = useRef(null);
  const [currencyCode, setCurrencyCode] = useState('ZAR');
  const [currencyOpen, setCurrencyOpen] = useState(false);
  const [currencySearch, setCurrencySearch] = useState('');
  const [days, setDaysRaw] = useState([]);
  const [selectedDayIndex, setSelectedDayIndex] = useState(0);
  const [expandedPackageRows, setExpandedPackageRows] = useState({});
  const [activeTab, setActiveTab] = useState('itinerary');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [statusMenuOpen, setStatusMenuOpen] = useState(false);
  const [kebabFor, setKebabFor] = useState(null);
  const [dragOverKey, setDragOverKey] = useState(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [copyOpen, setCopyOpen] = useState(false);
  const [copySourceId, setCopySourceId] = useState('');
  const [copyInsertDay, setCopyInsertDay] = useState(1);
  const [availableItineraries, setAvailableItineraries] = useState([]);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [editSvc, setEditSvc] = useState(null);
  const [copyDays, setCopyDays] = useState([]);
  const [copyAllDays, setCopyAllDays] = useState(false);
  const [dayNotesDay, setDayNotesDay] = useState(null);
  const [bootedState, setBootedState] = useState(false);
  const [lastSavedKey, setLastSavedKey] = useState(null);
  const [bulkConfirmOpen, setBulkConfirmOpen] = useState(false);
  const [bulkConfirmGroups, setBulkConfirmGroups] = useState([]);
  const [roomModalState, setRoomModalState] = useState({
    isOpen: false,
    dayIndex: null,
    serviceKey: null,
    item: null,
    service: null
  });
  const [placementDraft, setPlacementDraft] = useState(null);
  const [placementError, setPlacementError] = useState('');
  const [placementRepeat, setPlacementRepeat] = useState(false);
  const [placementRepeatCount, setPlacementRepeatCount] = useState(2);
  const [placementCopyDays, setPlacementCopyDays] = useState([]);
  const [placementOptional, setPlacementOptional] = useState(false);
  const [placementSplit, setPlacementSplit] = useState(false);
  const [placementDestinationSplit, setPlacementDestinationSplit] = useState(false);
  const [roomApplyPrompt, setRoomApplyPrompt] = useState(null);
  const [vehicleDraft, setVehicleDraft] = useState(null);
  /* A per-night surcharge with nothing to attach to has no way to know how many
     times it should repeat, so the operator is asked rather than it being
     guessed at one. */
  const [surchargeRepeatPrompt, setSurchargeRepeatPrompt] = useState(null);
  const [surchargeRepeatCount, setSurchargeRepeatCount] = useState(1);

  const idSeq = useRef(0);
  const booted = useRef(false);
  const lastItineraryIdRef = useRef(data?.itineraryId || null);
  const nextId = useCallback(() => {
    idSeq.current += 1;
    return `t${idSeq.current}`;
  }, []);

  const currencyObj = currencies.find((c) => (c.code || '').toUpperCase() === currencyCode.toUpperCase());
  const currencySymbol = currencyObj?.symbol || currencyCode;
  const paxCount = (Number(meta.numAdults) || 0) + (Number(meta.numChildren) || 0);
  /* The trip's travel window, taken from the days that carry a date. Pricing
     Protection is decided against these dates, so it has to be the real span
     rather than the day a service happens to land on. */
  const travelWindow = useMemo(() => {
    const dated = days.map((d) => d.date).filter(Boolean).sort();
    return { start: dated[0] || '', end: dated[dated.length - 1] || '' };
  }, [days]);
  const priceProtectionPercent = Math.max(0, Number(billing?.price_protection_percent) || 0);
  /* Company profile options for the supplier-facing travel documents. */
  const voucherOpts = {
    logo: billing?.logo_data_url || '',
    logoSize: billing?.logo_size || 'md',
    companyName: companyNameOf(billing),
    companyAddress: companyAddressOf(billing),
    companyTel: billing?.contact_tel || '',
    companyCell: billing?.contact_cell || '',
    companyEmail: billing?.contact_email || '',
    companyWebsite: billing?.contact_website || ''
  };
  const markupPct = Number(meta.client?.markup_percentage) || 0;
  const currentDay = days[selectedDayIndex] || null;
  const stage = normaliseStatus(meta.status);
  const itineraryDocAllowed = stage === 'quotation' || stage === 'provisional';
  const isProvisional = stage === 'provisional';
  const isConfirmed = stage === 'confirmed';
  const isInProgress = stage === 'in_progress';
  const isCompleted = stage === 'completed';
  const isCancelled = stage === 'cancelled';
  /* Provisional, Confirmed, In Progress, Completed, and Cancelled itineraries
     are locked against commercial edits. Only the status badge stays live, so
     an eligible booking can be returned to Quotation to re-open editing. */
  const isReadOnly = isProvisional || isConfirmed || isInProgress || isCompleted || isCancelled;
  const editLockedRef = useRef(isReadOnly);
  const hydrateRef = useRef(false);

  useEffect(() => {
    editLockedRef.current = isReadOnly;
  }, [isReadOnly]);

  const EDIT_LOCK_MESSAGE =
    'This itinerary is locked for editing. Change its status back to Quotation to make changes.';

  /* Every itinerary mutation funnels through these two wrappers, so a stale
     modal or keyboard path cannot slip past the disabled controls. Hydration
     (loading a saved itinerary) bypasses the lock. */
  const setDays = useCallback((update) => {
    if (editLockedRef.current && !hydrateRef.current) {
      showToast(EDIT_LOCK_MESSAGE, 'warning');
      return;
    }
    setDaysRaw(update);
  }, [showToast]);

  const setMeta = useCallback((update) => {
    setMetaRaw((prev) => {
      const next = typeof update === 'function' ? update(prev) : update;
      if (!next || next === prev) return next;
      if (editLockedRef.current && !hydrateRef.current) {
        // The status badge must stay live so the booking can be re-opened;
        // every other itinerary field is frozen.
        const touchesContent = Object.keys(next).some((k) => k !== 'status' && next[k] !== prev[k]);
        return touchesContent ? prev : next;
      }
      return next;
    });
  }, []);

  const completedRef = useRef(isReadOnly);

  useEffect(() => {
    completedRef.current = isReadOnly;
  }, [isReadOnly]);

  /* Terminal states stop itinerary mutations and operational changes. Invoice
     issuance is handled separately: completed bookings may still have balances
     to invoice, while cancelled bookings may not. */
  const isTerminal = isCompleted || isCancelled;
  const terminalRef = useRef(isTerminal);

  useEffect(() => {
    terminalRef.current = isTerminal;
  }, [isTerminal]);

  const normaliseCountry = (value) => String(value || '').trim().toLowerCase();
  const isSouthAfricanTenant = useMemo(
    () => normaliseCountry(billing?.operating_country || 'South Africa') === 'south africa',
    [billing]
  );
  /* Tax rule: South African tenants apply VAT only to ZAR-priced services —
     any other currency is always 0 / No VAT. Tenants outside South Africa
     apply their own configured tax (type + percentage from Settings) to every
     service, regardless of currency. */
  const taxAppliesForCurrency = useCallback((ccy) => {
    if (!isSouthAfricanTenant) return true;
    return normaliseCountry(ccy || 'ZAR') === 'zar';
  }, [isSouthAfricanTenant]);
  const defaultTax = taxRates.find((t) => t.is_active && t.is_default)
    || taxRates.find((t) => t.is_active) || null;
  /* No active tax rate configured => the tenant charges no tax at all. Falls
     back to 0 (not a hardcoded 15) so deactivating every tax in Settings
     removes tax from all calculations and documents. */
  const defaultTaxRate = Number(defaultTax?.rate ?? 0);
  const defaultTaxLabel = defaultTax?.name || 'Tax';
  const defaultRevenueAgency = defaultTax?.revenue_agency || '';

  /* Deposit policy: per-client override, else tenant default from Settings. */
  const depositPct = useMemo(() => {
    const fromClient = meta.client?.deposit_percentage;
    if (fromClient !== null && fromClient !== undefined && fromClient !== '') return Number(fromClient);
    return Number(companyDepositPct) || DEPOSIT_PCT;
  }, [meta.client, companyDepositPct]);

  /* Financial totals used by the stage-aware invoices / reconciliation. */
  const paxBalanceTotal = useMemo(() => {
    let t = 0;
    days.forEach((d) => {
      (d.services || []).forEach((sv) => {
        /* Optional / alternative services are excluded from the client total. */
        if (sv.isOptional) return;
        const line = (Number(sv.sellPP) || 0) * paxForService(sv, paxCount);
        t += line;
      });
    });
    return round2(t);
  }, [days, paxCount, defaultTaxRate]);

  /* VAT embedded in the client total — used to show Subtotal (Excl. VAT) /
     VAT / TOTAL DUE (INCL. VAT) on the client-facing invoice drafts. */
  const paxBalanceVAT = useMemo(() => {
    let t = 0;
    days.forEach((d) => {
      (d.services || []).forEach((sv) => {
        if (sv.isOptional) return;
        const line = (Number(sv.sellPP) || 0) * paxForService(sv, paxCount);
        const rate = numOr(sv.taxRate, defaultTaxRate);
        t += vatOfInclusive(line, rate);
      });
    });
    return round2(t);
  }, [days, paxCount, defaultTaxRate]);

  const selectedCurrencyTotal = useMemo(() => {
    let total = 0;
    days.forEach((day) => {
      (day.services || []).forEach((service) => {
        if (service.isOptional || (service.currencyCode || 'ZAR').toUpperCase() !== currencyCode.toUpperCase()) return;
        total += (Number(service.sellPP) || 0) * paxForService(service, paxCount);
      });
    });
    return round2(total);
  }, [days, paxCount, currencyCode]);

  const itineraryCostTotal = useMemo(() => {
    let c = 0;
    days.forEach((d) => {
      (d.services || []).forEach((sv) => {
        if (sv.isOptional) return;
        c += (Number(sv.buyPP) || 0) * paxForService(sv, paxCount);
      });
    });
    return round2(c);
  }, [days, paxCount]);

  /* -- Issued-invoice state for this itinerary + currency ------------------ */
  const invoicesInCurrency = useMemo(
    () => itineraryInvoices.filter((inv) => (inv.currency_code || '').toUpperCase() === currencyCode.toUpperCase()),
    [itineraryInvoices, currencyCode]
  );
  /* One invoice type now, so there is no deposit/final pair to pick between.
     The invoice the booking is currently working against is the open one, and
     the latest paid one is what a receipt would attach to. */
  const openInvoice = useMemo(
    () => invoicesInCurrency.find((inv) => inv.status !== 'void' && inv.status !== 'paid') || null,
    [invoicesInCurrency]
  );
  const activeInvoice = openInvoice;
  /* Journal entries and receipts keyed by the document they belong to, so the
     Finance tab can hang both off the invoice that produced them instead of
     re-querying per invoice. */
  const journalBySource = useMemo(() => {
    const map = new Map();
    for (const e of itineraryJournal) {
      if (!e.source_id) continue;
      const key = `${e.source_type}|${e.source_id}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(e);
    }
    return map;
  }, [itineraryJournal]);
  const receiptsByInvoice = useMemo(() => {
    const map = new Map();
    for (const r of itineraryReceipts) {
      if (!map.has(r.invoice_id)) map.set(r.invoice_id, []);
      map.get(r.invoice_id).push(r);
    }
    return map;
  }, [itineraryReceipts]);
  /* Net money held against an invoice: receipts less anything refunded back.
     A refund is money that has left, so it belongs in the balance but is not
     part of what has been received. */
  const receivedTotalFor = useCallback(
    (id) => netReceivedTotal(id, receiptsByInvoice.get(id) || []),
    [receiptsByInvoice]
  );
  /* The most that may still be handed back on an invoice. */
  const refundableFor = useCallback(
    (id) => refundableTotal(id, receiptsByInvoice.get(id) || []),
    [receiptsByInvoice]
  );
  const paymentInvoicesByCurrency = useMemo(() => {
    const byCurrency = new Map();
    itineraryInvoices.forEach((invoice) => {
      if ((invoice.status || '') === 'void') return;
      const invoiceOutstanding = invoiceBalance(invoice, itineraryReceipts);
      const bookingOutstanding = bookingReceivableRemaining(
        itineraryInvoices,
        itineraryReceipts,
        itineraryCreditNotes,
        invoice.currency_code
      );
      const balance = round2(Math.min(invoiceOutstanding, bookingOutstanding));
      const code = (invoice.currency_code || '').toUpperCase();
      if (!code) return;
      const current = byCurrency.get(code);
      if (!current || balance > current.derivedBalance) {
        byCurrency.set(code, { ...invoice, derivedBalance: balance });
      }
    });
    return [...byCurrency.values()];
  }, [itineraryInvoices, itineraryReceipts, itineraryCreditNotes]);
  /* Every entry for the itinerary that is not tied to one invoice (cost of
     sales), shown as its own group at the bottom of the tab. */
  const standaloneJournal = useMemo(
    () => itineraryJournal.filter((e) => !e.source_id || e.source_type === 'cost_of_sales'),
    [itineraryJournal]
  );
  const outstanding = round2(Math.max(0,
    selectedCurrencyTotal - netBilled(itineraryInvoices, itineraryCreditNotes, currencyCode)
  ));

  /* -- Stage-based document unlocks --------------------------------------
     Each lifecycle stage only shows the tabs the CSV lifecycle defines:
     quotation / pending ? planning tabs only; provisional adds the deposit
     invoice + supplier service request; confirmed (and in progress) release
     the full travel pack; in progress adds operational briefs; completed
     shows post-tour closure; cancelled shows the cancellation module and
     revokes everything else. */
  /* Which tabs exist at the current stage. Itinerary / Travelers / Pricing /
     Notes are available at every stage; Finance and the rest are stage-gated.
     This is the SINGLE source of truth for stage gating — the tab bar, the
     panels and the fallback below all read it, so a gate can never disagree
     with itself.
     A status change can retire the tab the user is standing on: Provisional ->
     Quotation retires Service Request, and Confirmed/In Progress -> Quotation
     retires Travel Documents and Vouchers. `tab` therefore falls back to
     Itinerary, the canonical view of every day and service at every stage, so a
     retired tab can never leave a blank panel that looks like lost services.
     Nothing is mutated here — only the view moves, so no service is lost. */
  const visibleTabIds = useMemo(() => {
    /* 'itinerary' stays first and is never gated: it holds the day-by-day, and
       every stage must be able to see and edit its days. */
    const ids = ['itinerary', 'client', 'pricing', 'notes'];
    if (stage !== 'quotation') ids.push('finance');
    if (isProvisional) ids.push('service-request');
    if (isConfirmed || isInProgress) ids.push('travel-docs', 'vouchers');
    if (isInProgress) ids.push('operations');
    if (isCompleted) ids.push('post-tour');
    if (isCancelled) ids.push('cancellation');
    return ids;
  }, [stage, isProvisional, isConfirmed, isInProgress, isCompleted, isCancelled]);
  const tab = visibleTabIds.includes(activeTab) ? activeTab : 'itinerary';

  // Navigation-guard dirty tracking: compare the current serialised working
  // state against the last state that was persisted (boot / save), so ANY
  // edit to days or meta automatically marks the workspace as dirty.
  const stateKey = useMemo(
    () => (bootedState ? JSON.stringify({ days, meta }) : ''),
    [bootedState, days, meta]
  );
  const dirty = bootedState && lastSavedKey !== null && stateKey !== lastSavedKey;

  useEffect(() => {
    if (!bootedState) return;
    setLastSavedKey(stateKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bootedState]);

  const fetchCompanyId = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;
    const { data: profile } = await supabase
      .from('profiles')
      .select('company_id')
      .eq('id', user.id)
      .single();
    return profile?.company_id || null;
  }, []);

  const loadCompanyMeta = useCallback(async (cid) => {
    setCompanyId(cid);
    if (!cid) return;
    try {
      const [taxRes, billingRes, bankRes] = await Promise.all([
        supabase.from('tax_rates').select('*').eq('company_id', cid),
        supabase.from('company_billing_settings').select('*').eq('company_id', cid).maybeSingle(),
        supabase.from('company_bank_accounts').select('*').eq('company_id', cid).order('is_default', { ascending: false })
      ]);
      setTaxRates(taxRes.data || []);
      setBilling(billingRes.data || null);
      if (billingRes.data?.default_deposit_percentage !== null && billingRes.data?.default_deposit_percentage !== undefined) {
        setCompanyDepositPct(Number(billingRes.data.default_deposit_percentage));
      }
      setBankAccounts(bankRes.data || []);
    } catch {
      // non-fatal; tax/billing defaults apply
    }
    // Category chips are optional — the table may not exist yet; fall back to built-ins.
    try {
      const { data: catsRes } = await supabase
        .from('library_categories')
        .select('name')
        .order('sort_order', { ascending: true });
      const catNames = (catsRes || []).map((c) => c.name).filter(Boolean);
      if (catNames.length) setCategoryChips(catNames);
    } catch {
      // keep DEFAULT_CATEGORY_CHIPS
    }
  }, []);

  const fetchItineraryItemIds = useCallback(async (iid) => {
    const { data } = await supabase
      .from('itinerary_day_items')
      .select('item_id')
      .eq('itinerary_id', iid);
    return [...new Set((data || []).map((r) => r.item_id).filter(Boolean))];
  }, []);

  /* PostgREST fails the entire select when any one column in the list is absent
     from the database, so a column added for a feature whose migration has not
     been applied would return zero rows rather than an empty result set. The
     query is retried against the long-standing columns, and the reduced list is
     remembered so later loads go straight to the working select. Surfaces the
     message instead of silently rendering an empty list. */
  const libraryFieldsRef = useRef(LIBRARY_ITEM_LIGHT_FIELDS);

  const selectLibraryItems = useCallback(async (runQuery) => {
    let res = await runQuery(libraryFieldsRef.current);
    if (res?.error && libraryFieldsRef.current !== LIBRARY_ITEM_BASE_FIELDS) {
      libraryFieldsRef.current = LIBRARY_ITEM_BASE_FIELDS;
      res = await runQuery(LIBRARY_ITEM_BASE_FIELDS);
    }
    if (res?.error) {
      showToast(`Library items could not be loaded: ${res.error.message}`, 'error');
      return [];
    }
    return res?.data || [];
  }, [showToast]);

  const loadLibraryItemsByIds = useCallback(async (cid, ids) => {
    if (!cid || !ids || ids.length === 0) {
      setLibraryItems([]);
      return;
    }
    try {
      const items = await selectLibraryItems((fields) => supabase
        .from('library_items')
        .select(fields)
        .in('id', ids));
      const itemIds = items.map((i) => i.id);
      const { data: ratesData } = itemIds.length
        ? await supabase.from('item_rates').select('*').in('item_id', itemIds)
        : { data: [] };
      let carRates = [];
      if (itemIds.length) {
        try {
          const { data } = await supabase
            .from('car_rental_rates')
            .select('*')
            .in('item_id', itemIds);
          carRates = data || [];
        } catch {
          carRates = [];
        }
      }
      const supIds = [...new Set(items.map((i) => i.supplier_id).filter(Boolean))];
      const { data: suppliersData } = supIds.length
        ? await supabase.from('suppliers').select('id, name, email, country, province_state, city, city_location').in('id', supIds)
        : { data: [] };
      setLibraryItems(buildMergedItems(items, ratesData || [], carRates, suppliersData || []));
    } catch {
      showToast('Failed to load saved library items', 'error');
    }
  }, [selectLibraryItems, showToast]);

  // Sidebar picker: on-demand server-side search. Bounded to a page of results
  // so the biggest cost (all rates for a whole company catalogue) never runs.
  const fetchPickerItems = useCallback(async () => {
    const term = searchTerm.trim();
    const hasFilter = categoryFilter !== '' || term.length > 0;
    if (!hasFilter || !companyId) {
      setPickerItems([]);
      setPickerLoading(false);
      return;
    }
    setPickerLoading(true);
    try {
      const safeTerm = term.replace(/[,()]/g, ' ').trim();
      const esc = (s) => s.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
      const items = await selectLibraryItems((fields) => {
        let q = supabase
          .from('library_items')
          .select(fields)
          .eq('company_id', companyId)
          .order('name', { ascending: true })
          .limit(30);
        if (categoryFilter !== '') q = q.eq('category', categoryFilter);
        if (safeTerm) q = q.or(`name.ilike.%${esc(safeTerm)}%,description.ilike.%${esc(safeTerm)}%`);
        return q;
      });
      const itemIds = items.map((i) => i.id);
      const { data: ratesData } = itemIds.length
        ? await supabase.from('item_rates').select('*').in('item_id', itemIds)
        : { data: [] };
      let carRates = [];
      if (itemIds.length) {
        try {
          const { data } = await supabase
            .from('car_rental_rates')
            .select('*')
            .in('item_id', itemIds);
          carRates = data || [];
        } catch {
          carRates = [];
        }
      }
      const supIds = [...new Set(items.map((i) => i.supplier_id).filter(Boolean))];
      const { data: suppliersData } = supIds.length
        ? await supabase.from('suppliers').select('id, name, email, country, province_state, city, city_location').in('id', supIds)
        : { data: [] };
      const merged = buildMergedItems(items, ratesData || [], carRates, suppliersData || []);
      setPickerItems(merged);
      // Keep looked-up items resolvable for drag/drop, room modal and tax checks.
      setLibraryItems((prev) => {
        const m = new Map(prev.map((i) => [i.id, i]));
        merged.forEach((i) => m.set(i.id, i));
        return Array.from(m.values());
      });
    } catch {
      showToast('Failed to search library items', 'error');
    } finally {
      setPickerLoading(false);
    }
  }, [companyId, searchTerm, categoryFilter, selectLibraryItems, showToast]);

  useEffect(() => {
    if (pickerSearchRef.current) clearTimeout(pickerSearchRef.current);
    pickerSearchRef.current = setTimeout(() => fetchPickerItems(), 350);
    return () => {
      if (pickerSearchRef.current) clearTimeout(pickerSearchRef.current);
    };
  }, [searchTerm, categoryFilter, fetchPickerItems]);

  const fetchPickerPackages = useCallback(async () => {
    if (!companyId || (categoryFilter !== '' && categoryFilter !== 'Packages')) {
      setPickerPackages([]);
      return;
    }
    setPickerPackagesLoading(true);
    try {
      const term = searchTerm.trim().replace(/[,()]/g, ' ').replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
      let query = supabase.from('packages')
        .select('id, name, description, cover_image_url, default_markup_percentage')
        .eq('company_id', companyId)
        .order('name', { ascending: true })
        .limit(30);
      if (term) query = query.or(`name.ilike.%${term}%,description.ilike.%${term}%`);
      const { data, error } = await query;
      if (error) throw error;
      const packages = data || [];
      const packageIds = packages.map((pkg) => pkg.id);
      const { data: packageDays, error: daysError } = packageIds.length
        ? await supabase.from('package_days').select('id, package_id, day_number, notes').in('package_id', packageIds).order('day_number')
        : { data: [], error: null };
      if (daysError) throw daysError;
      const dayIds = (packageDays || []).map((day) => day.id);
      const { data: packageServices, error: servicesError } = dayIds.length
        ? await supabase.from('package_day_items').select('package_day_id, item_name, category, supplier_name, currency_code, rate_basis, unit_cost, unit_price, quantity, notes, is_included').in('package_day_id', dayIds).order('sort_order')
        : { data: [], error: null };
      if (servicesError) throw servicesError;
      const servicesByDay = new Map();
      (packageServices || []).forEach((service) => servicesByDay.set(service.package_day_id, [...(servicesByDay.get(service.package_day_id) || []), service]));
      const daysByPackage = new Map();
      (packageDays || []).forEach((day) => daysByPackage.set(day.package_id, [...(daysByPackage.get(day.package_id) || []), {
        day_number: day.day_number, notes: day.notes, services: servicesByDay.get(day.id) || []
      }]));
      setPickerPackages(packages.map((pkg) => ({
        ...pkg,
        package_snapshot: {
          id: pkg.id, name: pkg.name, description: pkg.description,
          default_markup_percentage: pkg.default_markup_percentage,
          days: daysByPackage.get(pkg.id) || []
        }
      })));
    } catch (error) {
      setPickerPackages([]);
      showToast(`Could not load packages for the itinerary builder: ${error.message}`, 'error');
    } finally {
      setPickerPackagesLoading(false);
    }
  }, [companyId, categoryFilter, searchTerm, showToast]);

  useEffect(() => {
    const timer = setTimeout(fetchPickerPackages, 300);
    return () => clearTimeout(timer);
  }, [fetchPickerPackages]);

  const initDaysFromRange = useCallback(() => {
    const count = daysInRange(meta.travelStart, meta.travelEnd);
    const built = Array.from({ length: count }, (_, i) => ({
      key: nextId(),
      dayNumber: i + 1,
      date: meta.travelStart ? addDaysToDate(meta.travelStart, i) : '',
      notes: '',
      services: []
    }));
    hydrateRef.current = true;
    setDays(built);
    hydrateRef.current = false;
    setSelectedDayIndex(0);
  }, [meta.travelStart, meta.travelEnd, nextId, setDays ]);

  const loadExistingDays = useCallback(async () => {
    const id = data?.itineraryId;
    if (!id) return false;
    try {
      hydrateRef.current = true;
      const { data: it } = await supabase
        .from('itineraries')
        .select('*')
        .eq('id', id)
        .single();
      if (it) {
        let client = meta.client || null;
        if (it.client_id) {
          const { data: c } = await supabase
            .from('clients')
            .select('id, name, client_type, email, country, markup_percentage, deposit_percentage, address, logo_data_url, notes, contact_tel, contact_cell, contact_website')
            .eq('id', it.client_id)
            .single();
          if (c) client = c;
        }
        setMeta((prev) => ({
          ...prev,
          client,
          itineraryName: it.itinerary_name || prev.itineraryName,
          referenceNumber: it.reference_number || prev.referenceNumber,
          travelStart: toISODate(it.travel_start_date) || prev.travelStart,
          travelEnd: toISODate(it.travel_end_date) || prev.travelEnd,
          status: normaliseStatus(it.status),
          notes: it.notes || '',
          /* Travellers must be reloaded from the persisted row too. They are only
             ever entered on the Client form, so they are not in the route state on
             every entry (refresh, deep link, copied URL), and without this the
             working copy silently starts with none. */
          travellers: Array.isArray(it.travellers) ? it.travellers : (prev.travellers || []),
          numAdults: it.num_adults ?? prev.numAdults,
          numChildren: it.num_children ?? prev.numChildren,
          agencyRef: it.agency_reference || prev.agencyRef,
          tourType: it.itinerary_tour_type || prev.tourType || '',
          consultantName: it.consultant_name || prev.consultantName || ''
        }));
      }
      const { data: dayRows } = await supabase
        .from('itinerary_days')
        .select('*, itinerary_day_items(*)')
        .eq('itinerary_id', id)
        .order('day_number', { ascending: true });
      if (dayRows && dayRows.length) {
        const built = dayRows.map((rd, di) => ({
          key: nextId(),
          dayNumber: rd.day_number || di + 1,
          date: toISODate(rd.day_date) || addDaysToDate(meta.travelStart, di),
          notes: rd.notes || '',
          services: (rd.itinerary_day_items || []).map((ii) => {
            const mRaw = Number(ii.markup_percentage);
            const m = Number.isFinite(mRaw) ? mRaw : (Number(meta.client?.markup_percentage) || 0);
            const pricing = storedServicePricing(
              { ...ii, category: ii.category || '', room_allocations: ii.room_allocations },
              (Number(meta.numAdults) || 0) + (Number(meta.numChildren) || 0),
              m
            );
            const ccy = ii.currency_code || 'ZAR';
            const taxed = taxAppliesForCurrency(ccy);
            return {
              key: nextId(),
              dbId: ii.id || null,
              itemId: ii.item_id || null,
              packageId: ii.source_package_id || null,
              packageSnapshot: ii.package_snapshot || null,
              supplierId: ii.supplier_id || null,
              name: ii.item_name || '',
              category: ii.category || '',
              supplierName: ii.supplier_name || '',
              currencyCode: ccy,
              basis: ii.rate_basis || 'per_person',
              buyPP: pricing.buyPP,
              markup: m,
              sellPP: pricing.sellPP,
              pax: pricing.pax,
              quantity: Number(ii.quantity) || 1,
              descOverride: ii.description_override || '',
              taxRate: taxed ? (Number(ii.tax_rate) > 0 ? numOr(ii.tax_rate, defaultTaxRate) : defaultTaxRate) : 0,
              taxLabel: taxed ? (Number(ii.tax_rate) > 0 ? (ii.tax_label || defaultTaxLabel) : defaultTaxLabel) : 'No VAT',
              time: ii.service_time || '',
              confirmationStatus: ii.confirmation_status || 'RQ',
              confirmationNumber: ii.confirmation_number || '',
              flightNumber: ii.flight_number || '',
              flightTime: ii.flight_time || '',
              vehicleType: ii.vehicle_type || '',
              capacity: ii.capacity !== '' && ii.capacity !== null && ii.capacity !== undefined ? Number(ii.capacity) : '',
              roomType: ii.room_type || '',
              destinationArea: ii.destination_area || '',
              maxOccupancy: ii.max_occupancy !== null && ii.max_occupancy !== undefined ? Number(ii.max_occupancy) : '',
              roomAllocations: Array.isArray(ii.room_allocations) ? ii.room_allocations : [],
repeatGroupId: ii.repeat_group_id || null,
              splitGroupId: ii.split_group_id || null,
              /* Surcharge attributes survive the reload, so a passed-through
                 fee stays excluded from the total and a per-night fee keeps
                 its repeat count instead of silently reverting to one. */
              surchargeType: ii.surcharge_type || '',
              surchargeChargeBasis: ii.surcharge_charge_basis || '',
              surchargeUnitBasis: ii.surcharge_unit_basis || '',
              surchargeChargeable: ii.surcharge_chargeable === null || ii.surcharge_chargeable === undefined
                ? true
                : ii.surcharge_chargeable === true,
              surchargeRepeats: Math.max(1, parseInt(ii.surcharge_repeats, 10) || 1),
              surchargePassedThrough: ii.surcharge_passed_through === true,
              surchargeReference: Number(ii.surcharge_reference) || 0,
              linkedItemId: ii.linked_item_id || null,
              priceProtectionPercent: Number(ii.price_protection_percent) || 0,
              protectedSeasonName: '',
              supplierPaid: ii.supplier_paid === true,
              supplierPaidAt: ii.supplier_paid_at || '',
              supplierPaidRef: ii.supplier_paid_ref || '',
              isOptional: ii.is_included === false,
              mealPlan: ii.meal_plan || '',
              checkInTime: ii.check_in_time || '',
              checkOutTime: ii.check_out_time || '',
              startTime: ii.start_time || '',
              endTime: ii.end_time || '',
              notes: ii.notes || ''
            };
          })
        }));
        setDays(attachSuppliers(built, await fetchSupplierMap(
          built.flatMap((d) => (d.services || []).map((s) => s.supplierId))
        )));
        return true;
      }
      return false;
    } catch {
      return false;
    } finally {
      hydrateRef.current = false;
    }
  }, [data, meta.travelStart, meta.numAdults, meta.numChildren, meta.client, nextId, defaultTaxRate, defaultTaxLabel, taxAppliesForCurrency]);

  /* Auto-populate consultant name from the logged-in user's profile on first
     load. If the itinerary already has a consultant stored, loadExistingDays wins. */
  useEffect(() => {
    const fetchConsultant = async () => {
      try {
        const username = await getLoggedInUserName();
        if (username) {
          hydrateRef.current = true;
          setMeta((prev) => ({
            ...prev,
            consultantName: prev.consultantName || username
          }));
          hydrateRef.current = false;
        }
      } catch { /* noop */ }
    };
    fetchConsultant();
  }, [setMeta]);

  useEffect(() => {
    const boot = async () => {
      if (booted.current) return;
      booted.current = true;
      const cid = await fetchCompanyId();
      await loadCompanyMeta(cid);
      let foundSaved = false;
      if (cid && data?.itineraryId) {
        const savedItemIds = await fetchItineraryItemIds(data.itineraryId);
        await loadLibraryItemsByIds(cid, savedItemIds);
        foundSaved = await loadExistingDays();
      }
      if (!foundSaved) initDaysFromRange();
      setBootedState(true);
    };
    boot();
  }, [data, fetchCompanyId, loadCompanyMeta, fetchItineraryItemIds, loadLibraryItemsByIds, loadExistingDays, initDaysFromRange]);

  /* Safety net for the day skeleton. The boot pass above runs exactly once and
     builds the days from the travel range, but it is async — if the user sets
     the travel dates (or hits Save) before it lands, the working copy can still
     be empty. Left alone, that saves an itinerary header with no days at all.
     So whenever a complete travel range is known and there are simply no days
     yet, (re)generate them. Guarded on `days.length === 0` so it can never
     touch days that already exist, and it cannot loop: once it runs, the
     skeleton is present. */
  useEffect(() => {
    if (!bootedState) return;
    if (days.length > 0) return;
    if (!meta.travelStart || !meta.travelEnd) return;
    /* Deferred a tick so the skeleton lands in its own render instead of
       cascading out of this effect. React clears the timer if the deps change
       or the page unmounts first, so only one rebuild is ever queued. */
    const t = setTimeout(() => initDaysFromRange(), 0);
    return () => clearTimeout(t);
  }, [bootedState, days.length, meta.travelStart, meta.travelEnd, initDaysFromRange]);

  /* Load this itinerary's issued invoices so the builder can reflect real
     deposit/final state (issued, paid, outstanding) without a round-trip to
     the Finance module. */
  const loadItineraryInvoices = useCallback(async () => {
    const iid = meta.itineraryId || lastItineraryIdRef.current;
    if (!companyId || !iid) {
      setItineraryInvoices([]);
      setItineraryReceipts([]);
      setItineraryJournal([]);
      return;
    }
    const { data } = await supabase
      .from('invoices')
      .select('*')
      .eq('itinerary_id', iid)
      .order('created_at', { ascending: false });
    const rows = data || [];
    setItineraryInvoices(rows);

    /* Journal for this itinerary. Loaded here rather than on tab open so the
       invoice list, its receipts and its journal always arrive together and
       can never disagree. */
    const { data: entries } = await supabase
      .from('journal_entries')
      .select('*')
      .eq('itinerary_id', iid)
      .order('entry_date', { ascending: false })
      .order('created_at', { ascending: false });
    const entryRows = entries || [];
    const entryIds = entryRows.map((e) => e.id);
    let lineRows = [];
    if (entryIds.length) {
      const { data: lines } = await supabase
        .from('journal_lines')
        .select('*')
        .in('entry_id', entryIds)
        .order('sort_order', { ascending: true });
      lineRows = lines || [];
    }
    setItineraryJournal(entryRows.map((e) => ({ ...e, lines: lineRows.filter((l) => l.entry_id === e.id) })));

    const ids = rows.map((r) => r.id);
    if (ids.length === 0) { setItineraryReceipts([]); setItineraryCreditNotes([]); return; }
    const [receiptsResult, creditsResult] = await Promise.all([
      supabase
        .from('invoice_receipts')
        .select('*')
        .in('invoice_id', ids)
        .order('created_at', { ascending: false }),
      /* Credit notes are what reduce an invoice without any money moving, so
         the balance on this tab has to see them. */
      supabase
        .from('credit_notes')
        .select('*')
        .in('invoice_id', ids)
        .order('created_at', { ascending: false })
    ]);
    if (receiptsResult.error) throw receiptsResult.error;
    if (creditsResult.error) throw creditsResult.error;
    setItineraryReceipts(receiptsResult.data || []);
    setItineraryCreditNotes(creditsResult.data || []);
  }, [companyId, meta.itineraryId]);

  useEffect(() => {
    let cancelled = false;
    loadItineraryInvoices().catch((error) => {
      if (!cancelled) {
        showToast(`Could not load itinerary finance records: ${error.message}`, 'error');
      }
    });
    return () => { cancelled = true; };
  }, [loadItineraryInvoices, showToast]);

  /* -- Derived lists ------------------------------------------------------- */

  const categoryOptions = useMemo(() => {
    const set = new Set(categoryChips.length ? categoryChips : DEFAULT_CATEGORY_CHIPS);
    set.add('Packages');
    libraryItems.forEach((it) => {
      if (it.category) set.add(it.category);
    });
    return Array.from(set).sort();
  }, [categoryChips, libraryItems]);

  const filteredCurrencies = useMemo(() => {
    const term = currencySearch.trim().toLowerCase();
    if (!term) return currencies;
    return currencies.filter((c) =>
      `${c.code} ${c.name} ${c.symbol}`.toLowerCase().includes(term)
    );
  }, [currencies, currencySearch]);

  const symbolByCode = useMemo(() => {
    const m = new Map();
    currencies.forEach((c) => m.set((c.code || '').toUpperCase(), c.symbol || c.code));
    return m;
  }, [currencies]);

  const svcSymbol = useCallback((code) => {
    const sym = symbolByCode.get((code || 'ZAR').toUpperCase());
    return sym || code || 'ZAR';
  }, [symbolByCode]);

  const pickerItemsToShow = useMemo(() =>
    pickerItems.filter((it) => visibleInCurrency(it, currencyCode)),
  [pickerItems, currencyCode]);

  const pricingGroups = useMemo(() => {
    const order = [];
    const map = new Map();
    days.forEach((d) => {
      const byCurr = {};
      (d.services || []).forEach((sv) => {
        const code = sv.currencyCode || 'ZAR';
        if (!byCurr[code]) byCurr[code] = { buy: 0, sell: 0, tax: 0, taxIn: 0, taxNet: 0, count: 0, taxByLabel: {}, services: [], optBuy: 0, optSell: 0, optTax: 0, optTaxByLabel: {}, optionalServices: [] };
        const servicePax = paxForService(sv, paxCount);
        const line = (Number(sv.sellPP) || 0) * servicePax;
        const buyLine = (Number(sv.buyPP) || 0) * servicePax;
        const rate = numOr(sv.taxRate, defaultTaxRate);
        const taxAmt = vatOfInclusive(line, rate);
        const taxInAmt = vatOfInclusive(buyLine, rate);
        const label = sv.taxLabel || 'VAT';
        /* Optional / alternative services are kept out of the final price and
           invoiced totals, and gathered into their own priced group so the
           client can add them separately. */
        if (sv.isOptional) {
          byCurr[code].optBuy += buyLine;
          byCurr[code].optSell += line;
          byCurr[code].optTax += taxAmt;
          if (!byCurr[code].optTaxByLabel[label]) byCurr[code].optTaxByLabel[label] = { amount: 0, rate };
          byCurr[code].optTaxByLabel[label].amount += taxAmt;
          byCurr[code].optionalServices.push({
            name: sv.name || 'Service',
            supplierName: sv.supplierName || '',
            category: sv.category || '',
            mealPlan: sv.mealPlan || '',
            itemId: sv.itemId || null,
            roomAllocations: Array.isArray(sv.roomAllocations) ? sv.roomAllocations : [],
            markup: Number(sv.markup) || 0,
            taxRate: numOr(sv.taxRate, defaultTaxRate),
            qty: paxCount,
            unit: (Number(sv.sellPP) || 0),
            subExcl: round2(line - taxAmt),
            tax: round2(taxAmt),
            sell: round2(line)
          });
          return;
        }
        byCurr[code].buy += buyLine;
        byCurr[code].sell += line;
        byCurr[code].tax += taxAmt;
        byCurr[code].taxIn += taxInAmt;
        if (!byCurr[code].taxByLabel[label]) byCurr[code].taxByLabel[label] = { amount: 0, rate };
        byCurr[code].taxByLabel[label].amount += taxAmt;
        byCurr[code].count += 1;
        byCurr[code].services.push({
          name: sv.name || 'Service',
          supplierName: sv.supplierName || '',
          category: sv.category || '',
          mealPlan: sv.mealPlan || '',
          itemId: sv.itemId || null,
          roomAllocations: Array.isArray(sv.roomAllocations) ? sv.roomAllocations : [],
          markup: Number(sv.markup) || 0,
          taxRate: numOr(sv.taxRate, defaultTaxRate),
          qty: paxCount,
          unit: (Number(sv.sellPP) || 0),
          subExcl: round2(line - taxAmt),
          tax: round2(taxAmt),
          sell: round2(line)
        });
      });
      Object.keys(byCurr).forEach((code) => {
        if (!map.has(code)) {
          map.set(code, { code, days: [] });
          order.push(code);
        }
        map.get(code).days.push({ day: d.dayNumber, date: d.date, ...byCurr[code] });
      });
    });
    return order.map((code) => {
      const g = map.get(code);
      const cur = currencies.find((c) => (c.code || '').toUpperCase() === code.toUpperCase());
      const taxByLabel = {};
      const optTaxByLabel = {};
      g.days.forEach((r) => {
        Object.entries(r.taxByLabel || {}).forEach(([label, info]) => {
          if (!taxByLabel[label]) taxByLabel[label] = { amount: 0, rate: info.rate };
          taxByLabel[label].amount += info.amount;
        });
        Object.entries(r.optTaxByLabel || {}).forEach(([label, info]) => {
          if (!optTaxByLabel[label]) optTaxByLabel[label] = { amount: 0, rate: info.rate };
          optTaxByLabel[label].amount += info.amount;
        });
      });
      const optionalServices = g.days.flatMap((r) => r.optionalServices || []);
      return {
        code,
        symbol: cur?.symbol || code,
        name: cur?.name || '',
        days: g.days,
        count: g.days.reduce((a, r) => a + r.count, 0),
        optionalCount: optionalServices.length,
        optionalServices,
        totalBuy: round2(g.days.reduce((a, r) => a + r.buy, 0)),
        totalSell: round2(g.days.reduce((a, r) => a + r.sell, 0)),
        totalTax: round2(g.days.reduce((a, r) => a + r.tax, 0)),
        totalTaxIn: round2(g.days.reduce((a, r) => a + (r.taxIn || 0), 0)),
        totalTaxNet: round2(g.days.reduce((a, r) => a + (r.tax || 0) - (r.taxIn || 0), 0)),
        totalInclTax: round2(g.days.reduce((a, r) => a + r.sell, 0)),
        totalExcl: round2(g.days.reduce((a, r) => a + r.sell, 0) - g.days.reduce((a, r) => a + r.tax, 0)),
        taxEntries: Object.entries(taxByLabel).map(([label, info]) => ({
          label,
          rate: info.rate,
          amount: round2(info.amount)
        })),
        optionalTotalSell: round2(g.days.reduce((a, r) => a + (r.optSell || 0), 0)),
        optionalTotalTax: round2(g.days.reduce((a, r) => a + (r.optTax || 0), 0)),
        optionalTotalExcl: round2(g.days.reduce((a, r) => a + (r.optSell || 0), 0) - g.days.reduce((a, r) => a + (r.optTax || 0), 0)),
        optionalTaxEntries: Object.entries(optTaxByLabel).map(([label, info]) => ({
          label,
          rate: info.rate,
          amount: round2(info.amount)
        }))
      };
    });
  }, [days, paxCount, currencies, defaultTaxRate]);

  /* -- Day / pricing helpers (called from handlers, not render) ----------- */

  const normalizeDays = useCallback((arr) => arr.map((d, i) => ({
    ...d,
    dayNumber: i + 1,
    date: meta.travelStart ? addDaysToDate(meta.travelStart, i) : d.date || ''
  })), [meta.travelStart]);

  const applyDateExtension = useCallback((arr) => {
    const last = arr[arr.length - 1];
    if (!last?.date) return;
    setMeta((prev) => {
      const end = toISODate(last.date);
      if (end !== toISODate(prev.travelEnd)) {
        return { ...prev, travelEnd: end };
      }
      return prev;
    });
  }, [setMeta]);

  const dayTotals = useCallback((day) => {
    let buy = 0;
    let sell = 0;
    let taxOut = 0;
    let taxIn = 0;
    (day.services || []).forEach((sv) => {
      const servicePax = paxForService(sv, paxCount);
      const mergeLine = (Number(sv.sellPP) || 0) * servicePax;
      const rate = numOr(sv.taxRate, defaultTaxRate);
      buy += (Number(sv.buyPP) || 0) * servicePax;
      sell += mergeLine;
      taxOut += vatOfInclusive(mergeLine, rate);
      taxIn += vatOfInclusive((Number(sv.buyPP) || 0) * servicePax, rate);
    });
    return {
      buy: round2(buy),
      sell: round2(sell),
      tax: round2(taxOut),
      inputTax: round2(taxIn),
      netTax: round2(taxOut - taxIn),
      total: round2(sell),
      count: (day.services || []).length
    };
  }, [paxCount, defaultTaxRate]);

  const createService = useCallback((dayIndex, item, via, options = {}) => {
    if (completedRef.current) return;

    /* Pricing Protection: pick the season that actually covers the trip, block
       an unpriceable item outright, and uplift a stale season by the tenant's
       protection percentage. Done before anything is written so a blocked item
       never lands on the day and has to be undone. */
    const season = resolveSeasonForTravel({
      rates: item.item_rates || [],
      currencyCode,
      startDate: travelWindow.start,
      endDate: travelWindow.end,
      protectionPercent: priceProtectionPercent
    });
    if (!season.canAdd) {
      showToast(`"${item.name}" cannot be added: ${season.reason}`, 'error');
      return;
    }
    const protectedPct = season.protectionPercent || 0;

    /* A protected rate is uplifted before the per-person figure is derived, so
       the markup, tax and totals on the line all build on the protected price
       rather than needing a separate adjustment later. */
    const effectiveRates = protectedPct
      ? (item.item_rates || []).map((r) => (r.id === season.rate?.id ? applyProtectionToRate(r, protectedPct) : r))
      : item.item_rates || [];
    /* Narrow to the ONE season that prices this trip.

       contractPaxRate() -> rateForItem() takes the first row matching the
       currency, so handing it the whole matrix prices the line from whichever
       season the database returned first. The sidebar avoided this only
       because it built its own single-row item. Resolving here once means the
       line total, the room-allocation dialog and anything copied afterwards
       all read the same season. */
    const seasonalRates = season.rate
      ? ([effectiveRates.find((r) => r.id === season.rate.id)
        || effectiveRates.find((r) => r.season_name && r.season_name === season.rate.season_name)
        || applyProtectionToRate(season.rate, protectedPct)])
      : effectiveRates;
    const pricedItem = { ...item, item_rates: seasonalRates };
    /* The single protected row, used directly by the surcharge pricing path
       below. */
    const pricedRate = seasonalRates[0] || season.rate;

    /* Derived from the RESOLVED season, not the raw item: rate_basis is a
       property of the rate row, so a matrix that prices summer per-person and
       winter per-room must bill this trip on the row that actually covers it. */
    const basis = basisOfItem(pricedItem, currencyCode);

    const buyPP = round2(contractPaxRate(pricedItem, currencyCode, paxCount));
    const markup = Number(markupPct) || 0;
    const cat = item.category || '';
    const tourCat = /transfers?|tours?|activities?|excursions?/i.test(cat) || cat === 'Flights / Charter';
    const accomCat = /accommodation/i.test(cat);
    const surcharge = isSurchargeItem(item);
    /* Library items keep the vehicle in middle_category (transfers / tours) and
       the pax capacity in max_occupancy; meal plans live on the per-season
       item_rates rows with an accommodation default of "Bed & Breakfast". */
    const libMaxOcc = item.maxOccupancy ?? item.max_occupancy;
    const taxApplies = taxAppliesForCurrency(currencyCode);
    const numOrBlank = (v) => {
      if (v === '' || v === null || v === undefined) return '';
      const n = Number(v);
      return Number.isFinite(n) ? n : '';
    };
    const svc = {
      key: nextId(),
      itemId: item.id,
      supplierId: item.supplier_id || item.supplierId || item.supplier?.id || null,
      name: item.name,
      category: item.category || '',
      supplierName: item.supplier?.name || '',
      currencyCode,
      basis,
      buyPP,
      markup,
      sellPP: round2(buyPP * (1 + markup / 100)),
      pax: paxCount,
      quantity: 1,
      descOverride: '',
      taxRate: taxApplies ? defaultTaxRate : 0,
      taxLabel: taxApplies ? defaultTaxLabel : 'No VAT',
      time: '',
      confirmationStatus: 'RQ',
      confirmationNumber: '',
      flightNumber: item.flightNumber || item.flight_number || '',
      flightTime: item.flightTime || item.flight_time || '',
      vehicleType: item.vehicleType || item.vehicle_type || (tourCat ? item.sub_category : ''),
      capacity: numOrBlank(item.capacity ?? libMaxOcc),
      roomType: item.roomType || item.room_type || '',
      destinationRegion: item.destination_region || item.destinationRegion || item.location || '',
      destinationArea: item.destination_area || item.destinationArea || '',
      maxOccupancy: numOrBlank(libMaxOcc),
      mealPlan: item.mealPlan || item.meal_plan || (item.item_rates || []).find((r) => r.meal_plan)?.meal_plan || (accomCat ? 'Bed & Breakfast' : ''),
      checkInTime: item.checkInTime || item.check_in_time || '',
      checkOutTime: item.checkOutTime || item.check_out_time || '',
      startTime: item.startTime || item.start_time || '',
      endTime: item.endTime || item.end_time || '',
      notes: '',
      /* Only the season this trip is priced from. Storing the whole matrix here
         means every later reader (the room-allocation dialog, the per-room
         breakdown, a copied line) has to re-resolve the season itself, and the
         ones that forgot priced the line from whichever row came back first. */
      item_rates: pricedItem.item_rates,
      isOptional: !!options.isOptional,
      repeatGroupId: options.repeatGroupId || null,
      /* Properties that together house one party on one night. Set from the
         "group split" choice in the placement prompt; alternatives never get
         one because they are not part of the party. */
      splitGroupId: options.splitGroupId || null,
      /* Kept on the line so the protected price stays explainable after a
         reload: the raw season, what was applied and why. */
      priceProtectionPercent: protectedPct,
      protectedSeasonName: protectedPct ? season.seasonName : '',
      /* Which matrix priced this line, so a dialog or an export can say so. */
      seasonName: season.seasonName || '',
      seasonValidFrom: season.validFrom || '',
      seasonValidTo: season.validTo || ''
    };

    /* Surcharge Fees are priced on their own terms, not as per-person
       services: the fee is a per-person / per-adult / per-child / per-unit /
       per-vehicle figure, repeated for the basis, and a non-chargeable fee is
       the supplier's figure shown for reference with no markup and no money
       added. The totals elsewhere are always buyPP x paxCount, so the whole
       figure is folded into buyPP and the repeat count rides on quantity. */
    if (surcharge) {
      const chargeable = isSurchargeChargeable(item);
      const repeats = Math.max(1, parseInt(options.surchargeRepeats, 10)
        || surchargeRepeats({ item, nights: options.surchargeNights ?? 1 }));
      const { unitBasis, total: buyTotal } = surchargeBuyTotal({
        /* The protected rate, not the raw one: the fee belongs to the same
           season as the rest of the line, so an outdated season that needed an
           uplift has to uplift the fee too. */
        rate: pricedRate,
        item,
        paxCount,
        childCount: Number(meta.numChildren) || 0,
        nights: options.surchargeNights ?? 1
      });
      const priced = surchargePricing({ buyTotal, markupPercent: markup, chargeable });
      svc.quantity = repeats;
      svc.basis = unitBasis === 'per_person' ? 'per_person' : unitBasis;
      svc.buyPP = paxCount > 0 ? round2(priced.buy / paxCount) : round2(priced.buy);
      svc.sellPP = paxCount > 0 ? round2(priced.sell / paxCount) : round2(priced.sell);
      svc.surchargeType = surchargeTypeOf(item);
      svc.surchargeChargeBasis = surchargeBasisOf(item);
      svc.surchargeUnitBasis = unitBasis;
      svc.surchargeChargeable = chargeable;
      svc.surchargePassedThrough = priced.passedThrough;
      svc.surchargeReference = round2(priced.reference || 0);
      svc.surchargeRepeats = repeats;
      svc.linkedItemId = surchargeLinkId(item);
      svc.notes = priced.passedThrough
        ? 'Not chargeable — supplier figure shown for reference only, excluded from the total.'
        : '';
    }

    setDays((prev) => prev.map((d, i) => (
      i === dayIndex ? { ...d, services: [...d.services, svc] } : d
    )));
    const dayLabel = days[dayIndex] ? `Day ${days[dayIndex].dayNumber}` : 'the selected day';
    const added = `${via === 'double-click' ? 'Added' : 'Dropped'} "${item.name}" into ${dayLabel}`;
    if (protectedPct) {
      /* Protection changes the money on the line, so it is stated rather than
         left for the operator to infer from a total. */
      showToast(
        `${added} — Pricing Protection applied: ${protectedPct}% added to the ${season.seasonName || 'previous'} season because no season covers ${travelWindow.start} - ${travelWindow.end}.`,
        'warning'
      );
    } else if (season.status === 'ok' && season.reason) {
      showToast(`${added} — ${season.reason}`, 'warning');
    } else {
      showToast(added, 'success');
    }

    /* A surcharged service comes with its accommodation rather than on its own,
       so the two always land on the same day. A per-night fee that is not
       linked to anything cannot work out its own repeat count, so ask. */
    if (surcharge && !options.suppressSurchargeFollowUps) {
      if (needsRepeatPrompt(item) && !options.surchargeRepeats) {
        setSurchargeRepeatPrompt({
          isOpen: true,
          dayIndex,
          item,
          nights: options.surchargeNights ?? 1,
          via
        });
      }
    }

    /* An alternative room is only one of the options being offered, so there is
       nothing to allocate to it — the traveller allocation modal is skipped.

       This is the path that fires the moment an item is DROPPED onto a day, and
       it must hand the dialog the same season-resolved matrix as
       openRoomAllocationModal does. Passing the raw `item` here gave the dialog
       every season at once, so getRateRow() priced the room from whichever row
       the database returned first — a drop quoted Winter while the sidebar and
       the allocate button both quoted Summer. */
    if (accomCat && !options.suppressRoomModal && !options.isOptional) {
      setRoomModalState({
        isOpen: true,
        dayIndex,
        serviceKey: svc.key,
        item: buildRoomModalItem({ base: item, service: svc, modalRates: seasonalRates, season }),
        service: svc
      });
    }
  }, [currencyCode, markupPct, paxCount, days, nextId, defaultTaxRate, defaultTaxLabel, showToast, taxAppliesForCurrency, setDays, travelWindow.start, travelWindow.end, priceProtectionPercent, meta.numChildren, setSurchargeRepeatPrompt]);

  /* The unlinked per-night fee was added optimistically at a repeat count of 1
     because nothing was known at the time; once the operator answers, the line
     that was just added is re-priced rather than a second line being added, so
     the day never ends up with the fee counted twice. */
  const applySurchargeRepeatCount = useCallback(() => {
    const prompt = surchargeRepeatPrompt;
    const repeats = Math.max(1, surchargeRepeatCount);
    setSurchargeRepeatPrompt(null);
    setSurchargeRepeatCount(1);
    if (!prompt) return;

    const dayIndex = prompt.dayIndex;
    const day = days[dayIndex];
    if (!day) return;
    /* The last line on the day is the one just created. */
    const target = [...day.services].reverse().find((s) => s.itemId === prompt.item.id);
    if (!target) return;

    const item = libraryItems.find((li) => li.id === prompt.item.id) || prompt.item;
    const season = resolveSeasonForTravel({
      rates: item.item_rates || [],
      currencyCode,
      startDate: travelWindow.start,
      endDate: travelWindow.end,
      protectionPercent: priceProtectionPercent
    });
    const markup = Number(markupPct) || 0;
    const chargeable = isSurchargeChargeable(item);
    const { total: buyTotal } = surchargeBuyTotal({
      rate: applyProtectionToRate(season.rate, season.protectionPercent || 0),
      item,
      paxCount,
      childCount: Number(meta.numChildren) || 0,
      nights: repeats
    });
    const priced = surchargePricing({ buyTotal, markupPercent: markup, chargeable });

    setDays((prev) => prev.map((d, i) => (
      i === dayIndex
        ? {
          ...d,
          services: d.services.map((s) => (s.key === target.key
            ? {
              ...s,
              quantity: repeats,
              buyPP: paxCount > 0 ? round2(priced.buy / paxCount) : round2(priced.buy),
              sellPP: paxCount > 0 ? round2(priced.sell / paxCount) : round2(priced.sell),
              surchargeRepeats: repeats,
              surchargePassedThrough: priced.passedThrough
            }
            : s))
        }
        : d
    )));
    showToast(
      `"${item.name}" priced for ${repeats} night${repeats === 1 ? '' : 's'}${priced.passedThrough ? ' — not chargeable, excluded from the total' : ''}.`,
      'success'
    );
  }, [surchargeRepeatPrompt, surchargeRepeatCount, days, libraryItems, currencyCode, travelWindow.start, travelWindow.end, priceProtectionPercent, markupPct, paxCount, meta.numChildren, setDays, showToast]);

  /* Every surcharge linked to this accommodation, added as its own service line.
     Each occurrence is one line priced for exactly one charge, and the number of
     occurrences is what decides the total:
       - a once-off fee appears once, on the first night the property is booked,
         because the supplier charges it once for the whole booking;
       - a per-night fee appears on every night, one charge each.
     Carrying the full night count on every one of the nights instead would bill
     N nights twice over (N lines x N charges), and adding the once-off fee to
     each night would bill it N times. */
  const addLinkedSurcharges = useCallback((accommodationItem, dayIndices = []) => {
    const linked = libraryItems.filter((li) => isSurchargeItem(li) && surchargeLinkId(li) === accommodationItem?.id);
    if (!linked.length || !dayIndices.length) return;
    const summary = [];
    linked.forEach((feeItem) => {
      const perNight = surchargeBasisOf(feeItem) === 'per_night';
      const occurrenceDays = perNight ? dayIndices : [dayIndices[0]];
      occurrenceDays.forEach((dayIndex) => {
        createService(dayIndex, feeItem, 'copy', {
          suppressRoomModal: true,
          suppressSurchargeFollowUps: true,
          /* Every line is a single occurrence, so the per-night count is carried
             by the number of lines rather than by a multiplier on each of them.
             The operator is never prompted: a linked fee knows its own count. */
          surchargeRepeats: 1,
          surchargeNights: 1
        });
      });
      summary.push(`${feeItem.name}${perNight ? ` x${occurrenceDays.length}` : ''}`);
    });
    if (summary.length) {
      showToast(
        `Added with ${accommodationItem?.name || 'the accommodation'}: ${summary.join(', ')}.`,
        'success'
      );
    }
  }, [libraryItems, createService, showToast]);

  const openPlacementPrompt = useCallback((dayIndex, item, via) => {
    setPlacementDraft({ dayIndex, item, via });
    setPlacementError('');
    setPlacementDestinationSplit(false);
    setPlacementRepeat(false);
    setPlacementRepeatCount(Math.min(2, Math.max(1, days.length - dayIndex)));
    setPlacementCopyDays([]);
    const alreadyHasIncludedAccommodation = (days[dayIndex]?.services || []).some(
      (service) => /accommodation/i.test(service.category || '') && !service.isOptional
    );
    setPlacementOptional(isAccommodationItem(item) && alreadyHasIncludedAccommodation);
    setPlacementSplit(false);
  }, [days]);

  const isVehicleServiceItem = useCallback((item) => {
    const category = item?.category || '';
    if (/accommodation/i.test(category)) return false;
    return /transfers?|activities?|tours?|excursions?|flights?\s*\/?\s*charter/i.test(category)
      && Number(item?.capacity ?? item?.max_occupancy ?? item?.maxOccupancy) > 0;
  }, []);

  const vehicleOptionsFor = useCallback((item) => {
    const category = item?.category || '';
    const sourceCapacity = Number(item?.capacity ?? item?.max_occupancy ?? item?.maxOccupancy) || 0;
    const normaliseContext = (value) => String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
    const supplierId = item?.supplier_id || item?.supplier?.id || null;
    const destination = normaliseContext(
      item?.location
      || item?.destination
      || item?.destination_region
      || item?.supplier?.city_location
      || item?.supplier?.city
      || item?.supplier?.province_state
    );
    const scopedItems = libraryItems.filter((candidate) => {
      if (candidate.category !== category) return false;
      if (Number(candidate.capacity ?? candidate.max_occupancy ?? candidate.maxOccupancy) <= 0) return false;
      const sameSupplier = supplierId && (candidate.supplier_id || candidate.supplier?.id) === supplierId;
      const candidateDestination = normaliseContext(
        candidate.location
        || candidate.destination
        || candidate.destination_region
        || candidate.supplier?.city_location
        || candidate.supplier?.city
        || candidate.supplier?.province_state
      );
      const sameDestination = destination && candidateDestination && destination === candidateDestination;
      return sameSupplier || sameDestination;
    });
    const options = scopedItems.length ? scopedItems : [item];
    return options
      .filter((candidate) => Number(candidate.capacity ?? candidate.max_occupancy ?? candidate.maxOccupancy) >= paxCount)
      .sort((a, b) => (
        Number(a.capacity ?? a.max_occupancy ?? a.maxOccupancy)
        - Number(b.capacity ?? b.max_occupancy ?? b.maxOccupancy)
      ))
      .filter((candidate, index, all) => all.findIndex((entry) => entry.id === candidate.id) === index)
      .concat(sourceCapacity >= paxCount && !options.some((candidate) => candidate.id === item.id) ? [item] : []);
  }, [libraryItems, paxCount]);

  const openVehiclePrompt = useCallback((dayIndex, item, via) => {
    setVehicleDraft({ dayIndex, item, via, options: vehicleOptionsFor(item) });
  }, [vehicleOptionsFor]);

  const addService = useCallback((dayIndex, item, via) => {
    if (completedRef.current) return;
    if (via === 'drop' || via === 'double-click') {
      if (isVehicleServiceItem(item)) openVehiclePrompt(dayIndex, item, via);
      else openPlacementPrompt(dayIndex, item, via);
      return;
    }
    createService(dayIndex, item, via);
  }, [createService, isVehicleServiceItem, openPlacementPrompt, openVehiclePrompt]);

  const addPackageToDay = useCallback((dayIndex, pkg) => {
    if (completedRef.current || isReadOnly || !days[dayIndex]) return;
    const taxApplies = taxAppliesForCurrency(currencyCode);
    // The itinerary owns a detached copy of the reusable package contents.
    // Editing this copy must never mutate the saved package in the Packages menu.
    const packageSnapshot = pkg.package_snapshot
      ? JSON.parse(JSON.stringify(pkg.package_snapshot))
      : { id: pkg.id, name: pkg.name, description: pkg.description || '', days: [] };
    const snapshotServices = (packageSnapshot.days || []).flatMap((day) => day.services || []);
    const includedServices = snapshotServices.filter((service) => service.is_included !== false);
    const packageCurrencies = [...new Set(includedServices.map((service) => service.currency_code || 'ZAR'))];
    const packageCurrency = packageCurrencies.includes(currencyCode) ? currencyCode : packageCurrencies[0] || currencyCode;
    const packageCost = round2(snapshotServices
      .filter((service) => service.is_included !== false && (service.currency_code || 'ZAR') === packageCurrency)
      .reduce((sum, service) => {
        const qty = Number(service.quantity) || 1;
        const cost = Number(service.unit_cost) || 0;
        return sum + (isFlatBasis(service.rate_basis) ? cost * qty / Math.max(1, paxCount) : cost * qty);
      }, 0));
    // The itinerary client markup overrides the reusable package and its saved
    // service markups when a package is copied into this quote.
    const packageMarkup = Number(markupPct) || 0;
    const service = {
      key: nextId(), itemId: null, packageId: pkg.id, packageSnapshot,
      supplierId: null, name: pkg.name, category: 'Package',
      supplierName: '', currencyCode: packageCurrency, basis: 'per_person', buyPP: packageCost,
      markup: packageMarkup, sellPP: round2(packageCost * (1 + packageMarkup / 100)), pax: paxCount, quantity: 1,
      descOverride: pkg.description || '', taxRate: taxApplies ? defaultTaxRate : 0,
      taxLabel: taxApplies ? defaultTaxLabel : 'No VAT', time: '', confirmationStatus: 'RQ',
      confirmationNumber: '', notes: '', item_rates: [], isOptional: false, repeatGroupId: null
    };
    setDays((prev) => prev.map((day, index) => index === dayIndex
      ? { ...day, services: [...day.services, service] }
      : day));
    const mixedCurrencies = packageCurrencies.length > 1;
    showToast(`Added ${pkg.name} to Day ${days[dayIndex].dayNumber}.${mixedCurrencies ? ` Its main price uses ${packageCurrency}; review other currencies in the expanded details.` : ''}`, mixedCurrencies ? 'warning' : 'success');
  }, [isReadOnly, days, currencyCode, taxAppliesForCurrency, nextId, paxCount, markupPct, defaultTaxRate, defaultTaxLabel, setDays, showToast]);

  const removePackageService = useCallback((dayIndex, packageRowKey, packageDayIndex, serviceIndex) => {
    if (completedRef.current || isReadOnly) return;
    let removedName = '';
    setDays((previous) => previous.map((day, index) => {
      if (index !== dayIndex) return day;
      return {
        ...day,
        services: day.services.map((service) => {
          if (service.key !== packageRowKey || !service.packageSnapshot) return service;
          const packageDays = (service.packageSnapshot.days || []).map((packageDay, indexInPackage) => {
            if (indexInPackage !== packageDayIndex) return packageDay;
            const services = [...(packageDay.services || [])];
            if (serviceIndex >= 0 && serviceIndex < services.length) {
              removedName = services[serviceIndex].item_name || 'Package service';
              services.splice(serviceIndex, 1);
            }
            return { ...packageDay, services };
          });
          const remainingIncluded = packageDays
            .flatMap((packageDay) => packageDay.services || [])
            .filter((item) => item.is_included !== false && (item.currency_code || 'ZAR') === (service.currencyCode || 'ZAR'));
          const buyPP = round2(remainingIncluded.reduce((sum, item) => {
            const quantity = Number(item.quantity) || 1;
            const cost = Number(item.unit_cost) || 0;
            return sum + (isFlatBasis(item.rate_basis) ? cost * quantity / Math.max(1, paxCount) : cost * quantity);
          }, 0));
          const markup = Number(service.markup) || 0;
          return {
            ...service,
            packageSnapshot: { ...service.packageSnapshot, days: packageDays },
            buyPP,
            sellPP: round2(buyPP * (1 + markup / 100))
          };
        })
      };
    }));
    if (removedName) showToast(`${removedName} removed from the package in this itinerary.`, 'success');
  }, [isReadOnly, setDays, paxCount, showToast]);

  const selectVehicleOption = useCallback((item) => {
    if (!vehicleDraft) return;
    const { dayIndex, via } = vehicleDraft;
    setVehicleDraft(null);
    openPlacementPrompt(dayIndex, item, via);
  }, [vehicleDraft, openPlacementPrompt]);

  /* Distinct travellers already sleeping on a day. A night counts as full only
     once every guest holds a bed, which is what leaves room for a split group
     (e.g. 6 of 10 here, the other 4 in a second property) to be added. */
  const accommodationPaxOnDay = useCallback((dayIndex) => {
    const day = days[dayIndex];
    if (!day) return 0;
    return beddedTravellerCount(day.services || []);
  }, [days]);

  const placementSelectedDays = useMemo(() => {
    if (!placementDraft) return [];
    const baseDay = placementDraft.dayIndex;
    const repeatCount = placementRepeat
      ? Math.max(1, Math.min(days.length - baseDay, Number(placementRepeatCount) || 1))
      : 1;
    return [...new Set([
      ...Array.from({ length: repeatCount }, (_, index) => baseDay + index),
      ...placementCopyDays.map(Number)
    ])]
      .filter((index) => index >= 0 && index < days.length)
      .sort((a, b) => a - b);
  }, [placementDraft, placementRepeat, placementRepeatCount, placementCopyDays, days.length]);

  const confirmPlacement = useCallback(() => {
    if (!placementDraft) return;
    setPlacementError('');
    /* A group split and an alternative are opposites: one is part of the
       party's night and is priced into the itinerary, the other is an option
       the client may or may not take. Never both. */
    const isSplit = !!placementSplit && !placementOptional;
    const isOptional = !!placementOptional && !isSplit;
    const baseDay = placementDraft.dayIndex;
    const selectedDays = placementSelectedDays;

    if (isAccommodationItem(placementDraft.item)) {
      const conflicts = selectedDays.flatMap((dayIndex) => {
        const services = (days[dayIndex]?.services || []).filter(
          (service) => /accommodation/i.test(service.category || '')
        );
        return accommodationRegionConflicts(services, placementDraft.item, libraryItems)
          .map(({ region }) => ({ region }));
      });
      if (conflicts.length) {
        const hasMissingParentArea = !accommodationRegionOf(placementDraft.item)
          || conflicts.some(({ region }) => !region);
        const canJoinExistingDestination = selectedDays.every((dayIndex) => {
          const services = (days[dayIndex]?.services || []).filter(
            (service) => /accommodation/i.test(service.category || '')
          );
          const dayConflicts = accommodationRegionConflicts(services, placementDraft.item, libraryItems);
          if (!dayConflicts.length) return true;
          return canJoinExistingAccommodationDestination(services, placementDraft.item, libraryItems);
        });
        const canPlaceAcrossDestinations = isSplit && placementDestinationSplit;
        const canPlaceInExistingDestination = isSplit && !hasMissingParentArea && canJoinExistingDestination;
        if (!canPlaceAcrossDestinations && !canPlaceInExistingDestination) {
          setPlacementError(
            !accommodationRegionOf(placementDraft.item)
              ? (placementDestinationSplit
                ? 'This accommodation has no Parent Destination / Region set. Update it in Library Items so the destination split can be recorded correctly.'
                : 'Set a Parent Destination / Region for this accommodation in Library Items before adding it to the itinerary.')
              : 'This accommodation is in a different Parent Destination / Region from the rest of the group. Select “Split travelers across different destinations” to continue, or add accommodation in the same Parent Destination / Region.'
          );
          return;
        }
      }
    }

    /* A group split only makes sense while the night still has homeless
       travellers: this property takes the next batch, and the one after that
       takes the rest. Once the party is fully bedded, another property on that
       night is an alternative again. */
    if (isSplit) {
      const totalPax = (meta.travellers || []).length || paxCount;
      const noRoomLeft = selectedDays.filter((dayIndex) => accommodationPaxOnDay(dayIndex) >= totalPax);
      if (noRoomLeft.length) {
        const blocked = noRoomLeft.map((dayIndex) => `Day ${days[dayIndex]?.dayNumber ?? dayIndex + 1}`).join(', ');
        showToast(
          `All ${totalPax} pax already have a bed on ${blocked}, so there is nobody left to split off. Add it as an Alternative instead.`,
          'warning'
        );
        setPlacementSplit(false);
        return;
      }
    } else if (!isOptional && /accommodation/i.test(placementDraft.item?.category || '')) {
      /* No split chosen: a normal room still cannot be added to a night where
         everybody is already bedded, because that is what an alternative is
         for. */
      const totalPax = (meta.travellers || []).length || paxCount;
      if (totalPax > 0) {
        const fullDays = selectedDays.filter((dayIndex) => accommodationPaxOnDay(dayIndex) >= totalPax);
        if (fullDays.length) {
          const blocked = fullDays.map((dayIndex) => `Day ${days[dayIndex]?.dayNumber ?? dayIndex + 1}`).join(', ');
          showToast(
            `All ${totalPax} pax already have a bed on ${blocked}. Tick "Group split" to house the rest of the party here, or add it as an Alternative.`,
            'warning'
          );
          return;
        }
      }
    }

    /* Join the properties already housing this party on the first day, or
       start a new split group. Explicitly selected split properties on this
       night are linked as siblings, including older entries without an id. */
    let splitGroupId = null;
    if (isSplit) {
      const existing = (days[baseDay]?.services || []).find(
        (sv) => /accommodation/i.test(sv.category || '') && !sv.isOptional && sv.splitGroupId
      );
      splitGroupId = existing?.splitGroupId || nextId();
      setDays((prev) => prev.map((day, dayIndex) => (
        selectedDays.includes(dayIndex)
          ? {
              ...day,
              services: joinAccommodationSplitGroup(day.services || [], splitGroupId)
            }
          : day
      )));
    }

    const repeatGroupId = selectedDays.length > 1 ? nextId() : null;
    selectedDays.forEach((dayIndex, index) => {
      createService(dayIndex, placementDraft.item, index === 0 ? placementDraft.via : 'copy', {
        repeatGroupId,
        isOptional,
        splitGroupId,
        /* A split needs its allocation on every day it lands on — each night
           only asks for the travellers that are still homeless there. */
        suppressRoomModal: isSplit ? false : index !== 0
      });
    });
    /* An entrance fee or conservation levy belongs to its accommodation, so it
       travels with it onto every day the property lands on. Not for an
       alternative — the client has not chosen that property, so its fees are
       not in the quote. */
    if (!isOptional) addLinkedSurcharges(placementDraft.item, selectedDays);
    setPlacementDraft(null);
    setPlacementError('');
    setPlacementCopyDays([]);
    setPlacementSplit(false);
    setPlacementDestinationSplit(false);
    setPlacementOptional(false);
  }, [placementDraft, placementOptional, placementSplit, placementDestinationSplit, placementSelectedDays, days, libraryItems, meta.travellers, paxCount, accommodationPaxOnDay, showToast, setDays, nextId, createService, addLinkedSurcharges]);

  const openRoomAllocationModal = useCallback((dayIndex, sv) => {
    const libraryItem = libraryItems.find((it) => it.id === sv.itemId) || {};
    /* The library item carries one row per season, and calculateRoomCharges()
       reads whichever row getRateRow() finds first for the currency — the same
       first-match the sidebar would use if it were not resolving a season. Hand
       the modal the WHOLE matrix and it prices the room from whatever season
       the database happened to return first (winter, in a summer trip).

       So resolve the season here exactly as the sidebar and createService()
       do — against this itinerary's travel window — and pass down only that
       row. This is also what keeps a reloaded itinerary honest: the season is
       not stored on itinerary_day_items, so it has to be derived from the
       travel dates every time the dialog opens. */
    const sourceRates = (Array.isArray(libraryItem.item_rates) && libraryItem.item_rates.length)
      ? libraryItem.item_rates
      : (Array.isArray(sv.item_rates) ? sv.item_rates : []);
    /* A line already carrying Pricing Protection keeps its own percentage: it
       was priced with it and the dialog's figures overwrite buyPP/sellPP on
       confirm, so re-deriving it from the tenant's current setting would
       silently re-price the line. Lines without protection follow the tenant. */
    const modalProtectionPct = Number(sv.priceProtectionPercent) > 0
      ? Number(sv.priceProtectionPercent)
      : priceProtectionPercent;
    const season = resolveSeasonForTravel({
      rates: sourceRates,
      currencyCode,
      startDate: travelWindow.start,
      endDate: travelWindow.end,
      protectionPercent: modalProtectionPct
    });
    const modalRates = season.rate
      ? [applyProtectionToRate(season.rate, season.protectionPercent || 0)]
      /* Nothing resolved: still hand the dialog ONE row. Falling back to the
         whole matrix is what let getRateRow() quote a season the trip is not
         priced from — a multi-season array must never reach this dialog. */
      : [resolveRateForTravel({
        rates: sourceRates,
        currencyCode,
        startDate: travelWindow.start,
        endDate: travelWindow.end,
        protectionPercent: modalProtectionPct
      })].filter(Boolean);
    const libItem = buildRoomModalItem({
      base: libraryItem,
      service: sv,
      modalRates,
      season
    });
    setRoomModalState({
      isOpen: true,
      dayIndex,
      serviceKey: sv.key,
      item: libItem,
      service: sv
    });
  }, [libraryItems, currencyCode, travelWindow.start, travelWindow.end, priceProtectionPercent]);

  const validateAllRoomAllocations = useCallback(() => {
    for (let i = 0; i < (days || []).length; i++) {
      const day = days[i];
      /* Completeness is judged per night, not per service: a group split
         across two included properties is fine as long as the whole party is
         bedded once, within capacity, and nobody is double-booked. Alternatives
         are options the client has not chosen, so they are left out. */
      const check = validateDayAccommodation(day, meta.travellers || []);
      if (!check.isValid) {
        return {
          isValid: false,
          dayNumber: day.dayNumber,
          serviceName: check.service?.name || '',
          reason: check.reason,
          serviceKey: check.serviceKey,
          dayIndex: i,
          service: check.service || (day.services || []).find((sv) => sv.key === check.serviceKey) || null
        };
      }
    }
    return { isValid: true };
  }, [days, meta.travellers]);

  const handleSaveRoomAllocation = useCallback(({ roomAllocations, calculatedBuy, calculatedSell, numRooms, splitPending }) => {
    if (!roomModalState.serviceKey || roomModalState.dayIndex === null) return;
    const dayIdx = roomModalState.dayIndex;
    const svKey = roomModalState.serviceKey;
    const currentPax = Math.max(1, allocatedTravellerCount(roomAllocations) || paxCount);
    const newBuyPP = round2(calculatedBuy / currentPax);
    const newSellPP = round2(calculatedSell / currentPax);

    /* When a partial allocation starts or continues a split, link all included
       properties on this night. Older or interrupted split flows may have
       assigned a group id only to the newly-added property. */
    const splitGroupId = splitPending
      ? days[dayIdx]?.services?.find(
        (service) => service.key === svKey && /accommodation/i.test(service.category || '') && !service.isOptional
      )?.splitGroupId
        || days[dayIdx]?.services?.find(
          (service) => /accommodation/i.test(service.category || '') && !service.isOptional && service.splitGroupId
        )?.splitGroupId
        || nextId()
      : null;

    setDays((prev) => prev.map((d, i) => {
      if (i !== dayIdx) return d;
      let withSelf = (d.services || []).map((s) => (
        s.key === svKey
          ? {
              ...s,
              roomAllocations,
              buyPP: newBuyPP,
              sellPP: newSellPP,
              pax: currentPax,
              numRooms,
              splitGroupId: splitPending ? splitGroupId : s.splitGroupId
            }
          : s
      ));
      if (splitPending) {
        withSelf = joinAccommodationSplitGroup(withSelf, splitGroupId);
      }
      return { ...d, services: withSelf };
    }));
    const sourceService = days[dayIdx]?.services?.find((service) => service.key === svKey);
    const related = sourceService?.repeatGroupId
      ? days.flatMap((day, index) => (day.services || [])
        .filter((service) => service.repeatGroupId === sourceService.repeatGroupId && !(index === dayIdx && service.key === svKey))
        .map((service) => ({ dayIndex: index, service })))
      : [];
    if (related.length) {
      setRoomApplyPrompt({ roomAllocations, calculatedBuy, calculatedSell, numRooms, related });
    } else {
      showToast('Room allocation & rates updated', 'success');
    }

    /* A split group is worked through one property at a time: after this bed
       round, say how many travellers still need a bed that night so the
       operator knows to add the next property as a group split. */
    if (/accommodation/i.test(sourceService?.category || '')) {
      const totalPax = (meta.travellers || []).length || paxCount;
      if (totalPax > 0) {
        const bedded = beddedTravellerCount((days[dayIdx]?.services || []).map((service) => (
          service.key === svKey ? { ...service, roomAllocations } : service
        )));
        const stillHomeless = totalPax - bedded;
        if (stillHomeless > 0) {
          showToast(
            `${stillHomeless} traveller(s) still need a bed on Day ${days[dayIdx]?.dayNumber ?? dayIdx + 1} — add another property and tick "Group split".`,
            'info'
          );
        }
      }
    }
  }, [roomModalState, paxCount, days, meta.travellers, showToast, setDays, nextId]);
  const applyRoomAllocationToRelated = useCallback((applyToAll) => {
    if (!roomApplyPrompt) return;
    if (applyToAll) {
      const currentPax = Math.max(1, allocatedTravellerCount(roomApplyPrompt.roomAllocations) || paxCount);
      const buyPP = round2(roomApplyPrompt.calculatedBuy / currentPax);
      const sellPP = round2(roomApplyPrompt.calculatedSell / currentPax);
      setDays((prev) => prev.map((day) => ({
        ...day,
        services: day.services.map((service) => roomApplyPrompt.related.some((entry) => entry.service.key === service.key)
          ? { ...service, roomAllocations: roomApplyPrompt.roomAllocations, buyPP, sellPP, pax: currentPax, numRooms: roomApplyPrompt.numRooms }
          : service)
      })));
    }
    setRoomApplyPrompt(null);
    showToast(applyToAll ? 'Room allocation applied to all repeated days' : 'Room allocation saved for this day only', 'success');
  }, [roomApplyPrompt, paxCount, showToast, setDays ]);

  /* Who already has a bed that night in another included property. Handed to
     the room modal so a split group only has to bed the travellers who are
     still homeless, instead of every guest being demanded at every property. */
  const roomModalBeddedElsewhere = useMemo(() => {
    const day = days[roomModalState?.dayIndex];
    if (!day) return [];
    const self = (day.services || []).find((sv) => sv.key === roomModalState?.serviceKey);
    /* An alternative is a quote over the SAME party as the confirmed room: the
       beds it mirrors are exactly the beds it has to be able to take, so
       nothing counts as "already housed elsewhere". Excluding them handed the
       dialog an empty traveller pool and made an alternative impossible to
       allocate — the reported failure. */
    if (self?.isOptional) return [];
    const byIdentity = new Map();
    (day.services || []).forEach((sv) => {
      if (sv.key === roomModalState?.serviceKey) return;
      if (!/accommodation/i.test(sv.category || '') || sv.isOptional) return;
      (Array.isArray(sv.roomAllocations) ? sv.roomAllocations : []).forEach((rm) => {
        (rm.allocatedTravellers || []).forEach((tr) => {
          const identity = tr?.id || `${tr?.name || ''}|${tr?.surname || ''}`;
          if (identity && !byIdentity.has(identity)) byIdentity.set(identity, tr);
        });
      });
    });
    return [...byIdentity.values()];
  }, [days, roomModalState?.dayIndex, roomModalState?.serviceKey]);

  /* Patch one or more fields of a single service item (used by the Service
     Request / Travel Documents tabs for time, confirmation status, numbers,
     category details and service-specific notes).

     This is the ONLY write path that stays open while a booking is locked,
     because a Provisional booking cannot be confirmed until the supplier
     results are captured. It writes through setDaysRaw so the itinerary edit
     lock does not reject it; the card still only exposes the operational
     fields (contract/library fields are locked by `contractLocked`). */
  const updateService = useCallback((dayKey, svKey, patch) => {
    if (terminalRef.current) return;
    setDaysRaw((prev) => prev.map((d) => (
      d.key === dayKey
        ? { ...d, services: d.services.map((s) => (s.key === svKey ? { ...s, ...patch } : s)) }
        : d
    )));
  }, [setDaysRaw, terminalRef]);

  /* A service is only ready once its Provisional booking fields are captured:
     time, confirmation number and flight number on every service; vehicle type
     on transfers; check-in / check-out on accommodation. Mirrors the per-service
     OK guard in the Service Request tab. */
  const serviceReady = (sv) => {
const cat = sv.category || '';
if (!sv.confirmationNumber) return false; /* confirmation number: rendered on every category */
if (/transfers?/i.test(cat)) return !!(sv.time && sv.flightNumber && sv.vehicleType);
if (/accommodation/i.test(cat)) return !!(sv.checkInTime && sv.checkOutTime);
return !!sv.time; /* activities / meals / other */
  };

  /* The itinerary stays "Provisional Booking" until every service is confirmed
     (OK) with all required fields — you cannot lock it as Confirmed early. */
  const canConfirmBooking = useCallback(() => {
    const all = (days || []).flatMap((d) => d.services || []);
    if (!all.length) return false;
    return all.every((sv) => (sv.confirmationStatus || 'RQ') === 'OK' && serviceReady(sv));
  }, [days]);

  const handleItemDragStart = useCallback((e, item) => {
    e.dataTransfer.effectAllowed = 'copy';
    e.dataTransfer.setData('text/plain', JSON.stringify({ itemId: item.id }));
  }, []);

  const handleDayDrop = useCallback((dayIndex, e) => {
    if (completedRef.current) return;
    e.preventDefault();
    setIsDragOver(false);
    const raw = e.dataTransfer.getData('text/plain');
    let payload = null;
    try {
      payload = raw ? JSON.parse(raw) : null;
    } catch {
      payload = null;
    }
    if (!payload?.itemId) return;
    const item = libraryItems.find((it) => it.id === payload.itemId);
    if (item) addService(dayIndex, item, 'drop');
  }, [libraryItems, addService]);

  const removeService = useCallback((dayIdx, svcKey) => {
    if (completedRef.current) return;
    setDays((prev) => prev.map((d, i) => (
      i === dayIdx ? { ...d, services: d.services.filter((s) => s.key !== svcKey) } : d
    )));
  }, [setDays]);

  const updateServicePricing = useCallback((dayIdx, svcKey, field, rawValue) => {
    if (completedRef.current) return;
    const num = Number(rawValue);
    const value = Number.isFinite(num) ? num : 0;
    setDays((prev) => prev.map((d, i) => {
      if (i !== dayIdx) return d;
      return {
        ...d,
        services: d.services.map((s) => {
          if (s.key !== svcKey) return s;
          if (field === 'buyPP') {
            const buyPP = round2(value);
            const m = Number(s.markup) || 0;
            return { ...s, buyPP, sellPP: round2(buyPP * (1 + m / 100)) };
          }
          if (field === 'markup') {
            const m = value;
            return { ...s, markup: m, sellPP: round2((Number(s.buyPP) || 0) * (1 + m / 100)) };
          }
          return s;
        })
      };
    }));
  }, [setDays]);

  const moveService = useCallback((dayIdx, fromKey, toKey) => {
    if (completedRef.current) return;
    setDays((prev) => prev.map((d, i) => {
      if (i !== dayIdx) return d;
      const arr = [...d.services];
      const fi = arr.findIndex((s) => s.key === fromKey);
      const ti = arr.findIndex((s) => s.key === toKey);
      if (fi === -1 || ti === -1) return d;
      const [moved] = arr.splice(fi, 1);
      arr.splice(ti, 0, moved);
      return { ...d, services: arr };
    }));
  }, [setDays]);

  const handleServiceDragStart = useCallback((e, dayIdx, svcKey) => {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', JSON.stringify({ type: 'reorder', dayIdx, svcKey }));
  }, []);

  const handleServiceDrop = useCallback((e, dayIdx, targetKey) => {
    e.preventDefault();
    setDragOverKey(null);
    const raw = e.dataTransfer.getData('text/plain');
    let payload = null;
    try {
      payload = raw ? JSON.parse(raw) : null;
    } catch {
      payload = null;
    }
    if (!payload || payload.type !== 'reorder' || payload.svcKey === targetKey) return;
    if (Number(payload.dayIdx) !== dayIdx) return;
    moveService(dayIdx, payload.svcKey, targetKey);
  }, [moveService]);

  const addDay = useCallback(() => {
    if (completedRef.current) return;
    const next = normalizeDays([...days, { key: nextId(), dayNumber: days.length + 1, date: '', notes: '', services: [] }]);
    setDays(next);
    applyDateExtension(next);
    setSelectedDayIndex(days.length);
  }, [days, normalizeDays, applyDateExtension, nextId, setDays ]);

  const duplicateDay = useCallback((idx) => {
    if (completedRef.current) return;
    const src = days[idx];
    if (!src) return;
    const clone = {
      ...src,
      key: nextId(),
      dayNumber: 0,
      date: '',
      services: (src.services || []).map((s) => ({ ...s, key: nextId() }))
    };
    const next = normalizeDays([...days.slice(0, idx + 1), clone, ...days.slice(idx + 1)]);
    setDays(next);
    applyDateExtension(next);
    setSelectedDayIndex(idx + 1);
    setKebabFor(null);
  }, [days, normalizeDays, applyDateExtension, nextId, setDays ]);

  const clearDay = useCallback((idx) => {
    if (completedRef.current) return;
    setDays((prev) => prev.map((d, i) => (i === idx ? { ...d, services: [] } : d)));
    setKebabFor(null);
  }, [setDays]);

  const deleteDay = useCallback((idx) => {
    if (completedRef.current) return;
    if (days.length <= 1) {
      showToast('An itinerary needs at least one day', 'warning');
      return;
    }
    const next = normalizeDays(days.filter((_, i) => i !== idx));
    setDays(next);
    applyDateExtension(next);
    setSelectedDayIndex((prev) => Math.max(0, Math.min(prev, next.length - 1)));
    setKebabFor(null);
  }, [days, normalizeDays, applyDateExtension, showToast, setDays ]);

  /* -- Copy / Export / Save ------------------------------------------------ */

  const openCopy = useCallback(async () => {
    setCopyOpen(true);
    setCopySourceId('');
    setCopyInsertDay(1);
    try {
      const { data } = await supabase
        .from('itineraries')
        .select('id, itinerary_name, reference_number')
        .neq('id', meta.itineraryId || '')
        .order('created_at', { ascending: false });
      setAvailableItineraries(data || []);
    } catch {
      setAvailableItineraries([]);
    }
  }, [meta.itineraryId]);

  const confirmCopy = useCallback(async () => {
    if (completedRef.current) return;
    if (!copySourceId) {
      showToast('Select an itinerary to copy from first', 'warning');
      return;
    }
    const insertIdx = Math.max(0, Math.min((Number(copyInsertDay) || 1) - 1, days.length));
    setSaving(true);
    try {
      const { data: srcDays } = await supabase
        .from('itinerary_days')
        .select('*, itinerary_day_items(*)')
        .eq('itinerary_id', copySourceId)
        .order('day_number', { ascending: true });
      if (!srcDays || !srcDays.length) {
        showToast('That itinerary has no days copied yet', 'warning');
        setSaving(false);
        return;
      }
      const src = srcDays.map((rd) => ({
        key: nextId(),
        dayNumber: 0,
        date: '',
        notes: rd.notes || '',
        services: (rd.itinerary_day_items || []).map((ii) => {
          const mRaw = Number(ii.markup_percentage);
          const m = Number.isFinite(mRaw) ? mRaw : (Number(markupPct) || 0);
          const pricing = storedServicePricing(ii, paxCount, m);
          const ccy = ii.currency_code || currencyCode;
          const taxed = taxAppliesForCurrency(ccy);
          return {
            key: nextId(),
            itemId: ii.item_id || null,
            supplierId: ii.supplier_id || null,
            name: ii.item_name || '',
            category: ii.category || '',
            supplierName: ii.supplier_name || '',
            currencyCode: ccy,
            buyPP: pricing.buyPP,
            markup: m,
            basis: ii.rate_basis || 'per_person',
            sellPP: pricing.sellPP,
            pax: pricing.pax,
            quantity: Number(ii.quantity) || 1,
            descOverride: ii.description_override || '',
            taxRate: taxed ? (Number(ii.tax_rate) > 0 ? numOr(ii.tax_rate, defaultTaxRate) : defaultTaxRate) : 0,
            taxLabel: taxed ? (Number(ii.tax_rate) > 0 ? (ii.tax_label || defaultTaxLabel) : defaultTaxLabel) : 'No VAT',
            time: ii.service_time || '',
              confirmationStatus: ii.confirmation_status || 'RQ',
              confirmationNumber: ii.confirmation_number || '',
              flightNumber: ii.flight_number || '',
              flightTime: ii.flight_time || '',
              vehicleType: ii.vehicle_type || '',
              capacity: ii.capacity !== null && ii.capacity !== undefined ? Number(ii.capacity) : '',
              roomType: ii.room_type || '',
              destinationArea: ii.destination_area || '',
              maxOccupancy: ii.max_occupancy !== null && ii.max_occupancy !== undefined ? Number(ii.max_occupancy) : '',
            roomAllocations: Array.isArray(ii.room_allocations) ? ii.room_allocations : [],
            repeatGroupId: ii.repeat_group_id || null,
            isOptional: ii.is_included === false,
            mealPlan: ii.meal_plan || '',
            checkInTime: ii.check_in_time || '',
            checkOutTime: ii.check_out_time || '',
            startTime: ii.start_time || '',
            endTime: ii.end_time || '',
            notes: ii.notes || ''
          };
        })
      }));
      const merged = [...days.slice(0, insertIdx), ...src, ...days.slice(insertIdx)];
      const next = attachSuppliers(normalizeDays(merged), await fetchSupplierMap(
        merged.flatMap((d) => (d.services || []).map((s) => s.supplierId))
      ));
      setDays(next);
      applyDateExtension(next);
      setSelectedDayIndex(insertIdx);
      setCopyOpen(false);
      const srcName = availableItineraries.find((a) => a.id === copySourceId)?.itinerary_name || 'itinerary';
      showToast(`Copied ${src.length} day(s) from "${srcName}"`, 'success');
    } catch {
      showToast('Failed to copy itinerary days', 'error');
    } finally {
      setSaving(false);
    }
  }, [copySourceId, copyInsertDay, days, currencyCode, markupPct, paxCount, normalizeDays, applyDateExtension, nextId, availableItineraries, showToast, defaultTaxRate, defaultTaxLabel, taxAppliesForCurrency, setDays ]);

  const handleCopy = useCallback(() => {
    if (!meta.itineraryId) {
      showToast('Save the itinerary once before using Copy', 'warning');
      return;
    }
    openCopy();
  }, [meta.itineraryId, openCopy, showToast]);

  const downloadBlob = useCallback((content, filename, type) => {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, []);

  const buildRows = useCallback(() => {
    const rows = [];
    days.forEach((d) => {
      const t = dayTotals(d);
      rows.push({
        day: d.dayNumber,
        date: formatDateLong(d.date),
        svcCount: t.count,
        sell: t.sell,
        tax: t.tax,
        total: t.total
      });
    });
      const grandSell = round2(rows.reduce((a, r) => a + r.sell, 0));
      const grandTax = round2(rows.reduce((a, r) => a + r.tax, 0));
      const grandInTax = round2(rows.reduce((a, r) => a + (r.taxIn || 0), 0));
      const grandNetTax = round2(rows.reduce((a, r) => a + ((r.tax || 0) - (r.taxIn || 0)), 0));
      const grandTotal = round2(rows.reduce((a, r) => a + r.total, 0));
      return { rows, grandSell, grandTax, grandInTax, grandNetTax, grandTotal };
  }, [days, dayTotals]);

  const handleExport = useCallback((format) => {
    setExportOpen(false);
    const allocCheck = validateAllRoomAllocations();
    if (!allocCheck.isValid) {
      showToast(`Room Allocation Error (Day ${allocCheck.dayNumber}): ${allocCheck.reason}`, 'error');
      openRoomAllocationModal(allocCheck.dayIndex, allocCheck.service);
      return;
    }
    const ref = meta.referenceNumber || meta.itineraryName || 'itinerary';
    const safeName = String(ref).replace(/[^\w-]+/g, '_');
    if (format === 'link') {
      if (!['quotation', 'provisional'].includes(stage)) {
        showToast('The client itinerary document is only available for Quotation and Provisional bookings', 'warning');
        return;
      }
      showToast('Digital itinerary link sharing is coming soon', 'info');
      return;
    }
    if ((format === 'word' || format === 'pdf') && !['quotation', 'provisional'].includes(stage)) {
      showToast('The client itinerary document is only available for Quotation and Provisional bookings', 'warning');
      return;
    }

    const groups = pricingGroups.length > 0 ? pricingGroups : [{
      code: currencyCode,
      symbol: currencySymbol,
      name: '',
      days: [],
      totalSell: 0,
      totalTax: 0,
      totalExcl: 0,
      totalInclTax: 0
    }];

    const esc = htmlEscape;
    const taxLabel = defaultTaxLabel || 'VAT';
    const taxRateOf = (ccy) => (taxAppliesForCurrency(ccy) ? defaultTaxRate : 0);
    const showSupplierBase = billing?.show_supplier_in_description !== false;
    const showSupplierOf = (sv) => showSupplierBase || /accommodation/i.test(sv.category || '');
    const showMealPlanBase = billing?.show_meal_plan_on_accommodation !== false;
    const showMealPlanOf = (sv) => showMealPlanBase && /accommodation/i.test(sv.category || '') && !!(sv.mealPlan || '').trim();
    const perPerson = billing?.pricing_breakdown_mode === 'per_person';
    const accomLinesOn = billing?.pricing_breakdown_accommodation === 'rooms';
    /* Day-by-day rows for a currency group. In the default ("Service per day,
       detailed") presentation every service stays on its own line; when
       "Accommodation lines" is set to per-room, each night stop is expanded
       into one line per occupied room (e.g. 2A / 1A / 2A, 1C) with the Qty
       column carrying the occupant summary and the rows reconciled to the
       billed accommodation total. */
    const dayRowsOf = (grp) => {
      const rows = [];
      const travellers = Array.isArray(meta.travellers) ? meta.travellers : [];
      const fallbackChildren = travellers.filter((t) => !isAdultTraveller(t)).length;
      const fallbackAdults = Math.max(0, travellers.length - fallbackChildren) || Math.max(0, paxCount - fallbackChildren);
      (grp.days || []).forEach((r) => {
        (r.services || []).forEach((sv) => {
          if (!accomLinesOn || !/accommodation/i.test(sv.category || '')) {
            rows.push({
              day: r.day,
              date: r.date || '—',
              name: sv.name || 'Service',
              supplierName: sv.supplierName || '',
              category: sv.category || '',
              mealPlan: sv.mealPlan || '',
              qty: paxCount,
              qtyTitle: '',
              qtyText: false,
              unit: round2(sv.unit),
              subExcl: sv.subExcl,
              tax: sv.tax,
              sell: sv.sell
            });
            return;
          }
          const line = Number(sv.sell) || 0;
          const taxRate = numOr(sv.taxRate, defaultTaxRate);
          const item = sv.itemId ? libraryItems.find((x) => String(x.id) === String(sv.itemId)) : null;
          const baseRate = item && item.item_rates && item.item_rates.length
            ? rateForTravel(item, grp.code, travelWindow, priceProtectionPercent)
            : null;
          const rate = baseRate ? { ...baseRate, _ageRanges: item.child_age_ranges || [] } : null;
          const bd = accommodationBreakdown({
            mode: 'rooms',
            lineTotal: line,
            rooms: Array.isArray(sv.roomAllocations) ? sv.roomAllocations : [],
            rate,
            ageRanges: Array.isArray(rate?._ageRanges) ? rate._ageRanges : [],
            markup: Number(sv.markup) || 0,
            taxRate,
            fallbackAdults,
            fallbackChildren
          });
          bd.rows.forEach((brk) => {
            rows.push({
              day: r.day,
              date: r.date || '—',
              name: sv.name || 'Accommodation',
              supplierName: sv.supplierName || '',
              category: sv.category || 'Accommodation',
              mealPlan: sv.mealPlan || '',
              qty: brk.qty,
              qtyTitle: brk.qtyTitle,
              qtyText: true,
              unit: brk.unit,
              subExcl: brk.subExcl,
              tax: brk.tax,
              sell: brk.lineTotal
            });
          });
        });
      });
      return rows;
    };
    /* Optional / alternative services are priced in their own table directly
       under the main breakdown, so the client can see the full cost of adding
       them without them inflating the total due. */
    const optionalRowsOf = (grp) => {
      const rows = [];
      (grp.days || []).forEach((r) => {
        (r.optionalServices || []).forEach((sv) => {
          rows.push({
            day: r.day,
            date: r.date || '—',
            name: sv.name || 'Service',
            supplierName: sv.supplierName || '',
            category: sv.category || '',
            mealPlan: sv.mealPlan || '',
            qty: paxCount,
            unit: round2(sv.unit),
            subExcl: sv.subExcl,
            tax: sv.tax,
            sell: sv.sell
          });
        });
      });
      return rows;
    };
    const optionalSectionHtml = (grp, style) => {
      const rows = optionalRowsOf(grp);
      if (!rows.length) return '';
      const isAcc = (r) => /accommodation/i.test(r.category || '');
      const heading = style === 'pdf'
        ? `<h2 style="color:#0d7478;font-size:16px;margin:20px 0 6px;border-bottom:2px solid #0d7478;padding-bottom:4px;">Optional &amp; Alternative Extras — ${esc(grp.code)} (${esc(grp.symbol)})</h2>`
        : `<h2 style="color:#0d7478;margin-top:16px;margin-bottom:6px;">Optional &amp; Alternative Extras — ${esc(grp.code)} (${esc(grp.symbol)})</h2>`;
      const note = `<p style="color:#666;font-size:12px;margin:0 0 6px;">Not included in the total due. Priced separately so you can add any of these if you choose.</p>`;
      const body = rows.map((r) => `<tr><td>Day ${esc(r.day)}</td><td>${esc(r.date || '—')}</td><td>${rowDescHtml(r, esc)}${isAcc(r) ? ' <em>(alternative)</em>' : ' <em>(optional)</em>'}</td><td>${paxCount}</td><td class="num">${fmtMoney(round2(r.unit), grp.symbol)}</td><td>${fmtMoney(r.subExcl, grp.symbol)}</td><td>${fmtMoney(r.tax, grp.symbol)}</td><td><b>${fmtMoney(r.sell, grp.symbol)}</b></td></tr>`).join('');
      const taxRows = (grp.optionalTaxEntries || []).map((e) => `<tr><td colspan="7" align="right">${esc(e.label)} (${Number(e.rate)}%)</td><td><b>${fmtMoney(e.amount, grp.symbol)}</b></td></tr>`).join('');
      return `${heading}${note}
        <table ${style === 'pdf' ? '' : 'border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse;width:100%;"'}>
          <tr><th>Day</th><th>Date</th><th>Description</th><th>Qty</th><th class="num">Unit</th><th>Subtotal (Excl. ${esc(taxWordOf(grp.code))})</th><th>${esc(taxWordUpper(grp.code))}</th><th>Total (Incl. ${esc(taxWordUpper(grp.code))})</th></tr>
          ${body}
          <tr><td colspan="7" align="right">Subtotal (Excl. ${esc(taxWordOf(grp.code))})</td><td><b>${fmtMoney(grp.optionalTotalExcl, grp.symbol)}</b></td></tr>
          ${taxRows}
          <tr><td colspan="7" align="right"><b>TOTAL IF ALL ADDED (${esc(grp.code)})</b></td><td><b>${fmtMoney(grp.optionalTotalSell, grp.symbol)}</b></td></tr>
        </table>`;
    };
    const rowDescHtml = (r, escFn) => {
      const l = { category: r.category, mealPlan: r.mealPlan, supplierName: r.supplierName };
      const mealTxt = showMealPlanOf(l) ? ` - ${escFn(abbrevMealPlan(r.mealPlan))}` : '';
      const supplierLine = showSupplierOf(l) && r.supplierName
        ? (escFn === esc ? `<br><span style="color:#666;font-size:12px;">${escFn(r.supplierName)}</span>` : `<br><span class="muted">${escFn(r.supplierName)}</span>`)
        : '';
      return `${escFn(r.name)}${mealTxt}${supplierLine}`;
    };
    const rowDesc = (r) => {
      const l = { category: r.category, mealPlan: r.mealPlan, supplierName: r.supplierName };
      const mealTxt = showMealPlanOf(l) ? ` - ${abbrevMealPlan(r.mealPlan)}` : '';
      return showSupplierOf(l) && r.supplierName
        ? `${r.name}${mealTxt} — ${r.supplierName}`
        : `${r.name}${mealTxt}`;
    };
    const logoAlign = billing?.logo_position === 'center' ? 'margin:0 auto 8px' : (billing?.logo_position === 'right' ? 'margin:0 0 8px auto' : 'margin:0 0 8px');
    const logoImgTag = billing?.logo_data_url
      ? `<img src="${billing.logo_data_url}" alt="Company logo" style="display:block;max-width:${LOGO_WIDTHS[billing.logo_size] || LOGO_WIDTHS.md}px;height:auto;${logoAlign}">`
      : '';
    const hdrAlign = billing?.billing_address_position === 'center' ? 'text-align:center' : (billing?.billing_address_position === 'right' ? 'text-align:right' : 'text-align:left');
    const hdrLegal = billing?.legal_name ? `<div style="${hdrAlign}"><b>${esc(billing.legal_name)}</b></div>` : '';
    /* Company address plus the tenant contact lines (Tel / Email / Website) from
       the company profile, mirroring the Bill-from block on invoices, receipts
       and credit notes. Kept in one wrapper so the 32px gap below the company
       details stays where it was. */
    const hdrAddressLine = billing?.billing_address
      ? `<div style="color:#666;font-size:12px;">${esc(billing.billing_address).replace(/\n/g, '<br>')}</div>`
      : '';
    const hdrContactLine = (label, value) => (value
      ? `<div>${esc(label)}: ${esc(value)}</div>`
      : '');
    const coTel = String(billing?.contact_tel || '').trim();
    const coCell = String(billing?.contact_cell || '').trim();
    const hdrContact = [
      hdrContactLine('Tel', [coTel, coCell].filter(Boolean).join(' · ')),
      hdrContactLine('Email', String(billing?.contact_email || '').trim()),
      hdrContactLine('Web', String(billing?.contact_website || '').trim())
    ].join('');
    const hdrContactBlock = hdrContact ? `<div style="color:#666;font-size:12px;">${hdrContact}</div>` : '';
    const hdrAddress = (hdrAddressLine || hdrContactBlock)
      ? `<div style="${hdrAlign};margin-bottom:32px;">${hdrAddressLine}${hdrContactBlock}</div>`
      : '';
    const designer = meta.consultantName ? esc(meta.consultantName) : '—';
    const travellersList = (meta.travellers || []).map((tr) => travellerName(tr)).filter(Boolean);
    /* Names plus each traveller's note. Shared by the Word and PDF itinerary
       exports so both carry the same traveller notes as the voucher documents —
       a note recorded on the Client form must not stop at the email. */
    const travellersHtml = (() => {
      const list = (meta.travellers || []).filter((tr) => travellerName(tr));
      if (!list.length) return '';
      return `<p style="margin:2px 0;">${list.map((tr) => {
        const note = (tr.notes || '').trim();
        return esc(travellerName(tr)) + (note
          ? `<br><span style="color:#475569;font-size:0.9em;">Note: ${esc(note)}</span>`
          : '');
      }).join('<br>')}</p>`;
    })();
    const paxWord = paxCount > 0 ? `${paxCount} traveller${paxCount === 1 ? '' : 's'}` : '—';

    /* Client Bill-To block on the itinerary document: optional logo, name,
       address and the client's contact details (Tel / Cell / Email / Website),
       mirroring the Bill-To box on invoices, receipts and credit notes. */
    const clientBlockHtml = (() => {
      const cl = meta.client || {};
      const align = billing?.client_billing_address_position === 'center'
        ? 'text-align:center'
        : (billing?.client_billing_address_position === 'right' ? 'text-align:right' : 'text-align:left');
      const logoW = LOGO_WIDTHS[billing?.client_logo_size] || LOGO_WIDTHS.md;
      const logoPos = billing?.client_logo_position || 'left';
      const logoAlign = logoPos === 'center' ? 'margin:0 auto 8px' : (logoPos === 'right' ? 'margin:0 0 8px auto' : 'margin:0 0 8px');
      const logo = cl.logo_data_url
        ? `<img src="${cl.logo_data_url}" alt="Client logo" style="display:block;max-width:${logoW}px;height:auto;${logoAlign}">`
        : '';
      const name = cl.name ? `<div style="font-weight:700;">${esc(cl.name)}</div>` : '';
      const addr = cl.address ? `<div style="color:#666;font-size:12px;">${esc(cl.address).replace(/\n/g, '<br>')}</div>` : '';
      const line = (label, value) => (value
        ? `<div style="color:#666;font-size:12px;">${esc(label)}: ${esc(value)}</div>`
        : '');
      const contact = [
        line('Tel', String(cl.contact_tel || '').trim()),
        line('Cell', String(cl.contact_cell || '').trim()),
        line('Email', String(cl.email || cl.contact_email || '').trim()),
        line('Website', String(cl.contact_website || '').trim())
      ].join('');
      return (logo || name || addr || contact)
        ? `<div style="${align};margin-bottom:20px;">${logo}${name}${addr}${contact}</div>`
        : '';
    })();

    /* Day-by-day routing: per-day description plus every service on the day
       rendered as a bullet. Non-accommodation shows "Service type: Service name".
       Accommodation shows "Accommodation: Supplier, Meal plan" (abbreviated),
       which is always shown regardless of the line-item toggle. When a day has
       more than one accommodation at the same supplier (e.g. two room types),
       the service name is added so the lines stay distinguishable. */
    const dayByDayHtml = () => {
      const list = (days || []).map((d, i) => {
        const num = d.dayNumber || i + 1;
        const date = d.date ? formatDateLong(d.date) : '';
        const desc = (d.notes || '').trim();
        const services = d.services || [];
        /* Count how many accommodation entries share each supplier on this day. */
        const supplierUse = new Map();
        services.forEach((sv) => {
          if (!/accommodation/i.test(String(sv.category || ''))) return;
          const key = String(sv.supplierName || sv.supplier_name || '').trim().toLowerCase();
          if (!key) return;
          supplierUse.set(key, (supplierUse.get(key) || 0) + 1);
        });
        const itemLines = services.map((sv) => {
          const name = String(sv.name || '').trim() || 'Service';
          const category = String(sv.category || '').trim();
          const supplier = String(sv.supplierName || sv.supplier_name || '').trim();
          const meal = String(sv.mealPlan || '').trim();
          /* Optional / alternative services are badged in the routing so the
             client can see at a glance they are not part of the confirmed
             itinerary. */
          const badge = sv.isOptional
            ? ` <span style="color:#b45309;font-size:12px;font-style:italic;">(${isAccommodationItem(sv) ? 'alternative' : 'optional'} - not included)</span>`
            : '';
          if (/accommodation/i.test(category)) {
            const shared = supplier
              ? (supplierUse.get(supplier.toLowerCase()) || 0) > 1
              : false;
            const head = shared && supplier ? `${supplier}, ${name}` : (supplier || name);
            return `<strong>Accommodation</strong>: ${esc(head)}${meal ? `, ${esc(abbrevMealPlan(meal))}` : ''}${badge}`;
          }
          return `<strong>${esc(category || 'Service')}</strong>: ${esc(name)}${badge}`;
        }).filter(Boolean);
        return `<div style="margin:0 0 14px;">
          <div style="background:#eee;font-weight:700;color:#0d7478;padding:6px 10px;">Day ${num}${date ? ` &mdash; ${esc(date)}` : ''}</div>
          ${desc ? `<div style="margin:4px 0;padding:0 2px;">${esc(desc).replace(/\n/g, '<br>')}</div>` : ''}
          ${itemLines.length ? `<ul style="margin:4px 0;padding:0 2px 0 20px;list-style-type:disc;">${itemLines.map((l) => `<li style="margin:0 0 2px;">${l}</li>`).join('')}</ul>` : ''}
        </div>`;
      }).join('');
      return `<h2 style="color:#0d7478;margin-top:20px;margin-bottom:28px;text-align:center;">Itinerary</h2>${list || '<p>No days added yet.</p>'}`;
    };

    /* Dynamic Inclusions list, generated from the day items themselves because
       every itinerary is different.
         * Accommodation is listed as "Type: Supplier - Meal Plan" (full meal
           plan wording, not abbreviated).
         * Every other service is listed as "Type: Service name".
         * Identical entries are collapsed and prefixed with the total quantity
           (how many times it was added across the itinerary).
       The tenant's default Inclusions text (if enabled in Settings) shows above
       this list. */
    const dynamicInclusions = (() => {
      const byKey = new Map();
      (days || []).forEach((d) => {
        (d?.services || []).forEach((sv) => {
          /* Optional / alternative services are not part of the itinerary, so
             they must not be advertised as inclusions. */
          if (sv?.isOptional) return;
          const type = String(sv?.category || '').trim();
          const name = String(sv?.name || '').trim();
          const supplier = String(sv?.supplierName || sv?.supplier_name || '').trim();
          const meal = String(sv?.mealPlan || '').trim();
          const qty = Math.max(1, Number(sv?.qty) || 1);
          if (!type && !name) return;

          let label;
          if (/accommodation/i.test(type) || /accommodation/i.test(name)) {
            // Accommodation: Supplier - Meal Plan (meal plan shown in full).
            const head = [type || 'Accommodation', supplier || name].filter(Boolean).join(': ');
            label = meal ? `${head} - ${meal}` : head;
          } else {
            label = type && name ? `${type}: ${name}` : (name || type);
          }

          const key = label.toLowerCase();
          if (byKey.has(key)) byKey.get(key).qty += qty;
          else byKey.set(key, { label, qty });
        });
      });
      return [...byKey.values()];
    })();
    const dynamicInclusionsHtml = dynamicInclusions.length
      ? `<ul style="margin:6px 0 0;padding-left:0;list-style:none;">${dynamicInclusions.map((r) => `<li style="margin:2px 0;">&#10003; ${r.qty > 1 ? `${r.qty} x ` : ''}${esc(r.label)}</li>`).join('')}</ul>`
      : '';

    /* Whether the tenant's typed default Inclusions text is printed above the
       generated list (Settings > Itinerary Presentation). It is rendered as a
       ticked list so it matches the generated content below it. */
    const includeDefaultInclusions = billing?.itinerary_include_default_inclusions !== false;
    const defaultInclusionItems = (() => {
      const raw = includeDefaultInclusions ? String(billing?.itinerary_inclusions || '') : '';
      return raw
        .split(/\r?\n/)
        .map((s) => s.replace(/^\s*[-*•–—]\s*/, '').trim())
        .filter(Boolean);
    })();
    const defaultInclusionsHtml = defaultInclusionItems.length
      ? `<ul style="margin:0 0 8px;padding-left:0;list-style:none;">${defaultInclusionItems.map((s) => `<li style="margin:2px 0;">&#10003; ${esc(s)}</li>`).join('')}</ul>`
      : '';

    /* Optional Terms / Inclusions / Exclusions text blocks, each placed after the
       day-by-day routing, before the pricing breakdown or after it. The
       Inclusions block always renders (it carries the generated service list),
       even when the tenant has typed no default wording. */
    const itineraryBlocks = [
      { title: 'Terms & Conditions', text: billing?.itinerary_terms || '', position: billing?.itinerary_terms_position || 'under_day_by_day' },
      { title: 'Inclusions', text: '', position: billing?.itinerary_inclusions_position || 'under_day_by_day', extraHtml: defaultInclusionsHtml + dynamicInclusionsHtml },
      { title: 'Exclusions', text: billing?.itinerary_exclusions || '', position: billing?.itinerary_exclusions_position || 'under_day_by_day' }
    ].filter((b) => (b.text || '').trim() || (b.extraHtml || ''));
    const itineraryBlockHtml = (b) => {
      const text = (b.text || '').trim() ? `<div style="white-space:pre-line;">${esc(b.text)}</div>` : '';
      return `<h2 style="color:#0d7478;margin-top:20px;margin-bottom:8px;">${esc(b.title)}</h2>${text}${b.extraHtml || ''}`;
    };
    /* Assembles pricing + day-by-day + text blocks in the configured order. */
    const composeItineraryHtml = (pricingHtml) => {
      const under = itineraryBlocks.filter((b) => (b.position || 'under_day_by_day') === 'under_day_by_day').map(itineraryBlockHtml).join('');
      const before = itineraryBlocks.filter((b) => b.position === 'before_pricing').map(itineraryBlockHtml).join('');
      const after = itineraryBlocks.filter((b) => b.position === 'after_pricing').map(itineraryBlockHtml).join('');
      const pricingFirst = (billing?.itinerary_pricing_position || 'above') !== 'below';
      return pricingFirst
        ? `${before}${pricingHtml}${after}${dayByDayHtml()}${under}`
        : `${dayByDayHtml()}${under}${before}${pricingHtml}${after}`;
    };

    const ppData = (() => {
      const m = new Map();
      groups.forEach((g) => m.set(g.code, computePerPerson(days, g.code, meta.travellers || [], libraryItems, { defaultTaxRate, paxCount, travelWindow, protectionPercent: priceProtectionPercent })));
      return m;
    })();
    const ppRows = (g) => {
      const ppd = ppData.get(g.code);
      const rows = [
        ['All', ppDateRange(g), 'Per person sharing', 1, round2(ppd.perPersonSharing.sell), round2(ppd.perPersonSharing.subExcl), round2(ppd.perPersonSharing.tax), round2(ppd.perPersonSharing.sell)]
      ];
      if (ppd.hasSingle) rows.push(['', '', 'Single supplement', 1, round2(ppd.singleSupplement.sell), round2(ppd.singleSupplement.subExcl), round2(ppd.singleSupplement.tax), round2(ppd.singleSupplement.sell)]);
      if (ppd.hasChildren && ppd.perChild) rows.push(['', '', 'Per child', 1, round2(ppd.perChild.sell), round2(ppd.perChild.subExcl), round2(ppd.perChild.tax), round2(ppd.perChild.sell)]);
      return rows;
    };
    const ppRowHtml = (g, r, pdf) => {
      const num = (v) => fmtMoney(round2(v), g.symbol);
      const n = pdf ? ' class="num"' : '';
      return `<tr><td>${esc(r.day)}</td><td>${esc(r.date)}</td><td>${esc(r.label)}</td><td${n}>1</td><td class="num">${num(r.unit)}</td><td${n}>${num(r.subExcl)}</td><td${n}>${num(r.tax)}</td><td${n}><b>${num(r.incl)}</b></td></tr>`;
    };
    const ppRowsHtml = (g, pdf) => {
      const ppd = ppData.get(g.code);
      const rows = [ppRowHtml(g, { day: 'All', date: ppDateRange(g), label: 'Per person sharing', unit: ppd.perPersonSharing.sell, subExcl: ppd.perPersonSharing.subExcl, tax: ppd.perPersonSharing.tax, incl: ppd.perPersonSharing.sell }, pdf)];
      if (ppd.hasSingle) rows.push(ppRowHtml(g, { day: '', date: '', label: 'Single supplement', unit: ppd.singleSupplement.sell, subExcl: ppd.singleSupplement.subExcl, tax: ppd.singleSupplement.tax, incl: ppd.singleSupplement.sell }, pdf));
      if (ppd.hasChildren && ppd.perChild) rows.push(ppRowHtml(g, { day: '', date: '', label: 'Per child', unit: ppd.perChild.sell, subExcl: ppd.perChild.subExcl, tax: ppd.perChild.tax, incl: ppd.perChild.sell }, pdf));
      return rows.join('');
    };

    if (format === 'excel') {
      const lines = [
        `"Itinerary: ${csvEscape(meta.itineraryName)}"`,
        `"Reference: ${csvEscape(meta.referenceNumber || '')}"`,
        `"Tour Designer: ${csvEscape(meta.consultantName || '')}"`,
        `"Client: ${csvEscape(meta.client?.name || '')}"`,
        `"Dates: ${csvEscape(meta.travelStart)} to ${csvEscape(meta.travelEnd)}"`,
        `"Status: ${csvEscape(statusLabelOf(meta.status))}"`,
        `"Travellers: ${paxWord}"`,
        ...travellersList.map((n) => csvEscape(n)),
        ''
      ];

      groups.forEach((grp, idx) => {
        if (idx > 0) lines.push('');
        lines.push(`"Currency: ${csvEscape(grp.code)} (${csvEscape(grp.symbol)})${grp.name ? ` - ${csvEscape(grp.name)}` : ''}"`);
        const header = ['Day', 'Date', 'Description', 'Qty', 'Unit', `Subtotal (Excl. ${taxWordOf(grp.code)})`, taxWordUpper(grp.code), `Total (Incl. ${taxWordUpper(grp.code)})`].map(csvEscape).join(',');
        lines.push(header);
        if (perPerson) {
          ppRows(grp).forEach((r) => lines.push(r.map(csvEscape).join(',')));
        } else {
          dayRowsOf(grp).forEach((r) => lines.push([`Day ${r.day}`, r.date, rowDesc(r), r.qty, round2(r.unit), r.subExcl, r.tax, r.sell].map(csvEscape).join(',')));
        }
        lines.push([`Subtotal (Excl. ${taxWordOf(grp.code)})`, '', '', '', '', '', '', grp.totalExcl].map(csvEscape).join(','));
        lines.push([`${taxWordUpper(grp.code)} (${taxDisplayLabel(grp.code, taxLabel, taxRateOf(grp.code))} ${taxRateOf(grp.code)}%)`, '', '', '', '', '', '', grp.totalTax].map(csvEscape).join(','));
        lines.push([`TOTAL DUE (${grp.code} INCL. ${taxWordUpper(grp.code)})`, '', '', '', '', '', '', grp.totalInclTax].map(csvEscape).join(','));
        const optRows = optionalRowsOf(grp);
        if (optRows.length) {
          lines.push('');
          lines.push([`Optional & Alternative Extras (${grp.code}) - not included in the total due`].map(csvEscape).join(','));
          lines.push(header);
          optRows.forEach((r) => lines.push([`Day ${r.day}`, r.date, `${rowDesc(r)}${/accommodation/i.test(r.category || '') ? ' (alternative)' : ' (optional)'}`, r.qty, round2(r.unit), r.subExcl, r.tax, r.sell].map(csvEscape).join(',')));
          lines.push([`Subtotal (Excl. ${taxWordOf(grp.code)})`, '', '', '', '', '', '', grp.optionalTotalExcl].map(csvEscape).join(','));
          (grp.optionalTaxEntries || []).forEach((e) => lines.push([`${e.label} (${Number(e.rate)}%)`, '', '', '', '', '', '', e.amount].map(csvEscape).join(',')));
          lines.push([`TOTAL IF ALL ADDED (${grp.code})`, '', '', '', '', '', '', grp.optionalTotalSell].map(csvEscape).join(','));
        }
      });

      downloadBlob(lines.join('\n'), `${safeName}.csv`, 'text/csv;charset=utf-8');
      showToast('Itinerary exported as Excel (CSV)', 'success');
      return;
    }

    if (format === 'word') {
      const sectionsHtml = groups.map((grp) => `
        <h2 style="color:#0d7478;margin-top:20px;margin-bottom:8px;">Pricing Breakdown — ${esc(grp.code)} (${esc(grp.symbol)}${grp.name ? ` - ${esc(grp.name)}` : ''})</h2>
        <table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse;width:100%;">
          <tr><th>Day</th><th>Date</th><th>Description</th><th>Qty</th><th class="num">Unit</th><th>Subtotal (Excl. ${esc(taxWordOf(grp.code))})</th><th>${esc(taxWordUpper(grp.code))}</th><th>Total (Incl. ${esc(taxWordUpper(grp.code))})</th></tr>
          ${perPerson
            ? ppRowsHtml(grp, false)
            : dayRowsOf(grp).map((r) => `<tr><td>Day ${esc(r.day)}</td><td>${esc(r.date || '—')}</td><td>${rowDescHtml(r, esc)}</td><td${r.qtyText ? ` title="${esc(r.qtyTitle)}"` : ''}>${esc(r.qty)}</td><td class="num">${fmtMoney(round2(r.unit), grp.symbol)}</td><td>${fmtMoney(r.subExcl, grp.symbol)}</td><td>${fmtMoney(r.tax, grp.symbol)}</td><td>${fmtMoney(r.sell, grp.symbol)}</td></tr>`).join('')}
          <tr><td colspan="7" align="right">Subtotal (Excl. ${esc(taxWordOf(grp.code))})</td><td><b>${fmtMoney(grp.totalExcl, grp.symbol)}</b></td></tr>
          <tr><td colspan="7" align="right">${esc(taxWordUpper(grp.code))} (${esc(taxDisplayLabel(grp.code, taxLabel, taxRateOf(grp.code)))} ${taxRateOf(grp.code)}%)</td><td><b>${fmtMoney(grp.totalTax, grp.symbol)}</b></td></tr>
          <tr><td colspan="7" align="right"><b>TOTAL DUE (${esc(grp.code)} INCL. ${esc(taxWordUpper(grp.code))})</b></td><td><b>${fmtMoney(grp.totalInclTax, grp.symbol)}</b></td></tr>
        </table>
        ${optionalSectionHtml(grp, 'word')}
      `).join('');

      const body = `
        ${logoImgTag}
        ${hdrLegal}
        ${hdrAddress}
        <h1>${esc(meta.itineraryName)}</h1>
        <p style="margin:2px 0;"><b>Reference:</b> ${esc(meta.referenceNumber || '—')}</p>
        <p style="margin:2px 0;"><b>Tour Designer:</b> ${designer}</p>
        <p style="margin:2px 0;"><b>Client:</b> ${esc(meta.client?.name || '—')}</p>
        <p style="margin:2px 0;"><b>Dates:</b> ${esc(meta.travelStart)} &rarr; ${esc(meta.travelEnd)}</p>
        <p style="margin:2px 0;"><b>Status:</b> ${esc(statusLabelOf(meta.status))}</p>
        <p style="margin:2px 0 10px;"><b>Travellers:</b> ${paxWord}</p>
        ${travellersHtml}
        ${clientBlockHtml}
        ${composeItineraryHtml(sectionsHtml)}
        <p style="margin-top:24px;"><i>Generated by torbuilder</i></p>`;

      downloadBlob(`<html><head><meta charset="utf-8"></head><body>${body}</body></html>`, `${safeName}.doc`, 'application/msword');
      showToast('Itinerary exported as Word', 'success');
      return;
    }

    if (format === 'pdf') {
      const w = window.open('', '_blank', 'width=900,height=700');
      if (!w) {
        showToast('Please allow pop-ups to export the PDF', 'warning');
        return;
      }

      const sectionsHtml = groups.map((grp) => `
        <h2 style="color:#0d7478;font-size:16px;margin:24px 0 8px;border-bottom:2px solid #0d7478;padding-bottom:4px;">Pricing Breakdown — ${esc(grp.code)} (${esc(grp.symbol)}${grp.name ? ` - ${esc(grp.name)}` : ''})</h2>
        <table>
          <tr><th>Day</th><th>Date</th><th>Description</th><th class="num">Qty</th><th class="num">Unit</th><th>Subtotal (Excl. ${esc(taxWordOf(grp.code))})</th><th>${esc(taxWordUpper(grp.code))}</th><th>Total (Incl. ${esc(taxWordUpper(grp.code))})</th></tr>
          ${perPerson
            ? ppRowsHtml(grp, true)
            : dayRowsOf(grp).map((r) => `<tr><td>Day ${esc(r.day)}</td><td>${esc(r.date || '—')}</td><td>${rowDescHtml(r, esc)}</td><td${r.qtyText ? ` title="${esc(r.qtyTitle)}"` : ''}${r.qtyText ? ' style="text-align:left;"' : ' class="num"'}>${esc(r.qty)}</td><td class="num">${fmtMoney(round2(r.unit), grp.symbol)}</td><td class="num">${fmtMoney(r.subExcl, grp.symbol)}</td><td class="num">${fmtMoney(r.tax, grp.symbol)}</td><td class="num">${fmtMoney(r.sell, grp.symbol)}</td></tr>`).join('')}
          <tr class="grand"><td colspan="7" align="right">Subtotal (Excl. ${esc(taxWordOf(grp.code))})</td><td class="num">${fmtMoney(grp.totalExcl, grp.symbol)}</td></tr>
          <tr class="grand"><td colspan="7" align="right">${esc(taxWordUpper(grp.code))} (${esc(taxDisplayLabel(grp.code, taxLabel, taxRateOf(grp.code)))} ${taxRateOf(grp.code)}%)</td><td class="num">${fmtMoney(grp.totalTax, grp.symbol)}</td></tr>
          <tr class="grand"><td colspan="7" align="right">TOTAL DUE (${esc(grp.code)} INCL. ${esc(taxWordUpper(grp.code))})</td><td class="num">${fmtMoney(grp.totalInclTax, grp.symbol)}</td></tr>
        </table>
        ${optionalSectionHtml(grp, 'pdf')}
      `).join('');

      w.document.write(`<!doctype html><html><head><title>${esc(meta.itineraryName)}</title><style>
        body{font-family:Arial,sans-serif;margin:32px;color:#111}
        h1{margin:0 0 6px} .muted{color:#666;font-size:13px;margin:2px 0}
        table{border-collapse:collapse;width:100%;margin-top:16px}
        th,td{border:1px solid #ccc;padding:6px 10px;text-align:left;font-size:13px}
        th{background:#eee} .grand{font-weight:700} td.num{text-align:right}</style></head><body>
        ${logoImgTag}
        ${hdrLegal}
        ${hdrAddress}
        <h1>${esc(meta.itineraryName)}</h1>
        <p class="muted"><b>Reference:</b> ${esc(meta.referenceNumber || '—')}</p>
        <p class="muted"><b>Tour Designer:</b> ${designer}</p>
        <p class="muted"><b>Client:</b> ${esc(meta.client?.name || '—')}</p>
        <p class="muted"><b>Dates:</b> ${esc(meta.travelStart)} &rarr; ${esc(meta.travelEnd)}</p>
        <p class="muted"><b>Status:</b> ${esc(statusLabelOf(meta.status))}</p>
        <p class="muted" style="margin-bottom:10px;"><b>Travellers:</b> ${paxWord}</p>
        ${travellersHtml}
        ${clientBlockHtml}
        ${composeItineraryHtml(sectionsHtml)}
        <p class="muted" style="margin-top:24px;"><i>Generated by torbuilder</i></p>
        </body></html>`);
      w.document.close();
      w.focus();
      setTimeout(() => w.print(), 350);
      showToast('Itinerary PDF opened in a new window', 'success');
    }
  }, [meta, days, paxCount, pricingGroups, currencyCode, currencySymbol, defaultTaxLabel, defaultTaxRate, downloadBlob, showToast, billing, travelWindow, priceProtectionPercent]);

  const handleSave = useCallback(async () => {
    if (!companyId) {
      showToast('Company not found', 'error');
      return false;
    }
    /* Saving rewrites the days wholesale (delete + re-insert), so an empty
       in-memory `days` is never something to persist:
         - on an itinerary that already has days stored it would destroy them;
         - on a new itinerary it writes a header with no days at all, which is
           how a booking can end up "saved" yet empty.
       Refuse both, and say which case it is. */
    if (days.length === 0) {
      if (meta.itineraryId) {
        const { count } = await supabase
          .from('itinerary_days')
          .select('id', { count: 'exact', head: true })
          .eq('itinerary_id', meta.itineraryId);
        if (count) {
          showToast('This itinerary already has saved days, but none are loaded. Reload the page before saving so nothing is lost.', 'error');
          return false;
        }
      }
      showToast('Add at least one day before saving this itinerary.', 'warning');
      return false;
    }
    const allocCheck = validateAllRoomAllocations();
    if (!allocCheck.isValid) {
      showToast(`Room Allocation Guardrail (Day ${allocCheck.dayNumber}): ${allocCheck.reason}`, 'error');
      openRoomAllocationModal(allocCheck.dayIndex, allocCheck.service);
      setSaving(false);
      return false;
    }
    setSaving(true);
    try {
      const finalStart = toISODate(meta.travelStart);
      const finalEnd = toISODate(meta.travelEnd) || finalStart;
      const fallbackConsultant = await getLoggedInUserName();
      const finalConsultant = meta.consultantName || fallbackConsultant || null;
      /* Travellers and their notes are only ever entered on the Client form, so an
         empty list here means the working copy never loaded them — it is never a
         deliberate deletion (there is no UI for one). Persisting it would wipe every
         traveller and note on the record, so fall back to what is stored. */
      let travellersToSave = Array.isArray(meta.travellers) ? meta.travellers : [];
      if (travellersToSave.length === 0 && meta.itineraryId) {
        const { data: stored } = await supabase
          .from('itineraries')
          .select('travellers')
          .eq('id', meta.itineraryId)
          .maybeSingle();
        const storedTravellers = Array.isArray(stored?.travellers) ? stored.travellers : [];
        if (storedTravellers.length > 0) {
          travellersToSave = storedTravellers;
          setMeta((prev) => ({ ...prev, travellers: storedTravellers }));
        }
      }
      const headerPayload = {
        itinerary_name: meta.itineraryName,
        travel_start_date: finalStart || null,
        travel_end_date: finalEnd || null,
        num_adults: Number(meta.numAdults) || 0,
        num_children: Number(meta.numChildren) || 0,
        travellers: travellersToSave,
        agency_reference: meta.agencyRef || null,
        notes: meta.notes || null,
        status: normaliseStatus(meta.status),
        itinerary_tour_type: meta.tourType || null,
        consultant_name: finalConsultant
      };
      let id = meta.itineraryId;
      let persistedMeta = meta;
      if (!id) {
        const { data: ref, error: refErr } = await supabase
          .rpc('get_next_itinerary_reference', { p_company_id: companyId });
        if (!ref || refErr) throw new Error(refErr?.message || 'Could not allocate itinerary reference');
        const { data: created, error } = await supabase
          .from('itineraries')
          .insert([{
            ...headerPayload,
            company_id: companyId,
            client_id: meta.client?.id || null,
            reference_number: ref,
            currency_code: currencyCode
          }])
          .select()
          .single();
        if (error) throw error;
        id = created.id;
        persistedMeta = { ...meta, itineraryId: id, referenceNumber: ref };
        setMeta((prev) => ({ ...prev, itineraryId: id, referenceNumber: ref }));
      } else {
        const { error: upErr } = await supabase
          .from('itineraries')
          .update(headerPayload)
          .eq('id', id);
        if (upErr) throw upErr;
      }
      lastItineraryIdRef.current = id;

      const { error: delErr } = await supabase
        .from('itinerary_days')
        .delete()
        .eq('itinerary_id', id);
      if (delErr) throw delErr;

      for (let di = 0; di < days.length; di += 1) {
        const day = days[di];
        const { data: newDay, error: dayErr } = await supabase
          .from('itinerary_days')
          .insert([{
            itinerary_id: id,
            company_id: companyId,
            day_number: day.dayNumber,
            day_date: day.date || null,
            notes: day.notes || null
          }])
          .select()
          .single();
        if (dayErr) throw dayErr;
        const svcRows = (day.services || []).map((s, si) => ({
          itinerary_day_id: newDay.id,
          company_id: companyId,
          item_id: s.itemId || null,
          source_package_id: s.packageId || null,
          package_snapshot: s.packageSnapshot || null,
          supplier_id: s.supplierId || s.supplier_id || null,
          item_name: s.name,
          description_override: s.descOverride || null,
          category: s.category || null,
          supplier_name: s.supplierName || null,
          currency_code: s.currencyCode || currencyCode,
          unit_cost: s.buyPP || 0,
          unit_price: s.sellPP || 0,
          markup_percentage: Number(s.markup) || 0,
          rate_basis: s.basis || 'per_person',
          item_price_per_person: s.sellPP || 0,
          quantity: s.quantity || 1,
          pax: paxForService(s, paxCount),
          total_buy: round2((s.buyPP || 0) * paxForService(s, paxCount)),
          total_sell: round2((s.sellPP || 0) * paxForService(s, paxCount)),
          tax_rate: numOr(s.taxRate, 15),
          tax_label: s.taxLabel || 'VAT',
          service_time: s.time || null,
          confirmation_status: s.confirmationStatus || 'RQ',
          confirmation_number: s.confirmationNumber || null,
          flight_number: s.flightNumber || null,
          flight_time: s.flightTime || null,
          vehicle_type: s.vehicleType || null,
          capacity: s.capacity !== '' && s.capacity !== null && s.capacity !== undefined ? Number(s.capacity) : null,
          room_type: s.roomType || null,
          destination_area: s.destinationArea || null,
          max_occupancy: s.maxOccupancy !== '' && s.maxOccupancy !== null && s.maxOccupancy !== undefined ? Number(s.maxOccupancy) : null,
          room_allocations: Array.isArray(s.roomAllocations) ? s.roomAllocations : [],
          repeat_group_id: s.repeatGroupId || null,
          split_group_id: s.splitGroupId || null,
          /* Surcharge attributes, so a reloaded line still knows what kind of
             fee it is, whether it was chargeable, how many times it repeated
             and which accommodation it belongs to - all of which change what
             the line is worth and how it prints. */
          surcharge_type: s.surchargeType || null,
          surcharge_charge_basis: s.surchargeChargeBasis || null,
          surcharge_unit_basis: s.surchargeUnitBasis || null,
          surcharge_chargeable: s.surchargeChargeable === false ? false : (s.surchargeChargeable === true ? true : null),
          surcharge_repeats: Math.max(1, parseInt(s.surchargeRepeats, 10) || 1),
          surcharge_passed_through: !!s.surchargePassedThrough,
          /* The supplier figure for a fee that is shown but not billed, so the
             reference is still readable after a reload. */
          surcharge_reference: Number(s.surchargeReference) || 0,
          linked_item_id: s.linkedItemId || null,
          price_protection_percent: Number(s.priceProtectionPercent) || 0,
          supplier_paid: !!s.supplierPaid,
          supplier_paid_at: s.supplierPaid ? (s.supplierPaidAt || new Date().toISOString()) : null,
          /* The POP reference survives unticking "paid": the supplier invoice
             number stays on file even while the payment is queried. */
          supplier_paid_ref: s.supplierPaidRef || null,
          meal_plan: s.mealPlan || null,
          check_in_time: s.checkInTime || null,
          check_out_time: s.checkOutTime || null,
          start_time: s.startTime || null,
          end_time: s.endTime || null,
          notes: s.notes || null,
          is_included: !s.isOptional,
          sort_order: si
        }));
        if (svcRows.length) {
          const { data: insertedRows, error: itemsErr } = await supabase
            .from('itinerary_day_items')
            .insert(svcRows)
            .select('id, sort_order');
          if (itemsErr) throw itemsErr;
          /* Remember which row each service landed in, so operational flags that
             change mid-trip (supplier paid + proof of payment) can be written to
             that one row instead of rewriting the whole itinerary. */
          if (Array.isArray(insertedRows) && insertedRows.length) {
            const byOrder = new Map(insertedRows.map((row) => [Number(row.sort_order), row.id]));
            setDays((prev) => prev.map((d) => ({
              ...d,
              services: d.services.map((s, si) => (
                byOrder.has(si) ? { ...s, dbId: byOrder.get(si) } : s
              ))
            })));
          }
        }
      }
      setSaved(true);
      showToast('Itinerary saved', 'success');
      setLastSavedKey(JSON.stringify({ days, meta: persistedMeta }));
      return true;
    } catch (err) {
      showToast(err.message || 'Failed to save itinerary', 'error');
      return false;
    } finally {
      setSaving(false);
    }
  }, [companyId, meta, currencyCode, days, paxCount, showToast]);

  /* -- Unsaved-changes guard ------------------------------------------------
     The app ships a NavigationGuardProvider (mounted in App.jsx) that shows a
     "Save & Leave / Discard & Leave / Cancel" modal whenever the page is dirty
     and the user navigates away, and it also warns on browser tab close via
     beforeunload. Register this page with it so a partially-built itinerary
     (services added but not yet saved) is never silently lost: the guard uses
     handleSave's return value (true=proceed, false=stay) to decide whether the
     navigation may complete. */
  usePageGuard('itinerary-builder', 'this itinerary', dirty, handleSave);

  /* -- Issue an invoice from inside the builder. Editable quotations are saved
     first; locked bookings use their already-persisted itinerary without
     routing invoice work through the itinerary edit guard. */
  /* The booking's whole financial history, straight from the database: every
     invoice in this currency plus the credit notes against them. The over-billing
     guard is measured against this rather than the loaded state, which can be
     stale or only partly loaded. */
  const fetchBookingHistory = useCallback(async (itineraryId, ccy) => {
    const empty = { invoices: [], creditNotes: [], billed: 0 };
    if (!itineraryId || !companyId) return empty;
    const { data: invs, error: invErr } = await supabase
      .from('invoices')
      .select('id, invoice_number, total_incl, status, currency_code, paid_at')
      .eq('company_id', companyId)
      .eq('itinerary_id', itineraryId);
    if (invErr) throw invErr;
    const mine = (invs || []).filter((i) => (i.currency_code || '').toUpperCase() === (ccy || '').toUpperCase());
    if (!mine.length) return empty;

    const { data: cns, error: cnErr } = await supabase
      .from('credit_notes')
      .select('id, invoice_id, total_incl, status, currency_code, accounting_export')
      .eq('company_id', companyId)
      .in('invoice_id', mine.map((i) => i.id));
    if (cnErr) throw cnErr;

    return {
      invoices: mine,
      creditNotes: cns || [],
      billed: netBilled(mine, cns || [], ccy)
    };
  }, [companyId]);

  const handleIssueInvoiceHere = useCallback(async ({ silent = false, targetCurrency = currencyCode, requestPercent } = {}) => {
    if (!companyId) { showToast('Company not found', 'error'); return null; }
    if (isCancelled) return null;
    if (financeSubmissionRef.current) return null;
    financeSubmissionRef.current = true;
    const targetSymbol = svcSymbol(targetCurrency);
    setIssuingInvoice(true);
    try {
      if (!isReadOnly) {
        const ok = await handleSave();
        if (!ok) return null;
      }
      const iid = lastItineraryIdRef.current || meta.itineraryId;
      if (!iid) throw new Error('Save the itinerary before issuing an invoice');
      const agg = buildLinesFromDays(days, paxCount, targetCurrency);
      if (!agg.lines.length) { showToast('Add day-by-day services before issuing an invoice', 'warning'); return null; }

      /* The booking's financial history, read fresh. The guard below has to be
         measured against every invoice and credit note on this booking, not just
         the ones already loaded into state, so issuing twice in quick
         succession cannot bill the trip twice. */
      const history = await fetchBookingHistory(iid, targetCurrency);
      /* An invoice must carry payment details, so it can only be issued when an
         active bank account exists for this currency. Itineraries can still be
         built in any currency; only invoicing is blocked. */
      const activeBank = bankAccounts
        .filter((b) => b.is_active && (b.currency_code || '').toUpperCase() === targetCurrency.toUpperCase())
        .sort((a, b) => (b.is_default ? 1 : 0) - (a.is_default ? 1 : 0))[0] || null;
      if (!activeBank) {
        const anyActive = bankAccounts.some((b) => b.is_active);
        showToast(anyActive
          ? `No active bank account for ${targetCurrency}. Add or activate one in Settings > Bank Accounts to invoice in this currency.`
          : 'All bank accounts are deactivated. Add or activate a bank account in Settings to generate invoices.', 'error');
        return null;
      }
      const perPersonBreakdown = breakdownSnapshot(computePerPerson(
        days,
        targetCurrency,
        Array.isArray(meta.travellers) ? meta.travellers : [],
        libraryItems,
        { defaultTaxRate, paxCount, travelWindow, protectionPercent: priceProtectionPercent }
      ));

      /* The invoice bills what the trip costs less what has already been billed
         on it, so successive documents cover the trip exactly once. Taken from
         the fresh history, not the loaded state, for the same reason as the
         guard: this is the figure the document is actually being measured
         against, so it cannot be stale. */
      const alreadyBilled = history.billed;
      /* Nothing billed yet means this is the first request on the trip, so bill
         the configured opening percentage rather than the whole thing. */
      const firstRequest = alreadyBilled <= 0.009;
      const gross = requestPercent !== undefined
        ? billableAtPercentage(agg.totalIncl, requestPercent, history.invoices, history.creditNotes, targetCurrency)
        : firstRequest
          ? billableAtPercentage(agg.totalIncl, depositPct, history.invoices, history.creditNotes, targetCurrency)
          : billableRemaining(agg.totalIncl, history.invoices, history.creditNotes, targetCurrency);

      /* The guard: an invoice may only bill the part of the trip not yet
         billed. Read fresh from the database rather than from the state on
         screen, so a booking cannot be invoiced twice by issuing quickly. */
      const guard = canBill(gross, agg.totalIncl, history.invoices, history.creditNotes, targetCurrency);
      if (!guard.ok) {
        if (!silent) {
          showToast(guardMessage({ reason: guard.reason, limit: guard.limit, proposed: gross }, targetSymbol),
            guard.reason === 'nothing' ? 'warning' : 'error');
        }
        return null;
      }
      const netRatio = agg.totalIncl > 0 ? round2(agg.subtotalExcl) / agg.totalIncl : 1;
      const net = round2(gross * netRatio);
      /* Billing only part of the trip is a request for money, not yet an invoice
         for the supply, so it goes out as a proforma. Decided by the amount. */
      const status = gross < round2(agg.totalIncl) - 0.009 ? 'proforma' : 'validated';
      const balance = gross;

      const bank = activeBank;
      const bankDetails = bank ? {
        bank_name: bank.bank_name,
        account_holder_name: bank.account_holder_name,
        account_number: bank.account_number,
        branch_code: bank.branch_code,
        swift_code: bank.swift_code
      } : {};
      const client = meta.client || {};
      /* The server owns the booking keys and the invoice number: it allocates
         the number inside the same locked transaction that runs the guard, and
         stamps it into the accounting snapshot. Anything sent here for those
         fields is ignored. */
      const header = {
        client_id: client.id || null,
        invoice_type: 'invoice',
        status,
        currency_code: targetCurrency,
        subtotal_excl: net,
        tax_total: round2(gross - net),
        total_incl: gross,
        tax_label: agg.taxEntries[0]?.label || 'VAT',
        tax_rate: agg.taxEntries[0]?.rate ?? defaultTaxRate,
        balance_due: balance,
        issued_date: new Date().toISOString().slice(0, 10),
        due_date: null,
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
        notes: null,
        per_person_breakdown: perPersonBreakdown
      };

      const accounting = accountingPayload(header, agg.lines);
      /* Issued through the server so the guard and the write share one
         transaction. The check above is still worth doing first — it gives an
         instant, specific message — but this is the one that cannot be raced,
         and it also writes the header and its lines together. */
      const { data: issued, error: invErr } = await supabase.rpc('issue_booking_invoice', {
        p_company_id: companyId,
        p_itinerary_id: iid,
        p_currency: targetCurrency,
        p_trip_total: agg.totalIncl,
        p_invoice: { ...header, accounting_export: accounting },
        p_lines: scaleInvoiceLines(agg.lines, gross)
      });
      if (invErr) throw invErr;

      const { data: created, error: readErr } = await supabase
        .from('invoices')
        .select('*')
        .eq('id', issued.id)
        .single();
      if (readErr || !created) throw new Error(readErr?.message || 'Invoice was not created');
      const number = created.invoice_number;

      await loadItineraryInvoices();
      /* Recognition follows the invoice, not the itinerary stage. A deposit
         invoice is created as a proforma draft, so it posts nothing until it
         is actually validated (see openPaymentPrompt); a final invoice is
         created validated and posts straight away. postInvoice is idempotent
         per invoice, so a repeat call cannot double-post. */
      if (created.status && created.status !== 'proforma') {
        await postInvoice(companyId, created);
      }
      if (!silent) showToast(`Invoice ${number} issued`, 'success');
      return created;
    } catch (err) {
      /* The server carries its rejection reason in the exception detail, so the
         user gets the same specific message whether the guard was caught here
         or by the locked insert. Without this they would see Postgres' wording
         for what is really a billing problem. */
      const detail = parseGuardRejection(err);
      const msg = detail
        ? guardMessage(detail, targetSymbol)
        : /duplicate key|unique/i.test(err.message || '')
        ? `An invoice already exists for ${targetCurrency}`
        : (err.message || 'Failed to issue invoice');
      showToast(msg, detail ? (detail.reason === 'nothing' ? 'warning' : 'error') : 'error');
      return null;
    } finally {
      financeSubmissionRef.current = false;
      setIssuingInvoice(false);
    }
  }, [companyId, currencyCode, svcSymbol, fetchBookingHistory, handleSave, isReadOnly, isCancelled, meta.itineraryId, meta.client, meta.travellers, days, paxCount, depositPct, defaultTaxRate, bankAccounts, billing, libraryItems, loadItineraryInvoices, showToast, travelWindow, priceProtectionPercent]);

  /* -- Raise a payment receipt against the active invoice.
     A client can settle an invoice in instalments, so the amount is collected
     rather than assumed. What remains afterwards is derived from the documents,
     never from the cached balance_due column, so it stays correct however many
     receipts land. */
  const openPaymentPrompt = useCallback(async (targetCurrency = activeInvoice?.currency_code || currencyCode) => {
    const requestedCode = (targetCurrency || '').toUpperCase();
    const inv = paymentInvoicesByCurrency.find((candidate) => candidate.currency_code.toUpperCase() === requestedCode)
      || paymentInvoicesByCurrency[0]
      || activeInvoice
      || await handleIssueInvoiceHere({ silent: true, targetCurrency: requestedCode || currencyCode });
    if (!inv) return;
    const invoiceOutstanding = inv.derivedBalance ?? invoiceBalance(inv, itineraryReceipts);
    const bookingOutstanding = bookingReceivableRemaining(
      itineraryInvoices,
      itineraryReceipts,
      itineraryCreditNotes,
      inv.currency_code
    );
    const balance = round2(Math.min(invoiceOutstanding, bookingOutstanding));
    setPaymentPrompt({ ...inv, derivedBalance: balance, submissionKey: crypto.randomUUID() });
    setPaymentForm({
      amount: balance > 0.009 ? String(balance) : '',
      received_date: new Date().toISOString().slice(0, 10),
      payment_method: 'EFT',
      payment_reference: inv.payment_reference || ''
    });
  }, [activeInvoice, currencyCode, paymentInvoicesByCurrency, itineraryInvoices, itineraryReceipts, itineraryCreditNotes, handleIssueInvoiceHere, showToast]);

  const changePaymentCurrency = useCallback((targetCurrency) => {
    void openPaymentPrompt(targetCurrency);
  }, [openPaymentPrompt]);

  /* What the invoice would still owe once this amount is taken off it. */
  const balanceAfterPayment = useCallback((inv, amount) => round2(Math.max(0,
    round2(Number(inv.derivedBalance) || 0) - round2(amount))), []);

  const submitPayment = useCallback(async () => {
    const inv = paymentPrompt;
    if (!inv || financeSubmissionRef.current) return;
    financeSubmissionRef.current = true;
    setIssuingInvoice(true);
    let receiptSaved = false;
    try {
      const amount = round2(Number(paymentForm.amount));
      if (!(amount > 0.009)) throw new Error('Enter the amount received');

      /* The dialog can remain open after a network or journal error, and its
         cached balance may then be stale. Re-read movements before writing so
         retrying a payment that already settled this invoice cannot create a
         second receipt. */
      const { data: currentReceipts, error: receiptReadError } = await supabase
        .from('invoice_receipts')
        .select('amount, direction, accounting_export, client_submission_key')
        .eq('invoice_id', inv.id);
      if (receiptReadError) throw receiptReadError;
      if ((currentReceipts || []).some((receipt) =>
        receipt.client_submission_key === inv.submissionKey
        || receipt.accounting_export?.idempotency_key === inv.submissionKey
      )) {
        await loadItineraryInvoices();
        setPaymentPrompt(null);
        showToast(`A receipt for ${inv.invoice_number} was already recorded. No duplicate was created.`, 'warning');
        return;
      }
      const currentOutstanding = round2(Math.max(0,
        (Number(inv.total_incl) || 0) - settledTotal(inv.id, currentReceipts || [])
      ));

      const { data: number, error: numErr } = await supabase.rpc('get_next_receipt_reference', { p_company_id: companyId });
      if (numErr || !number) throw new Error(numErr?.message || 'Could not allocate receipt number');

      const balanceRemaining = round2(Math.max(0, currentOutstanding - amount));
      const receivedDate = paymentForm.received_date || new Date().toISOString().slice(0, 10);
      const accounting = {
        schema: 'torbuilder.receipt/v1',
        provider_agnostic: true,
        receipt_number: number,
        invoice_number: inv.invoice_number,
        invoice_type: inv.invoice_type,
        status: 'issued',
        date: receivedDate,
        currency: inv.currency_code,
        customer: { name: inv.bill_to_name, email: inv.bill_to_email },
        amount,
        balance_remaining: balanceRemaining,
        method: paymentForm.payment_method || 'EFT',
        reference: paymentForm.payment_reference || '',
        idempotency_key: inv.submissionKey
      };
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
        payment_method: paymentForm.payment_method || 'EFT',
        payment_reference: paymentForm.payment_reference || '',
        bill_to_name: inv.bill_to_name || '',
        bill_to_email: inv.bill_to_email || '',
        supplier_name: inv.supplier_name || '',
        supplier_tax_number: inv.supplier_tax_number || '',
        supplier_address: inv.supplier_address || '',
        bank_details: inv.bank_details || {},
        accounting_export: accounting,
        client_submission_key: inv.submissionKey,
        notes: null
      };
      const { data: receiptRow, error } = await supabase
        .from('invoice_receipts')
        .insert([row])
        .select('id')
        .single();
      if (error) throw error;
      receiptSaved = true;

      /* A part payment leaves the invoice live and still owing, so the status is
         derived from the documents rather than stamped paid. Only a receipt that
         clears the balance closes the invoice out. */
      const nowSettled = balanceRemaining <= 0.009;
      const paidUpdate = {
        status: nowSettled ? 'paid' : 'validated',
        balance_due: balanceRemaining,
        payment_reference: paymentForm.payment_reference || ''
      };
      if (nowSettled) paidUpdate.paid_at = new Date().toISOString();
      else paidUpdate.paid_at = null;
      const { error: paidErr } = await supabase
        .from('invoices')
        .update(paidUpdate)
        .eq('id', inv.id);
      if (paidErr) throw paidErr;

      /* Payment is the moment a proforma request becomes a real document, so its
         sale is recognised here. postInvoice is idempotent per invoice. */
      if (nowSettled && (inv.status === 'proforma' || inv.status === 'draft')) {
        await postInvoice(companyId, { ...inv, status: 'paid' });
      }
      /* A receipt row only links to its invoice, so the itinerary and client are
         carried across for the journal, which needs them to attribute the cash
         to the booking it settled. */
      await postReceipt(companyId, {
        ...row,
        id: receiptRow.id,
        invoice_id: inv.id,
        itinerary_id: inv.itinerary_id || meta.itineraryId || null,
        client_id: inv.client_id || meta.client?.id || null
      });

      await loadItineraryInvoices();
      setPaymentPrompt(null);
      showToast(
        nowSettled
          ? `Receipt ${number} issued — ${inv.invoice_number} settled in full`
          : `Receipt ${number} issued — ${svcSymbol(inv.currency_code)}${balanceRemaining.toFixed(2)} still outstanding`,
        'success'
      );
    } catch (err) {
      if (receiptSaved) {
        await loadItineraryInvoices();
        setPaymentPrompt(null);
        showToast(`Receipt was saved, but the follow-up accounting update failed: ${err.message || 'unknown error'}`, 'error');
      } else if (err.code === '23505' && /submission_key/i.test(err.message || '')) {
        await loadItineraryInvoices();
        setPaymentPrompt(null);
        showToast('This payment request was already recorded. The itinerary balances have been refreshed.', 'warning');
      } else if ((err.code === '23514' || err.code === 'check_violation') && (err.details || err.detail)) {
        let detail = null;
        try {
          detail = JSON.parse(err.details || err.detail);
        } catch {
          detail = null;
        }
        if (detail?.reason === 'receipt_limit') {
          const allowed = Number(detail.allowed) || 0;
          setPaymentForm((current) => ({ ...current, amount: allowed > 0 ? allowed.toFixed(2) : '' }));
          setPaymentPrompt((current) => current
            ? { ...current, derivedBalance: Math.min(current.derivedBalance, allowed) }
            : current);
          await loadItineraryInvoices();
          showToast(`Only ${svcSymbol(inv.currency_code)}${allowed.toFixed(2)} remains available across this invoice and itinerary. The amount has been updated.`, 'warning');
        } else {
          showToast(err.message || 'Payment exceeds the remaining itinerary balance', 'error');
        }
      } else {
        showToast(err.message || 'Failed to record payment', 'error');
      }
    } finally {
      financeSubmissionRef.current = false;
      setIssuingInvoice(false);
    }
  }, [paymentPrompt, paymentForm, companyId, svcSymbol, meta.itineraryId, meta.client, loadItineraryInvoices, showToast]);

  const openOverpaymentPrompt = (targetCurrency, tripTotal) => {
    const code = targetCurrency.toUpperCase();
    const amount = bookingOverpayment(
      tripTotal,
      itineraryInvoices,
      itineraryReceipts,
      itineraryCreditNotes,
      code
    );
    if (amount <= 0.009) {
      showToast(`There is no unresolved ${code} overpayment to resolve.`, 'warning');
      return;
    }

    const candidates = itineraryInvoices
      .filter((invoice) => (invoice.status || '') !== 'void'
        && (invoice.currency_code || '').toUpperCase() === code)
      .map((invoice) => {
        const heldCash = refundableTotal(invoice.id, itineraryReceipts);
        const invoiceOverpayment = round2(Math.max(0, heldCash - (Number(invoice.total_incl) || 0)));
        const refundLimit = round2(Math.min(amount, invoiceOverpayment));
        const creditLimit = refundLimit;
        return {
          invoice,
          refundLimit,
          creditLimit,
          available: Math.max(refundLimit, creditLimit)
        };
      })
      .filter((candidate) => candidate.available > 0.009);

    if (!candidates.length) {
      showToast(`The ${code} overpayment is not linked to an invoice with refundable excess cash. Review the invoice receipts in Finance.`, 'error');
      return;
    }
    const selected = candidates[0];
    setOverpaymentPrompt({
      currency: code,
      amount,
      candidates,
      selectedInvoiceId: selected.invoice.id,
      submissionKey: crypto.randomUUID()
    });
    setOverpaymentAmount(String(Math.min(amount, selected.available).toFixed(2)));
    setOverpaymentReason('Duplicate payment correction');
  };

  const resolveOverpayment = async (action) => {
    const prompt = overpaymentPrompt;
    if (!prompt || financeSubmissionRef.current) return;
    const candidate = prompt.candidates.find((entry) => entry.invoice.id === prompt.selectedInvoiceId);
    const amount = round2(Number(overpaymentAmount));
    if (!candidate || !(amount > 0.009)) {
      showToast('Choose a valid invoice and overpayment amount', 'error');
      return;
    }
    const actionLimit = action === 'refund' ? candidate.refundLimit : candidate.creditLimit;
    if (amount > actionLimit + 0.009) {
      showToast(`The maximum ${action === 'refund' ? 'refund' : 'credit note'} available on this invoice is ${svcSymbol(prompt.currency)}${actionLimit.toFixed(2)}.`, 'error');
      return;
    }

    financeSubmissionRef.current = true;
    setIssuingInvoice(true);
    try {
      const rpcName = action === 'credit_note'
        ? 'issue_itinerary_overpayment_credit_note_authorized'
        : 'resolve_itinerary_overpayment';
      const rpcArgs = action === 'credit_note'
        ? {
          p_company_id: companyId,
          p_invoice_id: candidate.invoice.id,
          p_amount: amount,
          p_reason: overpaymentReason.trim(),
          p_submission_key: prompt.submissionKey
        }
        : {
          p_company_id: companyId,
          p_invoice_id: candidate.invoice.id,
          p_amount: amount,
          p_reason: overpaymentReason.trim(),
          p_action: action,
          p_submission_key: prompt.submissionKey,
          p_lines: []
        };
      const { data, error } = await supabase.rpc(rpcName, rpcArgs);
      if (error) throw error;
      const result = Array.isArray(data) ? data[0] : data;
      if (!result) throw new Error('The overpayment resolution was not recorded');

      if (action === 'refund') {
        await postReceipt(companyId, {
          id: result.id,
          direction: 'out',
          amount: result.amount || amount,
          receipt_number: result.number,
          invoice_id: candidate.invoice.id,
          invoice_number: candidate.invoice.invoice_number,
          currency_code: prompt.currency,
          bill_to_name: candidate.invoice.bill_to_name || '',
          payment_method: 'REFUND',
          itinerary_id: meta.itineraryId || candidate.invoice.itinerary_id || null,
          client_id: candidate.invoice.client_id || meta.client?.id || null
        });
      } else {
        /* The receipt already placed excess cash in the client's receivable
           balance. This adjustment note documents that overpayment; reversing
           the original invoice posting here would reduce revenue a second time. */
      }

      await loadItineraryInvoices();
      setOverpaymentPrompt(null);
      showToast(
        action === 'refund'
          ? `Refund ${result.number} issued for ${svcSymbol(prompt.currency)}${amount.toFixed(2)}`
          : `Credit note ${result.number} issued for ${svcSymbol(prompt.currency)}${amount.toFixed(2)} and added to the client's credit balance`,
        'success'
      );
    } catch (err) {
      if (err.code === '23505' && /submission_key/i.test(err.message || '')) {
        await loadItineraryInvoices();
        setOverpaymentPrompt(null);
        showToast('This overpayment resolution was already recorded. The itinerary balances have been refreshed.', 'warning');
      } else if ((err.code === '23514' || err.code === 'check_violation') && (err.details || err.detail)) {
        let detail = null;
        try {
          detail = JSON.parse(err.details || err.detail);
        } catch {
          detail = null;
        }
        if (detail?.reason === 'overpayment_limit') {
          const available = Number(detail.available) || 0;
          setOverpaymentAmount(available > 0 ? available.toFixed(2) : '');
          setOverpaymentPrompt((current) => current
            ? { ...current, amount: available }
            : current);
          await loadItineraryInvoices();
          showToast(`Only ${svcSymbol(prompt.currency)}${available.toFixed(2)} of unresolved overpayment remains. The amount has been updated.`, 'warning');
        } else {
          showToast(err.message || 'Could not resolve the itinerary overpayment', 'error');
        }
      } else {
        showToast(err.message || 'Could not resolve the itinerary overpayment', 'error');
      }
    } finally {
      financeSubmissionRef.current = false;
      setIssuingInvoice(false);
    }
  };

  /* -- Email the issued invoice. Produces the chosen format as a downloadable
     / shareable attachment and opens the client's email with a covering note.
     (Browser mailto cannot attach files directly, so the file is shared via the
     Web Share API when available, otherwise downloaded ready to attach.) */
  const emailInvoiceToClient = useCallback(async () => {
    const inv = activeInvoice || await handleIssueInvoiceHere({ silent: true });
    if (!inv) return;
    const agg = buildLinesFromDays(days, paxCount, currencyCode);
    const docOpts = {
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
    const m = invoiceEmail(inv, agg.lines, docOpts);
    if (!m.to) { showToast('No client email on file', 'warning'); return; }

    let attached = false;
    if (emailFormat === 'word' || emailFormat === 'excel') {
      const isExcel = emailFormat === 'excel';
      const content = isExcel ? invoiceExcelHtml(inv, agg.lines, currencySymbol, docOpts) : invoiceDocHtml(inv, agg.lines, currencySymbol, docOpts);
      const filename = `${inv.invoice_number}.${isExcel ? 'xls' : 'doc'}`;
      const mime = isExcel ? 'application/vnd.ms-excel' : 'application/msword';
      try {
        const file = new File([content], filename, { type: mime });
        if (navigator.canShare?.({ files: [file] })) {
          await navigator.share({ files: [file], title: m.subject, text: m.body });
          attached = true;
        }
      } catch { /* share cancelled — fall through to download */ }
      if (!attached) {
        downloadBlob(content, filename, mime);
        showToast('Invoice file downloaded — attach it to the email', 'success');
      }
    } else {
      const w = openPrintWindow(invoiceDocHtml(inv, agg.lines, currencySymbol, docOpts), 300);
      if (!w) showToast('Please allow pop-ups to prepare the PDF', 'warning');
      else showToast('Choose "Save as PDF", then attach it to the email', 'success');
    }
    window.open(mailTo(m.to, m.subject, m.body), '_blank');
  }, [activeInvoice, handleIssueInvoiceHere, days, paxCount, currencyCode, currencySymbol, emailFormat, downloadBlob, showToast, billing]);

  const viewReceipt = useCallback((r) => {
    if (!r) return;
    const w = openPrintWindow(receiptDocHtml(r, svcSymbol(r.currency_code), { logo: billing?.logo_data_url || '', logoSize: billing?.logo_size || 'md' }), 300);
    if (!w) showToast('Please allow pop-ups to view the receipt', 'warning');
  }, [svcSymbol, showToast, billing]);

  /* -- Statement of account --------------------------------------------------
     One document per currency, built from the persisted invoices, receipts and
     credit notes for this booking. Rebuilt from scratch on each action so it can
     never show a figure the app has since superseded. */
  const statementCurrenciesHere = useMemo(
    () => [...new Set([
      ...statementCurrencies(
        itineraryInvoices,
        itineraryReceipts,
        itineraryCreditNotes,
        pricingGroups[0]?.code
          || itineraryInvoices[0]?.currency_code
          || itineraryReceipts[0]?.currency_code
          || itineraryCreditNotes[0]?.currency_code
          || currencyCode
      ),
      ...pricingGroups.map((group) => group.code.toUpperCase())
    ])].sort(),
    [itineraryInvoices, itineraryReceipts, itineraryCreditNotes, currencyCode, pricingGroups]
  );
  const [statementCcyChoice, setStatementCcyChoice] = useState(currencyCode);
  const [statementFormat, setStatementFormat] = useState('doc');
  /* The selected currency can disappear as documents change, so fall back to the
     booking currency rather than holding a selection that is no longer on offer.
     Derived during render — storing it in an effect would render a stale
     selector for a frame. */
  const statementCcy = statementCurrenciesHere.includes(statementCcyChoice)
    ? statementCcyChoice
    : statementCurrenciesHere[0] || currencyCode;
  const setStatementCcy = setStatementCcyChoice;

  const statementMeta = useCallback(() => ({
    reference_number: meta.referenceNumber || meta.reference || '',
    client_name: meta.client?.name || '',
    start_date: meta.travelStart || meta.start_date || '',
    end_date: meta.travelEnd || meta.end_date || ''
  }), [meta]);

  const buildStatement = useCallback((ccy) => statementFor(
    statementMeta(),
    ccy,
    itineraryInvoices,
    itineraryReceipts,
    itineraryCreditNotes
  ), [statementMeta, itineraryInvoices, itineraryReceipts, itineraryCreditNotes]);

  const statementDocOptions = useCallback(() => ({
    logo: billing?.logo_data_url || '',
    logoSize: billing?.logo_size || 'md',
    logoPosition: billing?.logo_position,
    billingAddressPosition: billing?.billing_address_position,
    supplierName: billing?.company_name || billing?.legal_name || '',
    supplierTaxNumber: billing?.tax_number || '',
    supplierAddress: billing?.company_address || '',
    companyContactTel: billing?.contact_phone || '',
    companyContactCell: billing?.contact_cell || '',
    companyContactEmail: billing?.contact_email || '',
    companyContactWebsite: billing?.website || ''
  }), [billing]);

  const viewStatement = useCallback(() => {
    const st = buildStatement(statementCcy);
    const w = openPrintWindow(statementDocHtml(statementMeta(), st, statementDocOptions()), 300);
    if (!w) showToast('Please allow pop-ups to view the statement', 'warning');
  }, [buildStatement, statementCcy, statementDocOptions, statementMeta, showToast]);

  const downloadStatement = useCallback(() => {
    const st = buildStatement(statementCcy);
    const ref = (statementMeta().reference_number || 'itinerary').replace(/[^\w-]+/g, '-');
    if (statementFormat === 'csv') {
      downloadBlob(statementCsv(statementMeta(), st), `${ref}-statement-${st.currency}.csv`, 'text/csv;charset=utf-8');
    } else if (statementFormat === 'xls') {
      downloadBlob(statementExcelHtml(statementMeta(), st, statementDocOptions()), `${ref}-statement-${st.currency}.xls`, 'application/vnd.ms-excel');
    } else {
      downloadBlob(statementDocHtml(statementMeta(), st, statementDocOptions()), `${ref}-statement-${st.currency}.doc`, 'application/msword');
    }
  }, [buildStatement, statementCcy, statementFormat, statementDocOptions, statementMeta, downloadBlob]);

  const emailStatement = useCallback(() => {
    const st = buildStatement(statementCcy);
    const info = statementMeta();
    const to = meta.client?.email || meta.client?.contact_email || '';
    if (!to) { showToast('This client has no email address on file', 'warning'); return; }
    const subject = `Statement of Account${info.reference_number ? ` — ${info.reference_number}` : ''}`;
    const body = statementEmail(info, st, {
      companyContactTel: billing?.contact_phone || '',
      companyContactEmail: billing?.contact_email || ''
    });
    window.open(mailTo(to, subject, body), '_blank');
  }, [buildStatement, statementCcy, statementMeta, meta, billing, showToast]);

  /* -- Edit itinerary details (Client & Tour) ------------------------------- */

  const handleDetailsSave = useCallback(async (payload) => {
    if (completedRef.current) return;
    if (!meta.itineraryId) {
      showToast('Save the itinerary once before editing its details', 'warning');
      return;
    }
    setSaving(true);
    try {
      const { error } = await supabase
        .from('itineraries')
        .update({
          itinerary_name: payload.itineraryName,
          client_id: payload.clientId,
          travel_start_date: payload.travelStart,
          travel_end_date: payload.travelEnd,
          travellers: payload.travellers,
          num_adults: payload.numAdults,
          num_children: payload.numChildren,
          agency_reference: payload.agencyRef,
          itinerary_tour_type: payload.tourType || null,
          consultant_name: payload.consultantName || meta.consultantName || null
        })
        .eq('id', meta.itineraryId);
      if (error) throw error;

      const nextClient = payload.selectedClient || meta.client;
      const nextMeta = {
        ...meta,
        itineraryName: payload.itineraryName,
        client: nextClient,
        travelStart: payload.travelStart,
        travelEnd: payload.travelEnd,
        travellers: payload.travellers,
        numAdults: payload.numAdults,
        numChildren: payload.numChildren,
        agencyRef: payload.agencyRef,
        tourType: payload.tourType || meta.tourType,
        consultantName: payload.consultantName || meta.consultantName
      };
      /* Reprice non-accommodation items when the party size changes. Their
         per-person amounts are stored on the line, so a rate divided by the
         old pax count otherwise stays stale when travelers are added or removed. */
      const nextDays = days.map((d, i) => ({
        ...d,
        dayNumber: i + 1,
        date: payload.travelStart ? addDaysToDate(payload.travelStart, i) : d.date || ''
      }));
      const priced = repriceServicesForPax({
        days: nextDays,
        libraryItems,
        paxCount: (Number(payload.numAdults) || 0) + (Number(payload.numChildren) || 0),
        childCount: Number(payload.numChildren) || 0,
        travelWindow: {
          start: payload.travelStart || nextDays[0]?.date || '',
          end: payload.travelEnd || nextDays[nextDays.length - 1]?.date || ''
        },
        protectionPercent: priceProtectionPercent
      });
      setDays(priced.days);
      setMeta((prev) => ({ ...prev, ...nextMeta }));
      /* Metadata was persisted above; any changed line prices remain dirty
         until the user saves the itinerary through its normal save action. */
      setLastSavedKey(JSON.stringify({ days, meta: nextMeta }));
      setDetailsOpen(false);
      const dayDataChanged = JSON.stringify(days) !== JSON.stringify(priced.days);
      setSaved(!dayDataChanged);
      if (priced.skipped.length) {
        showToast(`Itinerary details updated, but ${priced.skipped.length} service price(s) could not be refreshed. Check their library rates before saving.`, 'warning');
      } else if (priced.repriced) {
        showToast(`Itinerary details updated and ${priced.repriced} service price(s) recalculated. Save the itinerary to store the new prices.`, 'success');
      } else if (dayDataChanged) {
        showToast('Itinerary details updated. Save the itinerary to store the updated day dates.', 'success');
      } else {
        showToast('Itinerary details updated', 'success');
      }
    } catch (err) {
      showToast(err.message || 'Failed to update itinerary details', 'error');
    } finally {
      setSaving(false);
    }
  }, [meta, showToast, days, libraryItems, priceProtectionPercent, setDays, setMeta]);

  /* -- Edit a day service (name + description override) -------------------- */

const openServiceEditor = useCallback((dayIdx, sv) => {
    const li = sv.itemId ? libraryItems.find((x) => x.id === sv.itemId) : null;
    setEditSvc({
      dayIdx,
      key: sv.key,
      name: sv.name || '',
      descOverride: sv.descOverride || '',
      defaultDesc: li?.description || '',
      taxRate: numOr(sv.taxRate, 15),
      taxLabel: sv.taxLabel || 'VAT'
    });
    setCopyDays([]);
    setCopyAllDays(false);
  }, [libraryItems]);

  const saveServiceDetails = useCallback(() => {
    if (completedRef.current) return;
    if (!editSvc) return;
    const name = editSvc.name.trim();
    if (!name) {
      showToast('Service name is required', 'warning');
      return;
    }
    setDays((prev) => prev.map((d, i) => {
      if (i !== editSvc.dayIdx) return d;
      return {
        ...d,
        services: d.services.map((s) =>
          s.key === editSvc.key
            ? (() => {
              const taxAllowed = taxAppliesForCurrency(s.currencyCode);
              return {
                ...s,
                name,
                descOverride: editSvc.descOverride.trim(),
                taxRate: taxAllowed ? numOr(editSvc.taxRate, defaultTaxRate) : 0,
                taxLabel: taxAllowed ? (editSvc.taxLabel || defaultTaxLabel) : 'No VAT'
              };
            })()
            : s
        )
      };
    }));
    setSaved(false);
    setEditSvc(null);
    setCopyDays([]);
    setCopyAllDays(false);
    showToast('Service updated', 'success');
  }, [editSvc, defaultTaxRate, defaultTaxLabel, showToast, taxAppliesForCurrency, setDays ]);

  /* Copy the service currently being edited to all days or specific days.
     Creates deep clones so each occurrence remains independently editable.
     Room allocations copy along where present; a repeated accommodation keeps
     its meal plan, rates and per-day pricing. */
  const copyServiceToDays = useCallback((targets) => {
    if (completedRef.current) return;
    if (!editSvc) return;
    const sourceDay = days[editSvc.dayIdx];
    const source = sourceDay?.services?.find((s) => s.key === editSvc.key);
    if (!source) {
      showToast('Service not found', 'error');
      return;
    }
    if (!targets.length) {
      showToast('Select at least one target day', 'warning');
      return;
    }
    const valid = [...new Set(targets.map(Number))]
      .filter((i) => i >= 0 && i < days.length && i !== editSvc.dayIdx)
      .sort((a, b) => a - b);
    if (!valid.length) {
      showToast('No other day available to copy to', 'warning');
      setEditSvc(null);
      return;
    }
    let copied = 0;
    setDays((prev) => prev.map((d, i) => {
      if (!valid.includes(i)) return d;
      const family = source.repeatGroupId
        ? prev[editSvc.dayIdx]?.services?.filter((s) => s.repeatGroupId === source.repeatGroupId)
        : [source];
      const targetIds = new Set((d.services || []).map((s) => s.itemId));
      if (family.some((s) => s.itemId && targetIds.has(s.itemId))) return d;
      const clone = {
        ...source,
        key: nextId(),
        roomAllocations: Array.isArray(source.roomAllocations) ? JSON.parse(JSON.stringify(source.roomAllocations)) : [],
        item_rates: Array.isArray(source.item_rates) ? source.item_rates : [],
        repeatGroupId: source.repeatGroupId || null
      };
      copied += 1;
      return { ...d, services: [...(d.services || []), clone] };
    }));
    setSaved(false);
    setEditSvc(null);
    setCopyDays([]);
    setCopyAllDays(false);
    showToast(`Copied "${source.name}" to ${copied} other day${copied === 1 ? '' : 's'}`, 'success');
  }, [days, editSvc, nextId, showToast, setDays ]);

  /* ── Supplier payment confirmation (Operations, in progress) ────────────────
     One checkbox per service, because suppliers are paid per booking. Ticking
     it writes straight to that service's itinerary_day_items row, so a payment
     confirmed mid-trip survives a reload or an accidental navigation — it does
     not sit in the working copy waiting for the next Save. Services that have
     never been saved have no row yet, so they fall back to the normal Save. */
  const persistServicePayment = useCallback(async (dayIndex, serviceKey, patch) => {
    if (terminalRef.current) return false;
    const day = days[dayIndex];
    const current = (day?.services || []).find((sv) => sv.key === serviceKey);
    if (!current) return false;
    if (!current.dbId) {
      showToast('Save the itinerary before recording supplier payment details', 'warning');
      return false;
    }

    const nextDays = days.map((d, i) => (
      i === dayIndex
        ? { ...d, services: d.services.map((sv) => (sv.key === serviceKey ? { ...sv, ...patch } : sv)) }
        : d
    ));
    /* Supplier payment status is an operational record, not an itinerary
       content edit. Persist it directly so the In Progress read-only guard
       remains in place for services, prices, and other commercial details. */
    setDaysRaw(nextDays);

    /* The columns are snake_case, the service object is camelCase. Only send
       the fields this patch actually touches so unticking "paid" cannot wipe a
       POP reference that was entered earlier. */
    const dbPatch = {};
    if ('supplierPaid' in patch) {
      dbPatch.supplier_paid = !!patch.supplierPaid;
      dbPatch.supplier_paid_at = patch.supplierPaid
        ? patch.supplierPaidAt || new Date().toISOString()
        : null;
    }
    if ('supplierPaidRef' in patch) {
      dbPatch.supplier_paid_ref = patch.supplierPaidRef ? patch.supplierPaidRef : null;
    }

    if (!Object.keys(dbPatch).length) return true;

    const { error } = await supabase
      .from('itinerary_day_items')
      .update(dbPatch)
      .eq('id', current.dbId);
    if (error) {
      /* Put the checkbox back where it was rather than leaving a tick the
         database never accepted. */
      setDaysRaw(days);
      showToast(error.message || 'Could not record the payment confirmation', 'error');
      return false;
    }
    setLastSavedKey(JSON.stringify({ days: nextDays, meta }));
    return true;
  }, [days, meta, showToast]);

  const toggleServicePaid = useCallback((dayIndex, serviceKey, paid) => {
    void persistServicePayment(dayIndex, serviceKey, {
      supplierPaid: paid,
      supplierPaidAt: paid ? new Date().toISOString() : ''
    }).then((ok) => {
      if (ok && paid) showToast('Marked as paid to the supplier', 'success');
    });
  }, [persistServicePayment, showToast]);

  const savePaidRef = useCallback((dayIndex, serviceKey, ref) => {
    void persistServicePayment(dayIndex, serviceKey, { supplierPaidRef: ref });
  }, [persistServicePayment]);

  /* Print / save-as-PDF. The document carries its own print button so the
     operator can check it before committing paper. */
  const openProofOfPayment = useCallback((sv, day) => {
    const w = window.open('', '_blank', 'width=900,height=760');
    if (!w) {
      showToast('Please allow pop-ups to open the proof of payment', 'warning');
      return;
    }
    w.document.write(proofOfPaymentHtml(sv, day, meta, currencySymbol, paxCount, billing));
    w.document.close();
  }, [meta, currencySymbol, paxCount, billing, showToast]);

  const downloadProofOfPayment = useCallback((sv, day) => {
    downloadBlob(
      proofOfPaymentHtml(sv, day, meta, currencySymbol, paxCount, billing),
      `${popFileName(sv, day, meta)}.html`,
      'text/html'
    );
    showToast('Proof of payment downloaded', 'success');
  }, [meta, currencySymbol, paxCount, billing, downloadBlob, showToast]);

  /* -- Render: no data guard ---------------------------------------------- */

  if (!data) {
    return (
      <div className="super-admin-page" style={{ paddingBottom: '4rem' }}>
        <header className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: '1rem' }}>
          <div className="header-title">
            <MapIcon className="header-icon" />
            <div>
              <h1>Itinerary Builder</h1>
              <p>Build the tour day plan for this itinerary</p>
            </div>
          </div>
          <button
            className="secondary-btn"
            style={{ flex: '0 0 auto', padding: '0.625rem 1.5rem', display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}
            onClick={() => navigate('/itineraries')}
          >
            <ArrowLeft size={18} /> Back to Itineraries
          </button>
        </header>
        <div style={{ background: '#fff', borderRadius: '16px', padding: '3rem', border: '1px solid #cbd5e1', textAlign: 'center', color: '#64748b' }}>
          <MapIcon size={48} style={{ marginBottom: '1rem', opacity: 0.4 }} />
          <h3 style={{ fontSize: '1.15rem', fontWeight: 700, color: '#1e293b', marginBottom: '0.4rem' }}>No itinerary data</h3>
          <p>Create an itinerary first, then open it from the Itineraries list.</p>
        </div>
      </div>
    );
  }

  /* Single source of truth for a per-service card. Rendered identically in BOTH
     the "Provisional Service Request" tab and the "Travel Documents" tab
     (forced read-only, supplier OK badge, printable). Contract / library
     fields are ALWAYS locked regardless of tab so the signed contract can never
     be overridden by hand-typed data.

     The Service Request tab is the one place that stays editable while the
     itinerary is locked: a Provisional booking cannot be confirmed until the
     supplier results below are captured, so these operational fields (times,
     confirmation/flight numbers, vehicle, check-in/out, OK status) must remain
     writable. The locked tabs keep using canEdit = false. */
  const renderServiceCard = (sv, day, { editable, tab }) => {
    const cat = sv.category || '';
    const isTransfer = /transfers?/i.test(cat);
    const isAccom = /accommodation/i.test(cat);
    const isActivity = /activities?|tours?|excursions?/i.test(cat);
    const isMeal = /meals?|dinner|lunch|breakfast/i.test(cat);
    const canEdit = tab === 'service-request' ? editable && !isTerminal : editable && !isReadOnly;
    /* Fields sourced from the contract / library item ΓÇö never editable. */
    const contractLocked = isTransfer ? ['vehicleType', 'capacity'] : isAccom ? ['maxOccupancy', 'mealPlan'] : ['vehicleType', 'maxOccupancy'];
    const ro = (field) => !canEdit || contractLocked.includes(field);
    const update = (patch) => updateService(day.key, sv.key, patch);
    const showStatusButtons = tab === 'service-request' && canEdit;
    const ok = (sv.confirmationStatus || 'RQ') === 'OK';
    return (
      <div key={sv.key} style={{ border: '1px solid #e2e8f0', borderRadius: '10px', padding: '0.7rem 0.85rem', marginBottom: '0.6rem', background: '#fff' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '0.55rem' }}>
          <strong style={{ fontSize: '0.88rem', color: '#1a202c' }}>{repairText(sv.name)}</strong>
          {sv.isOptional && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.7rem', fontWeight: 800, color: '#b45309', background: '#fffbeb', border: '1px solid #fcd34d', padding: '0.15rem 0.5rem', borderRadius: '999px', whiteSpace: 'nowrap' }}>
              {isAccom ? 'Alternative' : 'Optional'} ┬╖ not in final price
            </span>
          )}
          {tab === 'travel-documents' ? (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.72rem', fontWeight: 800, color: ok ? '#15803d' : '#b45309', background: ok ? '#f0fdf4' : '#fffbeb', padding: '0.15rem 0.5rem', borderRadius: '999px' }}>
              <CheckCircle2 size={12} /> {ok ? 'OK ┬╖ Confirmed' : 'OK ┬╖ ' + (sv.confirmationStatus || 'RQ')}
            </span>
          ) : null}
        </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '0.5rem' }}>
        <div className="sidebar-field">
          <label>Date of service</label>
            <input className="sidebar-select" value={day.date ? formatDateShort(day.date) : 'ΓÇö'} readOnly style={{ background: '#f8fafc', color: '#64748b' }} />
          </div>
          {!isAccom && (
            <div className="sidebar-field">
              <label>Time</label>
              <input className="sidebar-select" type="time" value={sv.time || ''} readOnly={ro('time')} onChange={(e) => update({ time: e.target.value })} />
            </div>
          )}
          <div className="sidebar-field">
            <label>Confirmation number</label>
            <input className="sidebar-select" placeholder="From supplier (optional)" value={sv.confirmationNumber || ''} readOnly={ro('confirmationNumber')} onChange={(e) => update({ confirmationNumber: e.target.value })} />
          </div>
          {isTransfer && (
            <>
              <div className="sidebar-field">
                <label>Flight number</label>
                <input className="sidebar-select" placeholder="e.g. SA204" value={sv.flightNumber || ''} readOnly={ro('flightNumber')} onChange={(e) => update({ flightNumber: e.target.value })} />
              </div>
              <div className="sidebar-field">
                <label>Flight Time</label>
                <input className="sidebar-select" type="time" value={sv.flightTime || ''} readOnly={ro('flightTime')} onChange={(e) => update({ flightTime: e.target.value })} />
              </div>
              <div className="sidebar-field">
                <label>Vehicle type</label>
                <input className="sidebar-select" placeholder="e.g. Mercedes Vito 8-seater" value={sv.vehicleType || ''} readOnly={true} title="From contract/library ΓÇö locked" />
              </div>
              <div className="sidebar-field">
                <label>Capacity</label>
                <input className="sidebar-select" type="number" min="1" placeholder="Per contract" value={sv.capacity === '' ? '' : sv.capacity} readOnly={true} title="From contract/library ΓÇö locked" />
              </div>
            </>
          )}
          {isAccom && (
            <>
              <div className="sidebar-field">
                <label>Room type</label>
                <input className="sidebar-select" placeholder="e.g. Twin sharing" value={sv.roomType || ''} readOnly={ro('roomType')} onChange={(e) => update({ roomType: e.target.value })} />
              </div>
              <div className="sidebar-field">
                <label>Max occupancy</label>
                <input className="sidebar-select" type="number" min="1" placeholder="Per contract" value={sv.maxOccupancy === '' ? '' : sv.maxOccupancy} readOnly={true} title="From contract/library ΓÇö locked" />
              </div>
              <div className="sidebar-field">
                <label>Meal plan</label>
                <input className="sidebar-select" placeholder="e.g. Half board" value={sv.mealPlan || ''} readOnly={true} title="From contract/library ΓÇö locked" />
              </div>
              <div className="sidebar-field">
                <label>Check-in time</label>
                <input className="sidebar-select" type="time" value={sv.checkInTime || ''} readOnly={ro('checkInTime')} onChange={(e) => update({ checkInTime: e.target.value })} />
              </div>
              <div className="sidebar-field">
                <label>Check-out time</label>
                <input className="sidebar-select" type="time" value={sv.checkOutTime || ''} readOnly={ro('checkOutTime')} onChange={(e) => update({ checkOutTime: e.target.value })} />
              </div>
            </>
          )}
          {(isActivity || isMeal) && (
            <>
              <div className="sidebar-field">
                <label>Start time</label>
                <input className="sidebar-select" type="time" value={sv.startTime || ''} readOnly={ro('startTime')} onChange={(e) => update({ startTime: e.target.value })} />
              </div>
              {isActivity && (
                <div className="sidebar-field">
                  <label>End time</label>
                  <input className="sidebar-select" type="time" value={sv.endTime || ''} readOnly={ro('endTime')} onChange={(e) => update({ endTime: e.target.value })} />
                </div>
              )}
            </>
          )}
          {isActivity && (
            <>
              <div className="sidebar-field">
                <label>Vehicle type</label>
                <input className="sidebar-select" placeholder="e.g. Safari Landcruiser" value={sv.vehicleType || ''} readOnly={true} title="From contract/library ΓÇö locked" />
              </div>
              <div className="sidebar-field">
                <label>Max occupancy</label>
                <input className="sidebar-select" type="number" min="1" placeholder="Per contract" value={sv.maxOccupancy === '' ? '' : sv.maxOccupancy} readOnly={true} title="From contract/library ΓÇö locked" />
              </div>
            </>
          )}
        </div>
        {showStatusButtons && (
          <div className="sidebar-field" style={{ marginTop: '0.5rem' }}>
            <label>Confirmation status</label>
            <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
              {CONFIRMATION_OPTIONS.map((opt) => {
                const active = (sv.confirmationStatus || 'RQ') === opt.value;
                const m2 = CONFIRMATION_META[opt.value];
                return (
                  <button
                    key={opt.value}
                    type="button"
                    title={opt.title}
                    disabled={!canEdit}
                    onClick={() => {
const missing = !sv.confirmationNumber ||
(isTransfer ? !(sv.time && sv.flightNumber && sv.vehicleType) :
(isAccom ? !(sv.checkInTime && sv.checkOutTime) : !sv.time));
  if (opt.value === 'OK' && missing) { showToast('Fill all Provisional Booking fields before marking Confirmed', 'warning'); return; }
  update({ confirmationStatus: opt.value });
}}
                    style={{
                      border: active ? `1.5px solid ${m2.color}` : '1px solid #e2e8f0',
                      background: active ? m2.bg : '#fff',
                      color: active ? m2.color : '#64748b',
                      fontWeight: active ? 800 : 600,
                      borderRadius: '999px',
                      padding: '0.28rem 0.8rem',
                      fontSize: '0.78rem',
                      cursor: canEdit ? 'pointer' : 'not-allowed',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '0.3rem'
                    }}
                  >
                    <Check size={11} style={{ opacity: active ? 1 : 0 }} /> {opt.label}
                  </button>
                );
              })}
            </div>
          </div>
        )}
        {sv.surchargeType && (
          /* Surcharge facts belong on the line: which fee it is, whether it is
             billed, how it repeats and - for a passed-through fee - the supplier
             figure that is deliberately excluded from the total. */
          <div className="sidebar-field" style={{ marginTop: '0.5rem' }}>
            <label>Surcharge</label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.3rem', marginBottom: '0.3rem' }}>
              <span className="basis-tag">
                {(SURCHARGE_TYPES.find((t) => t.id === sv.surchargeType) || SURCHARGE_TYPES[0]).label}
              </span>
              <span className="basis-tag">
                {(CHARGE_BASIS.find((b) => b.id === sv.surchargeChargeBasis) || CHARGE_BASIS[0]).label}
              </span>
              <span className="basis-tag">
                {(UNIT_BASES.find((u) => u.id === sv.surchargeUnitBasis) || UNIT_BASES[0]).label}
              </span>
              {Number(sv.surchargeRepeats) > 1 && (
                <span className="basis-tag">{sv.surchargeRepeats}x</span>
              )}
              <span className="basis-tag" style={{ background: sv.surchargeChargeable === false ? '#f1f5f9' : '#ecfdf5', color: sv.surchargeChargeable === false ? '#64748b' : '#047857', borderColor: sv.surchargeChargeable === false ? '#e2e8f0' : '#a7f3d0' }}>
                {sv.surchargeChargeable === false ? 'Not chargeable' : 'Chargeable'}
              </span>
              {!!sv.linkedItemId && (
                <span className="basis-tag">Linked to accommodation</span>
              )}
            </div>
            {sv.surchargeChargeable === false && Number(sv.surchargeReference) > 0 && (
              <div style={{ fontSize: '0.78rem', color: '#64748b' }}>
                Supplier figure: <strong>{fmtMoney(sv.surchargeReference, currencySymbol)}</strong> &mdash; shown for reference, excluded from the total.
              </div>
            )}
          </div>
        )}
        {/* Pricing Protection is not a surcharge concept: any line can carry it,
            so it is reported outside the surcharge block above. */}
        {Number(sv.priceProtectionPercent) > 0 && (
          <div style={{ fontSize: '0.78rem', color: '#b45309', marginTop: '0.35rem', background: '#fffbeb', border: '1px solid #fde68a', padding: '0.25rem 0.45rem', borderRadius: '5px' }}>
            Pricing Protection: {sv.priceProtectionPercent}% applied{sv.protectedSeasonName ? ` to the ${sv.protectedSeasonName} season` : ''} because no season covers the travel dates.
          </div>
        )}
        {/* Group split and repeat placement are set on the line but were never
            surfaced anywhere, so an operator could not tell why a night is split
            across two properties or which lines move together. */}
        {(!!sv.splitGroupId || !!sv.repeatGroupId) && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.3rem', marginTop: '0.35rem' }}>
            {!!sv.splitGroupId && <span className="basis-tag">Split group</span>}
            {!!sv.repeatGroupId && <span className="basis-tag">Repeats with its group</span>}
          </div>
        )}
        <div className="sidebar-field" style={{ marginTop: '0.5rem' }}>
          <label>Notes</label>
          <textarea className="sidebar-select" rows={2} placeholder="Service-specific notes..." value={sv.notes || ''} readOnly={!canEdit} onChange={(e) => update({ notes: e.target.value })} style={{ resize: 'vertical', fontFamily: 'inherit' }} />
        </div>
      </div>
    );
  };

  /* What the placement prompt needs to know before it can offer a group split:
     this is accommodation, the target night already houses part of the party in
     an included property, and there are still travellers without a bed there. */
  const partyPaxForPlacement = (meta.travellers || []).length || paxCount;
  const beddedPaxBeforePlacement = placementDraft ? accommodationPaxOnDay(placementDraft.dayIndex) : 0;
  const placementSplitAvailable = !!placementDraft
    && isAccommodationItem(placementDraft.item)
    && partyPaxForPlacement > 0
    && beddedPaxBeforePlacement > 0
    && beddedPaxBeforePlacement < partyPaxForPlacement;
  const placementDestinationSplitAvailable = placementSplitAvailable;

  return (
    <div className="super-admin-page" style={{ paddingBottom: '1rem' }}>
      <header className="page-header" style={{ marginBottom: '1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: '1rem' }}>
        <div className="header-title">
          <MapIcon className="header-icon" />
          <div>
            <h1>Itinerary Builder</h1>
            <p>Plan the day-by-day tour services</p>
          </div>
        </div>
        <button
          className="secondary-btn"
          style={{ flex: '0 0 auto', padding: '0.625rem 1.5rem', display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}
          onClick={() => navigate('/itineraries')}
        >
          <ArrowLeft size={18} /> Back to Itineraries
        </button>
      </header>

      <div className="builder-layout">
        {/* -- Builder sidebar: library item picker ----------------------- */}
        <aside className="builder-sidebar">
          <div className="builder-sidebar-header">
            <div className="sidebar-search">
              <Search size={16} />
              <input
                placeholder="Search library items..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
            <div className="sidebar-field">
              <label>Currency</label>
              <div className="menu-popover currency-popover">
                <button
                  type="button"
                  className="currency-trigger"
                  onClick={() => { setCurrencyOpen((p) => !p); setCurrencySearch(''); }}
                >
                  <span className="currency-trigger-sym">{currencySymbol}</span>
                  <span className="currency-trigger-code">{currencyCode}</span>
                  <span className="currency-trigger-name">{currencyObj?.name || ''}</span>
                  <ChevronDown size={14} className={`currency-chevron ${currencyOpen ? 'open' : ''}`} />
                </button>
                {currencyOpen && (
                  <>
                    <div className="menu-overlay" onClick={() => setCurrencyOpen(false)} />
                    <div className="menu-panel currency-panel">
                      <div className="sidebar-search" style={{ margin: 0 }}>
                        <Search size={14} />
                        <input
                          autoFocus
                          placeholder="Search currency..."
                          value={currencySearch}
                          onChange={(e) => setCurrencySearch(e.target.value)}
                        />
                      </div>
                      <div className="currency-list">
                        {filteredCurrencies.map((c) => (
                          <button
                            key={c.code}
                            type="button"
                            className={`menu-item ${c.code === currencyCode ? 'active' : ''}`}
                            onClick={() => {
                              setCurrencyCode(c.code);
                              setCurrencyOpen(false);
                            }}
                          >
                            <span className="currency-opt-sym">{c.symbol}</span>
                            <span className="currency-opt-code">{c.code}</span>
                            <span className="currency-opt-name">{c.name}</span>
                            {c.code === currencyCode && <Check size={14} className="currency-opt-check" />}
                          </button>
                        ))}
                        {filteredCurrencies.length === 0 && (
                          <div className="currency-empty">No currency matches "{currencySearch}"</div>
                        )}
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>
            <div className="sidebar-field">
              <label>Filter</label>
              <div className="category-filters">
                {categoryOptions.map((cat) => (
                  <button
                    key={cat}
                    type="button"
                    className={`category-chip ${categoryFilter === cat ? 'active' : ''}`}
                    onClick={() => setCategoryFilter((cur) => (cur === cat ? '' : cat))}
                  >
                    {cat}
                  </button>
                ))}
              </div>
              <button
                type="button"
                className="clear-filters-btn"
                onClick={() => { setCategoryFilter(''); setSearchTerm(''); }}
              >
                Clear filters
              </button>
            </div>
          </div>

          <div className="builder-items-list">
            {pickerLoading ? (
              <div className="builder-items-empty">Searching library items...</div>
            ) : pickerItemsToShow.length === 0 && pickerPackages.length === 0 && !pickerPackagesLoading ? (
              <div className="builder-items-empty">
                <Package size={36} style={{ opacity: 0.5 }} />
                <div style={{ fontWeight: 700, color: '#64748b' }}>
                  {categoryFilter === '' && !searchTerm.trim() ? 'Pick a category or search' : 'No library items found'}
                </div>
                <div style={{ fontSize: '0.8rem' }}>
                  {categoryFilter === '' && !searchTerm.trim()
                    ? 'Select a category above (or search) to load matching library items on demand.'
                    : 'Try a different search, category, or currency.'}
                </div>
              </div>
            ) : (
              pickerItemsToShow.map((item) => {
                /* Resolve the season that will actually be used when this item
                   is dropped — the same logic createService() uses. Showing the
                   correctly-dated price in the sidebar prevents the operator
                   from being surprised when the line lands with a different
                   figure than what the sidebar advertised. */
                const sidebarSeason = resolveSeasonForTravel({
                  rates: item.item_rates || [],
                  currencyCode,
                  startDate: travelWindow.start,
                  endDate: travelWindow.end,
                  protectionPercent: 0  // sidebar shows raw price, not uplifted
                });
                /* Use the resolved rate row for display; fall back to the first
                   available rate when no season resolves (will show as 0 or
                   the raw price, consistent with what would happen on drop). */
                const sidebarRate = sidebarSeason.rate || rateForItem(item, currencyCode);
                const sidebarItem = sidebarRate ? { ...item, item_rates: [sidebarRate] } : item;
                /* Same season as the price below: rate_basis is per row, so a
                   matrix that prices summer per-person and winter per-room must
                   label the row this trip actually uses. */
                const basis = basisOfItem(sidebarItem, currencyCode);
                /* The sidebar mirrors the Library Items contract figure. Flat
                   rates stay whole here; only createService derives their
                   per-traveller Buy / pax amount for the itinerary line. */
                const price = sidebarLibraryRate(sidebarItem, currencyCode, paxCount);
                /* Build a human-readable pricing label that reflects the actual
                   tier being shown, so the operator can immediately tell whether
                   the figure is a single supplement, a sharing rate, etc. */
                const isAccomBasis = basis === 'per_person_sharing' || /accommodation/i.test(item.category || '');
                const isFlat = isFlatBasis(basis) || isFlatRoomRate(sidebarRate);
                let priceUnit;
                if (isFlat) {
                  priceUnit = basisLabelOf(basis);
                } else if (isAccomBasis) {
                  /* Show the tier that paxCount resolves to, so the label matches
                     the number shown: single when 1 pax, sharing when 2+. */
                  priceUnit = paxCount <= 1 ? 'per person (single)' : 'per person sharing';
                } else {
                  priceUnit = basis === 'per_person' ? 'per person' : basisLabelOf(basis).toLowerCase();
                }
                /* Warn when no exact season covers the travel dates — the price
                   shown is the closest prior season (or undated), so the figure
                   may change once the correct season is loaded. */
                const noExactSeason = sidebarSeason.status === 'protected' || sidebarSeason.status === 'undated';
                return (
                  <div
                    key={item.id}
                    className={`draggable-item ${isReadOnly ? 'locked' : ''}`}
                    draggable={!isReadOnly}
                    onDragStart={(e) => { if (isReadOnly) return; handleItemDragStart(e, item); }}
                    onDoubleClick={() => { if (isReadOnly) return; addService(selectedDayIndex, item, 'double-click'); }}
                    title={isReadOnly ? 'Locked itinerary is read-only' : 'Drag or double-click to choose placement'}
                  >
                    <div className="draggable-item-top">
                      <span className="draggable-item-name">{item.name}</span>
                      <GripVertical size={16} style={{ color: '#cbd5e1', flexShrink: 0 }} />
                    </div>
                    <div className="draggable-item-meta">
                      <span className="item-cat-tag">{item.category || 'General'}</span>
                      <span className="item-price-tag">{fmtMoney(price, currencySymbol)}<span style={{ color: '#94a3b8', fontWeight: 500 }}>{` ${priceUnit}`}</span></span>
                    </div>
                    <div className="draggable-item-supplier">
                      {item.supplier?.name || ''}
                      {isFlatBasis(basis) ? <span className="basis-tag">{basisLabelOf(basis)}</span> : null}
                      {noExactSeason && sidebarSeason.seasonName && (
                        <span className="basis-tag" style={{ color: '#b45309', background: '#fffbeb', borderColor: '#fde68a' }} title={`No season covers ${travelWindow.start || 'the travel dates'}; showing ${sidebarSeason.seasonName} season price`}>
                          ⚠ {sidebarSeason.seasonName}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })

            )}
            {pickerPackages.length > 0 && (
              <div className="builder-package-items">
                <h3>Packages</h3>
                {pickerPackages.map((pkg) => (
                  <article className="draggable-item builder-package-item" key={pkg.id}>
                    <div className="draggable-item-top"><span className="draggable-item-name">{pkg.name}</span></div>
                    {pkg.description && <p>{pkg.description}</p>}
                    <div className="draggable-item-meta">
                      <span className="item-cat-tag">Reusable package</span>
                      <span className="item-price-tag">{Number(pkg.default_markup_percentage) || 0}% default markup</span>
                    </div>
                    <button type="button" className="secondary-btn" disabled={isReadOnly || !currentDay}
                      onClick={() => addPackageToDay(selectedDayIndex, pkg)}>
                      Add to Day {selectedDayIndex + 1}
                    </button>
                  </article>
                ))}
              </div>
            )}
            {pickerPackagesLoading && <div className="builder-items-empty">Loading packages...</div>}
          </div>
        </aside>

        {/* -- Main panel --------------------------------------------------- */}
        <div className={`builder-main ${tab === 'finance' ? 'builder-main-finance' : ''}`}>
          {/* Header card */}
          <div className="builder-header-card">
            <div>
              <h2>
                {meta.itineraryName}
                {meta.referenceNumber && <span className="ref-badge">{meta.referenceNumber}</span>}
              </h2>
              <div className="builder-info-row">
                <span className="builder-info-piece">
                  <Calendar size={14} /> <strong>{meta.travelStart || '—'}</strong> &rarr; <strong>{meta.travelEnd || '—'}</strong>
                </span>
                <span className="builder-info-piece">
                  <User size={14} /> <strong>{meta.client?.name || 'No client'}</strong>
                </span>
                <span className="builder-info-piece">
                  <Users size={14} /> <strong>{paxCount > 0 ? `${paxCount} traveller${paxCount === 1 ? '' : 's'}` : 'No travellers'}</strong>
                </span>
                <div className="menu-popover status-popover">
                  <button
                    type="button"
                    className={`status-badge ${STATUS_MOD[meta.status] || ''}`}
                    style={{ border: '1px solid transparent', cursor: 'pointer' }}
                    onClick={() => setStatusMenuOpen((prev) => !prev)}
                  >
                    {statusLabelOf(meta.status)}
                  </button>
                  {statusMenuOpen && (
                    <>
                      <div className="menu-overlay" onClick={() => setStatusMenuOpen(false)} />
                      <div className="menu-panel" style={{ right: 0, top: 'calc(100% + 6px)', minWidth: '160px' }}>
                        {STATUS_OPTIONS.map((s) => (
                          <button
                            type="button"
                            key={s.value}
                            className="menu-item"
                            style={{ fontWeight: meta.status === s.value ? 700 : 600, background: meta.status === s.value ? '#f0fdfa' : 'transparent' }}
                            onClick={() => {
                              if (s.value === 'confirmed' && !canConfirmBooking()) {
                                const count = (days || []).reduce((n, d) => n + (d.services || []).length, 0);
                                showToast(
                                  count
                                    ? 'All services must be marked OK (Time, Confirmation no. & Flight no. required) before confirming this booking'
                                    : 'Add at least one service to this itinerary before confirming the booking',
                                  'warning'
                                );
                                setStatusMenuOpen(false);
                                return;
                              }
                              setMeta((prev) => ({ ...prev, status: s.value }));
                              setStatusMenuOpen(false);
                            }}
                          >
                            <span className={`status-dot ${s.value}`} /> {s.label}
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </div>
                {saved && (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.78rem', fontWeight: 700, color: '#166534' }}>
                    <CheckCircle2 size={14} /> Saved
                  </span>
                )}
              </div>
            </div>
            <div className="builder-actions">
<button type="button" className="icon-btn outline" onClick={handleCopy} disabled={isReadOnly} title={isReadOnly ? 'Copying days is locked on this itinerary' : 'Copy days from another itinerary'}>
                <Copy size={15} />
              </button>
              <button type="button" className="icon-btn outline" onClick={() => setDetailsOpen(true)} disabled={isReadOnly} title={isReadOnly ? 'Details are locked on this itinerary' : 'Edit client & tour details'}>
                <Edit3 size={16} /> Edit
              </button>
              {!isCancelled && (
              <div className="menu-popover">
                <button type="button" className="icon-btn outline" onClick={() => setExportOpen(!exportOpen)}>
                  <FileDown size={16} /> Export
                </button>
                {exportOpen && (
                  <>
                    <div className="menu-overlay" style={{ inset: 0 }} onClick={() => setExportOpen(false)} />
                    <div className="menu-panel" style={{ right: 0, top: 'calc(100% + 4px)' }}>
                      <button type="button" className="menu-item" onClick={() => handleExport('word')} disabled={!itineraryDocAllowed} title={itineraryDocAllowed ? 'Itinerary document (Word)' : 'Only available for Quotation and Provisional bookings'}>
                        <FileText size={15} /> Word
                      </button>
                      <button type="button" className="menu-item" onClick={() => handleExport('excel')}>
                        <FileSpreadsheet size={15} /> Excel
                      </button>
                      <button type="button" className="menu-item" onClick={() => handleExport('pdf')} disabled={!itineraryDocAllowed} title={itineraryDocAllowed ? 'Itinerary document (PDF)' : 'Only available for Quotation and Provisional bookings'}>
                        <Printer size={15} /> PDF
                      </button>
                      <button type="button" className="menu-item" onClick={() => handleExport('link')} disabled={!itineraryDocAllowed} title={itineraryDocAllowed ? 'Digital itinerary link' : 'Only available for Quotation and Provisional bookings'}>
                        <Link2 size={15} /> Digital Link
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}
              <button type="button" className="icon-btn teal" disabled={saving} onClick={handleSave}>
                <Save size={16} /> {saving ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>

          {isReadOnly && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', background: isCancelled ? '#fee2e2' : isCompleted ? '#f3e8ff' : '#fff7ed', border: `1px solid ${isCancelled ? '#fecaca' : isCompleted ? '#e9d5ff' : '#fed7aa'}`, color: isCancelled ? '#b91c1c' : isCompleted ? '#6b21a8' : '#9a3412', borderRadius: '12px', padding: '0.85rem 1.1rem', fontSize: '0.88rem', fontWeight: 600, marginBottom: '1rem' }}>
              <Lock size={16} />
              <div>
                {isCancelled
                  ? <>This itinerary is <strong>Cancelled</strong> and revoked. Change its status from the badge above to re-open it.</>
                  : isCompleted
                    ? <>This itinerary is <strong>Completed</strong> and read-only. Change its status from the badge above to edit it again.</>
                    : <>This itinerary is <strong>{isProvisional ? 'Provisional Booking' : 'Confirmed Booking'}</strong> and locked for editing. Change its status back to <strong>Quotation</strong> from the badge above to make changes.</>}
                {isProvisional && (
                  <div style={{ marginTop: '0.3rem', fontWeight: 500, opacity: 0.9 }}>
                    Supplier confirmations on the Service Request tab stay editable so this booking can still be confirmed.
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Tabs — hidden stages are locked out of their documents */}
          <div className="builder-tabs">
            <button type="button" className={`builder-tab ${tab === 'itinerary' ? 'active' : ''}`} onClick={() => setActiveTab('itinerary')}>
              <Route size={15} /> Itinerary
            </button>
            <button type="button" className={`builder-tab ${tab === 'client' ? 'active' : ''}`} onClick={() => setActiveTab('client')}>
              <User size={15} /> Travelers Info
            </button>
            <button type="button" className={`builder-tab ${tab === 'pricing' ? 'active' : ''}`} onClick={() => setActiveTab('pricing')}>
              <Receipt size={15} /> Pricing
            </button>
            <button type="button" className={`builder-tab ${tab === 'notes' ? 'active' : ''}`} onClick={() => setActiveTab('notes')}>
              <StickyNote size={15} /> Notes
            </button>
            {visibleTabIds.includes('finance') && (
              <button type="button" className={`builder-tab ${tab === 'finance' ? 'active' : ''}`} onClick={() => setActiveTab('finance')}>
                <Receipt size={15} /> Finance
              </button>
            )}
            {isProvisional && (
              <button type="button" className={`builder-tab ${tab === 'service-request' ? 'active' : ''}`} onClick={() => setActiveTab('service-request')}>
                <Mail size={15} /> Service Request
              </button>
            )}
            {(isConfirmed || isInProgress) && (
              <>
                <button type="button" className={`builder-tab ${tab === 'travel-docs' ? 'active' : ''}`} onClick={() => setActiveTab('travel-docs')}>
                  <Plane size={15} /> Travel Documents
                </button>
                <button type="button" className={`builder-tab ${tab === 'vouchers' ? 'active' : ''}`} onClick={() => setActiveTab('vouchers')}>
                  <Ticket size={15} /> Vouchers
                </button>
              </>
            )}
            {isInProgress && (
              <button type="button" className={`builder-tab ${tab === 'operations' ? 'active' : ''}`} onClick={() => setActiveTab('operations')}>
                <Calendar size={15} /> Operations
              </button>
            )}
            {isCompleted && (
              <button type="button" className={`builder-tab ${tab === 'post-tour' ? 'active' : ''}`} onClick={() => setActiveTab('post-tour')}>
                <CheckCircle2 size={15} /> Post-Tour
              </button>
            )}
            {isCancelled && (
              <button type="button" className={`builder-tab ${tab === 'cancellation' ? 'active' : ''}`} onClick={() => setActiveTab('cancellation')}>
                <X size={15} /> Cancellation
              </button>
            )}
          </div>

          {/* Day-by-day */}
          {tab === 'itinerary' && (
            <>
              <div className="day-strip-wrap" style={{ flexShrink: 0 }}>
                <div className="day-strip">
                  {days.map((d, i) => {
                    const t = dayTotals(d);
                    return (
                      <button
                        key={d.key}
                        type="button"
                        className={`day-strip-card ${selectedDayIndex === i ? 'active' : ''}`}
                        onClick={() => { setSelectedDayIndex(i); setDragOverKey(null); }}
                      >
                        <div className="day-strip-card-title">Day {d.dayNumber}</div>
                        <div className="day-strip-card-date">{formatDateLong(d.date) || ''}</div>
                        <div className="day-strip-card-summary">
                          <span>{t.count} item{t.count === 1 ? '' : 's'}</span>
                          <span>{fmtMoney(t.sell, currencySymbol)}</span>
                        </div>
                      </button>
                    );
                  })}
                  <button type="button" className="day-add-chip" onClick={addDay} disabled={isReadOnly} title={isReadOnly ? 'Locked itinerary is read-only' : 'Add Day'}>
                    <Plus size={15} /> Add Day
                  </button>
                </div>
              </div>

              {currentDay && (
                <div
                  className={`day-workspace ${isDragOver ? 'dragging' : ''}`}
                  onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
                  onDragLeave={() => setIsDragOver(false)}
                  onDrop={(e) => handleDayDrop(selectedDayIndex, e)}
                >
                  <div className="day-workspace-header">
                    <div className="day-workspace-title">
                      <h3>Day {currentDay.dayNumber}</h3>
                      <span className="day-date">{formatDateLong(currentDay.date) || ''}</span>
                      <span className="selected-chip"><Check size={12} /> Selected</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                      <div className="day-totals">
                        {(() => {
                          const t = dayTotals(currentDay);
                          return (
                            <>
                              <span className="day-total-pill buy"><span className="label">Total Buy</span>{fmtMoney(t.buy, currencySymbol)}</span>
                              <span className="day-total-pill sell"><span className="label">Total Sell</span>{fmtMoney(t.sell, currencySymbol)}</span>
                            </>
                          );
                        })()}
                      </div>
                      <div className="day-workspace-actions">
                        {!isReadOnly && (
                        <div className="menu-popover">
                          <button type="button" className="action-btn" title="Day options" onClick={() => setKebabFor(kebabFor === selectedDayIndex ? null : selectedDayIndex)}>
                            <MoreVertical size={16} />
                          </button>
                          {kebabFor === selectedDayIndex && (
                            <>
                              <div className="menu-overlay" onClick={() => setKebabFor(null)} />
                              <div className="menu-panel">
                                  <button type="button" className="menu-item" onClick={() => { setKebabFor(null); setDayNotesDay(selectedDayIndex); }}>
                                    <StickyNote size={15} /> Day Notes…
                                  </button>
                                  <button type="button" className="menu-item" onClick={() => duplicateDay(selectedDayIndex)}>
                                    <Layers size={15} /> Duplicate Day
                                  </button>
                                <button type="button" className="menu-item" onClick={() => clearDay(selectedDayIndex)}>
                                  <Eraser size={15} /> Clear All Services
                                </button>
                                <button type="button" className="menu-item danger" onClick={() => deleteDay(selectedDayIndex)}>
                                  <Trash2 size={15} /> Delete Day
                                </button>
                              </div>
                            </>
                          )}
                        </div>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="day-services">
                    {(currentDay.services && currentDay.services.length > 0) && (
                      <div className="svc-grid-head">
                        <span className="svc-grip-cell" />
                        <span>Service</span>
                        <span className="svc-head-buy">Buy /pax</span>
                        <span className="svc-head-markup">Markup</span>
                        <span className="svc-head-sell">Sell /pax</span>
                        <span className="svc-head-line">Total</span>
                        <span />
                      </div>
                    )}
                    {(currentDay.services || []).map((sv) => {
                      const servicePax = paxForService(sv, paxCount);
                      const sellLine = round2((Number(sv.sellPP) || 0) * servicePax);
                      return (
                        <div
                          key={sv.key}
                          className={`service-row ${dragOverKey === sv.key ? 'drag-over' : ''}`}
                          draggable={!isReadOnly}
                          onDragStart={(e) => { if (isReadOnly) return; handleServiceDragStart(e, selectedDayIndex, sv.key); }}
                          onDragOver={(e) => { if (isReadOnly) return; e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setDragOverKey(sv.key); }}
                          onDragLeave={() => setDragOverKey((cur) => (cur === sv.key ? null : cur))}
                          onDrop={(e) => { if (isReadOnly) return; handleServiceDrop(e, selectedDayIndex, sv.key); }}
                        >
                          <div className="svc-grip-cell">
                            {isReadOnly ? null : <GripVertical size={16} style={{ color: '#cbd5e1', cursor: 'grab' }} />}
                          </div>
<div className="service-row-main">
                            <button
                              type="button"
                              className="service-row-name"
                              title={isReadOnly ? 'Locked on this itinerary' : 'Edit service name & description'}
                              disabled={isReadOnly}
                              onClick={() => { if (isReadOnly) return; openServiceEditor(selectedDayIndex, sv); }}
                            >
                              {repairText(sv.name)}
                              {isReadOnly ? null : <Pencil size={13} className="service-row-name-edit" />}
                            </button>
                            <div className="service-row-meta">
                              {sv.category || 'General'}
                              {sv.supplierName ? ` · ${sv.supplierName}` : ''}
                              {servicePax > 0 ? ` · ${servicePax} pax` : ''}
                              {sv.currencyCode ? ` · ${sv.currencyCode}` : ''}
                              <span className={`basis-tag ${isFlatBasis(sv.basis) ? 'flat' : ''}`}>
                                {basisLabelOf(sv.basis)}
                              </span>
                            </div>
                            {sv.packageSnapshot && (
                              <div className="itinerary-package-details">
                                <button type="button" className="package-snapshot-toggle"
                                  aria-expanded={!!expandedPackageRows[sv.key]}
                                  onClick={() => setExpandedPackageRows((prev) => ({ ...prev, [sv.key]: !prev[sv.key] }))}>
                                  <Layers size={13} /> {expandedPackageRows[sv.key] ? 'Hide package services' : `Show package services (${(sv.packageSnapshot.days || []).reduce((sum, day) => sum + (day.services || []).length, 0)})`}
                                </button>
                                {expandedPackageRows[sv.key] && <div className="package-snapshot-services">
                                  {sv.packageSnapshot.days?.length ? sv.packageSnapshot.days.map((packageDay, dayIndex) => (
                                    <section key={`${sv.key}-day-${dayIndex}`}>
                                      <strong>Package Day {packageDay.day_number || dayIndex + 1}</strong>
                                      {(packageDay.services || []).map((service, serviceIndex) => (
                                        <div className="package-snapshot-service" key={`${sv.key}-${dayIndex}-${serviceIndex}`}>
                                          <span>{service.category || 'Service'}: {service.item_name}{service.is_included === false ? ' (optional)' : ''}</span>
                                          <small>{service.supplier_name || 'Supplier not specified'}{service.currency_code ? ` · ${service.currency_code} ${round2((isFlatBasis(service.rate_basis) ? Number(service.unit_cost || 0) / Math.max(1, paxCount) : Number(service.unit_cost || 0)) * (1 + (Number(sv.markup) || 0) / 100) * (Number(service.quantity) || 1)).toFixed(2)}` : ''}</small>
                                          {!isReadOnly && <button type="button" className="package-snapshot-remove"
                                            title={`Remove ${service.item_name || 'service'} from this package`}
                                            aria-label={`Remove ${service.item_name || 'service'} from this package in the itinerary`}
                                            onClick={() => removePackageService(selectedDayIndex, sv.key, dayIndex, serviceIndex)}>
                                            <Trash2 size={13} />
                                          </button>}
                                        </div>
                                      ))}
                                    </section>
                                  )) : <span>No services are saved in this package yet.</span>}
                                </div>}
                              </div>
                            )}
                            {/accommodation/i.test(sv.category || '') && (
                              <div style={{ marginTop: '0.35rem' }}>
                                {(() => {
const roomCheck = validateAccommodationServiceInDay(sv, days[selectedDayIndex]?.services || [], meta.travellers || []);
                                  const numRooms = sv.roomAllocations?.length || 0;
                                  const partyPax = (meta.travellers || []).length || paxCount;
                                  const paxHere = (sv.roomAllocations || [])
                                    .reduce((n, rm) => n + ((rm.allocatedTravellers || []).length), 0);
                                  if (roomCheck.isValid && numRooms > 0) {
                                    return (
                                      <button
                                        type="button"
                                        onClick={() => openRoomAllocationModal(selectedDayIndex, sv)}
                                        style={{
                                          display: 'inline-flex',
                                          alignItems: 'center',
                                          gap: '0.35rem',
                                          padding: '0.25rem 0.65rem',
                                          borderRadius: '6px',
                                          fontSize: '0.75rem',
                                          fontWeight: 600,
                                          background: '#dcfce7',
                                          color: '#15803d',
                                          border: '1px solid #86efac',
                                          cursor: 'pointer'
                                        }}
                                      >
                                        <CheckCircle2 size={13} /> {numRooms} Room(s) Allocated
                                        {paxHere < partyPax ? ` (${paxHere} of ${partyPax} Pax)` : ` (${paxHere} Pax)`}
                                      </button>
                                    );
                                  }
                                  return (
                                    <button
                                      type="button"
                                      onClick={() => openRoomAllocationModal(selectedDayIndex, sv)}
                                      style={{
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        gap: '0.35rem',
                                        padding: '0.25rem 0.65rem',
                                        borderRadius: '6px',
                                        fontSize: '0.75rem',
                                        fontWeight: 700,
                                        background: sv.isOptional ? '#fffbeb' : '#fee2e2',
                                        color: sv.isOptional ? '#b45309' : '#b91c1c',
                                        border: sv.isOptional ? '1px solid #fcd34d' : '1px solid #fca5a5',
                                        cursor: 'pointer'
                                      }}
                                    >
                                      {sv.isOptional
                                          ? 'Alternative · Allocate rooms if chosen'
                                          : 'Room Allocation Required'}
                                    </button>
                                  );
                                })()}
                              </div>
                            )}
                          </div>
                          <div className="svc-cell">
                            <input
                              className="svc-price-input buy"
                              type="number"
                              min="0"
                              step="0.01"
                              value={sv.buyPP}
                              disabled={isReadOnly}
                              onChange={isReadOnly ? undefined : (e) => updateServicePricing(selectedDayIndex, sv.key, 'buyPP', e.target.value)}
                              title="Buy price — the supplier rate per person. Edit it directly to negotiate."
                            />
                          </div>
                          <div className="svc-cell svc-markup-cell">
                            <input
                              className="svc-price-input markup"
                              type="number"
                              min="0"
                              step="0.5"
                              value={sv.markup ?? 0}
                              disabled={isReadOnly}
                              onChange={isReadOnly ? undefined : (e) => updateServicePricing(selectedDayIndex, sv.key, 'markup', e.target.value)}
                              title="Markup percentage applied to this service"
                            />
                            <span className="svc-markup-suffix">%</span>
                          </div>
                          <div className="svc-cell svc-sell-cell">
                            <span className="service-price sell">{fmtMoney(sv.sellPP, svcSymbol(sv.currencyCode))}</span>
                          </div>
                          <div className="svc-cell svc-line-cell">
                            <span className="service-price line">{fmtMoney(sellLine, svcSymbol(sv.currencyCode))}</span>
                          </div>
                          {isReadOnly ? null : (
                            <button type="button" className="service-remove" title="Remove" onClick={() => removeService(selectedDayIndex, sv.key)}>
                              <X size={16} />
                            </button>
                          )}
                        </div>
                      );
                    })}
                    {!currentDay.services.length && (
                      <div style={{ textAlign: 'center', color: '#94a3b8', padding: '1.25rem 0 0.25rem', fontSize: '0.9rem' }}>
                        No services added to this day yet. Drag from the left, or double-click an item.
                      </div>
                    )}
                  </div>

                  {!isReadOnly && (
                  <div
                    className={`day-drop-zone ${isDragOver ? 'dragging' : ''}`}
                    onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
                    onDragLeave={() => setIsDragOver(false)}
                    onDrop={(e) => handleDayDrop(selectedDayIndex, e)}
                  >
                    <Plus size={16} /> Drop services here
                  </div>
                  )}

                  {!isReadOnly && (
                  <div className="day-add-row">
                    <button type="button" className="secondary-btn" onClick={addDay}>
                      <Plus size={16} /> Add Another Day
                    </button>
                  </div>
                  )}
                </div>
              )}
            </>
          )}

          {/* Travelers Info tab */}
          {tab === 'client' && (
            <div className="builder-panel-card">
              <h3 style={{ fontSize: '1.1rem', fontWeight: 800, color: '#1a202c', margin: '0 0 0.25rem' }}>Travelers Info</h3>
              <p style={{ fontSize: '0.85rem', color: '#64748b', marginBottom: '1.25rem' }}>
                {paxCount} traveller(s) on this itinerary.
              </p>
              {meta.agencyRef && (
                <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: '10px', padding: '0.9rem 1.25rem', fontSize: '0.85rem', color: '#1e40af', marginBottom: '1.25rem' }}>
                  <strong>Agency Reference:</strong> {meta.agencyRef}
                </div>
              )}
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Name</th>
                    <th>Surname</th>
                    <th>Age</th>
                    <th>Note</th>
                  </tr>
                </thead>
                <tbody>
                  {(meta.travellers || []).map((t, i) => (
                    <tr key={i}>
                      <td style={{ color: '#94a3b8', fontWeight: 700 }}>{i + 1}</td>
                      <td>{t.name || '—'}</td>
                      <td>{t.surname || '—'}</td>
                      <td>{t.age || '—'}</td>
                      <td style={{ maxWidth: '22rem', whiteSpace: 'pre-wrap' }}>{t.notes || '—'}</td>
                    </tr>
                  ))}
                  {!meta.travellers?.length && (
                    <tr>
                      <td colSpan="5" style={{ color: '#94a3b8' }}>No traveller details recorded.</td>
                    </tr>
                  )}
                </tbody>
              </table>
              <h4 style={{ fontSize: '0.95rem', fontWeight: 700, color: '#334155', margin: '1.5rem 0 0.75rem' }}>Client</h4>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' }}>
                <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '1rem 1.25rem' }}>
                  <div className="company-id">Name</div>
                  <div style={{ fontWeight: 700, color: '#1a202c' }}>{meta.client?.name || '—'}</div>
                  <div className="company-id" style={{ marginTop: '0.25rem' }}>{meta.client?.client_type || ''}</div>
                </div>
                <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '1rem 1.25rem' }}>
                  <div className="company-id">Contact</div>
                  <div style={{ fontWeight: 600, color: '#1a202c' }}>{meta.client?.email || '—'}</div>
                  {meta.client?.contact_tel && <div className="company-id" style={{ marginTop: '0.25rem' }}>Tel: {meta.client.contact_tel}</div>}
                  {meta.client?.contact_cell && <div className="company-id" style={{ marginTop: '0.25rem' }}>Cell: {meta.client.contact_cell}</div>}
                </div>
                <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '1rem 1.25rem' }}>
                  <div className="company-id">Country</div>
                  <div style={{ fontWeight: 600, color: '#1a202c' }}>{meta.client?.country || '—'}</div>
                </div>
                <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '1rem 1.25rem' }}>
                  <div className="company-id">Markup</div>
                  <div style={{ fontWeight: 700, color: '#1a202c' }}>{markupPct}%</div>
                </div>
              </div>
            </div>
          )}

          {/* Pricing tab */}
          {tab === 'pricing' && (
            <div className="builder-panel-card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.5rem' }}>
                <h3 style={{ fontSize: '1.1rem', fontWeight: 800, color: '#1a202c', margin: 0 }}>Pricing Summary</h3>
                <span style={{ fontSize: '0.85rem', color: '#64748b' }}>
                  {paxCount} traveller(s) · client markup {markupPct}%
                </span>
              </div>
              {pricingGroups.length === 0 && (
                <div style={{ textAlign: 'center', color: '#94a3b8', padding: '2rem 0' }}>
                  Add services to a day to see the pricing breakdown.
                </div>
              )}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                {pricingGroups.map((g) => (
                  <section key={g.code} className="pricing-currency-section">
                    <div className="pricing-currency-head">
                      <span className="pricing-currency-sym">{g.symbol}</span>
                      <span className="pricing-currency-code">{g.code}</span>
                      {g.name && <span className="pricing-currency-name">{g.name}</span>}
                      <span className="pricing-currency-meta">{g.count} service{g.count === 1 ? '' : 's'}</span>
                    </div>
                    <table className="admin-table">
                      <thead>
                        <tr>
                          <th>Day</th>
                          <th>Date</th>
                          <th>Services</th>
                          <th>Buy ({taxWordOf(g.code)}-incl)</th>
                          <th>Sell ({taxWordOf(g.code)}-incl)</th>
                          <th>Output {taxWordUpper(g.code)}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {g.days.map((r) => (
                          <tr key={r.day}>
                            <td style={{ fontWeight: 700 }}>Day {r.day}</td>
                            <td>{r.date || '—'}</td>
                            <td>{r.count}</td>
                            <td style={{ color: '#b45309', fontWeight: 700 }}>{fmtMoney(r.buy, g.symbol)}</td>
                            <td style={{ color: '#0d7478', fontWeight: 700 }}>{fmtMoney(r.sell, g.symbol)}</td>
                            <td style={{ color: '#7c3aed', fontWeight: 700 }}>{fmtMoney(r.tax, g.symbol)}</td>
                          </tr>
                        ))}
                        <tr style={{ background: '#f8fafc' }}>
                          <td colSpan="5" style={{ textAlign: 'right', fontWeight: 700 }}>Subtotal (Excl {taxWordOf(g.code)})</td>
                          <td style={{ color: '#0d7478', fontWeight: 800 }}>{fmtMoney(g.totalExcl, g.symbol)}</td>
                        </tr>
                        {g.taxEntries.map((te) => (
                          <tr key={te.label} style={{ background: '#f8fafc' }}>
                            <td colSpan="5" style={{ textAlign: 'right', fontWeight: 700 }}>
                              {taxWordUpper(g.code)} <span style={{ fontWeight: 400, color: '#94a3b8', fontSize: '0.8rem' }}>({taxDisplayLabel(g.code, te.label, te.rate)} {Number(te.rate)}%)</span>
                            </td>
                            <td style={{ color: '#7c3aed', fontWeight: 800 }}>{fmtMoney(te.amount, g.symbol)}</td>
                          </tr>
                        ))}
                        <tr style={{ background: '#f8fafc' }}>
                          <td colSpan="5" style={{ textAlign: 'right', fontWeight: 700 }}>Input {taxWordUpper(g.code)} (on Buy, embedded)</td>
                          <td style={{ color: '#7c3aed', fontWeight: 800 }}>{fmtMoney(g.totalTaxIn, g.symbol)}</td>
                        </tr>
                        <tr style={{ background: '#f8fafc' }}>
                          <td colSpan="5" style={{ textAlign: 'right', fontWeight: 700 }}>Net {taxWordUpper(g.code)} to {taxAgencyOf(g.code, defaultRevenueAgency)} (Output - Input)</td>
                          <td style={{ color: '#7c3aed', fontWeight: 800 }}>{fmtMoney(g.totalTaxNet, g.symbol)}</td>
                        </tr>
                        <tr style={{ background: '#f0fdfa' }}>
                          <td colSpan="5" style={{ textAlign: 'right', fontWeight: 900, fontSize: '1rem' }}>
                            {g.code} TOTAL DUE (INCL {taxWordUpper(g.code)})
                          </td>
                          <td style={{ color: '#0d7478', fontWeight: 900, fontSize: '1rem' }}>
                            {fmtMoney(g.totalInclTax, g.symbol)}
                          </td>
                        </tr>
                      </tbody>
                    </table>
                    {g.optionalServices && g.optionalServices.length > 0 && (
                      <div style={{ marginTop: '0.75rem', border: '1px dashed #fcd34d', borderRadius: '10px', padding: '0.75rem 0.9rem', background: '#fffbeb' }}>
                        <div style={{ fontWeight: 800, color: '#b45309', marginBottom: '0.35rem', fontSize: '0.9rem' }}>
                          Optional &amp; Alternative Extras — {g.code}
                        </div>
                        <div style={{ fontSize: '0.78rem', color: '#92400e', marginBottom: '0.5rem' }}>
                          Not included in the {g.code} total due. Priced separately so the client can add them if they choose.
                        </div>
                        <table className="admin-table">
                          <tbody>
                            {g.optionalServices.map((sv, i) => (
                              <tr key={`${sv.itemId || 'opt'}-${i}`}>
                                <td>{repairText(sv.name || 'Service')}</td>
                                <td style={{ fontSize: '0.75rem', color: '#92400e' }}>
                                  {/accommodation/i.test(sv.category || '') ? 'Alternative' : 'Optional'}
                                </td>
                                <td className="num" style={{ color: '#0d7478', fontWeight: 700 }}>{fmtMoney(sv.sell, g.symbol)}</td>
                              </tr>
                            ))}
                            <tr style={{ background: '#fef3c7' }}>
                              <td colSpan="2" style={{ textAlign: 'right', fontWeight: 800 }}>TOTAL IF ALL ADDED ({g.code})</td>
                              <td className="num" style={{ color: '#b45309', fontWeight: 900 }}>{fmtMoney(g.optionalTotalSell, g.symbol)}</td>
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    )}
                  </section>
                ))}
              </div>
              <p style={{ fontSize: '0.8rem', color: '#94a3b8', marginTop: '1.25rem' }}>
                {pricingGroups.every((g) => isZar(g.code))
                  ? `Prices are grouped by currency, as an itinerary can mix currencies. Buy and Sell are both VAT-inclusive: the Sell price is the supplier amount plus markup (VAT included), so the client is charged the Sell total as-is. Subtotal (Excl VAT) plus the VAT rows equal TOTAL DUE (INCL. VAT). Input VAT (embedded in Buy) and Net VAT to SARS (Output minus Input, i.e. tax on the markup) are shown for internal tax records only and are never sent to the client. Each section uses its own currency.`
                  : 'Prices are grouped by currency, as an itinerary can mix currencies. Buy and Sell are both tax-inclusive: the Sell price is the supplier amount plus markup (tax included), so the client is charged the Sell total as-is. Subtotal (Excl Tax) plus the tax rows equal TOTAL DUE (INCL. TAX). Input Tax (embedded in Buy) and Net Tax (Output minus Input, i.e. tax on the markup) are shown for internal tax records only and are never sent to the client. Each section uses its own currency.'}
              </p>
            </div>
          )}

          {/* Notes tab */}
          {tab === 'notes' && (
            <div className="builder-panel-card">
              <h3 style={{ fontSize: '1.1rem', fontWeight: 800, color: '#1a202c', marginBottom: '0.5rem' }}>Itinerary Notes</h3>
              <p style={{ fontSize: '0.85rem', color: '#64748b', marginBottom: '1rem' }}>
                Internal notes for this itinerary. Saved with the rest of the itinerary.
              </p>
              <textarea
                style={{ width: '100%', minHeight: '240px', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '1rem', fontFamily: 'inherit', fontSize: '0.9rem', resize: 'vertical', outline: 'none' }}
                placeholder="Anything useful to remember about this tour..."
                value={meta.notes || ''}
                readOnly={isReadOnly}
                onChange={(e) => setMeta((prev) => ({ ...prev, notes: e.target.value }))}
              />
              <button type="button" className="primary-btn" style={{ width: 'auto', marginTop: '1rem', padding: '0.65rem 1.5rem', fontSize: '0.95rem', display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }} disabled={saving} onClick={handleSave}>
                <Save size={16} /> Save Itinerary
              </button>
            </div>
          )}

          {/* Copy modal */}
          {copyOpen && (
            <div className="modal-overlay">
              <div className="modal-content">
                <div className="modal-header">
                  <h2>Copy Itinerary Days</h2>
                  <button className="close-btn" onClick={() => setCopyOpen(false)}><X size={20} /></button>
                </div>
                <div className="sidebar-field">
                  <label>Copy from</label>
                  <SearchableSelect className="sidebar-select" value={copySourceId} onChange={(e) => setCopySourceId(e.target.value)}>
                    <option value="">Select an itinerary...</option>
                    {availableItineraries.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.itinerary_name}{a.reference_number ? ` (${a.reference_number})` : ''}
                      </option>
                    ))}
                  </SearchableSelect>
                  {availableItineraries.length === 0 && (
                    <div style={{ fontSize: '0.8rem', color: '#94a3b8', marginTop: '0.4rem' }}>
                      No other itineraries available to copy from.
                    </div>
                  )}
                </div>
                <div className="sidebar-field">
                  <label>Insert after day</label>
                  <SearchableSelect className="sidebar-select" value={copyInsertDay} onChange={(e) => setCopyInsertDay(Number(e.target.value))}>
                    {Array.from({ length: days.length + 1 }, (_, i) => (
                      <option key={i} value={i + 1}>
                        {i === days.length ? `After Day ${i} (at the end)` : `After Day ${i + 1}`}
                      </option>
                    ))}
                  </SearchableSelect>
                </div>
                <p style={{ fontSize: '0.82rem', color: '#64748b', marginTop: '1rem' }}>
                  The copied days are inserted into this itinerary. If they exceed the current date range, the travel end date is extended automatically.
                </p>
                <div className="form-actions">
                  <button type="button" className="secondary-btn" onClick={() => setCopyOpen(false)}>Cancel</button>
                  <button type="button" className="primary-btn" style={{ flex: 1 }} disabled={saving} onClick={confirmCopy}>
                    {saving ? 'Copying...' : 'Copy Days'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Edit Client & Tour details modal */}
          {detailsOpen && (
            <div className="modal-overlay">
              <div className="modal-content" style={{ maxWidth: '880px', maxHeight: '86vh', overflowY: 'auto' }}>
                <div className="modal-header">
                  <h2>Client &amp; Tour</h2>
                  <button className="close-btn" onClick={() => setDetailsOpen(false)}><X size={20} /></button>
                </div>
                <ClientTourForm
                  initial={{
                    itineraryName: meta.itineraryName,
                    clientId: meta.client?.id || '',
                    travelStart: meta.travelStart,
                    travelEnd: meta.travelEnd,
                    travellers: Array.isArray(meta.travellers) ? meta.travellers : [],
                    agencyRef: meta.agencyRef || '',
                    tourType: meta.tourType || '',
                    consultantName: meta.consultantName || ''
                  }}
                  submitLabel="Save Itinerary"
                  submitIcon={<Check size={18} />}
                  onCancel={() => setDetailsOpen(false)}
                  onSubmit={handleDetailsSave}
                />
              </div>
            </div>
          )}

          {/* --- Service Request (provisional) ---------------------------------------
     Booking enquiries for every supplier. Each service carries a confirmation
     status (RQ/OK/NA/WL/XX) recorded here as select buttons — these are the
     provisional enquiry results. Confirmed bookings later always reflect OK.
     Drafts are prefilled mailto: bodies derived from persisted data only.   */}
          {tab === 'service-request' && (
            <div className="builder-panel-card">
              <h3 style={{ fontSize: '1.1rem', fontWeight: 800, color: '#1a202c', marginBottom: '0.4rem' }}>
                Provisional Service Request
              </h3>
              <p style={{ fontSize: '0.85rem', color: '#64748b', marginBottom: '1.15rem', maxWidth: '760px' }}>
                Booking enquiries for every supplier on this tour, composed as prefilled
                <strong> mailto:</strong> drafts. Record each service's enquiry result using the
                <strong> status buttons</strong> — RQ (On Request), OK (Confirmed), NA (Not Available),
                WL (Waitlist), XX (Cancelled) — plus its <strong>time</strong>, <strong>confirmation
                number</strong> and <strong>notes</strong>. These results drive the Confirmed stage
                (which always reflects OK). Save the itinerary to persist them.
              </p>

              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '1.25rem' }}>
                <button type="button" className="primary-btn" style={{ alignItems: 'center', gap: '0.4rem', background: '#9e1e50', borderColor: '#9e1e50', color: '#fff' }} onClick={() => {
                  const perm = servicesBySupplier(days, libraryItems).filter((g) => emailOf(g.sup));
                  if (!perm.length) { showToast('No supplier email on file', 'warning'); return; }
                  const first = perm[0];
                  const m = supplierRequestEmail(first, days, meta, currencySymbol, paxCount, billing);
                  window.open(mailTo(m.to, m.subject, m.body), '_blank');
                }}>
                  <Mail size={15} /> Compose all requests
                </button>
                <span style={{ alignSelf: 'center', fontSize: '0.78rem', color: '#94a3b8' }}>
                  Opens one mailto draft per supplier. Send each from your mail client.
                </span>
              </div>

              {servicesBySupplier(days, libraryItems).map((grp) => (
                <div key={grp.key} className="supplier-request-card" style={{ border: '1px solid #e2e8f0', borderRadius: '14px', marginBottom: '0.9rem', overflow: 'hidden' }}>
                  <div className="supplier-request-head" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', padding: '0.85rem 1rem', background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.1rem' }}>
                      <strong style={{ fontSize: '0.92rem', color: '#1a202c' }}>{grp.label}</strong>
                      <span style={{ fontSize: '0.78rem', color: `${emailOf(grp.sup) ? '#16a34a' : '#dc2626'}` }}>
                        {emailOf(grp.sup) ? `? ${emailOf(grp.sup)}` : 'No email on file — add one in Suppliers'}
                      </span>
                    </div>
                    <span style={{ fontSize: '0.75rem', color: '#64748b', whiteSpace: 'nowrap' }}>{grp.svcs.length} service{grp.svcs.length === 1 ? '' : 's'}</span>
                  </div>
                  <div style={{ padding: '0.85rem 1rem' }}>
  {grp.svcs.map(({ sv, day }) => renderServiceCard(sv, day, { editable: !isTerminal, tab: 'service-request' }))}
                    <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '0.8rem' }}>
                      <button type="button" className="secondary-btn" style={{ alignItems: 'center', gap: '0.4rem', background: '#9e1e50', borderColor: '#9e1e50', color: '#fff' }} disabled={!emailOf(grp.sup)} onClick={() => {
                        const m = supplierRequestEmail(grp, days, meta, currencySymbol, paxCount, billing);
                        window.open(mailTo(m.to, m.subject, m.body), '_blank');
                      }}>
                        <Mail size={14} /> Compose ({grp.label}) request
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* --- Travel Documents (confirmed / in progress) ---------------------------
     Supplier reconfirmations. Every service is grouped under its supplier; each
     supplier gets its own compose button. The bulk button always asks the user
     first (listing the groups and mailto count) before opening the drafts.
     Per-service Time, confirmation data and category details are recorded here
     (saved with the itinerary) and appear on the supplier vouchers.          */}
          {tab === 'travel-docs' && (
            <div className="builder-panel-card">
              <h3 style={{ fontSize: '1.1rem', fontWeight: 800, color: '#1a202c', marginBottom: '0.4rem' }}>
                Travel Documents
              </h3>
              <p style={{ fontSize: '0.85rem', color: '#64748b', marginBottom: '1.15rem', maxWidth: '760px' }}>
                Reconfirm every <strong>booked</strong> service with its supplier. Each supplier has its own
                compose button; <strong>Compose all</strong> groups every service/library item under its
                supplier and asks you first before opening one draft per group. Record each service's
                <strong> time</strong>, <strong>confirmation number</strong> and category-specific details
                here — they are saved and printed on the supplier vouchers. Confirmed status always reflects
                <strong> OK</strong>.
              </p>

              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '1.25rem' }}>
                <button type="button" className="primary-btn" style={{ alignItems: 'center', gap: '0.4rem', background: '#9e1e50', borderColor: '#9e1e50', color: '#fff' }} onClick={() => {
                  const perm = servicesBySupplier(days, libraryItems).filter((g) => emailOf(g.sup));
                  if (!perm.length) { showToast('No supplier email on file', 'warning'); return; }
                  setBulkConfirmGroups(perm);
                  setBulkConfirmOpen(true);
                }}>
                  <Mail size={15} /> Compose all reconfirmations
                </button>
                <span style={{ alignSelf: 'center', fontSize: '0.78rem', color: '#94a3b8' }}>
                  Opens one mailto draft per supplier group — you are asked to confirm first.
                </span>
              </div>

              {servicesBySupplier(days, libraryItems).map((grp) => (
                <div key={grp.key} className="supplier-request-card" style={{ border: '1px solid #e2e8f0', borderRadius: '14px', marginBottom: '0.9rem', overflow: 'hidden' }}>
                  <div className="supplier-request-head" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', padding: '0.85rem 1rem', background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.1rem' }}>
                      <strong style={{ fontSize: '0.92rem', color: '#1a202c' }}>{grp.label}</strong>
                      <span style={{ fontSize: '0.78rem', color: `${emailOf(grp.sup) ? '#16a34a' : '#dc2626'}` }}>
                        {emailOf(grp.sup) ? `? ${emailOf(grp.sup)}` : 'No email on file — add one in Suppliers'}
                      </span>
                    </div>
                    <span style={{ fontSize: '0.75rem', color: '#64748b', whiteSpace: 'nowrap' }}>{grp.svcs.length} service{grp.svcs.length === 1 ? '' : 's'}</span>
                  </div>
                  <div style={{ padding: '0.85rem 1rem' }}>
                    {grp.svcs.map(({ sv, day }) => renderServiceCard(sv, day, { editable: false, tab: 'travel-documents' }))}
                    <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '0.8rem' }}>
                      <button type="button" className="secondary-btn" style={{ alignItems: 'center', gap: '0.4rem', background: '#9e1e50', borderColor: '#9e1e50', color: '#fff' }} disabled={!emailOf(grp.sup)} onClick={() => {
                        const m = supplierConfirmationEmail(grp, days, meta, currencySymbol, paxCount, billing);
                        window.open(mailTo(m.to, m.subject, m.body), '_blank');
                      }}>
                        <FileText size={14} /> Compose reconfirmation to {grp.label}
                      </button>
                    </div>
                  </div>
                </div>
              ))}

              {bulkConfirmOpen && (
                <div className="modal-overlay" onClick={() => setBulkConfirmOpen(false)}>
                  <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '520px' }}>
                    <div className="modal-header">
                      <h2>Compose all reconfirmations</h2>
                      <button className="close-btn" onClick={() => setBulkConfirmOpen(false)}><X size={20} /></button>
                    </div>
                    <div style={{ fontSize: '0.85rem', color: '#334155', marginBottom: '0.9rem' }}>
                      This will open <strong>{bulkConfirmGroups.length} mailto draft{bulkConfirmGroups.length === 1 ? '' : 's'}</strong>
                      , one per supplier group:
                    </div>
                    <ul style={{ margin: '0 0 1rem 0', paddingLeft: '1.2rem', display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
                      {bulkConfirmGroups.map((g) => (
                        <li key={g.key} style={{ fontSize: '0.84rem', color: '#475569' }}>
                          <strong>{g.label}</strong>
                          <span style={{ color: '#94a3b8' }}> — {g.svcs.length} service{g.svcs.length === 1 ? '' : 's'} · {g.email}</span>
                        </li>
                      ))}
                    </ul>
                    <div className="form-actions">
                      <button type="button" className="secondary-btn" onClick={() => setBulkConfirmOpen(false)}>Cancel</button>
                      <button
                        type="button"
                        className="primary-btn"
                        onClick={() => {
                          bulkConfirmGroups.forEach((g) => {
                            const m = supplierConfirmationEmail(g, days, meta, currencySymbol, paxCount, billing);
                            window.open(mailTo(m.to, m.subject, m.body), '_blank');
                          });
                          setBulkConfirmOpen(false);
                          showToast(`${bulkConfirmGroups.length} draft${bulkConfirmGroups.length === 1 ? '' : 's'} opened in your email client`, 'success');
                        }}
                      >
                        <Mail size={15} /> Open {bulkConfirmGroups.length} draft{bulkConfirmGroups.length === 1 ? '' : 's'}
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* --- Payment capture: the amount is collected, not assumed --- */}
          {paymentPrompt && (
            <div className="modal-overlay" onClick={() => !issuingInvoice && setPaymentPrompt(null)}>
              <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '520px' }}>
                <div className="modal-header">
                  <h2>Record payment</h2>
                  <button className="close-btn" onClick={() => !issuingInvoice && setPaymentPrompt(null)}><X size={20} /></button>
                </div>
                <div style={{ fontSize: '0.85rem', color: '#334155', marginBottom: '0.9rem' }}>
                  Record the amount actually received against <strong>{paymentPrompt.invoice_number}</strong>.
                  Any amount above the outstanding balance is recorded as an unresolved overpayment for later refund or credit.
                </div>

                {paymentInvoicesByCurrency.length > 1 && (
                  <>
                    <label htmlFor="payment-currency" style={{ display: 'block', fontSize: '0.8rem', color: '#475569', marginBottom: '0.3rem', fontWeight: 600 }}>
                      Currency / invoice
                    </label>
                    <select
                      id="payment-currency"
                      value={paymentPrompt.currency_code}
                      onChange={(event) => changePaymentCurrency(event.target.value)}
                      style={{ width: '100%', padding: '0.55rem 0.7rem', border: '1px solid #cbd5e1', borderRadius: '6px', fontSize: '0.95rem', marginBottom: '0.8rem' }}
                    >
                      {paymentInvoicesByCurrency.map((invoice) => (
                        <option key={invoice.id} value={invoice.currency_code}>
                          {invoice.currency_code} — {invoice.invoice_number} — {invoice.derivedBalance > 0.009
                            ? `${svcSymbol(invoice.currency_code)}${invoice.derivedBalance.toFixed(2)} outstanding`
                            : 'paid; additional payment allowed'}
                        </option>
                      ))}
                    </select>
                  </>
                )}

                <label style={{ display: 'block', fontSize: '0.8rem', color: '#475569', marginBottom: '0.3rem', fontWeight: 600 }}>
                  Amount received ({paymentPrompt.currency_code})
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  autoFocus
                  value={paymentForm.amount}
                  onChange={(e) => setPaymentForm({ ...paymentForm, amount: e.target.value })}
                  style={{ width: '100%', padding: '0.55rem 0.7rem', border: '1px solid #cbd5e1', borderRadius: '6px', fontSize: '0.95rem', marginBottom: '0.8rem' }}
                />

                <label style={{ display: 'block', fontSize: '0.8rem', color: '#475569', marginBottom: '0.3rem', fontWeight: 600 }}>
                  Date received
                </label>
                <input
                  type="date"
                  value={paymentForm.received_date}
                  onChange={(e) => setPaymentForm({ ...paymentForm, received_date: e.target.value })}
                  style={{ width: '100%', padding: '0.55rem 0.7rem', border: '1px solid #cbd5e1', borderRadius: '6px', fontSize: '0.95rem', marginBottom: '0.8rem' }}
                />

                <label style={{ display: 'block', fontSize: '0.8rem', color: '#475569', marginBottom: '0.3rem', fontWeight: 600 }}>
                  Payment method
                </label>
                <input
                  type="text"
                  value={paymentForm.payment_method}
                  onChange={(e) => setPaymentForm({ ...paymentForm, payment_method: e.target.value })}
                  placeholder="EFT, card, cash"
                  style={{ width: '100%', padding: '0.55rem 0.7rem', border: '1px solid #cbd5e1', borderRadius: '6px', fontSize: '0.95rem', marginBottom: '0.8rem' }}
                />

                <label style={{ display: 'block', fontSize: '0.8rem', color: '#475569', marginBottom: '0.3rem', fontWeight: 600 }}>
                  Bank reference
                </label>
                <input
                  type="text"
                  value={paymentForm.payment_reference}
                  onChange={(e) => setPaymentForm({ ...paymentForm, payment_reference: e.target.value })}
                  placeholder="Transaction ID (optional)"
                  style={{ width: '100%', padding: '0.55rem 0.7rem', border: '1px solid #cbd5e1', borderRadius: '6px', fontSize: '0.95rem', marginBottom: '0.9rem' }}
                />

                <div style={{ fontSize: '0.85rem', color: '#334155', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '6px', padding: '0.6rem 0.75rem', marginBottom: '0.9rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span>Invoice balance before payment</span>
                    <strong>{svcSymbol(paymentPrompt.currency_code)}{paymentPrompt.derivedBalance.toFixed(2)}</strong>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '0.3rem' }}>
                    <span>Invoice balance after this payment</span>
                    <strong>{svcSymbol(paymentPrompt.currency_code)}{balanceAfterPayment(paymentPrompt, Number(paymentForm.amount) || 0).toFixed(2)}</strong>
                  </div>
                  {Number(paymentForm.amount) > paymentPrompt.derivedBalance + 0.009 && (
                    <div role="status" style={{ marginTop: '0.45rem', color: '#9a3412', fontWeight: 700 }}>
                      Unresolved overpayment to record: {svcSymbol(paymentPrompt.currency_code)}{(Number(paymentForm.amount) - paymentPrompt.derivedBalance).toFixed(2)}. You can resolve it later from the itinerary summary.
                    </div>
                  )}
                </div>

                <div className="form-actions">
                  <button type="button" className="secondary-btn" disabled={issuingInvoice} onClick={() => setPaymentPrompt(null)}>Cancel</button>
                  <button type="button" className="primary-btn" disabled={issuingInvoice || !(Number(paymentForm.amount) > 0.009)} onClick={submitPayment}>
                    <CheckCircle2 size={15} /> Raise receipt
                  </button>
                </div>
              </div>
            </div>
          )}

          {overpaymentPrompt && (() => {
            const candidate = overpaymentPrompt.candidates.find((entry) => entry.invoice.id === overpaymentPrompt.selectedInvoiceId);
            const amount = Number(overpaymentAmount) || 0;
            return (
              <div className="modal-overlay" onClick={() => !issuingInvoice && setOverpaymentPrompt(null)}>
                <div className="modal-content" onClick={(event) => event.stopPropagation()} style={{ maxWidth: '560px' }}>
                  <div className="modal-header">
                    <h2>Resolve {overpaymentPrompt.currency} overpayment</h2>
                    <button className="close-btn" disabled={issuingInvoice} onClick={() => setOverpaymentPrompt(null)}><X size={20} /></button>
                  </div>
                  <p style={{ color: '#475569', fontSize: '0.88rem', lineHeight: 1.5 }}>
                    There is {svcSymbol(overpaymentPrompt.currency)}{overpaymentPrompt.amount.toFixed(2)} of unresolved overpayment. Choose whether to return the excess to the client or issue a credit note that stays in the client's {overpaymentPrompt.currency} credit balance.
                  </p>
                  <label htmlFor="overpayment-invoice" style={{ display: 'block', fontSize: '0.8rem', fontWeight: 700, color: '#475569', marginBottom: '0.3rem' }}>
                    Invoice containing the excess payment
                  </label>
                  <select
                    id="overpayment-invoice"
                    value={overpaymentPrompt.selectedInvoiceId}
                    disabled={issuingInvoice}
                    onChange={(event) => {
                      const selected = overpaymentPrompt.candidates.find((entry) => entry.invoice.id === event.target.value);
                      if (!selected) return;
                      setOverpaymentPrompt((current) => current
                        ? { ...current, selectedInvoiceId: selected.invoice.id }
                        : current);
                      setOverpaymentAmount(Math.min(overpaymentPrompt.amount, selected.available).toFixed(2));
                    }}
                    style={{ width: '100%', padding: '0.55rem 0.7rem', border: '1px solid #cbd5e1', borderRadius: '6px', fontSize: '0.95rem', marginBottom: '0.8rem' }}
                  >
                    {overpaymentPrompt.candidates.map((entry) => (
                      <option key={entry.invoice.id} value={entry.invoice.id}>
                        {entry.invoice.invoice_number} — up to {svcSymbol(overpaymentPrompt.currency)}{entry.available.toFixed(2)}
                      </option>
                    ))}
                  </select>
                  <label htmlFor="overpayment-resolution-amount" style={{ display: 'block', fontSize: '0.8rem', fontWeight: 700, color: '#475569', marginBottom: '0.3rem' }}>
                    Amount to resolve
                  </label>
                  <input
                    id="overpayment-resolution-amount"
                    type="number"
                    min="0.01"
                    max={candidate?.available || 0}
                    step="0.01"
                    value={overpaymentAmount}
                    disabled={issuingInvoice}
                    onChange={(event) => setOverpaymentAmount(event.target.value)}
                    style={{ width: '100%', padding: '0.55rem 0.7rem', border: '1px solid #cbd5e1', borderRadius: '6px', fontSize: '0.95rem', marginBottom: '0.8rem' }}
                  />
                  <label htmlFor="overpayment-resolution-reason" style={{ display: 'block', fontSize: '0.8rem', fontWeight: 700, color: '#475569', marginBottom: '0.3rem' }}>
                    Reason
                  </label>
                  <textarea
                    id="overpayment-resolution-reason"
                    value={overpaymentReason}
                    disabled={issuingInvoice}
                    onChange={(event) => setOverpaymentReason(event.target.value)}
                    rows={3}
                    style={{ width: '100%', padding: '0.55rem 0.7rem', border: '1px solid #cbd5e1', borderRadius: '6px', fontSize: '0.9rem', marginBottom: '1rem', resize: 'vertical', fontFamily: 'inherit' }}
                  />
                  <div className="form-actions">
                    <button type="button" className="secondary-btn" disabled={issuingInvoice} onClick={() => setOverpaymentPrompt(null)}>Cancel</button>
                    <button
                      type="button"
                      className="secondary-btn"
                      disabled={issuingInvoice || !candidate || !(amount > 0.009) || amount > candidate.refundLimit + 0.009 || !overpaymentReason.trim()}
                      onClick={() => resolveOverpayment('refund')}
                    >
                      {issuingInvoice ? 'Processing…' : 'Refund to client'}
                    </button>
                    <button
                      type="button"
                      className="primary-btn"
                      disabled={issuingInvoice || !candidate || !(amount > 0.009) || amount > candidate.creditLimit + 0.009 || !overpaymentReason.trim()}
                      onClick={() => resolveOverpayment('credit_note')}
                    >
                      {issuingInvoice ? 'Processing…' : 'Issue credit note'}
                    </button>
                  </div>
                  {candidate && candidate.creditLimit <= 0.009 && (
                    <p style={{ margin: '0.75rem 0 0', color: '#64748b', fontSize: '0.78rem' }}>
                      This invoice cannot take an additional credit note. A refund is available up to {svcSymbol(overpaymentPrompt.currency)}{candidate.refundLimit.toFixed(2)}.
                    </p>
                  )}
                </div>
              </div>
            );
          })()}

          {/* --- Finance: invoice ledger, journals, receipts, cost of sales --- */}
          {tab === 'finance' && (
            <>
              <FinanceSection
                sectionId="statement"
                title="Statement of account"
                summary="Charges, payments and the balance in date order — share it with the client"
                open={openFinance.statement}
                onToggle={() => toggleFinance('statement')}
              >
                <div style={{ display: 'grid', gap: '0.65rem', marginBottom: '1rem' }}>
                  {statementCurrenciesHere.map((ccy) => {
                    const st = buildStatement(ccy);
                    const sym = svcSymbol(ccy);
                    const settled = Math.abs(st.closing) < 0.009;
                    return (
                      <div key={ccy} style={{ background: settled ? '#f0fdf4' : '#fff7ed', border: `1px solid ${settled ? '#bbf7d0' : '#fed7aa'}`, borderRadius: '14px', padding: '1rem 1.25rem' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '1rem', flexWrap: 'wrap' }}>
                          <div style={{ fontSize: '0.8rem', fontWeight: 800, color: settled ? '#166534' : '#9a3412' }}>
                            {ccy} · {st.closing > 0.009 ? 'Outstanding balance'
                              : st.closing < -0.009 ? 'Held in credit'
                              : 'Account settled in full'}
                          </div>
                          <div style={{ fontSize: '1.35rem', fontWeight: 900, color: settled ? '#166534' : '#9a3412' }}>
                            {sym}{Math.abs(st.closing).toFixed(2)}
                          </div>
                        </div>
                        <div style={{ display: 'flex', gap: '1.5rem', marginTop: '0.5rem', flexWrap: 'wrap', fontSize: '0.82rem', color: '#334155' }}>
                          <span>Charged: <strong>{sym}{st.charges.toFixed(2)}</strong></span>
                          <span>Paid &amp; credited: <strong>{sym}{st.payments.toFixed(2)}</strong></span>
                          <span>{st.invoiceCount} invoice{st.invoiceCount === 1 ? '' : 's'}{st.voidCount ? `, ${st.voidCount} voided` : ''}</span>
                          {st.voidCount > 0 && <span style={{ color: '#64748b' }}>{st.voidedAmount === 0 ? 'voids net to nil' : `voids net ${sym}${Math.abs(st.voidedAmount).toFixed(2)}`}</span>}
                        </div>
                        {!st.reconciles && (
                          <p style={{ margin: '0.6rem 0 0', fontSize: '0.78rem', color: '#b91c1c', fontWeight: 700 }}>
                            This statement does not reconcile to the invoice balances on file. Please check the documents.
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: '0.82rem', fontWeight: 700, color: '#475569' }}>Document currency:</span>
                  {statementCurrenciesHere.length > 1 ? (
                    <select
                      value={statementCcy}
                      onChange={(e) => setStatementCcy(e.target.value)}
                      aria-label="Statement currency"
                      style={{ padding: '0.4rem 0.5rem', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '0.82rem' }}
                    >
                      {statementCurrenciesHere.map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                  ) : (
                    <strong style={{ fontSize: '0.82rem', color: '#475569' }}>{statementCcy}</strong>
                  )}
                  <button type="button" className="secondary-btn" style={{ alignItems: 'center', gap: '0.4rem' }} onClick={viewStatement}>
                    View / print
                  </button>
                  <SearchableSelect
                    value={statementFormat}
                    onChange={(e) => setStatementFormat(e.target.value)}
                    aria-label="Statement file format"
                    style={{ padding: '0.4rem 0.5rem', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '0.82rem' }}
                  >
                    <option value="doc">Word</option>
                    <option value="xls">Excel</option>
                    <option value="csv">CSV</option>
                  </SearchableSelect>
                  <button type="button" className="secondary-btn" style={{ alignItems: 'center', gap: '0.4rem' }} onClick={downloadStatement}>
                    Download
                  </button>
                  <button type="button" className="secondary-btn" style={{ alignItems: 'center', gap: '0.4rem' }} onClick={emailStatement}>
                    Email to client
                  </button>
                </div>
              </FinanceSection>

              <FinanceSection
                sectionId="ledger"
                title="Invoices &amp; journal"
                summary={`${itineraryInvoices.length} invoice${itineraryInvoices.length === 1 ? '' : 's'} across ${new Set(itineraryInvoices.map((inv) => (inv.currency_code || currencyCode).toUpperCase())).size} currencies, with currency-matched journal entries`}
                open={openFinance.ledger}
                onToggle={() => toggleFinance('ledger')}
              >
                {itineraryInvoices.length === 0 ? (
                  <p style={{ fontSize: '0.85rem', color: '#94a3b8', margin: 0 }}>
                    No invoice has been issued for this itinerary yet.
                  </p>
                ) : (
                  <div>
                    {itineraryInvoices.map((inv) => (
                      <InvoiceFinanceRow
                        key={inv.id}
                        invoice={inv}
                        symbol={inv.currency_code ? svcSymbol(inv.currency_code) : ''}
                        open={openInvoiceId === inv.id}
                        onToggle={() => setOpenInvoiceId((cur) => (cur === inv.id ? null : inv.id))}
                        entries={journalBySource.get(`invoice|${inv.id}`) || []}
                        receipts={receiptsByInvoice.get(inv.id) || []}
                        onViewReceipt={viewReceipt}
                      />
                    ))}
                  </div>
                )}

                {standaloneJournal.length > 0 && (
                  <div style={{ marginTop: '1.25rem' }}>
                    <div style={{ fontSize: '0.72rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.04em', color: '#94a3b8', marginBottom: '0.45rem' }}>
                      Other entries
                    </div>
                    <div style={{ display: 'grid', gap: '0.5rem' }}>
                      {standaloneJournal.map((e) => (
                        <JournalEntryCard
                          key={e.id}
                          entry={e}
                          symbol={e.currency_code ? svcSymbol(e.currency_code) : ''}
                          currencyCode={e.currency_code || 'Currency unknown'}
                        />
                      ))}
                    </div>
                  </div>
                )}
              </FinanceSection>
            </>
          )}

          {/* --- Stage invoice (provisional ? deposit request, confirmed+ ? final) -- */}
          {tab === 'finance' && (
            <FinanceSection
              sectionId="invoice"
              title="Invoice"
              summary={isProvisional
                ? 'Issue a deposit request separately for each itinerary currency'
                : 'Issue invoices separately for each itinerary currency'}
              open={openFinance.invoice}
              onToggle={() => toggleFinance('invoice')}
            >
              {isProvisional ? (
                <p style={{ fontSize: '0.85rem', color: '#64748b', marginBottom: '0.6rem', maxWidth: '720px' }}>
                  A <strong>provisional booking</strong> only unlocks this deposit invoice — no vouchers or
                  travel documents yet. Once the deposit is received, move the itinerary to
                  <strong> Confirmed</strong> to release the full travel pack.
                </p>
              ) : (
                <p style={{ fontSize: '0.85rem', color: '#64748b', marginBottom: '0.6rem', maxWidth: '720px' }}>
                  Final client invoice, net of any deposit already received. Confirm the payment here to raise
                  the receipt and clear the outstanding balance to <strong>R0.00</strong>.
                </p>
              )}

              <div className="inline-invoice-row" style={{ display: 'flex', flexWrap: 'wrap', gap: '1.5rem', alignItems: 'flex-start', marginBottom: '1.15rem' }}>
                {[{ label: 'Reference', value: meta.referenceNumber || meta.reference || '—' },
                  { label: 'Client', value: meta.client?.name || '—' },
                  { label: 'Days', value: `${days.length}` },
                  { label: 'Pax', value: `${paxCount}` }
                ].map((row) => (
                  <div key={row.label} style={{ display: 'flex', flexDirection: 'column', gap: '0.15rem' }}>
                    <span style={{ fontSize: '0.72rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.04em', color: '#94a3b8' }}>{row.label}</span>
                    <span style={{ fontSize: '0.92rem', fontWeight: 700, color: '#1a202c' }}>{row.value}</span>
                  </div>
                ))}
              </div>

              <div style={{ display: 'grid', gap: '0.65rem', marginBottom: '1.15rem' }}>
                {pricingGroups.filter((group) => group.totalSell > 0).map((group) => {
                  const sym = svcSymbol(group.code);
                  const billed = netBilled(itineraryInvoices, itineraryCreditNotes, group.code);
                  const balance = round2(Math.max(0, group.totalSell - billed));
                  const receivedHere = round2(itineraryInvoices
                    .filter((invoice) => (invoice.status || '') !== 'void'
                      && (invoice.currency_code || '').toUpperCase() === group.code.toUpperCase())
                    .reduce((total, invoice) => total + netReceivedTotal(invoice.id, itineraryReceipts), 0));
                  const paymentExcess = bookingOverpayment(
                    group.totalSell,
                    itineraryInvoices,
                    itineraryReceipts,
                    itineraryCreditNotes,
                    group.code
                  );
                  const receiptsHere = itineraryReceipts.filter((receipt) => (receipt.currency_code || '').toUpperCase() === group.code.toUpperCase());
                  const creditsHere = itineraryCreditNotes.filter((credit) => (credit.currency_code || '').toUpperCase() === group.code.toUpperCase()
                    && (credit.status || '') !== 'void');
                  const firstRequest = billed <= 0.009 ? round2(group.totalSell * (depositPct / 100)) : 0;
                  return (
                    <div key={group.code} className="invoice-total" style={{ background: balance > 0.009 ? (isProvisional ? '#eff6ff' : '#fff7ed') : '#f0fdf4', border: `1px solid ${balance > 0.009 ? (isProvisional ? '#bfdbfe' : '#fed7aa') : '#bbf7d0'}`, borderRadius: '14px', padding: '1rem 1.25rem' }}>
                      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
                        <div style={{ fontSize: '0.9rem', color: '#1e293b', fontWeight: 800 }}>{group.code} itinerary total</div>
                        <div style={{ fontSize: '1.45rem', fontWeight: 900, color: balance > 0.009 ? (isProvisional ? '#1e40af' : '#9a3412') : '#15803d' }}>
                          {sym}{group.totalSell.toFixed(2)}
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: '1.5rem', marginTop: '0.45rem', flexWrap: 'wrap', fontSize: '0.82rem', color: '#334155' }}>
                        <span>Balance to invoice: <strong>{sym}{balance.toFixed(2)}</strong></span>
                        <span>Already invoiced: <strong>{sym}{billed.toFixed(2)}</strong></span>
                        {receivedHere > 0 && <span>Net payments held: <strong>{sym}{receivedHere.toFixed(2)}</strong></span>}
                        {firstRequest > 0 && <span>Usual first request ({depositPct}%): <strong>{sym}{firstRequest.toFixed(2)}</strong></span>}
                      </div>
                      {paymentExcess > 0.009 && (
                        <div role="alert" style={{ marginTop: '0.65rem', border: '1px solid #fca5a5', borderRadius: '8px', background: '#fef2f2', color: '#991b1b', padding: '0.6rem 0.75rem', fontSize: '0.82rem', fontWeight: 700 }}>
                          The itinerary has an unresolved {group.code} overpayment of {sym}{paymentExcess.toFixed(2)}. It remains available to refund or issue as a client credit note.
                          <button type="button" className="secondary-btn" disabled={issuingInvoice} onClick={() => openOverpaymentPrompt(group.code, group.totalSell)} style={{ marginLeft: '0.6rem', padding: '0.25rem 0.55rem', color: '#991b1b', borderColor: '#fca5a5' }}>
                            Resolve overpayment
                          </button>
                        </div>
                      )}
                      {receiptsHere.length > 0 && (
                        <div style={{ borderTop: `1px solid ${balance > 0.009 ? '#cbd5e1' : '#bbf7d0'}`, paddingTop: '0.5rem', marginTop: '0.55rem' }}>
                          <div style={{ fontSize: '0.7rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.04em', color: '#64748b', marginBottom: '0.25rem' }}>Receipts · {group.code}</div>
                          {receiptsHere.map((receipt) => (
                            <div key={receipt.id} style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', fontSize: '0.82rem', color: '#334155', padding: '0.14rem 0' }}>
                              <span style={{ fontWeight: 600 }}>
                                {receipt.direction === 'out'
                                  ? `Refund for ${receipt.invoice_number || 'invoice'}`
                                  : receipt.direction === 'apply'
                                    ? `Credit applied to ${receipt.invoice_number || 'invoice'}`
                                    : receipt.direction === 'wallet_out'
                                      ? 'Client credit payout'
                                      : `${TYPE_LABEL[receipt.invoice_type] || receipt.invoice_type}${receipt.invoice_number ? ` ${receipt.invoice_number}` : ''}`}
                                {receipt.direction === 'out' || receipt.direction === 'wallet_out'
                                  ? ` — refunded ${receipt.received_date || '—'}`
                                  : ` — received ${receipt.received_date || '—'}`}
                              </span>
                              <span style={{ fontWeight: 700 }}>
                                <button type="button" onClick={() => viewReceipt(receipt)} title="View / print receipt" style={{ background: 'none', border: 'none', padding: 0, color: '#0d7478', fontWeight: 800, cursor: 'pointer', textDecoration: 'underline', font: 'inherit' }}>
                                  {receipt.receipt_number}
                                </button>
                                {'  '}{receipt.direction === 'out' || receipt.direction === 'wallet_out' ? '-' : ''}
                                {fmtMoney(receipt.amount, sym)}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                      {creditsHere.length > 0 && (
                        <div style={{ borderTop: `1px solid ${balance > 0.009 ? '#cbd5e1' : '#bbf7d0'}`, paddingTop: '0.5rem', marginTop: '0.55rem' }}>
                          <div style={{ fontSize: '0.7rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.04em', color: '#64748b', marginBottom: '0.25rem' }}>Credit notes · {group.code}</div>
                          {creditsHere.map((credit) => (
                            <div key={credit.id} style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', fontSize: '0.82rem', color: '#334155', padding: '0.14rem 0' }}>
                              <span style={{ fontWeight: 600 }}>
                                {credit.credit_note_number} — {credit.reason || 'Credit issued'}
                              </span>
                              <span style={{ fontWeight: 700 }}>{fmtMoney(credit.total_incl, sym)}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
                {pricingGroups.every((group) => group.totalSell <= 0) && (
                  <p style={{ fontSize: '0.85rem', color: '#94a3b8', margin: 0 }}>Add included services to see itinerary balances by currency.</p>
                )}
              </div>

              <div className="payment-receipt-box" style={{ border: '1.5px dashed #cbd5e1', borderRadius: '14px', padding: '1rem 1.25rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.3rem' }}>
                  <Receipt size={18} style={{ color: '#475569' }} />
                  <strong style={{ fontSize: '0.9rem', color: '#1a202c' }}>Payment receipt — {currencyCode}</strong>
                </div>
                <p style={{ fontSize: '0.82rem', color: '#64748b', margin: '0 0 0.7rem 0' }}>
                  Record what the client has paid. A receipt is raised for the amount entered, and the invoice is only closed out once nothing is left outstanding on it.
                </p>
                {paymentInvoicesByCurrency.length > 0 ? (
                  <button type="button" className="primary-btn" style={{ alignItems: 'center', gap: '0.4rem' }} disabled={issuingInvoice} onClick={() => openPaymentPrompt()}>
                    <CheckCircle2 size={15} /> Record payment
                    {paymentInvoicesByCurrency.length > 1 ? ` (${paymentInvoicesByCurrency.map((invoice) => invoice.currency_code).join(', ')})` : ` (${paymentInvoicesByCurrency[0].currency_code})`}
                  </button>
                ) : (
                  <p style={{ fontSize: '0.82rem', color: '#94a3b8', margin: 0 }}>
                    Issue the invoice below first — the receipt is raised automatically when you confirm payment.
                  </p>
                )}
              </div>

              <div className="invoice-actions" style={{ marginTop: '1.2rem', display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                {pricingGroups.filter((group) => group.totalSell > 0).map((group) => {
                  const billed = netBilled(itineraryInvoices, itineraryCreditNotes, group.code);
                  const remaining = round2(Math.max(0, group.totalSell - billed));
                  const maximumPercent = group.totalSell > 0 ? Math.min(100, (remaining / group.totalSell) * 100) : 0;
                  const initialPercent = billed <= 0.009
                    ? Math.min(depositPct, maximumPercent)
                    : maximumPercent;
                  return (
                    <button
                      key={group.code}
                      type="button"
                      className="primary-btn"
                      style={{ alignItems: 'center', gap: '0.4rem' }}
                      disabled={issuingInvoice || remaining <= 0.009}
                      onClick={() => setInvoiceIssuePrompt({
                        currency: group.code,
                        total: group.totalSell,
                        remaining,
                        percentage: String(round2(Math.max(0, initialPercent)))
                      })}
                      title={remaining <= 0.009 ? `The ${group.code} itinerary balance is fully invoiced` : `Choose a percentage of the ${group.code} itinerary total to invoice`}
                    >
                      <FileText size={15} />
                      {remaining <= 0.009
                        ? `${group.code} invoiced in full`
                        : `Issue ${group.code} invoice`}
                    </button>
                  );
                })}
                <button type="button" className="secondary-btn" style={{ alignItems: 'center', gap: '0.4rem' }} onClick={() => navigate('/finance')}>
                  <Receipt size={15} /> Issue Invoice in Finance module
                </button>
              </div>

              <div style={{ marginTop: '1.2rem', paddingTop: '1.1rem', borderTop: '1px solid #e2e8f0' }}>
                <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.04em', color: '#94a3b8', marginBottom: '0.4rem' }}>Email format</label>
                <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', alignItems: 'center' }}>
                  <SearchableSelect
                    className="input-field"
                    style={{ maxWidth: '170px' }}
                    value={emailFormat}
                    onChange={(e) => setEmailFormat(e.target.value)}
                  >
                    <option value="pdf">PDF</option>
                    <option value="word">Word</option>
                    <option value="excel">Excel</option>
                  </SearchableSelect>
                  <button type="button" className="primary-btn" style={{ alignItems: 'center', gap: '0.4rem' }} disabled={issuingInvoice} onClick={emailInvoiceToClient}>
                    <Send size={15} /> {isProvisional ? 'Email deposit request to client' : 'Email invoice to client'}
                  </button>
                </div>
                <p style={{ fontSize: '0.76rem', color: '#94a3b8', margin: '0.45rem 0 0 0' }}>
                  {emailFormat === 'pdf'
                    ? 'The PDF opens for you to save, then attach it to the email that follows.'
                    : `The ${emailFormat} file downloads (or is shared on supported devices), ready to attach to the email that follows.`}
                </p>
              </div>
            </FinanceSection>
          )}

          {/* --- Cost of sales (per itinerary, per currency) ------------------- */}
          {tab === 'finance' && (
            <FinanceSection
              sectionId="cost-of-sales"
              title="Cost of sales"
              summary="What the itinerary earns against what it costs, net of tax"
              open={openFinance.costOfSales}
              onToggle={() => toggleFinance('costOfSales')}
            >
              <p style={{ fontSize: '0.85rem', color: '#64748b', marginBottom: '0.75rem', maxWidth: '760px' }}>
                What this itinerary earns against what it costs. The net sale excludes tax, because tax
                collected is payable to SARS rather than kept as margin. Green is a profit, red is a loss.
              </p>
              <CostOfSalesPanel groups={pricingGroups} />
            </FinanceSection>
          )}

          {/* --- Vouchers (confirmed, read-only) --------------------------------- */}
          {tab === 'vouchers' && (
            <div className="builder-panel-card">
              <h3 style={{ fontSize: '1.1rem', fontWeight: 800, color: '#1a202c', marginBottom: '0.4rem' }}>
                Supplier Vouchers
              </h3>
              <p style={{ fontSize: '0.85rem', color: '#64748b', marginBottom: '1.15rem', maxWidth: '720px' }}>
                One <strong>read-only service voucher</strong> per supplier, per email. Vouchers cannot be
                edited — they strictly mirror the persisted itinerary (travellers, dates, times, notes,
                supplier reference and the per-service confirmation details you recorded). Confirmed status
                is always <strong>OK</strong>. Suppliers receive theirs individually via your default email client.
              </p>

              {servicesBySupplier(days, libraryItems).map((grp) => {
                const m = voucherFor(grp, days, meta, currencySymbol, paxCount, billing);
                return (
                  <div key={grp.key} className="voucher-card" style={{ border: '1px solid #e2e8f0', borderRadius: '14px', marginBottom: '0.9rem', overflow: 'hidden', background: '#ffffff', borderLeft: '4px solid #0d7478' }}>
                    <div style={{ padding: '0.9rem 1rem', background: '#f0fdfa', borderBottom: '1px solid #99f6e4' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                        <Ticket size={16} style={{ color: '#0d7478' }} />
                        <strong style={{ fontSize: '0.95rem', color: '#134e4a' }}>{grp.label}</strong>
                      </div>
                      <div style={{ fontSize: '0.8rem', color: '#0d7478', marginTop: '0.3rem' }}>
                        {emailOf(grp.sup) ? `Sent to: ${emailOf(grp.sup)}` : 'No supplier email on file'}
                      </div>
                    </div>
                    <div style={{ padding: '0.9rem 1rem' }}>
                      <pre style={{ margin: 0, whiteSpace: 'pre-wrap', fontFamily: 'inherit', fontSize: '0.82rem', color: '#475569', lineHeight: 1.6 }}>{m}</pre>
                    </div>
                    <div style={{ padding: '0 1rem 0.9rem', display: 'flex', justifyContent: 'flex-end', gap: '0.4rem', flexWrap: 'wrap' }}>
                      <button type="button" className="secondary-btn" style={{ alignItems: 'center', gap: '0.4rem' }} disabled={!emailOf(grp.sup)} onClick={() => window.open(mailTo(emailOf(grp.sup), `Voucher — ${grp.label}`, m), '_blank')}>
                        <Mail size={14} /> Email voucher to supplier
                      </button>
                      <button type="button" className="secondary-btn" style={{ alignItems: 'center', gap: '0.4rem' }} onClick={() => openPrintWindow(voucherDocHtml(grp, days, meta, currencySymbol, paxCount, voucherOpts), 300)}>
                        <Printer size={14} /> PDF / Print
                      </button>
                      <button type="button" className="secondary-btn" style={{ alignItems: 'center', gap: '0.4rem' }} onClick={() => downloadBlob(voucherDocHtml(grp, days, meta, currencySymbol, paxCount, voucherOpts), `${safeNameOf(grp.label)}-voucher.doc`, 'application/msword')}>
                        <Download size={14} /> Word
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* --- Operations (in progress) --------------------------------------- */}
          {tab === 'operations' && (
            <div className="builder-panel-card">
              <h3 style={{ fontSize: '1.1rem', fontWeight: 800, color: '#1a202c', marginBottom: '0.4rem' }}>
                Operations &amp; Daily Briefs
              </h3>
              <p style={{ fontSize: '0.85rem', color: '#64748b', marginBottom: '1rem', maxWidth: '720px' }}>
                The tour is <strong>in progress</strong>. Generate a daily handover brief for each day of the
                trip — guides and suppliers get their service times, contact details and expected values.
              </p>

              {/* Supplier payment confirmation: one checkbox per service. */}
              {(() => {
                const payable = days.flatMap((d, dayIndex) => (d.services || [])
                  .filter((sv) => !sv.isOptional)
                  .map((sv) => ({ sv, day: d, dayIndex })));
                if (!payable.length) return null;
                const paidCount = payable.filter((entry) => entry.sv.supplierPaid).length;
                const paidValue = payable.reduce((sum, entry) => sum + (entry.sv.supplierPaid ? round2((Number(entry.sv.buyPP) || 0) * paxForService(entry.sv, paxCount)) : 0), 0);
                const outstandingValue = payable.reduce((sum, entry) => sum + (entry.sv.supplierPaid ? 0 : round2((Number(entry.sv.buyPP) || 0) * paxForService(entry.sv, paxCount))), 0);

                return (
                  <div style={{ border: '1px solid #e2e8f0', borderRadius: '14px', marginBottom: '1.15rem', overflow: 'hidden', background: '#ffffff' }}>
                    <div style={{ padding: '0.9rem 1rem', background: '#f0fdfa', borderBottom: '1px solid #99f6e4', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <CheckCircle2 size={16} style={{ color: '#0f766e' }} />
                        <strong style={{ fontSize: '0.95rem', color: '#134e4a' }}>Supplier payment confirmation</strong>
                      </div>
                      <span style={{ fontSize: '0.8rem', color: '#64748b' }}>
                        {paidCount} of {payable.length} paid &middot; {currencySymbol}{round2(paidValue).toFixed(2)} paid
                        {outstandingValue > 0 ? ` · ${currencySymbol}${round2(outstandingValue).toFixed(2)} outstanding` : ''}
                      </span>
                    </div>

                    <div style={{ padding: '0.35rem 0' }}>
                      {payable.map(({ sv, day, dayIndex }) => {
                        const amount = round2((Number(sv.buyPP) || 0) * paxForService(sv, paxCount));
                        const paid = !!sv.supplierPaid;
                        return (
                          <div
                            key={`${sv.key}-${day.key}`}
                            style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.55rem 1rem', borderTop: '1px solid #f1f5f9', flexWrap: 'wrap' }}
                          >
                            <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', minWidth: '10.5rem' }}>
                              <input
                                type="checkbox"
                                checked={paid}
                                onChange={(e) => toggleServicePaid(dayIndex, sv.key, e.target.checked)}
                                style={{ width: '1.05rem', height: '1.05rem', accentColor: '#0d7478', cursor: 'pointer' }}
                                aria-label={`Confirm ${sv.name} has been paid to ${sv.supplierName || 'the supplier'}`}
                              />
                              <span style={{ fontSize: '0.82rem', fontWeight: 700, color: paid ? '#15803d' : '#475569' }}>
                                {paid ? 'Paid' : 'Not paid'}
                              </span>
                            </label>

                            <div style={{ flex: '1 1 14rem', minWidth: '0' }}>
                              <div style={{ fontSize: '0.82rem', fontWeight: 700, color: '#1a202c' }}>
                                Day {day.dayNumber} &middot; {repairText(sv.name)}
                              </div>
                              <div style={{ fontSize: '0.75rem', color: '#64748b' }}>
                                {sv.supplierName || 'Unknown supplier'}
                                {sv.confirmationNumber ? ` · Conf ${sv.confirmationNumber}` : ''}
                                {sv.supplierPaidAt ? ` · Confirmed ${formatDateShort(String(sv.supplierPaidAt).slice(0, 10))}` : ''}
                              </div>
                            </div>

                            <span style={{ fontSize: '0.82rem', fontWeight: 700, color: '#b91c1c', whiteSpace: 'nowrap' }}>
                              {fmtMoney(amount, svcSymbol(sv.currencyCode))}
                            </span>

                            <input
                              type="text"
                              className="sidebar-select"
                              style={{ width: '11rem', padding: '0.35rem 0.5rem', fontSize: '0.78rem' }}
                              placeholder="Supplier invoice / POP ref"
                              defaultValue={sv.supplierPaidRef || ''}
                              onBlur={(e) => {
                                const ref = e.target.value.trim();
                                if (ref !== (sv.supplierPaidRef || '')) savePaidRef(dayIndex, sv.key, ref);
                              }}
                            />

                            <div style={{ display: 'inline-flex', gap: '0.4rem' }}>
                              <button
                                type="button"
                                className="secondary-btn"
                                style={{ alignItems: 'center', gap: '0.3rem', padding: '0.35rem 0.6rem', fontSize: '0.75rem' }}
                                onClick={() => openProofOfPayment(sv, day)}
                                title="Open a printable proof of payment for this supplier booking"
                              >
                                <Printer size={14} /> POP
                              </button>
                              <button
                                type="button"
                                className="secondary-btn"
                                style={{ alignItems: 'center', gap: '0.3rem', padding: '0.35rem 0.6rem', fontSize: '0.75rem' }}
                                onClick={() => downloadProofOfPayment(sv, day)}
                                title="Download the proof of payment"
                              >
                                <Download size={14} />
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    <div style={{ padding: '0.6rem 1rem 0.9rem', fontSize: '0.76rem', color: '#64748b', borderTop: '1px solid #f1f5f9' }}>
                      Tick a box the moment the supplier is paid. Each tick is saved straight away and stamps a
                      proof of payment (POP) you can print or download for your records. Alternatives are left out —
                      nothing is owed on an option the client has not taken.
                    </div>
                  </div>
                );
              })()}

              {days.map((d) => {
                const brief = dailyBriefFor(d, meta, paxCount, currencySymbol, billing);
                return (
                  <div key={d.key} className="voucher-card" style={{ border: '1px solid #e2e8f0', borderRadius: '14px', marginBottom: '0.9rem', overflow: 'hidden', background: '#ffffff', borderLeft: '4px solid #0f766e' }}>
                    <div style={{ padding: '0.9rem 1rem', background: '#f0fdfa', borderBottom: '1px solid #99f6e4' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', justifyContent: 'space-between', flexWrap: 'wrap' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                          <Calendar size={16} style={{ color: '#0f766e' }} />
                          <strong style={{ fontSize: '0.95rem', color: '#134e4a' }}>Day {d.dayNumber} {formatDateLong(d.date) ? `— ${formatDateLong(d.date)}` : ''}</strong>
                        </div>
                        <span style={{ fontSize: '0.8rem', color: '#64748b' }}>{(d.services || []).length} service{(d.services || []).length === 1 ? '' : 's'}</span>
                      </div>
                    </div>
                    <div style={{ padding: '0.9rem 1rem', whiteSpace: 'pre-wrap', fontFamily: 'monospace', fontSize: '0.78rem', color: '#334155', lineHeight: '1.6' }}>
                      {brief}
                    </div>
                  </div>
                );
              })}
              <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', marginTop: '0.4rem' }}>
                <button type="button" className="secondary-btn" style={{ alignItems: 'center', gap: '0.4rem' }} onClick={() => {
                  const all = days.map((d) => dailyBriefFor(d, meta, paxCount, currencySymbol, billing)).join('\n\n--------------------------------------\n\n');
                  void clipboardCopy(all);
                  showToast('All daily briefs copied to clipboard', 'success');
                }}>
                  <Copy size={15} /> Copy all briefs
                </button>
              </div>
            </div>
          )}

          {/* --- Post-Tour (completed) ------------------------------------------ */}
          {tab === 'post-tour' && (
            <div className="builder-panel-card">
              <h3 style={{ fontSize: '1.1rem', fontWeight: 800, color: '#1a202c', marginBottom: '0.4rem' }}>
                Post-Tour Closure
              </h3>
              <p style={{ fontSize: '0.85rem', color: '#64748b', marginBottom: '1rem', maxWidth: '720px' }}>
                The itinerary is <strong>completed</strong>. Request client feedback and reconcile final
                income against supplier costs.
              </p>

              <div className="payment-receipt-box" style={{ border: '1.5px dashed #cbd5e1', borderRadius: '14px', padding: '1rem 1.25rem', marginBottom: '1.15rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.3rem' }}>
                  <Mail size={18} style={{ color: '#475569' }} />
                  <strong style={{ fontSize: '0.9rem', color: '#1a202c' }}>Client feedback form</strong>
                </div>
                <p style={{ fontSize: '0.82rem', color: '#64748b', margin: '0 0 0.7rem 0' }}>
                  Send the client a structured post-tour feedback request.
                </p>
                <div className="invoice-actions" style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                  <button type="button" className="primary-btn" style={{ alignItems: 'center', gap: '0.4rem' }} onClick={() => {
                    const m = feedbackRequestEmail(meta);
                    if (!m.to) { showToast('No client email on file', 'warning'); return; }
                    window.open(mailTo(m.to, m.subject, m.body), '_blank');
                  }}>
                    <Send size={15} /> Email feedback request
                  </button>
                  <button type="button" className="secondary-btn" style={{ alignItems: 'center', gap: '0.4rem' }} onClick={() => {
                    const m = feedbackRequestEmail(meta);
                    void clipboardCopy(`${m.subject}\n\n${m.body}`);
                    showToast('Feedback request copied to clipboard', 'success');
                  }}>
                    <Copy size={15} /> Copy to clipboard
                  </button>
                </div>
              </div>

              <div className="payment-receipt-box" style={{ border: '1.5px dashed #cbd5e1', borderRadius: '14px', padding: '1rem 1.25rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.3rem' }}>
                  <CheckCircle2 size={18} style={{ color: '#16a34a' }} />
                  <strong style={{ fontSize: '0.9rem', color: '#1a202c' }}>Expense reconciliation</strong>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem', margin: '0.6rem 0 0.85rem' }}>
                  {(pricingGroups.length > 0 ? pricingGroups : [{ code: currencyCode, symbol: currencySymbol, totalSell: paxBalanceTotal, totalBuy: itineraryCostTotal }]).map((grp) => {
                    const net = round2(grp.totalSell - grp.totalBuy);
                    return (
                      <div key={grp.code} className="invoice-total" style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '0.85rem 1.1rem', display: 'flex', gap: '1.75rem', flexWrap: 'wrap' }}>
                        <div>
                          <div style={{ fontSize: '0.75rem', color: '#16a34a', fontWeight: 700 }}>Income ({grp.code}, incl. tax)</div>
                          <div style={{ fontSize: '1.25rem', fontWeight: 800, color: '#15803d' }}>{grp.symbol}{grp.totalSell.toFixed(2)}</div>
                        </div>
                        <div>
                          <div style={{ fontSize: '0.75rem', color: '#dc2626', fontWeight: 700 }}>Supplier cost ({grp.code}, buy)</div>
                          <div style={{ fontSize: '1.25rem', fontWeight: 800, color: '#b91c1c' }}>{grp.symbol}{grp.totalBuy.toFixed(2)}</div>
                        </div>
                        <div>
                          <div style={{ fontSize: '0.75rem', color: '#475569', fontWeight: 700 }}>Net result ({grp.code})</div>
                          <div style={{ fontSize: '1.25rem', fontWeight: 800, color: net >= 0 ? '#15803d' : '#b91c1c' }}>{grp.symbol}{net.toFixed(2)}</div>
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div className="invoice-actions" style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                  <button type="button" className="primary-btn" style={{ alignItems: 'center', gap: '0.4rem' }} onClick={() => {
                    const m = reconciliationStatementFor(meta, pricingGroups, paxBalanceTotal, itineraryCostTotal, currencySymbol);
                    if (!m.to) { showToast('No client email on file', 'warning'); return; }
                    window.open(mailTo(m.to, m.subject, m.body), '_blank');
                  }}>
                    <Send size={15} /> Email reconciliation statement
                  </button>
                  <button type="button" className="secondary-btn" style={{ alignItems: 'center', gap: '0.4rem' }} onClick={() => {
                    const m = reconciliationStatementFor(meta, pricingGroups, paxBalanceTotal, itineraryCostTotal, currencySymbol);
                    void clipboardCopy(`${m.subject}\n\n${m.body}`);
                    showToast('Reconciliation statement copied to clipboard', 'success');
                  }}>
                    <Copy size={15} /> Copy to clipboard
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* --- Cancellation (cancelled) --------------------------------------- */}
          {tab === 'cancellation' && (
            <div className="builder-panel-card">
              <h3 style={{ fontSize: '1.1rem', fontWeight: 800, color: '#1a202c', marginBottom: '0.4rem' }}>
                Cancellation
              </h3>
              <p style={{ fontSize: '0.85rem', color: '#64748b', marginBottom: '1rem', maxWidth: '720px' }}>
                This itinerary is <strong>cancelled</strong>. All vouchers, travel documents and invoices have
                been revoked and the itinerary is locked. Issue the client a cancellation notice plus refund
                statement.
              </p>

              <div className="payment-receipt-box" style={{ border: '1.5px dashed #fecaca', borderRadius: '14px', padding: '1rem 1.25rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.3rem' }}>
                  <X size={18} style={{ color: '#b91c1c' }} />
                  <strong style={{ fontSize: '0.9rem', color: '#1a202c' }}>Cancellation notice &amp; refund statement</strong>
                </div>
                <p style={{ fontSize: '0.82rem', color: '#64748b', margin: '0 0 0.7rem 0' }}>
                  Retains the deposit ({depositPct}%) and details the refund due back to the client.
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem', margin: '0.6rem 0 0.85rem' }}>
                  {(pricingGroups.length > 0 ? pricingGroups : [{ code: currencyCode, symbol: currencySymbol, totalSell: paxBalanceTotal, totalTax: paxBalanceVAT }]).map((grp) => {
                    const deposit = round2(grp.totalSell * (depositPct / 100));
                    const refund = round2(grp.totalSell - deposit);
                    return (
                      <div
                        key={grp.code}
                        className="invoice-total"
                        style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '12px', padding: '0.85rem 1.1rem', display: 'flex', gap: '1.75rem', flexWrap: 'wrap' }}
                      >
                        <div>
                          <div style={{ fontSize: '0.75rem', color: '#64748b', fontWeight: 700 }}>Total price ({grp.code})</div>
                          <div style={{ fontSize: '1.1rem', fontWeight: 800, color: '#1a202c' }}>{grp.symbol}{grp.totalSell.toFixed(2)}</div>
                        </div>
                        <div>
                          <div style={{ fontSize: '0.75rem', color: '#64748b', fontWeight: 700 }}>Deposit retained ({depositPct}%)</div>
                          <div style={{ fontSize: '1.1rem', fontWeight: 800, color: '#b91c1c' }}>{grp.symbol}{deposit.toFixed(2)}</div>
                        </div>
                        <div>
                          <div style={{ fontSize: '0.75rem', color: '#16a34a', fontWeight: 700 }}>Refund due ({grp.code})</div>
                          <div style={{ fontSize: '1.25rem', fontWeight: 800, color: '#15803d' }}>{grp.symbol}{refund.toFixed(2)}</div>
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div className="invoice-actions" style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                  <button type="button" className="primary-btn" style={{ alignItems: 'center', gap: '0.4rem' }} onClick={() => {
                    const m = cancellationNoticeEmail(meta, pricingGroups, depositPct, paxBalanceTotal, paxBalanceVAT, currencySymbol);
                    if (!m.to) { showToast('No client email on file', 'warning'); return; }
                    window.open(mailTo(m.to, m.subject, m.body), '_blank');
                  }}>
                    <Send size={15} /> Email cancellation notice
                  </button>
                  <button type="button" className="secondary-btn" style={{ alignItems: 'center', gap: '0.4rem' }} onClick={() => {
                    const m = cancellationNoticeEmail(meta, pricingGroups, depositPct, paxBalanceTotal, paxBalanceVAT, currencySymbol);
                    void clipboardCopy(`${m.subject}\n\n${m.body}`);
                    showToast('Cancellation notice copied to clipboard', 'success');
                  }}>
                    <Copy size={15} /> Copy to clipboard
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Day Notes modal */}
          {dayNotesDay !== null && (
            <div className="modal-overlay" onClick={() => setDayNotesDay(null)}>
              <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '520px' }}>
                <div className="modal-header">
                  <h2>Day {days[dayNotesDay]?.dayNumber || ''} Notes</h2>
                  <button className="close-btn" onClick={() => setDayNotesDay(null)}><X size={20} /></button>
                </div>
                <div style={{ fontSize: '0.85rem', color: '#64748b', marginBottom: '0.9rem' }}>
                  Internal notes specific to this day. Shown inside the workspace and used on supplier vouchers.
                </div>
                <textarea
                  rows={6}
                  placeholder="Add notes specific to this day (e.g., Early morning start, Packed lunch required, etc.)"
                  value={days[dayNotesDay]?.notes || ''}
                  readOnly={isReadOnly}
                  onChange={(e) => {
                    if (isReadOnly) return;
                    setDays((prev) => prev.map((d, i) => (i === dayNotesDay ? { ...d, notes: e.target.value } : d)));
                  }}
                  style={{ width: '100%', minHeight: '150px', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '0.9rem', fontFamily: 'inherit', fontSize: '0.9rem', resize: 'vertical', outline: 'none' }}
                />
                <div className="form-actions" style={{ marginTop: '1rem' }}>
                  <button type="button" className="secondary-btn" onClick={() => setDayNotesDay(null)}>Done</button>
                </div>
              </div>
            </div>
          )}

          {/* Edit service modal */}
          {editSvc && (
            <div className="modal-overlay">
              <div className="modal-content" style={{ maxWidth: '560px' }}>
                <div className="modal-header">
                  <h2>Edit Service</h2>
                  <button className="close-btn" onClick={() => setEditSvc(null)}><X size={20} /></button>
                </div>
                <div className="sidebar-field">
                  <label>Service name</label>
                  <input
                    className="sidebar-select"
                    value={editSvc.name}
                    onChange={(e) => setEditSvc((p) => ({ ...p, name: e.target.value }))}
                  />
                </div>
                <div className="sidebar-field">
                  <label>Description</label>
                  <textarea
                    className="sidebar-select"
                    rows={4}
                    style={{ resize: 'vertical', fontFamily: 'inherit' }}
                    placeholder={editSvc.defaultDesc ? `Default: ${editSvc.defaultDesc}` : 'No default description'}
                    value={editSvc.descOverride}
                    onChange={(e) => setEditSvc((p) => ({ ...p, descOverride: e.target.value }))}
                  />
                  {editSvc.defaultDesc && (
                    <p style={{ fontSize: '0.78rem', color: '#64748b', marginTop: '0.35rem' }}>
                      Default description: {editSvc.defaultDesc}
                    </p>
                  )}
                </div>
                <p style={{ fontSize: '0.78rem', color: '#94a3b8', marginTop: '0.2rem' }}>
                  Leave the description blank to fall back to the library default.
                </p>
                <div style={{ marginTop: '1rem' }}>
                  <label style={{ fontSize: '0.8rem', fontWeight: 600, color: '#475569', display: 'block', marginBottom: '0.35rem' }}>
                    Tax applied to this service
                  </label>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 120px', gap: '0.75rem', alignItems: 'end' }}>
                    <div>
                      {taxRates.filter((t) => t.is_active).length > 0 && (
                        <SearchableSelect
                          className="sidebar-select"
                          style={{ width: '100%' }}
                          value=""
                          onChange={(e) => {
                            const t = taxRates.find((x) => x.id === e.target.value);
                            if (t) setEditSvc((p) => ({ ...p, taxRate: Number(t.rate), taxLabel: t.name || 'Tax' }));
                          }}
                        >
                          <option value="">Apply tax type...</option>
                          {taxRates.filter((t) => t.is_active).map((t) => (
                            <option key={t.id} value={t.id}>{t.name} — {Number(t.rate)}%</option>
                          ))}
                        </SearchableSelect>
                      )}
                      {taxRates.filter((t) => t.is_active).length === 0 && (
                        <p style={{ fontSize: '0.78rem', color: '#94a3b8', marginBottom: '0.2rem' }}>
                          No tenant tax types configured. Add them in Settings &rarr; Taxes.
                        </p>
                      )}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                      <input
                        className="sidebar-select"
                        type="number"
                        min="0"
                        max="100"
                        step="0.01"
                        style={{ width: '100%' }}
                        value={editSvc.taxRate}
                        onChange={(e) => setEditSvc((p) => ({ ...p, taxRate: Number(e.target.value) || 0 }))}
                      />
                      <span style={{ fontSize: '0.9rem', fontWeight: 700, color: '#64748b', whiteSpace: 'nowrap' }}>%</span>
                    </div>
                  </div>
                  <p style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '0.3rem' }}>
                    {editSvc.taxLabel || 'VAT'} rate applied on the sell line (markup already included).
                  </p>
                </div>
                <div style={{ marginTop: '1rem', borderTop: '1px solid #e2e8f0', paddingTop: '1rem' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.82rem', fontWeight: 600, color: '#334155', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={copyAllDays}
                      onChange={(e) => {
                        setCopyAllDays(e.target.checked);
                        if (e.target.checked) setCopyDays([]);
                      }}
                      style={{ width: '16px', height: '16px', accentColor: '#0d7478', cursor: 'pointer' }}
                    />
                    Copy this service to all days
                  </label>
                  <p style={{ margin: '0.25rem 0 0.6rem', color: '#94a3b8', fontSize: '0.74rem', lineHeight: 1.4 }}>
                    Duplicates this service onto every other day of the itinerary, keeping its rates, meal plan, tax and room allocation.
                  </p>
                  {!copyAllDays && (
                    <div style={{ marginTop: '0.4rem' }}>
                      <label style={{ fontSize: '0.8rem', fontWeight: 600, color: '#475569', display: 'block', marginBottom: '0.35rem' }}>
                        Copy to specific days <span style={{ fontWeight: 400, color: '#94a3b8' }}>(optional)</span>
                      </label>
                      <div className="placement-day-grid" style={{ maxHeight: '150px', overflowY: 'auto' }}>
                        {days.map((day, index) => (
                          <label className={`placement-day-option ${index === editSvc.dayIdx ? 'current' : ''}`} key={day.key}>
                            <input
                              type="checkbox"
                              disabled={index === editSvc.dayIdx}
                              checked={index === editSvc.dayIdx || copyDays.includes(index)}
                              onChange={(e) => setCopyDays((prev) => e.target.checked ? [...new Set([...prev, index])] : prev.filter((i) => i !== index))}
                            />
                            <span>Day {day.dayNumber}</span>
                            <small>{formatDateLong(day.date) || 'No date'}</small>
                          </label>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
                <div className="form-actions">
                  <button type="button" className="secondary-btn" onClick={() => setEditSvc(null)}>Cancel</button>
                  <button
                    type="button"
                    className="secondary-btn"
                    style={{ flex: 1 }}
                    onClick={() => {
                      const targets = copyAllDays
                        ? days.map((_, i) => i).filter((i) => i !== editSvc.dayIdx)
                        : copyDays;
                      copyServiceToDays(targets);
                    }}
                  >
                    Copy to Days
                  </button>
                  <button type="button" className="primary-btn" style={{ flex: 1 }} onClick={saveServiceDetails}>Save Changes</button>
                </div>
              </div>
            </div>
          )}

          {vehicleDraft && (
            <div className="modal-overlay service-placement-overlay" onClick={() => setVehicleDraft(null)}>
              <div className="modal-content service-placement-modal vehicle-selection-modal" onClick={(e) => e.stopPropagation()}>
                <div className="modal-header">
                  <div>
                    <div className="allocation-eyebrow">Vehicle capacity</div>
                    <h2>Select a vehicle size</h2>
                    <p className="placement-subtitle">
                      This service needs capacity for {paxCount} traveller{paxCount === 1 ? '' : 's'}. Select the contracted vehicle before continuing.
                    </p>
                  </div>
                  <button className="close-btn" onClick={() => setVehicleDraft(null)} aria-label="Close"><X size={20} /></button>
                </div>
                <div className="placement-option-card">
                  <strong>{vehicleDraft.item.name}</strong>
                  <span className="placement-help">Only vehicle sizes with enough capacity are available. No vehicle is assigned automatically.</span>
                  <span className="placement-help">
                    Options are restricted to this supplier or the same destination.
                    {vehicleDraft.item.supplier?.name ? ` Supplier: ${vehicleDraft.item.supplier.name}.` : ''}
                    {(vehicleDraft.item.location || vehicleDraft.item.supplier?.city_location || vehicleDraft.item.supplier?.city)
                      ? ` Destination: ${vehicleDraft.item.location || vehicleDraft.item.supplier?.city_location || vehicleDraft.item.supplier?.city}.`
                      : ''}
                  </span>
                </div>
                {vehicleDraft.options.length > 0 ? (
                  <div className="vehicle-option-grid">
                    {vehicleDraft.options.map((option) => {
                      const capacity = Number(option.capacity ?? option.max_occupancy ?? option.maxOccupancy);
                      return (
                        <button
                          type="button"
                          className="vehicle-option-card"
                          key={option.id}
                          onClick={() => selectVehicleOption(option)}
                        >
                          <span className="vehicle-option-name">{option.sub_category || option.name}</span>
                          <span className="vehicle-option-detail">{option.name}</span>
                          <span className="vehicle-option-capacity">Up to {capacity} traveller{capacity === 1 ? '' : 's'}</span>
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <div className="placement-option-card room-apply-summary">
                    <strong>No suitable vehicle size is available.</strong>
                    <span>Add a vehicle library item with capacity for all travellers, then try again.</span>
                  </div>
                )}
                <div className="form-actions placement-actions">
                  <button type="button" className="secondary-btn" onClick={() => setVehicleDraft(null)}>Cancel</button>
                </div>
              </div>
            </div>
          )}

          {surchargeRepeatPrompt && (
            <div className="modal-overlay service-placement-overlay" onClick={() => setSurchargeRepeatPrompt(null)}>
              <div className="modal-content service-placement-modal" onClick={(e) => e.stopPropagation()}>
                <div className="modal-header">
                  <div>
                    <div className="allocation-eyebrow">Per-night surcharge</div>
                    <h2>How many nights?</h2>
                    <p className="placement-subtitle">
                      "{surchargeRepeatPrompt.item.name}" is charged per night but is not linked to an accommodation, so the number of
                      nights it applies to cannot be worked out. Enter the count to price it correctly.
                    </p>
                  </div>
                  <button className="close-btn" onClick={() => setSurchargeRepeatPrompt(null)} aria-label="Close"><X size={20} /></button>
                </div>
                <div className="placement-option-card">
                  <label className="surcharge-repeat-field">
                    <span>Number of nights</span>
                    <input
                      type="number"
                      min="1"
                      max="365"
                      step="1"
                      value={surchargeRepeatCount}
                      onChange={(e) => setSurchargeRepeatCount(Math.max(1, parseInt(e.target.value, 10) || 1))}
                    />
                  </label>
                  <span className="placement-help">
                    The fee will be charged {surchargeRepeatCount} time{surchargeRepeatCount === 1 ? '' : 's'} on this line, and the
                    total shown in the itinerary will include all {surchargeRepeatCount}.
                  </span>
                </div>
                <div className="form-actions placement-actions">
                  <button
                    type="button"
                    className="secondary-btn"
                    onClick={() => {
                      setSurchargeRepeatPrompt(null);
                      setSurchargeRepeatCount(1);
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="primary-btn"
                    onClick={() => applySurchargeRepeatCount()}
                  >
                    Apply {surchargeRepeatCount} night{surchargeRepeatCount === 1 ? '' : 's'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {placementDraft && (
            <div className="modal-overlay service-placement-overlay" onClick={() => {
              setPlacementDraft(null);
              setPlacementError('');
            }}>
              <div className="modal-content service-placement-modal" onClick={(e) => e.stopPropagation()}>
                <div className="modal-header">
                  <div>
                    <div className="allocation-eyebrow">Service placement</div>
                    <h2>{placementDraft.item.name}</h2>
                    <p className="placement-subtitle">Choose where this service should appear in the itinerary.</p>
                  </div>
                  <button className="close-btn" onClick={() => {
                    setPlacementDraft(null);
                    setPlacementError('');
                  }} aria-label="Close"><X size={20} /></button>
                </div>

                {placementError && (
                  <div className="placement-validation-error" role="alert" aria-live="assertive">
                    <strong>Cannot add this accommodation yet</strong>
                    <p>{placementError}</p>
                  </div>
                )}

                {placementSplitAvailable && (
                  <div className="placement-option-card">
                    <label className="placement-check-row">
                      <input
                        type="checkbox"
                        checked={placementSplit}
                        onChange={(e) => {
                          setPlacementError('');
                          setPlacementDestinationSplit(false);
                          setPlacementSplit(e.target.checked);
                          setPlacementOptional(e.target.checked ? false : placementSplitAvailable);
                        }}
                      />
                      <span>
                        <strong>Group split — the party sleeps here too</strong>
                        <small>
                          Day {days[placementDraft.dayIndex]?.dayNumber} already houses {beddedPaxBeforePlacement} of {partyPaxForPlacement} pax, so this property
                          takes the remaining {Math.max(0, partyPaxForPlacement - beddedPaxBeforePlacement)} in its own room allocation. It is included in the final price.
                        </small>
                      </span>
                    </label>
                  </div>
                )}

                {placementDestinationSplitAvailable && (
                  <div className="placement-option-card placement-destination-split-card">
                    <label className="placement-check-row">
                      <input
                        type="checkbox"
                        checked={placementDestinationSplit}
                        onChange={(e) => {
                          const enabled = e.target.checked;
                          setPlacementError('');
                          setPlacementDestinationSplit(enabled);
                          setPlacementSplit(enabled);
                          setPlacementOptional(false);
                        }}
                      />
                      <span>
                        <strong>Split travelers across different destinations</strong>
                        <small>
                          This also selects Group split. Use it when part of the group is staying in another Parent Destination / Region. You will allocate the remaining travelers here; travelers already assigned to another property cannot be assigned again.
                        </small>
                      </span>
                    </label>
                  </div>
                )}

                <div className="placement-option-card">
                  <label className="placement-check-row">
                    <input
                      type="checkbox"
                      checked={placementOptional}
                      onChange={(e) => {
                        setPlacementError('');
                        setPlacementDestinationSplit(false);
                        setPlacementOptional(e.target.checked);
                        if (e.target.checked) setPlacementSplit(false);
                        else if (placementSplitAvailable) setPlacementSplit(true);
                      }}
                    />
                    <span>
                      <strong>{isAccommodationItem(placementDraft.item) ? 'Add as an alternative' : 'Add as optional'}</strong>
                      <small>
                        {isAccommodationItem(placementDraft.item)
                          ? 'Offered alongside the confirmed room. Not included in the final price and priced separately for the client.'
                          : 'Not included in the final price. Priced separately for the client so they can choose to add it.'}
                      </small>
                    </span>
                  </label>
                </div>

                <div className="placement-option-card">
                  <label className="placement-check-row">
                    <input type="checkbox" checked={placementRepeat} onChange={(e) => setPlacementRepeat(e.target.checked)} />
                    <span>
                      <strong>Repeat on consecutive days</strong>
                      <small>Place this service on the selected day and the following days.</small>
                    </span>
                  </label>
                  {placementRepeat && (
                    <div className="placement-inline-field">
                      <label htmlFor="placement-repeat-count">Number of days</label>
                      <SearchableSelect id="placement-repeat-count" className="sidebar-select" value={placementRepeatCount} onChange={(e) => setPlacementRepeatCount(Number(e.target.value))}>
                        {Array.from({ length: Math.max(1, days.length - placementDraft.dayIndex) }, (_, index) => (
                          <option key={index + 1} value={index + 1}>{index + 1} day{index === 0 ? '' : 's'}</option>
                        ))}
                      </SearchableSelect>
                    </div>
                  )}
                </div>

                <div className="placement-option-card">
                  <div className="placement-section-title">Copy to specific days <span>Optional</span></div>
                  <p className="placement-help">Select any additional days where this service should also appear.</p>
                  <div className="placement-day-grid">
                    {days.map((day, index) => (
                      <label className={`placement-day-option ${index === placementDraft.dayIndex ? 'current' : ''}`} key={day.key}>
                        <input
                          type="checkbox"
                          disabled={index === placementDraft.dayIndex}
                          checked={index === placementDraft.dayIndex || placementCopyDays.includes(index)}
                          onChange={(e) => setPlacementCopyDays((prev) => e.target.checked ? [...new Set([...prev, index])] : prev.filter((dayIndex) => dayIndex !== index))}
                        />
                        <span>Day {day.dayNumber}</span>
                        <small>{formatDateLong(day.date) || 'No date'}</small>
                      </label>
                    ))}
                  </div>
                </div>

                <div className="form-actions placement-actions">
                  <button type="button" className="secondary-btn" onClick={() => {
                    setPlacementDraft(null);
                    setPlacementError('');
                  }}>Cancel</button>
                  <button type="button" className="primary-btn" onClick={confirmPlacement}>Add service</button>
                </div>
              </div>
            </div>
          )}

          {roomApplyPrompt && (
            <div className="modal-overlay service-placement-overlay">
              <div className="modal-content service-placement-modal room-apply-modal">
                <div className="modal-header">
                  <div>
                    <div className="allocation-eyebrow">Room allocation saved</div>
                    <h2>Apply this allocation to repeated days?</h2>
                    <p className="placement-subtitle">This service repeats on {roomApplyPrompt.related.length} other day{roomApplyPrompt.related.length === 1 ? '' : 's'}.</p>
                  </div>
                </div>
                <div className="placement-option-card room-apply-summary">
                  <strong>Use the same traveller-to-room arrangement and contracted rates on every repeated occurrence?</strong>
                  <span>Choose “This day only” if another day needs a different room arrangement.</span>
                </div>
                <div className="form-actions placement-actions">
                  <button type="button" className="secondary-btn" onClick={() => applyRoomAllocationToRelated(false)}>This day only</button>
                  <button type="button" className="primary-btn" onClick={() => applyRoomAllocationToRelated(true)}>Apply to all repeated days</button>
                </div>
              </div>
            </div>
          )}

          {/* Room Allocation Modal */}
          {roomModalState.isOpen && (
          <RoomAllocationModal
            isOpen={roomModalState.isOpen}
            onClose={() => setRoomModalState({ isOpen: false, dayIndex: null, serviceKey: null, item: null, service: null })}
            onSave={handleSaveRoomAllocation}
            item={roomModalState.item}
            itineraryTravellers={meta.travellers || []}
            beddedElsewhere={roomModalBeddedElsewhere}
            currencyCode={currencyCode}
            markupPct={markupPct}
          />
          )}
          {invoiceIssuePrompt && (() => {
            const { currency: targetCurrency, total, remaining } = invoiceIssuePrompt;
            const percentage = Number(invoiceIssuePrompt.percentage);
            const maxPercentage = total > 0 ? Math.min(100, (remaining / total) * 100) : 0;
            const amount = billableAtPercentage(total, percentage, itineraryInvoices, itineraryCreditNotes, targetCurrency);
            const validPercentage = Number.isFinite(percentage)
              && percentage > 0
              && percentage <= maxPercentage + 0.000001
              && amount > 0.009;
            const symbol = svcSymbol(targetCurrency);
            return (
              <ConfirmDialog
                title={`Issue ${targetCurrency} invoice`}
                message={`Choose the percentage of the full ${targetCurrency} itinerary total to request. The remaining balance stays available for later invoices and is tracked separately in the statement of account.`}
                confirmLabel={`Issue invoice · ${symbol}${amount.toFixed(2)}`}
                cancelLabel="Cancel"
                busy={issuingInvoice}
                onCancel={() => setInvoiceIssuePrompt(null)}
                onConfirm={async () => {
                  if (!validPercentage) return;
                  const created = await handleIssueInvoiceHere({
                    targetCurrency,
                    requestPercent: percentage
                  });
                  if (created) setInvoiceIssuePrompt(null);
                }}
              >
                <div style={{ display: 'grid', gap: '0.7rem' }}>
                  <label htmlFor="invoice-request-percentage" style={{ fontSize: '0.82rem', fontWeight: 700, color: '#334155' }}>
                    Percentage of itinerary total
                  </label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.55rem' }}>
                    <input
                      id="invoice-request-percentage"
                      type="number"
                      min="0.01"
                      max={maxPercentage}
                      step="0.01"
                      autoFocus
                      value={invoiceIssuePrompt.percentage}
                      onChange={(event) => setInvoiceIssuePrompt((current) => current
                        ? { ...current, percentage: event.target.value }
                        : current)}
                      style={{ width: '100%', padding: '0.6rem 0.7rem', border: '1px solid #cbd5e1', borderRadius: '8px', fontSize: '1rem' }}
                    />
                    <strong style={{ color: '#475569' }}>%</strong>
                  </div>
                  <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '0.75rem 0.9rem', display: 'grid', gap: '0.4rem', fontSize: '0.84rem', color: '#475569' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem' }}>
                      <span>{targetCurrency} itinerary total</span>
                      <strong>{symbol}{total.toFixed(2)}</strong>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem' }}>
                      <span>Invoice amount</span>
                      <strong style={{ color: '#0d7478' }}>{symbol}{amount.toFixed(2)}</strong>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem' }}>
                      <span>Balance remaining after invoice</span>
                      <strong>{symbol}{Math.max(0, round2(remaining - amount)).toFixed(2)}</strong>
                    </div>
                  </div>
                  {percentage > maxPercentage + 0.000001 && (
                    <p style={{ margin: 0, color: '#b91c1c', fontSize: '0.8rem', fontWeight: 600 }}>
                      The selected percentage exceeds the unbilled {targetCurrency} balance. Maximum available: {maxPercentage.toFixed(2)}%.
                    </p>
                  )}
                </div>
              </ConfirmDialog>
            );
          })()}
        </div>
      </div>
    </div>
  );
};

export default ItineraryBuilder;
