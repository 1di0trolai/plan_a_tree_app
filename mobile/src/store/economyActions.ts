/** Xử lý mua thức ăn, thưởng vàng và quà chuỗi chăm cây; ghi nhận giao dịch để không cộng hoặc trừ tài nguyên lặp lại. */

import {
  boundedRandom, DAILY_GOLD_CAP, MAX_PURCHASE_QUANTITY, PACK_BONUS_CHANCE,
  rollFood, SHOP_CATALOG, STREAK_REWARDS,
} from '../data/economy';
import { localDateKey } from '../data/seed';
import { t } from '../i18n/core';
import type { AppState, EconomyState, FoodPurchase, StreakFoodReward } from '../types/app';

export { claimDailyLogin, getLoginRewardStatus } from './loginMailbox';
export type { LoginRewardResult } from './loginMailbox';

export function createEconomyState(): EconomyState {
  return { gold: 0, loginClaims: [], loginVisits: [], inspectionRewards: [], streakRewards: [], purchases: [], petTransactions: [] };
}

function addFood(current: AppState, itemId: string, quantity = 1): AppState {
  const catalog = SHOP_CATALOG.find((entry) => entry.itemId === itemId);
  const item = current.inventory.items.find((entry) => entry.id === itemId);
  if (!catalog || !item || item.category !== 'Thức ăn' || item.experienceGain !== catalog.experienceGain) {
    throw new Error('Thức ăn này hiện không có trong kho hàng.');
  }
  if (!Number.isSafeInteger(item.quantity) || item.quantity < 0 || !Number.isSafeInteger(item.quantity + quantity)) {
    throw new Error('Số lượng thức ăn không hợp lệ.');
  }
  return { ...current, inventory: { ...current.inventory,
    items: current.inventory.items.map((entry) => entry.id === itemId ? { ...entry, quantity: entry.quantity + quantity } : entry) } };
}

export interface FoodPurchaseInput { requestId: string; itemId: string; quantity: number }
export interface FoodPurchaseResult { alreadyPurchased: boolean; purchase: FoodPurchase }

/** Request IDs are durable: a retry returns its original receipt, never debits twice. */
export function purchaseFood(current: AppState, input: FoodPurchaseInput, now = new Date()): { state: AppState; result: FoodPurchaseResult } {
  if (!current.auth.loggedIn) throw new Error('Hãy đăng nhập trước khi mua đồ.');
  if (!input.requestId.trim() || input.requestId.length > 200) throw new Error('Mã giao dịch không hợp lệ.');
  if (current.economy.petTransactions.some((entry) => entry.requestId === input.requestId)) {
    throw new Error('Mã giao dịch đã được dùng cho thú nuôi.');
  }
  const catalog = SHOP_CATALOG.find((entry) => entry.itemId === input.itemId);
  if (!catalog) throw new Error('Món này không có trong cửa hàng.');
  if (!Number.isSafeInteger(input.quantity) || input.quantity < 1 || input.quantity > MAX_PURCHASE_QUANTITY) {
    throw new Error(t('Chọn số lượng từ 1 đến {max}.', { max: MAX_PURCHASE_QUANTITY }));
  }
  const previous = current.economy.purchases.find((entry) => entry.requestId === input.requestId);
  if (previous) {
    if (previous.itemId !== input.itemId || previous.quantity !== input.quantity) {
      throw new Error('Mã giao dịch đã được dùng cho một đơn hàng khác.');
    }
    return { state: current, result: { alreadyPurchased: true, purchase: previous } };
  }
  const totalGold = catalog.goldPrice * input.quantity;
  if (!Number.isSafeInteger(current.economy.gold) || current.economy.gold < totalGold) throw new Error('Bạn chưa đủ vàng.');
  const stocked = addFood(current, input.itemId, input.quantity);
  const purchase: FoodPurchase = { requestId: input.requestId, itemId: input.itemId, quantity: input.quantity,
    unitPrice: catalog.goldPrice, totalGold, createdAt: now.toISOString() };
  return { state: { ...stocked, economy: { ...stocked.economy, gold: stocked.economy.gold - totalGold,
    purchases: [...stocked.economy.purchases, purchase] } }, result: { alreadyPurchased: false, purchase } };
}

/** Called only after a newly stored, eligible inspection, never from care notes. */
export function awardInspectionEconomy(current: AppState, plantId: string, previousBest: number, now: Date, random: () => number) {
  const plant = current.plants.find((entry) => entry.id === plantId)!;
  const date = localDateKey(now);
  if (current.economy.inspectionRewards.some((entry) => entry.plantId === plantId && entry.date === date)) {
    return { state: current, goldAwarded: 0, streakReward: null };
  }
  const awardedToday = current.economy.inspectionRewards.filter((entry) => entry.date === date).reduce((sum, entry) => sum + entry.gold, 0);
  const goldAwarded = Math.min(10 + Math.floor(boundedRandom(random) * 41), Math.max(0, DAILY_GOLD_CAP - awardedToday));
  if (!Number.isSafeInteger(current.economy.gold + goldAwarded)) throw new Error('Số dư vàng không hợp lệ.');
  let state: AppState = { ...current, economy: { ...current.economy, gold: current.economy.gold + goldAwarded,
    inspectionRewards: [...current.economy.inspectionRewards, { plantId, date, gold: goldAwarded }] } };
  const milestone = STREAK_REWARDS.find((entry) => entry.milestone === plant.streak && previousBest < entry.milestone
    && !state.economy.streakRewards.some((reward) => reward.plantId === plantId && reward.milestone === entry.milestone));
  let streakReward: StreakFoodReward | null = null;
  if (milestone) {
    streakReward = { plantId, milestone: milestone.milestone, itemId: milestone.itemId, claimedAt: now.toISOString() };
    state = addFood(state, milestone.itemId);
    state = { ...state, economy: { ...state.economy, streakRewards: [...state.economy.streakRewards, streakReward] } };
  }
  return { state, goldAwarded, streakReward };
}

export function rollPackBonus(random: () => number): string | null {
  return boundedRandom(random) < PACK_BONUS_CHANCE ? rollFood(random) : null;
}

/** The stored pack outcome is the receipt; reveal can never reroll it. */
export function creditPackBonus(current: AppState, itemId: string | null | undefined): AppState {
  return itemId ? addFood(current, itemId) : current;
}
