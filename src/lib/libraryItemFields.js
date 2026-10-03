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
  /* Surcharge Fees. The builder needs all of these to price a surcharge line
     and to know whether the accommodation it belongs to has to bring it along,
     so they are selected alongside the legacy fee columns rather than only on
     the full library load. */
  'surcharge_type', 'surcharge_charge_basis', 'surcharge_unit_basis',
  'surcharge_chargeable', 'linked_item_id',
  LIBRARY_ITEM_BASE_FIELDS
].join(',');