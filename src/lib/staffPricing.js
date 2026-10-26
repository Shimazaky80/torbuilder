/* Staff / traveller role helpers and share context.
 *
 * Tour Guide and Tour Leader have special rules for counting:
 * - Tour Guide is added to the traveller list but NEVER counted in guide expense splits
 *   (guide fees/meals/overnight split by travellers + tour leaders only)
 * - Tour Leader is in the traveller list but NEVER counted in TL own room splits
 *   (TL own room costs split by paying clients only)
 * - Staff rooms (guide/driver/tour_guide/tour_leader own rooms) are never counted
 *   towards client rooms booked for TL discount threshold
 */

export const TRAVELLER_ROLES = ['client', 'tour_leader', 'tour_guide'];

export const normaliseRole = (role) => {
  const r = String(role || '').trim().toLowerCase();
  if (r === 'tour_leader' || r === 'tourleader' || r === 'leader') return 'tour_leader';
  if (r === 'tour_guide' || r === 'tourguide' || r === 'guide') return 'tour_guide';
  if (r === 'driver') return 'driver';
  if (r === 'client') return 'client';
  return 'client';
};

export const payingClientCount = (travellers = []) => {
  const list = Array.isArray(travellers) ? travellers : [];
  return list.filter((t) => normaliseRole(t?.role) === 'client').length;
};

export const tourLeaderCount = (travellers = []) => {
  const list = Array.isArray(travellers) ? travellers : [];
  return list.filter((t) => normaliseRole(t?.role) === 'tour_leader').length;
};

export const tourGuideCount = (travellers = []) => {
  const list = Array.isArray(travellers) ? travellers : [];
  return list.filter((t) => normaliseRole(t?.role) === 'tour_guide').length;
};

// Travellers + Tour Leaders only - used for guide expenses split
// Tour Guide is EXCLUDED even though they're in the traveller list
export const travellersPlusTlCount = (travellers = []) => {
  const list = Array.isArray(travellers) ? travellers : [];
  return list.filter((t) => {
    const r = normaliseRole(t?.role);
    return r === 'client' || r === 'tour_leader';
  }).length;
};

// Rooms allocated to client group only - excludes staff rooms
export const clientRoomsBooked = (allocations = []) => {
  const list = Array.isArray(allocations) ? allocations : [];
  return list.filter((rm) => {
    if (!rm) return false;
    // staff rooms never count
    if (rm.roomType === 'staff' || rm.isStaffRoom === true) return false;
    if (rm.staffRole) return false;
    const occs = Array.isArray(rm.allocatedTravellers) ? rm.allocatedTravellers : [];
    if (occs.some((t) => {
      const r = normaliseRole(t?.role);
      return r === 'tour_guide' || r === 'driver';
    })) {
      return false;
    }
    if (occs.length === 1 && normaliseRole(occs[0]?.role) === 'tour_leader') {
      return false;
    }
    return true;
  }).length;
};

export const buildShareContext = ({ travellers = [], allocations = [] } = {}) => {
  const payingClients = payingClientCount(travellers);
  const tourLeaders = tourLeaderCount(travellers);
  const tourGuides = tourGuideCount(travellers);
  const travellersPlusTl = travellersPlusTlCount(travellers);
  const clientRooms = clientRoomsBooked(allocations);

  return {
    payingClients,
    tourLeaders,
    tourGuides,
    travellersPlusTl,
    clientRoomsBooked: clientRooms,
    // Backwards compatible fallbacks
    paxCount: payingClients > 0 ? payingClients : Math.max(1, (Array.isArray(travellers) ? travellers.length : 1))
  };
};

export default {
  TRAVELLER_ROLES,
  normaliseRole,
  payingClientCount,
  tourLeaderCount,
  tourGuideCount,
  travellersPlusTlCount,
  clientRoomsBooked,
  buildShareContext
};
