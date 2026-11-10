/** Kiểm thử danh mục cửa hàng, nhập số lượng, kiểm tra số dư và lưu giao dịch mua đúng một lần. */

import { viI18n } from "./fixtures/i18nFixture";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";
import { createInitialState } from "../src/data/seed";
import { MAX_PURCHASE_QUANTITY, SHOP_CATALOG } from "../src/data/economy";

type Node = { type: unknown; props: Record<string, unknown> };
type Purchase = { requestId: string; itemId: string; quantity: number };
type Result = { ok: boolean; message: string; retryable?: boolean };
const compile = (path: string) => ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const compiled = compile("../src/app/shop.tsx");
const tokens = {} as typeof import("../src/theme");
runInNewContext(compile("../src/theme.ts"), { exports: tokens, require: () => ({ Platform: { OS: "ios", Version: 26 } }) });

// Execute actual route callbacks. Native sheet pixels are checked separately.
function shop(options: { gold?: number; width?: number; fontScale?: number; pending?: Purchase;
  purchase?: (input: Purchase, index: number) => Result | Promise<Result> } = {}) {
  const state = createInitialState();
  state.economy.gold = options.gold ?? 500;
  let providerPending: Purchase | null = options.pending ?? null;
  const hooks: unknown[] = [];
  const effects: { deps: unknown[]; cleanup?: () => void }[] = [];
  const work: (() => void)[] = [];
  const calls: Purchase[] = [];
  const timers: { duration: number; callback: () => void; canceled: boolean }[] = [];
  let cursor = 0;
  let effectIndex = 0;
  let serial = 0;
  let styles: Record<string, Record<string, unknown>> = {};
  const exports = {} as { default: () => Node };
  const jsx = (type: unknown, props: Record<string, unknown>) => ({ type, props });
  runInNewContext(compiled, {
    exports,
    setTimeout: (callback: () => void, duration: number) => { const timer = { callback, duration, canceled: false }; timers.push(timer); return timer; },
    clearTimeout: (timer: typeof timers[number]) => { timer.canceled = true; },
    require: (id: string) => {
      switch (id) {
        case "@/i18n": return { useI18n: () => viI18n };
        case "@/i18n/core": return viI18n;
        case "react": return {
          createElement: (type: unknown, props: Record<string, unknown>, ...children: unknown[]) => ({ type, props: { ...props, children } }),
          useState: <T>(initial: T) => {
            const index = cursor++;
            if (!(index in hooks)) hooks[index] = initial;
            return [hooks[index], (next: T | ((value: T) => T)) => { hooks[index] = typeof next === "function" ? (next as (value: T) => T)(hooks[index] as T) : next; }];
          },
          useRef: <T>(initial: T) => { const index = cursor++; if (!(index in hooks)) hooks[index] = { current: initial }; return hooks[index]; },
          useEffect: (callback: () => (() => void) | void, deps: unknown[]) => {
            const index = effectIndex++;
            const previous = effects[index];
            if (!previous || deps.some((value, i) => value !== previous.deps[i])) work.push(() => {
              previous?.cleanup?.();
              effects[index] = { deps, cleanup: callback() || undefined };
            });
          },
        };
        case "react/jsx-runtime": return { jsx, jsxs: jsx };
        case "react-native": return {
          AccessibilityInfo: { isReduceMotionEnabled: async () => true, addEventListener: () => ({ remove() {} }) },
          ActivityIndicator: "ActivityIndicator", Modal: "Modal", Pressable: "Pressable", ScrollView: "ScrollView", Text: "Text", TextInput: "TextInput", View: "View",
          useWindowDimensions: () => ({ width: options.width ?? 375, fontScale: options.fontScale ?? 1 }),
          StyleSheet: { create: (value: typeof styles) => { styles = value; return value; } },
        };
        case "react-native-safe-area-context": return { SafeAreaView: "SafeAreaView" };
        case "@expo/vector-icons/Ionicons": return { __esModule: true, default: "Icon" };
        case "@/components/FoodArtwork": return { FoodArtwork: "FoodArtwork" };
        case "@/components/CurrencyArtwork": return { CurrencyArtwork: "CurrencyArtwork" };
        case "@/components/journeyUI": return { JourneyHeader: "JourneyHeader", JourneyButton: "JourneyButton", ui: { content: {} } };
        case "@/data/economy": return { MAX_PURCHASE_QUANTITY, SHOP_CATALOG };
        case "@/hooks/useControlFocus": return { useControlFocus: () => ({ props: () => ({}), style: () => undefined }) };
        case "@/store/AppStore": return { useApp: () => ({ state, pendingFoodPurchase: providerPending,
          purchaseFood: async (input: Purchase) => {
            calls.push({ ...input });
            return options.purchase ? options.purchase(input, calls.length) : { ok: true, message: "Đã mua thức ăn" };
          },
        }) };
        case "@/theme": return tokens;
        case "@/utils/id": return { createId: () => `purchase-${++serial}` };
        default: throw new Error(`Unexpected dependency: ${id}`);
      }
    },
  });
  const nodes = (value: unknown): Node[] => {
    if (Array.isArray(value)) return value.flatMap(nodes);
    if (!value || typeof value !== "object" || !("props" in value)) return [];
    const node = value as Node;
    if (node.type === "Modal" && !node.props.visible) return [node];
    return [node, ...nodes(node.props.children)];
  };
  let tree: Node[] = [];
  const render = () => {
    cursor = 0; effectIndex = 0;
    tree = nodes(exports.default());
    while (work.length) work.shift()!();
    return tree;
  };
  const button = (label: string) => tree.find(node => node.props.accessibilityLabel === label || (node.type === "JourneyButton" && node.props.title === label));
  const press = (label: string) => {
    const control = button(label); assert.ok(control, label);
    if (!control.props.disabled) (control.props.onPress as () => void)();
    render();
  };
  const open = (itemId = "berry-bites") => {
    const offer = SHOP_CATALOG.find(entry => entry.itemId === itemId)!;
    const item = state.inventory.items.find(entry => entry.id === itemId)!;
    press(`${item.name}, thêm ${offer.experienceGain} kinh nghiệm, ${offer.goldPrice} vàng`);
  };
  const text = () => tree.filter(node => node.type === "Text").map(node => node.props.children).flat(Infinity).join(" ").replace(/\s+/g, " ");
  render();
  return { state, calls, timers, render, button, press, open, text, styles, nodes: () => tree,
    setProviderPending: (input: Purchase | null) => { providerPending = input; },
  };
}
const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };

test("shop offers six foods ordered by price, with no diamonds or payment controls", () => {
  const app = shop();
  assert.equal(app.nodes().filter(node => node.type === "FoodArtwork").length, 6);
  assert.equal(app.nodes().filter(node => node.type === "CurrencyArtwork" && node.props.currency === "gold").length, 7);
  assert.deepEqual(app.nodes().filter(node => node.type === "Pressable").map(node => node.props.accessibilityLabel), [
    "Quả Mọng, thêm 25 kinh nghiệm, 40 vàng", "Cơm Trắng, thêm 45 kinh nghiệm, 70 vàng",
    "Bánh Ngọt, thêm 60 kinh nghiệm, 90 vàng", "Sữa Tươi, thêm 90 kinh nghiệm, 140 vàng",
    "Mì Ramen, thêm 120 kinh nghiệm, 190 vàng", "Bánh Sao, thêm 150 kinh nghiệm, 240 vàng",
  ]);
  assert.doesNotMatch(app.text(), /kim cương|nạp tiền/i);
  assert.equal(app.calls.length, 0);
});

test("rice and ramen open their own quantity sheet and purchase the selected food", async () => {
  for (const [itemId, price] of [["rice-bowl", 70], ["ramen-bowl", 190]] as const) {
    const app = shop();
    app.open(itemId);
    app.press("Tăng số lượng");
    assert.match(app.text(), new RegExp(`${price * 2} vàng`));
    app.press(`Mua với ${price * 2} vàng`);
    await flush(); app.render();
    assert.deepEqual(app.calls, [{ requestId: "purchase-1", itemId, quantity: 2 }]);
    assert.match(app.text(), /Đã mua thức ăn/);
  }
});

test("typed quantities update the exact selected food order and reject invalid integer input", async () => {
  const app = shop({ gold: 100_000 }); app.open('rice-bowl');
  const type = (value: string) => {
    const input = app.nodes().find(node => node.type === 'TextInput')!;
    (input.props.onChangeText as (value: string) => void)(value); app.render();
  };
  for (const value of ['', '0', '-2', '1.5', 'abc', String(MAX_PURCHASE_QUANTITY + 1)]) {
    type(value);
    assert.match(app.text(), /Nhập số nguyên/);
    assert.equal(app.button('Mua với 0 vàng')?.props.disabled, true);
  }
  type('12');
  app.press('Mua với 840 vàng'); await flush(); app.render();
  assert.equal(app.calls[0].itemId, 'rice-bowl');
  assert.equal(app.calls[0].quantity, 12);
});

test("shop reflows to one column for a narrow phone or large text without disabling scaling", () => {
  for (const [width, fontScale, single] of [[375, 1, false], [320, 1, true], [375, 1.8, true], [667, 1, false]] as const) {
    const app = shop({ width, fontScale });
    const cards = app.nodes().filter(node => node.type === "Pressable");
    const style = (cards[0].props.style as (state: { pressed: boolean }) => unknown[])({ pressed: false });
    assert.ok(style.includes(single ? app.styles.fullCard : app.styles.halfCard));
    assert.equal(app.styles.iconButton.minHeight, 48);
    assert.equal(app.nodes().some(node => node.props.allowFontScaling === false), false);
  }
});

test("quantity confirmation sends one immutable intent and only shows a 3s toast after persistence", async () => {
  let resolve!: (result: Result) => void;
  const app = shop({ purchase: () => new Promise<Result>(done => { resolve = done; }) });
  app.open(); app.press("Tăng số lượng");
  assert.match(app.text(), /80 vàng/);
  assert.match(app.text(), /420 vàng/);
  const buy = app.button("Mua với 80 vàng")!;
  (buy.props.onPress as () => void)();
  (buy.props.onPress as () => void)();
  app.render();
  assert.equal(app.calls.length, 1);
  assert.deepEqual(app.calls[0], { requestId: "purchase-1", itemId: "berry-bites", quantity: 2 });
  assert.equal(app.button("Tăng số lượng")?.props.disabled, true);
  assert.equal(app.button("Đóng chọn số lượng")?.props.disabled, true);
  assert.doesNotMatch(app.text(), /Đã mua/);
  resolve({ ok: true, message: "Đã mua 2 phần thức ăn" }); await flush(); app.render();
  assert.match(app.text(), /Đã mua 2 phần thức ăn/);
  const timer = app.timers.find(entry => !entry.canceled)!;
  assert.equal(timer.duration, 3000);
  timer.callback(); app.render();
  assert.doesNotMatch(app.text(), /Đã mua 2 phần/);
});

test("insufficient balance shows the shortage and cannot submit a purchase", () => {
  const app = shop({ gold: 15 }); app.open();
  assert.match(app.text(), /Còn thiếu/); assert.match(app.text(), /25 vàng/);
  assert.equal(app.button("Mua với 40 vàng")?.props.disabled, true);
  (app.button("Mua với 40 vàng")?.props.onPress as () => void)();
  assert.equal(app.calls.length, 0);
});

test("an applied pending intent does not subtract its total from the displayed balance a second time", async () => {
  let complete!: (result: Result) => void;
  const app = shop({ purchase: () => new Promise<Result>(resolve => { complete = resolve; }) });
  app.open(); app.press("Mua với 40 vàng");
  app.state.economy.gold = 460;
  app.setProviderPending(app.calls[0]); app.render();
  assert.match(app.text(), /Sau khi mua 460 vàng/);
  assert.doesNotMatch(app.text(), /420 vàng/);
  complete({ ok: true, message: "Đã lưu" }); await flush(); app.render();
  assert.equal(app.calls.length, 1);
});

test("failed persistence keeps the same request ID and quantity on retry, even after closing the sheet", async () => {
  const app = shop({ purchase: (_input, index) => index === 1
    ? { ok: false, message: "Thiết bị chưa lưu được", retryable: true }
    : { ok: true, message: "Đã mua thức ăn" } });
  app.open(); app.press("Tăng số lượng"); app.press("Mua với 80 vàng"); await flush(); app.render();
  assert.equal(app.button("Tăng số lượng")?.props.disabled, true);
  app.press("Đóng chọn số lượng");
  assert.ok(app.button("Tiếp tục lưu đơn mua"));
  assert.equal(app.nodes().filter(node => node.type === "Pressable").every(node => node.props.disabled), true);
  app.press("Tiếp tục lưu đơn mua"); app.press("Thử lưu lại đơn mua"); await flush(); app.render();
  assert.equal(app.calls.length, 2); assert.deepEqual(app.calls[0], app.calls[1]);
});

test("a pending persisted-intent recovery survives route remount with its original ID", async () => {
  const input = { requestId: "original-purchase", itemId: "star-snack", quantity: 3 };
  const app = shop({ pending: input, gold: 0 });
  app.press("Tiếp tục lưu đơn mua");
  assert.equal(app.button("Tăng số lượng")?.props.disabled, true);
  assert.equal(app.button("Thử lưu lại đơn mua")?.props.disabled, false);
  app.press("Thử lưu lại đơn mua"); await flush(); app.render();
  assert.deepEqual(app.calls[0], input);
});
