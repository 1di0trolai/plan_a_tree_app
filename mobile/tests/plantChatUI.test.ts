/** Kiểm thử hội thoại chăm cây, tránh bàn phím, hiển thị tiến độ, thử lại và bỏ kết quả đã hết hiệu lực. */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";
import { t } from "../src/i18n/core";
import { AiServiceError, type AiRequestOptions } from "../src/services/aiRequestLifecycle";
import { CHAT_CONTEXT_LIMITS } from "../src/services/plantAiContracts";
import type { PlantChatMessage } from "../src/types/app";
import { createGardenFixture } from "./fixtures/gardenFixture";

// Run the real route callbacks with stable hooks; native keyboard/layout are not simulated.
const compiled = ts.transpileModule(
  readFileSync(new URL("../src/app/plant-chat.tsx", import.meta.url), "utf8"),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } },
).outputText;
type Node = { type: unknown; props: Record<string, unknown> };
type Hook = { value?: unknown; set?: (value: unknown) => void; deps?: readonly unknown[]; cleanup?: () => void };
const sameDeps = (a?: readonly unknown[], b?: readonly unknown[]) => !!a && !!b && a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function chat(archived = false, platform = "ios") {
  const state = createGardenFixture();
  const plant = state.plants[0];
  plant.archived = archived;
  state.chatMessages = [];
  let tree: unknown;
  let cursor = 0;
  let dirty = true;
  let focusCleanup: (() => void) | undefined;
  const hooks: Hook[] = [];
  let effects: (() => void)[] = [];
  const requests: { args: unknown[]; options: AiRequestOptions; response: ReturnType<typeof deferred<{ content: string }>> }[] = [];
  const appended: PlantChatMessage[] = [];
  const useState = <T>(initial: T) => {
    const index = cursor++;
    if (!hooks[index]) {
      hooks[index] = { value: initial, set: (value) => {
        const next = typeof value === "function" ? value(hooks[index].value) : value;
        if (!Object.is(next, hooks[index].value)) { hooks[index].value = next; dirty = true; }
      } };
    }
    return [hooks[index].value, hooks[index].set] as const;
  };
  const useRef = <T>(initial: T) => {
    const index = cursor++;
    if (!hooks[index]) hooks[index] = { value: { current: initial } };
    return hooks[index].value;
  };
  const useCallback = <T>(callback: T, deps: readonly unknown[]) => {
    const index = cursor++;
    if (!hooks[index] || !sameDeps(hooks[index].deps, deps)) hooks[index] = { value: callback, deps };
    return hooks[index].value;
  };
  const useFocusEffect = (callback: () => void | (() => void)) => {
    const index = cursor++;
    if (!hooks[index] || hooks[index].value !== callback) {
      const prior = hooks[index];
      hooks[index] = { value: callback };
      effects.push(() => {
        prior?.cleanup?.();
        const cleanup = callback();
        focusCleanup = typeof cleanup === "function" ? cleanup : undefined;
        hooks[index].cleanup = focusCleanup;
      });
    }
  };
  const jsx = (type: unknown, props: Record<string, unknown>) => ({ type, props });
  const exports = {} as { default: () => Node };
  runInNewContext(compiled, {
    exports, AbortController, Error,
    require: (id: string) => {
      switch (id) {
        case "@/i18n": return { t, useI18n: () => ({ locale: "vi", t }) };
        case "react": return { useState, useRef, useCallback };
        case "react/jsx-runtime": return { jsx, jsxs: jsx };
        case "expo-router": return { useLocalSearchParams: () => ({ plantId: plant.id }), useFocusEffect };
        case "react-native-safe-area-context": return { SafeAreaView: "SafeAreaView" };
        case "react-native": return {
          Image: "Image", KeyboardAvoidingView: "KeyboardAvoidingView", ScrollView: "ScrollView", Text: "Text", TextInput: "TextInput", View: "View",
          Platform: { OS: platform }, StyleSheet: { create: (styles: unknown) => styles },
        };
        case "@/components/AiProgress": return { AiProgress: "AiProgress" };
        case "@/screens/plant-chat/DailyCareComposer": return { DailyCareComposer: "DailyCareComposer" };
        case "@/components/journeyUI": return {
          JourneyButton: "JourneyButton", JourneyDisclosure: "JourneyDisclosure", JourneyHeader: "JourneyHeader",
          phaseLabels: { seedling: "Cây con", growing: "Đang phát triển" }, ui: {},
        };
        case "@/hooks/useControlFocus": return { useControlFocus: () => ({ style: () => ({}), props: () => ({}) }) };
        case "@/theme": return { COLORS: {}, GRADIENTS: {}, INPUT: { multiline: {} }, LAYOUT: {}, RADIUS: {}, SPACING: {}, TYPE: {} };
        case "@/services/plantAi": return {
          AiServiceError,
          isAiConfigured: () => true,
          createDemoChatReply: () => "Hướng dẫn mẫu, không dùng AI.",
          chatWithPlant: (...args: unknown[]) => {
            const response = deferred<{ content: string }>();
            requests.push({ args, options: args[6] as AiRequestOptions, response });
            return response.promise;
          },
        };
        case "@/services/plantAiContracts": return { CHAT_CONTEXT_LIMITS };
        case "@/store/AppStore": return { useApp: () => ({ state, appendChatMessage: (input: Omit<PlantChatMessage, "id" | "createdAt">) => {
          const message: PlantChatMessage = { ...input, id: `message-${appended.length + 1}`, createdAt: "2026-10-29T05:00:00Z" };
          appended.push(message);
          state.chatMessages = [...state.chatMessages, message];
          dirty = true;
          return message;
        } }) };
        default: throw new Error(`Unexpected dependency: ${id}`);
      }
    },
  });
  const render = () => {
    let attempts = 0;
    do {
      dirty = false; cursor = 0;
      const route = exports.default();
      tree = typeof route.type === "function" ? route.type(route.props) : route;
      const queued = effects; effects = []; queued.forEach((effect) => effect());
      assert.ok(++attempts < 10, "hooks should stabilize");
    } while (dirty);
  };
  const nodes = (value: unknown = tree): Node[] => {
    if (Array.isArray(value)) return value.flatMap((child) => nodes(child));
    if (!value || typeof value !== "object" || !("props" in value)) return [];
    const node = value as Node;
    return [node, ...(node.props.children === undefined ? [] : nodes(node.props.children))];
  };
  const textContent = (value: unknown = tree): string => {
    if (typeof value === "string" || typeof value === "number") return String(value);
    if (Array.isArray(value)) return value.map((child) => textContent(child)).join("");
    if (!value || typeof value !== "object" || !("props" in value)) return "";
    const node = value as Node;
    return node.props.children === undefined ? "" : textContent(node.props.children);
  };
  const button = (title: string) => nodes().find((node) => node.type === "JourneyButton" && node.props.title === title);
  const press = (title: string) => { const node = button(title); assert.ok(node, `missing button ${title}`); (node.props.onPress as () => void)(); render(); };
  const progress = () => nodes().find((node) => node.type === "AiProgress");
  const settle = async () => { await new Promise((done) => setImmediate(done)); render(); };
  const send = (question = "Cây hôm nay cần chăm sóc gì?") => {
    const input = nodes().find((node) => node.type === "TextInput"); assert.ok(input);
    (input.props.onChangeText as (value: string) => void)(question); render(); press("Gửi");
  };
  render();
  return { state, plant, requests, appended, nodes, textContent, progress, send, press, settle, render, blur: () => focusCleanup?.() };
}

test("chat explicitly avoids the keyboard on Android and iOS and keeps input outside the shrinking message list", () => {
  for (const [platform, behavior, dismissal] of [["android", "height", "on-drag"], ["ios", "padding", "interactive"]]) {
    const screen = chat(false, platform);
    const avoiding = screen.nodes().find(node => node.type === "KeyboardAvoidingView");
    const list = screen.nodes().find(node => node.type === "ScrollView");
    assert.equal(avoiding?.props.behavior, behavior);
    assert.equal(list?.props.keyboardDismissMode, dismissal);
    assert.equal(list?.props.keyboardShouldPersistTaps, "handled");
    assert.equal(typeof list?.props.onLayout, "function");
    const directChildren = avoiding?.props.children as Node[];
    assert.equal(directChildren[0], list);
    const composer = directChildren[1];
    assert.equal(composer.type, "View");
    assert.equal((composer.props.style as { flexShrink: number }).flexShrink, 0);
    assert.ok((composer.props.children as Node[]).some(node => node.type === "TextInput"));
  }
});

test("chat shows photo preparation then provider request progress, with only this plant's context", async () => {
  const screen = chat();
  screen.send();
  assert.equal(screen.progress()!.props.message, "Đang chuẩn bị nhật ký và ảnh của cây…");
  assert.equal(screen.appended.filter((message) => message.role === "user").length, 1);
  const request = screen.requests[0];
  assert.equal(request.args[0], screen.plant);
  for (const records of request.args.slice(1, 4)) assert.ok((records as { plantId: string }[]).every((record) => record.plantId === screen.plant.id));
  request.options.onProgress!("requesting"); screen.render();
  assert.equal(screen.progress()!.props.message, "Đã gửi yêu cầu · Đang chờ Gemini trả lời…");
  request.response.resolve({ content: "Hãy kiểm tra độ ẩm đất trước khi tưới." }); await screen.settle();
  assert.equal(screen.progress(), undefined);
  assert.equal(screen.appended.at(-1)!.role, "assistant");
  assert.equal(screen.appended.at(-1)!.content, "Hãy kiểm tra độ ẩm đất trước khi tưới.");
});

test("AiServiceError shows its actionable safe code and retry does not duplicate the question", async () => {
  const screen = chat();
  screen.send("Tôi có nên tưới thêm không?");
  screen.requests[0].response.reject(new AiServiceError("NETWORK", "Không kết nối được backend. Kiểm tra mạng và thử lại.")); await screen.settle();
  const alert = screen.nodes().find((node) => node.props.accessibilityRole === "alert");
  assert.equal(alert!.props.children, "Không kết nối được backend. Kiểm tra mạng và thử lại.\nMã lỗi: NETWORK");
  screen.press("Thử gửi lại cho Gemini");
  assert.equal(screen.requests.length, 2);
  assert.equal(screen.requests[1].args[5], "Tôi có nên tưới thêm không?");
  assert.equal(screen.requests[1].args[4], screen.requests[0].args[4], "retry uses the original bounded conversation snapshot");
  assert.equal(screen.appended.filter((message) => message.role === "user").length, 1);
  screen.requests[1].response.resolve({ content: "Kiểm tra đất trước, chưa tưới theo lịch cứng." }); await screen.settle();
  assert.equal(screen.appended.length, 2);
});

test("cancel aborts the pending request and ignores stale progress/results across retry", async () => {
  const screen = chat(); screen.send();
  const first = screen.requests[0];
  (screen.progress()!.props.onCancel as () => void)(); screen.render();
  assert.equal(first.options.signal!.aborted, true);
  assert.equal(screen.progress(), undefined);
  assert.match(screen.textContent(), /Đã hủy yêu cầu/);
  screen.press("Thử gửi lại cho Gemini");
  const second = screen.requests[1];
  second.options.onProgress!("requesting"); first.options.onProgress!("preparing"); screen.render();
  assert.equal(screen.progress()!.props.message, "Đã gửi yêu cầu · Đang chờ Gemini trả lời…");
  first.response.resolve({ content: "Kết quả cũ không được lưu." }); await screen.settle();
  assert.equal(screen.appended.filter((message) => message.role === "assistant").length, 0);
  assert.ok(screen.progress());
  second.response.resolve({ content: "Kết quả hiện tại." }); await screen.settle();
  assert.equal(screen.appended.filter((message) => message.role === "user").length, 1);
  assert.equal(screen.appended.filter((message) => message.role === "assistant").length, 1);
  assert.equal(screen.appended.at(-1)!.content, "Kết quả hiện tại.");
});

test("leaving chat aborts the request and cannot append a late assistant reply", async () => {
  const screen = chat(); screen.send();
  const request = screen.requests[0]; screen.blur();
  assert.equal(request.options.signal!.aborted, true);
  request.response.resolve({ content: "Không được lưu sau khi rời màn hình." }); await screen.settle();
  assert.equal(screen.appended.length, 1);
  assert.equal(screen.appended[0].role, "user");
});

test("context disclosure describes bounded current-stage photos, analyses, care journal and conversation", () => {
  const screen = chat();
  const disclosure = screen.nodes().find((node) => node.type === "JourneyDisclosure"); assert.ok(disclosure);
  const copy = screen.textContent(disclosure);
  assert.ok(copy.includes(`tối đa ${CHAT_CONTEXT_LIMITS.photos} ảnh gần nhất đúng giai đoạn`));
  assert.ok(copy.includes(`${CHAT_CONTEXT_LIMITS.analyses} bản phân tích, ${CHAT_CONTEXT_LIMITS.careEvents} việc chăm sóc và ${CHAT_CONTEXT_LIMITS.messages} tin nhắn gần nhất`));
  assert.doesNotMatch(copy, /\{(?:photos|analyses|events|messages)\}/);
  assert.match(copy, /Trợ lý không tự đọc toàn bộ thư viện ảnh/);
  assert.match(copy, /Ảnh không đọc được sẽ được bỏ qua/);
  assert.match(copy, /Gợi ý chỉ để tham khảo/);
});

test("archived chat remains readable but has no editable composer", () => {
  const screen = chat(true);
  assert.equal(screen.nodes().some((node) => node.type === "TextInput"), false);
  assert.match(screen.textContent(), /Hồ sơ đã lưu trữ/);
  assert.equal(screen.requests.length, 0);
});
