/** Kiểm thử tích quà theo lượt đăng nhập, chuyển quà cũ vào thư và các thao tác đọc, xóa, nhận thưởng. */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createInitialState } from '../src/data/seed';
import { claimAllMail, claimDailyLogin, claimMail, deleteAllMail, deleteMail, getLoginRewardStatus, readAllMail, readMail, syncLoginVisit } from '../src/store/loginMailbox';
import { normalizePersistedState } from '../src/store/normalizeState';
import type { AppState, MailMessage } from '../src/types/app';

const baseTime = new Date('2026-11-01T03:00:00Z');
const day = (index: number) => new Date(baseTime.getTime() + index * 86400000);
function signedIn() {
  const state = createInitialState();
  state.auth = { loggedIn: true, remember: true, identity: 'test@example.com' };
  return state;
}
function visits(count: number, random = () => 0): AppState {
  let state = signedIn();
  for (let index = 0; index < count; index++) state = syncLoginVisit(state, day(index), random).state;
  return state;
}
function publisher(id: string, attachments: MailMessage['attachments']): MailMessage {
  return { id, source: 'publisher', sourceRef: `announcement-${id}`, title: 'Quà thử', body: '',
    createdAt: baseTime.toISOString(), readAt: null, claimedAt: null, attachments };
}

test('actual signed-in visits bank gifts without credit; same-day foreground cannot roll twice', () => {
  const initial = signedIn();
  let rolls = 0;
  const first = syncLoginVisit(initial, baseTime, () => { rolls++; return 0.8; });
  assert.equal(first.result.recorded, true);
  assert.equal(first.result.gift?.itemId, 'honey-cookie');
  assert.equal(first.state.economy.loginVisits.length, 1);
  assert.equal(first.state.economy.loginClaims.length, 0);
  assert.deepEqual(first.state.inventory, initial.inventory);
  const repeated = syncLoginVisit(first.state, day(0), () => { rolls++; return 0.999; });
  assert.equal(repeated.state, first.state);
  assert.equal(rolls, 1);
  assert.equal(getLoginRewardStatus(first.state, day(0)).availableGifts.length, 1);
});

test('skipped days never create entitlements; cycle advances by actual visits, not claims or Mondays', () => {
  let state = signedIn();
  for (const index of [0, 3, 10, 12, 17, 20, 29]) state = syncLoginVisit(state, day(index), () => 0.95).state;
  assert.equal(state.economy.loginVisits.length, 7);
  assert.deepEqual(state.economy.loginVisits.map((gift) => gift.cycleDay), [1, 2, 3, 4, 5, 6, 7]);
  assert.deepEqual(state.economy.loginVisits.map((gift) => gift.itemId),
    ['forest-milk', 'forest-milk', 'forest-milk', 'forest-milk', 'forest-milk', 'forest-milk', 'star-snack']);
  assert.equal(state.mailbox.length, 0);
  assert.equal(state.inventory.items.every((food) => food.quantity === 0), true);
});

test('Vietnam midnight earns exactly one new visit; backward clock cannot invent visits', () => {
  const before = syncLoginVisit(signedIn(), new Date('2026-11-01T16:59:59Z'), () => 0).state;
  const after = syncLoginVisit(before, new Date('2026-11-01T17:00:00Z'), () => 0).state;
  assert.deepEqual(after.economy.loginVisits.map((gift) => gift.date), ['2026-11-01', '2026-11-02']);
  assert.equal(syncLoginVisit(after, day(-2), () => { throw new Error('No rollback rolls'); }).state, after);
});

test('several current-cycle banked gifts can be collected on the same day by tapping each gift', () => {
  let state = visits(3);
  for (const gift of [...state.economy.loginVisits].reverse()) {
    const result = claimDailyLogin(state, day(2), () => { throw new Error('Never reroll a stored gift'); }, gift.id);
    assert.equal(result.result.giftId, gift.id);
    state = result.state;
  }
  assert.equal(state.economy.loginClaims.length, 3);
  assert.equal(state.inventory.items[0].quantity, 3);
  assert.equal(getLoginRewardStatus(state, day(2)).canClaim, false);
  const retried = claimDailyLogin(state, day(3), () => { throw new Error('Retry never rolls'); }, state.economy.loginVisits[0].id);
  assert.equal(retried.state, state);
  assert.equal(retried.result.alreadyClaimed, true);
  assert.equal(state.economy.loginVisits.length, 3);
});

test('unknown explicit gift does not synchronize, roll, grant or mutate', () => {
  const state = signedIn();
  let rolls = 0;
  assert.throws(() => claimDailyLogin(state, baseTime, () => { rolls++; return 0; }, 'missing'));
  assert.equal(rolls, 0);
  assert.deepEqual(state.economy.loginVisits, []);
  assert.deepEqual(state.mailbox, []);
});

test('eighth actual visit moves only unclaimed old-cycle gifts into one fixed system mail', () => {
  let state = visits(7, () => 0.95);
  state = claimDailyLogin(state, day(6), Math.random, state.economy.loginVisits[0].id).state;
  const priorStock = structuredClone(state.inventory);
  const next = syncLoginVisit(state, day(20), () => 0);
  assert.equal(next.result.recorded, true);
  assert.equal(next.result.mailedMessages.length, 1);
  assert.equal(next.state.economy.loginVisits.at(-1)?.cycle, 2);
  assert.equal(next.state.economy.loginVisits.at(-1)?.cycleDay, 1);
  assert.deepEqual(next.state.mailbox[0].attachments,
    [{ kind: 'food', itemId: 'forest-milk', quantity: 5 }, { kind: 'food', itemId: 'star-snack', quantity: 1 }]);
  assert.deepEqual(next.state.inventory, priorStock);
  assert.equal(next.state.economy.loginVisits.slice(1, 7).every((gift) => !!gift.mailedAt), true);
  assert.equal(next.state.economy.loginVisits[0].mailedAt, null);
  assert.throws(() => claimDailyLogin(next.state, day(20), Math.random, next.state.economy.loginVisits[1].id), /hòm thư/);
  const restored = normalizePersistedState(JSON.parse(JSON.stringify(next.state)));
  assert.equal(syncLoginVisit(restored, day(20), () => { throw new Error('No reroll'); }).state, restored);
  assert.deepEqual(restored.mailbox, next.state.mailbox);
});

test('claimed cycle has no rollover mail; next cycle does not expire on ordinary calendar week boundaries', () => {
  let state = signedIn();
  for (let index = 0; index < 8; index++) state = claimDailyLogin(state, day(index * 3), () => 0).state;
  assert.equal(state.economy.loginVisits.length, 8);
  assert.equal(state.economy.loginClaims.length, 8);
  assert.equal(state.mailbox.length, 0);
});

test('mail read, receive, receive-all and deletion are idempotent across hydration', () => {
  let state = visits(8);
  const mailId = state.mailbox[0].id;
  assert.throws(() => deleteMail(state, mailId), /Nhận quà/);
  state = readMail(state, mailId, day(7)).state;
  assert.equal(readMail(state, mailId, day(8)).state, state);
  const first = claimMail(state, mailId, day(7));
  assert.deepEqual(first.result.claimedIds, [mailId]);
  assert.equal(first.state.inventory.items[0].quantity, 7);
  const restored = normalizePersistedState(JSON.parse(JSON.stringify(first.state)));
  assert.equal(claimMail(restored, mailId, day(8)).state, restored);
  assert.equal(claimAllMail(restored, day(8)).state, restored);
  const deleted = deleteMail(restored, mailId);
  assert.equal(deleted.state.mailbox.length, 0);
  assert.equal(deleteMail(deleted.state, mailId).state, deleted.state);
  const tomorrow = syncLoginVisit(normalizePersistedState(deleted.state), day(8), () => 0).state;
  assert.equal(tomorrow.mailbox.length, 0);
  assert.equal(tomorrow.inventory.items[0].quantity, 7);
});

test('receive-all aggregates food and gold atomically, marks all received and does not mint retry rewards', () => {
  const state = signedIn();
  state.mailbox = [publisher('a', [{ kind: 'gold', quantity: 20 }, { kind: 'food', itemId: 'berry-bites', quantity: 2 }]),
    publisher('b', [{ kind: 'food', itemId: 'berry-bites', quantity: 3 }]), publisher('notice', [])];
  const result = claimAllMail(state, baseTime);
  assert.deepEqual(result.result.claimedIds, ['a', 'b']);
  assert.equal(result.state.economy.gold, 20);
  assert.equal(result.state.inventory.items[0].quantity, 5);
  assert.equal(result.state.mailbox[0].readAt, baseTime.toISOString());
  assert.equal(result.state.mailbox[2].claimedAt, null);
  assert.equal(claimAllMail(result.state).state, result.state);
  assert.equal(state.economy.gold, 0);
  assert.equal(state.inventory.items[0].quantity, 0);
});

test('read-all preserves previous read times, leaves attachments unclaimed and survives hydration', () => {
  const state = signedIn();
  const alreadyRead = { ...publisher('read', []), readAt: day(-1).toISOString() };
  state.mailbox = [publisher('gift', [{ kind: 'gold', quantity: 50 }]), alreadyRead, publisher('notice', [])];
  const before = structuredClone(state);
  const next = readAllMail(state, baseTime);
  assert.deepEqual(next.result.readIds, ['gift', 'notice']);
  assert.equal(next.state.mailbox[0].readAt, baseTime.toISOString());
  assert.equal(next.state.mailbox[1], alreadyRead);
  assert.equal(next.state.mailbox[2].readAt, baseTime.toISOString());
  assert.equal(next.state.mailbox.every((mail) => mail.claimedAt === null), true);
  assert.equal(next.state.economy, state.economy);
  assert.equal(next.state.inventory, state.inventory);
  assert.deepEqual(state, before);
  const restored = normalizePersistedState(JSON.parse(JSON.stringify(next.state)));
  assert.deepEqual(restored.mailbox, next.state.mailbox);
  assert.equal(readAllMail(restored, day(1)).state, restored);
  assert.equal(readAllMail(signedIn()).result.readIds.length, 0);
});

test('delete-all keeps every unclaimed gift, deletes eligible mail without receiving or losing inventory', () => {
  const state = signedIn();
  const unreadGift = publisher('unread-gift', [{ kind: 'food', itemId: 'berry-bites', quantity: 2 }]);
  const readGift = { ...publisher('read-gift', [{ kind: 'gold', quantity: 25 }]), readAt: baseTime.toISOString() };
  const claimedGift = { ...publisher('claimed-gift', [{ kind: 'gold', quantity: 5 }]), claimedAt: baseTime.toISOString() };
  state.mailbox = [unreadGift, publisher('notice', []), readGift, claimedGift];
  const before = structuredClone(state);
  const next = deleteAllMail(state);
  assert.deepEqual(next.result.deletedIds, ['notice', 'claimed-gift']);
  assert.deepEqual(next.result.retainedIds, ['unread-gift', 'read-gift']);
  assert.deepEqual(next.state.mailbox, [unreadGift, readGift]);
  assert.equal(next.state.mailbox[0], unreadGift);
  assert.equal(next.state.mailbox[1], readGift);
  assert.equal(next.state.economy, state.economy);
  assert.equal(next.state.inventory, state.inventory);
  assert.deepEqual(state, before);
  const restored = normalizePersistedState(JSON.parse(JSON.stringify(next.state)));
  assert.equal(deleteAllMail(restored).state, restored);
  const received = claimAllMail(restored, baseTime).state;
  assert.equal(received.economy.gold, 25);
  assert.equal(received.inventory.items[0].quantity, 2);
  assert.equal(deleteAllMail(received).state.mailbox.length, 0);
  assert.equal(deleteAllMail(signedIn()).result.deletedIds.length, 0);
});

test('invalid stock, unknown food, malformed amounts and overflow fail the whole mail grant', () => {
  for (const attachments of [
    [{ kind: 'gold', quantity: Number.MAX_SAFE_INTEGER }, { kind: 'gold', quantity: 1 }],
    [{ kind: 'food', itemId: 'missing', quantity: 1 }],
    [{ kind: 'food', itemId: 'berry-bites', quantity: -1 }],
    [{ kind: 'food', itemId: 'berry-bites', quantity: 0.5 }],
    [{ kind: 'food', itemId: 'berry-bites', quantity: Number.MAX_SAFE_INTEGER }, { kind: 'food', itemId: 'berry-bites', quantity: 1 }],
  ] as MailMessage['attachments'][]) {
    const state = signedIn();
    state.mailbox = [publisher('valid', [{ kind: 'gold', quantity: 5 }]), publisher('invalid', attachments)];
    const before = structuredClone(state);
    assert.throws(() => claimAllMail(state, baseTime));
    assert.deepEqual(state, before);
  }
});

test('logged-out sessions cannot bank, claim, read or delete rewards', () => {
  const state = visits(8);
  state.auth.loggedIn = false;
  assert.equal(syncLoginVisit(state, day(9)).state, state);
  assert.throws(() => claimDailyLogin(state, day(9)));
  assert.throws(() => claimMail(state, state.mailbox[0].id));
  assert.throws(() => claimAllMail(state));
  assert.throws(() => readMail(state, state.mailbox[0].id));
  assert.throws(() => readAllMail(state));
  assert.throws(() => deleteMail(state, state.mailbox[0].id));
  assert.throws(() => deleteAllMail(state));
});

test('legacy claimed days migrate as already paid visits without inventing unclaimed gifts', () => {
  const raw = JSON.parse(JSON.stringify(signedIn()));
  raw.version = 4;
  delete raw.economy.loginVisits;
  delete raw.mailbox;
  raw.economy.loginClaims = [0, 3, 10].map((index) => ({ date: day(index).toISOString().slice(0, 10),
    cycleDay: index, itemId: 'berry-bites', claimedAt: day(index).toISOString() }));
  // Three valid old receipts, using their recorded cycle days rather than calendar gaps.
  raw.economy.loginClaims.forEach((claim: { cycleDay: number }, index: number) => { claim.cycleDay = index + 1; });
  const normalized = normalizePersistedState(raw);
  assert.equal(normalized.version, 5);
  assert.equal(normalized.economy.loginVisits.length, 3);
  assert.equal(normalized.economy.loginVisits.every((gift) => !!gift.claimedAt), true);
  assert.deepEqual(normalized.mailbox, []);
  assert.deepEqual(normalized.inventory, signedIn().inventory);
  const fourth = syncLoginVisit(normalized, day(11), () => 0).state;
  assert.equal(fourth.economy.loginVisits[3].cycleDay, 4);
  assert.equal(fourth.mailbox.length, 0);
});

test('normalization preserves gift rolls, receipts and mail flags; settings are bounded and deduplicated', () => {
  const raw = JSON.parse(JSON.stringify(visits(8)));
  raw.economy.loginVisits.push(raw.economy.loginVisits[0]);
  raw.mailbox.push(raw.mailbox[0]);
  raw.settings.giftDock = { edge: 'right', ratio: 3 };
  raw.settings.quickSaleRarities = ['Hiếm', 'Hiếm', 'wrong'];
  const restored = normalizePersistedState(raw);
  assert.equal(restored.economy.loginVisits.length, 8);
  assert.equal(restored.mailbox.length, 1);
  assert.deepEqual(restored.settings.giftDock, { edge: 'right', ratio: 1 });
  assert.deepEqual(restored.settings.quickSaleRarities, ['Hiếm']);
  assert.deepEqual(normalizePersistedState(restored).economy.loginVisits, restored.economy.loginVisits);
});

test('deleting claimed mail does not regenerate an expired gift after a later cycle', () => {
  let state = visits(8);
  const id = state.mailbox[0].id;
  state = deleteMail(claimMail(state, id).state, id).state;
  for (let index = 8; index < 15; index++) state = syncLoginVisit(state, day(index), () => 0).state;
  assert.equal(state.mailbox.length, 1);
  assert.equal(state.mailbox[0].sourceRef, 'login-cycle-2');
  assert.equal(state.inventory.items[0].quantity, 7);
  assert.equal(state.economy.loginVisits.at(-1)?.cycle, 3);
});
