/** Kiểm tra thông tin hồ sơ, trang phục và giờ nhắc; quyết định có phát nhạc nền hay không dựa trên tùy chọn cùng trạng thái ứng dụng. */

import type { GardenerOutfit, Profile, Settings } from "../types/app";

export type AccountProfileInput = Pick<Profile, "name" | "phone">;

export function isGardenerOutfit(value: unknown): value is GardenerOutfit {
  return value === "leaf" || value === "sun" || value === "rain";
}

export function parseReminderTime(
  value: string,
): { hour: number; minute: number } | null {
  const match = /^(\d{2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  return hour <= 23 && minute <= 59 ? { hour, minute } : null;
}

export function validateAccountProfile(
  input: AccountProfileInput,
): { ok: true; value: AccountProfileInput } | { ok: false; message: string } {
  const value = {
    name: input.name.trim(),
    phone: input.phone.trim().replace(/[\s.()-]/g, ""),
  };
  if (value.name.length < 2 || value.name.length > 40) {
    return { ok: false, message: "Tên người dùng cần từ 2 đến 40 ký tự." };
  }
  if (value.phone && !/^\+?\d{8,15}$/.test(value.phone)) {
    return {
      ok: false,
      message: "Số điện thoại cần từ 8 đến 15 chữ số, có thể bắt đầu bằng +.",
    };
  }
  return { ok: true, value };
}

export function shouldPlayBackgroundMusic(
  settings: Pick<Settings, "music" | "musicConsent">,
  loggedIn: boolean,
  foreground: boolean,
  pathname: string,
): boolean {
  return (
    loggedIn &&
    foreground &&
    settings.music &&
    settings.musicConsent &&
    !/(^|\/)camera(?:\/|$)/.test(pathname)
  );
}
