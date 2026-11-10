/** Thực hiện bán, nâng sao, cho ăn và cho ăn nhanh theo từng thú nuôi; kiểm tra nguyên liệu và ghi biên nhận cùng tài nguyên hoàn trả để chống giao dịch lặp. */

import { experienceForNextLevel } from '../data/seed';
import { t } from '../i18n/core';
import { SHOP_CATALOG } from '../data/economy';
import { PET_SALE_PRICES, PET_STAR_UPGRADES, PET_UPGRADE_FOOD_IDS } from '../data/petProgression';
import type { AppState, InventoryItem, PetFoodLedger, PetInstance, PetTransaction } from '../types/app';
import {
  addFoodLedgers, getEligibleUpgradeMaterials, getPetSaleRefund, getPetViews, PET_RARITY_ORDER,
  quoteMaterialRefund, quoteSale,
} from './petCollection';

export type MessageResult = { ok: boolean; message: string };
export interface SellPetCopiesInput { requestId: string; petId: string; petIds: string[] }
export interface UpgradePetInput { requestId: string; petId: string; targetStars: 2 | 3; materialPetIds: string[] }
export interface FeedPetInput { requestId: string; petId: string; itemId: string }
export interface QuickFeedPetInput { requestId: string; petId: string }
export type PetTransactionInput = ({ kind: 'sell' } & SellPetCopiesInput)
  | ({ kind: 'upgrade' } & UpgradePetInput)
  | ({ kind: 'feed' } & FeedPetInput)
  | ({ kind: 'quick-feed' } & QuickFeedPetInput);
export type PetActionTransition = { state: AppState; receipt: PetTransaction; alreadyApplied: boolean; message: string };
export interface QuickFeedPlan {
  foods: PetFoodLedger;
  experienceGain: number;
  levelBefore: number;
  levelAfter: number;
  experienceAfter: number;
  reachesNextLevel: boolean;
}

function exactIds(ids: readonly string[]): string[] {
  if (!Array.isArray(ids) || ids.some((id) => typeof id !== 'string' || !id.trim()) || new Set(ids).size !== ids.length) {
    throw new Error('Danh sách thú nuôi không hợp lệ hoặc bị trùng.');
  }
  return [...ids].sort();
}
function equalIds(a: readonly string[] | undefined, b: readonly string[]): boolean {
  if (!a) return false;
  return JSON.stringify(exactIds(a)) === JSON.stringify(exactIds(b));
}
function messageFor(receipt: PetTransaction): string {
  if (receipt.kind === 'sell') return t('Đã bán {count} thú nuôi, nhận {gold} vàng và hoàn thức ăn đã dùng.', { count: receipt.quantity, gold: receipt.totalGold });
  if (receipt.kind === 'upgrade') return t('Thú nuôi đã lên {stars} sao! Thức ăn của thú nuôi nguyên liệu đã được hoàn.', { stars: receipt.toStars });
  return receipt.levelAfter > receipt.levelBefore
    ? t('Thú nuôi nhận +{experience} kinh nghiệm và lên cấp {level}!', { experience: receipt.experienceGain, level: receipt.levelAfter })
    : t('Thú nuôi nhận +{experience} kinh nghiệm.', { experience: receipt.experienceGain });
}
function done(state: AppState, receipt: PetTransaction, alreadyApplied = false): PetActionTransition {
  return { state, receipt, alreadyApplied, message: messageFor(receipt) };
}
function existingReceipt(current: AppState, input: PetTransactionInput): PetTransaction | null {
  if (!current.auth.loggedIn) throw new Error('Hãy đăng nhập để quản lý thú nuôi.');
  if (typeof input.requestId !== 'string' || !input.requestId.trim() || input.requestId.length > 200) throw new Error('Mã giao dịch không hợp lệ.');
  if (current.economy.purchases.some((entry) => entry.requestId === input.requestId)) throw new Error('Mã giao dịch đã được dùng cho một đơn mua đồ.');
  const previous = current.economy.petTransactions.find((entry) => entry.requestId === input.requestId);
  if (!previous) return null;
  let matches = previous.petId === input.petId && previous.kind === input.kind;
  if (previous.kind === 'sell' && input.kind === 'sell') matches = matches && equalIds(previous.petIds, input.petIds);
  if (previous.kind === 'upgrade' && input.kind === 'upgrade') matches = matches
    && previous.toStars === input.targetStars && equalIds(previous.materialPetIds, input.materialPetIds);
  if (previous.kind === 'feed' && input.kind === 'feed') matches = matches && previous.itemId === input.itemId;
  if (!matches) throw new Error('Mã giao dịch đã được dùng cho thao tác khác.');
  return previous;
}
function requirePet(current: AppState, petId: string): PetInstance {
  const pet = current.inventory.pets.find((entry) => entry.id === petId);
  if (!pet) throw new Error('Không tìm thấy thú nuôi trong bộ sưu tập.');
  getPetSaleRefund(pet); // Validate tracked costs/food before any transaction.
  return pet;
}
function safeQuantity(value: number): boolean { return Number.isSafeInteger(value) && value >= 0; }
function nextFoodStock(current: AppState, spent: PetFoodLedger, refunded: PetFoodLedger = {}): InventoryItem[] {
  // Cost is checked before refund: returned food cannot fund this upgrade.
  addFoodLedgers(spent);
  addFoodLedgers(refunded);
  const changedIds = new Set([...Object.keys(spent), ...Object.keys(refunded)]);
  for (const id of changedIds) {
    const food = current.inventory.items.find((entry) => entry.id === id);
    if (!food || food.category !== 'Thức ăn' || !safeQuantity(food.quantity)) throw new Error('Kho thức ăn không hợp lệ.');
    if (food.quantity < (spent[id] ?? 0)) throw new Error(t('Chưa đủ {food}.', { food: t(food.name) }));
    if (!safeQuantity(food.quantity - (spent[id] ?? 0) + (refunded[id] ?? 0))) throw new Error('Số lượng thức ăn vượt giới hạn.');
  }
  return current.inventory.items.map((food) => changedIds.has(food.id)
    ? { ...food, quantity: food.quantity - (spent[food.id] ?? 0) + (refunded[food.id] ?? 0) } : food);
}
function withReceipt(current: AppState, receipt: PetTransaction): AppState {
  return { ...current, economy: { ...current.economy, petTransactions: [...current.economy.petTransactions, receipt] } };
}

export function sellPetCopies(current: AppState, input: SellPetCopiesInput, now = new Date()): PetActionTransition {
  const previous = existingReceipt(current, { ...input, kind: 'sell' });
  if (previous) return done(current, previous, true);
  const ids = exactIds(input.petIds);
  const target = requirePet(current, input.petId);
  if (!ids.includes(target.id)) throw new Error('Danh sách bán phải gồm thú nuôi đang chọn.');
  const quote = quoteSale(current, ids);
  const selectedCounts = new Map<string, number>();
  for (const id of ids) {
    const pet = requirePet(current, id);
    selectedCounts.set(pet.speciesId, (selectedCounts.get(pet.speciesId) ?? 0) + 1);
  }
  for (const [speciesId, count] of selectedCounts) {
    if (current.inventory.pets.filter((pet) => pet.speciesId === speciesId).length <= count) {
      throw new Error('Luôn giữ lại ít nhất một thú nuôi của mỗi loài.');
    }
  }
  if (!safeQuantity(current.economy.gold) || !safeQuantity(current.economy.gold + quote.gold)) throw new Error('Số dư vàng không hợp lệ.');
  const items = nextFoodStock(current, {}, quote.foods);
  const species = getPetViews([target])[0];
  const receipt: PetTransaction = { kind: 'sell', requestId: input.requestId, petId: input.petId,
    petIds: ids, quantity: ids.length, unitGold: PET_SALE_PRICES[species.rarity], totalGold: quote.gold,
    refundedFoods: quote.foods, createdAt: now.toISOString() };
  return done(withReceipt({ ...current,
    inventory: { ...current.inventory, items, pets: current.inventory.pets.filter((pet) => !ids.includes(pet.id)) },
    economy: { ...current.economy, gold: current.economy.gold + quote.gold },
  }, receipt), receipt);
}

export function upgradePet(current: AppState, input: UpgradePetInput, now = new Date()): PetActionTransition {
  const previous = existingReceipt(current, { ...input, kind: 'upgrade' });
  if (previous) return done(current, previous, true);
  const target = requirePet(current, input.petId);
  if ((input.targetStars !== 2 && input.targetStars !== 3) || input.targetStars !== target.stars + 1) {
    throw new Error(target.stars === 3 ? 'Thú nuôi đã đạt tối đa 3 sao.' : 'Hãy nâng lần lượt từng bậc sao.');
  }
  const cost = PET_STAR_UPGRADES[input.targetStars];
  if (!Number.isSafeInteger(target.level) || target.level < cost.minLevel) throw new Error(t('Thú nuôi cần đạt cấp {level} để lên {stars} sao.', { level: cost.minLevel, stars: input.targetStars }));
  const ids = exactIds(input.materialPetIds);
  if (ids.length !== cost.copies) throw new Error(t('Hãy chọn đúng {count} thú nuôi nguyên liệu.', { count: cost.copies }));
  const eligible = getEligibleUpgradeMaterials(current.inventory.pets, target.id);
  const materials = ids.map((id) => {
    const pet = eligible.find((entry) => entry.id === id);
    if (!pet) throw new Error('Nguyên liệu phải là thú nuôi 1 sao cùng loài, khác thú nuôi chính.');
    getPetSaleRefund(pet);
    return pet;
  });
  if (!safeQuantity(current.economy.gold) || current.economy.gold < cost.gold) throw new Error('Bạn chưa đủ vàng.');
  const spent = Object.fromEntries(PET_UPGRADE_FOOD_IDS.map((id) => [id, cost.foodQuantity]));
  const refunded = quoteMaterialRefund(materials).foods;
  const items = nextFoodStock(current, spent, refunded);
  const upgradeGoldSpent = target.upgradeGoldSpent + cost.gold;
  const baseCopies = target.baseCopies + materials.reduce((sum, pet) => sum + pet.baseCopies, 0);
  if (!safeQuantity(upgradeGoldSpent) || !Number.isSafeInteger(baseCopies) || baseCopies < 1) throw new Error('Chi phí thú nuôi vượt giới hạn.');
  const evolved: PetInstance = { ...target, stars: input.targetStars, baseCopies, upgradeGoldSpent,
    upgradeFoodSpent: addFoodLedgers(target.upgradeFoodSpent, spent) };
  // Material foodSpent was refunded above: never merge it into the main ledger.
  const receipt: PetTransaction = { kind: 'upgrade', requestId: input.requestId, petId: target.id,
    fromStars: target.stars as 1 | 2, toStars: input.targetStars, copies: cost.copies, gold: cost.gold,
    foodQuantity: cost.foodQuantity, foodItemIds: [...PET_UPGRADE_FOOD_IDS], materialPetIds: ids,
    refundedFoods: refunded, createdAt: now.toISOString() };
  return done(withReceipt({ ...current,
    inventory: { ...current.inventory, items, pets: current.inventory.pets.filter((pet) => !ids.includes(pet.id))
      .map((pet) => pet.id === target.id ? evolved : pet) },
    economy: { ...current.economy, gold: current.economy.gold - cost.gold },
  }, receipt), receipt);
}

function advanceExperience(pet: PetInstance, experienceGain: number) {
  if (!Number.isSafeInteger(pet.level) || pet.level < 1 || !safeQuantity(pet.experience)
    || !safeQuantity(experienceGain) || !safeQuantity(pet.experience + experienceGain)) throw new Error('Kinh nghiệm của thú nuôi không hợp lệ.');
  const threshold = experienceForNextLevel(pet.level);
  if (!Number.isSafeInteger(threshold) || threshold < 1) throw new Error('Cấp thú nuôi vượt giới hạn.');
  // Existing requirements rise linearly. Exact binary search avoids
  // unbounded loops when recovering a large but safe-integer legacy EXP value.
  const total = BigInt(pet.experience + experienceGain);
  const first = BigInt(threshold);
  const step = BigInt(experienceForNextLevel(2) - experienceForNextLevel(1));
  const costFor = (levels: bigint) => levels * first + step * levels * (levels - 1n) / 2n;
  let low = 0n;
  let high = total / first;
  while (low < high) {
    const middle = (low + high + 1n) / 2n;
    if (costFor(middle) <= total) low = middle;
    else high = middle - 1n;
  }
  const levelAfter = pet.level + Number(low);
  if (!Number.isSafeInteger(levelAfter)) throw new Error('Cấp thú nuôi vượt giới hạn.');
  return { levelAfter, experienceAfter: Number(total - costFor(low)) };
}
function foodForFeed(current: AppState, itemId: string): InventoryItem {
  const item = current.inventory.items.find((entry) => entry.id === itemId);
  const catalog = SHOP_CATALOG.find((entry) => entry.itemId === itemId);
  if (!item || !catalog || item.category !== 'Thức ăn' || item.experienceGain !== catalog.experienceGain) throw new Error('Không tìm thấy thức ăn cho thú nuôi.');
  if (!safeQuantity(item.quantity) || item.quantity < 1) throw new Error('Thức ăn này đã hết.');
  return item;
}

export function buildQuickFeedPlan(current: AppState, petId: string): QuickFeedPlan {
  const pet = requirePet(current, petId);
  const threshold = experienceForNextLevel(pet.level);
  if (!Number.isSafeInteger(threshold) || threshold < 1 || !safeQuantity(pet.experience)) throw new Error('Kinh nghiệm của thú nuôi không hợp lệ.');
  const needed = Math.max(0, threshold - pet.experience);
  const candidates = current.inventory.items.filter((item) => item.category === 'Thức ăn' && item.quantity > 0)
    .map((item) => foodForFeed(current, item.id))
    .sort((a, b) => PET_RARITY_ORDER[a.rarity] - PET_RARITY_ORDER[b.rarity]
      || a.experienceGain - b.experienceGain || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const foods: PetFoodLedger = {};
  let experienceGain = 0;
  for (const food of candidates) {
    if (experienceGain >= needed) break;
    const quantity = Math.min(food.quantity, Math.ceil((needed - experienceGain) / food.experienceGain));
    const gain = quantity * food.experienceGain;
    if (!safeQuantity(gain) || !safeQuantity(experienceGain + gain)) throw new Error('Kinh nghiệm vượt giới hạn.');
    foods[food.id] = quantity;
    experienceGain += gain;
  }
  const progress = advanceExperience(pet, experienceGain);
  return { foods, experienceGain, levelBefore: pet.level, ...progress, reachesNextLevel: progress.levelAfter > pet.level };
}

function commitFeed(current: AppState, input: FeedPetInput | QuickFeedPetInput,
  kind: 'feed' | 'quick-feed', foods: PetFoodLedger, experienceGain: number, now: Date): PetActionTransition {
  const pet = requirePet(current, input.petId);
  if (!Object.keys(foods).length || experienceGain <= 0) throw new Error('Không còn thức ăn để cho thú nuôi ăn.');
  const progress = advanceExperience(pet, experienceGain);
  const items = nextFoodStock(current, foods);
  const fed: PetInstance = { ...pet, level: progress.levelAfter, experience: progress.experienceAfter,
    foodSpent: addFoodLedgers(pet.foodSpent, foods) };
  const receipt: PetTransaction = { kind, requestId: input.requestId, petId: pet.id,
    ...(kind === 'feed' && 'itemId' in input ? { itemId: input.itemId } : {}), foods,
    experienceGain, levelBefore: pet.level, levelAfter: fed.level, createdAt: now.toISOString() };
  return done(withReceipt({ ...current, inventory: { ...current.inventory, items,
    pets: current.inventory.pets.map((entry) => entry.id === pet.id ? fed : entry) } }, receipt), receipt);
}

export function consumePetFood(current: AppState, input: FeedPetInput, now = new Date()): PetActionTransition {
  const previous = existingReceipt(current, { ...input, kind: 'feed' });
  if (previous) return done(current, previous, true);
  requirePet(current, input.petId);
  const food = foodForFeed(current, input.itemId);
  return commitFeed(current, input, 'feed', { [food.id]: 1 }, food.experienceGain, now);
}

export function quickFeedPet(current: AppState, input: QuickFeedPetInput, now = new Date()): PetActionTransition {
  const previous = existingReceipt(current, { ...input, kind: 'quick-feed' });
  if (previous) return done(current, previous, true);
  const plan = buildQuickFeedPlan(current, input.petId);
  return commitFeed(current, input, 'quick-feed', plan.foods, plan.experienceGain, now);
}
