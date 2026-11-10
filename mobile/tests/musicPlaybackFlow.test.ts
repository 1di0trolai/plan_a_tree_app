/** Kiểm thử nhạc nền qua máy ảnh, hội thoại và nhận thưởng, gồm phục hồi gián đoạn và giới hạn thử phát lại. */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";

import { createInitialState } from "../src/data/seed";
import { advanceMusicLifecycle, startMusicPlaybackSession } from "../src/utils/musicLifecycle";
import { shouldPlayBackgroundMusic } from "../src/utils/profilePreferences";
import { viI18n } from "./fixtures/i18nFixture";

const compiled = ts.transpileModule(
  readFileSync(new URL("../src/components/PreferenceEffects.tsx", import.meta.url), "utf8"),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } },
).outputText;
type Node = { type: (props: Record<string, unknown>) => null; props: Record<string, unknown>; key?: number };
type Hook = { value?: unknown; deps?: unknown[]; effect?: () => void | (() => void); cleanup?: () => void };
type Scope = { hooks: Hook[]; cursor: number; effects: number[] };
const makeScope = (): Scope => ({ hooks: [], cursor: 0, effects: [] });
const flush = async () => { for (let turn = 0; turn < 12; turn++) await Promise.resolve(); };
const same = (left?: unknown[], right?: unknown[]) => !!left && !!right && left.length === right.length && left.every((value, index) => Object.is(value, right[index]));

/** Real coordinator and nested MusicPlayback, with only native audio/hooks mocked. */
function musicFlow(options: { muted?: boolean; delayedMode?: Promise<void>; ringer?: "normal" | "silent" | "vibrate" } = {}) {
  const state = createInitialState();
  state.auth.loggedIn = true;
  state.settings.music = !options.muted;
  state.settings.musicConsent = true;
  let path = "/garden";
  let foreground = "active";
  let suspended = false;
  let ready = true;
  let modeFailures = 0;
  let blocked = false;
  let modeCalls = 0;
  let activeCalls = 0;
  let playsInSilentMode = false;
  const writes: string[] = [];
  const errors: (string | null)[] = [];
  const listeners = new Set<(next: string) => void>();
  const parent = makeScope();
  let child: Scope | null = null;
  let childKey: number | undefined;
  let scope = parent;
  const players: { playing: boolean; isLoaded: boolean; isBuffering: boolean; error: string | null; loop: boolean; volume: number; currentTime: number; plays: number; pauses: number; play(): void; pause(): void }[] = [];
  const player = () => players.at(-1)!;
  const cleanup = (target: Scope) => { for (const hook of target.hooks) hook.cleanup?.(); };
  const effects = (target: Scope) => {
    for (const index of target.effects.splice(0)) {
      const hook = target.hooks[index];
      hook.cleanup?.();
      const result = hook.effect!();
      hook.cleanup = typeof result === "function" ? result : undefined;
    }
  };
  const exports = {} as { PreferenceEffects: () => Node | null };
  runInNewContext(compiled, {
    exports,
    setTimeout: (callback: () => void, delay: number) => setTimeout(callback, delay),
    clearTimeout: (id: ReturnType<typeof setTimeout>) => clearTimeout(id),
    require: (id: string) => {
      switch (id) {
        case "react": return {
          useRef: <T>(initial: T) => { const index = scope.cursor++; return (scope.hooks[index] ??= { value: { current: initial } }).value; },
          useReducer: (reducer: (value: unknown, event: unknown) => unknown, initial: unknown) => {
            const owner = scope; const index = owner.cursor++;
            owner.hooks[index] ??= { value: initial };
            return [owner.hooks[index].value, (event: unknown) => { owner.hooks[index].value = reducer(owner.hooks[index].value, event); }];
          },
          useCallback: (callback: unknown, deps: unknown[]) => {
            const index = scope.cursor++;
            if (!same(scope.hooks[index]?.deps, deps)) scope.hooks[index] = { deps, value: callback };
            return scope.hooks[index].value;
          },
          useEffect: (effect: Hook["effect"], deps: unknown[]) => {
            const index = scope.cursor++;
            if (!same(scope.hooks[index]?.deps, deps)) {
              scope.hooks[index] = { ...scope.hooks[index], deps, effect };
              scope.effects.push(index);
            }
          },
        };
        case "react/jsx-runtime": return { jsx: (type: Node["type"], props: Node["props"], key?: number) => ({ type, props, key }) };
        case "expo-router": return { usePathname: () => path };
        case "../i18n": return viI18n;
        case "react-native": return { AppState: {
          get currentState() { return foreground; },
          addEventListener: (_event: string, listener: (next: string) => void) => {
            listeners.add(listener); return { remove: () => listeners.delete(listener) };
          },
        } };
        case "expo-audio": return {
          useAudioPlayer: () => player(),
          useAudioPlayerStatus: () => ({ ...player() }),
          setAudioModeAsync: async (mode: { allowsRecording: boolean; shouldPlayInBackground: boolean; playsInSilentMode: boolean }) => {
            modeCalls++;
            assert.equal(mode.allowsRecording, false);
            assert.equal(mode.shouldPlayInBackground, false);
            if (options.delayedMode) await options.delayedMode;
            if (modeFailures > 0) { modeFailures--; throw new Error("Session interrupted"); }
            playsInSilentMode = mode.playsInSilentMode;
          },
          setIsAudioActiveAsync: async (active: boolean) => { assert.equal(active, true); activeCalls++; },
        };
        case "../services/preferences": return { installReminderPresentationHandler: () => undefined, syncDailyReminder: async () => ({ enabled: false }) };
        case "../data/backgroundMusic": return { BACKGROUND_MUSIC_SOURCE: 1 };
        case "../services/preferenceStatus": return { setPreferenceError: (kind: string, message: string | null) => { if (kind === "music") errors.push(message); } };
        case "../hooks/usePreferenceStatus": return { usePreferenceStatus: () => ({ effectsSuspended: suspended }) };
        case "../store/AppStore": return { useApp: () => ({ state, ready, updateSetting }) };
        case "../utils/profilePreferences": return { shouldPlayBackgroundMusic };
        case "../utils/musicLifecycle": return { advanceMusicLifecycle, startMusicPlaybackSession };
        case "../services/gardenReminderPlan": return { millisecondsUntilNextGardenDay: () => 86400000 };
        default: throw new Error(`Unexpected music dependency ${id}`);
      }
    },
  });
  function updateSetting(key: string) { writes.push(key); }
  const render = () => {
    scope = parent; parent.cursor = 0;
    const node = exports.PreferenceEffects();
    effects(parent);
    if (!node) {
      if (child) cleanup(child);
      child = null; childKey = undefined;
      return;
    }
    if (!child || childKey !== node.key) {
      if (child) cleanup(child);
      child = makeScope(); childKey = node.key;
      players.push({ playing: false, isLoaded: true, isBuffering: false, error: null, loop: false, volume: 1, currentTime: 0, plays: 0, pauses: 0,
        play() {
          this.plays++;
          // SDK 58 Android checks the ringer mode independently of media volume.
          if (!blocked && (playsInSilentMode || !options.ringer || options.ringer === "normal")) this.playing = true;
        },
        pause() { this.pauses++; this.playing = false; },
      });
    }
    scope = child; child.cursor = 0; node.type(node.props); effects(child);
  };
  render();
  return {
    state, players, player, errors, writes, render,
    path: (next: string) => { path = next; render(); },
    event: (next: string) => { foreground = next; for (const listener of listeners) listener(next); render(); },
    mute: () => { state.settings.music = false; render(); },
    suspend: () => { suspended = true; render(); },
    unready: () => { ready = false; render(); },
    failModes: (count: number) => { modeFailures = count; },
    block: (next: boolean) => { blocked = next; },
    get modeCalls() { return modeCalls; }, get activeCalls() { return activeCalls; },
    unmount: () => { if (child) cleanup(child); cleanup(parent); },
  };
}

test("music survives camera → plant chat → gift → card reveal → garden without restarting the track", async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const flow = musicFlow();
  await flush(); flow.render();
  assert.equal(flow.player().playing, true);
  assert.equal(flow.player().loop, true);
  flow.player().currentTime = 42;
  flow.path("/camera"); await flush();
  assert.equal(flow.player().playing, false);
  flow.path("/plant-chat"); await flush(); flow.render();
  assert.equal(flow.player().playing, true);
  // Native gift Modal keeps the same route/coordinator and does not pause audio.
  flow.render(); await flush(); assert.equal(flow.player().playing, true);
  flow.path("/reward-pack"); await flush(); flow.render();
  flow.path("/garden"); await flush(); flow.render();
  assert.equal(flow.player().playing, true);
  assert.equal(flow.player().currentTime, 42);
  assert.equal(flow.players.length, 1);
  assert.equal(flow.modeCalls, 4);
  assert.equal(flow.activeCalls, 4);
  assert.deepEqual(flow.writes, []);
  flow.unmount(); assert.equal(flow.player().playing, false);
});

test("enabled music plays in Android silent/vibrate mode without false playback errors", async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  for (const ringer of ["silent", "vibrate"] as const) {
    const flow = musicFlow({ ringer });
    await flush(); flow.render();
    for (let index = 0; index < 4; index++) {
      context.mock.timers.tick(1000); await flush(); flow.render();
    }
    assert.equal(flow.player().playing, true, ringer);
    assert.equal(flow.modeCalls, 1);
    assert.equal(flow.activeCalls, 1);
    assert.equal(flow.errors.some(Boolean), false);
    assert.deepEqual(flow.writes, []);
    flow.unmount();

    const muted = musicFlow({ muted: true, ringer });
    await flush();
    assert.equal(muted.players.length, 0);
    assert.equal(muted.modeCalls, 0);
    muted.unmount();
  }
});

test("native pause after camera teardown recovers, but persistent interruption has a bounded retry budget", async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const flow = musicFlow(); await flush(); flow.render();
  flow.path("/camera"); flow.path("/plant-chat"); await flush(); flow.render();
  flow.player().playing = false; flow.render();
  context.mock.timers.tick(750); await flush(); flow.render();
  assert.equal(flow.player().playing, true);
  assert.equal(flow.modeCalls, 3);
  flow.block(true); flow.player().playing = false; flow.render();
  context.mock.timers.tick(750); await flush(); flow.render();
  const calls = flow.modeCalls;
  for (let index = 0; index < 5; index++) { context.mock.timers.tick(1000); await flush(); flow.render(); }
  assert.equal(flow.modeCalls, calls);
  assert.equal(flow.state.settings.music, true);
  assert.deepEqual(flow.writes, []);
  assert.ok(flow.errors.some(Boolean));
  flow.unmount();
});

test("transient mode errors retry without silently disabling music", async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const flow = musicFlow(); await flush(); flow.render();
  flow.path("/camera"); flow.failModes(1); flow.path("/plant-chat");
  await flush(); context.mock.timers.tick(750); await flush(); flow.render();
  assert.equal(flow.player().playing, true);
  assert.equal(flow.state.settings.music, true);
  assert.deepEqual(flow.writes, []);
  flow.unmount();
});

test("inactive resumes the same player; actual background starts a fresh looping track at zero", async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const flow = musicFlow(); await flush(); flow.render(); flow.player().currentTime = 42;
  flow.event("inactive"); assert.equal(flow.player().playing, false);
  flow.event("active"); await flush(); flow.render();
  assert.equal(flow.players.length, 1); assert.equal(flow.player().currentTime, 42);
  flow.event("background"); flow.event("inactive"); flow.event("active"); await flush(); flow.render();
  assert.equal(flow.players.length, 2); assert.equal(flow.player().currentTime, 0);
  assert.equal(flow.player().loop, true); assert.equal(flow.player().playing, true);
  flow.unmount();
});

test("mute, logout, reset suspension and hydration cancel delayed resumes; muted app never starts audio", async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const muted = musicFlow({ muted: true }); await flush();
  assert.equal(muted.players.length, 0); assert.equal(muted.modeCalls, 0); muted.unmount();
  for (const action of ["mute", "logout", "suspend", "unready", "camera", "unmount"] as const) {
    let resolve!: () => void;
    const wait = new Promise<void>((done) => { resolve = done; });
    const flow = musicFlow({ delayedMode: wait });
    if (action === "logout") { flow.state.auth.loggedIn = false; flow.render(); }
    else if (action === "camera") flow.path("/camera");
    else flow[action]();
    resolve(); await flush(); context.mock.timers.tick(1000); await flush();
    assert.equal(flow.players[0].plays, 0, action);
    assert.equal(flow.activeCalls, 0, action);
    assert.deepEqual(flow.writes, []);
    flow.unmount();
  }
});
