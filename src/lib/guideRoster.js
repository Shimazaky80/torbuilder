/* The guide as a person, next to the guide as a rate.

   Pricing was never the problem: one destination contract legitimately serves a
   hundred guides, and it stays exactly where it is - on the Guide item's season
   row. What that rate cannot carry is who was actually paid, and the fact that a
   few guides cost more than the standard.

   So the person lives in `guide_members` and carries a percentage uplift. This
   module is the only place that combines the two, so a guide fee cannot be
   worked out one way in the itinerary preview and another way on the invoice.

   The uplift is a cost, never a sell. It moves the buy figure of a guide line
   like any other crew charge and has nothing to do with the party count, the
   per-person sell, or the clients' price. It also never touches a guide's lunch
   or bed: those are what a property charges for a crew room or a crew meal, and
   a senior guide is not charged more for eating. */

import { supabase } from './supabase';

export const GUIDE_MEMBER_FIELDS = [
  'id', 'company_id', 'first_name', 'last_name', 'date_of_birth', 'national_id',
  'passport_number', 'tax_number', 'licence_number', 'email', 'phone', 'city',
  'destination_area', 'supplier_id', 'rate_uplift_percent', 'is_active', 'notes'
];

const round2 = (value) => Math.round((Number(value) || 0) * 100) / 100;

export const guideMemberName = (member) => [member?.first_name, member?.last_name]
  .filter((part) => String(part || '').trim())
  .join(' ')
  .trim();

/* A percentage typed by a human, so a negative or a stray text is not a discount. */
export const guideUpliftPercent = (member) => {
  const parsed = Number(member?.rate_uplift_percent ?? member?.rateUpliftPercent);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
};

/* What the standard rate becomes for this person. Called once, on the fee. */
export const applyGuideUplift = (amount, member) => {
  const base = Number(amount) || 0;
  const percent = guideUpliftPercent(member);
  return percent > 0 ? round2(base * (1 + percent / 100)) : round2(base);
};

/* Where the guide's own crew room / meal would be found, so the picker can say
   "local" without hiding anybody. */
const destinationKeys = (member) => [member?.destination_area, member?.destinationArea, member?.city]
  .map((value) => String(value || '').trim().toLowerCase())
  .filter(Boolean);

export const guideMemberMatchesDestination = (member, destination) => {
  const wanted = String(destination || '').trim().toLowerCase();
  if (!wanted) return false;
  return destinationKeys(member).some((key) => key === wanted || key.includes(wanted) || wanted.includes(key));
};

/* Guides for this destination first, then everyone else, each group alphabetical.
   Never a filter that hides the only guide who can do the job: an empty "local"
   group still shows the rest below a divider rather than an empty picker. */
export const guideMembersByDestination = (members = [], destination) => {
  const active = (Array.isArray(members) ? members : []).filter((member) => member && member.is_active !== false);
  const byName = (a, b) => guideMemberName(a).localeCompare(guideMemberName(b));
  const here = [];
  const elsewhere = [];
  active.forEach((member) => (guideMemberMatchesDestination(member, destination) ? here : elsewhere).push(member));
  return { here: here.sort(byName), elsewhere: elsewhere.sort(byName) };
};

/* The identity frozen onto the line at the moment it is priced. */
export const guideMemberSnapshot = (member, { baseCharge = 0, charged = 0, supplierName = '' } = {}) => {
  if (!member) return null;
  return {
    name: guideMemberName(member) || 'Guide',
    first_name: member.first_name || '',
    last_name: member.last_name || '',
    national_id: member.national_id || '',
    passport_number: member.passport_number || '',
    tax_number: member.tax_number || '',
    licence_number: member.licence_number || '',
    supplier_name: supplierName || '',
    base_charge: round2(baseCharge),
    uplift_percent: guideUpliftPercent(member),
    charged: round2(charged)
  };
};

/* What one guide line costs with a named person on it.

   `baseCharge` is the destination's flat per-trip sum for the service types
   picked - the contract money, untouched. The person only changes that one
   number, and the snapshot records both what was charged and what it would have
   been, so a premium guide is explainable on the invoice and not just dearer.

   With no person named nothing changes: the base is the charge and there is no
   snapshot to stamp. */
export const priceGuideLine = ({ baseCharge = 0, member = null, supplierName = '' } = {}) => {
  const base = round2(baseCharge);
  if (!member) return { baseCharge: base, charged: base, snapshot: null };
  const charged = applyGuideUplift(base, member);
  return {
    baseCharge: base,
    charged,
    snapshot: guideMemberSnapshot(member, { baseCharge: base, charged, supplierName })
  };
};

/* The snapshot is what a saved line reads, so a guide renamed or retuned last
   week cannot quietly rewrite a figure that has already been invoiced. */
export const guideSnapshotCharge = (snapshot) => round2(Number(snapshot?.charged ?? snapshot?.base_charge) || 0);

export const guideSnapshotUplift = (snapshot) => {
  const parsed = Number(snapshot?.uplift_percent);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
};

export const guideSnapshotName = (snapshot) => String(snapshot?.name || '').trim();

/* Line text: "John Michael · +10%". Only a named guide is worth a stamp. */
export const guideStampLabel = (snapshot) => {
  const name = guideSnapshotName(snapshot);
  if (!name) return '';
  const percent = guideSnapshotUplift(snapshot);
  return percent > 0 ? `${name} · +${percent}%` : name;
};

/* ---- Loading the directory ---------------------------------------------- */

/* PostgREST rejects a whole select when any one column is missing, so asking for
   guide_members on a workspace that has not applied the migration would not just
   lose the picker - it would throw on every load that included it. The fetch
   therefore reports whether the directory is there at all, and a builder with no
   directory prices guides exactly as it did before: one rate, no name. */
export const fetchGuideMembers = async (companyId) => {
  if (!companyId) return { members: [], ready: false };
  const { data, error } = await supabase
    .from('guide_members')
    .select(`${GUIDE_MEMBER_FIELDS.join(', ')}, suppliers(name)`)
    .eq('company_id', companyId)
    .eq('is_active', true)
    .order('first_name', { ascending: true })
    .order('last_name', { ascending: true });
  if (error) return { members: [], ready: false };
  return { members: data || [], ready: true };
};

/* The directory entry a saved line points at, or null when the guide has since
   been deleted - the snapshot on the line is what the invoice said, so a missing
   person never changes a figure. */
export const guideMembersById = (members = []) => {
  const map = {};
  (Array.isArray(members) ? members : []).forEach((member) => {
    if (member?.id) map[member.id] = member;
  });
  return map;
};

export const guideMemberSupplierName = (member) => String(member?.suppliers?.name || '').trim();
