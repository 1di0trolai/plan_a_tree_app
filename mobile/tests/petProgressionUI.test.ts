/** Kiểm thử giao diện kho thú, cho ăn, tăng sao, chọn nhiều thú và các hộp thoại giao dịch. */

import { viI18n } from "./fixtures/i18nFixture";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { createInitialState, experienceForNextLevel } from "../src/data/seed";
import * as actions from "../src/store/petActions";
import * as collection from "../src/store/petCollection";
import * as progressionData from "../src/data/petProgression";
import type { PetInstance } from "../src/types/app";

// Real route + presenters + callbacks, with native surfaces mocked (not pixel/device proof).
const compile = (file: string) => ts.transpileModule(readFileSync(new URL(file, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const sources = { inventory: compile("../src/app/(tabs)/inventory.tsx"), panel: compile("../src/screens/inventory/PetProgressionPanel.tsx"), popup: compile("../src/screens/inventory/PetActionPopup.tsx"), sale: compile("../src/screens/inventory/PetSalePopup.tsx") };
const tokens = {} as typeof import("../src/theme");
runInNewContext(compile("../src/theme.ts"), { exports: tokens, require: () => ({ Platform: { OS: "ios", Version: 26 } }) });
type Node = { type: unknown; props: Record<string, unknown>; key?: unknown };
type AlertAction = { text: string; style?: string; onPress?: () => void };
type Fiber = { hooks: unknown[]; cursor: number; cleanups: Map<number, () => void> };
type Input = actions.PetTransactionInput;
const flush = () => new Promise((resolve) => setImmediate(resolve));
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>((done) => { resolve = done; }); return { promise, resolve }; };

function inventory(options: { save?: (write: number) => Promise<void>; pets?: PetInstance[]; food?: number; gold?: number; level?: number; stars?: 1 | 2 | 3; pendingRewardAction?: boolean; width?: number; height?: number; fontScale?: number } = {}) {
  let state = createInitialState();
  state.auth = { ...state.auth, loggedIn: true, identity: "test@pat.vn" };
  state.economy.gold = options.gold ?? 1000;
  state.inventory.pets = options.pets ?? [
    { ...collection.createPetInstance("ladybug", "main"), level: options.level ?? 36, stars: options.stars ?? 1, baseCopies: ({ 1: 1, 2: 3, 3: 6 }[options.stars ?? 1]), upgradeGoldSpent: ({ 1: 0, 2: 200, 3: 700 }[options.stars ?? 1]), foodSpent: { "berry-bites": 2 } },
    ...[1, 2, 3, 4, 5].map((index) => ({ ...collection.createPetInstance("ladybug", `copy-${index}`), level: index, foodSpent: { "forest-milk": index } })),
    collection.createPetInstance("mantis", "legendary"),
    { ...collection.createPetInstance("ladybug", "upgraded"), stars: 2 as const, baseCopies: 3, upgradeGoldSpent: 200 },
    collection.createPetInstance("caterpillar", "other-species"),
  ];
  state.inventory.items = state.inventory.items.map((item) => ({ ...item, quantity: options.food ?? 5 }));
  let pending: Input | null = null;
  const calls: Input[] = [];
  const accessibilityFocus: unknown[] = [];
  const alerts: { title: string; message: string; actions: AlertAction[] }[] = [];
  const fibers = new Map<string, Fiber>();
  const effects: (() => void)[] = [];
  const focusEffects = new Set<{ effect: () => void | (() => void); cleanup?: () => void }>();
  let focused = true;
  const seen = new Set<string>();
  let current!: Fiber;
  let dirty = false, writes = 0, tree: unknown;
  const equal = (a: unknown[], b: unknown[]) => a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
  const jsx = (type: unknown, props: Record<string, unknown>, key?: unknown): Node => ({ type, props, key });
  const react = {
    createElement: (type: unknown, props: Record<string, unknown>, ...children: unknown[]) => jsx(type, { ...props, children }, props?.key),
    useState: (initial: unknown) => { const fiber = current, index = fiber.cursor++; if (!(index in fiber.hooks)) fiber.hooks[index] = typeof initial === "function" ? initial() : initial; return [fiber.hooks[index], (value: unknown) => { fiber.hooks[index] = typeof value === "function" ? value(fiber.hooks[index]) : value; dirty = true; }]; },
    useRef: (initial: unknown) => { const index = current.cursor++; if (!(index in current.hooks)) current.hooks[index] = { current: initial }; return current.hooks[index]; },
    useMemo: (factory: () => unknown, deps: unknown[]) => { const index = current.cursor++; const previous = current.hooks[index] as { deps: unknown[]; value: unknown } | undefined; if (!previous || !equal(previous.deps, deps)) current.hooks[index] = { deps, value: factory() }; return (current.hooks[index] as { value: unknown }).value; },
    useCallback: (callback: unknown, deps: unknown[]) => react.useMemo(() => callback, deps),
    useEffect: (effect: () => void | (() => void), deps: unknown[]) => { const fiber = current, index = fiber.cursor++; const previous = fiber.hooks[index] as unknown[] | undefined; if (!previous || !equal(previous, deps)) { fiber.hooks[index] = deps; effects.push(() => { fiber.cleanups.get(index)?.(); const cleanup = effect(); if (cleanup) fiber.cleanups.set(index, cleanup); }); } },
  };
  const transact = async (input: Input) => {
    calls.push(input); writes += 1;
    const transition = input.kind === "sell" ? actions.sellPetCopies(state, input) : input.kind === "upgrade" ? actions.upgradePet(state, input) : input.kind === "feed" ? actions.consumePetFood(state, input) : actions.quickFeedPet(state, input);
    state = transition.state; pending = input;
    try { await options.save?.(writes); pending = null; return { ok: true, message: transition.message }; }
    catch { return { ok: false, retryable: true, message: "Chưa lưu được thao tác pet." }; }
  };
  const modules = new Map<string, Record<string, unknown>>();
  const load = (name: keyof typeof sources): Record<string, unknown> => {
    if (modules.has(name)) return modules.get(name)!;
    const exports = {}; modules.set(name, exports);
    runInNewContext(sources[name], { exports, requestAnimationFrame: (callback: () => void) => { callback(); return 1; }, cancelAnimationFrame: () => {}, require: (id: string): unknown => {
      switch (id) {
        case "@/i18n": return { useI18n: () => viI18n };
        case "@/i18n/core": return viI18n;
        case "react": return react;
        case "react/jsx-runtime": return { jsx, jsxs: jsx, Fragment: "Fragment" };
        case "react-native": return { BackHandler: { addEventListener: () => ({ remove: () => {} }) }, FlatList: "FlatList", Modal: "Modal", Pressable: "Pressable", ScrollView: "ScrollView", Text: "Text", TextInput: "TextInput", View: "View", AccessibilityInfo: { isReduceMotionEnabled: async () => true, addEventListener: () => ({ remove: () => {} }), sendAccessibilityEvent: (host: unknown) => accessibilityFocus.push(host) }, StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1, absoluteFill: { position: "absolute", inset: 0 } }, useWindowDimensions: () => ({ width: options.width ?? 375, height: options.height ?? 812, fontScale: options.fontScale ?? 1 }), Alert: { alert: (title: string, message: string, buttons: AlertAction[]) => alerts.push({ title, message, actions: buttons }) } };
        case "react-native-safe-area-context": return { SafeAreaView: "SafeAreaView", useSafeAreaInsets: () => ({ top: 44, bottom: 24, left: 0, right: 0 }) };
        case "expo-router": return { router: { push: () => {} }, useFocusEffect: (effect: () => void | (() => void)) => react.useEffect(() => {
          const entry: { effect: () => void | (() => void); cleanup?: () => void } = { effect };
          focusEffects.add(entry);
          if (focused) entry.cleanup = effect() || undefined;
          return () => { entry.cleanup?.(); focusEffects.delete(entry); };
        }, [effect]) };
        case "@expo/vector-icons/Ionicons": return { __esModule: true, default: "Icon" };
        case "@/theme": return tokens;
        case "@/data/seed": return { experienceForNextLevel };
        case "@/data/petProgression": return progressionData;
        case "@/store/petCollection": return collection;
        case "@/store/petActions": return actions;
        case "@/screens/inventory/PetProgressionPanel": case "./PetProgressionPanel": return load("panel");
        case "@/screens/inventory/PetActionPopup": case "./PetActionPopup": return load("popup");
        case "@/screens/inventory/PetSalePopup": return load("sale");
        case "@/components/PetArtwork": return { PetArtwork: "PetArtwork" };
        case "@/components/FoodArtwork": return { FoodArtwork: "FoodArtwork" };
        case "@/components/CurrencyArtwork": return { CurrencyArtwork: "CurrencyArtwork" };
        case "@/components/journeyUI": return { JourneyButton: "JourneyButton" };
        case "@/hooks/useControlFocus": return { useControlFocus: () => ({ props: () => ({}), style: () => undefined }) };
        case "@/store/AppStore": return { useApp: () => ({ state, ready: true, pendingPetTransaction: pending, pendingFoodPurchase: null, pendingRewardAction: !!options.pendingRewardAction,
          updateSetting: (key: keyof typeof state.settings, value: never) => { state = { ...state, settings: { ...state.settings, [key]: value } }; dirty = true; },
          sellPetCopies: (input: actions.SellPetCopiesInput) => transact({ ...input, kind: "sell" }), upgradePet: (input: actions.UpgradePetInput) => transact({ ...input, kind: "upgrade" }),
          feedPet: (input: actions.FeedPetInput) => transact({ ...input, kind: "feed" }), quickFeedPet: (input: actions.QuickFeedPetInput) => transact({ ...input, kind: "quick-feed" }),
        }) };
        default: throw new Error(`Unexpected dependency ${id}`);
      }
    } }); return exports;
  };
  const expand = (value: unknown, path: string): unknown => {
    if (Array.isArray(value)) return value.map((child, index) => expand(child, `${path}.${index}`));
    if (!value || typeof value !== "object" || !("props" in value)) return value;
    const node = value as Node;
    if (typeof node.type === "function") {
      const key = `${path}/${node.type.name}:${String(node.key ?? "")}`;
      seen.add(key);
      if (!fibers.has(key)) fibers.set(key, { hooks: [], cursor: 0, cleanups: new Map() });
      const previous = current; current = fibers.get(key)!; current.cursor = 0;
      const result = node.type(node.props); current = previous;
      return expand(result, key);
    }
    if (node.type === "Modal" && !node.props.visible) return null;
    if (node.props.ref && typeof node.props.ref === "object") (node.props.ref as { current: unknown }).current = { type: node.type, label: node.props.children };
    if (node.type === "FlatList") return { ...node, props: { ...node.props, children: [expand(node.props.ListHeaderComponent, `${path}.header`), ...(node.props.data as { id: string }[]).map((item) => expand((node.props.renderItem as (input: unknown) => unknown)({ item }), `${path}.item-${item.id}`))] } };
    return { ...node, props: { ...node.props, children: expand(node.props.children, `${path}.children`) } };
  };
  const route = load("inventory").default;
  const render = () => {
    for (let pass = 0; pass < 10; pass += 1) {
      dirty = false; seen.clear(); tree = expand(jsx(route, {}), "root");
      for (const [key, fiber] of fibers) if (!seen.has(key)) { fiber.cleanups.forEach((cleanup) => cleanup()); fibers.delete(key); }
      effects.splice(0).forEach((effect) => effect());
      if (!dirty) return;
    } throw new Error("Unstable render");
  };
  const nodes = (value: unknown = tree): Node[] => Array.isArray(value) ? value.flatMap((child) => child === undefined ? [] : nodes(child)) : value && typeof value === "object" && "props" in value ? [value as Node, ...((value as Node).props.children === undefined ? [] : nodes((value as Node).props.children))] : [];
  const byId = (id: string) => nodes().find((node) => node.props.testID === id);
  const button = (title: string) => nodes().find((node) => node.props.accessibilityLabel === title || node.props.title === title);
  const press = (node: Node | undefined) => { assert.ok(node, "Control exists"); if (!node.props.disabled && !node.props.loading) (node.props.onPress as () => void)(); };
  const openPet = (id = "main") => { press(byId(`inventory-card-${id}`)); render(); };
  const openAction = (name: "feed" | "sale" | "upgrade") => { press(byId(`show-pet-${name}`)); render(); };
  const selectPet = (id = "main") => { const node = byId(`inventory-card-${id}`)!; (node.props.onLongPress as () => void)(); render(); };
  const openSale = (id = "main") => { selectPet(id); press(byId("inventory-bulk-sale")); render(); };
  const confirm = () => { const action = alerts.at(-1)?.actions.at(-1); assert.ok(action?.onPress); action.onPress(); };
  render();
  const blur = () => { focused = false; for (const entry of focusEffects) { entry.cleanup?.(); entry.cleanup = undefined; } render(); };
  const focusRoute = () => { focused = true; for (const entry of focusEffects) entry.cleanup = entry.effect() || undefined; render(); };
  return { nodes, byId, button, press, openPet, openAction, selectPet, openSale, confirm, render, blur, focusRoute, alerts, calls, accessibilityFocus, get state() { return state; }, logout: () => { state = { ...state, auth: { ...state.auth, loggedIn: false } }; render(); } };
}

test("inventory uses individual cards sorted by rarity, stars and level with no companion or quantity", () => {
  const screen = inventory();
  const list = screen.nodes().find((node) => node.type === "FlatList")!;
  assert.deepEqual((list.props.data as { id: string }[]).map((entry) => entry.id), collection.getPetViews(screen.state.inventory.pets).map((pet) => pet.id));
  assert.equal(screen.nodes().some((node) => String(node.props.accessibilityLabel).includes("số lượng")), false);
  screen.openPet();
  assert.equal(screen.button("Chọn làm bạn đồng hành"), undefined);
  assert.ok(screen.byId("show-pet-feed")); assert.ok(screen.byId("show-pet-upgrade")); assert.equal(screen.byId("show-pet-sale"), undefined);
  assert.equal(screen.byId("pet-food-list"), undefined);
  assert.equal(screen.nodes().filter((node) => node.type === "PetArtwork" && node.props.petId === "main").length, 0);
});

test("only Cho ăn reveals foods; feeding is durable, single-dispatch and updates one instance", async () => {
  const saved = deferred(); const screen = inventory({ save: () => saved.promise }); screen.openPet(); screen.openAction("feed");
  assert.equal(screen.byId("feed-berry-bites")?.props.title, "Cho ăn");
  screen.press(screen.byId("feed-berry-bites")); screen.press(screen.byId("feed-berry-bites")); screen.render();
  assert.equal(screen.calls.length, 1); assert.equal(screen.calls[0].kind, "feed"); assert.equal(screen.calls[0].petId, "main");
  assert.equal(screen.byId("show-pet-upgrade")?.props.disabled, true);
  screen.press(screen.button("Đóng chi tiết")); screen.render(); assert.ok(screen.byId("pet-progression-panel"));
  saved.resolve(); await flush(); screen.render(); assert.equal(screen.state.inventory.items.find((food) => food.id === "berry-bites")!.quantity, 4);
  assert.equal(screen.state.inventory.pets.find((pet) => pet.id === "main")!.foodSpent["berry-bites"], 3);
  assert.equal(screen.state.inventory.pets.find((pet) => pet.id === "copy-1")!.experience, 0);
});

test("quick feeding previews a plan and requires confirmation before durable dispatch", async () => {
  const screen = inventory({ level: 1 }); screen.openPet(); screen.openAction("feed"); screen.press(screen.byId("quick-feed-pet"));
  assert.equal(screen.calls.length, 0); assert.match(screen.alerts.at(-1)!.title, /Cho ăn nhanh/);
  screen.confirm(); await flush(); screen.render(); assert.equal(screen.calls[0].kind, "quick-feed"); assert.ok(screen.state.inventory.pets.find((pet) => pet.id === "main")!.level > 1);
});

test("food detail is informational only and never offers a pet feed picker", () => {
  const screen = inventory(); const tab = screen.nodes().find((node) => node.props.accessibilityRole === "tab" && JSON.stringify(node).includes("Vật phẩm"));
  screen.press(tab); screen.render(); screen.press(screen.byId("inventory-card-berry-bites")); screen.render();
  assert.equal(screen.byId("show-pet-feed"), undefined); assert.equal(screen.byId("quick-feed-pet"), undefined);
});

test("sale is a centered overlay outside pet detail and shows the exact refund once", async () => {
  const screen = inventory(); screen.openSale();
  assert.ok(screen.byId("pet-action-overlay")); assert.ok(screen.byId("pet-action-dialog"));
  assert.equal(screen.nodes().filter((node) => node.type === "Modal").length, 1);
  assert.equal(screen.byId("pet-progression-panel"), undefined);
  assert.ok(screen.byId("pet-food-refund"));
  screen.press(screen.byId("sell-pet-copy")); assert.equal(screen.alerts.length, 0); await flush(); screen.render();
  const sale = screen.calls[0]; assert.equal(sale.kind, "sell"); assert.deepEqual(sale.kind === "sell" && [...sale.petIds], ["main"]);
  assert.equal(screen.state.inventory.pets.some((pet) => pet.id === "main"), false); assert.equal(screen.byId("pet-action-overlay"), undefined);
});

test("long press enters selection, taps toggle exact IDs and cancel leaves no sale button", () => {
  const screen = inventory(); assert.equal(screen.byId("inventory-bulk-sale"), undefined);
  screen.selectPet(); assert.equal(screen.byId("pet-progression-panel"), undefined);
  assert.equal((screen.byId("inventory-card-main")!.props.accessibilityState as { checked: boolean }).checked, true);
  screen.press(screen.byId("inventory-card-copy-1")); screen.render();
  assert.equal(screen.byId("inventory-bulk-sale")?.props.title, "Bán (2)");
  screen.press(screen.byId("inventory-select-pets")); screen.render();
  assert.equal(screen.byId("inventory-bulk-sale"), undefined);
});

test("leaving the inventory clears an uncommitted sale selection and all temporary sheets", () => {
  const screen = inventory(); screen.selectPet();
  screen.press(screen.byId("inventory-card-copy-1")); screen.render();
  assert.equal(screen.byId("inventory-bulk-sale")?.props.title, "Bán (2)");
  screen.blur(); screen.focusRoute();
  assert.equal(screen.byId("inventory-bulk-sale"), undefined);
  assert.equal(screen.byId("inventory-select-pets")?.props.title, "Chọn");
  assert.equal(screen.byId("inventory-card-main")?.props.accessibilityRole, "button");
  screen.press(screen.byId("inventory-quick-sale")); screen.render();
  assert.ok(screen.byId("pet-action-dialog"));
  screen.blur(); screen.focusRoute(); assert.equal(screen.byId("pet-action-dialog"), undefined);
  screen.openPet(); screen.openAction("upgrade"); screen.blur(); screen.focusRoute();
  assert.equal(screen.byId("pet-action-dialog"), undefined); assert.equal(screen.byId("pet-progression-panel"), undefined);
  assert.equal(screen.calls.length, 0);
});

test("route changes clear only presentation while a committed sale keeps exact recovery IDs", async () => {
  const screen = inventory({ save: async (write) => { if (write === 1) throw new Error("disk"); } });
  screen.openSale(); screen.press(screen.byId("sell-pet-copy")); await flush(); screen.render();
  assert.ok(screen.byId("retry-pet-transaction"));
  screen.blur(); screen.focusRoute();
  assert.equal(screen.byId("inventory-bulk-sale"), undefined); assert.equal(screen.byId("pet-action-dialog"), undefined);
  assert.ok(screen.byId("retry-pet-transaction"));
  screen.press(screen.byId("retry-pet-transaction")); await flush(); screen.render();
  assert.equal(screen.calls.length, 2); assert.equal(screen.calls[0].requestId, screen.calls[1].requestId);
  assert.deepEqual(screen.calls[0].kind === "sell" && [...screen.calls[0].petIds], ["main"]);
  assert.equal(screen.state.economy.petTransactions.filter((entry) => entry.kind === "sell").length, 1);
});

test("sale and material tiles use actual filled stars and digits-only level badges", () => {
  const screen = inventory({ stars: 2 }); screen.openSale();
  const tile = screen.byId("sale-pet-main")!;
  assert.equal(screen.byId("sale-pet-level-main")?.props.children, 36);
  const stars = screen.nodes(tile).filter((node) => node.type === "Icon" && node.props.name === "star");
  assert.equal(stars.length, 2);
  assert.equal(screen.nodes(tile).some((node) => node.type === "Text" && /C36|2★/.test(JSON.stringify(node.props.children))), false);
  screen.blur(); screen.focusRoute(); screen.openPet(); screen.openAction("upgrade");
  const material = screen.byId("choose-pet-copy-1")!;
  assert.equal(screen.byId("material-pet-level-copy-1")?.props.children, 1);
  assert.equal(screen.nodes(material).filter((node) => node.type === "Icon" && node.props.name === "star").length, 1);
  assert.equal(screen.nodes(material).some((node) => node.type === "Text" && /Cấp 1|C1/.test(JSON.stringify(node.props.children))), false);
});

test("pet level digits have no badge box across inventory, sale and upgrade surfaces", () => {
  for (const speciesId of ["caterpillar", "ladybug", "hunter-bee", "moon-moth", "mantis"]) {
    const pets = [{ ...collection.createPetInstance(speciesId, "main"), level: 36 }, collection.createPetInstance(speciesId, "material")];
    const screen = inventory({ pets });
    const assertBlendedLevel = (id: string, level: number) => {
      const label = screen.byId(id)!;
      assert.equal(label.props.children, level);
      const style = label.props.style as Record<string, unknown>;
      assert.equal(style.backgroundColor, undefined);
      assert.equal(style.borderRadius, undefined);
      assert.equal(style.minWidth, undefined);
      assert.equal(style.textAlign, "right");
      assert.equal(style.color, tokens.COLORS.text);
    };
    assertBlendedLevel("pet-level-main", 36);
    screen.openSale();
    assertBlendedLevel("sale-pet-level-main", 36);
    screen.blur(); screen.focusRoute(); screen.openPet(); screen.openAction("upgrade");
    assertBlendedLevel("material-pet-level-material", 1);
  }
});

test("quick-sale label and currency stay in centered independently wrapping layout groups", () => {
  const screen = inventory(); screen.press(screen.byId("inventory-quick-sale")); screen.render();
  const button = screen.byId("sell-pet-copy")!;
  const outer = (button.props.style as (input: { pressed: boolean }) => Record<string, unknown>[])({ pressed: false })[0];
  assert.equal(outer.minHeight, tokens.LAYOUT.control); assert.equal(outer.alignItems, "center"); assert.equal(outer.justifyContent, "center");
  const content = screen.byId("quick-sale-button-content")!;
  assert.equal((content.props.style as Record<string, unknown>).justifyContent, "center");
  assert.equal((content.props.style as Record<string, unknown>).alignItems, "center");
  assert.ok(screen.byId("quick-sale-button-amount"));
  for (const node of screen.nodes(content).filter((entry) => entry.type === "Text")) {
    assert.equal((node.props.style as Record<string, unknown>).includeFontPadding, false);
    assert.equal(screen.nodes(node).some((entry) => entry.type === "CurrencyArtwork"), false);
  }
});

test("inventory visible content and accessibility labels consistently use Vietnamese", () => {
  const screen = inventory();
  const visible = () => screen.nodes().flatMap((node) => [node.type === "Text" ? node.props.children : undefined, node.props.title, node.props.accessibilityLabel]).filter((value): value is string => typeof value === "string").join(" ");
  assert.match(visible(), /Thú nuôi/); assert.doesNotMatch(visible(), /\bpet\b|\bEXP\b/i);
  screen.openPet(); screen.openAction("feed"); assert.doesNotMatch(visible(), /\bpet\b|\bEXP\b/i);
  screen.blur(); screen.focusRoute(); screen.openSale(); assert.doesNotMatch(visible(), /\bpet\b|\bEXP\b/i);
});

test("six pet tiles fit a standard phone without names; item cards keep their readable layout", () => {
  const screen = inventory();
  assert.equal(screen.nodes().find((node) => node.type === "FlatList")?.props.numColumns, 6);
  const tile = screen.byId("inventory-card-main")!;
  const text = screen.nodes(tile).filter((node) => node.type === "Text").map((node) => String(node.props.children));
  assert.equal(text.some((value) => value.includes("Bọ Rùa Lửa")), false);
  assert.equal(screen.nodes(tile).some((node) => node.type === "PetArtwork"), true);
  const style = tile.props.style as (input: { pressed: boolean }) => unknown[];
  const layout = JSON.stringify(style({ pressed: false }));
  assert.ok(layout.includes('"width":49.166666666666664'));
  assert.ok(JSON.stringify(screen.nodes().find((node) => node.props.accessibilityRole === "tablist")).includes("9/30"));
  const tab = screen.nodes().find((node) => node.props.accessibilityRole === "tab" && JSON.stringify(node).includes("Vật phẩm"));
  screen.press(tab); screen.render();
  assert.equal(screen.nodes().find((node) => node.type === "FlatList")?.props.numColumns, 2);
  assert.equal(screen.byId("inventory-quick-sale"), undefined);
});

test("pets and food artwork use the shared five rarity accents and light tints instead of one garden gradient", () => {
  const pets = ["caterpillar", "ladybug", "hunter-bee", "moon-moth", "mantis"].map((id) => collection.createPetInstance(id, id));
  const screen = inventory({ pets });
  const tiers = { "Thường": tokens.RARITY.Common, "Không phổ biến": tokens.RARITY.Uncommon, "Hiếm": tokens.RARITY.Rare, "Sử thi": tokens.RARITY.Epic, "Huyền thoại": tokens.RARITY.Legendary };
  for (const pet of collection.getPetViews(pets)) {
    const card = screen.byId(`inventory-card-${pet.id}`)!;
    const styles = JSON.stringify((card.props.style as (input: { pressed: boolean }) => unknown[])({ pressed: false }));
    assert.ok(styles.includes(tiers[pet.rarity].accent)); assert.ok(styles.includes(tiers[pet.rarity].background));
  }
  const tab = screen.nodes().find((node) => node.props.accessibilityRole === "tab" && JSON.stringify(node).includes("Vật phẩm")); screen.press(tab); screen.render();
  for (const food of screen.state.inventory.items) {
    assert.ok(JSON.stringify(screen.byId(`food-rarity-stripe-${food.id}`)?.props.style).includes(tiers[food.rarity].accent));
    const artStyle = JSON.stringify(screen.byId(`food-rarity-art-${food.id}`)?.props.style);
    assert.ok(artStyle.includes(tiers[food.rarity].background)); assert.equal(artStyle.includes("gradient"), false);
  }
});

test("bulk sale spans species, quotes only once and preserves the last of each species", async () => {
  const pets = [collection.createPetInstance("ladybug", "a"), collection.createPetInstance("ladybug", "keep-a"), collection.createPetInstance("mantis", "b"), collection.createPetInstance("mantis", "keep-b")];
  const screen = inventory({ pets }); screen.selectPet("a"); screen.press(screen.byId("inventory-card-b")); screen.render();
  screen.press(screen.byId("inventory-bulk-sale")); screen.render();
  assert.equal(screen.nodes().filter((node) => node.props.testID === "pet-sale-summary").length, 1);
  screen.press(screen.byId("sell-pet-copy")); await flush(); screen.render();
  assert.deepEqual(screen.state.inventory.pets.map((pet) => pet.id).sort(), ["keep-a", "keep-b"]);
  assert.equal(screen.state.economy.gold, 1360);
  assert.equal(screen.nodes().some((node) => node.type === "Text" && JSON.stringify(node.props.children).includes("Đã bán")), false);
  const protectedScreen = inventory({ pets: [collection.createPetInstance("mantis", "last")] }); protectedScreen.openSale("last");
  assert.equal(protectedScreen.byId("sell-pet-copy")?.props.disabled, true);
  assert.ok(protectedScreen.byId("pet-sale-invalid"));
});

test("quick sale has only rarity filters and one compact final quote, still sells exact surplus and refunds EXP food", async () => {
  const partial = { ...collection.createPetInstance("caterpillar", "partial"), experience: 25, foodSpent: { "berry-bites": 1 } };
  const pets = [partial, collection.createPetInstance("caterpillar", "keep"), { ...collection.createPetInstance("caterpillar", "trained"), level: 2 }, collection.createPetInstance("ladybug", "blue"), collection.createPetInstance("ladybug", "keep-blue")];
  const screen = inventory({ pets }); screen.press(screen.byId("inventory-quick-sale")); screen.render();
  assert.ok(screen.byId("quick-sale-rarities"));
  assert.equal(screen.byId("sale-selected-pets"), undefined);
  assert.equal(screen.byId("quick-sale-count"), undefined);
  assert.equal(screen.byId("pet-sale-summary"), undefined);
  screen.press(screen.byId("quick-sale-Không phổ biến")); screen.render();
  assert.deepEqual([...screen.state.settings.quickSaleRarities], ["Thường", "Không phổ biến"]);
  assert.equal(screen.byId("pet-food-refund"), undefined);
  assert.match(String(screen.byId("sell-pet-copy")?.props.accessibilityLabel), /Bán 3 thú nuôi, nhận 80 vàng, hoàn 1 Quả Mọng/);
  screen.press(screen.byId("sell-pet-copy")); await flush(); screen.render();
  assert.equal(screen.state.inventory.pets.some((pet) => pet.id === "partial"), false);
  assert.equal(screen.state.inventory.pets.some((pet) => pet.id === "trained"), true);
  assert.ok(screen.state.inventory.pets.some((pet) => pet.speciesId === "caterpillar"));
  assert.ok(screen.state.inventory.pets.some((pet) => pet.speciesId === "ladybug"));
});

test("pending reward mutation blocks feeding, upgrading, selecting and quick sale", () => {
  const screen = inventory({ pendingRewardAction: true });
  assert.equal(screen.byId("inventory-quick-sale")?.props.disabled, true);
  assert.equal(screen.byId("inventory-select-pets")?.props.disabled, true);
  screen.selectPet(); assert.equal(screen.byId("inventory-bulk-sale"), undefined);
  screen.openPet(); assert.equal(screen.byId("show-pet-feed")?.props.disabled, true); assert.equal(screen.byId("show-pet-upgrade")?.props.disabled, true);
});

test("upgrades never auto-select materials and exclude self, other species and upgraded instances", async () => {
  const screen = inventory(); screen.openPet(); screen.openAction("upgrade");
  assert.equal(screen.byId("upgrade-pet")?.props.disabled, true);
  assert.equal(screen.byId("choose-pet-main"), undefined); assert.equal(screen.byId("choose-pet-upgraded"), undefined); assert.equal(screen.byId("choose-pet-other-species"), undefined);
  screen.press(screen.byId("choose-pet-copy-1")); screen.render(); screen.press(screen.byId("choose-pet-copy-2")); screen.render();
  assert.ok(screen.byId("pet-food-refund")); assert.equal(screen.byId("upgrade-pet")?.props.disabled, false);
  screen.press(screen.byId("upgrade-pet")); assert.equal(screen.alerts.length, 0); await flush(); screen.render();
  const upgrade = screen.calls[0]; assert.ok(upgrade.kind === "upgrade"); assert.deepEqual([...upgrade.materialPetIds].sort(), ["copy-1", "copy-2"]);
  assert.equal(screen.state.inventory.pets.find((pet) => pet.id === "main")!.stars, 2); assert.ok(screen.state.inventory.pets.some((pet) => pet.id === "upgraded"));
});

test("level/food shortages remain readable and prevent upgrades without repeated level explanation", () => {
  const screen = inventory({ level: 17, food: 0, gold: 0 }); screen.openPet(); screen.openAction("upgrade");
  assert.match(JSON.stringify(screen.byId("pet-upgrade-level")), /17/); assert.doesNotMatch(JSON.stringify(screen.byId("pet-upgrade-missing")), /cấp 18/);
  assert.equal(screen.byId("upgrade-pet")?.props.disabled, true); screen.press(screen.byId("upgrade-pet")); assert.equal(screen.alerts.length, 0);
});

test("level-only shortage blocks an upgrade using the red requirement, not an extra prose block", () => {
  const screen = inventory({ level: 1 }); screen.openPet(); screen.openAction("upgrade");
  screen.press(screen.byId("choose-pet-copy-1")); screen.render(); screen.press(screen.byId("choose-pet-copy-2")); screen.render();
  assert.equal(screen.byId("pet-upgrade-missing"), undefined);
  assert.equal(screen.byId("upgrade-pet")?.props.disabled, true);
});

test("pet tiles render exactly one to three filled stars and a digits-only top-right level badge", () => {
  const pets = [1, 2, 3].map((stars) => ({ ...collection.createPetInstance("ladybug", `star-${stars}`), stars: stars as 1 | 2 | 3, baseCopies: ({ 1: 1, 2: 3, 3: 6 }[stars])!, upgradeGoldSpent: ({ 1: 0, 2: 200, 3: 700 }[stars])!, level: 36 }));
  const screen = inventory({ pets });
  for (const count of [1, 2, 3]) {
    const tile = screen.byId(`inventory-card-star-${count}`)!;
    const stars = screen.nodes(screen.byId(`pet-stars-star-${count}`)).filter((node) => node.type === "Icon");
    assert.equal(stars.length, count); assert.ok(stars.every((node) => node.props.name === "star"));
    assert.equal(screen.byId(`pet-level-star-${count}`)?.props.children, 36);
    assert.equal(screen.nodes(tile).some((node) => node.type === "Text" && JSON.stringify(node.props.children).includes("C36")), false);
  }
  screen.selectPet("star-1");
  assert.equal((screen.byId("inventory-card-star-1")?.props.accessibilityState as { checked: boolean }).checked, true);
  assert.equal(screen.byId("pet-level-star-1")?.props.children, 36);
});

test("failed sale save blocks dismissal while busy and retries original IDs after close/reopen", async () => {
  const saved = deferred(); const screen = inventory({ save: async (write) => { if (write === 1) { await saved.promise; throw new Error("disk"); } } });
  screen.openSale(); screen.press(screen.byId("sell-pet-copy")); screen.press(screen.byId("sell-pet-copy")); screen.render();
  screen.press(screen.byId("pet-action-backdrop")); screen.render(); assert.ok(screen.byId("pet-action-dialog")); assert.equal(screen.calls.length, 1);
  saved.resolve(); await flush(); screen.render(); assert.ok(screen.byId("retry-pet-transaction"));
  screen.press(screen.button("Đóng thao tác")); screen.render();
  assert.ok(screen.byId("retry-pet-transaction")); screen.openPet("copy-3");
  screen.press(screen.byId("retry-pet-transaction")); await flush(); screen.render();
  assert.equal(screen.calls.length, 2); assert.equal(screen.calls[0].requestId, screen.calls[1].requestId);
  assert.equal(screen.state.economy.petTransactions.filter((entry) => entry.kind === "sell").length, 1);
});

test("pending rewards block pet actions and late logout completion does not show success", async () => {
  const blocked = inventory({ pendingRewardAction: true }); blocked.openPet();
  for (const id of ["show-pet-feed", "show-pet-upgrade"]) assert.equal(blocked.byId(id)?.props.disabled, true);
  const saved = deferred(); const screen = inventory({ save: () => saved.promise }); screen.openPet(); screen.openAction("feed"); screen.press(screen.byId("feed-berry-bites")); screen.logout(); saved.resolve(); await flush(); screen.render();
  assert.equal(screen.nodes().some((node) => node.props.accessibilityLiveRegion === "polite" && JSON.stringify(node.props.children).includes("Pet nhận")), false);
});

test("large text uses four compact inventory columns and popup stays bounded and scrollable", () => {
  const screen = inventory({ width: 320, height: 568, fontScale: 1.8 });
  assert.equal(screen.nodes().find((node) => node.type === "FlatList")?.props.numColumns, 4);
  screen.openPet(); screen.openAction("upgrade");
  const style = screen.byId("pet-action-dialog")!.props.style as { width?: number; maxHeight?: number }[];
  assert.ok(style.some((entry) => entry.width === 280));
  assert.ok(screen.nodes(screen.byId("pet-action-dialog")).some((node) => node.type === "ScrollView"));
  assert.equal(screen.nodes().some((node) => node.props.allowFontScaling === false), false);
});

test("popup focus is sent after layout and restored when Android back closes the popup", () => {
  const screen = inventory(); screen.openPet(); screen.openAction("upgrade");
  const header = screen.nodes(screen.byId("pet-action-dialog")).find((node) => node.props.accessibilityRole === "header")!;
  (header.props.onLayout as () => void)();
  assert.equal(screen.accessibilityFocus.length, 1);
  const modal = screen.nodes().find((node) => node.type === "Modal")!;
  (modal.props.onRequestClose as () => void)(); screen.render();
  assert.equal(screen.byId("pet-action-dialog"), undefined);
  assert.ok(screen.byId("pet-progression-panel")); assert.equal(screen.accessibilityFocus.length, 2);
  assert.equal(modal.props.animationType, "none", "Motion stays off until the system preference is known");
});

test("failed upgrade retries exact material IDs once and closes popup after saving", async () => {
  const screen = inventory({ save: async (write) => { if (write === 1) throw new Error("disk"); } }); screen.openPet(); screen.openAction("upgrade");
  screen.press(screen.byId("choose-pet-copy-1")); screen.render(); screen.press(screen.byId("choose-pet-copy-2")); screen.render(); screen.press(screen.byId("upgrade-pet")); await flush(); screen.render();
  assert.ok(screen.byId("retry-pet-transaction")); assert.equal(screen.byId("upgrade-pet"), undefined);
  screen.press(screen.byId("retry-pet-transaction")); await flush(); screen.render();
  assert.equal(screen.calls[0].requestId, screen.calls[1].requestId); assert.equal(screen.byId("pet-action-overlay"), undefined);
  assert.equal(screen.state.economy.petTransactions.filter((receipt) => receipt.kind === "upgrade").length, 1);
});

test("failed food save reuses its receipt after closing the detail, without feeding twice", async () => {
  const screen = inventory({ save: async (write) => { if (write === 1) throw new Error("disk"); } }); screen.openPet(); screen.openAction("feed"); screen.press(screen.byId("feed-berry-bites")); await flush(); screen.render();
  screen.press(screen.button("Đóng chi tiết")); screen.render(); screen.press(screen.byId("retry-pet-transaction")); await flush(); screen.render();
  assert.equal(screen.calls[0].requestId, screen.calls[1].requestId);
  assert.equal(screen.state.inventory.items.find((food) => food.id === "berry-bites")!.quantity, 4);
  assert.equal(screen.state.economy.petTransactions.filter((receipt) => receipt.kind === "feed").length, 1);
});
