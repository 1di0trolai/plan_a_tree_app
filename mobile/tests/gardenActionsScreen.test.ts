/** Kiểm thử các thao tác chính của khu vườn, ảnh cây trống và vị trí nhận quà chăm sóc. */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";
import { t } from "../src/i18n/core";

import { localDateKey } from "../src/data/seed";
import { gardenViewportBudget } from "../src/screens/garden/gardenLayout";
import * as gardenNavigation from "../src/screens/garden/gardenNavigation";
import * as journeyActions from "../src/store/journeyActions";
import { getCurrentPlantStreak } from "../src/utils/plantStreak";
import type { AppState } from "../src/types/app";
import { createGardenFixture } from "./fixtures/gardenFixture";

// Exercise the real screen callbacks, not native pixels, hardware or gestures.
const compile = (file: string) =>
  ts.transpileModule(readFileSync(resolve(__dirname, file), "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText;
const compiled = compile("../src/app/(tabs)/garden.tsx");
const theme = {};
runInNewContext(compile("../src/theme.ts"), {
  exports: theme,
  require: () => ({ Platform: { OS: "ios", Version: 26 } }),
});
type Node = { type: unknown; props: Record<string, unknown> };

function nodes(value: unknown): Node[] {
  if (Array.isArray(value)) return value.flatMap(nodes);
  if (!value || typeof value !== "object" || !("props" in value)) return [];
  const node = value as Node;
  return [node, ...nodes(node.props.children)];
}

function garden(state = createGardenFixture()) {
  const slots: unknown[] = [];
  let cursor = 0;
  const routes: unknown[] = [];
  const exports = {} as { default: () => unknown };
  const jsx = (type: unknown, props: Record<string, unknown>) => ({ type, props });
  runInNewContext(compiled, {
    exports,
    require: (id: string) => {
      switch (id) {
        case "@/i18n": return { t, useI18n: () => ({ locale: "vi", t }) };
        case "react":
          return {
            useState: (initial: unknown) => {
              const slot = cursor++;
              if (!(slot in slots))
                slots[slot] = typeof initial === "function" ? initial() : initial;
              return [slots[slot], (next: unknown) => { slots[slot] = next; }];
            },
            useRef: (current: unknown) => ({ current }),
            useCallback: (callback: unknown) => callback,
            useEffect: () => {},
          };
        case "react/jsx-runtime": return { jsx, jsxs: jsx };
        case "../../../assets/tree_740934.png": return "tree_740934.png";
        case "@expo/vector-icons/Ionicons": return { __esModule: true, default: "Icon" };
        case "expo-router":
          return {
            router: { push: (route: unknown) => routes.push(route) },
            useFocusEffect: () => {},
            useLocalSearchParams: () => ({}),
          };
        case "react-native":
          return {
            ...Object.fromEntries(["View", "Text", "Pressable", "ScrollView", "Modal", "Image", "ActivityIndicator"].map((name) => [name, name])),
            StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
            Platform: { OS: "ios" },
            Animated: { Value: class {}, FlatList: "FlatList", event: () => () => {} },
            useWindowDimensions: () => ({ width: 375, height: 812, fontScale: 1 }),
          };
        case "react-native-safe-area-context": return { SafeAreaView: "SafeAreaView" };
        case "@/components/journeyUI": return { JourneyButton: "JourneyButton", phaseLabels: {
          planning: "Chuẩn bị trồng", germinating: "Đang ươm hạt", seedling: "Cây con", growing: "Đang phát triển", flowering: "Ra hoa", fruiting: "Có quả",
        } };
        case "@/data/seed": return { localDateKey };
        case "@/data/petProgression": return { PET_CAPACITY: 30 };
        case "@/utils/plantStreak": return { getCurrentPlantStreak };
        case "@/hooks/useControlFocus": return { useControlFocus: () => ({ props: () => ({}), style: () => ({}) }) };
        case "@/screens/garden/gardenFeedback": return {};
        case "@/screens/garden/GardenDots": return { GardenDots: "GardenDots" };
        case "@/screens/garden/gardenLayout": return { gardenViewportBudget };
        case "@/screens/garden/gardenNavigation": return gardenNavigation;
        case "@/store/journeyActions": return journeyActions;
        case "@/theme": return theme;
        case "@/store/AppStore":
          return { useApp: () => ({ ready: true, state, activePlant: state.plants.find((plant) => plant.id === state.activePlantId) }) };
        default: throw new Error(`Unexpected module: ${id}`);
      }
    },
  });
  const render = () => { cursor = 0; return nodes(exports.default()); };
  const byId = (tree: Node[], id: string) => {
    const result = tree.find((node) => node.props.testID === id);
    assert.ok(result, `Missing ${id}`);
    return result;
  };
  return { render, routes, byId };
}

test("active garden has one direct care action opening that plant's chat, without overflow or duplicate scan", () => {
  const state = createGardenFixture();
  const screen = garden(state);
  const tree = screen.render();
  const care = screen.byId(tree, "garden-plant-care");
  assert.equal(care.props.title, "Chăm sóc cây");
  (care.props.onPress as () => void)();
  assert.equal(JSON.stringify(screen.routes), JSON.stringify([{ pathname: "/plant-chat", params: { plantId: state.activePlantId } }]));
  assert.equal(tree.some((node) => node.props.name === "ellipsis-horizontal"), false);
  assert.equal(tree.some((node) => node.props.testID === "garden-daily-check"), false);
});

test("the empty garden uses the supplied tree PNG without cropping or stretching", () => {
  const state = createGardenFixture();
  state.plants = [];
  const screen = garden(state);
  const tree = screen.byId(screen.render(), "garden-empty-tree");
  assert.equal(tree.type, "Image");
  assert.equal(tree.props.source, "tree_740934.png");
  assert.equal(tree.props.resizeMode, "contain");
  assert.equal(tree.props.accessible, false);
  assert.equal((tree.props.style as Record<string, unknown>).width, (tree.props.style as Record<string, unknown>).height);
});

test("planning uses the same primary control slot and preserves the start-growing detail flow", () => {
  const state = createGardenFixture();
  state.plants[0].journey.phase = "planning";
  state.activePlantId = state.plants[0].id;
  const screen = garden(state);
  const action = screen.byId(screen.render(), "garden-plant-care");
  assert.equal(action.props.title, "Bắt đầu trồng");
  (action.props.onPress as () => void)();
  assert.equal(JSON.stringify(screen.routes), JSON.stringify([{ pathname: "/plant-detail", params: { plantId: state.activePlantId } }]));
});

test("an unopened pet reward does not displace the care action", () => {
  const state = createGardenFixture();
  state.dailyPacks = [{ id: "pending-pack" }] as AppState["dailyPacks"];
  const screen = garden(state);
  const tree = screen.render();
  screen.byId(tree, "garden-plant-care");
  const reward = screen.byId(tree, "garden-open-pack");
  assert.equal(reward.props.title, "Nhận quà");
  assert.notEqual(reward.props.secondary, true);
  assert.equal(screen.byId(tree, "garden-plant-care").props.secondary, true);
  const progressIndex = tree.findIndex((node) => node.props.accessibilityRole === "progressbar");
  assert.ok(progressIndex >= 0 && tree.indexOf(reward) > progressIndex);
  (reward.props.onPress as () => void)();
  assert.equal(JSON.stringify(screen.routes[0]), JSON.stringify({ pathname: "/reward-pack", params: { packId: "pending-pack" } }));
});

test("garden does not offer another gift before earning a pack or after opening it", () => {
  for (const packs of [[], [{ id: "opened-pack", revealedAt: new Date().toISOString() }]]) {
    const state = createGardenFixture();
    state.dailyPacks = packs as AppState["dailyPacks"];
    const screen = garden(state);
    assert.equal(screen.render().some(node => node.props.testID === "garden-open-pack"), false);
  }
});

test("an earned gift stays reachable even if all plants were subsequently archived", () => {
  const state = createGardenFixture();
  state.plants.forEach(plant => { plant.archived = true; });
  state.dailyPacks = [{ id: "earned-before-archive" }] as AppState["dailyPacks"];
  const screen = garden(state);
  const gift = screen.byId(screen.render(), "garden-open-pack");
  (gift.props.onPress as () => void)();
  assert.equal(JSON.stringify(screen.routes[0]), JSON.stringify({ pathname: "/reward-pack", params: { packId: "earned-before-archive" } }));
});

test("archives remain directly reachable in both a populated and an otherwise empty garden", () => {
  for (const allArchived of [false, true]) {
    const state = createGardenFixture();
    state.plants[0].archived = true;
    if (allArchived) state.plants.forEach((plant) => { plant.archived = true; });
    const screen = garden(state);
    let tree = screen.render();
    (screen.byId(tree, "garden-archived-plants").props.onPress as () => void)();
    tree = screen.render();
    assert.equal(tree.find((node) => node.type === "Modal")?.props.visible, true);
    assert.ok(tree.some((node) => node.props.title === "Khôi phục về vườn"));
  }
});

test("tapping a garden photo still opens the selected plant's stored profile", () => {
  const state = createGardenFixture();
  const screen = garden(state);
  const list = screen.render().find((node) => node.type === "FlatList");
  assert.ok(list);
  const item = state.plants[1];
  const photo = nodes((list.props.renderItem as (options: unknown) => unknown)({ item }))
    .find((node) => node.type === "Pressable");
  assert.ok(photo);
  (photo.props.onPress as () => void)();
  assert.equal(JSON.stringify(screen.routes), JSON.stringify([{ pathname: "/plant-detail", params: { plantId: item.id } }]));
});
