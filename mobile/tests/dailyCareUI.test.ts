/** Kiểm thử ô ghi chú, thao tác chăm sóc nhanh, bản dịch và lưu việc đã làm mà không tự cộng lượt kiểm tra. */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { commitLocale, t } from "../src/i18n/core";
import { localDateKey } from "../src/data/seed";
import { addCareEvent } from "../src/store/journeyActions";
import type { CareEvent } from "../src/types/app";
import { createGardenFixture } from "./fixtures/gardenFixture";

type Node = { type: unknown; props: Record<string, unknown> };
type Action = { text: string; onPress?: () => unknown };
const compile = (file: string) => ts.transpileModule(readFileSync(new URL(file, import.meta.url), "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const tokens = {} as typeof import("../src/theme");
runInNewContext(compile("../src/theme.ts"), { exports: tokens, require: () => ({ Platform: { OS: "ios", Version: 26 } }) });
const compiled = compile("../src/screens/plant-chat/DailyCareComposer.tsx");

function care(failWrites = 0, disabled = false) {
  const state = createGardenFixture();
  const plant = state.plants[0];
  let tree: unknown, cursor = 0, writes = 0, recorded = 0;
  const hooks: unknown[] = [];
  const alerts: { title: string; message: string; actions: Action[] }[] = [];
  let styles: Record<string, Record<string, unknown>> = {};
  const jsx = (type: unknown, props: Record<string, unknown>) => ({ type, props });
  const exports = {} as { DailyCareComposer: (props: { plantId: string; disabled: boolean }) => Node };
  runInNewContext(compiled, { exports, require: (id: string) => {
    switch (id) {
      case "@/i18n": return { t, useI18n: () => ({ locale: "vi", t }) };
      case "react": return {
        useState: <T>(initial: T) => {
          const index = cursor++;
          if (!(index in hooks)) hooks[index] = initial;
          return [hooks[index], (value: T | ((previous: T) => T)) => {
            hooks[index] = typeof value === "function" ? (value as (previous: T) => T)(hooks[index] as T) : value;
          }];
        },
        useRef: <T>(initial: T) => { const index = cursor++; if (!(index in hooks)) hooks[index] = { current: initial }; return hooks[index]; },
      };
      case "react/jsx-runtime": return { jsx, jsxs: jsx };
      case "@expo/vector-icons/Ionicons": return { __esModule: true, default: "Icon" };
      case "react-native": return {
        ActivityIndicator: "ActivityIndicator", Pressable: "Pressable", ScrollView: "ScrollView", Text: "Text", TextInput: "TextInput", View: "View",
        Alert: { alert: (title: string, message: string, actions: Action[]) => alerts.push({ title, message, actions }) },
        StyleSheet: { create: (value: typeof styles) => { styles = value; return value; } },
      };
      case "@/components/journeyUI": return { JourneyButton: "JourneyButton", ui: {} };
      case "@/data/seed": return { localDateKey };
      case "@/hooks/useControlFocus": return { useControlFocus: () => ({ props: () => ({}), style: () => ({}) }) };
      case "@/theme": return tokens;
      case "@/store/AppStore": return { useApp: () => ({ state,
        recordCareEvent: (input: Omit<CareEvent, "id" | "createdAt">) => {
          recorded += 1;
          const result = addCareEvent(state, input);
          Object.assign(state, result.state);
          return result.event;
        },
        persistNow: async () => { writes += 1; if (writes <= failWrites) throw new Error("disk unavailable"); },
      }) };
      default: throw new Error(`Unexpected dependency: ${id}`);
    }
  } });
  const render = () => { cursor = 0; tree = exports.DailyCareComposer({ plantId: plant.id, disabled }); };
  const nodes = (value: unknown = tree): Node[] => {
    if (Array.isArray(value)) return value.flatMap(nodes);
    if (!value || typeof value !== "object" || !("props" in value)) return [];
    const children = (value as Node).props.children;
    return [value as Node, ...(children === undefined ? [] : nodes(children))];
  };
  const button = (label: string) => nodes().find((node) => (node.type === "JourneyButton" && node.props.title === label)
    || (node.type === "Pressable" && node.props.accessibilityLabel === label));
  const input = () => nodes().find((node) => node.type === "TextInput")!;
  const press = (label: string) => { const found = button(label); assert.ok(found, label); (found.props.onPress as () => void)(); render(); };
  const type = (note: string) => { (input().props.onChangeText as (value: string) => void)(note); render(); };
  const settle = async () => { await new Promise((done) => setImmediate(done)); render(); };
  render();
  return { state, plant, nodes, button, input, press, type, render, settle, alerts, styles, get counts() { return { writes, recorded }; } };
}

test("daily care is noticeable but starts compact; note save appears only with text inside its frame", () => {
  const screen = care();
  assert.ok(screen.button("Hôm nay đã làm gì?"));
  assert.equal(screen.nodes().some((node) => node.type === "TextInput"), false);
  assert.equal(screen.styles.header.minHeight, tokens.LAYOUT.touch);
  screen.press("Hôm nay đã làm gì?");
  assert.equal(screen.button("Lưu ghi chú"), undefined);
  screen.type(" \n\t "); assert.equal(screen.button("Lưu ghi chú"), undefined);
  screen.type("Đã lau lá");
  const composer = screen.nodes().find((node) => node.props.testID === "care-note-composer")!;
  assert.ok(screen.nodes(composer).includes(screen.button("Lưu ghi chú")!));
  assert.equal(screen.styles.careInput.textAlignVertical, "center");
  assert.equal(screen.styles.careInput.minWidth, 0);
  assert.equal(screen.styles.careSaveButton.width, tokens.LAYOUT.touch);
  assert.equal(screen.styles.careSaveButton.height, tokens.LAYOUT.touch);
  assert.equal(screen.input().props.maxLength, 1200);
  assert.equal(screen.input().props.allowFontScaling, undefined);
  screen.type(""); assert.equal(screen.button("Lưu ghi chú"), undefined);
  assert.deepEqual(screen.counts, { writes: 0, recorded: 0 });
});

test("English and Japanese daily-care controls never rewrite the user's note", async () => {
  try {
    for (const locale of ["en", "ja"] as const) {
      commitLocale(locale);
      const screen = care();
      const title = t("Hôm nay đã làm gì?");
      assert.notEqual(title, "Hôm nay đã làm gì?");
      screen.press(title);
      assert.ok(screen.button(t("Đã tưới")));
      screen.type("Đã lau lá — My plant メモ");
      screen.press(t("Lưu ghi chú"));
      await screen.settle();
      assert.equal(screen.state.careEvents[0].note, "Đã lau lá — My plant メモ");
      assert.ok(screen.nodes().some(node => node.props.children === t("Đã lưu vào nhật ký.")));
    }
  } finally { commitLocale("vi"); }
});

test("typed care uses the actual ledger without changing inspection streak, daily round, gold or card rewards", async () => {
  const screen = care();
  const unchanged = () => JSON.stringify({ plants: screen.state.plants, checkIns: screen.state.checkIns, photos: screen.state.plantPhotos,
    analyses: screen.state.plantAnalyses, rounds: screen.state.dailyRounds, packs: screen.state.dailyPacks,
    economy: screen.state.economy, inventory: screen.state.inventory });
  const before = unchanged();
  screen.press("Hôm nay đã làm gì?"); screen.type("  Đã lau lá và buộc lại cành  ");
  const save = screen.button("Lưu ghi chú")!;
  (save.props.onPress as () => void)(); (save.props.onPress as () => void)();
  await screen.settle();
  assert.deepEqual(screen.counts, { writes: 1, recorded: 1 });
  assert.equal(screen.state.careEvents[0].plantId, screen.plant.id);
  assert.equal(screen.state.careEvents[0].kind, "other");
  assert.equal(screen.state.careEvents[0].note, "Đã lau lá và buộc lại cành");
  assert.equal(screen.input().props.value, "");
  assert.equal(screen.button("Lưu ghi chú"), undefined);
  assert.equal(unchanged(), before);
  assert.ok(screen.nodes().some((node) => node.props.accessibilityLabel === "1 ghi chép hôm nay"));
});

test("failed note persistence retains text and retries the same ledger event without duplication", async () => {
  const screen = care(1);
  screen.press("Hôm nay đã làm gì?"); screen.type("Đã đổi vị trí chậu"); screen.press("Lưu ghi chú");
  await screen.settle();
  assert.equal(screen.input().props.value, "Đã đổi vị trí chậu");
  assert.equal(screen.input().props.editable, false);
  assert.equal(screen.button("Đã tưới")!.props.disabled, true);
  assert.deepEqual(screen.counts, { writes: 1, recorded: 1 });
  screen.press("Thử lưu ghi chú"); await screen.settle();
  assert.deepEqual(screen.counts, { writes: 2, recorded: 1 });
  assert.equal(screen.input().props.value, "");
});

test("quick care confirms a real action; persistence failure retries without converting it to a custom event", async () => {
  const screen = care(1);
  screen.press("Hôm nay đã làm gì?"); screen.press("Đã tưới");
  assert.deepEqual(screen.counts, { writes: 0, recorded: 0 });
  assert.match(screen.alerts[0].message, /Không cần tưới hoặc bón phân mỗi ngày/);
  screen.alerts[0].actions.find((action) => action.text === "Đã thực hiện")!.onPress!(); await screen.settle();
  assert.equal(screen.state.careEvents[0].kind, "water");
  assert.equal(screen.state.careEvents[0].note, "Đã tưới");
  assert.ok(screen.button("Thử lưu ghi chú"));
  screen.press("Thử lưu ghi chú"); await screen.settle();
  assert.deepEqual(screen.counts, { writes: 2, recorded: 1 });
  assert.equal(screen.state.careEvents[0].kind, "water");
});

test("busy assistant prevents new care writes and irrelevant dates do not inflate today's badge", async () => {
  const screen = care(0, true);
  screen.state.careEvents.push({ id: "invalid", plantId: screen.plant.id, kind: "other", note: "old", createdAt: "invalid" });
  screen.render(); screen.press("Hôm nay đã làm gì?");
  assert.equal(screen.button("Đã tưới")!.props.disabled, true);
  screen.type("Không được ghi khi đang gửi"); screen.press("Lưu ghi chú"); await screen.settle();
  assert.deepEqual(screen.counts, { writes: 0, recorded: 0 });
});
