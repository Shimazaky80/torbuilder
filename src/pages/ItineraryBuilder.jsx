import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  Map as MapIcon,
  ArrowLeft,
  Search,
  Copy,
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
  Lock
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useToast } from '../context/ToastContext';
import { useCurrencies } from '../hooks/useCurrencies';
import ClientTourForm from '../components/ClientTourForm';
import { usePageGuard } from '../context/NavigationGuardContext';
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
  openPrintWindow
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
//   3+ travellers -> per-person rate for 3+ sharing
// Returns the per-person figure for the current group size, so the line
// (perPax x pax) reproduces the contracted room cost for the whole group.
const accommodationPaxRate = (rate, pax) => {
  const p = Number(pax) || 0;
  const num = (v) => parseFloat(v) || 0;
  if (p <= 1) return num(rate?.price_1_adult) || num(rate?.single_room_rate) || num(rate?.unit_price) || 0;
  if (p === 2) return num(rate?.price_2_adults) || num(rate?.double_twin_rate) || 0;
  return num(rate?.price_3_plus_adults) || num(rate?.price_2_adults) || num(rate?.double_twin_rate) || num(rate?.price_1_adult) || 0;
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

const visibleInCurrency = (item, code) => {
  const codeU = (code || '').toUpperCase();
  const hasRateCurr = (item.item_rates || []).some((r) => (r.currency || '').toUpperCase() === codeU);
  if (hasRateCurr) return true;
  const itemCurr = (item.currency || '').toUpperCase();
  if (itemCurr) return itemCurr === codeU;
  return codeU === 'ZAR';
};

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

/* Read-only supplier voucher (emailed individually, cannot be edited). */
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
    `Client: ${meta.client?.name || '—'}`,
    `Travellers: ${(meta.travellers || []).map((tr) => `${tr.name} ${tr.surname || ''}`.trim()).filter(Boolean).join(', ') || '—'}`,
    `Guests: ${Number(meta.numAdults) || 0} Adult(s)${Number(meta.numChildren) ? ` / ${Number(meta.numChildren)} Child(ren)` : ''} (${paxCount} total)`,
    '',
    lines.join('\n\n'),
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
        <tr><td class="h">Travellers</td><td colspan="3">${esc(trav)}</td></tr>
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
  `Client: ${meta.client?.name || '—'}`,
  `Travellers: ${(meta.travellers || []).map((tr) => `${tr.name} ${tr.surname || ''}`.trim()).filter(Boolean).join(', ') || '—'}`,
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
    `Guests: ${Number(meta.numAdults) || 0} Adult(s)${Number(meta.numChildren) ? ` / ${Number(meta.numChildren)} Child(ren)` : ''} (${paxCount} total)`,
    '',
    ...lines,
    '',
    'Operational contact: ' + (meta.client?.phone || '—')
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
const reconciliationStatementFor = (meta, income, cost, currencySymbol) => {
  const net = round2((Number(income) || 0) - (Number(cost) || 0));
  const body = [
    'EXPENSE RECONCILIATION STATEMENT',
    '',
    ...invoiceHeaderLines(meta),
    '',
    `Total invoiced to client (incl. tax): ${currencySymbol}${(Number(income) || 0).toFixed(2)}`,
    `Total supplier costs (buy): ${currencySymbol}${(Number(cost) || 0).toFixed(2)}`,
    `Net result: ${currencySymbol}${net.toFixed(2)}`,
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
const cancellationNoticeEmail = (meta, totalInclTax, vat, depositPct, currencySymbol) => {
  const total = Number(totalInclTax) || 0;
  const vatAmt = Number(vat) || 0;
  const subtotal = round2(total - vatAmt);
  const deposit = round2(total * ((Number(depositPct) || DEPOSIT_PCT) / 100));
  const body = [
    'CANCELLATION NOTICE',
    '',
    ...invoiceHeaderLines(meta),
    '',
    `This itinerary has been cancelled.`,
    `Cancellation date: ${new Date().toISOString().slice(0, 10)}`,
    '',
    `REFUND STATEMENT`,
    `Subtotal (Excl. VAT): ${currencySymbol}${subtotal.toFixed(2)}`,
    `VAT: ${currencySymbol}${vatAmt.toFixed(2)}`,
    `TOTAL DUE (INCL. VAT): ${currencySymbol}${total.toFixed(2)}`,
    `Deposit retained (${Number(depositPct) || DEPOSIT_PCT}%): ${currencySymbol}${deposit.toFixed(2)}`,
    `Refund due to client: ${currencySymbol}${round2(total - deposit).toFixed(2)}`,
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
    notes: ''
  });

  const [companyId, setCompanyId] = useState(null);
  const [libraryItems, setLibraryItems] = useState([]);
  const [loadingItems, setLoadingItems] = useState(true);
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
  const [dayNotesDay, setDayNotesDay] = useState(null);
  const [bootedState, setBootedState] = useState(false);
  const [lastSavedKey, setLastSavedKey] = useState(null);
  const [bulkConfirmOpen, setBulkConfirmOpen] = useState(false);
  const [bulkConfirmGroups, setBulkConfirmGroups] = useState([]);

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
  const defaultTax = taxRates.find((t) => t.is_active && t.is_default)
    || taxRates.find((t) => t.is_active) || null;
  const defaultTaxRate = Number(defaultTax?.rate ?? 15);
  const defaultTaxLabel = defaultTax?.name || 'VAT';

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

  const fetchLibraryItems = useCallback(async () => {
    setLoadingItems(true);
    try {
      const cid = await fetchCompanyId();
      if (!cid) return;
      const { data: items } = await supabase
        .from('library_items')
        .select('*')
        .eq('company_id', cid)
        .order('created_at', { ascending: false });
      const ids = (items || []).map((i) => i.id);
      const { data: ratesData } = ids.length
        ? await supabase.from('item_rates').select('*').in('item_id', ids)
        : { data: [] };
      let carRates = [];
      if (ids.length) {
        try {
          const { data } = await supabase
            .from('car_rental_rates')
            .select('*')
            .in('item_id', ids);
          carRates = data || [];
        } catch {
          carRates = [];
        }
      }
      const { data: suppliers } = await supabase
        .from('suppliers')
        .select('id, name, email')
        .eq('company_id', cid);
      const rateMap = {};
      (ratesData || []).forEach((r) => {
        if (!rateMap[r.item_id]) rateMap[r.item_id] = [];
        rateMap[r.item_id].push(r);
      });
      const supMap = {};
      (suppliers || []).forEach((s) => { supMap[s.id] = s; });
      const merged = (items || []).map((it) => ({
        ...it,
        name: repairText(it.name),
        description: repairText(it.description),
        category: it.category === 'Guide / Driver' ? 'Guide' : it.category,
        item_rates: rateMap[it.id] || [],
        car_rental_rates: carRates.filter((r) => r.item_id === it.id),
        supplier: supMap[it.supplier_id] || null
      }));
      setLibraryItems(merged);
      setCompanyId(cid);
      const { data: taxData } = await supabase
        .from('tax_rates')
        .select('*')
        .eq('company_id', cid);
      setTaxRates(taxData || []);
      const { data: billingData } = await supabase
        .from('company_billing_settings')
        .select('*')
        .eq('company_id', cid)
        .maybeSingle();
      setBilling(billingData || null);
      if (billingData?.default_deposit_percentage !== null && billingData?.default_deposit_percentage !== undefined) {
        setCompanyDepositPct(Number(billingData.default_deposit_percentage));
      }
      const { data: bankData } = await supabase
        .from('company_bank_accounts')
        .select('*')
        .eq('company_id', cid)
        .order('is_default', { ascending: false });
      setBankAccounts(bankData || []);
    } catch {
      showToast('Failed to load library items', 'error');
    } finally {
      setLoadingItems(false);
    }
  }, [fetchCompanyId, showToast]);

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
        if (it.client_id && !client?.markup_percentage) {
          const { data: c } = await supabase
            .from('clients')
            .select('id, name, client_type, email, phone, country, markup_percentage, deposit_percentage')
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
          agencyRef: it.agency_reference || prev.agencyRef
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
            return {
              key: nextId(),
              itemId: ii.item_id || null,
              name: ii.item_name || '',
              category: ii.category || '',
              supplierName: ii.supplier_name || '',
              currencyCode: ii.currency_code || 'ZAR',
              basis: ii.rate_basis || 'per_person',
              buyPP,
              markup: m,
              sellPP: round2(buyPP * (1 + m / 100)),
              pax: Number(ii.pax) || ((Number(meta.numAdults) || 0) + (Number(meta.numChildren) || 0)),
              quantity: Number(ii.quantity) || 1,
              descOverride: ii.description_override || '',
              taxRate: numOr(ii.tax_rate, 15),
              taxLabel: ii.tax_label || 'VAT',
              time: ii.service_time || '',
              confirmationStatus: ii.confirmation_status || 'RQ',
              confirmationNumber: ii.confirmation_number || '',
              flightNumber: ii.flight_number || '',
              flightTime: ii.flight_time || '',
              vehicleType: ii.vehicle_type || '',
              capacity: ii.capacity !== '' && ii.capacity !== null && ii.capacity !== undefined ? Number(ii.capacity) : '',
              roomType: ii.room_type || '',
              maxOccupancy: ii.max_occupancy !== null && ii.max_occupancy !== undefined ? Number(ii.max_occupancy) : '',
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
  }, [data, meta.travelStart, meta.numAdults, meta.numChildren, meta.client, nextId]);

  useEffect(() => {
    const boot = async () => {
      if (booted.current) return;
      booted.current = true;
      await fetchLibraryItems();
      const hasId = !!(data && data.itineraryId);
      const foundSaved = hasId ? await loadExistingDays() : false;
      if (!foundSaved) initDaysFromRange();
      setBootedState(true);
    };
    boot();
  }, [data, fetchLibraryItems, loadExistingDays, initDaysFromRange]);

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
    const set = new Set();
    libraryItems.forEach((it) => {
      if (it.category) set.add(it.category);
    });
    return Array.from(set).sort();
  }, [libraryItems]);

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

  const filteredItems = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    const hasAnyFilter = categoryFilter !== '' || term.length > 0;
    if (!hasAnyFilter) return [];
    return libraryItems.filter((it) => {
      if (categoryFilter !== '' && it.category !== categoryFilter) return false;
      if (!visibleInCurrency(it, currencyCode)) return false;
      if (term) {
        const hay = `${it.name} ${it.category} ${it.supplier?.name || ''}`.toLowerCase();
        if (!hay.includes(term)) return false;
      }
      return true;
    });
  }, [libraryItems, categoryFilter, currencyCode, searchTerm]);

  const pricingGroups = useMemo(() => {
    const order = [];
    const map = new Map();
    days.forEach((d) => {
      const byCurr = {};
      (d.services || []).forEach((sv) => {
        const code = sv.currencyCode || 'ZAR';
        if (!byCurr[code]) byCurr[code] = { buy: 0, sell: 0, tax: 0, taxIn: 0, taxNet: 0, count: 0, taxByLabel: {} };
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
      if (!prev.travelEnd || last.date > toISODate(prev.travelEnd)) {
        return { ...prev, travelEnd: last.date };
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

  const addService = useCallback((dayIndex, item, via) => {
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
      taxRate: defaultTaxRate,
      taxLabel: defaultTaxLabel,
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
      notes: ''
    };
    setDays((prev) => prev.map((d, i) => (
      i === dayIndex ? { ...d, services: [...d.services, svc] } : d
    )));
    const dayLabel = days[dayIndex] ? `Day ${days[dayIndex].dayNumber}` : 'the selected day';
    showToast(`${via === 'double-click' ? 'Added' : 'Dropped'} "${item.name}" into ${dayLabel}`, 'success');
  }, [currencyCode, markupPct, paxCount, days, nextId, defaultTaxRate, defaultTaxLabel, showToast]);

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
    if (!(sv.time && sv.confirmationNumber && sv.flightNumber)) return false;
    if (/transfers?/i.test(cat) && !sv.vehicleType) return false;
    if (/accommodation/i.test(cat) && !(sv.checkInTime && sv.checkOutTime)) return false;
    return true;
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
          return {
            key: nextId(),
            itemId: ii.item_id || null,
            name: ii.item_name || '',
            category: ii.category || '',
            supplierName: ii.supplier_name || '',
            currencyCode: ii.currency_code || currencyCode,
            buyPP,
            markup: m,
            basis: ii.rate_basis || 'per_person',
            sellPP: round2(buyPP * (1 + m / 100)),
            pax: Number(ii.pax) || paxCount,
            quantity: Number(ii.quantity) || 1,
            descOverride: ii.description_override || '',
            taxRate: numOr(ii.tax_rate, 15),
            taxLabel: ii.tax_label || 'VAT',
            time: ii.service_time || '',
              confirmationStatus: ii.confirmation_status || 'RQ',
              confirmationNumber: ii.confirmation_number || '',
              flightNumber: ii.flight_number || '',
              flightTime: ii.flight_time || '',
              vehicleType: ii.vehicle_type || '',
              capacity: ii.capacity !== null && ii.capacity !== undefined ? Number(ii.capacity) : '',
              roomType: ii.room_type || '',
            maxOccupancy: ii.max_occupancy !== null && ii.max_occupancy !== undefined ? Number(ii.max_occupancy) : '',
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
  }, [copySourceId, copyInsertDay, days, currencyCode, markupPct, paxCount, normalizeDays, applyDateExtension, nextId, availableItineraries, showToast]);

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
    const ref = meta.referenceNumber || meta.itineraryName || 'itinerary';
    const safeName = String(ref).replace(/[^\w-]+/g, '_');
    if (format === 'link') {
      showToast('Digital itinerary link sharing is coming soon', 'info');
      return;
    }
    if (format === 'excel') {
      const header = ['Day', 'Date', 'Services', 'Subtotal (Excl. VAT)', 'VAT', 'Total (Incl. VAT)'];
      const lines = [
        header.map(csvEscape).join(','),
        `"Itinerary: ${csvEscape(meta.itineraryName)}"`,
        `"Reference: ${csvEscape(meta.referenceNumber || '')}"`,
        `"Client: ${csvEscape(meta.client?.name || '')}"`,
        `"Dates: ${csvEscape(meta.travelStart)} to ${csvEscape(meta.travelEnd)}"`,
        ''
      ];
      const { rows, grandTax, grandSell, grandTotal } = buildRows();
      const subtotalExcl = round2(grandSell - grandTax);
      rows.forEach((r) => {
        lines.push([r.day, r.date, r.svcCount, round2(r.sell - r.tax), r.tax, r.total].map(csvEscape).join(','));
      });
      lines.push(['Subtotal (Excl. VAT)', '', '', '', '', subtotalExcl].map(csvEscape).join(','));
      lines.push(['VAT', '', '', '', '', grandTax].map(csvEscape).join(','));
      lines.push(['TOTAL DUE (INCL. VAT)', '', '', '', '', grandTotal].map(csvEscape).join(','));
      downloadBlob(lines.join('\n'), `${safeName}.csv`, 'text/csv;charset=utf-8');
      showToast('Itinerary exported as Excel (CSV)', 'success');
      return;
    }
    const esc = htmlEscape;
    if (format === 'word') {
      const { rows, grandTax, grandSell, grandTotal } = buildRows();
      const subtotalExcl = round2(grandSell - grandTax);
      const escape = htmlEscape;
      const taxLabel = defaultTaxLabel || 'VAT';
      const taxLine = `<b>VAT (${escape(taxLabel)} ${defaultTaxRate}%)</b>`;
  const body = `
    <h1>${escape(meta.itineraryName)}</h1>
    <p><b>Reference:</b> ${escape(meta.referenceNumber || '—')} &nbsp;·&nbsp; <b>Status:</b> ${escape(statusLabelOf(meta.status))}</p>
    <p><b>Client:</b> ${escape(meta.client?.name || '—')} &nbsp;·&nbsp; <b>Travellers:</b> ${paxCount}</p>
    <p><b>Dates:</b> ${escape(meta.travelStart)} &rarr; ${escape(meta.travelEnd)}</p>
        <table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse">
          <tr><th>Day</th><th>Date</th><th>#</th><th>Subtotal (Excl. VAT)</th><th>VAT</th><th>Total (Incl. VAT)</th></tr>
          ${rows.map((r) => `<tr><td>Day ${escape(r.day)}</td><td>${escape(r.date)}</td><td>${r.svcCount}</td><td>${fmtMoney(round2(r.sell - r.tax), currencySymbol)}</td><td>${fmtMoney(r.tax, currencySymbol)}</td><td>${fmtMoney(r.total, currencySymbol)}</td></tr>`).join('')}
          <tr><td colspan="5" align="right">Subtotal (Excl. VAT)</td><td><b>${fmtMoney(subtotalExcl, currencySymbol)}</b></td></tr>
          <tr><td colspan="5" align="right">${taxLine}</td><td><b>${fmtMoney(grandTax, currencySymbol)}</b></td></tr>
          <tr><td colspan="5" align="right"><b>TOTAL DUE (INCL. VAT)</b></td><td><b>${fmtMoney(grandTotal, currencySymbol)}</b></td></tr>
        </table>
        <p><i>Generated by torbuilder</i></p>`;
      downloadBlob(`<html><head><meta charset="utf-8"></head><body>${body}</body></html>`, `${safeName}.doc`, 'application/msword');
      showToast('Itinerary exported as Word', 'success');
      return;
    }
    if (format === 'pdf') {
      const { rows, grandTax, grandSell, grandTotal } = buildRows();
      const subtotalExcl = round2(grandSell - grandTax);
      const w = window.open('', '_blank', 'width=900,height=700');
      if (!w) {
        showToast('Please allow pop-ups to export the PDF', 'warning');
        return;
      }
      const taxLabel = defaultTaxLabel || 'VAT';
      w.document.write(`<!doctype html><html><head><title>${esc(meta.itineraryName)}</title><style>
        body{font-family:Arial,sans-serif;margin:32px;color:#111}
        h1{margin:0 0 6px} .muted{color:#666;font-size:13px;margin:2px 0}
        table{border-collapse:collapse;width:100%;margin-top:16px}
        th,td{border:1px solid #ccc;padding:6px 10px;text-align:left;font-size:13px}
        th{background:#eee} .grand{font-weight:700} td.num{text-align:right}</style></head><body>
        ${billing?.logo_data_url ? `<img src="${billing.logo_data_url}" alt="Company logo" style="display:block;max-width:${LOGO_WIDTHS[billing.logo_size] || LOGO_WIDTHS.md}px;height:auto;margin:0 0 8px">` : ''}
        ${billing?.legal_name ? `<p class="muted"><b>${esc(billing.legal_name)}</b></p>` : ''}
        <h1>${esc(meta.itineraryName)}</h1>
        <p class="muted">Reference: ${esc(meta.referenceNumber || '—')}  ·  ${esc(statusLabelOf(meta.status))}</p>
        <p class="muted">Client: ${esc(meta.client?.name || '—')}  ·  ${paxCount} traveller(s)</p>
        <p class="muted">Dates: ${esc(meta.travelStart)} &rarr; ${esc(meta.travelEnd)}</p>
        <table><tr><th>Day</th><th>Date</th><th>Services</th><th>Subtotal (Excl. VAT)</th><th>VAT</th><th>Total (Incl. VAT)</th></tr>
        ${rows.map((r) => `<tr><td>Day ${esc(r.day)}</td><td>${esc(r.date)}</td><td>${r.svcCount}</td><td class="num">${fmtMoney(round2(r.sell - r.tax), currencySymbol)}</td><td class="num">${fmtMoney(r.tax, currencySymbol)}</td><td class="num">${fmtMoney(r.total, currencySymbol)}</td></tr>`).join('')}
        <tr class="grand"><td colspan="5" align="right">Subtotal (Excl. VAT)</td><td class="num">${fmtMoney(subtotalExcl, currencySymbol)}</td></tr>
        <tr class="grand"><td colspan="5" align="right">VAT (${esc(taxLabel)} ${defaultTaxRate}%)</td><td class="num">${fmtMoney(grandTax, currencySymbol)}</td></tr>
        <tr class="grand"><td colspan="5" align="right">TOTAL DUE (INCL. VAT)</td><td class="num">${fmtMoney(grandTotal, currencySymbol)}</td></tr></table>
        <p class="muted"><i>Generated by torbuilder</i></p>
        </body></html>`);
      w.document.close();
      w.focus();
      setTimeout(() => w.print(), 350);
      showToast('Itinerary PDF opened in a new window', 'success');
    }
  }, [meta, paxCount, currencySymbol, defaultTaxLabel, defaultTaxRate, buildRows, downloadBlob, showToast, billing]);

  const handleSave = useCallback(async () => {
    if (!companyId) {
      showToast('Company not found', 'error');
      return false;
    }
    setSaving(true);
    try {
      const finalStart = toISODate(meta.travelStart);
      const finalEnd = toISODate(meta.travelEnd) || finalStart;
      const headerPayload = {
        itinerary_name: meta.itineraryName,
        travel_start_date: finalStart || null,
        travel_end_date: finalEnd || null,
        num_adults: Number(meta.numAdults) || 0,
        num_children: Number(meta.numChildren) || 0,
        travellers: meta.travellers || [],
        agency_reference: meta.agencyRef || null,
        notes: meta.notes || null,
        status: meta.status || 'quotation'
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

      const bank = bankAccounts
        .filter((b) => b.is_active && (b.currency_code || '').toUpperCase() === currencyCode.toUpperCase())
        .sort((a, b) => (b.is_default ? 1 : 0) - (a.is_default ? 1 : 0))[0] || null;
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
        supplier_name: billing?.legal_name || '',
        supplier_tax_number: billing?.tax_number || '',
        supplier_address: billing?.billing_address || '',
        bank_details: bankDetails,
        notes: null
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
  }, [companyId, isProvisional, itineraryInvoices, currencyCode, handleSave, meta.itineraryId, meta.client, days, paxCount, depositPct, defaultTaxRate, bankAccounts, billing, loadItineraryInvoices, showToast]);

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
    const m = invoiceEmail(inv, agg.lines);
    if (!m.to) { showToast('No client email on file', 'warning'); return; }

    let attached = false;
    if (emailFormat === 'word' || emailFormat === 'excel') {
      const isExcel = emailFormat === 'excel';
      const content = isExcel ? invoiceExcelHtml(inv, agg.lines, currencySymbol) : invoiceDocHtml(inv, agg.lines, currencySymbol, { logo: billing?.logo_data_url || '', logoSize: billing?.logo_size || 'md' });
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
      const w = openPrintWindow(invoiceDocHtml(inv, agg.lines, currencySymbol, { logo: billing?.logo_data_url || '', logoSize: billing?.logo_size || 'md' }), 300);
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
          agency_reference: payload.agencyRef
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
        agencyRef: payload.agencyRef
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
            ? { ...s, name, descOverride: editSvc.descOverride.trim(), taxRate: numOr(editSvc.taxRate, defaultTaxRate), taxLabel: editSvc.taxLabel || defaultTaxLabel }
            : s
        )
      };
    }));
    setSaved(false);
    setEditSvc(null);
    showToast('Service updated', 'success');
  }, [editSvc, defaultTaxRate, defaultTaxLabel, showToast]);

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
  const missing = !(sv.time && sv.confirmationNumber && sv.flightNumber) ||
    (isTransfer && !sv.vehicleType) || (isAccom && !(sv.checkInTime && sv.checkOutTime));
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
            {loadingItems ? (
              <div className="builder-items-empty">Loading library items...</div>
            ) : filteredItems.length === 0 ? (
              <div className="builder-items-empty">
                <Package size={36} style={{ opacity: 0.5 }} />
                <div style={{ fontWeight: 700, color: '#64748b' }}>
                  {categoryFilter === '' && !searchTerm.trim() ? 'Pick a category or search' : 'No library items found'}
                </div>
                <div style={{ fontSize: '0.8rem' }}>
                  {categoryFilter === '' && !searchTerm.trim()
                    ? 'Select a category above (or search) to browse your library items.'
                    : 'Try a different search, category, or currency.'}
                </div>
              </div>
            ) : (
              filteredItems.map((item) => {
                const basis = basisOfItem(item, currencyCode);
                const price = contractPaxRate(item, currencyCode, paxCount);
                return (
                  <div
                    key={item.id}
                    className={`draggable-item ${isReadOnly ? 'locked' : ''}`}
                    draggable={!isReadOnly}
                    onDragStart={(e) => { if (isReadOnly) return; handleItemDragStart(e, item); }}
                    onDoubleClick={() => { if (isReadOnly) return; addService(selectedDayIndex, item, 'double-click'); }}
                    title={isReadOnly ? 'Locked itinerary is read-only' : 'Drag or double-click to add to the selected day'}
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
                      <button type="button" className="menu-item" onClick={() => handleExport('word')}>
                        <FileText size={15} /> Word
                      </button>
                      <button type="button" className="menu-item" onClick={() => handleExport('excel')}>
                        <FileSpreadsheet size={15} /> Excel
                      </button>
                      <button type="button" className="menu-item" onClick={() => handleExport('pdf')}>
                        <Printer size={15} /> PDF
                      </button>
                      <button type="button" className="menu-item" onClick={() => handleExport('link')}>
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
                  <div className="company-id" style={{ marginTop: '0.25rem' }}>{meta.client?.phone || '—'}</div>
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
                          <th>Buy (VAT-incl)</th>
                          <th>Sell (VAT-incl)</th>
                          <th>Output VAT</th>
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
                          <td colSpan="5" style={{ textAlign: 'right', fontWeight: 700 }}>Subtotal (Excl VAT)</td>
                          <td style={{ color: '#0d7478', fontWeight: 800 }}>{fmtMoney(g.totalExcl, g.symbol)}</td>
                        </tr>
                        {g.taxEntries.map((te) => (
                          <tr key={te.label} style={{ background: '#f8fafc' }}>
                            <td colSpan="5" style={{ textAlign: 'right', fontWeight: 700 }}>
                              VAT <span style={{ fontWeight: 400, color: '#94a3b8', fontSize: '0.8rem' }}>({te.label} {Number(te.rate)}%)</span>
                            </td>
                            <td style={{ color: '#7c3aed', fontWeight: 800 }}>{fmtMoney(te.amount, g.symbol)}</td>
                          </tr>
                        ))}
                        <tr style={{ background: '#f8fafc' }}>
                          <td colSpan="5" style={{ textAlign: 'right', fontWeight: 700 }}>Input VAT (on Buy, embedded)</td>
                          <td style={{ color: '#7c3aed', fontWeight: 800 }}>{fmtMoney(g.totalTaxIn, g.symbol)}</td>
                        </tr>
                        <tr style={{ background: '#f8fafc' }}>
                          <td colSpan="5" style={{ textAlign: 'right', fontWeight: 700 }}>Net VAT to SARS (Output − Input)</td>
                          <td style={{ color: '#7c3aed', fontWeight: 800 }}>{fmtMoney(g.totalTaxNet, g.symbol)}</td>
                        </tr>
                        <tr style={{ background: '#f0fdfa' }}>
                          <td colSpan="5" style={{ textAlign: 'right', fontWeight: 900, fontSize: '1rem' }}>
                            {g.code} TOTAL DUE (INCL VAT)
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
                Prices are grouped by currency, as an itinerary can mix currencies. Buy and Sell are both
                VAT-inclusive: the Sell price is the supplier amount plus markup (VAT included), so the client is
                charged the Sell total as-is. Subtotal (Excl VAT) plus the VAT rows equal TOTAL DUE (INCL. VAT).
                Input VAT (embedded in Buy) and Net VAT to SARS (Output minus Input, i.e. tax on the markup) are
                shown for internal tax records only and are never sent to the client. Each section uses its own currency.
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
                    agencyRef: meta.agencyRef || ''
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
                {isProvisional ? 'Deposit Request' : 'Final Invoice'}
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
                    Issue the {isProvisional ? 'deposit' : 'final'} invoice below first — the receipt is raised automatically when you confirm payment.
                  </p>
                )}
              </div>

              <div className="invoice-actions" style={{ marginTop: '1.2rem', display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                <button type="button" className="primary-btn" style={{ alignItems: 'center', gap: '0.4rem' }} disabled={issuingInvoice || !!activeInvoice} onClick={() => handleIssueInvoiceHere()}>
                  <FileText size={15} /> {activeInvoice ? `${isProvisional ? 'Deposit' : 'Final'} invoice issued` : 'Issue Invoice Here'}
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
                    <Send size={15} /> {isProvisional ? 'Email deposit request to client' : 'Email final invoice to client'}
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
                <div className="invoice-total" style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '0.85rem 1.1rem', margin: '0.6rem 0 0.85rem', display: 'flex', gap: '1.75rem', flexWrap: 'wrap' }}>
                  <div>
                    <div style={{ fontSize: '0.75rem', color: '#16a34a', fontWeight: 700 }}>Income (invoiced, incl. tax)</div>
                    <div style={{ fontSize: '1.25rem', fontWeight: 800, color: '#15803d' }}>{currencySymbol}{paxBalanceTotal.toFixed(2)}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: '0.75rem', color: '#dc2626', fontWeight: 700 }}>Supplier cost (buy)</div>
                    <div style={{ fontSize: '1.25rem', fontWeight: 800, color: '#b91c1c' }}>{currencySymbol}{itineraryCostTotal.toFixed(2)}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: '0.75rem', color: '#475569', fontWeight: 700 }}>Net result</div>
                    <div style={{ fontSize: '1.25rem', fontWeight: 800, color: round2(paxBalanceTotal - itineraryCostTotal) >= 0 ? '#15803d' : '#b91c1c' }}>{currencySymbol}{round2(paxBalanceTotal - itineraryCostTotal).toFixed(2)}</div>
                  </div>
                </div>
                <div className="invoice-actions" style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                  <button type="button" className="primary-btn" style={{ alignItems: 'center', gap: '0.4rem' }} onClick={() => {
                    const m = reconciliationStatementFor(meta, paxBalanceTotal, itineraryCostTotal, currencySymbol);
                    if (!m.to) { showToast('No client email on file', 'warning'); return; }
                    window.open(mailTo(m.to, m.subject, m.body), '_blank');
                  }}>
                    <Send size={15} /> Email reconciliation statement
                  </button>
                  <button type="button" className="secondary-btn" style={{ alignItems: 'center', gap: '0.4rem' }} onClick={() => {
                    const m = reconciliationStatementFor(meta, paxBalanceTotal, itineraryCostTotal, currencySymbol);
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
                <div
                  className="invoice-total"
                  style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '12px', padding: '0.85rem 1.1rem', margin: '0.6rem 0 0.85rem', display: 'flex', gap: '1.75rem', flexWrap: 'wrap' }}
                >
                  <div>
                    <div style={{ fontSize: '0.75rem', color: '#64748b', fontWeight: 700 }}>Total itinerary price</div>
                    <div style={{ fontSize: '1.1rem', fontWeight: 800, color: '#1a202c' }}>{currencySymbol}{paxBalanceTotal.toFixed(2)}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: '0.75rem', color: '#64748b', fontWeight: 700 }}>Deposit retained ({depositPct}%)</div>
                    <div style={{ fontSize: '1.1rem', fontWeight: 800, color: '#b91c1c' }}>{currencySymbol}{round2(paxBalanceTotal * (depositPct / 100)).toFixed(2)}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: '0.75rem', color: '#16a34a', fontWeight: 700 }}>Refund due to client</div>
                    <div style={{ fontSize: '1.25rem', fontWeight: 800, color: '#15803d' }}>{currencySymbol}{round2(paxBalanceTotal * (1 - depositPct / 100)).toFixed(2)}</div>
                  </div>
                </div>
                <div className="invoice-actions" style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                  <button type="button" className="primary-btn" style={{ alignItems: 'center', gap: '0.4rem' }} onClick={() => {
                    const m = cancellationNoticeEmail(meta, paxBalanceTotal, paxBalanceVAT, depositPct, currencySymbol);
                    if (!m.to) { showToast('No client email on file', 'warning'); return; }
                    window.open(mailTo(m.to, m.subject, m.body), '_blank');
                  }}>
                    <Send size={15} /> Email cancellation notice
                  </button>
                  <button type="button" className="secondary-btn" style={{ alignItems: 'center', gap: '0.4rem' }} onClick={() => {
                    const m = cancellationNoticeEmail(meta, paxBalanceTotal, paxBalanceVAT, depositPct, currencySymbol);
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
                <div className="form-actions">
                  <button type="button" className="secondary-btn" onClick={() => setEditSvc(null)}>Cancel</button>
                  <button type="button" className="primary-btn" style={{ flex: 1 }} onClick={saveServiceDetails}>Save Changes</button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ItineraryBuilder;
