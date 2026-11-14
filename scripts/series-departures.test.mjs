import {
  BOOKING_STATUSES,
  DEPARTURE_STATUSES,
  WEEKDAYS,
  addDays,
  departureCode,
  departureStatusLabel,
  generateDepartureDates,
  isoWeekday,
  releaseDateFor,
  resolveDepartureStatus,
  returnDateFor,
  seatRollup,
  templateDuration,
  toISODate,
  weekdayLabel
} from '../src/lib/seriesDepartures.js';

let failures = 0;
const check = (label, actual, expected) => {
  const passed = JSON.stringify(actual) === JSON.stringify(expected);
  if (!passed) failures += 1;
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${label}: got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
};

console.log('\n--- Running Series Departures Verification Tests ---\n');

/* 1. A departure date is a calendar day, not an instant. These anchors are
      checked against the UTC calendar so a machine in any timezone agrees. */
check('the week starts on Monday for an operator', WEEKDAYS.map((day) => day.value), [1, 2, 3, 4, 5, 6, 7]);
check('the weekday names read as spoken', WEEKDAYS.map((day) => day.short), ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
check('2028-01-03 is a Monday', isoWeekday('2028-01-03'), 1);
check('2028-01-06 is a Thursday', isoWeekday('2028-01-06'), 4);
check('2028-12-31 is a Sunday', isoWeekday('2028-12-31'), 7);
check('a weekday answers for a date only', isoWeekday('2028-01-03T23:30:00-05:00'), 1);
check('an impossible day is not normalised into a real one', isoWeekday('2028-02-30'), null);
check('a leap day exists in 2028', isoWeekday('2028-02-29'), 2);
check('nonsense is not a date', isoWeekday('soon'), null);
check('nothing is not a date', isoWeekday(null), null);
check('a date formats back to the same ten characters', toISODate(Date.UTC(2028, 0, 3)), '2028-01-03');
check('adding days crosses a month end', addDays('2028-01-31', 1), '2028-02-01');
check('adding days crosses a year end', addDays('2028-12-31', 1), '2029-01-01');
check('subtracting days crosses a month end', addDays('2028-03-01', -1), '2028-02-29');
check('weekday labels name the day', weekdayLabel(4), 'Thursday');

/* 2. The schedule generates the days the template operates, inside its window
      and nowhere else. Both ends are inclusive: a tour valid to 31 December
      still runs on 31 December. */
const january = generateDepartureDates({ operatesOn: [1, 4], validFrom: '2028-01-01', validTo: '2028-01-31' });
check('Monday and Thursday across January', january, [
  '2028-01-03', '2028-01-06', '2028-01-10', '2028-01-13', '2028-01-17',
  '2028-01-20', '2028-01-24', '2028-01-27', '2028-01-31'
]);
check('the window is inclusive at both ends', generateDepartureDates({ operatesOn: [1], validFrom: '2028-01-03', validTo: '2028-01-03' }), ['2028-01-03']);
check('a schedule crossing the new year keeps both years', generateDepartureDates({ operatesOn: [1, 4], validFrom: '2028-12-28', validTo: '2029-01-04' }), ['2028-12-28', '2029-01-01', '2029-01-04']);
check('a leap February gets its Mondays and not the Tuesday', generateDepartureDates({ operatesOn: [1], validFrom: '2028-02-01', validTo: '2028-02-29' }), ['2028-02-07', '2028-02-14', '2028-02-21', '2028-02-28']);
check('no weekdays chosen is an unfinished template, not a daily tour', generateDepartureDates({ operatesOn: [], validFrom: '2028-01-01', validTo: '2028-01-31' }), []);
check('a reversed window generates nothing', generateDepartureDates({ operatesOn: [1], validFrom: '2028-02-01', validTo: '2028-01-01' }), []);
check('a missing window generates nothing', generateDepartureDates({ operatesOn: [1], validFrom: '2028-01-01' }), []);
check('an out-of-range weekday is dropped', generateDepartureDates({ operatesOn: [0, 8, 'x', 4], validFrom: '2028-01-01', validTo: '2028-01-07' }), ['2028-01-06']);
check('a weekday given as text still operates', generateDepartureDates({ operatesOn: ['1'], validFrom: '2028-01-01', validTo: '2028-01-07' }), ['2028-01-03']);

/* 3. Re-generating is additive. A departure that may already be sold is never
      produced twice, and a schedule change cannot silently cancel one. */
check('an existing departure is not generated again', generateDepartureDates({
  operatesOn: [1, 4], validFrom: '2028-01-01', validTo: '2028-01-10', existing: ['2028-01-03', '2028-01-06']
}), ['2028-01-10']);
check('generating twice adds nothing the second time', generateDepartureDates({
  operatesOn: [1, 4], validFrom: '2028-01-01', validTo: '2028-01-31', existing: january
}), []);
check('a dropped weekday leaves the sold departure alone', generateDepartureDates({
  operatesOn: [1], validFrom: '2028-01-01', validTo: '2028-01-10', existing: ['2028-01-06']
}), ['2028-01-03', '2028-01-10']);

/* 4. The codes and dates an operator reads on the calendar. */
check('the departure code is the date it leaves', departureCode('2028-01-05'), 'DEP-280105');
check('a bad date has no code', departureCode('2028-02-30'), '');
check('a seven day tour leaving on the fifth returns on the eleventh', returnDateFor('2028-01-05', 7), '2028-01-11');
check('a one day tour returns the same day', returnDateFor('2028-01-05', 1), '2028-01-05');
check('an unstated duration is a day, not a negative trip', returnDateFor('2028-01-05', 0), '2028-01-05');
/* The spec's own example: 30 days release on a 1 June arrival is 2 May. */
check('thirty days before the first of June is the second of May', releaseDateFor('2028-06-01', 30), '2028-05-02');
check('no release period is no release date', releaseDateFor('2028-06-01', 0), null);
check('an unset release period is not today', releaseDateFor('2028-06-01', null), null);
check('the duration comes from the package days', templateDuration([{ day_number: 1 }, { day_number: 7 }, { day_number: 3 }]), { durationDays: 7, durationNights: 6 });
check('a package with no days has no duration', templateDuration([]), { durationDays: 0, durationNights: 0 });
check('a day tour has no nights', templateDuration([{ day_number: 1 }]), { durationDays: 1, durationNights: 0 });

/* 5. The ledger is the authority on seats. Options are reported beside the sold
      count, because the database holds confirmed seats against the cap. */
const ledger = [
  { seats: 4, status: 'confirmed' },
  { seats: 2, status: 'confirmed' },
  { seats: 3, status: 'provisional' },
  { seats: 2, status: 'waitlist' },
  { seats: 5, status: 'cancelled' },
  { seats: 1, status: 'completed' }
];
check('sold counts confirmed and completed only', seatRollup(ledger, 20).sold, 7);
check('an option is held beside the sold count', seatRollup(ledger, 20).optioned, 3);
check('the waitlist is counted apart', seatRollup(ledger, 20).waitlisted, 2);
check('a cancellation gives its seats back', seatRollup([{ seats: 4, status: 'cancelled' }], 20).sold, 0);
check('remaining is what the cap still holds', seatRollup(ledger, 20).remaining, 13);
check('a full departure has no seats remaining', seatRollup([{ seats: 20, status: 'confirmed' }], 20).remaining, 0);
check('an over-sold ledger never reports negative seats', seatRollup([{ seats: 25, status: 'confirmed' }], 20).remaining, 0);
check('no cap stated is not no seats', seatRollup(ledger, 0).remaining, null);
check('an empty ledger sells nothing', seatRollup([], 20), { sold: 0, optioned: 0, waitlisted: 0, capacity: 20, remaining: 20 });
check('a malformed row is not a sale', seatRollup([null, { seats: 'x', status: 'confirmed' }, { seats: 2 }], 20).sold, 0);
check('the booking statuses are the ones the ledger understands', BOOKING_STATUSES, ['provisional', 'confirmed', 'waitlist', 'cancelled', 'completed']);

/* 6. The status machine. The minimum makes a departure guaranteed; the cap makes
      it a waitlist; and a decision somebody took is never overwritten by arithmetic. */
check('the statuses are the ones the calendar offers', DEPARTURE_STATUSES, ['open', 'guaranteed', 'waitlist', 'closed', 'cancelled', 'completed']);
check('below the minimum the departure is open', resolveDepartureStatus({ sold: 6, guaranteeMin: 8 }), 'open');
check('at the minimum it is guaranteed', resolveDepartureStatus({ sold: 8, guaranteeMin: 8 }), 'guaranteed');
check('above the minimum it stays guaranteed', resolveDepartureStatus({ sold: 12, guaranteeMin: 8 }), 'guaranteed');
check('no minimum means no automatic guarantee', resolveDepartureStatus({ sold: 12, guaranteeMin: 0 }), 'open');
check('a full departure takes a waitlist', resolveDepartureStatus({ sold: 20, capacity: 20, guaranteeMin: 8 }), 'waitlist');
check('a waitlist outranks a guarantee once the seats are gone', resolveDepartureStatus({ current: 'guaranteed', sold: 20, capacity: 20 }), 'waitlist');
/* Guaranteed is a promise to the supplier: a later cancellation does not un-run
   the tour. Only an operator un-declares it. */
check('a cancellation does not un-guarantee a departure', resolveDepartureStatus({ current: 'guaranteed', sold: 5, guaranteeMin: 8 }), 'guaranteed');
check('an operator may declare a guarantee by hand', resolveDepartureStatus({ current: 'guaranteed', sold: 0, guaranteeMin: 0 }), 'guaranteed');
check('a closed departure stays closed whatever sells', resolveDepartureStatus({ current: 'closed', sold: 20, capacity: 20, guaranteeMin: 8 }), 'closed');
check('a cancelled departure stays cancelled', resolveDepartureStatus({ current: 'cancelled', sold: 9, guaranteeMin: 8 }), 'cancelled');
check('a completed departure stays completed', resolveDepartureStatus({ current: 'completed', sold: 9, guaranteeMin: 8 }), 'completed');
check('an unknown status falls back to open', resolveDepartureStatus({ current: 'nonsense', sold: 1 }), 'open');
check('no arguments at all is an open departure', resolveDepartureStatus(), 'open');
check('every status has a label an operator reads', DEPARTURE_STATUSES.map(departureStatusLabel), ['Open', 'Guaranteed', 'Waitlist', 'Closed', 'Cancelled', 'Completed']);

console.log(failures
  ? `\n${failures} series departure example(s) FAILED\n`
  : '\nAll Series Departures verification examples PASSED successfully!\n');
if (failures) process.exitCode = 1;