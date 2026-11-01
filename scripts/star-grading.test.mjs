/* Hotel star grading: it belongs to the accommodation supplier (the property),
   and every document that names the hotel prints the same grade. */
import {
  STAR_GRADES,
  isAccommodationSupplier,
  starGlyphs,
  starLabel,
  starRatingOf,
  withStarGrade
} from '../src/lib/starGrading.js';
import { voucherDetailLines } from '../src/lib/voucherDetails.js';
import { libraryItemDetail, detailDocumentHtml } from '../src/lib/libraryItemDetail.js';

let failures = 0;
const check = (label, actual, expected) => {
  const ok = Object.is(actual, expected);
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}: got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
};
const checkJson = (label, actual, expected) => check(label, JSON.stringify(actual), JSON.stringify(expected));

checkJson('the picker offers 1 to 5 stars', STAR_GRADES, [1, 2, 3, 4, 5]);

check('a stored grade is read as a number', starRatingOf('4'), 4);
check('a numeric grade is kept', starRatingOf(5), 5);
check('ungraded stays null', starRatingOf(null), null);
check('an empty value stays null', starRatingOf(''), null);
check('zero is not a grade', starRatingOf(0), null);
check('six stars is not a grade', starRatingOf(6), null);
check('text is not a grade', starRatingOf('unrated'), null);

check('a four-star hotel prints four filled stars', starGlyphs(4), '★★★★☆');
check('an ungraded hotel prints no stars', starGlyphs(null), '');
check('the label reads as a grade', starLabel('3'), '3-star');
check('an ungraded hotel has no label', starLabel(null), '');

check('the property is named with its grade', withStarGrade('Boardwalk Hotel', 4), 'Boardwalk Hotel (4-star)');
check('an ungraded property keeps its plain name', withStarGrade('Riverside Lodge', null), 'Riverside Lodge');

check('accommodation suppliers carry the grade', isAccommodationSupplier({ category: 'Accommodation' }), true);
check('a transport supplier does not', isAccommodationSupplier({ category: 'Transportation' }), false);
check('a missing category does not', isAccommodationSupplier(null), false);

const voucher = voucherDetailLines({
  category: 'Accommodation',
  supplierStar: 4,
  roomType: 'Luxury Room',
  mealPlan: 'Bed & Breakfast'
});
check('the voucher states the hotel grade', voucher.includes('Star grading: 4-star'), true);
check('the voucher still carries the room', voucher.includes('Room type: Luxury Room'), true);
const voucherNoGrade = voucherDetailLines({ category: 'Accommodation', roomType: 'Standard Room' });
check('an ungraded hotel adds no grading line', voucherNoGrade.some((line) => line.startsWith('Star grading')), false);
const transferVoucher = voucherDetailLines({ category: 'Transfers', supplierStar: 4 });
check('a transfer never shows a hotel grade', transferVoucher.some((line) => line.startsWith('Star grading')), false);

const gradedItem = {
  id: 'h1',
  name: 'Boardwalk Hotel',
  category: 'Accommodation',
  currency: 'ZAR',
  pricing_model: 'per_room',
  supplier: { id: 's1', name: 'Boardwalk Hotel', star_rating: 5 },
  item_rates: [{
    id: 'r1',
    rate_basis: 'per_room',
    meal_plan: 'Bed & Breakfast',
    unit_price: 2800,
    price_2_adults: 2800,
    currency: 'ZAR'
  }]
};
const detail = libraryItemDetail({ item: gradedItem });
const supplierChip = detail.chips.find((chip) => chip.kind === 'supplier');
check('the rate card names the property with its stars', supplierChip?.text, 'Boardwalk Hotel · ★★★★★');
const exported = detailDocumentHtml(detail);
check('the exported card carries the grade', exported.includes('★★★★★'), true);

const ungradedDetail = libraryItemDetail({
  item: { ...gradedItem, supplier: { id: 's1', name: 'Boardwalk Hotel', star_rating: null } }
});
check(
  'an ungraded rate card shows only the property name',
  ungradedDetail.chips.find((chip) => chip.kind === 'supplier')?.text,
  'Boardwalk Hotel'
);

if (failures) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log('\nAll star-grading checks passed');
