-- =============================================================================
-- Migration: Stay X Pay Y accommodation promotions
--
-- A stay-pay offer is a promotion on a property, not a charge type and not a
-- night band: "stay 7 nights, pay for 5" changes which ROOM-NIGHTS are billed,
-- not what a night costs. It therefore lives beside the property's rooms:
--
--   library_items.stay_pay_promotions JSONB NOT NULL DEFAULT '[]'::jsonb
--
-- Each rule is:
--   {
--     "id": "sp_...",
--     "name": "Stay 7 Pay 5",
--     "roomKeys": [],              -- empty = every room at the property
--     "validFrom": "2026-01-01",   -- check-in must fall inside this window
--     "validTo": "2026-12-31",
--     "stayNights": 7,
--     "payNights": 5,
--     "repeat": true,              -- repeat every cycle across a longer stay
--     "freeNightRule": "cheapest", -- cheapest | last | every_nth
--     "maxFreeNights": 0,          -- 0 = no extra cap
--     "active": true
--   }
--
-- A free night waives the whole room-night - sharing, single supplement and
-- child figures alike - because the line itself is stamped, not one component
-- of its price. Linked Fees & Tickets lines (park fee, levy, porterage) are
-- separate services and are still charged on a free night.
--
-- The builders price one line per night, so the stamp is carried on the line:
--   stay_pay_free   the night is a promotion night and bills nothing
--   stay_pay_rule   the rule that granted it, for display
--   stay_pay_value  what the room-night was worth before it was waived
--
-- Columns are added with IF NOT EXISTS so a workspace that already applied part
-- of this migration can be re-run safely.
-- =============================================================================

ALTER TABLE public.library_items
  ADD COLUMN IF NOT EXISTS stay_pay_promotions JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public.itinerary_day_items
  ADD COLUMN IF NOT EXISTS stay_pay_free BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS stay_pay_rule TEXT,
  ADD COLUMN IF NOT EXISTS stay_pay_value NUMERIC;

ALTER TABLE public.package_day_items
  ADD COLUMN IF NOT EXISTS stay_pay_free BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS stay_pay_rule TEXT,
  ADD COLUMN IF NOT EXISTS stay_pay_value NUMERIC;

COMMENT ON COLUMN public.library_items.stay_pay_promotions IS
  'Accommodation stay-pay rules. Each rule scopes to roomKeys (empty = all rooms), applies when the check-in date falls inside validFrom..validTo, and waives stayNights - payNights room-nights per cycle. Multiple rules never stack: the best saving wins.';

COMMENT ON COLUMN public.itinerary_day_items.stay_pay_free IS
  'True when this accommodation night was waived by a stay-pay promotion. The line still carries stay_pay_value so the waived figure remains readable.';

COMMENT ON COLUMN public.package_day_items.stay_pay_free IS
  'True when this accommodation night was waived by a stay-pay promotion. The line still carries stay_pay_value so the waived figure remains readable.';

NOTIFY pgrst, 'reload schema';
