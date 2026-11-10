/** Tính chuỗi chăm sóc hiện còn hiệu lực theo lần kiểm tra gần nhất và ngày Việt Nam; không sửa kỷ lục hoặc trao lại quà chuỗi. */

import { localDateKey, offsetLocalDate } from '../data/seed';
import type { Plant } from '../types/app';

/** A stored streak is still active through the next Vietnam day only.
 * Displaying it never rewrites the best record or inspection/streak rewards.
 */
export function getCurrentPlantStreak(plant: Pick<Plant, 'streak' | 'lastCheckIn'>, now = new Date()): number {
  if (!Number.isSafeInteger(plant.streak) || plant.streak <= 0) return 0;
  return plant.lastCheckIn === localDateKey(now) || plant.lastCheckIn === offsetLocalDate(-1, now)
    ? plant.streak : 0;
}
