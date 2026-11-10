/** Tính vị trí lưu của hộp quà nổi và điểm bám cạnh gần nhất trong giới hạn màn hình an toàn. */

import type { Settings } from "@/types/app";

export type GiftDock = NonNullable<Settings["giftDock"]>;
export type GiftBounds = { left: number; right: number; top: number; bottom: number };
export type GiftPoint = { x: number; y: number };
const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));

export function pointForGiftDock(dock: GiftDock | null, bounds: GiftBounds): GiftPoint {
  const saved = dock ?? { edge: "right", ratio: 0.84 };
  const ratio = clamp(Number.isFinite(saved.ratio) ? saved.ratio : 0.84, 0, 1);
  if (saved.edge === "left" || saved.edge === "right") {
    return { x: bounds[saved.edge], y: bounds.top + (bounds.bottom - bounds.top) * ratio };
  }
  return { x: bounds.left + (bounds.right - bounds.left) * ratio, y: bounds[saved.edge] };
}

/** The whole target stays inside the safe rectangle, including above tabs. */
export function nearestGiftDock(point: GiftPoint, bounds: GiftBounds): { dock: GiftDock; point: GiftPoint } {
  const x = clamp(point.x, bounds.left, bounds.right);
  const y = clamp(point.y, bounds.top, bounds.bottom);
  const candidates = [
    { edge: "left", distance: x - bounds.left }, { edge: "right", distance: bounds.right - x },
    { edge: "top", distance: y - bounds.top }, { edge: "bottom", distance: bounds.bottom - y },
  ] as const;
  const edge = [...candidates].sort((a, b) => a.distance - b.distance)[0].edge;
  const vertical = edge === "left" || edge === "right";
  const span = vertical ? bounds.bottom - bounds.top : bounds.right - bounds.left;
  const ratio = span > 0 ? ((vertical ? y - bounds.top : x - bounds.left) / span) : 0;
  const dock = { edge, ratio };
  return { dock, point: pointForGiftDock(dock, bounds) };
}
