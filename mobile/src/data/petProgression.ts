/** Khai báo sức chứa kho thú nuôi, giá bán theo phẩm chất và chi phí, cấp yêu cầu, số bản sao cùng thức ăn cần để nâng sao. */

import type { Beast } from '../types/app';
import { SHOP_CATALOG } from './economy';

export const PET_CAPACITY = 30;

/** Base price per 1-star pet. Sales must retain at least one individual per species. */
export const PET_SALE_PRICES: Record<Beast['rarity'], number> = {
  'Thường': 20,
  'Không phổ biến': 40,
  'Hiếm': 80,
  'Sử thi': 160,
  'Huyền thoại': 320,
};

export const PET_STAR_UPGRADES = {
  2: { minLevel: 18, copies: 2, gold: 200, foodQuantity: 1 },
  3: { minLevel: 36, copies: 3, gold: 500, foodQuantity: 2 },
} as const;

/** Includes rice and ramen, independently of the smaller random-reward food pool. */
export const PET_UPGRADE_FOOD_IDS: readonly string[] = SHOP_CATALOG.map((food) => food.itemId);
