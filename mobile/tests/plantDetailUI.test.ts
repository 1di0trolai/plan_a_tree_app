/** Kiểm thử hồ sơ cây gọn, nhật ký thực tế, ảnh phân trang và xác nhận lưu trữ cây. */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";
import { t } from "../src/i18n/core";
import { createGardenFixture } from "./fixtures/gardenFixture";
import * as history from "../src/screens/plant-detail/history";
import { getCurrentPlantStreak } from "../src/utils/plantStreak";

const compile = (file: string) => ts.transpileModule(readFileSync(new URL(file, import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const compiled = compile("../src/app/plant-detail.tsx");
type Node = { type: unknown; props: Record<string, unknown> };
type Action = { text: string; onPress?: () => unknown };
type Result = { ok: boolean; message: string };
const ok: Result = { ok: true, message: "Đã lưu" };
const tokens = {} as typeof import("../src/theme");
runInNewContext(compile("../src/theme.ts"), { exports: tokens, require: () => ({ Platform: { OS: "ios", Version: 26 } }) });

function detail(options: { archived?: boolean; archiveResult?: Result; failedWrite?: boolean; manyRecords?: boolean; width?: number; fontScale?: number } = {}) {
  const state = createGardenFixture();
  const plant = state.plants[0];
  plant.archived = !!options.archived;
  let tree: unknown;
  let cursor = 0;
  const hooks: unknown[] = [];
  const routes: unknown[] = [];
  const alerts: { title: string; message: string; actions: Action[] }[] = [];
  let archives = 0, restores = 0, writes = 0;
  let styles: Record<string, Record<string, unknown>> = {};
  if (options.manyRecords) state.plantPhotos = Array.from({ length: 25 }, (_, index) => ({
    ...state.plantPhotos[0], id: `history-${index}`, date: `2026-10-${String(index + 1).padStart(2, "0")}`,
  }));
  const jsx = (type: unknown, props: Record<string, unknown>) => ({ type, props });
  const exports = {} as { default: () => Node };
  runInNewContext(compiled, { exports, require: (id: string) => {
    switch (id) {
      case "@/i18n": return { t, useI18n: () => ({ locale: "vi", t }) };
      case "@/utils/plantStreak": return { getCurrentPlantStreak };
      case "react": return { useState: <T>(initial: T) => {
        const index = cursor++;
        if (!(index in hooks)) hooks[index] = initial;
        return [hooks[index], (value: T | ((previous: T) => T)) => {
          hooks[index] = typeof value === "function" ? (value as (previous: T) => T)(hooks[index] as T) : value;
        }];
      } };
      case "react/jsx-runtime": return { jsx, jsxs: jsx };
      case "expo-router": return { useLocalSearchParams: () => ({ plantId: plant.id }),
        router: { push: (route: unknown) => routes.push(route), replace: (route: unknown) => routes.push(route) } };
      case "@expo/vector-icons/Ionicons": return { __esModule: true, default: "Icon" };
      case "react-native-safe-area-context": return { SafeAreaView: "SafeAreaView" };
      case "react-native": return {
        Alert: { alert: (title: string, message: string, actions: Action[] = []) => alerts.push({ title, message, actions }) },
        Image: "Image", Modal: "Modal", Pressable: "Pressable", ScrollView: "ScrollView", Text: "Text", View: "View",
        useWindowDimensions: () => ({ width: options.width ?? 375, height: 812, fontScale: options.fontScale ?? 1 }),
        StyleSheet: { create: (value: typeof styles) => { styles = value; return value; }, hairlineWidth: 1 },
      };
      case "@/components/journeyUI": return {
        JourneyButton: "JourneyButton", JourneyChoices: "JourneyChoices", JourneyField: "JourneyField", JourneyHeader: "JourneyHeader",
        phaseLabels: { planning: "Chuẩn bị trồng", seedling: "Cây con", growing: "Đang phát triển" }, ui: {},
      };
      case "@/hooks/useControlFocus": return { useControlFocus: () => ({ style: () => ({}), props: () => ({}) }) };
      case "@/theme": return tokens;
      case "@/screens/plant-detail/history": return history;
      case "@/store/AppStore": return { useApp: () => ({ state, updateJourney: () => ok,
        removePlant: () => { archives += 1; return options.archiveResult ?? ok; },
        restorePlant: () => { restores += 1; return ok; },
        persistNow: async () => { writes += 1; if (options.failedWrite) throw new Error("disk unavailable"); },
      }) };
      default: throw new Error(`Unexpected dependency: ${id}`);
    }
  } });
  const render = () => { cursor = 0; const route = exports.default(); tree = typeof route.type === "function" ? route.type(route.props) : route; };
  const nodes = (value: unknown = tree): Node[] => {
    if (Array.isArray(value)) return value.flatMap(nodes);
    if (!value || typeof value !== "object" || !("props" in value)) return [];
    const node = value as Node;
    return [node, ...(node.props.children === undefined ? [] : nodes(node.props.children))];
  };
  const button = (title: string) => nodes().find((node) => node.type === "JourneyButton" && node.props.title === title);
  const expand = (title: string) => {
    const header = nodes().find((node) => node.type === "Pressable" && nodes(node).some((child) => child.props.children === title));
    assert.ok(header); (header.props.onPress as () => void)(); render();
  };
  render();
  return { button, nodes, expand, render, alerts, routes, plant, state, styles, get counts() { return { archives, restores, writes }; } };
}

test("detail is a concise profile and archive, with daily care moved into the conversation", () => {
  const screen = detail();
  assert.ok(screen.button("Ẩn cây khỏi vườn"));
  assert.equal(screen.button("Hỏi trợ lý về cây"), undefined);
  assert.equal(screen.button("Quét để kiểm tra cây"), undefined);
  assert.equal(screen.nodes().some((node) => node.props.children === "Ghi việc đã làm"), false);
  for (const title of ["Giai đoạn", "Điều kiện trồng", "Nhật ký chăm cây", "Ảnh của cây"]) {
    screen.expand(title);
    const copy = screen.nodes().filter((node) => node.type === "Text").map((node) => node.props.children).join(" ");
    assert.doesNotMatch(copy, /Chọn đúng tình trạng|Chăm sóc cây ngoài đời thực|Mới nhất ở trên|Chạm ảnh|không thêm ảnh tại đây|Không xóa cây\./);
  }
});

test("compact disclosures and photo columns adapt without disabling text scaling", () => {
  for (const [width, fontScale] of [[375, 1], [320, 1.8], [375, 2.5]]) {
    const screen = detail({ width, fontScale, manyRecords: true });
    assert.equal(screen.styles.foldHeader.minHeight, tokens.LAYOUT.touch);
    assert.equal(screen.styles.foldHeader.paddingVertical, tokens.SPACING.sm);
    assert.equal(screen.styles.fold.marginBottom, tokens.SPACING.sm);
    assert.equal(screen.styles.foldContent.paddingBottom, tokens.SPACING.compact);
    screen.expand("Ảnh của cây");
    const rows = screen.nodes().filter((node) => node.type === "View" && node.props.style === screen.styles.photoRow);
    assert.equal(rows.length, width < 360 || fontScale >= 1.3 ? 6 : 3);
    assert.equal(screen.nodes().some((node) => node.props.allowFontScaling === false), false);
  }
});

test("visible diary excludes suggestions while retaining analysis and conversation data intact", () => {
  const screen = detail();
  const analyses = JSON.stringify(screen.state.plantAnalyses);
  const messages = JSON.stringify(screen.state.chatMessages);
  screen.state.careEvents.push({ id: "actual", plantId: screen.plant.id, kind: "other", note: "Đã lau lá ngoài đời", createdAt: "2026-11-04T02:00:00Z" });
  screen.render(); screen.expand("Nhật ký chăm cây");
  const copy = screen.nodes().filter((node) => node.type === "Text").map((node) => node.props.children).join(" ");
  assert.match(copy, /Đã lau lá ngoài đời/);
  assert.doesNotMatch(copy, /Đất đang hơi khô|phân tích|AI Gemini|Demo/);
  assert.equal(JSON.stringify(screen.state.plantAnalyses), analyses);
  assert.equal(JSON.stringify(screen.state.chatMessages), messages);
  assert.equal(screen.nodes().filter((node) => node.type === "Image").length, 0);
});

test("photos remain read-only, paginated and closeable, without analysis prose", () => {
  const screen = detail({ manyRecords: true });
  screen.expand("Ảnh của cây");
  assert.equal(screen.button("Chụp ảnh"), undefined);
  assert.equal(screen.button("Chọn ảnh"), undefined);
  assert.equal(screen.nodes().filter((node) => node.type === "Image").length, 6);
  const next = () => screen.nodes().find((node) => node.props.testID === "photos-next")!;
  for (let index = 0; index < 4; index += 1) {
    assert.equal(next().props.disabled, false); (next().props.onPress as () => void)(); screen.render();
  }
  assert.equal(screen.nodes().filter((node) => node.type === "Image").length, 1);
  assert.equal(next().props.disabled, true);
  const photo = screen.nodes().find((node) => node.type === "Pressable" && String(node.props.accessibilityLabel).startsWith("Xem ảnh"))!;
  (photo.props.onPress as () => void)(); screen.render();
  assert.equal(screen.nodes().find((node) => node.type === "Modal")!.props.visible, true);
  assert.equal(screen.button("Chụp ảnh"), undefined);
  (screen.button("Đóng ảnh")!.props.onPress as () => void)(); screen.render();
  assert.equal(screen.nodes().find((node) => node.type === "Modal")!.props.visible, false);
});

test("archive requires confirmation, persists once and returns with a transient notice", async () => {
  const screen = detail();
  (screen.button("Ẩn cây khỏi vườn")!.props.onPress as () => void)();
  assert.deepEqual(screen.counts, { archives: 0, restores: 0, writes: 0 });
  assert.equal(screen.alerts[0].actions[0].text, "Giữ trong vườn");
  await screen.alerts[0].actions.find((action) => action.text === "Ẩn cây")!.onPress!();
  assert.deepEqual(screen.counts, { archives: 1, restores: 0, writes: 1 });
  assert.equal(JSON.stringify(screen.routes), JSON.stringify([{ pathname: "/(tabs)/garden", params: { gardenNotice: `Đã ẩn ${screen.plant.name} khỏi vườn.` } }]));
});

test("roster guard rejection does not write or navigate", async () => {
  const screen = detail({ archiveResult: { ok: false, message: "Hãy kiểm tra cây trong nhiệm vụ hôm nay trước." } });
  (screen.button("Ẩn cây khỏi vườn")!.props.onPress as () => void)();
  await screen.alerts[0].actions.find((action) => action.text === "Ẩn cây")!.onPress!();
  assert.equal(screen.alerts[1].title, "Chưa thể lưu trữ");
  assert.equal(screen.counts.writes, 0); assert.equal(screen.routes.length, 0);
});

test("failed archive persistence offers retry without leaving prematurely", async () => {
  const screen = detail({ failedWrite: true });
  (screen.button("Ẩn cây khỏi vườn")!.props.onPress as () => void)();
  await screen.alerts[0].actions.find((action) => action.text === "Ẩn cây")!.onPress!();
  assert.equal(screen.alerts[1].title, "Chưa lưu xuống máy");
  assert.ok(screen.alerts[1].actions.some((action) => action.text === "Thử lưu lại"));
  assert.equal(screen.routes.length, 0);
});

test("archived profile has direct restore and read-only history", async () => {
  const screen = detail({ archived: true });
  assert.equal(screen.button("Ẩn cây khỏi vườn"), undefined);
  assert.equal(screen.nodes().some((node) => node.props.children === "Ghi việc đã làm"), false);
  screen.expand("Ảnh của cây");
  assert.equal(screen.nodes().filter((node) => node.type === "Image").length, 1);
  (screen.button("Khôi phục về vườn")!.props.onPress as () => void)();
  await new Promise((done) => setImmediate(done));
  assert.deepEqual(screen.counts, { archives: 0, restores: 1, writes: 1 });
  assert.equal(screen.routes.length, 1);
});
