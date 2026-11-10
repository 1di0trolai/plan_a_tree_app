/** Kiểm tra và chuẩn hóa dữ liệu thư, quà đăng nhập cùng thiết lập hộp quà và bán nhanh khi nạp bản lưu; không tự sinh quà lúc chuyển dữ liệu. */

import { SHOP_CATALOG } from '../data/economy';
import type { LoginGift, LoginRewardClaim, MailAttachment, MailMessage, PetRarity, Settings } from '../types/app';

type RecordValue = Record<string, unknown>;
function record(value: unknown): value is RecordValue { return typeof value === 'object' && value !== null && !Array.isArray(value); }
function date(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
function text(value: unknown): value is string { return typeof value === 'string' && value.length > 0; }
function integer(value: unknown): value is number { return typeof value === 'number' && Number.isSafeInteger(value) && value > 0; }
function food(value: unknown): value is string { return typeof value === 'string' && SHOP_CATALOG.some((item) => item.itemId === value); }
function timestamp(value: unknown): value is string | null { return value === null || text(value); }

/** Migration records already-paid visits only; hydration never rolls or grants gifts. */
export function normalizeLoginVisits(value: unknown, claims: LoginRewardClaim[]): LoginGift[] {
  if (!Array.isArray(value)) return [...claims].sort((a, b) => a.date.localeCompare(b.date)).map((claim, index) => ({
    id: `login-gift-${claim.date}`, date: claim.date, cycle: Math.floor(index / 7) + 1,
    cycleDay: index % 7 + 1, itemId: claim.itemId, earnedAt: claim.claimedAt,
    claimedAt: claim.claimedAt, mailedAt: null,
  }));
  const dates = new Set<string>();
  const ids = new Set<string>();
  const ordinals = new Set<number>();
  return value.filter(record).filter((entry) => {
    const ordinal = typeof entry.cycle === 'number' && typeof entry.cycleDay === 'number'
      ? (entry.cycle - 1) * 7 + entry.cycleDay : NaN;
    if (!text(entry.id) || ids.has(entry.id) || !date(entry.date) || dates.has(entry.date)
      || !integer(entry.cycle) || !integer(entry.cycleDay) || entry.cycleDay > 7 || !Number.isSafeInteger(ordinal)
      || ordinals.has(ordinal) || !food(entry.itemId) || !text(entry.earnedAt)
      || !timestamp(entry.claimedAt) || !timestamp(entry.mailedAt)) return false;
    dates.add(entry.date); ids.add(entry.id); ordinals.add(ordinal);
    return true;
  }).map((entry): LoginGift => {
    const claim = claims.find((item) => item.date === entry.date);
    return { id: entry.id as string, date: entry.date as string, cycle: entry.cycle as number,
      cycleDay: entry.cycleDay as number, itemId: entry.itemId as string, earnedAt: entry.earnedAt as string,
      claimedAt: claim?.claimedAt ?? entry.claimedAt as string | null,
      mailedAt: claim || entry.claimedAt ? null : entry.mailedAt as string | null };
  }).sort((a, b) => (a.cycle - b.cycle) * 7 + a.cycleDay - b.cycleDay);
}

function attachment(value: unknown): value is MailAttachment {
  return record(value) && integer(value.quantity)
    && (value.kind === 'gold' || value.kind === 'food' && food(value.itemId));
}

export function normalizeMailbox(value: unknown): MailMessage[] {
  if (!Array.isArray(value)) return [];
  const ids = new Set<string>();
  const refs = new Set<string>();
  return value.filter(record).filter((entry) => {
    const ref = `${entry.source}:${entry.sourceRef}`;
    if (!text(entry.id) || ids.has(entry.id) || !text(entry.sourceRef) || refs.has(ref)
      || entry.source !== 'system' && entry.source !== 'publisher'
      || !text(entry.title) || typeof entry.body !== 'string' || !text(entry.createdAt)
      || !timestamp(entry.readAt) || !timestamp(entry.claimedAt)
      || !Array.isArray(entry.attachments) || !entry.attachments.every(attachment)) return false;
    ids.add(entry.id); refs.add(ref); return true;
  }).map((entry): MailMessage => ({ id: entry.id as string, source: entry.source as MailMessage['source'],
    sourceRef: entry.sourceRef as string, title: entry.title as string, body: entry.body as string,
    createdAt: entry.createdAt as string, readAt: entry.readAt as string | null, claimedAt: entry.claimedAt as string | null,
    attachments: (entry.attachments as MailAttachment[]).map((item) => item.kind === 'gold'
      ? { kind: 'gold', quantity: item.quantity } : { kind: 'food', itemId: item.itemId, quantity: item.quantity }) }));
}

export function normalizeGiftDock(value: unknown): Settings['giftDock'] {
  if (!record(value) || !['left', 'right', 'top', 'bottom'].includes(value.edge as string)
    || typeof value.ratio !== 'number' || !Number.isFinite(value.ratio)) return null;
  return { edge: value.edge as NonNullable<Settings['giftDock']>['edge'], ratio: Math.max(0, Math.min(1, value.ratio)) };
}

export function normalizeQuickSaleRarities(value: unknown): PetRarity[] {
  const rarities: PetRarity[] = ['Thường', 'Không phổ biến', 'Hiếm', 'Sử thi', 'Huyền thoại'];
  return Array.isArray(value) ? rarities.filter((rarity) => value.includes(rarity)) : ['Thường'];
}
