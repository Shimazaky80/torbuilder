import React, { useState, useEffect, useMemo } from 'react';
import {
  Users,
  BedDouble,
  Plus,
  Trash2,
  CheckCircle2,
  AlertTriangle,
  X,
  UserCheck,
  UserX
} from 'lucide-react';
import {
  isAdultTraveller,
  calculateRoomCharges
} from '../lib/roomAllocationHelper';
import './RoomAllocationModal.css';

export default function RoomAllocationModal({
  isOpen,
  onClose,
  onSave,
  item,
  itineraryTravellers = [],
  currencyCode = 'ZAR',
  markupPct = 0
}) {
  if (!isOpen || !item) return null;

  const maxOccupancy = Math.max(1, parseInt(item.maxOccupancy ?? item.max_occupancy, 10) || 2);
  
  const travellersList = useMemo(() => {
    if (Array.isArray(itineraryTravellers) && itineraryTravellers.length > 0) {
      return itineraryTravellers.map((t, idx) => ({
        id: t.id || `trav_${idx}_${t.name || 'Pax'}`,
        name: t.name || `Traveller ${idx + 1}`,
        surname: t.surname || '',
        age: t.age ?? 30,
        type: t.type || (isAdultTraveller(t) ? 'Adult' : 'Child')
      }));
    }
    return [{ id: 'trav_default_1', name: 'Lead Traveller', surname: '', age: 30, type: 'Adult' }];
  }, [itineraryTravellers]);

  const [rooms, setRooms] = useState([]);

  // Initialize rooms on open or item change
  useEffect(() => {
    if (item.roomAllocations && Array.isArray(item.roomAllocations) && item.roomAllocations.length > 0) {
      const existingRooms = item.roomAllocations.map((rm, idx) => {
        const occs = (rm.allocatedTravellers || []).map((t) => {
          const matched = travellersList.find(
            (tl) => tl.id === t.id || (tl.name === t.name && tl.surname === t.surname)
          );
          return matched || t;
        });
        return {
          roomId: rm.roomId || idx + 1,
          allocatedTravellers: occs
        };
      });
      setRooms(existingRooms);
    } else {
      setRooms([]);
    }
  }, [item, travellersList, maxOccupancy]);

  // Compute unallocated travellers
  const allocatedIds = useMemo(() => {
    const set = new Set();
    rooms.forEach((rm) => {
      (rm.allocatedTravellers || []).forEach((t) => set.add(t.id));
    });
    return set;
  }, [rooms]);

  const unallocatedTravellers = useMemo(() => {
    return travellersList.filter((t) => !allocatedIds.has(t.id));
  }, [travellersList, allocatedIds]);

  // Check over capacity rooms
  const overCapacityRooms = useMemo(() => {
    return rooms.filter((rm) => (rm.allocatedTravellers || []).length > maxOccupancy);
  }, [rooms, maxOccupancy]);

  const isValid = unallocatedTravellers.length === 0 && overCapacityRooms.length === 0;

  // Financial calculations
  const financialSummary = useMemo(() => {
    return calculateRoomCharges(item, rooms, currencyCode, markupPct);
  }, [item, rooms, currencyCode, markupPct]);

  // Handlers
  const handleAddRoom = () => {
    setRooms((prev) => [
      ...prev,
      { roomId: prev.length + 1, allocatedTravellers: [] }
    ]);
  };

  const handleRemoveRoom = (roomId) => {
    if (rooms.length <= 1) return;
    setRooms((prev) =>
      prev.filter((r) => r.roomId !== roomId).map((r, idx) => ({ ...r, roomId: idx + 1 }))
    );
  };

  const handleAssignTraveller = (traveller, targetRoomId) => {
    setRooms((prev) =>
      prev.map((rm) => {
        const filtered = rm.allocatedTravellers.filter((t) => t.id !== traveller.id);
        if (rm.roomId === targetRoomId) {
          return { ...rm, allocatedTravellers: [...filtered, traveller] };
        }
        return { ...rm, allocatedTravellers: filtered };
      })
    );
  };

  const handleUnassignTraveller = (travellerId, roomId) => {
    setRooms((prev) =>
      prev.map((rm) => {
        if (rm.roomId === roomId) {
          return {
            ...rm,
            allocatedTravellers: rm.allocatedTravellers.filter((t) => t.id !== travellerId)
          };
        }
        return rm;
      })
    );
  };

  const handleConfirm = () => {
    if (!isValid) return;
    onSave({
      roomAllocations: rooms,
      calculatedBuy: financialSummary.totalBuy,
      calculatedSell: financialSummary.totalSell,
      numRooms: rooms.length,
      occupantSummary: `${rooms.length} Room(s), ${travellersList.length} Pax`
    });
    onClose();
  };

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
                  Contract Max Occupancy: {maxOccupancy} Pax / Room
                </span>
              </div>
              <p className="text-xs text-slate-500 font-medium mt-0.5">
                {item.name || item.title || 'Accommodation Service'} {(item.roomType || item.room_type) ? `(${item.roomType || item.room_type})` : ''}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
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
              <div className="h-4 w-px bg-slate-300" />
              <div>
                Rooms Allocated: <strong className="text-slate-900 font-bold">{rooms.length} Room(s)</strong>
              </div>
              {unallocatedTravellers.length > 0 && (
                <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-amber-100 text-amber-800 border border-amber-300">
                  {unallocatedTravellers.length} Unallocated
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

            {/* Left Column: Unallocated Travellers (4 cols) */}
            <div className="md:col-span-4 bg-slate-50 border border-slate-200 rounded-xl p-4 flex flex-col">
              <div className="flex items-center justify-between pb-3 border-b border-slate-200">
                <h3 className="font-bold text-xs uppercase tracking-wider text-slate-600 flex items-center gap-2">
                  <UserX size={15} className={unallocatedTravellers.length > 0 ? 'text-amber-600' : 'text-emerald-600'} />
                  Unallocated Travellers ({unallocatedTravellers.length})
                </h3>
              </div>

              <div className="mt-3 space-y-2.5 flex-1 overflow-y-auto max-h-[340px] pr-1">
                {unallocatedTravellers.length === 0 ? (
                  <div className="py-8 px-3 text-center text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-xl flex flex-col items-center gap-1.5">
                    <CheckCircle2 size={24} className="text-emerald-600" />
                    <span className="font-semibold">All travellers assigned to rooms!</span>
                  </div>
                ) : (
                  unallocatedTravellers.map((tr) => (
                    <div
                      key={tr.id}
                      className="p-3 bg-white border border-slate-200 rounded-xl flex flex-col gap-2 shadow-sm hover:border-slate-300 transition"
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="font-bold text-xs text-slate-900">
                            {tr.name} {tr.surname}
                          </div>
                          <div className="text-[11px] text-slate-500 font-medium">
                            Age: {tr.age} • {isAdultTraveller(tr) ? 'Adult' : 'Child'}
                          </div>
                        </div>
                        <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${
                          isAdultTraveller(tr) ? 'bg-blue-50 text-blue-700 border border-blue-200' : 'bg-purple-50 text-purple-700 border border-purple-200'
                        }`}>
                          {isAdultTraveller(tr) ? 'Adult' : 'Child'}
                        </span>
                      </div>

                      {/* Quick Assign Buttons / Select */}
                      <div className="flex items-center gap-1.5 pt-1.5 border-t border-slate-100">
                        <span className="text-[10px] text-slate-500 font-medium">Assign:</span>
                        <select
                          className="flex-1 bg-slate-50 border border-slate-300 rounded-md text-xs font-medium text-slate-800 px-2 py-1 focus:outline-none focus:border-[#0d7478]"
                          defaultValue=""
                          onChange={(e) => {
                            if (e.target.value) {
                              handleAssignTraveller(tr, Number(e.target.value));
                            }
                          }}
                        >
                          <option value="" disabled>Select Room...</option>
                          {rooms.map((rm) => (
                            <option key={rm.roomId} value={rm.roomId}>
                              Room {rm.roomId} ({(rm.allocatedTravellers || []).length}/{maxOccupancy})
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Right Column: Rooms List (8 cols) */}
            <div className="md:col-span-8 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="font-bold text-xs uppercase tracking-wider text-slate-600 flex items-center gap-2">
                  <UserCheck size={15} className="text-[#0d7478]" />
                  Room Allocations
                </h3>
                <span className="text-xs text-slate-500 font-medium">Max {maxOccupancy} Guests per Room</span>
              </div>

              <div className="space-y-3.5 max-h-[360px] overflow-y-auto pr-1">
                {rooms.map((rm) => {
                  const occs = rm.allocatedTravellers || [];
                  const isOver = occs.length > maxOccupancy;
                  const roomCalc = financialSummary.rooms.find((r) => r.roomId === rm.roomId) || {};

                  return (
                    <div
                      key={rm.roomId}
                      className={`p-4 rounded-xl border transition shadow-sm ${
                        isOver
                          ? 'bg-rose-50/50 border-rose-300 shadow-rose-100'
                          : occs.length === maxOccupancy
                          ? 'bg-emerald-50/30 border-emerald-300'
                          : 'bg-white border-slate-200'
                      }`}
                    >
                      {/* Room Card Header */}
                      <div className="flex items-center justify-between pb-2.5 border-b border-slate-200">
                        <div className="flex items-center gap-2.5">
                          <span className="font-bold text-sm text-slate-900">Room {rm.roomId}</span>
                          <span className={`text-[11px] px-2.5 py-0.5 rounded-full font-bold ${
                            isOver
                              ? 'bg-rose-100 text-rose-800 border border-rose-300'
                              : occs.length === maxOccupancy
                              ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                              : 'bg-slate-100 text-slate-700 border border-slate-300'
                          }`}>
                            {isOver
                              ? `⚠️ ${occs.length}/${maxOccupancy} OVER CAPACITY`
                              : `${occs.length}/${maxOccupancy} Occupants`}
                          </span>
                        </div>

                        <div className="flex items-center gap-3">
                          <span className="text-xs text-[#0d7478] font-bold bg-teal-50 px-2.5 py-1 rounded-md border border-teal-200">
                            {currencyCode} {roomCalc.sellPrice?.toFixed(2) || '0.00'}
                          </span>
                          {rooms.length > 1 && (
                            <button
                              type="button"
                              onClick={() => handleRemoveRoom(rm.roomId)}
                              className="text-slate-400 hover:text-rose-600 transition p-1 rounded hover:bg-rose-50"
                              title="Delete Room"
                            >
                              <Trash2 size={15} />
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Rate Details */}
                      <div className="mt-2 text-[11px] text-slate-500 font-medium">
                        Rate Calculation: <span className="text-slate-700 font-semibold">{roomCalc.rateDescription || 'No occupants assigned'}</span>
                      </div>

                      {/* Occupants List */}
                      <div className="mt-3 flex flex-wrap gap-2">
                        {occs.length === 0 ? (
                          <div className="text-xs text-slate-400 italic py-1">No occupants assigned yet. Select from unallocated pool.</div>
                        ) : (
                          occs.map((occ) => (
                            <div
                              key={occ.id}
                              className="flex items-center gap-2 px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-semibold text-slate-800 shadow-sm"
                            >
                              <span>{occ.name} {occ.surname}</span>
                              <span className="text-[10px] font-normal text-slate-500">({isAdultTraveller(occ) ? 'Adult' : 'Child'})</span>
                              <button
                                type="button"
                                onClick={() => handleUnassignTraveller(occ.id, rm.roomId)}
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
                Excl. VAT: {currencyCode} {financialSummary.totalExcl.toFixed(2)} | Buy: {currencyCode} {financialSummary.totalBuy.toFixed(2)}
              </div>
            </div>
          </div>

          {/* Guardrail Warning Banner */}
          {!isValid && (
            <div className="bg-amber-50 border border-amber-300 p-3.5 rounded-xl text-amber-900 text-xs flex items-start gap-3">
              <AlertTriangle size={20} className="text-amber-600 shrink-0 mt-0.5" />
              <div className="space-y-0.5">
                <strong className="font-bold text-amber-950">Room Allocation Alert:</strong>
                {unallocatedTravellers.length > 0 && (
                  <div>• {unallocatedTravellers.length} traveller(s) must still be allocated to a room.</div>
                )}
                {overCapacityRooms.length > 0 && (
                  <div>• {overCapacityRooms.length} room(s) exceed maximum contract capacity ({maxOccupancy} pax). Please add another room or redistribute travellers.</div>
                )}
              </div>
            </div>
          )}

          {isValid && (
            <div className="bg-emerald-50 border border-emerald-300 p-3 rounded-xl text-emerald-900 text-xs flex items-center gap-2">
              <CheckCircle2 size={18} className="text-emerald-600 shrink-0" />
              <span className="font-semibold">All travellers are validly allocated without exceeding room capacity limits.</span>
            </div>
          )}

        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-slate-200 bg-slate-50 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
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
