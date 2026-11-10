/** Tạo và sắp xếp từng thú nuôi; tính giá bán, tài nguyên hoàn trả và danh sách bán nhanh hoặc nguyên liệu nâng sao, đồng thời giữ lại cá thể cuối mỗi loài. */

import { PET_SPECIES } from '../data/seed';
import { PET_SALE_PRICES } from '../data/petProgression';
import { SHOP_CATALOG } from '../data/economy';
import type { AppState, PetFoodLedger, PetInstance, PetRarity, PetView } from '../types/app';

export const PET_RARITY_ORDER: Record<PetRarity, number> = {
  'Thường': 0, 'Không phổ biến': 1, 'Hiếm': 2, 'Sử thi': 3, 'Huyền thoại': 4,
};

export function addFoodLedgers(...ledgers: readonly PetFoodLedger[]): PetFoodLedger {
  const total: PetFoodLedger = {};
  for (const ledger of ledgers) for (const [id, quantity] of Object.entries(ledger)) {
    if (!SHOP_CATALOG.some((item) => item.itemId === id) || !Number.isSafeInteger(quantity) || quantity < 0) {
      throw new Error('Lịch sử thức ăn không hợp lệ.');
    }
    const next = (total[id] ?? 0) + quantity;
    if (!Number.isSafeInteger(next)) throw new Error('Số lượng thức ăn vượt giới hạn.');
    if (next) total[id] = next;
  }
  return total;
}

export function createPetInstance(speciesId: string, id: string): PetInstance {
  if (!id.trim() || !PET_SPECIES.some((species) => species.id === speciesId)) throw new Error('Hồ sơ thú nuôi không hợp lệ.');
  return { id, speciesId, level: 1, experience: 0, stars: 1,
    foodSpent: {}, upgradeFoodSpent: {}, upgradeGoldSpent: 0, baseCopies: 1 };
}

export function comparePetViews(a: PetView, b: PetView): number {
  return PET_RARITY_ORDER[b.rarity] - PET_RARITY_ORDER[a.rarity]
    || b.stars - a.stars || b.level - a.level || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

export function getPetViews(pets: readonly PetInstance[]): PetView[] {
  return pets.map((pet) => {
    const species = PET_SPECIES.find((entry) => entry.id === pet.speciesId);
    if (!species) throw new Error('Không tìm thấy loài thú nuôi.');
    return { ...species, ...pet };
  }).sort(comparePetViews);
}

export function getPetSaleRefund(pet: PetInstance): { gold: number; foods: PetFoodLedger } {
  const species = PET_SPECIES.find((entry) => entry.id === pet.speciesId);
  if (!species || ![1, 2, 3].includes(pet.stars) || !Number.isSafeInteger(pet.baseCopies)
    || pet.baseCopies !== ({ 1: 1, 2: 3, 3: 6 }[pet.stars])
    || !Number.isSafeInteger(pet.upgradeGoldSpent)
    || pet.upgradeGoldSpent !== ({ 1: 0, 2: 200, 3: 700 }[pet.stars])) throw new Error('Chi phí thú nuôi không hợp lệ.');
  const gold = PET_SALE_PRICES[species.rarity] * pet.baseCopies + pet.upgradeGoldSpent;
  if (!Number.isSafeInteger(gold)) throw new Error('Giá bán thú nuôi vượt giới hạn.');
  return { gold, foods: addFoodLedgers(pet.foodSpent, pet.upgradeFoodSpent) };
}

/** Quote exact IDs; last-of-species protection is enforced by the committing sale. */
export function quoteSale(current: Pick<AppState, 'inventory'>, petIds: readonly string[]) {
  if (!petIds.length || new Set(petIds).size !== petIds.length) throw new Error('Hãy chọn các thú nuôi khác nhau để bán.');
  const selected = petIds.map((id) => {
    const pet = current.inventory.pets.find((entry) => entry.id === id);
    if (!pet) throw new Error('Thú nuôi đã thay đổi. Hãy chọn lại.');
    return pet;
  });
  let gold = 0;
  let foods: PetFoodLedger = {};
  for (const pet of selected) {
    const refund = getPetSaleRefund(pet);
    gold += refund.gold;
    if (!Number.isSafeInteger(gold)) throw new Error('Tổng vàng vượt giới hạn.');
    foods = addFoodLedgers(foods, refund.foods);
  }
  return { gold, foods, petIds: [...petIds], quantity: selected.length };
}

/** Reserve the strongest individual of each species, then select only fresh 1★ pets. */
export function getQuickSalePetIds(pets: readonly PetInstance[], rarities: readonly PetRarity[]): string[] {
  const ordered = getPetViews(pets);
  const retained = new Set<string>();
  return ordered.filter((pet) => {
    if (!retained.has(pet.speciesId)) { retained.add(pet.speciesId); return false; }
    return pet.stars === 1 && pet.level === 1 && rarities.includes(pet.rarity);
  }).map((pet) => pet.id);
}

export function getEligibleUpgradeMaterials(pets: readonly PetInstance[], targetId: string): PetInstance[] {
  const target = pets.find((pet) => pet.id === targetId);
  return target ? pets.filter((pet) => pet.id !== targetId && pet.speciesId === target.speciesId && pet.stars === 1) : [];
}

export function quoteMaterialRefund(materialPets: readonly PetInstance[]): { foods: PetFoodLedger } {
  if (new Set(materialPets.map((pet) => pet.id)).size !== materialPets.length || materialPets.some((pet) => pet.stars !== 1)) {
    throw new Error('Nguyên liệu phải là các thú nuôi 1 sao khác nhau.');
  }
  return { foods: addFoodLedgers(...materialPets.map((pet) => pet.foodSpent)) };
}
