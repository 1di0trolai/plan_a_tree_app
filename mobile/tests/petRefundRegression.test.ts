/** Kiểm thử hồi quy hoàn thức ăn và chi phí tăng sao đúng cá thể, không suy diễn tài nguyên từ cấp được cấp sẵn. */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createInitialState } from '../src/data/seed';
import { applyTestResourceFloors } from './fixtures/testResources';
import { normalizePersistedState } from '../src/store/normalizeState';
import { consumePetFood, quickFeedPet, sellPetCopies, upgradePet } from '../src/store/petActions';
import { createPetInstance, getPetSaleRefund, quoteSale } from '../src/store/petCollection';
import type { AppState } from '../src/types/app';

const now = new Date('2026-11-04T03:00:00Z');
function resources() {
  const state = createInitialState();
  state.auth = { loggedIn: true, remember: true, identity: 'refund@example.test' };
  return applyTestResourceFloors(state, true);
}
const stock = (state: AppState, id: string) => state.inventory.items.find((item) => item.id === id)!.quantity;
const hydrate = (state: AppState) => normalizePersistedState(JSON.parse(JSON.stringify(state)));

test('DEV level36 has no food cost; quick feeding 36 to37 records and refunds exactly39 berries on that individual', () => {
  const initial = resources();
  const targetId = 'dev-test:mantis:1';
  const before = initial.inventory.pets.find((pet) => pet.id === targetId)!;
  assert.equal(before.level, 36);
  assert.deepEqual(getPetSaleRefund(before), { gold: 320, foods: {} });
  const feed = { requestId: 'mantis-to-37', petId: targetId };
  const fed = quickFeedPet(initial, feed, now).state;
  const target = fed.inventory.pets.find((pet) => pet.id === targetId)!;
  assert.equal(target.level, 37);
  assert.equal(target.experience, 0);
  assert.deepEqual(target.foodSpent, { 'berry-bites': 39 });
  assert.equal(stock(fed, 'berry-bites'), 960);
  const restored = hydrate(fed);
  assert.deepEqual(quoteSale(restored, [targetId]).foods, { 'berry-bites': 39 });
  const sale = { requestId: 'sell-mantis-37', petId: targetId, petIds: [targetId] };
  const sold = sellPetCopies(restored, sale, now);
  assert.equal(stock(sold.state, 'berry-bites'), 999);
  assert.equal(sold.state.economy.gold, 100_320);
  assert.equal(sold.receipt.kind === 'sell' && sold.receipt.refundedFoods?.['berry-bites'], 39);
  const after = hydrate(sold.state);
  assert.equal(sellPetCopies(after, sale).state, after);
  assert.equal(quickFeedPet(after, feed).state, after);
  assert.equal(stock(after, 'berry-bites'), 999);
  assert.equal(initial.inventory.pets.find((pet) => pet.id === targetId)!.level, 36);
});

test('selling a different duplicate cannot refund or discard the trained individual investment', () => {
  let state = resources();
  state = quickFeedPet(state, { requestId: 'feed-exact-id', petId: 'dev-test:mantis:1' }, now).state;
  const sold = sellPetCopies(state, { requestId: 'sell-other-id', petId: 'dev-test:mantis:2', petIds: ['dev-test:mantis:2'] }, now).state;
  assert.equal(stock(sold, 'berry-bites'), 960);
  assert.equal(sold.inventory.pets.find((pet) => pet.id === 'dev-test:mantis:1')!.level, 37);
  assert.deepEqual(sold.inventory.pets.find((pet) => pet.id === 'dev-test:mantis:1')!.foodSpent, { 'berry-bites': 39 });
  const refund = quoteSale(sold, ['dev-test:mantis:1']);
  assert.deepEqual(refund.foods, { 'berry-bites': 39 });
});

test('mixed-species sale refunds each exact selected ledger and each rarity price after hydration', () => {
  let state = resources();
  const main = 'dev-test:mantis:1';
  const other = 'dev-test:ladybug:1';
  state = consumePetFood(state, { requestId: 'feed-mantis-rice', petId: main, itemId: 'rice-bowl' }, now).state;
  state = consumePetFood(state, { requestId: 'feed-mantis-ramen', petId: main, itemId: 'ramen-bowl' }, now).state;
  state = consumePetFood(state, { requestId: 'feed-bug-rice', petId: other, itemId: 'rice-bowl' }, now).state;
  state = hydrate(state);
  const sale = { requestId: 'mixed-refund', petId: main, petIds: [main, other] };
  const before = structuredClone(state);
  assert.deepEqual(quoteSale(state, sale.petIds).foods, { 'rice-bowl': 2, 'ramen-bowl': 1 });
  const sold = sellPetCopies(state, sale, now).state;
  assert.equal(sold.economy.gold, 100_360);
  assert.equal(stock(sold, 'rice-bowl'), 999);
  assert.equal(stock(sold, 'ramen-bowl'), 999);
  assert.equal(sold.inventory.pets.length, 23);
  assert.deepEqual(state, before);
  const restored = hydrate(sold);
  assert.equal(sellPetCopies(restored, { ...sale, petIds: [...sale.petIds].reverse() }).state, restored);
});

test('selling a trained evolved pet returns its own feed plus every star cost, not already-refunded material feed', () => {
  let state = resources();
  // One extra individual permits sale after the full six-base-copy fusion chain.
  state.inventory.pets.push({ ...createPetInstance('mantis', 'extra-mantis'), level: 36 });
  const target = 'dev-test:mantis:1';
  state = consumePetFood(state, { requestId: 'feed-main', petId: target, itemId: 'forest-milk' }, now).state;
  state = consumePetFood(state, { requestId: 'feed-material', petId: 'dev-test:mantis:2', itemId: 'berry-bites' }, now).state;
  state = upgradePet(state, { requestId: 'two', petId: target, targetStars: 2,
    materialPetIds: ['dev-test:mantis:2', 'dev-test:mantis:3'] }, now).state;
  assert.equal(stock(state, 'berry-bites'), 998); // Material berry already returned; one upgrade berry spent.
  state = upgradePet(hydrate(state), { requestId: 'three', petId: target, targetStars: 3,
    materialPetIds: ['dev-test:mantis:4', 'dev-test:mantis:5', 'extra-mantis'] }, now).state;
  // Retain one species copy so this final sale respects the existing rule.
  state.inventory.pets.push(createPetInstance('mantis', 'kept-mantis'));
  const quote = quoteSale(state, [target]);
  assert.equal(quote.gold, 6 * 320 + 700);
  assert.equal(quote.foods['berry-bites'], 3);
  assert.equal(quote.foods['forest-milk'], 4);
  const sold = sellPetCopies(hydrate(state), { requestId: 'sell-three', petId: target, petIds: [target] }, now).state;
  assert.equal(sold.economy.gold, 101_920);
  assert.equal(sold.inventory.items.every((item) => item.quantity === 999), true);
});

test('historical progress without a recorded exact food ledger cannot manufacture a refund from level or EXP', () => {
  const raw = JSON.parse(JSON.stringify(resources()));
  raw.version = 3;
  raw.inventory.beasts = [{ id: 'mantis', quantity: 2, level: 50, experience: 900, stars: 1 }];
  delete raw.inventory.pets;
  const migrated = hydrate(raw);
  const target = migrated.inventory.pets[0];
  assert.equal(target.level, 50);
  assert.deepEqual(target.foodSpent, {});
  assert.deepEqual(quoteSale(migrated, [target.id]).foods, {});
});
