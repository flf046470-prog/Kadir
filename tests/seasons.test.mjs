import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getTrevelinSeason, getTrevelinDate, SEASON_ORDER } from '../src/components/seasons/calendar.ts';

test('each month follows the southern hemisphere calendar', () => {
  const expected = ['summer', 'summer', 'summer', 'autumn', 'autumn', 'autumn', 'winter', 'winter', 'winter', 'spring', 'spring', 'spring'];
  expected.forEach((season, month) => {
    assert.equal(getTrevelinSeason(new Date(Date.UTC(2026, month, 15, 15))), season);
  });
});

for (const [month, before, after] of [[3, 'summer', 'autumn'], [6, 'autumn', 'winter'], [9, 'winter', 'spring'], [12, 'spring', 'summer']]) {
  test(`season changes on ${month}/21 at midnight in Trevelin, not the visitor's timezone`, () => {
    const midnight = Date.UTC(2026, month - 1, 21, 3);
    assert.equal(getTrevelinSeason(new Date(midnight - 1)), before);
    assert.equal(getTrevelinSeason(new Date(midnight)), after);
    assert.equal(getTrevelinDate(new Date(midnight - 1)).day, 20);
    assert.equal(getTrevelinDate(new Date(midnight)).day, 21);
  });
}

test('year rollover and leap days remain summer', () => {
  for (const iso of ['2026-12-31T23:59:59Z', '2027-01-01T03:00:00Z', '2028-02-29T12:00:00Z']) {
    assert.equal(getTrevelinSeason(new Date(iso)), 'summer');
  }
});

test('the browser locale does not change the calendar', () => {
  assert.deepEqual(SEASON_ORDER, ['spring', 'summer', 'autumn', 'winter']);
  assert.equal(getTrevelinSeason(new Date('2026-10-15T19:18:19Z')), 'spring');
  assert.throws(() => getTrevelinSeason(new Date('invalid')), RangeError);
});
