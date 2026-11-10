/** Kiểm thử chuỗi chăm sóc hiện tại theo ngày Việt Nam, tách biệt kỷ lục cao nhất và loại giá trị sai. */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getCurrentPlantStreak } from '../src/utils/plantStreak';

const now = new Date('2026-11-04T03:00:00Z');

test('current plant streak retains today or yesterday only, independently of its best record', () => {
  assert.equal(getCurrentPlantStreak({ streak: 4, lastCheckIn: '2026-11-04' }, now), 4);
  assert.equal(getCurrentPlantStreak({ streak: 4, lastCheckIn: '2026-11-03' }, now), 4);
  assert.equal(getCurrentPlantStreak({ streak: 20, lastCheckIn: '2026-11-02' }, now), 0);
  assert.equal(getCurrentPlantStreak({ streak: 20, lastCheckIn: null }, now), 0);
  assert.equal(getCurrentPlantStreak({ streak: 20, lastCheckIn: '2026-11-05' }, now), 0);
  assert.equal(getCurrentPlantStreak({ streak: 20, lastCheckIn: 'not-a-date' }, now), 0);
});

test('Vietnam midnight expires a missed-day streak rather than following the host timezone', () => {
  const plant = { streak: 5, lastCheckIn: '2026-11-02' };
  assert.equal(getCurrentPlantStreak(plant, new Date('2026-11-03T16:59:59Z')), 5);
  assert.equal(getCurrentPlantStreak(plant, new Date('2026-11-03T17:00:00Z')), 0);
  assert.equal(getCurrentPlantStreak({ streak: 5, lastCheckIn: '2026-11-03' }, new Date('2026-11-03T17:00:00Z')), 5);
});

test('displaying a current streak is non-mutating and rejects negative, fractional or non-finite values', () => {
  for (const streak of [0, -1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(getCurrentPlantStreak({ streak, lastCheckIn: '2026-11-04' }, now), 0);
  }
  const plant = { streak: 12, bestStreak: 50, lastCheckIn: '2026-10-30' };
  const copy = { ...plant };
  assert.equal(getCurrentPlantStreak(plant, now), 0);
  assert.deepEqual(plant, copy);
});
