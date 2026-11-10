/** Kiểm thử giao diện quà đăng nhập bảy ngày, chạm hộp để nhận và hiệu ứng thẻ sau khi đã lưu thành công. */

import { viI18n } from "./fixtures/i18nFixture";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";
import { createInitialState } from "../src/data/seed";
import { buildDailyLoginGift, showDailyGiftOnRoute } from "../src/screens/rewards/dailyLoginGiftModel";
import { nearestGiftDock, pointForGiftDock } from "../src/screens/rewards/giftDock";
import type { LoginGift } from "../src/types/app";

const compile = (path: string) => ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const tokens = {} as typeof import("../src/theme");
runInNewContext(compile("../src/theme.ts"), { exports: tokens, require: () => ({ Platform: { OS: "ios", Version: 26 } }) });
type Node = { type: unknown; props: Record<string, unknown> };
const exports = {} as { DailyLoginGift: (props: Record<string, unknown>) => Node };
let dimensions = { width: 375, height: 812, fontScale: 1 };
runInNewContext(compile("../src/screens/rewards/DailyLoginGift.tsx"), { exports, require: (id: string) => {
  switch (id) {
        case "@/i18n": return { useI18n: () => viI18n };
        case "@/i18n/core": return viI18n;
    case "react": return { createElement: (type: unknown, props: Record<string, unknown>, ...children: unknown[]) => ({ type, props: { ...props, children } }) };
    case "react/jsx-runtime": return { Fragment: "Fragment", jsx: (type: unknown, props: Record<string, unknown>) => ({ type, props }), jsxs: (type: unknown, props: Record<string, unknown>) => ({ type, props }) };
    case "@expo/vector-icons/Ionicons": return { __esModule: true, default: "Icon" };
    case "react-native": return { View: "View", Text: "Text", Pressable: "Pressable", ScrollView: "ScrollView", Modal: "Modal", ActivityIndicator: "Spinner", useWindowDimensions: () => dimensions, StyleSheet: { create: (value: unknown) => value, absoluteFill: { position: "absolute" } } };
    case "react-native-safe-area-context": return { useSafeAreaInsets: () => ({ top: 44, bottom: 34, left: 0, right: 0 }) };
    case "@/components/FoodArtwork": return { FoodArtwork: "FoodArtwork" };
    case "@/hooks/useControlFocus": return { useControlFocus: () => ({ props: () => ({}), style: () => undefined }) };
    case "@/theme": return tokens;
    case "./ShakingGift": return { ShakingGift: "ShakingGift" };
    case "./FoodLoginReveal": return { FoodLoginReveal: "FoodLoginReveal" };
    default: throw new Error(`Unexpected dependency ${id}`);
  }
} });
function nodes(value: unknown): Node[] {
  if (Array.isArray(value)) return value.flatMap(nodes);
  if (!value || typeof value !== "object" || !("props" in value)) return [];
  const node = value as Node; return [node, ...nodes(node.props.children)];
}
const visits = (count: number): LoginGift[] => Array.from({ length: count }, (_, index) => ({
  id: `gift-${index}`, date: `2026-10-${String(index + 10).padStart(2, "0")}`, cycleDay: index % 7 + 1, cycle: Math.floor(index / 7) + 1,
  itemId: "berry-bites", earnedAt: "2026-10-10T03:00:00Z", claimedAt: null, mailedAt: null,
}));
function render(overrides: Record<string, unknown> = {}) {
  let closed = 0; const claimed: string[] = [];
  const tree = exports.DailyLoginGift({ gift: buildDailyLoginGift(visits(3), "2026-11-01"), items: createInitialState().inventory.items, visible: true, pending: false, pendingGiftId: null, received: null, error: null,
    onClose: () => { closed += 1; }, onClaim: (id: string) => claimed.push(id), ...overrides });
  const all = nodes(tree);
  return { all, byId: (id: string) => all.find((node) => node.props.testID === id)!, claimed, get closed() { return closed; } };
}

test("actual visits bank multiple claimable boxes and never reveal unopened rolls", () => {
  const model = buildDailyLoginGift(visits(3), "2026-11-01");
  assert.equal(model.cycleDay, 3);
  assert.deepEqual(model.days.map((day) => day.status), ["available", "available", "available", "locked", "locked", "locked", "locked"]);
  assert.ok(model.days.every((day) => day.itemId === null));
  assert.equal(model.days[6].improved, true);
});
test("new cycles show only their own visited gifts and retry can expose an optimistic claim", () => {
  const history = visits(8); history[0].claimedAt = history[0].earnedAt;
  const model = buildDailyLoginGift(history, history[7].date);
  assert.equal(model.cycleDay, 1); assert.equal(model.currentCycle, 2);
  assert.equal(model.days[0].giftId, "gift-7"); assert.ok(model.days.slice(1).every((day) => day.status === "locked"));
  history[7].claimedAt = history[7].earnedAt;
  assert.equal(buildDailyLoginGift(history, history[7].date).canClaim, false);
  assert.equal(buildDailyLoginGift(history, history[7].date, "gift-7").days[0].status, "available");
});
test("tapping eligible gift itself claims exact ID; no claim footer or auto-claim", () => {
  const view = render(); assert.equal(view.claimed.length, 0);
  const box = view.byId("daily-gift-day-2"); assert.equal(box.props.disabled, false);
  (box.props.onPress as () => void)(); assert.deepEqual(view.claimed, ["gift-1"]);
  (view.byId("daily-gift-day-5").props.onPress as () => void)(); assert.deepEqual(view.claimed, ["gift-1"]);
  assert.equal(view.all.some((node) => node.props.testID === "daily-gift-claim"), false);
  assert.equal(view.all.filter((node) => node.props.testID && /^daily-gift-day-/.test(String(node.props.testID))).length, 7);
  assert.ok(view.all.some((node) => node.type === "ShakingGift" && node.props.eligible === true));
});
test("pending blocks every box, including rapid taps; failures retain visible retry guidance", () => {
  const view = render({ pending: true, pendingGiftId: "gift-0" });
  assert.equal(view.byId("daily-gift-day-1").props.disabled, true);
  (view.byId("daily-gift-day-1").props.onPress as () => void)(); assert.equal(view.claimed.length, 0);
  const error = render({ error: { message: "Chưa lưu", retryable: true } });
  assert.equal(error.byId("daily-gift-error").props.accessibilityRole, "alert");
});
test("durable claim displays a separate exact-food card reveal, never another grant callback", () => {
  const view = render({ received: { date: "2026-11-01", itemId: "forest-milk", cycleDay: 3, claimedAt: "2026-11-01T03:00:00Z" } });
  const reveal = view.all.find((node) => node.type === "FoodLoginReveal")!;
  assert.equal((reveal.props.item as { id: string }).id, "forest-milk");
  assert.equal(reveal.props.onClaim, undefined);
  (reveal.props.onClose as () => void)(); assert.equal(view.closed, 1);
});
test("native modal back, backdrop and accessibility escape all close without claiming", () => {
  const view = render();
  (view.all.find((node) => node.type === "Modal")!.props.onRequestClose as () => void)();
  (view.byId("daily-gift-backdrop").props.onPress as () => void)();
  (view.byId("daily-gift-sheet").props.onAccessibilityEscape as () => void)();
  assert.equal(view.closed, 3); assert.equal(view.claimed.length, 0);
});
test("small and large-text layouts wrap gift boxes; fullscreen flows hide floating gift", () => {
  for (const dimension of [{ width: 320, height: 568, fontScale: 1 }, { width: 375, height: 812, fontScale: 1.6 }, { width: 812, height: 375, fontScale: 1 }]) {
    dimensions = dimension; const view = render();
    const style = view.byId("daily-gift-day-1").props.style as (state: { pressed: boolean }) => unknown[];
    assert.equal((style({ pressed: false })[1] as { width: string }).width, dimension.width < 350 || dimension.fontScale >= 1.4 ? "46%" : "30%");
  }
  dimensions = { width: 375, height: 812, fontScale: 1 };
  assert.equal(showDailyGiftOnRoute("/(tabs)/garden"), true);
  for (const route of ["/camera", "/plant-chat", "/reward-pack", "/mailbox", "/"]) assert.equal(showDailyGiftOnRoute(route), false);
});
test("dock chooses nearest safe edge, persists normalized position and survives rotation", () => {
  const bounds = { left: 8, right: 239, top: 52, bottom: 398 };
  for (const [point, edge] of [[{ x: 9, y: 200 }, "left"], [{ x: 238, y: 200 }, "right"], [{ x: 100, y: 53 }, "top"], [{ x: 100, y: 397 }, "bottom"]] as const) {
    const result = nearestGiftDock(point, bounds); assert.equal(result.dock.edge, edge);
    assert.ok(result.dock.ratio >= 0 && result.dock.ratio <= 1);
  }
  const saved = nearestGiftDock({ x: -100, y: 5000 }, bounds);
  assert.ok(saved.point.x >= bounds.left && saved.point.x <= bounds.right);
  assert.ok(saved.point.y >= bounds.top && saved.point.y <= bounds.bottom);
  assert.deepEqual(pointForGiftDock({ edge: "left", ratio: 0.5 }, { left: 52, right: 700, top: 8, bottom: 200 }), { x: 52, y: 104 });
});
