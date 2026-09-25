import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
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
  Users
} from 'lucide-react';
import { supabase, getLoggedInUserName } from '../lib/supabase';
import { useToast } from '../context/ToastContext';
import { useCurrencies } from '../hooks/useCurrencies';
import ClientTourForm from '../components/ClientTourForm';
import { usePageGuard } from '../context/NavigationGuardContext';
import RoomAllocationModal from '../components/RoomAllocationModal';
import { validateRoomAllocation, isAdultTraveller } from '../lib/roomAllocationHelper';
import { computePerPersonRows, breakdownSnapshot } from '../lib/perPersonPricing';
import { accommodationBreakdown } from '../lib/accommodationBreakdown';
import { LIBRARY_ITEM_LIGHT_FIELDS } from '../lib/libraryItemFields';
import {
  buildLinesFromDays,
  accountingPayload,
  effectiveBalance,
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

/* â”€â”€â”€ Pure helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

const toISODate = (iso) => (iso ? String(iso).slice(0, 10) : '');

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
   margin-only net VAT = output VAT − input VAT. */
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

const effectiveAdultRate = (rate) =>
  rate ? parseFloat(rate.price_1_adult) || parseFloat(rate.unit_price) || 0 : 0;

// Contract pricing model â€” drives whether a rate is charged per traveller or
// once (flat / per vehicle / per trip). A flat-rate item (e.g. a city tour
// charged per vehicle) must NOT be multiplied by pax: its per-person figure is
// the contract total divided by the travellers, so per-pax Ã— pax == contract.
const FLAT_BASIS = new Set(['per_vehicle', 'per_trip', 'per_room', 'flat']);

const basisOfItem = (item, code) => {
  const rate = rateForItem(item, code);
  return rate?.rate_basis || item?.pricing_model || 'per_person';
};

const isFlatBasis = (basis) => FLAT_BASIS.has(basis);

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

const tierRateForPax = (rate, pax) => {
  const tiers = Array.isArray(rate?.tiered_pricing) ? rate.tiered_pricing : [];
  if (!tiers.length) return 0;
  const p = Number(pax) || 0;
  let chosen = null;
  for (const t of tiers) {
    const minP = parseInt(t.min_pax, 10) || 0;
    const maxP = parseInt(t.max_pax, 10) || 0;
    if (p >= minP && (maxP === 0 || p <= maxP)) { chosen = t; break; }
  }
  if (!chosen) chosen = tiers[tiers.length - 1];
  const total = parseFloat(chosen?.rate) || 0;
  return p > 0 ? total / p : total;
};

// Accommodation rates are quoted per room occupancy, not per traveller:
//   1 traveller -> single rate (price_1_adult / single_room_rate)
//   2 travellers -> per-person sharing rate (price_2_adults / double_twin_rate)
//   3+ travellers -> the first 2 adults share at the sharing rate and each
//   additional adult adds the extra-adult rate (price_3_plus_adults, falling
//   back to the sharing rate) — i.e. 2 x sharing + (pax - 2) x extra, divided
//   by pax for the per-person figure. Contract room cost = perPax x pax.
const accommodationPaxRate = (rate, pax) => {
  const p = Number(pax) || 0;
  const num = (v) => parseFloat(v) || 0;
  if (p <= 1) return num(rate?.price_1_adult) || num(rate?.single_room_rate) || num(rate?.unit_price) || 0;
  if (p === 2) return num(rate?.price_2_adults) || num(rate?.double_twin_rate) || 0;
  const sharing = num(rate?.price_2_adults) || num(rate?.double_twin_rate) || num(rate?.price_1_adult) || 0;
  const extra = num(rate?.price_3_plus_adults) > 0 ? num(rate?.price_3_plus_adults) : sharing;
  return p > 0 ? (2 * sharing + Math.max(0, p - 2) * extra) / p : 0;
};

// Per-person buy figure implied by a contract, given the traveller count.
//   per_person items: the rate itself is per person.
//   per_person_sharing (accommodation): single rate when 1 traveller,
//   per-person sharing rate when 2+, keyed by occupancy (never the single
//   rate multiplied by pax).
//   flat / per_vehicle / per_trip / per_room: contract total Ã· travellers,
//   so the line (perPax Ã— pax) reproduces the contract amount exactly.
const contractPaxRate = (item, code, pax) => {
  const rate = rateForItem(item, code);
  const raw = effectiveAdultRate(rate);
  const basis = basisOfItem(item, code);
  const p = Number(pax) || 0;
  if (basis === 'tiered') return tierRateForPax(rate, p);
  if (basis === 'per_person_sharing') return accommodationPaxRate(rate, p);
  if (isFlatBasis(basis)) return p > 0 ? raw / p : raw;
  return raw;
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
       instead of the sharing rate (single − sharing) per night. Omitted when
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
      services.push({
        category: sv.category,
        currencyCode: sv.currencyCode,
        sellPP: Number(sv.sellPP) || 0,
        taxRate: numOr(sv.taxRate, defaults.defaultTaxRate),
        itemId: sv.itemId || null,
        roomAllocations: Array.isArray(sv.roomAllocations) ? sv.roomAllocations : [],
        markup: Number(sv.markup) || 0
      });
    });
  });
  const rateBy = (itemId) => {
    if (!itemId) return null;
    const item = libraryItems.find((x) => String(x.id) === String(itemId));
    if (!item) return null;
    const rate = rateForItem(item, code);
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

const statusLabelOf = (v) => STATUS_OPTIONS.find((s) => s.value === v)?.label || v;

/* ─── Email tooling (default tenant mail client via mailto) ─────────────────
   There is no SMTP backend in this build; the tenant's default email client
   handles sending. We compose fully prefilled mailto: drafts for every
   supplier / service so the user simply presses Send. Vouchers and service
   requests are strictly derived from persisted data — they cannot be edited. */

const mailTo = (email, subject, body) =>
  `mailto:${(email || '').trim()}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

const emailOf = (sup) =>
  (sup && (sup.email || sup.contact_email || sup.email_address || '').trim()) || '';

/* ────────────────────────────────────────────────────────────────────────────
   Text decode guard. Library rows (names/notes) arrive from any era of the
   tenant DB and can carry mojibake from a legacy import (UTF-8 bytes read as
   Latin-1/CP1252, then re-stored). We only fix display, never the DB: replace
   the classic double-encoded sequences at render time. Pure + idempotent —
   returns its input unchanged when nothing needs decoding, so it is a no-op
   on already-clean strings. This forces every day-by-day label back to
   plain English/ASCII while leaving the persisted rows untouched.
   ──────────────────────────────────────────────────────────────────────────── */


/* Repair classic UTF-8-misread-as-Latin-1 mojibake in text that arrived via a
   legacy-codepage import (Ã©→é, Ã±→ñ, â€™→’, â€“→–, â€”→—, Ã¤→ä, Ã¸→ø, …).
   Pure no-op on clean strings; used only to normalise on-screen day-by-day
   library labels + notes. Never touches the database. */
const repairText = (txt) => {
  if (!txt || typeof txt !== 'string') return txt || '';
  const TR = [
    [/Ã©/g, 'é'], [/Ã¨/g, 'è'], [/Ãª/g, 'ê'], [/Ã«/g, 'ë'],
    [/Ã¢/g, 'â'], [/Ã´/g, 'ô'], [/Ã¶/g, 'ö'], [/Ã¼/g, 'ü'], [/Ã¹/g, 'ù'],
    [/Ã¤/g, 'ä'], [/Ã¶/g, 'ö'], [/Ãº/g, 'ú'], [/Ã­/g, 'í'], [/Ã³/g, 'ó'], [/Ã¡/g, 'á'],
    [/Ã±/g, 'ñ'], [/Ã§/g, 'ç'], [/Ã±/g, 'ñ'], [/Ã¸/g, 'ø'], [/Ã¦/g, 'æ'], [/ÃŸ/g, 'ß'],
    [/Ã˜/g, 'Ø'], [/Ã…/g, 'Å'], [/Ã‰/g, 'É'], [/Ãˆ/g, 'È'], [/Ãœ/g, 'Ü'], [/Ã–/g, 'Ö'], [/Ã„/g, 'Ä'], [/Ã�/g, 'Ã'],
    [/â€™/g, '’'], [/â€œ/g, '“'], [/â€�/g, '”'], [/â€“/g, '–'], [/â€”/g, '—'],
    [/â€¦/g, '…'], [/â€˜/g, '‘'], [/â€š/g, '‚'],
    [/Â¶/g, '·'], [/Âº/g, '·'], [/Â°…/g, '·'], [/Â¿/g, '·'],
    [/Â·/g, '·'], [/Â°/g, '°'], [/Â±/g, '±'], [/Â²/g, '²'], [/Â³/g, '³'],
    [/Â´/g, '´'], [/Âµ/g, 'µ'], [/Â¶/g, '¶'], [/Â¸/g, '¸'], [/Â¹/g, '¹'],
    [/Â»/g, '»'], [/Â¼/g, '¼'], [/Â½/g, '½'], [/Â¾/g, '¾']
  ];
  let out = String(txt);
  for (const [r, rep] of TR) out = String(out).replace(r, rep);
  return out;
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
const svTime = (sv) => `${sv.startTime || ''}${sv.startTime && sv.endTime ? '→' : ''}${sv.endTime || ''}`;

/* ─── Confirmation status codes (service request results) ────────────────────
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

/* Per-category confirmation detail lines used on the supplier voucher and the
   confirmed-stage reconfirmation email. Date is omitted here — the caller
   already places the (non-editable) service date from the itinerary. */
const voucherDetailLines = (sv) => {
  const cat = sv.category || '';
  const lines = [];
  lines.push('Confirmation Status: OK');
  const num = (sv.confirmationNumber || '').trim();
  if (num) lines.push(`Confirmation Number: ${num}`);
  if (/transfers?/i.test(cat)) {
    const flight = (sv.flightNumber || '').trim();
    if (flight) lines.push(`Flight number: ${flight}`);
    const time = (sv.time || '').trim();
    if (time) lines.push(`Time: ${time}`);
    const veh = (sv.vehicleType || '').trim();
    if (veh) lines.push(`Vehicle type: ${veh}`);
    if (sv.capacity !== '' && sv.capacity !== null && sv.capacity !== undefined) lines.push(`Capacity: ${sv.capacity}`);
  } else if (/accommodation/i.test(cat)) {
    const room = (sv.roomType || '').trim();
    if (room) lines.push(`Room type: ${room}`);
    if (sv.maxOccupancy !== '' && sv.maxOccupancy !== null && sv.maxOccupancy !== undefined) lines.push(`Max occupancy: ${sv.maxOccupancy}`);
    const meal = (sv.mealPlan || '').trim();
    if (meal) lines.push(`Meal plan: ${meal}`);
    const ci = (sv.checkInTime || '').trim();
    if (ci) lines.push(`Check-in time: ${ci}`);
    const co = (sv.checkOutTime || '').trim();
    if (co) lines.push(`Check-out time: ${co}`);
  } else if (/activities?|tours?|excursions?/i.test(cat)) {
    const veh = (sv.vehicleType || '').trim();
    if (veh) lines.push(`Vehicle type: ${veh}`);
    if (sv.maxOccupancy !== '' && sv.maxOccupancy !== null && sv.maxOccupancy !== undefined) lines.push(`Max occupancy: ${sv.maxOccupancy}`);
    const st = (sv.startTime || sv.time || '').trim();
    if (st) lines.push(`Start time: ${st}`);
    const en = (sv.endTime || '').trim();
    if (en) lines.push(`End time: ${en}`);
  } else if (/meals?|dinner|lunch|breakfast/i.test(cat)) {
    const st = (sv.startTime || sv.time || '').trim();
    if (st) lines.push(`Start time: ${st}`);
  } else {
    const time = (sv.time || '').trim();
    if (time) lines.push(`Time: ${time}`);
  }
  const notes = (sv.notes || '').trim();
  if (notes) lines.push(`Notes: ${notes}`);
  return lines;
};

const servicesBySupplier = (days, libraryItems) => {
  const groups = {};
  const order = [];
  const supplierOf = (sv) => {
    const li = (libraryItems || []).find((it) => it.id === sv.itemId);
    return li?.supplier || sv.supplierObj || null;
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

/* One combined mailto body for every service going to a single supplier. */
const supplierRequestEmail = (group, allDays, meta, currencySymbol, paxCount) => {
  const adults = Number(meta.numAdults) || 0;
  const children = Number(meta.numChildren) || 0;
  const bodies = group.svcs.map(({ sv, day }) => {
    const totalSell = round2((Number(sv.sellPP) || 0) * paxCount);
    return [
      `Service: ${repairText(sv.name)}`,
      day.date ? `Date: ${formatDateLong(day.date)}` : '',
      timeRangeOf(sv) ? `Time: ${timeRangeOf(sv)}` : '',
      serviceNotes(sv) ? `Notes: ${serviceNotes(sv)}` : '',
      `Guests: ${adults || 0} Adult(s)${children ? ` / ${children} Child(ren)` : ''} (${paxCount} total)`,
      `Estimated net: ${currencySymbol}${totalSell.toFixed(2)}`
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
    `Kind regards,`
  ].join('\n');
  return {
    to: group.email,
    subject: `Provisional Service Request — ${meta.referenceNumber || meta.reference || ''}`,
    body
  };
};

/* Confirmed-stage reconfirmation — one mailto draft per supplier, carrying the
   per-category confirmation details (status OK + supplier confirmation data). */
const supplierConfirmationEmail = (group, allDays, meta, currencySymbol, paxCount) => {
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
    `Kind regards,`
  ].join('\n');
  return {
    to: group.email,
    subject: `Service Confirmation — ${meta.referenceNumber || meta.reference || ''}`,
    body
  };
};

/* Per-item email line group shared by the single-service draft and the
   combined-per-supplier draft so both styles carry the exact same fields in
   the exact same order (Service → Dates → Time → Guests → Special Req).      */
const serviceItemLines = (sv, day, meta, currencySymbol, paxCount) => {
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
const serviceItemEmail = (sv, day, amount, meta, currencySymbol, paxCount) => {
  const agencyLabel = meta.agencyRef || meta.agency_reference || meta.client?.name || 'Direct Client';
  const body = [
    `We would like to place a provisional request for the following service on behalf of our client:`,
    '',
    serviceItemLines(sv, day, meta, currencySymbol, paxCount),
    '',
    `Estimated net: ${currencySymbol}${amount.toFixed(2)}`,
    `Our Reference#: ${meta.referenceNumber || meta.reference || '—'}`,
    `Agency/Direct Client: ${agencyLabel}`,
    `Client Nationality: ${meta.client?.nationality || '—'}`
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

/* Per-traveller detail lines (nationality, passport, emergency contact, dietary,
   insurance) so important client info travels into vouchers + documents. Notes are
   intentionally NOT inline here — they are compounded at the bottom of the voucher
   in a single Notes box, each labelled with the traveller it belongs to. */
const travellerDetailLines = (travellers) => {
  return (Array.isArray(travellers) ? travellers : []).map((tr) => {
    const who = `${tr.name} ${tr.surname || ''}`.trim() || 'Traveller';
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
    const who = `${tr.name} ${tr.surname || ''}`.trim() || 'Traveller';
    const note = (tr.notes || '').trim();
    return note ? `${who}: ${note}` : '';
  }).filter(Boolean);
};
const voucherFor = (group, allDays, meta, currencySymbol, paxCount) => {
  const dateStr = (day) => (day.date ? formatDateLong(day.date) : '');
  const lines = group.svcs.map(({ sv, day }) => [
    `• ${repairText(sv.name)}`,
    dateStr(day) ? `  Date: ${dateStr(day)}` : '',
    ...voucherDetailLines(sv).map((l) => `  ${l}`)
  ].filter((l) => l !== '').join('\n'));
  return [
    `SERVICE VOUCHER`,
    `Supplier: ${group.label}`,
    `Itinerary: ${meta.itineraryName}`,
    `Reference: ${meta.referenceNumber || meta.reference || '—'}`,
    `Tour Designer: ${meta.consultantName || '—'}`,
    `Client: ${meta.client?.name || '—'}`,
    `Travellers: ${(meta.travellers || []).map((tr) => `${tr.name} ${tr.surname || ''}`.trim()).filter(Boolean).join(', ') || '—'}`,
    ...travellerDetailLines(meta.travellers),
    `Guests: ${Number(meta.numAdults) || 0} Adult(s)${Number(meta.numChildren) ? ` / ${Number(meta.numChildren)} Child(ren)` : ''} (${paxCount} total)`,
    '',
    lines.join('\n\n'),
    ...(travellerNoteLines(meta.travellers).length
      ? ['', 'Notes:', ...travellerNoteLines(meta.travellers).map((l) => `• ${l}`)]
      : []),
    '',
    `Thank you for your cooperation.`
  ].join('\n');
};

/* Print-ready PDF (and Word) version of one supplier voucher. Reuses the exact
   read-only fields that voucherFor emits so the downloaded file is identical
   to what is shown and emailed — vouchers cannot be edited or diverge. */
const voucherDocHtml = (group, allDays, meta, currencySymbol, paxCount, opts) => {
  const { logo = '', logoSize = 'md' } = opts || {};
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
  const trav = (meta.travellers || []).map((tr) => `${tr.name} ${tr.surname || ''}`.trim()).filter(Boolean).join(', ') || '—';
  const clientLine = meta.client?.name ? esc(meta.client.name) : '—';
  const notes = travellerNoteLines(meta.travellers);
  return `<!doctype html><html><head><meta charset="utf-8"><title>Voucher — ${esc(group.label)}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: 'Segoe UI', Arial, sans-serif; color: #1e293b; margin: 0; padding: 24px; font-size: 13px; }
  .doc { max-width: 820px; margin: 0 auto; border: 1px solid #cbd5e1; border-top: 6px solid #0d7478; border-radius: 10px; overflow: hidden; background: #fff; }
  .hd { background: #f0fdfa; padding: 18px 22px; border-bottom: 2px solid #99f6e4; display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; }
  .hd .lg { flex: 0 0 auto; }
  .hd .lg img { display: block; max-width: ${logoW}px; height: auto; }
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
      <div class="lg">${logo ? `<img src="${esc(logo)}" alt="Company logo">` : ''}</div>
      <div class="tt" style="text-align:right">
        <div class="sub">Supplier</div>
        <h1>Service Voucher</h1>
        <div style="color:#0f766e;font-size:12px;font-weight:700">${esc(group.label)}</div>
      </div>
    </div>
    <div class="meta">
      <table>
        <tr><td class="h">Itinerary</td><td>${esc(meta.itineraryName || '—')}</td><td class="h">Reference</td><td>${esc(meta.referenceNumber || meta.reference || '—')}</td></tr>
        <tr><td class="h">Client</td><td>${clientLine}</td><td class="h">Guests</td><td>${Number(meta.numAdults) || 0} Adult(s)${Number(meta.numChildren) ? ` / ${Number(meta.numChildren)} Child(ren)` : ''} (${paxCount} total)</td></tr>
        <tr><td class="h">Tour Designer</td><td>${esc(meta.consultantName || '—')}</td><td class="h">Dates</td><td>${esc(formatDateLong(meta.travelStart))} → ${esc(formatDateLong(meta.travelEnd))}</td></tr>
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

/* ─── Stage-aware document drafts (all strict mailto) ─────────────────────
   Each lifecycle stage only unlocks the documents the CSV lifecycle defines:
     Quotation            → quotation PDF/Word (Export menu)
     Provisional Booking  → Deposit Invoice / Deposit Request
     Confirmed Booking    → Final Invoice, Vouchers, Travel Documents
     In Progress          → keeps confirmed docs, adds daily service briefs
     Completed            → feedback form + expense reconciliation
     Cancelled            → cancellation notice + refund statement (docs revoked) */

const DEPOSIT_PCT = 30;

const invoiceHeaderLines = (meta) => [
  `Itinerary: ${meta.itineraryName}`,
  `Reference: ${meta.referenceNumber || meta.reference || '—'}`,
  `Tour Designer: ${meta.consultantName || '—'}`,
  `Client: ${meta.client?.name || '—'}`,
  `Travellers: ${(meta.travellers || []).map((tr) => `${tr.name} ${tr.surname || ''}`.trim()).filter(Boolean).join(', ') || '—'}`,
  ...travellerDetailLines(meta.travellers),
  `Dates: ${meta.travelStart} to ${meta.travelEnd}`
];

/* Daily service brief for one day — operational handover for guides/suppliers. */
const dailyBriefFor = (day, meta, paxCount, currencySymbol) => {
  const lines = (day.services || []).map((sv) => {
    const line = round2((Number(sv.sellPP) || 0) * paxCount);
    return [
      `• ${repairText(sv.name)}`,
      timeRangeOf(sv) ? `  Time: ${timeRangeOf(sv)}` : '',
      `  Supplier: ${sv.supplierName || '—'}`,
      serviceNotes(sv) ? `  Notes: ${serviceNotes(sv)}` : '',
      `  Estimated value: ${currencySymbol}${line.toFixed(2)}`
    ].filter((l) => l !== '').join('\n');
  });
  const guests = (meta.travellers || []).map((tr) => `${tr.name} ${tr.surname || ''}`.trim()).filter(Boolean).join(', ') || '—';
  return [
    `DAILY SERVICE BRIEF — Day ${day.dayNumber}`,
    day.date ? `Date: ${formatDateLong(day.date)}` : '',
    `Itinerary: ${meta.itineraryName} (${meta.referenceNumber || meta.reference || '—'})`,
    `Travellers: ${guests}`,
    ...travellerDetailLines(meta.travellers),
    `Guests: ${Number(meta.numAdults) || 0} Adult(s)${Number(meta.numChildren) ? ` / ${Number(meta.numChildren)} Child(ren)` : ''} (${paxCount} total)`,
    '',
    ...lines,
    '',
    'Operational contact: ' + (meta.client?.contact_cell || meta.client?.contact_tel || '—')
  ].join('\n');
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



/* â”€â”€â”€ Component â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

export const ItineraryBuilder = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const data = location.state || null;
  const { showToast } = useToast();
  const { currencies } = useCurrencies();

  const [meta, setMeta] = useState({
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
    status: data?.status || 'quotation',
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
  const [issuingInvoice, setIssuingInvoice] = useState(false);
  const [emailFormat, setEmailFormat] = useState('pdf');
  const [searchTerm, setSearchTerm] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [pickerItems, setPickerItems] = useState([]);
  const [pickerLoading, setPickerLoading] = useState(false);
  const [categoryChips, setCategoryChips] = useState([]);
  const pickerSearchRef = useRef(null);
  const [currencyCode, setCurrencyCode] = useState('ZAR');
  const [currencyOpen, setCurrencyOpen] = useState(false);
  const [currencySearch, setCurrencySearch] = useState('');
  const [days, setDays] = useState([]);
  const [selectedDayIndex, setSelectedDayIndex] = useState(0);
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
  const [placementRepeat, setPlacementRepeat] = useState(false);
  const [placementRepeatCount, setPlacementRepeatCount] = useState(2);
  const [placementCopyDays, setPlacementCopyDays] = useState([]);
  const [roomApplyPrompt, setRoomApplyPrompt] = useState(null);
  const [vehicleDraft, setVehicleDraft] = useState(null);

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
  const markupPct = Number(meta.client?.markup_percentage) || 0;
  const currentDay = days[selectedDayIndex] || null;
  const stage = meta.status || 'quotation';
  const itineraryDocAllowed = stage === 'quotation' || stage === 'provisional';
  const isProvisional = stage === 'provisional';
  const isConfirmed = stage === 'confirmed';
  const isInProgress = stage === 'in_progress';
  const isCompleted = stage === 'completed';
  const isCancelled = stage === 'cancelled';
  const isReadOnly = isCompleted || isCancelled;
  const completedRef = useRef(isReadOnly);

  useEffect(() => {
    completedRef.current = isReadOnly;
  }, [isReadOnly]);
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
        const line = (Number(sv.sellPP) || 0) * paxCount;
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
        const line = (Number(sv.sellPP) || 0) * paxCount;
        const rate = numOr(sv.taxRate, defaultTaxRate);
        t += vatOfInclusive(line, rate);
      });
    });
    return round2(t);
  }, [days, paxCount, defaultTaxRate]);

  const itineraryCostTotal = useMemo(() => {
    let c = 0;
    days.forEach((d) => {
      (d.services || []).forEach((sv) => {
        c += (Number(sv.buyPP) || 0) * paxCount;
      });
    });
    return round2(c);
  }, [days, paxCount]);

  /* ── Issued-invoice state for this itinerary + currency ──────────────────
     A deposit invoice is raised while provisional; a final invoice once the
     booking is confirmed. Only one live invoice per (type, currency) exists. */
  const invoiceTypeForStage = isProvisional ? 'deposit' : 'final';
  const invoicesInCurrency = useMemo(
    () => itineraryInvoices.filter((inv) => (inv.currency_code || '').toUpperCase() === currencyCode.toUpperCase()),
    [itineraryInvoices, currencyCode]
  );
  const depositInvoice = useMemo(
    () => invoicesInCurrency.find((inv) => inv.invoice_type === 'deposit' && inv.status !== 'void') || null,
    [invoicesInCurrency]
  );
  const finalInvoice = useMemo(
    () => invoicesInCurrency.find((inv) => inv.invoice_type === 'final' && inv.status !== 'void') || null,
    [invoicesInCurrency]
  );
  const activeInvoice = invoiceTypeForStage === 'final' ? finalInvoice : depositInvoice;
  const paidDepositTotal = useMemo(
    () => round2(invoicesInCurrency
      .filter((inv) => inv.invoice_type === 'deposit' && inv.status === 'paid')
      .reduce((a, r) => a + (Number(r.deposit_amount) || Number(r.total_incl) || 0), 0)),
    [invoicesInCurrency]
  );
  const depositRequested = round2(paxBalanceTotal * (depositPct / 100));
  const balanceAfterDeposit = round2(paxBalanceTotal - depositRequested);
  const depositPaid = depositInvoice?.status === 'paid' || paidDepositTotal > 0;
  const finalPaid = finalInvoice?.status === 'paid';
  const depositBalanceRemaining = depositPaid ? round2(paxBalanceTotal - paidDepositTotal) : balanceAfterDeposit;
  const finalOutstanding = finalInvoice
    ? round2(effectiveBalance(finalInvoice))
    : round2(paxBalanceTotal - paidDepositTotal);
  const currencyReceipts = useMemo(
    () => itineraryReceipts.filter((r) => (r.currency_code || '').toUpperCase() === currencyCode.toUpperCase()),
    [itineraryReceipts, currencyCode]
  );

  /* ── Stage-based document unlocks ──────────────────────────────────────
     Each lifecycle stage only shows the tabs the CSV lifecycle defines:
     quotation / pending → planning tabs only; provisional adds the deposit
     invoice + supplier service request; confirmed (and in progress) release
     the full travel pack; in progress adds operational briefs; completed
     shows post-tour closure; cancelled shows the cancellation module and
     revokes everything else. */
  const visibleTabIds = useMemo(() => {
    const ids = ['itinerary', 'client', 'pricing', 'notes'];
    if (isProvisional) ids.push('service-request', 'invoices');
    if (isConfirmed || isInProgress) ids.push('travel-docs', 'invoices', 'vouchers');
    if (isInProgress) ids.push('operations');
    if (isCompleted) ids.push('post-tour');
    if (isCancelled) ids.push('cancellation');
    return ids;
  }, [isProvisional, isConfirmed, isInProgress, isCompleted, isCancelled]);
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

  const loadLibraryItemsByIds = useCallback(async (cid, ids) => {
    if (!cid || !ids || ids.length === 0) {
      setLibraryItems([]);
      return;
    }
    try {
      const { data: items } = await supabase
        .from('library_items')
        .select(LIBRARY_ITEM_LIGHT_FIELDS)
        .in('id', ids);
      const itemIds = (items || []).map((i) => i.id);
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
      const supIds = [...new Set((items || []).map((i) => i.supplier_id).filter(Boolean))];
      const { data: suppliersData } = supIds.length
        ? await supabase.from('suppliers').select('id, name, email, country, province_state, city, city_location').in('id', supIds)
        : { data: [] };
      setLibraryItems(buildMergedItems(items || [], ratesData || [], carRates, suppliersData || []));
    } catch {
      showToast('Failed to load saved library items', 'error');
    }
  }, [showToast]);

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
      let q = supabase
        .from('library_items')
        .select(LIBRARY_ITEM_LIGHT_FIELDS)
        .eq('company_id', companyId)
        .order('name', { ascending: true })
        .limit(30);
      if (categoryFilter !== '') q = q.eq('category', categoryFilter);
      if (safeTerm) q = q.or(`name.ilike.%${esc(safeTerm)}%,description.ilike.%${esc(safeTerm)}%`);
      const { data: items } = await q;
      const itemIds = (items || []).map((i) => i.id);
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
      const supIds = [...new Set((items || []).map((i) => i.supplier_id).filter(Boolean))];
      const { data: suppliersData } = supIds.length
        ? await supabase.from('suppliers').select('id, name, email, country, province_state, city, city_location').in('id', supIds)
        : { data: [] };
      const merged = buildMergedItems(items || [], ratesData || [], carRates, suppliersData || []);
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
  }, [companyId, searchTerm, categoryFilter, showToast]);

  useEffect(() => {
    if (pickerSearchRef.current) clearTimeout(pickerSearchRef.current);
    pickerSearchRef.current = setTimeout(() => fetchPickerItems(), 350);
    return () => {
      if (pickerSearchRef.current) clearTimeout(pickerSearchRef.current);
    };
  }, [searchTerm, categoryFilter, fetchPickerItems]);

  const initDaysFromRange = useCallback(() => {
    const count = daysInRange(meta.travelStart, meta.travelEnd);
    const built = Array.from({ length: count }, (_, i) => ({
      key: nextId(),
      dayNumber: i + 1,
      date: meta.travelStart ? addDaysToDate(meta.travelStart, i) : '',
      notes: '',
      services: []
    }));
    setDays(built);
    setSelectedDayIndex(0);
  }, [meta.travelStart, meta.travelEnd, nextId]);

  const loadExistingDays = useCallback(async () => {
    const id = data?.itineraryId;
    if (!id) return false;
    try {
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
          status: it.status || prev.status,
          notes: it.notes || '',
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
            const buyPP = Number(ii.unit_cost) || 0;
            const mRaw = Number(ii.markup_percentage);
            const m = Number.isFinite(mRaw) ? mRaw : (Number(meta.client?.markup_percentage) || 0);
            const ccy = ii.currency_code || 'ZAR';
            const taxed = taxAppliesForCurrency(ccy);
            return {
              key: nextId(),
              itemId: ii.item_id || null,
              name: ii.item_name || '',
              category: ii.category || '',
              supplierName: ii.supplier_name || '',
              currencyCode: ccy,
              basis: ii.rate_basis || 'per_person',
              buyPP,
              markup: m,
              sellPP: round2(buyPP * (1 + m / 100)),
              pax: Number(ii.pax) || ((Number(meta.numAdults) || 0) + (Number(meta.numChildren) || 0)),
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
              maxOccupancy: ii.max_occupancy !== null && ii.max_occupancy !== undefined ? Number(ii.max_occupancy) : '',
              roomAllocations: Array.isArray(ii.room_allocations) ? ii.room_allocations : [],
              repeatGroupId: ii.repeat_group_id || null,
              mealPlan: ii.meal_plan || '',
              checkInTime: ii.check_in_time || '',
              checkOutTime: ii.check_out_time || '',
              startTime: ii.start_time || '',
              endTime: ii.end_time || '',
              notes: ii.notes || ''
            };
          })
        }));
        setDays(built);
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }, [data, meta.travelStart, meta.numAdults, meta.numChildren, meta.client, nextId, defaultTaxRate, defaultTaxLabel, taxAppliesForCurrency]);

  /* Auto-populate consultant name from the logged-in user's profile on first
     load. If the itinerary already has a consultant stored, loadExistingDays wins. */
  useEffect(() => {
    const fetchConsultant = async () => {
      try {
        const username = await getLoggedInUserName();
        if (username) {
          setMeta((prev) => ({
            ...prev,
            consultantName: prev.consultantName || username
          }));
        }
      } catch { /* noop */ }
    };
    fetchConsultant();
  }, []);

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

  /* Load this itinerary's issued invoices so the builder can reflect real
     deposit/final state (issued, paid, outstanding) without a round-trip to
     the Invoices module. */
  const loadItineraryInvoices = useCallback(async () => {
    const iid = meta.itineraryId || lastItineraryIdRef.current;
    if (!companyId || !iid) { setItineraryInvoices([]); setItineraryReceipts([]); return; }
    const { data } = await supabase
      .from('invoices')
      .select('*')
      .eq('itinerary_id', iid)
      .order('created_at', { ascending: false });
    const rows = data || [];
    setItineraryInvoices(rows);
    const ids = rows.map((r) => r.id);
    if (ids.length === 0) { setItineraryReceipts([]); return; }
    const { data: receipts } = await supabase
      .from('invoice_receipts')
      .select('*')
      .in('invoice_id', ids)
      .order('created_at', { ascending: false });
    setItineraryReceipts(receipts || []);
  }, [companyId, meta.itineraryId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const iid = meta.itineraryId || lastItineraryIdRef.current;
      if (!companyId || !iid) { if (!cancelled) { setItineraryInvoices([]); setItineraryReceipts([]); } return; }
      const { data } = await supabase
        .from('invoices')
        .select('*')
        .eq('itinerary_id', iid)
        .order('created_at', { ascending: false });
      const rows = data || [];
      if (cancelled) return;
      setItineraryInvoices(rows);
      const ids = rows.map((r) => r.id);
      if (ids.length === 0) { setItineraryReceipts([]); return; }
      const { data: receipts } = await supabase
        .from('invoice_receipts')
        .select('*')
        .in('invoice_id', ids)
        .order('created_at', { ascending: false });
      if (!cancelled) setItineraryReceipts(receipts || []);
    })();
    return () => { cancelled = true; };
  }, [companyId, meta.itineraryId]);

  /* â”€â”€ Derived lists â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

  const categoryOptions = useMemo(() => {
    const set = new Set(categoryChips.length ? categoryChips : DEFAULT_CATEGORY_CHIPS);
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
        if (!byCurr[code]) byCurr[code] = { buy: 0, sell: 0, tax: 0, taxIn: 0, taxNet: 0, count: 0, taxByLabel: {}, services: [] };
        const line = (Number(sv.sellPP) || 0) * paxCount;
        const buyLine = (Number(sv.buyPP) || 0) * paxCount;
        const rate = numOr(sv.taxRate, defaultTaxRate);
        const taxAmt = vatOfInclusive(line, rate);
        const taxInAmt = vatOfInclusive(buyLine, rate);
        const label = sv.taxLabel || 'VAT';
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
      g.days.forEach((r) => {
        Object.entries(r.taxByLabel || {}).forEach(([label, info]) => {
          if (!taxByLabel[label]) taxByLabel[label] = { amount: 0, rate: info.rate };
          taxByLabel[label].amount += info.amount;
        });
      });
      return {
        code,
        symbol: cur?.symbol || code,
        name: cur?.name || '',
        days: g.days,
        count: g.days.reduce((a, r) => a + r.count, 0),
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
        }))
      };
    });
  }, [days, paxCount, currencies, defaultTaxRate]);

  /* â”€â”€ Day / pricing helpers (called from handlers, not render) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

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
  }, []);

  const dayTotals = useCallback((day) => {
    let buy = 0;
    let sell = 0;
    let taxOut = 0;
    let taxIn = 0;
    (day.services || []).forEach((sv) => {
      const mergeLine = (Number(sv.sellPP) || 0) * paxCount;
      const rate = numOr(sv.taxRate, defaultTaxRate);
      buy += (Number(sv.buyPP) || 0) * paxCount;
      sell += mergeLine;
      taxOut += vatOfInclusive(mergeLine, rate);
      taxIn += vatOfInclusive((Number(sv.buyPP) || 0) * paxCount, rate);
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
    const basis = basisOfItem(item, currencyCode);
    const buyPP = round2(contractPaxRate(item, currencyCode, paxCount));
    const markup = Number(markupPct) || 0;
    const cat = item.category || '';
    const tourCat = /transfers?|tours?|activities?|excursions?/i.test(cat) || cat === 'Flights / Charter';
    const accomCat = /accommodation/i.test(cat);
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
      maxOccupancy: numOrBlank(libMaxOcc),
      mealPlan: item.mealPlan || item.meal_plan || (item.item_rates || []).find((r) => r.meal_plan)?.meal_plan || (accomCat ? 'Bed & Breakfast' : ''),
      checkInTime: item.checkInTime || item.check_in_time || '',
      checkOutTime: item.checkOutTime || item.check_out_time || '',
      startTime: item.startTime || item.start_time || '',
      endTime: item.endTime || item.end_time || '',
      notes: '',
      item_rates: item.item_rates || [],
      repeatGroupId: options.repeatGroupId || null
    };

    setDays((prev) => prev.map((d, i) => (
      i === dayIndex ? { ...d, services: [...d.services, svc] } : d
    )));
    const dayLabel = days[dayIndex] ? `Day ${days[dayIndex].dayNumber}` : 'the selected day';
    showToast(`${via === 'double-click' ? 'Added' : 'Dropped'} "${item.name}" into ${dayLabel}`, 'success');

    if (accomCat && !options.suppressRoomModal) {
      setRoomModalState({
        isOpen: true,
        dayIndex,
        serviceKey: svc.key,
        item,
        service: svc
      });
    }
  }, [currencyCode, markupPct, paxCount, days, nextId, defaultTaxRate, defaultTaxLabel, showToast, taxAppliesForCurrency]);

  const openPlacementPrompt = useCallback((dayIndex, item, via) => {
    setPlacementDraft({ dayIndex, item, via });
    setPlacementRepeat(false);
    setPlacementRepeatCount(Math.min(2, Math.max(1, days.length - dayIndex)));
    setPlacementCopyDays([]);
  }, [days.length]);

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

  const selectVehicleOption = useCallback((item) => {
    if (!vehicleDraft) return;
    const { dayIndex, via } = vehicleDraft;
    setVehicleDraft(null);
    openPlacementPrompt(dayIndex, item, via);
  }, [vehicleDraft, openPlacementPrompt]);

  const confirmPlacement = useCallback(() => {
    if (!placementDraft) return;
    const baseDay = placementDraft.dayIndex;
    const repeatCount = placementRepeat ? Math.max(1, Math.min(days.length - baseDay, Number(placementRepeatCount) || 1)) : 1;
    const repeatDays = Array.from({ length: repeatCount }, (_, index) => baseDay + index);
    const selectedDays = [...new Set([...repeatDays, ...placementCopyDays.map(Number)])]
      .filter((index) => index >= 0 && index < days.length)
      .sort((a, b) => a - b);
    const repeatGroupId = selectedDays.length > 1 ? nextId() : null;
    selectedDays.forEach((dayIndex, index) => {
      createService(dayIndex, placementDraft.item, index === 0 ? placementDraft.via : 'copy', {
        repeatGroupId,
        suppressRoomModal: index !== 0
      });
    });
    setPlacementDraft(null);
    setPlacementCopyDays([]);
  }, [placementDraft, placementRepeat, placementRepeatCount, placementCopyDays, days.length, nextId, createService]);

  const openRoomAllocationModal = useCallback((dayIndex, sv) => {
    const libraryItem = libraryItems.find((it) => it.id === sv.itemId) || {};
    const libItem = {
      ...libraryItem,
      id: sv.itemId,
      name: libraryItem.name || sv.name,
      category: libraryItem.category || sv.category,
      maxOccupancy: sv.maxOccupancy || libraryItem.maxOccupancy || libraryItem.max_occupancy,
      roomType: sv.roomType || libraryItem.roomType || libraryItem.room_type,
      roomAllocations: sv.roomAllocations || [],
      item_rates: libraryItem.item_rates || sv.item_rates || []
    };
    setRoomModalState({
      isOpen: true,
      dayIndex,
      serviceKey: sv.key,
      item: libItem,
      service: sv
    });
  }, [libraryItems]);

  const validateAllRoomAllocations = useCallback(() => {
    for (let i = 0; i < (days || []).length; i++) {
      const day = days[i];
      const services = day.services || [];
      for (let j = 0; j < services.length; j++) {
        const sv = services[j];
        const check = validateRoomAllocation(sv, meta.travellers || []);
        if (!check.isValid) {
          return {
            isValid: false,
            dayNumber: day.dayNumber,
            serviceName: sv.name,
            reason: check.reason,
            serviceKey: sv.key,
            dayIndex: i,
            service: sv
          };
        }
      }
    }
    return { isValid: true };
  }, [days, meta.travellers]);

  const handleSaveRoomAllocation = useCallback(({ roomAllocations, calculatedBuy, calculatedSell, numRooms }) => {
    if (!roomModalState.serviceKey || roomModalState.dayIndex === null) return;
    const dayIdx = roomModalState.dayIndex;
    const svKey = roomModalState.serviceKey;
    const currentPax = Math.max(1, paxCount);
    const newBuyPP = round2(calculatedBuy / currentPax);
    const newSellPP = round2(calculatedSell / currentPax);

    setDays((prev) => prev.map((d, i) => (
      i === dayIdx
        ? {
            ...d,
            services: d.services.map((s) => (
              s.key === svKey
                ? {
                    ...s,
                    roomAllocations,
                    buyPP: newBuyPP,
                    sellPP: newSellPP,
                    numRooms
                  }
                : s
            ))
          }
        : d
    )));
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
  }, [roomModalState, paxCount, days, showToast]);

  const applyRoomAllocationToRelated = useCallback((applyToAll) => {
    if (!roomApplyPrompt) return;
    if (applyToAll) {
      const currentPax = Math.max(1, paxCount);
      const buyPP = round2(roomApplyPrompt.calculatedBuy / currentPax);
      const sellPP = round2(roomApplyPrompt.calculatedSell / currentPax);
      setDays((prev) => prev.map((day) => ({
        ...day,
        services: day.services.map((service) => roomApplyPrompt.related.some((entry) => entry.service.key === service.key)
          ? { ...service, roomAllocations: roomApplyPrompt.roomAllocations, buyPP, sellPP, numRooms: roomApplyPrompt.numRooms }
          : service)
      })));
    }
    setRoomApplyPrompt(null);
    showToast(applyToAll ? 'Room allocation applied to all repeated days' : 'Room allocation saved for this day only', 'success');
  }, [roomApplyPrompt, paxCount, showToast]);

  /* Patch one or more fields of a single service item (used by the Service
     Request / Travel Documents tabs for time, confirmation status, numbers,
     category details and service-specific notes). */
  const updateService = useCallback((dayKey, svKey, patch) => {
    if (completedRef.current) return;
    setDays((prev) => prev.map((d) => (
      d.key === dayKey
        ? { ...d, services: d.services.map((s) => (s.key === svKey ? { ...s, ...patch } : s)) }
        : d
    )));
  }, []);

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
  }, []);

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
  }, []);

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
  }, []);

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
  }, [days, normalizeDays, applyDateExtension, nextId]);

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
  }, [days, normalizeDays, applyDateExtension, nextId]);

  const clearDay = useCallback((idx) => {
    if (completedRef.current) return;
    setDays((prev) => prev.map((d, i) => (i === idx ? { ...d, services: [] } : d)));
    setKebabFor(null);
  }, []);

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
  }, [days, normalizeDays, applyDateExtension, showToast]);

  /* â”€â”€ Copy / Export / Save â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

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
          const buyPP = Number(ii.unit_cost) || 0;
          const mRaw = Number(ii.markup_percentage);
          const m = Number.isFinite(mRaw) ? mRaw : (Number(markupPct) || 0);
          const ccy = ii.currency_code || currencyCode;
          const taxed = taxAppliesForCurrency(ccy);
          return {
            key: nextId(),
            itemId: ii.item_id || null,
            name: ii.item_name || '',
            category: ii.category || '',
            supplierName: ii.supplier_name || '',
            currencyCode: ccy,
            buyPP,
            markup: m,
            basis: ii.rate_basis || 'per_person',
            sellPP: round2(buyPP * (1 + m / 100)),
            pax: Number(ii.pax) || paxCount,
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
            maxOccupancy: ii.max_occupancy !== null && ii.max_occupancy !== undefined ? Number(ii.max_occupancy) : '',
            roomAllocations: Array.isArray(ii.room_allocations) ? ii.room_allocations : [],
            repeatGroupId: ii.repeat_group_id || null,
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
      const next = normalizeDays(merged);
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
  }, [copySourceId, copyInsertDay, days, currencyCode, markupPct, paxCount, normalizeDays, applyDateExtension, nextId, availableItineraries, showToast, defaultTaxRate, defaultTaxLabel, taxAppliesForCurrency]);

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
      if (!['quotation', 'provisional'].includes(meta.status || 'quotation')) {
        showToast('The client itinerary document is only available for Quotation and Provisional bookings', 'warning');
        return;
      }
      showToast('Digital itinerary link sharing is coming soon', 'info');
      return;
    }
    if ((format === 'word' || format === 'pdf') && !['quotation', 'provisional'].includes(meta.status || 'quotation')) {
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
          const baseRate = item && item.item_rates && item.item_rates.length ? rateForItem(item, grp.code) : null;
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
    const hdrAddress = billing?.billing_address ? `<div style="${hdrAlign};color:#666;font-size:12px;margin-bottom:32px;">${esc(billing.billing_address).replace(/\n/g, '<br>')}</div>` : '';
    const designer = meta.consultantName ? esc(meta.consultantName) : '—';
    const travellersList = (meta.travellers || []).map((tr) => `${tr.name} ${tr.surname || ''}`.trim()).filter(Boolean);
    const travellersHtml = travellersList.length
      ? `<p style="margin:2px 0;">${travellersList.map((n) => esc(n)).join('<br>')}</p>`
      : '';
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
          if (/accommodation/i.test(category)) {
            const shared = supplier
              ? (supplierUse.get(supplier.toLowerCase()) || 0) > 1
              : false;
            const head = shared && supplier ? `${supplier}, ${name}` : (supplier || name);
            return `<strong>Accommodation</strong>: ${esc(head)}${meal ? `, ${esc(abbrevMealPlan(meal))}` : ''}`;
          }
          return `<strong>${esc(category || 'Service')}</strong>: ${esc(name)}`;
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
      groups.forEach((g) => m.set(g.code, computePerPerson(days, g.code, meta.travellers || [], libraryItems, { defaultTaxRate, paxCount })));
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
  }, [meta, days, paxCount, pricingGroups, currencyCode, currencySymbol, defaultTaxLabel, defaultTaxRate, downloadBlob, showToast, billing]);

  const handleSave = useCallback(async () => {
    if (!companyId) {
      showToast('Company not found', 'error');
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
      const headerPayload = {
        itinerary_name: meta.itineraryName,
        travel_start_date: finalStart || null,
        travel_end_date: finalEnd || null,
        num_adults: Number(meta.numAdults) || 0,
        num_children: Number(meta.numChildren) || 0,
        travellers: meta.travellers || [],
        agency_reference: meta.agencyRef || null,
        notes: meta.notes || null,
        status: meta.status || 'quotation',
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
          pax: s.pax || paxCount,
          total_buy: round2((s.buyPP || 0) * paxCount),
          total_sell: round2((s.sellPP || 0) * paxCount),
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
          max_occupancy: s.maxOccupancy !== '' && s.maxOccupancy !== null && s.maxOccupancy !== undefined ? Number(s.maxOccupancy) : null,
          room_allocations: Array.isArray(s.roomAllocations) ? s.roomAllocations : [],
          repeat_group_id: s.repeatGroupId || null,
          meal_plan: s.mealPlan || null,
          check_in_time: s.checkInTime || null,
          check_out_time: s.checkOutTime || null,
          start_time: s.startTime || null,
          end_time: s.endTime || null,
          notes: s.notes || null,
          is_included: true,
          sort_order: si
        }));
        if (svcRows.length) {
          const { error: itemsErr } = await supabase
            .from('itinerary_day_items')
            .insert(svcRows);
          if (itemsErr) throw itemsErr;
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

  /* ── Unsaved-changes guard ────────────────────────────────────────────────
     The app ships a NavigationGuardProvider (mounted in App.jsx) that shows a
     "Save & Leave / Discard & Leave / Cancel" modal whenever the page is dirty
     and the user navigates away, and it also warns on browser tab close via
     beforeunload. Register this page with it so a partially-built itinerary
     (services added but not yet saved) is never silently lost: the guard uses
     handleSave's return value (true=proceed, false=stay) to decide whether the
     navigation may complete. */
  usePageGuard('itinerary-builder', 'this itinerary', dirty, handleSave);

  /* ── Issue the stage invoice (deposit while provisional, final once
     confirmed) from inside the builder. Persists the itinerary first so the
     invoice snapshot always matches what is stored, then writes the invoice
     header + immutable line items and records the accounting export. */
  const handleIssueInvoiceHere = useCallback(async ({ silent = false } = {}) => {
    if (!companyId) { showToast('Company not found', 'error'); return null; }
    if (completedRef.current) return null;
    const type = isProvisional ? 'deposit' : 'final';
    const label = type === 'deposit' ? 'Deposit' : 'Final';
    const existing = itineraryInvoices.find((inv) => inv.invoice_type === type
      && inv.status !== 'void'
      && (inv.currency_code || '').toUpperCase() === currencyCode.toUpperCase());
    if (existing) {
      if (!silent) showToast(`${label} invoice already issued (${existing.invoice_number})`, 'warning');
      return existing;
    }
    setIssuingInvoice(true);
    try {
      const ok = await handleSave();
      if (!ok) return null;
      const iid = lastItineraryIdRef.current || meta.itineraryId;
      if (!iid) throw new Error('Save the itinerary before issuing an invoice');
      const agg = buildLinesFromDays(days, paxCount, currencyCode);
      if (!agg.lines.length) { showToast('Add day-by-day services before issuing an invoice', 'warning'); return null; }
      /* An invoice must carry payment details, so it can only be issued when an
         active bank account exists for this currency. Itineraries can still be
         built in any currency; only invoicing is blocked. */
      const activeBank = bankAccounts
        .filter((b) => b.is_active && (b.currency_code || '').toUpperCase() === currencyCode.toUpperCase())
        .sort((a, b) => (b.is_default ? 1 : 0) - (a.is_default ? 1 : 0))[0] || null;
      if (!activeBank) {
        const anyActive = bankAccounts.some((b) => b.is_active);
        showToast(anyActive
          ? `No active bank account for ${currencyCode}. Add or activate one in Settings > Bank Accounts to invoice in this currency.`
          : 'All bank accounts are deactivated. Add or activate a bank account in Settings to generate invoices.', 'error');
        return null;
      }
      const perPersonBreakdown = breakdownSnapshot(computePerPerson(
        days,
        currencyCode,
        Array.isArray(meta.travellers) ? meta.travellers : [],
        libraryItems,
        { defaultTaxRate, paxCount }
      ));

      const isFinal = type === 'final';
      let creditedAmount = 0;
      let creditedInvoiceId = null;
      let creditedInvoiceNumber = '';
      if (isFinal) {
        const { data: depositRows } = await supabase
          .from('invoices')
          .select('id, invoice_number, deposit_amount, total_incl, status')
          .eq('itinerary_id', iid)
          .eq('currency_code', currencyCode)
          .eq('invoice_type', 'deposit')
          .neq('status', 'void')
          .order('created_at', { ascending: false });
        const paid = (depositRows || []).filter((r) => r.status === 'paid');
        creditedAmount = round2(paid.reduce((a, r) => a + (Number(r.deposit_amount) || Number(r.total_incl) || 0), 0));
        if (paid[0]) {
          creditedInvoiceId = paid[0].id;
          creditedInvoiceNumber = paid[0].invoice_number;
        }
      }
      const depositAmount = isFinal ? creditedAmount : round2(agg.totalIncl * (depositPct / 100));
      const balance = round2(agg.totalIncl - creditedAmount);

      const { data: number, error: numErr } = await supabase.rpc('get_next_invoice_reference', { p_company_id: companyId });
      if (numErr || !number) throw new Error(numErr?.message || 'Could not allocate invoice number');

      const bank = activeBank;
      const bankDetails = bank ? {
        bank_name: bank.bank_name,
        account_holder_name: bank.account_holder_name,
        account_number: bank.account_number,
        branch_code: bank.branch_code,
        swift_code: bank.swift_code
      } : {};
      const client = meta.client || {};
      const header = {
        company_id: companyId,
        itinerary_id: iid,
        client_id: client.id || null,
        invoice_number: number,
        invoice_type: type,
        status: isFinal ? 'validated' : 'proforma',
        currency_code: currencyCode,
        subtotal_excl: agg.subtotalExcl,
        tax_total: agg.taxTotal,
        total_incl: agg.totalIncl,
        tax_label: agg.taxEntries[0]?.label || 'VAT',
        tax_rate: agg.taxEntries[0]?.rate ?? defaultTaxRate,
        deposit_percentage: depositPct,
        deposit_amount: depositAmount,
        balance_due: balance,
        credited_invoice_id: creditedInvoiceId,
        credited_invoice_number: creditedInvoiceNumber,
        credited_amount: creditedAmount,
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
      const { data: created, error: invErr } = await supabase
        .from('invoices')
        .insert([{ ...header, accounting_export: accounting }])
        .select('*')
        .single();
      if (invErr) throw invErr;

      const lineRows = agg.lines.map((l) => ({ ...l, invoice_id: created.id, company_id: companyId }));
      const { error: lineErr } = await supabase.from('invoice_line_items').insert(lineRows);
      if (lineErr) {
        await supabase.from('invoices').delete().eq('id', created.id);
        throw lineErr;
      }

      await loadItineraryInvoices();
      if (!silent) showToast(`${label} invoice ${number} issued`, 'success');
      return created;
    } catch (err) {
      const msg = /duplicate key|unique/i.test(err.message || '')
        ? `A ${type} invoice already exists for ${currencyCode}`
        : (err.message || 'Failed to issue invoice');
      showToast(msg, 'error');
      return null;
    } finally {
      setIssuingInvoice(false);
    }
  }, [companyId, isProvisional, itineraryInvoices, currencyCode, handleSave, meta.itineraryId, meta.client, meta.travellers, days, paxCount, depositPct, defaultTaxRate, bankAccounts, billing, libraryItems, loadItineraryInvoices, showToast]);

  /* ── Raise the payment receipt for the stage invoice and mark it paid. */
  const confirmPayment = useCallback(async () => {
    const inv = activeInvoice || await handleIssueInvoiceHere({ silent: true });
    if (!inv) return;
    setIssuingInvoice(true);
    try {
      const { data: number, error: numErr } = await supabase.rpc('get_next_receipt_reference', { p_company_id: companyId });
      if (numErr || !number) throw new Error(numErr?.message || 'Could not allocate receipt number');

      const amount = inv.invoice_type === 'deposit'
        ? round2(Number(inv.deposit_amount) || 0)
        : round2(Number(inv.balance_due) || 0);
      const balanceRemaining = inv.invoice_type === 'deposit' ? round2(Number(inv.balance_due) || 0) : 0;
      const receivedDate = new Date().toISOString().slice(0, 10);
      const accounting = {
        schema: 'torbuilder.receipt/v1',
        provider_agnostic: true,
        receipt_number: number,
        invoice_number: inv.invoice_number,
        invoice_type: inv.invoice_type,
        status: 'paid',
        date: receivedDate,
        currency: inv.currency_code,
        customer: { name: inv.bill_to_name, email: inv.bill_to_email },
        amount,
        balance_remaining: balanceRemaining,
        method: 'EFT'
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
        payment_method: 'EFT',
        payment_reference: inv.payment_reference || '',
        bill_to_name: inv.bill_to_name || '',
        bill_to_email: inv.bill_to_email || '',
        supplier_name: inv.supplier_name || '',
        supplier_tax_number: inv.supplier_tax_number || '',
        supplier_address: inv.supplier_address || '',
        bank_details: inv.bank_details || {},
        accounting_export: accounting,
        notes: null
      };
      const { error } = await supabase.from('invoice_receipts').insert([row]);
      if (error) throw error;

      const paidUpdate = { status: 'paid', paid_at: new Date().toISOString() };
      if (inv.invoice_type === 'final') paidUpdate.balance_due = 0;
      const { error: paidErr } = await supabase
        .from('invoices')
        .update(paidUpdate)
        .eq('id', inv.id);
      if (paidErr) throw paidErr;

      await loadItineraryInvoices();
      showToast(`Receipt ${number} issued — payment confirmed`, 'success');
    } catch (err) {
      showToast(err.message || 'Failed to confirm payment', 'error');
    } finally {
      setIssuingInvoice(false);
    }
  }, [activeInvoice, handleIssueInvoiceHere, companyId, loadItineraryInvoices, showToast]);

  /* ── Email the issued invoice. Produces the chosen format as a downloadable
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
      clientBillingAddressPosition: ['left', 'center', 'right'].includes(billing?.client_billing_address_position) ? billing.client_billing_address_position : 'left'
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

  /* â”€â”€ Edit itinerary details (Client & Tour) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

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
      const nextDays = days.map((d, i) => ({
        ...d,
        dayNumber: i + 1,
        date: payload.travelStart ? addDaysToDate(payload.travelStart, i) : d.date || ''
      }));
      setMeta((prev) => ({ ...prev, ...nextMeta }));
      setDays(nextDays);
      setLastSavedKey(JSON.stringify({ days: nextDays, meta: nextMeta }));
      setDetailsOpen(false);
      setSaved(true);
      showToast('Itinerary details updated', 'success');
    } catch (err) {
      showToast(err.message || 'Failed to update itinerary details', 'error');
    } finally {
      setSaving(false);
    }
  }, [meta.itineraryId, meta.client, showToast]);

  /* â”€â”€ Edit a day service (name + description override) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

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
  }, [editSvc, defaultTaxRate, defaultTaxLabel, showToast, taxAppliesForCurrency]);

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
  }, [days, editSvc, nextId, showToast]);

  /* â”€â”€ Render: no data guard â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

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
     the "Provisional Service Request" tab (editable) and the "Travel Documents"
     tab (forced read-only, supplier OK badge, printable). Contract / library
     fields are ALWAYS locked regardless of tab so the signed contract can never
     be overridden by hand-typed data. */
  const renderServiceCard = (sv, day, { editable, tab }) => {
    const cat = sv.category || '';
    const isTransfer = /transfers?/i.test(cat);
    const isAccom = /accommodation/i.test(cat);
    const isActivity = /activities?|tours?|excursions?/i.test(cat);
    const isMeal = /meals?|dinner|lunch|breakfast/i.test(cat);
    const canEdit = editable && !isReadOnly;
    /* Fields sourced from the contract / library item — never editable. */
    const contractLocked = isTransfer ? ['vehicleType', 'capacity'] : isAccom ? ['maxOccupancy', 'mealPlan'] : ['vehicleType', 'maxOccupancy'];
    const ro = (field) => !canEdit || contractLocked.includes(field);
    const update = (patch) => updateService(day.key, sv.key, patch);
    const showStatusButtons = tab === 'service-request' && canEdit;
    const ok = (sv.confirmationStatus || 'RQ') === 'OK';
    return (
      <div key={sv.key} style={{ border: '1px solid #e2e8f0', borderRadius: '10px', padding: '0.7rem 0.85rem', marginBottom: '0.6rem', background: '#fff' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '0.55rem' }}>
          <strong style={{ fontSize: '0.88rem', color: '#1a202c' }}>{repairText(sv.name)}</strong>
          {tab === 'travel-documents' ? (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.72rem', fontWeight: 800, color: ok ? '#15803d' : '#b45309', background: ok ? '#f0fdf4' : '#fffbeb', padding: '0.15rem 0.5rem', borderRadius: '999px' }}>
              <CheckCircle2 size={12} /> {ok ? 'OK · Confirmed' : 'OK · ' + (sv.confirmationStatus || 'RQ')}
            </span>
          ) : null}
        </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '0.5rem' }}>
        <div className="sidebar-field">
          <label>Date of service</label>
            <input className="sidebar-select" value={day.date ? formatDateShort(day.date) : '—'} readOnly style={{ background: '#f8fafc', color: '#64748b' }} />
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
                <input className="sidebar-select" placeholder="e.g. Mercedes Vito 8-seater" value={sv.vehicleType || ''} readOnly={true} title="From contract/library — locked" />
              </div>
              <div className="sidebar-field">
                <label>Capacity</label>
                <input className="sidebar-select" type="number" min="1" placeholder="Per contract" value={sv.capacity === '' ? '' : sv.capacity} readOnly={true} title="From contract/library — locked" />
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
                <input className="sidebar-select" type="number" min="1" placeholder="Per contract" value={sv.maxOccupancy === '' ? '' : sv.maxOccupancy} readOnly={true} title="From contract/library — locked" />
              </div>
              <div className="sidebar-field">
                <label>Meal plan</label>
                <input className="sidebar-select" placeholder="e.g. Half board" value={sv.mealPlan || ''} readOnly={true} title="From contract/library — locked" />
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
                <input className="sidebar-select" placeholder="e.g. Safari Landcruiser" value={sv.vehicleType || ''} readOnly={true} title="From contract/library — locked" />
              </div>
              <div className="sidebar-field">
                <label>Max occupancy</label>
                <input className="sidebar-select" type="number" min="1" placeholder="Per contract" value={sv.maxOccupancy === '' ? '' : sv.maxOccupancy} readOnly={true} title="From contract/library — locked" />
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
        <div className="sidebar-field" style={{ marginTop: '0.5rem' }}>
          <label>Notes</label>
          <textarea className="sidebar-select" rows={2} placeholder="Service-specific notes..." value={sv.notes || ''} readOnly={!canEdit} onChange={(e) => update({ notes: e.target.value })} style={{ resize: 'vertical', fontFamily: 'inherit' }} />
        </div>
      </div>
    );
  };

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
        {/* â”€â”€ Builder sidebar: library item picker â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
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
            ) : pickerItemsToShow.length === 0 ? (
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
                const basis = basisOfItem(item, currencyCode);
                const price = contractPaxRate(item, currencyCode, paxCount);
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
                      <span className="item-price-tag">{fmtMoney(price, currencySymbol)}<span style={{ color: '#94a3b8', fontWeight: 500 }}>/pax</span></span>
                    </div>
                    <div className="draggable-item-supplier">
                      {item.supplier?.name || ''}
                      {isFlatBasis(basis) ? <span className="basis-tag">{basisLabelOf(basis)}</span> : null}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </aside>

        {/* â”€â”€ Main panel â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
        <div className="builder-main">
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

          {/* Tabs — hidden stages are locked out of their documents */}
          <div className="builder-tabs">
            <button type="button" className={`builder-tab ${activeTab === 'itinerary' ? 'active' : ''}`} onClick={() => setActiveTab('itinerary')}>
              <Route size={15} /> Itinerary
            </button>
            <button type="button" className={`builder-tab ${activeTab === 'client' ? 'active' : ''}`} onClick={() => setActiveTab('client')}>
              <User size={15} /> Travelers Info
            </button>
            <button type="button" className={`builder-tab ${activeTab === 'pricing' ? 'active' : ''}`} onClick={() => setActiveTab('pricing')}>
              <Receipt size={15} /> Pricing
            </button>
            <button type="button" className={`builder-tab ${activeTab === 'notes' ? 'active' : ''}`} onClick={() => setActiveTab('notes')}>
              <StickyNote size={15} /> Notes
            </button>
            {isProvisional && (
              <>
                <button type="button" className={`builder-tab ${activeTab === 'service-request' ? 'active' : ''}`} onClick={() => setActiveTab('service-request')}>
                  <Mail size={15} /> Service Request
                </button>
                <button type="button" className={`builder-tab ${activeTab === 'invoices' ? 'active' : ''}`} onClick={() => setActiveTab('invoices')}>
                  <Receipt size={15} /> Deposit Request
                </button>
              </>
            )}
            {(isConfirmed || isInProgress) && (
              <>
                <button type="button" className={`builder-tab ${activeTab === 'travel-docs' ? 'active' : ''}`} onClick={() => setActiveTab('travel-docs')}>
                  <Plane size={15} /> Travel Documents
                </button>
                <button type="button" className={`builder-tab ${activeTab === 'invoices' ? 'active' : ''}`} onClick={() => setActiveTab('invoices')}>
                  <Receipt size={15} /> Invoices
                </button>
                <button type="button" className={`builder-tab ${activeTab === 'vouchers' ? 'active' : ''}`} onClick={() => setActiveTab('vouchers')}>
                  <Ticket size={15} /> Vouchers
                </button>
              </>
            )}
            {isInProgress && (
              <button type="button" className={`builder-tab ${activeTab === 'operations' ? 'active' : ''}`} onClick={() => setActiveTab('operations')}>
                <Calendar size={15} /> Operations
              </button>
            )}
            {isCompleted && (
              <button type="button" className={`builder-tab ${activeTab === 'post-tour' ? 'active' : ''}`} onClick={() => setActiveTab('post-tour')}>
                <CheckCircle2 size={15} /> Post-Tour
              </button>
            )}
            {isCancelled && (
              <button type="button" className={`builder-tab ${activeTab === 'cancellation' ? 'active' : ''}`} onClick={() => setActiveTab('cancellation')}>
                <X size={15} /> Cancellation
              </button>
            )}
          </div>

          {/* Day-by-day */}
          {tab === 'itinerary' && (
            <>
              {isReadOnly && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', background: isCancelled ? '#fee2e2' : '#f3e8ff', border: `1px solid ${isCancelled ? '#fecaca' : '#e9d5ff'}`, color: isCancelled ? '#b91c1c' : '#6b21a8', borderRadius: '12px', padding: '0.85rem 1.1rem', fontSize: '0.88rem', fontWeight: 600, marginBottom: '1rem' }}>
                  <Lock size={16} />
                  {isCancelled
                    ? <>This itinerary is <strong>Cancelled</strong> and revoked. Change its status from the badge above to re-open it.</>
                    : <>This itinerary is <strong>Completed</strong> and read-only. Change its status from the badge above to edit it again.</>}
                </div>
              )}
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
                        <span className="svc-head-line">Line</span>
                        <span />
                      </div>
                    )}
                    {(currentDay.services || []).map((sv) => {
                      const sellLine = round2((Number(sv.sellPP) || 0) * paxCount);
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
                              {paxCount > 0 ? ` · ${paxCount} pax` : ''}
                              {sv.currencyCode ? ` · ${sv.currencyCode}` : ''}
                              <span className={`basis-tag ${isFlatBasis(sv.basis) ? 'flat' : ''}`}>
                                {basisLabelOf(sv.basis)}
                              </span>
                            </div>
                            {/accommodation/i.test(sv.category || '') && (
                              <div style={{ marginTop: '0.35rem' }}>
                                {(() => {
                                  const roomCheck = validateRoomAllocation(sv, meta.travellers || []);
                                  const numRooms = sv.roomAllocations?.length || 0;
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
                                        ✓ {numRooms} Room(s) Allocated ({meta.travellers?.length || 0} Pax)
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
                                        background: '#fee2e2',
                                        color: '#b91c1c',
                                        border: '1px solid #fca5a5',
                                        cursor: 'pointer'
                                      }}
                                    >
                                      ⚠️ Room Allocation Required
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
                              title="Buy price â€” the supplier rate per person. Edit it directly to negotiate."
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
                  </tr>
                </thead>
                <tbody>
                  {(meta.travellers || []).map((t, i) => (
                    <tr key={i}>
                      <td style={{ color: '#94a3b8', fontWeight: 700 }}>{i + 1}</td>
                      <td>{t.name || '—'}</td>
                      <td>{t.surname || '—'}</td>
                      <td>{t.age || '—'}</td>
                    </tr>
                  ))}
                  {!meta.travellers?.length && (
                    <tr>
                      <td colSpan="4" style={{ color: '#94a3b8' }}>No traveller details recorded.</td>
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
                  {paxCount} traveller(s) Â· client markup {markupPct}%
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
                          <td colSpan="5" style={{ textAlign: 'right', fontWeight: 700 }}>Net {taxWordUpper(g.code)} to {taxAgencyOf(g.code, defaultRevenueAgency)} (Output − Input)</td>
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
                  <select className="sidebar-select" value={copySourceId} onChange={(e) => setCopySourceId(e.target.value)}>
                    <option value="">Select an itinerary...</option>
                    {availableItineraries.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.itinerary_name}{a.reference_number ? ` (${a.reference_number})` : ''}
                      </option>
                    ))}
                  </select>
                  {availableItineraries.length === 0 && (
                    <div style={{ fontSize: '0.8rem', color: '#94a3b8', marginTop: '0.4rem' }}>
                      No other itineraries available to copy from.
                    </div>
                  )}
                </div>
                <div className="sidebar-field">
                  <label>Insert after day</label>
                  <select className="sidebar-select" value={copyInsertDay} onChange={(e) => setCopyInsertDay(Number(e.target.value))}>
                    {Array.from({ length: days.length + 1 }, (_, i) => (
                      <option key={i} value={i + 1}>
                        {i === days.length ? `After Day ${i} (at the end)` : `After Day ${i + 1}`}
                      </option>
                    ))}
                  </select>
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

          {/* ─── Service Request (provisional) ───────────────────────────────────────
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
                  const m = supplierRequestEmail(first, days, meta, currencySymbol, paxCount);
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
                        {emailOf(grp.sup) ? `✉ ${emailOf(grp.sup)}` : 'No email on file — add one in Suppliers'}
                      </span>
                    </div>
                    <span style={{ fontSize: '0.75rem', color: '#64748b', whiteSpace: 'nowrap' }}>{grp.svcs.length} service{grp.svcs.length === 1 ? '' : 's'}</span>
                  </div>
                  <div style={{ padding: '0.85rem 1rem' }}>
{grp.svcs.map(({ sv, day }) => renderServiceCard(sv, day, { editable: !isReadOnly, tab: 'service-request' }))}
                    <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '0.8rem' }}>
                      <button type="button" className="secondary-btn" style={{ alignItems: 'center', gap: '0.4rem', background: '#9e1e50', borderColor: '#9e1e50', color: '#fff' }} disabled={!emailOf(grp.sup)} onClick={() => {
                        const m = supplierRequestEmail(grp, days, meta, currencySymbol, paxCount);
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

          {/* ─── Travel Documents (confirmed / in progress) ───────────────────────────
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
                        {emailOf(grp.sup) ? `✉ ${emailOf(grp.sup)}` : 'No email on file — add one in Suppliers'}
                      </span>
                    </div>
                    <span style={{ fontSize: '0.75rem', color: '#64748b', whiteSpace: 'nowrap' }}>{grp.svcs.length} service{grp.svcs.length === 1 ? '' : 's'}</span>
                  </div>
                  <div style={{ padding: '0.85rem 1rem' }}>
                    {grp.svcs.map(({ sv, day }) => renderServiceCard(sv, day, { editable: false, tab: 'travel-documents' }))}
                    <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '0.8rem' }}>
                      <button type="button" className="secondary-btn" style={{ alignItems: 'center', gap: '0.4rem', background: '#9e1e50', borderColor: '#9e1e50', color: '#fff' }} disabled={!emailOf(grp.sup)} onClick={() => {
                        const m = supplierConfirmationEmail(grp, days, meta, currencySymbol, paxCount);
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
                            const m = supplierConfirmationEmail(g, days, meta, currencySymbol, paxCount);
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

          {/* ─── Invoices (provisional → deposit request, confirmed+ → final) ── */}
          {tab === 'invoices' && (
            <div className="builder-panel-card">
              <h3 style={{ fontSize: '1.1rem', fontWeight: 800, color: '#1a202c', marginBottom: '0.4rem' }}>
                Invoice
              </h3>
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

              {isProvisional ? (
                <div className="invoice-total" style={{ background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: '14px', padding: '1rem 1.25rem', marginBottom: '1.15rem' }}>
                  <div style={{ fontSize: '0.8rem', color: '#1e40af', fontWeight: 700, marginBottom: '0.25rem' }}>Total itinerary price</div>
                  <div style={{ fontSize: '1.6rem', fontWeight: 900, color: '#1e40af' }}>
                    {currencySymbol}{paxBalanceTotal.toFixed(2)}
                  </div>
                  <div style={{ display: 'flex', gap: '1.5rem', marginTop: '0.5rem', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: '0.82rem', color: '#334155', fontWeight: 600 }}>
                      Deposit requested ({depositPct}%): <strong>{currencySymbol}{depositRequested.toFixed(2)}</strong>
                    </span>
                    <span style={{ fontSize: '0.82rem', color: '#334155', fontWeight: 600 }}>
                      {depositPaid ? 'Balance remaining:' : 'Balance remaining after deposit:'} <strong>{currencySymbol}{depositBalanceRemaining.toFixed(2)}</strong>
                    </span>
                    {depositPaid && (
                      <span style={{ fontSize: '0.82rem', color: '#15803d', fontWeight: 800 }}>
                        Deposit received: {currencySymbol}{paidDepositTotal.toFixed(2)}
                      </span>
                    )}
                    {currencyReceipts.length > 0 && (
                      <div style={{ flexBasis: '100%', borderTop: '1px solid #bfdbfe', paddingTop: '0.5rem', marginTop: '0.2rem' }}>
                        <div style={{ fontSize: '0.72rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.04em', color: '#94a3b8', marginBottom: '0.25rem' }}>Payments received</div>
                        {currencyReceipts.map((r) => (
                          <div key={r.id} style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', fontSize: '0.82rem', color: '#334155', padding: '0.14rem 0' }}>
                            <span style={{ fontWeight: 600 }}>
                              {TYPE_LABEL[r.invoice_type] || r.invoice_type} — received {r.received_date || '—'}
                            </span>
                            <span style={{ fontWeight: 700 }}>
                              <button
                                type="button"
                                onClick={() => viewReceipt(r)}
                                title="View / print receipt"
                                style={{ background: 'none', border: 'none', padding: 0, color: '#0d7478', fontWeight: 800, cursor: 'pointer', textDecoration: 'underline', font: 'inherit' }}
                              >
                                {r.receipt_number}
                              </button>
                              {'  '}{fmtMoney(r.amount, currencySymbol)}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="invoice-total" style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '14px', padding: '1rem 1.25rem', marginBottom: '1.15rem' }}>
                  <div style={{ fontSize: '0.8rem', color: '#16a34a', fontWeight: 700, marginBottom: '0.25rem' }}>Outstanding balance</div>
                  <div style={{ fontSize: '1.6rem', fontWeight: 900, color: '#15803d' }}>
                    {currencySymbol}{finalOutstanding.toFixed(2)}
                  </div>
                  <div style={{ display: 'grid', gap: '0.3rem', marginTop: '0.6rem' }}>
                    <span style={{ fontSize: '0.82rem', color: '#334155', fontWeight: 600 }}>
                      Total invoice amount: <strong>{currencySymbol}{paxBalanceTotal.toFixed(2)}</strong>
                    </span>
                    {currencyReceipts.length > 0 && (
                      <div style={{ borderTop: '1px solid #bbf7d0', paddingTop: '0.5rem', marginTop: '0.3rem' }}>
                        <div style={{ fontSize: '0.72rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.04em', color: '#94a3b8', marginBottom: '0.25rem' }}>Payments received</div>
                        {currencyReceipts.map((r) => (
                          <div key={r.id} style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', fontSize: '0.82rem', color: '#334155', padding: '0.14rem 0' }}>
                            <span style={{ fontWeight: 600 }}>
                              {TYPE_LABEL[r.invoice_type] || r.invoice_type} — received {r.received_date || '—'}
                            </span>
                            <span style={{ fontWeight: 700 }}>
                              <button
                                type="button"
                                onClick={() => viewReceipt(r)}
                                title="View / print receipt"
                                style={{ background: 'none', border: 'none', padding: 0, color: '#0d7478', fontWeight: 800, cursor: 'pointer', textDecoration: 'underline', font: 'inherit' }}
                              >
                                {r.receipt_number}
                              </button>
                              {'  '}{fmtMoney(r.amount, currencySymbol)}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                    {finalPaid && (
                      <span style={{ fontSize: '0.82rem', color: '#15803d', fontWeight: 800 }}>
                        Paid in full — account settled
                      </span>
                    )}
                  </div>
                </div>
              )}

              <div className="payment-receipt-box" style={{ border: '1.5px dashed #cbd5e1', borderRadius: '14px', padding: '1rem 1.25rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.3rem' }}>
                  <Receipt size={18} style={{ color: '#475569' }} />
                  <strong style={{ fontSize: '0.9rem', color: '#1a202c' }}>Payment receipt</strong>
                </div>
                <p style={{ fontSize: '0.82rem', color: '#64748b', margin: '0 0 0.7rem 0' }}>
                  {isProvisional
                    ? 'Confirm that the client\'s deposit has been received. A receipt is raised and the deposit invoice is marked paid.'
                    : 'Confirm that the client\'s payment has been received. A receipt is raised, the invoice is marked paid and the outstanding balance clears to R0.00.'}
                </p>
                {activeInvoice && activeInvoice.status === 'paid' ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', color: '#15803d', fontWeight: 700, fontSize: '0.9rem' }}>
                    <CheckCircle2 size={16} />
                    {isProvisional
                      ? `Deposit received${depositBalanceRemaining > 0 ? ` — outstanding balance ${currencySymbol}${depositBalanceRemaining.toFixed(2)}` : ''}`
                      : 'Payment received & confirmed — outstanding balance R0.00'}
                  </div>
                ) : activeInvoice ? (
                  <button type="button" className="primary-btn" style={{ alignItems: 'center', gap: '0.4rem' }} disabled={issuingInvoice} onClick={confirmPayment}>
                    <CheckCircle2 size={15} /> {isProvisional ? 'Confirm deposit received' : 'Payment received & confirmed'}
                  </button>
                ) : (
                  <p style={{ fontSize: '0.82rem', color: '#94a3b8', margin: 0 }}>
            3287|        Issue the invoice below first — the receipt is raised automatically when you confirm payment.
                  </p>
                )}
              </div>

              <div className="invoice-actions" style={{ marginTop: '1.2rem', display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                <button type="button" className="primary-btn" style={{ alignItems: 'center', gap: '0.4rem' }} disabled={issuingInvoice || !!activeInvoice} onClick={() => handleIssueInvoiceHere()}>
                  <FileText size={15} />                   {activeInvoice ? (isProvisional ? 'Invoice issued' : 'Invoice issued') : 'Issue Invoice Here'}
                </button>
                <button type="button" className="secondary-btn" style={{ alignItems: 'center', gap: '0.4rem' }} onClick={() => navigate('/invoices')}>
                  <Receipt size={15} /> Issue Invoice in Invoice module
                </button>
              </div>

              <div style={{ marginTop: '1.2rem', paddingTop: '1.1rem', borderTop: '1px solid #e2e8f0' }}>
                <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.04em', color: '#94a3b8', marginBottom: '0.4rem' }}>Email format</label>
                <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', alignItems: 'center' }}>
                  <select
                    className="input-field"
                    style={{ maxWidth: '170px' }}
                    value={emailFormat}
                    onChange={(e) => setEmailFormat(e.target.value)}
                  >
                    <option value="pdf">PDF</option>
                    <option value="word">Word</option>
                    <option value="excel">Excel</option>
                  </select>
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
            </div>
          )}

          {/* ─── Vouchers (confirmed, read-only) ───────────────────────────────── */}
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
                const m = voucherFor(grp, days, meta, currencySymbol, paxCount);
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
                      <button type="button" className="secondary-btn" style={{ alignItems: 'center', gap: '0.4rem' }} onClick={() => openPrintWindow(voucherDocHtml(grp, days, meta, currencySymbol, paxCount, { logo: billing?.logo_data_url || '', logoSize: billing?.logo_size || 'md' }), 300)}>
                        <Printer size={14} /> PDF / Print
                      </button>
                      <button type="button" className="secondary-btn" style={{ alignItems: 'center', gap: '0.4rem' }} onClick={() => downloadBlob(voucherDocHtml(grp, days, meta, currencySymbol, paxCount, { logo: billing?.logo_data_url || '', logoSize: billing?.logo_size || 'md' }), `${safeNameOf(grp.label)}-voucher.doc`, 'application/msword')}>
                        <Download size={14} /> Word
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* ─── Operations (in progress) ─────────────────────────────────────── */}
          {tab === 'operations' && (
            <div className="builder-panel-card">
              <h3 style={{ fontSize: '1.1rem', fontWeight: 800, color: '#1a202c', marginBottom: '0.4rem' }}>
                Operations &amp; Daily Briefs
              </h3>
              <p style={{ fontSize: '0.85rem', color: '#64748b', marginBottom: '1rem', maxWidth: '720px' }}>
                The tour is <strong>in progress</strong>. Generate a daily handover brief for each day of the
                trip — guides and suppliers get their service times, contact details and expected values.
              </p>
              {days.map((d) => {
                const brief = dailyBriefFor(d, meta, paxCount, currencySymbol);
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
                  const all = days.map((d) => dailyBriefFor(d, meta, paxCount, currencySymbol)).join('\n\n══════════════════════════════════════\n\n');
                  void clipboardCopy(all);
                  showToast('All daily briefs copied to clipboard', 'success');
                }}>
                  <Copy size={15} /> Copy all briefs
                </button>
              </div>
            </div>
          )}

          {/* ─── Post-Tour (completed) ────────────────────────────────────────── */}
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

          {/* ─── Cancellation (cancelled) ─────────────────────────────────────── */}
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
                        <select
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
                            <option key={t.id} value={t.id}>{t.name} â€” {Number(t.rate)}%</option>
                          ))}
                        </select>
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

          {placementDraft && (
            <div className="modal-overlay service-placement-overlay" onClick={() => setPlacementDraft(null)}>
              <div className="modal-content service-placement-modal" onClick={(e) => e.stopPropagation()}>
                <div className="modal-header">
                  <div>
                    <div className="allocation-eyebrow">Service placement</div>
                    <h2>{placementDraft.item.name}</h2>
                    <p className="placement-subtitle">Choose where this service should appear in the itinerary.</p>
                  </div>
                  <button className="close-btn" onClick={() => setPlacementDraft(null)} aria-label="Close"><X size={20} /></button>
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
                      <select id="placement-repeat-count" className="sidebar-select" value={placementRepeatCount} onChange={(e) => setPlacementRepeatCount(Number(e.target.value))}>
                        {Array.from({ length: Math.max(1, days.length - placementDraft.dayIndex) }, (_, index) => (
                          <option key={index + 1} value={index + 1}>{index + 1} day{index === 0 ? '' : 's'}</option>
                        ))}
                      </select>
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
                  <button type="button" className="secondary-btn" onClick={() => setPlacementDraft(null)}>Cancel</button>
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
          <RoomAllocationModal
            isOpen={roomModalState.isOpen}
            onClose={() => setRoomModalState({ isOpen: false, dayIndex: null, serviceKey: null, item: null, service: null })}
            onSave={handleSaveRoomAllocation}
            item={roomModalState.item}
            itineraryTravellers={meta.travellers || []}
            currencyCode={currencyCode}
            markupPct={markupPct}
          />
        </div>
      </div>
    </div>
  );
};

export default ItineraryBuilder;
