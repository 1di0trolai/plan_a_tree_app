/** Kiểm thử điều phối quà khi ứng dụng hoạt động, nhận đúng hộp và phục hồi lỗi lưu mà không cấp thưởng lại. */

import { viI18n } from "./fixtures/i18nFixture";
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
import { createInitialState } from '../src/data/seed';
import { claimDailyLogin, syncLoginVisit } from '../src/store/loginMailbox';
import { buildDailyLoginGift, showDailyGiftOnRoute } from '../src/screens/rewards/dailyLoginGiftModel';
import type { AppState, LoginRewardClaim } from '../src/types/app';

const compiled = ts.transpileModule(readFileSync(new URL('../src/components/EconomyEffects.tsx', import.meta.url), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
type Result = { ok: true; result: { alreadyClaimed: boolean; claim: LoginRewardClaim; giftId: string } } | { ok: false; message: string; retryable?: boolean };
type VisitResult = { ok: true; message: string } | { ok: false; message: string; retryable?: boolean };
type Node = { type: unknown; props: Record<string, unknown> };
type Hook = { value?: unknown; deps?: unknown[]; effect?: () => void | (() => void); cleanup?: () => void };
const flush = () => new Promise(resolve => setImmediate(resolve));
function coordinator(options: { ready?: boolean; loggedIn?: boolean; foreground?: boolean;
  visit?: (state: AppState, date: string, attempt: number) => Promise<VisitResult>;
  claim?: (state: AppState, date: string, id: string) => Promise<Result> } = {}) {
  const state = createInitialState(); state.auth.loggedIn = options.loggedIn ?? true; state.auth.identity = 'garden@example.com';
  const ready = options.ready ?? true;
  let date = '2026-10-29', pathname = '/garden', foreground = options.foreground === false ? 'background' : 'active';
  let calls = 0, syncs = 0, recoveries = 0, cursor = 0, serial = 0, rewardPending = false, tree: Node | null = null;
  const hooks: Hook[] = [], effects: number[] = [], listeners = new Set<(next: string) => void>();
  const timers = new Map<number, { callback: () => void; delay: number }>();
  const exports = {} as { EconomyEffects: () => Node | null };
  const sync = async (): Promise<VisitResult> => {
    syncs++;
    if (options.visit) {
      const result = await options.visit(state, date, syncs);
      if (!result.ok && result.retryable) rewardPending = true;
      return result;
    }
    Object.assign(state, syncLoginVisit(state, new Date(`${date}T03:00:00Z`), () => 0).state);
    return { ok: true, message: 'Saved' };
  };
  const claim = async (id: string) => { calls++; if (options.claim) { const result = await options.claim(state, date, id); rewardPending = !result.ok && !!result.retryable; return result; }
    const transition = claimDailyLogin(state, new Date(`${date}T03:00:00Z`), () => 0, id); Object.assign(state, transition.state); return { ok: true, result: transition.result }; };
  const same = (a?: unknown[], b?: unknown[]) => !!a && !!b && a.length === b.length && a.every((value, i) => Object.is(value, b[i]));
  const jsx = (type: unknown, props: Record<string, unknown>) => ({ type, props });
  runInNewContext(compiled, { exports,
    setTimeout: (callback: () => void, delay: number) => { timers.set(++serial, { callback, delay }); return serial; }, clearTimeout: (id: number) => timers.delete(id),
    require: (id: string) => {
      switch (id) {
        case "@/i18n": return { useI18n: () => viI18n };
        case "@/i18n/core": return viI18n;
        case 'react': return {
          useState: <T>(initial: T | (() => T)) => { const i = cursor++; hooks[i] ??= { value: typeof initial === 'function' ? (initial as () => T)() : initial }; return [hooks[i].value, (next: T | ((value: T) => T)) => { hooks[i].value = typeof next === 'function' ? (next as (value: T) => T)(hooks[i].value as T) : next; }]; },
          useRef: <T>(value: T) => (hooks[cursor++] ??= { value: { current: value } }).value,
          useMemo: (make: () => unknown, deps: unknown[]) => { const i = cursor++; if (!same(hooks[i]?.deps, deps)) hooks[i] = { deps, value: make() }; return hooks[i].value; },
          useEffect: (effect: () => void | (() => void), deps: unknown[]) => { const i = cursor++; if (!same(hooks[i]?.deps, deps)) { hooks[i]?.cleanup?.(); hooks[i] = { deps, effect }; effects.push(i); } },
        };
        case 'react/jsx-runtime': return { jsx, jsxs: jsx, Fragment: 'Fragment' };
        case 'expo-router': return { usePathname: () => pathname, router: { push() {} } };
        case 'react-native': return { Pressable: 'Pressable', Text: 'Text', StyleSheet: { create: (value: unknown) => value }, AppState: { get currentState() { return foreground; }, addEventListener: (_event: string, listener: (next: string) => void) => { listeners.add(listener); return { remove: () => listeners.delete(listener) }; } } };
        case 'react-native-safe-area-context': return { useSafeAreaInsets: () => ({ top: 44, bottom: 34 }) };
        case '@/data/seed': return { localDateKey: () => date };
        case '@/screens/rewards/DailyLoginGift': return { DailyLoginGift: 'DailyLoginGift' };
        case '@/screens/rewards/FloatingDailyGift': return { FloatingDailyGift: 'FloatingDailyGift' };
        case '@/screens/rewards/dailyLoginGiftModel': return { buildDailyLoginGift, showDailyGiftOnRoute };
        case '@/services/gardenReminderPlan': return { millisecondsUntilNextGardenDay: () => 12345 };
        case '@/store/AppStore': return { useApp: () => ({ ready, state, claimLoginReward: claim, syncLoginVisit: sync, updateSetting() {}, pendingRewardAction: rewardPending, retryRewardAction: async () => { recoveries++; rewardPending = false; return { ok: true, message: 'Saved' }; } }) };
        case '@/theme': return { COLORS: {}, LAYOUT: {}, RADIUS: {}, SHADOWS: {}, SPACING: {}, TYPE: {} };
        default: throw new Error(`Unexpected dependency ${id}`);
      }
    },
  });
  const nodes = (value: unknown): Node[] => Array.isArray(value) ? value.flatMap(nodes) : value && typeof value === 'object' && 'props' in value ? [value as Node, ...nodes((value as Node).props.children)] : [];
  const render = () => { cursor = 0; tree = exports.EconomyEffects(); for (const i of effects.splice(0)) { const cleanup = hooks[i].effect!(); if (cleanup) hooks[i].cleanup = cleanup; } return tree; };
  const node = (type: string) => nodes(tree).find(entry => entry.type === type), props = () => node('DailyLoginGift')!.props;
  render();
  return { render, props, node, state, get calls() { return calls; }, get syncs() { return syncs; }, get recoveries() { return recoveries; }, get tree() { return tree; }, get listeners() { return listeners.size; },
    open: () => (node('FloatingDailyGift')!.props.onOpen as () => void)(), claim: (id = state.economy.loginVisits.at(-1)!.id) => (props().onClaim as (id: string) => void)(id),
    setDate: (value: string) => { date = value; }, setPath: (value: string) => { pathname = value; }, event: (value: string) => { foreground = value; for (const listener of listeners) listener(value); },
    midnight: () => { const entry = [...timers.entries()].find(([, timer]) => timer.delay === 12345)!; timers.delete(entry[0]); entry[1].callback(); },
    retryVisit: () => { const entry = [...timers.entries()].find(([, timer]) => [3000, 10000, 30000].includes(timer.delay)); assert.ok(entry, 'a failed visit must schedule an automatic retry'); timers.delete(entry[0]); entry[1].callback(); },
    replay: () => { for (const hook of hooks) if (hook.effect) { hook.cleanup?.(); const cleanup = hook.effect(); if (cleanup) hook.cleanup = cleanup; } }, unmount: () => { for (const hook of hooks) hook.cleanup?.(); },
  };
}
test('foreground visits bank boxes without claiming; StrictMode and reentry never duplicate', async () => {
  const app = coordinator(); await flush(); app.render(); assert.equal(app.state.economy.loginVisits.length, 1); assert.equal(app.calls, 0);
  app.open(); app.render(); assert.equal(app.props().visible, true); (app.props().onClose as () => void)(); app.replay(); app.event('active'); app.render(); await flush();
  assert.equal(app.state.economy.loginVisits.length, 1); assert.equal(app.state.economy.loginClaims.length, 0);
  app.setDate('2026-11-02'); app.midnight(); app.render(); await flush(); app.render(); assert.equal(app.state.economy.loginVisits.length, 2); assert.equal(app.calls, 0);
  assert.equal(app.listeners, 1); app.unmount(); assert.equal(app.listeners, 0);
});
test('nothing banks before hydration, sign-in or foreground; fullscreen flows hide entry', async () => {
  for (const options of [{ ready: false }, { loggedIn: false }, { foreground: false }]) { const app = coordinator(options); await flush(); assert.equal(app.syncs, 0); assert.equal(app.tree, null); app.unmount(); }
  const app = coordinator(); await flush(); app.render(); for (const path of ['/camera', '/plant-chat', '/reward-pack', '/', '/mailbox']) { app.setPath(path); app.render(); assert.equal(app.tree, null); }
});
test('box claims exact ID once despite rapid taps; reveal waits for successful storage', async () => {
  let finish!: (value: Result) => void;
  const app = coordinator({ claim: async (state, date, id) => { const result = claimDailyLogin(state, new Date(`${date}T03:00:00Z`), () => 0, id); Object.assign(state, result.state); return new Promise(resolve => { finish = resolve; }); } });
  await flush(); app.render(); app.open(); app.render(); app.claim(); app.claim(); app.render(); assert.equal(app.calls, 1); assert.equal(app.props().received, null); assert.equal(app.props().pending, true);
  finish({ ok: true, result: { alreadyClaimed: false, claim: app.state.economy.loginClaims[0], giftId: app.state.economy.loginVisits[0].id } }); await flush(); app.render(); assert.equal((app.props().received as LoginRewardClaim).itemId, 'berry-bites');
});
test('failed optimistic gift recovers after close/reopen without another claim', async () => {
  const app = coordinator({ claim: async (state, date, id) => { const result = claimDailyLogin(state, new Date(`${date}T03:00:00Z`), () => 0, id); Object.assign(state, result.state); return { ok: false, retryable: true, message: 'Disk full' }; } });
  await flush(); app.render(); app.open(); app.render(); app.claim(); await flush(); app.render(); assert.equal(app.props().pending, true);
  (app.props().onClose as () => void)(); app.render(); app.open(); app.render(); (app.props().onRetry as () => void)(); await flush(); app.render();
  assert.equal((app.props().received as LoginRewardClaim).itemId, 'berry-bites'); assert.equal(app.calls, 1); assert.equal(app.state.economy.loginClaims.length, 1);
});
test('replacement login session suppresses late feedback and unmount clears listeners', async () => {
  let finish!: (value: Result) => void;
  const app = coordinator({ claim: async () => new Promise(resolve => { finish = resolve; }) }); await flush(); app.render(); app.open(); app.render(); app.claim();
  app.state.auth.loggedIn = false; app.render(); app.state.auth.loggedIn = true; app.render(); finish({ ok: false, retryable: true, message: 'Old error' }); await flush(); app.render();
  assert.equal(app.props().error, null); assert.equal(app.props().received, null); app.unmount(); assert.equal(app.listeners, 0);
});

test('a failed initialization attempt retries automatically instead of hiding the daily gift for the whole day', async () => {
  const app = coordinator({ visit: async (state, date, attempt) => {
    if (attempt === 1) return { ok: false, message: 'Storage is still opening' };
    Object.assign(state, syncLoginVisit(state, new Date(`${date}T03:00:00Z`), () => 0).state);
    return { ok: true, message: 'Saved' };
  } });
  await flush(); app.render(); await flush(); app.render();
  assert.equal(app.syncs, 1, 'failure feedback must not create a tight retry loop');
  assert.equal(app.state.economy.loginVisits.length, 0);
  app.retryVisit(); app.render(); await flush(); app.render();
  assert.equal(app.syncs, 2);
  assert.equal(app.state.economy.loginVisits.length, 1);
  assert.equal(app.node('FloatingDailyGift')?.props.count, 1);
  assert.equal(app.props().error, null);
  app.event('active'); app.render(); await flush();
  assert.equal(app.syncs, 2, 'the stored receipt, not an attempted date, prevents repeats');
  app.unmount();
});

test('automatic visit recovery persists the original optimistic gift without rolling or claiming again', async () => {
  let rolls = 0;
  const app = coordinator({ visit: async (state, date, attempt) => {
    Object.assign(state, syncLoginVisit(state, new Date(`${date}T03:00:00Z`), () => { rolls++; return 0; }).state);
    return attempt === 1 ? { ok: false, message: 'Disk was temporarily busy', retryable: true } : { ok: true, message: 'Saved' };
  } });
  await flush(); app.render(); app.retryVisit(); app.render(); await flush(); app.render();
  assert.equal(app.recoveries, 1);
  assert.equal(app.syncs, 2);
  assert.equal(app.state.economy.loginVisits.length, 1);
  assert.equal(app.state.economy.loginClaims.length, 0);
  assert.equal(rolls, 1);
  assert.equal(app.props().error, null);
  app.unmount();
});

test('a newly imported account save without today’s visit is checked again; another account never inherits the date cache', async () => {
  const app = coordinator(); await flush(); app.render();
  app.state.economy.loginVisits = [];
  app.render(); await flush(); app.render();
  assert.equal(app.state.economy.loginVisits.length, 1);
  assert.equal(app.syncs, 2);
  app.state.auth.userId = '22222222-2222-4222-8222-222222222222';
  app.state.economy.loginVisits = [];
  app.render(); await flush(); app.render();
  assert.equal(app.state.economy.loginVisits.length, 1);
  assert.equal(app.syncs, 3);
  app.unmount();
});

test('a claimed gift stays claimed on app reopen and missed calendar dates are not backfilled', async () => {
  const app = coordinator(); await flush(); app.render(); app.open(); app.render(); app.claim(); await flush(); app.render();
  (app.props().onClose as () => void)(); app.event('background'); app.render(); app.event('active'); app.render(); await flush(); app.render();
  assert.equal(app.node('FloatingDailyGift'), undefined);
  assert.equal(app.state.economy.loginClaims.length, 1);
  app.setDate('2026-11-05'); app.event('active'); app.render(); await flush(); app.render();
  assert.deepEqual(app.state.economy.loginVisits.map((gift) => gift.cycleDay), [1, 2]);
  assert.equal(app.node('FloatingDailyGift')?.props.count, 1);
  app.unmount();
});
