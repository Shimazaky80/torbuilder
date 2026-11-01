/* Hotel star grading. It belongs to the property (the accommodation supplier),
   not to a room type or a season: one hotel is graded once and every room it
   sells inherits the grade. Kept as a small pure module so the itinerary,
   vouchers, packages and rate card all print the grade the same way. */

export const STAR_GRADES = [1, 2, 3, 4, 5];

/* Anything that is not a whole grade from 1 to 5 is "not graded". NULL is the
   normal case for lodges and guest houses that carry no star rating at all. */
export const starRatingOf = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 1 && parsed <= 5 ? parsed : null;
};

/* Filled / hollow stars for the screen: "★★★★☆". */
export const starGlyphs = (value) => {
  const grade = starRatingOf(value);
  return grade ? '★'.repeat(grade) + '☆'.repeat(5 - grade) : '';
};

/* Read-aloud grade for documents: "4-star". */
export const starLabel = (value) => {
  const grade = starRatingOf(value);
  return grade ? `${grade}-star` : '';
};

/* "Hotel X (4-star)" — the property name as every travel document prints it,
   unchanged when the hotel is ungraded. */
export const withStarGrade = (name, value) => {
  const label = starLabel(value);
  const text = String(name ?? '').trim();
  return label ? `${text} (${label})` : text;
};

/* The grade only means something for a hotel. Every other supplier category
   keeps the column empty, including a supplier that is switched away from
   Accommodation later. */
export const isAccommodationSupplier = (supplier) =>
  /^accommodation$/i.test(String(supplier?.category || '').trim());
