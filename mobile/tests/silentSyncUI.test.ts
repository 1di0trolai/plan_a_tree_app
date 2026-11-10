/** Kiểm thử đồng bộ thông thường không hiện thông báo hoặc nút lưu, nhưng xung đột vẫn cần xác nhận. */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
import type { SyncStatus } from '../src/store/cloudStorage';
import { viI18n } from './fixtures/i18nFixture';

type Node = { type: unknown; props: Record<string, unknown> };
const compile = (file: string) => ts.transpileModule(readFileSync(new URL(file, import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;

function banner(status?: SyncStatus) {
  let reloads = 0;
  const alerts: { text: string; onPress: () => void }[][] = [];
  const native = { ActivityIndicator: 'Spinner', Pressable: 'Pressable', Text: 'Text', View: 'View',
    Platform: { OS: 'android', Version: 28 }, StyleSheet: { create: (styles: unknown) => styles },
    Alert: { alert: (_title: string, _message: string, buttons: { text: string; onPress: () => void }[]) => alerts.push(buttons) } };
  const theme = {};
  runInNewContext(compile('../src/theme.ts'), { exports: theme, require: () => native });
  const jsx = (type: unknown, props: Record<string, unknown>): Node => ({ type, props });
  const component = {} as { SyncStatusBanner: () => Node | null };
  runInNewContext(compile('../src/components/SyncStatusBanner.tsx'), { exports: component, require: (id: string) => {
    if (id === 'react') return { useRef: (value: unknown) => ({ current: value }), useState: (value: unknown) => [value, () => {}] };
    if (id === 'react/jsx-runtime') return { jsx, jsxs: jsx };
    if (id === 'react-native') return native;
    if (id === 'react-native-safe-area-context') return { SafeAreaView: 'SafeAreaView' };
    if (id === '@/i18n') return viI18n;
    if (id === '@/theme') return theme;
    if (id === '@/store/AppStore') return { useApp: () => ({ syncStatus: status,
      retrySync: () => { throw new Error('No manual sync action should be rendered'); },
      reloadCloud: async () => { reloads++; return { ok: true, message: '' }; },
    }) };
    throw new Error(`Unexpected dependency: ${id}`);
  } });
  const nodes = (value: unknown): Node[] => Array.isArray(value) ? value.flatMap(nodes)
    : value && typeof value === 'object' && 'props' in value ? [value as Node, ...nodes((value as Node).props.children)] : [];
  const tree = component.SyncStatusBanner();
  return { tree, nodes: nodes(tree), alerts, reloads: () => reloads };
}

test('ordinary sync, success, offline and temporary errors produce no banner, notification or manual button', () => {
  assert.equal(banner().tree, null);
  for (const phase of ['idle', 'syncing', 'synced', 'offline', 'error'] as const) {
    const ui = banner({ phase, message: 'Internal sync status', retryable: phase === 'offline' });
    assert.equal(ui.tree, null, phase);
    assert.equal(ui.alerts.length, 0);
    assert.equal(ui.reloads(), 0);
  }
});

test('conflicting device saves cannot be overwritten without explicit confirmation', async () => {
  const ui = banner({ phase: 'conflict', message: 'Dữ liệu đã thay đổi trên thiết bị khác.' });
  const button = ui.nodes.find(node => node.props.accessibilityRole === 'button')!;
  assert.equal(button.props.accessibilityLabel, 'Tải dữ liệu mới từ máy chủ');
  assert.equal(ui.reloads(), 0);
  (button.props.onPress as () => void)();
  assert.equal(ui.alerts.length, 1);
  assert.equal(ui.reloads(), 0);
  ui.alerts[0].find(action => action.text === 'Để sau')!.onPress();
  assert.equal(ui.reloads(), 0);
  (button.props.onPress as () => void)();
  ui.alerts[1].find(action => action.text === 'Tải bản mới')!.onPress();
  await Promise.resolve();
  assert.equal(ui.reloads(), 1);
});
