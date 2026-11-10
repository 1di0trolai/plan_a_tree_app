/** Tính lịch nhắc chăm những cây còn thiếu lượt kiểm tra trong bảy ngày tới theo giờ Việt Nam và giờ nhắc đã chọn. */

import { localDateKey, offsetLocalDate } from "../data/seed";
import type { AppState } from "../types/app";
import { parseReminderTime } from "../utils/profilePreferences";
import { t } from "../i18n/core";

export const GARDEN_REMINDER_OWNER = "pat-daily-garden-v1";
export const REMINDER_HORIZON_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;
const VIETNAM_OFFSET_MS = 7 * 60 * 60 * 1000;

export type ReminderGarden = Pick<AppState, "plants" | "dailyRounds">;
export interface GardenReminder {
  id: string;
  date: string;
  at: number;
  title: string;
  body: string;
  signature: string;
}

export function hasPendingGardenCare(garden: ReminderGarden, now = new Date()): boolean {
  const eligible = garden.plants.filter((plant) => !plant.archived && plant.journey.phase !== "planning");
  if (!eligible.length) return false;
  const today = localDateKey(now);
  const round = garden.dailyRounds.find((entry) => entry.date === today);
  // Today's frozen roster owns completion. Later additions join tomorrow.
  if (round?.plantIds.length) {
    return !round.completedAt && !round.plantIds.every((id) => round.inspectedPlantIds.includes(id));
  }
  // Imported/legacy checks may already be complete without an open round.
  return eligible.some((plant) => plant.lastCheckIn !== today);
}

const COPY = [
  ["Chào buổi sáng, người chăm vườn!", "Cây đang đợi bạn ghé thăm. Quan sát một chút và lưu ảnh hôm nay nhé."],
  ["Khu vườn gửi bạn một chiếc lá", "Rảnh vài phút chưa? Mở PAT kiểm tra những người bạn xanh nào."],
  ["Chiều rồi, mình gặp nhau ngoài vườn nhé", "Vẫn còn cây chưa được kiểm tra hôm nay. Ghé xem lá và đất đang thế nào nhé."],
  ["Người chăm vườn ơi, đừng lẩn nữa!", "Cây vẫn đang chờ lượt kiểm tra hôm nay đấy. Mình xử lý trước bữa tối nhé?"],
  ["PAT bắt đầu khoanh tay rồi nhé", "Sắp hết ngày mà vườn vẫn chưa được thăm đủ. Mở máy ảnh kiểm tra nốt các cây nào!"],
  ["Lời nhắc cuối ngày: ra vườn thôi!", "PAT đã nhắc rất ngoan cả ngày rồi đấy. Hoàn thành lượt kiểm tra trước nửa đêm nhé."],
] as const;

/** Seven days × at most six slots = 42, below iOS's 64 pending-notification cap.
 * Absolute dates deliberately follow the same UTC+7 calendar as garden streaks.
 * OS delivery is best effort; JS is not expected to run after the app is closed.
 */
export function buildGardenReminderPlan(
  garden: ReminderGarden,
  startTime: string,
  now = new Date(),
): GardenReminder[] {
  const parsed = parseReminderTime(startTime);
  if (!parsed) throw new Error("Giờ nhắc cần đúng dạng HH:MM, ví dụ 08:00.");
  if (!garden.plants.some((plant) => !plant.archived && plant.journey.phase !== "planning")) return [];
  // Legacy settings before 08:00 are clamped to protect overnight quiet hours.
  const start = Math.max(8 * 60, parsed.hour * 60 + parsed.minute);
  const today = localDateKey(now);
  const todayPending = hasPendingGardenCare(garden, now);
  const result: GardenReminder[] = [];
  for (let day = 0; day < REMINDER_HORIZON_DAYS; day++) {
    const date = offsetLocalDate(day, now);
    if (date === today && !todayPending) continue;
    const midnight = Date.parse(`${date}T00:00:00+07:00`);
    for (let minutes = start; minutes < 24 * 60; minutes += 3 * 60) {
      const at = midnight + minutes * 60 * 1000;
      if (at <= now.getTime()) continue;
      const copy = COPY[Math.min(COPY.length - 1, Math.max(0, Math.floor((minutes / 60 - 8) / 3)))];
      const [sourceTitle, sourceBody] = copy;
      const title = t(sourceTitle), body = t(sourceBody);
      const id = `${GARDEN_REMINDER_OWNER}:${date}:${minutes}`;
      result.push({ id, date, at, title, body, signature: `${at}|${title}|${body}` });
    }
  }
  return result;
}

export function millisecondsUntilNextGardenDay(now = new Date()): number {
  const shifted = now.getTime() + VIETNAM_OFFSET_MS;
  return DAY_MS - (shifted % DAY_MS) + 50;
}
