/** Kiểm tra lịch sử bán, nâng sao và cho ăn trong bản lưu; giữ mã giao dịch, thú đã chọn và tài nguyên hoàn trả để tránh xử lý lặp. */

import { SHOP_CATALOG } from '../data/economy';
import type { FoodPurchase, PetFoodLedger, PetTransaction } from '../types/app';

type Raw = Record<string, unknown>;
const isRecord = (value: unknown): value is Raw => !!value && typeof value === 'object' && !Array.isArray(value);
const positive = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
const isFood = (value: unknown): value is string => typeof value === 'string' && SHOP_CATALOG.some((food) => food.itemId === value);
const ids = (value: unknown): value is string[] => Array.isArray(value) && value.length > 0
  && value.every((id) => typeof id === 'string' && !!id) && new Set(value).size === value.length;
const ledger = (value: unknown): value is PetFoodLedger => isRecord(value)
  && Object.entries(value).every(([id, quantity]) => isFood(id) && positive(quantity));

/** Retain historical receipts verbatim in meaning, including the exact selected IDs. */
export function normalizePetTransactions(value: unknown, purchases: FoodPurchase[]): PetTransaction[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set(purchases.map((purchase) => purchase.requestId));
  const result: PetTransaction[] = [];
  for (const raw of value) {
    if (!isRecord(raw) || typeof raw.requestId !== 'string' || !raw.requestId.trim() || raw.requestId.length > 200
      || seen.has(raw.requestId) || typeof raw.petId !== 'string' || !raw.petId || typeof raw.createdAt !== 'string') continue;
    const common = { requestId: raw.requestId, petId: raw.petId, createdAt: raw.createdAt };
    const refund = raw.refundedFoods === undefined ? {} : ledger(raw.refundedFoods) ? { refundedFoods: { ...raw.refundedFoods } } : null;
    if (!refund) continue;
    let entry: PetTransaction | null = null;
    if (raw.kind === 'sell' && positive(raw.quantity) && positive(raw.unitGold) && positive(raw.totalGold)) {
      const selected = raw.petIds === undefined ? undefined : ids(raw.petIds) ? [...raw.petIds] : null;
      if (selected !== null && (selected
        ? selected.length === raw.quantity && selected.includes(raw.petId)
        : raw.quantity * raw.unitGold === raw.totalGold)) {
        entry = { ...common, ...refund, kind: 'sell', quantity: raw.quantity, unitGold: raw.unitGold,
          totalGold: raw.totalGold, ...(selected ? { petIds: selected } : {}) };
      }
    } else if (raw.kind === 'upgrade' && (raw.fromStars === 1 || raw.fromStars === 2)
      && raw.toStars === raw.fromStars + 1 && positive(raw.copies) && positive(raw.gold)
      && positive(raw.foodQuantity) && ids(raw.foodItemIds) && raw.foodItemIds.every(isFood)) {
      const selected = raw.materialPetIds === undefined ? undefined : ids(raw.materialPetIds) ? [...raw.materialPetIds] : null;
      if (selected !== null && (!selected || selected.length === raw.copies && !selected.includes(raw.petId))) {
        entry = { ...common, ...refund, kind: 'upgrade', fromStars: raw.fromStars, toStars: raw.toStars as 2 | 3,
          copies: raw.copies, gold: raw.gold, foodQuantity: raw.foodQuantity, foodItemIds: [...raw.foodItemIds],
          ...(selected ? { materialPetIds: selected } : {}) };
      }
    } else if ((raw.kind === 'feed' || raw.kind === 'quick-feed') && ledger(raw.foods)
      && Object.keys(raw.foods).length > 0 && positive(raw.experienceGain)
      && positive(raw.levelBefore) && positive(raw.levelAfter) && raw.levelAfter >= raw.levelBefore
      && (raw.kind === 'quick-feed' || isFood(raw.itemId))) {
      entry = { ...common, kind: raw.kind, foods: { ...raw.foods }, experienceGain: raw.experienceGain,
        levelBefore: raw.levelBefore, levelAfter: raw.levelAfter, ...(isFood(raw.itemId) ? { itemId: raw.itemId } : {}) };
    }
    if (entry) { seen.add(entry.requestId); result.push(entry); }
  }
  return result;
}
