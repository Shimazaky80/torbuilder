/* Stay X Pay Y: a promotion changes which room-nights are billed, not what a
   night costs. These checks pin the rule engine's arithmetic and the way the
   builders' consecutive-night grouping feeds it. */
import {
  emptyStayPayPromotion,
  normalizeStayPayPromotions,
  planStayPay,
  roomKeyForService,
  stayPayExcludedService,
  stayPayFreeNightIndexes,
  stayPayPromotionApplies,
  stayPayPromotionError,
  stayPayPromotionsOverlapError,
  stayPayRuleSummary
} from '../src/lib/stayPay.js';

let failures = 0;
const check = (label, actual, expected) => {
  const ok = Object.is(actual, expected);
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}: got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
};
const checkJson = (label, actual, expected) => check(label, JSON.stringify(actual), JSON.stringify(expected));

const rule = (overrides = {}) => ({
  ...emptyStayPayPromotion(),
  name: 'Stay 7 Pay 5',
  stayNights: 7,
  payNights: 5,
  ...overrides
});

check('new rule is active and repeats', `${rule().active}/${rule().repeat}`, 'true/true');
checkJson('normalization keeps a scoped room list unique', normalizeStayPayPromotions([
  { ...rule(), roomKeys: ['room_1', 'room_1', '', 'room_2'] }
])[0].roomKeys, ['room_1', 'room_2']);
checkJson('a JSON string column reads as rules', normalizeStayPayPromotions(JSON.stringify([rule({ name: 'A' })])).map((r) => r.name), ['A']);
checkJson('garbage reads as no rules', normalizeStayPayPromotions('{not json'), []);

check('a complete rule has no error', stayPayPromotionError(rule()), '');
check('a rule with no name is refused', stayPayPromotionError(rule({ name: '' })).includes('name'), true);
check('pay nights are clamped below the stay', normalizeStayPayPromotions([rule({ payNights: 7 })])[0].payNights, 6);
check('zero paid nights are refused', stayPayPromotionError(rule({ payNights: 0 })).includes('at least one'), true);
check('paying for every night is refused', stayPayPromotionError(rule({ payNights: 7 })).includes('fewer than stay nights'), true);
check('an inverted window is refused', stayPayPromotionError(rule({ validFrom: '2026-12-01', validTo: '2026-11-01' })).includes('before valid from'), true);
check('an impossible calendar date is refused', stayPayPromotionError(rule({ validFrom: '2026-02-30' })).includes('valid calendar date'), true);
check('overlapping active rules for one room are refused', stayPayPromotionsOverlapError([
  rule({ id: 'one', roomKeys: ['room_1'], validFrom: '2026-01-01', validTo: '2026-06-30' }),
  rule({ id: 'two', roomKeys: ['room_1'], validFrom: '2026-06-01', validTo: '2026-12-31' })
]).includes('overlap'), true);
check('inactive overlapping rules are allowed', stayPayPromotionsOverlapError([
  rule({ id: 'one', roomKeys: ['room_1'], validFrom: '2026-01-01', validTo: '2026-06-30' }),
  rule({ id: 'two', active: false, roomKeys: ['room_1'], validFrom: '2026-06-01', validTo: '2026-12-31' })
]), '');
check('non-overlapping room scopes can share a window', stayPayPromotionsOverlapError([
  rule({ id: 'one', roomKeys: ['room_1'] }),
  rule({ id: 'two', roomKeys: ['room_2'] })
]), '');

check('check-in inside the window applies', stayPayPromotionApplies(
  rule({ validFrom: '2026-01-01', validTo: '2026-12-31' }),
  { checkInDate: '2026-06-01' }
), true);
check('check-in before the window does not apply', stayPayPromotionApplies(
  rule({ validFrom: '2026-01-01', validTo: '2026-12-31' }),
  { checkInDate: '2025-12-31' }
), false);
check('a scoped rule only matches its room', stayPayPromotionApplies(
  rule({ roomKeys: ['room_2'] }),
  { roomKey: 'room_1', checkInDate: '2026-06-01' }
), false);
check('an unscoped rule matches any room', stayPayPromotionApplies(
  rule({ roomKeys: [] }),
  { roomKey: 'room_1', checkInDate: '2026-06-01' }
), true);
check('an undated stay only uses an open-ended offer', stayPayPromotionApplies(
  rule({ validFrom: '2026-01-01' }),
  { checkInDate: '' }
), false);

/* Cheapest nights: the 7-night cycle waives the two lowest figures. */
const values = [1000, 1000, 1200, 1200, 900, 900, 1500];
checkJson('cheapest waives the two lowest nights', [...stayPayFreeNightIndexes({
  values, stayNights: 7, payNights: 5, repeat: false, freeNightRule: 'cheapest'
})].sort((a, b) => a - b), [4, 5]);

checkJson('last waives the final nights', [...stayPayFreeNightIndexes({
  values, stayNights: 7, payNights: 5, repeat: false, freeNightRule: 'last'
})].sort((a, b) => a - b), [5, 6]);

const spread = [...stayPayFreeNightIndexes({
  values, stayNights: 7, payNights: 5, repeat: false, freeNightRule: 'every_nth'
})].sort((a, b) => a - b);
check('spread waives exactly two nights', spread.length, 2);
check('spread keeps the free nights inside the cycle', spread.every((index) => index >= 0 && index < 7), true);

/* Repeating across a 14-night stay doubles the free nights; without repeat the
   second cycle is charged in full. */
const fourteen = Array.from({ length: 14 }, (_, index) => 1000 + index);
check('repeat earns two free nights per full cycle', stayPayFreeNightIndexes({
  values: fourteen, stayNights: 7, payNights: 5, repeat: true, freeNightRule: 'last'
}).size, 4);
check('no repeat earns only the first cycle', stayPayFreeNightIndexes({
  values: fourteen, stayNights: 7, payNights: 5, repeat: false, freeNightRule: 'last'
}).size, 2);
check('a partial last cycle earns nothing', stayPayFreeNightIndexes({
  values: fourteen.slice(0, 10), stayNights: 7, payNights: 5, repeat: true, freeNightRule: 'last'
}).size, 2);

check('max free nights caps the award', stayPayFreeNightIndexes({
  values: fourteen, stayNights: 7, payNights: 5, repeat: true, freeNightRule: 'last', maxFreeNights: 3
}).size, 3);

/* Two rules: the bigger saving wins and the other does not also waive a night. */
const nights = Array.from({ length: 7 }, (_, index) => ({
  date: `2026-06-0${index + 1}`,
  value: index === 6 ? 5000 : 1000
}));
const best = planStayPay({
  nights,
  promotions: [
    rule({ id: 'a', name: 'Cheapest', freeNightRule: 'cheapest', validFrom: '2026-01-01', validTo: '2026-12-31' }),
    rule({ id: 'b', name: 'Last', freeNightRule: 'last', validFrom: '2026-01-01', validTo: '2026-12-31' })
  ]
});
check('the rule with the bigger saving wins', best.rule.name, 'Last');
check('only that rule stamps the free nights', [...best.freeIndexes].sort((a, b) => a - b).join(','), '5,6');
check('saving is the waived money', best.saving, 6000);

/* A gap splits the stay into two runs, each with its own check-in. */
const split = planStayPay({
  nights: [
    { date: '2026-06-01', value: 1000 },
    { date: '2026-06-02', value: 1000 },
    { date: '2026-06-03', value: 1000 },
    { date: '2026-06-04', value: 1000 },
    { date: '2026-06-05', value: 1000 },
    { date: '2026-06-06', value: 1000 },
    { date: '2026-06-07', value: 1000 },
    { date: '2026-06-10', value: 1000 },
    { date: '2026-06-11', value: 1000 },
    { date: '2026-06-12', value: 1000 },
    { date: '2026-06-13', value: 1000 },
    { date: '2026-06-14', value: 1000 },
    { date: '2026-06-15', value: 1000 },
    { date: '2026-06-16', value: 1000 }
  ],
  promotions: [rule({ repeat: false })]
});
check('a gap starts a new stay, each earning its own free nights', split.freeIndexes.size, 4);

/* Duplicate dates are one room-night: the two lines are summed into one value,
   and a free night stamps every line sitting on that date. */
const duplicate = planStayPay({
  nights: [
    { date: '2026-06-01', value: 500 },
    { date: '2026-06-01', value: 500 },
    { date: '2026-06-02', value: 1000 }
  ],
  promotions: [rule({ stayNights: 2, payNights: 1, repeat: false, freeNightRule: 'cheapest' })]
});
check('duplicate dates count as one room-night', duplicate.saving, 1000);
check('every line on the free date is stamped', duplicate.freeIndexes.size, 2);

/* A later stay at the same property is tested against its own check-in, so a
   window that closed before it arrived does not waive its nights. */
const lateRun = planStayPay({
  nights: [
    ...Array.from({ length: 7 }, (_, index) => ({ date: `2026-06-0${index + 1}`, value: 1000 })),
    ...Array.from({ length: 7 }, (_, index) => ({ date: `2026-12-0${index + 1}`, value: 1000 }))
  ],
  promotions: [rule({ repeat: false, validFrom: '2026-01-01', validTo: '2026-06-30' })]
});
check('a later stay outside the window earns nothing', lateRun.freeIndexes.size, 2);

const earlyRun = planStayPay({
  nights: [
    ...Array.from({ length: 7 }, (_, index) => ({ date: `2026-01-0${index + 1}`, value: 1000 })),
    ...Array.from({ length: 7 }, (_, index) => ({ date: `2026-12-0${index + 1}`, value: 1000 }))
  ],
  promotions: [rule({ repeat: false, validFrom: '2026-12-01', validTo: '2026-12-31' })]
});
check('a later stay inside the window still earns', earlyRun.freeIndexes.size, 2);

/* Room scope and builder exclusions. */
const item = {
  room_types: [
    { id: 'uuid-1', key: 'room_1', name: 'Standard' },
    { id: 'uuid-2', key: 'room_2', name: 'Sea View' }
  ]
};
check('a line maps back to its library room key', roomKeyForService({ roomTypeId: 'uuid-2' }, item), 'room_2');
check('a line with only a room name maps back too', roomKeyForService({ roomType: 'Standard' }, item), 'room_1');
check('an optional line is excluded', stayPayExcludedService({ isOptional: true }), true);
check('a guide bed is excluded', stayPayExcludedService({ guideOnly: true }), true);
check('a normal client room is included', stayPayExcludedService({ isOptional: false }), false);

check('summary names the cycle and the window', stayPayRuleSummary(
  rule({ validFrom: '2026-01-01', validTo: '2026-12-31' })
).includes('Stay 7, pay 5'), true);
check('summary gives a live promotion preview', stayPayRuleSummary(rule()).includes('A 7-night stay pays 5 nights; the 2 cheapest nights are free.'), true);

if (failures) {
  console.error(`\n${failures} stay-pay check(s) failed`);
  process.exit(1);
}
console.log('\nAll stay-pay checks passed');
