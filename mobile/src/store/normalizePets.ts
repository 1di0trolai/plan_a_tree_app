/** Kiểm tra từng thú nuôi và sổ tài nguyên hoàn trả, đồng thời chuyển kho gộp cũ thành các cá thể riêng. Từ chối sổ bị lỗi thay vì âm thầm làm mất tài nguyên. */

import { PET_SPECIES } from '../data/seed';
import { PET_STAR_UPGRADES, PET_UPGRADE_FOOD_IDS } from '../data/petProgression';
import type { PetInstance } from '../types/app';

type RecordValue = Record<string, unknown>;
const isRecord = (value: unknown): value is RecordValue => !!value && typeof value === 'object' && !Array.isArray(value);
const isSpecies = (id: unknown): id is string => typeof id === 'string' && PET_SPECIES.some((pet) => pet.id === id);
const nonnegativeInteger = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

/** Reject corrupt refund ledgers instead of silently erasing earned resources. */
function foodLedger(value: unknown): Record<string, number> {
  if (!isRecord(value)) throw new Error('Sổ thức ăn của thú nuôi bị lỗi. Dữ liệu gốc được giữ nguyên.');
  const result: Record<string, number> = {};
  for (const [id, quantity] of Object.entries(value)) {
    if (!PET_UPGRADE_FOOD_IDS.includes(id) || !nonnegativeInteger(quantity)) {
      throw new Error('Sổ thức ăn của thú nuôi bị lỗi. Dữ liệu gốc được giữ nguyên.');
    }
    if (quantity) result[id] = quantity;
  }
  return result;
}

/** Version 4 has individual progress; never reconstruct it from old pack history. */
export function normalizePetInstances(value: unknown): PetInstance[] {
  if (!Array.isArray(value)) throw new Error('Danh sách thú nuôi bị lỗi. Không tự động xóa kho.');
  const seen = new Set<string>();
  return value.map((raw) => {
    if (!isRecord(raw) || typeof raw.id !== 'string' || !raw.id || seen.has(raw.id) || !isSpecies(raw.speciesId)
      || !nonnegativeInteger(raw.level) || raw.level < 1 || !nonnegativeInteger(raw.experience)
      || (raw.stars !== 1 && raw.stars !== 2 && raw.stars !== 3)
      || !nonnegativeInteger(raw.upgradeGoldSpent) || !nonnegativeInteger(raw.baseCopies) || raw.baseCopies < 1) {
      throw new Error('Hồ sơ thú nuôi bị lỗi. Không tự động ghi đè kho đã lưu.');
    }
    seen.add(raw.id);
    return { id: raw.id, speciesId: raw.speciesId, level: raw.level, experience: raw.experience, stars: raw.stars,
      foodSpent: foodLedger(raw.foodSpent), upgradeFoodSpent: foodLedger(raw.upgradeFoodSpent),
      upgradeGoldSpent: raw.upgradeGoldSpent, baseCopies: raw.baseCopies };
  });
}

/** Old rows model one trained pet plus untrained spare copies, not N trained pets. */
export function migrateLegacyPets(value: unknown): PetInstance[] {
  if (!Array.isArray(value)) return [];
  const result: PetInstance[] = [];
  const seen = new Set<string>();
  for (const raw of value) {
    if (!isRecord(raw) || !isSpecies(raw.id)) continue;
    if (seen.has(raw.id) || !nonnegativeInteger(raw.quantity) || raw.quantity > 10_000) {
      // This is a safety check, not a silent cap: preserve the original save on failure.
      throw new Error('Số lượng thú nuôi cũ không hợp lệ. Dữ liệu gốc được giữ nguyên.');
    }
    seen.add(raw.id);
    const stars = raw.stars === 2 || raw.stars === 3 ? raw.stars : 1;
    const steps = stars === 3 ? [PET_STAR_UPGRADES[2], PET_STAR_UPGRADES[3]]
      : stars === 2 ? [PET_STAR_UPGRADES[2]] : [];
    const upgradeFoodQuantity = steps.reduce((sum, step) => sum + step.foodQuantity, 0);
    for (let index = 0; index < raw.quantity; index++) {
      const primary = index === 0;
      result.push({ id: `legacy-${raw.id}-${index + 1}`, speciesId: raw.id,
        level: primary && nonnegativeInteger(raw.level) ? Math.max(1, raw.level) : 1,
        experience: primary && nonnegativeInteger(raw.experience) ? raw.experience : 0,
        stars: primary ? stars : 1,
        // Historical individual feeding was not recorded. Never invent a refund.
        foodSpent: {},
        upgradeFoodSpent: primary && upgradeFoodQuantity
          ? Object.fromEntries(PET_UPGRADE_FOOD_IDS.map((id) => [id, upgradeFoodQuantity])) : {},
        upgradeGoldSpent: primary ? steps.reduce((sum, step) => sum + step.gold, 0) : 0,
        baseCopies: primary ? 1 + steps.reduce((sum, step) => sum + step.copies, 0) : 1 });
    }
  }
  return result;
}
