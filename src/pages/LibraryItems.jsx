import { useState, useEffect, useRef, useMemo } from 'react';
import SearchableSelect from '../components/SearchableSelect';
import CarSpecGrid from '../components/CarSpecGrid';
import { useLocation } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useCurrencies } from '../hooks/useCurrencies';
import { useToast } from '../context/ToastContext';
import ConfirmDialog from '../components/ConfirmDialog';
import LibraryItemDetailModal from '../components/LibraryItemDetailModal';
import { useConfirm } from '../hooks/useConfirm';
import { useListRowLimit } from '../hooks/useListRowLimit';
import { useAmountSettings, stepForAmounts, applyInputRounding } from '../lib/amountSettings';
import { SURCHARGE_CATEGORY, SURCHARGE_TYPES, CHARGE_BASIS, UNIT_BASES, unitBasesFor, isValidUnitBasis, isSurchargeItem, surchargeTypeLabel, feeEditorRowFromRecord, feeRatePayload, feeSeasonKey, moveFeeAmount, feeBasisChargesHeads } from '../lib/surchargeFees';
import { chargesChildRate } from '../lib/servicePricing';
import { waiverLadder, waiverFromLadder, withWaiverNote } from '../lib/singleSupplement';
import { nightBandLabel, WEEKEND_DAY_OPTIONS, weekendDaysOf } from '../lib/accommodationOptions';
import { EXTRAS_CHARGE_SUGGESTIONS } from '../lib/extrasChargeTypes';
import { crewLadderTiers, normaliseStaffTiers, staffRoomLadder, staffTierSummary } from '../lib/staffRoomTiers';
import { STAR_GRADES, starGlyphs, starLabel, starRatingOf } from '../lib/starGrading';
import { supplierColumns, supplierStarColumn } from '../lib/supplierStarColumn';
import { normalizeRoomTypes, roomForRate, roomsFromRates } from '../lib/roomTypes';
import { OCCUPANCY_BASIS, normalizeOccupancyLadder, occupancyLadderError } from '../lib/occupancyPricing';
import { fetchRoomTypesForItems, roomTypesReady as probeRoomTypesReady } from '../lib/roomTypeTable';
import { itemDestinationLabel } from '../lib/libraryItemDetail';
import {
  Package,
  Building2,
  Search,
  Plus,
  Minus,
  Users,
  User,
  Eye,
  Edit3,
  Trash2,
  X,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Hotel,
  BedDouble,
  Star,
  Bus,
  BusFront,
  Utensils,
  Compass,
  UserCheck,
  Sparkles,
  Plane,
  Car,
  TrainFront,
  Ticket,
  Calendar,
  DollarSign,
  Image as ImageIcon,
  UploadCloud,
  FileText,
  Filter,
  MapPin,
  Globe,
  Tag,
  Download,
  Loader2,
  Navigation,
  Briefcase,
  DoorOpen,
  Cog,
  Fuel,
  Snowflake,
  Zap,
  Receipt
} from 'lucide-react';
import LanguageText from '../components/LanguageText';
import { carRentalGroups } from '../lib/carRentalPricing';
import { VEHICLE_TYPES, activeVehicleTypes, mergeVocabulary, vocabularyReadFilter } from '../lib/companyVocabulary';
import { SOURCE_LANGUAGE, textI18nPayload, translationsOf } from '../lib/i18n';
import { useTenantLanguages } from '../lib/i18n/useTenantLanguages';
import { scopeCompanyId } from '../lib/tenantScope';

/* Price and count fields may never hold a negative value. Clamps a typed
   negative number to "0" while leaving empty / non-numeric values (including
   checked booleans and arrays) untouched so text fields keep working. */
const clampNonNegative = (value) => {
  if (typeof value !== 'string' || value.trim() === '') return value;
  const n = Number(value);
  return Number.isFinite(n) && n < 0 ? '0' : value;
};

/* A hire tariff is one season's money: a Rental Price Validity window and the
   rental-length ladder priced inside it. The same car group is contracted at other
   figures in other weeks, so a group holds one season per window exactly as a room
   holds one rate row per season.

   Module scope, not the component body: createCarRentalGroup() is hoisted and runs
   from a useState initializer, and a counter declared below that line would still
   be in its temporal dead zone when it does. */
let carSeasonCount = 0;
const createCarRentalSeason = (copyFrom = null) => {
  carSeasonCount += 1;
  return {
    seasonId: `crs_${carSeasonCount}`,
    validFrom: '',
    validTo: '',
    /* A new season starts as the ladder before it with the money blanked, because a
       hire contract cuts its weeks the same way all year; only the figures move. A
       carried-over price would be money nobody had typed. */
    ranges: copyFrom?.ranges?.length
      ? copyFrom.ranges.map((range) => ({ minDays: range.minDays, maxDays: range.maxDays, price: '' }))
      : [
        { minDays: 1, maxDays: 6, price: '' },
        { minDays: 7, maxDays: 13, price: '' },
        { minDays: 14, maxDays: 30, price: '' },
        { minDays: 31, maxDays: '', price: '' }
      ]
  };
};

/* A money box the operator left blank is written to the season row as null, so a row can tell
   "not offered" apart from a deliberate 0 (a free child, a free third adult, an infants-go-free
   band). The editor hands over the raw typed string, so a typed 0 or 0.00 becomes the number 0
   and is kept; a box that was never touched is still the number 0 in form state, which is why a
   numeric zero reads as "never set". */
const moneyOrNull = (value) => {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number' && value === 0) return null;
  const parsed = parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
};

/* Reads a money column back into the editor. null and a bare numeric 0 both come back as a blank
   box: a numeric 0 is the residue of the old "start every box at 0.00" default, so it is treated
   as nothing loaded and rewritten as null on the next save. Raw child-map values keep their typed
   digits, so an explicit "0.00" survives. */
const moneyLoad = (value) => {
  if (value === null || value === undefined || value === '') return '';
  if (typeof value === 'number' && value === 0) return '';
  return String(value);
};

/* A tour leader room may deliberately be free, so 0 is a real price here. These
   two keep a saved 0 through load and save instead of reading it as a blank box
   the way the generic money helpers do. */
const moneyLoadKeepZero = (value) => (value === null || value === undefined || value === '' ? '' : String(value));
const moneyOrZero = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
};

/* A nights band is a whole number of nights (or nothing at all, meaning the
   band is open on that side). Zero is not a band - a stay is at least one
   night - so it saves as an open bound rather than as "0 nights". */
const wholeOrNull = (value) => {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

/* A tier with a blank threshold or rate is still being typed; save only
   complete ones so a half-filled row cannot become a free tier from zero client
   rooms. Shared by the crew and tour leader ladders.

   The ceiling is the stopper and it is optional: a row that leaves "To client
   rooms" blank runs up to the next threshold, or forever when it is the last
   row. A ceiling below its own threshold is the row being typed, so it saves as
   that threshold rather than a band that closed before it opened. */
const tierLadderPayload = (tiers) => (Array.isArray(tiers) ? tiers : [])
  .map((tier) => {
    const minRooms = moneyOrZero(tier.minClientRooms);
    const rate = moneyOrZero(tier.rate);
    if (minRooms === null || rate === null) return null;
    const ceiling = wholeOrNull(tier.maxClientRooms);
    return {
      minClientRooms: Math.max(0, Math.round(minRooms)),
      maxClientRooms: ceiling === null ? null : Math.max(Math.round(minRooms), ceiling),
      rooms: Math.max(1, Math.floor(parseFloat(tier.rooms) || 1)),
      rate
    };
  })
  .filter(Boolean)
  .sort((a, b) => a.minClientRooms - b.minClientRooms);

/* Reads a saved ladder back into the editor, keeping a typed 0 rate (a free
   room) rather than treating it as a blank box, and leaving a ceiling that was
   never typed blank so an open band does not become a stop. */
const tierLadderFromRow = (tiers) => (Array.isArray(tiers)
  ? tiers.map(tier => ({
      minClientRooms: moneyLoadKeepZero(tier?.minClientRooms ?? tier?.min_rooms),
      maxClientRooms: moneyLoadKeepZero(tier?.maxClientRooms ?? tier?.max_rooms),
      rooms: moneyLoadKeepZero(tier?.rooms) || '1',
      rate: moneyLoadKeepZero(tier?.rate)
    }))
  : []);

/* A brand-new season starts with every money box empty, not 0.00. Nothing is priced until the
   operator types a figure, so a saved rate card only ever carries consciously loaded prices and
   the read-only view has nothing to hide. */
const emptySeasonMoney = () => ({
  roomRate: '', singleRoomRate: '', price1Adult: '', price2Adults: '', price3PlusAdults: '',
  childRates: {}, singleSupplementWaiver: '', childDiscount: '', guideRate: '', driverRate: '', crewTiers: [], tourLeaderRate: '', tourLeaderTiers: [],
  guideTransferRate: '', guideHalfDayRate: '', guideFullDayRate: '', guideOverlandRate: '', guideDinnerRate: '',
  guideMealPlan: 'Bed & Breakfast', driverMealPlan: 'Bed & Breakfast',
  adultRate: '', childRate: '', fastTrackAdultRate: '', fastTrackChildRates: {}, tiers: [],
  vehicleRate: '', pricesByVehicle: {}, entranceFeePerson: '', entranceFeeVehicle: '', entranceFeeChild: '',
  levyAdultRate: '', levyChildRate: '', unitRate: '', taxesAndSurcharges: '',
  minNights: '', maxNights: '', weekendDays: [], weekendPrice: '', occupancyRates: []
});

/* The adult/child slots a priced season can actually use. Accommodation takes
   them from the room the season belongs to; a train (and any other item with
   capacity boxes) takes them from the item itself. A slot the contract does not
   offer is greyed out rather than left open to an accidental price.
   A room's child slots are null when the property does not split its guests by
   age - the room then takes any mix up to its beds, which is a slot the season
   does have, not one it lacks. */
const priceCapacityFor = (item, roomKey = '') => {
  if (item?.category === 'Accommodation') {
    const rooms = item.roomTypes || [];
    const room = rooms.find((entry) => entry.key === roomKey) || rooms[0];
    if (room) {
      const maxOccupancy = Math.max(1, parseInt(room.maxOccupancy, 10) || 1);
      const statedChildren = parseInt(room.maxChildren, 10);
      return {
        maxAdults: Math.min(maxOccupancy, Math.max(1, parseInt(room.maxAdults, 10) || maxOccupancy)),
        maxChildren: Number.isFinite(statedChildren) ? Math.max(0, Math.min(maxOccupancy, statedChildren)) : null
      };
    }
  }
  const maxOccupancy = Math.max(1, parseInt(item?.maxOccupancy, 10) || 2);
  return {
    maxAdults: Math.min(maxOccupancy, Math.max(1, parseInt(item?.maxAdults, 10) || maxOccupancy)),
    maxChildren: Math.max(0, parseInt(item?.maxChildren, 10) || 0)
  };
};

/* What a room's child cap column holds: null when the property does not split
   its guests by age, otherwise the stated number of beds - never more than the
   room has, which is how a 6-berth villa ended up sold with room for 22
   children. */
const childCapPayload = (room, occupancy) => {
  const stated = parseInt(room?.maxChildren, 10);
  if (!Number.isFinite(stated)) return null;
  return Math.max(0, Math.min(Math.max(1, occupancy), stated));
};

/* Whether a room offers a child rate at all. A property that does not split its
   guests by age takes children in any bed, so an unstated cap offers one; only
   a stated 0 refuses it. */
const capacityTakesChildren = (capacity) => !capacity
  || capacity.maxChildren === null
  || capacity.maxChildren > 0;

/* The smallest party a supplier will run an activity for. Nothing stated and an
   explicit 0 are the same deal — there is no minimum — so a tour that will depart
   with two guests never has to be edited just to satisfy a blank box. Reads both
   the saved row and the editor's own field. */
const minPaxToRunOf = (item) => {
  const raw = item?.min_pax_to_run ?? item?.minPaxToRun;
  return Math.max(0, parseInt(raw, 10) || 0);
};

/* The party sizes a villa ladder prices: every occupant count from the smallest
   the supplier sells to the number of beds the room has. One column per size so
   the grid is typed straight off a supplier sheet, and no gap can be left where a
   party would have no price. */
const occupancySizesForRoom = (room) => {
  const ceiling = Math.max(1, Math.min(30, parseInt(room?.maxOccupancy, 10) || 2));
  const from = Math.max(1, Math.min(parseInt(room?.occupancyFrom, 10) || 2, ceiling));
  const sizes = [];
  for (let pax = from; pax <= ceiling; pax += 1) sizes.push(pax);
  return sizes;
};

/* Which contract a room is priced on. The room states it; a room saved before
   the column existed inherits the item's model, exactly as the engines do.

   Only these three bases are room contracts, and the column checks for nothing
   else: an item-level 'per_person' copied down from an older form is not a
   choice about the room, so it inherits the default sharing contract rather
   than being saved as a basis the database rejects. */
const ROOM_CHARGE_MODELS = ['per_person_sharing', 'per_room', OCCUPANCY_BASIS];
const roomPricingModelOf = (room, item = {}) => {
  const roomModel = String(room?.pricingModel || '').trim();
  if (ROOM_CHARGE_MODELS.includes(roomModel)) return roomModel;
  const itemModel = String(item?.pricingModel || '').trim();
  if (ROOM_CHARGE_MODELS.includes(itemModel)) return itemModel;
  return 'per_person_sharing';
};

const isOccupancyRoom = (room, item = {}) => roomPricingModelOf(room, item) === OCCUPANCY_BASIS;

/* The stored ladder back as the one-figure-per-party-size list the grid edits.
   A band that covers several sizes (5-8 at one price) opens as three boxes, so
   the operator can price 6 differently next season without fighting the shape. */
const occupancyBandsForEdit = (rate) => normalizeOccupancyLadder(rate?.occupancy_rates)
  .reduce((rows, band) => {
    for (let pax = band.minPax; pax <= band.maxPax; pax += 1) rows.push({ pax, rate: band.rate });
    return rows;
  }, []);

const occupancyRateOf = (season, pax) => {
  const band = (Array.isArray(season?.occupancyRates) ? season.occupancyRates : [])
    .find((row) => parseInt(row.pax, 10) === pax);
  return band ? band.rate : '';
};

/* The ladder as the supplier sheet reads: contiguous party sizes at their own
   per-person figures. A size with no price is left out, and the pricing engines
   refuse to quote a room for it rather than inventing a nearest band. */
const occupancyLadderFromEdit = (sizes, season) => {
  const rows = sizes
    .map((pax) => ({ pax, rate: Number(occupancyRateOf(season, pax)) }))
    .filter((band) => band.rate > 0)
    .map((band) => ({ min_pax: band.pax, max_pax: band.pax, rate: band.rate }));
  return rows.length ? rows : null;
};

/* Disabled price boxes keep their layout but read as unavailable, so the
   operator can see the field exists without being able to type into it. */
const disabledPriceInputStyle = {
  background: '#f1f5f9',
  color: '#94a3b8',
  cursor: 'not-allowed'
};

/* A single child figure kept in a JSONB map keeps the raw typed digits, so an entered 0.00 comes
   back as "0.00" and still reads as a price. A blank or never-touched box becomes null and the
   caller drops it from the map. */
const childEntry = (value) => {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number' && value === 0) return null;
  return value;
};

/* Reads an image file and re-encodes it as a smaller data URL. Images larger
   than maxDim are downscaled to keep the longest edge at maxDim and saved as
   JPEG; small images are returned unchanged (original format preserved). */
const compressImageDataUrl = (file, maxDim = 1200, quality = 0.82) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Invalid image'));
      img.onload = () => {
        const scale = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight));
        if (scale >= 1) {
          resolve(reader.result);
          return;
        }
        const w = Math.max(1, Math.round(img.naturalWidth * scale));
        const h = Math.max(1, Math.round(img.naturalHeight * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });

/* Previous / next controls that step the Seasonal Rates Matrix through one
   season at a time. */
const seasonNavBtnStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: '28px',
  height: '28px',
  borderRadius: '999px',
  border: '1px solid #cbd5e1',
  background: '#ffffff',
  color: '#0f766e',
  cursor: 'pointer'
};

/* Cells of the vehicle price grid, so the one table on screen reads as a table. */
const vehicleCellHead = {
  padding: '0.35rem 0.6rem',
  borderBottom: '2px solid #cbd5e1',
  fontSize: '0.72rem',
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  color: '#64748b',
  textAlign: 'left'
};
const vehicleCell = {
  padding: '0.35rem 0.6rem',
  borderBottom: '1px solid #e2e8f0',
  fontSize: '0.8rem',
  color: '#1e293b'
};

/* Summary of a per-vehicle rate's price vector for the directory listing. One row per
   season, so a code can appear priced in one season and FOC in another — the last season
   wins, which is what the form shows too. Unpriced codes are left off entirely rather
   than shown as 0, because "never priced" and "priced at zero" are different things. */
const vehicleVectorSummary = (rates) => {
  const vec = {};
  (rates || []).forEach(rate => {
    const prices = rate && rate.prices_by_vehicle;
    if (!prices || typeof prices !== 'object') return;
    Object.entries(prices).forEach(([code, value]) => {
      if (typeof value === 'number') vec[code] = value;
      else if (value && value.free) vec[code] = 'FOC';
      else if (value && value.na) vec[code] = 'n/a';
      else delete vec[code];
    });
  });
  return Object.entries(vec);
};

/* The surcharge fee columns written onto one season's item_rates row.
   Entrance fees and conservation levies used to be extra columns on an
   Accommodation / Transfers item's season. They are separate library items now,
   so only a Fees & Tickets item writes these, and only into the columns its own
   rate basis actually uses - the unused ones are left off entirely rather than
   written as 0, so a stale fee can never be read back out of a season row.
     per_vehicle            -> the per-vehicle figure, for every fee type
     per_person / per_adult -> the per-person figure (entrance fee or ticket)
                               or the adult figure (a levy)
     per_child              -> the per-child figure
     per_unit               -> the unit price, the flat basis per_vehicle
                               replaced; only an item already saved on it writes
   A fee that bills heads also bills a child on a figure of its own, and the
   guide's place is written beside it by the caller. `feeChildRate` says whether
   the workspace has the column yet: writing the amount read from a box nobody
   can see would put null into a column that does not exist. */
const surchargeRateFees = (itemData, season, { feeChildRate = false } = {}) => {
  if (!isSurchargeItem(itemData)) return {};
  const unitBasis = itemData.surchargeUnitBasis || 'per_person';
  const num = moneyOrNull;
  /* A ticket is admitted on the same columns as an entrance fee - the type only
     changes the name on the screen - so the ladder split is levy vs not-levy. */
  const isLevy = (itemData.surchargeType || 'entrance_fee') === 'conservation_levy';
  if (unitBasis === 'per_unit') {
    return { unit_price: num(season.unitRate) };
  }
  if (unitBasis === 'per_vehicle') {
    return { entrance_fee_per_vehicle: num(season.entranceFeeVehicle) };
  }
  if (!isLevy) {
    return {
      entrance_fee_per_person: num(season.entranceFeePerson),
      ...(feeChildRate ? { entrance_fee_per_child: num(season.entranceFeeChild) } : {})
    };
  }
  /* A levy quotes both an adult and a child ladder whenever it bills people;
     the "per child" basis is the one case where only the child figure is
     charged, so the adult column stays untouched there. */
  if (unitBasis === 'per_child') {
    return { conservation_levy_per_child: num(season.levyChildRate) };
  }
  return {
    conservation_levy_per_adult: num(season.levyAdultRate),
    conservation_levy_per_child: num(season.levyChildRate)
  };
};

/* The words a fee's own price boxes are headed with. A ticket and an entrance
   fee are priced from the same columns, so only the heading tells them apart. */
const feeTypeHeading = (type) => {
  const t = type || 'entrance_fee';
  if (t === 'conservation_levy') return 'Conservation Levy';
  if (t === 'ticket') return 'Ticket';
  return 'Entrance Fee';
};

/* Ladder editor for the rooms a property includes once enough paying client
   rooms are booked. The crew (driver-guide) and tour leader deals share this
   shape: each tier states the total rooms included from a threshold, the rate
   for the rooms it adds (0 = free, a partial amount = discounted) and — when
   the deal has an end — the client-room count it stops covering. */
const TierLadderEditor = ({
  legend, roomLabel, currency, tiers = [], tone = 'teal', moneyStep, onAdd, onChange, onRemove
}) => {
  const palette = tone === 'amber'
    ? { border: '#fde68a', title: '#92400e', label: '#a16207', note: '#b45309' }
    : { border: '#99f6e4', title: '#115e59', label: '#0f766e', note: '#0f766e' };
  return (
    <div style={{ marginTop: '0.85rem', paddingTop: '0.75rem', borderTop: `1px dashed ${palette.border}` }}>
      <span style={{ fontSize: '0.78rem', fontWeight: 700, color: palette.title, display: 'block', marginBottom: '0.35rem' }}>
        {legend}
      </span>
      {tiers.map((tier, tierIdx) => (
        <div key={tierIdx} style={{ display: 'flex', alignItems: 'flex-end', gap: '0.5rem', marginBottom: '0.45rem', flexWrap: 'wrap' }}>
          <div>
            <span style={{ fontSize: '0.7rem', color: palette.label, fontWeight: 600, display: 'block' }}>From client rooms</span>
            <input
              type="number"
              min="0"
              className="pricing-select"
              style={{ padding: '0.3rem', width: '110px' }}
              placeholder="e.g. 10"
              value={tier.minClientRooms ?? ''}
              onChange={(e) => onChange(tierIdx, 'minClientRooms', e.target.value)}
            />
          </div>
          <div>
            <span style={{ fontSize: '0.7rem', color: palette.label, fontWeight: 600, display: 'block' }}>To client rooms</span>
            <input
              type="number"
              min="0"
              className="pricing-select"
              style={{ padding: '0.3rem', width: '110px' }}
              placeholder="blank = and above"
              value={tier.maxClientRooms ?? ''}
              onChange={(e) => onChange(tierIdx, 'maxClientRooms', e.target.value)}
            />
          </div>
          <div>
            <span style={{ fontSize: '0.7rem', color: palette.label, fontWeight: 600, display: 'block' }}>{roomLabel} rooms (total)</span>
            <input
              type="number"
              min="1"
              className="pricing-select"
              style={{ padding: '0.3rem', width: '110px' }}
              value={tier.rooms ?? '1'}
              onChange={(e) => onChange(tierIdx, 'rooms', e.target.value)}
            />
          </div>
          <div>
            <span style={{ fontSize: '0.7rem', color: palette.label, fontWeight: 600, display: 'block' }}>Rate ({currency})</span>
            <input
              type="number"
              min="0"
              className="pricing-select"
              style={{ padding: '0.3rem', width: '130px' }}
              placeholder="0 = free"
              value={tier.rate ?? ''}
              onChange={(e) => onChange(tierIdx, 'rate', e.target.value)}
              step={moneyStep}
            />
          </div>
          <button
            type="button"
            className="secondary-btn"
            style={{ padding: '0.3rem 0.55rem', fontSize: '0.78rem' }}
            onClick={() => onRemove(tierIdx)}
            aria-label={`Remove ${roomLabel.toLowerCase()} tier`}
          >
            Remove
          </button>
        </div>
      ))}
      <button
        type="button"
        className="secondary-btn"
        style={{ padding: '0.35rem 0.7rem', fontSize: '0.78rem' }}
        onClick={onAdd}
      >
        + Add tier
      </button>
      <div style={{ fontSize: '0.72rem', color: palette.note, marginTop: '0.4rem' }}>
        Each tier covers the client rooms from its From count up to its To count. Leave
        To blank and the tier runs to the next one, or forever when it is the last row:
        1 with no To reads as “1 and above”, 10 with a To of 20 reads as “10–20 client
        rooms” and nothing beyond 20. Enter the total {roomLabel.toLowerCase()} rooms
        included from that threshold and the rate for those rooms; repeating the same
        room count with a new rate changes the price for that band (0 = free). A bed
        outside every band — past a stopped ladder or in a gap between two tiers — pays
        the normal Single rate. Tiers take over from the flat rate above.
      </div>
    </div>
  );
};

/* Draft room rows need a key before they have a database id. The key is handed
   in by the caller (sequential within one property), so no clock is read during
   render; a saved room uses its database id on the next load. */

export const LibraryItems = () => {
  const [suppliers, setSuppliers] = useState([]);
  const [confirmDialog, confirm] = useConfirm();
  const [selectedSupplierId, setSelectedSupplierId] = useState('');
  const [libraryItemsList, setLibraryItemsList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [fetchingItems, setFetchingItems] = useState(false);
  const [totalCount, setTotalCount] = useState(0);
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('All');
  const [supplierFilter, setSupplierFilter] = useState('All');
  const [showInlineForm, setShowInlineForm] = useState(false);
  const searchTimeoutRef = useRef(null);
  const { limit: pageSize } = useListRowLimit();

  // Editing state: when set, the inline form updates these items instead of inserting.
  // Maps form tempId -> existing library_items row id.
  const [editingItems, setEditingItems] = useState({});

  // Seasonal Rates Matrix shows one season at a time: Maps form tempId -> visible season index.
  const [activeSeasonByItem, setActiveSeasonByItem] = useState({});

  /* Which charge type of the visible season the accommodation matrix is showing.
     One season carries several charge types (board basics) at different prices,
     so within a season the operator picks the charge type to edit. Maps form
     tempId -> the flat season-row index of the selected charge type. */
  const [activeChargeByItem, setActiveChargeByItem] = useState({});

  // Same one-at-a-time view for the directory rows, keyed by the saved item id.
  const [activeSeasonByListItem, setActiveSeasonByListItem] = useState({});

  // Image gallery lightbox & description popup
  const [lightbox, setLightbox] = useState(null); // { images: [], index: number }
  const [descriptionPopup, setDescriptionPopup] = useState(null);
  const [contractPopup, setContractPopup] = useState(null); // { name, url }
  // The read-only "what does this item charge" panel: every season and every pricing
  // type for one catalog item, without opening the edit form.
  const [detailItem, setDetailItem] = useState(null);
  const [uploadingContract, setUploadingContract] = useState(null); // tempId being uploaded

  // Supplier creation mode: 'existing' vs 'new'
  const [supplierMode, setSupplierMode] = useState('existing');

  // Multi-item support toggle
  const [addMultiple, setAddMultiple] = useState(true);

  // Comprehensive Supplier Form State (Matching Screenshot)
  const [supplierForm, setSupplierForm] = useState({
    name: '',
    contactPerson: '',
    email: '',
    phone: '',
    website: '',
    address: '',
    country: 'South Africa',
    provinceState: '',
    city: '',
    bankName: '',
    accountHolderName: '',
    bankAccountNumber: '',
    branchCode: '',
    swiftCode: '',
    starRating: ''
  });

  const [savingSupplier, setSavingSupplier] = useState(false);
  const [saving, setSaving] = useState(false);

  // DB feature detection (columns may be missing until migrations are applied)
  const [dbFeatures, setDbFeatures] = useState({ guideDriver: true, guideMinRooms: true, guideDriverTiers: true, contracts: true, tieredPricing: true, transferType: true, feeType: true, driverOption: true, tourType: true, transportType: true, surchargeFees: true, pricesByVehicle: false, tourLeaderTiers: true, singleSupplementTiers: false, nightBands: false, weekendRates: false, occupancyPricing: false, staffOptions: false, minPaxToRun: false, feeChildRate: false, rentalContractFee: false, textI18n: false });

  /* The languages this tenant writes content in. The tabs the editors show are
     this list narrowed by the column actually existing: a tenant that switched
     Portuguese on but has not applied 20261251 gets no box it cannot save. */
  const tenantLanguages = useTenantLanguages();
  const contentLanguages = dbFeatures.textI18n ? tenantLanguages : [SOURCE_LANGUAGE];

  // The price axis a per-vehicle rate row is keyed by, read once from Settings.
  const [vehicleTypes, setVehicleTypes] = useState([]);

  // Form State: Array of items for batch creation under supplier
  const [itemsToSave, setItemsToSave] = useState([createNewItemTemplate(1)]);

  // Draft name typed into an accommodation item's "Add charge option" box.
  const [chargeOptionDraft, setChargeOptionDraft] = useState({});

  /* Lodging rooms. The table and its columns arrive together, so one probe
     decides whether the property/room editor is available; until then the item
     keeps behaving as one room type. */
  const [roomsReady, setRoomsReady] = useState(false);
  const [activeRoomByItem, setActiveRoomByItem] = useState({});
  const [starColumnReady, setStarColumnReady] = useState(false);
  const [supplierStarDraft, setSupplierStarDraft] = useState({});

  /* A car hire is contracted by country — one price list covers the whole of it,
     so the operator is not asked for a town that changes nothing. The tenant's
     own country is the starting value; a hire sold abroad is the exception that
     gets typed differently. */
  const [operatingCountry, setOperatingCountry] = useState('South Africa');

  useEffect(() => {
    let active = true;
    probeRoomTypesReady().then((ready) => { if (active) setRoomsReady(ready); });
    supplierStarColumn().then((ready) => { if (active) setStarColumnReady(ready); });
    return () => { active = false; };
  }, []);

  const { showToast } = useToast();
  const location = useLocation();
  const { currencies } = useCurrencies();
  const amountSettings = useAmountSettings();
  const moneyStep = stepForAmounts(amountSettings.allowDecimals);

  const categoryOptions = [
    { id: 'Accommodation', label: 'Accommodation', icon: Hotel, color: '#863bff' },
    { id: SURCHARGE_CATEGORY, label: 'Fees & Tickets', icon: Receipt, color: '#f43f5e' },
    { id: 'Transfers', label: 'Transfers', icon: Bus, color: '#3b82f6' },
    { id: 'Activities / Tours', label: 'Activities / Tours', icon: Compass, color: '#10b981' },
    { id: 'Flights / Charter', label: 'Flights / Charter', icon: Plane, color: '#6366f1' },
    { id: 'Meals', label: 'Meals', icon: Utensils, color: '#f59e0b' },
    { id: 'Guide', label: 'Guide', icon: UserCheck, color: '#8b5cf6' },
    { id: 'Trains', label: 'Trains', icon: TrainFront, color: '#f97316' },
    { id: 'Tickets', label: 'Tickets', icon: Ticket, color: '#14b8a6' },
    { id: 'Extras', label: 'Extras', icon: Sparkles, color: '#ec4899' },
    { id: 'Car Rental', label: 'Car Rental', icon: Car, color: '#06b6d4' },
    { id: 'Transport', label: 'Transport', icon: BusFront, color: '#0ea5e9' }
  ];

// Category options are driven by the library_categories table when present,
// falling back to the built-in list above (e.g. before the migration is run).
  const [categories, setCategories] = useState(categoryOptions);

  /* A surcharge is linked to the one accommodation it belongs to, so the picker
     offers properties only - a levy does not belong to a transfer or a tour.
     Built from the saved library as well as anything currently on screen, so a
     surcharge created alongside its accommodation can link to it immediately. */
  const accommodationLinkOptions = useMemo(() => {
    const byId = new Map();
    libraryItemsList.forEach((li) => {
      if (li && li.id && /^accommodation$/i.test(String(li.category || ''))) byId.set(li.id, li);
    });
    itemsToSave.forEach((item) => {
      const id = editingItems[item.tempId] || item.id;
      if (id && /^accommodation$/i.test(String(item.category || ''))) {
        if (!byId.has(id)) byId.set(id, { id, name: item.name, location: item.destinationRegion || item.location || '' });
      }
    });
    return [...byId.values()]
      .map((li) => ({ id: li.id, label: li.location ? `${li.name} — ${li.location}` : li.name }))
      .sort((a, b) => String(a.label).localeCompare(String(b.label)));
  }, [libraryItemsList, itemsToSave, editingItems]);


  const mealPlanOptions = [
    'Room Only',
    'Self Catering',
    'Bed & Breakfast',
    'Half Board',
    'Full Board',
    'All Inclusive'
  ];

  const tourTypes = [
    {
      id: 'short_experience',
      label: 'Short Experience',
      icon: '⏱️',
      description: 'Minutes to an hour — a boat hop, a walk, a quick visit or a ride.'
    },
    {
      id: 'half_day',
      label: 'Half Day',
      icon: '🌤️',
      description: 'Typically 3–5 hours — a morning or afternoon activity.'
    },
    {
      id: 'full_day',
      label: 'Full Day',
      icon: '🌞',
      description: 'Typically 6–10 hours — a full day of sightseeing or activity.'
    },
    {
      id: 'escorted_dinner_lunch',
      label: 'Escorted Dinner / Lunch',
      icon: '🍽️',
      description: 'A hosted meal (dinner or lunch) with escort / guide.'
    },
    {
      id: 'overland_transfer',
      label: 'Overland Transfer',
      icon: '🛤️',
      description: 'Long-haul transfer that stays away from the origin overnight.'
    }
  ];

  const transferPricingOptions = [
    { id: 'per_vehicle', label: 'Flat Rate (Per Vehicle)' },
    { id: 'per_person', label: 'Per Person' },
    { id: 'tiered', label: 'Tiered (by pax count)' }
  ];

  const transferTypes = [
    {
      id: 'airport_city',
      label: 'Airport / City',
      icon: '✈️',
      description: 'From/to the airport or city transfers to hotels — minutes to a few hours, same day.'
    },
    {
      id: 'dinner',
      label: 'Dinner',
      icon: '🍽️',
      description: 'Evening transfers to/from restaurants for dinner.'
    },
    {
      id: 'overland',
      label: 'Overland',
      icon: '🛤️',
      description: 'Long-haul transfer that spends the night away from the origin city.'
    }
  ];

  /* A Transport supplier sells the vehicle itself, not a named journey: the same
     bus can shuttle a tour, run a transfer, haul a group overland, or stand by at
     the client's disposal. The type is what the itinerary reads to allow for the
     driver's meals and overnight. */
  const transportTypes = [
    {
      id: 'tour_activity',
      label: 'Tour / activity transport',
      icon: '🧭',
      description: 'The vehicle carries the group to an activity or on a tour and back.'
    },
    {
      id: 'transfer',
      label: 'Transfer',
      icon: '🚐',
      description: 'A point-to-point move between two places, same day.'
    },
    {
      id: 'overland',
      label: 'Overland',
      icon: '🛤️',
      description: 'Long-haul leg that spends the night away from the origin city.'
    },
    {
      id: 'at_disposal',
      label: 'At disposal',
      icon: '⏱️',
      description: 'The vehicle and driver stand by for the day, so the hire is priced per day.'
    }
  ];

  /* Transport is the vehicle-only category. It takes the same tour-style editor as
     a transfer - capacity, per-vehicle pricing, the vehicle price vector - and the
     same driver rules, because a bus always comes with its driver. */
  const isTransportCategory = (category) => category === 'Transport';

  // Categories that use the simplified tour/transfer form: vehicle capacity,
  // per-vehicle / per-person / tiered pricing, and a minimal seasonal matrix.
  const isTourStyleCategory = (category) => category === 'Transfers' || category === 'Activities / Tours' || category === 'Flights / Charter' || isTransportCategory(category);
  const isFlightCategory = (category) => category === 'Flights / Charter';
  const isMealsCategory = (category) => category === 'Meals';
  const isTrainCategory = (category) => category === 'Trains';
  const isTicketCategory = (category) => category === 'Tickets';
  const isExtrasCategory = (category) => category === 'Extras';
  /* Accommodation and Extras both price one season at several named charges —
     board basics for the one, separate charges for the other — so both are
     edited season-first with a charge type standing on every rate row. */
  const hasChargeTypes = (category) => category === 'Accommodation' || isExtrasCategory(category);
  const isCarRentalCategory = (category) => category === 'Car Rental';
  const isGuideCategory = (category) => category === 'Guide' || category === 'Guide / Driver';
  const normalizeCategoryName = (name) => {
    if (name === 'Guide / Driver') return 'Guide';
    if (name === 'Surcharge Fees') return SURCHARGE_CATEGORY;
    return name;
  };
  const legacyCategoryName = (name) => {
    if (name === 'Guide') return 'Guide / Driver';
    if (name === SURCHARGE_CATEGORY) return 'Surcharge Fees';
    return null;
  };
  const isDriverEligibleCategory = (category) => category === 'Transfers' || category === 'Activities / Tours' || isTransportCategory(category);

  // A dedicated driver is only provided for large vehicles (14+ seats) and the
  // vehicle price already includes the driver — the option only triggers the
  // driver's meals / accommodation in the itinerary builder (costs come from the
  // Meals & Accommodation module rates).
  const driverMealOptions = [
    { id: 'lunch', label: 'Lunch' },
    { id: 'dinner', label: 'Dinner' }
  ];
  // The Guide charges a different flat per-trip price depending on the service
  // it accompanies. The itinerary builder picks the rate for the service at hand.
  const guideServiceTypes = [
    { id: 'transfer', field: 'guideTransferRate', label: 'Transfer price' },
    { id: 'half_day', field: 'guideHalfDayRate', label: 'Half Day price' },
    { id: 'full_day', field: 'guideFullDayRate', label: 'Full Day price' },
    { id: 'overland', field: 'guideOverlandRate', label: 'Overland price' },
    { id: 'dinner_transfer', field: 'guideDinnerRate', label: 'Dinner transfer price' }
  ];
  const getVehiclePax = (maxOccupancy) => parseInt(maxOccupancy) || 0;
  /* What the vehicle is being hired for, from whichever field the category uses:
     a transfer names itself by its transfer type, a Transport item by the job the
     supplier is being paid for. */
  const driverHireType = (item) => (isTransportCategory(item?.category) ? item?.transportType : item?.transferType);
  const getDefaultDriverMeals = (category, hireType) => {
    if (category === 'Transfers') {
      if (hireType === 'dinner') return ['dinner'];
      if (hireType === 'overland') return ['lunch', 'dinner'];
      return [];
    }
    /* A Transport day is the vehicle and its driver for as long as the group needs
       them, so the driver eats with the group; an overland leg runs into the
       evening as well. */
    if (isTransportCategory(category)) return hireType === 'overland' ? ['lunch', 'dinner'] : ['lunch'];
    return ['lunch'];
  };
  const getDefaultDriverAccommodation = (category, hireType) =>
    (category === 'Transfers' || isTransportCategory(category)) && hireType === 'overland';

  // Dynamic Country Options derived from full currencies table
  const countryOptions = currencies.length > 0
    ? [...new Set(currencies.map(c => c.country).filter(Boolean))].sort()
    : [
        'South Africa',
        'Tanzania',
        'Kenya',
        'Namibia',
        'Botswana',
        'Uganda',
        'Rwanda',
        'Zambia',
        'Zimbabwe',
        'United States',
        'United Kingdom',
        'Germany',
        'France',
        'Australia',
        'Other'
      ];

  function ensureSharingRules(maxAdults = 2, maxOccupancy = 2, currentRules = []) {
    const safeAdults = Math.max(1, parseInt(maxAdults) || 2);
    const safeMaxOcc = Math.max(safeAdults, parseInt(maxOccupancy) || 2);
    const rulesMap = {};
    if (Array.isArray(currentRules)) {
      currentRules.forEach(r => {
        if (r && r.adults) {
          rulesMap[r.adults] = r.maxChildren;
        }
      });
    }

    const result = [];
    for (let a = 1; a <= safeAdults; a++) {
      const rowMaxAllowed = Math.max(0, safeMaxOcc - a);
      let assigned = rulesMap[a] !== undefined ? parseInt(rulesMap[a]) : rowMaxAllowed;
      if (isNaN(assigned)) assigned = rowMaxAllowed;
      assigned = Math.max(0, Math.min(rowMaxAllowed, assigned));
      result.push({
        adults: a,
        maxChildren: assigned
      });
    }
    return result;
  }

  /* Rules seeded under an older ceiling keep their old auto-derived values
     after a room type starts sleeping more guests. A row still holding the old
     auto value (old ceiling minus adults) follows the new ceiling; a row the
     operator set lower on purpose keeps that cap, clamped to the new ceiling. */
  function rebaseSharingRules(maxAdults, oldCeiling, newCeiling, currentRules = []) {
    const safeAdults = Math.max(1, parseInt(maxAdults) || 1);
    const safeOld = Math.max(1, parseInt(oldCeiling) || 1);
    const safeNew = Math.max(safeAdults, parseInt(newCeiling) || safeOld);
    const rulesMap = {};
    if (Array.isArray(currentRules)) {
      currentRules.forEach(r => {
        if (r && r.adults) {
          rulesMap[r.adults] = r.maxChildren;
        }
      });
    }

    const result = [];
    for (let a = 1; a <= safeAdults; a++) {
      const oldAuto = Math.max(0, safeOld - a);
      const newAuto = Math.max(0, safeNew - a);
      let assigned = newAuto;
      if (rulesMap[a] !== undefined) {
        const stored = parseInt(rulesMap[a]);
        if (!isNaN(stored)) {
          assigned = stored === oldAuto ? newAuto : Math.max(0, Math.min(newAuto, stored));
        }
      }
      result.push({
        adults: a,
        maxChildren: assigned
      });
    }
    return result;
  }

  /* Detect rows still holding the untouched seed pattern (maxChildren equals
     ceiling minus adults on every row) under a smaller ceiling than the rooms
     currently offer — the signature of rules seeded before a room was widened.
     Returns that stale ceiling, or null when any row was edited by hand. */
  function staleAutoCeilingOf(rules, currentCeiling) {
    if (!Array.isArray(rules) || rules.length === 0) return null;
    const sorted = [...rules].sort((a, b) => (parseInt(a.adults) || 0) - (parseInt(b.adults) || 0));
    const firstAdults = Math.max(1, parseInt(sorted[0]?.adults) || 1);
    if (firstAdults !== 1) return null;
    const candidate = Math.max(1, (parseInt(sorted[0]?.maxChildren) || 0) + 1);
    if (candidate >= currentCeiling) return null;
    const matches = sorted.every(r => {
      const a = parseInt(r.adults) || 0;
      const c = parseInt(r.maxChildren);
      return !isNaN(c) && c === Math.max(0, candidate - a);
    });
    return matches ? candidate : null;
  }

  /* With room types the property-wide ceiling and adult row count come from
     the widest room, since the sharing rules are property-wide by contract. */
  function roomCeilingOf(rooms) {
    return (rooms || []).reduce((max, room) => Math.max(max, parseInt(room.maxOccupancy) || 0), 0);
  }

  function roomAdultsOf(rooms) {
    return (rooms || []).reduce(
      (max, room) => Math.max(max, Math.min(parseInt(room.maxAdults) || 1, parseInt(room.maxOccupancy) || 1)),
      1
    );
  }

  /* A hire tariff is one season's money: a Rental Price Validity window and the
     rental-length ladder priced inside it. The same car group is contracted at
     other figures in other weeks, so a group holds one season per window, exactly
     as a room holds one rate row per season. */
  function createCarRentalGroup() {
    return {
      groupId: 'crg_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
      vehicleGroup: '',
      vehicleName: '',
      rateCode: '',
      kmsUnlimited: true,
      kmsIncluded: '',
      luggage: '',
      doors: '',
      passengers: '',
      aircon: true,
      gear: 'automatic',
      fuelType: 'fuel',
      seasons: [createCarRentalSeason()]
    };
  }

  /* A hoisted declaration, not a const: createNewItemTemplate() runs from the
     useState initializer above, before this line would have been evaluated. */
  function newRoomTemplate(name = '', key = 'room_1') {
    return {
      key,
      id: null,
      name,
      description: '',
      maxOccupancy: 2,
      maxAdults: 2,
      /* A new room starts without a child cap. Most properties sell a room by
         how many sleep in it and only name a child limit when they have one, so
         the blank is the common contract rather than an unfilled box. */
      maxChildren: null,
      /* A villa is contracted on how many sleep in it; a standard room on its
         adult count. The room carries the choice so one property can hold both,
         and the smallest party the ladder sells - the price bands themselves are
         per season and charge type, so they are typed in the grid below. */
      pricingModel: '',
      occupancyFrom: 2
    };
  }

  function createNewItemTemplate(index = 1) {
    const defaultAgeBands = [
      { id: 'band_1', name: 'Infants', ageFrom: 0, ageTo: 2 },
      { id: 'band_2', name: 'Children', ageFrom: 3, ageTo: 11 },
      { id: 'band_3', name: 'Teens', ageFrom: 12, ageTo: 17 }
    ];

    const initialMaxOcc = 2;
    const initialMaxAdults = 2;
    const defaultRoom = newRoomTemplate('Standard Room');

    return {
      tempId: Date.now() + Math.random(),
      itemIndex: index,
      name: '',
      destinationRegion: '',
      destinationArea: '',
      identifierCode: '',
      category: 'Accommodation',
      currency: 'ZAR',
      mealPlan: 'Bed & Breakfast',
      vehicleType: '',
      tourType: '',
      minPaxToRun: '',
      transferType: '',
      transportType: '',
      flightNumber: '',
      airlineName: '',
      departureCity: '',
      arrivalCity: '',
      trainDepartureDate: '',
      trainJourneyNights: 0,
      trainCabinName: '',
      ticketType: 'standard',
      mealType: 'Breakfast',
      menuType: 'a_la_carte',
      mealGratuityPercent: 0,
      /* Crew flags: which meals the guide and the driver are booked on, and
         whether this flight also sells the guide a seat. All three decide what
         the itinerary offers, never what a season costs. */
      guideMealOffered: false,
      driverMealOffered: false,
      guideFlightOffered: false,
      feeType: 'none',
      levyBasis: 'per_night',
      /* Fees & Tickets items only. A surcharge is its own library item rather
         than a switch on an accommodation, so it carries its own type, basis,
         rate basis, chargeable flag and the property it belongs to. */
      surchargeType: 'entrance_fee',
      surchargeChargeBasis: 'once_off',
      surchargeUnitBasis: 'per_person',
      surchargeChargeable: true,
      linkedItemId: '',
      /* Park fees and conservation levies that belong to this property. They are
         saved as linked Fees & Tickets items so the itinerary can price them on
         their own line, but the operator types them once here with the
         accommodation rather than creating a separate library item. */
      linkedFees: [],
      linkedFeeOriginalIds: [],
      childAge: 12,
      pricingModel: 'per_person', // 'per_person' | 'per_room' | transfer: 'per_vehicle' | 'tiered'
      maxOccupancy: initialMaxOcc,
      maxAdults: initialMaxAdults,
      maxChildren: 1,
      sharingCapacityRules: ensureSharingRules(initialMaxAdults, initialMaxOcc, [
        { adults: 1, maxChildren: 1 },
        { adults: 2, maxChildren: 0 }
      ]),
      childrenOwnRoomPolicy: 'child_rates',
      guideDriverOffered: false,
  guideMinRooms: 1,
  tourLeaderRoomOffered: false,
  tourLeaderMinRooms: 1,
  tourLeaderRate: '',
      driverRequired: false,
      driverMeals: [],
      driverAccommodation: false,
      guideMeals: [],
      guideAccommodation: false,
      description: '',
      textI18n: null,
      imageUrls: [],
      newImageUrlInput: '',
      contractUrl: '',
      contractName: '',
      childAgeRanges: defaultAgeBands,
      carGroups: [createCarRentalGroup()],
      /* The admin fee the hire company adds to every rental agreement. Typed once
         per contract - one library item is one contract - because two vehicle
         groups of the same agreement cannot cost the paperwork differently. */
      rentalContractFee: '',
      roomTypes: [defaultRoom],
      seasons: [
        {
          seasonName: 'Base Season',
          optionName: '',
          roomKey: defaultRoom.key,
          validFrom: '',
          validTo: '',
          ...emptySeasonMoney()
        }
      ]
    };
  }

  const handleSharingRuleChange = (tempId, adultCount, maxChildrenVal) => {
    setItemsToSave(prev => prev.map(item => {
      if (item.tempId === tempId) {
        const hasRooms = item.category === 'Accommodation' && Array.isArray(item.roomTypes) && item.roomTypes.length > 0 && roomsReady;
        const safeMaxOcc = hasRooms
          ? (roomCeilingOf(item.roomTypes) || 2)
          : (parseInt(item.maxOccupancy) || 2);
        const currentRules = item.sharingCapacityRules || ensureSharingRules(item.maxAdults || 2, safeMaxOcc, []);
        const rowMaxAllowed = Math.max(0, safeMaxOcc - adultCount);
        const parsedVal = maxChildrenVal === '' ? '' : Math.max(0, Math.min(rowMaxAllowed, parseInt(maxChildrenVal) || 0));

        const updated = currentRules.map(r => {
          if (r.adults === adultCount) {
            return { ...r, maxChildren: parsedVal };
          }
          return r;
        });

        return {
          ...item,
          sharingCapacityRules: updated
        };
      }
      return item;
    }));
  };

  const activeRoomKeyFor = (item) => {
    const rooms = item?.roomTypes || [];
    const raw = activeRoomByItem[item?.tempId];
    return rooms.some((room) => room.key === raw) ? raw : (rooms[0]?.key || '');
  };

  /* One property can sell sharing rooms and occupancy-priced villas, so what the
     price matrix and its explainer offer is decided by the room on screen. */
  const activeRoomFor = (item, roomKey = '') => (item?.roomTypes || [])
    .find((room) => room.key === (roomKey || activeRoomKeyFor(item))) || null;
  const roomModelFor = (item, roomKey = '') => roomPricingModelOf(
    item?.category === 'Accommodation' ? activeRoomFor(item, roomKey) : null,
    item
  );

  const handleAddRoom = (tempId) => {
    const current = itemsToSave.find(entry => entry.tempId === tempId);
    const rooms = current?.roomTypes || [];
    const used = new Set(rooms.map(room => room.key));
    let seq = rooms.length + 1;
    while (used.has(`room_${seq}`)) seq += 1;
    const room = newRoomTemplate('', `room_${seq}`);
    setItemsToSave(prev => prev.map(item => {
      if (item.tempId !== tempId) return item;
      const newRooms = [...(item.roomTypes || []), room];
      const oldCeiling = roomCeilingOf(item.roomTypes);
      const newCeiling = roomCeilingOf(newRooms);
      return {
        ...item,
        roomTypes: newRooms,
        sharingCapacityRules: newCeiling !== oldCeiling
          ? rebaseSharingRules(roomAdultsOf(newRooms), oldCeiling || 1, newCeiling, item.sharingCapacityRules)
          : item.sharingCapacityRules
      };
    }));
    /* Pricing is entered one room at a time, so a new room becomes the one on
       screen instead of the operator hunting for it in a collapsed list. */
    setActiveRoomByItem(prev => ({ ...prev, [tempId]: room.key }));
  };

  const handleUpdateRoom = (tempId, roomKey, field, value) => {
    setItemsToSave(prev => prev.map(item => {
      if (item.tempId !== tempId) return item;
      const oldCeiling = roomCeilingOf(item.roomTypes);
      const newRooms = (item.roomTypes || []).map(room => {
        if (room.key !== roomKey) return room;
        if (field === 'name' || field === 'description') return { ...room, [field]: value };
        if (field === 'pricingModel') return { ...room, pricingModel: String(value || '') };
        if (field === 'occupancyFrom') {
          const from = Math.min(Math.max(1, parseInt(value, 10) || 1), Math.max(1, parseInt(room.maxOccupancy, 10) || 2));
          return { ...room, occupancyFrom: from };
        }
        const number = Math.max(1, parseInt(value, 10) || 0);
        if (field === 'maxOccupancy') {
          const maxOccupancy = Math.min(30, number);
          const statedChildren = parseInt(room.maxChildren, 10);
          return {
            ...room,
            maxOccupancy,
            maxAdults: Math.min(room.maxAdults || 1, maxOccupancy),
            /* Fewer beds cannot mean more children. A room that never stated a
               child cap keeps it unstated - shrinking the room does not turn a
               property that does not split its guests into one that refuses
               them. */
            maxChildren: Number.isFinite(statedChildren)
              ? Math.min(maxOccupancy, Math.max(0, statedChildren))
              : null
          };
        }
        if (field === 'maxAdults') {
          return { ...room, maxAdults: Math.min(number, room.maxOccupancy || number) };
        }
        if (field === 'maxChildren') {
          const stated = parseInt(value, 10);
          if (!Number.isFinite(stated)) return { ...room, maxChildren: null };
          const ceiling = Math.max(1, parseInt(room.maxOccupancy, 10) || 2);
          return { ...room, maxChildren: Math.min(ceiling, Math.max(0, stated)) };
        }
        return room;
      });
      let next = { ...item, roomTypes: newRooms };
      if (field === 'maxOccupancy' || field === 'maxAdults') {
        const newCeiling = roomCeilingOf(newRooms);
        next = {
          ...next,
          sharingCapacityRules: rebaseSharingRules(roomAdultsOf(newRooms), oldCeiling || 1, newCeiling, item.sharingCapacityRules)
        };
      }
      return next;
    }));
  };

  const handleRemoveRoom = (tempId, roomKey) => {
    const item = itemsToSave.find(entry => entry.tempId === tempId);
    if (!item) return;
    if ((item.roomTypes || []).length <= 1) {
      showToast('A property needs at least one room type', 'warning');
      return;
    }
    if ((item.seasons || []).some(season => season.roomKey === roomKey)) {
      showToast('Remove this room type\'s seasons before deleting it', 'warning');
      return;
    }
    setItemsToSave(prev => prev.map(entry => {
      if (entry.tempId !== tempId) return entry;
      const oldCeiling = roomCeilingOf(entry.roomTypes);
      const newRooms = (entry.roomTypes || []).filter(room => room.key !== roomKey);
      const newCeiling = roomCeilingOf(newRooms);
      return {
        ...entry,
        roomTypes: newRooms,
        sharingCapacityRules: newCeiling !== oldCeiling
          ? rebaseSharingRules(roomAdultsOf(newRooms), oldCeiling || 1, newCeiling || 1, entry.sharingCapacityRules)
          : entry.sharingCapacityRules
      };
    }));
    setActiveRoomByItem(prev => (prev[tempId] === roomKey ? { ...prev, [tempId]: '' } : prev));
  };

  /* The star grade belongs to the supplier (the hotel or lodge), not to one
     room: every room in this property inherits it, and the itinerary, vouchers
     and rate cards print it from there. An existing supplier is updated as the
     stars are clicked; an unsaved inline supplier keeps the grade in the form
     so it is written with the rest of the supplier record. */
  /* A property's locality is the supplier's city — one source of truth, so the
     operator does not retype the destination on every room and rate. */
  const supplierDestination = () => {
    if (supplierMode === 'new' || !selectedSupplierId) {
      return String(supplierForm.city || supplierForm.provinceState || '').trim();
    }
    const supplier = suppliers.find((s) => s.id === selectedSupplierId) || {};
    return String(supplier.city_location || supplier.city || supplier.province_state || '').trim();
  };

  const supplierStarValue = () => {
    if (!selectedSupplierId) return starRatingOf(supplierForm.starRating);
    if (supplierStarDraft[selectedSupplierId] !== undefined) return supplierStarDraft[selectedSupplierId];
    return starRatingOf((suppliers.find(s => s.id === selectedSupplierId) || {}).star_rating);
  };

  const handleStarGradeChange = async (grade) => {
    const rating = grade === null ? null : starRatingOf(grade);
    if (!selectedSupplierId) {
      setSupplierForm(prev => ({ ...prev, starRating: rating ?? '' }));
      return;
    }
    setSupplierStarDraft(prev => ({ ...prev, [selectedSupplierId]: rating }));
    if (!starColumnReady) return;
    const { error } = await supabase
      .from('suppliers')
      .update({ star_rating: rating })
      .eq('id', selectedSupplierId);
    if (error) {
      showToast(error.message, 'error');
      return;
    }
    setSuppliers(prev => prev.map(s => (s.id === selectedSupplierId ? { ...s, star_rating: rating } : s)));
  };

  const handleAddChildAgeBand = (tempId) => {    setItemsToSave(prev => prev.map(item => {
      if (item.tempId === tempId) {
        const currentBands = item.childAgeRanges || [];
        const newBandId = 'band_' + Date.now();
        const lastBand = currentBands[currentBands.length - 1];
        const nextAgeFrom = lastBand ? (lastBand.ageTo + 1) : 0;
        const newBand = {
          id: newBandId,
          name: 'Tier ' + (currentBands.length + 1),
          ageFrom: nextAgeFrom,
          ageTo: nextAgeFrom + 5
        };
        return {
          ...item,
          childAgeRanges: [...currentBands, newBand]
        };
      }
      return item;
    }));
  };

  const handleUpdateChildAgeBand = (tempId, bandIdx, field, val) => {
    setItemsToSave(prev => prev.map(item => {
      if (item.tempId === tempId) {
        const updated = (item.childAgeRanges || []).map((b, idx) => {
          if (idx === bandIdx) {
            const parsedVal = (field === 'ageFrom' || field === 'ageTo')
              ? Math.max(0, parseInt(val) || 0)
              : val;
            return { ...b, [field]: parsedVal };
          }
          return b;
        });
        return { ...item, childAgeRanges: updated };
      }
      return item;
    }));
  };

  const handleRemoveChildAgeBand = (tempId, bandIdx) => {
    setItemsToSave(prev => prev.map(item => {
      if (item.tempId === tempId && (item.childAgeRanges || []).length > 1) {
        return {
          ...item,
          childAgeRanges: item.childAgeRanges.filter((_, idx) => idx !== bandIdx)
        };
      }
      return item;
    }));
  };

  const handleChildRateChange = (tempId, seasonIdx, bandId, rate) => {
    setItemsToSave(prev => prev.map(item => {
      if (item.tempId === tempId) {
        const updatedSeasons = item.seasons.map((s, idx) => {
          if (idx === seasonIdx) {
            const updatedChildRates = {
              ...(s.childRates || {}),
              [bandId]: clampNonNegative(rate)
            };
            return { ...s, childRates: updatedChildRates };
          }
          return s;
        });
        return { ...item, seasons: updatedSeasons };
      }
      return item;
    }));
  };

  const handleFastTrackChildRateChange = (tempId, seasonIdx, bandId, rate) => {
    setItemsToSave(prev => prev.map(item => {
      if (item.tempId === tempId) {
        const updatedSeasons = item.seasons.map((s, idx) => {
          if (idx === seasonIdx) {
            const updatedChildRates = {
              ...(s.fastTrackChildRates || {}),
              [bandId]: clampNonNegative(rate)
            };
            return { ...s, fastTrackChildRates: updatedChildRates };
          }
          return s;
        });
        return { ...item, seasons: updatedSeasons };
      }
      return item;
    }));
  };

  // ── Resolve company_id robustly ──────────────────────────────────────────
  // 1. Try profiles.company_id  (normal path)
  // 2. Fall back to companies.owner_id = auth user  (after schema reset)
  const resolveCompanyId = async (user) => {
    const { data: profile } = await supabase
      .from('profiles')
      .select('company_id')
      .eq('id', user.id)
      .single();

    if (scopeCompanyId(profile?.company_id)) return scopeCompanyId(profile.company_id);

    // Fallback: find a company owned by this user
    const { data: ownedCompany } = await supabase
      .from('companies')
      .select('id')
      .eq('owner_id', user.id)
      .single();

    if (ownedCompany?.id) return ownedCompany.id;

    throw new Error(
      'Company not found. Your account is not linked to a company. Please contact support or re-register.'
    );
  };

  useEffect(() => {
    fetchInitialData();
  }, []);

  useEffect(() => {
    if (!lightbox) return;
    const onKeyDown = (e) => {
      if (e.key === 'Escape') setLightbox(null);
      if (e.key === 'ArrowRight') setLightbox(prev => prev && { ...prev, index: (prev.index + 1) % prev.images.length });
      if (e.key === 'ArrowLeft') setLightbox(prev => prev && { ...prev, index: (prev.index - 1 + prev.images.length) % prev.images.length });
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [lightbox]);

  const fetchInitialData = async () => {
    setLoading(true);
    try {
      /* Optional columns differ between deployments, so probe the ones the
         editor writes. A select against a missing column fails, which hides
         only the controls that need it instead of breaking the save. */
      try {
        const hasColumns = async (table, columns) => {
          const { error } = await supabase.from(table).select(columns.join(',')).limit(1);
          return !error;
        };
        const [
          guideDriverRates, guideMinRooms, guideDriverTiers,
          contracts, tieredPricing, transferType, tourType, transportType,
          feeTypeLib, feeTypeRates, driverOption, surchargeFees,
          pricesByVehicle, tourLeaderTiers, singleSupplementTiers, nightBands, weekendRates,
          roomPricingModel, occupancyRatesColumn, staffOptions, minPaxToRun, entranceFeeChildRate,
          rentalContractFee, textI18n
        ] = await Promise.all([
          hasColumns('item_rates', ['guide_rate', 'driver_rate', 'guide_meal_plan', 'driver_meal_plan']),
          hasColumns('library_items', ['guide_min_rooms']),
          hasColumns('item_rates', ['guide_tiers', 'driver_tiers']),
          hasColumns('library_items', ['contract_url', 'contract_name']),
          hasColumns('item_rates', ['tiered_pricing']),
          hasColumns('library_items', ['transfer_type']),
          hasColumns('library_items', ['tour_type']),
          hasColumns('library_items', ['transport_type']),
          /* fee_type and conservation_levy_basis travel on the same library
             payload, so they gate together; the fee figures are rate columns. */
          hasColumns('library_items', ['fee_type', 'conservation_levy_basis']),
          hasColumns('item_rates', ['entrance_fee_per_person', 'conservation_levy_per_adult']),
          hasColumns('library_items', ['driver_required', 'driver_meals', 'driver_accommodation']),
          hasColumns('library_items', ['surcharge_type', 'surcharge_charge_basis', 'surcharge_unit_basis', 'surcharge_chargeable', 'linked_item_id']),
          hasColumns('item_rates', ['prices_by_vehicle']),
          hasColumns('item_rates', ['tour_leader_tiers']),
          hasColumns('item_rates', ['single_supplement_tiers']),
          hasColumns('item_rates', ['min_nights', 'max_nights']),
          hasColumns('item_rates', ['weekend_days', 'weekend_price']),
          /* A villa ladder spans two tables: the room says which contract it is
             sold on and the rate row carries the per-person bands. Both must
             exist before the editor offers the basis, or a save would write a
             column the database has not got. */
          hasColumns('library_item_room_types', ['pricing_model']),
          hasColumns('item_rates', ['occupancy_rates']),
          /* Which meals the crew eats and whether the supplier sells the guide a
             seat: three item-level flags that arrive on the same migration, so
             they gate together. */
          hasColumns('library_items', ['guide_meal_offered', 'driver_meal_offered', 'guide_flight_offered']),
          /* A tour that runs for one guest is a fact about the item, not a season;
             the child entrance fee is a figure on the rate row beside the adult
             one. Both arrive on 20261245. */
          hasColumns('library_items', ['min_pax_to_run']),
          hasColumns('item_rates', ['entrance_fee_per_child']),
          /* A hire contract always carries an admin fee, but the column only
             arrives with the rental work: an unmigrated workspace keeps its
             tariffs and simply has nowhere to type the fee. */
          hasColumns('library_items', ['rental_contract_fee']),
          /* The translation column 20261251 adds. Until it lands, the item keeps
             its single English description and no language tabs appear. */
          hasColumns('library_items', ['text_i18n'])
        ]);
        setDbFeatures({
          guideDriver: guideDriverRates,
          guideMinRooms,
          guideDriverTiers,
          contracts,
          tieredPricing,
          transferType,
          tourType,
          transportType,
          feeType: feeTypeLib && feeTypeRates,
          driverOption,
          surchargeFees,
          pricesByVehicle,
          tourLeaderTiers,
          singleSupplementTiers,
          nightBands,
          weekendRates,
          occupancyPricing: roomPricingModel && occupancyRatesColumn,
          staffOptions,
          minPaxToRun,
          feeChildRate: entranceFeeChildRate,
          rentalContractFee,
          textI18n
        });
      } catch {
        // Probes failed (offline / row-level security) — keep the defaults.
      }

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      let companyId;
      try {
        companyId = await resolveCompanyId(user);
      } catch {
        // No company linked yet — show empty state without crashing
        setLoading(false);
        return;
      }

      /* Vehicle types are a national list now: the standard rows plus this
         company's own, with the company's row winning where both carry one code.
         Active is decided after merging, because deactivating a standard type
         means adding an override that says so, not editing the shared row. */
      const { data: vTypes } = await supabase
        .from('company_vehicle_types')
        .select(VEHICLE_TYPES.columns)
        .or(vocabularyReadFilter(companyId))
        .order(...VEHICLE_TYPES.orderBy);
      setVehicleTypes(activeVehicleTypes(mergeVocabulary(vTypes, VEHICLE_TYPES.keyColumn)));

      const { data: sups } = await supabase
        .from('suppliers')
        .select('*')
        .eq('company_id', companyId)
        .order('name', { ascending: true });
      setSuppliers(sups || []);

      /* The column has a database default, and a tenant that never opened
         Settings has no row at all — either way the fallback is the country the
         rest of the app already assumes. A missing column simply reads as null. */
      const { data: billingRow } = await supabase
        .from('company_billing_settings')
        .select('operating_country')
        .eq('company_id', companyId)
        .maybeSingle();
      const tenantCountry = String(billingRow?.operating_country || '').trim();
      if (tenantCountry) setOperatingCountry(tenantCountry);

      // Load category options from the database (falls back to the built-in
      // list on error, e.g. when library_categories doesn't exist yet).
      try {
        const { data: catsData } = await supabase
          .from('library_categories')
          .select('id, name, icon, color, sort_order')
          .order('sort_order', { ascending: true });
        if (catsData && catsData.length > 0) {
          const legacyNames = ['Entrance fees', 'Conservation Levies'];
          setCategories(catsData
            .filter(c => !legacyNames.includes(c.name))
            .map(c => {
              const id = normalizeCategoryName(c.name);
              const match = categoryOptions.find(o => o.id === id);
              return { id, label: id, icon: match?.icon || Package, color: c.color || match?.color || '#334155' };
            }));
        }
      } catch {
        // table missing — keep fallback
      }

      const preselectedId = location.state?.supplierId;
      if (preselectedId && sups?.some(s => s.id === preselectedId)) {
        setSelectedSupplierId(preselectedId);
        setShowInlineForm(true);
      }
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  const fetchLibraryItems = async ({ offset = 0, append = false } = {}) => {
    setFetchingItems(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data: profile } = await supabase
        .from('profiles')
        .select('company_id')
        .eq('id', user.id)
        .single();

      if (!scopeCompanyId(profile?.company_id)) return;

      // ── Fetch pages of items as plain queries (no PostgREST FK joins).
      // This avoids "schema cache" errors regardless of FK registration state
      // and keeps each request small, loading rows on demand via search/filters.

      const trimmed = (search || '').trim();
      const term = trimmed.replace(/[,()]/g, ' ').trim();
      const esc = (s) => s.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');

      let itemQuery = supabase
        .from('library_items')
        .select('*', { count: 'exact' })
        .eq('company_id', scopeCompanyId(profile.company_id))
        .order('created_at', { ascending: false });

      if (supplierFilter !== 'All') {
        itemQuery = itemQuery.eq('supplier_id', supplierFilter);
      }
      if (categoryFilter !== 'All') {
        itemQuery = legacyCategoryName(categoryFilter)
          ? itemQuery.in('category', [categoryFilter, legacyCategoryName(categoryFilter)])
          : itemQuery.eq('category', categoryFilter);
      }
      if (term) {
        const termLower = term.toLowerCase();
        const matchingSupplierIds = suppliers
          .filter((s) => (s.name || '').toLowerCase().includes(termLower))
          .slice(0, 30)
          .map((s) => s.id);
        if (matchingSupplierIds.length > 0) {
          itemQuery = itemQuery.or(`name.ilike.%${esc(term)}%,description.ilike.%${esc(term)}%,supplier_id.in.(${matchingSupplierIds.join(',')})`);
        } else {
          itemQuery = itemQuery.or(`name.ilike.%${esc(term)}%,description.ilike.%${esc(term)}%`);
        }
      }
      itemQuery = itemQuery.range(offset, offset + pageSize - 1);

      const { data: items, count, error: itemsError } = await itemQuery;
      if (itemsError) throw itemsError;

      const itemIds = (items || []).map(i => i.id);

      // Fetch item_rates separately — no FK join
      const { data: ratesData } = itemIds.length > 0
        ? await supabase.from('item_rates').select('*').in('item_id', itemIds)
        : { data: [] };

      /* Room types are a child of the property, so a hotel with three rooms
         loads as one library row. The lookup is silent until the lodging
         migration is applied, and a legacy item simply reads as no rooms. */
      const roomsByItem = await fetchRoomTypesForItems(itemIds);

      // Fetch car_rental_rates separately — no FK join
      let carRatesData = [];
      if (itemIds.length > 0) {
        try {
          const carRes = await supabase.from('car_rental_rates').select('*').in('item_id', itemIds);
          carRatesData = carRes.data || [];
        } catch (e) {
          carRatesData = [];
        }
      }

      // Fetch suppliers separately — no FK join
      const { data: suppliersData } = await supabase
        .from('suppliers')
        .select(await supplierColumns('id, name'))
        .eq('company_id', scopeCompanyId(profile.company_id));

      // Build lookup maps and merge
      const ratesMap = {};
      (ratesData || []).forEach(r => {
        if (!ratesMap[r.item_id]) ratesMap[r.item_id] = [];
        ratesMap[r.item_id].push(r);
      });

      const carRatesMap = {};
      (carRatesData || []).forEach(r => {
        if (!carRatesMap[r.item_id]) carRatesMap[r.item_id] = [];
        carRatesMap[r.item_id].push(r);
      });

      const supplierMap = {};
      (suppliersData || []).forEach(s => { supplierMap[s.id] = s; });

      const merged = (items || []).map(item => ({
        ...item,
        category: normalizeCategoryName(item.category),
        item_rates: ratesMap[item.id] || [],
        car_rental_rates: carRatesMap[item.id] || [],
        room_types: roomsByItem.get(item.id) || [],
        supplier: supplierMap[item.supplier_id] || null
      }));

      if (append) {
        setLibraryItemsList(prev => {
          const seen = new Set(prev.map(i => i.id));
          return [...prev, ...merged.filter(i => !seen.has(i.id))];
        });
      } else {
        setLibraryItemsList(merged);
      }
      setTotalCount(count || merged.length);
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setFetchingItems(false);
    }
  };

  useEffect(() => {
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    searchTimeoutRef.current = setTimeout(() => fetchLibraryItems({ offset: 0 }), 350);
    return () => {
      if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    };
  }, [categoryFilter, supplierFilter, search]);

  // Add Another Library Item Card in Batch Form
  const handleAddAnotherItem = () => {
    setItemsToSave(prev => [
      ...prev,
      createNewItemTemplate(prev.length + 1)
    ]);
  };

  // Remove Item Card from Batch Form
  const handleRemoveItemCard = (tempId) => {
    if (itemsToSave.length === 1) return;
    setItemsToSave(prev => prev.filter(item => item.tempId !== tempId));
  };

  // Update Item Field
  /* One field of a language's own set of translations, merged into the item's
     text_i18n by the editor. It is a separate handler because a translation is
     an object of languages, not a value a text input types. */
  const handleItemTranslationsChange = (tempId, nextTranslations) => {
    setItemsToSave(prev => prev.map(item => (item.tempId === tempId ? { ...item, textI18n: nextTranslations } : item)));
  };

  const handleItemFieldChange = (tempId, field, value) => {
    setItemsToSave(prev => prev.map(item => {
      if (item.tempId === tempId) {
        return { ...item, [field]: clampNonNegative(value) };
      }
      return item;
    }));
  };

  // ── Car Rental groups ──────────────────────────────────────────────────────
  const handleAddCarGroup = (tempId) => {
    setItemsToSave(prev => prev.map(item => {
      if (item.tempId !== tempId) return item;
      return { ...item, carGroups: [...(item.carGroups || []), createCarRentalGroup()] };
    }));
  };

  const handleRemoveCarGroup = (tempId, groupId) => {
    setItemsToSave(prev => prev.map(item => {
      if (item.tempId !== tempId) return item;
      const groups = (item.carGroups || []).filter(g => g.groupId !== groupId);
      return { ...item, carGroups: groups.length > 0 ? groups : [createCarRentalGroup()] };
    }));
  };

  const handleCarGroupFieldChange = (tempId, groupId, field, value) => {
    setItemsToSave(prev => prev.map(item => {
      if (item.tempId !== tempId) return item;
      const groups = (item.carGroups || []).map(g =>
        g.groupId === groupId ? { ...g, [field]: clampNonNegative(value) } : g
      );
      return { ...item, carGroups: groups };
    }));
  };

  /* The seasons a group is sold across, each with its own Rental Price Validity
     window and its own ladder. Copying the ladder of the season before it keeps the
     day bands the contract uses; the prices stay blank until they are typed. */
  const handleAddCarSeason = (tempId, groupId) => {
    setItemsToSave(prev => prev.map(item => {
      if (item.tempId !== tempId) return item;
      const groups = (item.carGroups || []).map(g => {
        if (g.groupId !== groupId) return g;
        const seasons = g.seasons?.length ? g.seasons : [createCarRentalSeason()];
        return { ...g, seasons: [...seasons, createCarRentalSeason(seasons[seasons.length - 1])] };
      });
      return { ...item, carGroups: groups };
    }));
  };

  const handleRemoveCarSeason = (tempId, groupId, seasonId) => {
    setItemsToSave(prev => prev.map(item => {
      if (item.tempId !== tempId) return item;
      const groups = (item.carGroups || []).map(g => {
        if (g.groupId !== groupId) return g;
        const seasons = (g.seasons || []).filter(s => s.seasonId !== seasonId);
        return { ...g, seasons: seasons.length > 0 ? seasons : [createCarRentalSeason()] };
      });
      return { ...item, carGroups: groups };
    }));
  };

  const handleCarSeasonFieldChange = (tempId, groupId, seasonId, field, value) => {
    setItemsToSave(prev => prev.map(item => {
      if (item.tempId !== tempId) return item;
      const groups = (item.carGroups || []).map(g => {
        if (g.groupId !== groupId) return g;
        const seasons = (g.seasons || []).map(s =>
          s.seasonId === seasonId ? { ...s, [field]: clampNonNegative(value) } : s
        );
        return { ...g, seasons };
      });
      return { ...item, carGroups: groups };
    }));
  };

  const handleAddCarRange = (tempId, groupId, seasonId) => {
    setItemsToSave(prev => prev.map(item => {
      if (item.tempId !== tempId) return item;
      const groups = (item.carGroups || []).map(g => {
        if (g.groupId !== groupId) return g;
        const seasons = (g.seasons || []).map(s => (
          s.seasonId === seasonId
            ? { ...s, ranges: [...(s.ranges || []), { minDays: '', maxDays: '', price: '' }] }
            : s
        ));
        return { ...g, seasons };
      });
      return { ...item, carGroups: groups };
    }));
  };

  const handleRemoveCarRange = (tempId, groupId, seasonId, rangeIdx) => {
    setItemsToSave(prev => prev.map(item => {
      if (item.tempId !== tempId) return item;
      const groups = (item.carGroups || []).map(g => {
        if (g.groupId !== groupId) return g;
        const seasons = (g.seasons || []).map(s => {
          if (s.seasonId !== seasonId) return s;
          const ranges = (s.ranges || []).filter((_, idx) => idx !== rangeIdx);
          return { ...s, ranges: ranges.length > 0 ? ranges : [{ minDays: '', maxDays: '', price: '' }] };
        });
        return { ...g, seasons };
      });
      return { ...item, carGroups: groups };
    }));
  };

  const handleCarRangeChange = (tempId, groupId, seasonId, rangeIdx, field, value) => {
    setItemsToSave(prev => prev.map(item => {
      if (item.tempId !== tempId) return item;
      const groups = (item.carGroups || []).map(g => {
        if (g.groupId !== groupId) return g;
        const seasons = (g.seasons || []).map(s => {
          if (s.seasonId !== seasonId) return s;
          const ranges = (s.ranges || []).map((r, idx) => (
            idx === rangeIdx ? { ...r, [field]: clampNonNegative(value) } : r
          ));
          return { ...s, ranges };
        });
        return { ...g, seasons };
      });
      return { ...item, carGroups: groups };
    }));
  };

  // Save Supplier Only handler (Inside new supplier box)
  const handleSaveSupplierOnly = async () => {
    if (!supplierForm.name.trim()) {
      showToast('Supplier Name is required', 'warning');
      return;
    }

    setSavingSupplier(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const companyId = await resolveCompanyId(user);

      const newSupPayload = {
        company_id: companyId,
        name: supplierForm.name.trim(),
        category: itemsToSave[0]?.category || 'Accommodation',
        contact_person: supplierForm.contactPerson,
        email: supplierForm.email,
        phone: supplierForm.phone,
        website: supplierForm.website,
        address: supplierForm.address,
        physical_address: supplierForm.address,
        country: supplierForm.country,
        province_state: supplierForm.provinceState,
        city: supplierForm.city,
        city_location: supplierForm.city || supplierForm.provinceState,
        bank_name: supplierForm.bankName,
        account_holder_name: supplierForm.accountHolderName,
        bank_account_number: supplierForm.bankAccountNumber,
        branch_code: supplierForm.branchCode,
        swift_code: supplierForm.swiftCode
      };

      const { data: createdSup, error: supErr } = await supabase
        .from('suppliers')
        .insert([newSupPayload])
        .select()
        .single();

      if (supErr) throw supErr;

      setSuppliers(prev => [...prev, createdSup]);
      setSelectedSupplierId(createdSup.id);
      setSupplierMode('existing');
      setSupplierForm({
        name: '',
        contactPerson: '',
        email: '',
        phone: '',
        website: '',
        address: '',
        country: 'South Africa',
        provinceState: '',
        city: '',
        bankName: '',
        accountHolderName: '',
        bankAccountNumber: '',
        branchCode: '',
        swiftCode: ''
      });
      showToast(`Supplier "${createdSup.name}" created and saved! Library Items section is now active.`, 'success');
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setSavingSupplier(false);
    }
  };

  const handleCancelSupplierForm = () => {
    setSupplierMode('existing');
    setSupplierForm({
      name: '',
      contactPerson: '',
      email: '',
      phone: '',
      website: '',
      address: '',
      country: 'South Africa',
      provinceState: '',
      city: '',
      bankName: '',
      accountHolderName: '',
      bankAccountNumber: '',
      branchCode: '',
      swiftCode: ''
    });
  };

  // Upload JPEG Images (Max 10 per Library Item)
  const handleImageFilesUpload = (tempId, files) => {
    if (!files || files.length === 0) return;

    const targetItem = itemsToSave.find(item => item.tempId === tempId);
    if (!targetItem) return;

    const currentCount = targetItem.imageUrls?.length || 0;
    if (currentCount >= 10) {
      showToast('Maximum 10 images reached for this library item', 'warning');
      return;
    }

    const validFiles = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const isJpeg = file.type === 'image/jpeg' || file.type === 'image/jpg' || file.type === 'image/png' || file.name.match(/\.(jpe?g|png)$/i);
      if (!isJpeg) {
        showToast(`"${file.name}" skipped: Only JPEG (.jpg / .jpeg) and PNG (.png) image files are allowed.`, 'warning');
        continue;
      }
      validFiles.push(file);
    }

    if (validFiles.length === 0) return;

    const remainingSlots = 10 - currentCount;
    const filesToProcess = validFiles.slice(0, remainingSlots);
    if (validFiles.length > remainingSlots) {
      showToast(`Only ${remainingSlots} more image(s) could be added (max 10 total).`, 'info');
    }

    (async () => {
      for (let i = 0; i < filesToProcess.length; i++) {
        try {
          const dataUrl = await compressImageDataUrl(filesToProcess[i]);
          setItemsToSave(prev => prev.map(item => {
            if (item.tempId === tempId) {
              if (item.imageUrls.length >= 10) return item;
              return {
                ...item,
                imageUrls: [...item.imageUrls, dataUrl]
              };
            }
            return item;
          }));
        } catch {
          showToast('One image could not be processed and was skipped.', 'error');
        }
      }
    })();
  };

  const handleRemoveImage = (tempId, imgIdx) => {
    setItemsToSave(prev => prev.map(item => {
      if (item.tempId === tempId) {
        const updatedImages = item.imageUrls.filter((_, idx) => idx !== imgIdx);
        return { ...item, imageUrls: updatedImages };
      }
      return item;
    }));
  };

  // Reorder image within an item's gallery. direction: -1 = move left, +1 = move right.
  const handleMoveImage = (tempId, fromIdx, direction) => {
    setItemsToSave(prev => prev.map(item => {
      if (item.tempId !== tempId) return item;
      const toIdx = fromIdx + direction;
      if (toIdx < 0 || toIdx >= item.imageUrls.length) return item;
      const urls = [...item.imageUrls];
      [urls[fromIdx], urls[toIdx]] = [urls[toIdx], urls[fromIdx]];
      return { ...item, imageUrls: urls };
    }));
  };

  // Build a browser-renderable source for a contract file (PDF native, Office via viewer)
  const getContractViewerSrc = (url, name) => {
    const fileName = (name || url || '').split('/').pop() || '';
    const lower = fileName.toLowerCase();
    if (lower.endsWith('.pdf')) return url;
    if (/\.(docx?|xlsx?|pptx?)$/.test(lower)) {
      return `https://view.officeapps.live.com/op/view.aspx?src=${encodeURIComponent(url)}`;
    }
    return url;
  };

  // Upload a contract document (PDF / Word / Excel) to Supabase Storage
  const handleContractFileSelect = async (tempId, files) => {
    if (!files || files.length === 0) return;
    const file = files[0];
    const lowerName = (file.name || '').toLowerCase();
    if (!/\.(pdf|docx?|xlsx?)$/.test(lowerName)) {
      showToast(`"${file.name}" skipped: Only PDF, Word and Excel files are allowed.`, 'warning');
      return;
    }
    if (file.size > 30 * 1024 * 1024) {
      showToast('Contract file exceeds the 30 MB limit.', 'warning');
      return;
    }

    const target = itemsToSave.find(i => i.tempId === tempId);
    if (!target) return;
    if (target.contractUrl) {
      showToast('A contract is already attached. Remove it first to upload a new one.', 'warning');
      return;
    }

    setUploadingContract(tempId);

    let companyId = null;
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        companyId = await resolveCompanyId(user);
      }
    } catch {
      // The upload below will report a clear error if the tenant cannot resolve.
    }

    if (!companyId) {
      showToast('Your tenant workspace could not be resolved. Please sign in again.', 'error');
      setUploadingContract(null);
      return;
    }

    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const path = `${companyId}/${Date.now()}_${safeName}`;

    const { error: upErr } = await supabase.storage.from('contracts').upload(path, file, { upsert: true, cacheControl: '3600' });
    if (upErr) {
      showToast(`Contract upload failed: ${upErr.message}`, 'error');
      setUploadingContract(null);
      return;
    }

    const { data: pubData } = supabase.storage.from('contracts').getPublicUrl(path);

    setItemsToSave(prev => prev.map(i => {
      if (i.tempId !== tempId) return i;
      return { ...i, contractUrl: pubData?.publicUrl || '', contractName: file.name };
    }));
    setUploadingContract(null);
    showToast('Contract uploaded.', 'success');
  };

  const handleRemoveContract = (tempId) => {
    setItemsToSave(prev => prev.map(i => {
      if (i.tempId !== tempId) return i;
      return { ...i, contractUrl: '', contractName: '' };
    }));
  };

  // Seasons Management within an item
  const handleAddSeasonRow = (tempId, optionName = '', roomKey = '') => {
    setItemsToSave(prev => prev.map(item => {
      if (item.tempId === tempId) {
        const room = (item.roomTypes || []).find(entry => entry.key === roomKey) || item.roomTypes?.[0];
        const seasonCount = room
          ? item.seasons.filter(s => s.roomKey === room.key).length + 1
          : item.seasons.length + 1;
        return {
          ...item,
          seasons: [
            ...item.seasons,
            {
              seasonName: `Season ${seasonCount}`,
              /* The charge option this season belongs to. Empty means the
                 item's default board; a named value makes it one option of a
                 multi-price accommodation. */
              optionName: optionName || item.mealPlan || '',
              /* A season is priced for one room type. The key is the room the
                 new row is entered under; a legacy one-room item leaves it on
                 its only room. */
              roomKey: room?.key || '',
              validFrom: '',
              validTo: '',
              ...emptySeasonMoney()
            }
          ]
        };
      }
      return item;
    }));
  };

  /* A transfer names its vehicle from the company's own Settings list, and the
     vehicle's seats ARE its capacity: the band engine, the placement guards and
     every document read max_occupancy, so picking a 6-seat Combi has to leave a
     6 behind. The money does not move — a transfer charges the per-person or
     tiered row it contracts whatever car turns up.
     A row saved before the list existed, or on a type since retired, keeps its
     own words and the capacity it already carried. */
  const handleVehicleTypeChange = (tempId, value) => {
    setItemsToSave(prev => prev.map(item => {
      if (item.tempId !== tempId) return item;
      const chosen = vehicleTypes.find((type) => type.name === value);
      const pax = chosen
        ? (parseInt(chosen.max_capacity, 10) || 0)
        : (parseInt(item.maxOccupancy) || 0);
      const driverEligible = isDriverEligibleCategory(item.category) && pax >= 14;
      return {
        ...item,
        vehicleType: value,
        maxOccupancy: pax || (parseInt(item.maxOccupancy) || 0),
        driverRequired: driverEligible ? true : false,
        driverMeals: driverEligible ? getDefaultDriverMeals(item.category, driverHireType(item)) : [],
        driverAccommodation: driverEligible ? getDefaultDriverAccommodation(item.category, driverHireType(item)) : false
      };
    }));
  };

  // Switch category AND keep a valid pricing model for it
  const handleCategoryChange = (tempId, category) => {
    setItemsToSave(prev => prev.map(item => {
      if (item.tempId !== tempId) return item;
      let pricingModel = item.pricingModel;
      if (isTourStyleCategory(category)) {
        if (isFlightCategory(category)) {
          if (item.category === 'Flights / Charter') pricingModel = item.pricingModel;
          else if (!item.pricingModel || !['per_person', 'per_vehicle'].includes(item.pricingModel)) pricingModel = 'per_person';
        } else if (!['per_vehicle', 'per_person', 'tiered'].includes(pricingModel)) {
          pricingModel = 'per_vehicle';
        }
      } else if (category === 'Accommodation') {
        pricingModel = 'per_person';
      } else if (isTicketCategory(category)) {
        pricingModel = 'per_person';
      } else if (isExtrasCategory(category)) {
        pricingModel = 'per_person';
      } else if (isCarRentalCategory(category)) {
        pricingModel = 'per_vehicle';
      } else {
        if (['per_vehicle', 'tiered', 'per_unit'].includes(pricingModel)) pricingModel = 'per_person';
      }
      /* Switching category drops the legacy bundled-fee switch: entrance fees
         and conservation levies live in their own items now, so a base item
         never carries one. */
      const feeType = 'none';
      const driverEligible = isDriverEligibleCategory(category) && getVehiclePax(item.maxOccupancy) >= 14;
      /* A hire names its country, not its town. Only ever filled when the box
         is still empty, so switching category cannot overwrite a locality the
         operator already typed. */
      const destinationRegion = isCarRentalCategory(category) && !String(item.destinationRegion || '').trim()
        ? operatingCountry
        : item.destinationRegion;
      return {
        ...item,
        category,
        destinationRegion,
        pricingModel,
        feeType,
        driverRequired: driverEligible ? true : false,
        driverMeals: driverEligible ? getDefaultDriverMeals(category, driverHireType({ ...item, category })) : [],
        driverAccommodation: driverEligible ? getDefaultDriverAccommodation(category, driverHireType({ ...item, category })) : false
      };
    }));
  };

  // Transfer tiered pricing rows
  const handleAddTierRow = (tempId, seasonIdx) => {
    setItemsToSave(prev => prev.map(item => {
      if (item.tempId !== tempId) return item;
      const updatedSeasons = item.seasons.map((s, idx) => {
        if (idx !== seasonIdx) return s;
        return { ...s, tiers: [...(s.tiers || []), { minPax: '', maxPax: '', rate: '' }] };
      });
      return { ...item, seasons: updatedSeasons };
    }));
  };

  const handleUpdateTier = (tempId, seasonIdx, tierIdx, field, value) => {
    setItemsToSave(prev => prev.map(item => {
      if (item.tempId !== tempId) return item;
      const updatedSeasons = item.seasons.map((s, idx) => {
        if (idx !== seasonIdx) return s;
        const updatedTiers = (s.tiers || []).map((t, tIdx) => tIdx === tierIdx ? { ...t, [field]: clampNonNegative(value) } : t);
        return { ...s, tiers: updatedTiers };
      });
      return { ...item, seasons: updatedSeasons };
    }));
  };

  const handleRemoveTier = (tempId, seasonIdx, tierIdx) => {
    setItemsToSave(prev => prev.map(item => {
      if (item.tempId !== tempId) return item;
      const updatedSeasons = item.seasons.map((s, idx) => {
        if (idx !== seasonIdx) return s;
        return { ...s, tiers: (s.tiers || []).filter((_, tIdx) => tIdx !== tierIdx) };
      });
      return { ...item, seasons: updatedSeasons };
    }));
  };

  const handleSeasonChange = (tempId, seasonIdx, field, value) => {
    setItemsToSave(prev => prev.map(item => {
      if (item.tempId === tempId) {
        const updatedSeasons = item.seasons.map((s, idx) => {
          if (idx === seasonIdx) {
            return { ...s, [field]: clampNonNegative(value) };
          }
          return s;
        });
        return { ...item, seasons: updatedSeasons };
      }
      return item;
    }));
  };

  /* Some fields hold a list rather than a figure (the weekend weekdays), so they
     are set as typed instead of going through the numeric clamp. */
  const handleSeasonValueChange = (tempId, seasonIdx, field, value) => {
    setItemsToSave(prev => prev.map(item => {
      if (item.tempId !== tempId) return item;
      const updatedSeasons = item.seasons.map((s, idx) => (idx === seasonIdx ? { ...s, [field]: value } : s));
      return { ...item, seasons: updatedSeasons };
    }));
  };

  /* The villa ladder is typed one box per party size. A size with no figure is
     dropped from the ladder rather than stored at zero: a zero would quote the
     room for nothing, where the supplier simply does not sell it that size. */
  const handleOccupancyRateChange = (tempId, seasonIdx, pax, value) => {
    const price = parseFloat(value);
    setItemsToSave(prev => prev.map(item => {
      if (item.tempId !== tempId) return item;
      return {
        ...item,
        seasons: item.seasons.map((s, idx) => {
          if (idx !== seasonIdx) return s;
          const rows = (Array.isArray(s.occupancyRates) ? s.occupancyRates : [])
            .filter((row) => parseInt(row.pax, 10) !== pax);
          if (Number.isFinite(price) && price > 0) rows.push({ pax, rate: price });
          return { ...s, occupancyRates: rows.sort((a, b) => a.pax - b.pax) };
        })
      };
    }));
  };

  /* The crew and tour leader ladders share one editor shape: a list of
     { minClientRooms, maxClientRooms, rooms, rate } rows held on the season
     under its field. */
  const updateSeasonTierList = (tempId, seasonIdx, field, updater) => {
    setItemsToSave(prev => prev.map(item => {
      if (item.tempId !== tempId) return item;
      return {
        ...item,
        seasons: item.seasons.map((s, idx) => (idx === seasonIdx
          ? { ...s, [field]: updater(s[field] || []) }
          : s))
      };
    }));
  };

  const handleTierAdd = (tempId, seasonIdx, field, defaultMinRooms = 1) => {
    updateSeasonTierList(tempId, seasonIdx, field, (tiers) => {
      const previous = tiers[tiers.length - 1];
      /* A first tier seeds from the item's minimum; a later one starts blank
         because its threshold is a new contract term, and the rooms count steps
         up by one so the usual "one more room" ladder is one click away. */
      const next = previous
        ? { minClientRooms: '', maxClientRooms: '', rooms: String(Math.max(1, parseInt(previous.rooms, 10) || 1) + 1), rate: '' }
        : { minClientRooms: String(defaultMinRooms || 1), maxClientRooms: '', rooms: '1', rate: '' };
      return [...tiers, next];
    });
  };

  const handleTierChange = (tempId, seasonIdx, field, tierIdx, key, value) => {
    updateSeasonTierList(tempId, seasonIdx, field, (tiers) => tiers.map((tier, tIdx) => (
      tIdx === tierIdx ? { ...tier, [key]: clampNonNegative(value) } : tier
    )));
  };

  const handleTierRemove = (tempId, seasonIdx, field, tierIdx) => {
    updateSeasonTierList(tempId, seasonIdx, field, (tiers) => tiers.filter((_, tIdx) => tIdx !== tierIdx));
  };

  /* Single-supplement waiver: the rate card only stores how many single rooms
     are charged the sharing rate. A blank box is no waiver; anything else is a
     whole number of rooms. */
  const handleSingleSupplementWaiverChange = (tempId, seasonIdx, value) => {
    const digits = String(value ?? '').replace(/[^\d]/g, '');
    handleSeasonChange(tempId, seasonIdx, 'singleSupplementWaiver', digits);
  };

  /* Money fields only — snaps a typed rate/fee to a whole number on blur when the
     "Round input amounts" setting is active. Counts (pax, capacity, ages) never
     go through this. */
  const snapSeasonMoney = (e, tempId, seasonIndex, field) => {
    const v = applyInputRounding(e.target.value, amountSettings.inputRounding);
    if (v !== '' && v !== e.target.value) handleSeasonChange(tempId, seasonIndex, field, v);
  };

  const snapOccupancyMoney = (e, tempId, seasonIndex, pax) => {
    const v = applyInputRounding(e.target.value, amountSettings.inputRounding);
    if (v !== e.target.value) handleOccupancyRateChange(tempId, seasonIndex, pax, v);
  };

  /* One cell of the vehicle price grid. The value is a number, {free:true}, {na:true},
     or undefined for "never priced". The last case deletes the key rather than writing
     zero: an untouched cell has to read as an error, not as a gift, because everything
     is charged unless the item is genuinely free (architecture doc, D12). */
  const handleVehiclePriceChange = (tempId, seasonIdx, code, value) => {
    setItemsToSave(prev => prev.map(item => {
      if (item.tempId !== tempId) return item;
      const updatedSeasons = item.seasons.map((s, idx) => {
        if (idx !== seasonIdx) return s;
        const next = { ...(s.pricesByVehicle || {}) };
        const isState = typeof value === 'object' && value !== null;
        const isBlank = value === '' || value === null || value === undefined;
        if (isBlank) {
          delete next[code];
        } else if (isState) {
          next[code] = value;
        } else {
          const rounded = Number(applyInputRounding(String(value), amountSettings.inputRounding));
          next[code] = Number.isFinite(rounded) ? rounded : 0;
        }
        return { ...s, pricesByVehicle: next };
      });
      return { ...item, seasons: updatedSeasons };
    }));
  };

  const snapBandRate = (e, tempId, seasonIndex, bandId, writer) => {
    const v = applyInputRounding(e.target.value, amountSettings.inputRounding);
    if (v !== '' && v !== e.target.value) writer(tempId, seasonIndex, bandId, v);
  };

  const handleRemoveSeasonRow = (tempId, seasonIdx) => {
    setItemsToSave(prev => prev.map(item => {
      if (item.tempId === tempId && item.seasons.length > 1) {
        return {
          ...item,
          seasons: item.seasons.filter((_, idx) => idx !== seasonIdx)
        };
      }
      return item;
    }));
    /* Keep the carousel on a row that still exists. */
    setActiveSeasonByItem(prev => {
      const current = Number.isInteger(prev[tempId]) ? prev[tempId] : 0;
      const total = Math.max(1, (itemsToSave.find(i => i.tempId === tempId)?.seasons?.length || 2) - 1);
      const next = Math.min(current > seasonIdx ? current - 1 : current, total - 1);
      return { ...prev, [tempId]: Math.max(0, next) };
    });
  };

  /* Which season of an item the Seasonal Rates Matrix is showing. Kept per item
     so editing several items in one batch never fights over the same index. */
  const activeSeasonIndexOf = (tempId, seasons) => {
    const total = (seasons || []).length;
    if (total <= 1) return 0;
    const raw = activeSeasonByItem[tempId];
    return Number.isInteger(raw) && raw >= 0 && raw < total ? raw : 0;
  };

  const stepActiveSeason = (tempId, seasons, delta) => {
    const total = (seasons || []).length;
    if (total <= 1) return;
    setActiveSeasonByItem(prev => {
      const current = activeSeasonIndexOf(tempId, seasons);
      return { ...prev, [tempId]: (current + delta + total) % total };
    });
  };

  /* Accommodation is edited room-first, then season-first: a room carries
     seasons, a season carries charge types. Passing a room key scopes the
     groups to that room; the room key is part of the identity so two rooms
     can use the same season name without merging. */
  const accommodationSeasonGroupsFor = (seasons, roomKey = '') => {
    const groups = [];
    const byKey = new Map();
    (seasons || []).forEach((season, index) => {
      if (roomKey && season.roomKey !== roomKey) return;
      const key = `${roomKey ? `${season.roomKey || ''}|` : ''}${season.seasonName || ''}|${season.validFrom || ''}|${season.validTo || ''}`;
      if (!byKey.has(key)) {
        byKey.set(key, {
          key,
          roomKey: season.roomKey || '',
          seasonName: season.seasonName,
          validFrom: season.validFrom,
          validTo: season.validTo,
          memberIndices: []
        });
        groups.push(byKey.get(key));
      }
      byKey.get(key).memberIndices.push(index);
    });
    return groups;
  };

  /* The charge type of a group currently being edited: the remembered one when
     it still belongs to that season, otherwise the season's first charge type. */
  const activeChargeIndexOf = (tempId, group) => {
    const raw = activeChargeByItem[tempId];
    if (group && Number.isInteger(raw) && group.memberIndices.includes(raw)) return raw;
    return group?.memberIndices?.[0] ?? 0;
  };

  /* Editing the season name / dates edits EVERY charge type of that season, so a
     season is retyped or redated once rather than once per board basis. */
  const handleSeasonGroupChange = (tempId, memberIndices, field, value) => {
    setItemsToSave(prev => prev.map(item => {
      if (item.tempId !== tempId) return item;
      const targets = new Set(memberIndices || []);
      const first = item.seasons[(memberIndices || [])[0]];
      const oldKey = first ? feeSeasonKey(first.seasonName, first.validFrom, first.validTo) : '';
      const next = first ? { ...first, [field]: clampNonNegative(value) } : null;
      const newKey = next ? feeSeasonKey(next.seasonName, next.validFrom, next.validTo) : '';
      /* A fee amount is keyed by its season's name and window. Retyping either
         moves the figure with the season, otherwise the save would read the new
         key, find no amount, and drop a fee the operator never touched. The
         child figure rides along in its own map and has to move with it. */
      const linkedFees = oldKey && newKey && oldKey !== newKey
        ? (item.linkedFees || []).map((fee) => {
            const amounts = moveFeeAmount(fee.amounts, oldKey, newKey);
            const childAmounts = moveFeeAmount(fee.childAmounts, oldKey, newKey);
            if (amounts === fee.amounts && childAmounts === fee.childAmounts) return fee;
            return { ...fee, amounts, childAmounts };
          })
        : item.linkedFees;
      return {
        ...item,
        linkedFees,
        seasons: item.seasons.map((s, idx) => (targets.has(idx) ? { ...s, [field]: clampNonNegative(value) } : s))
      };
    }));
  };

  /* Add a charge type to an EXISTING season: a fresh rate row that copies the
     season's name and window and starts at zero, so the operator only types the
     board basis and its prices. */
  const handleAddChargeToSeason = (tempId, group, optionName = '') => {
    if (!group) return;
    setItemsToSave(prev => prev.map(item => {
      if (item.tempId !== tempId) return item;
      return {
        ...item,
        seasons: [
          ...item.seasons,
          {
            seasonName: group.seasonName || 'Base Season',
            optionName: (optionName || '').trim(),
            roomKey: group.roomKey || '',
            validFrom: group.validFrom || '',
            validTo: group.validTo || '',
            ...emptySeasonMoney()
          }
        ]
      };
    }));
  };

  /* Remove a whole season: every charge type it carries. */
  const handleRemoveSeasonGroup = (tempId, group) => {
    if (!group || group.memberIndices.length === 0) return;
    const targets = new Set(group.memberIndices);
    setItemsToSave(prev => prev.map(item => {
      if (item.tempId !== tempId) return item;
      const seasons = item.seasons.filter((_, idx) => !targets.has(idx));
      return { ...item, seasons: seasons.length ? seasons : item.seasons };
    }));
    setActiveSeasonByItem(prev => {
      const current = Number.isInteger(prev[tempId]) ? prev[tempId] : 0;
      const remaining = itemsToSave.find(i => i.tempId === tempId)?.seasons.length || 0;
      const total = Math.max(1, remaining - group.memberIndices.length);
      return { ...prev, [tempId]: Math.max(0, Math.min(current, total - 1)) };
    });
  };

  /* Park fees / conservation levies typed on the accommodation. Each row becomes
     a linked Fees & Tickets library item on save, so the itinerary still prices
     the fee on its own line and brings it along with the property. The fee's
     terms are shared; its amount is entered season by season. */
  const handleAddLinkedFee = (tempId) => {
    setItemsToSave((prev) => prev.map((item) => (
      item.tempId === tempId
        ? {
            ...item,
            linkedFees: [
              ...(item.linkedFees || []),
              {
                key: `fee_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
                dbId: null,
                name: '',
                type: 'entrance_fee',
                chargeBasis: 'once_off',
                unitBasis: 'per_person',
                chargeable: true,
                amount: '',
                amounts: {},
                childAmounts: {}
              }
            ]
          }
        : item
    )));
  };

  const handleRemoveLinkedFee = (tempId, feeKey) => {
    setItemsToSave((prev) => prev.map((item) => (
      item.tempId === tempId
        ? { ...item, linkedFees: (item.linkedFees || []).filter((fee) => fee.key !== feeKey) }
        : item
    )));
  };

  const handleLinkedFeeChange = (tempId, feeKey, field, value) => {
    setItemsToSave((prev) => prev.map((item) => {
      if (item.tempId !== tempId) return item;
      return {
        ...item,
        linkedFees: (item.linkedFees || []).map((fee) => {
          if (fee.key !== feeKey) return fee;
          if (field === 'type') {
            /* An entrance fee has no per-child figure, so switching the type
               must not leave a basis behind that would price as zero. */
            const unitBasis = isValidUnitBasis({ surcharge_type: value }, fee.unitBasis)
              ? fee.unitBasis
              : 'per_person';
            return { ...fee, type: value, unitBasis };
          }
          return { ...fee, [field]: value };
        })
      };
    }));
  };

  /* One fee amount for one season. A blank box means the fee is not charged in
     that season; the other seasons keep their own figures. `map` is which
     figure of the fee is being edited - the visitor amount, or the child amount
     a property that splits its gate price by age charges instead. */
  const handleLinkedFeeAmountChange = (tempId, feeKey, seasonKey, value, map = 'amounts') => {
    setItemsToSave((prev) => prev.map((item) => {
      if (item.tempId !== tempId) return item;
      return {
        ...item,
        linkedFees: (item.linkedFees || []).map((fee) => (
          fee.key === feeKey
            ? { ...fee, [map]: { ...(fee[map] || {}), [seasonKey]: clampNonNegative(value) } }
            : fee
        ))
      };
    }));
  };

  /* The list column shows the same one-season-at-a-time view, but it is a
     different surface from the edit form: the rows are keyed by the saved item id
     rather than a form tempId, so the two views keep their own position instead of
     sharing one index. A supplier with many seasons would otherwise push the
     directory hundreds of pixels down for a figure that is only a few lines tall. */
  const activeListSeasonIndex = (itemId, seasons) => {
    const total = (seasons || []).length;
    if (total <= 1) return 0;
    const raw = activeSeasonByListItem[itemId];
    return Number.isInteger(raw) && raw >= 0 && raw < total ? raw : 0;
  };

  const stepListSeason = (itemId, seasons, delta) => {
    const total = (seasons || []).length;
    if (total <= 1) return;
    setActiveSeasonByListItem(prev => {
      const current = activeListSeasonIndex(itemId, seasons);
      return { ...prev, [itemId]: (current + delta + total) % total };
    });
  };

  // Submit All Batch Items (along with new Supplier if supplierMode === 'new' or if supplier not yet saved)
  const handleSubmitAllItems = async (e) => {
    e.preventDefault();

    /* A property's locality is its supplier's city, so an accommodation item is
       not asked for one it would only duplicate. A hire names its country, so
       the refusal says which box to fill rather than pointing at a town. */
    const supplierLocality = supplierDestination();
    const missingDestination = itemsToSave.find((item) => (
      /accommodation/i.test(String(item.category || ''))
        ? !supplierLocality && !String(item.destinationRegion || '').trim()
        : !String(item.destinationRegion || '').trim()
    ));
    if (missingDestination) {
      showToast(
        /accommodation/i.test(String(missingDestination.category || ''))
          ? 'A destination is required: set the supplier city or fill Destination / Locality'
          : (isCarRentalCategory(missingDestination.category)
            ? 'A hire needs its country — one price list covers it, so the country the car is picked up in goes in Country / Territory'
            : 'A destination is required: fill Destination / Locality'),
        'warning'
      );
      return;
    }
    const missingAccommodationArea = itemsToSave.find(
      (item) => /accommodation/i.test(String(item.category || '')) && !String(item.destinationArea || '').trim()
    );
    if (missingAccommodationArea) {
      showToast('Destination Area is required for every accommodation Library Item', 'warning');
      return;
    }

    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const companyId = await resolveCompanyId(user);

      let targetSupplierId = selectedSupplierId;

      // If creating a NEW supplier inline (or supplier hasn't been saved yet)
      if (supplierMode === 'new' || (!targetSupplierId && supplierForm.name.trim())) {
        if (!supplierForm.name.trim()) {
          showToast('Supplier Name is required to save library items', 'warning');
          return;
        }

        const newSupPayload = {
          company_id: companyId,
          name: supplierForm.name.trim(),
          category: itemsToSave[0]?.category || 'Accommodation',
          contact_person: supplierForm.contactPerson,
          email: supplierForm.email,
          phone: supplierForm.phone,
          website: supplierForm.website,
          address: supplierForm.address,
          physical_address: supplierForm.address,
          country: supplierForm.country,
          province_state: supplierForm.provinceState,
          city: supplierForm.city,
          city_location: supplierForm.city || supplierForm.provinceState,
          bank_name: supplierForm.bankName,
          account_holder_name: supplierForm.accountHolderName,
          bank_account_number: supplierForm.bankAccountNumber,
          branch_code: supplierForm.branchCode,
          swift_code: supplierForm.swiftCode,
          ...(starColumnReady ? { star_rating: starRatingOf(supplierForm.starRating) } : {})
        };

        const { data: createdSup, error: supErr } = await supabase
          .from('suppliers')
          .insert([newSupPayload])
          .select()
          .single();

        if (supErr) throw supErr;

        targetSupplierId = createdSup.id;
        setSuppliers(prev => [...prev, createdSup]);
        setSelectedSupplierId(createdSup.id);
        setSupplierMode('existing');
        showToast(`Supplier "${createdSup.name}" created and saved to Suppliers Directory!`, 'success');
      }

      if (!targetSupplierId) {
        showToast('Please select or create a supplier first', 'warning');
        return;
      }

      // Check if item names are populated
      for (let i = 0; i < itemsToSave.length; i++) {
        if (!itemsToSave[i].name.trim()) {
          showToast(`Library Item ${i + 1} requires a name`, 'warning');
          return;
        }
        if (roomsReady && itemsToSave[i].category === 'Accommodation') {
          const roomNames = (itemsToSave[i].roomTypes || [])
            .map(room => String(room.name || '').trim())
            .filter(Boolean);
          if (!roomNames.length) {
            showToast(`Accommodation Item ${i + 1} requires at least one room type`, 'warning');
            return;
          }
          if (new Set(roomNames.map(name => name.toLowerCase())).size !== roomNames.length) {
            showToast(`Accommodation Item ${i + 1} has two room types with the same name`, 'warning');
            return;
          }
          /* A villa on the occupancy ladder is only quotable at a party size it
             has a price for. Save the ladder complete, or the itinerary refuses
             that party later with no explanation the operator ever gave it. */
          if (dbFeatures.occupancyPricing) {
            const roomRows = (itemsToSave[i].roomTypes || [])
              .filter(room => String(room.name || '').trim());
            for (const seasonRow of itemsToSave[i].seasons || []) {
              const room = roomRows.find(entry => entry.key === seasonRow.roomKey) || roomRows[0] || null;
              if (!isOccupancyRoom(room, itemsToSave[i])) continue;
              const ladder = occupancyLadderFromEdit(occupancySizesForRoom(room), seasonRow);
              const problem = occupancyLadderError(
                { occupancy_rates: ladder },
                Math.max(1, parseInt(room.maxOccupancy, 10) || 2)
              );
              if (problem) {
                const charge = seasonRow.optionName ? ` / ${seasonRow.optionName}` : '';
                showToast(`Accommodation Item ${i + 1}, ${room.name} — ${seasonRow.seasonName || 'Base Season'}${charge}: ${problem}`, 'warning');
                return;
              }
            }
          }
        }
        if (itemsToSave[i].category === 'Transfers' && dbFeatures.transferType && !itemsToSave[i].transferType) {
          showToast(`Transfer Item ${i + 1} requires a Transfer Type`, 'warning');
          return;
        }
        if (itemsToSave[i].category === 'Activities / Tours' && dbFeatures.tourType && !itemsToSave[i].tourType) {
          showToast(`Activity / Tour Item ${i + 1} requires a Tour Type`, 'warning');
          return;
        }
        if (isTransportCategory(itemsToSave[i].category) && dbFeatures.transportType && !itemsToSave[i].transportType) {
          showToast(`Transport Item ${i + 1} requires a Transport Type`, 'warning');
          return;
        }
        /* Only a transfer has to name its vehicle. An activity is bought for the
           thing that happens, and a boat trip, a quad tour or a park walk is not a
           road vehicle, so requiring the label blocked saves of real tours. */
        if (itemsToSave[i].category === 'Transfers' && !itemsToSave[i].vehicleType) {
          showToast(`Transfers Item ${i + 1} requires a Vehicle Type`, 'warning');
          return;
        }
        if (isCarRentalCategory(itemsToSave[i].category)) {
          const groups = itemsToSave[i].carGroups || [];
          if (groups.length === 0) {
            showToast(`Car Rental Item ${i + 1} requires at least one Vehicle Group`, 'warning');
            return;
          }
          for (const g of groups) {
            if (!(g.vehicleGroup || '').trim()) {
              showToast(`Car Rental Item ${i + 1}: every group requires a Vehicle Group (e.g. "C")`, 'warning');
              return;
            }
            if (!(g.vehicleName || '').trim()) {
              showToast(`Car Rental Item ${i + 1}: every group requires a Vehicle name (e.g. "Toyota Starlet")`, 'warning');
              return;
            }
            if (!(g.rateCode || '').trim()) {
              showToast(`Car Rental Item ${i + 1}: every group requires a Contract Type (e.g. "Classic Max (CM)")`, 'warning');
              return;
            }
            /* A short-let contract with three bands is a real contract, so the
               editor no longer insists on four. What it does insist on is a band
               somebody can price from: without one the drop has nothing to
               multiply and the hire cannot be quoted. */
            const seasons = g.seasons?.length ? g.seasons : [createCarRentalSeason()];
            const windows = new Set();
            for (let sIdx = 0; sIdx < seasons.length; sIdx += 1) {
              const s = seasons[sIdx];
              const from = (s.validFrom || '').trim();
              const to = (s.validTo || '').trim();
              const named = `${from}→${to}`;
              if (windows.has(named)) {
                showToast(`Car Rental Item ${i + 1}: group "${g.vehicleGroup}" has two seasons with the same Rental Price Validity, which would be quoted as one tariff. Give them different weeks.`, 'warning');
                return;
              }
              windows.add(named);
              if (from && to && to < from) {
                showToast(`Car Rental Item ${i + 1}: group "${g.vehicleGroup}" season ${sIdx + 1} ends before it starts, so no pick-up date could ever price from it.`, 'warning');
                return;
              }
              /* One season may leave its window blank — that is the whole-contract
                 tariff the editor has always allowed. Two seasons have to say which
                 weeks each of them speaks for, or the pick-up date cannot answer
                 which money the car is hired at. */
              if (seasons.length > 1 && !from && !to) {
                showToast(`Car Rental Item ${i + 1}: group "${g.vehicleGroup}" season ${sIdx + 1} names no Rental Price Validity. A group sold across several seasons has to say which weeks each season covers.`, 'warning');
                return;
              }
              const filledRanges = (s.ranges || []).filter(r => (r.minDays || '') !== '' && (parseFloat(r.price) || 0) > 0);
              if (filledRanges.length < 1) {
                showToast(`Car Rental Item ${i + 1}: group "${g.vehicleGroup}" season ${sIdx + 1} needs at least one rental-length band with a daily price`, 'warning');
                return;
              }
              /* A band with a length and no money is a car hired for nothing, and one
                 with money and no length prices no hire at all. Either is a hole in the
                 contract rather than a box left for later, so the save names the band
                 that is unfinished instead of writing it. */
              const halfTyped = (s.ranges || []).find(r => (
                ((r.minDays || '') !== '' && (r.price || '') === '')
                || ((r.price || '') !== '' && (r.minDays || '') === '')
              ));
              if (halfTyped) {
                const band = `${halfTyped.minDays || '?'}–${halfTyped.maxDays || '∞'} days`;
                showToast(`Car Rental Item ${i + 1}: group "${g.vehicleGroup}" season ${sIdx + 1} has a ${band} band that is only half filled — ${halfTyped.price === '' || !halfTyped.price ? 'it has no daily price, which would hire that car for nothing' : 'it has no rental length, so no hire can ever be priced from it'}. Finish it or remove it.`, 'warning');
                return;
              }
            }
          }
        }
      }

      // Save all Library Items
      for (const itemData of itemsToSave) {
        /* A property's headline capacity is the widest room it sells. The
           itinerary allocates travellers into room types, but the library row
           still has to answer "how many can this place take" for the list and
           for older pricing paths. */
        const roomList = (itemData.category === 'Accommodation' && roomsReady ? (itemData.roomTypes || []) : [])
          .filter(room => String(room.name || '').trim());
        const roomCapacity = roomList.length
          ? (() => {
              const widest = Math.max(...roomList.map(room => Math.max(1, parseInt(room.maxOccupancy) || 1)));
              const stated = roomList.map(room => parseInt(room.maxChildren, 10)).filter(Number.isFinite);
              return {
                maxOccupancy: widest,
                maxAdults: Math.max(...roomList.map(room => Math.max(1, parseInt(room.maxAdults) || 1))),
                /* A room with no child cap takes a child in any bed, so the
                   property headline says so too. Reporting 0 here would read as
                   "this lodge takes no children". */
                maxChildren: stated.length < roomList.length ? widest : Math.max(0, ...stated)
              };
            })()
          : null;
        const maxOcc = roomCapacity?.maxOccupancy || Math.max(1, parseInt(itemData.maxOccupancy) || 2);
        const maxAdults = Math.min(maxOcc, roomCapacity?.maxAdults || Math.max(1, parseInt(itemData.maxAdults) || maxOcc));
        const sharingRules = itemData.sharingCapacityRules || ensureSharingRules(maxAdults, maxOcc, []);
        const maxChildren = roomCapacity
          ? roomCapacity.maxChildren
          : (sharingRules.length > 0 ? Math.max(...sharingRules.map(r => parseInt(r.maxChildren) || 0)) : 0);
        const isTourStyle = isTourStyleCategory(itemData.category);
        const isFlight = isFlightCategory(itemData.category);
        const isMeals = isMealsCategory(itemData.category);
        const isExtras = isExtrasCategory(itemData.category);
        const isCarRental = isCarRentalCategory(itemData.category);
        const isGuide = isGuideCategory(itemData.category);
        const isAccommodationItem = /accommodation/i.test(String(itemData.category || ''));
        const itemLocality = isAccommodationItem
          ? (supplierLocality || String(itemData.destinationRegion || '').trim())
          : String(itemData.destinationRegion || '').trim();
        const pricingModel = isTourStyle
          ? (itemData.pricingModel || (itemData.category === 'Flights / Charter' ? 'per_person' : 'per_vehicle'))
          : (itemData.category === 'Accommodation' || isTrainCategory(itemData.category)
            ? (itemData.pricingModel || 'per_person')
            : (isCarRental
              ? 'per_vehicle'
              : (isExtras ? (itemData.pricingModel === 'per_unit' ? 'per_unit' : 'per_person') : 'per_person')));

        const itemPayload = {
          company_id: companyId,
          supplier_id: targetSupplierId,
          name: itemData.name,
          destination_region: itemLocality,
          /* An accommodation area is the group-split key, so it is mandatory
             there. A hire's area is only the town its country price does not
             cover, so it is stored when typed and NULL when left blank — which
             is exactly "the whole country costs the same". */
          destination_area: (isAccommodationItem || isCarRental)
            ? String(itemData.destinationArea || '').trim()
            : null,
          category: itemData.category,
          sub_category: itemData.category === 'Transfers' ? (itemData.vehicleType || itemData.category) : itemData.category,
          transfer_type: itemData.category === 'Transfers' && dbFeatures.transferType ? (itemData.transferType || null) : null,
          tour_type: itemData.category === 'Activities / Tours' && dbFeatures.tourType ? (itemData.tourType || null) : null,
          transport_type: isTransportCategory(itemData.category) && dbFeatures.transportType ? (itemData.transportType || null) : null,
          /* A tour that runs for one guest says so by leaving this blank, so an
             empty field writes NULL rather than a zero someone has to read. */
          ...(dbFeatures.minPaxToRun
            ? { min_pax_to_run: itemData.category === 'Activities / Tours' ? (minPaxToRunOf(itemData) || null) : null }
            : {}),
          ...(itemData.category === 'Flights / Charter'
            ? {
                flight_number: itemData.flightNumber || null,
                airline_name: itemData.airlineName || null,
                departure_city: itemData.departureCity || null,
                arrival_city: itemData.arrivalCity || null,
                /* Gated on the probe: a workspace without the column would have
                   the whole flight payload rejected. */
                ...(dbFeatures.staffOptions ? { guide_flight_offered: !!itemData.guideFlightOffered } : {})
              }
            : {}),
          ...(isTrainCategory(itemData.category)
            ? {
                train_departure_date: itemData.trainDepartureDate || null,
                train_journey_nights: parseInt(itemData.trainJourneyNights) || 0,
                train_cabin_name: itemData.trainCabinName || null
              }
            : {}),
          ...(isTicketCategory(itemData.category)
            ? { ticket_type: itemData.ticketType || 'standard' }
            : {}),
          /* A hire contract with no admin fee typed is a contract that charges
             none, so a blank writes NULL rather than a zero that looks priced. */
          ...(isCarRental && dbFeatures.rentalContractFee
            ? { rental_contract_fee: moneyOrNull(itemData.rentalContractFee) }
            : {}),
          ...(itemData.category === 'Meals'
            ? {
                meal_type: itemData.mealType || 'Breakfast',
                menu_type: itemData.menuType || 'a_la_carte',
                meal_gratuity_percent: parseFloat(itemData.mealGratuityPercent) || 0,
                ...(dbFeatures.staffOptions ? {
                  guide_meal_offered: !!itemData.guideMealOffered,
                  driver_meal_offered: !!itemData.driverMealOffered
                } : {})
              }
            : {}),
          ...(isDriverEligibleCategory(itemData.category) && dbFeatures.driverOption
            ? {
                driver_required: !!itemData.driverRequired,
                driver_meals: itemData.driverRequired ? ((itemData.driverMeals || []).join(',') || '') : '',
                driver_accommodation: !!(itemData.driverRequired && itemData.driverAccommodation)
              }
            : {}),
          ...(isGuide
            ? {
                guide_meals: (itemData.guideMeals || []).join(',') || '',
                guide_accommodation: !!itemData.guideAccommodation
              }
            : {}),
          description: itemData.description,
          /* Sent only when a second language is switched on and the column
             exists. An English-only tenant's item saves carry no new key at all,
             so they behave exactly as they did before this column was added. */
          ...textI18nPayload(contentLanguages.length > 1, itemData.textI18n),
          currency: itemData.currency,
          pricing_model: pricingModel,
          max_occupancy: maxOcc,
          max_adults: isTourStyle ? maxOcc : maxAdults,
          max_children: isTourStyle ? 0 : maxChildren,
          sharing_capacity_rules: isTourStyle ? [] : sharingRules,
          children_own_room_policy: itemData.childrenOwnRoomPolicy || 'child_rates',
          child_age_ranges: isTourStyle
            ? [{ id: 'child', name: `Child (up to ${parseInt(itemData.childAge) || 12} yrs)`, ageFrom: 0, ageTo: (parseInt(itemData.childAge) || 12) }]
            : (isExtras && pricingModel === 'per_unit' ? [] : (itemData.childAgeRanges || [])),
          images: itemData.imageUrls,
                ...(dbFeatures.guideDriver && itemData.category === 'Accommodation'
                  ? {
                      guide_driver_room_offered: !!itemData.guideDriverOffered,
                      ...(dbFeatures.guideMinRooms
                        ? { guide_min_rooms: Math.max(1, parseInt(itemData.guideMinRooms, 10) || 1) }
                        : {})
                    }
                  : {}),
                ...(itemData.category === 'Accommodation'
                  ? { tour_leader_room_offered: !!itemData.tourLeaderRoomOffered, tour_leader_min_rooms: parseInt(itemData.tourLeaderMinRooms) || 1 }
                  : {}),
          ...(dbFeatures.feeType
            ? {
                /* Base categories no longer carry a bundled fee: entrance fees
                   and conservation levies are separate Fees & Tickets items, so
                   the legacy switch is pinned off for everything else. */
                fee_type: 'none',
                conservation_levy_basis: 'per_night'
              }
            : {}),
          ...(dbFeatures.surchargeFees && isSurchargeItem(itemData)
            ? {
                surcharge_type: itemData.surchargeType || 'entrance_fee',
                surcharge_charge_basis: CHARGE_BASIS.some((b) => b.id === itemData.surchargeChargeBasis)
                  ? itemData.surchargeChargeBasis
                  : 'once_off',
                surcharge_unit_basis: UNIT_BASES.some((b) => b.id === itemData.surchargeUnitBasis)
                  ? itemData.surchargeUnitBasis
                  : 'per_person',
                surcharge_chargeable: itemData.surchargeChargeable !== false,
                linked_item_id: itemData.linkedItemId || null
              }
            : {}),
          ...(dbFeatures.contracts && (itemData.contractUrl || itemData.contractName)
            ? { contract_url: itemData.contractUrl || null, contract_name: itemData.contractName || null }
            : {})
        };

        // Determine target row: update existing (edit mode) or insert new
        const editingDbId = editingItems[itemData.tempId];
        let targetItemId;

        if (editingDbId) {
          const { data: updatedItem, error: itemErr } = await supabase
            .from('library_items')
            .update(itemPayload)
            .eq('id', editingDbId)
            .select()
            .single();

          if (itemErr) throw itemErr;
          targetItemId = updatedItem?.id || editingDbId;

          // Freshly replace all season rates for the edited item
          const { error: delErr } = await supabase
            .from('item_rates')
            .delete()
            .eq('item_id', targetItemId);

          if (delErr) throw delErr;

          // Freshly replace car rental rates for the edited item
          const { error: delCarErr } = await supabase
            .from('car_rental_rates')
            .delete()
            .eq('item_id', targetItemId);

          if (delCarErr) throw delCarErr;
        } else {
          const { data: newItem, error: itemErr } = await supabase
            .from('library_items')
            .insert([itemPayload])
            .select()
            .single();

          if (itemErr) throw itemErr;
          targetItemId = newItem.id;
        }

        /* Room types are synced before the rates so every rate row can point at
           the row it prices. Editing removes the rooms the operator deleted
           (their rates were just replaced) and updates the rest in place, so an
           itinerary line keeps the room id it was sold with. */
        const roomIdByKey = new Map();
        if (roomList.length) {
          if (editingDbId) {
            const { data: existingRooms, error: existingRoomsErr } = await supabase
              .from('library_item_room_types')
              .select('id')
              .eq('item_id', targetItemId);
            if (existingRoomsErr) throw existingRoomsErr;
            const keepIds = roomList.map(room => room.id).filter(Boolean);
            const staleIds = (existingRooms || [])
              .map(room => room.id)
              .filter(id => !keepIds.includes(id));
            if (staleIds.length) {
              const { error: staleRoomsErr } = await supabase
                .from('library_item_room_types')
                .delete()
                .in('id', staleIds);
              if (staleRoomsErr) throw staleRoomsErr;
            }
          }

          for (let roomIndex = 0; roomIndex < roomList.length; roomIndex += 1) {
            const room = roomList[roomIndex];
            const occupancy = Math.max(1, parseInt(room.maxOccupancy) || 1);
            const roomPayload = {
              company_id: companyId,
              item_id: targetItemId,
              name: String(room.name).trim(),
              description: String(room.description || '').trim() || null,
              max_occupancy: occupancy,
              max_adults: Math.min(occupancy, Math.max(1, parseInt(room.maxAdults) || occupancy)),
              max_children: childCapPayload(room, occupancy),
              ...(dbFeatures.occupancyPricing
                ? { pricing_model: roomPricingModelOf(room, itemData) }
                : {}),
              sort_order: roomIndex,
              is_active: true
            };
            if (room.id) {
              const { error: roomErr } = await supabase
                .from('library_item_room_types')
                .update(roomPayload)
                .eq('id', room.id);
              if (roomErr) throw roomErr;
              roomIdByKey.set(room.key || room.id, room.id);
            } else {
              const { data: insertedRoom, error: roomErr } = await supabase
                .from('library_item_room_types')
                .insert([roomPayload])
                .select('id')
                .single();
              if (roomErr) throw roomErr;
              roomIdByKey.set(room.key, insertedRoom.id);
            }
          }
        }

        // Insert Seasons Pricing Matrices (Car Rental uses its own group-based rates below)
        if (!isCarRental && itemData.seasons.length > 0) {
          const ratesPayload = itemData.seasons.map(s => {
            /* A fee row carries its own figure and nothing else. The adult,
               child and room columns stay null on purpose: they are not read by
               the fee engine, so a stray or legacy number in one of them would
               make an unpriced fee look priced, and a "per adult"/"per unit"
               fee would fall through to it as a hidden fallback. */
            if (isSurchargeItem(itemData)) {
              return {
                item_id: targetItemId,
                option_name: s.seasonName || 'Base Season',
                season_name: s.seasonName || 'Base Season',
                meal_plan: null,
                currency: itemData.currency,
                valid_from: s.validFrom || null,
                valid_to: s.validTo || null,
                price_1_adult: null,
                price_2_adults: null,
                price_3_plus_adults: null,
                child_rates_breakdown: {},
                single_supplement: null,
                child_discount: null,
                single_room_rate: null,
                double_twin_rate: null,
                effective_single_rate: null,
                rate_basis: 'per_person',
                child_sharing_policy: '',
                unit_price: null,
                ...(dbFeatures.feeType ? surchargeRateFees(itemData, s, { feeChildRate: dbFeatures.feeChildRate }) : {}),
                /* The guide's own place at the gate. A fee that buys a thing (a
                   unit, a vehicle) sells no head, so nothing is written and a
                   figure left over from a per-person basis cannot be read back. */
                ...(dbFeatures.guideDriver && feeBasisChargesHeads(itemData.surchargeUnitBasis || 'per_person')
                  ? { guide_rate: moneyOrNull(s.guideRate) }
                  : {})
              };
            }
            if (isGuide) {
              return {
                item_id: targetItemId,
                option_name: s.seasonName || 'Base Season',
                season_name: s.seasonName || 'Base Season',
                meal_plan: null,
                currency: itemData.currency,
                valid_from: s.validFrom || null,
                valid_to: s.validTo || null,
                price_1_adult: null,
                price_2_adults: null,
                price_3_plus_adults: null,
                child_rates_breakdown: {},
                single_supplement: null,
                child_discount: null,
                single_room_rate: null,
                double_twin_rate: null,
                effective_single_rate: null,
                rate_basis: 'per_trip',
                child_sharing_policy: '',
                unit_price: null,
                guide_transfer_rate: moneyOrNull(s.guideTransferRate),
                guide_half_day_rate: moneyOrNull(s.guideHalfDayRate),
                guide_full_day_rate: moneyOrNull(s.guideFullDayRate),
                guide_overland_rate: moneyOrNull(s.guideOverlandRate),
                guide_dinner_rate: moneyOrNull(s.guideDinnerRate)
              };
            }
            if (isMeals) {
              const adultRate = moneyOrNull(s.adultRate);
              const childRate = childEntry(s.childRate);
              return {
                item_id: targetItemId,
                option_name: s.seasonName || 'Base Season',
                season_name: s.seasonName || 'Base Season',
                meal_plan: null,
                currency: itemData.currency,
                valid_from: s.validFrom || null,
                valid_to: s.validTo || null,
                price_1_adult: adultRate,
                price_2_adults: null,
                price_3_plus_adults: null,
                child_rates_breakdown: childRate !== null ? { child: childRate } : {},
                single_supplement: null,
                child_discount: null,
                single_room_rate: null,
                double_twin_rate: null,
                effective_single_rate: null,
                rate_basis: 'per_person',
                child_sharing_policy: '',
                unit_price: adultRate,
                guide_rate: moneyOrNull(s.guideRate),
                driver_rate: moneyOrNull(s.driverRate)
              };
            }
            if (isExtras) {
              const adultRate = moneyOrNull(s.adultRate);
              /* A per-unit extra sells the service, not a seat on it: the figure
                 is charged once however many guests take it, so it is stored on
                 the flat basis the pricing engines divide across the party. */
              const extrasBasis = pricingModel === 'per_unit' ? 'per_unit' : 'per_person';
              const childRate = extrasBasis === 'per_unit' ? null : childEntry(s.childRate);
              return {
                item_id: targetItemId,
                option_name: s.seasonName || 'Base Season',
                season_name: s.seasonName || 'Base Season',
                /* The charge name rides on meal_plan, the column a board basic
                   occupies for a room; blank means this row is the item's default charge. */
                meal_plan: (s.optionName || '').trim() || null,
                currency: itemData.currency,
                valid_from: s.validFrom || null,
                valid_to: s.validTo || null,
                price_1_adult: adultRate,
                price_2_adults: null,
                price_3_plus_adults: null,
                child_rates_breakdown: childRate !== null ? { child: childRate } : {},
                single_supplement: null,
                child_discount: null,
                single_room_rate: null,
                double_twin_rate: null,
                effective_single_rate: null,
                rate_basis: extrasBasis,
                child_sharing_policy: '',
                unit_price: adultRate
              };
            }
            if (isTourStyle) {
              const isPerVehicle = pricingModel === 'per_vehicle';
              const vehiclePrices = (dbFeatures.pricesByVehicle && isPerVehicle && s.pricesByVehicle) || {};
              /* The two legacy single-price columns still have to hold something, because
                 they are the only ones quotes read today. They take the cheapest vehicle
                 that is actually priced; a vector nobody has priced yet stays at zero and
                 blocks rather than silently selling a free vehicle. */
              const pricedVector = Object.values(vehiclePrices).filter(p => typeof p === 'number' && p > 0);
              const typedAdult = moneyOrNull(s.adultRate);
              const adultRate = typedAdult !== null ? typedAdult : (pricedVector.length ? Math.min(...pricedVector) : null);
              const vehicleRate = parseFloat(s.vehicleRate) || 0;
              const childRate = childEntry(s.childRate);
              const isTiered = pricingModel === 'tiered';
              const tiers = Array.isArray(s.tiers) ? s.tiers
                .filter(t => t && (parseFloat(t.rate) > 0))
                .map(t => ({ min_pax: parseInt(t.minPax) || 0, max_pax: parseInt(t.maxPax) || 0, rate: parseFloat(t.rate) || 0 }))
                : [];
              return {
                item_id: targetItemId,
                option_name: s.seasonName || 'Base Season',
                season_name: s.seasonName || 'Base Season',
                meal_plan: null,
                currency: itemData.currency,
                valid_from: s.validFrom || null,
                valid_to: s.validTo || null,
                price_1_adult: !isTiered ? adultRate : null,
                price_2_adults: null,
                price_3_plus_adults: null,
                child_rates_breakdown: childRate !== null ? { child: childRate } : {},
                single_supplement: null,
                child_discount: null,
                single_room_rate: null,
                double_twin_rate: null,
                effective_single_rate: null,
                rate_basis: isPerVehicle ? 'per_vehicle' : (isTiered ? 'tiered' : 'per_person'),
                child_sharing_policy: '',
                unit_price: isPerVehicle ? adultRate : null,
                ...(dbFeatures.pricesByVehicle && isPerVehicle ? { prices_by_vehicle: vehiclePrices } : {}),
                ...(dbFeatures.tieredPricing && isTiered ? { tiered_pricing: tiers } : {}),
                ...(dbFeatures.feeType
                  ? {
                      /* Only a Fees & Tickets item writes the fee columns, and only the
                      columns its own rate basis needs. Base categories no longer carry a
                      bundled fee at all. */
                      ...(surchargeRateFees(itemData, s))
                    }
                  : {}),
                ...(isFlight
                  ? {
                      taxes_and_surcharges: moneyOrNull(s.taxesAndSurcharges),
                      /* The guide's seat on this flight. Blank means the crew
                         pays the fare the clients pay. */
                      ...(dbFeatures.guideDriver ? { guide_rate: moneyOrNull(s.guideRate) } : {})
                    }
                  : {}),
                /* A touring guide who comes along is charged a place on the
                   activity from the same tariff, so the figure belongs to the
                   season beside the adult rate. Only an activity sells places
                   that way - a per-vehicle hire buys the vehicle, not heads. */
                ...(dbFeatures.guideDriver && itemData.category === 'Activities / Tours' && !isPerVehicle
                  ? { guide_rate: moneyOrNull(s.guideRate) }
                  : {})
              };
            }
            if (isTicketCategory(itemData.category)) {
              const adultRate = moneyOrNull(s.adultRate);
              const childRatesMap = s.childRates || {};
              const hasFastTrack = itemData.ticketType === 'both' || itemData.ticketType === 'fast_track';
              const fastTrackAdultRate = hasFastTrack ? moneyOrNull(s.fastTrackAdultRate) : null;
              const fastTrackChildRates = hasFastTrack ? (s.fastTrackChildRates || {}) : {};
              return {
                item_id: targetItemId,
                option_name: s.seasonName || 'Base Season',
                season_name: s.seasonName || 'Base Season',
                meal_plan: null,
                currency: itemData.currency,
                valid_from: s.validFrom || null,
                valid_to: s.validTo || null,
                price_1_adult: adultRate,
                price_2_adults: null,
                price_3_plus_adults: null,
                child_rates_breakdown: childRatesMap,
                fast_track_adult_rate: fastTrackAdultRate,
                fast_track_child_rates_breakdown: fastTrackChildRates,
                single_supplement: null,
                child_discount: null,
                single_room_rate: null,
                double_twin_rate: null,
                effective_single_rate: null,
                rate_basis: 'per_person',
                child_sharing_policy: 'by_age_range',
                unit_price: adultRate
              };
            }
            const rateRoom = roomList.find(entry => entry.key === s.roomKey) || roomList[0] || null;
            /* The room states its own contract, so one property can price its
               standard rooms per person sharing and its villas by occupancy. */
            const roomModel = roomPricingModelOf(rateRoom, itemData);
            const isFlatRoom = roomModel === 'per_room';
            const occupancyPriced = dbFeatures.occupancyPricing && roomModel === OCCUPANCY_BASIS;
            /* A disabled price box is not a price. If the room cannot take a
               second or third adult, or cannot take children, or has no weekend
               nights ticked, the row is written as "not offered" even if an
               older value is still sitting in form state. */
            const capacity = priceCapacityFor(itemData, rateRoom?.key || '');
            const canShare = capacity.maxAdults >= 2;
            const canTakeThirdAdult = capacity.maxAdults >= 3;
            const takesChildren = capacityTakesChildren(capacity);
            const weekendDays = weekendDaysOf(s);
            const roomRate = moneyOrNull(s.roomRate);
            /* A flat rate is quoted for the room, so it covers everyone who
               sleeps in it up to its occupancy. A party of one still occupies
               the whole room, which is why the flat mode needs a second figure:
               what one adult pays for the room to themselves. Older rows never
               had one, so they fall back to the room rate. */
            const flatSingleRate = moneyOrNull(s.singleRoomRate) ?? roomRate;
            const p1Adult = isFlatRoom ? flatSingleRate : moneyOrNull(s.price1Adult);
            const p2Adults = isFlatRoom ? roomRate : (canShare ? moneyOrNull(s.price2Adults) : null);
            /* The 3+ adult figure is whatever the operator typed, including 0 or
               blank. It used to fall back to the 2-adult rate whenever it was 0 or
               empty, which silently restored the old price on every save and made
               "this property does not take a third adult" impossible to record. A
               blank box is now stored as null (not offered); a typed 0 stays 0. */
            const p3PlusAdults = isFlatRoom ? roomRate : (canTakeThirdAdult ? moneyOrNull(s.price3PlusAdults) : null);
            const childRatesMap = isFlatRoom || !takesChildren ? {} : (s.childRates || {});
            const discount = isFlatRoom || !takesChildren ? null : moneyOrNull(s.childDiscount);
            /* A villa on the occupancy ladder is priced by its bands alone. The
               adult, child and supplement columns stay null so nothing on the row
               can be read as a price the contract never quoted. */
            const ladderSizes = occupancySizesForRoom(rateRoom);
            const occupancyLadder = occupancyPriced ? occupancyLadderFromEdit(ladderSizes, s) : null;
            const ladderAdult = occupancyPriced ? null : p1Adult;
            const ladderSharing = occupancyPriced ? null : p2Adults;
            const ladderThird = occupancyPriced ? null : p3PlusAdults;
            const tlTiers = tierLadderPayload(s.tourLeaderTiers);
            /* One crew ladder, saved into both columns: the pool is one contract,
               so the guide column and the driver column carry the same rows and
               every reader of either sees the same deal. */
            const crewTiers = tierLadderPayload(s.crewTiers);
            /* The rate card stores one waiver count and the optional ladder
               column carries it as a zero-supplement tier, so every pricing
               path reads the same rule. Zero waivers clears the ladder. The
               notes marker keeps the rule on a database without the column. */
            const waiverCount = !isFlatRoom && canShare
              ? Math.max(0, parseInt(s.singleSupplementWaiver, 10) || 0)
              : 0;
            const singleSuppTiers = waiverLadder(waiverCount);

            return {
              item_id: targetItemId,
              option_name: s.seasonName || 'Base Season',
              season_name: s.seasonName || 'Base Season',
              /* Each rate row's meal_plan is its charge option (room only, half
                 board, ...). Rows sharing a meal_plan form one option's season
                 matrix; a blank one falls back to the item's default board. */
              meal_plan: s.optionName || itemData.mealPlan,
              currency: itemData.currency,
              valid_from: s.validFrom || null,
              valid_to: s.validTo || null,
              price_1_adult: ladderAdult,
              price_2_adults: ladderSharing,
              price_3_plus_adults: ladderThird,
              child_rates_breakdown: childRatesMap,
              single_supplement: null,
              child_discount: discount,
              single_room_rate: ladderAdult,
              double_twin_rate: ladderSharing,
              effective_single_rate: ladderAdult,
              rate_basis: occupancyPriced
                ? OCCUPANCY_BASIS
                : (isFlatRoom ? 'per_room' : 'per_person_sharing'),
              ...(dbFeatures.occupancyPricing ? { occupancy_rates: occupancyLadder } : {}),
              child_sharing_policy: isFlatRoom ? 'room_rate_divided' : 'sharing_with_adults',
              unit_price: isFlatRoom ? roomRate : (occupancyPriced ? null : (p2Adults ?? p1Adult ?? null)),
              /* A room contracted at several nightly prices by length of stay:
                 the band rides on the row beside the charge type, so one room
                 is still one library item. Blank on both sides prices every
                 stay, which is what every older row means. */
              ...(dbFeatures.nightBands && itemData.category === 'Accommodation'
                ? { min_nights: wholeOrNull(s.minNights), max_nights: wholeOrNull(s.maxNights) }
                : {}),
              /* Weekend pricing is per NIGHT, not per stay: the picked weekdays
                 and the price those nights carry ride on the same rate row as
                 the normal figure, so the itinerary charges each night from its
                 own date without duplicating the room. */
              ...(dbFeatures.weekendRates && itemData.category === 'Accommodation'
                ? {
                    weekend_days: occupancyPriced || !weekendDays.length ? null : weekendDays,
                    weekend_price: occupancyPriced || !weekendDays.length ? null : moneyOrNull(s.weekendPrice)
                  }
                : {}),
                ...(dbFeatures.guideDriver && itemData.category === 'Accommodation'
                  ? {
                      guide_rate: moneyOrNull(s.guideRate),
                      driver_rate: moneyOrNull(s.driverRate),
                      ...(dbFeatures.guideDriverTiers
                        ? {
                            guide_tiers: crewTiers.length ? crewTiers : null,
                            driver_tiers: crewTiers.length ? crewTiers : null
                          }
                        : {})
                    }
                  : {}),
                ...(itemData.category === 'Accommodation'
                  ? {
                      tour_leader_rate: moneyOrZero(s.tourLeaderRate),
                      ...(dbFeatures.tourLeaderTiers ? { tour_leader_tiers: tlTiers.length ? tlTiers : null } : {}),
                      ...(dbFeatures.singleSupplementTiers
                        ? { single_supplement_tiers: !isFlatRoom && singleSuppTiers.length ? singleSuppTiers : null }
                        : {}),
                      ...(!isFlatRoom && waiverCount > 0 ? { notes: withWaiverNote(null, waiverCount) } : {})
                    }
                  : {}),
              ...(roomList.length
                ? (() => {
                    /* The rate belongs to one room type; its name and capacity
                       are copied onto the row so a package snapshot, a partner
                       quotation or a rate card can print the room without a
                       second lookup. */
                    const room = rateRoom;
                    const occupancy = Math.max(1, parseInt(room.maxOccupancy) || 1);
                    return {
                      room_type_id: roomIdByKey.get(room.key) || null,
                      room_type: room.name,
                      room_max_occupancy: occupancy,
                      room_max_adults: Math.min(occupancy, Math.max(1, parseInt(room.maxAdults) || occupancy)),
                      room_max_children: childCapPayload(room, occupancy)
                    };
                  })()
                : {}),
              ...(dbFeatures.guideDriver && itemData.category === 'Accommodation'
                ? { guide_meal_plan: s.guideMealPlan || itemData.mealPlan, driver_meal_plan: s.driverMealPlan || itemData.mealPlan }
                : {}),
              ...(dbFeatures.feeType
                ? surchargeRateFees(itemData, s)
                : {})
            };
          });

          const { error: ratesErr } = await supabase.from('item_rates').insert(ratesPayload);
          if (ratesErr) throw ratesErr;
        }

        /* Car hire: one row per (vehicle group × season × rental-length band), so
           the same group can be sold at other money in other weeks. The group's
           specs ride on every row because the vehicle is the same car all year; the
           window and the money come from the season the band belongs to. */
        if (isCarRental && Array.isArray(itemData.carGroups) && itemData.carGroups.length > 0) {
          const carRatesPayload = itemData.carGroups.flatMap(g => {
            const kmsUnlimited = g.kmsUnlimited !== false;
            const seasons = g.seasons?.length ? g.seasons : [createCarRentalSeason()];
            return seasons.flatMap(s => (s.ranges || []).map(r => ({
              item_id: targetItemId,
              vehicle_group: (g.vehicleGroup || '').trim(),
              vehicle_name: (g.vehicleName || '').trim(),
              rate_code: (g.rateCode || '').trim(),
              kms_unlimited: kmsUnlimited,
              kms_included: kmsUnlimited ? null : (parseFloat(g.kmsIncluded) || 0),
              luggage: parseInt(g.luggage) || 0,
              doors: parseInt(g.doors) || 0,
              max_passengers: parseInt(g.passengers) || 0,
              has_aircon: g.aircon !== false,
              gear: g.gear || 'automatic',
              fuel_type: g.fuelType || 'fuel',
              min_days: parseInt(r.minDays) || 0,
              max_days: r.maxDays === '' || r.maxDays == null ? null : (parseInt(r.maxDays) || 0),
              price: parseFloat(r.price) || 0,
              valid_from: s.validFrom || null,
              valid_to: s.validTo || null,
              currency: itemData.currency
            })));
          });

          if (carRatesPayload.length > 0) {
            const { error: carErr } = await supabase.from('car_rental_rates').insert(carRatesPayload);
            if (carErr) throw carErr;
          }
        }

        /* Park fees / conservation levies typed on the property. Each one is
           stored as a linked Fees & Tickets item so the itinerary prices it as
           its own line and carries it with the accommodation. The fee's terms
           are shared, but its amount belongs to one season: each priced season
           gets its own rate row, and the same season resolution that prices the
           room also finds the fee row that covers the trip. */
        if (itemData.category === 'Accommodation' && dbFeatures.surchargeFees && dbFeatures.feeType) {
          /* A fee follows the season, not the room: the same season priced for
             several rooms is still one season to the fee, so it gets one rate
             row per season window rather than one per room. */
          const seenSeasonKeys = new Set();
          const seasonGroups = accommodationSeasonGroupsFor(itemData.seasons).filter((group) => {
            const key = feeSeasonKey(group.seasonName, group.validFrom, group.validTo);
            if (seenSeasonKeys.has(key)) return false;
            seenSeasonKeys.add(key);
            return true;
          });
          const rateSeasons = seasonGroups.length
            ? seasonGroups
            : [{ seasonName: 'Base Season', validFrom: '', validTo: '' }];
          const keptFeeIds = [];

          for (const fee of itemData.linkedFees || []) {
            /* A blank amount means the fee is not charged in that season. Only
               priced seasons get a rate row; a fee with no priced season is not
               a fee at all, so a half-started row is dropped and an existing
               one is detached with the removed rows below. A typed 0 stays 0. */
            const amounts = fee.amounts && typeof fee.amounts === 'object' ? fee.amounts : null;
            const childAmounts = fee.childAmounts && typeof fee.childAmounts === 'object' ? fee.childAmounts : null;
            const pricedSeasons = rateSeasons
              .map((group) => {
                const key = feeSeasonKey(group.seasonName, group.validFrom, group.validTo);
                const raw = amounts
                  ? (Object.prototype.hasOwnProperty.call(amounts, key) ? amounts[key] : '')
                  : fee.amount;
                /* A child figure rides on the season's own row and never makes
                   one: a season with only a child amount is a season with no
                   fee, because nothing bills a child on its own. */
                const childRaw = childAmounts
                  ? (Object.prototype.hasOwnProperty.call(childAmounts, key) ? childAmounts[key] : '')
                  : '';
                return { group, amount: moneyOrNull(raw), childAmount: moneyOrNull(childRaw) };
              })
              .filter((entry) => entry.amount !== null);
            if (!pricedSeasons.length) continue;

            const feePayload = {
              company_id: companyId,
              /* A fee can be billed by a park authority rather than the property,
                 so an existing fee keeps its own supplier; only a fee created
                 from this form starts on the property's supplier. */
              ...(fee.dbId ? {} : { supplier_id: targetSupplierId }),
              name: String(fee.name || '').trim() || surchargeTypeLabel(fee.type),
              destination_region: itemLocality || 'Unknown',
              destination_area: String(itemData.destinationArea || '').trim() || null,
              category: SURCHARGE_CATEGORY,
              sub_category: SURCHARGE_CATEGORY,
              description: null,
              currency: itemData.currency,
              pricing_model: 'per_person',
              surcharge_type: fee.type || 'entrance_fee',
              surcharge_charge_basis: fee.chargeBasis === 'per_night' ? 'per_night' : 'once_off',
              surcharge_unit_basis: isValidUnitBasis({ surcharge_type: fee.type }, fee.unitBasis) ? fee.unitBasis : 'per_person',
              surcharge_chargeable: fee.chargeable !== false,
              linked_item_id: targetItemId
            };

            let feeId = fee.dbId;
            if (feeId) {
              const { error: feeErr } = await supabase
                .from('library_items')
                .update(feePayload)
                .eq('id', feeId);
              if (feeErr) throw feeErr;
              const { error: delErr } = await supabase.from('item_rates').delete().eq('item_id', feeId);
              if (delErr) throw delErr;
            } else {
              const { data: createdFee, error: feeErr } = await supabase
                .from('library_items')
                .insert([feePayload])
                .select()
                .single();
              if (feeErr) throw feeErr;
              feeId = createdFee.id;
            }
            keptFeeIds.push(feeId);

            const feeRates = pricedSeasons.map(({ group, amount, childAmount }) => feeRatePayload({
              itemId: feeId,
              currency: itemData.currency,
              seasonName: group.seasonName,
              validFrom: group.validFrom,
              validTo: group.validTo,
              type: fee.type,
              unitBasis: fee.unitBasis,
              amount,
              childAmount: dbFeatures.feeChildRate ? childAmount : undefined
            }));
            const { error: feeRateErr } = await supabase.from('item_rates').insert(feeRates);
            if (feeRateErr) throw feeRateErr;
          }

          /* A fee row the operator removed is detached rather than deleted: the
             fee stays in the library for any itinerary that already priced it,
             but it no longer travels with this property. */
          const removedFeeIds = (itemData.linkedFeeOriginalIds || []).filter((id) => !keptFeeIds.includes(id));
          if (removedFeeIds.length) {
            const { error: removedErr } = await supabase
              .from('library_items')
              .update({ linked_item_id: null })
              .in('id', removedFeeIds);
            if (removedErr) throw removedErr;
          }
        }
      }

      const isEditing = Object.keys(editingItems).length > 0;
      showToast(isEditing ? 'Library item updated successfully!' : `Successfully saved ${itemsToSave.length} Library Item(s)!`, 'success');
      setShowInlineForm(false);
      setEditingItems({});
      setSupplierMode('existing');
      setItemsToSave([createNewItemTemplate(1)]);
      fetchLibraryItems();
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteItem = async (item) => {
    const ok = await confirm({
      title: 'Delete library item?',
      message: `"${item.item_name || item.name || 'This item'}" will be permanently removed.`,
      detail: 'Itineraries already using this item keep their saved copy.',
      confirmLabel: 'Delete item',
      destructive: true
    });
    if (!ok) return;
    try {
      const { error } = await supabase.from('library_items').delete().eq('id', item.id);
      if (error) throw error;
      setLibraryItemsList(prev => prev.filter(i => i.id !== item.id));
      setTotalCount(c => Math.max(0, c - 1));
      showToast('Library item deleted', 'success');
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  // Convert a DB library item (with merged item_rates) into the inline form template
  const buildItemFromRecord = (item, linkedFees = [], linkedFeeOriginalIds = []) => {
    const rates = item.item_rates || [];
    const isTourStyle = isTourStyleCategory(item.category);
    const pricingModel = item.pricing_model || (item.category === 'Accommodation' ? 'per_person' : (item.category === 'Transfers' ? 'per_vehicle' : 'per_person'));
    const maxOcc = Math.max(1, parseInt(item.max_occupancy) || 2);
    const maxAdults = Math.max(1, parseInt(item.max_adults) || maxOcc);
    const childBands = Array.isArray(item.child_age_ranges) && item.child_age_ranges.length > 0
      ? item.child_age_ranges
      : createNewItemTemplate().childAgeRanges;

    /* A property carries its room types; every season row is priced for one of
       them. A database without the lodging migration (or an item saved before
       it) reads back as one room, so the editor is the same shape either way. */
    const isAccommodation = item.category === 'Accommodation';
    const storedRooms = isAccommodation ? normalizeRoomTypes(item.room_types) : [];
    const derivedRooms = isAccommodation && !storedRooms.length ? roomsFromRates(rates) : [];
    const roomList = !isAccommodation
      ? []
      : (storedRooms.length ? storedRooms : (derivedRooms.length ? derivedRooms : [newRoomTemplate('Standard Room')]));
    const roomKeyForRate = (rate) => roomForRate(rate, roomList)?.key || roomList[0]?.key || '';

    /* The smallest party a villa sells to is the first band its own rate rows
       price, so "from N pax" reloads what the operator typed rather than the
       default. A standard room keeps the default untouched. */
    const occupancyFloorForRoom = (room) => {
      const bands = rates
        .filter((rate) => roomKeyForRate(rate) === room.key)
        .flatMap((rate) => normalizeOccupancyLadder(rate.occupancy_rates));
      if (!bands.length) return 2;
      return Math.max(1, Math.min(...bands.map((band) => band.minPax)));
    };
    const roomListWithFloor = roomList.map((room) => (
      isOccupancyRoom(room, { pricingModel }) ? { ...room, occupancyFrom: occupancyFloorForRoom(room) } : room
    ));

    const defaultChildRates = {};

    const seasons = rates.length > 0 ? rates.map(r => {
      if (isGuideCategory(item.category)) {
        return {
          seasonName: r.season_name || r.option_name || 'Base Season',
          validFrom: r.valid_from || '',
          validTo: r.valid_to || '',
          guideTransferRate: moneyLoad(r.guide_transfer_rate),
          guideHalfDayRate: moneyLoad(r.guide_half_day_rate),
          guideFullDayRate: moneyLoad(r.guide_full_day_rate),
          guideOverlandRate: moneyLoad(r.guide_overland_rate),
          guideDinnerRate: moneyLoad(r.guide_dinner_rate),
          adultRate: 0,
          childRate: 0,
          tiers: [],
          roomRate: 0,
          price1Adult: 0,
          price2Adults: 0,
          price3PlusAdults: 0,
          childRates: {},
          childDiscount: 0,
          guideMealPlan: 'Bed & Breakfast',
          driverMealPlan: 'Bed & Breakfast',
          entranceFeePerson: parseFloat(r.entrance_fee_per_person) || 0,
          entranceFeeVehicle: parseFloat(r.entrance_fee_per_vehicle) || 0,
          levyAdultRate: parseFloat(r.conservation_levy_per_adult) || 0,
          levyChildRate: parseFloat(r.conservation_levy_per_child) || 0,
          taxesAndSurcharges: parseFloat(r.taxes_and_surcharges) || 0
        };
      }
      if (isMealsCategory(item.category)) {
        const mealChildRate = moneyLoad((r.child_rates_breakdown || {}).child);
        return {
          seasonName: r.season_name || r.option_name || 'Base Season',
          validFrom: r.valid_from || '',
          validTo: r.valid_to || '',
          adultRate: moneyLoad(r.price_1_adult ?? r.unit_price),
          childRate: mealChildRate,
          guideRate: moneyLoad(r.guide_rate),
          driverRate: moneyLoad(r.driver_rate)
        };
      }
      if (isExtrasCategory(item.category)) {
        const extrasChildRate = moneyLoad((r.child_rates_breakdown || {}).child);
        return {
          seasonName: r.season_name || r.option_name || 'Base Season',
          optionName: r.meal_plan || '',
          validFrom: r.valid_from || '',
          validTo: r.valid_to || '',
          adultRate: moneyLoad(r.price_1_adult ?? r.unit_price),
          childRate: extrasChildRate
        };
      }
      if (isTourStyle) {
        const transferChildRate = moneyLoad((r.child_rates_breakdown || {}).child);
        return {
          seasonName: r.season_name || r.option_name || 'Base Season',
          validFrom: r.valid_from || '',
          validTo: r.valid_to || '',
          adultRate: r.rate_basis === 'tiered' ? '' : moneyLoad(r.price_1_adult ?? r.unit_price),
          vehicleRate: 0,
          pricesByVehicle: r.prices_by_vehicle || {},
          childRate: transferChildRate,
          tiers: Array.isArray(r.tiered_pricing) ? r.tiered_pricing.map(t => ({ minPax: t.min_pax ?? '', maxPax: t.max_pax ?? '', rate: t.rate ?? '' })) : [],
          roomRate: 0,
          price1Adult: 0,
          price2Adults: 0,
          price3PlusAdults: 0,
          childRates: {},
          childDiscount: 0,
          /* An activity's guide figure is read with its zero intact: 0 is the
             deal that admits the guide free, and losing it on reload would turn
             a free place into a charged one on the next save. A flight keeps the
             older loading, where 0 and blank bill the same fare. */
          guideRate: item.category === 'Activities / Tours'
            ? moneyLoadKeepZero(r.guide_rate)
            : (isFlightCategory(item.category) ? moneyLoad(r.guide_rate) : 0),
          driverRate: 0,
          guideMealPlan: 'Bed & Breakfast',
          driverMealPlan: 'Bed & Breakfast',
          entranceFeePerson: moneyLoad(r.entrance_fee_per_person),
          entranceFeeVehicle: moneyLoad(r.entrance_fee_per_vehicle),
          levyAdultRate: moneyLoad(r.conservation_levy_per_adult),
          levyChildRate: moneyLoad(r.conservation_levy_per_child),
          taxesAndSurcharges: moneyLoad(r.taxes_and_surcharges)
        };
      }
      const isFlat = pricingModel === 'per_room' || r.rate_basis === 'per_room';
      if (isTicketCategory(item.category)) {
        return {
          seasonName: r.season_name || r.option_name || 'Base Season',
          validFrom: r.valid_from || '',
          validTo: r.valid_to || '',
          adultRate: moneyLoad(r.price_1_adult ?? r.unit_price),
          roomRate: 0,
          price1Adult: 0,
          price2Adults: 0,
          price3PlusAdults: 0,
          childRates: r.child_rates_breakdown || defaultChildRates,
          fastTrackAdultRate: moneyLoad(r.fast_track_adult_rate),
          fastTrackChildRates: r.fast_track_child_rates_breakdown || defaultChildRates,
          childDiscount: 0,
          guideRate: 0,
          driverRate: 0
        };
      }
      return {
        seasonName: r.season_name || r.option_name || 'Base Season',
        optionName: r.meal_plan || '',
        roomKey: roomKeyForRate(r),
        minNights: r.min_nights ?? '',
        maxNights: r.max_nights ?? '',
        weekendDays: weekendDaysOf(r),
        weekendPrice: moneyLoad(r.weekend_price),
        occupancyRates: occupancyBandsForEdit(r),
        validFrom: r.valid_from || '',
        validTo: r.valid_to || '',
        roomRate: isFlat ? moneyLoad(r.unit_price ?? r.price_2_adults ?? r.double_twin_rate) : moneyLoad(r.single_room_rate),
        singleRoomRate: isFlat ? moneyLoad(r.single_room_rate ?? r.effective_single_rate ?? r.price_1_adult) : 0,
        price1Adult: moneyLoad(r.price_1_adult ?? r.single_room_rate),
        price2Adults: moneyLoad(r.price_2_adults ?? r.double_twin_rate),
        price3PlusAdults: moneyLoad(r.price_3_plus_adults),
        childRates: isFlat ? {} : (r.child_rates_breakdown || defaultChildRates),
        singleSupplementWaiver: (() => {
          const waived = waiverFromLadder(r);
          return waived > 0 ? String(waived) : '';
        })(),
        childDiscount: isFlat ? '' : moneyLoad(r.child_discount),
        /* A fee's guide figure bills 0 as "the guide enters free", so it loads
           with its zero intact. A room's guide bed keeps the older loading: rows
           written before the zero-aware boxes hold a 0 that was the editor's
           default rather than a deal, and honouring it would quietly make guide
           beds free across the existing library. */
        guideRate: isSurchargeItem(item) ? moneyLoadKeepZero(r.guide_rate) : moneyLoad(r.guide_rate),
        /* One crew ladder in the editor, whichever column the deal was typed
           into. It saves to the guide column and mirrors to the driver one; a
           contract that only ever existed against the driver column still loads. */
        crewTiers: tierLadderFromRow(r.guide_tiers?.length ? r.guide_tiers : r.driver_tiers),
        driverRate: moneyLoad(r.driver_rate),
        tourLeaderRate: moneyLoadKeepZero(r.tour_leader_rate),
        tourLeaderTiers: tierLadderFromRow(r.tour_leader_tiers),
        guideMealPlan: r.guide_meal_plan || r.meal_plan || 'Bed & Breakfast',
        driverMealPlan: r.driver_meal_plan || r.meal_plan || 'Bed & Breakfast',
        entranceFeePerson: moneyLoad(r.entrance_fee_per_person),
        /* 0 is a contracted free child; blank is the park not splitting by age,
           so the two must not collapse into each other on reload. */
        entranceFeeChild: moneyLoadKeepZero(r.entrance_fee_per_child),
        entranceFeeVehicle: moneyLoad(r.entrance_fee_per_vehicle),
        levyAdultRate: moneyLoad(r.conservation_levy_per_adult),
        levyChildRate: moneyLoad(r.conservation_levy_per_child),
        unitRate: moneyLoad(r.unit_price),
        taxesAndSurcharges: moneyLoad(r.taxes_and_surcharges)
      };
    }) : [{
      seasonName: 'Base Season',
      validFrom: '',
      validTo: '',
      ...(isAccommodation ? { roomKey: roomList[0]?.key || '' } : {}),
      ...emptySeasonMoney()
    }];

    /* Rows come back one per (group × season × band), so fold them the same way the
       pricing engine does: a card per vehicle group, a season inside it per Rental
       Price Validity window. A group that was only ever sold on one window loads as
       one season, exactly as the editor wrote it. */
    const carRatesRows = Array.isArray(item.car_rental_rates) ? item.car_rental_rates : [];
    const carGroupsMap = {};
    const carSeasonMap = {};
    let carSeasonLoads = 0;
    carRatesRows.forEach(r => {
      const key = `${r.vehicle_group || ''}|${r.vehicle_name || ''}|${r.rate_code || ''}|${r.kms_unlimited !== false}|${r.kms_included || ''}`;
      if (!carGroupsMap[key]) {
        carGroupsMap[key] = {
          groupId: 'crg_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
          vehicleGroup: r.vehicle_group || '',
          vehicleName: r.vehicle_name || '',
          rateCode: r.rate_code || '',
          kmsUnlimited: r.kms_unlimited !== false,
          kmsIncluded: r.kms_included ?? '',
          luggage: r.luggage ?? '',
          doors: r.doors ?? '',
          passengers: r.max_passengers ?? '',
          aircon: r.has_aircon !== false,
          gear: r.gear || 'automatic',
          fuelType: r.fuel_type || 'fuel',
          seasons: []
        };
      }
      const group = carGroupsMap[key];
      const seasonKey = `${key}|${r.valid_from || ''}|${r.valid_to || ''}`;
      if (!carSeasonMap[seasonKey]) {
        carSeasonLoads += 1;
        const season = {
          seasonId: `crs_load_${carSeasonLoads}`,
          validFrom: r.valid_from || '',
          validTo: r.valid_to || '',
          ranges: []
        };
        carSeasonMap[seasonKey] = season;
        group.seasons.push(season);
      }
      carSeasonMap[seasonKey].ranges.push({
        minDays: r.min_days ?? '',
        maxDays: r.max_days ?? '',
        price: r.price ?? ''
      });
    });
    Object.values(carGroupsMap).forEach(group => {
      group.seasons.sort((a, b) => String(a.validFrom || '9999-12-31').localeCompare(String(b.validFrom || '9999-12-31')));
      group.seasons.forEach(season => {
        season.ranges.sort((a, b) => (parseInt(a.minDays) || 0) - (parseInt(b.minDays) || 0));
      });
    });
    const carGroups = Object.keys(carGroupsMap).length > 0
      ? Object.values(carGroupsMap)
      : [createCarRentalGroup()];

    return {
      tempId: Date.now() + Math.random(),
      itemIndex: 1,
      name: item.name || '',
      destinationRegion: item.destination_region || item.location || '',
      destinationArea: item.destination_area || '',
      identifierCode: item.identifier_code || '',
      identifierDestinationRegion: item.destination_region || item.location || '',
      category: normalizeCategoryName(item.category) || 'Accommodation',
      currency: item.currency || 'ZAR',
      mealPlan: rates.find(r => r.meal_plan)?.meal_plan || 'Bed & Breakfast',
      vehicleType: item.category === 'Transfers' ? (item.sub_category || '') : '',
      tourType: item.tour_type || '',
      minPaxToRun: item.min_pax_to_run ?? '',
      transferType: item.category === 'Transfers' ? (item.transfer_type || '') : '',
      transportType: item.transport_type || '',
      rentalContractFee: item.rental_contract_fee ?? '',
      flightNumber: item.flight_number || '',
      airlineName: item.airline_name || '',
      departureCity: item.departure_city || '',
      arrivalCity: item.arrival_city || '',
      trainDepartureDate: item.train_departure_date || '',
      trainJourneyNights: parseInt(item.train_journey_nights) || 0,
      trainCabinName: item.train_cabin_name || '',
      ticketType: item.ticket_type || 'standard',
      mealType: item.meal_type || 'Breakfast',
      menuType: item.menu_type || 'a_la_carte',
      mealGratuityPercent: parseFloat(item.meal_gratuity_percent) || 0,
      guideMealOffered: isMealsCategory(item.category) && item.guide_meal_offered === true,
      driverMealOffered: isMealsCategory(item.category) && item.driver_meal_offered === true,
      guideFlightOffered: isFlightCategory(item.category) && item.guide_flight_offered === true,
      feeType: 'none',
      levyBasis: 'per_night',
      surchargeType: item.surcharge_type || 'entrance_fee',
      surchargeChargeBasis: ['once_off', 'per_night'].includes(item.surcharge_charge_basis) ? item.surcharge_charge_basis : 'once_off',
      surchargeUnitBasis: UNIT_BASES.some((b) => b.id === item.surcharge_unit_basis) ? item.surcharge_unit_basis : 'per_person',
      surchargeChargeable: item.surcharge_chargeable !== false,
      linkedItemId: item.linked_item_id || '',
      childAge: isTourStyle ? (parseInt(childBands[0]?.ageTo) || 12) : 12,
      pricingModel,
      maxOccupancy: maxOcc,
      maxAdults,
      maxChildren: Math.max(0, parseInt(item.max_children) || 0),
      sharingCapacityRules: (() => {
        const stored = (Array.isArray(item.sharing_capacity_rules) && item.sharing_capacity_rules.length > 0)
          ? item.sharing_capacity_rules
          : null;
        if (!stored) return ensureSharingRules(maxAdults, maxOcc, []);
        if (isAccommodation && roomList.length > 0) {
          const currentCeiling = roomCeilingOf(roomList) || maxOcc;
          const stale = staleAutoCeilingOf(stored, currentCeiling);
          if (stale !== null) {
            return rebaseSharingRules(roomAdultsOf(roomList), stale, currentCeiling, stored);
          }
        }
        return stored;
      })(),
      guideDriverOffered: item.guide_driver_room_offered === true,
      childrenOwnRoomPolicy: ['child_rates', 'adult_rates', 'single_room_rate'].includes(item.children_own_room_policy)
        ? item.children_own_room_policy
        : 'child_rates',
    guideMinRooms: item.guide_min_rooms || 1,
    tourLeaderRoomOffered: item.tour_leader_room_offered === true,
    tourLeaderMinRooms: item.tour_leader_min_rooms || 1,
      driverRequired: isDriverEligibleCategory(item.category) && item.driver_required === true,
      driverMeals: isDriverEligibleCategory(item.category) ? ((item.driver_meals || '').split(',').filter(Boolean)) : [],
      driverAccommodation: isDriverEligibleCategory(item.category) && item.driver_accommodation === true,
      guideMeals: isGuideCategory(item.category) ? ((item.guide_meals || '').split(',').filter(Boolean)) : [],
      guideAccommodation: isGuideCategory(item.category) && item.guide_accommodation === true,
      description: item.description || '',
      textI18n: translationsOf(item),
      imageUrls: Array.isArray(item.images) ? item.images : [],
      newImageUrlInput: '',
      contractUrl: item.contract_url || '',
      contractName: item.contract_name || '',
      childAgeRanges: childBands,
      carGroups,
      roomTypes: roomListWithFloor,
      seasons,
      linkedFees,
      linkedFeeOriginalIds
    };
  };

  const handleEditItem = async (item) => {
    let linkedFees = [];
    let linkedFeeOriginalIds = [];
    if (item.category === 'Accommodation' && dbFeatures.surchargeFees && dbFeatures.feeType) {
      try {
        const { data: feeItems } = await supabase
          .from('library_items')
          .select('*')
          .eq('linked_item_id', item.id);
        const feeRows = (feeItems || []).filter(isSurchargeItem);
        if (feeRows.length) {
          /* The fee amount is entered per property season. The season list is
             taken from the accommodation's own rate rows, deduped across rooms,
             so a renamed or redated season can still find the figure it was
             saved with. */
          const seenSeasons = new Set();
          const feeSeasons = (item.item_rates || []).reduce((groups, rate) => {
            const seasonName = rate.season_name || rate.option_name || 'Base Season';
            const validFrom = rate.valid_from || '';
            const validTo = rate.valid_to || '';
            const key = feeSeasonKey(seasonName, validFrom, validTo);
            if (seenSeasons.has(key)) return groups;
            seenSeasons.add(key);
            groups.push({ seasonName, validFrom, validTo });
            return groups;
          }, []);
          const feeIds = feeRows.map((fee) => fee.id);
          const { data: feeRates } = await supabase
            .from('item_rates')
            .select('*')
            .in('item_id', feeIds);
          const ratesByItem = {};
          (feeRates || []).forEach((rate) => {
            if (!ratesByItem[rate.item_id]) ratesByItem[rate.item_id] = [];
            ratesByItem[rate.item_id].push(rate);
          });
          linkedFees = feeRows.map((fee) => feeEditorRowFromRecord(
            { ...fee, item_rates: ratesByItem[fee.id] || [] },
            feeSeasons
          ));
          linkedFeeOriginalIds = feeIds;
        }
      } catch {
        // A database without the fee columns behaves as if the property had none.
      }
    }
    const template = buildItemFromRecord(item, linkedFees, linkedFeeOriginalIds);
    setItemsToSave([template]);
    setEditingItems({ [template.tempId]: item.id });
    setSelectedSupplierId(item.supplier_id || item.supplier?.id || '');
    setSupplierMode('existing');
    setShowInlineForm(true);
    requestAnimationFrame(() => {
      const el = document.getElementById('library-item-form');
      el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  };

  // Search + filters are applied server-side; the rendered list is the fetched page.
  const filteredList = libraryItemsList;

  return (
    <div className="super-admin-page" style={{ paddingBottom: '4rem' }}>

      {/* Top Bar Header & Category Filters */}
      <header className="page-header" style={{ marginBottom: '1.5rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', flexWrap: 'wrap', gap: '1rem' }}>

          {/* Search Box */}
          <div className="search-box" style={{ width: '380px', margin: 0 }}>
            <Search size={18} />
            <input
              type="text"
              placeholder="Search library items by name or supplier..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          {/* Filter Dropdowns on Header Bar */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <div style={{ position: 'relative' }}>
              <SearchableSelect
                className="pricing-select"
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value)}
                style={{
                  height: '42px',
                  margin: 0,
                  paddingRight: '2rem',
                  fontWeight: 600,
                  minWidth: '190px',
                  borderColor: '#cbd5e1'
                }}
              >
                <option value="All">All Categories</option>
                {categories.map(cat => (
                  <option key={cat.id} value={cat.id}>{cat.label}</option>
                ))}
              </SearchableSelect>
            </div>

            {/* Supplier Filter Dropdown on Header Bar */}
            <div style={{ position: 'relative' }}>
              <SearchableSelect
                className="pricing-select"
                value={supplierFilter}
                onChange={(e) => setSupplierFilter(e.target.value)}
                style={{
                  height: '42px',
                  margin: 0,
                  paddingRight: '2rem',
                  fontWeight: 600,
                  minWidth: '190px',
                  borderColor: '#cbd5e1'
                }}
              >
                <option value="All">All Suppliers</option>
                {suppliers.map(s => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </SearchableSelect>
            </div>

            {/* Toggle Add Library Item Inline Form */}
            <button
              className="primary-btn"
              style={{ width: 'auto', padding: '0.625rem 1.25rem', height: '42px', background: '#0d7478' }}
              onClick={() => setShowInlineForm(!showInlineForm)}
            >
              <Plus size={18} /> {showInlineForm ? 'Close Form' : 'Add Library Item'}
            </button>
          </div>

        </div>
      </header>

      {/* FULL-WIDTH INLINE CREATION / EDIT FORM BLOCK (No Modals!) */}
      {showInlineForm && (
        <div id="library-item-form" style={{
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
              <Package size={22} color="#0d7478" />
              {Object.keys(editingItems).length > 0 ? `Edit Library Item: ${itemsToSave[0]?.name || ''}` : 'Add New Library Item'}
            </h2>
            <button
              onClick={() => { setShowInlineForm(false); setEditingItems({}); }}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#64748b' }}
            >
              <X size={24} />
            </button>
          </div>

          <form onSubmit={handleSubmitAllItems}>

            {/* INLINE SUPPLIER SELECTION / CREATION SECTION */}
            <div style={{
              background: '#f8fafc',
              padding: '1.5rem',
              borderRadius: '12px',
              border: '1px solid #e2e8f0',
              marginBottom: '2rem'
            }}>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
                <h3 style={{ fontSize: '1.1rem', fontWeight: 700, color: '#0f172a', margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <Building2 size={20} color="#0d7478" /> Supplier
                </h3>

                {/* Right Top Action Link */}
                {supplierMode === 'new' ? (
                  <button
                    type="button"
                    onClick={() => setSupplierMode('existing')}
                    style={{ color: '#0d7478', background: 'none', border: 'none', fontWeight: 600, fontSize: '0.9rem', cursor: 'pointer' }}
                  >
                    Select Existing
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => setSupplierMode('new')}
                    style={{ color: '#0d7478', background: 'none', border: 'none', fontWeight: 600, fontSize: '0.9rem', cursor: 'pointer' }}
                  >
<Plus size={14} /> Add New Supplier
                  </button>
                )}
              </div>

              {/* MODE 1: Select Existing Supplier Dropdown */}
              {supplierMode === 'existing' && (
                <div style={{ maxWidth: '600px' }}>
                  <label style={{ fontSize: '0.85rem', fontWeight: 700, color: '#334155', display: 'block', marginBottom: '0.35rem' }}>
                    Select Supplier *
                  </label>
                  <SearchableSelect
                    className="pricing-select"
                    value={selectedSupplierId}
                    onChange={(e) => setSelectedSupplierId(e.target.value)}
                    style={{ margin: 0, fontWeight: 600 }}
                  >
                    <option value="">Select supplier...</option>
                    {suppliers.map(s => (
                      /* No category suffix: a supplier's category reflects only
                         the first item it was created from, so showing it would
                         wrongly suggest the supplier only offers that service. */
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </SearchableSelect>
                </div>
              )}

              {/* MODE 2: Full Inline New Supplier Form (Matching Screenshot) */}
              {supplierMode === 'new' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>

                  {/* Basic Information */}
                  <div>
                    <h4 style={{ fontSize: '0.95rem', fontWeight: 700, color: '#334155', marginBottom: '0.75rem', borderBottom: '1px solid #e2e8f0', paddingBottom: '0.35rem' }}>
                      Basic Information
                    </h4>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                      <div>
                        <label style={{ fontSize: '0.8rem', fontWeight: 600, color: '#475569', display: 'block', marginBottom: '0.25rem' }}>
                          Supplier Name *
                        </label>
                        <input
                          type="text"
                          className="pricing-select"
                          placeholder="e.g., Safari Lodge Group"
                          required={supplierMode === 'new'}
                          value={supplierForm.name}
                          onChange={(e) => setSupplierForm({ ...supplierForm, name: e.target.value })}
                        />
                      </div>

                      <div>
                        <label style={{ fontSize: '0.8rem', fontWeight: 600, color: '#475569', display: 'block', marginBottom: '0.25rem' }}>
                          Contact Person
                        </label>
                        <input
                          type="text"
                          className="pricing-select"
                          placeholder="e.g., John Doe"
                          value={supplierForm.contactPerson}
                          onChange={(e) => setSupplierForm({ ...supplierForm, contactPerson: e.target.value })}
                        />
                      </div>

                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                        <div>
                          <label style={{ fontSize: '0.8rem', fontWeight: 600, color: '#475569', display: 'block', marginBottom: '0.25rem' }}>
                            Email
                          </label>
                          <input
                            type="email"
                            className="pricing-select"
                            placeholder="supplier@example.com"
                            value={supplierForm.email}
                            onChange={(e) => setSupplierForm({ ...supplierForm, email: e.target.value })}
                          />
                        </div>

                        <div>
                          <label style={{ fontSize: '0.8rem', fontWeight: 600, color: '#475569', display: 'block', marginBottom: '0.25rem' }}>
                            Phone
                          </label>
                          <input
                            type="text"
                            className="pricing-select"
                            placeholder="+27 123 456 789"
                            value={supplierForm.phone}
                            onChange={(e) => setSupplierForm({ ...supplierForm, phone: e.target.value })}
                          />
                        </div>
                      </div>

                      <div>
                        <label style={{ fontSize: '0.8rem', fontWeight: 600, color: '#475569', display: 'block', marginBottom: '0.25rem' }}>
                          Website
                        </label>
                        <input
                          type="text"
                          className="pricing-select"
                          placeholder="https://www.example.com"
                          value={supplierForm.website}
                          onChange={(e) => setSupplierForm({ ...supplierForm, website: e.target.value })}
                        />
                      </div>
                    </div>
                  </div>

                  {/* Location */}
                  <div>
                    <h4 style={{ fontSize: '0.95rem', fontWeight: 700, color: '#334155', marginBottom: '0.75rem', borderBottom: '1px solid #e2e8f0', paddingBottom: '0.35rem' }}>
                      Location
                    </h4>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                      <div>
                        <label style={{ fontSize: '0.8rem', fontWeight: 600, color: '#475569', display: 'block', marginBottom: '0.25rem' }}>
                          Address
                        </label>
                        <input
                          type="text"
                          className="pricing-select"
                          placeholder="123 Main Street"
                          value={supplierForm.address}
                          onChange={(e) => setSupplierForm({ ...supplierForm, address: e.target.value })}
                        />
                      </div>

                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1rem' }}>
                        <div>
                          <label style={{ fontSize: '0.8rem', fontWeight: 600, color: '#475569', display: 'block', marginBottom: '0.25rem' }}>
                            Country
                          </label>
                          <SearchableSelect
                            className="pricing-select"
                            value={supplierForm.country}
                            onChange={(e) => setSupplierForm({ ...supplierForm, country: e.target.value })}
                          >
                            {countryOptions.map(c => (
                              <option key={c} value={c}>{c}</option>
                            ))}
                          </SearchableSelect>
                        </div>

                        <div>
                          <label style={{ fontSize: '0.8rem', fontWeight: 600, color: '#475569', display: 'block', marginBottom: '0.25rem' }}>
                            Province/State
                          </label>
                          <input
                            type="text"
                            className="pricing-select"
                            placeholder="Western Cape"
                            value={supplierForm.provinceState}
                            onChange={(e) => setSupplierForm({ ...supplierForm, provinceState: e.target.value })}
                          />
                        </div>

                        <div>
                          <label style={{ fontSize: '0.8rem', fontWeight: 600, color: '#475569', display: 'block', marginBottom: '0.25rem' }}>
                            City
                          </label>
                          <input
                            type="text"
                            className="pricing-select"
                            placeholder="Cape Town"
                            value={supplierForm.city}
                            onChange={(e) => setSupplierForm({ ...supplierForm, city: e.target.value })}
                          />
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Banking Details */}
                  <div>
                    <h4 style={{ fontSize: '0.95rem', fontWeight: 700, color: '#334155', marginBottom: '0.75rem', borderBottom: '1px solid #e2e8f0', paddingBottom: '0.35rem' }}>
                      Banking Details
                    </h4>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                        <div>
                          <label style={{ fontSize: '0.8rem', fontWeight: 600, color: '#475569', display: 'block', marginBottom: '0.25rem' }}>
                            Bank Name
                          </label>
                          <input
                            type="text"
                            className="pricing-select"
                            placeholder="Standard Bank"
                            value={supplierForm.bankName}
                            onChange={(e) => setSupplierForm({ ...supplierForm, bankName: e.target.value })}
                          />
                        </div>

                        <div>
                          <label style={{ fontSize: '0.8rem', fontWeight: 600, color: '#475569', display: 'block', marginBottom: '0.25rem' }}>
                            Account Holder Name
                          </label>
                          <input
                            type="text"
                            className="pricing-select"
                            placeholder="Full name"
                            value={supplierForm.accountHolderName}
                            onChange={(e) => setSupplierForm({ ...supplierForm, accountHolderName: e.target.value })}
                          />
                        </div>
                      </div>

                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                        <div>
                          <label style={{ fontSize: '0.8rem', fontWeight: 600, color: '#475569', display: 'block', marginBottom: '0.25rem' }}>
                            Bank Account Number
                          </label>
                          <input
                            type="text"
                            className="pricing-select"
                            placeholder="123456789"
                            value={supplierForm.bankAccountNumber}
                            onChange={(e) => setSupplierForm({ ...supplierForm, bankAccountNumber: e.target.value })}
                          />
                        </div>

                        <div>
                          <label style={{ fontSize: '0.8rem', fontWeight: 600, color: '#475569', display: 'block', marginBottom: '0.25rem' }}>
                            Bank/Branch Code
                          </label>
                          <input
                            type="text"
                            className="pricing-select"
                            placeholder="051001"
                            value={supplierForm.branchCode}
                            onChange={(e) => setSupplierForm({ ...supplierForm, branchCode: e.target.value })}
                          />
                        </div>
                      </div>

                      <div style={{ maxWidth: '450px' }}>
                        <label style={{ fontSize: '0.8rem', fontWeight: 600, color: '#475569', display: 'block', marginBottom: '0.25rem' }}>
                          SWIFT/BIC/IBAN Code
                        </label>
                        <input
                          type="text"
                          className="pricing-select"
                          placeholder="SBZA ZA JJ"
                          value={supplierForm.swiftCode}
                          onChange={(e) => setSupplierForm({ ...supplierForm, swiftCode: e.target.value })}
                        />
                      </div>
                    </div>
                  </div>

                  {/* Dedicated Save Supplier & Cancel Buttons */}
                  <div style={{ display: 'flex', gap: '1rem', justifyContent: 'flex-end', alignItems: 'center', marginTop: '0.5rem', paddingTop: '1.25rem', borderTop: '1px solid #e2e8f0' }}>
                    <span style={{ fontSize: '0.8rem', color: '#64748b', marginRight: 'auto' }}>
                      (Saving supplier enables library item creation below)
                    </span>
                    <button
                      type="button"
                      className="secondary-btn"
                      style={{ flex: '0 0 auto', padding: '0.625rem 1.5rem' }}
                      onClick={handleCancelSupplierForm}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      className="primary-btn"
                      style={{ background: '#0d7478', width: 'auto', padding: '0.625rem 1.5rem' }}
                      onClick={handleSaveSupplierOnly}
                      disabled={savingSupplier}
                    >
                      <Check size={16} /> {savingSupplier ? 'Saving Supplier...' : 'Save Supplier'}
                    </button>
                  </div>

                </div>
              )}

            </div>

            {/* SUPPLIER REQUIRED / DISABLED BANNER IF NO SUPPLIER IS ESTABLISHED */}
            {!selectedSupplierId && (
              <div style={{
                background: '#fef3c7',
                border: '1px solid #fde68a',
                color: '#92400e',
                padding: '0.85rem 1.25rem',
                borderRadius: '8px',
                fontSize: '0.875rem',
                fontWeight: 500,
                marginBottom: '1.5rem',
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem'
              }}>
                <Building2 size={18} color="#b45309" />
                <span>Please select a supplier above, or click "Add New Supplier" and save it, to activate the library item form below.</span>
              </div>
            )}

            {/* LIBRARY ITEMS CONTAINER — Disabled / Grayed out until a supplier is selected or created */}
            <div style={{
              opacity: selectedSupplierId ? 1 : 0.45,
              pointerEvents: selectedSupplierId ? 'auto' : 'none',
              filter: selectedSupplierId ? 'none' : 'grayscale(0.6)',
              transition: 'all 0.25s ease'
            }}>

              {/* MULTI-ITEM CHECKBOX BANNER */}
              <div style={{
                background: '#eff6ff',
                padding: '0.85rem 1.25rem',
                borderRadius: '8px',
                border: '1px solid #bfdbfe',
                marginBottom: '2rem',
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem'
              }}>
                <input
                  type="checkbox"
                  id="addMultiple"
                  checked={addMultiple}
                  onChange={(e) => setAddMultiple(e.target.checked)}
                  style={{ width: '18px', height: '18px', cursor: 'pointer', accentColor: '#2563eb' }}
                />
                <label htmlFor="addMultiple" style={{ fontSize: '0.9rem', fontWeight: 600, color: '#1d4ed8', cursor: 'pointer' }}>
                  Add multiple library items from this supplier at once
                </label>
              </div>

              {/* DYNAMIC LIBRARY ITEM CARDS */}
              {itemsToSave.map((item, itemIdx) => {
                const isTourStyle = isTourStyleCategory(item.category);
                /* With room types, the widest room answers "how many in one
                   room"; without them the item's own ceiling still does. */
                const roomCeiling = item.category === 'Accommodation' && roomsReady
                  ? (Math.max(0, ...(item.roomTypes || []).map(room => parseInt(room.maxOccupancy) || 0)) || 2)
                  : (parseInt(item.maxOccupancy) || 2);
                return (
                <div
                  key={item.tempId}
                  style={{
                    background: '#fff',
                    borderRadius: '12px',
                    padding: '1.75rem',
                    border: '1px solid #e2e8f0',
                    boxShadow: '0 4px 12px rgba(0,0,0,0.02)',
                    marginBottom: '2rem',
                    position: 'relative'
                  }}
                >
                  {/* Header for Item Card */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem', borderBottom: '1px solid #f1f5f9', paddingBottom: '0.75rem' }}>
                    <h3 style={{ fontSize: '1.1rem', fontWeight: 700, color: '#0f172a', margin: 0 }}>
                      Library Item {itemIdx + 1}
                    </h3>
                    {itemsToSave.length > 1 && (
                      <button
                        type="button"
                        onClick={() => handleRemoveItemCard(item.tempId)}
                        style={{ color: '#ef4444', background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.25rem', fontSize: '0.85rem' }}
                      >
                        <Trash2 size={16} /> Remove Item
                      </button>
                    )}
                  </div>

                  {/* Category & Currency Row */}
                  <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '1.25rem', marginBottom: '1.25rem' }}>
                    <div>
                      <label style={{ fontSize: '0.85rem', fontWeight: 600, color: '#475569', display: 'block', marginBottom: '0.35rem' }}>
                        Category *
                      </label>
                      <SearchableSelect
                        className="pricing-select"
                        value={item.category}
                        onChange={(e) => handleCategoryChange(item.tempId, e.target.value)}
                      >
                        {categories.map(cat => (
                          <option key={cat.id} value={cat.id}>{cat.label}</option>
                        ))}
                      </SearchableSelect>
                    </div>

                    <div>
                      <label style={{ fontSize: '0.85rem', fontWeight: 600, color: '#475569', display: 'block', marginBottom: '0.35rem' }}>
                        Currency *
                      </label>
                      <SearchableSelect
                        className="pricing-select"
                        value={item.currency}
                        onChange={(e) => handleItemFieldChange(item.tempId, 'currency', e.target.value)}
                      >
                        {currencies.length === 0 && (
                          <option value={item.currency}>{item.currency}</option>
                        )}
                        {currencies.map(c => (
                          <option key={c.code} value={c.code}>
                            {c.code} – {c.name} ({c.symbol})
                          </option>
                        ))}
                      </SearchableSelect>
                    </div>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '1.25rem', marginBottom: '1.25rem' }}>
                    <div>
                      <label style={{ fontSize: '0.85rem', fontWeight: 600, color: '#475569', display: 'block', marginBottom: '0.35rem' }}>
                        {/accommodation/i.test(String(item.category || ''))
                          ? 'Destination'
                          : (isCarRentalCategory(item.category) ? 'Country / Territory *' : 'Destination / Locality *')}
                      </label>
                      {/accommodation/i.test(String(item.category || '')) ? (
                        <input
                          type="text"
                          className="pricing-select"
                          readOnly
                          aria-readonly="true"
                          placeholder="Set the supplier's city"
                          value={supplierDestination() || item.destinationRegion || ''}
                        />
                      ) : (
                        <input
                          type="text"
                          className="pricing-select"
                          placeholder={isCarRentalCategory(item.category) ? operatingCountry : 'e.g. Windhoek / Etosha National Park'}
                          required
                          value={item.destinationRegion || ''}
                          onChange={(e) => handleItemFieldChange(item.tempId, 'destinationRegion', e.target.value)}
                        />
                      )}
                      <small style={{ display: 'block', marginTop: '0.3rem', color: '#64748b' }}>
                        {/accommodation/i.test(String(item.category || ''))
                          ? (supplierDestination()
                            ? 'Taken from the supplier — a property sits where its supplier does, so the locality is not asked again here.'
                            : 'The supplier has no city yet. Set it in the supplier record; until then the stored locality is kept.')
                          : (isCarRentalCategory(item.category)
                            ? 'One hire contract prices the whole country, so this is the country the car is picked up in. Starts on the country set in Settings; change it only when you sell a hire abroad at a different price. Shown on rate cards, used by search, and it seeds the identifier code.'
                            : 'The specific place this item sits in. Shown in the library list and on rate cards, used by search, and it seeds the identifier code.')}
                      </small>
                    </div>
                    <div>
                      <label style={{ fontSize: '0.85rem', fontWeight: 600, color: '#475569', display: 'block', marginBottom: '0.35rem' }}>
                        Identifier Code
                      </label>
                      <input
                        type="text"
                        className="pricing-select"
                        value={item.identifierCode && item.destinationRegion === item.identifierDestinationRegion ? item.identifierCode : 'Generated when saved'}
                        readOnly
                        aria-readonly="true"
                      />
                    </div>
                  </div>

                  {isCarRentalCategory(item.category) && (
                    <div style={{ marginBottom: '1.25rem' }}>
                      <label style={{ fontSize: '0.85rem', fontWeight: 600, color: '#475569', display: 'block', marginBottom: '0.35rem' }}>
                        Locality (only if it prices differently)
                      </label>
                      <input
                        type="text"
                        className="pricing-select"
                        placeholder={`e.g. Walvis Bay — leave blank when the whole of ${item.destinationRegion || 'this country'} costs the same`}
                        value={item.destinationArea || ''}
                        onChange={(e) => handleItemFieldChange(item.tempId, 'destinationArea', e.target.value)}
                      />
                      <small style={{ display: 'block', marginTop: '0.3rem', color: '#64748b' }}>
                        Normally blank: one hire contract prices the country. Fill it only where one place
                        costs differently, and it does two things — it names that hire on the rate card, and it
                        lets the destination filter in the itinerary and package builders find this item by that
                        town as well as by the country.
                      </small>
                    </div>
                  )}

                  {/accommodation/i.test(String(item.category || '')) && (
                    <div style={{ marginBottom: '1.25rem' }}>
                      <label style={{ fontSize: '0.85rem', fontWeight: 600, color: '#475569', display: 'block', marginBottom: '0.35rem' }}>
                        Destination Area *
                      </label>
                      <input
                        type="text"
                        className="pricing-select"
                        placeholder="e.g. Garden Route (the same area for every property nearby)"
                        required
                        value={item.destinationArea || ''}
                        onChange={(e) => handleItemFieldChange(item.tempId, 'destinationArea', e.target.value)}
                      />
                      <small style={{ display: 'block', marginTop: '0.3rem', color: '#64748b' }}>
                        The town comes from the supplier. This is the wider area key used to judge whether
                        another property is a valid alternative and how traveller groups split by destination —
                        type it identically on every property in that area.
                      </small>
                    </div>
                  )}

                  {/* Name & Meal Plan / Vehicle Type Row */}
                  <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '1.25rem', marginBottom: '1.25rem' }}>
                    <div>
                      <label style={{ fontSize: '0.85rem', fontWeight: 600, color: '#475569', display: 'block', marginBottom: '0.35rem' }}>
                        {/accommodation/i.test(String(item.category || '')) ? 'Property Name *' : 'Library Item Name *'}
                      </label>
                      <input
                        type="text"
                        className="pricing-select"
                        placeholder={item.category === 'Transfers'
                          ? 'e.g., Airport Transfer / Safari Transfer'
                          : (item.category === 'Activities / Tours'
                            ? 'e.g., Game Drive / Boat Cruise / Guided Walk'
                            : (item.category === 'Flights / Charter'
                              ? 'e.g., JNB–NBO Scheduled / Charter Flight'
                              : (item.category === 'Meals'
                              ? 'e.g., Buffet Lunch / À La Carte Dinner'
                              : (isGuideCategory(item.category)
                                ? 'e.g., Freelance Guide / Safari Guide / Walking Guide'
                                : (isTrainCategory(item.category)
                                ? 'e.g., CPT–PRY 3 Nights (Journey Name)'
                                : (isTicketCategory(item.category)
                                ? 'e.g., Park Entrance Ticket / Game Drive Ticket'
                                : (isExtrasCategory(item.category)
                                ? 'e.g., Spa Treatment / Laundry Service / Wi-Fi Pass'
                                : (isCarRentalCategory(item.category)
                                ? 'e.g., Self-Drive (Group C) — Toyota Starlet'
                                : /accommodation/i.test(String(item.category || ''))
                                ? 'e.g., Oudtshoorn Lodge / Safari Camp'
                                : isTransportCategory(item.category)
                                ? 'e.g., 30-Seat Bus Hire / Mini Coach / Closed Truck'
                                : 'e.g., Standard Room / Safari Transfer / Game Drive'))))))))}
                        required
                        value={item.name}
                        onChange={(e) => handleItemFieldChange(item.tempId, 'name', e.target.value)}
                      />
                      {/accommodation/i.test(String(item.category || '')) && (
                        <small style={{ display: 'block', marginTop: '0.3rem', color: '#64748b' }}>
                          The property itself — the lodge, camp or guesthouse. Its room types go in the card below, so do not name it after a room.
                        </small>
                      )}
                    </div>

                    {/* Only a transfer names its vehicle. A Transport item IS the
                        vehicle - its name, seat capacity, hire type and the per
                        vehicle price matrix already say which one is bought - and an
                        activity is a thing that happens: a boat trip, a quad bike, a
                        walk into a park. Plenty have no road vehicle at all, so the
                        required label asked every tour for a vehicle it does not
                        have. */}
                    {item.category === 'Transfers' ? (
                      <div>
                        <label style={{ fontSize: '0.85rem', fontWeight: 600, color: '#475569', display: 'block', marginBottom: '0.35rem' }}>
                          Vehicle Type *
                        </label>
                        {vehicleTypes.length ? (
                          <>
                            <SearchableSelect
                              className="pricing-select"
                              value={item.vehicleType}
                              onChange={(e) => handleVehicleTypeChange(item.tempId, e.target.value)}
                            >
                              <option value="">Select a vehicle type</option>
                              {vehicleTypes.map((type) => (
                                <option key={type.id || type.code} value={type.name}>
                                  {type.name} — {type.max_capacity} seats
                                </option>
                              ))}
                              {/* A row saved on words the list no longer holds — a
                                  free-text vehicle, or a type since retired — shows
                                  its own answer rather than losing it. */}
                              {item.vehicleType && !vehicleTypes.some((type) => type.name === item.vehicleType) && (
                                <option value={item.vehicleType}>{item.vehicleType} (saved value — not in Settings)</option>
                              )}
                            </SearchableSelect>
                            <span style={{ fontSize: '0.7rem', color: '#64748b', display: 'block', marginTop: '0.25rem' }}>
                              The chosen vehicle's seats become this transfer's capacity, so the party guards and the documents count the same car. Manage the list in Settings.
                            </span>
                          </>
                        ) : (
                          <>
                            <input
                              type="text"
                              className="pricing-select"
                              placeholder="e.g. Land Cruiser / Safari Minivan"
                              value={item.vehicleType}
                              onChange={(e) => handleVehicleTypeChange(item.tempId, e.target.value)}
                            />
                            <span style={{ fontSize: '0.7rem', color: '#64748b', display: 'block', marginTop: '0.25rem' }}>
                              No vehicle types are set for this company yet, so this transfer names its own. Add them in Settings to pick from the list instead.
                            </span>
                          </>
                        )}
                      </div>
                    ) : (item.category === 'Accommodation' || isTrainCategory(item.category)) ? (
                      <div>
                        <label style={{ fontSize: '0.85rem', fontWeight: 600, color: '#475569', display: 'block', marginBottom: '0.35rem' }}>
                          Meal Plan
                        </label>
                        <SearchableSelect
                          className="pricing-select"
                          value={item.mealPlan}
                          onChange={(e) => handleItemFieldChange(item.tempId, 'mealPlan', e.target.value)}
                        >
                          {mealPlanOptions.map(mp => (
                            <option key={mp} value={mp}>{mp}</option>
                          ))}
                        </SearchableSelect>
                      </div>
                    ) : null}

                    {/* DRIVER OPTION (large vehicles: 14+ seats — Activities / Tours + Transfers) */}
                    {dbFeatures.driverOption && isDriverEligibleCategory(item.category) && getVehiclePax(item.maxOccupancy) >= 14 && (
                      <div style={{ background: '#f0fdfa', border: '1px solid #5eead4', borderRadius: '8px', padding: '0.85rem 1rem', marginTop: '1rem' }}>
                        <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontSize: '0.85rem', fontWeight: 700, color: '#134e4a' }}>
                          <input
                            type="checkbox"
                            checked={!!item.driverRequired}
                            onChange={(e) => {
                              handleItemFieldChange(item.tempId, 'driverRequired', e.target.checked);
                              handleItemFieldChange(item.tempId, 'driverMeals', e.target.checked ? getDefaultDriverMeals(item.category, driverHireType(item)) : []);
                              handleItemFieldChange(item.tempId, 'driverAccommodation', e.target.checked ? getDefaultDriverAccommodation(item.category, driverHireType(item)) : false);
                            }}
                          />
                          🚗 Dedicated Driver Required
                        </label>
                        <div style={{ fontSize: '0.72rem', color: '#0f766e', marginTop: '0.25rem' }}>
                          The vehicle price already includes the driver — this only triggers the driver's meals and accommodation in quotes.
                        </div>
                        {item.driverRequired && (
                          <>
                            <div style={{ marginTop: '0.65rem', display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                              <span style={{ fontSize: '0.75rem', fontWeight: 600, color: '#475569' }}>Driver Meals:</span>
                              {driverMealOptions.map(o => {
                                const checked = (item.driverMeals || []).includes(o.id);
                                return (
                                  <label key={o.id} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', cursor: 'pointer', fontSize: '0.8rem', fontWeight: 600, color: '#334155' }}>
                                    <input
                                      type="checkbox"
                                      checked={checked}
                                      onChange={(e) => {
                                        const next = new Set(item.driverMeals || []);
                                        if (e.target.checked) next.add(o.id); else next.delete(o.id);
                                        handleItemFieldChange(item.tempId, 'driverMeals', [...next]);
                                      }}
                                    />
                                    {o.label}
                                  </label>
                                );
                              })}
                            </div>
                            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontSize: '0.8rem', fontWeight: 600, color: '#334155', marginTop: '0.55rem' }}>
                              <input
                                type="checkbox"
                                checked={!!item.driverAccommodation}
                                onChange={(e) => handleItemFieldChange(item.tempId, 'driverAccommodation', e.target.checked)}
                              />
                              Overnight accommodation for driver
                            </label>
                            <div style={{ fontSize: '0.72rem', color: '#64748b', marginTop: '0.5rem', lineHeight: 1.45 }}>
                              Driver meal and night costs are pulled from the Meals and Accommodation module rates in the itinerary builder.
                            </div>
                          </>
                        )}
</div>
                    )}

                    {/* GUIDE DETAILS (Guide only) */}
                    {isGuideCategory(item.category) && (
                      <div style={{ background: '#faf5ff', border: '1px solid #ddd6fe', borderRadius: '8px', padding: '0.85rem 1rem', marginTop: '1rem' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem', fontWeight: 700, color: '#6b21a8' }}>
                          <UserCheck size={16} /> Guide Details
                        </div>
                        <div style={{ fontSize: '0.72rem', color: '#7c3aed', marginTop: '0.25rem' }}>
                          The guide rate is a flat per-trip rate shared among travellers. These flags only trigger the guide's meals &amp; accommodation in quotes — costs come from the Meals and Accommodation module rates.
                        </div>
                        <div style={{ marginTop: '0.65rem', display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                          <span style={{ fontSize: '0.75rem', fontWeight: 600, color: '#475569' }}>Guide Meals:</span>
                          {driverMealOptions.map(o => {
                            const checked = (item.guideMeals || []).includes(o.id);
                            return (
                              <label key={o.id} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', cursor: 'pointer', fontSize: '0.8rem', fontWeight: 600, color: '#334155' }}>
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={(e) => {
                                    const next = new Set(item.guideMeals || []);
                                    if (e.target.checked) next.add(o.id); else next.delete(o.id);
                                    handleItemFieldChange(item.tempId, 'guideMeals', [...next]);
                                  }}
                                />
                                {o.label}
                              </label>
                            );
                          })}
                        </div>
                        <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontSize: '0.8rem', fontWeight: 600, color: '#334155', marginTop: '0.55rem' }}>
                          <input
                            type="checkbox"
                            checked={!!item.guideAccommodation}
                            onChange={(e) => handleItemFieldChange(item.tempId, 'guideAccommodation', e.target.checked)}
                          />
                          Overnight accommodation for guide
                        </label>
                      </div>
                    )}
                  </div>

                  {/* GUIDE / DRIVER ROOM RATE TOGGLE (Accommodation only) */}
                  {item.category === 'Accommodation' && dbFeatures.guideDriver && (
                    <div style={{
                      background: item.guideDriverOffered ? '#fffbeb' : '#f8fafc',
                      border: item.guideDriverOffered ? '1px solid #fde68a' : '1px solid #e2e8f0',
                      borderRadius: '10px',
                      padding: '0.85rem 1.15rem',
                      marginBottom: '1.25rem',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: '0.75rem',
                      flexWrap: 'wrap'
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.55rem' }}>
                        <Hotel size={18} color={item.guideDriverOffered ? '#d97706' : '#64748b'} />
                        <div>
                          <span style={{ fontSize: '0.85rem', fontWeight: 700, color: '#1e293b', display: 'block' }}>
                            Guide / Driver Room
                          </span>
                          <span style={{ fontSize: '0.74rem', color: item.guideDriverOffered ? '#a16207' : '#64748b' }}>
                            {item.guideDriverOffered
                              ? 'Enter the guide and driver rates and each room rule per season. The Min Client Rooms above gates both rates.'
                              : 'Not offered — guide & driver automatically use the Single Room rate.'}
                          </span>
                        </div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
                        <label style={{ fontSize: '0.85rem', fontWeight: 600, color: '#334155', display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer' }}>
                          <input
                            type="checkbox"
                            checked={item.guideDriverOffered || false}
                            onChange={(e) => handleItemFieldChange(item.tempId, 'guideDriverOffered', e.target.checked)}
                            style={{ width: '17px', height: '17px', accentColor: '#d97706', cursor: 'pointer' }}
                          />
                          Hotel offers Guide/Driver rate
                        </label>
                        {item.guideDriverOffered && dbFeatures.guideMinRooms && (
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                            <span style={{ fontSize: '0.78rem', color: '#475569', fontWeight: 600 }}>Min Client Rooms:</span>
                            <input
                              type="number"
                              min="1"
                              style={{ width: '60px', padding: '0.25rem 0.5rem', fontSize: '0.82rem' }}
                              className="pricing-select"
                              value={item.guideMinRooms ?? 1}
                              onChange={(e) => handleItemFieldChange(item.tempId, 'guideMinRooms', Math.max(1, parseInt(e.target.value, 10) || 1))}
                            />
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                  {item.category === 'Accommodation' && (
                    <div style={{
                      background: item.tourLeaderRoomOffered ? '#f0fdfa' : '#f8fafc',
                      border: item.tourLeaderRoomOffered ? '1px solid #99f6e4' : '1px solid #e2e8f0',
                      borderRadius: '10px',
                      padding: '0.85rem 1.15rem',
                      marginBottom: '1.25rem',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: '0.75rem',
                      flexWrap: 'wrap'
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.55rem' }}>
                        <UserCheck size={18} color={item.tourLeaderRoomOffered ? '#0d7478' : '#64748b'} />
                        <div>
                          <span style={{ fontSize: '0.85rem', fontWeight: 700, color: '#1e293b', display: 'block' }}>
                            Tour Leader Room
                          </span>
                          <span style={{ fontSize: '0.74rem', color: item.tourLeaderRoomOffered ? '#0f766e' : '#64748b' }}>
                            {item.tourLeaderRoomOffered
                              ? 'Enter Tour Leader rate per season below. Threshold applies to client rooms.'
                              : 'Not offered — Tour Leader uses normal Single rate.'}
                          </span>
                        </div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
                        <label style={{ fontSize: '0.85rem', fontWeight: 600, color: '#334155', display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer' }}>
                          <input
                            type="checkbox"
                            checked={item.tourLeaderRoomOffered || false}
                            onChange={(e) => handleItemFieldChange(item.tempId, 'tourLeaderRoomOffered', e.target.checked)}
                            style={{ width: '17px', height: '17px', accentColor: '#0d7478', cursor: 'pointer' }}
                          />
                          Hotel offers Tour Leader rate
                        </label>
                        {item.tourLeaderRoomOffered && (
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                            <span style={{ fontSize: '0.78rem', color: '#475569', fontWeight: 600 }}>Min Client Rooms:</span>
                            <input
                              type="number"
                              min="1"
                              style={{ width: '60px', padding: '0.25rem 0.5rem', fontSize: '0.82rem' }}
                              className="pricing-select"
                              value={item.tourLeaderMinRooms ?? 1}
                              onChange={(e) => handleItemFieldChange(item.tempId, 'tourLeaderMinRooms', Math.max(1, parseInt(e.target.value, 10) || 1))}
                            />
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* FLIGHT DETAILS CARD */}
                  {item.category === 'Flights / Charter' && (
                    <div style={{
                      background: '#ffffff',
                      border: '1px solid #e2e8f0',
                      borderRadius: '12px',
                      padding: '1.25rem',
                      marginBottom: '1.5rem',
                      boxShadow: '0 1px 3px rgba(0,0,0,0.02)'
                    }}>
                      <div style={{ marginBottom: '1rem', borderBottom: '1px solid #f1f5f9', paddingBottom: '0.75rem' }}>
                        <h4 style={{ fontSize: '0.95rem', fontWeight: 700, color: '#1e293b', margin: 0, display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                          <Plane size={18} color="#6366f1" /> Flight Details
                        </h4>
                        <span style={{ fontSize: '0.78rem', color: '#64748b' }}>
                          Optional references to identify this flight. Route and times are shown in the itinerary builder.
                        </span>
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.85rem' }}>
                        <div>
                          <label style={{ fontSize: '0.75rem', fontWeight: 600, color: '#475569', display: 'block', marginBottom: '0.25rem' }}>
                            Flight Number <span style={{ fontWeight: 400, color: '#94a3b8' }}>(optional)</span>
                          </label>
                          <input
                            type="text"
                            className="pricing-select"
                            style={{ padding: '0.4rem', fontSize: '0.85rem' }}
                            placeholder="e.g. SA 234"
                            value={item.flightNumber || ''}
                            onChange={(e) => handleItemFieldChange(item.tempId, 'flightNumber', e.target.value)}
                          />
                        </div>
                        <div>
                          <label style={{ fontSize: '0.75rem', fontWeight: 600, color: '#475569', display: 'block', marginBottom: '0.25rem' }}>
                            Airline Name <span style={{ fontWeight: 400, color: '#94a3b8' }}>(optional)</span>
                          </label>
                          <input
                            type="text"
                            className="pricing-select"
                            style={{ padding: '0.4rem', fontSize: '0.85rem' }}
                            placeholder="e.g. South African Airways"
                            value={item.airlineName || ''}
                            onChange={(e) => handleItemFieldChange(item.tempId, 'airlineName', e.target.value)}
                          />
                        </div>
                        <div>
                          <label style={{ fontSize: '0.75rem', fontWeight: 600, color: '#475569', display: 'block', marginBottom: '0.25rem' }}>
                            Departure City
                          </label>
                          <input
                            type="text"
                            className="pricing-select"
                            style={{ padding: '0.4rem', fontSize: '0.85rem' }}
                            placeholder="e.g. Johannesburg"
                            value={item.departureCity || ''}
                            onChange={(e) => handleItemFieldChange(item.tempId, 'departureCity', e.target.value)}
                          />
                        </div>
                        <div>
                          <label style={{ fontSize: '0.75rem', fontWeight: 600, color: '#475569', display: 'block', marginBottom: '0.25rem' }}>
                            Arrival City
                          </label>
                          <input
                            type="text"
                            className="pricing-select"
                            style={{ padding: '0.4rem', fontSize: '0.85rem' }}
                            placeholder="e.g. Nairobi"
                            value={item.arrivalCity || ''}
                            onChange={(e) => handleItemFieldChange(item.tempId, 'arrivalCity', e.target.value)}
                          />
                        </div>
                      </div>

                      {/* THE GUIDE'S SEAT. Suppliers fly the crew on the same
                         flight often enough that it needs saying on the item;
                         the itinerary then offers the ticket as a guide-only
                         line beside the clients' seats. */}
                      {dbFeatures.staffOptions && (
                        <div style={{ marginTop: '1rem', paddingTop: '0.9rem', borderTop: '1px solid #f1f5f9' }}>
                          <label style={{ fontSize: '0.85rem', fontWeight: 600, color: '#334155', display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer' }}>
                            <input
                              type="checkbox"
                              checked={item.guideFlightOffered || false}
                              onChange={(e) => handleItemFieldChange(item.tempId, 'guideFlightOffered', e.target.checked)}
                              style={{ width: '17px', height: '17px', accentColor: '#6366f1', cursor: 'pointer' }}
                            />
                            <UserCheck size={15} color="#6366f1" /> The supplier also sells the guide a seat
                          </label>
                          <span style={{ fontSize: '0.72rem', color: '#64748b', display: 'block', marginTop: '0.4rem', lineHeight: 1.45 }}>
                            Dropping this flight on a day offers a second line for the guide alone, at the Guide Fare on the season or, when that is blank, at the fare the clients pay. The clients are never charged for it.
                          </span>
                        </div>
                      )}
                    </div>
                  )}

                  {/* TRAIN JOURNEY DETAILS CARD */}
                  {isTrainCategory(item.category) && (
                    <div style={{
                      background: '#ffffff',
                      border: '1px solid #e2e8f0',
                      borderRadius: '12px',
                      padding: '1.25rem',
                      marginBottom: '1.5rem',
                      boxShadow: '0 1px 3px rgba(0,0,0,0.02)'
                    }}>
                      <div style={{ marginBottom: '1rem', borderBottom: '1px solid #f1f5f9', paddingBottom: '0.75rem' }}>
                        <h4 style={{ fontSize: '0.95rem', fontWeight: 700, color: '#1e293b', margin: 0, display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                          <TrainFront size={18} color="#f97316" /> Train Journey Details
                        </h4>
                        <span style={{ fontSize: '0.78rem', color: '#64748b' }}>
                          Schedule and cabin identity for this journey. The departure date is the exact date the journey departs and is used as a stop in the itinerary builder — quotes wait until itinerary dates match. Departure and arrival times are handled in the itinerary builder.
                        </span>
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.85rem' }}>
                        <div>
                          <label style={{ fontSize: '0.75rem', fontWeight: 600, color: '#475569', display: 'block', marginBottom: '0.25rem' }}>
                            Departure Date
                          </label>
                          <input
                            type="date"
                            className="pricing-select"
                            style={{ padding: '0.4rem', fontSize: '0.85rem' }}
                            value={item.trainDepartureDate || ''}
                            onChange={(e) => handleItemFieldChange(item.tempId, 'trainDepartureDate', e.target.value)}
                          />
                        </div>
                        <div>
                          <label style={{ fontSize: '0.75rem', fontWeight: 600, color: '#475569', display: 'block', marginBottom: '0.25rem' }}>
                            Journey Nights (Duration)
                          </label>
                          <input
                            type="number"
                            min="0"
                            max="30"
                            className="pricing-select"
                            style={{ padding: '0.4rem', fontSize: '0.85rem' }}
                            placeholder="e.g. 3"
                            value={item.trainJourneyNights}
                            onChange={(e) => handleItemFieldChange(item.tempId, 'trainJourneyNights', e.target.value)}
                          />
                          <span style={{ fontSize: '0.68rem', color: '#94a3b8', display: 'block' }}>Number of nights on board (e.g. 3 Nights)</span>
                        </div>
                        <div>
                          <label style={{ fontSize: '0.75rem', fontWeight: 600, color: '#475569', display: 'block', marginBottom: '0.25rem' }}>
                            Cabin (Room) Name
                          </label>
                          <input
                            type="text"
                            className="pricing-select"
                            style={{ padding: '0.4rem', fontSize: '0.85rem' }}
                            placeholder="e.g. Pullman / Royal Suite"
                            value={item.trainCabinName || ''}
                            onChange={(e) => handleItemFieldChange(item.tempId, 'trainCabinName', e.target.value)}
                          />
                        </div>
                      </div>
                    </div>
                  )}

                  {/* MEAL DETAILS CARD */}
                  {item.category === 'Meals' && (
                    <div style={{
                      background: '#ffffff',
                      border: '1px solid #e2e8f0',
                      borderRadius: '12px',
                      padding: '1.25rem',
                      marginBottom: '1.5rem',
                      boxShadow: '0 1px 3px rgba(0,0,0,0.02)'
                    }}>
                      <div style={{ marginBottom: '1rem', borderBottom: '1px solid #f1f5f9', paddingBottom: '0.75rem' }}>
                        <h4 style={{ fontSize: '0.95rem', fontWeight: 700, color: '#1e293b', margin: 0, display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                          <Utensils size={18} color="#f59e0b" /> Meal Details
                        </h4>
                        <span style={{ fontSize: '0.78rem', color: '#64748b' }}>
                          Set the type of meal, the menu style, and any gratuity to add on top of the fare.
                        </span>
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.85rem' }}>
                        <div>
                          <label style={{ fontSize: '0.75rem', fontWeight: 600, color: '#475569', display: 'block', marginBottom: '0.25rem' }}>
                            Type of Meal
                          </label>
                          <SearchableSelect
                            className="pricing-select"
                            style={{ padding: '0.4rem', fontSize: '0.85rem' }}
                            value={item.mealType || 'Breakfast'}
                            onChange={(e) => handleItemFieldChange(item.tempId, 'mealType', e.target.value)}
                          >
                            <option value="Breakfast">Breakfast</option>
                            <option value="Lunch">Lunch</option>
                            <option value="Dinner">Dinner</option>
                          </SearchableSelect>
                        </div>
                        <div>
                          <label style={{ fontSize: '0.75rem', fontWeight: 600, color: '#475569', display: 'block', marginBottom: '0.25rem' }}>
                            Menu Type
                          </label>
                          <SearchableSelect
                            className="pricing-select"
                            style={{ padding: '0.4rem', fontSize: '0.85rem' }}
                            value={item.menuType || 'a_la_carte'}
                            onChange={(e) => handleItemFieldChange(item.tempId, 'menuType', e.target.value)}
                          >
                            <option value="a_la_carte">À La Carte</option>
                            <option value="buffet">Buffet</option>
                          </SearchableSelect>
                        </div>
                        <div>
                          <label style={{ fontSize: '0.75rem', fontWeight: 600, color: '#475569', display: 'block', marginBottom: '0.25rem' }}>
                            Gratuity (%)
                          </label>
                          <input
                            type="number"
                            min="0"
                            max="100"
                            step="0.1"
                            className="pricing-select"
                            style={{ padding: '0.4rem', fontSize: '0.85rem' }}
                            placeholder="e.g. 10"
                            value={item.mealGratuityPercent !== undefined ? item.mealGratuityPercent : 0}
                            onChange={(e) => handleItemFieldChange(item.tempId, 'mealGratuityPercent', e.target.value)}
                          />
                          <span style={{ fontSize: '0.7rem', color: '#94a3b8', display: 'block' }}>Optional service gratuity added to the fare</span>
                        </div>
                      </div>

                      {/* CREW MEALS. The guide details dialog on the itinerary
                         offers the meals ticked here, so the operator never has
                         to remember which restaurant takes the crew. */}
                      {dbFeatures.staffOptions && (
                        <div style={{ marginTop: '1rem', paddingTop: '0.9rem', borderTop: '1px solid #f1f5f9' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '1.1rem', flexWrap: 'wrap' }}>
                            <label style={{ fontSize: '0.85rem', fontWeight: 600, color: '#334155', display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer' }}>
                              <input
                                type="checkbox"
                                checked={item.guideMealOffered || false}
                                onChange={(e) => handleItemFieldChange(item.tempId, 'guideMealOffered', e.target.checked)}
                                style={{ width: '17px', height: '17px', accentColor: '#f59e0b', cursor: 'pointer' }}
                              />
                              <UserCheck size={15} color="#f59e0b" /> Guide meal
                            </label>
                            <label style={{ fontSize: '0.85rem', fontWeight: 600, color: '#334155', display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer' }}>
                              <input
                                type="checkbox"
                                checked={item.driverMealOffered || false}
                                onChange={(e) => handleItemFieldChange(item.tempId, 'driverMealOffered', e.target.checked)}
                                style={{ width: '17px', height: '17px', accentColor: '#0ea5e9', cursor: 'pointer' }}
                              />
                              <Car size={15} color="#0ea5e9" /> Driver meal
                            </label>
                          </div>
                          <span style={{ fontSize: '0.72rem', color: '#64748b', display: 'block', marginTop: '0.4rem', lineHeight: 1.45 }}>
                            {item.guideMealOffered
                              ? 'The guide details dialog offers this meal, priced at its Guide Rate. Tick "Driver meal" too and the driver is charged a line of their own at the Driver Rate.'
                              : 'Unticked meals are never offered to the guide. While no meal in the library is ticked, the dialog still lists every meal so an untagged library keeps working.'}
                          </span>
                        </div>
                      )}
                    </div>
                  )}

                  {/* TRANSFER TYPE SELECTOR */}
                  {item.category === 'Transfers' && (
                    <div style={{
                      background: '#ffffff',
                      border: '1px solid #e2e8f0',
                      borderRadius: '12px',
                      padding: '1.25rem',
                      marginBottom: '1.5rem',
                      boxShadow: '0 1px 3px rgba(0,0,0,0.02)'
                    }}>
                      <div style={{ marginBottom: '1rem', borderBottom: '1px solid #f1f5f9', paddingBottom: '0.75rem' }}>
                        <h4 style={{ fontSize: '0.95rem', fontWeight: 700, color: '#1e293b', margin: 0, display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                          <Navigation size={18} color="#863bff" /> Transfer Type <span style={{ color: '#ef4444' }}>*</span>
                        </h4>
                        <span style={{ fontSize: '0.78rem', color: '#64748b' }}>
                          Each type is priced differently, so pick the one that matches how this transfer is used.
                        </span>
                      </div>

                      {!dbFeatures.transferType && (
                        <div style={{ background: '#fefce8', border: '1px solid #facc15', borderRadius: '6px', padding: '0.5rem 0.75rem', marginBottom: '0.75rem', fontSize: '0.74rem', fontWeight: 600, color: '#854d0e' }}>
                          Transfer Type isn't available in this workspace yet, so transfers are saved as a standard transfer.
                        </div>
                      )}

                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.6rem' }}>
                        {transferTypes.map(tt => {
                          const selected = item.transferType === tt.id;
                          return (
                            <button
                              key={tt.id}
                              type="button"
                              onClick={() => {
                                handleItemFieldChange(item.tempId, 'transferType', tt.id);
                                if (item.driverRequired) {
                                  handleItemFieldChange(item.tempId, 'driverMeals', getDefaultDriverMeals(item.category, tt.id));
                                  handleItemFieldChange(item.tempId, 'driverAccommodation', getDefaultDriverAccommodation(item.category, tt.id));
                                }
                              }}
                              style={{
                                background: selected ? '#f5f3ff' : '#f8fafc',
                                border: selected ? '2px solid #a855f7' : '1px solid #e2e8f0',
                                borderRadius: '10px',
                                padding: '0.75rem 0.85rem',
                                textAlign: 'left',
                                cursor: 'pointer',
                                transition: 'all 0.15s ease'
                              }}
                            >
                              <span style={{ fontWeight: 700, fontSize: '0.85rem', color: selected ? '#7c3aed' : '#1e293b', display: 'block' }}>
                                {tt.icon} {tt.label} {selected && '✓'}
                              </span>
                              <span style={{ fontSize: '0.72rem', color: '#64748b', display: 'block', marginTop: '0.2rem', lineHeight: 1.35 }}>
                                {tt.description}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* TOUR TYPE SELECTOR (Activities / Tours only) */}
                  {item.category === 'Activities / Tours' && (
                    <div style={{
                      background: '#ffffff',
                      border: '1px solid #e2e8f0',
                      borderRadius: '12px',
                      padding: '1.25rem',
                      marginBottom: '1.5rem',
                      boxShadow: '0 1px 3px rgba(0,0,0,0.02)'
                    }}>
                      <div style={{ marginBottom: '1rem', borderBottom: '1px solid #f1f5f9', paddingBottom: '0.75rem' }}>
                        <h4 style={{ fontSize: '0.95rem', fontWeight: 700, color: '#1e293b', margin: 0, display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                          <Compass size={18} color="#10b981" /> Tour Type <span style={{ color: '#ef4444' }}>*</span>
                        </h4>
                        <span style={{ fontSize: '0.78rem', color: '#64748b' }}>
                          This labels the service in the itinerary builder (Short Experience, Half Day, Full Day, Escorted Dinner / Lunch, or Overland Transfer).
                        </span>
                      </div>

                      {!dbFeatures.tourType && (
                        <div style={{ background: '#fefce8', border: '1px solid #facc15', borderRadius: '6px', padding: '0.5rem 0.75rem', marginBottom: '0.75rem', fontSize: '0.74rem', fontWeight: 600, color: '#854d0e' }}>
                          Tour Type isn't available in this workspace yet, so tours are saved without a type.
                        </div>
                      )}

                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.6rem' }}>
                        {tourTypes.map(tt => {
                          const selected = item.tourType === tt.id;
                          return (
                            <button
                              key={tt.id}
                              type="button"
                              onClick={() => handleItemFieldChange(item.tempId, 'tourType', tt.id)}
                              style={{
                                background: selected ? '#ecfdf5' : '#f8fafc',
                                border: selected ? '2px solid #10b981' : '1px solid #e2e8f0',
                                borderRadius: '10px',
                                padding: '0.75rem 0.85rem',
                                textAlign: 'left',
                                cursor: 'pointer',
                                transition: 'all 0.15s ease'
                              }}
                            >
                              <span style={{ fontWeight: 700, fontSize: '0.85rem', color: selected ? '#047857' : '#1e293b', display: 'block' }}>
                                {tt.icon} {tt.label} {selected && '✓'}
                              </span>
                              <span style={{ fontSize: '0.72rem', color: '#64748b', display: 'block', marginTop: '0.2rem', lineHeight: 1.35 }}>
                                {tt.description}
                              </span>
                            </button>
                          );
                        })}
                      </div>

                      {/* A tour that needs a crowd to depart is a different product
                          from one that runs whoever walks up, and the supplier states
                          it once for the item, not per season. */}
                      {dbFeatures.minPaxToRun && (
                        <div style={{ marginTop: '1rem', paddingTop: '0.9rem', borderTop: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', gap: '0.7rem', flexWrap: 'wrap' }}>
                          <label style={{ fontSize: '0.82rem', fontWeight: 700, color: '#1e293b' }} htmlFor={`min-pax-${item.tempId}`}>
                            Minimum guests to run
                          </label>
                          <input
                            id={`min-pax-${item.tempId}`}
                            type="number"
                            min="0"
                            step="1"
                            placeholder="none"
                            className="pricing-select"
                            style={{ width: '110px' }}
                            value={item.minPaxToRun ?? ''}
                            onChange={(e) => handleItemFieldChange(item.tempId, 'minPaxToRun', e.target.value)}
                          />
                          <span style={{ fontSize: '0.74rem', color: '#64748b' }}>
                            Leave blank when the supplier runs it for any party size.
                          </span>
                        </div>
                      )}
                    </div>
                  )}

                  {/* TRANSPORT TYPE SELECTOR (Transport only) */}
                  {isTransportCategory(item.category) && (
                    <div style={{
                      background: '#ffffff',
                      border: '1px solid #e2e8f0',
                      borderRadius: '12px',
                      padding: '1.25rem',
                      marginBottom: '1.5rem',
                      boxShadow: '0 1px 3px rgba(0,0,0,0.02)'
                    }}>
                      <div style={{ marginBottom: '1rem', borderBottom: '1px solid #f1f5f9', paddingBottom: '0.75rem' }}>
                        <h4 style={{ fontSize: '0.95rem', fontWeight: 700, color: '#1e293b', margin: 0, display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                          <BusFront size={18} color="#0ea5e9" /> Transport Type <span style={{ color: '#ef4444' }}>*</span>
                        </h4>
                        <span style={{ fontSize: '0.78rem', color: '#64748b' }}>
                          What the vehicle is hired for. It decides what the itinerary allows for the driver on the day.
                        </span>
                      </div>

                      {!dbFeatures.transportType && (
                        <div style={{ background: '#fefce8', border: '1px solid #facc15', borderRadius: '6px', padding: '0.5rem 0.75rem', marginBottom: '0.75rem', fontSize: '0.74rem', fontWeight: 600, color: '#854d0e' }}>
                          Transport Type isn't available in this workspace yet, so transport is saved without a type.
                        </div>
                      )}

                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.6rem' }}>
                        {transportTypes.map(tt => {
                          const selected = item.transportType === tt.id;
                          return (
                            <button
                              key={tt.id}
                              type="button"
                              onClick={() => {
                                handleItemFieldChange(item.tempId, 'transportType', tt.id);
                                if (item.driverRequired) {
                                  handleItemFieldChange(item.tempId, 'driverMeals', getDefaultDriverMeals(item.category, tt.id));
                                  handleItemFieldChange(item.tempId, 'driverAccommodation', getDefaultDriverAccommodation(item.category, tt.id));
                                }
                              }}
                              style={{
                                background: selected ? '#f0f9ff' : '#f8fafc',
                                border: selected ? '2px solid #0ea5e9' : '1px solid #e2e8f0',
                                borderRadius: '10px',
                                padding: '0.75rem 0.85rem',
                                textAlign: 'left',
                                cursor: 'pointer',
                                transition: 'all 0.15s ease'
                              }}
                            >
                              <span style={{ fontWeight: 700, fontSize: '0.85rem', color: selected ? '#0369a1' : '#1e293b', display: 'block' }}>
                                {tt.icon} {tt.label} {selected && '✓'}
                              </span>
                              <span style={{ fontSize: '0.72rem', color: '#64748b', display: 'block', marginTop: '0.2rem', lineHeight: 1.35 }}>
                                {tt.description}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* PROPERTY, ROOM TYPES & STAR GRADING CARD */}
                  {item.category === 'Accommodation' && roomsReady && (() => {
                    const rooms = item.roomTypes || [];
                    const activeKey = activeRoomKeyFor(item);
                    const currentGrade = supplierStarValue();
                    /* Legacy accommodation rows were backfilled with the old item
                       name, which used to be the room type, so the property and its
                       one room read the same. Name the property after the lodge. */
                    const propertyName = String(item.name || '').trim().toLowerCase();
                    const roomNameMatchesProperty = !!propertyName && rooms.some(
                      (room) => String(room.name || '').trim().toLowerCase() === propertyName
                    );
                    const numberCell = (roomKey, label, field, value, min, blankLabel = '') => (
                      <div>
                        <label style={{ fontSize: '0.7rem', fontWeight: 600, color: '#64748b', display: 'block', marginBottom: '0.2rem' }}>{label}</label>
                        <input
                          type="number"
                          min={min}
                          max="30"
                          className="pricing-select"
                          style={{ width: '100%', padding: '0.35rem 0.45rem', fontSize: '0.85rem', fontWeight: 700, textAlign: 'center' }}
                          placeholder={blankLabel || undefined}
                          value={value === null || value === undefined ? '' : value}
                          onChange={(e) => handleUpdateRoom(item.tempId, roomKey, field, e.target.value)}
                        />
                      </div>
                    );
                    return (
                      <div style={{
                        background: '#ffffff',
                        border: '1px solid #dbeafe',
                        borderRadius: '12px',
                        padding: '1.25rem',
                        marginBottom: '1.5rem',
                        boxShadow: '0 1px 3px rgba(0,0,0,0.02)'
                      }}>
                        <div style={{ marginBottom: '1rem', borderBottom: '1px solid #f1f5f9', paddingBottom: '0.75rem' }}>
                          <h4 style={{ fontSize: '0.95rem', fontWeight: 700, color: '#1e293b', margin: 0, display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                            <BedDouble size={18} color="#0369a1" /> Property, room types &amp; grading
                          </h4>
                          <span style={{ fontSize: '0.78rem', color: '#64748b' }}>
                            One supplier, one property, several room types. Each room carries its own seasons and rates below;
                            the itinerary asks which room the travellers are in.
                          </span>
                        </div>

                        {roomNameMatchesProperty && (
                          <div style={{
                            background: '#fffbeb', border: '1px solid #fde68a', borderRadius: '9px',
                            padding: '0.6rem 0.8rem', marginBottom: '1rem', fontSize: '0.76rem',
                            color: '#92400e', lineHeight: 1.45
                          }}>
                            This property carries the same name as one of its rooms. Rename the property
                            above to the lodge or guesthouse itself (e.g. “Oudtshoorn Lodge”) and keep the
                            room name here as the type it sells.
                          </div>
                        )}

                        {/* Star grading — a property grade, not a room one. */}
                        <div style={{
                          display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0.75rem',
                          background: '#fffbeb', border: '1px solid #fde68a', borderRadius: '9px',
                          padding: '0.7rem 0.9rem', marginBottom: '1rem'
                        }}>
                          <div style={{ flex: '1', minWidth: '220px' }}>
                            <span style={{ fontSize: '0.82rem', fontWeight: 700, color: '#92400e', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                              <Star size={14} color="#d97706" /> Star grading
                            </span>
                            <span style={{ fontSize: '0.72rem', color: '#a16207', display: 'block', marginTop: '0.15rem' }}>
                              A grade for the property (the supplier), not for one room — every room here inherits it.
                            </span>
                          </div>
                          {starColumnReady ? (
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.1rem' }}>
                              {STAR_GRADES.map((grade) => (
                                <button
                                  key={grade}
                                  type="button"
                                  title={currentGrade === grade ? `${grade}-star (click to clear)` : `${grade}-star`}
                                  aria-label={`${grade}-star`}
                                  onClick={() => handleStarGradeChange(currentGrade === grade ? null : grade)}
                                  style={{
                                    background: 'none', border: 'none', cursor: 'pointer', lineHeight: 1,
                                    fontSize: '1.4rem', padding: '0.1rem 0.12rem',
                                    color: currentGrade && grade <= currentGrade ? '#f59e0b' : '#cbd5e1'
                                  }}
                                >
                                  ★
                                </button>
                              ))}
                              <button
                                type="button"
                                onClick={() => handleStarGradeChange(null)}
                                style={{
                                  marginLeft: '0.45rem', fontSize: '0.72rem', padding: '0.2rem 0.55rem',
                                  border: '1px solid #fcd34d', background: currentGrade ? '#fff' : '#fef3c7',
                                  color: '#92400e', borderRadius: '6px', cursor: 'pointer', fontWeight: 600
                                }}
                              >
                                Not graded
                              </button>
                            </div>
                          ) : (
                            <span style={{ fontSize: '0.74rem', color: '#92400e' }}>
                              Star grading needs its migration before it can be saved.
                            </span>
                          )}
                        </div>

                        {/* One row per room type the property sells. */}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                          {rooms.map((room) => {
                            return (
                              <div
                                key={room.key}
                                style={{
                                  display: 'grid',
                                  gridTemplateColumns: 'minmax(150px, 1.4fr) repeat(3, minmax(74px, 0.55fr)) minmax(190px, 1fr) auto',
                                  gap: '0.5rem',
                                  alignItems: 'end',
                                  background: '#f8fafc',
                                  border: `1px solid ${room.key === activeKey ? '#7dd3fc' : '#e2e8f0'}`,
                                  borderRadius: '8px',
                                  padding: '0.55rem 0.65rem'
                                }}
                              >
                                <div>
                                  <label style={{ fontSize: '0.7rem', fontWeight: 600, color: '#64748b', display: 'block', marginBottom: '0.2rem' }}>Room type</label>
                                  <input
                                    type="text"
                                    className="pricing-select"
                                    style={{ width: '100%', padding: '0.35rem 0.45rem', fontSize: '0.85rem', fontWeight: 600 }}
                                    placeholder="e.g. Garden Suite"
                                    value={room.name}
                                    onChange={(e) => handleUpdateRoom(item.tempId, room.key, 'name', e.target.value)}
                                  />
                                </div>
                                {numberCell(room.key, 'Sleeps', 'maxOccupancy', room.maxOccupancy, 1)}
                                {numberCell(room.key, 'Max adults', 'maxAdults', room.maxAdults, 1)}
                                {numberCell(room.key, 'Max children', 'maxChildren', room.maxChildren, 0, 'any')}
                                {dbFeatures.occupancyPricing && (
                                <div>
                                  <label style={{ fontSize: '0.7rem', fontWeight: 600, color: '#64748b', display: 'block', marginBottom: '0.2rem' }}>Charged by</label>
                                  <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
                                    <select
                                      className="pricing-select"
                                      style={{ flex: 1, padding: '0.35rem 0.4rem', fontSize: '0.78rem' }}
                                      value={roomPricingModelOf(room, item)}
                                      onChange={(e) => handleUpdateRoom(item.tempId, room.key, 'pricingModel', e.target.value)}
                                    >
                                      <option value="per_person_sharing">Per person sharing</option>
                                      <option value="per_room">Whole room</option>
                                      <option value={OCCUPANCY_BASIS}>Per person by occupancy</option>
                                    </select>
                                    {isOccupancyRoom(room, item) && (
                                      <label style={{ fontSize: '0.68rem', color: '#64748b', display: 'flex', alignItems: 'center', gap: '0.25rem', whiteSpace: 'nowrap' }}>
                                        from
                                        <input
                                          type="number"
                                          min={1}
                                          max={room.maxOccupancy}
                                          className="pricing-select"
                                          style={{ width: '3.2rem', padding: '0.3rem 0.35rem', fontSize: '0.78rem' }}
                                          value={room.occupancyFrom ?? 2}
                                          onChange={(e) => handleUpdateRoom(item.tempId, room.key, 'occupancyFrom', e.target.value)}
                                        />
                                        pax
                                      </label>
                                    )}
                                  </div>
                                </div>
                                )}
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', paddingBottom: '0.05rem' }}>
                                  <button
                                    type="button"
                                    onClick={() => setActiveRoomByItem(prev => ({ ...prev, [item.tempId]: room.key }))}
                                    style={{
                                      fontSize: '0.7rem', fontWeight: 600, padding: '0.3rem 0.5rem', borderRadius: '6px',
                                      cursor: 'pointer', whiteSpace: 'nowrap',
                                      border: `1px solid ${room.key === activeKey ? '#0369a1' : '#cbd5e1'}`,
                                      background: room.key === activeKey ? '#e0f2fe' : '#fff',
                                      color: room.key === activeKey ? '#0369a1' : '#475569'
                                    }}
                                  >
                                    {room.key === activeKey ? 'Pricing below' : 'Price this room'}
                                  </button>
                                  <button
                                    type="button"
                                    title="Remove room type"
                                    aria-label="Remove room type"
                                    disabled={rooms.length <= 1}
                                    onClick={() => handleRemoveRoom(item.tempId, room.key)}
                                    style={{
                                      background: 'none', border: 'none', padding: '0.2rem', cursor: rooms.length <= 1 ? 'not-allowed' : 'pointer',
                                      color: rooms.length <= 1 ? '#cbd5e1' : '#ef4444'
                                    }}
                                  >
                                    <Trash2 size={14} />
                                  </button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap', marginTop: '0.55rem' }}>
                          <button
                            type="button"
                            className="secondary-btn"
                            style={{ padding: '0.4rem 0.85rem', fontSize: '0.8rem', display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}
                            onClick={() => handleAddRoom(item.tempId)}
                          >
                            <Plus size={13} /> Add room type
                          </button>
                          <span style={{ fontSize: '0.72rem', color: '#64748b', lineHeight: 1.4 }}>
                            Leave Max children blank when the property does not tell adults and children apart - the room
                            then takes any mix up to its Sleeps. Type a number only for a room that caps them, and 0 for
                            one that takes no children.
                          </span>
                        </div>
                      </div>
                    );
                  })()}

                  {/* MAXIMUM OCCUPANCY & CAPACITY CARD */}
                  {isTourStyle ? (
                    <div style={{
                      background: '#ffffff',
                      border: '1px solid #e2e8f0',
                      borderRadius: '12px',
                      padding: '1.25rem',
                      marginBottom: '1.5rem',
                      boxShadow: '0 1px 3px rgba(0,0,0,0.02)'
                    }}>
                      <div style={{ marginBottom: '1rem', borderBottom: '1px solid #f1f5f9', paddingBottom: '0.75rem' }}>
                        <h4 style={{ fontSize: '0.95rem', fontWeight: 700, color: '#1e293b', margin: 0, display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                          {item.category === 'Flights / Charter'
                            ? <Plane size={18} color="#6366f1" />
                            : isTransportCategory(item.category)
                              ? <BusFront size={18} color="#0ea5e9" />
                              : <Bus size={18} color="#3b82f6" />} {item.category === 'Transfers' || isTransportCategory(item.category) ? 'Vehicle Capacity' : item.category === 'Flights / Charter' ? 'Seat Capacity' : 'Transport Capacity'}
                        </h4>
                        <span style={{ fontSize: '0.78rem', color: '#64748b' }}>
                          {item.category === 'Transfers'
                            ? 'The seats of the vehicle type picked above. The price is whatever the transfer contracts; the capacity decides how many of these vehicles a party needs.'
                            : item.category === 'Flights / Charter'
                              ? 'Maximum number of passengers (pax) seats on this flight.'
                              : isTransportCategory(item.category)
                                ? 'Seats in this vehicle. A Transport item is hired whole, so the party that fits is the party it prices.'
                                : 'Maximum number of passengers (pax) per activity / tour departure.'}
                        </span>
                      </div>
                      <div style={{ background: '#f8fafc', padding: '0.85rem 1rem', borderRadius: '8px', border: '1px solid #e2e8f0', display: 'flex', alignItems: 'flex-end', gap: '0.6rem', flexWrap: 'wrap' }}>
                        <div style={{ flex: '1', minWidth: '180px' }}>
                          <span style={{ fontSize: '0.82rem', fontWeight: 700, color: '#1e293b', display: 'block' }}>Maximum Occupancy</span>
                          <span style={{ fontSize: '0.7rem', color: '#64748b' }}>{item.category === 'Flights / Charter' ? 'Max passengers (seats) on the flight' : item.category === 'Transfers' ? 'Seats the chosen vehicle type carries — pick the type above and this follows it' : 'Max pax allowed — set the capacity for your vehicle type'}</span>
                          <input
                            type="number"
                            min="1"
                            max={isTransportCategory(item.category) ? '90' : '60'}
                            className="pricing-select"
                            style={{ width: '100%', padding: '0.4rem 0.6rem', fontSize: '0.95rem', fontWeight: 700, textAlign: 'center', marginTop: '0.35rem' }}
                            value={item.maxOccupancy}
                            onChange={(e) => {
                              const newMax = Math.max(1, parseInt(e.target.value) || 1);
                              setItemsToSave(prev => prev.map(it => {
                                if (it.tempId === item.tempId) return { ...it, maxOccupancy: newMax };
                                return it;
                              }));
                            }}
                          />
                        </div>
                        <span style={{ fontSize: '0.85rem', color: '#3b82f6', fontWeight: 700, paddingBottom: '0.5rem' }}>Max Pax</span>
                      </div>
                      {item.vehicleType && (
                        <div style={{ padding: '0.75rem 1rem', borderRadius: '8px', background: '#eff6ff', border: '1px solid #bfdbfe', fontSize: '0.8rem', color: '#1e40af', marginTop: '1rem' }}>
                          🚐 <strong>{item.vehicleType}</strong> — accommodates up to <strong>{item.maxOccupancy} pax</strong>.
                        </div>
                      )}
                    </div>
                  ) : (item.category === 'Accommodation' || isTrainCategory(item.category)) ? (
                  <div style={{
                    background: '#ffffff',
                    border: '1px solid #e2e8f0',
                    borderRadius: '12px',
                    padding: '1.25rem',
                    marginBottom: '1.5rem',
                    boxShadow: '0 1px 3px rgba(0,0,0,0.02)'
                  }}>
                    <div style={{ marginBottom: '1rem', borderBottom: '1px solid #f1f5f9', paddingBottom: '0.75rem' }}>
                      <h4 style={{ fontSize: '0.95rem', fontWeight: 700, color: '#1e293b', margin: 0, display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                        <Users size={18} color="#00665c" /> {isTrainCategory(item.category) ? 'Cabin Occupancy & Capacity Limits' : 'Room Occupancy & Capacity Limits'}
                      </h4>
                      <span style={{ fontSize: '0.78rem', color: '#64748b' }}>
                        {isTrainCategory(item.category)
                          ? 'Configure maximum capacity per cabin for all-adult parties and conditional child sharing allowances.'
                          : 'Configure maximum capacity per room for all-adult parties and conditional child sharing allowances.'}
                      </span>
                    </div>

                    {/* Overall Capacity Ceilings Grid */}
                    {item.category === 'Accommodation' && roomsReady ? (
                      <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: '8px', padding: '0.75rem 1rem', marginBottom: '1.25rem', fontSize: '0.78rem', color: '#1e40af', lineHeight: 1.5 }}>
                        <strong>Room ceilings come from the room types above.</strong> The property accepts up to{' '}
                        <strong>{Math.max(0, ...(item.roomTypes || []).map(room => parseInt(room.maxOccupancy) || 0)) || 2} guests</strong> in one room.
                        Each room&rsquo;s own sleeps / adults / children limits are set on its room type; the itinerary allocates travellers into
                        the room they are priced in. The child sharing rules below stay property-wide because they follow the supplier contract.
                      </div>
                    ) : (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem', marginBottom: '1.25rem' }}>

                      {/* Max Total Capacity */}
                      <div style={{ background: '#f8fafc', padding: '0.85rem 1rem', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                        <div style={{ marginBottom: '0.4rem' }}>
                          <span style={{ fontSize: '0.82rem', fontWeight: 700, color: '#1e293b', display: 'block' }}>Max Total Capacity</span>
                          <span style={{ fontSize: '0.7rem', color: '#64748b' }}>{isTrainCategory(item.category) ? 'Overall cabin limit (Adults + Children)' : 'Overall room limit (Adults + Children)'}</span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                          <input
                            type="number"
                            min="1"
                            max="30"
                            className="pricing-select"
                            style={{ width: '100%', padding: '0.4rem 0.6rem', fontSize: '0.95rem', fontWeight: 700, textAlign: 'center' }}
                            value={item.maxOccupancy}
                            onChange={(e) => {
                              const newMax = Math.max(1, parseInt(e.target.value) || 1);
                              const newAdults = Math.min(newMax, parseInt(item.maxAdults) || 2);
                              setItemsToSave(prev => prev.map(it => {
                                if (it.tempId === item.tempId) {
                                  const updatedRules = ensureSharingRules(newAdults, newMax, it.sharingCapacityRules);
                                  return {
                                    ...it,
                                    maxOccupancy: newMax,
                                    maxAdults: newAdults,
                                    sharingCapacityRules: updatedRules
                                  };
                                }
                                return it;
                              }));
                            }}
                          />
                          <span style={{ fontSize: '0.75rem', color: '#64748b', whiteSpace: 'nowrap' }}>Guests</span>
                        </div>
                      </div>

                      {/* Max Adults Limit */}
                      <div style={{ background: '#f8fafc', padding: '0.85rem 1rem', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                        <div style={{ marginBottom: '0.4rem' }}>
                          <span style={{ fontSize: '0.82rem', fontWeight: 700, color: '#1e293b', display: 'block' }}>Max Adults Limit</span>
                          <span style={{ fontSize: '0.7rem', color: '#64748b' }}>Limit when occupied by adults only</span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                          <input
                            type="number"
                            min="1"
                            max={item.maxOccupancy || 20}
                            className="pricing-select"
                            style={{ width: '100%', padding: '0.4rem 0.6rem', fontSize: '0.95rem', fontWeight: 700, textAlign: 'center' }}
                            value={item.maxAdults !== undefined ? item.maxAdults : item.maxOccupancy}
                            onChange={(e) => {
                              const val = Math.max(1, parseInt(e.target.value) || 1);
                              const capped = Math.min(parseInt(item.maxOccupancy) || 2, val);
                              setItemsToSave(prev => prev.map(it => {
                                if (it.tempId === item.tempId) {
                                  const updatedRules = ensureSharingRules(capped, it.maxOccupancy, it.sharingCapacityRules);
                                  return {
                                    ...it,
                                    maxAdults: capped,
                                    sharingCapacityRules: updatedRules
                                  };
                                }
                                return it;
                              }));
                            }}
                          />
                          <span style={{ fontSize: '0.75rem', color: '#64748b', whiteSpace: 'nowrap' }}>Adults</span>
                        </div>
                      </div>

                    </div>
                    )}

                    {/* Conditional Sharing Capacity Controller */}
                    <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '1rem', marginBottom: '1.25rem' }}>
                      <div style={{ marginBottom: '0.75rem' }}>
                        <span style={{ fontSize: '0.82rem', fontWeight: 700, color: '#1e293b', display: 'block' }}>
                          Child Sharing Rules per Adult Count
                        </span>
                        <span style={{ fontSize: '0.72rem', color: '#64748b' }}>
                          {isTrainCategory(item.category)
                            ? 'Specify how many children are permitted to share when the cabin has 1, 2, or 3 adults.'
                            : 'Specify how many children are permitted to share when the room has 1, 2, or 3 adults.'}
                        </span>
                      </div>

                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                        {(item.sharingCapacityRules || ensureSharingRules(item.maxAdults || 2, item.maxOccupancy || 2, [])).map((rule) => {                          const currentAdults = rule.adults;
                          const maxAllowedForThisRow = Math.max(0, roomCeiling - currentAdults);
                          const childrenVal = Math.min(maxAllowedForThisRow, Math.max(0, parseInt(rule.maxChildren) || 0));
                          const effectiveTotal = currentAdults + childrenVal;

                          return (
                            <div key={currentAdults} style={{
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              background: '#ffffff',
                              border: '1px solid #e2e8f0',
                              borderRadius: '6px',
                              padding: '0.55rem 0.85rem',
                              flexWrap: 'wrap',
                              gap: '0.5rem'
                            }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                <span style={{
                                  background: '#00665c',
                                  color: '#ffffff',
                                  fontWeight: 700,
                                  fontSize: '0.75rem',
                                  padding: '0.2rem 0.55rem',
                                  borderRadius: '4px'
                                }}>
                                  {currentAdults} {currentAdults === 1 ? 'Adult' : 'Adults'}
                                </span>
                                <span style={{ fontSize: '0.8rem', color: '#334155', fontWeight: 600 }}>
                                  {isTrainCategory(item.category) ? 'in cabin allows:' : 'in room allows:'}
                                </span>
                              </div>

                              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                                  <span style={{ fontSize: '0.78rem', color: '#64748b' }}>Max Children:</span>
                                  <input
                                    type="number"
                                    min="0"
                                    max={maxAllowedForThisRow}
                                    value={rule.maxChildren !== undefined ? rule.maxChildren : childrenVal}
                                    onChange={(e) => handleSharingRuleChange(item.tempId, currentAdults, e.target.value)}
                                    style={{ width: '60px', padding: '0.25rem 0.4rem', fontSize: '0.85rem', fontWeight: 700, textAlign: 'center', border: '1px solid #cbd5e1', borderRadius: '5px' }}
                                  />
                                </div>

                                <span style={{
                                  fontSize: '0.75rem',
                                  fontWeight: 600,
                                  color: childrenVal === 0 ? '#b45309' : '#15803d',
                                  background: childrenVal === 0 ? '#fffbeb' : '#f0fdf4',
                                  padding: '0.25rem 0.6rem',
                                  borderRadius: '5px',
                                  border: `1px solid ${childrenVal === 0 ? '#fde68a' : '#bbf7d0'}`
                                }}>
                                  {childrenVal === 0
                                    ? `Max ${effectiveTotal} Guests (${currentAdults} Adults only, No children)`
                                    : `Max ${effectiveTotal} Guests (${currentAdults} Adults + ${childrenVal} Child${childrenVal > 1 ? 'ren' : ''})`}
                                </span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    {/* Children in their own room: a property-wide contract term
                        the room engine enforces when no adult shares the room. */}
                    {/accommodation|train/i.test(String(item.category || '')) && (
                      <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '0.85rem 1rem', marginBottom: '1.25rem' }}>
                        <label style={{ fontSize: '0.82rem', fontWeight: 700, color: '#1e293b', display: 'block', marginBottom: '0.25rem' }}>
                          Children in Their Own Room
                        </label>
                        <span style={{ fontSize: '0.72rem', color: '#64748b', display: 'block', marginBottom: '0.5rem' }}>
                          Applies when a room holds children only — children sharing with adults always pay their child band rates.
                        </span>
                        <SearchableSelect
                          className="pricing-select"
                          value={item.childrenOwnRoomPolicy || 'child_rates'}
                          onChange={(e) => handleItemFieldChange(item.tempId, 'childrenOwnRoomPolicy', e.target.value)}
                        >
                          <option value="child_rates">Charge child band rates</option>
                          <option value="adult_rates">Charge standard adult rates (1 child: single rate · 2: sharing rate each)</option>
                          <option value="single_room_rate">Charge one single room rate for the whole room</option>
                        </SearchableSelect>
                      </div>
                    )}

                    {/* Capacity Summary Badge */}
                    <div style={{
                      padding: '0.75rem 1rem',
                      borderRadius: '8px',
                      background: '#f0fdf4',
                      border: '1px solid #bbf7d0',
                      fontSize: '0.8rem',
                      color: '#166534',
                      marginBottom: '1.25rem'
                    }}>
                      <div style={{ fontWeight: 700, marginBottom: '0.25rem', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                        💡 Capacity & Sharing Rules Summary:
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.15rem', marginLeft: '0.5rem' }}>
                        {(item.sharingCapacityRules || ensureSharingRules(item.maxAdults || 2, item.maxOccupancy || 2, [])).map(r => {
                          const ch = Math.max(0, parseInt(r.maxChildren) || 0);
                          return (
                            <div key={r.adults}>
                              • <strong>{r.adults} {r.adults === 1 ? 'Adult' : 'Adults'}:</strong> {ch === 0 ? '0 Children (Max ' + r.adults + ' Guests only)' : 'Up to ' + ch + ' Child' + (ch > 1 ? 'ren' : '') + ' sharing (Max ' + (r.adults + ch) + ' Guests)'}
                            </div>
                          );
                        })}
                        <div style={{ marginTop: '0.2rem', color: '#15803d', fontWeight: 600 }}>
                          • {isTrainCategory(item.category) ? 'Cabin Ceiling' : 'Room Ceiling'}: <strong>{roomCeiling} Total Guests</strong>
                        </div>
                      </div>
                    </div>

                    {/* ── Child Age Range Configuration (per supplier contract) ── */}
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                        <span style={{ fontSize: '0.82rem', fontWeight: 700, color: '#334155' }}>
                          Child Age Ranges (per supplier contract)
                        </span>
                        <button
                          type="button"
                          onClick={() => handleAddChildAgeBand(item.tempId)}
                          style={{ fontSize: '0.75rem', padding: '0.25rem 0.65rem', background: '#f0fdf4', color: '#00665c', border: '1px solid #bbf7d0', borderRadius: '6px', cursor: 'pointer', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}
                        >
                          <Plus size={13} /> Add Age Tier
                        </button>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                        {(item.childAgeRanges || []).map((band, bandIdx) => (
                          <div key={band.id} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '7px', padding: '0.45rem 0.65rem' }}>
                            <input
                              type="text"
                              value={band.name}
                              onChange={(e) => handleUpdateChildAgeBand(item.tempId, bandIdx, 'name', e.target.value)}
                              placeholder="Name"
                              style={{ flex: '1', minWidth: '80px', fontSize: '0.8rem', padding: '0.25rem 0.4rem', border: '1px solid #cbd5e1', borderRadius: '5px', fontWeight: 600, color: '#1e293b' }}
                            />
                            <span style={{ fontSize: '0.75rem', color: '#64748b', whiteSpace: 'nowrap' }}>Ages</span>
                            <input
                              type="number"
                              min="0"
                              value={band.ageFrom}
                              onChange={(e) => handleUpdateChildAgeBand(item.tempId, bandIdx, 'ageFrom', e.target.value)}
                              style={{ width: '52px', fontSize: '0.8rem', padding: '0.25rem 0.35rem', border: '1px solid #cbd5e1', borderRadius: '5px', textAlign: 'center' }}
                            />
                            <span style={{ fontSize: '0.75rem', color: '#64748b' }}>–</span>
                            <input
                              type="number"
                              min="0"
                              value={band.ageTo}
                              onChange={(e) => handleUpdateChildAgeBand(item.tempId, bandIdx, 'ageTo', e.target.value)}
                              style={{ width: '52px', fontSize: '0.8rem', padding: '0.25rem 0.35rem', border: '1px solid #cbd5e1', borderRadius: '5px', textAlign: 'center' }}
                            />
                            <span style={{ fontSize: '0.72rem', color: '#94a3b8' }}>yrs</span>
                            {(item.childAgeRanges || []).length > 1 && (
                              <button
                                type="button"
                                onClick={() => handleRemoveChildAgeBand(item.tempId, bandIdx)}
                                style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', padding: '0.1rem', lineHeight: 1 }}
                                title="Remove age tier"
                              >
                                <X size={14} />
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>

                  </div>
                  ) : null}

                  {/* TICKET DETAILS CARD */}
                  {isTicketCategory(item.category) ? (
                  <div style={{
                    background: '#ffffff',
                    border: '1px solid #e2e8f0',
                    borderRadius: '12px',
                    padding: '1.25rem',
                    marginBottom: '1.5rem',
                    boxShadow: '0 1px 3px rgba(0,0,0,0.02)'
                  }}>
                    <div style={{ marginBottom: '1rem', borderBottom: '1px solid #f1f5f9', paddingBottom: '0.75rem' }}>
                      <h4 style={{ fontSize: '0.95rem', fontWeight: 700, color: '#1e293b', margin: 0, display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                        <Ticket size={18} color="#14b8a6" /> Ticket Details
                      </h4>
                      <span style={{ fontSize: '0.78rem', color: '#64748b' }}>
                        Tickets are always quoted per person. Set the child age ranges used for children pricing below.
                      </span>
                    </div>

                    {/* ── Ticket Type ── */}
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.75rem', marginBottom: '1rem', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '0.7rem 1rem' }}>
                      <div>
                        <span style={{ fontSize: '0.85rem', fontWeight: 700, color: '#1e293b', display: 'block' }}>
                          <Ticket size={16} color="#14b8a6" /> Ticket Type
                        </span>
                        <span style={{ fontSize: '0.74rem', color: '#64748b' }}>
                          Standard and Fast Track tickets have different prices.
                        </span>
                      </div>
                      <div style={{ display: 'inline-flex', background: '#e2e8f0', padding: '3px', borderRadius: '8px', gap: '3px', flexWrap: 'wrap' }}>
                        {[{ id: 'standard', label: '🎟️ Standard' }, { id: 'fast_track', label: '⚡ Fast Track' }, { id: 'both', label: '🎟️ ⚡ Both' }].map(opt => (
                          <button
                            key={opt.id}
                            type="button"
                            style={{
                              padding: '0.4rem 0.9rem', fontSize: '0.8rem', fontWeight: 700, borderRadius: '6px', border: 'none', cursor: 'pointer', transition: 'all 0.15s ease',
                              background: (item.ticketType || 'standard') === opt.id ? '#ffffff' : 'transparent',
                              color: (item.ticketType || 'standard') === opt.id ? '#0f766e' : '#64748b',
                              boxShadow: (item.ticketType || 'standard') === opt.id ? '0 1px 3px rgba(0,0,0,0.1)' : 'none'
                            }}
                            onClick={() => setItemsToSave(prev => prev.map(it => {
                              if (it.tempId === item.tempId) return { ...it, ticketType: opt.id };
                              return it;
                            }))}
                          >
                            {opt.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* ── Child Age Range Configuration (per supplier contract) ── */}
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                        <span style={{ fontSize: '0.82rem', fontWeight: 700, color: '#334155' }}>
                          Child Age Ranges (per supplier contract)
                        </span>
                        <button
                          type="button"
                          onClick={() => handleAddChildAgeBand(item.tempId)}
                          style={{ fontSize: '0.75rem', padding: '0.25rem 0.65rem', background: '#f0fdfa', color: '#0f766e', border: '1px solid #99f6e4', borderRadius: '6px', cursor: 'pointer', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}
                        >
                          <Plus size={13} /> Add Age Tier
                        </button>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                        {(item.childAgeRanges || []).map((band, bandIdx) => (
                          <div key={band.id} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '7px', padding: '0.45rem 0.65rem' }}>
                            <input
                              type="text"
                              value={band.name}
                              onChange={(e) => handleUpdateChildAgeBand(item.tempId, bandIdx, 'name', e.target.value)}
                              placeholder="Name"
                              style={{ flex: '1', minWidth: '80px', fontSize: '0.8rem', padding: '0.25rem 0.4rem', border: '1px solid #cbd5e1', borderRadius: '5px', fontWeight: 600, color: '#1e293b' }}
                            />
                            <span style={{ fontSize: '0.75rem', color: '#64748b', whiteSpace: 'nowrap' }}>Ages</span>
                            <input
                              type="number"
                              min="0"
                              value={band.ageFrom}
                              onChange={(e) => handleUpdateChildAgeBand(item.tempId, bandIdx, 'ageFrom', e.target.value)}
                              style={{ width: '52px', fontSize: '0.8rem', padding: '0.25rem 0.35rem', border: '1px solid #cbd5e1', borderRadius: '5px', textAlign: 'center' }}
                            />
                            <span style={{ fontSize: '0.75rem', color: '#64748b' }}>–</span>
                            <input
                              type="number"
                              min="0"
                              value={band.ageTo}
                              onChange={(e) => handleUpdateChildAgeBand(item.tempId, bandIdx, 'ageTo', e.target.value)}
                              style={{ width: '52px', fontSize: '0.8rem', padding: '0.25rem 0.35rem', border: '1px solid #cbd5e1', borderRadius: '5px', textAlign: 'center' }}
                            />
                            <span style={{ fontSize: '0.72rem', color: '#94a3b8' }}>yrs</span>
                            {(item.childAgeRanges || []).length > 1 && (
                              <button
                                type="button"
                                onClick={() => handleRemoveChildAgeBand(item.tempId, bandIdx)}
                                style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', padding: '0.1rem', lineHeight: 1 }}
                                title="Remove age tier"
                              >
                                <X size={14} />
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                      {(item.childAgeRanges || []).length === 0 && (
                        <div style={{ fontSize: '0.75rem', color: '#94a3b8', marginTop: '0.3rem' }}>
                          No child age ranges set — only the adult rate will apply. Add a tier for children pricing.
                        </div>
                      )}
                    </div>
                  </div>
                  ) : null}

                  {/* PRICING MODEL SELECTOR */}
                  {!isMealsCategory(item.category) && !isGuideCategory(item.category) && !isTicketCategory(item.category) && !isCarRentalCategory(item.category) && (
                  <div style={{
                    background: '#f8fafc',
                    border: '1px solid #e2e8f0',
                    borderRadius: '10px',
                    padding: '0.85rem 1.15rem',
                    marginBottom: '1.5rem',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    flexWrap: 'wrap',
                    gap: '0.75rem'
                  }}>
                    <div>
                      <span style={{ fontSize: '0.85rem', fontWeight: 700, color: '#1e293b', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                        <Tag size={16} color="#00665c" /> {isFlightCategory(item.category)
                          ? 'Flight Pricing Model:'
                          : (isExtrasCategory(item.category)
                            ? 'Extras Charged:'
                            : (isTourStyle
                            ? (item.category === 'Transfers' ? 'Transfer Pricing Type:' : isTransportCategory(item.category) ? 'Vehicle Hire Pricing Type:' : 'Activity / Tour Pricing Type:')
                            : (item.category === 'Accommodation' ? 'Accommodation Pricing Model:'
                              : (isTrainCategory(item.category) ? 'Train Journey Pricing Model:' : 'Pricing Type:'))))}
                      </span>
                      <span style={{ fontSize: '0.74rem', color: '#64748b' }}>
                        {isFlightCategory(item.category)
                          ? 'Choose whether the fare is quoted per person or per charter (whole flight).'
                          : (isExtrasCategory(item.category)
                            ? 'Choose whether the extra is bought once for the service itself, or for every guest taking it.'
                            : (isTourStyle
                            ? 'Choose how the rate is quoted: per vehicle, per person, or tiered by pax count.'
                            : 'Choose whether rates are quoted per person sharing or as a flat room/unit price.'))}
                      </span>
                    </div>

                    {isExtrasCategory(item.category) ? (
                      <div style={{ display: 'inline-flex', background: '#e2e8f0', padding: '3px', borderRadius: '8px', gap: '3px', flexWrap: 'wrap' }}>
                        {[{ id: 'per_unit', label: '✨ Service only (per unit)' }, { id: 'per_person', label: '👥 Per person' }].map(opt => (
                          <button
                            key={opt.id}
                            type="button"
                            onClick={() => handleItemFieldChange(item.tempId, 'pricingModel', opt.id)}
                            style={{
                              padding: '0.4rem 0.9rem', fontSize: '0.8rem', fontWeight: 700, borderRadius: '6px', border: 'none', cursor: 'pointer', transition: 'all 0.15s ease',
                              background: (item.pricingModel || 'per_person') === opt.id ? '#ffffff' : 'transparent',
                              color: (item.pricingModel || 'per_person') === opt.id ? '#db2777' : '#64748b',
                              boxShadow: (item.pricingModel || 'per_person') === opt.id ? '0 1px 3px rgba(0,0,0,0.1)' : 'none'
                            }}
                          >
                            {opt.label}
                          </button>
                        ))}
                      </div>
                    ) : isFlightCategory(item.category) ? (
                      <div style={{ display: 'inline-flex', background: '#e2e8f0', padding: '3px', borderRadius: '8px', gap: '3px', flexWrap: 'wrap' }}>
                        {[{ id: 'per_person', label: 'Per Person' }, { id: 'per_vehicle', label: 'Per Charter (Whole Flight)' }].map(opt => (
                          <button
                            key={opt.id}
                            type="button"
                            onClick={() => handleItemFieldChange(item.tempId, 'pricingModel', opt.id)}
                            style={{
                              padding: '0.4rem 0.9rem', fontSize: '0.8rem', fontWeight: 700, borderRadius: '6px', border: 'none', cursor: 'pointer', transition: 'all 0.15s ease',
                              background: (item.pricingModel || 'per_person') === opt.id ? '#ffffff' : 'transparent',
                              color: (item.pricingModel || 'per_person') === opt.id ? '#1d4ed8' : '#64748b',
                              boxShadow: (item.pricingModel || 'per_person') === opt.id ? '0 1px 3px rgba(0,0,0,0.1)' : 'none'
                            }}
                          >
                            {opt.label}
                          </button>
                        ))}
                      </div>
                    ) : isTourStyle ? (
                      <div style={{ display: 'inline-flex', background: '#e2e8f0', padding: '3px', borderRadius: '8px', gap: '3px', flexWrap: 'wrap' }}>
                        {transferPricingOptions.map(opt => (
                          (opt.id === 'tiered' && !dbFeatures.tieredPricing) ? null : (
                            <button
                              key={opt.id}
                              type="button"
                              onClick={() => handleItemFieldChange(item.tempId, 'pricingModel', opt.id)}
                              style={{
                                padding: '0.4rem 0.9rem', fontSize: '0.8rem', fontWeight: 700, borderRadius: '6px', border: 'none', cursor: 'pointer', transition: 'all 0.15s ease',
                                background: item.pricingModel === opt.id ? '#ffffff' : 'transparent',
                                color: item.pricingModel === opt.id ? '#1d4ed8' : '#64748b',
                                boxShadow: item.pricingModel === opt.id ? '0 1px 3px rgba(0,0,0,0.1)' : 'none'
                              }}
                            >
                              {opt.label}
                            </button>
                          )
                        ))}
                      </div>
                    ) : (
                    <div style={{ display: 'inline-flex', background: '#e2e8f0', padding: '3px', borderRadius: '8px', gap: '3px' }}>
                      <button
                        type="button"
                        onClick={() => handleItemFieldChange(item.tempId, 'pricingModel', 'per_person')}
                        style={{
                          padding: '0.4rem 0.9rem',
                          fontSize: '0.8rem',
                          fontWeight: 700,
                          borderRadius: '6px',
                          border: 'none',
                          cursor: 'pointer',
                          transition: 'all 0.15s ease',
                          background: (item.pricingModel || 'per_person') === 'per_person' ? '#ffffff' : 'transparent',
                          color: (item.pricingModel || 'per_person') === 'per_person' ? '#00665c' : '#64748b',
                          boxShadow: (item.pricingModel || 'per_person') === 'per_person' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none'
                        }}
                      >
                        👥 Per Person Sharing (PPS)
                      </button>
                      <button
                        type="button"
                        onClick={() => handleItemFieldChange(item.tempId, 'pricingModel', 'per_room')}
                        style={{
                          padding: '0.4rem 0.9rem',
                          fontSize: '0.8rem',
                          fontWeight: 700,
                          borderRadius: '6px',
                          border: 'none',
                          cursor: 'pointer',
                          transition: 'all 0.15s ease',
                          background: item.pricingModel === 'per_room' ? '#ffffff' : 'transparent',
                          color: item.pricingModel === 'per_room' ? '#00665c' : '#64748b',
                          boxShadow: item.pricingModel === 'per_room' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none'
                        }}
                      >
                        🏠 Flat Room / Unit Rate
                      </button>
                    </div>
                    )}
                  </div>
                  )}

                  {/* FEES & TICKETS ARE THEIR OWN ITEMS, NOT A SWITCH ON A BASE ITEM.
                      An entrance fee or conservation levy used to be a toggle on
                      Accommodation / Transfers, which put the price on the base
                      item's seasonal matrix where the itinerary never read it.
                      Each fee is now a library item in its own right, so it gets
                      its own supplier, its own price and its own line. */}
                  {isSurchargeItem(item) ? (
                    <div style={{
                      background: '#fff7ed',
                      border: '1px solid #fed7aa',
                      borderRadius: '10px',
                      padding: '0.85rem 1.15rem',
                      marginBottom: '1.5rem'
                    }}>
                      <span style={{ fontSize: '0.85rem', fontWeight: 700, color: '#9a3412', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                        <Tag size={16} color="#ea580c" /> Fee & ticket setup
                      </span>
                      <span style={{ fontSize: '0.74rem', color: '#7c2d12', display: 'block', marginTop: '0.2rem' }}>
                        This item is a fee or ticket, so it becomes its own line on the itinerary with its own price. Link it to the accommodation
                        it belongs to and it is added automatically with that property.
                      </span>

                      <div style={{ marginTop: '0.85rem', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: '0.75rem' }}>
                        <div>
                          <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#7c2d12', display: 'block', marginBottom: '0.3rem' }}>Fee type</span>
                          <SearchableSelect
                            className="pricing-select"
                            style={{ padding: '0.4rem 0.6rem', border: '1px solid #fdba74', borderRadius: '6px', width: '100%' }}
                            value={item.surchargeType || 'entrance_fee'}
                            onChange={(e) => handleItemFieldChange(item.tempId, 'surchargeType', e.target.value)}
                          >
                            {SURCHARGE_TYPES.map((opt) => <option key={opt.id} value={opt.id}>{opt.label}</option>)}
                          </SearchableSelect>
                        </div>
                        <div>
                          <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#7c2d12', display: 'block', marginBottom: '0.3rem' }}>Charged</span>
                          <SearchableSelect
                            className="pricing-select"
                            style={{ padding: '0.4rem 0.6rem', border: '1px solid #fdba74', borderRadius: '6px', width: '100%' }}
                            value={item.surchargeChargeBasis || 'once_off'}
                            onChange={(e) => handleItemFieldChange(item.tempId, 'surchargeChargeBasis', e.target.value)}
                          >
                            {CHARGE_BASIS.map((opt) => <option key={opt.id} value={opt.id}>{opt.label}</option>)}
                          </SearchableSelect>
                        </div>
                        <div>
                          <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#7c2d12', display: 'block', marginBottom: '0.3rem' }}>Rate is per</span>
                          <SearchableSelect
                            className="pricing-select"
                            style={{ padding: '0.4rem 0.6rem', border: '1px solid #fdba74', borderRadius: '6px', width: '100%' }}
                            value={item.surchargeUnitBasis || 'per_person'}
                            onChange={(e) => handleItemFieldChange(item.tempId, 'surchargeUnitBasis', e.target.value)}
                          >
                            {unitBasesFor({
                              surcharge_type: item.surchargeType || 'entrance_fee',
                              surcharge_unit_basis: item.surchargeUnitBasis
                            }).map((opt) => <option key={opt.id} value={opt.id}>{opt.label}</option>)}
                          </SearchableSelect>
                          {/* A levy is the only type with a child figure of its
                              own to store, so leaving "per child" selected after
                              switching type would save a basis that always
                              prices as zero. */}
                          {!isValidUnitBasis({ surcharge_type: item.surchargeType || 'entrance_fee' }, item.surchargeUnitBasis || 'per_person')
                            && (
                              <span style={{ display: 'block', marginTop: '0.25rem', fontSize: '0.7rem', color: '#b45309' }}>
                                Not available for this fee type — pick another basis above.
                              </span>
                            )}
                        </div>
                        <div>
                          <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#7c2d12', display: 'block', marginBottom: '0.3rem' }}>Linked accommodation</span>
                          <SearchableSelect
                            className="pricing-select"
                            style={{ padding: '0.4rem 0.6rem', border: '1px solid #fdba74', borderRadius: '6px', width: '100%' }}
                            value={item.linkedItemId || ''}
                            onChange={(e) => handleItemFieldChange(item.tempId, 'linkedItemId', e.target.value)}
                          >
                            <option value="">Not linked</option>
                            {accommodationLinkOptions.map((opt) => <option key={opt.id} value={opt.id}>{opt.label}</option>)}
                          </SearchableSelect>
                        </div>
                      </div>

                      <div style={{ marginTop: '0.85rem', paddingTop: '0.75rem', borderTop: '1px solid #fed7aa' }}>
                        <label style={{ display: 'flex', alignItems: 'flex-start', gap: '0.45rem', fontSize: '0.8rem', fontWeight: 600, color: '#7c2d12', cursor: 'pointer' }}>
                          <input
                            type="checkbox"
                            checked={item.surchargeChargeable !== false}
                            onChange={(e) => handleItemFieldChange(item.tempId, 'surchargeChargeable', e.target.checked)}
                            style={{ width: '16px', height: '16px', accentColor: '#ea580c', cursor: 'pointer', marginTop: '1px' }}
                          />
                          Chargeable — add this fee to the client's total with markup
                        </label>
                        <span style={{ fontSize: '0.74rem', color: '#7c2d12', display: 'block', marginTop: '0.3rem', paddingLeft: '1.7rem' }}>
                          {item.surchargeChargeable === false
                            ? 'Not chargeable: the line is still shown so the client can see what the supplier charges, but nothing is added to the total and no markup is applied.'
                            : 'Chargeable: the fee is marked up like any other bought service and added to the total.'}
                        </span>
                      </div>

                      {(item.surchargeChargeBasis || 'once_off') === 'per_night' && !item.linkedItemId && (
                        <div style={{ marginTop: '0.75rem', padding: '0.6rem 0.75rem', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: '8px' }}>
                          <span style={{ fontSize: '0.76rem', color: '#92400e' }}>
                            This fee repeats per night but is not linked to an accommodation, so the operator is asked how many nights it
                            applies to when it is added to an itinerary. Linking it to an accommodation removes that question.
                          </span>
                        </div>
                      )}
                    </div>
                  ) : null}

                  {/* CAR RENTAL GROUPS EDITOR */}
                  {isCarRentalCategory(item.category) && (
                    <div style={{
                      background: '#f8fafc',
                      borderRadius: '10px',
                      padding: '1.25rem',
                      border: '1px solid #e2e8f0',
                      marginBottom: '1.5rem'
                    }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', marginBottom: '0.75rem', flexWrap: 'wrap' }}>
                        <h4 style={{ fontSize: '0.95rem', fontWeight: 700, color: '#334155', margin: 0, display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                          <Car size={18} color="#06b6d4" /> Car Rental Contract
                        </h4>
                        {dbFeatures.rentalContractFee ? (
                          <div style={{ display: 'flex', alignItems: 'flex-end', gap: '0.4rem' }}>
                            <div>
                              <label style={{ fontSize: '0.72rem', fontWeight: 600, color: '#0e7490', display: 'block', marginBottom: '0.2rem' }}>
                                Rental Contract Fee ({item.currency})
                              </label>
                              <input
                                type="number"
                                min="0"
                                step="0.01"
                                className="pricing-select"
                                style={{ padding: '0.35rem 0.5rem', fontSize: '0.85rem', width: '130px', textAlign: 'center', fontWeight: 700, color: '#0f766e' }}
                                placeholder="e.g. 250"
                                value={item.rentalContractFee ?? ''}
                                onChange={(e) => handleItemFieldChange(item.tempId, 'rentalContractFee', e.target.value)}
                              />
                            </div>
                            <span style={{ fontSize: '0.68rem', color: '#64748b', maxWidth: '15rem', lineHeight: 1.35, paddingBottom: '0.3rem' }}>
                              The admin fee the hire company adds to every agreement. Charged once per car dropped, folded into that vehicle line.
                            </span>
                          </div>
                        ) : (
                          <div style={{ background: '#fefce8', border: '1px solid #facc15', borderRadius: '6px', padding: '0.4rem 0.6rem', fontSize: '0.72rem', fontWeight: 600, color: '#854d0e' }}>
                            The contract fee column isn&rsquo;t in this workspace yet, so hires price without it.
                          </div>
                        )}
                      </div>
                      <div style={{ fontSize: '0.78rem', color: '#64748b', marginBottom: '0.85rem', lineHeight: 1.5 }}>
                        Each group binds a <strong>Vehicle Group</strong>, a <strong>Vehicle Model</strong> and its <strong>Contract Type</strong> to
                        the tariff seasons it is sold across. A band price is <strong>per day</strong>: car hire is charged in whole 24-hour blocks, so
                        a car collected at 08:00 and back at 08:00 the next morning is one day, and five minutes later is two. The blocks decide which
                        band applies and the band&rsquo;s daily price is multiplied by them.
                        <strong> Rental Price Validity</strong> is the window the hire must fall in — it is tested against the pick-up date, it is not a
                        reservation deadline, and one group can be sold at different money in more than one window. Each season keeps its own ladder.
                      </div>

                      {(item.carGroups || []).map((group, groupIdx) => (
                        <div key={group.groupId} style={{
                          background: '#ffffff',
                          border: '1px solid #67e8f9',
                          borderRadius: '10px',
                          padding: '1rem',
                          marginBottom: '1rem'
                        }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                            <span style={{ fontSize: '0.85rem', fontWeight: 700, color: '#0e7490' }}>
                              Vehicle Group {groupIdx + 1}
                              {(group.seasons || []).length > 1 && (
                                <span style={{ fontWeight: 500, color: '#64748b', fontSize: '0.75rem', marginLeft: '0.4rem' }}>
                                  — {group.seasons.length} rental price seasons
                                </span>
                              )}
                            </span>
                            <button
                              type="button"
                              onClick={() => handleRemoveCarGroup(item.tempId, group.groupId)}
                              style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: '0.75rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.25rem' }}
                            >
                              <Trash2 size={13} /> Remove Group
                            </button>
                          </div>

                          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: '0.75rem', marginBottom: '0.85rem' }}>
                            <div>
                              <label style={{ fontSize: '0.75rem', fontWeight: 600, color: '#475569', display: 'block', marginBottom: '0.25rem' }}>
                                Vehicle Group <span style={{ color: '#ef4444' }}>*</span>
                              </label>
                              <input
                                type="text"
                                className="pricing-select"
                                style={{ padding: '0.4rem', fontSize: '0.85rem' }}
                                placeholder="e.g. C"
                                value={group.vehicleGroup}
                                onChange={(e) => handleCarGroupFieldChange(item.tempId, group.groupId, 'vehicleGroup', e.target.value)}
                              />
                            </div>
                            <div>
                              <label style={{ fontSize: '0.75rem', fontWeight: 600, color: '#475569', display: 'block', marginBottom: '0.25rem' }}>
                                Vehicle Model <span style={{ color: '#ef4444' }}>*</span>
                              </label>
                              <input
                                type="text"
                                className="pricing-select"
                                style={{ padding: '0.4rem', fontSize: '0.85rem' }}
                                placeholder="e.g. Toyota Corolla Quest or similar"
                                value={group.vehicleName}
                                onChange={(e) => handleCarGroupFieldChange(item.tempId, group.groupId, 'vehicleName', e.target.value)}
                              />
                            </div>
                            <div>
                              <label style={{ fontSize: '0.75rem', fontWeight: 600, color: '#475569', display: 'block', marginBottom: '0.25rem' }}>
                                Contract Type <span style={{ color: '#ef4444' }}>*</span>
                              </label>
                              <input
                                type="text"
                                className="pricing-select"
                                style={{ padding: '0.4rem', fontSize: '0.85rem' }}
                                placeholder="e.g. Classic Max (CM)"
                                value={group.rateCode}
                                onChange={(e) => handleCarGroupFieldChange(item.tempId, group.groupId, 'rateCode', e.target.value)}
                              />
                            </div>
                            <div>
                              <label style={{ fontSize: '0.75rem', fontWeight: 600, color: '#475569', display: 'block', marginBottom: '0.25rem' }}>
                                KMS Included
                              </label>
                              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                                <label style={{ fontSize: '0.78rem', fontWeight: 600, color: '#334155', display: 'flex', alignItems: 'center', gap: '0.3rem', cursor: 'pointer' }}>
                                  <input
                                    type="checkbox"
                                    checked={group.kmsUnlimited !== false}
                                    onChange={(e) => handleCarGroupFieldChange(item.tempId, group.groupId, 'kmsUnlimited', e.target.checked)}
                                    style={{ width: '15px', height: '15px', accentColor: '#06b6d4', cursor: 'pointer' }}
                                  />
                                  Unlimited
                                </label>
                              </div>
                              {group.kmsUnlimited === false && (
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', marginTop: '0.3rem' }}>
                                  <input
                                    type="number"
                                    min="0"
                                    className="pricing-select"
                                    style={{ padding: '0.35rem', fontSize: '0.85rem', width: '120px' }}
                                    placeholder="e.g. 200"
                                    value={group.kmsIncluded ?? ''}
                                    onChange={(e) => handleCarGroupFieldChange(item.tempId, group.groupId, 'kmsIncluded', e.target.value)}
                                  />
                                  <span style={{ fontSize: '0.72rem', color: '#64748b' }}>km</span>
                                </div>
                              )}
                            </div>
                          </div>

                          {/* The six facts, in the same grid every travel document prints */}
                          <div style={{ background: '#f0fdff', border: '1px solid #a5f3fc', borderRadius: '10px', padding: '0.85rem 1rem', marginBottom: '1rem' }}>
                            <div style={{ fontSize: '0.8rem', fontWeight: 700, color: '#155e75', marginBottom: '0.6rem', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                              <Car size={15} color="#0891b2" /> Vehicle Specification
                            </div>
                            <CarSpecGrid
                              spec={group}
                              onChange={(field, value) => handleCarGroupFieldChange(item.tempId, group.groupId, field, value)}
                            />
                            <div style={{ fontSize: '0.68rem', color: '#64748b', marginTop: '0.5rem' }}>
                              M or A for gearbox, F or E for power, a tick or a cross for air conditioning. This exact grid prints on every document that mentions the car.
                            </div>
                          </div>

                          {/* The seasons this group is sold across. A hire contract
                              charges the same car at other money in other weeks, so
                              one window and the ladder priced inside it belong
                              together, and the pick-up date of a hire decides which
                              of them answers. */}
                          <div style={{ fontSize: '0.8rem', fontWeight: 700, color: '#334155', marginBottom: '0.3rem' }}>
                            Rental Price Validity seasons
                            <span style={{ fontWeight: 400, color: '#94a3b8', fontSize: '0.74rem' }}> — each one a window and the ladder priced inside it</span>
                          </div>
                          <div style={{ fontSize: '0.72rem', color: '#64748b', marginBottom: '0.6rem' }}>
                            Charged in 24-hour blocks: 08:00 to 08:00 the next morning is 1 day. Five minutes later is 2.
                            A hire prices off the season that covers its pick-up date.
                          </div>

                          {(group.seasons || []).map((season, seasonIdx) => (
                            <div key={season.seasonId} style={{ background: '#f8fafc', border: '1px solid #cbd5e1', borderRadius: '10px', padding: '0.75rem 0.85rem', marginBottom: '0.7rem' }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.6rem', marginBottom: '0.55rem', flexWrap: 'wrap' }}>
                                <span style={{ fontSize: '0.78rem', fontWeight: 700, color: '#0e7490' }}>
                                  Season {seasonIdx + 1}
                                  <span style={{ fontWeight: 500, color: '#475569', marginLeft: '0.35rem' }}>
                                    {!season.validFrom && !season.validTo
                                      ? '— any pick-up date'
                                      : `— ${season.validFrom || 'from the beginning'} to ${season.validTo || 'open'}`}
                                  </span>
                                </span>
                                {(group.seasons || []).length > 1 && (
                                  <button
                                    type="button"
                                    onClick={() => handleRemoveCarSeason(item.tempId, group.groupId, season.seasonId)}
                                    style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: '0.73rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.25rem' }}
                                  >
                                    <Trash2 size={13} /> Remove Season
                                  </button>
                                )}
                              </div>

                              {/* Each date keeps its own row: a native date field needs
                                  real width for its calendar button, and two of them
                                  squeezed into one narrow auto-fit track overflow onto
                                  whatever sits next to them. */}
                              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.75rem', marginBottom: '0.5rem' }}>
                                <div style={{ minWidth: 0 }}>
                                  <label style={{ fontSize: '0.75rem', fontWeight: 600, color: '#475569', display: 'block', marginBottom: '0.25rem' }}>
                                    Rental Price Validity — from
                                  </label>
                                  <input
                                    type="date"
                                    className="pricing-select"
                                    style={{ padding: '0.35rem', fontSize: '0.85rem', width: '100%' }}
                                    value={season.validFrom}
                                    onChange={(e) => handleCarSeasonFieldChange(item.tempId, group.groupId, season.seasonId, 'validFrom', e.target.value)}
                                  />
                                </div>
                                <div style={{ minWidth: 0 }}>
                                  <label style={{ fontSize: '0.75rem', fontWeight: 600, color: '#475569', display: 'block', marginBottom: '0.25rem' }}>
                                    Rental Price Validity — to
                                  </label>
                                  <input
                                    type="date"
                                    className="pricing-select"
                                    style={{ padding: '0.35rem', fontSize: '0.85rem', width: '100%' }}
                                    value={season.validTo}
                                    onChange={(e) => handleCarSeasonFieldChange(item.tempId, group.groupId, season.seasonId, 'validTo', e.target.value)}
                                  />
                                </div>
                              </div>

                              <div style={{ fontSize: '0.75rem', fontWeight: 600, color: '#475569', marginBottom: '0.35rem' }}>
                                Rental Length Ranges <span style={{ fontWeight: 400, color: '#94a3b8', fontSize: '0.72rem' }}>(per day, in {item.currency})</span>
                              </div>
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                                {(season.ranges || []).map((range, rangeIdx) => (
                                  <div key={rangeIdx} style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', background: '#f0fdfa', border: '1px solid #99f6e4', borderRadius: '8px', padding: '0.5rem 0.75rem', flexWrap: 'wrap' }}>
                                    <span style={{ fontSize: '0.75rem', color: '#0f766e', fontWeight: 600, whiteSpace: 'nowrap' }}>Day</span>
                                    <input
                                      type="number"
                                      min="1"
                                      className="pricing-select"
                                      style={{ padding: '0.35rem', fontSize: '0.85rem', width: '80px', textAlign: 'center' }}
                                      placeholder="min"
                                      value={range.minDays}
                                      onChange={(e) => handleCarRangeChange(item.tempId, group.groupId, season.seasonId, rangeIdx, 'minDays', e.target.value)}
                                    />
                                    <span style={{ fontSize: '0.75rem', color: '#64748b' }}>–</span>
                                    <input
                                      type="number"
                                      min="1"
                                      className="pricing-select"
                                      style={{ padding: '0.35rem', fontSize: '0.85rem', width: '80px', textAlign: 'center' }}
                                      placeholder="max / blank = +"
                                      value={range.maxDays}
                                      onChange={(e) => handleCarRangeChange(item.tempId, group.groupId, season.seasonId, rangeIdx, 'maxDays', e.target.value)}
                                    />
                                    <span style={{ fontSize: '0.75rem', color: '#0f766e', fontWeight: 600, whiteSpace: 'nowrap' }}>days</span>
                                    <div style={{ flex: '1', minWidth: '160px', maxWidth: '220px', marginLeft: 'auto' }}>
                                      <input
                                        type="number"
                                        min="0"
                                        className="pricing-select"
                                        style={{ padding: '0.35rem', fontSize: '0.85rem', width: '100%', textAlign: 'center', fontWeight: 700, color: '#0f766e' }}
                                        placeholder={`Per day (${item.currency})`}
                                        value={range.price}
                                        onChange={(e) => handleCarRangeChange(item.tempId, group.groupId, season.seasonId, rangeIdx, 'price', e.target.value)}
                                      />
                                    </div>
                                    <button
                                      type="button"
                                      onClick={() => handleRemoveCarRange(item.tempId, group.groupId, season.seasonId, rangeIdx)}
                                      style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', padding: '0.1rem', lineHeight: 1 }}
                                      title="Remove range"
                                    >
                                      <X size={15} />
                                    </button>
                                  </div>
                                ))}
                              </div>
                              <button
                                type="button"
                                className="secondary-btn"
                                style={{ padding: '0.35rem 0.75rem', fontSize: '0.78rem', marginTop: '0.6rem', display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}
                                onClick={() => handleAddCarRange(item.tempId, group.groupId, season.seasonId)}
                              >
                                <Plus size={13} /> Add Range
                              </button>
                            </div>
                          ))}

                          {(group.seasons || []).length === 0 && (
                            <div style={{ fontSize: '0.76rem', color: '#b45309', background: '#fffbeb', border: '1px solid #fcd34d', borderRadius: 8, padding: '0.5rem 0.7rem', marginBottom: '0.6rem' }}>
                              This group has no tariff yet, so no hire of it can be priced. Add a season below.
                            </div>
                          )}

                          <button
                            type="button"
                            className="secondary-btn"
                            style={{ padding: '0.35rem 0.75rem', fontSize: '0.78rem', display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}
                            onClick={() => handleAddCarSeason(item.tempId, group.groupId)}
                          >
                            <Plus size={13} /> Add Rental Price Validity season
                          </button>
                        </div>
                      ))}

                      <button
                        type="button"
                        className="secondary-btn"
                        style={{ padding: '0.5rem 1rem', fontSize: '0.85rem', display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}
                        onClick={() => handleAddCarGroup(item.tempId)}
                      >
                        <Plus size={14} /> Add Vehicle Group
                      </button>
                    </div>
                  )}

                  {/* Seasonal Pricing Matrices Box */}
                  {!isCarRentalCategory(item.category) && (
                  <div style={{
                    background: '#f8fafc',
                    borderRadius: '10px',
                    padding: '1.25rem',
                    border: '1px solid #e2e8f0',
                    marginBottom: '1.5rem'
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                      <h4 style={{ fontSize: '0.95rem', fontWeight: 700, color: '#334155', margin: 0, display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                        <Calendar size={18} color="#863bff" /> {isFlightCategory(item.category)
                          ? `Seasonal Flight Fares (${item.pricingModel === 'per_vehicle' ? 'Per Charter' : 'Per Person'})`
                          : isGuideCategory(item.category)
                            ? 'Seasonal Guide Rates (Per Service Type)'
                            : isMealsCategory(item.category)
                            ? 'Seasonal Meal Fares (Per Person)'
                            : (isTrainCategory(item.category)
                            ? `Seasonal Train Fares (${item.pricingModel === 'per_room' ? 'Flat Cabin Rate' : 'Per Person'})`
                            : (isTicketCategory(item.category)
                            ? 'Seasonal Ticket Fares (Per Person)'
                            : (isExtrasCategory(item.category)
                            ? `Seasonal Extras Fares (${item.pricingModel === 'per_unit' ? 'Service Only — Per Unit' : 'Per Person'})`
                            : (isTourStyle
                            ? `Seasonal Price Matrices (${item.pricingModel === 'tiered' ? 'Tiered by Pax Count' : item.pricingModel === 'per_vehicle' ? 'Flat Vehicle Rate' : 'Per Person Rates'})`
                            : `Seasonal Pricing Matrices ${item.pricingModel === 'per_room' ? '(Flat Room Rates)' : '(Per Person Rates)'}`))))}
                      </h4>
                    </div>

                    {/* Rate Guide */}
                    {isGuideCategory(item.category) && (
                      <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '0.75rem 1rem', marginBottom: '1rem', fontSize: '0.78rem', color: '#475569', lineHeight: '1.45' }}>
                        <div style={{ fontWeight: 700, color: '#6b21a8', marginBottom: '0.2rem' }}>🚶 Guide Rate (Per Service Type):</div>
                        <div>• <strong>Transfer / Half Day / Full Day / Overland / Dinner transfer:</strong> a separate flat per-trip price for each service the guide accompanies. The itinerary builder picks the rate for the service at hand.</div>
                        <div>• <strong>Meals:</strong> lunch/dinner that trigger when the guide accompanies the trip.</div>
                        <div>• <strong>Accommodation:</strong> overnight flag that triggers guide accommodation when required.</div>
                      </div>
                    )}
                    {isMealsCategory(item.category) && (
                      <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '0.75rem 1rem', marginBottom: '1rem', fontSize: '0.78rem', color: '#475569', lineHeight: '1.45' }}>
                        <div style={{ fontWeight: 700, color: '#b45309', marginBottom: '0.2rem' }}>🍽️ Meal Fares:</div>
                        <div>• <strong>Adult Rate:</strong> per person meal price.</div>
                        <div>• <strong>Child Rate:</strong> per child meal price.</div>
                        {parseFloat(item.mealGratuityPercent) > 0 && (
                          <div>• <strong>Gratuity:</strong> {item.mealGratuityPercent}% added on top of the fare.</div>
                        )}
                      </div>
                    )}
                    {isTicketCategory(item.category) && (
                      <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '0.75rem 1rem', marginBottom: '1rem', fontSize: '0.78rem', color: '#475569', lineHeight: '1.45' }}>
                        <div style={{ fontWeight: 700, color: '#0d9488', marginBottom: '0.2rem' }}>🎟️ Ticket Fares:</div>
                        <div>• <strong>Adult Rate:</strong> per person ticket price.</div>
                        <div>• <strong>Child Rate:</strong> per child ticket price by age range.</div>
                        <div style={{ color: '#0f766e', fontWeight: 600, marginTop: '0.25rem' }}>
                          Tickets are always quoted per person.
                        </div>
                      </div>
                    )}
                    {isExtrasCategory(item.category) && (
                      <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '0.75rem 1rem', marginBottom: '1rem', fontSize: '0.78rem', color: '#475569', lineHeight: '1.45' }}>
                        <div style={{ fontWeight: 700, color: '#ec4899', marginBottom: '0.2rem' }}>✨ Extras Fares:</div>
                        {item.pricingModel === 'per_unit' ? (
                          <>
                            <div>• <strong>Unit Price:</strong> charged once for the service — a meet-and-greet, a boat hire, a private viewing — however many guests take it.</div>
                            <div>• Repeating the line on the itinerary (or its quantity) is the only thing that multiplies it. Guests never do.</div>
                            <div style={{ color: '#db2777', fontWeight: 600, marginTop: '0.25rem' }}>
                              This extra is charged per unit, so children pay nothing extra for it.
                            </div>
                          </>
                        ) : (
                          <>
                            <div>• <strong>Adult Rate:</strong> per person extra service price.</div>
                            <div>• <strong>Child Rate:</strong> per child extra service price.</div>
                            <div style={{ color: '#db2777', fontWeight: 600, marginTop: '0.25rem' }}>
                              This extra is charged per person, so every guest takes it.
                            </div>
                          </>
                        )}
                      </div>
                    )}
                    {isFlightCategory(item.category) && (
                      <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '0.75rem 1rem', marginBottom: '1rem', fontSize: '0.78rem', color: '#475569', lineHeight: '1.45' }}>
                        <div style={{ fontWeight: 700, color: '#4338ca', marginBottom: '0.2rem' }}>✈️ Flight Fares:</div>
                        <div>• <strong>Adult Rate:</strong> base fare per adult (per flight).</div>
                        <div>• <strong>Child Rate:</strong> fare per child (up to the child age set below).</div>
                        <div>• <strong>Taxes &amp; Surcharges:</strong> added on top of the base fare (fuel surcharge, airport fees, etc.).</div>
                        <div style={{ color: '#4338ca', fontWeight: 600, marginTop: '0.25rem' }}>
                          For charter flights, set the whole-flight rate as the Adult Rate.
                        </div>
                      </div>
                    )}
                    {isSurchargeItem(item) && (
                      <div style={{ background: '#ffffff', border: '1px solid #fed7aa', borderRadius: '8px', padding: '0.75rem 1rem', marginBottom: '1rem', fontSize: '0.78rem', color: '#7c2d12', lineHeight: '1.45' }}>
                        <div style={{ fontWeight: 700, color: '#c2410c', marginBottom: '0.2rem' }}>
                          {feeTypeHeading(item.surchargeType) + ' Rates'}
                        </div>
                        {(item.surchargeType || 'entrance_fee') === 'conservation_levy' ? (
                          <>
                            <div>• <strong>Per Adult:</strong> charged for each adult on the booking.</div>
                            <div>• <strong>Per Child:</strong> charged for each child (up to the child age set below).</div>
                            <div>• <strong>Per Vehicle:</strong> charged once per vehicle, whatever the levy calls itself.</div>
                            <div style={{ color: '#9a3412', fontWeight: 600, marginTop: '0.25rem' }}>
                              Charged {item.surchargeChargeBasis === 'per_night' ? 'nightly for the duration of the stay' : 'once off for the whole booking'}.
                            </div>
                          </>
                        ) : (
                          <>
                            <div>• <strong>Per Person:</strong> charged for each visitor entering.</div>
                            <div>• <strong>Per Vehicle:</strong> charged once per vehicle/departure (e.g. park entry per car).</div>
                            <div style={{ color: '#9a3412', fontWeight: 600, marginTop: '0.25rem' }}>Pick one in &quot;Rate is per&quot; above; the season matrix collects the figure that basis needs.</div>
                          </>
                        )}
                      </div>
                    )}
                    {isTourStyle && !isFlightCategory(item.category) ? (
                      item.pricingModel === 'tiered' ? (
                        <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '0.75rem 1rem', marginBottom: '1rem', fontSize: '0.78rem', color: '#475569', lineHeight: '1.45' }}>
                          <div style={{ fontWeight: 700, color: '#1d4ed8', marginBottom: '0.2rem' }}>📊 Tiered Pricing Model:</div>
                          <div>Contract charges different rates depending on how many passengers are in the vehicle.</div>
                          <div style={{ color: '#1e40af', fontWeight: 600, marginTop: '0.25rem' }}>
                            Add pax bands (e.g. 1–3 pax → R 2,500; 4+ pax → R 3,200). Child rate is optional.
                          </div>
                        </div>
                      ) : item.pricingModel === 'per_vehicle' ? (
                        <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '0.75rem 1rem', marginBottom: '1rem', fontSize: '0.78rem', color: '#475569', lineHeight: '1.45' }}>
                          <div style={{ fontWeight: 700, color: '#1d4ed8', marginBottom: '0.2rem' }}>🚐 Flat Rate (Per Vehicle):</div>
                          <div>Contract charges a fixed rate per vehicle per trip for up to <strong>{item.maxOccupancy || 4} pax</strong>, regardless of mix.</div>
                          <div style={{ color: '#1e40af', fontWeight: 600, marginTop: '0.25rem' }}>
                            Child rate is optional. Total trip price = vehicle rate (or per person × pax when sharing is requested).
                          </div>
                        </div>
                      ) : (
                        <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '0.75rem 1rem', marginBottom: '1rem', fontSize: '0.78rem', color: '#475569', lineHeight: '1.45' }}>
                          <div style={{ fontWeight: 700, color: '#1d4ed8', marginBottom: '0.2rem' }}>👤 Per-Person Transfer Rate:</div>
                          <div>Contract charges per passenger. Add adult rate and an optional child rate.</div>
                          <div style={{ color: '#1e40af', fontWeight: 600, marginTop: '0.25rem' }}>
                            Child rate applies to passengers up to the child age set below.
                          </div>
                        </div>
                      )
                    ) : (isFlightCategory(item.category) || isMealsCategory(item.category) || isGuideCategory(item.category) || isTicketCategory(item.category) || isExtrasCategory(item.category)) ? null : (
                    roomModelFor(item) === OCCUPANCY_BASIS ? (
                      <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '0.75rem 1rem', marginBottom: '1rem', fontSize: '0.78rem', color: '#475569', lineHeight: '1.45' }}>
                        <div style={{ fontWeight: 700, color: '#7c2d12', marginBottom: '0.2rem' }}>🏡 Villa Rate by Party Size:</div>
                        <div>Contract quotes one per-person-per-night figure for each party the {isTrainCategory(item.category) ? 'cabin' : 'room'} sleeps. Everyone in it pays that figure &mdash; adult or child alike.</div>
                        <div style={{ color: '#9a3412', fontWeight: 600, marginTop: '0.25rem' }}>
                          Price every party size the supplier sells. A size left blank is a size this villa cannot be quoted for.
                        </div>
                      </div>
                    ) : roomModelFor(item) === 'per_room' ? (
                      <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '0.75rem 1rem', marginBottom: '1rem', fontSize: '0.78rem', color: '#475569', lineHeight: '1.45' }}>
                        <div style={{ fontWeight: 700, color: '#166534', marginBottom: '0.2rem' }}>{isTrainCategory(item.category) ? '💡 Flat Cabin Rate Model:' : '💡 Flat Room Rate Model:'}</div>
                        <div>Contract charges a fixed rate per {isTrainCategory(item.category) ? 'cabin per night' : 'room/unit per night'} for up to <strong>{item.maxOccupancy || 2} Total Guests</strong> (regardless of adult or child mix).</div>
                        <div style={{ color: '#00665c', fontWeight: 600, marginTop: '0.25rem' }}>
                          In the Itinerary Builder, the per-person rate is automatically derived as: <code>{isTrainCategory(item.category) ? 'Cabin Rate' : 'Room Rate'} ÷ Number of Occupants</code>.
                        </div>
                      </div>
                    ) : (
                      <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '0.65rem 0.85rem', marginBottom: '1rem', fontSize: '0.78rem', color: '#475569', lineHeight: '1.45' }}>
                        <div style={{ fontWeight: 700, color: '#334155', marginBottom: '0.2rem' }}>{isTrainCategory(item.category) ? '💡 Per-Person Cabin Rates:' : '💡 Per-Person Catalog Rates:'}</div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.35rem', marginTop: '0.2rem' }}>
                          <div>• <strong>1 Adult:</strong> Single Cabin rate (per person)</div>
                          <div>• <strong>2 Adults:</strong> Per Person Sharing (PPS) rate (each adult sharing)</div>
                          <div>• <strong>3+ Adults:</strong> Extra Adult rate (each additional adult sharing)</div>
<div>• <strong>Children:</strong> Rate per child by age tier (sharing with adult/s)</div>
                        </div>
                      </div>
                    ))}

                    {hasChargeTypes(item.category) && (() => {
                      const isAccomItem = item.category === 'Accommodation';
                      const rooms = item.roomTypes || [];
                      const activeRoomKey = isAccomItem ? activeRoomKeyFor(item) : '';
                      const groups = accommodationSeasonGroupsFor(item.seasons, activeRoomKey);
                      const currentGroup = groups[activeSeasonIndexOf(item.tempId, groups)];
                      const activeGroup = currentGroup || groups[0] || null;
                      const chargeLabels = (activeGroup?.memberIndices || [])
                        .map((idx) => (item.seasons[idx]?.optionName || item.mealPlan || '').trim());
                      const optionNames = [...new Set(chargeLabels.filter(Boolean))];
                      const defaultCharge = isAccomItem ? (item.mealPlan || 'Bed & Breakfast') : (item.name || 'the service');
                      const suggestions = isAccomItem ? optionNames : [...new Set([...EXTRAS_CHARGE_SUGGESTIONS, ...optionNames])];
                      return (
                        <div style={{ background: '#f5f3ff', border: '1px solid #ddd6fe', borderRadius: '8px', padding: '0.85rem 1rem', marginBottom: '1rem' }}>
                          {isAccomItem && rooms.length > 1 && (
                            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0.4rem', marginBottom: '0.75rem', paddingBottom: '0.6rem', borderBottom: '1px solid #ede9fe' }}>
                              <span style={{ fontSize: '0.72rem', fontWeight: 600, color: '#5b21b6' }}>Pricing room:</span>
                              {rooms.map((room) => {
                                const selected = room.key === activeRoomKey;
                                return (
                                  <button
                                    key={room.key}
                                    type="button"
                                    onClick={() => setActiveRoomByItem(prev => ({ ...prev, [item.tempId]: room.key }))}
                                    style={{
                                      padding: '0.22rem 0.7rem', borderRadius: '999px', cursor: 'pointer', fontSize: '0.75rem', fontWeight: 600,
                                      border: `1px solid ${selected ? '#0d7478' : '#ddd6fe'}`,
                                      background: selected ? '#f0fdfa' : '#fff',
                                      color: selected ? '#0d7478' : '#5b21b6'
                                    }}
                                  >
                                    {room.name || 'Untitled room'}
                                  </button>
                                );
                              })}
                            </div>
                          )}
                          <div style={{ fontWeight: 700, fontSize: '0.82rem', color: '#5b21b6', marginBottom: '0.2rem' }}>Charge types</div>
                          <div style={{ fontSize: '0.74rem', color: '#64748b', marginBottom: '0.6rem', lineHeight: 1.45 }}>
                            {isAccomItem
                              ? <>One season is priced at several charge types (room only, half board, full board with activities). Add a charge type to &ldquo;{activeGroup?.seasonName || 'the current season'}&rdquo; below and set its prices in the matrix &mdash; on a drop the itinerary asks which season and charge type applies.
                                  {dbFeatures.nightBands && ' A charge type priced by the length of stay uses the same name again with its own night band, so it remains one charge type with an extra row.'}</>
                              : <>One Extras item can be priced at several charges instead of several library items: a fuel contract that sells 5 litres, a full tank and a different fuel again is three charge types on one item. Add one to &ldquo;{activeGroup?.seasonName || 'the current season'}&rdquo; and set its price below &mdash; on a drop the itinerary asks which charge the line is sold as.</>}
                          </div>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', marginBottom: '0.6rem' }}>
                            {optionNames.length === 0
                              ? <span style={{ fontSize: '0.75rem', color: '#94a3b8' }}>This season uses the default &ldquo;{defaultCharge}&rdquo;. Add a charge type to price another{isAccomItem ? ' board basis' : ' charge'}.</span>
                              : optionNames.map((name) => (
                                <span key={name} style={{ background: '#fff', border: '1px solid #ddd6fe', borderRadius: '999px', padding: '0.22rem 0.65rem', fontSize: '0.75rem', fontWeight: 600, color: '#5b21b6' }}>
                                  {name}
                                </span>
                              ))}
                          </div>
                          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                            <input
                              list={`option-list-${item.tempId}`}
                              className="pricing-select"
                              style={{ maxWidth: '260px', padding: '0.4rem' }}
                              placeholder={isAccomItem ? 'e.g. Half Board' : 'e.g. Fuel charge'}
                              value={chargeOptionDraft[item.tempId] || ''}
                              onChange={(e) => setChargeOptionDraft((prev) => ({ ...prev, [item.tempId]: e.target.value }))}
                            />
                            <datalist id={`option-list-${item.tempId}`}>
                              {suggestions.map((n) => <option key={n} value={n} />)}
                            </datalist>
                            <button
                              type="button"
                              className="secondary-btn"
                              disabled={!(chargeOptionDraft[item.tempId] || '').trim() || !activeGroup}
                              onClick={() => {
                                handleAddChargeToSeason(item.tempId, activeGroup, chargeOptionDraft[item.tempId]);
                                setChargeOptionDraft((prev) => ({ ...prev, [item.tempId]: '' }));
                              }}
                            >
                              <Plus size={13} /> Add charge type to this season
                            </button>
                          </div>
                        </div>
                      );
                    })()}

                    {item.seasons.map((season, seasonIdx) => {
                      /* Seasonal Rates Matrix shows one season at a time; the
                         arrows below move between them. Accommodation and Extras
                         are edited season-first: the visible season shows one
                         charge type at a time, and the chips below switch
                         between them. */
                      const isAccom = item.category === 'Accommodation';
                      const groupsSeasons = hasChargeTypes(item.category);
                      const chargeGroups = groupsSeasons
                        ? accommodationSeasonGroupsFor(item.seasons, isAccom ? activeRoomKeyFor(item) : '')
                        : null;
                      const activeGroupIdx = groupsSeasons
                        ? activeSeasonIndexOf(item.tempId, chargeGroups)
                        : activeSeasonIndexOf(item.tempId, item.seasons);
                      const activeGroup = groupsSeasons ? chargeGroups[activeGroupIdx] : null;
                      const activeMemberIdx = groupsSeasons
                        ? activeChargeIndexOf(item.tempId, activeGroup)
                        : activeSeasonIndexOf(item.tempId, item.seasons);
                      if (seasonIdx !== activeMemberIdx) return null;
                      const totalSeasons = groupsSeasons ? chargeGroups.length : item.seasons.length;
                      const seasonPos = groupsSeasons ? activeGroupIdx : seasonIdx;
                      const headerName = groupsSeasons ? activeGroup?.seasonName : season.seasonName;
                      const navSeasons = groupsSeasons ? chargeGroups : item.seasons;
                      const bands = item.childAgeRanges || [];
                      /* Capacity decides which price boxes are live: a room
                         that cannot take two adults has no sharing rate, one
                         that cannot take three has no extra-adult rate, and a
                         room with no child slots has no child prices. */
                      const seasonRoomKey = isAccom ? (activeGroup?.roomKey || activeRoomKeyFor(item)) : '';
                      const roomModel = roomModelFor(item, seasonRoomKey);
                      const isFlatRoom = roomModel === 'per_room';
                      /* A villa on the occupancy ladder replaces the whole adult
                         and child matrix with one box per party size, so the two
                         are never on screen at once and cannot disagree. */
                      const occupancyPricedRoom = isAccom && dbFeatures.occupancyPricing && roomModel === OCCUPANCY_BASIS;
                      const occupancySizes = occupancyPricedRoom
                        ? occupancySizesForRoom(activeRoomFor(item, seasonRoomKey))
                        : [];
                      const occupancyProblem = occupancyPricedRoom
                        ? occupancyLadderError(
                          { occupancy_rates: occupancyLadderFromEdit(occupancySizes, season) },
                          Math.max(1, parseInt(activeRoomFor(item, seasonRoomKey)?.maxOccupancy, 10) || 2)
                        )
                        : '';
                      const capacity = priceCapacityFor(item, seasonRoomKey);
                      /* A fee is one figure with one basis: the fee box at the
                         bottom of this card is the only thing the itinerary
                         charges. The per-person adult/child matrix below has no
                         meaning for it, so it is greyed out rather than left
                         editable - a number typed there is money that never
                         reaches a quote but makes an unpriced fee look priced. */
                      const isFeeItem = isSurchargeItem(item);
                      const feeOnlyNote = 'A fee is priced by its own figure in the fee box below.';
                      /* Only the categories that buy per head - meals, entries and
                         extras - contract a child price the itinerary actually
                         charges, and rooms price a child sharing with an adult.
                         Everything else sells SPACE: a seat on a transfer, a place
                         on a tour, a berth on a train, a charter, a rental car. A
                         child occupies as much of it as an adult and is charged the
                         adult figure, so a child rate typed there prints on a rate
                         card but never reaches a quote. The supplier sends those
                         figures, so the box stays visible and greyed with the reason
                         rather than disappearing. */
                      const childRatesCharged = isAccom
                        || chargesChildRate({ category: item.category, pricing_model: item.pricingModel });
                      const spaceChildNote = 'A child pays the adult rate: this line sells space, and a child takes the same space as an adult.';
                      const canShare = !isFeeItem && capacity.maxAdults >= 2;
                      const canTakeThirdAdult = !isFeeItem && capacity.maxAdults >= 3;
                      const takesChildren = !isFeeItem && childRatesCharged && capacityTakesChildren(capacity);
                      /* A space-selling category keeps showing the child fare the
                         supplier quoted - it is a real figure, it prints on the rate
                         card, the itinerary simply does not bill it. A room with no
                         child slots has no figure to show, so that box stays blank. */
                      const childRatesShown = takesChildren || (!isFeeItem && !childRatesCharged);
                      const singleRateLive = !isFeeItem;
                      const rateOffCaption = isFeeItem ? 'Not used by a fee' : 'Not used by this room';
                      const childOffCaption = !childRatesCharged
                        ? 'Charged at the adult rate'
                        : rateOffCaption;
                      const shareOffTitle = isFeeItem ? feeOnlyNote : 'This room cannot take two adults';
                      const thirdOffTitle = isFeeItem ? feeOnlyNote : 'This room cannot take three adults';
                      const childOffTitle = isFeeItem
                        ? feeOnlyNote
                        : (!childRatesCharged ? spaceChildNote : 'This room has no child slots');
                      /* The fee block inside this season is keyed by the season
                         it belongs to, so its amount box edits that season only. */
                      const feeSeason = isAccom && activeGroup
                        ? feeSeasonKey(activeGroup.seasonName, activeGroup.validFrom, activeGroup.validTo)
                        : '';

                      return (
                        <div key={seasonIdx} style={{ background: '#fff', padding: '1rem', borderRadius: '8px', border: '1px solid #e2e8f0', marginBottom: '1rem' }}>

                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem', marginBottom: '0.75rem', flexWrap: 'wrap' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                              {totalSeasons > 1 && (
                                <button
                                  type="button"
                                  onClick={() => stepActiveSeason(item.tempId, navSeasons, -1)}
                                  title="Previous season"
                                  aria-label="Previous season"
                                  style={seasonNavBtnStyle}
                                >
                                  <ChevronLeft size={16} />
                                </button>
                              )}
                              <span style={{ fontWeight: 700, fontSize: '0.85rem', color: '#475569' }}>
                                Season {seasonPos + 1}{' '}
                                <span style={{ fontWeight: 400, color: '#94a3b8' }}>
                                  of {totalSeasons} ({headerName})
                                </span>
                              </span>
                              {totalSeasons > 1 && (
                                <button
                                  type="button"
                                  onClick={() => stepActiveSeason(item.tempId, navSeasons, 1)}
                                  title="Next season"
                                  aria-label="Next season"
                                  style={seasonNavBtnStyle}
                                >
                                  <ChevronRight size={16} />
                                </button>
                              )}
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                              {totalSeasons > 1 && (
                                <span style={{ fontSize: '0.72rem', color: '#94a3b8' }}>
                                  Use the arrows to move between seasons
                                </span>
                              )}
                              {totalSeasons > 1 && (
                                <button type="button" onClick={() => (groupsSeasons ? handleRemoveSeasonGroup(item.tempId, activeGroup) : handleRemoveSeasonRow(item.tempId, seasonIdx))}
                                  style={{ color: '#ef4444', background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.75rem', display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
                                  <Trash2 size={14} /> Remove Season
                                </button>
                              )}
                            </div>
                          </div>

                          {/* Season Name & Dates */}
                          <div style={{ display: 'grid', gridTemplateColumns: isAccom ? (dbFeatures.nightBands ? '1.2fr 1fr 1fr 1.1fr 0.7fr 0.7fr' : '1.2fr 1fr 1fr 1.1fr') : (groupsSeasons ? '1.2fr 1fr 1fr 1.1fr' : '2fr 1fr 1fr'), gap: '1rem', marginBottom: isAccom ? '0.75rem' : '1rem' }}>
                            <div>
                              <label style={{ fontSize: '0.75rem', fontWeight: 600, color: '#64748b', display: 'block', marginBottom: '0.25rem' }}>Season Name</label>
                              <input type="text" className="pricing-select" style={{ padding: '0.4rem', fontSize: '0.85rem' }}
                                placeholder="e.g. Base / High Season"
                                value={season.seasonName}
                                onChange={(e) => (groupsSeasons
                                  ? handleSeasonGroupChange(item.tempId, activeGroup.memberIndices, 'seasonName', e.target.value)
                                  : handleSeasonChange(item.tempId, seasonIdx, 'seasonName', e.target.value))} />
                            </div>
                            {groupsSeasons && (
                              <div>
                                <label style={{ fontSize: '0.75rem', fontWeight: 600, color: '#64748b', display: 'block', marginBottom: '0.25rem' }}>Charge type</label>
                                <input type="text" className="pricing-select" list={`option-list-${item.tempId}`} style={{ padding: '0.4rem', fontSize: '0.85rem' }}
                                  placeholder={isAccom ? 'e.g. Half Board (blank = default)' : 'e.g. Fuel charge (blank = the item itself)'}
                                  value={season.optionName || ''}
                                  onChange={(e) => handleSeasonChange(item.tempId, seasonIdx, 'optionName', e.target.value)} />
                              </div>
                            )}
                            {isAccom && dbFeatures.nightBands && (
                              <>
                                <div>
                                  <label style={{ fontSize: '0.75rem', fontWeight: 600, color: '#64748b', display: 'block', marginBottom: '0.25rem' }}>Nights from</label>
                                  <input type="number" min="1" step="1" className="pricing-select" style={{ padding: '0.4rem', fontSize: '0.85rem' }}
                                    placeholder="every stay"
                                    value={season.minNights ?? ''}
                                    onChange={(e) => handleSeasonChange(item.tempId, seasonIdx, 'minNights', e.target.value)} />
                                </div>
                                <div>
                                  <label style={{ fontSize: '0.75rem', fontWeight: 600, color: '#64748b', display: 'block', marginBottom: '0.25rem' }}>Nights to</label>
                                  <input type="number" min="1" step="1" className="pricing-select" style={{ padding: '0.4rem', fontSize: '0.85rem' }}
                                    placeholder="open ended"
                                    value={season.maxNights ?? ''}
                                    onChange={(e) => handleSeasonChange(item.tempId, seasonIdx, 'maxNights', e.target.value)} />
                                </div>
                              </>
                            )}
                            <div>
                              <label style={{ fontSize: '0.75rem', fontWeight: 600, color: '#64748b', display: 'block', marginBottom: '0.25rem' }}>Valid From</label>
                              <input type="date" className="pricing-select" style={{ padding: '0.4rem', fontSize: '0.85rem' }}
                                value={season.validFrom}
                                onChange={(e) => (groupsSeasons
                                  ? handleSeasonGroupChange(item.tempId, activeGroup.memberIndices, 'validFrom', e.target.value)
                                  : handleSeasonChange(item.tempId, seasonIdx, 'validFrom', e.target.value))} />
                            </div>
                            <div>
                              <label style={{ fontSize: '0.75rem', fontWeight: 600, color: '#64748b', display: 'block', marginBottom: '0.25rem' }}>Valid To</label>
                              <input type="date" className="pricing-select" style={{ padding: '0.4rem', fontSize: '0.85rem' }}
                                value={season.validTo}
                                onChange={(e) => (groupsSeasons
                                  ? handleSeasonGroupChange(item.tempId, activeGroup.memberIndices, 'validTo', e.target.value)
                                  : handleSeasonChange(item.tempId, seasonIdx, 'validTo', e.target.value))} />
                            </div>
                          </div>

                          {isAccom && dbFeatures.nightBands && (
                            <p style={{ fontSize: '0.74rem', color: '#64748b', margin: '0 0 0.9rem', lineHeight: 1.45 }}>
                              Night band: leave both boxes blank when the room has one price for every stay. Fill them in when the price changes with
                              the length of stay &mdash; 1&ndash;3 nights at one figure, 4+ at another. It stays the same room and the same charge type,
                              not a second library item.
                            </p>
                          )}

                          {/* Charge types of this season — pick which one the
                              prices below belong to. */}
                          {groupsSeasons && activeGroup && (
                            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0.4rem', marginBottom: '1rem' }}>
                              <span style={{ fontSize: '0.72rem', fontWeight: 600, color: '#64748b' }}>Charge type:</span>
                              {activeGroup.memberIndices.map((idx) => {
                                const band = isAccom ? nightBandLabel(item.seasons[idx]) : '';
                                const unnamed = isAccom ? (item.mealPlan || 'Default board') : (item.name || 'Default charge');
                                const label = (item.seasons[idx]?.optionName || unnamed).trim() || unnamed;
                                const selected = idx === activeMemberIdx;
                                return (
                                  <button
                                    key={idx}
                                    type="button"
                                    onClick={() => setActiveChargeByItem((prev) => ({ ...prev, [item.tempId]: idx }))}
                                    style={{
                                      padding: '0.22rem 0.7rem', borderRadius: '999px', cursor: 'pointer', fontSize: '0.75rem', fontWeight: 600,
                                      border: `1px solid ${selected ? '#0d7478' : '#ddd6fe'}`,
                                      background: selected ? '#f0fdfa' : '#fff',
                                      color: selected ? '#0d7478' : '#5b21b6'
                                    }}
                                  >
                                    {band ? `${label} · ${band}` : label}
                                  </button>
                                );
                              })}
                            </div>
                          )}

                          {/* Flat Room Rate Input OR PPS Tier Inputs */}
                          {isGuideCategory(item.category) ? (
                            <div style={{ background: '#faf5ff', border: '1px solid #ddd6fe', borderRadius: '8px', padding: '1rem' }}>
                              <label style={{ fontSize: '0.82rem', fontWeight: 700, color: '#1e293b', display: 'block', marginBottom: '0.5rem' }}>
                                Guide Rates ({item.currency}) — Flat Per Trip by Service Type
                              </label>
                              <div style={{ fontSize: '0.74rem', color: '#64748b', marginBottom: '0.65rem', lineHeight: 1.45 }}>
                                The Guide charges a different flat per-trip rate depending on the service it accompanies.
                                The itinerary builder picks the price for the service at hand.
                              </div>
                              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.75rem', maxWidth: '980px' }}>
                                {guideServiceTypes.map(gst => (
                                  <div key={gst.id}>
                                    <span style={{ fontSize: '0.75rem', fontWeight: 600, color: '#475569', display: 'block', marginBottom: '0.25rem' }}>
                                      {gst.label} ({item.currency})
                                    </span>
                                    <input
                                      type="number"
                                      min="0"
                                      className="pricing-select"
                                      style={{ padding: '0.45rem 0.75rem', fontSize: '0.95rem', fontWeight: 700, width: '100%' }}
                                      placeholder="e.g. 1800"
                                      value={season[gst.field] !== undefined ? season[gst.field] : ''}
                                      onChange={(e) => handleSeasonChange(item.tempId, seasonIdx, gst.field, e.target.value)} step={moneyStep} onBlur={(e) => snapSeasonMoney(e, item.tempId, seasonIdx, gst.field)}
                                    />
                                  </div>
                                ))}
                              </div>
                              <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '0.6rem', lineHeight: 1.45 }}>
                                Rates are shared among travellers. Meals &amp; accommodation triggers are set in Guide Details above.
                              </div>
                            </div>
                          ) : isMealsCategory(item.category) ? (
                            <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '1rem' }}>
                              <label style={{ fontSize: '0.82rem', fontWeight: 700, color: '#1e293b', display: 'block', marginBottom: '0.5rem' }}>
                                Meal Fare ({item.currency}) — Per Person
                              </label>
                              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.75rem', maxWidth: '520px' }}>
                                <div>
                                  <label style={{ fontSize: '0.75rem', fontWeight: 600, color: '#475569', display: 'block', marginBottom: '0.25rem' }}>
                                    Adult Rate ({item.currency})
                                  </label>
                                  <input
                                    type="number"
                                    min="0"
                                    className="pricing-select"
                                    style={{ padding: '0.45rem 0.75rem', fontSize: '1rem', fontWeight: 700, width: '100%' }}
                                    placeholder="e.g. 850"
                                    value={season.adultRate !== undefined ? season.adultRate : ''}
                                    onChange={(e) => handleSeasonChange(item.tempId, seasonIdx, 'adultRate', e.target.value)} step={moneyStep} onBlur={(e) => snapSeasonMoney(e, item.tempId, seasonIdx, 'adultRate')}
                                  />
                                  <span style={{ fontSize: '0.7rem', color: '#94a3b8', display: 'block' }}>Charged per adult</span>
                                </div>
                                <div>
                                  <label style={{ fontSize: '0.75rem', fontWeight: 600, color: '#475569', display: 'block', marginBottom: '0.25rem' }}>
                                    Child Rate ({item.currency})
                                  </label>
                                  <input
                                    type="number"
                                    min="0"
                                    className="pricing-select"
                                    style={{ padding: '0.45rem 0.75rem', fontSize: '1rem', fontWeight: 700, width: '100%' }}
                                    placeholder="e.g. 450"
                                    value={season.childRate !== undefined ? season.childRate : ''}
                                    onChange={(e) => handleSeasonChange(item.tempId, seasonIdx, 'childRate', e.target.value)} step={moneyStep} onBlur={(e) => snapSeasonMoney(e, item.tempId, seasonIdx, 'childRate')}
                                  />
                                  <span style={{ fontSize: '0.7rem', color: '#94a3b8', display: 'block' }}>Charged per child</span>
                                </div>
                                <div>
                                  <label style={{ fontSize: '0.75rem', fontWeight: 600, color: '#475569', display: 'block', marginBottom: '0.25rem' }}>
                                    Guide Rate ({item.currency})
                                  </label>
                                  <input
                                    type="number"
                                    min="0"
                                    className="pricing-select"
                                    style={{ padding: '0.45rem 0.75rem', fontSize: '1rem', fontWeight: 700, width: '100%' }}
                                    placeholder="e.g. 500"
                                    value={season.guideRate !== undefined ? season.guideRate : ''}
                                    onChange={(e) => handleSeasonChange(item.tempId, seasonIdx, 'guideRate', e.target.value)} step={moneyStep} onBlur={(e) => snapSeasonMoney(e, item.tempId, seasonIdx, 'guideRate')}
                                  />
                                </div>
                                <div>
                                  <label style={{ fontSize: '0.75rem', fontWeight: 600, color: '#475569', display: 'block', marginBottom: '0.25rem' }}>
                                    Driver Rate ({item.currency})
                                  </label>
                                  <input
                                    type="number"
                                    min="0"
                                    className="pricing-select"
                                    style={{ padding: '0.45rem 0.75rem', fontSize: '1rem', fontWeight: 700, width: '100%' }}
                                    placeholder="e.g. 500"
                                    value={season.driverRate !== undefined ? season.driverRate : ''}
                                    onChange={(e) => handleSeasonChange(item.tempId, seasonIdx, 'driverRate', e.target.value)} step={moneyStep} onBlur={(e) => snapSeasonMoney(e, item.tempId, seasonIdx, 'driverRate')}
                                  />
                                </div>
                              </div>
                              <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '0.6rem', lineHeight: 1.45 }}>
                                {(parseFloat(item.mealGratuityPercent) || 0) > 0
                                  ? `A ${parseFloat(item.mealGratuityPercent)}% gratuity is added on top of the fare.`
                                  : 'No gratuity is added to this fare.'}
                                {dbFeatures.staffOptions && !item.guideMealOffered && !item.driverMealOffered
                                  ? ' This meal is not on the crew manifest yet — tick "Guide meal" or "Driver meal" in Meal Details above to offer it in the guide details dialog.'
                                  : ''}
                              </div>
                            </div>
                          ) : isTicketCategory(item.category) ? (
                            <div style={{ background: '#f0fdfa', border: '1px solid #99f6e4', borderRadius: '8px', padding: '1rem' }}>
                              {item.ticketType !== 'fast_track' && (
                                <>
                              <label style={{ fontSize: '0.82rem', fontWeight: 700, color: '#1e293b', display: 'block', marginBottom: '0.5rem' }}>
                                Standard Ticket Fare ({item.currency}) — Per Person
                              </label>
                              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.75rem', maxWidth: '520px' }}>
                                <div>
                                  <label style={{ fontSize: '0.75rem', fontWeight: 600, color: '#475569', display: 'block', marginBottom: '0.25rem' }}>
                                    Adult Rate ({item.currency})
                                  </label>
                                  <input
                                    type="number"
                                    min="0"
                                    className="pricing-select"
                                    style={{ padding: '0.45rem 0.75rem', fontSize: '1rem', fontWeight: 700, width: '100%' }}
                                    placeholder="e.g. 850"
                                    value={season.adultRate !== undefined ? season.adultRate : ''}
                                    onChange={(e) => handleSeasonChange(item.tempId, seasonIdx, 'adultRate', e.target.value)} step={moneyStep} onBlur={(e) => snapSeasonMoney(e, item.tempId, seasonIdx, 'adultRate')}
                                  />
                                  <span style={{ fontSize: '0.7rem', color: '#94a3b8', display: 'block' }}>Charged per adult</span>
                                </div>
                              </div>

                              {/* Children Pricing per Age Range — Standard */}
                              {bands.length > 0 && (
                                <div style={{ marginTop: '1rem' }}>
                                  <label style={{ fontSize: '0.8rem', fontWeight: 700, color: '#334155', display: 'block', marginBottom: '0.5rem' }}>
                                    Children Pricing per Age Range (Per Person — {item.currency})
                                  </label>
                                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '0.75rem' }}>
                                    {bands.map((band) => (
                                      <div key={band.id}>
                                        <span style={{ fontSize: '0.75rem', color: '#475569', fontWeight: 600, display: 'block' }}>
                                          {band.name} ({band.ageFrom}–{band.ageTo} yrs)
                                        </span>
                                        <input
                                          type="number"
                                          min="0"
                                          className="pricing-select"
                                          style={{ padding: '0.35rem' }}
                                          placeholder={`Price (${item.currency})`}
                                          value={season.childRates?.[band.id] !== undefined ? season.childRates[band.id] : ''}
                                          onChange={(e) => handleChildRateChange(item.tempId, seasonIdx, band.id, e.target.value)} step={moneyStep} onBlur={(e) => snapBandRate(e, item.tempId, seasonIdx, band.id, handleChildRateChange)}
                                        />
                                        <span style={{ fontSize: '0.68rem', color: '#94a3b8' }}>Per child</span>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}
                                </>
                              )}

                              {item.ticketType !== 'standard' && (
                                <>
                                  {item.ticketType === 'both' && (<hr style={{ border: 'none', borderTop: '1px dashed #99f6e4', marginTop: '1.2rem' }} />)}
                                  <label style={{ fontSize: '0.82rem', fontWeight: 700, color: '#1e293b', display: 'block', marginBottom: '0.5rem', marginTop: '0.4rem' }}>
                                    Fast Track Ticket Fare ({item.currency}) — Per Person
                                  </label>
                                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.75rem', maxWidth: '520px' }}>
                                    <div>
                                      <label style={{ fontSize: '0.75rem', fontWeight: 600, color: '#475569', display: 'block', marginBottom: '0.25rem' }}>
                                        Adult Rate ({item.currency})
                                      </label>
                                      <input
                                        type="number"
                                        min="0"
                                        className="pricing-select"
                                        style={{ padding: '0.45rem 0.75rem', fontSize: '1rem', fontWeight: 700, width: '100%' }}
                                        placeholder="e.g. 1200"
                                        value={season.fastTrackAdultRate !== undefined ? season.fastTrackAdultRate : ''}
                                        onChange={(e) => handleSeasonChange(item.tempId, seasonIdx, 'fastTrackAdultRate', e.target.value)} step={moneyStep} onBlur={(e) => snapSeasonMoney(e, item.tempId, seasonIdx, 'fastTrackAdultRate')}
                                      />
                                      <span style={{ fontSize: '0.7rem', color: '#94a3b8', display: 'block' }}>Charged per adult</span>
                                    </div>
                                  </div>

                                  {/* Children Pricing per Age Range — Fast Track */}
                                  {bands.length > 0 && (
                                    <div style={{ marginTop: '1rem' }}>
                                      <label style={{ fontSize: '0.8rem', fontWeight: 700, color: '#334155', display: 'block', marginBottom: '0.5rem' }}>
                                        Fast Track Children Pricing per Age Range (Per Person — {item.currency})
                                      </label>
                                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '0.75rem' }}>
                                        {bands.map((band) => (
                                          <div key={band.id}>
                                            <span style={{ fontSize: '0.75rem', color: '#475569', fontWeight: 600, display: 'block' }}>
                                              {band.name} ({band.ageFrom}–{band.ageTo} yrs)
                                            </span>
                                            <input
                                              type="number"
                                              min="0"
                                              className="pricing-select"
                                              style={{ padding: '0.35rem' }}
                                              placeholder={`Price (${item.currency})`}
                                              value={season.fastTrackChildRates?.[band.id] !== undefined ? season.fastTrackChildRates[band.id] : ''}
                                              onChange={(e) => handleFastTrackChildRateChange(item.tempId, seasonIdx, band.id, e.target.value)} step={moneyStep} onBlur={(e) => snapBandRate(e, item.tempId, seasonIdx, band.id, handleFastTrackChildRateChange)}
                                            />
                                            <span style={{ fontSize: '0.68rem', color: '#94a3b8' }}>Per child</span>
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                  )}
                                </>
                              )}
                              <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '0.6rem', lineHeight: 1.45 }}>
                                Tickets are always quoted per person. Child rates apply by age range (configured above).
                              </div>
                            </div>
                          ) : isExtrasCategory(item.category) ? (
                            <div style={{ background: '#fdf2f8', border: '1px solid #fbcfe8', borderRadius: '8px', padding: '1rem' }}>
                              <label style={{ fontSize: '0.82rem', fontWeight: 700, color: '#1e293b', display: 'block', marginBottom: '0.5rem' }}>
                                {(season.optionName || '').trim() ? `${(season.optionName || '').trim()} — ` : 'Extra Service Fare — '}
                                ({item.currency}) {item.pricingModel === 'per_unit' ? 'Service only (per unit)' : 'Per Person'}
                              </label>
                              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.75rem', maxWidth: '520px' }}>
                                <div>
                                  <label style={{ fontSize: '0.75rem', fontWeight: 600, color: '#475569', display: 'block', marginBottom: '0.25rem' }}>
                                    {item.pricingModel === 'per_unit' ? 'Unit Price' : 'Adult Rate'} ({item.currency})
                                  </label>
                                  <input
                                    type="number"
                                    min="0"
                                    className="pricing-select"
                                    style={{ padding: '0.45rem 0.75rem', fontSize: '1rem', fontWeight: 700, width: '100%' }}
                                    placeholder={item.pricingModel === 'per_unit' ? 'e.g. 3500' : 'e.g. 850'}
                                    value={season.adultRate !== undefined ? season.adultRate : ''}
                                    onChange={(e) => handleSeasonChange(item.tempId, seasonIdx, 'adultRate', e.target.value)} step={moneyStep} onBlur={(e) => snapSeasonMoney(e, item.tempId, seasonIdx, 'adultRate')}
                                  />
                                  <span style={{ fontSize: '0.7rem', color: '#94a3b8', display: 'block' }}>
                                    {item.pricingModel === 'per_unit' ? 'Charged once for the whole service' : 'Charged per adult'}
                                  </span>
                                </div>
                                {item.pricingModel === 'per_unit' ? null : (
                                <div>
                                  <label style={{ fontSize: '0.75rem', fontWeight: 600, color: '#475569', display: 'block', marginBottom: '0.25rem' }}>
                                    Child Rate ({item.currency})
                                  </label>
                                  <input
                                    type="number"
                                    min="0"
                                    className="pricing-select"
                                    style={{ padding: '0.45rem 0.75rem', fontSize: '1rem', fontWeight: 700, width: '100%' }}
                                    placeholder="e.g. 450"
                                    value={season.childRate !== undefined ? season.childRate : ''}
                                    onChange={(e) => handleSeasonChange(item.tempId, seasonIdx, 'childRate', e.target.value)} step={moneyStep} onBlur={(e) => snapSeasonMoney(e, item.tempId, seasonIdx, 'childRate')}
                                  />
                                  <span style={{ fontSize: '0.7rem', color: '#94a3b8', display: 'block' }}>Charged per child</span>
                                </div>
                                )}
                              </div>
                              <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '0.6rem', lineHeight: 1.45 }}>
                                {item.pricingModel === 'per_unit'
                                  ? 'Charged once for the service itself, however many guests take it. Only repeating the line multiplies it, and no guest - adult or child - is priced on it.'
                                  : 'Charged for every guest taking the extra. Set the child rate if children pay a different price.'}
                              </div>
                            </div>
                          ) : isFlightCategory(item.category) ? (
                            <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '1rem' }}>
                              <label style={{ fontSize: '0.82rem', fontWeight: 700, color: '#1e293b', display: 'block', marginBottom: '0.5rem' }}>
                                Flight Fare ({item.currency}) {item.pricingModel === 'per_vehicle' ? '— Per Charter (Whole Flight)' : '— Per Person'}
                              </label>
                              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.75rem', maxWidth: '520px' }}>
                                <div>
                                  <label style={{ fontSize: '0.75rem', fontWeight: 600, color: '#475569', display: 'block', marginBottom: '0.25rem' }}>
                                    {item.pricingModel === 'per_vehicle' ? 'Charter Rate' : 'Adult Rate'} ({item.currency})
                                  </label>
                                  <input
                                    type="number"
                                    min="0"
                                    className="pricing-select"
                                    style={{ padding: '0.45rem 0.75rem', fontSize: '1rem', fontWeight: 700, width: '100%' }}
                                    placeholder={item.pricingModel === 'per_vehicle' ? 'e.g. 200000' : 'e.g. 8500'}
                                    value={season.adultRate !== undefined ? season.adultRate : ''}
                                    onChange={(e) => handleSeasonChange(item.tempId, seasonIdx, 'adultRate', e.target.value)} step={moneyStep} onBlur={(e) => snapSeasonMoney(e, item.tempId, seasonIdx, 'adultRate')}
                                  />
                                  <span style={{ fontSize: '0.7rem', color: '#94a3b8', display: 'block' }}>
                                    {item.pricingModel === 'per_vehicle' ? 'Charged once for the whole flight' : 'Charged per adult'}
                                  </span>
                                </div>
                                <div>
                                  <label style={{ fontSize: '0.75rem', fontWeight: 600, color: '#475569', display: 'block', marginBottom: '0.25rem' }}>
                                    Child Rate ({item.currency}) <span style={{ fontWeight: 400, color: '#94a3b8' }}>(optional)</span>
                                  </label>
                                  <input
                                    type="number"
                                    min="0"
                                    className="pricing-select"
                                    style={{ padding: '0.45rem 0.75rem', fontSize: '1rem', fontWeight: 700, width: '100%', ...(!childRatesCharged ? disabledPriceInputStyle : {}) }}
                                    placeholder={childRatesCharged ? 'e.g. 4500' : 'Recorded, not charged'}
                                    title={childRatesCharged ? undefined : spaceChildNote}
                                    disabled={!childRatesCharged}
                                    value={season.childRate !== undefined ? season.childRate : ''}
                                    onChange={(e) => handleSeasonChange(item.tempId, seasonIdx, 'childRate', e.target.value)} step={moneyStep} onBlur={(e) => snapSeasonMoney(e, item.tempId, seasonIdx, 'childRate')}
                                  />
                                  <span style={{ fontSize: '0.7rem', color: '#94a3b8', display: 'block' }}>
                                    {childRatesCharged ? 'Charged per child' : 'Not charged — a child takes a seat'}
                                  </span>
                                </div>
                                <div>
                                  <label style={{ fontSize: '0.75rem', fontWeight: 600, color: '#475569', display: 'block', marginBottom: '0.25rem' }}>
                                    Taxes &amp; Surcharges ({item.currency})
                                  </label>
                                  <input
                                    type="number"
                                    min="0"
                                    className="pricing-select"
                                    style={{ padding: '0.45rem 0.75rem', fontSize: '1rem', fontWeight: 700, width: '100%' }}
                                    placeholder="e.g. 900"
                                    value={season.taxesAndSurcharges !== undefined ? season.taxesAndSurcharges : ''}
                                    onChange={(e) => handleSeasonChange(item.tempId, seasonIdx, 'taxesAndSurcharges', e.target.value)} step={moneyStep} onBlur={(e) => snapSeasonMoney(e, item.tempId, seasonIdx, 'taxesAndSurcharges')}
                                  />
                                  <span style={{ fontSize: '0.7rem', color: '#94a3b8', display: 'block' }}>Fuel surcharge, airport fees, etc.</span>
                                </div>
                                {item.guideFlightOffered && dbFeatures.staffOptions && (
                                  <div>
                                    <label style={{ fontSize: '0.75rem', fontWeight: 600, color: '#475569', display: 'block', marginBottom: '0.25rem' }}>
                                      Guide Fare ({item.currency})
                                    </label>
                                    <input
                                      type="number"
                                      min="0"
                                      className="pricing-select"
                                      style={{ padding: '0.45rem 0.75rem', fontSize: '1rem', fontWeight: 700, width: '100%' }}
                                      placeholder={item.pricingModel === 'per_vehicle' ? 'e.g. 8500' : 'same as adult'}
                                      value={season.guideRate !== undefined ? season.guideRate : ''}
                                      onChange={(e) => handleSeasonChange(item.tempId, seasonIdx, 'guideRate', e.target.value)} step={moneyStep} onBlur={(e) => snapSeasonMoney(e, item.tempId, seasonIdx, 'guideRate')}
                                    />
                                    <span style={{ fontSize: '0.7rem', color: '#94a3b8', display: 'block' }}>
                                      {item.pricingModel === 'per_vehicle'
                                        ? 'One seat on the charter. Blank charges the adult fare.'
                                        : "The guide's own seat. Blank charges the fare the clients pay."}
                                    </span>
                                  </div>
                                )}
                              </div>

                              <div style={{ maxWidth: '220px', marginTop: '1rem' }}>
                                <label style={{ fontSize: '0.75rem', fontWeight: 600, color: '#475569', display: 'block', marginBottom: '0.25rem' }}>
                                  Child Age Limit (yrs)
                                </label>
                                <input
                                  type="number"
                                  min="1"
                                  max="17"
                                  className="pricing-select"
                                  style={{ padding: '0.45rem 0.75rem', fontSize: '0.95rem', width: '100%', ...(!childRatesCharged ? disabledPriceInputStyle : {}) }}
                                  title={childRatesCharged ? undefined : spaceChildNote}
                                  disabled={!childRatesCharged}
                                  value={item.childAge || 12}
                                  onChange={(e) => handleItemFieldChange(item.tempId, 'childAge', e.target.value)}
                                />
                              </div>
                            </div>
                          ) : isTourStyle ? (
                            <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '1rem' }}>
                              {item.pricingModel === 'tiered' ? (
                                <>
                                  <label style={{ fontSize: '0.82rem', fontWeight: 700, color: '#1e293b', display: 'block', marginBottom: '0.5rem' }}>
                                    Tiered Rates by Pax Count ({item.currency})
                                  </label>
                                  {(season.tiers || []).map((tier, tierIdx) => (
                                    <div key={`${seasonIdx}-t${tierIdx}`} style={{ display: 'flex', alignItems: 'flex-end', gap: '0.6rem', marginBottom: '0.55rem', flexWrap: 'wrap' }}>
                                      <div>
                                        <span style={{ fontSize: '0.7rem', color: '#64748b', fontWeight: 600, display: 'block' }}>Min Pax</span>
                                        <input
                                          type="number"
                                          min="1"
                                          className="pricing-select"
                                          style={{ width: '80px', padding: '0.35rem' }}
                                          value={tier.minPax ?? ''}
                                          onChange={(e) => handleUpdateTier(item.tempId, seasonIdx, tierIdx, 'minPax', e.target.value)}
                                        />
                                      </div>
                                      <div>
                                        <span style={{ fontSize: '0.7rem', color: '#64748b', fontWeight: 600, display: 'block' }}>Max Pax</span>
                                        <input
                                          type="number"
                                          min="1"
                                          className="pricing-select"
                                          style={{ width: '80px', padding: '0.35rem' }}
                                          value={tier.maxPax ?? ''}
                                          onChange={(e) => handleUpdateTier(item.tempId, seasonIdx, tierIdx, 'maxPax', e.target.value)}
                                        />
                                      </div>
                                      <div>
                                        <span style={{ fontSize: '0.7rem', color: '#64748b', fontWeight: 600, display: 'block' }}>Rate ({item.currency})</span>
                                        <input
                                          type="number"
                                          min="0"
                                          className="pricing-select"
                                          style={{ width: '120px', padding: '0.35rem' }}
                                          placeholder="e.g. 3000"
                                          value={tier.rate ?? ''}
                                          onChange={(e) => handleUpdateTier(item.tempId, seasonIdx, tierIdx, 'rate', e.target.value)}
                                        />
                                      </div>
                                      <button
                                        type="button"
                                        onClick={() => handleRemoveTier(item.tempId, seasonIdx, tierIdx)}
                                        style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', padding: '0.4rem', lineHeight: 1 }}
                                        title="Remove tier"
                                      >
                                        <Trash2 size={15} />
                                      </button>
                                    </div>
                                  ))}
                                  <button
                                    type="button"
                                    onClick={() => handleAddTierRow(item.tempId, seasonIdx)}
                                    style={{ background: '#ffffff', border: '1px dashed #cbd5e1', borderRadius: '6px', color: '#1d4ed8', padding: '0.4rem 0.9rem', fontSize: '0.78rem', fontWeight: 700, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}
                                  >
                                    <Plus size={14} /> Add Pax Tier
                                  </button>
                                  <div style={{ fontSize: '0.72rem', color: '#64748b', marginTop: '0.6rem' }}>
                                    Example: 1–3 pax → R 2,500 / 4–7 pax → R 3,200. The itinerary builder picks the band matching the passenger count.
                                  </div>
                                </>
                              ) : item.pricingModel === 'per_vehicle' ? (
                                dbFeatures.pricesByVehicle && vehicleTypes.length ? (
                                  <div>
                                    <label style={{ fontSize: '0.82rem', fontWeight: 700, color: '#1e293b', display: 'block', marginBottom: '0.35rem' }}>
                                      Price by Vehicle Type ({item.currency} per trip)
                                    </label>
                                    <div style={{ fontSize: '0.74rem', color: '#64748b', marginBottom: '0.6rem' }}>
                                      One price per vehicle this supplier quotes, on the same row. A quote picks the smallest vehicle that seats the party and charges that column in full; the party size divides it.
                                    </div>
                                    <table style={{ borderCollapse: 'collapse', fontSize: '0.8rem', minWidth: '30rem' }}>
                                      <thead>
                                        <tr>
                                          <th style={vehicleCellHead}>Vehicle</th>
                                          <th style={{ ...vehicleCellHead, textAlign: 'right' }}>Seats</th>
                                          <th style={{ ...vehicleCellHead, textAlign: 'right' }}>Price</th>
                                          <th style={vehicleCellHead}>Charge</th>
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {vehicleTypes.map((vehicleType) => {
                                          const entry = (season.pricesByVehicle || {})[vehicleType.code];
                                          const isState = typeof entry === 'object' && entry !== null;
                                          const state = entry === undefined ? 'priced' : (isState ? (entry.free ? 'free' : 'na') : 'priced');
                                          const amount = typeof entry === 'number' ? entry : '';
                                          return (
                                            <tr key={vehicleType.code} style={state === 'priced' ? undefined : { opacity: 0.7 }}>
                                              <td style={vehicleCell}>{vehicleType.name}</td>
                                              <td style={{ ...vehicleCell, textAlign: 'right' }}>{vehicleType.max_capacity}</td>
                                              <td style={{ ...vehicleCell, textAlign: 'right' }}>
                                                {state === 'priced' ? (
                                                  <input
                                                    type="number"
                                                    min="0"
                                                    step={moneyStep}
                                                    className="pricing-select"
                                                    style={{ width: '7.5rem', padding: '0.3rem 0.45rem', textAlign: 'right' }}
                                                    placeholder="not priced"
                                                    value={amount}
                                                    onChange={(e) => handleVehiclePriceChange(item.tempId, seasonIdx, vehicleType.code, e.target.value)}
                                                  />
                                                ) : (
                                                  <span style={{ color: '#94a3b8' }}>&mdash;</span>
                                                )}
                                              </td>
                                              <td style={vehicleCell}>
                                                <select
                                                  className="pricing-select"
                                                  style={{ padding: '0.3rem 0.45rem', fontSize: '0.78rem' }}
                                                  value={state}
                                                  onChange={(e) => {
                                                    const next = e.target.value;
                                                    handleVehiclePriceChange(item.tempId, seasonIdx, vehicleType.code,
                                                      next === 'priced' ? (typeof entry === 'number' ? entry : '')
                                                        : (next === 'free' ? { free: true } : { na: true }));
                                                  }}
                                                >
                                                  <option value="priced">Price</option>
                                                  <option value="free">Free (no charge)</option>
                                                  <option value="na">Doesn&rsquo;t apply</option>
                                                </select>
                                              </td>
                                            </tr>
                                          );
                                        })}
                                      </tbody>
                                    </table>
                                    <div style={{ fontSize: '0.74rem', color: '#64748b', marginTop: '0.5rem' }}>
                                      A vehicle left <strong>not priced</strong> blocks that party size from being sold. Choose <em>Free</em> or <em>Doesn&rsquo;t apply</em> only when the supplier really charges nothing for it.
                                    </div>
                                  </div>
                                )
                                : (
                                <div>
                                  <label style={{ fontSize: '0.82rem', fontWeight: 700, color: '#1e293b', display: 'block', marginBottom: '0.35rem' }}>
                                    Vehicle Rate per Trip ({item.currency})
                                  </label>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', maxWidth: '320px' }}>
                                    <input
                                      type="number"
                                      min="0"
                                      className="pricing-select"
                                      style={{ padding: '0.45rem 0.75rem', fontSize: '1rem', fontWeight: 700 }}
                                      placeholder="e.g. 3000"
                                      value={season.adultRate !== undefined ? season.adultRate : ''}
                                      onChange={(e) => handleSeasonChange(item.tempId, seasonIdx, 'adultRate', e.target.value)} step={moneyStep} onBlur={(e) => snapSeasonMoney(e, item.tempId, seasonIdx, 'adultRate')}
                                    />
                                    <span style={{ fontSize: '0.8rem', color: '#64748b', whiteSpace: 'nowrap' }}>/ Vehicle</span>
                                  </div>
                                  <div style={{ fontSize: '0.74rem', color: '#64748b', marginTop: '0.45rem' }}>
                                    Flat price for up to <strong>{item.maxOccupancy || 4} pax</strong>. In quotes, per-person rate is: <code>{item.currency} {parseFloat(season.adultRate) || 0} ÷ (Passengers)</code>.
                                  </div>
                                </div>
                                )
                              ) : (
                                <div>
                                  <label style={{ fontSize: '0.82rem', fontWeight: 700, color: '#1e293b', display: 'block', marginBottom: '0.35rem' }}>
                                    Rate per Person ({item.currency})
                                  </label>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', maxWidth: '320px' }}>
                                    <input
                                      type="number"
                                      min="0"
                                      className="pricing-select"
                                      style={{ padding: '0.45rem 0.75rem', fontSize: '1rem', fontWeight: 700 }}
                                      placeholder="e.g. 850"
                                      value={season.adultRate !== undefined ? season.adultRate : ''}
                                      onChange={(e) => handleSeasonChange(item.tempId, seasonIdx, 'adultRate', e.target.value)} step={moneyStep} onBlur={(e) => snapSeasonMoney(e, item.tempId, seasonIdx, 'adultRate')}
                                    />
                                    <span style={{ fontSize: '0.8rem', color: '#64748b', whiteSpace: 'nowrap' }}>/ Person</span>
                                  </div>
                                  <div style={{ fontSize: '0.74rem', color: '#64748b', marginTop: '0.45rem' }}>
                                    Charged per passenger in the vehicle.
                                  </div>
                                </div>
                              )}

                              {/* Child Rate (Optional) - recorded for the rate card,
                                  charged only on the categories that buy per head. A
                                  transfer or tour sells seats, so a child pays the
                                  adult fare and this box is greyed with the reason. */}
                              <div style={{ display: 'flex', alignItems: 'flex-end', gap: '0.75rem', marginTop: '1rem', flexWrap: 'wrap' }}>
                                <div style={{ maxWidth: '200px', flex: '1' }}>
                                  <label style={{ fontSize: '0.75rem', fontWeight: 600, color: '#475569', display: 'block', marginBottom: '0.25rem' }}>
                                    Child Rate ({item.currency}) (Optional)
                                  </label>
                                  <input
                                    type="number"
                                    min="0"
                                    className="pricing-select"
                                    style={{ padding: '0.35rem', ...(!childRatesCharged ? disabledPriceInputStyle : {}) }}
                                    placeholder={childRatesCharged ? 'Leave blank for no child rate' : 'Recorded, not charged'}
                                    title={childRatesCharged ? undefined : spaceChildNote}
                                    disabled={!childRatesCharged}
                                    value={season.childRate !== undefined ? season.childRate : ''}
                                    onChange={(e) => handleSeasonChange(item.tempId, seasonIdx, 'childRate', e.target.value)} step={moneyStep} onBlur={(e) => snapSeasonMoney(e, item.tempId, seasonIdx, 'childRate')}
                                  />
                                </div>
                                <div style={{ maxWidth: '200px', flex: '1' }}>
                                  <label style={{ fontSize: '0.75rem', fontWeight: 600, color: '#475569', display: 'block', marginBottom: '0.25rem' }}>
                                    Child Age Limit (yrs)
                                  </label>
                                  <input
                                    type="number"
                                    min="1"
                                    max="17"
                                    className="pricing-select"
                                    style={{ padding: '0.35rem', ...(!childRatesCharged ? disabledPriceInputStyle : {}) }}
                                    title={childRatesCharged ? undefined : spaceChildNote}
                                    disabled={!childRatesCharged}
                                    value={item.childAge || 12}
                                    onChange={(e) => handleItemFieldChange(item.tempId, 'childAge', e.target.value)}
                                  />
                                </div>
                              </div>
                              <div style={{ fontSize: '0.72rem', color: '#64748b', marginTop: '0.5rem' }}>
                                {childRatesCharged
                                  ? `Child rate applies to passengers up to ${item.childAge || 12} years old. Children below 1 year usually travel free — confirm with supplier contract.`
                                  : spaceChildNote}
                              </div>

                              {/* The supplier's tariff often quotes the guide's own
                                  place on an activity alongside the guest price. It is
                                  a seasonal figure like the adult rate, and only an
                                  activity sold per head has one to sell. */}
                              {item.category === 'Activities / Tours' && dbFeatures.guideDriver && item.pricingModel !== 'per_vehicle' && (
                                <div style={{ maxWidth: '220px', marginTop: '1rem' }}>
                                  <label style={{ fontSize: '0.75rem', fontWeight: 600, color: '#475569', display: 'block', marginBottom: '0.25rem' }}>
                                    Guide Rate ({item.currency})
                                  </label>
                                  <input
                                    type="number"
                                    min="0"
                                    className="pricing-select"
                                    style={{ padding: '0.35rem', width: '100%' }}
                                    placeholder="Blank = not charged"
                                    value={season.guideRate !== undefined ? season.guideRate : ''}
                                    onChange={(e) => handleSeasonChange(item.tempId, seasonIdx, 'guideRate', e.target.value)} step={moneyStep} onBlur={(e) => snapSeasonMoney(e, item.tempId, seasonIdx, 'guideRate')}
                                  />
                                  <span style={{ fontSize: '0.7rem', color: '#94a3b8', display: 'block' }}>
                                    What the supplier charges for the guide on this activity. 0 = free.
                                  </span>
                                </div>
                              )}
                            </div>
                          ) : (
                          occupancyPricedRoom ? (
                            <div style={{ background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: '8px', padding: '1rem' }}>
                              <label style={{ fontSize: '0.82rem', fontWeight: 700, color: '#7c2d12', display: 'block', marginBottom: '0.35rem' }}>
                                Rate per Person per Night ({item.currency}) — by guests in the {isTrainCategory(item.category) ? 'cabin' : 'room'}
                              </label>
                              <div style={{ fontSize: '0.74rem', color: '#9a3412', marginBottom: '0.7rem', lineHeight: 1.45 }}>
                                Type the supplier sheet as it reads: one figure for each party this {isTrainCategory(item.category) ? 'cabin' : 'room'} sleeps.
                                Every guest pays that figure, adult or child, so there is no child rate and no single supplement to add.
                              </div>
                              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(112px, 1fr))', gap: '0.6rem' }}>
                                {occupancySizes.map((pax) => (
                                  <div key={`occ-${pax}`}>
                                    <span style={{ fontSize: '0.74rem', fontWeight: 700, color: '#7c2d12', display: 'block', marginBottom: '0.2rem' }}>
                                      {pax} {pax === 1 ? 'guest' : 'guests'}
                                    </span>
                                    <input
                                      type="number"
                                      min="0"
                                      className="pricing-select"
                                      style={{ width: '100%', padding: '0.35rem', fontWeight: 700 }}
                                      placeholder={item.currency}
                                      value={occupancyRateOf(season, pax)}
                                      onChange={(e) => handleOccupancyRateChange(item.tempId, seasonIdx, pax, e.target.value)}
                                      step={moneyStep}
                                      onBlur={(e) => snapOccupancyMoney(e, item.tempId, seasonIdx, pax)}
                                    />
                                    <span style={{ fontSize: '0.66rem', color: '#c2410c', display: 'block' }}>each / night</span>
                                  </div>
                                ))}
                              </div>
                              <div style={{ fontSize: '0.72rem', color: '#9a3412', marginTop: '0.6rem', lineHeight: 1.45 }}>
                                Sold from {occupancySizes[0]} to {occupancySizes[occupancySizes.length - 1]} guests.
                                {occupancySizes.length > 1 && ' A fuller party pays less each because the same house is split more ways.'}
                              </div>
                              {occupancyProblem && (
                                <div style={{ fontSize: '0.74rem', color: '#b91c1c', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '8px', padding: '0.5rem 0.7rem', marginTop: '0.6rem', lineHeight: 1.45 }}>
                                  {occupancyProblem}
                                </div>
                              )}
                            </div>
                          ) : isFlatRoom ? (
                            <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '1rem' }}>
                              <label style={{ fontSize: '0.82rem', fontWeight: 700, color: '#1e293b', display: 'block', marginBottom: '0.35rem' }}>
                                {isTrainCategory(item.category) ? 'Cabin / Unit Rate per Night' : 'Room / Unit Rate per Night'} ({item.currency})
                              </label>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', maxWidth: '320px' }}>
                                <input
                                  type="number"
                                  className="pricing-select"
                                  style={{ padding: '0.45rem 0.75rem', fontSize: '1rem', fontWeight: 700 }}
                                  placeholder={`e.g. 5000`}
                                  value={season.roomRate !== undefined ? season.roomRate : ''}
                                  onChange={(e) => handleSeasonChange(item.tempId, seasonIdx, 'roomRate', e.target.value)} step={moneyStep} onBlur={(e) => snapSeasonMoney(e, item.tempId, seasonIdx, 'roomRate')}
                                />
                                <span style={{ fontSize: '0.8rem', color: '#64748b', whiteSpace: 'nowrap' }}>/ {isTrainCategory(item.category) ? 'Cabin' : 'Room'} / Night</span>
                              </div>
                              <div style={{ fontSize: '0.74rem', color: '#64748b', marginTop: '0.45rem' }}>
                                Flat price for the whole {isTrainCategory(item.category) ? 'cabin' : 'room'} for up to <strong>{item.maxOccupancy || 2} persons</strong>. In quotes, rate per person is <code>{item.currency} {parseFloat(season.roomRate) || 0} ÷ (Occupants)</code>.
                              </div>
                              <div style={{ marginTop: '1rem', paddingTop: '0.85rem', borderTop: '1px dashed #cbd5e1' }}>
                                <label style={{ fontSize: '0.82rem', fontWeight: 700, color: '#1e293b', display: 'block', marginBottom: '0.35rem' }}>
                                  1 Adult ({isTrainCategory(item.category) ? 'Single Cabin' : 'Single Room'}) ({item.currency})
                                </label>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', maxWidth: '320px' }}>
                                  <input
                                    type="number"
                                    className="pricing-select"
                                    style={{ padding: '0.45rem 0.75rem', fontSize: '1rem', fontWeight: 700 }}
                                    placeholder={`e.g. ${Math.round((parseFloat(season.roomRate) || 0) * 1.35) || 6500}`}
                                    value={season.singleRoomRate !== undefined ? season.singleRoomRate : ''}
                                    onChange={(e) => handleSeasonChange(item.tempId, seasonIdx, 'singleRoomRate', e.target.value)} step={moneyStep} onBlur={(e) => snapSeasonMoney(e, item.tempId, seasonIdx, 'singleRoomRate')}
                                  />
                                  <span style={{ fontSize: '0.8rem', color: '#64748b', whiteSpace: 'nowrap' }}>/ {isTrainCategory(item.category) ? 'Cabin' : 'Room'} / Night</span>
                                </div>
                                <div style={{ fontSize: '0.74rem', color: '#64748b', marginTop: '0.45rem' }}>
                                  What one adult pays for the {isTrainCategory(item.category) ? 'cabin' : 'room'} to themselves, since they are not sharing. Leave blank to charge the flat {isTrainCategory(item.category) ? 'cabin' : 'room'} rate.
                                </div>
                              </div>
                            </div>
                          ) : isFeeItem ? null : (
                            <>
                              {/* Adults Pricing */}
                              <div style={{ marginBottom: '1rem' }}>
                                <label style={{ fontSize: '0.8rem', fontWeight: 700, color: '#334155', display: 'block', marginBottom: '0.5rem' }}>
                                  Adults Pricing (Per Person — {item.currency})
                                </label>
                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '0.75rem' }}>
                                  <div>
                                    <span style={{ fontSize: '0.75rem', color: '#475569', fontWeight: 600, display: 'block' }}>1 Adult ({isTrainCategory(item.category) ? 'Single Cabin' : 'Single Room'})</span>
                                    <input
                                      type="number"
                                      className="pricing-select"
                                      style={{ padding: '0.35rem', ...(!singleRateLive ? disabledPriceInputStyle : {}) }}
                                      placeholder={singleRateLive ? `Price (${item.currency})` : 'Not used'}
                                      title={singleRateLive ? undefined : feeOnlyNote}
                                      disabled={!singleRateLive}
                                      value={singleRateLive ? season.price1Adult : ''}
                                      onChange={(e) => handleSeasonChange(item.tempId, seasonIdx, 'price1Adult', e.target.value)} step={moneyStep} onBlur={(e) => snapSeasonMoney(e, item.tempId, seasonIdx, 'price1Adult')}
                                    />
                                    <span style={{ fontSize: '0.68rem', color: '#94a3b8' }}>{singleRateLive ? '1 Adult Single rate' : 'Not used by a fee'}</span>
                                  </div>
                                  <div>
                                    <span style={{ fontSize: '0.75rem', color: '#475569', fontWeight: 600, display: 'block' }}>2 Adults (Double/Twin)</span>
                                    <input
                                      type="number"
                                      className="pricing-select"
                                      style={{ padding: '0.35rem', ...(!canShare ? disabledPriceInputStyle : {}) }}
                                      placeholder={canShare ? `Price (${item.currency})` : 'Not used'}
                                      title={canShare ? undefined : shareOffTitle}
                                      disabled={!canShare}
                                      value={canShare ? season.price2Adults : ''}
                                      onChange={(e) => handleSeasonChange(item.tempId, seasonIdx, 'price2Adults', e.target.value)} step={moneyStep} onBlur={(e) => snapSeasonMoney(e, item.tempId, seasonIdx, 'price2Adults')}
                                    />
                                    <span style={{ fontSize: '0.68rem', color: '#94a3b8' }}>{canShare ? 'Per Person Sharing (PPS)' : rateOffCaption}</span>
                                  </div>
                                  <div>
                                    <span style={{ fontSize: '0.75rem', color: '#475569', fontWeight: 600, display: 'block' }}>3+ Adults (Per Person)</span>
                                    <input
                                      type="number"
                                      className="pricing-select"
                                      style={{ padding: '0.35rem', ...(!canTakeThirdAdult ? disabledPriceInputStyle : {}) }}
                                      placeholder={canTakeThirdAdult ? `Price (${item.currency})` : 'Not used'}
                                      title={canTakeThirdAdult ? undefined : thirdOffTitle}
                                      disabled={!canTakeThirdAdult}
                                      value={canTakeThirdAdult && season.price3PlusAdults !== undefined ? season.price3PlusAdults : ''}
                                      onChange={(e) => handleSeasonChange(item.tempId, seasonIdx, 'price3PlusAdults', e.target.value)} step={moneyStep} onBlur={(e) => snapSeasonMoney(e, item.tempId, seasonIdx, 'price3PlusAdults')}
                                    />
                                    <span style={{ fontSize: '0.68rem', color: '#94a3b8' }}>{canTakeThirdAdult ? 'Extra adult sharing' : rateOffCaption}</span>
                                  </div>
                                </div>
                              </div>

                              {/* Children Pricing per Age Range */}
                              {bands.length > 0 && (
                                <div style={{ marginBottom: '1rem' }}>
                                  <label style={{ fontSize: '0.8rem', fontWeight: 700, color: '#334155', display: 'block', marginBottom: '0.5rem' }}>
                                    Children Pricing per Age Range (Per Person — {item.currency})
                                  </label>
                                  {!childRatesCharged && (
                                    <div style={{ fontSize: '0.72rem', color: '#94a3b8', marginBottom: '0.5rem' }}>{spaceChildNote}</div>
                                  )}
                                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '0.75rem' }}>
                                    {bands.map((band) => (
                                      <div key={band.id}>
                                        <span style={{ fontSize: '0.75rem', color: '#475569', fontWeight: 600, display: 'block' }}>
                                          {band.name} ({band.ageFrom}–{band.ageTo} yrs)
                                        </span>
                                        <input
                                          type="number"
                                          className="pricing-select"
                                          style={{ padding: '0.35rem', ...(!takesChildren ? disabledPriceInputStyle : {}) }}
                                          placeholder={childRatesShown ? `Price (${item.currency})` : 'Not used'}
                                          title={takesChildren ? undefined : childOffTitle}
                                          disabled={!takesChildren}
                                          value={childRatesShown && season.childRates?.[band.id] !== undefined ? season.childRates[band.id] : ''}
                                          onChange={(e) => handleChildRateChange(item.tempId, seasonIdx, band.id, e.target.value)} step={moneyStep} onBlur={(e) => snapBandRate(e, item.tempId, seasonIdx, band.id, handleChildRateChange)}
                                        />
                                        <span style={{ fontSize: '0.68rem', color: '#94a3b8' }}>{takesChildren ? 'Sharing with adult/s' : childOffCaption}</span>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}

                              {/* Optional Child Discount */}
                              <div style={{ maxWidth: '300px', marginTop: '0.75rem' }}>
                                <label style={{ fontSize: '0.75rem', fontWeight: 600, color: '#475569', display: 'block', marginBottom: '0.25rem' }}>
                                  Child Discount (%) (Optional)
                                </label>
                                <input
                                  type="number"
                                  className="pricing-select"
                                  style={{ padding: '0.35rem', ...(!takesChildren ? disabledPriceInputStyle : {}) }}
                                  placeholder={childRatesShown ? 'e.g. 10%' : 'Not used'}
                                  title={takesChildren ? undefined : childOffTitle}
                                  disabled={!takesChildren}
                                  value={childRatesShown ? season.childDiscount : ''}
                                  onChange={(e) => handleSeasonChange(item.tempId, seasonIdx, 'childDiscount', e.target.value)}
                                />
                                {!takesChildren && (
                                  <span style={{ fontSize: '0.68rem', color: '#94a3b8', display: 'block', marginTop: '0.2rem' }}>{childOffCaption}</span>
                                )}
                              </div>

                              {/* The single rate already sets the supplement: it is the
                                  gap to the sharing rate. A contract only decides how
                                  many single rooms are waived before that applies. */}
                              {item.category === 'Accommodation' && (() => {
                                const single = parseFloat(season.price1Adult);
                                const sharing = parseFloat(season.price2Adults);
                                const ratesReady = canShare && Number.isFinite(single) && single > 0 && Number.isFinite(sharing) && sharing > 0;
                                const supplement = ratesReady ? Math.max(0, single - sharing) : 0;
                                const waiver = canShare ? Math.max(0, parseInt(season.singleSupplementWaiver, 10) || 0) : 0;
                                return (
                                  <div style={{ marginTop: '1rem', paddingTop: '0.85rem', borderTop: '1px dashed #cbd5e1' }}>
                                    <label style={{ fontSize: '0.8rem', fontWeight: 700, color: '#334155', display: 'block', marginBottom: '0.35rem' }}>
                                      Single Supplement Waiver
                                    </label>
                                    <div style={{ fontSize: '0.72rem', color: '#64748b', marginBottom: '0.6rem' }}>
                                      {!canShare
                                        ? 'This room cannot be shared, so there is no single supplement to waive.'
                                        : ratesReady
                                          ? <>The supplement is worked out from the adult rates: <strong>{item.currency} {supplement.toLocaleString()}</strong> per single room / night ({item.currency} {single.toLocaleString()} single &minus; {item.currency} {sharing.toLocaleString()} sharing).</>
                                          : 'Enter the 1 Adult and 2 Adults rates above to work out the single supplement.'}
                                    </div>
                                    <div style={{ display: 'flex', alignItems: 'flex-end', gap: '0.5rem', flexWrap: 'wrap' }}>
                                      <div>
                                        <span style={{ fontSize: '0.72rem', color: '#475569', fontWeight: 600, display: 'block', marginBottom: '0.2rem' }}>
                                          Waive the supplement for the first
                                        </span>
                                        <input
                                          type="number"
                                          min="0"
                                          step="1"
                                          className="pricing-select"
                                          style={{ padding: '0.35rem', width: '90px', ...(!canShare ? disabledPriceInputStyle : {}) }}
                                          placeholder={canShare ? '0' : 'Not used'}
                                          title={canShare ? undefined : 'This room cannot be shared'}
                                          disabled={!canShare}
                                          value={canShare ? (season.singleSupplementWaiver ?? '') : ''}
                                          onChange={(e) => handleSingleSupplementWaiverChange(item.tempId, seasonIdx, e.target.value)}
                                        />
                                      </div>
                                      <span style={{ fontSize: '0.78rem', color: '#475569', fontWeight: 600, paddingBottom: '0.4rem' }}>
                                        single room{waiver === 1 ? '' : 's'}
                                      </span>
                                    </div>
                                    <div style={{ fontSize: '0.7rem', color: '#64748b', marginTop: '0.35rem' }}>
                                      {!canShare
                                        ? 'A room that takes one adult is always charged the single rate.'
                                        : waiver > 0
                                          ? `The first ${waiver} single room${waiver === 1 ? ' is' : 's are'} charged the sharing rate. From single room ${waiver + 1} the single rate applies. Counted per night, per property, in room order.`
                                          : '0 waives nothing: every single room is charged the single rate. Enter 1, 2, ... to waive that many single rooms before the single rate applies.'}
                                    </div>
                                  </div>
                                );
                              })()}
                            </>
                          ))}

                          {/* Weekend nights are per room type: the supplier
                              decides which nights are weekend, so they are
                              picked here instead of assuming Sat/Sun. A villa
                              on an occupancy ladder is not: its band already is
                              the price for that night, and a weekend figure
                              typed beside it would price nothing. */}
                          {item.category === 'Accommodation' && dbFeatures.weekendRates && !occupancyPricedRoom && (() => {
                            const days = (Array.isArray(season.weekendDays) ? season.weekendDays : [])
                              .map((value) => parseInt(value, 10))
                              .filter((value) => value >= 1 && value <= 7)
                              .sort((a, b) => a - b);
                            const price = parseFloat(season.weekendPrice) || 0;
                            const normal = parseFloat(season.roomRate) || parseFloat(season.price2Adults) || 0;
                            const weekendDisabled = days.length === 0;
                            const dayNames = WEEKEND_DAY_OPTIONS
                              .filter((day) => days.includes(day.value))
                              .map((day) => day.short)
                              .join(', ');
                            const toggleDay = (value) => {
                              const next = days.includes(value)
                                ? days.filter((day) => day !== value)
                                : [...days, value].sort((a, b) => a - b);
                              handleSeasonValueChange(item.tempId, seasonIdx, 'weekendDays', next);
                            };
                            return (
                              <div style={{ background: '#fdf4ff', border: '1px solid #f0abfc', borderRadius: '8px', padding: '0.85rem 1rem', marginTop: '1rem' }}>
                                <label style={{ fontSize: '0.8rem', fontWeight: 700, color: '#86198f', display: 'block', marginBottom: '0.35rem' }}>
                                  Weekend Rate — per Room per Night ({item.currency})
                                </label>
                                <div style={{ fontSize: '0.74rem', color: '#7e22ce', marginBottom: '0.55rem', lineHeight: 1.45 }}>
                                  Tick the nights this contract treats as weekend, then enter the figure those nights carry.
                                  Weekend pricing is per night, so a single booking can mix the normal and weekend price.
                                </div>
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem', marginBottom: '0.65rem' }}>
                                  {WEEKEND_DAY_OPTIONS.map((day) => {
                                    const selected = days.includes(day.value);
                                    return (
                                      <button
                                        key={day.value}
                                        type="button"
                                        title={day.label}
                                        aria-pressed={selected}
                                        onClick={() => toggleDay(day.value)}
                                        style={{
                                          padding: '0.25rem 0.7rem', borderRadius: '999px', cursor: 'pointer',
                                          fontSize: '0.75rem', fontWeight: 600,
                                          border: `1px solid ${selected ? '#a21caf' : '#e9d5ff'}`,
                                          background: selected ? '#fae8ff' : '#fff',
                                          color: selected ? '#86198f' : '#7e22ce'
                                        }}
                                      >
                                        {day.short}
                                      </button>
                                    );
                                  })}
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', maxWidth: '320px' }}>
                                  <input
                                    type="number"
                                    min="0"
                                    className="pricing-select"
                                    style={{ padding: '0.45rem 0.75rem', fontSize: '1rem', fontWeight: 700, ...(weekendDisabled ? disabledPriceInputStyle : {}) }}
                                    placeholder={weekendDisabled ? 'Tick weekend nights first' : (normal > 0 ? `e.g. ${normal}` : 'e.g. 3200')}
                                    title={weekendDisabled ? 'Tick at least one weekend night to set a weekend price' : undefined}
                                    disabled={weekendDisabled}
                                    value={weekendDisabled ? '' : (season.weekendPrice !== undefined ? season.weekendPrice : '')}
                                    onChange={(e) => handleSeasonChange(item.tempId, seasonIdx, 'weekendPrice', e.target.value)}
                                    step={moneyStep}
                                    onBlur={(e) => snapSeasonMoney(e, item.tempId, seasonIdx, 'weekendPrice')}
                                  />
                                  <span style={{ fontSize: '0.8rem', color: '#64748b', whiteSpace: 'nowrap' }}>/ Room / Night</span>
                                </div>
                                <div style={{ fontSize: '0.7rem', color: '#7e22ce', marginTop: '0.4rem', lineHeight: 1.45 }}>
                                  {days.length === 0
                                    ? 'Tick at least one weekend night to set a weekend price. Until then every night is charged the normal rate above.'
                                    : price <= 0
                                      ? 'No weekend price entered, so every night is charged the normal rate above.'
                                      : `${dayNames} nights are charged ${item.currency} ${price.toLocaleString()} instead of the normal nightly rate. A single room keeps its own contracted single rate when one is entered.`}
                                </div>
                              </div>
                            );
                          })()}

                          {/* Park fees and conservation levies belong to the
                              season they are charged in. The fee's name, type and
                              basis are shared across the property; the amount box
                              edits this season only, and a blank box means the fee
                              is not charged in this season. */}
                          {isAccom && activeGroup && (
                            <div style={{ background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: '10px', padding: '0.85rem 1rem', marginTop: '1rem' }}>
                              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap' }}>
                                <div>
                                  <span style={{ fontSize: '0.85rem', fontWeight: 700, color: '#9a3412', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                                    <Receipt size={16} color="#ea580c" /> Park fees &amp; conservation levies
                                  </span>
                                  <span style={{ fontSize: '0.74rem', color: '#7c2d12', display: 'block', marginTop: '0.2rem' }}>
                                    {dbFeatures.surchargeFees && dbFeatures.feeType
                                      ? `Amounts below apply to ${activeGroup.seasonName || 'this season'}${activeGroup.validFrom ? ` (${activeGroup.validFrom} to ${activeGroup.validTo || 'open'})` : ''}. Leave a fee blank in a season it is not charged.`
                                      : 'Park fees and conservation levies aren\u2019t available in this workspace yet.'}
                                  </span>
                                </div>
                                {dbFeatures.surchargeFees && dbFeatures.feeType && (
                                  <button
                                    type="button"
                                    className="secondary-btn"
                                    style={{ padding: '0.4rem 0.85rem', fontSize: '0.8rem', display: 'inline-flex', alignItems: 'center', gap: '0.3rem', whiteSpace: 'nowrap' }}
                                    onClick={() => handleAddLinkedFee(item.tempId)}
                                  >
                                    <Plus size={13} /> Add fee
                                  </button>
                                )}
                              </div>

                              {dbFeatures.surchargeFees && dbFeatures.feeType && (item.linkedFees || []).map((fee) => {
                                const feeType = fee.type || 'entrance_fee';
                                const chargedLabel = (fee.chargeBasis === 'per_night') ? 'per night' : 'once for the whole stay';
                                const amount = fee.amounts && Object.prototype.hasOwnProperty.call(fee.amounts, feeSeason)
                                  ? fee.amounts[feeSeason]
                                  : (fee.amounts ? '' : (fee.amount ?? ''));
                                const unitBasis = fee.unitBasis || 'per_person';
                                /* Only "per person" bills both ages, so it is the
                                   one basis with a child figure to record. */
                                const showChildAmount = dbFeatures.feeChildRate && unitBasis === 'per_person';
                                const childAmount = fee.childAmounts && Object.prototype.hasOwnProperty.call(fee.childAmounts, feeSeason)
                                  ? fee.childAmounts[feeSeason]
                                  : '';
                                return (
                                  <div key={fee.key} style={{ marginTop: '0.85rem', paddingTop: '0.75rem', borderTop: '1px solid #fed7aa' }}>
                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: '0.6rem' }}>
                                      <div>
                                        <label style={{ fontSize: '0.72rem', fontWeight: 700, color: '#7c2d12', display: 'block', marginBottom: '0.25rem' }}>Fee name</label>
                                        <input
                                          type="text"
                                          className="pricing-select"
                                          style={{ padding: '0.4rem 0.55rem', width: '100%' }}
                                          placeholder={surchargeTypeLabel(feeType)}
                                          value={fee.name}
                                          onChange={(e) => handleLinkedFeeChange(item.tempId, fee.key, 'name', e.target.value)}
                                        />
                                      </div>
                                      <div>
                                        <label style={{ fontSize: '0.72rem', fontWeight: 700, color: '#7c2d12', display: 'block', marginBottom: '0.25rem' }}>Fee type</label>
                                        <SearchableSelect
                                          className="pricing-select"
                                          style={{ padding: '0.4rem 0.55rem', width: '100%' }}
                                          value={feeType}
                                          onChange={(e) => handleLinkedFeeChange(item.tempId, fee.key, 'type', e.target.value)}
                                        >
                                          {SURCHARGE_TYPES.map((opt) => <option key={opt.id} value={opt.id}>{opt.label}</option>)}
                                        </SearchableSelect>
                                      </div>
                                      <div>
                                        <label style={{ fontSize: '0.72rem', fontWeight: 700, color: '#7c2d12', display: 'block', marginBottom: '0.25rem' }}>Charged</label>
                                        <SearchableSelect
                                          className="pricing-select"
                                          style={{ padding: '0.4rem 0.55rem', width: '100%' }}
                                          value={fee.chargeBasis || 'once_off'}
                                          onChange={(e) => handleLinkedFeeChange(item.tempId, fee.key, 'chargeBasis', e.target.value)}
                                        >
                                          {CHARGE_BASIS.map((opt) => <option key={opt.id} value={opt.id}>{opt.label}</option>)}
                                        </SearchableSelect>
                                      </div>
                                      <div>
                                        <label style={{ fontSize: '0.72rem', fontWeight: 700, color: '#7c2d12', display: 'block', marginBottom: '0.25rem' }}>Rate is per</label>
                                        <SearchableSelect
                                          className="pricing-select"
                                          style={{ padding: '0.4rem 0.55rem', width: '100%' }}
                                          value={fee.unitBasis || 'per_person'}
                                          onChange={(e) => handleLinkedFeeChange(item.tempId, fee.key, 'unitBasis', e.target.value)}
                                        >
                                          {unitBasesFor({
                                            surcharge_type: feeType,
                                            surcharge_unit_basis: fee.unitBasis
                                          }).map((opt) => <option key={opt.id} value={opt.id}>{opt.label}</option>)}
                                        </SearchableSelect>
                                      </div>
                                      <div>
                                        <label style={{ fontSize: '0.72rem', fontWeight: 700, color: '#7c2d12', display: 'block', marginBottom: '0.25rem' }}>
                                          Amount ({item.currency}) — {activeGroup.seasonName || 'this season'}
                                        </label>
                                        <input
                                          type="number"
                                          min="0"
                                          className="pricing-select"
                                          style={{ padding: '0.4rem 0.55rem', width: '100%', fontWeight: 700 }}
                                          placeholder="Blank = not charged"
                                          value={amount}
                                          onChange={(e) => handleLinkedFeeAmountChange(item.tempId, fee.key, feeSeason, e.target.value)}
                                          step={moneyStep}
                                          onBlur={(e) => handleLinkedFeeAmountChange(item.tempId, fee.key, feeSeason, applyInputRounding(e.target.value, amountSettings.inputRounding))}
                                        />
                                      </div>
                                      {showChildAmount && (
                                        <div>
                                          <label style={{ fontSize: '0.72rem', fontWeight: 700, color: '#7c2d12', display: 'block', marginBottom: '0.25rem' }}>
                                            Child amount ({item.currency}) — {activeGroup.seasonName || 'this season'}
                                          </label>
                                          <input
                                            type="number"
                                            min="0"
                                            className="pricing-select"
                                            style={{ padding: '0.4rem 0.55rem', width: '100%', fontWeight: 700 }}
                                            placeholder="Blank = adult amount"
                                            value={childAmount}
                                            onChange={(e) => handleLinkedFeeAmountChange(item.tempId, fee.key, feeSeason, e.target.value, 'childAmounts')}
                                            step={moneyStep}
                                            onBlur={(e) => handleLinkedFeeAmountChange(item.tempId, fee.key, feeSeason, applyInputRounding(e.target.value, amountSettings.inputRounding), 'childAmounts')}
                                          />
                                          <span style={{ fontSize: '0.66rem', color: '#9a3412', display: 'block', marginTop: '0.15rem' }}>
                                            Some properties charge a child less at the gate. Blank bills a child the adult amount.
                                          </span>
                                        </div>
                                      )}
                                      <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', paddingBottom: '0.2rem' }}>
                                        <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.76rem', fontWeight: 600, color: '#7c2d12', cursor: 'pointer' }}>
                                          <input
                                            type="checkbox"
                                            checked={fee.chargeable !== false}
                                            onChange={(e) => handleLinkedFeeChange(item.tempId, fee.key, 'chargeable', e.target.checked)}
                                            style={{ width: '15px', height: '15px', accentColor: '#ea580c', cursor: 'pointer' }}
                                          />
                                          Chargeable
                                        </label>
                                        <span style={{ fontSize: '0.68rem', color: '#9a3412', marginTop: '0.15rem' }}>
                                          {fee.chargeable !== false
                                            ? `Added to the client total, ${chargedLabel}.`
                                            : 'Shown for reference only, excluded from the total.'}
                                        </span>
                                      </div>
                                    </div>
                                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem', marginTop: '0.45rem', flexWrap: 'wrap' }}>
                                      <span style={{ fontSize: '0.7rem', color: '#9a3412' }}>
                                        Fee details are shared across seasons; this amount applies to {activeGroup.seasonName || 'this season'} only.
                                      </span>
                                      <button
                                        type="button"
                                        className="secondary-btn"
                                        style={{ padding: '0.3rem 0.6rem', fontSize: '0.74rem', color: '#b91c1c', borderColor: '#fca5a5' }}
                                        onClick={() => handleRemoveLinkedFee(item.tempId, fee.key)}
                                      >
                                        Remove fee
                                      </button>
                                    </div>
                                  </div>
                                );
                              })}

                              {dbFeatures.surchargeFees && dbFeatures.feeType && (item.linkedFees || []).length === 0 && (
                                <div style={{ marginTop: '0.7rem', fontSize: '0.74rem', color: '#9a3412' }}>
                                  No park fee or conservation levy on this property. Add one only if the supplier bills it on top of the room rate.
                                </div>
                              )}
                            </div>
                          )}

                          {/* Fee Inputs (per season). Only a Fees & Tickets item has these; the
                              unit basis decides which single figure is collected. */}
                          {isSurchargeItem(item) && (() => {
                            const basis = item.surchargeChargeBasis || 'once_off';
                            const unit = item.surchargeUnitBasis || 'per_person';
                            const isLevy = (item.surchargeType || 'entrance_fee') === 'conservation_levy';
                            const when = basis === 'per_night' ? 'per night' : 'once off';
                            const moneyField = (
                              field, label, hint, placeholder
                            ) => (
                              <div>
                                <label style={{ fontSize: '0.75rem', fontWeight: 600, color: '#475569', display: 'block', marginBottom: '0.25rem' }}>
                                  {label} ({item.currency})
                                </label>
                                <input
                                  type="number"
                                  min="0"
                                  className="pricing-select"
                                  style={{ padding: '0.45rem 0.75rem', fontSize: '1rem', fontWeight: 700, width: '100%' }}
                                  placeholder={placeholder}
                                  value={season[field] !== undefined ? season[field] : ''}
                                  onChange={(e) => handleSeasonChange(item.tempId, seasonIdx, field, e.target.value)} step={moneyStep} onBlur={(e) => snapSeasonMoney(e, item.tempId, seasonIdx, field)}
                                />
                                <span style={{ fontSize: '0.7rem', color: '#94a3b8', display: 'block' }}>{hint}</span>
                              </div>
                            );
                            /* One box per figure this fee actually bills, and
                               nothing else. A fee that buys a thing (a unit, a
                               vehicle) has no head to price, so a child or a
                               guide box beside it would be money the itinerary
                               never charges; "per adult" bills adults alone, so
                               only the adult figure is asked for. */
                            const perHead = feeBasisChargesHeads(unit);
                            const splitsAge = unit === 'per_person';
                            const visitorLabel = unit === 'per_adult' ? 'Adult Rate' : 'Per Person Rate';
                            let fields;
                            if (unit === 'per_vehicle') {
                              fields = [moneyField('entranceFeeVehicle', `Per Vehicle Rate`, `Charged once per vehicle, ${when}`, 'e.g. 1200')];
                            } else if (unit === 'per_unit') {
                              fields = [moneyField('unitRate', `Per Unit Rate`, `Charged once for the unit, ${when}`, 'e.g. 1500')];
                            } else if (!isLevy) {
                              fields = [
                                moneyField('entranceFeePerson', visitorLabel, `Charged per visitor, ${when}`, 'e.g. 850'),
                                ...(dbFeatures.feeChildRate && splitsAge
                                  ? [moneyField('entranceFeeChild', 'Child Rate', `Charged per child in place of the visitor figure, ${when}. Blank = the park does not price children separately and a child pays the adult amount.`, 'e.g. 430')]
                                  : [])
                              ];
                            } else {
                              fields = unit === 'per_child'
                                ? [moneyField('levyChildRate', `Child Rate`, `Charged per child, ${when}`, 'e.g. 60')]
                                : [
                                    moneyField('levyAdultRate', `Adult Rate`, `Charged per adult, ${when}`, 'e.g. 120'),
                                    ...(splitsAge
                                      ? [moneyField('levyChildRate', 'Child Rate', `Charged per child in place of the adult figure, ${when}. Blank or 0 = a child pays nothing on this levy.`, 'e.g. 60')]
                                      : [])
                                  ];
                            }
                            if (perHead && dbFeatures.guideDriver) {
                              fields.push(moneyField(
                                'guideRate',
                                "Guide Rate",
                                `The guide's own place on this fee, ${when}. Blank charges the visitor amount; 0 admits the guide free.`,
                                'e.g. 0'
                              ));
                            }
                            return (
                              <div style={{ background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: '8px', padding: '1rem', marginTop: '1rem' }}>
                                <label style={{ fontSize: '0.82rem', fontWeight: 700, color: '#9a3412', display: 'block', marginBottom: '0.5rem' }}>
                                  {(feeTypeHeading(item.surchargeType) + ' Rates (' + item.currency + ') — ' + when)}
                                </label>
                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: '0.75rem', maxWidth: '720px' }}>
                                  {fields}
                                </div>
                                <div style={{ fontSize: '0.74rem', color: '#7c2d12', marginTop: '0.45rem' }}>
                                  This fee is charged on its own line in the itinerary, not folded into the accommodation's price.
                                  {item.surchargeChargeable === false
                                    ? ' It is marked not chargeable, so it will be shown for reference and excluded from the total.'
                                    : ''}
                                </div>
                              </div>
                            );
                          })()}

                          {/* Driver-Guide room pool (Accommodation, offered hotels only) */}
                          {item.category === 'Accommodation' && item.guideDriverOffered && dbFeatures.guideDriver && (
                            <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: '8px', padding: '0.85rem 1rem', marginTop: '1rem' }}>
                              <span style={{ fontSize: '0.8rem', fontWeight: 700, color: '#92400e', display: 'block', marginBottom: '0.35rem' }}>
                                🚌 Driver-Guide Room Rates (per night — {item.currency})
                              </span>
                              <span style={{ fontSize: '0.7rem', color: '#92400e', display: 'block', marginBottom: '0.6rem' }}>
                                One pool of crew rooms, released from {Math.max(1, parseInt(item.guideMinRooms, 10) || 1)} client room{Math.max(1, parseInt(item.guideMinRooms, 10) || 1) === 1 ? '' : 's'} booked — set that in the Min Client Rooms box above. Whichever of the guide and the driver beds first takes the room, and the next crew bed pays the normal Single rate. A crew rule below replaces the flat rate with the hotel’s own ladder.
                              </span>
                              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '0.75rem' }}>
                                <div>
                                  <span style={{ fontSize: '0.75rem', color: '#a16207', fontWeight: 600, display: 'block' }}>Guide Room Rate (prices the pool)</span>
                                  <input
                                    type="number"
                                    min="0"
                                    className="pricing-select"
                                    style={{ padding: '0.35rem' }}
                                    placeholder={`Rate (${item.currency})`}
                                    value={season.guideRate !== undefined ? season.guideRate : ''}
                                    onChange={(e) => handleSeasonChange(item.tempId, seasonIdx, 'guideRate', e.target.value)} step={moneyStep} onBlur={(e) => snapSeasonMoney(e, item.tempId, seasonIdx, 'guideRate')}
                                  />
                                  <span style={{ fontSize: '0.68rem', color: '#b45309', display: 'block' }}>0 = free room · blank = normal Single rate</span>
                                  <span style={{ fontSize: '0.75rem', color: '#a16207', fontWeight: 600, display: 'block', marginTop: '0.45rem' }}>
                                    Guide Meal Plan (same as clients)
                                  </span>
                                  <SearchableSelect
                                    className="pricing-select"
                                    style={{ padding: '0.35rem' }}
                                    value={season.guideMealPlan || item.mealPlan}
                                    onChange={(e) => handleSeasonChange(item.tempId, seasonIdx, 'guideMealPlan', e.target.value)}
                                  >
                                    {mealPlanOptions.map(mp => (
                                      <option key={mp} value={mp}>{mp}</option>
                                    ))}
                                  </SearchableSelect>
                                </div>
                                <div>
                                  <span style={{ fontSize: '0.75rem', color: '#a16207', fontWeight: 600, display: 'block' }}>Driver Room Rate (stands in only where the Guide box is blank)</span>
                                  <input
                                    type="number"
                                    min="0"
                                    className="pricing-select"
                                    style={{ padding: '0.35rem' }}
                                    placeholder={`Rate (${item.currency})`}
                                    value={season.driverRate !== undefined ? season.driverRate : ''}
                                    onChange={(e) => handleSeasonChange(item.tempId, seasonIdx, 'driverRate', e.target.value)} step={moneyStep} onBlur={(e) => snapSeasonMoney(e, item.tempId, seasonIdx, 'driverRate')}
                                  />
                                  <span style={{ fontSize: '0.68rem', color: '#b45309', display: 'block' }}>0 = free room · blank = normal Single rate</span>
                                  <span style={{ fontSize: '0.75rem', color: '#a16207', fontWeight: 600, display: 'block', marginTop: '0.45rem' }}>
                                    Driver Meal Plan (same as clients)
                                  </span>
                                  <SearchableSelect
                                    className="pricing-select"
                                    style={{ padding: '0.35rem' }}
                                    value={season.driverMealPlan || item.mealPlan}
                                    onChange={(e) => handleSeasonChange(item.tempId, seasonIdx, 'driverMealPlan', e.target.value)}
                                  >
                                    {mealPlanOptions.map(mp => (
                                      <option key={mp} value={mp}>{mp}</option>
                                    ))}
                                  </SearchableSelect>
                                </div>
                              </div>
                              {dbFeatures.guideDriverTiers && (
                                <TierLadderEditor
                                  legend="Driver-Guide room rule (optional) — one shared allowance"
                                  roomLabel="Crew"
                                  currency={item.currency}
                                  tiers={season.crewTiers || []}
                                  tone="amber"
                                  moneyStep={moneyStep}
                                  onAdd={() => handleTierAdd(item.tempId, seasonIdx, 'crewTiers', Math.max(1, parseInt(item.guideMinRooms, 10) || 1))}
                                  onChange={(tierIdx, field, value) => handleTierChange(item.tempId, seasonIdx, 'crewTiers', tierIdx, field, value)}
                                  onRemove={(tierIdx) => handleTierRemove(item.tempId, seasonIdx, 'crewTiers', tierIdx)}
                                />
                              )}
                            </div>
                          )}
                          {item.category === 'Accommodation' && item.tourLeaderRoomOffered && (
                            <div style={{ background: '#f0fdfa', border: '1px solid #99f6e4', borderRadius: '8px', padding: '0.85rem 1rem', marginTop: '1rem' }}>
                              <span style={{ fontSize: '0.8rem', fontWeight: 700, color: '#0f766e', display: 'block', marginBottom: '0.5rem' }}>
                                🧭 Tour Leader Room Rate (per night — {item.currency})
                              </span>
                              <div style={{ maxWidth: '300px' }}>
                                <span style={{ fontSize: '0.75rem', color: '#0f766e', fontWeight: 600, display: 'block' }}>Rate</span>
                                <input
                                  type="number"
                                  min="0"
                                  className="pricing-select"
                                  style={{ padding: '0.35rem' }}
                                  placeholder={`Rate (${item.currency})`}
                                  value={season.tourLeaderRate !== undefined ? season.tourLeaderRate : ''}
                                  onChange={(e) => handleSeasonChange(item.tempId, seasonIdx, 'tourLeaderRate', e.target.value)} step={moneyStep} onBlur={(e) => snapSeasonMoney(e, item.tempId, seasonIdx, 'tourLeaderRate')}
                                />
                                <span style={{ fontSize: '0.68rem', color: '#0f766e', display: 'block' }}>
                                  Enter 0 for a free tour leader room. Leave blank to charge the normal Single rate.
                                </span>
                              </div>

                              {dbFeatures.tourLeaderTiers && (
                                <TierLadderEditor
                                  legend="Tiered pricing (optional)"
                                  roomLabel="Tour Leader"
                                  currency={item.currency}
                                  tiers={season.tourLeaderTiers || []}
                                  moneyStep={moneyStep}
                                  onAdd={() => handleTierAdd(item.tempId, seasonIdx, 'tourLeaderTiers', item.tourLeaderMinRooms || 1)}
                                  onChange={(tierIdx, field, value) => handleTierChange(item.tempId, seasonIdx, 'tourLeaderTiers', tierIdx, field, value)}
                                  onRemove={(tierIdx) => handleTierRemove(item.tempId, seasonIdx, 'tourLeaderTiers', tierIdx)}
                                />
                              )}
                            </div>
                          )}

                        </div>
                      );
                    })}

                    <button
                      type="button"
                      className="secondary-btn"
                      style={{ padding: '0.4rem 0.85rem', fontSize: '0.8rem', display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}
                      onClick={() => {
                        /* A new season starts as a single charge type: blank
                           name and dates, default board basis. An option's extra
                           charge types are added on top of it with the charge-type
                           helper. */
                        handleAddSeasonRow(item.tempId, '', item.category === 'Accommodation' ? activeRoomKeyFor(item) : '');
                      }}
                    >
                      <Plus size={13} /> Add Season
                    </button>
                  </div>
                  )}

                  {/* Description Field */}
                  <div style={{ marginBottom: '1.5rem' }}>
                    <label style={{ fontSize: '0.85rem', fontWeight: 600, color: '#475569', display: 'block', marginBottom: '0.35rem' }}>
                      Description
                    </label>
                    <LanguageText
                      field="description"
                      languages={contentLanguages}
                      translations={item.textI18n}
                      value={item.description}
                      onChange={(v) => handleItemFieldChange(item.tempId, 'description', v)}
                      onTranslationsChange={(next) => handleItemTranslationsChange(item.tempId, next)}
                      placeholder="Detailed description of the library item..."
                    />
                  </div>

                  {/* Gallery Images (Max 10) Field - Matching Screenshot Design */}
                  <div>
                    <label style={{ fontSize: '0.85rem', fontWeight: 600, color: '#334155', display: 'block', marginBottom: '0.5rem' }}>
                      Gallery Images (Max 10)
                    </label>

                    <input
                      type="file"
                      id={`file-input-${item.tempId}`}
                      multiple
                      accept=".jpg,.jpeg,.png,image/jpeg,image/png"
                      style={{ display: 'none' }}
                      onChange={(e) => {
                        handleImageFilesUpload(item.tempId, e.target.files);
                        e.target.value = '';
                      }}
                    />

                    <div
                      onClick={() => {
                        if (item.imageUrls.length >= 10) {
                          showToast('Maximum 10 images reached', 'warning');
                          return;
                        }
                        document.getElementById(`file-input-${item.tempId}`)?.click();
                      }}
                      onDragOver={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                      }}
                      onDrop={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        handleImageFilesUpload(item.tempId, e.dataTransfer.files);
                      }}
                      style={{
                        border: '1.5px dashed #cbd5e1',
                        borderRadius: '8px',
                        background: '#fafbfc',
                        padding: '2rem 1.5rem',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        justifyContent: 'center',
                        cursor: item.imageUrls.length >= 10 ? 'not-allowed' : 'pointer',
                        transition: 'all 0.2s ease',
                        width: '100%',
                        boxSizing: 'border-box'
                      }}
                      onMouseEnter={(e) => {
                        if (item.imageUrls.length < 10) e.currentTarget.style.borderColor = '#94a3b8';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.borderColor = '#cbd5e1';
                      }}
                    >
                      <div style={{ color: '#475569', marginBottom: '0.5rem' }}>
                        <UploadCloud size={32} strokeWidth={1.5} />
                      </div>
                      <div style={{ fontSize: '0.9rem', fontWeight: 500, color: '#334155', marginBottom: '0.25rem' }}>
                        Click to upload images
                      </div>
                      <div style={{ fontSize: '0.8rem', color: '#94a3b8' }}>
                        {item.imageUrls.length}/10 images
                      </div>
                    </div>

                    {/* Image Thumbnails Grid */}
                    {item.imageUrls.length > 0 && (
                      <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', marginTop: '1rem' }}>
                        {item.imageUrls.map((imgUrl, imgIdx) => (
                          <div key={imgIdx} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.3rem' }}>
                            <div style={{ position: 'relative', width: '84px', height: '84px', borderRadius: '8px', overflow: 'hidden', border: '1px solid #cbd5e1', boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>
                              <img
                                src={imgUrl}
                                alt={`Gallery ${imgIdx + 1}`}
                                onClick={() => setLightbox({ images: item.imageUrls, index: imgIdx })}
                                title="Click to enlarge"
                                style={{ width: '100%', height: '100%', objectFit: 'cover', cursor: 'pointer' }}
                              />
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleRemoveImage(item.tempId, imgIdx);
                                }}
                                style={{ position: 'absolute', top: '3px', right: '3px', background: 'rgba(0,0,0,0.65)', color: '#fff', border: 'none', borderRadius: '50%', width: '20px', height: '20px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                                title="Remove image"
                              >
                                <X size={12} />
                              </button>
                              <span style={{ position: 'absolute', bottom: '2px', left: '4px', fontSize: '0.65rem', background: 'rgba(0,0,0,0.6)', color: '#fff', padding: '1px 4px', borderRadius: '3px' }}>
                                #{imgIdx + 1}
                              </span>
                            </div>
                            {item.imageUrls.length > 1 && (
                              <div style={{ display: 'flex', gap: '0.35rem', alignItems: 'center' }}>
                                <button
                                  type="button"
                                  onClick={() => handleMoveImage(item.tempId, imgIdx, -1)}
                                  disabled={imgIdx === 0}
                                  title="Move image left"
                                  style={{ background: '#ffffff', border: '1px solid #cbd5e1', color: '#1e293b', width: '26px', height: '26px', borderRadius: '6px', cursor: imgIdx === 0 ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0, lineHeight: 1, opacity: imgIdx === 0 ? 0.4 : 1 }}
                                >
                                  <ChevronLeft size={14} />
                                </button>
                                <span style={{ fontSize: '0.65rem', color: '#94a3b8', whiteSpace: 'nowrap' }}>{imgIdx + 1}/{item.imageUrls.length}</span>
                                <button
                                  type="button"
                                  onClick={() => handleMoveImage(item.tempId, imgIdx, 1)}
                                  disabled={imgIdx === item.imageUrls.length - 1}
                                  title="Move image right"
                                  style={{ background: '#ffffff', border: '1px solid #cbd5e1', color: '#1e293b', width: '26px', height: '26px', borderRadius: '6px', cursor: imgIdx === item.imageUrls.length - 1 ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0, lineHeight: 1, opacity: imgIdx === item.imageUrls.length - 1 ? 0.4 : 1 }}
                                >
                                  <ChevronRight size={14} />
                                </button>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Contract Document Upload */}
                    <div style={{ border: '1.5px dashed #cbd5e1', borderRadius: '8px', background: '#fafbfc', padding: '1rem 1.25rem', marginTop: '1.25rem' }}>
                      <span style={{ fontSize: '0.8rem', fontWeight: 700, color: '#334155', display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.25rem' }}>
                        <FileText size={16} color="#1d4ed8" /> Contract Document (PDF, Word, Excel)
                      </span>
                      <span style={{ fontSize: '0.74rem', color: '#64748b', display: 'block' }}>
                        Attach the signed contract so rates can be verified against it. Click the contract in the directory to read it.
                      </span>

                      {!dbFeatures.contracts && (
                        <div style={{ background: '#fefce8', border: '1px solid #facc15', borderRadius: '6px', padding: '0.5rem 0.75rem', marginTop: '0.6rem', fontSize: '0.74rem', fontWeight: 600, color: '#854d0e' }}>
                          Contract attachment isn't available in this workspace yet.
                        </div>
                      )}

                      <input
                        type="file"
                        id={`contract-input-${item.tempId}`}
                        accept=".pdf,.doc,.docx,.xls,.xlsx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                        style={{ display: 'none' }}
                        onChange={(e) => {
                          handleContractFileSelect(item.tempId, e.target.files);
                          e.target.value = '';
                        }}
                      />

                      {uploadingContract === item.tempId ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.75rem', fontSize: '0.85rem', color: '#475569' }}>
                          <Loader2 size={18} className="spin" style={{ animation: 'spin 1s linear infinite' }} /> Uploading contract…
                        </div>
                      ) : item.contractUrl ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginTop: '0.75rem', background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: '6px', padding: '0.45rem 0.75rem', width: 'fit-content' }}>
                          <FileText size={15} color="#1d4ed8" />
                          <span style={{ fontSize: '0.85rem', fontWeight: 600, color: '#1e3a8a', maxWidth: '340px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {item.contractName}
                          </span>
                          <button type="button" onClick={() => handleRemoveContract(item.tempId)} title="Remove contract" style={{ background: 'none', border: 'none', color: '#b91c1c', cursor: 'pointer', display: 'flex', alignItems: 'center', padding: 0 }}>
                            <X size={16} />
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => document.getElementById(`contract-input-${item.tempId}`)?.click()}
                          style={{ background: '#ffffff', border: '1px solid #cbd5e1', borderRadius: '6px', color: '#1e293b', padding: '0.5rem 1rem', fontSize: '0.85rem', fontWeight: 500, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '0.45rem', marginTop: '0.75rem', boxShadow: '0 1px 2px rgba(0,0,0,0.03)' }}
                        >
                          <UploadCloud size={16} /> Choose contract file
                        </button>
                      )}
                    </div>
                  </div>

                </div>
                );
              })}

              {/* Centered Add Another Item Button */}
              {addMultiple && (
                <div style={{ display: 'flex', justifyContent: 'center', marginTop: '1.5rem', marginBottom: '1.5rem' }}>
                  <button
                    type="button"
                    onClick={handleAddAnotherItem}
                    style={{
                      background: '#ffffff',
                      border: '1px solid #cbd5e1',
                      color: '#1e293b',
                      padding: '0.55rem 1.25rem',
                      borderRadius: '6px',
                      fontSize: '0.9rem',
                      fontWeight: 500,
                      cursor: 'pointer',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '0.4rem',
                      boxShadow: '0 1px 2px rgba(0,0,0,0.03)'
                    }}
                  >
                    <Plus size={16} /> Add Another Library Item
                  </button>
                </div>
              )}

              {/* Bottom Right Actions */}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '1rem', alignItems: 'center', borderTop: '1px solid #f1f5f9', paddingTop: '1.25rem' }}>
                <button
                  type="button"
                  className="secondary-btn"
                  style={{ flex: '0 0 auto', padding: '0.625rem 1.5rem' }}
                  onClick={() => { setShowInlineForm(false); setEditingItems({}); }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="primary-btn"
                  style={{ background: '#0d7478', width: 'auto', padding: '0.625rem 1.5rem' }}
                  disabled={saving}
                >
                  {saving ? 'Saving...' : (Object.keys(editingItems).length > 0 ? 'Save Changes' : 'Add Library Item(s)')}
                </button>
              </div>

            </div>

          </form>

        </div>
      )}

      {/* MASTER LIST OF CREATED LIBRARY ITEMS */}
      <div className="admin-table-container">
        <div style={{ padding: '1.25rem 1.5rem', borderBottom: '1px solid #e2e8f0', background: '#fafafa', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ fontSize: '1.05rem', fontWeight: 700, color: '#1e293b', margin: 0 }}>
            Library Items Directory ({filteredList.length}{totalCount > filteredList.length ? ` of ${totalCount}` : ''})
          </h3>
        </div>

        <table className="admin-table">
          <thead>
            <tr>
              <th>Library Item & Images</th>
              <th>Contract</th>
              <th>Supplier</th>
              <th>Category</th>
              <th>Meal Plan</th>
              <th>Max Occ</th>
              <th>Seasonal Rates Matrix</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading || fetchingItems ? (
              <tr><td colSpan="8" className="text-center" style={{ padding: '3rem' }}>Loading library items...</td></tr>
            ) : filteredList.length === 0 ? (
              <tr>
                <td colSpan="8" className="text-center" style={{ padding: '3rem', color: '#64748b' }}>
                  <Package size={48} style={{ marginBottom: '1rem', opacity: 0.4 }} />
                  <h3>No Library Items Found</h3>
                  <p>Click "Add Library Item" above to build your item catalog.</p>
                </td>
              </tr>
            ) : filteredList.map((item) => {
              const catObj = categories.find(c => c.id === item.category);
              const IconComp = catObj?.icon || Package;
              const hasImages = item.images && item.images.length > 0;
              const isTourStyle = isTourStyleCategory(item.category);
              const transType = item.category === 'Transfers' ? transferTypes.find(t => t.id === item.transfer_type) : null;

              return (
                <tr key={item.id}>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                      {hasImages ? (
                        <img
                          src={item.images[0]}
                          alt={item.name}
                          onClick={() => setLightbox({ images: item.images, index: 0 })}
                          title={`View ${item.images.length} image${item.images.length > 1 ? 's' : ''}`}
                          style={{ width: '48px', height: '48px', borderRadius: '8px', objectFit: 'cover', border: '1px solid #e2e8f0', cursor: 'pointer' }}
                        />
                      ) : (
                        <div style={{ background: '#f1f5f9', color: catObj?.color || '#334155', width: '48px', height: '48px', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          <IconComp size={22} />
                        </div>
                      )}
                      <div>
                        {itemDestinationLabel(item) ? (
                          <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#0d7478', display: 'block', marginBottom: '0.15rem' }}>{itemDestinationLabel(item)}</span>
                        ) : (
                          /* An item with no destination cannot be found by destination in
                             the itinerary and package pickers, so the list says which ones
                             still need one rather than leaving the line blank. */
                          <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#b45309', display: 'block', marginBottom: '0.15rem' }}>No destination set</span>
                        )}
                        <span
                          onClick={() => setDetailItem(item)}
                          title="Click to view every season's pricing"
                          style={{ fontWeight: 700, color: '#0f172a', display: 'block', cursor: 'pointer', textDecoration: 'underline dotted', textUnderlineOffset: '3px' }}
                        >
                          {item.name}{item.identifier_code && <span style={{ color: '#0d7478' }}> - {item.identifier_code}</span>}
                        </span>
                        {item.category === 'Accommodation' && (item.room_types || []).length > 0 && (
                          <span style={{ display: 'flex', flexWrap: 'wrap', gap: '0.3rem', marginTop: '0.25rem' }}>
                            {item.room_types.map((room) => (
                              <span
                                key={room.id || room.name}
                                title={`${room.name} — sleeps ${room.maxOccupancy}`}
                                style={{ fontSize: '0.68rem', fontWeight: 600, color: '#0369a1', background: '#e0f2fe', border: '1px solid #bae6fd', borderRadius: '5px', padding: '0.08rem 0.4rem' }}
                              >
                                {room.name} · sleeps {room.maxOccupancy}
                              </span>
                            ))}
                          </span>
                        )}
                        {/* Only a transfer names a vehicle on its card; an activity
                            says what it is with its tour type instead. */}
                        {item.category === 'Transfers' && item.sub_category && item.sub_category !== 'Transfers' && (
                            <span style={{ display: 'inline-block', marginTop: '0.25rem', fontSize: '0.72rem', fontWeight: 700, color: '#1d4ed8', background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: '5px', padding: '0.1rem 0.45rem' }}>
                              🚐 {item.sub_category} · {item.max_occupancy || 4} pax
                            </span>
                          )}
                          {item.category === 'Activities / Tours' && item.tour_type && (
                            <span style={{ display: 'inline-block', marginLeft: '0.35rem', marginTop: '0.25rem', fontSize: '0.72rem', fontWeight: 700, color: '#047857', background: '#ecfdf5', border: '1px solid #a7f3d0', borderRadius: '5px', padding: '0.1rem 0.45rem' }}>
                              {tourTypes.find(t => t.id === item.tour_type)?.icon || '🧭'} {(tourTypes.find(t => t.id === item.tour_type)?.label || item.tour_type)}
                            </span>
                          )}
                          {minPaxToRunOf(item) > 0 && (
                            <span
                              title={`The supplier will not run this without at least ${minPaxToRunOf(item)} guests`}
                              style={{ display: 'inline-block', marginLeft: '0.35rem', marginTop: '0.25rem', fontSize: '0.72rem', fontWeight: 700, color: '#9a3412', background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: '5px', padding: '0.1rem 0.45rem' }}
                            >
                              Min {minPaxToRunOf(item)} pax
                            </span>
                          )}
                          {isTransportCategory(item.category) && item.transport_type && (() => {
                            const hire = transportTypes.find(t => t.id === item.transport_type);
                            return (
                              <span style={{ display: 'inline-block', marginLeft: '0.35rem', marginTop: '0.25rem', fontSize: '0.72rem', fontWeight: 700, color: '#0369a1', background: '#f0f9ff', border: '1px solid #bae6fd', borderRadius: '5px', padding: '0.1rem 0.45rem' }}>
                                {hire?.icon || '🚌'} {hire?.label || item.transport_type}
                              </span>
                            );
                          })()}
                        {transType && (
                          <span style={{ display: 'inline-block', marginLeft: '0.35rem', fontSize: '0.72rem', fontWeight: 700, color: '#7c3aed', background: '#f5f3ff', border: '1px solid #ddd6fe', borderRadius: '5px', padding: '0.1rem 0.45rem' }}>
                            {transType.icon} {transType.label}
                          </span>
                        )}
                        {item.driver_required === true && isDriverEligibleCategory(item.category) && (
                          <span style={{ display: 'inline-block', marginLeft: '0.35rem', marginTop: '0.25rem', fontSize: '0.72rem', fontWeight: 700, color: '#0f766e', background: '#f0fdfa', border: '1px solid #5eead4', borderRadius: '5px', padding: '0.1rem 0.45rem' }}>
                            🚗 Driver{(item.driver_meals || '').split(',').filter(Boolean).map(id => driverMealOptions.find(o => o.id === id)?.label || id).join(' + ')}
                            {item.driver_accommodation === true ? ' (Overnight)' : ''}
                          </span>
                        )}
                        {isGuideCategory(item.category) && (
                          <span style={{ display: 'inline-block', marginLeft: '0.35rem', marginTop: '0.25rem', fontSize: '0.72rem', fontWeight: 700, color: '#6b21a8', background: '#faf5ff', border: '1px solid #ddd6fe', borderRadius: '5px', padding: '0.1rem 0.45rem' }}>
                            🚶 Guide{(item.guide_meals || '').split(',').filter(Boolean).map(id => driverMealOptions.find(o => o.id === id)?.label || id).join(' + ')}
                            {item.guide_accommodation === true ? ' (Overnight)' : ''}
                          </span>
                        )}
                        {isTrainCategory(item.category) && (
                          <span style={{ display: 'inline-block', marginLeft: '0.35rem', marginTop: '0.25rem', fontSize: '0.72rem', fontWeight: 700, color: '#c2410c', background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: '5px', padding: '0.1rem 0.45rem' }}>
                            🚂 {(item.train_departure_date || '—')} {parseInt(item.train_journey_nights) > 0 ? `· ${item.train_journey_nights} Night${parseInt(item.train_journey_nights) > 1 ? 's' : ''}` : ''} {item.train_cabin_name ? `· ${item.train_cabin_name}` : ''}
                          </span>
                        )}
                        {isTicketCategory(item.category) && (
                          <span style={{ display: 'inline-block', marginLeft: '0.35rem', marginTop: '0.25rem', fontSize: '0.72rem', fontWeight: 700, color: '#0f766e', background: '#f0fdfa', border: '1px solid #99f6e4', borderRadius: '5px', padding: '0.1rem 0.45rem' }}>
                            🎟️ {item.child_age_ranges && item.child_age_ranges.length > 0 ? `${item.child_age_ranges.length} Child Age Tier${item.child_age_ranges.length > 1 ? 's' : ''}` : 'Adults Only'}
                          </span>
                        )}
                        {item.description && (
                          <span
                            onClick={() => setDescriptionPopup(item.description)}
                            title="Click to view full description"
                            style={{ fontSize: '0.8rem', color: '#64748b', display: '-webkit-box', WebkitLineClamp: 1, WebkitBoxOrient: 'vertical', overflow: 'hidden', cursor: 'pointer', textDecoration: 'underline dotted', textUnderlineOffset: '3px' }}
                          >
                            {item.description}
                          </span>
                        )}
                      </div>
                    </div>
                  </td>
                  <td>
                    {item.contract_url ? (
                      <button
                        type="button"
                        onClick={() => setContractPopup({ name: item.contract_name || 'Contract Document', url: item.contract_url })}
                        title="Click to read the contract document"
                        style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.78rem', fontWeight: 600, color: '#1d4ed8', background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: '6px', padding: '0.35rem 0.7rem', cursor: 'pointer' }}
                      >
                        <FileText size={14} /> View Contract
                      </button>
                    ) : (
                      <span style={{ fontSize: '0.8rem', color: '#94a3b8' }}>—</span>
                    )}
                  </td>
                  <td>
                    <span style={{ fontWeight: 600, color: '#334155', fontSize: '0.9rem' }}>
                      {item.supplier?.name || 'Unassigned'}
                    </span>
                    {starRatingOf(item.supplier?.star_rating) && (
                      <div
                        title={`${starLabel(item.supplier.star_rating)} hotel`}
                        style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', marginTop: '0.1rem', color: '#b45309', fontSize: '0.78rem', fontWeight: 700 }}
                      >
                        <span>{starGlyphs(item.supplier.star_rating)}</span>
                        <span style={{ fontSize: '0.7rem', fontWeight: 600 }}>{starLabel(item.supplier.star_rating)}</span>
                      </div>
                    )}
                  </td>
                  <td>
                    <span className="status-badge active" style={{ background: '#f8fafc', color: catObj?.color || '#334155', border: '1px solid #e2e8f0' }}>
                      {item.category}
                    </span>
                  </td>
                  <td>
                    <div style={{ fontSize: '0.85rem', color: '#475569' }}>
                      <div className="meal-plan-cell">{item.item_rates?.find(r => r.meal_plan)?.meal_plan || '—'}</div>
                    </div>
                  </td>
                  <td>
                    <div style={{ fontSize: '0.85rem', color: '#475569' }}>
                      {isTicketCategory(item.category) || isExtrasCategory(item.category) || isCarRentalCategory(item.category) ? (
                        <div style={{ fontWeight: 600, color: isExtrasCategory(item.category) ? '#db2777' : (isCarRentalCategory(item.category) ? '#0e7490' : '#0f766e') }}>
                          {(isCarRentalCategory(item.category))
                            ? 'Per Vehicle'
                            : (isExtrasCategory(item.category) && item.pricing_model === 'per_unit' ? 'Service Only' : 'Per Person')}
                        </div>
                      ) : (
                        <>
                          <div>Max Occ: <strong>{item.max_occupancy || 2} Persons</strong></div>
                          {(item.category === 'Accommodation' || isTrainCategory(item.category)) && Array.isArray(item.sharing_capacity_rules) && item.sharing_capacity_rules.length > 0 ? (
                            <div style={{ fontSize: '0.72rem', color: '#64748b', marginTop: '0.2rem', lineHeight: '1.35' }}>
                              {item.sharing_capacity_rules.map(r => `${r.adults}A (+${r.maxChildren}Ch)`).join(' · ')}
                            </div>
                          ) : (item.category === 'Accommodation' || isTrainCategory(item.category)) ? (
                            <div style={{ fontSize: '0.74rem', color: '#64748b', marginTop: '0.2rem' }}>
                              Max {item.max_adults || item.max_occupancy || 2} Adults
                            </div>
                          ) : null}
                        </>
                      )}
                    </div>
                  </td>
                  <td>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem' }}>
                      {/* Pricing model badge */}
                      {isSurchargeItem(item) && (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.72rem', fontWeight: 700, color: '#c2410c', background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: '5px', padding: '0.15rem 0.45rem', marginBottom: '0.2rem', width: 'fit-content' }}>
                          {(item.surcharge_type || 'entrance_fee') === 'entrance_fee' ? 'Entrance Fees' : 'Conservation Levy'}
                          {item.surcharge_charge_basis === 'per_night' ? ' (Per Night)' : ''}
                          {item.surcharge_chargeable === false ? ' · Not chargeable' : ''}
                        </span>
                      )}
                      {item.category === 'Flights / Charter' ? (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.72rem', fontWeight: 700, color: '#4338ca', background: '#eef2ff', border: '1px solid #c7d2fe', borderRadius: '5px', padding: '0.15rem 0.45rem', marginBottom: '0.2rem', width: 'fit-content' }}>
                          ✈️ {item.pricing_model === 'per_vehicle' ? 'Per Charter' : 'Per Person'}
                        </span>
                      ) : isTourStyle && item.pricing_model === 'per_vehicle' ? (
                        <>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.72rem', fontWeight: 700, color: '#1d4ed8', background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: '5px', padding: '0.15rem 0.45rem', marginBottom: '0.2rem', width: 'fit-content' }}>
                            🚐 Price by Vehicle
                          </span>
                          {vehicleVectorSummary(item.item_rates).length > 0 && (
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.3rem', marginBottom: '0.3rem' }}>
                              {vehicleVectorSummary(item.item_rates).map(([code, value]) => {
                                const vehicleType = vehicleTypes.find(v => v.code === code);
                                return (
                                  <span key={code} style={{ fontSize: '0.7rem', fontWeight: 600, color: '#334155', background: '#f1f5f9', border: '1px solid #e2e8f0', borderRadius: '4px', padding: '0.1rem 0.35rem', fontVariantNumeric: 'tabular-nums' }}>
                                    {vehicleType ? vehicleType.name : code} {value}
                                  </span>
                                );
                              })}
                            </div>
                          )}
                        </>
                      ) : isTourStyle && item.pricing_model === 'tiered' ? (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.72rem', fontWeight: 700, color: '#7c3aed', background: '#f5f3ff', border: '1px solid #ddd6fe', borderRadius: '5px', padding: '0.15rem 0.45rem', marginBottom: '0.2rem', width: 'fit-content' }}>
                          📊 Tiered (by pax count)
                        </span>
                      ) : isTourStyle ? (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.72rem', fontWeight: 700, color: '#047857', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '5px', padding: '0.15rem 0.45rem', marginBottom: '0.2rem', width: 'fit-content' }}>
                          👤 Per Person
                        </span>
                      ) : isTicketCategory(item.category) ? (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.72rem', fontWeight: 700, color: '#0f766e', background: '#f0fdfa', border: '1px solid #99f6e4', borderRadius: '5px', padding: '0.15rem 0.45rem', marginBottom: '0.2rem', width: 'fit-content' }}>
                          🎟️ Per Person
                        </span>
                      ) : isExtrasCategory(item.category) ? (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.72rem', fontWeight: 700, color: '#db2777', background: '#fdf2f8', border: '1px solid #f9a8d4', borderRadius: '5px', padding: '0.15rem 0.45rem', marginBottom: '0.2rem', width: 'fit-content' }}>
                          ✨ {item.pricing_model === 'per_unit' ? 'Service only (per unit)' : 'Per Person'}
                        </span>
                      ) : isCarRentalCategory(item.category) ? (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.72rem', fontWeight: 700, color: '#0e7490', background: '#ecfeff', border: '1px solid #67e8f9', borderRadius: '5px', padding: '0.15rem 0.45rem', marginBottom: '0.2rem', width: 'fit-content' }}>
                          🚗 Flat Rate (Per Vehicle)
                        </span>
                      ) : item.pricing_model === 'per_room' ? (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.72rem', fontWeight: 700, color: '#7c3aed', background: '#f5f3ff', border: '1px solid #ddd6fe', borderRadius: '5px', padding: '0.15rem 0.45rem', marginBottom: '0.2rem', width: 'fit-content' }}>
                          {isTrainCategory(item.category) ? '🚂 Flat Cabin Rate' : '🏠 Flat Room Rate'}
                        </span>
                      ) : (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.72rem', fontWeight: 700, color: '#047857', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '5px', padding: '0.15rem 0.45rem', marginBottom: '0.2rem', width: 'fit-content' }}>
                          👥 Per Person (PPS)
                        </span>
                      )}
                      {item.item_rates && item.item_rates.length > 0 ? (
                        item.item_rates.map((rate, rIdx) => {
                          /* One season at a time, stepped with the arrows below. */
                          if (rIdx !== activeListSeasonIndex(item.id, item.item_rates)) return null;
                          const isFlat = item.pricing_model === 'per_room' || rate.rate_basis === 'per_room';
                          const flatRate = parseFloat(rate.unit_price) || parseFloat(rate.price_1_adult) || 0;
                          const p1 = parseFloat(rate.price_1_adult || rate.single_room_rate) || 0;
                          const p2 = parseFloat(rate.price_2_adults || rate.double_twin_rate) || 0;
                          const p3 = parseFloat(rate.price_3_plus_adults) || 0;
                          const childRatesMap = rate.child_rates_breakdown || {};
                          const childBands = item.child_age_ranges || [];
                          const hasBreakdown = Object.keys(childRatesMap).length > 0 && childBands.length > 0;
                          const guideDriverOffered = item.guide_driver_room_offered === true;
                          const guideMinRooms = Math.max(1, Number(item.guide_min_rooms) || 1);
                          const singleRate = isFlat ? flatRate : (p1 || 0);
                          /* Guide/driver: a typed 0 is a free room; a blank rate
                             means the property charges its normal single rate. */
                          const guideRateConfigured = rate.guide_rate !== null && rate.guide_rate !== undefined && rate.guide_rate !== '';
                          const driverRateConfigured = rate.driver_rate !== null && rate.driver_rate !== undefined && rate.driver_rate !== '';
                          const guideRate = guideRateConfigured ? (parseFloat(rate.guide_rate) || 0) : singleRate;
                          const driverRate = driverRateConfigured ? (parseFloat(rate.driver_rate) || 0) : singleRate;
                          /* One crew pool prints one rule: the ladder a property
                             saved into either column, headed by the guide figure. */
                          const crewTiers = crewLadderTiers(rate.guide_tiers, rate.driver_tiers);
                          const crewRate = guideRateConfigured ? guideRate : driverRate;
                          const guideRateText = (value) => `${item.currency} ${Number(value).toLocaleString()}`;
                          const crewTierSummary = staffTierSummary(
                            staffRoomLadder({ offered: true, tiers: crewTiers, minRooms: guideMinRooms, rate: crewRate }),
                            guideRateText,
                            'crew room'
                          );
                          /* Tour leader: a 0 is a free room, so the preview keeps a
                             configured 0 instead of falling back to the single rate. */
                          const tourLeaderOffered = item.tour_leader_room_offered === true;
                          const tlLadder = normaliseStaffTiers(rate.tour_leader_tiers);
                          const tlRateConfigured = rate.tour_leader_rate !== null && rate.tour_leader_rate !== undefined && rate.tour_leader_rate !== '';
                          const tlBaseRate = tlRateConfigured ? (parseFloat(rate.tour_leader_rate) || 0) : singleRate;
                          /* The preview states each band's client-room range,
                             so 1–10 rooms at one rate and 11+ at another read
                             as two explicit lines rather than one headline. */
                          const tlTierSummary = staffTierSummary(tlLadder, guideRateText, 'TL room');
                          const itemMealPlan = item.item_rates?.find(r => r.meal_plan)?.meal_plan || '—';
                          const guideMealPlan = rate.guide_meal_plan || itemMealPlan;
                          const driverMealPlan = rate.driver_meal_plan || itemMealPlan;
                          const transferTiers = Array.isArray(rate.tiered_pricing) ? rate.tiered_pricing : [];
                          const transferTierRate = parseFloat(rate.tiered_pricing?.[0]?.rate) || 0;
                          const transferAdultRate = parseFloat(rate.price_1_adult || rate.unit_price) || transferTierRate;
                          const transferChildRate = parseFloat(childRatesMap.child) || 0;

                          return (
                            <div key={rIdx}>
                              {item.item_rates.length > 1 && (
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem', marginBottom: '0.3rem' }}>
                                  <button type="button" aria-label="Previous season" title="Use the arrows to move between seasons" onClick={() => stepListSeason(item.id, item.item_rates, -1)} style={seasonNavBtnStyle}>
                                    <ChevronLeft size={16} />
                                  </button>
                                  <span style={{ fontSize: '0.72rem', fontWeight: 700, color: '#475569', whiteSpace: 'nowrap' }}>
                                    Season {rIdx + 1} of {item.item_rates.length}
                                  </span>
                                  <button type="button" aria-label="Next season" title="Use the arrows to move between seasons" onClick={() => stepListSeason(item.id, item.item_rates, 1)} style={seasonNavBtnStyle}>
                                    <ChevronRight size={16} />
                                  </button>
                                </div>
                              )}
                            <div style={{ fontSize: '0.78rem', background: '#f8fafc', padding: '0.45rem 0.65rem', borderRadius: '6px', border: '1px solid #e2e8f0', lineHeight: 1.4 }}>
                              <div style={{ fontWeight: 700, color: '#1e293b', marginBottom: '0.15rem' }}>
                                {rate.season_name || 'Season'}:
                              </div>
{item.category === 'Guide' ? (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.72rem', fontWeight: 700, color: '#6b21a8', background: '#faf5ff', border: '1px solid #ddd6fe', borderRadius: '5px', padding: '0.15rem 0.45rem', marginBottom: '0.2rem', width: 'fit-content' }}>
                          🚶 Per Trip
                        </span>
                      ) : item.category === 'Flights / Charter' ? (
                                <>{(item.departure_city || item.arrival_city) && (
                                    <div style={{ color: '#4338ca', fontWeight: 600, marginBottom: '0.15rem' }}>
                                      {[item.departure_city, item.arrival_city].filter(Boolean).join(' → ')}
                                      {item.flight_number ? ` · ${item.flight_number}` : ''}
                                    </div>
                                  )}
                                  <div style={{ color: '#4338ca', fontWeight: 600 }}>
                                    <strong>{item.pricing_model === 'per_vehicle' ? 'Charter:' : 'Adult:'}</strong> {item.currency} {transferAdultRate.toLocaleString()}{item.pricing_model === 'per_vehicle' ? ' / flight' : ''}
                                  </div>
                                  {transferChildRate > 0 && (
                                    <div style={{ color: '#64748b', fontSize: '0.72rem', marginTop: '0.15rem' }}>
                                      <strong>Child (up to {parseInt(childBands[0]?.ageTo) || 12} yrs):</strong> {item.currency} {transferChildRate.toLocaleString()}
                                    </div>
                                  )}
                                  {(parseFloat(rate.taxes_and_surcharges) || 0) > 0 && (
                                    <div style={{ color: '#b45309', fontWeight: 600, marginTop: '0.15rem' }}>
                                      <strong>Taxes &amp; Surcharges:</strong> {item.currency} {(parseFloat(rate.taxes_and_surcharges) || 0).toLocaleString()}
                                    </div>
                                  )}
                                </>
                              ) : isTicketCategory(item.category) ? (
                                <>
                                  <div style={{ color: '#0f766e', fontWeight: 600 }}>
                                    <strong>{item.ticket_type === 'fast_track' ? 'Fast Track' : 'Standard'}:</strong> {item.currency} {(parseFloat(item.ticket_type === 'fast_track' ? (rate.fast_track_adult_rate || rate.price_1_adult) : rate.price_1_adult) || 0).toLocaleString()} / person
                                  </div>
                                  {(item.ticket_type === 'both') && (
                                    <div style={{ color: '#0f766e', fontWeight: 600, marginTop: '0.15rem' }}>
                                      <strong>Fast Track:</strong> {item.currency} {(parseFloat(rate.fast_track_adult_rate) || 0).toLocaleString()} / person
                                    </div>
                                  )}
                                  {childBands.length > 0 && childBands.map((band) => {
                                    const bandRate = parseFloat(childRatesMap[band.id]) || 0;
                                    return bandRate > 0 ? (
                                      <div key={band.id} style={{ color: '#64748b', fontSize: '0.74rem', marginTop: '0.15rem' }}>
                                        <strong>{band.name} ({band.ageFrom}–{band.ageTo} yrs):</strong> {item.currency} {bandRate.toLocaleString()} / child
                                      </div>
                                    ) : null;
                                  })}
                                  {item.ticket_type === 'both' && (
                                    (() => {
                                      const fastTrackChildRatesMap = rate.fast_track_child_rates_breakdown || {};
                                      return childBands.length > 0 ? childBands.map((band) => {
                                        const bandRate = parseFloat(fastTrackChildRatesMap[band.id]) || 0;
                                        return bandRate > 0 ? (
                                          <div key={`ft-${band.id}`} style={{ color: '#64748b', fontSize: '0.74rem', marginTop: '0.15rem' }}>
                                            <strong>FT {band.name} ({band.ageFrom}–{band.ageTo} yrs):</strong> {item.currency} {bandRate.toLocaleString()} / child
                                          </div>
                                        ) : null;
                                      }) : null;
                                    })()
                                  )}
                                </>
                              ) : isExtrasCategory(item.category) ? (
                                <>
                                  <div style={{ color: '#db2777', fontWeight: 600 }}>
                                    <strong>{item.pricing_model === 'per_unit' ? 'Service:' : 'Adult:'}</strong> {item.currency} {transferAdultRate.toLocaleString()}{item.pricing_model === 'per_unit' ? ' / service' : ' / person'}
                                  </div>
                                  {item.pricing_model !== 'per_unit' && transferChildRate > 0 && (
                                    <div style={{ color: '#64748b', fontSize: '0.74rem', marginTop: '0.15rem' }}>
                                      <strong>Child:</strong> {item.currency} {transferChildRate.toLocaleString()} / child
                                    </div>
                                  )}
                                </>
                              ) : isTourStyle ? (
                                <>
                                  {item.pricing_model === 'per_vehicle' || rate.rate_basis === 'per_vehicle' ? (
                                    <div style={{ color: '#1d4ed8', fontWeight: 600 }}>
                                      {item.currency} {transferAdultRate.toLocaleString()} / vehicle
                                      <span style={{ fontWeight: 400, color: '#64748b', marginLeft: '0.4rem', fontSize: '0.72rem' }}>
                                        (÷ pax for per-person rate)
                                      </span>
                                    </div>
                                  ) : item.pricing_model === 'tiered' || rate.rate_basis === 'tiered' ? (
                                    (transferTiers.length > 0 ? (
                                      <div style={{ color: '#7c3aed' }}>
                                        {transferTiers.map((t, tIdx) => (
                                          <div key={tIdx} style={{ fontWeight: 600 }}>
                                            {t.min_pax}–{t.max_pax} pax: {item.currency} {(parseFloat(t.rate) || 0).toLocaleString()}
                                          </div>
                                        ))}
                                      </div>
                                    ) : (
                                      <div style={{ color: '#7c3aed', fontWeight: 600 }}>
                                        {item.currency} {transferAdultRate.toLocaleString()} (tiered)
                                      </div>
                                    ))
                                  ) : (
                                    <div style={{ color: '#334155' }}>
                                      <strong>Per Person:</strong> {item.currency} {transferAdultRate.toLocaleString()}
                                    </div>
                                  )}
                                  {transferChildRate > 0 && (
                                    <div style={{ color: '#64748b', fontSize: '0.72rem', marginTop: '0.15rem' }}>
                                      Child (up to {parseInt(childBands[0]?.ageTo) || 12} yrs): {item.currency} {transferChildRate.toLocaleString()}
                                    </div>
                                  )}
                                </>
                              ) : isGuideCategory(item.category) ? (
                                <div style={{ color: '#6b21a8', fontWeight: 600, lineHeight: 1.55 }}>
                                  {guideServiceTypes.map(gst => {
                                    const colMap = {
                                      transfer: 'guide_transfer_rate',
                                      half_day: 'guide_half_day_rate',
                                      full_day: 'guide_full_day_rate',
                                      overland: 'guide_overland_rate',
                                      dinner_transfer: 'guide_dinner_rate'
                                    };
                                    const svcRate = parseFloat(rate[colMap[gst.id]]) || 0;
                                    return svcRate > 0 ? (
                                      <div key={gst.id} style={{ fontSize: '0.74rem' }}>
                                        <strong>{gst.label}:</strong> {item.currency} {svcRate.toLocaleString()}
                                      </div>
                                    ) : null;
                                  })}
                                  <span style={{ fontWeight: 400, color: '#64748b', fontSize: '0.72rem' }}>
                                    (per trip, shared among travellers)
                                  </span>
                                </div>
                              ) : isFlat ? (
                                <div style={{ color: '#7c3aed', fontWeight: 600 }}>
                                  Flat Rate: {item.currency} {flatRate.toLocaleString()} / {isTrainCategory(item.category) ? 'cabin' : 'room'}
                                  <span style={{ fontWeight: 400, color: '#64748b', marginLeft: '0.4rem', fontSize: '0.72rem' }}>
                                    (÷ occupants for per-person rate)
                                  </span>
                                </div>
                              ) : (
                                <>
                                  <div style={{ color: '#334155' }}>
                                    <strong>Single:</strong> {item.currency} {p1.toLocaleString()} | <strong>PPS:</strong> {item.currency} {p2.toLocaleString()}
                                  </div>
                                  {p3 > 0 && (
                                    <div style={{ color: '#475569', fontSize: '0.74rem' }}>
                                      <strong>3+ Adults:</strong> {item.currency} {p3.toLocaleString()} (PP)
                                    </div>
                                  )}
                                  {hasBreakdown && (
                                    <div style={{ color: '#64748b', fontSize: '0.72rem', marginTop: '0.15rem' }}>
                                      Child Sharing: {childBands.map(b => `${b.name}: ${item.currency} ${(parseFloat(childRatesMap[b.id]) || 0).toLocaleString()}`).join(' | ')}
                                    </div>
                                  )}
                                </>
                              )}
                              {item.category === 'Accommodation' && (
                                <div style={{ color: '#b45309', fontSize: '0.7rem', marginTop: '0.15rem', background: '#fffbeb', border: '1px solid #fde68a', padding: '0.2rem 0.4rem', borderRadius: '4px', display: 'flex', flexWrap: 'wrap', gap: '0 0.5rem' }}>
                                  {guideDriverOffered ? (
                                    <span>
                                      Driver-Guide (one pool): {crewTiers.length > 0
                                        ? crewTierSummary
                                        : `${item.currency} ${crewRate.toLocaleString()} (guide ${guideMealPlan} \u00b7 driver ${driverMealPlan}${guideMinRooms > 1 ? ` \u00b7 min ${guideMinRooms} client rooms` : ''})`}
                                    </span>
                                  ) : (
                                    <span>
                                      Guide/Driver: defaults to Single ({item.currency} {singleRate.toLocaleString()})
                                    </span>
                                  )}
                                  {tourLeaderOffered && (
                                    <div style={{ color: '#0f766e', fontSize: '0.7rem', marginTop: '0.15rem', background: '#f0fdfa', border: '1px solid #99f6e4', padding: '0.2rem 0.4rem', borderRadius: '4px' }}>
                                      {tlLadder.length > 0
                                        ? <>Tour Leader: {tlTierSummary}</>
                                        : <>Tour Leader: {item.currency} {tlBaseRate.toLocaleString()} (Min {item.tour_leader_min_rooms || 1} client rooms)</>}
                                    </div>
                                  )}
                                </div>
                              )}
                              {/* A Fees & Tickets item shows its fee figures here, on its own rate
                                  rows, keyed off the surcharge type rather than a legacy flag. */}
                              {isSurchargeItem(item) && (item.surcharge_type || 'entrance_fee') === 'entrance_fee' && ((parseFloat(rate.entrance_fee_per_person) || 0) > 0 || (parseFloat(rate.entrance_fee_per_vehicle) || 0) > 0) && (
                                <div style={{ color: '#c2410c', fontWeight: 600, marginTop: '0.15rem' }}>
                                  {(parseFloat(rate.entrance_fee_per_person) || 0) > 0 && (
                                    <span><strong>Entrance / Person:</strong> {item.currency} {(parseFloat(rate.entrance_fee_per_person) || 0).toLocaleString()}</span>
                                  )}
                                  {(parseFloat(rate.entrance_fee_per_person) || 0) > 0 && (parseFloat(rate.entrance_fee_per_vehicle) || 0) > 0 && <span style={{ margin: '0 0.3rem' }}>|</span>}
                                  {(parseFloat(rate.entrance_fee_per_vehicle) || 0) > 0 && (
                                    <span><strong>Entrance / Vehicle:</strong> {item.currency} {(parseFloat(rate.entrance_fee_per_vehicle) || 0).toLocaleString()}</span>
                                  )}
                                </div>
                              )}
                              {isSurchargeItem(item) && (item.surcharge_type || 'entrance_fee') !== 'entrance_fee' && ((parseFloat(rate.conservation_levy_per_adult) || 0) > 0 || (parseFloat(rate.conservation_levy_per_child) || 0) > 0) && (
                                <div style={{ color: '#c2410c', fontWeight: 600, marginTop: '0.15rem' }}>
                                  {(parseFloat(rate.conservation_levy_per_adult) || 0) > 0 && (
                                    <span><strong>Levy Adult{item.surcharge_charge_basis === 'per_night' ? ' / Night' : ''}:</strong> {item.currency} {(parseFloat(rate.conservation_levy_per_adult) || 0).toLocaleString()}</span>
                                  )}
                                  {(parseFloat(rate.conservation_levy_per_adult) || 0) > 0 && (parseFloat(rate.conservation_levy_per_child) || 0) > 0 && <span style={{ margin: '0 0.3rem' }}>|</span>}
                                  {(parseFloat(rate.conservation_levy_per_child) || 0) > 0 && (
                                    <span><strong>Levy Child{item.surcharge_charge_basis === 'per_night' ? ' / Night' : ''}:</strong> {item.currency} {(parseFloat(rate.conservation_levy_per_child) || 0).toLocaleString()}</span>
                                  )}
                                </div>
                              )}
                            </div>
                            </div>
                          );
                        })
                      ) : isCarRentalCategory(item.category) ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                          {(item.car_rental_rates && item.car_rental_rates.length > 0) ? (
                            /* The same fold the hire dialog prices from, so the summary
                               on the saved card cannot say one thing about the seasons
                               and the drop say another. */
                            carRentalGroups({ car_rental_rates: item.car_rental_rates, currency: item.currency }).map((g) => (
                              <div key={g.key} style={{ background: '#f0fdfa', border: '1px solid #99f6e4', borderRadius: '6px', padding: '0.4rem 0.55rem', marginTop: '0.1rem' }}>
                                <div style={{ fontWeight: 700, color: '#0e7490', marginBottom: '0.15rem' }}>
                                  {g.vehicleGroup && `${g.vehicleGroup} · `}{g.vehicleName || 'Vehicle'}
                                  {g.rateCode && <span style={{ color: '#155e75', fontWeight: 600 }}> — {g.rateCode}</span>}
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.2rem', fontSize: '0.7rem', color: '#0e7490' }}>
                                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem', background: '#ecfeff', border: '1px solid #a5f3fc', borderRadius: '4px', padding: '0.08rem 0.35rem' }}>
                                    <Briefcase size={11} /> {g.luggage ? `${g.luggage} bags` : '—'}
                                  </span>
                                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem', background: '#ecfeff', border: '1px solid #a5f3fc', borderRadius: '4px', padding: '0.08rem 0.35rem' }}>
                                    <DoorOpen size={11} /> {g.doors ? `${g.doors}` : '—'}
                                  </span>
                                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem', background: '#ecfeff', border: '1px solid #a5f3fc', borderRadius: '4px', padding: '0.08rem 0.35rem' }}>
                                    <Users size={11} /> {g.passengers ? `Max ${g.passengers} pax` : '—'}
                                  </span>
                                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem', background: '#ecfeff', border: '1px solid #a5f3fc', borderRadius: '4px', padding: '0.08rem 0.35rem' }}>
                                    <Snowflake size={11} /> {g.aircon ? 'AC' : 'No AC'}
                                  </span>
                                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem', background: '#ecfeff', border: '1px solid #a5f3fc', borderRadius: '4px', padding: '0.08rem 0.35rem' }}>
                                    <Cog size={11} /> {g.gear === 'manual' ? 'Manual' : 'Auto'}
                                  </span>
                                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem', background: '#ecfeff', border: '1px solid #a5f3fc', borderRadius: '4px', padding: '0.08rem 0.35rem' }}>
                                    {g.fuelType === 'electric' ? <Zap size={11} /> : <Fuel size={11} />} {g.fuelType === 'electric' ? 'Electric' : 'Fuel'}
                                  </span>
                                </div>
                                {g.seasons.map((season) => (
                                  <div key={season.key} style={{ marginBottom: '0.2rem' }}>
                                    <div style={{ color: '#0e7490', fontSize: '0.7rem', fontWeight: 700 }}>
                                      Rental Price Validity {season.windowLabel}
                                    </div>
                                    {season.bands.map((band) => (
                                      <div key={`${season.key}-${band.id}`} style={{ color: '#334155', fontSize: '0.74rem', lineHeight: 1.5 }}>
                                        {`${band.minDays}${(band.maxDays && band.maxDays !== band.minDays) ? `–${band.maxDays}` : '+'} days: `}
                                        {item.currency} {(parseFloat(band.price) || 0).toLocaleString()} / vehicle
                                      </div>
                                    ))}
                                  </div>
                                ))}
                                <div style={{ color: '#64748b', fontSize: '0.7rem', marginTop: '0.2rem' }}>
                                  {g.kmsUnlimited ? 'Unlimited km' : `${g.kmsIncluded || 0} km incl.`}
                                </div>
                              </div>
                            ))
                          ) : (
                            <span style={{ fontSize: '0.8rem', color: '#94a3b8' }}>No car rental rates configured</span>
                          )}
                        </div>
                      ) : (
                        <span style={{ fontSize: '0.8rem', color: '#94a3b8' }}>No rates defined</span>
                      )}
                    </div>
                  </td>
                  <td>
                    <div className="action-buttons">
                      <button className="action-btn" onClick={() => setDetailItem(item)} title="View all pricing">
                        <Eye size={16} />
                      </button>
                      <button className="action-btn" onClick={() => handleEditItem(item)} title="Edit Item">
                        <Edit3 size={16} />
                      </button>
                      <button className="action-btn delete" onClick={() => handleDeleteItem(item)} title="Delete Item">
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {!loading && !fetchingItems && totalCount > filteredList.length && (
          <div style={{ padding: '1rem', textAlign: 'center', borderTop: '1px solid #e2e8f0' }}>
            <button
              type="button"
              className="secondary-btn"
              style={{ flex: '0 0 auto' }}
              onClick={() => fetchLibraryItems({ offset: filteredList.length, append: true })}
            >
              Load more ({filteredList.length} of {totalCount} shown)
            </button>
          </div>
        )}
      </div>

      {/* IMAGE GALLERY LIGHTBOX */}
      {lightbox && (
        <div
          onClick={() => setLightbox(null)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(15,23,42,0.9)',
            zIndex: 1000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexDirection: 'column'
          }}
        >
          <button
            onClick={() => setLightbox(null)}
            title="Close"
            style={{ position: 'absolute', top: '1rem', right: '1.25rem', background: 'rgba(255,255,255,0.12)', border: 'none', color: '#fff', width: '40px', height: '40px', borderRadius: '50%', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          >
            <X size={24} />
          </button>

          <div style={{ color: '#e2e8f0', fontWeight: 600, marginBottom: '0.75rem', fontSize: '0.9rem' }}>
            Image {lightbox.index + 1} of {lightbox.images.length}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', maxWidth: '92vw' }} onClick={(e) => e.stopPropagation()}>
            <button
              onClick={() => setLightbox(prev => prev && { ...prev, index: (prev.index - 1 + prev.images.length) % prev.images.length })}
              title="Previous image"
              style={{ background: 'rgba(255,255,255,0.12)', border: 'none', color: '#fff', width: '44px', height: '44px', borderRadius: '50%', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}
            >
              <ChevronLeft size={26} />
            </button>
            <img
              src={lightbox.images[lightbox.index]}
              alt={`Image ${lightbox.index + 1}`}
              style={{ maxWidth: '75vw', maxHeight: '72vh', objectFit: 'contain', borderRadius: '8px', background: '#000' }}
            />
            <button
              onClick={() => setLightbox(prev => prev && { ...prev, index: (prev.index + 1) % prev.images.length })}
              title="Next image"
              style={{ background: 'rgba(255,255,255,0.12)', border: 'none', color: '#fff', width: '44px', height: '44px', borderRadius: '50%', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}
            >
              <ChevronRight size={26} />
            </button>
          </div>

          {lightbox.images.length > 1 && (
            <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1.25rem', flexWrap: 'wrap', justifyContent: 'center', maxWidth: '80vw' }} onClick={(e) => e.stopPropagation()}>
              {lightbox.images.map((img, i) => (
                <img
                  key={i}
                  src={img}
                  alt={`Thumb ${i + 1}`}
                  onClick={() => setLightbox(prev => prev && { ...prev, index: i })}
                  style={{
                    width: '46px',
                    height: '46px',
                    borderRadius: '6px',
                    objectFit: 'cover',
                    cursor: 'pointer',
                    border: i === lightbox.index ? '2px solid #14b8a6' : '2px solid rgba(255,255,255,0.25)',
                    opacity: i === lightbox.index ? 1 : 0.65
                  }}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* DESCRIPTION POPUP */}
      {descriptionPopup && (
        <div
          onClick={() => setDescriptionPopup(null)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(15,23,42,0.55)',
            zIndex: 1001,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '1.5rem'
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ background: '#fff', borderRadius: '12px', padding: '1.75rem', maxWidth: '560px', width: '100%', boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem', borderBottom: '1px solid #e2e8f0', paddingBottom: '0.75rem' }}>
              <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 700, color: '#0f172a', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <FileText size={18} color="#00665c" /> Item Description
              </h3>
              <button onClick={() => setDescriptionPopup(null)} style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#64748b' }}>
                <X size={20} />
              </button>
            </div>
            <p style={{ margin: 0, fontSize: '0.95rem', lineHeight: 1.6, color: '#334155', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
              {descriptionPopup}
            </p>
          </div>
        </div>
      )}

      {/* READ-ONLY PRICING VIEW */}
      {detailItem && (
        <LibraryItemDetailModal
          item={detailItem}
          vehicleTypes={vehicleTypes}
          onClose={() => setDetailItem(null)}
        />
      )}

      {/* CONTRACT DOCUMENT POPUP */}
      {contractPopup && (
        <div
          onClick={() => setContractPopup(null)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(15,23,42,0.7)',
            zIndex: 1002,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '1.5rem'
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ background: '#fff', borderRadius: '12px', width: 'min(1100px, 94vw)', maxHeight: '90vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 20px 60px rgba(0,0,0,0.35)' }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.9rem 1.25rem', borderBottom: '1px solid #e2e8f0', background: '#fafafa', gap: '1rem' }}>
              <h3 style={{ margin: 0, fontSize: '0.98rem', fontWeight: 700, color: '#0f172a', display: 'flex', alignItems: 'center', gap: '0.5rem', minWidth: 0 }}>
                <FileText size={18} color="#1d4ed8" />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {contractPopup.name}
                </span>
              </h3>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexShrink: 0 }}>
                <a
                  href={contractPopup.url}
                  target="_blank"
                  rel="noreferrer"
                  download={contractPopup.name}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', background: '#0d7478', color: '#fff', border: 'none', padding: '0.45rem 1rem', borderRadius: '6px', fontSize: '0.82rem', fontWeight: 600, cursor: 'pointer', textDecoration: 'none' }}
                >
                  <Download size={15} /> Download
                </a>
                <button onClick={() => setContractPopup(null)} style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#64748b' }}>
                  <X size={20} />
                </button>
              </div>
            </div>

            <iframe
              src={getContractViewerSrc(contractPopup.url, contractPopup.name)}
              title="Contract Document"
              style={{ width: '100%', height: '72vh', minHeight: '420px', border: 'none', background: '#f1f5f9' }}
            />

            <div style={{ padding: '0.6rem 1.25rem', borderTop: '1px solid #e2e8f0', background: '#fafafa', fontSize: '0.78rem', color: '#64748b' }}>
              If the preview does not load, use <strong>Download</strong> to open the document directly.
            </div>
          </div>
        </div>
      )}

      {confirmDialog && <ConfirmDialog {...confirmDialog} />}

    </div>
  );
};
