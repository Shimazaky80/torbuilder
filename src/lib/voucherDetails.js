/* Per-category supplier voucher details shared by preview, email, and print. */
import { starLabel } from './starGrading';
import { crewShareOn } from './guidePricing';
import { carSpecText } from './carSpecIcons';
import { isRentalFeeLine, rentalDaysLabel, rentalVehicleLabel, rentalWindowLabel } from './carRentalPricing';
import { allocatedRoomTypeLabel } from './roomTypes';

/* `specs` asks for the six vehicle facts as a written line. A print document that
   draws the icon grid passes false so the same six facts are not said twice;
   every text document — the emailed voucher, the reconfirmation — leaves it on,
   because a mailto body cannot draw a gear. */
export const voucherDetailLines = (sv, { specs = true } = {}) => {
  const cat = sv.category || '';
  const lines = ['Confirmation Status: OK'];
  const confirmationNumber = (sv.confirmationNumber || '').trim();
  if (confirmationNumber) lines.push(`Confirmation Number: ${confirmationNumber}`);

  if (sv.rental) {
    /* The hire answers for itself: which car, out of which yard, for how many
       24-hour blocks. The line's own copy of the contract is the only place the
       pick-up and return exist, so the voucher reads them from there rather than
       from the generic time field a transfer uses. */
    const r = sv.rental;
    const vehicle = rentalVehicleLabel(r);
    if (vehicle) lines.push(`Vehicle type: ${vehicle}`);
    if (isRentalFeeLine(r)) {
      lines.push('Contract fee for the hire agreement above');
    } else {
      const hireWindow = rentalWindowLabel(r.pickupAt, r.returnAt);
      if (hireWindow) lines.push(`Collected / returned: ${hireWindow}`);
      const length = rentalDaysLabel(r.rentalDays);
      if (length) lines.push(`Length of hire: ${length}`);
      const share = r.dayShare;
      if (share && Number(share.dayCount) > 1) {
        lines.push(`Billing block: ${share.ordinal} of ${share.dayCount}`);
      }
      if (r.pickupLocation) lines.push(`Pick up location: ${r.pickupLocation}`);
      if (r.returnLocation) lines.push(`Return location: ${r.returnLocation}`);
      lines.push(r.kmsUnlimited !== false ? 'Mileage: Unlimited km' : `Mileage: ${Number(r.kmsIncluded) || 0} km included`);
      if (specs) {
        const specLine = carSpecText(r);
        if (specLine) lines.push(specLine);
      }
    }
  } else if (/transfers?/i.test(cat)) {
    const flight = (sv.flightNumber || '').trim();
    if (flight) lines.push(`Flight number: ${flight}`);
    const flightTime = (sv.flightTime || '').trim();
    if (flightTime) lines.push(`Flight departure / arrival time: ${flightTime}`);
    const time = (sv.time || '').trim();
    if (time) lines.push(`Pick up time: ${time}`);
    const vehicle = (sv.vehicleType || '').trim();
    if (vehicle) lines.push(`Vehicle type: ${vehicle}`);
    if (sv.capacity !== '' && sv.capacity !== null && sv.capacity !== undefined) {
      lines.push(`Capacity: ${sv.capacity}`);
    }
  } else if (/transport/i.test(cat)) {
    /* A hired vehicle has no flight to meet, so the voucher carries the pick-up,
       the vehicle and how many seats were booked. */
    const time = (sv.time || sv.startTime || '').trim();
    if (time) lines.push(`Pick up time: ${time}`);
    const vehicle = (sv.vehicleType || '').trim();
    if (vehicle) lines.push(`Vehicle type: ${vehicle}`);
    if (sv.capacity !== '' && sv.capacity !== null && sv.capacity !== undefined) {
      lines.push(`Capacity: ${sv.capacity}`);
    }
  } else if (/accommodation/i.test(cat)) {
    /* Hotel grade, when the property has one, so the voucher and the client's
       itinerary describe the hotel the same way. */
    if (starLabel(sv.supplierStar)) lines.push(`Star grading: ${starLabel(sv.supplierStar)}`);
    const room = allocatedRoomTypeLabel(sv);
    if (room) lines.push(`Room type: ${room}`);
    if (sv.maxOccupancy !== '' && sv.maxOccupancy !== null && sv.maxOccupancy !== undefined) {
      lines.push(`Max occupancy: ${sv.maxOccupancy}`);
    }
    const meal = (sv.mealPlan || '').trim();
    if (meal) lines.push(`Meal plan: ${meal}`);
    const checkIn = (sv.checkInTime || '').trim();
    if (checkIn) lines.push(`Check-in time: ${checkIn}`);
    const checkOut = (sv.checkOutTime || '').trim();
    if (checkOut) lines.push(`Check-out time: ${checkOut}`);
  } else if (/activities?|tours?|excursions?/i.test(cat)) {
    const vehicle = (sv.vehicleType || '').trim();
    if (vehicle) lines.push(`Vehicle type: ${vehicle}`);
    if (sv.maxOccupancy !== '' && sv.maxOccupancy !== null && sv.maxOccupancy !== undefined) {
      lines.push(`Max occupancy: ${sv.maxOccupancy}`);
    }
    const pickupTime = (sv.startTime || sv.time || '').trim();
    if (pickupTime) lines.push(`Pick up time: ${pickupTime}`);
    const endTime = (sv.endTime || '').trim();
    if (endTime) lines.push(`End time: ${endTime}`);
  } else if (/flights?|charter/i.test(cat)) {
    const flight = (sv.flightNumber || '').trim();
    if (flight) lines.push(`Flight number: ${flight}`);
    const flightTime = (sv.flightTime || sv.time || '').trim();
    if (flightTime) lines.push(`Flight departure / arrival time: ${flightTime}`);
  } else if (/meals?|dinner|lunch|breakfast/i.test(cat)) {
    const startTime = (sv.startTime || sv.time || '').trim();
    if (startTime) lines.push(`Start time: ${startTime}`);
  } else {
    const time = (sv.time || '').trim();
    if (time) lines.push(`Time: ${time}`);
  }

  /* The crew place this line buys is broken out for the supplier even though the
     party pays for it inside its own fare, so the booking still asks for the seat. */
  const crew = crewShareOn(sv);
  if (crew) {
    const currency = String(sv.currencyCode || sv.currency_code || '').toUpperCase();
    lines.push(`${crew.label}: ${currency ? `${currency} ` : ''}${Number(crew.fare).toFixed(2)}${crew.heads > 1 ? ` × ${crew.heads}` : ''}, shared by ${Math.max(1, Number(crew.divisor) || 1)}`);
  }

  const notes = (sv.notes || '').trim();
  if (notes) lines.push(`Notes: ${notes}`);
  return lines;
};
