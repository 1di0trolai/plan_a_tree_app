/** Kiểm thử luồng quét chăm cây, xác nhận danh tính, lưu kết quả và hủy tác vụ an toàn khi rời máy ảnh. */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";
import { t } from "../src/i18n/core";

import { recordPlantInspection } from "../src/store/journeyActions";
import type { Analysis } from "../src/types/app";
import {
  confirmScanCandidate,
  resolveScanRecognition,
  type RecognitionResult,
} from "../src/utils/scanRecognition";
import { createGardenFixture } from "./fixtures/gardenFixture";

// Execute the actual route callbacks/effects without loading a native runtime.
// These checks cover orchestration and persistence, not camera hardware or pixels.
const compiled = ts.transpileModule(
  readFileSync(resolve(__dirname, "../src/app/(tabs)/camera.tsx"), "utf8"),
  {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
  },
).outputText;

type Node = { type: unknown; props: Record<string, unknown> };
type Hook = {
  value?: unknown;
  deps?: readonly unknown[];
  cleanup?: () => void;
};
type Effect = () => void | (() => void);
const analysis: Analysis = {
  level: "Chú ý",
  title: "Kiểm tra độ ẩm",
  summary: "Quan sát trực tiếp đất trước khi tưới.",
  actions: ["Chạm nhẹ vào lớp đất mặt."],
};
const sameDeps = (a?: readonly unknown[], b?: readonly unknown[]) =>
  !!a &&
  !!b &&
  a.length === b.length &&
  a.every((value, index) => Object.is(value, b[index]));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function cameraFlow(
  options: {
    recognition?: RecognitionResult;
    recognitionWait?: ReturnType<typeof deferred<RecognitionResult>>;
    failedWrites?: number;
  } = {},
) {
  let state = createGardenFixture();
  const hooks: Hook[] = [];
  let cursor = 0;
  let dirty = true;
  let tree: unknown;
  let effects: (() => void)[] = [];
  let focusEffect: Effect | undefined;
  let focusCleanup: (() => void) | undefined;
  let appListener: ((value: string) => void) | undefined;
  let timerId = 0;
  const timers = new Map<number, { callback: () => void; delay: number }>();
  const deleted: string[] = [];
  const routes: unknown[] = [];
  const recognitionCalls: { uri: string; signal: AbortSignal }[] = [];
  const analysisCalls: { uri: string; plantId: string }[] = [];
  let captures = 0;
  let saves = 0;
  let writes = 0;
  const nativeCamera = {
    takePictureAsync: async () => ({
      uri: `file:///camera/frame-${++captures}.jpg`,
    }),
  };
  const useState = <T>(initial: T | (() => T)) => {
    const index = cursor++;
    if (!hooks[index])
      hooks[index] = {
        value: typeof initial === "function" ? (initial as () => T)() : initial,
      };
    const set = (value: T | ((previous: T) => T)) => {
      const next =
        typeof value === "function"
          ? (value as (previous: T) => T)(hooks[index].value as T)
          : value;
      if (!Object.is(next, hooks[index].value)) {
        hooks[index].value = next;
        dirty = true;
      }
    };
    return [hooks[index].value as T, set] as const;
  };
  const useRef = <T>(initial: T) => {
    const index = cursor++;
    if (!hooks[index]) hooks[index] = { value: { current: initial } };
    return hooks[index].value as { current: T };
  };
  const useCallback = <T>(callback: T, deps: readonly unknown[]) => {
    const index = cursor++;
    if (!hooks[index] || !sameDeps(hooks[index].deps, deps))
      hooks[index] = { value: callback, deps };
    return hooks[index].value as T;
  };
  const useEffect = (effect: Effect, deps?: readonly unknown[]) => {
    const index = cursor++;
    const previous = hooks[index];
    if (!previous || !sameDeps(previous.deps, deps)) {
      hooks[index] = { ...previous, deps };
      effects.push(() => {
        previous?.cleanup?.();
        const cleanup = effect();
        hooks[index].cleanup =
          typeof cleanup === "function" ? cleanup : undefined;
      });
    }
  };
  const jsx = (type: unknown, props: Record<string, unknown>) => ({
    type,
    props,
  });
  class NativeFile {
    uri: string;
    constructor(uri: string) {
      this.uri = uri;
    }
    get exists() {
      return !deleted.includes(this.uri);
    }
    delete() {
      deleted.push(this.uri);
    }
  }
  class AiServiceError extends Error {}
  const exports = {} as { default: () => unknown };
  runInNewContext(compiled, {
    exports,
    AbortController,
    setTimeout: (callback: () => void, delay: number) => {
      const id = ++timerId;
      timers.set(id, { callback, delay });
      return id;
    },
    clearTimeout: (id: number) => timers.delete(id),
    require: (id: string) => {
      switch (id) {
        case "@/i18n": return { t, useI18n: () => ({ locale: "vi", t }) };
        case "react":
          return { useState, useRef, useCallback, useEffect };
        case "react/jsx-runtime":
          return { jsx, jsxs: jsx };
        case "@expo/vector-icons/Ionicons":
          return { __esModule: true, default: "Icon" };
        case "expo-camera":
          return {
            CameraView: "CameraView",
            useCameraPermissions: () => [
              { granted: true, canAskAgain: true },
              async () => ({ granted: true }),
            ],
          };
        case "expo-file-system":
          return { File: NativeFile };
        case "expo-linear-gradient":
          return { LinearGradient: "Gradient" };
        case "expo-status-bar":
          return { StatusBar: "StatusBar" };
        case "expo-router":
          return {
            router: {
              replace: (route: unknown) => routes.push(route),
              navigate: (route: unknown) => routes.push(route),
            },
            useFocusEffect: (callback: Effect) =>
              useEffect(() => {
                focusEffect = callback;
                const cleanup = callback();
                focusCleanup =
                  typeof cleanup === "function" ? cleanup : undefined;
                return () => focusCleanup?.();
              }, [callback]),
          };
        case "react-native":
          return {
            ActivityIndicator: "Spinner",
            Image: "Image",
            Pressable: "Pressable",
            ScrollView: "ScrollView",
            Text: "Text",
            View: "View",
            AppState: {
              currentState: "active",
              addEventListener: (
                _event: string,
                listener: (value: string) => void,
              ) => {
                appListener = listener;
                return { remove() {} };
              },
            },
            Linking: { openSettings: async () => {} },
            StyleSheet: { create: (value: unknown) => value, absoluteFill: {} },
          };
        case "react-native-safe-area-context":
          return { SafeAreaView: "SafeAreaView" };
        case "@/components/AiProgress":
          return { AiProgress: "AiProgress" };
        case "@/components/journeyUI":
          return { JourneyButton: "JourneyButton" };
        case "@/hooks/useControlFocus":
          return {
            useControlFocus: () => ({
              props: () => ({}),
              style: () => undefined,
            }),
          };
        case "@/services/plantAi":
          return {
            AiServiceError,
            recognizePhoto: async (
              uri: string,
              _plants: unknown,
              _photos: unknown,
              request: { signal: AbortSignal },
            ) => {
              recognitionCalls.push({ uri, signal: request.signal });
              return options.recognitionWait
                ? options.recognitionWait.promise
                : (options.recognition ?? {
                    decision: "candidate",
                    candidateIds: [state.plants[0].id],
                    explanation: "Cần xác nhận đúng cây.",
                  });
            },
            analyzePhoto: async (uri: string, plant: { id: string }) => {
              analysisCalls.push({ uri, plantId: plant.id });
              return { analysis };
            },
          };
        case "@/store/AppStore":
          return {
            useApp: () => ({
              state,
              ready: true,
              saveInspection: (
                input: Parameters<typeof recordPlantInspection>[1],
              ) => {
                saves++;
                const recorded = recordPlantInspection(state, input);
                state = recorded.state;
                dirty = true;
                return recorded.result;
              },
              persistNow: async () => {
                writes++;
                if (writes <= (options.failedWrites ?? 0))
                  throw new Error("SQLite đang bận.");
              },
            }),
          };
        case "@/theme":
          return {
            COLORS: {},
            INTERACTION: {},
            LAYOUT: { artwork: 120, touch: 48 },
            RADIUS: {},
            SPACING: {},
            TYPE: {},
          };
        case "@/utils/checkInPhotos":
          return {
            persistCheckInPhoto: async (uri: string) =>
              uri.replace("/camera/", "/documents/pat-photos/"),
            deleteCheckInPhoto: (uri: string) => deleted.push(uri),
          };
        case "@/utils/scanRecognition":
          return { confirmScanCandidate, resolveScanRecognition };
        default:
          throw new Error(`Unexpected route dependency: ${id}`);
      }
    },
  });
  function nodes(value = tree): Node[] {
    if (Array.isArray(value)) return value.flatMap((child) => nodes(child));
    if (!value || typeof value !== "object" || !("props" in value)) return [];
    const node = value as Node;
    return [
      node,
      ...(node.props.children === undefined ? [] : nodes(node.props.children)),
    ];
  }
  function flushSync() {
    let attempts = 0;
    while (dirty) {
      assert.ok(attempts++ < 40, "Route effects did not settle.");
      cursor = 0;
      dirty = false;
      effects = [];
      tree = exports.default();
      const nativeNode = nodes().find((node) => node.type === "CameraView");
      if (nativeNode)
        (nativeNode.props.ref as { current: unknown }).current = nativeCamera;
      const queued = effects;
      for (const effect of queued) effect();
    }
  }
  async function flush() {
    for (let turn = 0; turn < 24; turn++) {
      flushSync();
      await Promise.resolve();
    }
    flushSync();
  }
  function ready() {
    const node = nodes().find((entry) => entry.type === "CameraView");
    assert.ok(node, "Camera should be mounted on the focused route.");
    (node.props.onCameraReady as () => void)();
    flushSync();
  }
  function tickScan() {
    const entry = [...timers].find(([, timer]) => timer.delay === 1800);
    assert.ok(
      entry,
      "A deliberate scan round should arm one automatic capture.",
    );
    timers.delete(entry[0]);
    entry[1].callback();
  }
  function press(value: string) {
    const node = nodes().find(
      (entry) =>
        entry.props.title === value || entry.props.accessibilityLabel === value,
    );
    assert.ok(node, `Missing action: ${value}`);
    assert.notEqual(node.props.disabled, true);
    (node.props.onPress as () => void)();
    flushSync();
  }
  flushSync();
  ready();
  return {
    flush,
    tickScan,
    press,
    nodes,
    recognitionCalls,
    analysisCalls,
    routes,
    deleted,
    get state() {
      return state;
    },
    get captures() {
      return captures;
    },
    get saves() {
      return saves;
    },
    get writes() {
      return writes;
    },
    blur: () => {
      focusCleanup?.();
      flushSync();
    },
    refocus: () => {
      const cleanup = focusEffect?.();
      focusCleanup = typeof cleanup === "function" ? cleanup : undefined;
      flushSync();
      ready();
    },
    background: () => {
      appListener?.("background");
      flushSync();
    },
    cancel: () => {
      const progress = nodes().find((node) => node.type === "AiProgress");
      assert.ok(progress, "An in-flight scan should offer cancellation.");
      (progress.props.onCancel as () => void)();
      flushSync();
    },
  };
}

test("live care scan captures automatically, requires identity confirmation, then saves one observed photo and advice before opening chat", async () => {
  const flow = cameraFlow();
  const before = {
    photos: flow.state.plantPhotos.length,
    chats: flow.state.chatMessages.length,
  };
  flow.tickScan();
  await flow.flush();
  assert.equal(flow.captures, 1);
  assert.equal(flow.recognitionCalls.length, 1);
  assert.equal(flow.analysisCalls.length, 0);
  assert.equal(flow.saves, 0);
  assert.equal(flow.routes.length, 0);
  flow.press(`Đúng, ${flow.state.plants[0].name}`);
  await flow.flush();
  assert.equal(flow.analysisCalls[0].uri, flow.recognitionCalls[0].uri);
  assert.equal(flow.saves, 1);
  assert.equal(flow.writes, 1);
  assert.equal(flow.state.plantPhotos.length, before.photos + 1);
  assert.equal(flow.state.chatMessages.length, before.chats + 1);
  assert.equal(
    flow.state.chatMessages.at(-1)?.photoId,
    flow.state.plantPhotos[0].id,
  );
  assert.match(
    flow.state.chatMessages.at(-1)!.content,
    /Chạm nhẹ vào lớp đất mặt/,
  );
  assert.match(flow.state.plantPhotos[0].imageUri, /documents\/pat-photos/);
  assert.equal(
    JSON.stringify(flow.routes),
    JSON.stringify([
      { pathname: "/plant-chat", params: { plantId: flow.state.plants[0].id } },
    ]),
  );
});

test("unknown identification lets users pick an existing plant and a new scan analyzes care without identifying again", async () => {
  const flow = cameraFlow({
    recognition: {
      decision: "unknown",
      candidateIds: [],
      explanation: "Chưa tìm ra cây.",
    },
  });
  flow.tickScan();
  await flow.flush();
  assert.equal(flow.analysisCalls.length, 0);
  const plant = flow.state.plants[1];
  flow.press(`Quét kiểm tra ${plant.name}, ${plant.species}`);
  flow.tickScan();
  await flow.flush();
  assert.equal(flow.captures, 2);
  assert.equal(flow.recognitionCalls.length, 1);
  assert.equal(flow.analysisCalls.length, 1);
  assert.equal(flow.analysisCalls[0].plantId, plant.id);
  assert.match(flow.analysisCalls[0].uri, /frame-2/);
  assert.equal(flow.state.chatMessages.at(-1)?.plantId, plant.id);
  assert.ok(
    !flow
      .nodes()
      .some(
        (node) =>
          typeof node.props.title === "string" &&
          /Thêm cây/.test(node.props.title),
      ),
  );
});

test("retrying a failed durable write does not capture, call AI, append chat or award an inspection twice", async () => {
  const flow = cameraFlow({ failedWrites: 1 });
  flow.tickScan();
  await flow.flush();
  flow.press(`Đúng, ${flow.state.plants[0].name}`);
  await flow.flush();
  const saved = {
    photos: flow.state.plantPhotos.length,
    chats: flow.state.chatMessages.length,
    checks: flow.state.checkIns.length,
    rounds: JSON.stringify(flow.state.dailyRounds),
  };
  assert.equal(flow.routes.length, 0);
  flow.press("Thử lưu lại");
  await flow.flush();
  assert.equal(flow.captures, 1);
  assert.equal(flow.recognitionCalls.length, 1);
  assert.equal(flow.analysisCalls.length, 1);
  assert.equal(flow.saves, 1);
  assert.equal(flow.writes, 2);
  assert.equal(flow.state.plantPhotos.length, saved.photos);
  assert.equal(flow.state.chatMessages.length, saved.chats);
  assert.equal(flow.state.checkIns.length, saved.checks);
  assert.equal(JSON.stringify(flow.state.dailyRounds), saved.rounds);
  assert.equal(flow.routes.length, 1);
});

test("leaving the scanner aborts recognition and a late response cannot analyze, persist or navigate", async () => {
  const waiting = deferred<RecognitionResult>();
  const flow = cameraFlow({ recognitionWait: waiting });
  flow.tickScan();
  await flow.flush();
  assert.equal(flow.recognitionCalls.length, 1);
  flow.blur();
  assert.equal(flow.recognitionCalls[0].signal.aborted, true);
  waiting.resolve({
    decision: "candidate",
    candidateIds: [flow.state.plants[0].id],
    explanation: "Late response",
  });
  await flow.flush();
  assert.equal(flow.analysisCalls.length, 0);
  assert.equal(flow.saves, 0);
  assert.equal(flow.writes, 0);
  assert.equal(flow.routes.length, 0);
  assert.ok(flow.deleted.includes("file:///camera/frame-1.jpg"));
});

test("selecting a plant during a cancelled request re-arms its care scan after the previous request settles", async () => {
  const waiting = deferred<RecognitionResult>();
  const flow = cameraFlow({ recognitionWait: waiting });
  flow.tickScan();
  await flow.flush();
  flow.cancel();
  assert.equal(flow.recognitionCalls[0].signal.aborted, true);
  flow.press("Chọn cây trong vườn");
  const plant = flow.state.plants[1];
  flow.press(`Quét kiểm tra ${plant.name}, ${plant.species}`);
  // The old request has not settled yet; a second camera/API job must wait.
  flow.tickScan();
  await flow.flush();
  assert.equal(flow.captures, 1);
  waiting.resolve({
    decision: "unknown",
    candidateIds: [],
    explanation: "Late response",
  });
  await flow.flush();
  flow.tickScan();
  await flow.flush();
  assert.equal(flow.captures, 2);
  assert.equal(flow.recognitionCalls.length, 1);
  assert.equal(flow.analysisCalls.length, 1);
  assert.equal(flow.analysisCalls[0].plantId, plant.id);
});

test("backgrounding the app while its camera route is focused aborts the request and rejects late work", async () => {
  const waiting = deferred<RecognitionResult>();
  const flow = cameraFlow({ recognitionWait: waiting });
  flow.tickScan();
  await flow.flush();
  flow.background();
  assert.equal(flow.recognitionCalls[0].signal.aborted, true);
  waiting.resolve({
    decision: "candidate",
    candidateIds: [flow.state.plants[0].id],
    explanation: "Late response",
  });
  await flow.flush();
  assert.equal(flow.analysisCalls.length, 0);
  assert.equal(flow.saves, 0);
  assert.equal(flow.routes.length, 0);
  assert.ok(flow.deleted.includes("file:///camera/frame-1.jpg"));
});
