/** Kiểm thử tích hợp kho trạng thái, tự động lưu và thử lại đồng bộ, xác thực cùng giao dịch kinh tế không bị lặp. */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { createInitialState } from '../src/data/seed';
import * as economyActions from '../src/store/economyActions';
import { createEconomyTransactions } from '../src/store/economyTransactions';
import * as loginMailbox from '../src/store/loginMailbox';
import * as journeyActions from '../src/store/journeyActions';
import * as petActions from '../src/store/petActions';
import * as petCollection from '../src/store/petCollection';
import { createPetInstance } from '../src/store/petCollection';
import type { AppContextValue } from '../src/store/AppStore';
import type { SyncStatus } from '../src/store/cloudStorage';
import { FRESH_START_EPOCH, statePhotoUris, type StoredUserData } from '../src/store/storageLifecycle';
import type { AppState } from '../src/types/app';
import * as profilePreferences from '../src/utils/profilePreferences';
import { accountAuthFixture, AuthFault } from './fixtures/accountAuthPort';
import { viI18n } from './fixtures/i18nFixture';

const compiled = ts.transpileModule(readFileSync(resolve(__dirname, '../src/store/AppStore.tsx'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const flush = async () => { for (let index = 0; index < 40; index++) await Promise.resolve(); };
function deferred() {
  let release!: () => void;
  const wait = new Promise<void>((resolveWait) => { release = resolveWait; });
  return { wait, release };
}

/** Run the real provider and pure actions; replace only React/native/storage ports. */
function provider(prepare?: (state: AppState) => void) {
  const initial = createInitialState();
  initial.auth = { loggedIn: true, remember: true, identity: 'test@pat.vn' };
  initial.economy.gold = 200;
  prepare?.(initial);
  const auth = accountAuthFixture(initial);
  let disk: StoredUserData = { storageEpoch: FRESH_START_EPOCH, state: clone(initial), pendingPhotoCleanup: [] };
  const hooks: { value: unknown; deps?: readonly unknown[]; cleanup?: () => void }[] = [];
  let cursor = 0;
  let context: AppContextValue;
  const effects: (() => void)[] = [];
  const io = { fail: false, gate: null as Promise<void> | null, attempts: 0, saves: [] as AppState[],
    socialAttempts: [] as string[], socialResets: [] as string[], failSocialReset: false,
    cloudMail: [] as { claimIds?: string[]; readIds?: string[]; deleteIds?: string[] }[],
    cloudFailure: null as SyncStatus | null, cloudFlushes: 0, cloudRefreshes: 0,
    cloudSaves: [] as AppState[] };
  let timerSequence = 0;
  const timers = new Map<number, { delay: number; run: () => void }>();
  const clock = {
    delays: () => [...timers.values()].map(timer => timer.delay),
    fireNext: () => {
      const next = [...timers.entries()].sort((a, b) => a[1].delay - b[1].delay)[0];
      assert.ok(next, 'an automatic retry should be scheduled');
      timers.delete(next[0]); next[1].run();
    },
  };
  const sameDeps = (a: readonly unknown[] | undefined, b: readonly unknown[] | undefined) =>
    a !== undefined && b !== undefined && a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
  const useState = <T>(initialValue: T | (() => T)) => {
    const index = cursor++;
    hooks[index] ??= { value: typeof initialValue === 'function' ? (initialValue as () => T)() : initialValue };
    return [hooks[index].value as T, (value: T | ((previous: T) => T)) => {
      hooks[index].value = typeof value === 'function' ? (value as (previous: T) => T)(hooks[index].value as T) : value;
    }] as const;
  };
  const useRef = <T>(initialValue: T) => {
    const index = cursor++;
    hooks[index] ??= { value: { current: initialValue } };
    return hooks[index].value;
  };
  const memo = <T>(make: () => T, deps: readonly unknown[]) => {
    const index = cursor++;
    if (!hooks[index] || !sameDeps(hooks[index].deps, deps)) hooks[index] = { value: make(), deps };
    return hooks[index].value;
  };
  const useEffect = (effect: () => void | (() => void), deps: readonly unknown[]) => {
    const index = cursor++;
    if (!hooks[index] || !sameDeps(hooks[index].deps, deps)) {
      const previous = hooks[index];
      hooks[index] = { value: undefined, deps };
      effects.push(() => {
        previous?.cleanup?.();
        const cleanup = effect();
        if (typeof cleanup === 'function') hooks[index].cleanup = cleanup;
      });
    }
  };
  const jsx = (_type: unknown, props: { value: AppContextValue }) => { context = props.value; return props; };
  const exports = {} as { AppProvider: (props: { children: null }) => unknown; useApp: () => AppContextValue };
  runInNewContext(compiled, {
    exports, Error, console: { warn() {} }, setInterval: () => 1, clearInterval() {},
    setTimeout: (run: () => void, delay: number) => {
      const id = ++timerSequence; timers.set(id, { run, delay }); return id;
    },
    clearTimeout: (id: number) => { timers.delete(id); },
    require: (id: string) => {
      switch (id) {
        case 'react': return { createContext: () => ({ Provider: 'Provider' }), useContext: () => context,
          useState, useRef, useMemo: memo, useEffect, useCallback: (callback: unknown, deps: readonly unknown[]) => memo(() => callback, deps) };
        case 'react/jsx-runtime': return { jsx, jsxs: jsx };
        case '../i18n/core': return viI18n;
        case 'react-native': return { AppState: { currentState: 'active', addEventListener: () => ({ remove() {} }) } };
        case 'expo-sqlite/kv-store': return { __esModule: true, default: { getItem: async () => null, setItem: async () => {} } };
        case '../data/seed': return { createInitialState };
        case '../services/accountAuth': return { accountAuth: auth.port, AccountAuthError: AuthFault };
        case '../services/cloudSync': return { cloudSync: {} };
        case '../services/cloudAssets': return { cloudAssetFiles: {} };
        case './cloudStorage': return { createCloudStorage: (options: { port: { setItem: (key: string, value: string) => Promise<void> }; record: StoredUserData;
          onStatus?: (status: SyncStatus) => void }) => {
          let record = clone(options.record);
          let status: SyncStatus = { phase: 'synced', message: '' };
          const publish = (next: SyncStatus) => { status = next; options.onStatus?.(next); };
          const sync = async () => {
            publish({ phase: 'syncing', message: '' });
            if (io.cloudFailure) { publish({ ...io.cloudFailure }); throw new Error('Simulated cloud failure'); }
            io.cloudSaves.push(clone(record.state));
            publish({ phase: 'synced', message: '' }); return record;
          };
          return { port: { ...options.port, setItem: async (key: string, value: string) => {
            await options.port.setItem(key, value); record = JSON.parse(value) as StoredUserData;
          } }, record: () => record, status: () => ({ ...status }), blocked: () => status.phase === 'conflict',
          open: async () => record,
          flush: async () => { io.cloudFlushes++; return sync(); },
          refresh: async () => { io.cloudRefreshes++; return sync(); },
          mail: async (action: { claimIds?: string[]; readIds?: string[]; deleteIds?: string[] }) => {
            io.cloudMail.push(action);
            for (const id of action.readIds ?? []) record.state = loginMailbox.readMail(record.state, id).state;
            for (const id of action.claimIds ?? []) record.state = loginMailbox.claimMail(record.state, id).state;
            for (const id of action.deleteIds ?? []) record.state = loginMailbox.deleteMail(record.state, id).state;
            await options.port.setItem('PAT_MOBILE_STATE_V1', JSON.stringify(record)); return record;
          } };
        } };
        case '../services/socialLogin': return {
          startSocialLogin: async (provider: string) => {
            io.socialAttempts.push(provider);
            return { provider, tokenType: 'id_token', token: 'proof' };
          },
          resetSocialLoginSession: async (provider: string) => {
            io.socialResets.push(provider);
            if (io.failSocialReset) throw new Error('Provider session reset failed');
          },
        };
        case './accountStorage': return { loadAccountData: async (_base: unknown, user: { id: string; email: string; username: string }) => {
          const record = clone(disk);
          record.state.auth = { ...record.state.auth, loggedIn: true, userId: user.id, identity: user.email };
          record.state.profile = { ...record.state.profile, name: user.username, email: user.email };
          return { port: { setItem: async (_key: string, value: string) => { disk = JSON.parse(value); } }, record };
        } };
        case '../utils/profilePreferences': return profilePreferences;
        case '../services/preferences': return { withPreferenceReset: async (task: () => Promise<unknown>) => task(),
          cancelDailyReminders: async () => {}, deleteBackgroundMusicFile() {}, listBackgroundMusicUris: () => [] };
        case '../services/preferenceStatus': return { setPreferenceError() {} };
        case '../utils/checkInPhotos': return { withCheckInPhotoReset: async (task: () => Promise<unknown>) => task(),
          deleteCheckInPhoto() {}, listCheckInPhotoUris: () => [] };
        case './storageLifecycle': return { statePhotoUris,
          loadStoredUserData: async () => clone(disk),
          saveStoredUserData: async (port: { setItem: (key: string, value: string) => Promise<void> }, previous: StoredUserData, state: AppState) => {
            io.attempts++;
            if (io.gate) await io.gate;
            if (io.fail) throw new Error('Simulated disk failure');
            disk = { ...previous, state: clone(state) };
            await port.setItem('PAT_MOBILE_STATE_V1', JSON.stringify(disk));
            io.saves.push(clone(state));
            return clone(disk);
          },
        };
        case './journeyActions': return journeyActions;
        case './petActions': return petActions;
        case './petCollection': return petCollection;
        case './economyActions': return economyActions;
        case './economyTransactions': return { createEconomyTransactions };
        case './loginMailbox': return loginMailbox;
        default: throw new Error(`Unexpected dependency: ${id}`);
      }
    },
  });
  const render = () => {
    cursor = 0;
    exports.AppProvider({ children: null });
    while (effects.length) effects.shift()!();
    return context;
  };
  return { io, auth, clock, render, consume: () => exports.useApp(), disk: () => disk,
    hydrate: async () => { render(); await flush(); render(); await flush(); return render(); } };
}

const order = { requestId: 'stable-purchase', itemId: 'berry-bites', quantity: 2 };

test('ordinary progress changes are saved locally and uploaded automatically without tapping Save', async () => {
  const app = provider(); await app.hydrate(); await flush(); app.render();
  const before = app.io.cloudFlushes;
  app.consume().updateProfile({ title: 'An automatically saved garden' });
  app.render(); await flush(); app.render();
  assert.ok(app.io.cloudFlushes > before, 'the provider state effect must flush the cloud outbox');
  assert.equal(app.disk().state.profile.title, 'An automatically saved garden');
  assert.equal(app.io.cloudSaves.at(-1)?.profile.title, 'An automatically saved garden');
  assert.equal(app.consume().syncStatus.phase, 'synced');
  assert.deepEqual(app.clock.delays(), []);
});

test('manual sync and explicit cloud reload remain usable after hydration', async () => {
  const app = provider(); await app.hydrate(); await flush(); app.render();
  const before = app.io.cloudRefreshes;
  const sync = await app.consume().retrySync();
  assert.equal(sync.ok, true, sync.message);
  await flush(); app.render();
  const reload = await app.consume().reloadCloud();
  assert.equal(reload.ok, true, reload.message);
  await flush(); app.render();
  assert.equal(app.io.cloudRefreshes, before + 2);
  assert.equal(app.consume().syncStatus.phase, 'synced');
  assert.equal(app.consume().ready, true);
});

test('temporary cloud failures retry automatically with 3/10/30-second backoff and stop after success', async () => {
  const app = provider(); await app.hydrate(); await flush(); app.render();
  app.io.cloudFailure = { phase: 'offline', message: 'Temporary network outage', retryable: true };
  app.consume().updateProfile({ title: 'Waiting for the network' });
  app.render(); await flush(); app.render();
  assert.equal(app.disk().state.profile.title, 'Waiting for the network', 'offline changes remain durable locally');
  assert.deepEqual(app.clock.delays(), [3_000]);
  for (const delay of [10_000, 30_000]) {
    const before = app.io.cloudFlushes;
    app.clock.fireNext(); await flush(); app.render();
    assert.ok(app.io.cloudFlushes > before, 'the retry runs without calling the manual sync action');
    assert.deepEqual(app.clock.delays(), [delay]);
  }
  app.io.cloudFailure = null;
  app.clock.fireNext(); await flush(); app.render();
  assert.equal(app.io.cloudSaves.at(-1)?.profile.title, 'Waiting for the network');
  assert.equal(app.consume().syncStatus.phase, 'synced');
  assert.deepEqual(app.clock.delays(), [], 'success cancels the automatic retry chain');
});

test('conflicts and authentication failures do not schedule automatic upload retries', async () => {
  for (const phase of ['conflict', 'error'] as const) {
    const app = provider(); await app.hydrate(); await flush(); app.render();
    app.io.cloudFailure = { phase, message: phase === 'conflict' ? 'Another phone changed this garden' : 'Sign in again', retryable: false };
    app.consume().updateProfile({ title: `A safely retained ${phase} change` });
    app.render(); await flush(); app.render();
    assert.equal(app.consume().syncStatus.phase, phase);
    assert.deepEqual(app.clock.delays(), [], `${phase} must require explicit resolution`);
  }
});

test('removed development mutations stay unavailable and hydration never grants resources', async () => {
  const app = provider();
  await app.hydrate();
  const context = app.consume();
  for (const key of ['grantTestResources', 'grantDemoMail', 'resetUserData', 'pendingTestResources']) {
    assert.equal(key in context, false);
  }
  assert.equal(context.state.economy.gold, 200, 'only the fixture starting balance is retained');
  assert.equal(context.state.inventory.pets.length, 0);
  assert.ok(context.state.inventory.items.every(item => item.quantity === 0));
  assert.equal(context.state.mailbox.length, 0);
  assert.equal(typeof context.requestPasswordReset, 'function');
  assert.equal(typeof context.resetPassword, 'function');
  assert.equal(typeof context.changePassword, 'function');
});

test('persisted login flags cannot replace server authentication or accept a wrong password', async () => {
  const app = provider(); app.auth.io.saved = null;
  await app.hydrate(); assert.equal(app.consume().state.auth.loggedIn, false);
  app.auth.io.loginError = new AuthFault('INVALID_CREDENTIALS', 'Email hoặc mật khẩu không đúng.', 401);
  const failed = await app.consume().login('test@pat.vn', 'wrong', true);
  assert.equal(failed.ok, false); assert.equal(app.render().state.auth.loggedIn, false);
  assert.equal(app.auth.io.saved, null);
  app.auth.io.loginError = null;
  assert.equal((await app.consume().login('test@pat.vn', 'valid long password', true)).ok, true);
  assert.equal(app.render().state.auth.loggedIn, true);
  assert.equal(app.consume().state.auth.identity, app.consume().state.profile.email);
  assert.equal(JSON.stringify(app.disk()).includes('valid long password'), false);
  assert.equal(JSON.stringify(app.disk()).includes('a'.repeat(43)), false);
});
test('revoked remembered sessions are cleared without trusting local logged-in state', async () => {
  const app = provider(); app.auth.io.meError = new AuthFault('SESSION_EXPIRED', 'Đăng nhập lại.', 401);
  await app.hydrate(); assert.equal(app.consume().state.auth.loggedIn, false);
  assert.equal(app.auth.io.saved, null);
  assert.equal(app.consume().rememberedEmail, 'test@pat.vn');
  assert.equal(app.consume().rememberLogin, true);
});

test('a temporary remembered-session validation failure keeps its token and retries without entering a guest session', async () => {
  const app = provider();
  app.auth.io.meError = new AuthFault('NETWORK', 'Không kết nối được máy chủ tài khoản.');
  await app.hydrate();
  assert.equal(app.consume().ready, false);
  assert.match(app.consume().storageError!, /Không kết nối/);
  assert.equal(app.consume().account, null);
  assert.equal(app.auth.io.saved?.session.token, 'a'.repeat(43));
  assert.equal(app.auth.io.savedTokens.includes(null), false);
  app.auth.io.meError = null;
  app.consume().retryStorage();
  await app.hydrate();
  assert.equal(app.consume().ready, true);
  assert.equal(app.consume().state.auth.loggedIn, true);
  assert.equal(app.consume().rememberedEmail, 'test@pat.vn');
  assert.equal(app.consume().storageError, null);
});

test('existing remembered sessions gain an email suggestion without changing the authenticated account', async () => {
  const app = provider(); app.auth.io.remembered = null;
  await app.hydrate();
  assert.equal(app.consume().state.auth.loggedIn, true);
  assert.equal(app.consume().rememberLogin, true);
  assert.equal(app.consume().rememberedEmail, 'test@pat.vn');
  assert.equal(app.auth.io.saved?.session.token, 'a'.repeat(43));
});

test('remember opt-out removes the durable login and email without terminating the active account', async () => {
  const app = provider(); await app.hydrate();
  assert.equal((await app.consume().updateRememberLogin(false)).ok, true);
  app.render();
  assert.equal(app.consume().rememberLogin, false);
  assert.equal(app.consume().rememberedEmail, '');
  assert.equal(app.consume().state.auth.loggedIn, true);
  assert.equal(app.auth.io.saved, null);
  assert.equal(app.auth.io.remembered, null);
  assert.equal(app.consume().state.auth.remember, false);
});

test('logout during a remember write cannot restore an old token or commit a stale preference', async () => {
  const app = provider(); await app.hydrate();
  assert.equal((await app.consume().updateRememberLogin(false)).ok, true); app.render();
  const gate = deferred(); app.auth.io.rememberGate = gate.wait;
  const pending = app.consume().updateRememberLogin(true);
  await flush(); app.consume().logout(); gate.release();
  assert.equal((await pending).ok, false);
  await flush(); app.render();
  assert.equal(app.consume().state.auth.loggedIn, false);
  assert.equal(app.consume().rememberLogin, false);
  assert.equal(app.auth.io.saved, null);
  assert.equal(app.auth.io.remembered, null);
});

test('a failed secure preference write is reported rather than pretending opt-out succeeded', async () => {
  const app = provider(); await app.hydrate();
  app.auth.io.rememberError = new AuthFault('STORAGE', 'Chưa lưu được lựa chọn ghi nhớ đăng nhập.');
  const result = await app.consume().updateRememberLogin(false);
  assert.equal(result.ok, false);
  assert.match(result.message!, /Chưa lưu/);
  assert.equal(app.render().rememberLogin, true);
  assert.equal(app.consume().state.auth.loggedIn, true);
  assert.equal(app.auth.io.saved, null, 'failed preference cleanup never resurrects the deleted token');
});

test('remembered successful password login retains device autofill on logout but never writes secrets to AppState', async () => {
  const app = provider(); app.auth.io.saved = null; app.auth.io.remembered = null;
  await app.hydrate();
  assert.equal((await app.consume().updateRememberLogin(true)).ok, true);
  assert.deepEqual(clone(app.auth.io.remembered), { email: '' });
  assert.equal((await app.consume().login('test@pat.vn', 'not-for-storage', true)).ok, true);
  app.render();
  assert.equal(app.consume().rememberedEmail, 'test@pat.vn');
  assert.equal(app.consume().rememberedPassword, 'not-for-storage');
  app.consume().logout(); await flush(); app.render();
  assert.equal(app.auth.io.saved, null);
  assert.equal(app.consume().rememberLogin, true);
  assert.equal(app.consume().rememberedEmail, 'test@pat.vn');
  assert.deepEqual(clone(app.auth.io.remembered), { email: 'test@pat.vn', password: 'not-for-storage' });
  assert.equal(app.consume().rememberedPassword, 'not-for-storage');
  assert.equal(JSON.stringify(app.disk()).includes('not-for-storage'), false);
});

test('ordinary password login without remember succeeds and clears stored credentials without passing a secret to a null email', async () => {
  const app = provider(); app.auth.io.saved = null;
  app.auth.io.remembered = { email: 'test@pat.vn', password: 'previous-password' };
  const writes: { email: string | null; hasPassword: boolean }[] = [];
  const saveRememberedLogin = app.auth.port.saveRememberedLogin;
  app.auth.port.saveRememberedLogin = async (email, password) => {
    if (email === null && typeof password === 'string')
      throw new AuthFault('INVALID_INPUT', 'Cannot bind a password without an opted-in email');
    writes.push({ email, hasPassword: typeof password === 'string' });
    await saveRememberedLogin(email, password);
  };
  await app.hydrate();
  const result = await app.consume().login('test@pat.vn', 'successful-unremembered-password', false);
  assert.equal(result.ok, true);
  assert.equal(app.render().state.auth.loggedIn, true);
  assert.equal(app.consume().rememberLogin, false);
  assert.equal(app.consume().rememberedPassword, '');
  assert.deepEqual(writes, [{ email: null, hasPassword: false }]);
  assert.equal(app.auth.io.remembered, null);
  assert.equal(app.auth.io.saved, null);
  assert.equal(JSON.stringify(app.disk()).includes('successful-unremembered-password'), false);
});

test('failed password authentication never replaces an existing remembered credential', async () => {
  const app = provider(); app.auth.io.saved = null;
  app.auth.io.remembered = { email: 'test@pat.vn', password: 'previous-password' };
  await app.hydrate();
  app.auth.io.loginError = new AuthFault('INVALID_CREDENTIALS', 'Thông tin không đúng.', 401);
  assert.equal((await app.consume().login('other@pat.vn', 'wrong-password', true)).ok, false);
  assert.deepEqual(clone(app.auth.io.remembered), { email: 'test@pat.vn', password: 'previous-password' });
  assert.equal(app.render().rememberedPassword, 'previous-password');
  assert.equal(JSON.stringify(app.disk()).includes('previous-password'), false);
});

test('social login removes any old local password and remembers only its verified email', async () => {
  const app = provider(); app.auth.io.saved = null;
  app.auth.io.remembered = { email: 'test@pat.vn', password: 'previous-password' };
  await app.hydrate();
  assert.equal((await app.consume().loginSocial('google', true)).ok, true);
  assert.deepEqual(clone(app.auth.io.remembered), { email: 'test@pat.vn' });
  assert.equal(app.render().rememberedPassword, '');
});
test('social sign-in uses authenticated account storage and linking preserves garden resources', async () => {
  const app = provider(); app.auth.io.saved = null; await app.hydrate();
  assert.equal((await app.consume().loginSocial('google', true)).ok, true);
  assert.equal(app.render().state.auth.loggedIn, true);
  assert.equal((app.auth.io.saved as ReturnType<typeof accountAuthFixture>['io']['saved'])?.session.token, 'a'.repeat(43));
  const before = clone(app.consume().state);
  assert.equal((await app.consume().linkSocial('facebook')).ok, true);
  assert.deepEqual(clone(app.render().state), before);
  assert.deepEqual(clone(app.consume().account?.providers), ['facebook']);
  assert.equal(JSON.stringify(app.disk()).includes('proof'), false);
  assert.equal(JSON.stringify(app.disk()).includes('a'.repeat(43)), false);
});
test('logout during social sign-in cannot restore a late server session', async () => {
  const app = provider(); app.auth.io.saved = null; await app.hydrate();
  const gate = deferred(); app.auth.io.loginGate = gate.wait;
  const pending = app.consume().loginSocial('google', true);
  await flush(); app.consume().logout(); gate.release();
  assert.equal((await pending).ok, false);
  await flush(); assert.equal(app.render().state.auth.loggedIn, false);
  assert.equal(app.auth.io.saved, null);
  assert.equal(app.consume().account, null);
});

test('email conflict clears only provider approval and permits a fresh social retry', async () => {
  for (const providerName of ['google', 'facebook'] as const) {
    const app = provider(); app.auth.io.saved = null; await app.hydrate();
    const before = clone(app.render().state);
    app.auth.io.loginError = new AuthFault('SOCIAL_LINK_REQUIRED', 'Email này đã có tài khoản PAT.', 409);
    const rejected = await app.consume().loginSocial(providerName, false);
    assert.equal(rejected.ok, false);
    assert.match(rejected.message!, /Email này/);
    assert.deepEqual(app.io.socialResets, [providerName]);
    assert.deepEqual(clone(app.render().state), before);
    assert.equal(app.consume().account, null);
    assert.equal(app.auth.io.saved, null);

    app.auth.io.loginError = null;
    assert.equal((await app.consume().loginSocial(providerName, false)).ok, true);
    assert.deepEqual(app.io.socialAttempts, [providerName, providerName]);
    assert.equal(app.render().state.auth.loggedIn, true);
  }
});

test('provider cleanup failures do not replace the original account conflict or block retry', async () => {
  const app = provider(); app.auth.io.saved = null; await app.hydrate();
  app.io.failSocialReset = true;
  app.auth.io.loginError = new AuthFault('SOCIAL_LINK_REQUIRED', 'Hãy liên kết tài khoản PAT đã có.', 409);
  assert.equal((await app.consume().loginSocial('google', false)).message, 'Hãy liên kết tài khoản PAT đã có.');
  app.auth.io.loginError = null;
  assert.equal((await app.consume().loginSocial('google', false)).ok, true);
});
test('social proof rejection preserves PAT session while an expired PAT session logs out', async () => {
  const app = provider(); await app.hydrate();
  app.auth.io.linkError = new AuthFault('SOCIAL_TOKEN_INVALID', 'Hãy xác thực lại Google.', 401);
  assert.equal((await app.consume().linkSocial('google')).ok, false);
  assert.equal(app.render().state.auth.loggedIn, true);
  assert.equal(app.auth.io.saved?.session.token, 'a'.repeat(43));
  assert.equal(app.auth.io.calls.some(call => call.startsWith('logout:')), false);
  app.auth.io.linkError = new AuthFault('SESSION_EXPIRED', 'Đăng nhập lại PAT.', 401);
  assert.equal((await app.consume().linkSocial('google')).ok, false);
  await flush(); assert.equal(app.render().state.auth.loggedIn, false);
  assert.equal(app.auth.io.saved, null);
});
test('password rotation keeps only the replacement credential and wrong current password leaves it unchanged', async () => {
  const app = provider(); app.auth.io.remembered = { email: 'test@pat.vn', password: 'old' }; await app.hydrate();
  app.auth.io.passwordError = new AuthFault('CURRENT_PASSWORD_INCORRECT', 'Mật khẩu hiện tại không đúng.', 400);
  assert.equal((await app.consume().changePassword('wrong', 'valid long new password')).ok, false);
  assert.equal(app.auth.io.saved?.session.token, 'a'.repeat(43));
  assert.equal(app.auth.io.remembered?.password, 'old');
  app.auth.io.passwordError = null;
  assert.equal((await app.consume().changePassword('old', 'valid long new password')).ok, true);
  assert.equal(app.auth.io.saved?.session.token, 'b'.repeat(43));
  assert.equal(app.auth.io.calls.at(-1), `password:${'a'.repeat(43)}`);
  assert.equal(app.auth.io.remembered?.password, 'valid long new password');
  assert.equal(app.render().rememberedPassword, 'valid long new password');
  assert.equal(JSON.stringify(app.disk()).includes('valid long new password'), false);
});

test('password reset invalidates a stale saved password while retaining email opt-in', async () => {
  const app = provider(); app.auth.io.saved = null;
  app.auth.io.remembered = { email: 'test@pat.vn', password: 'old' };
  await app.hydrate();
  assert.equal((await app.consume().resetPassword('r'.repeat(43), 'new-password')).ok, true);
  assert.deepEqual(clone(app.auth.io.remembered), { email: 'test@pat.vn' });
  assert.equal(app.render().rememberedPassword, '');
  assert.equal(JSON.stringify(app.disk()).includes('new-password'), false);
});

test('guest password recovery never signs in, persists secrets or changes garden resources', async () => {
  const app = provider(); app.auth.io.saved = null; await app.hydrate();
  const before = clone(app.render().state);
  const writes = app.io.attempts;
  const sessionWrites = app.auth.io.savedTokens.length;
  assert.equal((await app.consume().requestPasswordReset('test@pat.vn')).ok, true);
  assert.equal((await app.consume().resetPassword('r'.repeat(43), '  valid new password  ')).ok, true);
  assert.deepEqual(app.auth.io.calls, ['forgot-password', 'reset-password']);
  assert.deepEqual(clone(app.render().state), before);
  assert.equal(app.io.attempts, writes);
  assert.equal(app.auth.io.savedTokens.length, sessionWrites);
  assert.equal(app.auth.io.saved, null);
  assert.equal(app.consume().state.auth.loggedIn, false);
});

test('recovery failures are retryable without state changes and signed-in users use current-password change', async () => {
  const app = provider(); app.auth.io.saved = null; await app.hydrate();
  const before = clone(app.render().state);
  app.auth.io.recoveryError = new AuthFault('RESET_NOT_CONFIGURED', 'Email chưa được cấu hình.', 503);
  const failed = await app.consume().requestPasswordReset('test@pat.vn');
  assert.equal(failed.ok, false); assert.match(failed.message, /chưa được cấu hình/);
  assert.deepEqual(clone(app.render().state), before);
  app.auth.io.recoveryError = null;
  assert.equal((await app.consume().requestPasswordReset('test@pat.vn')).ok, true);
  assert.equal((await app.consume().login('test@pat.vn', 'valid long password', true)).ok, true);
  app.render(); const previousCalls = app.auth.io.calls.length;
  assert.equal((await app.consume().resetPassword('r'.repeat(43), 'valid new password')).ok, false);
  assert.equal(app.auth.io.calls.length, previousCalls);
});
test('logout during login cannot restore a stale server session', async () => {
  const app = provider(); app.auth.io.saved = null; await app.hydrate();
  const gate = deferred(); app.auth.io.loginGate = gate.wait;
  const pending = app.consume().login('test@pat.vn', 'valid long password', true);
  app.consume().logout(); gate.release();
  assert.equal((await pending).ok, false);
  await flush(); assert.equal(app.render().state.auth.loggedIn, false); assert.equal(app.auth.io.saved, null);
});

test('actual provider retains failed purchase intent and same-ID retry saves without double debit', async () => {
  const app = provider();
  await app.hydrate();
  app.io.fail = true;
  const failed = await app.consume().purchaseFood(order);
  assert.equal(failed.ok, false);
  assert.equal('retryable' in failed && failed.retryable, true);
  const pending = app.render();
  assert.equal(pending.state.economy.gold, 120);
  assert.equal(pending.state.inventory.items[0].quantity, 2);
  assert.equal(pending.pendingFoodPurchase?.requestId, order.requestId);
  assert.equal(app.disk().state.economy.gold, 200);
  app.io.fail = false;
  const retried = await app.consume().purchaseFood(order);
  assert.equal(retried.ok, true);
  const completed = app.render();
  assert.equal(completed.pendingFoodPurchase, null);
  assert.equal(completed.state.economy.gold, 120);
  assert.equal(app.disk().state.economy.gold, 120);
  assert.equal(app.disk().state.inventory.items[0].quantity, 2);
  assert.equal(app.disk().state.economy.purchases.length, 1);
});

test('pending order survives consumer replacement and blocks a different ID or changed intent', async () => {
  const app = provider();
  await app.hydrate();
  app.io.fail = true;
  await app.consume().purchaseFood(order);
  app.render(); // Provider remains mounted while a screen closes/reopens.
  const anotherScreen = app.consume();
  assert.equal(anotherScreen.pendingFoodPurchase?.requestId, order.requestId);
  const different = await anotherScreen.purchaseFood({ ...order, requestId: 'new-route-order' });
  assert.equal(different.ok, false);
  const changed = await anotherScreen.purchaseFood({ ...order, quantity: 1 });
  assert.equal(changed.ok, false);
  assert.equal(app.render().state.economy.purchases.length, 1);
  assert.equal(app.consume().state.economy.gold, 120);
});

test('concurrent duplicate purchase calls keep one receipt and debit', async () => {
  const app = provider();
  await app.hydrate();
  const gate = deferred();
  app.io.gate = gate.wait;
  const first = app.consume().purchaseFood(order);
  const second = app.consume().purchaseFood(order);
  assert.equal(app.render().state.economy.gold, 120);
  assert.equal(app.consume().state.economy.purchases.length, 1);
  gate.release();
  assert.equal((await first).ok, true);
  assert.equal((await second).ok, true);
  assert.equal(app.disk().state.economy.gold, 120);
  assert.equal(app.disk().state.inventory.items[0].quantity, 2);
});

test('logout suppresses a late purchase success while preserving the already committed receipt', async () => {
  const app = provider();
  await app.hydrate();
  const gate = deferred();
  app.io.gate = gate.wait;
  const purchase = app.consume().purchaseFood(order);
  app.consume().logout();
  app.render();
  gate.release();
  const result = await purchase;
  assert.equal(result.ok, false);
  assert.match(result.message, /Phiên sử dụng/);
  await flush();
  const state = app.render().state;
  assert.equal(state.auth.loggedIn, false);
  assert.equal(state.economy.gold, 120);
  assert.equal(state.economy.purchases.length, 1);
});

test('actual provider login-claim retries persist the same food and date, never grant twice', async () => {
  const app = provider();
  await app.hydrate();
  app.io.fail = true;
  const failed = await app.consume().claimLoginReward();
  assert.equal(failed.ok, false);
  assert.equal('retryable' in failed && failed.retryable, true);
  const first = app.render().state;
  const claim = first.economy.loginClaims[0];
  assert.equal(first.economy.loginClaims.length, 1);
  assert.equal(first.inventory.items.reduce((sum, food) => sum + food.quantity, 0), 1);
  app.io.fail = false;
  const retry = await app.consume().claimLoginReward();
  assert.equal(retry.ok, true);
  assert.equal(retry.ok && retry.result.claim.itemId, claim.itemId);
  assert.deepEqual(app.render().state.economy.loginClaims, [claim]);
  assert.equal(app.disk().state.inventory.items.reduce((sum, food) => sum + food.quantity, 0), 1);
});

test('logout suppresses late login gift success feedback', async () => {
  const app = provider();
  await app.hydrate();
  const gate = deferred();
  app.io.gate = gate.wait;
  const claim = app.consume().claimLoginReward();
  app.consume().logout();
  gate.release();
  const result = await claim;
  assert.equal(result.ok, false);
  assert.match(!result.ok && result.message || '', /Phiên sử dụng/);
  assert.equal(app.render().state.economy.loginClaims.length, 1);
});

function petProvider() {
  return provider((state) => {
    state.economy.gold = 1_000;
    state.inventory.pets = [
      { ...createPetInstance('ladybug', 'ladybug'), level: 36, experience: 37 },
      ...Array.from({ length: 5 }, (_, index) => createPetInstance('ladybug', `ladybug-copy-${index + 1}`)),
    ];
    state.inventory.items = state.inventory.items.map((food) => ({ ...food, quantity: 4 }));
  });
}
const starOrder = { requestId: 'stable-star-upgrade', petId: 'ladybug', targetStars: 2 as const,
  materialPetIds: ['ladybug-copy-1', 'ladybug-copy-2'] };
const saleOrder = { requestId: 'stable-copy-sale', petId: 'ladybug-copy-5', petIds: ['ladybug-copy-5'] };
const feedOrder = { requestId: 'stable-food', petId: 'ladybug', itemId: 'berry-bites' };

test('visit saving retries the same fixed gift and blocks purchases until durable', async () => {
  const app = provider(); await app.hydrate();
  app.io.fail = true;
  const result = await app.consume().syncLoginVisit();
  assert.equal(result.ok, false);
  const context = app.render();
  assert.equal(context.pendingRewardAction, true);
  const gift = clone(context.state.economy.loginVisits[0]);
  assert.equal(context.state.inventory.items.reduce((sum, food) => sum + food.quantity, 0), 0);
  assert.equal((await context.purchaseFood(order)).ok, false);
  assert.equal((await context.claimLoginReward(gift.id)).ok, false);
  app.io.fail = false;
  assert.equal((await app.consume().retryRewardAction()).ok, true);
  assert.equal(app.render().pendingRewardAction, false);
  assert.deepEqual(app.disk().state.economy.loginVisits, [gift]);
  assert.equal((await app.consume().claimLoginReward(gift.id)).ok, true);
  assert.equal(app.disk().state.inventory.items.reduce((sum, food) => sum + food.quantity, 0), 1);
});

test('mail claims and deletion are durable, mutually locked and never double-credit after write failure', async () => {
  const app = provider((state) => {
    state.mailbox = [{ id: 'gift-mail', source: 'system', sourceRef: 'cycle', title: 'Quà', body: '',
      createdAt: '2026-01-01T00:00:00Z', readAt: null, claimedAt: null,
      attachments: [{ kind: 'food', itemId: 'berry-bites', quantity: 3 }, { kind: 'gold', quantity: 80 }] }];
  });
  await app.hydrate(); app.io.fail = true;
  assert.equal((await app.consume().claimMail('gift-mail')).ok, false);
  assert.equal(app.render().state.economy.gold, 280);
  assert.equal((await app.consume().deleteMail('gift-mail')).ok, false);
  app.io.fail = false;
  assert.equal((await app.consume().claimMail('gift-mail')).ok, true);
  assert.equal((await app.consume().claimAllMail()).ok, true);
  assert.equal(app.disk().state.inventory.items[0].quantity, 3);
  assert.equal(app.disk().state.economy.gold, 280);
  assert.equal((await app.consume().deleteMail('gift-mail')).ok, true);
  assert.equal(app.disk().state.mailbox.length, 0);
});

test('publisher letters use the server action path; mixed claim-all credits each source only once', async () => {
  const app = provider(current => {
    const mail = { sourceRef: 'gift', title: 'Quà', body: '', createdAt: '2026-11-06T00:00:00Z', readAt: null, claimedAt: null };
    current.mailbox = [{ ...mail, id: 'publisher', source: 'publisher', attachments: [{ kind: 'gold', quantity: 100 }] },
      { ...mail, id: 'system', source: 'system', attachments: [{ kind: 'gold', quantity: 20 }] }];
  });
  await app.hydrate(); assert.equal((await app.consume().claimAllMail()).ok, true);
  assert.equal(app.render().state.economy.gold, 320);
  assert.deepEqual(clone(app.io.cloudMail), [{ claimIds: ['publisher'] }]);
  assert.equal((await app.consume().claimMail('publisher')).ok, true);
  assert.equal(app.render().state.economy.gold, 320);
  assert.equal((await app.consume().deleteMail('publisher')).ok, true);
  assert.equal(app.render().state.mailbox.some(mail => mail.id === 'publisher'), false);
  assert.deepEqual(clone(app.io.cloudMail.at(-1)), { deleteIds: ['publisher'] });
});

function mailboxProvider() {
  return provider((state) => {
    const mail = { source: 'system' as const, body: '', createdAt: '2026-01-01T00:00:00Z', readAt: null, claimedAt: null };
    state.mailbox = [
      { ...mail, id: 'gift', sourceRef: 'gift', title: 'Quà', attachments: [{ kind: 'gold', quantity: 80 }] },
      { ...mail, id: 'notice', sourceRef: 'notice', title: 'Thông báo', attachments: [] },
      { ...mail, id: 'already-read', sourceRef: 'read', title: 'Đã đọc', readAt: '2026-01-02T00:00:00Z', attachments: [] },
    ];
  });
}

test('provider read-all retries fixed timestamps without claiming gifts or clearing flags before durable storage', async () => {
  const app = mailboxProvider(); await app.hydrate();
  app.io.fail = true;
  const failed = await app.consume().markAllMailRead();
  assert.equal(failed.ok, false);
  assert.equal('retryable' in failed && failed.retryable, true);
  const pending = app.render();
  assert.equal(pending.pendingRewardAction, true);
  const expectedMail = clone(pending.state.mailbox);
  assert.equal(expectedMail.every((mail) => !!mail.readAt), true);
  assert.equal(expectedMail[2].readAt, '2026-01-02T00:00:00Z');
  assert.equal(expectedMail.every((mail) => mail.claimedAt === null), true);
  assert.equal(app.disk().state.mailbox[0].readAt, null);
  assert.equal((await app.consume().deleteAllMail()).ok, false);
  app.io.fail = false;
  assert.equal((await app.consume().markAllMailRead()).ok, true);
  assert.deepEqual(app.disk().state.mailbox, expectedMail);
  assert.equal(app.disk().state.economy.gold, 200);
  assert.equal(app.disk().state.inventory.items.every((food) => food.quantity === 0), true);
  const writes = app.io.attempts;
  assert.equal((await app.consume().markAllMailRead()).ok, true);
  assert.equal(app.io.attempts, writes);
});

test('provider bulk deletion retains unclaimed attachments and retries only the committed removal', async () => {
  const app = mailboxProvider(); await app.hydrate();
  app.io.fail = true;
  const failed = await app.consume().deleteAllMail();
  assert.equal(failed.ok, false);
  assert.equal(app.render().pendingRewardAction, true);
  assert.deepEqual(app.render().state.mailbox.map((mail) => mail.id), ['gift']);
  assert.equal(app.disk().state.mailbox.length, 3);
  assert.equal((await app.consume().claimMail('gift')).ok, false);
  assert.equal((await app.consume().markAllMailRead()).ok, false);
  app.io.fail = false;
  assert.equal((await app.consume().retryRewardAction()).ok, true);
  assert.deepEqual(app.disk().state.mailbox.map((mail) => mail.id), ['gift']);
  assert.equal(app.disk().state.mailbox[0].readAt, null);
  assert.equal(app.disk().state.mailbox[0].claimedAt, null);
  assert.equal(app.disk().state.economy.gold, 200);
  assert.equal((await app.consume().claimMail('gift')).ok, true);
  assert.equal(app.disk().state.economy.gold, 280);
  assert.equal((await app.consume().deleteAllMail()).ok, true);
  assert.equal(app.disk().state.mailbox.length, 0);
  const writes = app.io.attempts;
  assert.equal((await app.consume().deleteAllMail()).ok, true);
  assert.equal(app.io.attempts, writes);
});

test('rapid bulk read requests share one snapshot and prevent competing deletion', async () => {
  const app = mailboxProvider(); await app.hydrate();
  const gate = deferred(); app.io.gate = gate.wait;
  const first = app.consume().markAllMailRead();
  const duplicate = app.consume().markAllMailRead();
  const expectedMail = clone(app.render().state.mailbox);
  assert.equal((await app.consume().deleteAllMail()).ok, false);
  gate.release();
  assert.equal((await first).ok, true);
  assert.equal((await duplicate).ok, true);
  assert.deepEqual(app.disk().state.mailbox, expectedMail);
  assert.equal(app.disk().state.economy.gold, 200);
});

test('logout suppresses late bulk deletion feedback without discarding retained gift attachments', async () => {
  const app = mailboxProvider(); await app.hydrate();
  const gate = deferred(); app.io.gate = gate.wait;
  const deletion = app.consume().deleteAllMail();
  app.consume().logout(); gate.release();
  const result = await deletion;
  assert.equal(result.ok, false);
  assert.match(!result.ok && result.message || '', /Phiên sử dụng/);
  await flush();
  assert.equal(app.render().state.auth.loggedIn, false);
  assert.deepEqual(app.disk().state.mailbox.map((mail) => mail.id), ['gift']);
  assert.equal(app.disk().state.mailbox[0].attachments[0].quantity, 80);
});

test('pending pack reveal blocks other spending and retries the same pet and bonus snapshot', async () => {
  const app = provider((state) => {
    state.dailyPacks = [{ id: 'deferred-pack', roundId: 'round', date: '2026-01-01', beastId: 'ladybug',
      rarity: 'Uncommon', isNew: true, earnedAt: '2026-01-01T00:00:00Z', revealedAt: null,
      creditedAt: null, petInstanceId: 'earned-pet', demo: false, bonusFoodItemId: 'berry-bites' }];
  });
  await app.hydrate(); app.io.fail = true;
  app.consume().openDailyPack('deferred-pack');
  await assert.rejects(app.consume().persistNow());
  assert.equal(app.render().pendingRewardAction, true);
  assert.equal((await app.consume().purchaseFood(order)).ok, false);
  assert.equal(app.render().state.inventory.pets.length, 1);
  app.io.fail = false;
  assert.equal((await app.consume().retryRewardAction()).ok, true);
  app.consume().openDailyPack('deferred-pack'); await app.consume().persistNow();
  assert.equal(app.disk().state.inventory.pets.length, 1);
  assert.equal(app.disk().state.inventory.items[0].quantity, 1);
});

test('failed feeding persists one food debit and one refundable ledger entry on same-ID retry', async () => {
  const app = petProvider();
  await app.hydrate();
  app.io.fail = true;
  const result = await app.consume().feedPet(feedOrder);
  assert.equal(result.ok, false);
  assert.equal('retryable' in result && result.retryable, true);
  const pending = app.render();
  assert.equal(pending.pendingPetTransaction?.requestId, feedOrder.requestId);
  assert.equal(pending.state.inventory.items[0].quantity, 3);
  assert.equal(pending.state.inventory.pets[0].experience, 62);
  assert.deepEqual(pending.state.inventory.pets[0].foodSpent, { 'berry-bites': 1 });
  assert.equal(app.disk().state.inventory.items[0].quantity, 4);
  assert.equal((await app.consume().feedPet({ ...feedOrder, itemId: 'forest-milk' })).ok, false);
  assert.equal((await app.consume().purchaseFood(order)).ok, false);
  app.io.fail = false;
  assert.equal((await app.consume().feedPet(feedOrder)).ok, true);
  assert.equal(app.render().pendingPetTransaction, null);
  assert.equal(app.disk().state.inventory.items[0].quantity, 3);
  assert.equal(app.disk().state.inventory.pets[0].experience, 62);
  assert.deepEqual(app.disk().state.inventory.pets[0].foodSpent, { 'berry-bites': 1 });
  assert.equal(app.disk().state.economy.petTransactions.length, 1);
  assert.equal((await app.consume().feedPet(feedOrder)).ok, true);
  assert.equal(app.disk().state.inventory.items[0].quantity, 3);
});

test('rapid duplicate feeds share one durable debit and refundable ledger entry', async () => {
  const app = petProvider();
  await app.hydrate();
  const gate = deferred();
  app.io.gate = gate.wait;
  const first = app.consume().feedPet(feedOrder);
  const duplicate = app.consume().feedPet(feedOrder);
  assert.equal(app.render().state.inventory.items[0].quantity, 3);
  assert.equal(app.consume().state.inventory.pets[0].experience, 62);
  gate.release();
  assert.equal((await first).ok, true);
  assert.equal((await duplicate).ok, true);
  assert.equal(app.render().pendingPetTransaction, null);
  assert.equal(app.disk().state.inventory.items[0].quantity, 3);
  assert.deepEqual(app.disk().state.inventory.pets[0].foodSpent, { 'berry-bites': 1 });
  assert.equal(app.disk().state.economy.petTransactions.length, 1);
});

test('logout suppresses feeding feedback but retains the already committed individual ledger', async () => {
  const app = petProvider();
  await app.hydrate();
  const gate = deferred();
  app.io.gate = gate.wait;
  const feeding = app.consume().feedPet(feedOrder);
  app.consume().logout();
  gate.release();
  assert.equal((await feeding).ok, false);
  const state = app.render().state;
  assert.equal(state.auth.loggedIn, false);
  assert.deepEqual(state.inventory.pets[0].foodSpent, { 'berry-bites': 1 });
  assert.equal(state.inventory.items[0].quantity, 3);
});

test('actual provider retries a failed upgrade without consuming copies, gold or any food twice', async () => {
  const app = petProvider();
  await app.hydrate();
  app.io.fail = true;
  const failed = await app.consume().upgradePet(starOrder);
  assert.equal(failed.ok, false);
  assert.equal('retryable' in failed && failed.retryable, true);
  const pending = app.render();
  assert.equal(pending.pendingPetTransaction?.requestId, starOrder.requestId);
  assert.equal(pending.state.inventory.pets[0].stars, 2);
  assert.equal(pending.state.inventory.pets.length, 4);
  assert.equal(pending.state.inventory.pets.some((pet) => starOrder.materialPetIds.includes(pet.id)), false);
  assert.equal(pending.state.economy.gold, 800);
  assert.ok(pending.state.inventory.items.every((food) => food.quantity === 3));
  assert.equal(app.disk().state.inventory.pets[0].stars, 1);
  app.io.fail = false;
  assert.equal((await app.consume().upgradePet(starOrder)).ok, true);
  const saved = app.render();
  assert.equal(saved.pendingPetTransaction, null);
  assert.equal(saved.state.economy.gold, 800);
  assert.equal(app.disk().state.inventory.pets.length, 4);
  assert.ok(app.disk().state.inventory.items.every((food) => food.quantity === 3));
  assert.equal(app.disk().state.economy.petTransactions.length, 1);
  assert.equal(app.disk().state.inventory.pets[0].level, 36);
  assert.equal(app.disk().state.inventory.pets[0].experience, 37);
  assert.equal(app.disk().state.inventory.pets[0].baseCopies, 3);
});

test('a pending pet transaction survives screen replacement and blocks sale, purchase and feeding until saved', async () => {
  const app = petProvider();
  await app.hydrate();
  app.io.fail = true;
  await app.consume().upgradePet(starOrder);
  const before = JSON.stringify(app.render().state);
  assert.equal((await app.consume().sellPetCopies(saleOrder)).ok, false);
  assert.equal((await app.consume().upgradePet({ ...starOrder, requestId: 'new-upgrade', targetStars: 3 })).ok, false);
  assert.equal((await app.consume().upgradePet({ ...starOrder, targetStars: 3 })).ok, false);
  assert.equal((await app.consume().purchaseFood(order)).ok, false);
  assert.equal((await app.consume().feedPet(feedOrder)).ok, false);
  assert.equal(JSON.stringify(app.render().state), before);
  app.io.fail = false;
  assert.equal((await app.consume().upgradePet(starOrder)).ok, true);
  app.render();
  assert.equal((await app.consume().feedPet(feedOrder)).ok, true);
});

test('rapid duplicate sale calls award one payment and forbid a concurrent upgrade', async () => {
  const app = petProvider();
  await app.hydrate();
  const gate = deferred();
  app.io.gate = gate.wait;
  const first = app.consume().sellPetCopies(saleOrder);
  const second = app.consume().sellPetCopies(saleOrder);
  const competing = await app.consume().upgradePet(starOrder);
  assert.equal(competing.ok, false);
  const pending = app.render();
  assert.equal(pending.state.economy.gold, 1_040);
  assert.equal(pending.state.inventory.pets.length, 5);
  assert.equal(pending.state.inventory.pets.some((pet) => saleOrder.petIds.includes(pet.id)), false);
  assert.equal(pending.state.economy.petTransactions.length, 1);
  gate.release();
  assert.equal((await first).ok, true);
  assert.equal((await second).ok, true);
  assert.equal(app.disk().state.economy.gold, 1_040);
  assert.equal(app.disk().state.inventory.pets.length, 5);
});

test('pending purchases also block pet transactions so their displayed costs cannot race', async () => {
  const app = petProvider();
  await app.hydrate();
  app.io.fail = true;
  await app.consume().purchaseFood(order);
  assert.equal((await app.consume().sellPetCopies(saleOrder)).ok, false);
  assert.equal((await app.consume().upgradePet(starOrder)).ok, false);
  assert.equal(app.render().state.economy.petTransactions.length, 0);
});

test('a sale that fails to save cannot award extra gold when retried', async () => {
  const app = petProvider();
  await app.hydrate();
  app.io.fail = true;
  assert.equal((await app.consume().sellPetCopies(saleOrder)).ok, false);
  app.render();
  assert.equal(app.disk().state.economy.gold, 1_000);
  app.io.fail = false;
  assert.equal((await app.consume().sellPetCopies(saleOrder)).ok, true);
  assert.equal(app.render().pendingPetTransaction, null);
  assert.equal(app.disk().state.economy.gold, 1_040);
  assert.equal(app.disk().state.inventory.pets.length, 5);
  assert.equal(app.disk().state.economy.petTransactions.length, 1);
});

test('logout suppresses late pet feedback without corrupting the committed transaction', async () => {
  const app = petProvider();
  await app.hydrate();
  const gate = deferred();
  app.io.gate = gate.wait;
  const upgrade = app.consume().upgradePet(starOrder);
  app.consume().logout();
  app.render();
  gate.release();
  const result = await upgrade;
  assert.equal(result.ok, false);
  assert.match(result.message, /Phiên sử dụng/);
  await flush();
  const state = app.render().state;
  assert.equal(state.auth.loggedIn, false);
  assert.equal(state.inventory.pets[0].stars, 2);
  assert.equal(state.economy.petTransactions.length, 1);
});

test('a failed pet write after logout does not leak a retry prompt into the signed-out screen', async () => {
  const app = petProvider();
  await app.hydrate();
  const gate = deferred();
  app.io.gate = gate.wait;
  app.io.fail = true;
  const sale = app.consume().sellPetCopies(saleOrder);
  app.consume().logout();
  gate.release();
  const result = await sale;
  assert.equal(result.ok, false);
  assert.match(result.message, /Phiên sử dụng/);
  assert.equal('retryable' in result && result.retryable, false);
});

