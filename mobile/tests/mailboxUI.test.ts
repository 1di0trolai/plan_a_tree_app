/** Kiểm thử bộ lọc hòm thư, chi tiết thư, nhận quà và thao tác đọc hoặc xóa hàng loạt. */

import { viI18n } from "./fixtures/i18nFixture";
import { commitLocale, getLocaleTag, t } from '../src/i18n/core';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
import { createInitialState } from '../src/data/seed';
import type { MailMessage } from '../src/types/app';

const source = readFileSync(new URL('../src/screens/mailbox/MailboxContent.tsx', import.meta.url), 'utf8');
const compile = (value: string) => ts.transpileModule(value, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const theme = {};
runInNewContext(compile(readFileSync(new URL('../src/theme.ts', import.meta.url), 'utf8')), { exports: theme, require: () => ({ Platform: { OS: 'ios', Version: 26 } }) });
type Node = { type: unknown; props: Record<string, unknown> };
const jsx = (type: unknown, props: Record<string, unknown>) => ({ type, props });
const exports = {} as { MailboxContent: (props: Record<string, unknown>) => Node; hasMailReward: (mail: MailMessage) => boolean; canDeleteMail: (mail: MailMessage) => boolean };
runInNewContext(compile(source), { exports, require: (id: string) => {
  switch (id) {
        case "@/i18n": return { useI18n: () => viI18n };
        case "@/i18n/core": return viI18n;
    case 'react': return { createElement: (type: unknown, props: Record<string, unknown>, ...children: unknown[]) => jsx(type, { ...props, children }) };
    case 'react/jsx-runtime': return { jsx, jsxs: jsx, Fragment: 'Fragment' };
    case 'react-native': return { Text: 'Text', Pressable: 'Pressable', View: 'View', ScrollView: 'ScrollView', Modal: 'Modal', StyleSheet: { create: (value: unknown) => value, hairlineWidth: 1, absoluteFill: {} } };
    case 'react-native-safe-area-context': return { useSafeAreaInsets: () => ({ top: 44, bottom: 34 }) };
    case '@/components/journeyUI': return { JourneyButton: 'JourneyButton' };
    case '@/components/CurrencyArtwork': return { CurrencyArtwork: 'CurrencyArtwork' };
    case '@/components/FoodArtwork': return { FoodArtwork: 'FoodArtwork' };
    case '@/hooks/useControlFocus': return { useControlFocus: () => ({ props: () => ({}), style: () => undefined }) };
    case '@/theme': return theme;
    case '@expo/vector-icons/Ionicons': return { __esModule: true, default: 'Icon' };
    default: throw new Error(id);
  }
} });
const mail = (id: string, props: Partial<MailMessage> = {}): MailMessage => ({ id, source: 'system', sourceRef: id, title: id, body: '', createdAt: '2026-11-01T00:00:00Z', readAt: null, claimedAt: null, attachments: [], ...props });
const messages = [mail('notice', { source: 'publisher' }), mail('gift', { readAt: '2026-11-01T01:00:00Z', attachments: [{ kind: 'food', itemId: 'berry-bites', quantity: 7 }, { kind: 'gold', quantity: 50 }] }), mail('paid', { claimedAt: '2026-11-01T01:00:00Z', readAt: '2026-11-01T01:00:00Z', attachments: [{ kind: 'gold', quantity: 10 }] })];
function render(props: Record<string, unknown> = {}) {
  const events: string[] = [];
  const tree = exports.MailboxContent({ messages, items: createInitialState().inventory.items, filter: 'all', selectedId: null, busy: false, pendingRecovery: false, error: '',
    onOpen: (id: string) => events.push(`open:${id}`), onClose: () => events.push('close'), onFilter: (id: string) => events.push(`filter:${id}`), onClaim: (id: string) => events.push(`claim:${id}`), onClaimAll: () => events.push('claim-all'), onReadAll: () => events.push('read-all'), onDeleteAll: () => events.push('delete-all'), onDelete: (id: string) => events.push(`delete:${id}`), onRetry: () => events.push('retry'), ...props });
  const nodes = (value: unknown): Node[] => Array.isArray(value) ? value.flatMap(nodes) : value && typeof value === 'object' && 'props' in value ? (value as Node).type === 'Modal' && !(value as Node).props.visible ? [] : [value as Node, ...nodes((value as Node).props.children)] : [];
  const all = nodes(tree), byId = (id: string) => all.find(node => node.props.testID === id);
  return { events, all, byId, press: (id: string) => { const control = byId(id); assert.ok(control); if (!control.props.disabled) (control.props.onPress as () => void)(); } };
}
test('mailbox exposes only all/unread filters; publisher notices need no attachments', () => {
  assert.equal(render().all.filter(node => String(node.props.testID).startsWith('mail-row-')).length, 3);
  assert.ok(render({ filter: 'unread' }).byId('mail-row-notice')); assert.equal(render({ filter: 'unread' }).byId('mail-row-gift'), undefined);
  const ui = render(); assert.equal(ui.byId('mail-filter-gifts'), undefined);
  ui.press('mail-row-gift'); ui.press('mail-filter-unread'); assert.deepEqual(ui.events, ['open:gift', 'filter:unread']);
});

test('English and Japanese mailbox controls translate without rewriting publisher mail', () => {
  const originalTranslate = viI18n.t;
  const originalTag = viI18n.getLocaleTag;
  try {
    viI18n.t = t;
    viI18n.getLocaleTag = getLocaleTag;
    const original = mail('original', { source: 'publisher', title: 'Kho đồ', body: 'Một ghi chú riêng của người gửi.' });
    for (const [locale, readAll, deleteAll] of [['en', 'Read all', 'Delete all'], ['ja', 'すべて既読', 'すべて削除']] as const) {
      commitLocale(locale);
      const ui = render({ messages: [original], selectedId: original.id });
      assert.equal(ui.byId('mail-read-all')!.props.title, readAll);
      assert.equal(ui.byId('mail-delete-all')!.props.title, deleteAll);
      const text = ui.all.filter(node => node.type === 'Text').map(node => node.props.children).flat(Infinity);
      assert.ok(text.includes(original.title));
      assert.ok(text.includes(original.body));
      assert.equal(original.title, 'Kho đồ');
    }
    commitLocale('ja');
    const system = mail('cycle', { sourceRef: 'login-cycle-2', title: 'Quà ghé vườn', body: 'Quà chưa nhận của chu kỳ 2.' });
    const systemUi = render({ messages: [system], selectedId: system.id });
    const systemText = systemUi.all.filter(node => node.type === 'Text').map(node => node.props.children).flat(Infinity);
    assert.ok(systemText.includes('サイクル2の未受け取りギフトです。'));
    assert.equal(system.body, 'Quà chưa nhận của chu kỳ 2.');
  } finally {
    viI18n.t = originalTranslate;
    viI18n.getLocaleTag = originalTag;
    commitLocale('vi');
  }
});

test('mailbox no longer exposes sample letter generation and preserves existing letters', () => {
  const ui = render();
  assert.equal(ui.byId('mail-add-demo'), undefined);
  assert.equal(ui.all.filter(node => String(node.props.testID).startsWith('mail-row-')).length, messages.length);
  assert.deepEqual(ui.events, []);
  const route = readFileSync(new URL('../src/app/mailbox.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(route, /grantDemoMail|onAddDemo/);
  assert.doesNotMatch(source, /Nạp thư mẫu|onAddDemo|mail-add-demo/);
});
test('unclaimed attachments have one receive action and no delete; gold and foods keep exact counts', () => {
  const ui = render({ selectedId: 'gift' }); assert.equal(ui.byId('mail-delete'), undefined);
  assert.equal(ui.all.filter(node => node.props.testID === 'mail-attachment').length, 2);
  ui.press('mail-claim'); assert.deepEqual(ui.events, ['claim:gift']);
  assert.equal(exports.hasMailReward(messages[1]), true); assert.equal(exports.canDeleteMail(messages[1]), false);
});
test('bulk read and delete act on the whole mailbox, not only the displayed filter', () => {
  const ui = render({ filter: 'unread' }); ui.press('mail-read-all'); ui.press('mail-delete-all');
  assert.deepEqual(ui.events, ['read-all', 'delete-all']);
  assert.equal(ui.byId('mail-read-all')!.props.title, 'Đọc tất cả');
  assert.equal(ui.byId('mail-delete-all')!.props.title, 'Xoá tất cả');
});
test('bulk actions are unavailable for empty/no eligible mail and during write recovery', () => {
  for (const props of [{ messages: [] }, { busy: true }, { pendingRecovery: true }]) {
    const ui = render(props); ui.press('mail-read-all'); ui.press('mail-delete-all'); assert.deepEqual(ui.events, []);
  }
  const giftsOnly = render({ messages: [messages[1]] }); giftsOnly.press('mail-delete-all'); giftsOnly.press('mail-read-all');
  assert.deepEqual(giftsOnly.events, []);
  assert.equal((render().byId('mail-bulk-actions')!.props.style as { flexWrap: string }).flexWrap, 'wrap');
});
test('claimed gift or plain notice can be deleted; receive all is disabled while saving/recovering', () => {
  for (const id of ['notice', 'paid']) { const ui = render({ selectedId: id }); assert.equal(ui.byId('mail-claim'), undefined); ui.press('mail-delete'); assert.deepEqual(ui.events, [`delete:${id}`]); }
  for (const props of [{ busy: true }, { pendingRecovery: true }]) { const ui = render(props); ui.press('mail-claim-all'); assert.equal(ui.events.length, 0); }
  const ui = render(); ui.press('mail-claim-all'); assert.deepEqual(ui.events, ['claim-all']);
});
test('pending write shows explicit recovery, empty filters are calm, all close paths remain available', () => {
  const ui = render({ selectedId: 'gift', pendingRecovery: true, error: 'Not saved' }); ui.press('mailbox-retry'); assert.deepEqual(ui.events, ['retry']);
  assert.ok(render({ messages: [] }).byId('mailbox-empty'));
  const detail = render({ selectedId: 'notice' }); (detail.byId('mail-detail')!.props.onAccessibilityEscape as () => void)(); assert.deepEqual(detail.events, ['close']);
});
test('profile exposes mailbox and protected stack registers it without remote send controls', () => {
  assert.match(readFileSync(new URL('../src/app/(tabs)/profile.tsx', import.meta.url), 'utf8'), /router.push\("\/mailbox"\)/);
  assert.match(readFileSync(new URL('../src/app/_layout.tsx', import.meta.url), 'utf8'), /Stack.Screen name="mailbox"/);
  assert.doesNotMatch(source, /sendMail|publishMail|adminEndpoint/);
});

function routeUi(result = Promise.resolve({ ok: true, message: 'Đã lưu' })) {
  type Button = { text: string; style?: string; onPress?: () => void };
  const alerts: { title: string; message: string; buttons: Button[]; options: { onDismiss: () => void } }[] = [];
  const calls: string[] = [];
  const hooks: { value: unknown; deps?: readonly unknown[]; cleanup?: () => void }[] = [];
  let cursor = 0;
  const app = { state: { mailbox: messages, inventory: { items: [] } }, pendingRewardAction: false,
    retrySync: async () => ({ ok: true, message: 'Đã đồng bộ' }),
    markMailRead: async (id: string) => { calls.push(`read:${id}`); return result; },
    markAllMailRead: async () => { calls.push('read-all'); return result; },
    deleteAllMail: async () => { calls.push('delete-all'); return result; },
  };
  const route = {} as { default: () => Node };
  runInNewContext(compile(readFileSync(new URL('../src/app/mailbox.tsx', import.meta.url), 'utf8')), {
    exports: route, require: (id: string) => {
      switch (id) {
        case "@/i18n": return { useI18n: () => viI18n };
        case "@/i18n/core": return viI18n;
        case 'react': return {
          useCallback: (callback: unknown) => callback,
          useState: (initial: unknown) => { const index = cursor++; hooks[index] ??= { value: initial }; return [hooks[index].value, (value: unknown) => { hooks[index].value = value; }]; },
          useRef: (initial: unknown) => { const index = cursor++; hooks[index] ??= { value: { current: initial } }; return hooks[index].value; },
          useEffect: (effect: () => void | (() => void), deps: readonly unknown[]) => {
            const index = cursor++, previous = hooks[index];
            if (!previous || !previous.deps || deps.some((value, i) => !Object.is(value, previous.deps![i]))) {
              previous?.cleanup?.(); const cleanup = effect();
              hooks[index] = { value: undefined, deps, cleanup: typeof cleanup === 'function' ? cleanup : undefined };
            }
          },
        };
        case 'react/jsx-runtime': return { jsx, jsxs: jsx };
        case 'expo-router': return { useFocusEffect: (callback: () => void) => callback() };
        case 'react-native': return { View: 'View', StyleSheet: { create: (value: unknown) => value }, Alert: { alert: (title: string, message: string, buttons: Button[], options: { onDismiss: () => void }) => alerts.push({ title, message, buttons, options }) } };
        case 'react-native-safe-area-context': return { SafeAreaView: 'SafeAreaView' };
        case '@/components/journeyUI': return { JourneyHeader: 'JourneyHeader' };
        case '@/screens/mailbox/MailboxContent': return { MailboxContent: 'MailboxContent', canDeleteMail: exports.canDeleteMail };
        case '@/store/AppStore': return { useApp: () => app };
        case '@/theme': return theme;
        default: throw new Error(id);
      }
    },
  });
  const nodes = (value: unknown): Node[] => Array.isArray(value) ? value.flatMap(nodes) : value && typeof value === 'object' && 'props' in value ? [value as Node, ...nodes((value as Node).props.children)] : [];
  return { app, alerts, calls, content: () => { cursor = 0; return nodes(route.default()).find(node => node.type === 'MailboxContent')!.props; }, unmount: () => hooks.forEach(hook => hook.cleanup?.()) };
}
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
test('bulk delete asks native confirmation once, describes gift protection and supports cancel/dismiss', async () => {
  const ui = routeUi(), content = ui.content();
  (content.onDeleteAll as () => void)(); (content.onDeleteAll as () => void)();
  assert.equal(ui.alerts.length, 1); assert.deepEqual(ui.calls, []);
  assert.match(ui.alerts[0].message, /Xoá 2 thư/); assert.match(ui.alerts[0].message, /quà chưa nhận sẽ được giữ lại/);
  ui.alerts[0].buttons.find(button => button.style === 'cancel')!.onPress!();
  assert.deepEqual(ui.calls, []);
  (content.onDeleteAll as () => void)(); ui.alerts[1].options.onDismiss();
  (content.onDeleteAll as () => void)();
  ui.alerts[2].buttons.find(button => button.style === 'destructive')!.onPress!();
  await flush(); assert.deepEqual(ui.calls, ['delete-all']);
});
test('bulk controls suppress repeated pending actions, protected-only deletion and stale unmounted confirmation', async () => {
  let finish!: (result: { ok: boolean; message: string }) => void;
  const ui = routeUi(new Promise(resolve => { finish = resolve; })), content = ui.content();
  (content.onReadAll as () => void)(); (content.onReadAll as () => void)(); (content.onDeleteAll as () => void)();
  assert.deepEqual(ui.calls, ['read-all']); assert.equal(ui.alerts.length, 0);
  finish({ ok: false, message: 'Chưa lưu được thay đổi' }); await flush();
  assert.equal(ui.content().error, 'Chưa lưu được thay đổi');
  const protectedOnly = routeUi(); protectedOnly.app.state.mailbox = [messages[1]];
  (protectedOnly.content().onDeleteAll as () => void)(); assert.equal(protectedOnly.alerts.length, 0);
  const stale = routeUi(); (stale.content().onDeleteAll as () => void)(); stale.unmount();
  stale.alerts[0].buttons.find(button => button.style === 'destructive')!.onPress!();
  assert.deepEqual(stale.calls, []);
  const recovering = routeUi(); recovering.app.pendingRewardAction = true;
  (recovering.content().onDeleteAll as () => void)(); assert.equal(recovering.alerts.length, 0);
});
