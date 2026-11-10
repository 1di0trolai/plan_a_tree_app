/** Tạo thư mẫu và mức tài nguyên dành riêng cho kiểm thử; ứng dụng thật không được nhập hoặc sử dụng tệp này. */
import { SHOP_CATALOG } from '../../src/data/economy';
import { createPetInstance } from '../../src/store/petCollection';
import { PET_CAPACITY } from '../../src/data/petProgression';
import type { AppState, MailMessage } from '../../src/types/app';
import { createId } from '../../src/utils/id';

/** Development preview only. These are floors, never recurring or additive rewards. */
export const TEST_RESOURCE_FLOORS = { gold: 100_000, food: 999, petCopies: 5, petLevel: 36 } as const;
export const TEST_RESOURCE_PET_IDS = ['caterpillar', 'ladybug', 'hunter-bee', 'moon-moth', 'mantis'] as const;

export const DEMO_MAIL_IDS = ['demo-mail:notice:v1', 'demo-mail:food:v1', 'demo-mail:gold:v1', 'demo-mail:mixed:v1'] as const;

/** Explicit repeatable local samples, not remote publisher delivery.
 * The provider keeps one durable snapshot per in-flight action to avoid double taps. */
export function applyDemoMail(current: AppState, now = new Date(), batchId = createId('sample-mail')): AppState {
  if (!current.auth.loggedIn) throw new Error('Hãy đăng nhập trước khi thêm thư mẫu.');
  const createdAt = now.toISOString();
  const ids = DEMO_MAIL_IDS.map((id) => `${id}:${batchId}`);
  if (current.mailbox.some((mail) => ids.includes(mail.id))) return current;
  const base = { createdAt, readAt: null, claimedAt: null };
  const localNotice = 'Thư mẫu được tạo trên thiết bị.';
  const samples: MailMessage[] = [
    { ...base, id: ids[0], source: 'publisher', sourceRef: `demo:publisher-notice:${batchId}`,
      title: '[MẪU] Lời chào từ PAT', body: `Chào mừng bạn đến với khu vườn PAT! ${localNotice}`, attachments: [] },
    { ...base, id: ids[1], source: 'system', sourceRef: `demo:system-food:${batchId}`,
      title: '[MẪU] Quà ghé vườn', body: `Một chút thức ăn dành cho những người bạn nhỏ. ${localNotice}`,
      attachments: [{ kind: 'food', itemId: 'berry-bites', quantity: 3 }, { kind: 'food', itemId: 'forest-milk', quantity: 1 }] },
    { ...base, id: ids[2], source: 'publisher', sourceRef: `demo:publisher-gold:${batchId}`,
      title: '[MẪU] Quà vàng từ PAT', body: `Gửi bạn một túi vàng để mua sắm cho khu vườn. ${localNotice}`,
      attachments: [{ kind: 'gold', quantity: 500 }] },
    { ...base, id: ids[3], source: 'publisher', sourceRef: `demo:publisher-mixed:${batchId}`,
      title: '[MẪU] Gói quà làm vườn', body: `Thức ăn và vàng cho một ngày chăm vườn thật vui. ${localNotice}`,
      attachments: [{ kind: 'food', itemId: 'rice-bowl', quantity: 2 }, { kind: 'gold', quantity: 120 }] },
  ];
  const existingIds = new Set(current.mailbox.map((mail) => mail.id));
  return { ...current,
    economy: { ...current.economy, demoMailGrantedAt: createdAt },
    mailbox: [...current.mailbox, ...samples.filter((mail) => !existingIds.has(mail.id))],
  };
}

export function applyTestResourceFloors(current: AppState, development: boolean): AppState {
  if (!development) throw new Error('Không thể nạp tài nguyên trong phiên này.');
  if (!current.auth.loggedIn) throw new Error('Hãy đăng nhập trước khi nạp tài nguyên.');
  const foods = new Set<string>(SHOP_CATALOG.map((item) => item.itemId));
  const pets = [...current.inventory.pets];
  // IDs identify an individual for its entire lifetime, even after a sale or fusion.
  // Reusing a consumed ID would make old receipts refer to a newly granted pet.
  const usedIds = new Set([
    ...pets.map((pet) => pet.id),
    ...current.economy.petTransactions.flatMap((receipt) => [receipt.petId,
      ...(receipt.kind === 'sell' ? receipt.petIds ?? []
        : receipt.kind === 'upgrade' ? receipt.materialPetIds ?? [] : [])]),
    ...current.dailyPacks.flatMap((pack) => pack.petInstanceId ? [pack.petInstanceId] : []),
  ]);
  for (const speciesId of TEST_RESOURCE_PET_IDS) {
    let count = pets.filter((pet) => pet.speciesId === speciesId).length;
    let index = 1;
    while (count < TEST_RESOURCE_FLOORS.petCopies && pets.length < PET_CAPACITY) {
      let id: string;
      do { id = `dev-test:${speciesId}:${index++}`; } while (usedIds.has(id));
      // Preview levels are not fed EXP: no paid-food or upgrade-cost ledger to refund.
      pets.push({ ...createPetInstance(speciesId, id), level: TEST_RESOURCE_FLOORS.petLevel });
      usedIds.add(id);
      count += 1;
    }
  }
  return {
    ...current,
    economy: { ...current.economy, gold: Math.max(current.economy.gold, TEST_RESOURCE_FLOORS.gold) },
    inventory: { ...current.inventory, pets,
      items: current.inventory.items.map((food) => foods.has(food.id)
        ? { ...food, quantity: Math.max(food.quantity, TEST_RESOURCE_FLOORS.food) } : food) },
  };
}
