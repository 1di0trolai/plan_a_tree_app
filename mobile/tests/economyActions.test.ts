/** Kiểm thử quy tắc vàng, quà đăng nhập, xác suất thức ăn và mua hàng với giới hạn chống nhận trùng. */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DAILY_GOLD_CAP, LOGIN_REWARD_WEIGHTS, rollFood, SHOP_CATALOG } from '../src/data/economy';
import { createInitialState, offsetLocalDate } from '../src/data/seed';
import {
  claimDailyLogin, getLoginRewardStatus, purchaseFood,
} from '../src/store/economyActions';
import {
  addCareEvent, addJourneyReference, recordPlantInspection, revealDailyPack,
  type InspectionInput,
} from '../src/store/journeyActions';
import { normalizePersistedState } from '../src/store/normalizeState';
import type { AppState } from '../src/types/app';
import { createGardenFixture } from './fixtures/gardenFixture';

const now = new Date('2026-10-30T03:00:00Z');
const inspection: Omit<InspectionInput, 'plantId'> = {
  imageUri: 'file:///plant.jpg', source: 'camera', mode: 'gemini', identityConfirmed: true,
  analysis: { level: 'Tốt', title: 'Đã quan sát', summary: 'Theo dõi đất trước khi tưới.', actions: [] },
};

function signedIn(): AppState {
  const state = createInitialState();
  return { ...state, auth: { ...state.auth, loggedIn: true, remember: true } };
}

function garden(count = 1): AppState {
  const state = createGardenFixture();
  const plant = state.plants[0];
  return { ...state, auth: { ...state.auth, loggedIn: true, remember: true },
    plants: Array.from({ length: count }, (_, index) => ({ ...plant, id: `plant-${index}`, streak: 0, bestStreak: 0, lastCheckIn: null })),
    checkIns: [], plantPhotos: [], plantAnalyses: [] };
}

function inspect(state: AppState, id = state.plants[0].id, date = now, economyRandom = () => 0.99) {
  return recordPlantInspection(state, { ...inspection, plantId: id }, date, () => 0.6, economyRandom);
}

test('new users receive no demo gold, food, login receipts or payment balance', () => {
  const state = createInitialState();
  assert.equal(state.economy.gold, 0);
  assert.deepEqual(state.economy.loginClaims, []);
  assert.deepEqual(state.economy.purchases, []);
  assert.ok(state.inventory.items.every((entry) => entry.quantity === 0));
  assert.deepEqual(SHOP_CATALOG.map((entry) => [entry.goldPrice, entry.experienceGain]), [[40, 25], [70, 45], [90, 60], [140, 90], [190, 120], [240, 150]]);
  assert.equal(LOGIN_REWARD_WEIGHTS.regular.reduce((sum: number, weight) => sum + weight, 0), 100);
  assert.equal(LOGIN_REWARD_WEIGHTS.daySeven.reduce((sum: number, weight) => sum + weight, 0), 100);
});

test('new shop foods do not alter login or pack food distributions', () => {
  assert.deepEqual(LOGIN_REWARD_WEIGHTS.regular, [70, 22, 7, 1]);
  assert.deepEqual(LOGIN_REWARD_WEIGHTS.daySeven, [15, 45, 30, 10]);
  const regularCases = [
    [0, 'berry-bites'], [0.699999, 'berry-bites'],
    [0.7, 'honey-cookie'], [0.919999, 'honey-cookie'],
    [0.92, 'forest-milk'], [0.989999, 'forest-milk'],
    [0.99, 'star-snack'], [1, 'star-snack'],
  ] as const;
  const daySevenCases = [
    [0, 'berry-bites'], [0.149999, 'berry-bites'],
    [0.15, 'honey-cookie'], [0.599999, 'honey-cookie'],
    [0.6, 'forest-milk'], [0.899999, 'forest-milk'],
    [0.9, 'star-snack'], [1, 'star-snack'],
  ] as const;
  for (const [sample, itemId] of regularCases) assert.equal(rollFood(() => sample), itemId);
  for (const [sample, itemId] of daySevenCases) assert.equal(rollFood(() => sample, true), itemId);
});

test('login grants one item once per Vietnam day, retry cannot reroll even after hydration', () => {
  const before = signedIn();
  const first = claimDailyLogin(before, now, () => 0);
  assert.equal(first.result.claim.itemId, 'berry-bites');
  assert.equal(first.state.inventory.items[0].quantity, 1);
  let rolls = 0;
  const restored = normalizePersistedState(JSON.parse(JSON.stringify(first.state)));
  const again = claimDailyLogin(restored, now, () => { rolls++; return 0.999; });
  assert.equal(again.state, restored);
  assert.equal(again.result.alreadyClaimed, true);
  assert.equal(rolls, 0);
  assert.equal(before.inventory.items[0].quantity, 0);
});

test('seventh visited day uses better rates, independent of Sunday or calendar gaps', () => {
  let state = signedIn();
  for (let day = 0; day < 8; day++) {
    // Deliberately miss alternate days and cross several weekdays.
    const date = new Date(now.getTime() + day * 2 * 86400000);
    const claimed = claimDailyLogin(state, date, () => 0.95);
    assert.equal(claimed.result.claim.cycleDay, day % 7 + 1);
    assert.equal(claimed.result.claim.itemId, day === 6 ? 'star-snack' : 'forest-milk');
    state = claimed.state;
  }
  assert.equal(state.economy.loginClaims.length, 8);
});

test('Vietnam midnight, not host locale, unlocks another login claim', () => {
  const first = claimDailyLogin(signedIn(), new Date('2026-10-30T16:59:59Z'), () => 0).state;
  assert.equal(getLoginRewardStatus(first, new Date('2026-10-30T16:59:59Z')).canClaim, false);
  const second = claimDailyLogin(first, new Date('2026-10-30T17:00:00Z'), () => 0);
  assert.equal(second.result.claim.date, '2026-10-31');
  assert.equal(second.result.claim.cycleDay, 2);
});

test('unauthenticated login rewards and purchases are rejected without mutation', () => {
  const state = createInitialState();
  state.economy.gold = 100;
  assert.throws(() => claimDailyLogin(state, now));
  assert.throws(() => purchaseFood(state, { requestId: 'p1', itemId: 'berry-bites', quantity: 1 }, now));
  assert.equal(state.economy.gold, 100);
  assert.equal(state.economy.loginClaims.length, 0);
});

test('only first eligible inspection per plant/day earns 10–50 gold; records still save', () => {
  const initial = garden();
  const first = inspect(initial, undefined, now, () => 0);
  assert.equal(first.result.goldAwarded, 10);
  assert.equal(first.state.economy.gold, 10);
  const repeated = inspect(first.state);
  assert.equal(repeated.result.goldAwarded, 0);
  assert.equal(repeated.state.economy.inspectionRewards.length, 1);
  assert.equal(repeated.state.checkIns.length, 2);
  assert.equal(initial.economy.gold, 0);
  assert.equal(inspect(garden(), undefined, now, () => 1).result.goldAwarded, 50);
});

test('spending gold cannot reset the 200-gold daily earning cap; tomorrow has new quota', () => {
  let state = garden(6);
  for (let index = 0; index < 4; index++) state = inspect(state, `plant-${index}`).state;
  assert.equal(state.economy.gold, DAILY_GOLD_CAP);
  state = purchaseFood(state, { requestId: 'spend', itemId: 'berry-bites', quantity: 4 }, now).state;
  assert.equal(state.economy.gold, 40);
  const fifth = inspect(state, 'plant-4');
  assert.equal(fifth.result.goldAwarded, 0);
  assert.equal(fifth.state.economy.gold, 40);
  assert.equal(fifth.state.economy.inspectionRewards.length, 5);
  const tomorrow = inspect(fifth.state, 'plant-4', new Date('2026-10-31T03:00:00Z'));
  assert.equal(tomorrow.result.goldAwarded, 50);
});

test('a final award is clipped to remaining daily cap, including after hydration', () => {
  const state = garden();
  state.economy.inspectionRewards = Array.from({ length: 4 }, (_, index) => ({ plantId: `past-${index}`, date: '2026-10-30', gold: index === 3 ? 45 : 50 }));
  const restored = normalizePersistedState(state);
  assert.equal(inspect(restored).result.goldAwarded, 5);
  assert.equal(inspect(restored).state.economy.gold, 5);
});

test('care notes, references and planning observations never award gold or food', () => {
  const state = garden();
  const cared = addCareEvent(state, { plantId: 'plant-0', kind: 'other', note: 'Ghi chú' }, now).state;
  const reference = addJourneyReference(cared, { plantId: 'plant-0', imageUri: 'file:///reference.jpg', source: 'library' }, now).state;
  reference.plants[0].journey = { ...reference.plants[0].journey, phase: 'planning' };
  const result = inspect(reference);
  assert.equal(result.result.goldAwarded, 0);
  assert.equal(result.result.streakReward, null);
  assert.deepEqual(result.state.economy, state.economy);
});

test('5/10/20/50 streak milestones give one matching food separately for each plant', () => {
  for (const [milestone, itemId] of [[5, 'berry-bites'], [10, 'honey-cookie'], [20, 'forest-milk'], [50, 'star-snack']] as const) {
    let state = garden(2);
    state.plants = state.plants.map((plant) => ({ ...plant, streak: milestone - 1, bestStreak: milestone - 1, lastCheckIn: offsetLocalDate(-1, now) }));
    const originalQuantity = state.inventory.items.find((food) => food.id === itemId)!.quantity;
    for (const plant of state.plants) {
      const checked = inspect(state, plant.id);
      assert.equal(checked.result.streakReward?.milestone, milestone);
      assert.equal(checked.result.streakReward?.itemId, itemId);
      state = checked.state;
    }
    assert.equal(state.economy.streakRewards.length, 2);
    assert.equal(state.inventory.items.find((food) => food.id === itemId)!.quantity, originalQuantity + 2);
    const repeated = inspect(state);
    assert.equal(repeated.result.streakReward, null);
    assert.equal(repeated.state.economy.streakRewards.length, 2);
  }
});

test('losing then rebuilding a streak cannot claim an old milestone again', () => {
  const initial = garden();
  initial.plants[0] = { ...initial.plants[0], streak: 4, bestStreak: 4, lastCheckIn: offsetLocalDate(-1, now) };
  const first = inspect(initial).state;
  const later = normalizePersistedState(first);
  later.plants[0] = { ...later.plants[0], streak: 4, lastCheckIn: '2026-11-04' };
  const again = inspect(later, 'plant-0', new Date('2026-11-05T03:00:00Z'));
  assert.equal(again.result.streakReward, null);
  assert.equal(again.state.economy.streakRewards.length, 1);
});

test('pack bonus outcome is persisted at earning and credited exactly once at reveal', () => {
  const rolls = [0.5, 0.1, 0.8]; // gold, chance succeeds, honey food.
  const earned = inspect(garden(), undefined, now, () => rolls.shift()!).state;
  const pack = earned.dailyPacks[0];
  assert.equal(pack.bonusFoodItemId, 'honey-cookie');
  const quantity = earned.inventory.items.find((entry) => entry.id === 'honey-cookie')!.quantity;
  const restored = normalizePersistedState(JSON.parse(JSON.stringify(earned)));
  assert.equal(restored.dailyPacks[0].bonusFoodItemId, 'honey-cookie');
  const opened = revealDailyPack(restored, pack.id, now);
  assert.equal(opened.state.inventory.items.find((entry) => entry.id === 'honey-cookie')!.quantity, quantity + 1);
  assert.equal(revealDailyPack(opened.state, pack.id, now).state, opened.state);
  assert.equal(opened.state.inventory.pets.length, earned.inventory.pets.length + 1);
  assert.equal(opened.state.inventory.pets.at(-1)!.id, pack.petInstanceId);
});

test('pack chance boundary is 25%, and losing packs stay null across hydration', () => {
  const rolls = [0.5, 0.25];
  const earned = inspect(garden(), undefined, now, () => rolls.shift()!).state;
  assert.equal(earned.dailyPacks[0].bonusFoodItemId, null);
  const restored = normalizePersistedState(earned);
  const revealed = revealDailyPack(restored, restored.dailyPacks[0].id, now);
  assert.deepEqual(revealed.state.inventory.items, earned.inventory.items);
});

test('legacy state hydration never grants old gold, login gifts, streak food or pack bonuses', () => {
  const old = inspect(garden()).state;
  old.plants[0] = { ...old.plants[0], streak: 4, bestStreak: 20 };
  const raw = JSON.parse(JSON.stringify(old));
  raw.version = 4;
  delete raw.dailyPacks[0].creditedAt;
  delete raw.economy;
  delete raw.dailyPacks[0].bonusFoodItemId;
  const restored = normalizePersistedState(raw);
  assert.equal(restored.economy.gold, 0);
  assert.deepEqual(restored.economy.loginClaims, []);
  assert.deepEqual(restored.inventory, old.inventory);
  assert.equal('bonusFoodItemId' in restored.dailyPacks[0], false);
  assert.deepEqual(revealDailyPack(restored, restored.dailyPacks[0].id, now).state.inventory, restored.inventory);
  assert.equal(inspect(restored).result.goldAwarded, 0); // already checked today before upgrade.
  const tomorrow = inspect(restored, 'plant-0', new Date('2026-10-31T03:00:00Z'));
  assert.equal(tomorrow.result.streakReward, null); // old best already exceeded five.
  assert.deepEqual(tomorrow.state.economy.streakRewards, []);
});

test('shop uses catalogue price and updates gold, item stock and receipt atomically', () => {
  const initial = signedIn();
  initial.economy.gold = 200;
  const bought = purchaseFood(initial, { requestId: 'order-1', itemId: 'honey-cookie', quantity: 2 }, now);
  assert.equal(bought.state.economy.gold, 20);
  assert.equal(bought.state.inventory.items.find((entry) => entry.id === 'honey-cookie')!.quantity, 2);
  assert.equal(bought.result.purchase.totalGold, 180);
  assert.equal(initial.economy.gold, 200);
  assert.equal(initial.inventory.items[1].quantity, 0);
});

for (const food of [
  { itemId: 'rice-bowl', goldPrice: 70, experienceGain: 45 },
  { itemId: 'ramen-bowl', goldPrice: 190, experienceGain: 120 },
] as const) {
  test(`${food.itemId} can be purchased and retried after hydration without duplicate debit or stock`, () => {
    const initial = signedIn();
    initial.economy.gold = 500;
    const input = { requestId: `purchase-${food.itemId}`, itemId: food.itemId, quantity: 2 };
    const bought = purchaseFood(initial, input, now);
    const stock = bought.state.inventory.items.find((entry) => entry.id === food.itemId)!;
    assert.equal(stock.quantity, 2);
    assert.equal(stock.experienceGain, food.experienceGain);
    assert.equal(bought.state.economy.gold, 500 - food.goldPrice * 2);
    assert.equal(bought.result.purchase.unitPrice, food.goldPrice);
    assert.equal(bought.result.purchase.totalGold, food.goldPrice * 2);
    assert.equal(initial.inventory.items.find((entry) => entry.id === food.itemId)!.quantity, 0);
    assert.equal(initial.economy.gold, 500);

    const restored = normalizePersistedState(JSON.parse(JSON.stringify(bought.state)));
    assert.equal(restored.inventory.items.find((entry) => entry.id === food.itemId)!.quantity, 2);
    assert.deepEqual(restored.economy.purchases, [bought.result.purchase]);
    const retry = purchaseFood(restored, input, now);
    assert.equal(retry.state, restored);
    assert.equal(retry.result.alreadyPurchased, true);
    assert.equal(restored.economy.gold, 500 - food.goldPrice * 2);
    assert.equal(restored.economy.purchases.length, 1);
  });
}

test('legacy inventories gain new food entries at zero while preserving old stock and gold', () => {
  const initial = signedIn();
  initial.economy.gold = 500;
  const originalFoods = ['berry-bites', 'honey-cookie', 'forest-milk', 'star-snack'];
  initial.inventory.items = initial.inventory.items
    .filter((entry) => originalFoods.includes(entry.id))
    .map((entry, index) => ({ ...entry, quantity: index + 1 }));
  const restored = normalizePersistedState(JSON.parse(JSON.stringify(initial)));
  assert.equal(restored.economy.gold, initial.economy.gold);
  for (const item of initial.inventory.items) {
    assert.equal(restored.inventory.items.find((entry) => entry.id === item.id)!.quantity, item.quantity);
  }
  for (const itemId of ['rice-bowl', 'ramen-bowl']) {
    assert.equal(restored.inventory.items.find((entry) => entry.id === itemId)!.quantity, 0);
    const bought = purchaseFood(restored, { requestId: `legacy-${itemId}`, itemId, quantity: 1 }, now);
    assert.equal(bought.state.inventory.items.find((entry) => entry.id === itemId)!.quantity, 1);
    assert.equal(restored.inventory.items.find((entry) => entry.id === itemId)!.quantity, 0);
  }
});

test('purchase retry after hydration never duplicates debit/stock; conflicting intent rejects', () => {
  const initial = signedIn();
  initial.economy.gold = 200;
  const input = { requestId: 'stable-request', itemId: 'berry-bites', quantity: 2 };
  const bought = purchaseFood(initial, input, now).state;
  const restored = normalizePersistedState(JSON.parse(JSON.stringify(bought)));
  assert.equal(purchaseFood(restored, input, now).state, restored);
  assert.equal(purchaseFood(restored, input, now).result.alreadyPurchased, true);
  assert.throws(() => purchaseFood(restored, { ...input, quantity: 1 }, now));
  assert.throws(() => purchaseFood(restored, { ...input, itemId: 'honey-cookie' }, now));
  assert.equal(restored.economy.gold, 120);
  assert.equal(restored.inventory.items[0].quantity, 2);
});

test('shop rejects invalid quantities, unknown/missing stock, blank IDs and insufficient balance', () => {
  const initial = signedIn();
  initial.economy.gold = 200;
  const input = { requestId: 'p', itemId: 'berry-bites', quantity: 1 };
  for (const quantity of [0, -1, 1.5, NaN, Infinity, 100, Number.MAX_SAFE_INTEGER]) {
    assert.throws(() => purchaseFood(initial, { ...input, quantity }, now));
  }
  assert.throws(() => purchaseFood(initial, { ...input, requestId: ' ' }, now));
  assert.throws(() => purchaseFood(initial, { ...input, itemId: 'free-food' }, now));
  assert.throws(() => purchaseFood(initial, { ...input, itemId: 'star-snack' }, now));
  const missing = { ...initial, inventory: { ...initial.inventory, items: [] } };
  assert.throws(() => purchaseFood(missing, input, now));
  assert.equal(initial.economy.gold, 200);
  assert.deepEqual(initial.economy.purchases, []);
});

test('economy hydration deduplicates valid receipts, preserves assets and rejects malformed fields', () => {
  const initial = signedIn();
  initial.economy.gold = 300;
  const claimed = claimDailyLogin(initial, now, () => 0).state;
  const bought = purchaseFood(claimed, { requestId: 'p', itemId: 'berry-bites', quantity: 1 }, now).state;
  const raw = JSON.parse(JSON.stringify(bought));
  raw.economy.loginClaims.push({ ...raw.economy.loginClaims[0] });
  raw.economy.purchases.push({ ...raw.economy.purchases[0] });
  raw.economy.purchases.push({ ...raw.economy.purchases[0], requestId: 'forged', unitPrice: 1 });
  raw.economy.inspectionRewards = [{ plantId: 'missing-historical-record', date: '2026-10-30', gold: 30 }];
  const restored = normalizePersistedState(raw);
  assert.equal(restored.economy.loginClaims.length, 1);
  assert.equal(restored.economy.purchases.length, 1);
  assert.equal(restored.economy.inspectionRewards.length, 1); // archived/deleted IDs still consume original quota.
  assert.deepEqual(restored.inventory, bought.inventory);
  assert.deepEqual(restored.settings, bought.settings);
  assert.equal(normalizePersistedState({ ...raw, economy: { ...raw.economy, gold: Infinity } }).economy.gold, 0);
});

test('historical purchase prices survive normalization and still deduplicate retries', () => {
  const input = { requestId: 'historical-price', itemId: 'berry-bites', quantity: 2 };
  const state = signedIn();
  state.economy.gold = 160;
  state.inventory.items[0].quantity = 2;
  state.economy.purchases = [{ ...input, unitPrice: 20, totalGold: 40, createdAt: now.toISOString() }];
  const restored = normalizePersistedState(state);
  assert.equal(restored.economy.purchases[0].unitPrice, 20);
  assert.equal(purchaseFood(restored, input, now).state, restored);
  assert.equal(restored.economy.gold, 160);
  assert.equal(restored.inventory.items[0].quantity, 2);
});
