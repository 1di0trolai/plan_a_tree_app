/** Kiểm thử hệ thống dịch Việt/Anh/Nhật, nội suy, thông báo đổi ngôn ngữ và bảo toàn nội dung người dùng. */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
import { accountMessages } from '../src/i18n/account';
import { gardenMessages } from '../src/i18n/garden';
import { inventoryMessages } from '../src/i18n/inventory';
import { commonMessages } from '../src/i18n/common';
import { actionMessages } from '../src/i18n/actionMessages';
import * as actualCore from '../src/i18n/core';
import { buildGardenReminderPlan } from '../src/services/gardenReminderPlan';
import { createDailyReminderController } from '../src/services/reminderController';
import { createGardenFixture } from './fixtures/gardenFixture';

type Core = typeof import('../src/i18n/core');
type Localization = typeof import('../src/i18n/index');
type Locale = actualCore.Locale;
const compile = (file: string) => ts.transpileModule(readFileSync(new URL(file, import.meta.url), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const coreCode = compile('../src/i18n/core.ts');
const indexCode = compile('../src/i18n/index.ts');

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const flush = async () => { for (let index = 0; index < 12; index++) await Promise.resolve(); };

/** Run the real preference module against isolated SQLite and React ports. */
function runtime(options: {
  stored?: string | null;
  get?: () => Promise<string | null>;
  set?: (value: string) => Promise<void>;
} = {}) {
  const core = {} as Core;
  runInNewContext(coreCode, { exports: core, Intl, require: (id: string) => {
    switch (id) {
      case './account': return { accountMessages };
      case './garden': return { gardenMessages };
      case './inventory': return { inventoryMessages };
      case './common': return { commonMessages };
      case './actionMessages': return { actionMessages };
      default: throw new Error(`Unexpected core dependency: ${id}`);
    }
  } });
  const localization = {} as Localization;
  const reads: string[] = [];
  const writes: { key: string; value: string }[] = [];
  const hooks: {
    subscribe: Core['subscribeLocale']; snapshot: Core['getLocale']; server: () => Locale;
  }[] = [];
  let stored = options.stored ?? null;
  runInNewContext(indexCode, { exports: localization, require: (id: string) => {
    if (id === './core') return core;
    if (id === 'react') return { useSyncExternalStore: (
      subscribe: Core['subscribeLocale'], snapshot: Core['getLocale'], server: () => Locale,
    ) => { hooks.push({ subscribe, snapshot, server }); return snapshot(); } };
    if (id === 'expo-sqlite/kv-store') return { __esModule: true, default: {
      getItem: async (key: string) => { reads.push(key); return options.get ? options.get() : stored; },
      setItem: async (key: string, value: string) => {
        writes.push({ key, value });
        if (options.set) await options.set(value);
        stored = value;
      },
    } };
    throw new Error(`Unexpected localization dependency: ${id}`);
  } });
  return { core, localization, reads, writes, hooks, get stored() { return stored; } };
}

test('language allowlist, names and exact Vietnamese/English/Japanese UI copy', () => {
  const { core } = runtime();
  assert.equal(core.getLocale(), 'vi');
  assert.deepEqual(JSON.parse(JSON.stringify(core.LANGUAGES)), [
    { code: 'vi', name: 'Tiếng Việt' }, { code: 'en', name: 'English' }, { code: 'ja', name: '日本語' },
  ]);
  for (const value of [undefined, null, '', 'fr', 'zh', 'EN', 1, {}, ['ja']]) assert.equal(core.isLocale(value), false);
  for (const [locale, tag, label] of [
    ['vi', 'vi-VN', 'Ngôn ngữ'], ['en', 'en-US', 'Language'], ['ja', 'ja-JP', '言語'],
  ] as const) {
    assert.equal(core.isLocale(locale), true);
    core.commitLocale(locale);
    assert.equal(core.getLocale(), locale);
    assert.equal(core.getLocaleTag(), tag);
    assert.equal(core.t('Ngôn ngữ'), label);
  }
  assert.throws(() => core.commitLocale('fr' as Locale), /Unsupported language/);
  assert.equal(core.getLocale(), 'ja', 'Invalid values cannot change the active language');
});

test('explicit lookup handles whitespace while unknown user content is preserved verbatim', () => {
  const { core } = runtime();
  const unknown = '  Cây của tôi 🌿 — Paper\nメモ: đất ẩm vừa đủ.  ';
  assert.equal(core.t(' \n Đóng\t '), ' \n Đóng\t ', 'Vietnamese keeps the original source layout');
  for (const locale of ['vi', 'en', 'ja'] as const) {
    core.commitLocale(locale);
    assert.equal(core.t(unknown), unknown);
    assert.equal(core.t(''), '');
  }
  core.commitLocale('en'); assert.equal(core.t(' \n Đóng\t '), 'Close');
  core.commitLocale('ja'); assert.equal(core.t(' \n Đóng\t '), '閉じる');
});

test('interpolation supports zero, preserves missing slots and never evaluates inserted user text', () => {
  const { core } = runtime();
  for (const [locale, expected] of [
    ['vi', 'Cấp 0'], ['en', 'Level 0'], ['ja', 'レベル 0'],
  ] as const) {
    core.commitLocale(locale);
    assert.equal(core.t('Cấp {level}', { level: 0 }), expected);
    assert.ok(core.t('Cấp {level}').includes('{level}'));
    const name = 'Paper {level} $& 日本語';
    assert.ok(core.t('Trợ lý của {name}', { name, level: 7 }).includes(name), 'Inserted content is not recursively translated or interpolated');
  }
  const inherited = Object.create({ name: 'Not an own property' }) as actualCore.TranslationParams;
  assert.ok(core.t('Trợ lý của {name}', inherited).includes('{name}'));
  assert.equal(core.t('{name}:{count}:{empty}', { name: 'A', count: 0, empty: '' }), 'A:0:');
});

test('locale listeners fire only for real changes and unsubscribe cleanly', () => {
  const { core } = runtime();
  const observed: Locale[] = [];
  const unsubscribe = core.subscribeLocale(() => observed.push(core.getLocale()));
  core.commitLocale('vi');
  core.commitLocale('en');
  core.commitLocale('en');
  core.commitLocale('ja');
  assert.deepEqual(observed, ['en', 'ja']);
  unsubscribe(); unsubscribe();
  core.commitLocale('vi');
  assert.deepEqual(observed, ['en', 'ja']);
});

test('number formatting uses each selected Intl locale', () => {
  const { core } = runtime();
  for (const [locale, expected] of [
    ['vi', '1.234.567,89'], ['en', '1,234,567.89'], ['ja', '1,234,567.89'],
  ] as const) {
    core.commitLocale(locale);
    assert.equal(core.formatNumber(1234567.89), expected);
    assert.equal(core.formatNumber(0), '0');
    assert.equal(core.formatNumber(-20), '-20');
  }
});

test('every dictionary entry has both translations with the same placeholder set', () => {
  const placeholders = (value: string) => [...new Set([...value.matchAll(/\{([A-Za-z][A-Za-z0-9_]*)\}/g)].map(match => match[1]))].sort();
  const dictionaries = { accountMessages, gardenMessages, inventoryMessages, actionMessages, commonMessages };
  for (const [name, dictionary] of Object.entries(dictionaries)) {
    assert.ok(Object.keys(dictionary).length > 0, `${name} is not empty`);
    for (const [source, pair] of Object.entries(dictionary)) {
      assert.ok(source.trim(), `${name}: source cannot be empty`);
      assert.equal(pair.length, 2, `${name}: ${source}`);
      for (const translation of pair) {
        assert.ok(translation.trim(), `${name}: ${source}`);
        assert.deepEqual(placeholders(translation), placeholders(source), `${name}: ${source}`);
        assert.doesNotMatch(translation, /\uFFFD/, `${name}: ${source}`);
      }
    }
  }
});

test('language preference hydrates from SQLite once and is restored in a new installation session', async () => {
  const first = runtime({ stored: 'en' });
  const initial = first.localization.loadLanguage();
  assert.equal(first.localization.loadLanguage(), initial, 'Concurrent loads share one read');
  await initial;
  assert.deepEqual(first.reads, [first.localization.LANGUAGE_STORAGE_KEY]);
  assert.equal(first.core.getLocale(), 'en');
  await first.localization.setLocale('ja');
  assert.deepEqual(first.writes, [{ key: 'PAT_UI_LANGUAGE_V1', value: 'ja' }]);
  assert.equal(first.stored, 'ja');
  const reopened = runtime({ stored: first.stored });
  await reopened.localization.loadLanguage();
  assert.equal(reopened.core.getLocale(), 'ja');
});

test('invalid or unreadable saved language retains Vietnamese and explicit choices remain usable', async () => {
  for (const get of [async () => 'fr', async () => null, async () => { throw new Error('SQLite read failed'); }]) {
    const instance = runtime({ get });
    await instance.localization.loadLanguage();
    assert.equal(instance.core.getLocale(), 'vi');
    await instance.localization.setLocale('en');
    assert.equal(instance.stored, 'en');
    assert.equal(instance.core.getLocale(), 'en');
  }
});

test('concurrent choices serialize SQLite writes and commit only after each durable write', async () => {
  const gates = [deferred<void>(), deferred<void>()];
  let index = 0;
  const instance = runtime({ set: () => gates[index++].promise });
  const observed: Locale[] = [];
  instance.core.subscribeLocale(() => observed.push(instance.core.getLocale()));
  const english = instance.localization.setLocale('en');
  const japanese = instance.localization.setLocale('ja');
  await flush();
  assert.deepEqual(instance.writes.map(entry => entry.value), ['en']);
  assert.equal(instance.core.getLocale(), 'vi');
  gates[0].resolve(); await english; await flush();
  assert.equal(instance.core.getLocale(), 'en');
  assert.deepEqual(instance.writes.map(entry => entry.value), ['en', 'ja']);
  gates[1].resolve(); await japanese;
  assert.equal(instance.core.getLocale(), 'ja');
  assert.equal(instance.stored, 'ja');
  assert.deepEqual(observed, ['en', 'ja']);
});

test('slow hydration completes before a newer explicit choice and cannot overwrite it', async () => {
  const read = deferred<string | null>();
  const instance = runtime({ get: () => read.promise });
  const hydration = instance.localization.loadLanguage();
  const explicit = instance.localization.setLocale('ja');
  await flush();
  assert.equal(instance.writes.length, 0, 'The new choice waits for pending hydration');
  read.resolve('en');
  await Promise.all([hydration, explicit]);
  assert.equal(instance.core.getLocale(), 'ja');
  assert.equal(instance.stored, 'ja');
  await instance.localization.loadLanguage();
  assert.equal(instance.core.getLocale(), 'ja');
  assert.equal(instance.reads.length, 1);
});

test('write failure keeps the old locale, reports a localized error and does not poison the queue', async () => {
  let fail = true;
  const retryWrite = deferred<void>();
  const instance = runtime({ stored: 'ja', set: async () => {
    if (fail) { fail = false; throw new Error('disk full'); }
    await retryWrite.promise;
  } });
  await instance.localization.loadLanguage();
  const failure = instance.localization.setLocale('en');
  const retry = instance.localization.setLocale('vi');
  await assert.rejects(failure, /言語を保存できませんでした/);
  assert.equal(instance.core.getLocale(), 'ja', 'Failed writes never commit the requested language');
  assert.equal(instance.stored, 'ja');
  retryWrite.resolve();
  await retry;
  assert.equal(instance.stored, 'vi');
  assert.equal(instance.core.getLocale(), 'vi');
  assert.deepEqual(instance.writes.map(entry => entry.value), ['en', 'vi']);
});

test('unsupported explicit choices never read or write SQLite', async () => {
  const instance = runtime();
  await assert.rejects(instance.localization.setLocale('fr' as Locale), /Unsupported language/);
  assert.deepEqual(instance.reads, []);
  assert.deepEqual(instance.writes, []);
  assert.equal(instance.core.getLocale(), 'vi');
});

test('the React hook subscribes to the same locale store with a deterministic Vietnamese server snapshot', async () => {
  const instance = runtime();
  const hook = instance.localization.useI18n();
  assert.equal(hook.locale, 'vi');
  assert.equal(hook.t, instance.core.t);
  assert.equal(hook.setLocale, instance.localization.setLocale);
  assert.equal(instance.hooks[0].subscribe, instance.core.subscribeLocale);
  assert.equal(instance.hooks[0].snapshot, instance.core.getLocale);
  assert.equal(instance.hooks[0].server(), 'vi');
  await hook.setLocale('en');
  assert.equal(instance.localization.useI18n().locale, 'en');
  assert.equal(instance.hooks[1].server(), 'vi');
});

test('daily reminder language changes its copy and signature, never the UTC+7 schedule or garden data', () => {
  const garden = createGardenFixture();
  const before = JSON.stringify(garden);
  const now = new Date('2026-11-06T00:00:00Z');
  try {
    actualCore.commitLocale('vi');
    const vietnamese = buildGardenReminderPlan(garden, '08:00', now);
    assert.ok(vietnamese.length > 0);
    assert.equal(vietnamese[0].title, 'Chào buổi sáng, người chăm vườn!');
    for (const [locale, title] of [
      ['en', 'Good morning, gardener!'], ['ja', 'おはようございます、庭のお世話係さん！'],
    ] as const) {
      actualCore.commitLocale(locale);
      const translated = buildGardenReminderPlan(garden, '08:00', now);
      assert.equal(translated[0].title, title);
      assert.deepEqual(translated.map(({ id, date, at }) => ({ id, date, at })), vietnamese.map(({ id, date, at }) => ({ id, date, at })));
      for (let index = 0; index < translated.length; index++) {
        assert.equal(translated[index].title, actualCore.t(vietnamese[index].title));
        assert.equal(translated[index].body, actualCore.t(vietnamese[index].body));
        assert.notEqual(translated[index].signature, vietnamese[index].signature);
      }
    }
    assert.equal(JSON.stringify(garden), before);
  } finally { actualCore.commitLocale('vi'); }
});

test('reminder reconciliation replaces already-scheduled old-language copy instead of duplicating it', async () => {
  const garden = createGardenFixture();
  const now = new Date('2026-11-06T00:00:00Z');
  const pending = new Map<string, { signature: string; title: string }>();
  const cancelled: string[] = [];
  const controller = createDailyReminderController({
    list: async () => [...pending].map(([id, entry]) => ({ id, signature: entry.signature })),
    allowed: async () => true,
    cancel: async id => { cancelled.push(id); pending.delete(id); },
    schedule: async reminder => { pending.set(reminder.id, { signature: reminder.signature, title: reminder.title }); },
  });
  try {
    actualCore.commitLocale('vi');
    await controller({ enabled: true, time: '08:00', garden, now });
    const count = pending.size;
    assert.ok(count > 0);
    actualCore.commitLocale('ja');
    await controller({ enabled: true, time: '08:00', garden, now });
    assert.equal(pending.size, count);
    assert.equal(cancelled.length, count);
    assert.ok([...pending.values()].every(entry => /[\u3040-\u30ff\u3400-\u9fff]/u.test(entry.title)));
    await controller({ enabled: true, time: '08:00', garden, now });
    assert.equal(cancelled.length, count, 'An unchanged language retains matching schedules');
  } finally { actualCore.commitLocale('vi'); }
});
