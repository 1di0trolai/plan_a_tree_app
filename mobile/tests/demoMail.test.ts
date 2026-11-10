/** Kiểm thử dữ liệu thư mẫu dành riêng cho bộ kiểm thử, bảo đảm từng thư đọc, xóa và nhận quà đúng một lần. */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createInitialState } from '../src/data/seed';
import { normalizePersistedState } from '../src/store/normalizeState';
import { applyDemoMail, DEMO_MAIL_IDS } from './fixtures/testResources';
import { claimAllMail, claimMail, deleteMail, readMail } from '../src/store/loginMailbox';

const now = new Date('2026-11-04T03:00:00Z');
const signed = () => { const state = createInitialState(); state.auth = { loggedIn: true, remember: true, identity: 'demo-mail@pat.vn' }; return state; };

test('fresh state never seeds letters; explicit demo grant creates four current mail variants without crediting assets', () => {
  const before = signed(); assert.deepEqual(before.mailbox, []);
  const next = applyDemoMail(before, now, 'first');
  assert.equal(next.mailbox.length, 4);
  assert.deepEqual(next.mailbox.map(mail => mail.id), DEMO_MAIL_IDS.map(id => `${id}:first`));
  assert.equal(next.inventory, before.inventory);
  assert.equal(next.economy.gold, before.economy.gold);
  assert.equal(next.economy.demoMailGrantedAt, now.toISOString());
  assert.ok(next.mailbox.every(mail => mail.title.startsWith('[MẪU]') && mail.body.includes('Thư mẫu được tạo trên thiết bị.') && !mail.readAt && !mail.claimedAt));
  assert.ok(next.mailbox.every(mail => !/thử giao diện|bản thử nghiệm|bản mẫu|mô phỏng/i.test(mail.body)));
  assert.equal(next.mailbox[0].source, 'publisher'); assert.deepEqual(next.mailbox[0].attachments, []);
  assert.equal(next.mailbox[1].source, 'system'); assert.ok(next.mailbox[1].attachments.every(attachment => attachment.kind === 'food'));
  assert.deepEqual(next.mailbox[2].attachments, [{ kind: 'gold', quantity: 500 }]);
  assert.deepEqual(next.mailbox[3].attachments.map(attachment => attachment.kind), ['food', 'gold']);
});

test('samples use normal claim/read/delete actions and can be explicitly replenished after reload and deletion', () => {
  let state = applyDemoMail(signed(), now, 'first');
  const ids = state.mailbox.map(mail => mail.id);
  state = readMail(state, ids[0], now).state;
  const beforeRead = state.inventory;
  assert.equal(state.mailbox[0].readAt, now.toISOString()); assert.equal(state.inventory, beforeRead);
  state = claimMail(state, ids[1], now).state;
  assert.equal(state.inventory.items.find(food => food.id === 'berry-bites')!.quantity, 3);
  assert.equal(state.inventory.items.find(food => food.id === 'forest-milk')!.quantity, 1);
  state = claimAllMail(state, now).state;
  assert.equal(state.economy.gold, 620);
  assert.equal(state.inventory.items.find(food => food.id === 'rice-bowl')!.quantity, 2);
  for (const id of ids) state = deleteMail(state, id).state;
  assert.deepEqual(state.mailbox, []);
  const restored = normalizePersistedState(JSON.parse(JSON.stringify(state)));
  assert.equal(restored.economy.demoMailGrantedAt, now.toISOString());
  const replenished = applyDemoMail(restored, new Date('2026-12-01'), 'second');
  assert.equal(replenished.mailbox.length, 4);
  assert.ok(replenished.mailbox.every(mail => !ids.includes(mail.id) && !mail.claimedAt));
  assert.equal(replenished.economy.gold, 620);
  assert.equal(restored.economy.gold, 620);
});

test('samples require sign-in but neither a prior grant nor a legacy receipt blocks a new explicit batch', () => {
  assert.throws(() => applyDemoMail(createInitialState(), now), /đăng nhập/);
  const state = normalizePersistedState({ ...signed(), economy: { ...signed().economy, demoMailGrantedAt: 'invalid' } });
  assert.equal(state.economy.demoMailGrantedAt, undefined);
  const first = applyDemoMail(state, now, 'first');
  assert.equal(first.mailbox.length, 4);
  assert.equal(applyDemoMail(first, now, 'first'), first);
  const next = applyDemoMail(first, now, 'second');
  assert.equal(next.mailbox.length, 8);
  assert.equal(new Set(next.mailbox.map(mail => mail.id)).size, 8);
});

test('separate batches survive hydration with distinct references and each attachment can only be claimed once', () => {
  const first = applyDemoMail(signed(), now, 'first');
  const next = applyDemoMail(first, now, 'second');
  const restored = normalizePersistedState(JSON.parse(JSON.stringify(next)));
  assert.equal(restored.mailbox.length, 8);
  assert.equal(new Set(restored.mailbox.map(mail => `${mail.source}:${mail.sourceRef}`)).size, 8);
  const claimed = claimAllMail(restored, now).state;
  assert.equal(claimed.economy.gold, 1240);
  assert.equal(claimed.inventory.items.find(food => food.id === 'berry-bites')!.quantity, 6);
  assert.equal(claimed.inventory.items.find(food => food.id === 'rice-bowl')!.quantity, 4);
  assert.equal(claimAllMail(claimed, now).state, claimed);
});
