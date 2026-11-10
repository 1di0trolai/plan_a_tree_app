/** Kiểm thử lớp phủ mở thẻ thú, chờ lưu phần thưởng, giảm chuyển động và phục hồi lỗi không cấp quà trùng. */

import { viI18n } from "./fixtures/i18nFixture";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";
import { createGardenFixture } from "./fixtures/gardenFixture";
import { revealDailyPack } from "../src/store/journeyActions";
import { localDateKey, PET_SPECIES } from "../src/data/seed";
import type { CardRarity, DailyPetPack } from "../src/types/app";

// Render real route, presenters and motion hook; pixels still need native QA.
const compile = (path: string) => ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const sources = {
  route: compile("../src/app/reward-pack.tsx"),
  reveal: compile("../src/screens/rewards/PackReveal.tsx"),
  cards: compile("../src/screens/rewards/PackCards.tsx"),
  motion: compile("../src/screens/rewards/usePackReveal.ts"),
};
const tokens = {} as typeof import("../src/theme");
runInNewContext(compile("../src/theme.ts"), { exports: tokens, require: () => ({ Platform: { OS: "ios", Version: 26 } }) });
type Node = { type: unknown; props: Record<string, unknown> };
type Options = {
  revealed?: boolean; reduceMotion?: boolean; lightAR?: boolean; noPack?: boolean; packId?: string;
  fontScale?: number; width?: number; height?: number; rarity?: CardRarity; bonusFoodItemId?: string | null;
  canGoBack?: boolean; persist?: (write: number) => Promise<void>;
};
const flush = () => new Promise((resolve) => setImmediate(resolve));
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
};

function reward(options: Options = {}) {
  let state = createGardenFixture();
  state.settings.lightAR = !!options.lightAR;
  const pet = PET_SPECIES[0];
  const pack: DailyPetPack = {
    id: "earned-pack", roundId: "completed-round", date: localDateKey(), beastId: pet.id, rarity: options.rarity ?? "Common",
    isNew: false, earnedAt: "2026-10-29T03:00:00Z", revealedAt: options.revealed ? "2026-10-29T04:00:00Z" : null, demo: false,
    bonusFoodItemId: options.bonusFoodItemId,
  };
  state.dailyPacks = options.noPack ? [] : [pack];
  const inventoryBefore = JSON.stringify(state.inventory);
  const hooks: unknown[] = [];
  const pendingEffects: (() => void)[] = [];
  const cleanupSlots = new Map<number, () => void>();
  const animations: FakeAnimation[] = [];
  const values: FakeAnimatedValue[] = [];
  const events = new Map<string, (...args: unknown[]) => unknown>();
  let cursor = 0;
  let nextId = 0;
  let dirty = false;
  let tree: unknown;
  let writes = 0;
  let opens = 0;
  let animationStops = 0;
  const routes: unknown[] = [];
  const scrolls: unknown[] = [];
  class FakeAnimatedValue {
    constructor(public value: number) { values.push(this); }
    interpolate(input: unknown) { return input; }
    setValue(value: number) { this.value = value; }
    stopAnimation() { animationStops += 1; }
  }
  class FakeAnimation {
    started = false;
    stopped = false;
    finished = false;
    callback?: (result: { finished: boolean }) => void;
    constructor(public kind: string, public value?: FakeAnimatedValue, public config?: Record<string, unknown>) { animations.push(this); }
    start(callback?: (result: { finished: boolean }) => void) { this.started = true; this.callback = callback; }
    stop() { if (this.stopped || this.finished) return; this.stopped = true; this.callback?.({ finished: false }); }
    finish(finished = true) { this.finished = true; this.value?.setValue(this.config?.toValue as number); this.callback?.({ finished }); }
  }
  const sameDeps = (a: unknown[] | undefined, b: unknown[] | undefined) => a && b && a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
  const react = {
    useId: () => {
      const index = cursor++;
      if (!(index in hooks)) hooks[index] = `reward-${nextId++}`;
      return hooks[index];
    },
    useState: <T>(initial: T | (() => T)) => {
      const index = cursor++;
      if (!(index in hooks)) hooks[index] = typeof initial === "function" ? (initial as () => T)() : initial;
      return [hooks[index], (value: T | ((previous: T) => T)) => {
        const next = typeof value === "function" ? (value as (previous: T) => T)(hooks[index] as T) : value;
        if (!Object.is(next, hooks[index])) { hooks[index] = next; dirty = true; }
      }];
    },
    useRef: <T>(initial: T) => {
      const index = cursor++;
      if (!(index in hooks)) hooks[index] = { current: initial };
      return hooks[index];
    },
    useCallback: <T>(callback: T, deps: unknown[]) => {
      const index = cursor++;
      const old = hooks[index] as { callback: T; deps: unknown[] } | undefined;
      if (!old || !sameDeps(old.deps, deps)) hooks[index] = { callback, deps };
      return (hooks[index] as { callback: T }).callback;
    },
    useEffect: (effect: () => void | (() => void), deps?: unknown[]) => {
      const index = cursor++;
      if (!(index in hooks) || !sameDeps(hooks[index] as unknown[] | undefined, deps)) {
        hooks[index] = deps;
        pendingEffects.push(() => {
          cleanupSlots.get(index)?.();
          cleanupSlots.delete(index);
          const cleanup = effect();
          if (cleanup) cleanupSlots.set(index, cleanup);
        });
      }
    },
  };
  const persistNow = async () => { writes += 1; await options.persist?.(writes); };
  const openDailyPack = (id: string) => { opens += 1; const result = revealDailyPack(state, id); state = result.state; return result.pack; };
  const jsx = (type: unknown, props: Record<string, unknown>) => ({ type, props });
  const register = (prefix: string) => (name: string, callback: (...args: unknown[]) => unknown) => {
    events.set(`${prefix}:${name}`, callback);
    return { remove: () => events.delete(`${prefix}:${name}`) };
  };
  const exports = new Map<string, Record<string, unknown>>();
  const load = (name: keyof typeof sources): Record<string, unknown> => {
    if (exports.has(name)) return exports.get(name)!;
    const output = {};
    exports.set(name, output);
    runInNewContext(sources[name], { exports: output, require: dependency });
    return output;
  };
  const dependency = (id: string): unknown => {
    switch (id) {
        case "@/i18n": return { useI18n: () => viI18n };
        case "@/i18n/core": return viI18n;
      case "react": return react;
      case "react/jsx-runtime": return { jsx, jsxs: jsx, Fragment: "Fragment" };
      case "@expo/vector-icons/Ionicons": return { __esModule: true, default: "Icon" };
      case "expo-linear-gradient": return { LinearGradient: "LinearGradient" };
      case "expo-status-bar": return { StatusBar: "StatusBar" };
      case "react-native-svg": return { __esModule: true, default: "Svg", Defs: "SvgDefs", Ellipse: "SvgEllipse", Path: "SvgPath", RadialGradient: "SvgRadialGradient", Stop: "SvgStop" };
      case "expo-router": return {
        useLocalSearchParams: () => ({ packId: options.packId }),
        useFocusEffect: (effect: () => void | (() => void)) => react.useEffect(effect, [effect]),
        router: { canGoBack: () => options.canGoBack !== false, back: () => routes.push("back"), replace: (route: unknown) => routes.push(route) },
      };
      case "react-native-safe-area-context": return { SafeAreaView: "SafeAreaView", useSafeAreaInsets: () => ({ top: 44, bottom: 24, left: 0, right: 0 }) };
      case "react-native": return {
        Pressable: "Pressable", ScrollView: "ScrollView", Text: "Text", View: "View",
        useWindowDimensions: () => ({ width: options.width ?? 375, height: options.height ?? 812, fontScale: options.fontScale ?? 1 }),
        StyleSheet: { create: (value: unknown) => value, absoluteFill: { position: "absolute", left: 0, right: 0, top: 0, bottom: 0 } },
        AppState: { currentState: "active", addEventListener: register("app") },
        BackHandler: { addEventListener: register("back") },
        AccessibilityInfo: { isReduceMotionEnabled: async () => !!options.reduceMotion, addEventListener: register("accessibility") },
        Easing: { cubic: "cubic", sin: "sin", out: (value: unknown) => value, in: (value: unknown) => value, inOut: (value: unknown) => value },
        Animated: {
          Value: FakeAnimatedValue, View: "AnimatedView", Text: "AnimatedText",
          timing: (value: FakeAnimatedValue, config: Record<string, unknown>) => new FakeAnimation("timing", value, config),
          spring: (value: FakeAnimatedValue, config: Record<string, unknown>) => new FakeAnimation("spring", value, config),
          sequence: () => new FakeAnimation("sequence"), loop: () => new FakeAnimation("loop"),
        },
      };
      case "@/components/journeyUI": return { JourneyButton: "JourneyButton" };
      case "@/components/PetArtwork": return { PetArtwork: "PetArtwork" };
      case "@/components/FoodArtwork": return { FoodArtwork: "FoodArtwork" };
      case "@/components/BrandArtwork": return { BrandArtwork: "BrandArtwork" };
      case "@/hooks/useControlFocus": return { useControlFocus: () => ({ props: () => ({}), style: () => undefined }) };
      case "@/screens/rewards/PackReveal": return load("reveal");
      case "./PackCards": return load("cards");
      case "./usePackReveal": return load("motion");
      case "@/theme": return tokens;
      case "@/data/seed": return { PET_SPECIES };
      case "@/store/AppStore": return { useApp: () => ({ state, persistNow, openDailyPack }) };
      default: throw new Error(`Unexpected dependency: ${id}`);
    }
  };
  const expand = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(expand);
    if (!value || typeof value !== "object" || !("props" in value)) return value;
    const node = value as Node;
    if (typeof node.type === "function") return expand(node.type(node.props));
    if (node.type === "ScrollView" && node.props.ref) (node.props.ref as { current: unknown }).current = { scrollTo: (input: unknown) => scrolls.push(input) };
    return { ...node, props: { ...node.props, children: expand(node.props.children) } };
  };
  const route = load("route").default as () => Node;
  const render = () => {
    for (let pass = 0; pass < 10; pass += 1) {
      dirty = false; cursor = 0; tree = expand(route());
      const scheduled = pendingEffects.splice(0);
      scheduled.forEach((effect) => effect());
      if (!dirty) return tree;
    }
    throw new Error("Unstable render loop");
  };
  const nodes = (value: unknown = tree): Node[] => {
    if (Array.isArray(value)) return value.flatMap((child) => nodes(child));
    if (!value || typeof value !== "object" || !("props" in value)) return [];
    const node = value as Node;
    return [node, ...(node.props.children === undefined ? [] : nodes(node.props.children))];
  };
  const byId = (id: string) => nodes().find((node) => node.props.testID === id);
  const button = (title: string) => nodes().find((node) => node.props.title === title || node.props.accessibilityLabel === title);
  const press = (node: Node | undefined) => { assert.ok(node, "Control should exist"); (node.props.onPress as () => void)(); };
  const finishFinite = (finished = true) => {
    const animation = animations.find((entry) => entry.started && !entry.stopped && !entry.finished && ["timing", "spring"].includes(entry.kind));
    assert.ok(animation, "Finite animation should be active"); animation.finish(finished);
  };
  render();
  return {
    render, nodes, byId, button, press, routes, scrolls, values, animations, events, inventoryBefore, finishFinite,
    pressCard: () => press(byId("open-earned-pack")),
    get state() { return state; }, get counts() { return { writes, opens, animationStops }; },
    unmount: () => { [...cleanupSlots.values()].forEach((cleanup) => cleanup()); cleanupSlots.clear(); },
  };
}

test("reward is a dismissible overlay whose sealed card is the only reveal action", async () => {
  const screen = reward(); await flush(); screen.render();
  assert.equal(screen.byId("open-earned-pack")?.props.accessibilityLabel, "Mở thẻ thú nuôi");
  assert.equal(screen.nodes().some((node) => node.type === "JourneyHeader"), false);
  assert.equal(screen.button("Thông tin phần thưởng"), undefined);
  assert.equal(screen.button("Về khu vườn"), undefined);
  assert.equal(screen.nodes().some((node) => node.type === "StatusBar" && node.props.style === "light"), true);
  assert.ok(screen.byId("reward-halo"));
  const arrival = screen.animations.find((entry) => entry.config?.duration === tokens.MOTION.cardArrival && entry.started);
  assert.ok(arrival);
  assert.ok(screen.animations.filter((entry) => entry.config).every((entry) => entry.config?.useNativeDriver === true));
  screen.press(screen.byId("reward-backdrop"));
  assert.deepEqual(screen.routes, ["back"]);
  assert.equal(screen.counts.opens, 0);
});

test("initial write and reveal write gate all front artwork, with rapid taps locked", async () => {
  const first = deferred(); const second = deferred();
  const screen = reward({ persist: (write) => write === 1 ? first.promise : second.promise });
  screen.pressCard(); assert.equal(screen.counts.opens, 0);
  first.resolve(); await flush(); screen.render();
  screen.pressCard(); screen.pressCard(); screen.render();
  assert.equal(screen.counts.opens, 1);
  assert.equal(screen.byId("open-earned-pack")?.props.disabled, true);
  assert.equal(screen.byId("revealed-pet-card"), undefined);
  assert.equal(screen.animations.some((entry) => entry.config?.duration === tokens.MOTION.cardCharge && entry.started), false);
  second.resolve(); await flush(); screen.render();
  assert.ok(screen.animations.some((entry) => entry.config?.duration === tokens.MOTION.cardCharge && entry.started));
  screen.finishFinite(); screen.render();
  assert.ok(screen.byId("revealed-pet-card"));
  screen.finishFinite(); screen.render();
  assert.equal(screen.byId("open-earned-pack"), undefined);
  assert.equal(JSON.stringify(screen.state.inventory), screen.inventoryBefore);
});

test("storage errors retain safe initial-save retry then same-card reveal retry", async () => {
  const screen = reward({ reduceMotion: true, persist: async (write) => { if ([1, 3].includes(write)) throw new Error("disk"); } });
  await flush(); screen.render();
  assert.equal(screen.byId("open-earned-pack")?.props.disabled, true);
  screen.press(screen.button("Thử lưu lại")); await flush(); screen.render();
  assert.equal(screen.byId("open-earned-pack")?.props.disabled, false);
  screen.pressCard(); await flush(); screen.render();
  assert.equal(screen.byId("revealed-pet-card"), undefined);
  assert.ok(screen.nodes().some((node) => node.props.accessibilityRole === "alert"));
  const openedAt = screen.state.dailyPacks[0].revealedAt;
  screen.pressCard(); await flush(); screen.render();
  assert.ok(screen.byId("revealed-pet-card"));
  assert.equal(screen.state.dailyPacks[0].revealedAt, openedAt);
  assert.equal(JSON.stringify(screen.state.inventory), screen.inventoryBefore);
});

test("reduced-motion and light-AR both preserve manual reveal without any animation loop", async () => {
  for (const options of [{ reduceMotion: true }, { lightAR: true }]) {
    const screen = reward(options); await flush(); screen.render();
    assert.equal(screen.byId("revealed-pet-card"), undefined);
    assert.equal(screen.animations.some((entry) => entry.started), false);
    screen.pressCard(); await flush(); screen.render();
    assert.ok(screen.byId("revealed-pet-card"));
    assert.equal(screen.animations.some((entry) => entry.started), false);
  }
});

test("saved opened pack shows the pet immediately, with no grant or new arrival", async () => {
  const screen = reward({ revealed: true, fontScale: 2 }); await flush(); screen.render();
  assert.ok(screen.byId("revealed-pet-card"));
  assert.equal(screen.byId("open-earned-pack"), undefined);
  assert.equal(screen.counts.opens, 0);
  assert.equal(screen.animations.some((entry) => entry.config?.duration === tokens.MOTION.cardArrival && entry.started), false);
  assert.equal(screen.nodes().some((node) => node.props.allowFontScaling === false), false);
  assert.ok(screen.nodes().some((node) => node.type === "ScrollView" && !node.props.horizontal));
});

test("sealed and revealed cards keep their labels without decorative Gemini-like badges", async () => {
  for (const rarity of ["Common", "Uncommon", "Rare", "Epic", "Legendary"] as const) {
    const screen = reward({ rarity, reduceMotion: true }); await flush(); screen.render();
    assert.ok(screen.byId("sealed-card-open-footer"));
    assert.equal(screen.nodes().some((node) => node.props.name === "sparkles-outline"), false);
    screen.pressCard(); await flush(); screen.render();
    assert.ok(screen.byId("revealed-pet-card"));
    assert.equal(screen.nodes().some((node) => ["sparkles-outline", "diamond-outline"].includes(String(node.props.name))), false);
  }
});

test("bonus is credited once before revealing, then offers a peek and two-way reward pager", async () => {
  const second = deferred();
  const screen = reward({ bonusFoodItemId: "berry-bites", persist: (write) => write === 2 ? second.promise : Promise.resolve() });
  const before = screen.state.inventory.items.find((item) => item.id === "berry-bites")!.quantity;
  await flush(); screen.render(); screen.pressCard(); await flush(); screen.render();
  assert.equal(screen.byId("pack-bonus-food"), undefined);
  assert.equal(screen.state.inventory.items.find((item) => item.id === "berry-bites")!.quantity, before + 1);
  second.resolve(); await flush(); screen.finishFinite(); screen.render(); screen.finishFinite(); screen.render();
  assert.ok(screen.byId("pack-bonus-food"));
  assert.ok(screen.byId("bonus-card-peek"));
  const pager = screen.byId("reward-pager")!;
  assert.equal(pager.props.pagingEnabled, true);
  assert.equal(pager.props.horizontal, true);
  screen.press(screen.button("Xem quà đi kèm")); screen.render();
  assert.equal(screen.byId("bonus-card-peek"), undefined);
  assert.equal(screen.button("Xem quà đi kèm")?.props.disabled, true);
  assert.ok(screen.scrolls.length);
  screen.press(screen.button("Xem thẻ thú nuôi")); screen.render();
  assert.ok(screen.byId("bonus-card-peek"));
  const cardWidth = (screen.byId("reward-pager")!.props.style as { width: number }).width;
  (screen.byId("reward-pager")!.props.onMomentumScrollEnd as (event: unknown) => void)({ nativeEvent: { contentOffset: { x: cardWidth } } }); screen.render();
  assert.equal(screen.button("Xem quà đi kèm")?.props.disabled, true);
  assert.deepEqual(screen.routes, []);
  assert.equal(screen.state.inventory.items.find((item) => item.id === "berry-bites")!.quantity, before + 1);
});

test("bonus failure and reopen preserve exactly one fixed food credit", async () => {
  const screen = reward({ bonusFoodItemId: "honey-cookie", reduceMotion: true, persist: async (write) => { if (write === 2) throw new Error("disk"); } });
  const before = screen.state.inventory.items.find((item) => item.id === "honey-cookie")!.quantity;
  await flush(); screen.render(); screen.pressCard(); await flush(); screen.render();
  assert.equal(screen.byId("pack-bonus-food"), undefined);
  screen.pressCard(); await flush(); screen.render();
  assert.ok(screen.byId("pack-bonus-food"));
  assert.equal(screen.state.inventory.items.find((item) => item.id === "honey-cookie")!.quantity, before + 1);
});

test("background or a reduced-motion change settles a durably revealed card without replay", async () => {
  for (const event of ["background", "reduce-motion"]) {
    const screen = reward(); await flush(); screen.render(); screen.pressCard(); await flush(); screen.render();
    if (event === "background") screen.events.get("app:change")?.("background");
    else screen.events.get("accessibility:reduceMotionChanged")?.(true);
    screen.render();
    assert.ok(screen.byId("revealed-pet-card"));
    assert.equal(screen.counts.opens, 1);
    assert.equal(screen.animations.some((entry) => entry.kind === "spring" && entry.started), false);
    assert.ok(screen.animations.filter((entry) => entry.kind === "loop").every((entry) => entry.stopped));
  }
});

test("closing during a write stops motion and never launches a reveal after unmount", async () => {
  const pending = deferred();
  const screen = reward({ persist: (write) => write === 2 ? pending.promise : Promise.resolve() });
  await flush(); screen.render(); screen.pressCard(); screen.press(screen.byId("close-reward"));
  screen.unmount(); pending.resolve(); await flush();
  assert.deepEqual(screen.routes, ["back"]);
  assert.ok(screen.state.dailyPacks[0].revealedAt);
  assert.equal(screen.animations.some((entry) => entry.config?.duration === tokens.MOTION.cardCharge && entry.started), false);
  assert.ok(screen.counts.animationStops >= 4);
  assert.equal(screen.events.size, 0);
});

test("an interrupted native charge settles to the saved pet instead of starting another animation", async () => {
  const screen = reward(); await flush(); screen.render(); screen.pressCard(); await flush(); screen.render();
  screen.finishFinite(false); screen.render();
  assert.ok(screen.byId("revealed-pet-card"));
  assert.equal(screen.animations.some((entry) => entry.kind === "spring" && entry.started), false);
  assert.equal(screen.counts.opens, 1);
  assert.ok(screen.state.dailyPacks[0].revealedAt);
});

test("Android back and direct-link fallback dismiss without requiring an opened card", () => {
  const screen = reward({ canGoBack: false });
  assert.equal(screen.events.get("back:hardwareBackPress")?.(), true);
  assert.deepEqual(screen.routes, ["/(tabs)/garden"]);
  assert.equal(screen.counts.opens, 0);
});

test("an invalid requested pack ID and an empty inventory never fallback to a different gift", () => {
  for (const options of [{ packId: "missing-pack" }, { noPack: true }]) {
    const screen = reward(options);
    assert.equal(screen.byId("open-earned-pack"), undefined);
    assert.equal(screen.byId("revealed-pet-card"), undefined);
    assert.equal(screen.counts.opens, 0);
    assert.ok(JSON.stringify(screen.nodes()).includes("Chưa có quà để mở"));
  }
});

test("five revealed halos follow green, blue, purple, gold, red rather than duplicate green", async () => {
  const colors: string[] = [];
  for (const rarity of ["Common", "Uncommon", "Rare", "Epic", "Legendary"] as const) {
    const screen = reward({ revealed: true, rarity, reduceMotion: true }); await flush(); screen.render();
    const halo = JSON.stringify(screen.byId("reward-halo"));
    assert.ok(halo.includes(tokens.RARITY[rarity].glow));
    colors.push(tokens.RARITY[rarity].glow);
  }
  assert.equal(new Set(colors).size, 5);
});

test("small portrait and landscape cards remain bounded and retain scrollable scaled text", async () => {
  for (const size of [{ width: 320, height: 568 }, { width: 667, height: 375 }]) {
    const screen = reward({ ...size, revealed: true, fontScale: 2 }); await flush(); screen.render();
    const pager = screen.byId("reward-pager")!;
    const style = pager.props.style as { width: number; height: number };
    assert.ok(style.width < size.width);
    if (size.width > size.height) assert.ok(style.width >= 220, "Landscape card must not collapse into a narrow strip");
    assert.ok(style.height < size.height - 68);
    assert.ok(screen.nodes().some((node) => node.type === "ScrollView" && !node.props.horizontal));
    assert.equal(screen.nodes().some((node) => node.props.allowFontScaling === false), false);
  }
});

test("silver halo is a feathered radial gradient rather than stacked opaque panels", async () => {
  const screen = reward({ reduceMotion: true }); await flush(); screen.render();
  const halo = screen.byId("reward-halo")!;
  const inner = screen.nodes(halo);
  assert.ok(inner.some((node) => node.type === "SvgRadialGradient"));
  assert.ok(inner.some((node) => node.type === "SvgStop" && node.props.offset === "1" && node.props.stopOpacity === "0"));
  assert.equal(inner.some((node) => node.type === "View"), false);
});

test("compact portrait reward leaves visible aura breathing room and strengthens its rim", async () => {
  const screen = reward({ revealed: true, reduceMotion: true }); await flush(); screen.render();
  const style = screen.byId("reward-pager")!.props.style as { width: number; height: number };
  assert.equal(style.width, 248);
  assert.equal(style.height, 360);
  const art = screen.nodes().find((node) => node.type === "PetArtwork")!;
  assert.ok(Number(art.props.size) <= 176, "Pet artwork shrinks with the card rather than overflowing");
  const halo = screen.byId("reward-halo")!;
  const haloStyle = (halo.props.style as { opacity?: { outputRange: number[] } }[]).find((entry) => entry.opacity);
  assert.ok(haloStyle?.opacity?.outputRange.every((opacity) => opacity >= 0.8));
  const stops = screen.nodes(halo).filter((node) => node.type === "SvgStop");
  assert.ok(stops.some((node) => node.props.offset === "0.64" && Number(node.props.stopOpacity) >= 0.6));
  assert.ok(stops.some((node) => node.props.offset === "1" && node.props.stopOpacity === "0"));
});

test("open caption stays in a fixed sealed-card footer outside the scroll body", async () => {
  const screen = reward({ reduceMotion: true, width: 320, height: 568, fontScale: 1.6 }); await flush(); screen.render();
  const footer = screen.byId("sealed-card-open-footer")!;
  assert.ok(footer);
  assert.ok(JSON.stringify(footer).includes("Mở thẻ"));
  const scrollBodies = screen.nodes().filter((node) => node.type === "ScrollView");
  assert.equal(scrollBodies.some((node) => screen.nodes(node).includes(footer)), false);
  const style = footer.props.style as { flexShrink: number; minHeight: number };
  assert.equal(style.flexShrink, 0);
  assert.ok(style.minHeight >= tokens.LAYOUT.touch);
});
