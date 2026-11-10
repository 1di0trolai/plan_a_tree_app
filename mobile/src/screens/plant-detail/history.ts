/** Chuẩn hóa, sắp xếp và phân trang nhật ký chăm sóc cùng ảnh của cây để hiển thị trong hồ sơ. */

import type { CareEvent, PlantPhoto } from "@/types/app";
import { getLocale, t } from "@/i18n/core";

export const JOURNAL_PAGE_SIZE = 8;
export const PHOTO_PAGE_SIZE = 6;

export const careLabels: Record<CareEvent["kind"], string> = {
  water: "Đã tưới", fertilize: "Đã bón phân", repot: "Đã thay chậu",
  prune: "Đã tỉa", observe: "Đã quan sát", other: "Ghi chú của bạn",
};

export type JournalEntry = {
  id: string;
  date: string;
  time: string;
  timestamp: number;
  kind: "care";
  event: CareEvent;
};

const vietnamOffset = 7 * 60 * 60 * 1000;

function observationTime(date: string, time: string): number {
  const parsed = Date.parse(`${date}T${time || "00:00"}:00+07:00`);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Both the journal and daily rewards use the Vietnam calendar, not the device zone. */
function careDate(createdAt: string) {
  const parsed = Date.parse(createdAt);
  if (!Number.isFinite(parsed)) return { date: "", time: "", timestamp: 0 };
  const local = new Date(parsed + vietnamOffset).toISOString();
  return { date: local.slice(0, 10), time: local.slice(11, 16), timestamp: parsed };
}

/** The visible diary is factual: suggestions stay in chat, never become actions. */
export function buildPlantJournal(plantId: string, events: CareEvent[]): JournalEntry[] {
  const care: JournalEntry[] = events.filter((entry) => entry.plantId === plantId).map((event) => ({
    id: `care:${event.id}`, kind: "care", event, ...careDate(event.createdAt),
  }));
  return care.sort((a, b) => b.timestamp - a.timestamp || b.id.localeCompare(a.id));
}

export function sortedPlantPhotos(plantId: string, photos: PlantPhoto[]): PlantPhoto[] {
  return photos.filter((entry) => entry.plantId === plantId).sort((a, b) =>
    observationTime(b.date, b.time) - observationTime(a.date, a.time) || b.id.localeCompare(a.id));
}

export function groupJournalDays(entries: JournalEntry[]) {
  const days = new Map<string, JournalEntry[]>();
  for (const entry of entries) {
    const group = days.get(entry.date) ?? [];
    group.push(entry);
    days.set(entry.date, group);
  }
  return Array.from(days, ([date, records]) => ({ date, records }));
}

export function historyDate(date: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return t("Chưa rõ ngày");
  const locale = getLocale();
  if (locale === "ja") return `${match[1]}/${match[2]}/${match[3]}`;
  if (locale === "en") return `${match[2]}/${match[3]}/${match[1]}`;
  return `${match[3]}/${match[2]}/${match[1]}`;
}

/** Bounded pages keep long archives cheap; no record is silently truncated. */
export function historyPage<T>(records: T[], requestedPage: number, pageSize: number) {
  const size = Math.max(1, Number.isFinite(pageSize) ? Math.floor(pageSize) : 1);
  const pages = Math.max(1, Math.ceil(records.length / size));
  const page = Math.min(pages - 1, Math.max(0, Number.isFinite(requestedPage) ? Math.floor(requestedPage) : 0));
  const start = page * size;
  return { page, pages, total: records.length, start: records.length ? start + 1 : 0,
    end: Math.min(start + size, records.length), records: records.slice(start, start + size) };
}
