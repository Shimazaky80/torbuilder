/* Columns that have existed on library_items for a long time. Kept separately so
   a select can be retried against them: PostgREST rejects the WHOLE select when
   a single column in the list does not exist yet, so one column belonging to a
   migration that has not been applied would otherwise empty every list in the
   app that uses the light field set. */
export const LIBRARY_ITEM_BASE_FIELDS = [
  'id', 'company_id', 'supplier_id', 'name', 'category', 'sub_category',
  'description', 'location', 'destination_region', 'destination_area', 'currency', 'max_occupancy', 'is_active', 'created_at',
  'child_age_ranges',
  'max_adults', 'max_children',
  'contract_url', 'contract_name',
  'flight_number', 'airline_name', 'departure_city', 'arrival_city',
  'guide_driver_room_offered',
  'pricing_model',
  'sharing_capacity_rules',
  'fee_type', 'conservation_levy_basis',
  'transfer_type',
  'meal_type', 'menu_type', 'meal_gratuity_percent',
  'driver_required', 'driver_meals', 'driver_accommodation',
  'guide_meals', 'guide_accommodation',
  'ticket_type',
  'train_cabin_name', 'train_departure_date', 'train_journey_nights',
  'tour_type'
].join(',');

export const LIBRARY_ITEM_LIGHT_FIELDS = [
  /* Fees & Tickets. The builder needs all of these to price a surcharge line
     and to know whether the accommodation it belongs to has to bring it along,
     so they are selected alongside the legacy fee columns rather than only on
     the full library load. */
  'surcharge_type', 'surcharge_charge_basis', 'surcharge_unit_basis',
  'surcharge_chargeable', 'linked_item_id',
  /* Tour leader and guide room deals. The room dialog prices a TL or guide bed
     from these, so a dropped/allocated accommodation has to carry them; they
     stay out of the base list so the retry still works before the migration is
     applied. Same for the children-own-room policy, which the room engine
     needs to price a children-only room. */
  'tour_leader_room_offered', 'tour_leader_min_rooms', 'guide_min_rooms',
  'children_own_room_policy',
  /* The guide details dialog and the flight's guide ticket both decide from
     these, and a library load that has to drop the whole select would leave the
     builder with no meals to offer the guide at all. */
  'guide_meal_offered', 'driver_meal_offered', 'guide_flight_offered',
  LIBRARY_ITEM_BASE_FIELDS
].join(',');

/* Package Builder's library select. It names its columns instead of taking `*`,
   so the crew flags are split off the same way: a workspace that has not applied
   that migration yet still has to open its packages, and one unknown column in a
   named select rejects the whole query. */
const LIBRARY_ITEM_PACKAGE_COLUMNS = [
  'id', 'name', 'category', 'description', 'currency', 'pricing_model', 'supplier_id',
  'max_occupancy', 'destination_region', 'destination_area', 'location', 'max_adults',
  'max_children', 'child_age_ranges', 'is_active', 'meal_type', 'menu_type',
  'guide_meals', 'guide_accommodation', 'guide_driver_room_offered'
];

export const LIBRARY_ITEM_PACKAGE_FIELDS = [
  ...LIBRARY_ITEM_PACKAGE_COLUMNS,
  'guide_meal_offered', 'driver_meal_offered', 'guide_flight_offered'
].join(',');

export const LIBRARY_ITEM_PACKAGE_FIELDS_FALLBACK = LIBRARY_ITEM_PACKAGE_COLUMNS.join(',');