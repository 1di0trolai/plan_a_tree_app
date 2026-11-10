/** Kiểm thử cho ăn, cho ăn nhanh, tăng sao và bán từng thú nuôi với chi phí cùng sổ hoàn trả chính xác. */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createInitialState } from '../src/data/seed';
import { PET_UPGRADE_FOOD_IDS } from '../src/data/petProgression';
import { buildQuickFeedPlan, consumePetFood, quickFeedPet, sellPetCopies, upgradePet } from '../src/store/petActions';
import { createPetInstance, getPetSaleRefund } from '../src/store/petCollection';
import type { AppState, PetInstance } from '../src/types/app';

function stocked(): AppState {
  const state = createInitialState();
  state.auth = { loggedIn: true, remember: true, identity: 'pets@pat.vn' };
  state.economy.gold = 1_000;
  state.inventory.items = state.inventory.items.map((food) => ({ ...food, quantity: 10 }));
  state.inventory.pets = Array.from({ length: 7 }, (_, index) => createPetInstance('ladybug', `bug-${index}`));
  state.inventory.pets[0].level = 36;
  state.inventory.pets[0].experience = 37;
  return state;
}
const pet = (state: AppState, id = 'bug-0') => state.inventory.pets.find((entry) => entry.id === id)!;
const food = (state: AppState, id: string) => state.inventory.items.find((entry) => entry.id === id)!;
const two = { requestId: 'star-two', petId: 'bug-0', targetStars: 2 as const, materialPetIds: ['bug-1', 'bug-2'] };
const three = { requestId: 'star-three', petId: 'bug-0', targetStars: 3 as const, materialPetIds: ['bug-3', 'bug-4', 'bug-5'] };

test('feeding changes only the chosen individual and records exact food investment for future refund', () => {
  const before = stocked();
  pet(before, 'bug-1').experience = 90;
  const input = { requestId: 'feed-one', petId: 'bug-1', itemId: 'berry-bites' };
  const { state, receipt } = consumePetFood(before, input);
  assert.equal(pet(state, 'bug-1').level, 2);
  assert.equal(pet(state, 'bug-1').experience, 15);
  assert.deepEqual(pet(state, 'bug-1').foodSpent, { 'berry-bites': 1 });
  assert.equal(food(state, 'berry-bites').quantity, 9);
  assert.equal(pet(state), pet(before));
  assert.equal(receipt.kind, 'feed');
  assert.equal(before.economy.petTransactions.length, 0);
  assert.equal(food(before, 'berry-bites').quantity, 10);
  const retry = consumePetFood(state, input);
  assert.equal(retry.state, state);
  assert.equal(retry.alreadyApplied, true);
  assert.throws(() => consumePetFood(state, { ...input, itemId: 'forest-milk' }), /thao tác khác/);
  assert.throws(() => quickFeedPet(state, { requestId: input.requestId, petId: input.petId }), /thao tác khác/);
});

test('food investment remains independent from stars, and feeding missing/empty/non-food stock fails atomically', () => {
  for (const itemId of ['rice-bowl', 'ramen-bowl', 'star-snack']) {
    const before = stocked();
    const expected = food(before, itemId).experienceGain;
    const state = consumePetFood(before, { requestId: itemId, petId: 'bug-0', itemId }).state;
    assert.equal(pet(state).experience, 37 + expected);
    assert.equal(pet(state).stars, 1);
    assert.deepEqual(pet(state).foodSpent, { [itemId]: 1 });
  }
  const variants = [
    (s: AppState) => { food(s, 'berry-bites').quantity = 0; },
    (s: AppState) => { food(s, 'berry-bites').category = 'Đồ chơi'; },
    (s: AppState) => { food(s, 'berry-bites').quantity = 0.5; },
    (s: AppState) => { pet(s).foodSpent = { 'berry-bites': Number.MAX_SAFE_INTEGER }; },
    (s: AppState) => { pet(s).experience = Number.MAX_SAFE_INTEGER; },
    (s: AppState) => { s.auth.loggedIn = false; },
  ];
  for (const change of variants) {
    const before = stocked(); change(before);
    const snapshot = JSON.stringify(before);
    assert.throws(() => consumePetFood(before, { requestId: 'invalid', petId: 'bug-0', itemId: 'berry-bites' }));
    assert.equal(JSON.stringify(before), snapshot);
  }
  assert.throws(() => consumePetFood(stocked(), { requestId: 'missing', petId: 'missing', itemId: 'berry-bites' }), /Không tìm thấy thú nuôi/);
});

test('quick feed spends lowest rarity first and EXP ascending within that rarity, carrying any excess', () => {
  const before = stocked();
  pet(before, 'bug-1').experience = 0;
  before.inventory.items = before.inventory.items.map((item) => ({ ...item, quantity: 0 }));
  Object.assign(food(before, 'berry-bites'), { quantity: 2, rarity: 'Thường' });
  Object.assign(food(before, 'rice-bowl'), { quantity: 1, rarity: 'Thường' });
  Object.assign(food(before, 'honey-cookie'), { quantity: 1, rarity: 'Thường' });
  Object.assign(food(before, 'forest-milk'), { quantity: 10, rarity: 'Hiếm' });
  const plan = buildQuickFeedPlan(before, 'bug-1');
  assert.deepEqual(plan.foods, { 'berry-bites': 2, 'rice-bowl': 1, 'honey-cookie': 1 });
  assert.equal(plan.experienceGain, 155);
  assert.equal(plan.levelAfter, 2);
  assert.equal(plan.experienceAfter, 55);
  assert.equal(plan.reachesNextLevel, true);
  const input = { requestId: 'quick', petId: 'bug-1' };
  const first = quickFeedPet(before, input);
  assert.equal(pet(first.state, 'bug-1').experience, 55);
  assert.deepEqual(pet(first.state, 'bug-1').foodSpent, plan.foods);
  assert.equal(food(first.state, 'forest-milk').quantity, 10);
  assert.equal(quickFeedPet(first.state, input).state, first.state);
  assert.equal(first.state.economy.petTransactions.length, 1);
  // Rarity dominates EXP: a rare 25-EXP berry must wait behind common 45-EXP rice.
  food(before, 'berry-bites').rarity = 'Hiếm';
  food(before, 'rice-bowl').quantity = 3;
  assert.deepEqual(buildQuickFeedPlan(before, 'bug-1').foods, { 'rice-bowl': 3 });
});

test('quick feed uses all remaining food when insufficient, and refuses a completely empty stock', () => {
  const before = stocked();
  pet(before, 'bug-1').experience = 0;
  before.inventory.items = before.inventory.items.map((item) => ({ ...item, quantity: item.id === 'berry-bites' || item.id === 'rice-bowl' ? 1 : 0 }));
  const plan = buildQuickFeedPlan(before, 'bug-1');
  assert.equal(plan.experienceGain, 70);
  assert.equal(plan.reachesNextLevel, false);
  assert.equal(plan.levelAfter, 1);
  assert.equal(plan.experienceAfter, 70);
  const state = quickFeedPet(before, { requestId: 'partial', petId: 'bug-1' }).state;
  assert.equal(pet(state, 'bug-1').experience, 70);
  assert.ok(state.inventory.items.every((item) => item.quantity === 0));
  assert.throws(() => quickFeedPet(state, { requestId: 'empty', petId: 'bug-1' }), /Không còn thức ăn/);
});

test('manual upgrades consume selected 1-star individuals and track 3/6 base copies, 200/700 gold and every food cost', () => {
  const before = stocked();
  const second = upgradePet(before, two).state;
  assert.equal(second.inventory.pets.length, 5);
  assert.equal(pet(second).stars, 2);
  assert.equal(pet(second).baseCopies, 3);
  assert.equal(pet(second).upgradeGoldSpent, 200);
  assert.equal(second.economy.gold, 800);
  assert.deepEqual(pet(second).upgradeFoodSpent, Object.fromEntries(PET_UPGRADE_FOOD_IDS.map((id) => [id, 1])));
  assert.equal(pet(second).level, 36);
  assert.equal(pet(second).experience, 37);
  const third = upgradePet(second, three).state;
  assert.equal(third.inventory.pets.length, 2);
  assert.equal(pet(third).stars, 3);
  assert.equal(pet(third).baseCopies, 6);
  assert.equal(pet(third).upgradeGoldSpent, 700);
  assert.equal(third.economy.gold, 300);
  assert.deepEqual(pet(third).upgradeFoodSpent, Object.fromEntries(PET_UPGRADE_FOOD_IDS.map((id) => [id, 3])));
  assert.ok(third.inventory.items.every((item) => item.quantity === 7));
  assert.equal(getPetSaleRefund(pet(second)).gold, 3 * 40 + 200);
  assert.equal(getPetSaleRefund(pet(third)).gold, 6 * 40 + 700);
  assert.throws(() => upgradePet(third, { ...three, requestId: 'max' }), /tối đa 3 sao/);
});

test('trained 1-star material refunds its recorded food immediately and never double refunds through the primary', () => {
  let state = stocked();
  state = consumePetFood(state, { requestId: 'feed-main', petId: 'bug-0', itemId: 'ramen-bowl' }).state;
  state = consumePetFood(state, { requestId: 'feed-material', petId: 'bug-1', itemId: 'berry-bites' }).state;
  state = consumePetFood(state, { requestId: 'feed-material-2', petId: 'bug-2', itemId: 'forest-milk' }).state;
  const beforeUpgrade = state;
  state = upgradePet(state, two).state;
  assert.equal(food(state, 'berry-bites').quantity, food(beforeUpgrade, 'berry-bites').quantity - 1 + 1);
  assert.equal(food(state, 'forest-milk').quantity, food(beforeUpgrade, 'forest-milk').quantity - 1 + 1);
  assert.deepEqual(pet(state).foodSpent, { 'ramen-bowl': 1 });
  state = upgradePet(state, three).state;
  const quote = getPetSaleRefund(pet(state));
  assert.equal(quote.foods['berry-bites'], 3);
  assert.equal(quote.foods['forest-milk'], 3);
  assert.equal(quote.foods['ramen-bowl'], 4);
  state = sellPetCopies(state, { requestId: 'sell-trained', petId: 'bug-0', petIds: ['bug-0'] }).state;
  assert.equal(state.inventory.pets.length, 1);
  assert.equal(state.inventory.pets[0].id, 'bug-6');
  assert.equal(state.economy.gold, 1_240);
  assert.ok(state.inventory.items.every((item) => item.quantity === 10));
});

test('sale uses exact selected same-species IDs and leaves one per species, including when upgraded pets are selected', () => {
  let state = stocked();
  state = upgradePet(state, two).state;
  const input = { requestId: 'multi-sale', petId: 'bug-0', petIds: ['bug-0', 'bug-3'] };
  const sold = sellPetCopies(state, input);
  assert.equal(sold.receipt.kind === 'sell' && sold.receipt.totalGold, 360);
  assert.equal(sold.state.economy.gold, 1_160);
  assert.equal(sold.state.inventory.pets.length, 3);
  assert.equal(sellPetCopies(sold.state, { ...input, petIds: ['bug-3', 'bug-0'] }).state, sold.state);
  assert.throws(() => sellPetCopies(sold.state, { ...input, petIds: ['bug-0'] }), /thao tác khác/);
  assert.throws(() => sellPetCopies(state, { requestId: 'all', petId: 'bug-0', petIds: state.inventory.pets.map((entry) => entry.id) }), /giữ lại/);
  assert.throws(() => sellPetCopies(state, { requestId: 'not-anchor', petId: 'bug-0', petIds: ['bug-3'] }), /gồm thú nuôi/);
  const mixed = { ...state, inventory: { ...state.inventory, pets: [...state.inventory.pets, createPetInstance('caterpillar', 'worm')] } };
  assert.throws(() => sellPetCopies(mixed, { requestId: 'mixed', petId: 'bug-0', petIds: ['bug-0', 'worm'] }), /giữ lại/);
  assert.throws(() => sellPetCopies(state, { requestId: 'duplicate', petId: 'bug-0', petIds: ['bug-0', 'bug-0'] }), /trùng/);
});

test('upgrade rejects wrong counts, duplicate/target/cross-species/upgraded materials, stale IDs and under-level targets atomically', () => {
  const variants: { mutate?: (s: AppState) => void; ids: string[]; level?: number }[] = [
    { ids: ['bug-1'] }, { ids: ['bug-1', 'bug-1'] }, { ids: ['bug-0', 'bug-1'] }, { ids: ['bug-1', 'missing'] },
    { ids: ['bug-1', 'bug-2'], level: 17 },
    { ids: ['bug-1', 'bug-2'], mutate: (s) => { pet(s, 'bug-1').speciesId = 'caterpillar'; } },
    { ids: ['bug-1', 'bug-2'], mutate: (s) => { pet(s, 'bug-1').stars = 2; } },
  ];
  for (const variant of variants) {
    const state = stocked();
    variant.mutate?.(state);
    if (variant.level) pet(state).level = variant.level;
    const snapshot = JSON.stringify(state);
    assert.throws(() => upgradePet(state, { ...two, materialPetIds: variant.ids }));
    assert.equal(JSON.stringify(state), snapshot);
  }
  const at18 = stocked(); pet(at18).level = 18;
  const second = upgradePet(at18, two).state;
  pet(second).level = 35;
  assert.throws(() => upgradePet(second, three), /cấp 36/);
  pet(second).level = 36;
  assert.equal(pet(upgradePet(second, three).state).stars, 3);
});

test('upgrades validate all costs before material refunds, and every overflow/error leaves state untouched', () => {
  const variants = [
    (s: AppState) => { s.economy.gold = 199; },
    (s: AppState) => { food(s, 'rice-bowl').quantity = 0; pet(s, 'bug-1').foodSpent = { 'rice-bowl': 1 }; },
    (s: AppState) => { food(s, 'berry-bites').quantity = Number.MAX_SAFE_INTEGER; pet(s, 'bug-1').foodSpent = { 'berry-bites': 2 }; },
    (s: AppState) => { pet(s, 'bug-1').foodSpent = { unknown: 1 }; },
    (s: AppState) => { s.inventory.items = s.inventory.items.filter((entry) => entry.id !== 'ramen-bowl'); },
  ];
  for (const change of variants) {
    const state = stocked(); change(state);
    const snapshot = JSON.stringify(state);
    assert.throws(() => upgradePet(state, two));
    assert.equal(JSON.stringify(state), snapshot);
  }
  const maxWallet = stocked(); maxWallet.economy.gold = Number.MAX_SAFE_INTEGER;
  assert.throws(() => sellPetCopies(maxWallet, { requestId: 'overflow', petId: 'bug-1', petIds: ['bug-1'] }), /Số dư/);
});

test('durable IDs replay without consuming materials again and cannot collide with legacy receipts or purchases', () => {
  const before = stocked();
  const second = upgradePet(before, two).state;
  const restored = JSON.parse(JSON.stringify(second)) as AppState;
  assert.equal(upgradePet(restored, { ...two, materialPetIds: ['bug-2', 'bug-1'] }).state, restored);
  assert.throws(() => upgradePet(restored, { ...two, materialPetIds: ['bug-3', 'bug-4'] }), /thao tác khác/);
  restored.economy.petTransactions.push({ kind: 'sell', requestId: 'legacy', petId: 'bug-3', createdAt: 'old', quantity: 1, unitGold: 40, totalGold: 40 });
  assert.throws(() => sellPetCopies(restored, { requestId: 'legacy', petId: 'bug-3', petIds: ['bug-3'] }), /thao tác khác/);
  restored.economy.purchases.push({ requestId: 'shop', itemId: 'berry-bites', quantity: 1, unitPrice: 40, totalGold: 40, createdAt: 'old' });
  assert.throws(() => consumePetFood(restored, { requestId: 'shop', petId: 'bug-0', itemId: 'berry-bites' }), /mua đồ/);
  const signedOut = { ...restored, auth: { ...restored.auth, loggedIn: false } };
  assert.throws(() => upgradePet(signedOut, two), /đăng nhập/);
  const reset = createInitialState(); reset.auth.loggedIn = true;
  assert.throws(() => upgradePet(reset, two), /Không tìm thấy thú nuôi/);
  assert.equal(reset.economy.petTransactions.length, 0);
});

test('feed can safely normalize a large legacy EXP value without an unbounded loop or unsafe integer result', () => {
  const state = stocked();
  const target: PetInstance = pet(state, 'bug-1');
  target.experience = 1_000_000;
  const fed = consumePetFood(state, { requestId: 'large-exp', petId: target.id, itemId: 'berry-bites' }).state;
  assert.ok(Number.isSafeInteger(pet(fed, target.id).level));
  assert.ok(Number.isSafeInteger(pet(fed, target.id).experience));
  assert.ok(pet(fed, target.id).level > 1);
});
