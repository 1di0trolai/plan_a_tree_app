/** Tạo trạng thái quà đăng nhập theo chu kỳ bảy lần ghé vườn và xác định trang được hiển thị hộp quà nổi. */

import type { LoginGift } from "@/types/app";

export interface DailyGiftDay {
  day: number;
  status: "claimed" | "available" | "locked";
  giftId: string | null;
  itemId: string | null;
  improved: boolean;
}

/** Actual visit days, not weekdays or claim counts. Unopened results stay hidden. */
export function buildDailyLoginGift(visits: LoginGift[], date: string, retryGiftId?: string) {
  const currentCycle = visits.reduce((cycle, gift) => Math.max(cycle, gift.cycle), 1);
  const gifts = visits.filter((gift) => gift.cycle === currentCycle);
  const todayGift = gifts.find((gift) => gift.date === date) ?? null;
  const cycleDay = gifts.reduce((day, gift) => Math.max(day, gift.cycleDay), 1);
  const days: DailyGiftDay[] = Array.from({ length: 7 }, (_, index) => {
    const day = index + 1;
    const gift = gifts.find((entry) => entry.cycleDay === day);
    const available = gift && ((!gift.claimedAt && !gift.mailedAt) || gift.id === retryGiftId);
    return {
      day,
      status: available ? "available" : gift?.claimedAt ? "claimed" : "locked",
      giftId: gift?.id ?? null,
      itemId: gift?.claimedAt && !available ? gift.itemId : null,
      improved: day === 7,
    };
  });
  return { canClaim: days.some((day) => day.status === "available"), currentCycle, cycleDay, todayGift, days };
}

export type DailyLoginGiftModel = ReturnType<typeof buildDailyLoginGift>;

/** No floating rewards over a camera, conversation, auth form or card reveal. */
export function showDailyGiftOnRoute(pathname: string) {
  const route = pathname.replace(/\/\([^/]+\)/g, "");
  return ["/garden", "/inventory", "/profile", "/shop"].includes(route);
}
