-- =============================================================================
-- Migration: composed package offers (bundle key + label)
--
-- A package line today is one library item. That is the right shape for a lodge
-- night or a park fee, and the wrong shape for what operators actually sell: a
-- Cape Town airport transfer is a car for three rental days, the hire desk's
-- paperwork fee and a guide's time, quoted to the client as ONE thing at ONE
-- price. Split across three unlabelled lines it reads as three services the
-- client did not buy, and the number they are asked to compare is nothing the
-- tenant ever composed.
--
-- A bundle is that composed offer: several lines on one day, carrying the same
-- bundle_key, sold under one bundle_label. It is deliberately thin. The lines
-- stay separate rows with their own prices, because each one is priced by a
-- different rule — a hire by its tariff window and rental-length band, a guide by
-- its survey rates, a fee by being flat — and folding them into one row would
-- lose the reason behind each figure. The key only says which lines are one
-- offer, so the builder can group them, the document can print them once under
-- their own name, and the total a client sees is the sum the tenant intended.
--
-- The key is minted on the client, not by the database, for the same reason
-- item_key is: persist() deletes and reinserts every package row on each save, so
-- any id the database generates is recreated mid-save and cannot be pointed at.
-- There is no foreign key here for exactly that reason — a bundle can be created,
-- emptied and refilled without touching a parent row, and a package copy that
-- drags a dangling key is a bug nobody would see.
--
-- The label is repeated on every line of the offer rather than stored once per
-- key. Nothing joins on it, package lines are already rewritten whole on every
-- save, and a per-offer table would need the same delete-and-reinsert dance the
-- days and bands do to buy a single text field.
--
-- Nothing existing changes meaning: unbundled lines keep their NULL key and are
-- grouped, priced and printed exactly as they were before this file ran.
-- =============================================================================

ALTER TABLE public.package_day_items
  ADD COLUMN IF NOT EXISTS bundle_key UUID,
  ADD COLUMN IF NOT EXISTS bundle_label TEXT;

-- Reads a day's offers: every line sharing a key, and nothing else on the day.
CREATE INDEX IF NOT EXISTS package_day_items_bundle_key_idx
  ON public.package_day_items (package_day_id, bundle_key)
  WHERE bundle_key IS NOT NULL;

COMMENT ON COLUMN public.package_day_items.bundle_key IS
  'Minted on the client for one composed offer — a car hire, its paperwork fee and a guide sold as a single transfer, say. Every line of that offer carries the same key; NULL means the line stands on its own. No foreign key: persist() recreates every package row on each save.';

COMMENT ON COLUMN public.package_day_items.bundle_label IS
  'The name the offer is sold under, repeated on each of its lines because nothing joins on it and a package is rewritten whole on every save.';

NOTIFY pgrst, 'reload schema';
