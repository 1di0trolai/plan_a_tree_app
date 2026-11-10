/** Kiểm thử bộ tạo tài nguyên mẫu chỉ dành cho kiểm thử, bảo toàn tiến trình và không tái sử dụng mã cá thể cũ. */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createInitialState, PET_SPECIES } from '../src/data/seed';
import { SHOP_CATALOG, LOGIN_REWARD_WEIGHTS, REWARD_FOOD_IDS } from '../src/data/economy';
import { createPetInstance } from '../src/store/petCollection';
import { applyTestResourceFloors, TEST_RESOURCE_PET_IDS } from './fixtures/testResources';
import * as petActions from '../src/store/petActions';
import { createGardenFixture } from './fixtures/gardenFixture';

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
function signedGarden() {
  const state = createGardenFixture();
  state.auth = { loggedIn: true, remember: true, identity: 'resources@pat.vn' };
  return state;
}

test('resource floors fill all six foods and five individual pets per illustrated species without manufacturing garden rewards', () => {
  const before = signedGarden();
  const state = applyTestResourceFloors(before, true);
  assert.equal(state.economy.gold, 100_000);
  assert.equal(state.inventory.items.length, 6);
  assert.ok(state.inventory.items.every((food) => food.quantity === 999));
  for (const id of TEST_RESOURCE_PET_IDS) {
    const pets = state.inventory.pets.filter((entry) => entry.speciesId === id);
    assert.equal(pets.length, 5);
    const generated = pets.filter((pet) => !before.inventory.pets.some((original) => original.id === pet.id));
    assert.ok(generated.every((pet) => pet.level === 36 && pet.experience === 0 && pet.stars === 1));
    for (const pet of generated) {
      assert.deepEqual(pet, { ...createPetInstance(id, pet.id), level: 36 });
    }
  }
  assert.equal(state.inventory.pets.length, 25);
  assert.equal(new Set(state.inventory.pets.map((pet) => pet.id)).size, 25);
  for (const original of before.inventory.pets) assert.equal(state.inventory.pets.find((pet) => pet.id === original.id), original);
  assert.deepEqual({ ...state, inventory: before.inventory, economy: before.economy }, before);
  assert.deepEqual({ ...state.economy, gold: before.economy.gold }, before.economy);
  assert.equal(before.economy.gold, 0);
  assert.equal(before.inventory.items[0].quantity, 5);
});

test('resource grants are idempotent floors and never lower higher resources, level, EXP or stars', () => {
  const before = signedGarden();
  before.economy.gold = 200_000;
  before.inventory.items[0].quantity = 2_000;
  before.inventory.pets[0] = { ...before.inventory.pets[0], level: 80, experience: 37, stars: 3,
    foodSpent: { 'berry-bites': 10 }, upgradeFoodSpent: { 'forest-milk': 3 }, upgradeGoldSpent: 700, baseCopies: 6 };
  const snail = createPetInstance('dew-snail', 'dev-test:mantis:1');
  before.inventory.pets.push(snail);
  const first = applyTestResourceFloors(before, true);
  assert.equal(first.economy.gold, 200_000);
  assert.equal(first.inventory.items[0].quantity, 2_000);
  assert.deepEqual(first.inventory.pets[0], before.inventory.pets[0]);
  assert.equal(first.inventory.pets.find((pet) => pet.id === snail.id), snail);
  assert.equal(new Set(first.inventory.pets.map((pet) => pet.id)).size, first.inventory.pets.length);
  assert.deepEqual(applyTestResourceFloors(first, true), first);
  assert.equal(first.settings, before.settings);
  assert.equal(first.plants, before.plants);
  assert.equal(first.dailyPacks, before.dailyPacks);
  assert.equal(first.economy.loginClaims, before.economy.loginClaims);
  assert.equal(first.economy.petTransactions, before.economy.petTransactions);
});

test('refilling after feeding, upgrading and selling never reuses historical individual IDs', () => {
  const fresh = createInitialState();
  fresh.auth = { loggedIn: true, remember: true, identity: 'lifetime@pat.vn' };
  let state = applyTestResourceFloors(fresh, true);
  const targetId = 'dev-test:ladybug:3';
  state = petActions.consumePetFood(state, { requestId: 'feed-main', petId: targetId, itemId: 'berry-bites' }).state;
  state = petActions.consumePetFood(state, { requestId: 'feed-material', petId: 'dev-test:ladybug:1', itemId: 'berry-bites' }).state;
  state = petActions.upgradePet(state, { requestId: 'fuse', petId: targetId, targetStars: 2,
    materialPetIds: ['dev-test:ladybug:1', 'dev-test:ladybug:4'] }).state;
  const sale = { requestId: 'sell-pair', petId: 'dev-test:ladybug:5', petIds: ['dev-test:ladybug:5', 'dev-test:ladybug:2'] };
  state = petActions.sellPetCopies(state, sale).state;
  state.dailyPacks = [{ id: 'historical-pack', roundId: 'round', date: '2026-11-02',
    beastId: 'ladybug', petInstanceId: 'dev-test:ladybug:6', rarity: 'Uncommon', isNew: false,
    earnedAt: '2026-11-02T01:00:00Z', revealedAt: '2026-11-02T01:00:01Z', demo: false }];
  const target = state.inventory.pets.find((pet) => pet.id === targetId)!;
  const receipts = clone(state.economy.petTransactions);
  const filled = applyTestResourceFloors(state, true);
  assert.equal(filled.inventory.pets.find((pet) => pet.id === targetId), target);
  assert.deepEqual(target.foodSpent, { 'berry-bites': 1 });
  assert.equal(target.stars, 2);
  const added = filled.inventory.pets.filter((pet) => !state.inventory.pets.some((old) => old.id === pet.id));
  assert.deepEqual(added.map((pet) => pet.id), [7, 8, 9, 10].map((index) => `dev-test:ladybug:${index}`));
  assert.ok(added.every((pet) => pet.level === 36 && Object.keys(pet.foodSpent).length === 0
    && Object.keys(pet.upgradeFoodSpent).length === 0 && pet.upgradeGoldSpent === 0));
  assert.deepEqual(filled.economy.petTransactions, receipts);
  assert.equal(petActions.sellPetCopies(filled, sale).state, filled);
  assert.deepEqual(applyTestResourceFloors(filled, true), filled);
});

test('release or signed-out direct pure grants reject; fresh accounts never own catalogue pets', () => {
  const signed = signedGarden();
  assert.throws(() => applyTestResourceFloors(signed, false), /Không thể nạp tài nguyên trong phiên này/);
  const initial = createInitialState();
  assert.equal(initial.version, 5);
  assert.deepEqual(initial.inventory.pets, []);
  assert.equal(PET_SPECIES.length, 6);
  assert.ok(PET_SPECIES.every((species) => !('quantity' in species) && !('level' in species) && !('owned' in species)));
  assert.throws(() => applyTestResourceFloors(initial, true), /đăng nhập/);
  initial.auth.loggedIn = true;
  const filled = applyTestResourceFloors(initial, true);
  assert.equal(filled.inventory.pets.length, 25);
  assert.deepEqual(filled.plants, []);
  assert.deepEqual(filled.dailyPacks, []);
  assert.deepEqual(filled.economy.loginClaims, []);
  assert.deepEqual(filled.economy.petTransactions, []);
});

test('food display names and tiers change without altering EXP, prices or reward odds', () => {
  const food = createInitialState().inventory.items;
  assert.deepEqual(food.map((item) => [item.id, item.name, item.rarity]), [
    ['berry-bites', 'Quả Mọng', 'Thường'], ['rice-bowl', 'Cơm Trắng', 'Không phổ biến'],
    ['honey-cookie', 'Bánh Ngọt', 'Hiếm'], ['forest-milk', 'Sữa Tươi', 'Hiếm'],
    ['ramen-bowl', 'Mì Ramen', 'Sử thi'], ['star-snack', 'Bánh Sao', 'Huyền thoại'],
  ]);
  assert.deepEqual(food.map((item) => item.experienceGain), [25, 45, 60, 90, 120, 150]);
  assert.deepEqual(SHOP_CATALOG.map((item) => item.goldPrice), [40, 70, 90, 140, 190, 240]);
  assert.deepEqual(REWARD_FOOD_IDS, ['berry-bites', 'honey-cookie', 'forest-milk', 'star-snack']);
  assert.deepEqual(LOGIN_REWARD_WEIGHTS, { regular: [70, 22, 7, 1], daySeven: [15, 45, 30, 10] });
  assert.equal(PET_SPECIES.find((species) => species.id === 'moon-moth')?.name, 'Bướm Ánh Trăng');
});

