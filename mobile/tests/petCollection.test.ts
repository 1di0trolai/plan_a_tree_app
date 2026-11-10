/** Kiểm thử tạo và sắp xếp cá thể thú, chọn nguyên liệu tăng sao và tính giá trị hoàn trả khi bán. */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createInitialState, PET_SPECIES } from '../src/data/seed';
import { PET_SALE_PRICES, PET_UPGRADE_FOOD_IDS } from '../src/data/petProgression';
import {
  addFoodLedgers, comparePetViews, createPetInstance, getEligibleUpgradeMaterials,
  getPetSaleRefund, getPetViews, getQuickSalePetIds, quoteMaterialRefund, quoteSale,
} from '../src/store/petCollection';
import type { PetFoodLedger, PetInstance, PetStars } from '../src/types/app';

function atStars(pet: PetInstance, stars: PetStars): PetInstance {
  const foodCount = stars === 1 ? 0 : stars === 2 ? 1 : 3;
  return { ...pet, stars, baseCopies: stars === 1 ? 1 : stars === 2 ? 3 : 6,
    upgradeGoldSpent: stars === 1 ? 0 : stars === 2 ? 200 : 700,
    upgradeFoodSpent: foodCount ? Object.fromEntries(PET_UPGRADE_FOOD_IDS.map((id) => [id, foodCount])) : {} };
}

test('instance factory creates separate per-pet progression/ledgers and validates catalogue identity', () => {
  const first = createPetInstance('ladybug', 'first');
  const second = createPetInstance('ladybug', 'second');
  assert.deepEqual(first, { id: 'first', speciesId: 'ladybug', level: 1, experience: 0, stars: 1,
    baseCopies: 1, upgradeGoldSpent: 0, foodSpent: {}, upgradeFoodSpent: {} });
  first.foodSpent['berry-bites'] = 2;
  assert.deepEqual(second.foodSpent, {});
  assert.deepEqual(second.upgradeFoodSpent, {});
  assert.throws(() => createPetInstance('unknown', 'id'), /không hợp lệ/);
  assert.throws(() => createPetInstance('ladybug', '  '), /không hợp lệ/);
});

test('joined cards sort rarity descending, then stars, level and stable instance ID, without grouping duplicates', () => {
  const pets = [
    { ...atStars(createPetInstance('moon-moth', 'epic-low'), 3), level: 20 },
    { ...createPetInstance('mantis', 'legendary'), level: 1 },
    { ...atStars(createPetInstance('moon-moth', 'epic-high-z'), 3), level: 50 },
    { ...atStars(createPetInstance('moon-moth', 'epic-high-a'), 3), level: 50 },
    { ...createPetInstance('moon-moth', 'epic-one'), level: 99 },
    { ...atStars(createPetInstance('caterpillar', 'common-three'), 3), level: 36 },
    { ...createPetInstance('caterpillar', 'common-one'), level: 99 },
  ];
  const original = pets.map((pet) => pet.id);
  const views = getPetViews(pets);
  assert.deepEqual(views.map((pet) => pet.id), ['legendary', 'epic-high-a', 'epic-high-z', 'epic-low', 'epic-one', 'common-three', 'common-one']);
  assert.equal(views.length, pets.length);
  assert.equal(views.filter((pet) => pet.speciesId === 'moon-moth').length, 4);
  assert.deepEqual(pets.map((pet) => pet.id), original);
  assert.equal(comparePetViews(views[0], views[0]), 0);
  assert.equal(views[0].name, PET_SPECIES.find((pet) => pet.id === 'mantis')!.name);
  assert.equal('quantity' in views[0], false);
  assert.equal('owned' in views[0], false);
});

test('sale quote pays G / 3G+200 / 6G+700 and returns only recorded feed plus upgrade food for every rarity', () => {
  for (const species of PET_SPECIES) {
    const G = PET_SALE_PRICES[species.rarity];
    for (const stars of [1, 2, 3] as const) {
      const pet = atStars(createPetInstance(species.id, `${species.id}-${stars}`), stars);
      pet.foodSpent = { 'berry-bites': 2 };
      const refund = getPetSaleRefund(pet);
      assert.equal(refund.gold, stars === 1 ? G : stars === 2 ? 3 * G + 200 : 6 * G + 700);
      assert.equal(refund.foods['berry-bites'], stars === 1 ? 2 : stars === 2 ? 3 : 5);
      for (const id of PET_UPGRADE_FOOD_IDS.filter((id) => id !== 'berry-bites')) {
        assert.equal(refund.foods[id] ?? 0, stars === 1 ? 0 : stars === 2 ? 1 : 3);
      }
    }
  }
});

test('bulk sale quote sums exact mixed-species pets and rejects missing or repeated IDs without mutating order', () => {
  const state = createInitialState();
  state.inventory.pets = [createPetInstance('ladybug', 'one'), atStars(createPetInstance('ladybug', 'two'), 2), createPetInstance('caterpillar', 'worm')];
  state.inventory.pets[0].foodSpent = { 'forest-milk': 2 };
  const quote = quoteSale(state, ['two', 'one']);
  assert.equal(quote.gold, 360);
  assert.equal(quote.quantity, 2);
  assert.equal(quote.foods['forest-milk'], 3);
  assert.deepEqual(quote.petIds, ['two', 'one']);
  assert.deepEqual(state.inventory.pets.map((pet) => pet.id), ['one', 'two', 'worm']);
  assert.equal(quoteSale(state, ['one', 'worm']).gold, 60);
  for (const ids of [[], ['one', 'one'], ['one', 'missing']]) assert.throws(() => quoteSale(state, ids));
});

test('material picker lists only other one-star pets of the same species, including trained copies for manual choice', () => {
  const pets = [atStars(createPetInstance('ladybug', 'main'), 2),
    { ...createPetInstance('ladybug', 'trained'), level: 99 }, createPetInstance('ladybug', 'fresh'),
    atStars(createPetInstance('ladybug', 'upgraded'), 2), createPetInstance('caterpillar', 'other')];
  assert.deepEqual(getEligibleUpgradeMaterials(pets, 'main').map((pet) => pet.id), ['trained', 'fresh']);
  assert.deepEqual(getEligibleUpgradeMaterials(pets, 'missing'), []);
  pets[1].foodSpent = { 'rice-bowl': 2 };
  pets[2].foodSpent = { 'rice-bowl': 1, 'ramen-bowl': 3 };
  assert.deepEqual(quoteMaterialRefund([pets[1], pets[2]]), { foods: { 'rice-bowl': 3, 'ramen-bowl': 3 } });
  assert.throws(() => quoteMaterialRefund([pets[1], pets[1]]), /khác nhau/);
  assert.throws(() => quoteMaterialRefund([pets[0]]), /1 sao/);
});

test('refund ledger validation rejects unknown food, fractions, negatives and safe-integer overflows', () => {
  assert.deepEqual(addFoodLedgers({ 'berry-bites': 1 }, { 'berry-bites': 2, 'rice-bowl': 0 }), { 'berry-bites': 3 });
  const invalidLedgers: PetFoodLedger[] = [{ unknown: 1 }, { 'berry-bites': -1 }, { 'berry-bites': 1.5 }, { 'berry-bites': Infinity }];
  for (const ledger of invalidLedgers) {
    assert.throws(() => addFoodLedgers(ledger));
  }
  assert.throws(() => addFoodLedgers({ 'berry-bites': Number.MAX_SAFE_INTEGER }, { 'berry-bites': 1 }), /giới hạn/);
  const pet = createPetInstance('ladybug', 'invalid');
  pet.baseCopies = 3;
  assert.throws(() => getPetSaleRefund(pet), /Chi phí/);
  pet.baseCopies = 1;
  pet.upgradeGoldSpent = Number.MAX_SAFE_INTEGER;
  assert.throws(() => getPetSaleRefund(pet), /Chi phí/);
});

test('quick sale filters rarity, 1-star and level 1 while retaining the strongest individual of every species', () => {
  const pets = [
    createPetInstance('caterpillar', 'worm-a'),
    { ...createPetInstance('caterpillar', 'worm-b'), experience: 75, foodSpent: { 'berry-bites': 3 } },
    { ...createPetInstance('caterpillar', 'worm-trained'), level: 18 },
    atStars(createPetInstance('ladybug', 'ladybug-two'), 2),
    createPetInstance('ladybug', 'ladybug-fresh'),
    createPetInstance('hunter-bee', 'bee-only'),
    createPetInstance('mantis', 'mantis-a'), createPetInstance('mantis', 'mantis-b'),
  ];
  const before = structuredClone(pets);
  assert.deepEqual(new Set(getQuickSalePetIds(pets, ['Thường'])), new Set(['worm-a', 'worm-b']));
  assert.deepEqual(new Set(getQuickSalePetIds(pets, ['Thường', 'Không phổ biến', 'Huyền thoại'])),
    new Set(['worm-a', 'worm-b', 'ladybug-fresh', 'mantis-b']));
  assert.deepEqual(getQuickSalePetIds(pets, []), []);
  assert.deepEqual(pets, before);
});

test('quick-sale candidate retention works for multiple common species and fresh identical copies', () => {
  const pets = [createPetInstance('caterpillar', 'worm-z'), createPetInstance('caterpillar', 'worm-a'),
    createPetInstance('dew-snail', 'snail-only')];
  assert.deepEqual(getQuickSalePetIds(pets, ['Thường']), ['worm-z']);
});
