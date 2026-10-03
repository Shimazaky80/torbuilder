/* Per-category supplier voucher details shared by preview, email, and print. */
export const voucherDetailLines = (sv) => {
  const cat = sv.category || '';
  const lines = ['Confirmation Status: OK'];
  const confirmationNumber = (sv.confirmationNumber || '').trim();
  if (confirmationNumber) lines.push(`Confirmation Number: ${confirmationNumber}`);

  if (/transfers?/i.test(cat)) {
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
  } else if (/accommodation/i.test(cat)) {
    const room = (sv.roomType || '').trim();
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

  const notes = (sv.notes || '').trim();
  if (notes) lines.push(`Notes: ${notes}`);
  return lines;
};
