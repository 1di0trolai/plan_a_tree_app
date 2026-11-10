/** Định nghĩa danh mục thức ăn dùng chung cho giá bán, kinh nghiệm và quà thưởng, cùng tỷ lệ quà, mốc chuỗi chăm cây và giới hạn tài nguyên. */
export const SHOP_CATALOG = [
  { itemId: 'berry-bites', goldPrice: 40, experienceGain: 25 },
  { itemId: 'rice-bowl', goldPrice: 70, experienceGain: 45 },
  { itemId: 'honey-cookie', goldPrice: 90, experienceGain: 60 },
  { itemId: 'forest-milk', goldPrice: 140, experienceGain: 90 },
  { itemId: 'ramen-bowl', goldPrice: 190, experienceGain: 120 },
  { itemId: 'star-snack', goldPrice: 240, experienceGain: 150 },
] as const;

/** Reward odds stay independent from shop additions and display order. */
export const REWARD_FOOD_IDS = ['berry-bites', 'honey-cookie', 'forest-milk', 'star-snack'] as const;

export const LOGIN_REWARD_WEIGHTS = {
  regular: [70, 22, 7, 1],
  daySeven: [15, 45, 30, 10],
} as const;

export const STREAK_REWARDS = [
  { milestone: 5, itemId: 'berry-bites' },
  { milestone: 10, itemId: 'honey-cookie' },
  { milestone: 20, itemId: 'forest-milk' },
  { milestone: 50, itemId: 'star-snack' },
] as const;

export const DAILY_GOLD_CAP = 200;
export const PACK_BONUS_CHANCE = 0.25;
export const MAX_PURCHASE_QUANTITY = 99;

export function boundedRandom(random: () => number): number {
  const sample = random();
  return Number.isFinite(sample) ? Math.max(0, Math.min(1 - Number.EPSILON, sample)) : 0;
}

/** The pack bonus uses the regular food distribution after its 25% chance. */
export function rollFood(random: () => number, improved = false): string {
  const weights = improved ? LOGIN_REWARD_WEIGHTS.daySeven : LOGIN_REWARD_WEIGHTS.regular;
  let ticket = boundedRandom(random) * 100;
  const index = weights.findIndex((weight) => (ticket -= weight) < 0);
  return REWARD_FOOD_IDS[index < 0 ? REWARD_FOOD_IDS.length - 1 : index];
}
