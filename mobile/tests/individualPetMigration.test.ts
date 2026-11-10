/** Kiểm thử chuyển dữ liệu thú gộp cũ thành từng cá thể, giữ tiến trình và chi phí hoàn trả không bị lặp. */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createInitialState } from '../src/data/seed';
import { PET_UPGRADE_FOOD_IDS } from '../src/data/petProgression';
import { migrateLegacyPets, normalizePetInstances } from '../src/store/normalizePets';
import { normalizePersistedState } from '../src/store/normalizeState';
import { getPetSaleRefund } from '../src/store/petCollection';
import { createPetInstance } from '../src/store/petCollection';
import { consumePetFood, quickFeedPet, sellPetCopies, upgradePet } from '../src/store/petActions';
import { FRESH_START_EPOCH, LEGACY_PET_BACKUP_KEY, STORAGE_KEY, loadStoredUserData, type UserStorage } from '../src/store/storageLifecycle';

const oldInventory = () => ({ beasts: [{ id: 'ladybug', quantity: 5, level: 38, experience: 85, stars: 3, owned: true }],
  items: createInitialState().inventory.items, companionId: 'ladybug' });

test('legacy split preserves total count, trained main and recoverable upgrade investment exactly once', () => {
  const old = { ...createInitialState(), version: 3, inventory: oldInventory() };
  const migrated = normalizePersistedState(old);
  assert.equal(migrated.inventory.pets.length, 5);
  const [main, ...spares] = migrated.inventory.pets;
  assert.equal(main.stars, 3);
  assert.equal(main.level, 38);
  assert.equal(main.experience, 85);
  assert.deepEqual(main.foodSpent, {});
  assert.equal(main.baseCopies, 6);
  assert.equal(main.upgradeGoldSpent, 700);
  assert.deepEqual(main.upgradeFoodSpent, Object.fromEntries(PET_UPGRADE_FOOD_IDS.map((id) => [id, 3])));
  assert.equal(getPetSaleRefund(main).gold, 6 * 40 + 700);
  assert.ok(spares.every((pet) => pet.level === 1 && pet.stars === 1 && pet.experience === 0 && pet.baseCopies === 1));
  assert.deepEqual(normalizePersistedState(migrated), migrated);
  assert.equal('companionId' in migrated.inventory, false);
});

test('corrupt or excessive legacy counts fail without silently deleting or truncating pets', () => {
  for (const quantity of [-1, 1.5, Infinity, 1_000_000]) {
    assert.throws(() => migrateLegacyPets([{ id: 'ladybug', quantity }]), /Số lượng thú nuôi cũ/);
  }
  assert.throws(() => migrateLegacyPets([{ id: 'ladybug', quantity: 1 }, { id: 'ladybug', quantity: 2 }]), /Số lượng thú nuôi cũ/);
});

test('individual records retain exact ledgers and reject duplicate IDs or corrupt refund counts', () => {
  const [pet] = migrateLegacyPets(oldInventory().beasts);
  pet.foodSpent = { 'berry-bites': 7, 'rice-bowl': 2 };
  assert.deepEqual(normalizePetInstances([pet]), [pet]);
  assert.throws(() => normalizePetInstances([pet, pet]), /Hồ sơ thú nuôi/);
  for (const bad of [{ 'berry-bites': -1 }, { 'berry-bites': 0.5 }, { unknown: 1 }]) {
    assert.throws(() => normalizePetInstances([{ ...pet, foodSpent: bad }]), /Sổ thức ăn/);
  }
});

function legacyPort() {
  const initial = JSON.stringify({ storageEpoch: FRESH_START_EPOCH, state: { ...createInitialState(), version: 3,
    inventory: oldInventory() }, pendingPhotoCleanup: [] });
  const records = new Map([[STORAGE_KEY, initial]]);
  const writes: string[] = [];
  const port: UserStorage = { getItem: async (key) => records.get(key) ?? null,
    setItem: async (key, value) => { writes.push(key); records.set(key, value); },
    listPhotos: () => { throw new Error('Migration must not reset photos.'); },
    deletePhoto: () => { throw new Error('Migration must not delete photos.'); } };
  return { initial, records, writes, port };
}

test('v3 load backs up inventory then commits v5 without reset; repeated load never replays migration', async () => {
  const memory = legacyPort();
  const result = await loadStoredUserData(memory.port);
  assert.equal(result.state.version, 5);
  assert.equal(result.state.inventory.pets.length, 5);
  assert.deepEqual(memory.writes, [LEGACY_PET_BACKUP_KEY, STORAGE_KEY]);
  assert.deepEqual(JSON.parse(memory.records.get(LEGACY_PET_BACKUP_KEY)!), { version: 3, inventory: oldInventory() });
  const next = await loadStoredUserData(memory.port);
  assert.deepEqual(next.state.inventory, result.state.inventory);
  assert.equal(memory.writes.length, 2);
});

test('failed backup or first migration commit leaves the original main save readable', async () => {
  for (const failedKey of [LEGACY_PET_BACKUP_KEY, STORAGE_KEY]) {
    const memory = legacyPort();
    const write = memory.port.setItem;
    memory.port.setItem = async (key, value) => { if (key === failedKey) throw new Error('disk full'); await write(key, value); };
    await assert.rejects(loadStoredUserData(memory.port), /disk full/);
    assert.equal(memory.records.get(STORAGE_KEY), memory.initial);
    memory.port.setItem = write;
    assert.equal((await loadStoredUserData(memory.port)).state.inventory.pets.length, 5);
  }
});

test('feed, material-refund, two upgrades and sale survive hydration without replaying refunds', () => {
  let state = createInitialState();
  state.auth = { loggedIn: true, remember: true, identity: 'keeper@example.test' };
  state.economy.gold = 1_000;
  state.inventory.items = state.inventory.items.map((food) => ({ ...food, quantity: 20 }));
  state.inventory.pets = Array.from({ length: 7 }, (_, index) => ({ ...createPetInstance('ladybug', `pet-${index}`), level: 36 }));
  const hydrate = () => { state = normalizePersistedState(JSON.parse(JSON.stringify(state))); };
  const feed = { requestId: 'feed-main', petId: 'pet-0', itemId: 'berry-bites' };
  state = consumePetFood(state, feed).state;
  const materialFeed = { requestId: 'feed-material', petId: 'pet-1', itemId: 'rice-bowl' };
  state = consumePetFood(state, materialFeed).state;
  hydrate();
  assert.equal(consumePetFood(state, feed).alreadyApplied, true);
  const second = { requestId: 'two-stars', petId: 'pet-0', targetStars: 2 as const, materialPetIds: ['pet-1', 'pet-2'] };
  state = upgradePet(state, second).state;
  hydrate();
  assert.equal(upgradePet(state, { ...second, materialPetIds: [...second.materialPetIds].reverse() }).alreadyApplied, true);
  assert.equal(state.inventory.items.find((food) => food.id === 'rice-bowl')!.quantity, 19);
  assert.deepEqual(state.inventory.pets[0].foodSpent, { 'berry-bites': 1 });
  const third = { requestId: 'three-stars', petId: 'pet-0', targetStars: 3 as const, materialPetIds: ['pet-3', 'pet-4', 'pet-5'] };
  state = upgradePet(state, third).state;
  hydrate();
  const sell = { requestId: 'sell-trained', petId: 'pet-0', petIds: ['pet-0'] };
  state = sellPetCopies(state, sell).state;
  hydrate();
  assert.equal(state.economy.gold, 1_000 + 6 * 40);
  assert.ok(state.inventory.items.every((food) => food.quantity === 20));
  assert.equal(state.inventory.pets.length, 1);
  assert.equal(sellPetCopies(state, sell).alreadyApplied, true);
  assert.equal(upgradePet(state, third).alreadyApplied, true);
  assert.equal(consumePetFood(state, materialFeed).alreadyApplied, true);
  const quick = { requestId: 'quick-survivor', petId: 'pet-6' };
  state = quickFeedPet(state, quick).state;
  hydrate();
  assert.equal(quickFeedPet(state, quick).alreadyApplied, true);
});
