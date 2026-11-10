/** Kiểm thử thanh điều hướng đổi theo ngôn ngữ và nút máy ảnh được căn giữa, không có nhãn hiển thị. */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
import { commitLocale, t } from '../src/i18n/core';

type Node = { type: unknown; props: Record<string, unknown> };
type Options = { title: string; tabBarShowLabel?: boolean; tabBarAccessibilityLabel?: string;
  tabBarIconStyle?: { width: number; height: number } };
const compile = (path: string) => ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const jsx = (type: unknown, props: Record<string, unknown>): Node => ({ type, props });

function tabs(bottom = 0) {
  const native = { View: 'View', Platform: { OS: 'android', Version: 28 },
    StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 } };
  const theme = {};
  runInNewContext(compile('../src/theme.ts'), { exports: theme, require: () => native });
  const module = {} as { default: () => Node };
  runInNewContext(compile('../src/app/(tabs)/_layout.tsx'), { exports: module, require: (id: string) => {
    if (id === 'react/jsx-runtime') return { jsx, jsxs: jsx };
    if (id === 'react-native') return native;
    if (id === '@expo/vector-icons/Ionicons') return { __esModule: true, default: 'Icon' };
    if (id === 'expo-router') return { Tabs: { Screen: 'TabScreen' } };
    if (id === 'expo-router/react-navigation') return { PlatformPressable: 'PlatformPressable' };
    if (id === 'react-native-safe-area-context') return { useSafeAreaInsets: () => ({ top: 0, bottom }) };
    if (id === '@/components/UnreadDot') return { UnreadDot: 'UnreadDot' };
    if (id === '@/hooks/useControlFocus') return { useControlFocus: () => ({ props: () => ({}), style: () => undefined }) };
    if (id === '@/i18n') return { useI18n: () => ({ t }) };
    if (id === '@/store/AppStore') return { useApp: () => ({ state: { mailbox: [] } }) };
    if (id === '@/theme') return theme;
    throw new Error(`Unexpected dependency: ${id}`);
  } });
  const render = () => module.default();
  const screens = () => Object.fromEntries((render().props.children as Node[]).map(node => [node.props.name, node.props.options as Options]));
  const shared = (name: string) => (render().props.screenOptions as (props: unknown) => {
    tabBarStyle: { height: number; paddingTop: number; paddingBottom: number };
    tabBarIcon: (props: unknown) => Node;
  })({ route: { name, key: name } });
  return { screens, shared };
}

test('all bottom navigation titles update on the same mounted layout in Vietnamese, English and Japanese', () => {
  const ui = tabs();
  try {
    for (const [locale, expected] of [
      ['vi', ['Vườn', 'Kho đồ', 'Đấu trường', 'Hồ sơ']],
      ['en', ['Garden', 'Inventory', 'Arena', 'Profile']],
      ['ja', ['庭', '持ち物', 'アリーナ', 'プロフィール']],
    ] as const) {
      commitLocale(locale);
      assert.deepEqual(['garden', 'inventory', 'battle', 'profile'].map(name => ui.screens()[name].title), [...expected]);
    }
  } finally { commitLocale('vi'); }
});

test('camera has no visible label, but keeps its localized accessible name and centered touch-sized artwork', () => {
  try {
    for (const bottom of [0, 24, 34]) {
      const ui = tabs(bottom);
      commitLocale('ja');
      const camera = ui.screens().camera;
      assert.equal(camera.tabBarShowLabel, false);
      assert.equal(camera.tabBarAccessibilityLabel, 'カメラを開いて植物を識別');
      const bar = ui.shared('garden').tabBarStyle;
      const artwork = ui.shared('camera').tabBarIcon({ color: 'green', focused: false });
      const style = artwork.props.style as { width: number; height: number; alignItems: string; justifyContent: string };
      assert.equal(style.width, 64); assert.equal(style.height, 64);
      assert.equal(style.width, style.height, 'camera is a circle, not a short pill');
      assert.equal(style.alignItems, 'center'); assert.equal(style.justifyContent, 'center');
      assert.equal(camera.tabBarIconStyle?.height, style.height);
      assert.ok(style.height <= bar.height - bar.paddingBottom - bar.paddingTop);
      assert.equal(bar.paddingBottom, bottom);
      assert.equal((artwork.props.children as Node).props.accessible, false);
      assert.equal((artwork.props.children as Node).props.size, 32);
      assert.equal(((artwork.props.children as Node).props.style as { includeFontPadding: boolean }).includeFontPadding, false);
    }
  } finally { commitLocale('vi'); }
});
