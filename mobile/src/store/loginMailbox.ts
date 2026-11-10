/** Ghi nhận ngày ghé vườn, quà đăng nhập theo chu kỳ và chuyển quà chưa nhận sang hòm thư. Xử lý đọc, nhận và xóa thư mà không trao thưởng trùng. */

import { rollFood, SHOP_CATALOG } from '../data/economy';
import { localDateKey } from '../data/seed';
import type { AppState, LoginGift, LoginRewardClaim, MailAttachment, MailMessage } from '../types/app';

function requireSession(current: AppState) {
  if (!current.auth.loggedIn) throw new Error('Hãy đăng nhập trước khi nhận quà.');
}

function available(gift: LoginGift) { return gift.claimedAt === null && gift.mailedAt === null; }
function visitOrdinal(gift: LoginGift) { return (gift.cycle - 1) * 7 + gift.cycleDay; }

export function getLoginRewardStatus(current: AppState, now = new Date()) {
  const visits = current.economy.loginVisits;
  const today = localDateKey(now);
  const todayGift = visits.find((entry) => entry.date === today) ?? null;
  const currentCycle = visits.at(-1)?.cycle ?? 1;
  const gifts = visits.filter((entry) => entry.cycle === currentCycle);
  const availableGifts = gifts.filter((entry) => available(entry) && entry.date <= today);
  const todayClaim = current.economy.loginClaims.find((entry) => entry.date === today) ?? null;
  return { canClaim: current.auth.loggedIn && availableGifts.length > 0,
    nextCycleDay: todayGift?.cycleDay ?? (visits.at(-1) ? visitOrdinal(visits.at(-1)!) : 0) % 7 + 1,
    todayClaim, todayGift, currentCycle, gifts, availableGifts };
}

/** One UTC+7 date actually seen by a signed-in foreground session earns one gift.
 * No missing dates are backfilled. Rolls occur once, when the entitlement is stored.
 */
export function syncLoginVisit(current: AppState, now = new Date(), random = Math.random) {
  const unchanged = { state: current, result: { recorded: false, gift: null as LoginGift | null,
    mailedMessage: null as MailMessage | null, mailedMessages: [] as MailMessage[] } };
  if (!current.auth.loggedIn) return unchanged;
  const date = localDateKey(now);
  const visits = current.economy.loginVisits;
  const existing = visits.find((gift) => gift.date === date);
  // A reversed device clock must not insert an extra ordinal into a completed cycle.
  if (!existing && visits.some((gift) => gift.date > date)) return unchanged;
  const ordinal = visits.at(-1) ? visitOrdinal(visits.at(-1)!) : 0;
  const gift: LoginGift = existing ?? { id: `login-gift-${date}`, date,
    cycle: Math.floor(ordinal / 7) + 1, cycleDay: ordinal % 7 + 1,
    itemId: rollFood(random, ordinal % 7 === 6), earnedAt: now.toISOString(),
    claimedAt: null, mailedAt: null };
  const updatedVisits = existing ? visits : [...visits, gift];
  const oldCycles = [...new Set(updatedVisits.filter((entry) => entry.cycle < gift.cycle && available(entry))
    .map((entry) => entry.cycle))];
  let mailbox = current.mailbox;
  let finalVisits = updatedVisits;
  const mailedMessages: MailMessage[] = [];
  for (const cycle of oldCycles) {
    const sourceRef = `login-cycle-${cycle}`;
    const previous = mailbox.find((mail) => mail.source === 'system' && mail.sourceRef === sourceRef);
    const foods = new Map<string, number>();
    for (const entry of finalVisits.filter((visit) => visit.cycle === cycle && available(visit))) {
      foods.set(entry.itemId, (foods.get(entry.itemId) ?? 0) + 1);
    }
    const mail: MailMessage = previous ?? { id: `mail-${sourceRef}`, source: 'system', sourceRef,
      title: 'Quà ghé vườn', body: `Quà chưa nhận của chu kỳ ${cycle}.`,
      createdAt: now.toISOString(), readAt: null, claimedAt: null,
      attachments: [...foods].map(([itemId, quantity]) => ({ kind: 'food', itemId, quantity })) };
    if (!previous) { mailbox = [...mailbox, mail]; mailedMessages.push(mail); }
    finalVisits = finalVisits.map((entry) => entry.cycle === cycle && available(entry)
      ? { ...entry, mailedAt: mail.createdAt } : entry);
  }
  if (existing && finalVisits === visits) return { ...unchanged, result: { ...unchanged.result, gift } };
  return { state: { ...current, economy: { ...current.economy, loginVisits: finalVisits }, mailbox },
    result: { recorded: !existing, gift, mailedMessage: mailedMessages.at(-1) ?? null, mailedMessages } };
}

export interface LoginRewardResult { alreadyClaimed: boolean; claim: LoginRewardClaim; giftId: string }

/** Explicit gift IDs never create a different gift or spend a fresh random roll. */
export function claimDailyLogin(current: AppState, now = new Date(), random = Math.random, giftId?: string): { state: AppState; result: LoginRewardResult } {
  requireSession(current);
  if (giftId !== undefined && (typeof giftId !== 'string' || !giftId.trim() || giftId.length > 200)) {
    throw new Error('Mã hộp quà không hợp lệ.');
  }
  const synced = giftId !== undefined ? current : syncLoginVisit(current, now, random).state;
  const status = getLoginRewardStatus(synced, now);
  const gift = giftId !== undefined ? synced.economy.loginVisits.find((entry) => entry.id === giftId)
    : status.availableGifts[0] ?? status.todayGift;
  if (!gift || gift.date > localDateKey(now)) throw new Error('Hộp quà này chưa thể nhận.');
  if (gift.claimedAt !== null) {
    const claim = synced.economy.loginClaims.find((entry) => entry.date === gift.date)
      ?? { date: gift.date, cycleDay: gift.cycleDay, itemId: gift.itemId, claimedAt: gift.claimedAt };
    return { state: synced, result: { alreadyClaimed: true, claim, giftId: gift.id } };
  }
  if (gift.mailedAt !== null || gift.cycle !== status.currentCycle) throw new Error('Quà này đã chuyển vào hòm thư.');
  const timestamp = now.toISOString();
  const claim: LoginRewardClaim = { date: gift.date, cycleDay: gift.cycleDay, itemId: gift.itemId, claimedAt: timestamp };
  const credited = creditAttachments(synced, [{ kind: 'food', itemId: gift.itemId, quantity: 1 }]);
  return { state: { ...credited, economy: { ...credited.economy,
    loginVisits: credited.economy.loginVisits.map((entry) => entry.id === gift.id ? { ...entry, claimedAt: timestamp } : entry),
    loginClaims: [...credited.economy.loginClaims, claim] } }, result: { alreadyClaimed: false, claim, giftId: gift.id } };
}

/** Validate the entire grant before returning any changed inventory or balance. */
function creditAttachments(current: AppState, attachments: MailAttachment[]): AppState {
  let gold = current.economy.gold;
  if (!Number.isSafeInteger(gold) || gold < 0) throw new Error('Số dư vàng không hợp lệ.');
  const foods = new Map<string, number>();
  for (const attachment of attachments) {
    if (!Number.isSafeInteger(attachment.quantity) || attachment.quantity <= 0) throw new Error('Quà đính kèm không hợp lệ.');
    if (attachment.kind === 'gold') {
      gold += attachment.quantity;
      if (!Number.isSafeInteger(gold)) throw new Error('Số dư vàng vượt giới hạn.');
    } else if (attachment.kind === 'food') {
      const catalog = SHOP_CATALOG.find((entry) => entry.itemId === attachment.itemId);
      const item = current.inventory.items.find((entry) => entry.id === attachment.itemId);
      if (!catalog || !item || item.category !== 'Thức ăn' || item.experienceGain !== catalog.experienceGain) {
        throw new Error('Thức ăn này hiện không có trong kho hàng.');
      }
      const quantity = (foods.get(attachment.itemId) ?? 0) + attachment.quantity;
      if (!Number.isSafeInteger(quantity) || !Number.isSafeInteger(item.quantity) || item.quantity < 0
        || !Number.isSafeInteger(item.quantity + quantity)) throw new Error('Số lượng thức ăn vượt giới hạn.');
      foods.set(attachment.itemId, quantity);
    } else throw new Error('Quà đính kèm chưa được hỗ trợ.');
  }
  return { ...current, economy: { ...current.economy, gold }, inventory: { ...current.inventory,
    items: current.inventory.items.map((item) => foods.has(item.id)
      ? { ...item, quantity: item.quantity + foods.get(item.id)! } : item) } };
}

export function readMail(current: AppState, mailId: string, now = new Date()) {
  requireSession(current);
  const mail = current.mailbox.find((entry) => entry.id === mailId);
  if (!mail) throw new Error('Không tìm thấy thư.');
  if (mail.readAt) return { state: current, result: { mail } };
  const read = { ...mail, readAt: now.toISOString() };
  return { state: { ...current, mailbox: current.mailbox.map((entry) => entry.id === mailId ? read : entry) }, result: { mail: read } };
}

export function readAllMail(current: AppState, now = new Date()) {
  requireSession(current);
  const unread = current.mailbox.filter((mail) => mail.readAt === null);
  if (unread.length === 0) return { state: current, result: { readIds: [] as string[] } };
  const timestamp = now.toISOString();
  return { state: { ...current, mailbox: current.mailbox.map((mail) => mail.readAt === null
    ? { ...mail, readAt: timestamp } : mail) }, result: { readIds: unread.map((mail) => mail.id) } };
}

export interface MailClaimResult { claimedIds: string[]; alreadyClaimed: boolean; attachments: MailAttachment[] }

function claimMessages(current: AppState, messages: MailMessage[], now: Date): { state: AppState; result: MailClaimResult } {
  const pending = messages.filter((mail) => mail.attachments.length > 0 && mail.claimedAt === null);
  if (pending.length === 0) return { state: current, result: { claimedIds: [], alreadyClaimed: true, attachments: [] } };
  const attachments = pending.flatMap((mail) => mail.attachments);
  const credited = creditAttachments(current, attachments);
  const ids = new Set(pending.map((mail) => mail.id));
  return { state: { ...credited, mailbox: credited.mailbox.map((mail) => ids.has(mail.id)
    ? { ...mail, readAt: mail.readAt ?? now.toISOString(), claimedAt: now.toISOString() } : mail) },
  result: { claimedIds: [...ids], alreadyClaimed: false, attachments } };
}

export function claimMail(current: AppState, mailId: string, now = new Date()) {
  requireSession(current);
  const mail = current.mailbox.find((entry) => entry.id === mailId);
  if (!mail) throw new Error('Không tìm thấy thư.');
  return claimMessages(current, [mail], now);
}

export function claimAllMail(current: AppState, now = new Date()) {
  requireSession(current);
  return claimMessages(current, current.mailbox, now);
}

export function deleteMail(current: AppState, mailId: string) {
  requireSession(current);
  const mail = current.mailbox.find((entry) => entry.id === mailId);
  if (!mail) return { state: current, result: { deleted: false } };
  if (mail.attachments.length > 0 && mail.claimedAt === null) throw new Error('Nhận quà trước khi xóa thư.');
  return { state: { ...current, mailbox: current.mailbox.filter((entry) => entry.id !== mailId) }, result: { deleted: true } };
}

/** An unread letter can be removed, but a gift is retained until it is claimed. */
export function deleteAllMail(current: AppState) {
  requireSession(current);
  const retained = current.mailbox.filter((mail) => mail.attachments.length > 0 && mail.claimedAt === null);
  const deletedIds = current.mailbox.filter((mail) => mail.attachments.length === 0 || mail.claimedAt !== null)
    .map((mail) => mail.id);
  return { state: deletedIds.length > 0 ? { ...current, mailbox: retained } : current,
    result: { deletedIds, retainedIds: retained.map((mail) => mail.id) } };
}
