import React, { useState, useMemo } from 'react';
import {
  Users,
  BedDouble,
  Plus,
  Trash2,
  CheckCircle2,
  AlertTriangle,
  X,
  UserCheck,
  ArrowRight
} from 'lucide-react';
import {
  isAdultTraveller,
  calculateRoomCharges,
  normaliseTravellerRole
} from '../lib/roomAllocationHelper';
import { roomTypesOf, roomTypeOfAllocation } from '../lib/roomTypes';
import { taxWordOf } from '../lib/invoiceDoc';
import './RoomAllocationModal.css';

/* Saved allocations are matched back to the live traveller objects so the
   roster shows the same person the itinerary knows, even after a reload. */
function roomsFromItem(item, travellersList) {  if (!Array.isArray(item?.roomAllocations) || item.roomAllocations.length === 0) return [];
  return item.roomAllocations.map((rm, idx) => {
    const occs = (rm.allocatedTravellers || []).map((t) => {
      const matched = travellersList.find(
        (tl) => tl.id === t.id || (tl.name === t.name && tl.surname === t.surname)
      );
      return matched || t;
    });
    return {
      ...rm,
      roomId: rm.roomId || idx + 1,
      allocatedTravellers: occs
    };
  });
}

const occupantCounts = (room) => {
  const occupants = Array.isArray(room?.allocatedTravellers) ? room.allocatedTravellers : [];
  const adults = occupants.filter(isAdultTraveller).length;
  return { total: occupants.length, adults, children: occupants.length - adults };
};

/* A crew room is marked by its role, not by one of the property's guest room
   types, and its role marker is what drives the staff pricing rules. The type
   picker must never read 'staff' as a room name or overwrite it. */
const isCrewRoom = (room) => String(room?.roomType || room?.room_type || '').trim().toLowerCase() === 'staff'
  || room?.isStaffRoom === true
  || !!String(room?.staffRole || room?.staff_role || '').trim();

/* The beds one room offers. Each room type states its own capacity, so a night
   that mixes a Family Suite with Standard Rooms cannot judge both against the
   capacity of whichever room the line was sold at. */
const roomCapsOf = (room, choices, fallback) => {
  const named = String(room?.roomType || room?.room_type || '').trim();
  const choice = named && !isCrewRoom(room)
    ? choices.find((rt) => rt.name.toLowerCase() === named.toLowerCase())
    : null;
  if (!choice) return fallback;
  const maxOccupancy = Math.max(1, parseInt(choice.maxOccupancy, 10) || fallback.maxOccupancy);
  const statedAdults = parseInt(choice.maxAdults, 10);
  const statedChildren = parseInt(choice.maxChildren, 10);
  return {
    maxOccupancy,
    maxAdults: Number.isFinite(statedAdults) && statedAdults > 0
      ? Math.min(statedAdults, maxOccupancy)
      : fallback.maxAdults,
    maxChildren: Number.isFinite(statedChildren) && statedChildren >= 0
      ? statedChildren
      : fallback.maxChildren
  };
};

const capsLabel = ({ maxOccupancy, maxAdults, maxChildren }) => {
  const parts = [];
  if (maxAdults !== null && maxAdults < maxOccupancy) {
    parts.push(`${maxAdults} adult${maxAdults === 1 ? '' : 's'}`);
  }
  if (maxChildren === 0) parts.push('adults only');
  else if (maxChildren !== null) parts.push(`${maxChildren} child${maxChildren === 1 ? '' : 'ren'}`);
  return parts.length ? `${parts.join(' + ')} · ${maxOccupancy} pax` : `${maxOccupancy} pax`;
};

const roomIsOverCapacity = (room, maxOccupancy, maxAdults, maxChildren) => {
  const counts = occupantCounts(room);
  return counts.total > maxOccupancy
    || (maxAdults !== null && counts.adults > maxAdults)
    || (maxChildren !== null && counts.children > maxChildren);
};

/* Why this traveller cannot join this room, or '' when they fit. */
const roomCapacityBlock = (roomId, room, traveller, maxOccupancy, maxAdults, maxChildren) => {
  const counts = occupantCounts(room);
  if (counts.total >= maxOccupancy) return `Room ${roomId} is full (${maxOccupancy} max)`;
  if (isAdultTraveller(traveller) && maxAdults !== null && counts.adults >= maxAdults) {
    return `Room ${roomId} has no adult bed left (${maxAdults} adult${maxAdults === 1 ? '' : 's'} max)`;
  }
  if (!isAdultTraveller(traveller) && maxChildren !== null && counts.children >= maxChildren) {
    return `Room ${roomId} has no child bed left (${maxChildren} child${maxChildren === 1 ? '' : 'ren'} max)`;
  }
  return '';
};

export default function RoomAllocationModal({
  isOpen,
  onClose,
  onCancel,
  onSave,
  item,
  itineraryTravellers = [],
  beddedElsewhere = [],
  currencyCode = 'ZAR',
  markupPct = 0
}) {
  /* Hooks first, early return last: bailing out before them would change the
     hook count between renders. The caller also mounts this only while open. */
  const open = !!isOpen && !!item;
  /* Cancelling is distinct from closing after a save: the builder uses it to
     discard an accommodation line that was only added to open this dialog. */
  const requestCancel = onCancel || onClose;
  const maxOccupancy = Math.max(1, parseInt(item?.maxOccupancy ?? item?.max_occupancy, 10) || 2);
  /* A room contract states beds as adults and children, not just a total: a
     three-bed room that takes two adults may not take three adults. A cap is
     null when the line predates room-level capacity, and - for children - when
     the property does not tell adults and children apart at all. */
  const statedAdults = parseInt(item?.maxAdults, 10);
  const maxAdults = Number.isFinite(statedAdults) && statedAdults > 0
    ? Math.min(statedAdults, maxOccupancy)
    : null;
  const statedChildren = parseInt(item?.maxChildren, 10);
  const maxChildren = Number.isFinite(statedChildren) && statedChildren >= 0
    ? statedChildren
    : null;
  /* Only the caps that restrict the room are named. An adult cap equal to its
     beds restricts nothing, and a property that does not split its guests by
     age states no child cap, so together they read as the plain total rather
     than as "adults only" - which would refuse a family the villa takes. */
  const capacityParts = [];
  if (maxAdults !== null && maxAdults < maxOccupancy) {
    capacityParts.push(`${maxAdults} adult${maxAdults === 1 ? '' : 's'}`);
  }
  if (maxChildren === 0) capacityParts.push('adults only');
  else if (maxChildren !== null) capacityParts.push(`${maxChildren} child${maxChildren === 1 ? '' : 'ren'}`);
  const capacityLabel = capacityParts.length
    ? `${capacityParts.join(' + ')} · ${maxOccupancy} pax`
    : `${maxOccupancy} pax`;
  const lineCaps = useMemo(() => ({ maxOccupancy, maxAdults, maxChildren }), [maxOccupancy, maxAdults, maxChildren]);
  /* The property's own room types. A night can mix them - one Family Suite and
     two Standard Rooms - and the allocation is what knows which guest sleeps
     where, so each room carries its own type. With only one type there is
     nothing to choose and the line's sold type already says it all. */
  const roomTypeChoices = useMemo(() => roomTypesOf(item).filter((rt) => rt.name), [item]);
  const typesToChoose = roomTypeChoices.length > 1;
  const soldRoomType = String(item?.roomType || item?.room_type || '').trim();
  const travellersList = useMemo(() => {
    if (Array.isArray(itineraryTravellers) && itineraryTravellers.length > 0) {
      return itineraryTravellers.map((t, idx) => ({
        id: t.id || `trav_${idx}_${t.name || 'Pax'}`,
        name: t.name || `Traveller ${idx + 1}`,
        surname: t.surname || '',
        age: t.age ?? 30,
        type: t.type || (isAdultTraveller(t) ? 'Adult' : 'Child'),
        role: normaliseTravellerRole(t?.role)
      }));
    }
    return [{ id: 'trav_default_1', name: 'Lead Traveller', surname: '', age: 30, type: 'Adult', role: 'client' }];
  }, [itineraryTravellers]);

  /* Guests already holding a bed in another included property on this night.
     A party split across two properties only has to be bedded here once, so
     these travellers are neither demanded nor allowed to be added twice. */
  const allocatedElsewhereIds = useMemo(() => {
    const set = new Set();
    (Array.isArray(beddedElsewhere) ? beddedElsewhere : []).forEach((t) => {
      const id = t?.id || `trav_${t?.name || ''}`;
      set.add(id);
      set.add(`${t?.name || ''}|${t?.surname || ''}`);
    });
    return set;
  }, [beddedElsewhere]);

  const isBeddedElsewhere = useMemo(() => {
    const set = new Set();
    travellersList.forEach((t) => {
      if (allocatedElsewhereIds.has(t.id) || allocatedElsewhereIds.has(`${t.name}|${t.surname}`)) set.add(t.id);
    });
    return set;
  }, [travellersList, allocatedElsewhereIds]);

  const requiredTravellers = useMemo(
    () => travellersList.filter((t) => !isBeddedElsewhere.has(t.id)),
    [travellersList, isBeddedElsewhere]
  );

  /* The caller mounts this dialog only while it is open, so the saved
     allocations are read once as initial state rather than synced by effect. */
  const initialRooms = useMemo(() => roomsFromItem(item, travellersList), [item, travellersList]);
  const [rooms, setRooms] = useState(initialRooms);
  /* One room is always the drop target. Rather than every traveller carrying
     their own room dropdown, the operator selects a room once and then moves
     people into it with the arrow button or by dragging them onto the card. */
  const [selectedRoomId, setSelectedRoomId] = useState(initialRooms[0]?.roomId ?? null);
  /* Multiple travellers can be ticked or shift-clicked and moved in one go;
     the arrow button on a row still moves just that traveller. */
  const [selectedTravellerIds, setSelectedTravellerIds] = useState([]);
  const [selectionAnchorId, setSelectionAnchorId] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [draggingId, setDraggingId] = useState('');
  const [dragOverRoomId, setDragOverRoomId] = useState(null);
  const [moveNotice, setMoveNotice] = useState('');

  // Compute unallocated travellers
  const allocatedIds = useMemo(() => {
    const set = new Set();
    rooms.forEach((rm) => {
      (rm.allocatedTravellers || []).forEach((t) => set.add(t.id));
    });
    return set;
  }, [rooms]);

  /* Only guests not already allocated to another included property can be
     assigned here. This drives the traveller list and room selectors. */
  const unallocatedTravellers = useMemo(() => {
    return travellersList.filter(
      (t) => !allocatedIds.has(t.id) && !isBeddedElsewhere.has(t.id)
    );
  }, [travellersList, allocatedIds, isBeddedElsewhere]);

  /* This property is responsible only for the travelers not bedded elsewhere. */
  const outstandingRequired = useMemo(() => {
    return requiredTravellers.filter((t) => !allocatedIds.has(t.id));
  }, [requiredTravellers, allocatedIds]);

  // Travellers double-booked: held here and in another included property.
  const doubleBooked = useMemo(() => {
    return travellersList.filter((t) => allocatedIds.has(t.id) && isBeddedElsewhere.has(t.id));
  }, [travellersList, allocatedIds, isBeddedElsewhere]);

  // Check over capacity rooms
  const overCapacityRooms = useMemo(() => {
    return rooms.filter((rm) => {
      const caps = roomCapsOf(rm, roomTypeChoices, lineCaps);
      return roomIsOverCapacity(rm, caps.maxOccupancy, caps.maxAdults, caps.maxChildren);
    });
  }, [rooms, roomTypeChoices, lineCaps]);

  /* A group split starts here: the operator deliberately houses only part of
     the party in this property and adds the next property for the remainder.
     Until that second property exists the night is legitimately incomplete,
     so a partial allocation has to be confirmable — otherwise the split can
     never be started, because a full allocation leaves nobody to split off. */
  const [splittingGroup, setSplittingGroup] = useState(false);
  const splitPending = !item?.isOptional && splittingGroup && outstandingRequired.length > 0;

  // Financial calculations
  const financialSummary = useMemo(() => {
    return calculateRoomCharges(item, rooms, currencyCode, markupPct);
  }, [item, rooms, currencyCode, markupPct]);

  /* A villa sold on an occupancy ladder has no price for every party size, and a
     room the ladder does not cover is not a cheaper room - it is a room this party
     cannot be housed in. The dialog refuses the allocation instead of saving a R0
     night, and says which room and which size. */
  const unpricedRooms = useMemo(
    () => financialSummary.unpricedRooms || [],
    [financialSummary]
  );

  const isValid = useMemo(() => {
    const problemsOnly = overCapacityRooms.length > 0 || doubleBooked.length > 0
      || unpricedRooms.length > 0;
    if (splitPending) return !problemsOnly && rooms.length > 0;
    /* Judged on what THIS property owes, not on the whole assign pool: a split
       never has to re-house a sibling's beds, and an option never has to house
       anything at all beyond what it was asked to quote. */
    return !problemsOnly && outstandingRequired.length === 0;
  }, [splitPending, overCapacityRooms, doubleBooked, outstandingRequired, rooms, unpricedRooms]);

  /* Which room each traveller currently sleeps in, for the status pill and for
     ordering the roster: unallocated first, then by room, then guests another
     property already houses. */
  const roomByTravellerId = useMemo(() => {
    const map = new Map();
    rooms.forEach((rm) => {
      (rm.allocatedTravellers || []).forEach((t) => map.set(t.id, rm.roomId));
    });
    return map;
  }, [rooms]);

  const activeRoom = useMemo(() => {
    const selected = rooms.find((rm) => rm.roomId === selectedRoomId);
    if (selected) return selected;
    return rooms.find((rm) => {
      const caps = roomCapsOf(rm, roomTypeChoices, lineCaps);
      return (rm.allocatedTravellers || []).length < caps.maxOccupancy;
    }) || rooms[0] || null;
  }, [rooms, selectedRoomId, roomTypeChoices, lineCaps]);
  const activeRoomId = activeRoom?.roomId ?? null;
  const activeRoomCaps = roomCapsOf(activeRoom, roomTypeChoices, lineCaps);
  const activeRoomOccupants = activeRoom ? (activeRoom.allocatedTravellers || []).length : 0;
  const activeRoomFull = !!activeRoom && activeRoomOccupants >= activeRoomCaps.maxOccupancy;

  const orderedTravellers = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    const matches = term
      ? travellersList.filter((t) => `${t.name} ${t.surname}`.toLowerCase().includes(term))
      : travellersList;
    const rank = (t) => {
      if (isBeddedElsewhere.has(t.id)) return 2;
      return roomByTravellerId.has(t.id) ? 1 : 0;
    };
    return [...matches].sort((a, b) => {
      const ra = rank(a);
      const rb = rank(b);
      if (ra !== rb) return ra - rb;
      if (ra === 1) {
        return (roomByTravellerId.get(a.id) || 0) - (roomByTravellerId.get(b.id) || 0);
      }
      return 0;
    });
  }, [travellersList, searchTerm, isBeddedElsewhere, roomByTravellerId]);

  const draggingTraveller = useMemo(
    () => travellersList.find((t) => t.id === draggingId) || null,
    [travellersList, draggingId]
  );
  const rosterIsDropTarget = !!draggingId && roomByTravellerId.has(draggingId);

  const selectedIdSet = useMemo(() => new Set(selectedTravellerIds), [selectedTravellerIds]);
  const selectedMovableTravellers = useMemo(
    () => orderedTravellers.filter((t) => selectedIdSet.has(t.id) && !isBeddedElsewhere.has(t.id)),
    [orderedTravellers, selectedIdSet, isBeddedElsewhere]
  );

  const toggleTravellerSelection = (travellerId, { range = false } = {}) => {
    if (isBeddedElsewhere.has(travellerId)) return;
    if (range && selectionAnchorId && selectionAnchorId !== travellerId) {
      const visibleIds = orderedTravellers
        .filter((t) => !isBeddedElsewhere.has(t.id))
        .map((t) => t.id);
      const from = visibleIds.indexOf(selectionAnchorId);
      const to = visibleIds.indexOf(travellerId);
      if (from !== -1 && to !== -1) {
        const [lo, hi] = from < to ? [from, to] : [to, from];
        const rangeIds = visibleIds.slice(lo, hi + 1);
        setSelectedTravellerIds((prev) => [...new Set([...prev, ...rangeIds])]);
        return;
      }
    }
    setSelectedTravellerIds((prev) => (
      prev.includes(travellerId) ? prev.filter((id) => id !== travellerId) : [...prev, travellerId]
    ));
    setSelectionAnchorId(travellerId);
  };

  const clearSelection = () => {
    setSelectedTravellerIds([]);
    setSelectionAnchorId('');
  };

  const handleSelectAllUnallocated = () => {
    /* The whole party, not just what the search box currently shows, so the
       label cannot mean two different things depending on the filter. */
    const ids = travellersList
      .filter((t) => !roomByTravellerId.has(t.id) && !isBeddedElsewhere.has(t.id))
      .map((t) => t.id);
    setSelectedTravellerIds(ids);
    setSelectionAnchorId(ids[ids.length - 1] || '');
    setMoveNotice(ids.length ? '' : 'No unallocated travellers to select.');
  };

  const moveBlockedReason = (traveller, targetRoomId = activeRoomId) => {
    const target = rooms.find((rm) => rm.roomId === targetRoomId);
    if (isBeddedElsewhere.has(traveller.id)) return 'Already has a bed in another property on this night';
    if (!target) return 'Add or select a room first';
    const occs = target.allocatedTravellers || [];
    if (occs.some((t) => t.id === traveller.id)) return `Already in Room ${target.roomId}`;
    const caps = roomCapsOf(target, roomTypeChoices, lineCaps);
    return roomCapacityBlock(target.roomId, target, traveller, caps.maxOccupancy, caps.maxAdults, caps.maxChildren);
  };

  const moveTraveller = (traveller, targetRoomId) => {
    if (!traveller) return false;
    const blocked = moveBlockedReason(traveller, targetRoomId);
    if (blocked) {
      /* Being in the target room is a no-op; anything else is worth saying. */
      if (!blocked.startsWith('Already in Room')) setMoveNotice(blocked);
      return false;
    }
    setRooms((prev) =>
      prev.map((rm) => {
        const filtered = (rm.allocatedTravellers || []).filter((t) => t.id !== traveller.id);
        if (rm.roomId === targetRoomId) {
          return { ...rm, allocatedTravellers: [...filtered, traveller] };
        }
        return { ...rm, allocatedTravellers: filtered };
      })
    );
    setMoveNotice('');
    return true;
  };

  /* Bulk move fills the selected room in roster order. Anything that does not
     fit stays unallocated and is reported, rather than half-applying silently. */
  const handleMoveSelected = () => {
    if (!activeRoom) {
      setMoveNotice('Add or select a room first.');
      return;
    }
    const targetRoomId = activeRoom.roomId;
    const targetCaps = activeRoomCaps;
    const movers = selectedMovableTravellers.filter(
      (t) => roomByTravellerId.get(t.id) !== targetRoomId
    );
    if (!movers.length) {
      setMoveNotice('Selected traveller(s) are already in this room.');
      return;
    }
    /* Fill by bed type: three adults must not be crammed into a room that
       takes two adults just because it has three beds. */
    const accepted = [];
    const rejected = [];
    movers.forEach((traveller) => {
      const roomAfter = { ...activeRoom, allocatedTravellers: [...(activeRoom.allocatedTravellers || []), ...accepted] };
      const blocked = roomCapacityBlock(targetRoomId, roomAfter, traveller, targetCaps.maxOccupancy, targetCaps.maxAdults, targetCaps.maxChildren);
      if (blocked) rejected.push(traveller);
      else accepted.push(traveller);
    });
    setRooms((prev) =>
      prev.map((rm) => {
        const kept = (rm.allocatedTravellers || []).filter(
          (t) => !accepted.some((a) => a.id === t.id)
        );
        if (rm.roomId === targetRoomId) {
          return { ...rm, allocatedTravellers: [...kept, ...accepted] };
        }
        return { ...rm, allocatedTravellers: kept };
      })
    );
    clearSelection();
    setMoveNotice(
      rejected.length
        ? `${rejected.length} traveller(s) not moved into Room ${targetRoomId} — it takes ${capsLabel(targetCaps)}.`
        : ''
    );
  };

  /* One click beds the next unallocated travellers in the selected room,
     stopping at whichever bed the contract runs out of first. */
  const handleAutoFillRoom = () => {
    if (!activeRoom) {
      setMoveNotice('Add or select a room first.');
      return;
    }
    const fillCaps = roomCapsOf(activeRoom, roomTypeChoices, lineCaps);
    const candidates = travellersList.filter(
      (t) => !roomByTravellerId.has(t.id) && !isBeddedElsewhere.has(t.id)
    );
    const chosen = [];
    let firstBlocked = '';
    candidates.forEach((traveller) => {
      const roomAfter = { ...activeRoom, allocatedTravellers: [...(activeRoom.allocatedTravellers || []), ...chosen] };
      const blocked = roomCapacityBlock(activeRoom.roomId, roomAfter, traveller, fillCaps.maxOccupancy, fillCaps.maxAdults, fillCaps.maxChildren);
      if (blocked) firstBlocked = firstBlocked || blocked;
      else chosen.push(traveller);
    });
    if (!chosen.length) {
      setMoveNotice(firstBlocked || 'No unallocated travellers left to add.');
      return;
    }
    setRooms((prev) =>
      prev.map((rm) => (
        rm.roomId === activeRoom.roomId
          ? { ...rm, allocatedTravellers: [...(rm.allocatedTravellers || []), ...chosen] }
          : rm
      ))
    );
    clearSelection();
    setMoveNotice(firstBlocked ? `Room ${activeRoom.roomId} takes ${capsLabel(fillCaps)}.` : '');
  };

  // Handlers
  const handleAddRoom = () => {
    const nextId = rooms.length + 1;
    setRooms((prev) => [
      ...prev,
      {
        roomId: prev.length + 1,
        allocatedTravellers: [],
        /* A new room starts as the type this line was sold at; the picker on the
           card is what turns it into the Family Suite beside the Standard Rooms. */
        ...(typesToChoose && soldRoomType ? { roomType: soldRoomType } : {})
      }
    ]);
    /* Adding a room is almost always followed by filling it. */
    setSelectedRoomId(nextId);
    setMoveNotice('');
  };

  const handleRoomTypeChange = (roomId, name) => {
    const choice = roomTypeChoices.find((rt) => rt.name === name) || null;
    setRooms((prev) => prev.map((rm) => (
      rm.roomId === roomId
        ? { ...rm, roomType: name || '', roomTypeId: choice?.id || null }
        : rm
    )));
    /* A smaller room type can leave the occupants over its beds, so say so
       instead of letting the alert look like a move that never happened. */
    const after = rooms.find((rm) => rm.roomId === roomId);
    const caps = roomCapsOf({ ...after, roomType: name || '' }, roomTypeChoices, lineCaps);
    setMoveNotice(roomIsOverCapacity(after, caps.maxOccupancy, caps.maxAdults, caps.maxChildren)
      ? `Room ${roomId} as ${name || 'the sold room'} takes ${capsLabel(caps)}, which the travellers in it do not fit.`
      : '');
  };

  const handleRemoveRoom = (roomId) => {
    if (rooms.length <= 1) return;
    const remaining = rooms
      .filter((r) => r.roomId !== roomId)
      .map((r, idx) => ({ ...r, roomId: idx + 1 }));
    setRooms(remaining);
    if (selectedRoomId === roomId) setSelectedRoomId(remaining[0]?.roomId ?? null);
    setMoveNotice('');
  };

  const handleUnassignTraveller = (travellerId, roomId) => {
    setRooms((prev) =>
      prev.map((rm) => {
        if (rm.roomId === roomId) {
          return {
            ...rm,
            allocatedTravellers: (rm.allocatedTravellers || []).filter((t) => t.id !== travellerId)
          };
        }
        return rm;
      })
    );
    setMoveNotice('');
  };

  const handleUnassignAnywhere = (travellerId) => {
    setRooms((prev) =>
      prev.map((rm) => ({
        ...rm,
        allocatedTravellers: (rm.allocatedTravellers || []).filter((t) => t.id !== travellerId)
      }))
    );
    setMoveNotice('');
  };

  const handleDragStart = (event, travellerId) => {
    event.dataTransfer.setData('text/plain', travellerId);
    event.dataTransfer.effectAllowed = 'move';
    setDraggingId(travellerId);
  };

  const handleDragEnd = () => {
    setDraggingId('');
    setDragOverRoomId(null);
  };

  const handleRoomDragOver = (event, roomId) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    if (dragOverRoomId !== roomId) setDragOverRoomId(roomId);
  };

  const handleRoomDragLeave = (event) => {
    if (!event.currentTarget.contains(event.relatedTarget)) setDragOverRoomId(null);
  };

  const handleRoomDrop = (event, roomId) => {
    event.preventDefault();
    event.stopPropagation();
    const travellerId = event.dataTransfer.getData('text/plain') || draggingId;
    setDragOverRoomId(null);
    setDraggingId('');
    const traveller = travellersList.find((t) => t.id === travellerId);
    if (!traveller) return;
    setSelectedRoomId(roomId);
    moveTraveller(traveller, roomId);
  };

  const handleRosterDragOver = (event) => {
    if (!rosterIsDropTarget) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  };

  const handleRosterDrop = (event) => {
    const travellerId = event.dataTransfer.getData('text/plain') || draggingId;
    if (!travellerId) return;
    event.preventDefault();
    setDraggingId('');
    setDragOverRoomId(null);
    handleUnassignAnywhere(travellerId);
  };

  const occupantSummary = `${rooms.length} Room(s), ${requiredTravellers.length} Pax`;

  const handleConfirm = () => {
    if (!isValid) return;
    onSave({
      roomAllocations: rooms,
      calculatedBuy: financialSummary.totalBuy,
      calculatedSell: financialSummary.totalSell,
      numRooms: rooms.length,
      occupantSummary,
      splitPending
    });
    onClose();
  };

  if (!open) return null;

  return (
    <div className="room-allocation-modal-overlay">
      <div className="room-allocation-modal-shell">
        
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50/80">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#0d7478]/10 text-[#0d7478] flex items-center justify-center font-bold">
              <BedDouble size={22} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-bold text-slate-900">Room & Traveller Allocation</h2>
                <span className="px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-teal-50 text-[#0d7478] border border-teal-200">
                  Contract Capacity: {capacityLabel} / Room
                </span>
              </div>
              <p className="text-xs text-slate-500 font-medium mt-0.5">
                {item.name || item.title || 'Accommodation Service'} {(item.roomType || item.room_type) ? `(${item.roomType || item.room_type})` : ''}
              </p>
              {/* Which matrix the figures below came from. The travel dates pick
                  the season, so an operator can tell at a glance that the room
                  rate matches the trip rather than reconciling it by hand. */}
              {item._seasonName && (
                <p className="text-[11px] text-[#0d7478] font-semibold mt-0.5">
                  Season: {item._seasonName}
                  {item._seasonFrom && item._seasonTo ? ` (${item._seasonFrom} – ${item._seasonTo})` : ''}
                  {item._seasonStatus === 'protected'
                    ? ' — closest prior season, Pricing Protection applied'
                    : item._seasonStatus === 'stale'
                      ? ' — closest prior season, no Pricing Protection percentage set, so these are its own figures'
                      : ''}
                </p>
              )}
            </div>
          </div>
          <button
            onClick={requestCancel}
            className="p-2 text-slate-400 hover:text-slate-700 rounded-lg hover:bg-slate-200/60 transition"
          >
            <X size={18} />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-6 overflow-y-auto flex-1 space-y-5 bg-white">

          {/* Top Control Bar */}
          <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-50 p-3.5 rounded-xl border border-slate-200">
            <div className="flex items-center gap-4 text-xs font-semibold text-slate-700">
              <div className="flex items-center gap-1.5">
                <Users size={16} className="text-[#0d7478]" />
                <span>Itinerary Travellers: <strong className="text-slate-900 font-bold">{travellersList.length} Pax</strong></span>
              </div>
              {isBeddedElsewhere.size > 0 && (
                <>
                  <div className="h-4 w-px bg-slate-300" />
                  <div>
                    Bedded Elsewhere: <strong className="text-slate-900 font-bold">{isBeddedElsewhere.size} Pax</strong>
                  </div>
                  <div className="h-4 w-px bg-slate-300" />
                  <div>
                    To Allocate Here: <strong className="text-slate-900 font-bold">{requiredTravellers.length} Pax</strong>
                  </div>
                </>
              )}
              <div className="h-4 w-px bg-slate-300" />
              <div>
                Rooms Allocated: <strong className="text-slate-900 font-bold">{rooms.length} Room(s)</strong>
              </div>
              {outstandingRequired.length > 0 && (
                <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-amber-100 text-amber-800 border border-amber-300">
                  {outstandingRequired.length} Unallocated
                </span>
              )}
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleAddRoom}
                className="px-3 py-1.5 text-xs font-semibold bg-[#0d7478] hover:bg-[#0b6266] text-white rounded-lg transition inline-flex items-center gap-1.5 shadow-sm"
              >
                <Plus size={14} /> Add Room
              </button>
            </div>
          </div>

          {/* 2-Column Grid */}
          <div className="grid grid-cols-1 md:grid-cols-12 gap-5">

            {/* Left Column: Full traveller roster (4 cols). Every traveller is
                listed with their current room so a large party stays legible;
                the room is chosen once above, not per traveller. */}
            <div className="md:col-span-4 bg-slate-50 border border-slate-200 rounded-xl p-4 flex flex-col">
              <div className="room-alloc-roster-head">
                <h3 className="room-alloc-roster-title">
                  <Users size={15} className="text-[#0d7478]" />
                  Travellers
                </h3>
                <span className="room-alloc-count">
                  {travellersList.length} pax · {unallocatedTravellers.length} unallocated
                </span>
              </div>

              <div className={`room-alloc-target ${activeRoom ? '' : 'is-empty'}`}>
                <span className="room-alloc-target-text">
                  <ArrowRight size={13} />
                  {activeRoom
                    ? `Selected room: Room ${activeRoom.roomId}${roomTypeOfAllocation(activeRoom, item) ? ` · ${roomTypeOfAllocation(activeRoom, item)}` : ''} · ${activeRoomOccupants}/${activeRoomCaps.maxOccupancy}${activeRoomFull ? ' · full' : ''}`
                    : 'Add a room, then select it to move travellers in.'}
                </span>
                {activeRoom && (
                  <button
                    type="button"
                    className="room-alloc-autofill"
                    onClick={handleAutoFillRoom}
                    disabled={activeRoomFull || unallocatedTravellers.length === 0}
                    title="Fill this room with unallocated travellers"
                  >
                    Auto-fill
                  </button>
                )}
              </div>

              {isBeddedElsewhere.size > 0 && (
                <p className="room-alloc-help">
                  {isBeddedElsewhere.size} traveller{isBeddedElsewhere.size === 1 ? ' already has' : 's already have'} a bed in another property on this night and cannot be moved here.
                </p>
              )}

              <input
                type="search"
                className="room-alloc-search"
                placeholder="Search traveller..."
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                aria-label="Search travellers"
              />

              <div className="room-alloc-bulk">
                <span className="room-alloc-bulk-count">
                  {selectedTravellerIds.length > 0
                    ? `${selectedTravellerIds.length} selected`
                    : 'Select travellers to move together'}
                </span>
                <div className="room-alloc-bulk-actions">
                  <button
                    type="button"
                    className="room-alloc-bulk-all"
                    onClick={handleSelectAllUnallocated}
                    disabled={unallocatedTravellers.length === 0}
                  >
                    Select all unallocated
                  </button>
                  {selectedTravellerIds.length > 0 && (
                    <button
                      type="button"
                      className="room-alloc-bulk-move"
                      onClick={handleMoveSelected}
                      disabled={!activeRoom}
                    >
                      Move to Room {activeRoomId ?? '—'}
                    </button>
                  )}
                  {selectedTravellerIds.length > 0 && (
                    <button type="button" className="room-alloc-bulk-clear" onClick={clearSelection}>
                      Clear
                    </button>
                  )}
                </div>
              </div>

              {moveNotice && (
                <div className="room-alloc-notice" role="status">{moveNotice}</div>
              )}

              <div
                className={`room-alloc-roster ${rosterIsDropTarget ? 'is-drop-target' : ''}`}
                role="list"
                aria-label="Travellers"
                onDragOver={handleRosterDragOver}
                onDrop={handleRosterDrop}
              >
                {orderedTravellers.length === 0 ? (
                  <div className="room-alloc-empty" style={{ borderColor: '#e2e8f0', background: '#f8fafc', color: '#64748b' }}>
                    No traveller matches “{searchTerm.trim()}”.
                  </div>
                ) : orderedTravellers.map((tr) => {
                  const roomId = roomByTravellerId.get(tr.id);
                  const bedded = isBeddedElsewhere.has(tr.id);
                  const isSelected = selectedIdSet.has(tr.id);
                  const blockedReason = moveBlockedReason(tr);
                  const canMove = !blockedReason;
                  const initials = `${tr.name?.[0] || ''}${tr.surname?.[0] || ''}`.toUpperCase() || '?';
                  return (
                    <div
                      key={tr.id}
                      role="listitem"
                      tabIndex={0}
                      draggable={!bedded}
                      aria-label={`${tr.name} ${tr.surname}${bedded ? ', bedded in another property' : roomId ? `, Room ${roomId}` : ', unallocated'}`}
                      className={`room-alloc-traveller ${isSelected ? 'is-selected' : ''} ${roomId ? 'is-bedded' : ''} ${bedded ? 'is-other-property' : ''} ${draggingId === tr.id ? 'is-dragging' : ''}`}
                      onClick={(event) => toggleTravellerSelection(tr.id, { range: event.shiftKey })}
                      onDoubleClick={() => { if (canMove) moveTraveller(tr, activeRoomId); }}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault();
                          if (canMove) moveTraveller(tr, activeRoomId);
                        } else if (event.key === ' ') {
                          event.preventDefault();
                          toggleTravellerSelection(tr.id, { range: event.shiftKey });
                        }
                      }}
                      onDragStart={(event) => handleDragStart(event, tr.id)}
                      onDragEnd={handleDragEnd}
                    >
                      <input
                        type="checkbox"
                        className="room-alloc-check"
                        checked={isSelected}
                        disabled={bedded}
                        aria-label={`Select ${tr.name} ${tr.surname}`}
                        onChange={() => toggleTravellerSelection(tr.id)}
                        onClick={(event) => event.stopPropagation()}
                      />
                      <span className="room-alloc-avatar" aria-hidden="true">{initials}</span>
                      <span className="room-alloc-traveller-main">
                        <span className="room-alloc-traveller-name">{tr.name} {tr.surname}</span>
                        <span className="room-alloc-traveller-meta">Age {tr.age} · {isAdultTraveller(tr) ? 'Adult' : 'Child'}</span>
                      </span>
                      {bedded ? (
                        <span className="room-alloc-pill is-other">Other property</span>
                      ) : roomId ? (
                        <span className="room-alloc-pill is-bedded">Room {roomId}</span>
                      ) : (
                        <span className="room-alloc-pill is-unallocated">Unallocated</span>
                      )}
                      <button
                        type="button"
                        className="room-alloc-move"
                        disabled={!canMove}
                        title={blockedReason || `Move to Room ${activeRoomId}`}
                        aria-label={`Move ${tr.name} ${tr.surname} to Room ${activeRoomId ?? ''}`.trim()}
                        onClick={(event) => {
                          event.stopPropagation();
                          moveTraveller(tr, activeRoomId);
                        }}
                      >
                        <ArrowRight size={14} />
                      </button>
                    </div>
                  );
                })}
              </div>

              <p className="room-alloc-help">
                Tick or shift-click travellers to move them together, or use a row's arrow. Drag a traveller onto a room, or back here to unallocate.
              </p>
            </div>

            {/* Right Column: Rooms List (8 cols) */}
            <div className="md:col-span-8 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="font-bold text-xs uppercase tracking-wider text-slate-600 flex items-center gap-2">
                  <UserCheck size={15} className="text-[#0d7478]" />
                  Room Allocations
                </h3>
                <span className="text-xs text-slate-500 font-medium">
                  {typesToChoose
                    ? 'Each room is typed below — a night can mix this property’s room types'
                    : `Max ${capacityLabel} per Room`}
                </span>
              </div>

              <div className="space-y-3.5 max-h-[360px] overflow-y-auto pr-1">
                {rooms.length === 0 && (
                  <div className="room-alloc-empty" style={{ borderColor: '#e2e8f0', background: '#f8fafc', color: '#64748b' }}>
                    No rooms yet. Click “Add Room” to create the first one.
                  </div>
                )}
                {rooms.map((rm) => {
                  const occs = rm.allocatedTravellers || [];
                  const counts = occupantCounts(rm);
                  const roomCaps = roomCapsOf(rm, roomTypeChoices, lineCaps);
                  const isOver = roomIsOverCapacity(rm, roomCaps.maxOccupancy, roomCaps.maxAdults, roomCaps.maxChildren);
                  const isFull = counts.total >= roomCaps.maxOccupancy
                    || (roomCaps.maxAdults !== null && counts.adults >= roomCaps.maxAdults);
                  const isActive = rm.roomId === activeRoomId;
                  const isDropTarget = dragOverRoomId === rm.roomId;
                  const effectiveType = roomTypeOfAllocation(rm, item);
                  const roomCalc = financialSummary.rooms.find((r) => r.roomId === rm.roomId) || {};

                  return (
                    <div
                      key={rm.roomId}
                      className={`room-alloc-room ${isOver ? 'is-over' : ''} ${isActive ? 'is-active' : ''} ${isDropTarget ? 'is-drag-over' : ''}`}
                      onClick={() => { setSelectedRoomId(rm.roomId); setMoveNotice(''); }}
                      onDragOver={(event) => handleRoomDragOver(event, rm.roomId)}
                      onDragLeave={handleRoomDragLeave}
                      onDrop={(event) => handleRoomDrop(event, rm.roomId)}
                    >
                      {/* Room Card Header */}
                      <div className="flex items-center justify-between pb-2.5 border-b border-slate-200">
                        <div className="flex items-center gap-2.5 flex-wrap">
                          <span className="font-bold text-sm text-slate-900">Room {rm.roomId}</span>
                          {isCrewRoom(rm) ? (
                            <span className="text-[10px] px-2 py-0.5 rounded-full font-bold bg-purple-100 text-purple-800 border border-purple-200">
                              Staff Room
                            </span>
                          ) : typesToChoose ? (
                            <label
                              className="room-alloc-type"
                              onClick={(event) => event.stopPropagation()}
                              onDoubleClick={(event) => event.stopPropagation()}
                            >
                              <span className="room-alloc-type-label">Room type</span>
                              <select
                                className="room-alloc-type-select"
                                aria-label={`Room type for Room ${rm.roomId}`}
                                value={effectiveType}
                                onChange={(event) => handleRoomTypeChange(rm.roomId, event.target.value)}
                              >
                                {!effectiveType && <option value="">Not chosen</option>}
                                {roomTypeChoices.map((rt) => (
                                  <option key={rt.key || rt.name} value={rt.name}>{rt.name}</option>
                                ))}
                              </select>
                            </label>
                          ) : (effectiveType ? (
                            <span className="text-[11px] px-2 py-0.5 rounded-full font-semibold bg-slate-100 text-slate-700 border border-slate-300">
                              {effectiveType}
                            </span>
                          ) : null)}
                          <span className={`text-[11px] px-2.5 py-0.5 rounded-full font-bold ${
                            isOver
                              ? 'bg-rose-100 text-rose-800 border border-rose-300'
                              : isFull
                              ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                              : 'bg-slate-100 text-slate-700 border border-slate-300'
                          }`}>
                            {isOver
                              ? `⚠️ ${counts.total}/${roomCaps.maxOccupancy}${roomCaps.maxAdults !== null ? ` · ${counts.adults}/${roomCaps.maxAdults} adults` : ''} OVER CAPACITY`
                              : `${counts.total}/${roomCaps.maxOccupancy} Occupants${roomCaps.maxAdults !== null ? ` · ${counts.adults}/${roomCaps.maxAdults} adults` : ''}`}
                          </span>
                        </div>

                        <div className="flex items-center gap-3">
                          <button
                            type="button"
                            className={`room-alloc-select ${isActive ? 'is-active' : ''}`}
                            onClick={(event) => {
                              event.stopPropagation();
                              setSelectedRoomId(rm.roomId);
                              setMoveNotice('');
                            }}
                            title={isActive ? 'This room receives travellers' : 'Select this room as the move target'}
                          >
                            {isActive && <CheckCircle2 size={13} />}
                            {isActive ? 'Selected' : 'Select'}
                          </button>
                          <span className="text-xs text-[#0d7478] font-bold bg-teal-50 px-2.5 py-1 rounded-md border border-teal-200">
                            {currencyCode} {roomCalc.sellPrice?.toFixed(2) || '0.00'}
                          </span>
                          {rooms.length > 1 && (
                            <button
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                handleRemoveRoom(rm.roomId);
                              }}
                              className="text-slate-400 hover:text-rose-600 transition p-1 rounded hover:bg-rose-50"
                              title="Delete Room"
                            >
                              <Trash2 size={15} />
                            </button>
                          )}
                        </div>
                      </div>

                      {isDropTarget && (
                        <div className="room-alloc-drop-hint">
                          Drop {draggingTraveller ? `${draggingTraveller.name} ${draggingTraveller.surname}` : 'traveller'} here
                        </div>
                      )}

                      {/* Rate Details */}
                      <div className="mt-2 text-[11px] text-slate-500 font-medium">
                        Rate Calculation: <span className="text-slate-700 font-semibold">{roomCalc.rateDescription || 'No occupants assigned'}</span>
                      </div>

                      {/* Occupants List. Chips are draggable, so a guest can be
                          moved straight from one room to another. */}
                      <div className="mt-3 flex flex-wrap gap-2">
                        {occs.length === 0 ? (
                          <div className="text-xs text-slate-400 italic py-1">
                            {isActive
                              ? 'This room is selected — use the arrow beside a traveller or drag them here.'
                              : 'No occupants yet. Click this room, then move travellers in.'}
                          </div>
                        ) : (
                          occs.map((occ) => (
                            <div
                              key={occ.id}
                              draggable
                              onDragStart={(event) => handleDragStart(event, occ.id)}
                              onDragEnd={handleDragEnd}
                              className="room-alloc-occupant flex items-center gap-2 px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-semibold text-slate-800 shadow-sm"
                              title="Drag to another room"
                            >
                              <span>{occ.name} {occ.surname}</span>
                              <span className="text-[10px] font-normal text-slate-500">({isAdultTraveller(occ) ? 'Adult' : 'Child'})</span>
                              <button
                                type="button"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  handleUnassignTraveller(occ.id, rm.roomId);
                                }}
                                className="text-slate-400 hover:text-rose-600 transition font-bold leading-none ml-1 text-sm"
                                title="Remove traveller"
                              >
                                ×
                              </button>
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

          </div>

          {/* Financial Summary Card */}
          <div className="bg-teal-50/60 border border-teal-200 p-4 rounded-xl flex items-center justify-between">
            <div>
              <div className="text-xs font-bold text-[#0d7478] uppercase tracking-wider">Total Accommodation Rate</div>
              <div className="text-xs text-slate-600 font-medium">Calculated per room according to contract rates</div>
            </div>
            <div className="text-right">
              <div className="text-2xl font-black text-[#0d7478]">
                {currencyCode} {financialSummary.totalSell.toFixed(2)}
              </div>
              <div className="text-[11px] text-slate-500 font-medium">
                Excl. {taxWordOf(currencyCode)}: {currencyCode} {financialSummary.totalExcl.toFixed(2)} | Buy: {currencyCode} {financialSummary.totalBuy.toFixed(2)}
              </div>
            </div>
          </div>

{/* Guardrail Warning Banner */}
          {!isValid && (
            <div className="bg-amber-50 border border-amber-300 p-3.5 rounded-xl text-amber-900 text-xs flex items-start gap-3">
              <AlertTriangle size={20} className="text-amber-600 shrink-0 mt-0.5" />
              <div className="space-y-0.5">
                <strong className="font-bold text-amber-950">Room Allocation Alert:</strong>
                {outstandingRequired.length > 0 && !splitPending && (
                  <div>&bull; {outstandingRequired.length} traveller(s) must still be allocated to a room.</div>
                )}
                {splitPending && (
                  <div>&bull; {outstandingRequired.length} traveller(s) are left for another property &mdash; tick &ldquo;Group split&rdquo; to continue.</div>
                )}
                {doubleBooked.length > 0 && (
                  <div>• {doubleBooked.length} traveller(s) already have a bed in another property on this night — remove them here.</div>
                )}
                {overCapacityRooms.length > 0 && (
                  <div>• {overCapacityRooms.length} room(s) exceed the beds their own room type allows ({overCapacityRooms.map((room) => `Room ${room.roomId}${roomTypeOfAllocation(room, item) ? ` ${roomTypeOfAllocation(room, item)}` : ''} takes ${capsLabel(roomCapsOf(room, roomTypeChoices, lineCaps))}`).join('; ')}). Add another room or redistribute travellers.</div>
                )}
                {unpricedRooms.map((room) => (
                  <div key={room.roomId}>• {room.reason}</div>
                ))}
              </div>
            </div>
          )}

          {isValid && (
            <div className="bg-emerald-50 border border-emerald-300 p-3 rounded-xl text-emerald-900 text-xs flex items-center gap-2">
              <CheckCircle2 size={18} className="text-emerald-600 shrink-0" />
              <span className="font-semibold">
                {splitPending
                  ? 'Partial allocation saved — add the next property for the remaining travellers and tick "Group split".'
                  : 'All travellers are validly allocated without exceeding room capacity limits.'}
              </span>
            </div>
          )}

          {!item?.isOptional && outstandingRequired.length > 0 && !doubleBooked.length && !overCapacityRooms.length && (
            <label className="flex items-start gap-3 bg-indigo-50 border border-indigo-200 p-3.5 rounded-xl text-xs text-indigo-900 cursor-pointer hover:bg-indigo-100/70 transition">
              <input
                type="checkbox"
                checked={splittingGroup}
                onChange={(e) => setSplittingGroup(e.target.checked)}
                className="mt-0.5"
                style={{ accentColor: '#4f46e5', cursor: 'pointer' }}
              />
              <span className="font-semibold leading-relaxed">
                Group split &mdash; another property will house the remaining {outstandingRequired.length} traveller(s) on this night.
                <span className="block font-normal text-indigo-700 mt-0.5">
                  Leave them unallocated here, then add the next property and tick &ldquo;Group split&rdquo; on it. Every property in the split is priced into the itinerary.
                </span>
              </span>
            </label>
          )}

        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-slate-200 bg-slate-50 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={requestCancel}
            className="px-4 py-2 text-xs font-bold text-slate-600 hover:text-slate-900 transition rounded-xl hover:bg-slate-200/60"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!isValid}
            onClick={handleConfirm}
            className={`px-5 py-2.5 text-xs font-bold rounded-xl shadow-md transition ${
              isValid
                ? 'bg-[#0d7478] hover:bg-[#0b6266] text-white cursor-pointer'
                : 'bg-slate-200 text-slate-400 cursor-not-allowed border border-slate-300'
            }`}
          >
            Confirm & Apply Room Allocation
          </button>
        </div>

      </div>
    </div>
  );
}
