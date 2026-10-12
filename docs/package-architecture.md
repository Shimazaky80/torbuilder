# Package Builder architecture — iterated against the mockup

Status: **v2, agreed in the mockup (`docs/mockups/package-builder-pricing.html`).**
Scope is the **package module only**. The standalone `ItineraryBuilder` is a separate
screen with its own one-party, one-vehicle model and is untouched by anything here.

---

## 1. Source of truth

`itinerary_pricing.json` (the workbook packages are actually priced in). One property
decides everything else:

**The vehicle is a column, not a row.**

```
item                         saloon  combi  quantum  sprinter   bus
Spanish Transfer JIA→Hotel      750    900    1050      2310   4150
Transport (Europcar)            835   1870    5910     17100  28700
Petrol (trip estimate)         3800   4500    5000    Included Included
Toll Gates            ─────────── flat 365 ──────────────────────────
Panorama Route        ─────────── per person 341 ─────────────────────
Accommodation         ─────────── sharing 810 / single 540 ───────────

nett_totals_by_vehicle:  saloon 20494 · combi 25209 · quantum 26683
                         sprinter 42599 · bus 57699
```

One row per service, five prices in that row, the bottom of the sheet is the sum down
each column, and a party of *N* divides its column by *N*.

Two structural facts proved from the workbook:

- **`pricing_by_vehicle` is a flat `vehicle → price` map.** There are no pax bands inside
  it. Bands are only *which party sizes you are willing to quote* (the divisor) — so
  bands belong on the package grid, not on the library price vector.
- **Only accommodation + single supplement vary inside a year.**
  `seasonal_packaged_summaries` moves precisely `accommodation_and_park_fees_fixed` and
  `single_supplement_fixed` across three periods. Everything else is annual. That fact
  is the answer to the "more than one season without copying the package" challenge.

---

## 2. The model

```
VEHICLE_TYPE            global master, configured once in Settings
  id, code, name, max_capacity        saloon 3 · combi 6 · quantum_10 10
                                       sprinter_16 16 · bus_39 39 · aranza_40 40

LIBRARY_ITEM            as today
  └─ ITEM_RATE (rate row)  season · currency · basis
        prices_by_vehicle { saloon: 750, combi: 900, quantum_10: 1050, ... }

PACKAGE
  └─ PACKAGE_SERVICE     one line per service — NOT one per vehicle
  └─ PACKAGE_SEASON      header, not a copy: { from, to, accommodation, single_supplement }
  └─ PACKAGE_GRID        up to 6 vehicle columns × traveller bands (quote display)
```

### Why the previous design was wrong

The vehicle was stored **in the row**, so pricing five vehicle sizes meant five rows per
service, on every day, each generating a band that rendered its own full breakdown:

```
1 city tour × 5 vehicles   =   5 rows
× 7 days of vehicles       =  dozens of rows
× bands                    =  a breakdown table per band
```

The arithmetic was always right — column sum ÷ pax — but the vehicle was in the wrong
place. The sheet does the same job with 1 row × 5 columns.

---

## 3. Cost bases

Everything in the sheet is one of these. Nothing else exists.

| Basis | Sheet example | Charge |
|---|---|---|
| **`PER_VEHICLE`** | `pricing_by_vehicle` | column price for the resolved vehicle |
| **`FLAT`** | `flat_rate: 365` (tolls), `flat_rate: 2360` (guide) | once, for the whole party |
| **`FLAT_EACH`** | `flat_rate_each: 300` (guide lunch, driver lunch) | × head count |
| **`PER_PERSON`** | `per_person_cost: 341` (Panorama), `1177` (4×4 safari) | × party size |
| **`ACCOMMODATION`** | `cost_sharing: { sharing 810, single_supplement 540 }` | rate shape, see below |

Two families: **unit prices ÷ party size** (vehicle, flat, flat-each) and
**per-person items × party size** (fees, activities, accommodation sharing).

`ACCOMMODATION` stays a **rate shape** (`sharing`, `single_supplement`, `extraAdult`,
plus the child range) — a single number cannot price 3 adults in a double + single with
a 6-year-old at half rate, which is the most common booking there is.

---

## 4. Party size and vehicle resolution

**Party size is free entry** and never stored (D11). Vehicle resolves the same way it
did before the mockup:

```
party of N  →  vehicle = smallest type whose max_capacity >= N
             →  if no type seats N, the package is not sellable at that size
```

The package grid (`&sect;6.2`) is the **quote surface** for those sizes: each column is a
vehicle size chosen from Settings, each row of that column is a quotable traveller
count — the divisor. Bands are seeded from the size and are free to override.

---

## 5. Missing prices

**Everything is charged unless a library item is genuinely free.** An unpriced cell is a
cost you forgot, not a gift — it must never silently sum to zero. States (D12):

| State | Stored as | Effect |
|---|---|---|
| **Priced** | a number | added to the column |
| **Explicitly free** | `{ free: true }` | `0`, note kept for display |
| **Explicitly not applicable** | `{ na: true }` | `0`, rendered as `—` |
| **Never priced** | key absent | **blocks that party size from being sold** |

Default for an untouched cell is **error**, not `0`. This is why removing a draft price
*deletes* the key rather than writing zero — see `handleVehiclePriceChange`.

---

## 6. The calculation

### 6.1 Arithmetic (unchanged)

```
given party size N
  V = smallest vehicle type that seats N

  shared    =  Σ PER_VEHICLE  prices[V]
             + Σ FLAT
             + Σ FLAT_EACH  × count

  perPerson =  Σ PER_PERSON  rate × N
             + accommodation sharing × sharing occupancy
             + extras / child terms

  single    =  Σ single supplements

  party total  =  shared + perPerson + single
  per person   =  party total ÷ N
```

Row shares are summed **unrounded**; per-person figures are rounded for display only.

The grid's **price per person** row is exactly this, split for the eye:
`(vehicle pool ÷ band pax) + per-person fixed`; accommodation and single supplement are
drawn from the season overlay, below the grid.

### 6.2 The Pricing and Seasons tab (the merged tab)

`Valid dates` + `Travellers & pricing` become one tab. It holds the season strip, an up
to-6-column vehicle grid, and the overlay:

```
SEASON STRIP        ● Base · ○ 01 Jan–30 Mar · ○ 01 Apr–30 Aug · ○ 01 Sep–30 Dec · + Add
                    (a header, never a package copy — see §7 D16)

GRID
  Vehicle           [Saloon ▼]  [Combi ▼]  [Quantum ▼]   (empty)   (empty)
  Travel season     one row spanning all columns (accommodation drives the dates)
  Travellers        2  3       2  4  6    3  6  10
  Price per person  (pool÷pax + perPerson) per band cell
  Single supplement full-width, per person, from the season
  Child price       full-width, from the library item's child_rates (§7 D17)

OVERLAY             Accommodation & park fees · Single supplement · Vehicle & service pool
```

Rules, all agreed in the mockup:

- **A column is a vehicle size**, chosen from Settings; a size used in one column is
  disabled in the other five; 1–6 columns (D19). No supplier / destination / region in
  the picker — that idea was aborted (A): two suppliers with the same 30-seater are one
  size and one column, and the cheaper supplier is chosen at the service line.
- **Bands seed from size**: `step = round(size ÷ 3)`, bands `[step, 2×step, size]`,
  two bands if size ≤ 3. Free to override, ≤ the vehicle's seats (D20).
- **Vehicle pool is annual and locked**; the season overlay holds only accommodation and
  single supplement.

### 6.3 The Presentation pricing tab and the sheet read-out (step 7)

The summary is the same grid, without the vehicle row. Clients never read a vehicle size;
the columns stay but are unnamed options, and the only legible row is the traveller count:

```
Travel season        Season 1 · 01 Jan 2026 → 30 Mar 2026            (full width)
Travellers           2  3            2  4  6            3  6  10      (teal cells)
Price per person sharing   per-option cells = pool ÷ pax + per-person + accommodation
Single supplement   full width, amber, from the season
Child price         full width, pink, unit share + accommodation child rate
```

- **One grid, two tabs.** Column/band state lives in `usePricingGrid` above the tabs:
  *Pricing & seasons* edits it, *Presentation pricing* reads it. No second copy, so the
  presentation can never disagree with the costing tab.
- **Travellers and prices are their own rows** on *both* tabs, matching the mockup: one
  row with pax numbers side-by-side as bands, the price row directly underneath, each
  band `flex: 1` so the figures line up column-for-column.
- **4 columns by default** with a *show more* toggle; the export splits at **3 columns per
  block**, a new block below, and is switched by the *Presentation pricing* option in the
  export modal. Client markup (D6/D7) applies to the per-person and flat figures.
- **Itinerary reads like the sheet**: a per-vehicle line on the working canvas carries its
  vehicle price pills (from its own locked snapshot), the workbook's one-row-per-service
  shape, so every size an operator is pricing is visible while they edit.
- **Rows mirror the mockup palette exactly**: amber `#fffbeb` season cell (`#b45309` /
  `#78350f` / `#92400e`), amber `#fefce8` single supplement (`#854d0e`), pink `#fdf2f8`
  child (`#9d174d`), teal `#f0fdfa` vehicle heads (`#99f6e4` select, `#0f766e` read) and
  `#f8fafc` labels. The accommodation row borrows the teal so it stays distinct from the
  amber season pair.

---

## 7. Decisions

### Standing

| | Decision |
|---|---|
| **D2** | Divisor is always actual pax; `min_chargeable_pax` stays deleted. |
| **D4** | Accommodation is a rate shape, not a scalar. |
| **D5** | One markup, not a shared/per-person split. |
| **D6** | Two independent processes, never a fallback, implemented as `packageExportMarkup` keyed on *assignment*. |
| **D7** | Markup applies to totals after aggregation and is never stored. |
| **D8** | Three stacked boxes, one column per party size. Implemented. |

### New

| | Decision |
|---|---|
| **D9** | Vehicle types are a global master list, configured in Settings. Applied (`20261220_company_vehicle_types`), seeded saloon 3, combi 6, quantum_10 10, sprinter_16 16, bus_39 39. |
| **D10** | The price vector lives on the rate row (`item_rates.prices_by_vehicle`, `20261221_...`). States per §5. Library Items UI implemented (seeded from Settings; free/n-a states; legacy single-price columns fall back to the cheapest priced vehicle). |
| **D11** | Party size is free entry and never stored. |
| **D12** | An unpriced cell blocks; only an explicit free flag charges zero. |
| **D13** | **Seasons are a header, not a copy.** One package, many seasons; switching never duplicates the package or reloads services. |
| **D14** | **Two price stores.** The vehicle grid is annual, written once; the season overlay holds only `{ accommodation, single_supplement }`. |
| **D15** | **Resolve by date.** Trip dates pick the season; accommodation comes from it, every other line from the annual pool. |
| **D16** | **Straddle a boundary → highest rate wins** for all nights — never split, never first-night. Runs per accommodation line. |
| **D17** | **Child price**: library item's `child_rates` wins — a published R0.00 is a genuinely free child and is honoured as such; only a property with **no** child price for the age band charges its single supplement. |
| **D18** | **Prices are a locked snapshot** on the package; library edits never move an existing package; a deliberate *Update from library* writes the current rate. Supplier changes are expected — that is why nothing re-reads on its own. |
| **D19** | Up to 6 vehicle columns, unique per size, one size per column. 6th vehicle (`aranza_40`) confirmed in scope. |
| **D20** | Band seeding rule `[step, 2×step, size]`, editable, ≤ seats. |
| **D21** | **Columns are chosen where the package is created** — how many, and which sizes — from `company_vehicle_types` on the Package modal, and stored on the package (`packages.vehicle_columns`, `20261223_...`). The grid seeds from those (D19 caps it at 6); a package without one falls back to the first six sizes. The pick is still free on the costing tab, and the working grid's columns write back on save so the exporter stays in step. |
| **D22** | **A guide is priced per the service it accompanies.** On add, the operator ticks which flat per-trip service types price the line (Transfer, Half Day, Full Day, Overland, Dinner Transfer — the `guide_*_rate` columns on the rate row); Overland chains a *Guide & driver details* step (lunch, dinner, overnight; `guide_only` = only the guide & driver are charged). The detail lines are `guide_only`, priced flat and split across the party, and the engine ignores them as client accommodation so they never inflate the lodging figure (`20261224_guide_service_detour`). |
| **D23** | **An accommodation has one charge type per season matrix.** Room Only / Bed & Breakfast / Half Board / Full Board / Full Board with activities are each their own `item_rates` season set, keyed by the row's `meal_plan`. On drop, if more than one charge type exists (or any charge type spans several seasons) the operator picks the charge type and season in a prompt, and the engine pins that exact rate row — the season matrix is never shared across charge types. |
| **D24** | **The chosen (charge type, season) is pinned, and it behaves like any explicit choice.** The library row is selected by id (`seasonForRate`), so the placement, repeated days, the room modal and the package helper all price from that exact row without pricing protection overriding it (the operator already chose the season). The season is shown with its exact window (`Season: 2027/04/01-2027/08/31`) at choice time, in the package rate selector and on the package sidebar so the operator can verify it against the travel dates. |

### Overturned / aborted

| Was | Now | Why |
|---|---|---|
| **D1** — bands are exact pax, stored as content | Retired. Party size is free entry. | Bands as content duplicated itineraries and multiplied the breakdown. |
| **D3** — package-wide occupancy matrix | Deleted. "Smallest that seats" is a pure function. | A matrix is that function written down. |
| **Supplier/destination in the vehicle picker** | Aborted (user). | Search+label-only added noise; column = size only. |

---

## 8. What survives, what retires

### Survives untouched

- `calculatePackageTravellerBreakdown` and the row-share arithmetic
- `accommodationTerms` / `childRange` handling
- Markup: D5, D6, D7 (Phase 1, independent of vehicle structure)
- The three price boxes (D8)
- Season resolution and price protection (`seasonFor`, `applyProtectionToRate`)
- Currency handling and the export modal layout

### Retires

| | |
|---|---|
| "Valid dates" + "Travellers & pricing" as separate tabs | merged into Pricing and Seasons |
| Bands as stored content | `package_pax_options`, `packageBandSuggestions`, `packageBandForPax`, `packageBandCapacityError` |
| Per-band vehicle resolution | `packageTierDays`, `tier_key`, `replaces_item_key` — read path only, no drop |
| Supplier/destination column picker | never built |

---

## 9. Open items

| # | Item | Notes |
|---|---|---|
| **A** | Migrate `package_validity_periods` → seasons | Done in step 5. Additive `20261222_package_seasons.sql` (applied) adds `name`, `accommodation_per_person`, `single_supplement` — the season header `{name, from, to, accommodation, single_supplement}` (D13/D14); existing rows backfilled. Table rename to `package_seasons` deferred to a step-7 cleanup migration. |
| **B** | Engine reads the vector | Done in step 3. |
| **C** | Service line cost basis | Done in step 4. Basis comes from the item/rate (`basisOfRate`); lines now carry a locked snapshot (`rate_snapshot` captured at add/refresh) and price from it (D18). `refreshServiceFromLibrary` is the Update-from-library write path. |
| **D** | Retiring stored bands | Bands and `tier_key` remain as dead content; quotes and invoices reference them. Read path, not a drop. |
| **E** | Package grid persistence | Decided in step 6, amended for D21: **columns are no longer ephemeral** — they are chosen on the Packages list, stored as `packages.vehicle_columns`, and written back on save so the exporter stays in step. What stays ephemeral is the **bands** (D20): seeded per size, editable, never stored. |
| **F** | Guide service detour | Step 9 (D22). Migration `20261224_guide_service_detour.sql` written — run it in the SQL editor (`guide_service_types jsonb`, `guide_only boolean` on both day-item tables) before saving a guide line. |
| **G** | Accommodation charge types (D23/D24) | Step 10. No schema change — each charge type is its own `item_rates` season set keyed by `meal_plan`, entered in the Library Items *Charge options* panel. Drop prompt, pinned-row pricing and season-window labels implemented in both builders; legacy items (no charge types) add exactly as before. |

---

## 10. Order of work

Done:

**1. Vehicle type master list** — applied, Settings UI present.
**2. Rate rows gain the price vector, Library Items UI** — migration applied in the SQL
editor, feature-gated grid, save + read-back + directory display.
**3. Engine reads the column (B).** Quote-time reading of `prices_by_vehicle` implemented
with tests: `vehicleTypeForPax`, `vehicleVectorPrice`, `vehicleBlockReason`, and a
`vehicleTypes` param on `calculatePackageTravellerBreakdown`. A vector cell prices the
band; `{free:true}`/`{na:true}` charge zero; an absent cell (or no vehicle that seats the
party) blocks it — `servable:false` + `blockedVehicleReasons`, row kept at zero. No
vehicle list → legacy single-price fallback, never a block. PackageBuilder now loads
`company_vehicle_types` and passes them into every breakdown.
**4. Service line = one row; locked-snapshot write path (C, D18).** `rateFor` prices a
line from its captured `rate_snapshot`, so supplier changes in the library never move a
saved package; only the explicit Update-from-library action (`refreshServiceFromLibrary`,
a new per-line refresh button on the itinerary) copies the current rate over the snapshot.
Legacy lines with no snapshot keep living on the current library rate. The snapshot also
locks the price vector. Tests added (230 total).
**5. Seasons → headers (A, D13–D16).** Schema applied in the SQL editor
(`20261222_package_seasons.sql`): additive season-header columns on
`package_validity_periods` — `name`, `accommodation_per_person`, `single_supplement` —
with existing rows backfilled. Overlay-only (D14) unchanged elsewhere.
**6. Pricing and Seasons tab in the builder (mockup → code).** `Valid dates` and
`Travellers & pricing` merge into one tab (`PricingSeasonsTab.jsx`):
- **Season strip + editor** — CRUD over the validity periods, now carrying the season
  header fields; the overlay and amber row switch with the selected season.
- **Trip-dates preview** — enter any dates to see which package season resolves (D15) and
  each accommodation line's per-contract resolution; a straddle warns and charges the
  highest overlapping rate (D16, `accommodationRatesForTrip`).
- **Up-to-6-column vehicle grid** — columns seeded from the package's own
  `vehicle_columns` chosen on the Packages list (D21), falling back to the first six
  sizes from Settings (one size per column, explicit empty sticks), bands seeded per
  size (`seedBandsForSeats`, D20) and editable ≤ seats; per-person cells priced
  `pool ÷ pax + perPerson` from `vehicleColumnPools` (annual, D14), with the per-cell
  formula, a full-width **Accommodation per person sharing** row, and the full-width
  single-supplement and child rows (B1).
- **Overlay cards** — accommodation per person + single supplement (from the season) and
  the vehicle & service pool (annual). The accommodation figure is *derived* from the
  itinerary's own accommodation lines resolved against the season's dates
  (`accommodationPerPersonForSeason`), so adding an accommodation is never a silent
  no-op; the per-season override, when set, stays locked (D18). The grid row and the
  Summary tab read the very same figure.
- **Services locked-snapshot table** — every included line with cost basis, per-column
  vehicle prices read from its own snapshot, an annual/seasonal tag with the
  accommodation's own contract window dates trailed, and per-line + *Update all*
  from-library actions (D18).
Bands left as stored content (retired, read path only); the working bands stay ephemeral (E),
but the column set itself is now part of the package (`vehicle_columns`, D21), written by
`persist()` and read by `load()`. Tests added for the new helpers (259 total).
**7. Display (§6.3).** A new **Presentation pricing** tab (renamed from *Pricing summary*)
reads the same grid via `usePricingGrid` (state lifted above the tabs — one set of columns/
bands for the costing tab and the presentation): no vehicle row (clients read no vehicle
size), full-width season line, teal Travellers cells, per-option *Price per person sharing*
cells (pool ÷ pax + per-person + accommodation), full-width amber single supplement and
pink child price, 4 columns by default with a *show more* toggle. Both presentation and
grid tabs now draw the Travellers and Price rows exactly like the mockup — two separate
rows of flex bands instead of stacked cells — with the mockup's row colours (amber season,
amber supplement, pink child, teal heads). The itinerary canvas shows each per-vehicle
line's vehicle-price pills from its own locked snapshot (the sheet's one-row-per-service
read-out). The export gains a *Presentation pricing* option: the same table, splitting to
**3 columns per block** when more vehicles are priced, marked up for a client view. All
verified: target ESLint clean, `vite build` green, tests still 259 PASS.

**8. Close-out.** Step 7 ends the planned work for the package module. Table rename
`package_validity_periods` → `package_seasons` (open item A) is the only remaining cleanup,
safe now that display reads the season columns only.
**9. Guide service detour (D22).** Applied in the SQL editor
(`20261224_guide_service_detour.sql`): `itinerary_day_items` and `package_day_items` gain
`guide_service_types jsonb` and `guide_only boolean`.
- **Shared helpers** (`guidePricing.js`): the five flat per-trip service types, their rate
  fields on the rate row (`guide_transfer_rate`, `guide_half_day_rate`, `guide_full_day_rate`,
  `guide_overland_rate`, `guide_dinner_rate`), the sum-charge and label helpers, and the
  accommodation/meal guide-rate fallback (guide room falls back to the single rate when the
  hotel does not publish one) driven by the hotel's *Guide & driver room* toggle.
- **GuideServiceTypeModal** — the add-time picker: which flat service types price this guide
  line, with the running total and a disabled Confirm until one is ticked.
- **GuideDetailsModal** — the overland follow-up: lunch and dinner from the day's meal items,
  overnight from the library's accommodation items (hotels that offer a guide/driver room are
  tagged; an overnight with no such hotel warns), a *guide & driver only* checkbox, and the
  total. The confirmed plan writes guide-only lunch/dinner/overnight lines to the day.
- Both builders wire it: the itinerary holds the add in a modal before pricing
  (`guideServiceTypes`), overland auto-opens the details step, and re-opening uses the
  current choices; the package builder does the same per day scope. Lines carry
  `guide_service_types` / `guide_only` (and `guide_for_item_key` linking the details to their
  guide on save and reload; the itinerary links by the guide item's id since a service key is
  not persisted). Removing a guide line cascades its detail lines.
- **Engine guard** (`packagePricing.js`): `isAccommodation` returns false for a `guide_only`
  line, so the guide & driver's overnight never counts as client accommodation, doubles the
  per-person figure, or seeds a room count. Tests (262 total) cover the three cases: a
  guide-only overnight alone derives no accommodation figure, is not named, and never
  doubles a client lodging beside it.
Verified: target ESLint clean (new files and the package builder; the itinerary builder
keeps its pre-existing react-compiler findings), `vite build` green, tests 259 → 262 PASS.
**10. Accommodation charge types (D23/D24).** No migration — a charge type is a set of
`item_rates` seasons carrying the same `meal_plan`, entered in the Library Items *Charge
options* panel (dedicated per-season field; each option is its own season matrix, legacy
rows with no charge type read back as the item's single board).
- **Shared helpers** (`accommodationOptions.js`): options group by `meal_plan`, each
  presenting its own seasons; `seasonChoiceLabel` formats a season with its exact window
  (`Summer: 2027/04/01-2027/08/31`) so the operator can match it to the travel dates;
  `seasonForRate` / `ratesForOption` / `rateById` pin and constrain the engine to the
  chosen (option, season).
- **AccommodationChargeModal** — the add-time picker: one radio list per charge type, its
  seasons labelled with the window and price (unpriced seasons disabled), the default being
  the season the travel dates resolve to, and the confirmed choice returned as
  `{ rateId, optionLabel }` to be pinned on the line.
- **Itinerary builder** — dropping a multi-option accommodation pauses on the picker first;
  the placement (and every repeated day) passes `roomAllocationItem.rateId` /
  `options.optionLabel` through to `createService`, which prices from the pinned row
  (`seasonForRate`) and skips pricing protection because the season is explicit.
- **Package builder** — the same picker gate on add; the package row pins the rate id, the
  per-line rate selector labels each option `season · option · from-to`, and the sidebar
  tag repeats it so the operator can check the window against the trip dates.
- Verify scope: files lint-clean, `vite build` green, package-pricing 262 PASS unchanged,
  pricing-season 57 → 72 PASS (grouping, choices, prompt gate, date formatting,
  pinned-row addability).

---

## 11. Export presentation (unchanged)

- Vehicles read `Private vehicle sized to your party` — no capacity anywhere.
- No note explaining how vehicles are sized.
- The builder canvas keeps every service visible; that is the working surface.
- Export modal is a two-column grid capped to the viewport.